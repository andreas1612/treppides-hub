package services;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;

@Service
public class TokenService {

    private final byte[] secret;

    // NOTE: ":"
    public TokenService(@Value("${app.approvals.secret:}") String secretProp) {
        String s = secretProp;
        if (s == null || s.trim().isEmpty()) {
            // Dev-friendly fallback so the app can start even without config
            s = UUID.randomUUID().toString() + UUID.randomUUID().toString();
            System.err.println("[TokenService] WARN: app.approvals.secret is missing. Using ephemeral secret (dev only).");
        }
        this.secret = s.getBytes(StandardCharsets.UTF_8);
    }

    public String create(int requestId, String approverEmail, Instant expiresAt) {
        String payload = "rid=" + requestId
                + "&apr=" + url(approverEmail)
                + "&exp=" + expiresAt.getEpochSecond();
        String sig = sign(payload);
        return b64(payload) + "." + b64(sig);
    }

    public Verified parseAndVerify(String token) {
        String[] parts = token.split("\\.", 2);
        if (parts.length != 2) return null;
        String payload = new String(Base64.getUrlDecoder().decode(parts[0]), StandardCharsets.UTF_8);
        String sig = new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8);
        if (!constEq(sign(payload), sig)) return null;

        Map<String,String> m = Query.parse(payload);
        int rid = Integer.parseInt(m.getOrDefault("rid", "-1"));
        String apr = Query.decode(m.getOrDefault("apr", ""));
        long exp = Long.parseLong(m.getOrDefault("exp", "0"));
        if (Instant.now().getEpochSecond() > exp) return null;

        return new Verified(rid, apr, Instant.ofEpochSecond(exp));
    }

    public record Verified(int requestId, String approverEmail, Instant expiresAt) {}

    // --- helpers ---
    private String sign(String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            byte[] h = mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
            return new String(h, StandardCharsets.ISO_8859_1);
        } catch (Exception e) { throw new RuntimeException(e); }
    }

    private boolean constEq(String a, String b){
        if (a.length() != b.length()) return false;
        int r = 0;
        for (int i=0;i<a.length();i++) r |= a.charAt(i) ^ b.charAt(i);
        return r == 0;
    }

    private static String b64(String s){
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString(s.getBytes(StandardCharsets.UTF_8));
    }

    private static String url(String s){ return Query.encode(s); }

    // Tiny query codec
    static class Query {
        static Map<String,String> parse(String q){
            return java.util.Arrays.stream(q.split("&"))
              .map(p -> p.split("=",2))
              .collect(java.util.stream.Collectors.toMap(
                 a -> a[0], a -> a.length>1? a[1]: ""
              ));
        }
        static String encode(String s){
            try { return java.net.URLEncoder.encode(s, "UTF-8"); } catch(Exception e){ return s; }
        }
        static String decode(String s){
            try { return java.net.URLDecoder.decode(s, "UTF-8"); } catch(Exception e){ return s; }
        }
    }
}