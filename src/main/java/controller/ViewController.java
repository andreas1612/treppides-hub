package controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.ui.Model;

@Controller
public class ViewController {
    @GetMapping({"/", "/index"})
    public String index() {
        return "index"; // templates/index.html
    }

    @GetMapping("/all-files")
    public String allfiles() {
        return "all-files"; // templates/all-files.html
    }

    
    @GetMapping("/about")
    public String about() {
        return "about"; // templates/add-file.html
    }

    @GetMapping("/file")
    public String fileByQuery(@RequestParam(value = "ref", required = false) Integer ref, Model model) {
        model.addAttribute("ref", ref);
        return "file"; // templates/file.html
    }

    @GetMapping("/file/{ref}")
    public String fileByPath(@PathVariable("ref") Integer ref, Model model) {
        model.addAttribute("ref", ref);
        return "file"; // templates/file.html
    }

    @GetMapping("/myfiles") 
    public String myFiles(
        @RequestParam(value="email", required=false) String email, Model m){
        m.addAttribute("holderEmail", email);
        return "myfiles";
    }

    @GetMapping("/allfiles")
    public String all() {
        return "allfiles"; // templates/add-file.html
    }

    @GetMapping("/returnapprovals")
    public String returnapprocals() {
        return "returnapprovals"; // templates/add-file.html
    }

}
