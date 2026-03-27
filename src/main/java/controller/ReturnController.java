package controller;

import entities.KycFile;
import entities.KycHistory;
import entities.FileRequest;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import repositories.KycFileRepository;
import repositories.KycHistoryRepository;
import repositories.FileRequestRepository;
import services.EmailService;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/custody")
public class ReturnController {

    private final KycHistoryRepository historyRepo;
    private final KycFileRepository fileRepo;
    private final FileRequestRepository requestRepo;
    private final EmailService email;

    public ReturnController(KycHistoryRepository historyRepo,
                            KycFileRepository fileRepo,
                            FileRequestRepository requestRepo,
                            EmailService email) {
        this.historyRepo = historyRepo;
        this.fileRepo = fileRepo;
        this.requestRepo = requestRepo;
        this.email = email;
    }

    // Java-8-friendly DTO
    public static class ReturnDto {
        private String reference;
        private String holderEmail;
        public String getReference() { return reference; }
        public void setReference(String reference) { this.reference = reference; }
        public String getHolderEmail() { return holderEmail; }
        public void setHolderEmail(String holderEmail) { this.holderEmail = holderEmail; }
    }

    @PostMapping("/return")
    @Transactional
    public Map<String, Object> returnFile(@RequestBody ReturnDto dto) {
        if (dto.getReference() == null || dto.getHolderEmail() == null || dto.getHolderEmail().trim().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "reference and holderEmail are required");
        }

        // open history for this file
        KycHistory h = historyRepo.findByFileReferenceAndEndAtIsNull(dto.getReference())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "No open custody for this file"));

        // only the current holder can start a return request
        String current = (h.getHolder() != null) ? h.getHolder().getEmail() : null;
        if (current == null || !current.equalsIgnoreCase(dto.getHolderEmail())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only the current holder can request a return");
        }

        KycFile file = h.getFile();
        if (file == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "File not found for history row");
        if (file.getPersonInCharge() == null || file.getPersonInCharge().getEmail() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "File has no person-in-charge set");
        }

        String picEmail = file.getPersonInCharge().getEmail();

        // create a FileRequest that PIC will see in Approvals
        FileRequest fr = new FileRequest();
        fr.setFileId(file.getReference());
        fr.setRequester(current);           // holder
        fr.setApprover(picEmail);           // PIC approves the return
        fr.setStatus("PENDING");
        fr.setNote("[RETURN] Holder requests to return file. Current location: " +
                   (h.getLocation() == null ? "Office" : h.getLocation()));
        fr.setCreatedAt(OffsetDateTime.now(ZoneOffset.UTC));

        FileRequest saved = requestRepo.save(fr);

        // notify PIC by emails
        try {
            email.notifyReturnRequestToPic(
                picEmail,
                saved.getFileId(),
                saved.getRequester(),
                file.getClient(),
                saved.getNote()
            );
        } catch (Exception ignore) {}

        Map<String, Object> resp = new HashMap<>();
        resp.put("ok", true);
        resp.put("requestId", saved.getId());
        return resp;
    }

}
