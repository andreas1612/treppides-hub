package entities;

import jakarta.persistence.*;
import java.time.OffsetDateTime;

@Entity
@Table(name = "FILEREQUESTS")
public class FileRequest {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Integer id;

    @Column(name="FILEID", nullable=false)
    private String fileId;

    @Column(name="REQUESTER", nullable=false, length=100)
    private String requester;

    @Column(name="APPROVER", length=100)
    private String approver;

    @Column(name="STATUS", nullable=false, length=20)
    private String status; // PENDING, APPROVED, DECLINED, CANCELLED

    @Column(name="NOTE", length=300)
    private String note;

    @Column(name="CREATEDAT", nullable=false)
    private OffsetDateTime createdAt;

    @Column(name="DECIDEDAT")
    private OffsetDateTime decidedAt;

    public Integer getId() { return id; }
    public void setId(Integer id) { this.id = id; }

    public String getFileId() { return fileId; }
    public void setFileId(String fileId) { this.fileId = fileId; }

    public String getRequester() { return requester; }
    public void setRequester(String requester) { this.requester = requester; }

    public String getApprover() { return approver; }
    public void setApprover(String approver) { this.approver = approver; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public String getNote() { return note; }
    public void setNote(String note) { this.note = note; }

    public OffsetDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(OffsetDateTime createdAt) { this.createdAt = createdAt; }

    public OffsetDateTime getDecidedAt() { return decidedAt; }
    public void setDecidedAt(OffsetDateTime decidedAt) { this.decidedAt = decidedAt; }
}
