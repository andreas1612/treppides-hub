package controller;

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping; 

@Controller
public class ApprovalsPageController {
    @GetMapping("/approvals")
    public String approvalsPage(String approverEmail, Model model) {
        // Pass through (optional) approverEmail if it came from a link param
        model.addAttribute("approverEmail", approverEmail == null ? "" : approverEmail);
        return "approvals"; // renders templates/approvals.html
    }
}
