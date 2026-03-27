package entities;

import com.fasterxml.jackson.annotation.JsonIdentityInfo;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.ObjectIdGenerators;
import jakarta.persistence.*;

@JsonIdentityInfo(generator = ObjectIdGenerators.PropertyGenerator.class, property = "reference")
@JsonIgnoreProperties({"hibernateLazyInitializer","handler"})
@Entity
@Table(name = "FILES")
public class KycFile {

    @Id
    @Column(name = "REFERENCE")
    private String reference;

    @Column(name = "ISACTIVE", nullable = false)
    private boolean isActive = true;

    @Column(name = "CLIENT", nullable = false, length = 100)
    private String client;

    @Column(name = "ST", nullable = false, length = 50)
    private String st;

    @Column(name = "HOMEFLOOR", nullable = false)
    private Integer homeFloor;

    @ManyToOne(optional = false, fetch = FetchType.LAZY)
    @JoinColumn(name = "PERSONINCHARGE") // Employee.EMAIL
    private Employee personInCharge;

    public String getReference() { return reference; }
    public void setReference(String reference) { this.reference = reference; }

    public boolean getIsActive() { return isActive; }
    public void setIsActive(boolean isActive) { this.isActive = isActive; }

    public String getClient() { return client; }
    public void setClient(String client) { this.client = client; }

    public String getStatus() { return st; }
    public void setStatus(String st) { this.st = st; }

    public Integer getHomeFloor() { return homeFloor; }
    public void setHomeFloor(Integer homeFloor) { this.homeFloor = homeFloor; }

    public Employee getPersonInCharge() { return personInCharge; }
    public void setPersonInCharge(Employee personInCharge) { this.personInCharge = personInCharge; }
}
