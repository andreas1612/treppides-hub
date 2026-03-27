package repositories;

import entities.FileRequest;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface FileRequestRepository extends JpaRepository<FileRequest, Integer> {

    List<FileRequest> findByRequesterOrderByCreatedAtDesc(String requesterEmail);

    List<FileRequest> findByApproverAndStatusOrderByCreatedAtAsc(String approverEmail, String status);

    // NEW: other pending requests for same file to the old approver (excluding the one just approved)
    List<FileRequest> findAllByFileIdAndApproverAndStatusAndIdNot(String fileId, String approver, String status, Integer id);

    boolean existsByFileIdAndRequesterAndStatusAndNoteStartingWith(
        String fileId,
        String requester,
        String status,
        String notePrefix
    );

}
