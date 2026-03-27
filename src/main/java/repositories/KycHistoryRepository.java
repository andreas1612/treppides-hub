package repositories;

import entities.KycHistory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface KycHistoryRepository extends JpaRepository<KycHistory, Long> {

    // Keep your name, but tell Spring how to navigate the relation (file.reference)
    @Query("""
           select h
           from KycHistory h
           where h.file.reference = :reference
             and h.endAt is null
           """)
    Optional<KycHistory> findByFileReferenceAndEndAtIsNull(@Param("reference") String reference);

    // Keep your name, return full history ordered by start time desc
    @Query("""
           select h
           from KycHistory h
           where h.file.reference = :reference
           order by h.startAt desc
           """)
    List<KycHistory> findByFileReferenceOrderByStartAtDesc(@Param("reference") String reference);

     @Query("""
       select h from KycHistory h
       where lower(h.holder.email) = lower(:email)
         and h.endAt is null
    """)
    List<KycHistory> findAllOpenByHolder(@Param("email") String email);

}
