package controller;

import entities.Employee;
import entities.KycFile;
import entities.KycHistory;
import repositories.EmployeeRepository;
import repositories.KycFileRepository;
import repositories.KycHistoryRepository;

import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/history")
public class KycHistoryController {

    private final KycFileRepository fileRepo;
    private final EmployeeRepository empRepo;
    private final KycHistoryRepository histRepo;

    //constructor (no return type, name = class name)
    public KycHistoryController(KycFileRepository fileRepo,
                                EmployeeRepository empRepo,
                                KycHistoryRepository histRepo) {
        this.fileRepo = fileRepo;
        this.empRepo = empRepo;
        this.histRepo = histRepo;
    }

    // simple GET so /api/custody is not 404
    @GetMapping
    public Map<String, Object> ping() { return Map.of("ok", true); }

    // DTOs
    public record CheckoutDto(String reference, String holderEmail, String location) {}
    public record ReturnDto(String reference, String location) {}

    @PostMapping("/checkout")
    @Transactional
    public String checkout(@RequestBody CheckoutDto dto) {
        KycFile file = fileRepo.findById(dto.reference()).orElseThrow();
        Employee holder = empRepo.findById(dto.holderEmail()).orElseThrow();

        histRepo.findByFileReferenceAndEndAtIsNull(dto.reference()).ifPresent(h -> {
            throw new IllegalStateException("File already checked out by " + h.getHolder().getFullName());
        });

        var h = new KycHistory();
        h.setFile(file);
        h.setHolder(holder);
        h.setLocation(dto.location() == null ? "Compliance Office" : dto.location());
        histRepo.save(h);

        file.setPersonInCharge(holder);
        file.setStatus("OUT");
        fileRepo.save(file);

        return "Checked out";
    }

    @PostMapping("/return")
    @Transactional
    public String returnFile(@RequestBody ReturnDto dto) {
        var file = fileRepo.findById(dto.reference()).orElseThrow();
        var open = histRepo.findByFileReferenceAndEndAtIsNull(dto.reference())
                .orElseThrow(() -> new IllegalStateException("No open custody for this file"));

        open.setEndAt(Instant.now());
        if (dto.location() != null) open.setLocation(dto.location());
        histRepo.save(open);

        file.setStatus("ARCHIVE");
        // file.setPersonInCharge(null);
        fileRepo.save(file);

        return "Returned";
    }

    @GetMapping("/history/{reference}")
    public List<KycHistory> history(@PathVariable String reference) {
        return histRepo.findByFileReferenceOrderByStartAtDesc(reference);
    }
}
