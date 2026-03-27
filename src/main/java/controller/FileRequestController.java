package controller;

import entities.Employee;
import entities.KycFile;
import entities.KycHistory;
import entities.FileRequest;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import repositories.EmployeeRepository;
import repositories.KycFileRepository;
import repositories.KycHistoryRepository;
import services.EmailService;
import repositories.FileRequestRepository;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;

@RestController
@RequestMapping("/api/requests")
public class FileRequestController {

    private final FileRequestRepository requestRepo;
    private final KycFileRepository fileRepo;
    private final EmployeeRepository employeeRepo;
    private final KycHistoryRepository historyRepo;
    private final EmailService emailService;

    public FileRequestController(FileRequestRepository requestRepo,
                                 KycFileRepository fileRepo,
                                 EmployeeRepository employeeRepo,
                                 KycHistoryRepository historyRepo,
                                 EmailService emailService) {
        this.requestRepo = requestRepo;
        this.fileRepo = fileRepo;
        this.employeeRepo = employeeRepo;
        this.historyRepo = historyRepo;
        this.emailService = emailService;
    }

    /* ========= DTOs ========= */

    public record CreateRequestDto(String reference, String requesterEmail, String note) {}
    public record DecisionDto(String approverEmail, String note, String location) {}
    public record CancelDto(String requesterEmail, String note) {}

    /* ========= Queries ========= */

    @GetMapping("/mine")
    public List<FileRequest> myRequests(@RequestParam String requesterEmail) {
        return requestRepo.findByRequesterOrderByCreatedAtDesc(requesterEmail);
    }

    @GetMapping("/pending")
    public List<FileRequest> pendingForMe(@RequestParam String approverEmail) {
        return requestRepo.findByApproverAndStatusOrderByCreatedAtAsc(approverEmail, "PENDING");
    }

    @GetMapping("/{id}")
    public FileRequest one(@PathVariable Integer id) {
        return requestRepo.findById(id).orElseThrow(() -> notFound("Request not found"));
    }

    /* ========= Create ========= */

    @PostMapping
    @Transactional
    public FileRequest create(@RequestBody CreateRequestDto dto) {
        if (dto.reference() == null || dto.requesterEmail() == null)
            throw badRequest("reference and requesterEmail are required");

        KycFile file = fileRepo.findById(dto.reference())
                .orElseThrow(() -> badRequest("File not found"));
        employeeRepo.findById(dto.requesterEmail())
                .orElseThrow(() -> badRequest("Requester not found or not active"));

        // Who should approve? Holder if exists, else PersonInCharge
        var openHistory = historyRepo.findByFileReferenceAndEndAtIsNull(dto.reference());
        String approverEmail;
        if (openHistory.isPresent()) {
            approverEmail = openHistory.get().getHolder().getEmail();
        } else {
            if (file.getPersonInCharge() == null)
                throw badRequest("File has no person-in-charge set");
            approverEmail = file.getPersonInCharge().getEmail();
        }

        FileRequest fr = new FileRequest();
        fr.setFileId(dto.reference());
        fr.setRequester(dto.requesterEmail());
        fr.setApprover(approverEmail);
        fr.setStatus("PENDING");
        fr.setNote(dto.note());
        fr.setCreatedAt(OffsetDateTime.now(ZoneOffset.UTC));

        FileRequest saved = requestRepo.save(fr);

        // ---- notify approver (fire-and-forget) ----
        try {
            emailService.notifyNewRequest(
                approverEmail,
                saved.getFileId(),
                saved.getRequester(),
                file.getClient(),
                saved.getNote()
            );
        } catch (Exception ignore) {}

        return saved;
    }

    /* ========= Approve ========= */

   @PostMapping("/{id}/approve")
    @Transactional
    public FileRequest approve(@PathVariable Integer id, @RequestBody DecisionDto dto) {
        FileRequest fr = requestRepo.findById(id).orElseThrow(() -> notFound("Request not found"));

        requirePending(fr);
        requireApprover(fr, dto.approverEmail());

        // detect "return" requests by NOTE prefix
        boolean isReturn = fr.getNote() != null && fr.getNote().startsWith("[RETURN]");

        KycFile file = fileRepo.findById(fr.getFileId()).orElseThrow(() -> badRequest("File not found"));

        if (isReturn) {
            // ====== RETURN FLOW: holder → PIC confirms return to storage ======
            var openOpt = historyRepo.findByFileReferenceAndEndAtIsNull(fr.getFileId());
            KycHistory open = openOpt.orElseThrow(() -> badRequest("No open custody for this file"));

            // close current custody
            if (open.getEndAt() == null) {
                open.setEndAt(java.time.Instant.now());
                historyRepo.save(open);
            }

            // mark file back as available
            file.setStatus("Available");
            fileRepo.save(file);

            // finish request (no new custody row)
            fr.setStatus("APPROVED");
            fr.setNote(mergeNote(fr.getNote(), dto.note()));
            fr.setDecidedAt(OffsetDateTime.now(ZoneOffset.UTC));
            FileRequest updated = requestRepo.save(fr);

            // notify requester (the holder) that PIC approved the return
        try {
                emailService.notifyReturnConfirmedToHolder(
                    updated.getRequester(),      // holder email
                    updated.getFileId(),
                    updated.getApprover(),       // PIC email
                    dto.location()
                );
            } catch (Exception ignore) {}



            return updated;
        }

        // ====== NORMAL FLOW: give file to new holder ======

        Employee newHolder = employeeRepo.findById(fr.getRequester())
                .orElseThrow(() -> badRequest("Requester not found"));

        // Close open custody if exists — FLUSH so DB sees it closed before new insert
        var open = historyRepo.findByFileReferenceAndEndAtIsNull(fr.getFileId());
        open.ifPresent(h -> {
            if (h.getEndAt() == null) {
                h.setEndAt(java.time.Instant.now());
                historyRepo.save(h);
                historyRepo.flush(); // critical: prevents duplicate "open" row per file
            }
        });

        // New custody entry
        KycHistory h = new KycHistory();
        h.setFile(file);
        h.setHolder(newHolder);
        h.setLocation(dto.location() == null ? "Office" : dto.location());
        h.setStartAt(java.time.Instant.now());
        historyRepo.save(h);

        // Update file status
        file.setStatus("OUT");
        fileRepo.save(file);

        // Finish request
        fr.setStatus("APPROVED");
        fr.setNote(mergeNote(fr.getNote(), dto.note()));
        fr.setDecidedAt(OffsetDateTime.now(ZoneOffset.UTC));
        FileRequest updated = requestRepo.save(fr);

        // ---- notify requester (approved) ----
        try {
            emailService.notifyApproved(
                updated.getRequester(),
                updated.getFileId(),
                updated.getApprover(),
                dto.location()
            );
        } catch (Exception ignore) {}

        // ---- optional: notify previous holder that file was released ----
        open.ifPresent(prev -> {
            try {
                if (prev.getHolder() != null && prev.getHolder().getEmail() != null) {
                    emailService.notifyReleased(
                        prev.getHolder().getEmail(),
                        updated.getFileId(),
                        updated.getRequester()
                    );
                }
            } catch (Exception ignore) {}
        });

        // --- expire (actually: cancel) other pending requests for this file to the old approver
        try {
            String oldApprover = fr.getApprover();
            List<FileRequest> others = requestRepo
                .findAllByFileIdAndApproverAndStatusAndIdNot(fr.getFileId(), oldApprover, "PENDING", fr.getId());
            if (!others.isEmpty()) {
                OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
                for (FileRequest o : others) {
                    o.setStatus("CANCELLED"); // <- use an allowed value
                    o.setDecidedAt(now);
                    o.setNote(mergeNote(o.getNote(),
                        "Auto-cancelled: holder changed to " + newHolder.getEmail()));
                }
                requestRepo.saveAll(others);

                // notify requesters to re-request from the new holder
                for (FileRequest o : others) {
                    try {
                        emailService.notifyRequestExpired( // text still says “expired”
                            o.getRequester(), o.getFileId(), newHolder.getEmail()
                        );
                    } catch (Exception ignore) {}
                }
            }
        } catch (Exception ignore) {}

        return updated;
    }

    /* ========= Decline ========= */

   @PostMapping("/{id}/decline")
    @Transactional
    public FileRequest decline(@PathVariable Integer id, @RequestBody DecisionDto dto) {
        FileRequest fr = requestRepo.findById(id).orElseThrow(() -> notFound("Request not found"));
        requirePending(fr);
        requireApprover(fr, dto.approverEmail());

        boolean isReturn = isReturn(fr);

        fr.setStatus("DECLINED");
        fr.setNote(mergeNote(fr.getNote(), dto.note()));
        fr.setDecidedAt(OffsetDateTime.now(ZoneOffset.UTC));
        FileRequest updated = requestRepo.save(fr);

        // ---- notify requester ----
        try {
         
            if (isReturn) {
                // holder requested a return, PIC rejected
                    emailService.notifyReturnRejectedToHolder(
                    updated.getRequester(),      // holder
                    updated.getFileId(),
                    updated.getApprover(),       // PIC
                    dto.note()
                );
            } else {
                // normal "give me the file" request
                emailService.notifyDeclined(
                    updated.getRequester(),
                    updated.getFileId(),
                    updated.getApprover(),
                    dto.note()
                );
            }
        } catch (Exception ignore) {}

        return updated;
    }


    /* ========= Cancel (by requester) ========= */

    @PostMapping("/{id}/cancel")
    @Transactional
    public FileRequest cancel(@PathVariable Integer id, @RequestBody CancelDto dto) {
        FileRequest fr = requestRepo.findById(id).orElseThrow(() -> notFound("Request not found"));
        requirePending(fr);
        if (dto.requesterEmail() == null || !dto.requesterEmail().equalsIgnoreCase(fr.getRequester()))
            throw forbidden("Only the requester can cancel this request");

        fr.setStatus("CANCELLED");
        fr.setNote(mergeNote(fr.getNote(), dto.note()));
        fr.setDecidedAt(OffsetDateTime.now(ZoneOffset.UTC));
        FileRequest updated = requestRepo.save(fr);

        // inform approver of cancel (optional)
        try {
            emailService.sendHtml(
                updated.getApprover(),
                "[KYC] Request cancelled for file " + updated.getFileId(),
                "<div style=\"font-family:Segoe UI,Arial,sans-serif\">"
                + "<p>Requester <b>" + esc(updated.getRequester()) + "</b> cancelled their request "
                + "for file <b>" + esc(String.valueOf(updated.getFileId())) + "</b>.</p>"
                + (dto.note() != null && !dto.note().isBlank() ? "<p><b>Note:</b> " + esc(dto.note()) + "</p>" : "")
                + "</div>"
            );
        } catch (Exception ignore) {}

        return updated;
    }

    /* ========= helpers ========= */

    private void requirePending(FileRequest fr) {
        if (!"PENDING".equalsIgnoreCase(fr.getStatus()))
            throw badRequest("Request is not pending");
    }

    private void requireApprover(FileRequest fr, String email) {
        if (email == null || !email.equalsIgnoreCase(fr.getApprover()))
            throw forbidden("Only the assigned approver can make this decision");
    }

    private ResponseStatusException notFound(String m) { 
        return new ResponseStatusException(HttpStatus.NOT_FOUND, m); 
    }

    private ResponseStatusException badRequest(String m) { 
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, m); 
    }
    private ResponseStatusException forbidden(String m) { 
        return new ResponseStatusException(HttpStatus.FORBIDDEN, m); 
    }

    private boolean isReturn(FileRequest fr) {
        String note = fr.getNote();
        return note != null && note.startsWith("[RETURN]");
    }


    private String mergeNote(String existing, String add) {
        if (add == null || add.isBlank()) return existing;
        if (existing == null || existing.isBlank()) return add;
        return existing + " | " + add;
    }

    private static String esc(String s){
        if (s == null) return "";
        return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;");
    }
}
