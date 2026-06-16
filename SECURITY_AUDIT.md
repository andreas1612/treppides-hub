# Security & Configuration Audit — 2026-06-16

> **Purpose**: This document is a complete brief for a new Claude session to implement all fixes.
> Read this top to bottom, then execute the fixes in priority order.
> Every fix includes the exact file, line, current code, and replacement code.

---

## Health Check Snapshot (2026-06-16)

| Service | Status | Detail |
|---|---|---|
| Task Manager (Spring Boot) | **RUNNING** | PID 730013, up since Jun 11, systemd `taskmanager.service` |
| nginx | **RUNNING** | Up since Jun 11, `nginx -t` passes, 4 workers |
| Hub frontend (`hub.treppides.com`) | **200 OK** | Static files served correctly |
| TM `/api/reports/performance/me` | **401** | Correct (no session) |
| TM `/api/reports/budget-kpi/me` | **401** | Correct (no session) |
| TM via hub proxy (`/projects/api/me`) | **401** | Correct (proxy works) |
| SSL certificate | **Valid** | `*.treppides.com` Sectigo, expires Nov 22, 2026 |
| Flask tester (port 9090) | **DOWN** | `app_legacy.py` running but not on 9090; `app.py` running on 9092 |
| Spring `dev` profile | **NOT ACTIVE** | systemd unit has no `--spring.profiles.active` flag — safe |

---

## Architecture Context (READ THIS FIRST)

### Repos and paths

| Component | Path | Branch | Repo |
|---|---|---|---|
| Hub frontend | `~/treppides-hub` | `main` | `github.com/andreas1612/treppides-hub` |
| Task Manager (TM) | `~/taskmanager` | `deployment` | `github.com/andreas1612/TM` |
| Flask tester | `~/performance-tester` | N/A (not in git) | — |

### How auth works today

```
User opens https://hub.treppides.com/performance.html
  → JS (auth.js) calls https://hub.treppides.com/projects/api/me (credentials: include)
  → nginx proxies /projects/* → http://127.0.0.1:8080/* (Spring Boot TM)
  → Spring SecurityFilterChain checks: authenticated?
       YES → 200 + { email, name, preferredUsername }
       NO  → 401 (HttpStatusEntryPoint for /api/**)
  → JS gets 401 → redirects browser to /login.html
  → User clicks "Sign in with Microsoft"
  → Browser goes to Azure AD OAuth2 authorize endpoint
  → Azure AD authenticates user, issues OIDC token
  → Callback: https://tasks.treppides.com/login/oauth2/code/azure
       (or https://hub.treppides.com/login/oauth2/code/azure via proxy)
  → Spring creates session, redirects to /dashboard.html
  → auth.js restores original URL from sessionStorage
```

### Key files

| File | Purpose | Location |
|---|---|---|
| `SecurityConfig.java` | Spring Security filter chain, CORS, OAuth2 login | `~/taskmanager/src/main/java/com/treppides/taskmanager/config/` |
| `DevSecurityConfig.java` | Dev-only auth bypass via header (profile-gated) | same dir |
| `AuthController.java` | `/api/me` endpoint | `~/taskmanager/src/.../controllers/` |
| `PerformanceController.java` | `/api/reports/performance/*` — uses `resolveEmail()` | same dir |
| `BudgetKpiController.java` | `/api/reports/budget-kpi/*` — uses `resolveEmail()` | same dir |
| `PerformanceRepository.java` | `findCodeByEmail()` — email→eSoft code DB lookup | `~/taskmanager/src/.../repositories/` |
| `application.properties` | Azure AD client config, DB creds, logging levels | `~/taskmanager/src/main/resources/` |
| `js/auth.js` | Hub-side auth init, redirect logic | `~/treppides-hub/js/` |
| `js/performance.js` | Performance page, uses `TM_BASE=/projects` | same dir |
| `js/manager-kpi.js` | Budget KPI page, uses `TM_BASE=/projects` | same dir |
| nginx config | Reverse proxy, TLS, headers | `/etc/nginx/sites-enabled/treppides-hub` |
| systemd unit | TM service definition | `/etc/systemd/system/taskmanager.service` |

### Azure AD app registration (read-only access)

| Setting | Value |
|---|---|
| App | `SpringBoot-App` |
| Client ID | `dc4895f7-****` (see application.properties) |
| Tenant ID | `6e5d13a9-****` (see application.properties) |
| Issuer | `https://login.microsoftonline.com/{tenant-id}/v2.0` |
| Scopes | `openid, profile, email` |
| Grant type | `authorization_code` |
| Auth method | `client_secret_post` |
| Redirect URIs (Azure-side) | `*/login/oauth2/code/azure` for both hub and tasks domains |

**We have NO admin access to the Azure Portal.** All fixes must be application-side (Spring Boot, nginx, or frontend JS).

### What Azure AD returns in the OIDC token

With `openid, profile, email` scopes:

| Claim | Example value | Used by app? |
|---|---|---|
| `preferred_username` | `apieri@treppides.com` | YES — primary identifier for all email lookups |
| `email` | `apieri@treppides.com` | YES — exposed in `/api/me` |
| `name` | `Andreas Pieri` | YES — exposed in `/api/me` |
| `sub` | (GUID) | NO |
| `oid` | (GUID) | NO |
| `tid` | `6e5d13a9-...` | NO (Spring validates internally) |
| `acct` | `0` (member) / `1` (guest) | NOT REQUESTED — would be useful |

### Email resolution chain

```
OidcUser.getPreferredUsername()
  → "apieri@treppides.com"
  → PerformanceRepository.findCodeByEmail(email)
      → SELECT invservemployee_code FROM dbo.invservemployees
        WHERE invservemployee_email = ? AND invservemployee_inactive = 0
  → eSoft code "0274"
  → PerformanceRepository.findTargetByCode("0274")
      → SELECT * FROM dbo.performance_targets WHERE esoft_code = ?
  → employee data (name, level, target, manager, etc.)
```

No eSoft match → 404 `NON_CHARGEABLE_ROLE` → frontend shows "role not included" message.

---

## FINDINGS — PRIORITY ORDER

---

### 1. CRITICAL — External Domain Users Can Log In

**The problem**: A person with a `@finalogic.com` email was able to log into the hub. This should be impossible — only `@treppides.com` users should have access.

**Root cause**: The Treppides Azure AD tenant has **guest/B2B users** from external domains (finalogic, possibly others). These guests were invited for Teams/SharePoint collaboration. Azure AD treats them as valid tenant members and issues OIDC tokens for them when they access any app registered in the tenant.

The Spring Security config has **zero domain filtering**:

```java
// SecurityConfig.java line 28
.anyRequest().authenticated()
```

This means: "if Azure AD says you're authenticated, you're in." There is no check on email domain, account type, or tenant membership.

**What happens for a finalogic guest user**:
```
Guest user → Azure AD → token issued (preferred_username = "user@finalogic.com") →
Spring sees valid OIDC token → authenticated = true → hub loads →
findCodeByEmail("user@finalogic.com") → no eSoft match → 404 NON_CHARGEABLE_ROLE
```

They can log in, see the hub shell, and hit all authenticated endpoints. They get a "not available" message on performance/budget pages only because they have no eSoft record — but they ARE authenticated and inside the application.

**Fix — add a domain-check filter in `SecurityConfig.java`**:

Create a new file `~/taskmanager/src/main/java/com/treppides/taskmanager/config/DomainFilter.java`:

```java
package com.treppides.taskmanager.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Rejects authenticated users whose preferred_username is not @treppides.com.
 * This blocks Azure AD B2B guest users (e.g. @finalogic.com) from accessing the app.
 */
public class DomainFilter extends OncePerRequestFilter {

    private static final String ALLOWED_DOMAIN = "@treppides.com";

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof OidcUser oidc) {
            String username = oidc.getPreferredUsername();
            if (username == null || !username.toLowerCase().endsWith(ALLOWED_DOMAIN)) {
                request.getSession().invalidate();
                SecurityContextHolder.clearContext();
                response.setStatus(403);
                response.setContentType("application/json");
                response.getWriter().write("{\"error\":\"Access restricted to treppides.com accounts\"}");
                return;
            }
        }
        filterChain.doFilter(request, response);
    }
}
```

Then register it in `SecurityConfig.java` — add import and filter registration:

```java
// Add import at top:
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

// In filterChain(), add BEFORE the return:
http.addFilterAfter(new DomainFilter(), UsernamePasswordAuthenticationFilter.class);
```

The full `filterChain` method becomes:

```java
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http
        .cors(cors -> cors.configurationSource(corsConfigurationSource()))
        .csrf(csrf -> csrf.disable())
        .authorizeHttpRequests(auth -> auth
            .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
            .requestMatchers("/", "/login.html", "/error", "/css/**", "/js/**", "/favicon.ico").permitAll()
            .anyRequest().authenticated()
        )
        .exceptionHandling(ex -> ex
            .defaultAuthenticationEntryPointFor(
                new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED),
                new AntPathRequestMatcher("/api/**")
            )
        )
        .oauth2Login(oauth2 -> oauth2
            .loginPage("/login.html")
            .defaultSuccessUrl("/dashboard.html", true)
        )
        .addFilterAfter(new DomainFilter(), UsernamePasswordAuthenticationFilter.class);

    return http.build();
}
```

**After deploying**: test by asking the finalogic user to try again — they should get a 403 JSON error after Azure AD redirects back.

---

### 2. CRITICAL — Client Secret in Plaintext in Git

**The problem**: `application.properties` line 35 contains the Azure AD client secret in plain text. This file is committed to `github.com/andreas1612/TM`. If the repo is ever forked, cloned by someone outside, or the GitHub account is compromised, the secret is exposed.

```properties
# ~/taskmanager/src/main/resources/application.properties line 35
spring.security.oauth2.client.registration.azure.client-secret=<REDACTED — see application.properties>
```

**Also in the same file** — database passwords and SMTP credentials:
- Line 2: `spring.datasource.password=<REDACTED>` (InternalTools DB)
- Line 19: `spring.mail.password=<REDACTED>` (Office 365 SMTP)
- Line 64: `esoft.datasource.password=<REDACTED>` (eSoft DB)

**Fix — move all secrets to environment variables**:

Step 1: Edit `application.properties` — replace hardcoded secrets with env-var placeholders:

```properties
# line 2
spring.datasource.password=${DB_INTERNAL_TOOLS_PASSWORD}

# line 19
spring.mail.password=${SMTP_PASSWORD}

# line 35
spring.security.oauth2.client.registration.azure.client-secret=${AZURE_CLIENT_SECRET}

# line 64
esoft.datasource.password=${ESOFT_DB_PASSWORD}
```

Step 2: Add the env vars to the systemd service file `/etc/systemd/system/taskmanager.service`:

```ini
[Service]
Type=simple
User=tech-admin
WorkingDirectory=/home/tech-admin/taskmanager
ExecStart=/usr/bin/java -jar target/taskmanager-0.0.1-SNAPSHOT.jar
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=AZURE_CLIENT_SECRET=<copy from current application.properties line 35>
Environment=DB_INTERNAL_TOOLS_PASSWORD=<copy from current application.properties line 2>
Environment=SMTP_PASSWORD=<copy from current application.properties line 19>
Environment=ESOFT_DB_PASSWORD=<copy from current application.properties line 64>
```

Step 3: After deploying the properties change, run:
```bash
sudo systemctl daemon-reload
sudo systemctl restart taskmanager
```

Step 4: Ideally, **rotate the Azure AD client secret** via whoever has Azure Portal access. The current one should be considered potentially exposed via git history.

**Note**: The git history will still contain the old secrets. If this repo is ever made public, a `git filter-repo` pass or secret rotation is needed.

---

### 3. HIGH — CSRF Protection Disabled

**The problem**: `SecurityConfig.java` line 24:

```java
.csrf(csrf -> csrf.disable())
```

Any authenticated user's browser can be tricked into making POST/PUT/DELETE requests to TM via a malicious webpage (cross-site request forgery). This matters because TM has task assignment, email sending, and other state-changing operations.

**Fix**: Enable CSRF with cookie-based token (compatible with SPA fetch calls):

```java
// Replace:
.csrf(csrf -> csrf.disable())

// With:
.csrf(csrf -> csrf
    .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
    .csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler())
)
```

Add imports:
```java
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
```

**Frontend change**: After enabling, the hub JS must read the `XSRF-TOKEN` cookie and send it as an `X-XSRF-TOKEN` header on POST/PUT/DELETE requests. Currently the hub only uses GET requests, so this is low risk — but if TM has any POST endpoints used from the hub, those calls need the header.

**Recommendation**: Implement this AFTER fix #1 and #2 are deployed and verified. Test thoroughly — CSRF changes can break OAuth2 callback flows if not configured correctly. You may need to exempt the OAuth2 callback path:

```java
.csrf(csrf -> csrf
    .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
    .csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler())
    .ignoringRequestMatchers("/login/oauth2/code/*")
)
```

---

### 4. HIGH — Debug/TRACE Security Logging in Production

**The problem**: `application.properties` lines 47-49:

```properties
logging.level.org.springframework.security=DEBUG
logging.level.org.springframework.security.oauth2=TRACE
```

This dumps OIDC tokens, session IDs, authentication decisions, and user claims to the journal/logs. Anyone with journal access can see tokens and session details.

Visible in the running logs right now — the `systemctl status` output already showed:
```
TRACE ... Did not match request to Ant [pattern='/login/oauth2/code/*']
DEBUG ... Set SecurityContextHolder to anonymous SecurityContext
DEBUG ... Saved request https://tasks.treppides.com/api/reports/performance/me?continue to session
```

**Fix**: Replace with WARN level:

```properties
logging.level.org.springframework.security=WARN
logging.level.org.springframework.security.oauth2=WARN
```

Also remove or comment out the Azure debug line:
```properties
# line 49 — remove:
logging.level.com.azure.spring=DEBUG
```

---

### 5. HIGH — Seed SQL Domain Mismatch (`@hq.treppides.com`)

**The problem**: `~/performance_targets_seed.sql` contains ~103 rows with `azure_email` in PBI format (`@hq.treppides.com`). Azure AD returns `@treppides.com`. When DBA creates the `performance_targets` table and loads this seed, the TM backend's `findTargetByCode()` will return `azure_email` values that don't match Azure AD.

This doesn't directly break the main lookup chain (which goes through eSoft `invservemployee_email`), but:
- The `DevSecurityConfig` uses `performance_targets.azure_email` to create auth tokens in dev mode
- Any future code that compares Azure email against `performance_targets.azure_email` will fail
- The Flask tester already works around this with `.replace("@hq.treppides.com", "@treppides.com")`

**Fix**: Before sending the seed to DBA, run a find-and-replace on the SQL file:

```bash
sed -i "s/@hq.treppides.com/@treppides.com/g" ~/performance_targets_seed.sql
```

Verify:
```bash
grep -c "@hq.treppides.com" ~/performance_targets_seed.sql  # should be 0
grep -c "@treppides.com" ~/performance_targets_seed.sql      # should be ~103
```

---

### 6. MEDIUM — No Explicit OAuth2 Redirect URI

**The problem**: `application.properties` line 38 comment says redirect URI is omitted — Spring auto-generates it from the request's `Host` header:

```properties
# redirect-uri omitted — Spring auto-generates from the request Host header.
```

This works because nginx sets `proxy_set_header Host $host`, so the Host header is always correct. But if any reverse proxy or load balancer is added in front that doesn't forward the Host header correctly, the OAuth2 callback URL will break or could be manipulated.

**Fix**: Add explicit redirect URI:

```properties
spring.security.oauth2.client.registration.azure.redirect-uri={baseUrl}/login/oauth2/code/{registrationId}
```

This is Spring's default template — it will resolve to `https://tasks.treppides.com/login/oauth2/code/azure` or `https://hub.treppides.com/login/oauth2/code/azure` based on the Host header, but makes the intent explicit.

Alternatively, if you want to lock it to one domain:
```properties
spring.security.oauth2.client.registration.azure.redirect-uri=https://tasks.treppides.com/login/oauth2/code/azure
```

---

### 7. MEDIUM — No Explicit Session Timeout

**The problem**: No `server.servlet.session.timeout` is set in `application.properties`. Spring defaults to 30 minutes. For an internal corporate app used during the workday, this means users get logged out frequently and must re-authenticate.

**Fix**: Add to `application.properties`:

```properties
server.servlet.session.timeout=8h
```

---

### 8. MEDIUM — Session Cookie Missing SameSite Attribute

**The problem**: `application.properties` line 59 sets:

```properties
server.servlet.session.cookie.secure=true
```

But no `SameSite` attribute is set. Spring defaults to `Lax` which is OK, but being explicit is better for security audits and prevents future Spring version changes from surprising you.

**Fix**: Add to `application.properties`:

```properties
server.servlet.session.cookie.same-site=lax
```

---

### 9. MEDIUM — Localhost CORS Origins in Production

**The problem**: `SecurityConfig.java` lines 49-52:

```java
config.setAllowedOrigins(List.of(
    "http://localhost:3000",
    "http://localhost:62202",
    "https://hub.treppides.com"
));
```

Localhost origins should not be in the production CORS config. If someone runs a local dev server on port 3000 or 62202 and has a valid TM session cookie, their local page can make authenticated cross-origin requests to production TM.

**Fix**: Remove localhost origins. If needed for dev, gate behind a Spring profile:

```java
config.setAllowedOrigins(List.of(
    "https://hub.treppides.com"
));
```

---

### 10. MEDIUM — Email Case Sensitivity

**The problem**: `PerformanceRepository.findCodeByEmail()` and the `EMPLOYEES` table (JPA, email as primary key) do exact string matching. If Azure AD returns `APieri@treppides.com` but eSoft stores `apieri@treppides.com`, the lookup fails.

In practice, SQL Server's default collation (`SQL_Latin1_General_CP1_CI_AS`) is case-insensitive for `WHERE` clauses, so the DB lookup likely works. But the JPA `Employee` entity uses email as `@Id`, and Java `HashMap`/`equals` comparisons are case-sensitive.

**Fix**: Add `.toLowerCase()` in the `resolveEmail()` method of both controllers:

In `PerformanceController.java`:
```java
private static String resolveEmail(Authentication auth) {
    if (auth == null) {
        throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
    }
    if (auth.getPrincipal() instanceof OidcUser oidc) {
        return oidc.getPreferredUsername().toLowerCase();
    }
    return auth.getName().toLowerCase();
}
```

Same change in `BudgetKpiController.java`.

---

### 11. LOW — Stale Commented-Out Azure Config

**The problem**: `application.properties` lines 29-33 have commented-out `spring.cloud.azure.active-directory.*` lines from a previous Azure AD Spring Boot starter integration:

```properties
#spring.cloud.azure.active-directory.enabled=true
#spring.cloud.azure.active-directory.profile.tenant-id=<REDACTED>
#spring.cloud.azure.active-directory.credential.client-id=<REDACTED>
#spring.security.oauth2.client.registration.azure.client-secret=<REDACTED>
#spring.security.oauth2.client.registration.azure.client-authentication-method=client_secret_post
```

These are dead config lines that contain a duplicate of the client secret.

**Fix**: Delete lines 29-33 entirely.

---

### 12. LOW — Deprecated X-XSS-Protection Header

**The problem**: nginx config sets:

```
add_header X-XSS-Protection "1; mode=block" always;
```

This header is deprecated — Chrome removed XSS Auditor in 2019, Firefox never implemented it. CSP (already in place) is the correct mitigation.

**Fix**: Remove the line from both server blocks in `/etc/nginx/sites-enabled/treppides-hub`. Not urgent — it causes no harm, just noise.

---

### 13. INFO — Flask Tester Port 9090 Down

**The problem**: The Flask performance tester (`app_legacy.py`) is running but not listening on port 9090. A newer `app.py` is running on port 9092. The documented URL `http://192.168.0.221:9090/` in CLAUDE.md does not work.

**Current process state**:
- `python3 app_legacy.py` — running (PID 830664), unclear what port
- `python3 app.py` — running on port 9092 (PID 832381)

**Fix**: Either:
- Restart `app_legacy.py` on port 9090 if it's still needed
- Or update all docs to point to port 9092 and kill the legacy process

---

### 14. INFO — Stale nginx Config in `sites-available`

`/etc/nginx/sites-available/treppides-hub` (11KB) is an older version of the nginx config without TaskManager proxy support. `/etc/nginx/sites-enabled/treppides-hub` (14KB) is the current production config. They are NOT symlinked — the enabled version was manually created.

This is not a problem (nginx only reads `sites-enabled`), but it's confusing. Consider deleting the stale `sites-available` version or updating it to match.

---

## Implementation Order

| Step | Fix | Repo | Requires Restart |
|---|---|---|---|
| 1 | Domain filter (block external users) | `~/taskmanager` | YES — TM restart |
| 2 | Move secrets to env vars | `~/taskmanager` + systemd | YES — daemon-reload + TM restart |
| 3 | Reduce logging to WARN | `~/taskmanager` | YES — TM restart |
| 4 | Add session timeout + SameSite | `~/taskmanager` | YES — TM restart |
| 5 | Remove localhost CORS | `~/taskmanager` | YES — TM restart |
| 6 | Add `.toLowerCase()` to email resolution | `~/taskmanager` | YES — TM restart |
| 7 | Clean up stale comments in properties | `~/taskmanager` | YES — TM restart |
| 8 | Add explicit redirect URI | `~/taskmanager` | YES — TM restart |

Steps 1-8 are all in `application.properties` or Java config, so they can be batched into **one commit + one TM restart**.

| Step | Fix | Repo | Requires Restart |
|---|---|---|---|
| 9 | Fix seed SQL domains | `~/performance_targets_seed.sql` | NO |
| 10 | CSRF enablement | `~/taskmanager` | YES — TM restart (do separately, test carefully) |
| 11 | Remove X-XSS-Protection | nginx | YES — nginx reload |
| 12 | Fix Flask tester / update docs | `~/performance-tester` | Process restart |

---

## Deploy Sequence After Changes

### Task Manager (Steps 1-8)

```bash
# 1. Build
cd ~/taskmanager && ./mvnw package -DskipTests 2>&1 | tail -5

# 2. Update systemd (if secrets moved to env vars)
sudo systemctl daemon-reload

# 3. Restart
echo 'KTTech@2026ub(8)' | sudo -S systemctl restart taskmanager

# 4. Wait and verify
sleep 15
sudo systemctl status taskmanager --no-pager | head -20

# 5. Smoke test
curl -s -o /dev/null -w "%{http_code}" https://tasks.treppides.com/api/reports/performance/me
# Expected: 401

curl -s -o /dev/null -w "%{http_code}" https://tasks.treppides.com/api/reports/budget-kpi/me
# Expected: 401
```

### nginx (Step 11)

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## Git Workflow

All TM changes are in `~/taskmanager` on branch `deployment`.

```bash
cd ~/taskmanager
git add -p   # review each change
git commit -m "security: block external domains, move secrets to env vars, harden config"
git push origin deployment
```

**Do NOT push secrets.** After moving to env vars, verify that `git diff` no longer shows any passwords or client secrets before committing.

---

## What We Cannot Fix Without Azure Portal Access

These require someone with Azure AD admin access:

1. **Rotate the client secret** — the current one is in git history and should be considered compromised
2. **Restrict app to "Accounts in this organizational directory only"** (single-tenant) — if the app is currently set to multi-tenant, changing this in Azure Portal would be the proper fix for the external domain issue (our domain filter is the application-side workaround)
3. **Configure optional claims** — adding `acct` claim would let us distinguish member (0) vs guest (1) accounts without checking email domain
4. **Configure App Roles** — defining `Admin`/`Manager` roles in Azure Portal would eliminate the need for hardcoded admin email lists in Phase 5
5. **Remove guest user access** — if finalogic guests don't need access to this specific app, Azure admin can restrict it via Enterprise Application user assignment

---

## Verification Checklist (After All Fixes)

- [ ] `@finalogic.com` user gets 403 when trying to log in
- [ ] `@treppides.com` user can still log in and see their data
- [ ] `git diff` of `application.properties` shows NO plaintext secrets
- [ ] `systemctl status taskmanager` shows running after restart
- [ ] `journalctl -u taskmanager --since "5 min ago"` shows WARN-level logs only, no DEBUG/TRACE token dumps
- [ ] `curl -s -o /dev/null -w "%{http_code}" https://tasks.treppides.com/api/reports/performance/me` returns 401
- [ ] `curl -s -o /dev/null -w "%{http_code}" https://tasks.treppides.com/api/reports/budget-kpi/me` returns 401
- [ ] Performance and Budget KPI pages load correctly for a logged-in treppides.com user
