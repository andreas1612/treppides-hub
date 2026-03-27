import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.mail.javamail.JavaMailSender;
import services.EmailService;

@Configuration
public class MailConfig {

  @Bean
  public EmailService emailService(JavaMailSender sender) {
    return new EmailService(sender);
  }
}
