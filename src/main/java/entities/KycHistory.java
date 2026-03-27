package entities;

import com.fasterxml.jackson.annotation.JsonIdentityInfo;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.ObjectIdGenerators;
import jakarta.persistence.*;
import java.time.Instant;

@JsonIdentityInfo(generator = ObjectIdGenerators.PropertyGenerator.class, property = "id")
@JsonIgnoreProperties({"hibernateLazyInitializer","handler"})
@Entity
@Table(name = "FILESHISTORY")
public class KycHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "ID")
    private Long id;

    @ManyToOne(optional = false, fetch = FetchType.LAZY)
    @JoinColumn(name = "FILEID") // FILES.REFERENCE
    private KycFile file;

    // recommended: HOLDEREMAIL column in DB (FK to EMPLOYEES.EMAIL)
    @ManyToOne(optional = false, fetch = FetchType.LAZY)
    @JoinColumn(name = "HOLDEREMAIL")
    private Employee holder;

    @Column(name = "FL", nullable = false, length = 100)
    private String location;

    @Column(name = "STARTAT", nullable = false)
    private Instant startAt = Instant.now();

    @Column(name = "ENDAT")
    private Instant endAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public KycFile getFile() { return file; }
    public void setFile(KycFile file) { this.file = file; }

    public Employee getHolder() { return holder; }
    public void setHolder(Employee holder) { this.holder = holder; }

    public String getLocation() { return location; }
    public void setLocation(String location) { this.location = location; }

    public Instant getStartAt() { return startAt; }
    public void setStartAt(Instant startAt) { this.startAt = startAt; }

    public Instant getEndAt() { return endAt; }
    public void setEndAt(Instant endAt) { this.endAt = endAt; }
}
