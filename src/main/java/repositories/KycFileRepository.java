package repositories;

import entities.KycFile;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface KycFileRepository extends JpaRepository<KycFile, String> {
    List<KycFile> findByClientContainingIgnoreCase(String client);  // search files by client name
}
