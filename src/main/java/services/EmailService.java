package services;

import org.springframework.stereotype.Service;

import java.time.Instant;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Async;
import jakarta.mail.internet.MimeMessage;


@Service
public class EmailService {

    private final JavaMailSender mailSender;

    @Value("${app.mail.from}")
    private String from;

    @Value("${app.ui.baseurl:}")
    private String uiBaseUrl;

    public EmailService(JavaMailSender mailSender) {
        this.mailSender = mailSender;
    }

    @Async
    public void sendHtml(String to, String subject, String html) {
        try {
            MimeMessage msg = mailSender.createMimeMessage();
            MimeMessageHelper h = new MimeMessageHelper(msg, "UTF-8");
            h.setFrom(from);
            h.setTo(to);
            h.setSubject(subject);
            h.setText(html, true);
            mailSender.send(msg);
        } catch (Exception e) {
            System.err.println("Email send failed: " + e.getMessage());
        }
    }

    /* ---------- TEMPLATES ---------- */

    public void notifyNewRequest(String approverEmail, String fileRef, String requesterEmail, String client, String note) {
        String subject = "[KYC] New Request for File " + fileRef;
        String link = uiBaseUrl.isBlank() ? "" :
            "<p><a href=\"" + uiBaseUrl + "/approvals?approverEmail=" + esc(approverEmail) + "\">Open approvals</a></p>";
        String html = """
            <div style="font-family:Segoe UI,Arial,sans-serif">
            <h2>Approval needed</h2>
            <p><b>File:</b> %s<br/>
                <b>Client:</b> %s<br/>
                <b>Requester:</b> %s</p>
            %s
            <p style="margin-top:10px"><b>Note:</b> %s</p>
            </div>
            """.formatted(fileRef, esc(client), esc(requesterEmail), link, escOrDash(note));
        sendHtml(approverEmail, subject, html);
    }
    
    /*@Autowired TokenService tokenService;
    public void notifyNewRequest(String approverEmail, Integer fileRef,
                                String requesterEmail, String client, String note) {
        String subject = "[KYC] Approval needed for file " + fileRef;

        var expires = java.time.Instant.now().plus(java.time.Duration.ofHours(48));
        String token = tokenService.create( fileRef, approverEmail, expires);

        String approvalsUrl = uiBaseUrl.isBlank() ? "" :
            uiBaseUrl + "/approvals/" + fileRef + "?t=" + token;

        String linkBlock = approvalsUrl.isEmpty() ? "" : """
            <p>
            <a href="%s" style="display:inline-block;padding:10px 14px;background:#2a7b2a;
                color:#fff;text-decoration:none;border-radius:8px">Open approvals</a>
            </p>
            <p style="font-size:12px;color:#666">If the button doesn't work:<br>%s</p>
            """.formatted(approvalsUrl, esc(approvalsUrl));

        String html = """
        <div style="font-family:Segoe UI,Arial,sans-serif">
            <h2>Approval needed</h2>
            <p><b>File:</b> %d<br/>
            <b>Client:</b> %s<br/>
            <b>Requester:</b> %s</p>
            %s
            <p style="margin-top:10px"><b>Note:</b> %s</p>
        </div>
        """.formatted(fileRef, esc(client), esc(requesterEmail), linkBlock, escOrDash(note));

        sendHtml(approverEmail, subject, html);
    }*/

    public void notifyApproved(String requesterEmail, String fileRef, String approverEmail, String location) {
        String subject = "[KYC] Your Request for File " + fileRef + " was Approved";
        String html = """
            <div style="font-family:Segoe UI,Arial,sans-serif">
            <h2>Request approved</h2>
            <p><b>File:</b> %s</p>
            <p><b>Approved by:</b> %s</p>
            <p><b>Location:</b> %s</p>
            </div>
            """.formatted(fileRef, esc(approverEmail), escOrDash(location));
        sendHtml(requesterEmail, subject, html);
    }

    public void notifyDeclined(String requesterEmail, String fileRef, String approverEmail, String note) {
        String subject = "[KYC] Your Request for File " + fileRef + " was Declined";
        String html = """
            <div style="font-family:Segoe UI,Arial,sans-serif">
            <h2>Request declined</h2>
            <p><b>File:</b> %s</p>
            <p><b>By:</b> %s</p>
            <p><b>Reason:</b> %s</p>
            </div>
            """.formatted(fileRef, esc(approverEmail), escOrDash(note));
       sendHtml(requesterEmail, subject, html);
    }

    // inform previous holder when custody moves (not implememted)
    public void notifyReleased(String previousHolderEmail, String fileRef, String newHolderEmail) {
        String subject = "[KYC] File " + fileRef + " Released to " + newHolderEmail;
        String html = """
            <div style="font-family:Segoe UI,Arial,sans-serif">
              <h2>Custody changed</h2>
              <p><b>File:</b> %d</p>
              <p><b>New holder:</b> %s</p>
            </div>
            """.formatted(fileRef, esc(newHolderEmail));
        sendHtml(previousHolderEmail, subject, html);
    }

    public void notifyRequestExpired(String requesterEmail, String fileRef, String newHolderEmail) {
    String subject = "[KYC] Request for File " + fileRef + " is No Longer Valid";
    String html = """
        <div style="font-family:Segoe UI,Arial,sans-serif">
          <h2>Request expired</h2>
          <p>Your request can no longer be approved by the previous holder because custody moved.</p>
          <p><b>File:</b> %s<br/>
             <b>Current holder:</b> %s</p>
          <p>Please submit a new request to the current holder.</p>
        </div>
        """.formatted(fileRef, esc(newHolderEmail));
    sendHtml(requesterEmail, subject, html);
    }


    private static String esc(String s){ return s==null? "" : s.replace("<","&lt;").replace(">","&gt;"); }
    private static String escOrDash(String s){ return (s==null || s.isBlank()) ? "—" : esc(s); }
    
    public void notifyReturnedToPic(String picEmail, Integer fileRef, String returnedBy, String location) {
        String subject = "[KYC] File " + fileRef + " Returned";
        String html = """
            <div style="font-family:Segoe UI,Arial,sans-serif">
            <h2>File returned</h2>
            <p><b>File:</b> %s</p>
            <p><b>Returned by:</b> %s</p>
            <p><b>Location:</b> %s</p>
            </div>
            """.formatted(fileRef, esc(returnedBy), escOrDash(location));
        sendHtml(picEmail, subject, html);
    }

   /* public void notifyReturnVerificationPic(String picEmail, Integer fileRef, String holderEmail, String token, Instant exp){
        String subject = "[KYC] Verify return of file " + fileRef;xzc                                 
        String verifyUrl = uiBaseUrl.isBlank() ? "" : uiBaseUrl + "/verify-return?t=" + token; // simple landing page OR call API directly from UI

        String linkBlock = verifyUrl.isEmpty() ? "" : """
            <p>
            <a href="%s" style="display:inline-block;padding:10px 14px;background:#2a7b2a;
                color:#fff;text-decoration:none;border-radius:8px">Verify Return</a>
            </p>
            <p style="font-size:12px;color:#666">Valid until: %s<br>If the button doesn't work: %s</p>
            """.formatted(verifyUrl, esc(exp.toString()), esc(verifyUrl));

        String html = """
        <div style="font-family:Segoe UI,Arial,sans-serif">
            <h2>Return verification</h2>
            <p><b>File:</b> %d<br/>
            <b>From holder:</b> %s</p>
            %s
            <p class="muted">Only the PIC can confirm. This does not close custody until verified.</p>
        </div>
        """.formatted(fileRef, escOrDash(holderEmail), linkBlock);

        sendHtml(picEmail, subject, html);
    }*/

    public void notifyReturnCompleted(String holderEmail, Integer fileRef, String picEmail){
        if (holderEmail == null || holderEmail.isBlank()) return;
        String subject = "[KYC] Return Completed for File " + fileRef;
        String html = """
        <div style="font-family:Segoe UI,Arial,sans-serif">
            <h2>Return confirmed</h2>
            <p><b>File:</b> %d<br/>
            <b>Confirmed by PIC:</b> %s</p>
        </div>
        """.formatted(fileRef, escOrDash(picEmail));
        sendHtml(holderEmail, subject, html);
    }

    public void notifyReturnRequestToPic(String picEmail,String fileId,String holderEmail,String client,String location) {
        String subject = "[KYC] Return Confirmation Required for File " + fileId;

     String link = uiBaseUrl.isBlank() ? "" :
            "<p><a href=\"" + uiBaseUrl + "/approvals?approverEmail=" + esc(picEmail) + "\">Open approvals</a></p>";

    String html = """
        <div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#222;">
            <p>Hello,</p>
            <p>The current holder <b>%s</b> has requested to return file <b>%s</b>%s.</p>
            <p>Please open the approvals page %s, to <b>confirm</b> or <b>reject</b> the return.</p>
            <p style="margin-top:16px;font-size:12px;color:#666;">
                This is a return confirmation request, not a new file checkout.
            </p>
        </div>
        """.formatted(
            esc(holderEmail),   
            esc(String.valueOf(fileId)),
            (client != null && !client.isBlank() ? " (<b>" + esc(client) + "</b>)" : ""),
            link
        );

    sendHtml(picEmail, subject, html);

    }

    public void notifyReturnConfirmedToHolder(String holderEmail,String fileId, String picEmail,String location) {
        String subject = "[KYC] Your File Return has been Confirmed (ref " + fileId + ")";

        String body = "<div style=\"font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#222;\">"
            + "<p>Hello,</p>"
            + "<p>Your request to <b>return</b> file <b>" + esc(String.valueOf(fileId)) + "</b>"
            + " has been <b>confirmed</b> by <b>" + esc(picEmail) + "</b>.</p>"
            + (location != null && !location.isBlank()
                ? "<p>The file is recorded as stored at: <b>" + esc(location) + "</b>.</p>"
                : "")
            + "<p>The file is no longer considered to be in your custody.</p>"
            + "<p style=\"margin-top:16px;font-size:12px;color:#666;\">"
            + "This email confirms a return, not a new file checkout."
            + "</p>"
            + "</div>";

        sendHtml(holderEmail, subject, body);
    }

    public void notifyReturnRejectedToHolder(String holderEmail,String fileId,String picEmail,String reason) {
    String subject = "[KYC] Your File Return has been Rejected (ref " + fileId + ")";

    String body = "<div style=\"font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#222;\">"
        + "<p>Hello,</p>"
        + "<p>Your request to <b>return</b> file <b>" + esc(String.valueOf(fileId)) + "</b>"
        + " was <b>not confirmed</b> by <b>" + esc(picEmail) + "</b>.</p>"
        + (reason != null && !reason.isBlank()
            ? "<p><b>Reason:</b> " + esc(reason) + "</p>"
            : "")
        + "<p>The system still considers this file to be under your custody.</p>"
        + "<p style=\"margin-top:16px;font-size:12px;color:#666;\">"
        + "This email refers to a <b>return confirmation</b> that was rejected, not a normal access request."
        + "</p>"
        + "</div>";

    sendHtml(holderEmail, subject, body);
}


}
