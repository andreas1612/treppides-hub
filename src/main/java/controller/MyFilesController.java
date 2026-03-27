package controller;

import org.springframework.web.bind.annotation.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import services.EmailService;
import java.util.Map;

@RestController
@RequestMapping("/myfiles")
public class MyFilesController {

    private final EmailService emailService;

    public MyFilesController(EmailService emailService) {
        this.emailService = emailService;
    }

    // POST /myfiles/start
    @PostMapping("/start")
    public Map<String, Object> sendLoginLink(@RequestBody Map<String, String> body) {
        String email = body.get("email");
        if (email == null || email.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Email is required");
        }

        try {
            // Send the email with a simple link like:
            // https://your-ui-url/approvals?email=lpampaka@treppides.com
            String link = "http://localhost:8080/approvals?email=" + email;
            String html = """
                <div style="font-family:Segoe UI,Arial,sans-serif">
                  <h2>Your KYC files link</h2>
                  <p>Click below to view your files and pending approvals.</p>
                  <p><a href="%s" style="display:inline-block;padding:10px 14px;background:#ADC430;
                     color:#000;text-decoration:none;border-radius:8px;font-weight:600">Open My Files</a></p>
                  <p style="font-size:12px;color:#666">If the button doesn’t work, copy this link:<br>%s</p>
                </div>
                """.formatted(link, link);
            emailService.sendHtml(email, "[KYC] Your file access link", html);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to send email");
        }

        return Map.of("ok", true);
    }
}
