package controller;

import entities.Department;
import repositories.DepartmentRepository;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/departments")
public class DepartmentController {
    private final DepartmentRepository repo;

    public DepartmentController(DepartmentRepository repo) { this.repo = repo; }

    @GetMapping
    public List<Department> all() { return repo.findAll(); }

    @GetMapping("/{id}")
    public Department one(@PathVariable Integer id) { return repo.findById(id).orElseThrow(); }

    @PostMapping
    public Department create(@RequestBody Department d) { return repo.save(d); }

    @PutMapping("/{id}")
    public Department update(@PathVariable Integer id, @RequestBody Department body) {
        var d = repo.findById(id).orElseThrow();
        d.setName(body.getName());
        return repo.save(d);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable Integer id) { repo.deleteById(id); }
}
