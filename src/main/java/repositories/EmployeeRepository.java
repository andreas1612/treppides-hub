package repositories;

import org.springframework.data.jpa.repository.JpaRepository;
import entities.Employee;
import java.util.List;

public interface EmployeeRepository extends JpaRepository<Employee, String> {
    List<Employee> findByIsActiveTrue();  // find only active employees
}

