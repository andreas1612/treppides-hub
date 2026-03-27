package controller;

import entities.KycFile;
import entities.Employee;
import entities.KycHistory;
import repositories.EmployeeRepository;
import repositories.KycFileRepository;
import repositories.KycHistoryRepository;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Optional;

@RestController
@RequestMapping("/api/files")
public class FileController {
    private final KycFileRepository fileRepo;
    private final EmployeeRepository empRepo;
    private final KycHistoryRepository historyRepo;

    public FileController(KycFileRepository fileRepo,
                          EmployeeRepository empRepo,
                          KycHistoryRepository historyRepo) {
        this.fileRepo = fileRepo;
        this.empRepo = empRepo;
        this.historyRepo = historyRepo;
    }

    /* -------- DTO -------- */
    public record FileSummary(
        String reference,
        Boolean isActive,
        String client,
        String st,
        Integer homeFloor,
        String personInChargeEmail,
        // NEW (nullable): live status fields for single-file GET
        String holderEmail,
        String location
    ) {}

    private static FileSummary toSummaryBasic(KycFile f) {
        return new FileSummary(
            f.getReference(),
            f.getIsActive(),
            f.getClient(),
            f.getStatus(),
            f.getHomeFloor(),
            f.getPersonInCharge() != null ? f.getPersonInCharge().getEmail() : null,
            null,   // holderEmail (not populated in list)
            null    // location    (not populated in list)
        );
    }

    private static FileSummary toSummaryWithLive(KycFile f, Optional<KycHistory> open) {
        String holderEmail = open.map(h -> h.getHolder() != null ? h.getHolder().getEmail() : null).orElse(null);
        String location    = open.map(KycHistory::getLocation).orElse(null);
        return new FileSummary(
            f.getReference(),
            f.getIsActive(),
            f.getClient(),
            f.getStatus(),
            f.getHomeFloor(),
            f.getPersonInCharge() != null ? f.getPersonInCharge().getEmail() : null,
            holderEmail,
            location
        );
    }

    /* -------- Endpoints -------- */

    @GetMapping
    public List<FileSummary> all() {
        // keep list lightweight (no per-row history lookup)
        return fileRepo.findAll().stream().map(FileController::toSummaryBasic).toList();
    }

    @GetMapping("/{reference}")
    public FileSummary one(@PathVariable String reference) {
        var file = fileRepo.findById(reference).orElseThrow();
        var open = historyRepo.findByFileReferenceAndEndAtIsNull(reference);
        return toSummaryWithLive(file, open);
    }

    @PostMapping
    public FileSummary create(@RequestBody FileSummary dto) {
        var f = new KycFile();
        f.setReference(dto.reference());
        f.setIsActive(dto.isActive() != null ? dto.isActive() : true);
        f.setClient(dto.client());
        f.setStatus(dto.st() != null ? dto.st() : "Available"); // default
        f.setHomeFloor(dto.homeFloor());

        if (dto.personInChargeEmail() != null) {
            Employee pic = empRepo.findById(dto.personInChargeEmail())
                    .orElseThrow(() -> new IllegalArgumentException("PIC not found"));
            f.setPersonInCharge(pic);
        }
        return toSummaryBasic(fileRepo.save(f));
    }

    @PutMapping("/{reference}")
    public FileSummary update(@PathVariable String reference, @RequestBody FileSummary dto) {
        var f = fileRepo.findById(reference).orElseThrow();

        if (dto.isActive() != null) f.setIsActive(dto.isActive());
        if (dto.client() != null) f.setClient(dto.client());
        if (dto.st() != null) f.setStatus(dto.st());
        if (dto.homeFloor() != null) f.setHomeFloor(dto.homeFloor());
        if (dto.personInChargeEmail() != null) {
            Employee pic = empRepo.findById(dto.personInChargeEmail())
                    .orElseThrow(() -> new IllegalArgumentException("PIC not found"));
            f.setPersonInCharge(pic);
        }
        return toSummaryBasic(fileRepo.save(f));
    }

    @DeleteMapping("/{reference}")
    public void delete(@PathVariable String reference) {
        fileRepo.deleteById(reference);
    }
}
