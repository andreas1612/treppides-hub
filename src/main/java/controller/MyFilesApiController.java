package controller;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.*;
import repositories.KycHistoryRepository; 


@RestController
@RequestMapping("/api")
public class MyFilesApiController {

    private final KycHistoryRepository repo;

    public MyFilesApiController(KycHistoryRepository repo){
        this.repo = repo;
    }

   // GET /api/my-files?email=someone@treppides.com
   @GetMapping("/my-files")
   public List<Map<String,Object>> myFiles(@RequestParam("email") String email) {
        List<Map<String,Object>> result = new java.util.ArrayList<>();
        for (var h : repo.findAllOpenByHolder(email)) {
            Map<String,Object> row = new java.util.HashMap<>();
            row.put("reference", h.getFile().getReference());
            row.put("client", h.getFile().getClient());
            row.put("location", h.getLocation());
            row.put("startAt", h.getStartAt());
            row.put("status", "In use");
            result.add(row);
        }
        return result;
    }
   
}
