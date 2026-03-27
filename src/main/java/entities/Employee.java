package entities;

import jakarta.persistence.*;

@Entity
@Table(name = "EMPLOYEES", schema = "dbo") // schema optional but fine
public class Employee {

    @Id
    @Column(name = "EMAIL", length = 100)
    private String email;

    @Column(name = "FULLNAME", nullable = false, length = 150)
    private String fullName;

    @Column(name = "DEPARTMENTID", nullable = false)
    private Integer departmentId;

    @Column(name = "ISACTIVE", nullable = false)
    private Boolean isActive = true;

    @Column(name = "POSITION", nullable = false, length = 100)
    private String position;

    @Column(name = "FLOORLOCATION", nullable = false)
    private String floorLocation;

    @Column(name = "SUPERVISORID")
    private String supervisorId;

    // getters and setters ...
    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }

    public String getFullName() { return fullName; }
    public void setFullName(String fullName) { this.fullName = fullName; }

    public Integer getDepartment() { return departmentId; }
    public void setDepartment(Integer departmentId) { this.departmentId = departmentId; }

    public Boolean getIsActive() { return isActive; }
    public void setIsActive(Boolean active) { isActive = active; }

    public String getPosition() { return position; }
    public void setPosition(String position) { this.position = position; }

    public String getFloorLocation() { return floorLocation; }
    public void setFloorLocation(String floorLocation) { this.floorLocation = floorLocation; }

    public String getSupervisor() { return supervisorId; }
    public void setSupervisor(String supervisorId) { this.supervisorId = supervisorId; }
    
}
