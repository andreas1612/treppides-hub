package controller;

import entities.Employee;
import repositories.EmployeeRepository;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/employees")
public class EmployeeController {
    private final EmployeeRepository repo;

    public EmployeeController(EmployeeRepository repo) { this.repo = repo; }

    @GetMapping
    public List<Employee> all() { return repo.findAll(); }

    @GetMapping("/{email}")
    public Employee one(@PathVariable String email) {
        return repo.findById(email).orElseThrow();
    }

    @PostMapping
    public Employee create(@RequestBody Employee e) { return repo.save(e); }

    @PutMapping("/{email}")
    public Employee update(@PathVariable String email, @RequestBody Employee body) {
        var e = repo.findById(email).orElseThrow();
        e.setFullName(body.getFullName());
        e.setDepartment(body.getDepartment());
        e.setPosition(body.getPosition());
        e.setFloorLocation(body.getFloorLocation());
        e.setIsActive(body.getIsActive());
        e.setSupervisor(body.getSupervisor());
        return repo.save(e);
    }

    @DeleteMapping("/{email}")
    public void delete(@PathVariable String email) { repo.deleteById(email); }

}
