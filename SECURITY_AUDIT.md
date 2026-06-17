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
| Client ID | `dc4895f7-ea14-4387-a368-cbccacee7270` |
| Tenant ID | `6e5d13a9-1138-4013-913d-f32a1be7dced` |
| Issuer | `https://login.microsoftonline.com/6e5d13a9-1138-4013-913d-f32a1be7dced/v2.0` |
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
spring.security.oauth2.client.registration.azure.client-secret=<REDACTED>
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
Environment=AZURE_CLIENT_SECRET=<REDACTED>
Environment=DB_INTERNAL_TOOLS_PASSWORD=<REDACTED>
Environment=SMTP_PASSWORD=<REDACTED>
Environment=ESOFT_DB_PASSWORD=<REDACTED>
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
#spring.cloud.azure.active-directory.profile.tenant-id=6e5d13a9-...
#spring.cloud.azure.active-directory.credential.client-id=dc4895f7-...
#spring.security.oauth2.client.registration.azure.client-secret=i~X8Q~...
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

## DEEP AUDIT FINDINGS — 2026-06-16

> Added by deep audit pass across `~/treppides-hub`, `~/taskmanager`, `~/performance-tester`,
> `~/bookstack`, `~/openproject`, nginx, systemd, file permissions, network listeners, and git history.
> Findings 1-14 above remain valid and are not repeated here.

---

### 15. CRITICAL — Zero Authorization (IDOR) on ALL Task Controller Endpoints

**The problem**: `TaskController.java` has **no ownership or role checks** on any endpoint. Any authenticated user can read, modify, or delete any other user's tasks by guessing IDs or email addresses.

**File**: `~/taskmanager/src/main/java/com/treppides/taskmanager/controllers/TaskController.java` lines 38-166

Specific examples:
- `GET /api/tasks/employee/{email}` (line 39) — fetch any user's tasks by email
- `GET /api/tasks/team/{email}` (line 44) — view any team's tasks
- `PUT /api/tasks/{taskId}` (line 67) — modify any task
- `PUT /api/tasks/{taskId}/status` (line 76) — change any task's status
- `POST /api/tasks/{taskId}/comments` (line 93) — comment on any task
- `DELETE /api/tasks/dependencies/{dependencyId}` (line 163) — delete any dependency

There are zero `@PreAuthorize`, `@Secured`, or `@RolesAllowed` annotations in the entire codebase.

**Fix**: Add method-level authorization. Derive the current user from the OAuth2 principal and compare against the task's `createdBy` / `assignedTo` before allowing mutations. At minimum:

```java
// In each mutation endpoint, add:
String currentUser = ((OidcUser) auth.getPrincipal()).getPreferredUsername();
if (!task.getCreatedBy().equalsIgnoreCase(currentUser)
    && !task.getAssignedTo().contains(currentUser)) {
    throw new ResponseStatusException(HttpStatus.FORBIDDEN);
}
```

For read endpoints, restrict to: own tasks, tasks assigned to me, or tasks in my team (if manager). Admin override for admin emails.

---

### 16. CRITICAL — User Identity Spoofing via Client-Supplied changedBy/createdBy

**The problem**: Throughout the Task Manager, the identity of who performs an action is passed from the client, **never derived from the authenticated session**.

**Files**:
- `TaskController.java` line 70: `changedBy` is a `@RequestParam`
- `TaskController.java` line 95: `request.getChangedBy()` from request body
- `TaskController.java` lines 119-120: `changedBy` is a `@RequestParam`
- `CreateTaskRequest.java` line 10: `createdBy` from client
- `AddCommentRequest.java` line 4: `changedBy` from client

This means any authenticated user can:
- Create tasks appearing to come from another user
- Make changes logged as another user (audit trail forgery)
- Add comments impersonating any employee

**Fix**: In every controller method, ignore the client-supplied identity and derive from the session:

```java
String actor = ((OidcUser) auth.getPrincipal()).getPreferredUsername().toLowerCase();
// Use 'actor' instead of request.getChangedBy() / request.getCreatedBy()
```

---

### 17. CRITICAL — Credentials in Plaintext Markdown Files (World-Readable)

**The problem**: Multiple documentation files in the home directory contain full credential sets in plaintext, all with `664` permissions (group-readable):

| File | Secrets exposed |
|---|---|
| `~/CLAUDE.md` lines 22-25 | DB usernames + passwords for InternalTools and eSoft |
| `~/CLAUDE.md` line 52 | sudo password in deploy command |
| `~/DEPLOY_GUIDE.md` lines 9, 18, 22, 54 | sudo password (repeated 4 times) |
| `~/NEXT_SESSION.md` lines 37-44 | sudo password, DB server/user information |
| `~/budget_per_manager_seed_sqlserver.sql` line 3 | DB password in `sqlcmd` example comment |

**Fix**: This is a documentation-vs-security tradeoff. Options:
1. **Best**: Remove all credentials from docs. Reference `application.properties` or a password manager instead
2. **Minimum**: `chmod 600` all files containing credentials
3. **For the seed SQL**: Remove the `sqlcmd` comment with the password

---

### 18. CRITICAL — Flask Tester Has Zero Auth + Bound to All Interfaces

**The problem**: Both Flask apps (`app.py` on port 9092, `app_legacy.py` on port 9091) have:
1. **No authentication** on any endpoint
2. `app.run(host="0.0.0.0")` — listening on all network interfaces
3. `app_legacy.py` has **POST/DELETE endpoints** for fee adjustments with zero auth

Any device on the LAN can:
- Read all 103 employees' performance data
- Read all 40 managers' budget KPI data
- **Create and delete financial fee adjustment records** (`POST /api/fee-adjustments`, `DELETE /api/fee-adjustments/<id>`)

**File**: `app_legacy.py` line 647 (POST), line 671 (DELETE), line 690 (`host="0.0.0.0"`)
**File**: `app.py` line 891 (`host="0.0.0.0"`)

**Fix — immediate**:
```bash
# Kill both orphan processes
pkill -f "python3 app_legacy.py"
pkill -f "python3 app.py"
```

If the Flask tester is needed, restart bound to localhost only:
```python
# In app.py and app_legacy.py, change:
app.run(host="127.0.0.1", port=9092, debug=False)
```

And set `PERF_AUTH_MODE=prod` explicitly in the environment (see finding #25).

---

### 19. CRITICAL — Flask Dev Auth Mode Defaults to On

**The problem**: `app.py` line 27:

```python
AUTH_MODE = os.environ.get("PERF_AUTH_MODE", "dev")
```

If `PERF_AUTH_MODE` is not explicitly set, the app runs in dev mode where:
- **Everyone is treated as admin** (line 195: `if AUTH_MODE != "dev" and not g.user["isAdmin"]`)
- **Identity is spoofable** via `X-Dev-Email` header or `_dev_email` query param (line 137)
- The health endpoint leaks the auth mode (`/api/performance/health`, line 215)

Combined with finding #18 (bound to all interfaces, no auth), this means any LAN client can impersonate any admin user.

**Fix**: Change the default to `"prod"`:
```python
AUTH_MODE = os.environ.get("PERF_AUTH_MODE", "prod")
```

---

### 20. DEFERRED — BookStack API Tokens in Browser-Served config.js

> **DEFERRED**: Tokens and PIN will be rotated after the application is feature-complete. Noted here for the record.

**The problem**: `~/treppides-hub/config.js` lines 36-37 contain the BookStack API token pair, and line 57 contains `ADMIN_PIN: "1234"`. This file:
- Is loaded by every browser session via `main.js`
- Sits in the nginx web root — fetchable at `https://hub.treppides.com/config.js`
- The admin PIN is client-side only — bypassable via `sessionStorage.setItem("hub_admin_auth","1")`
- Admin auth check is in `admin.js` lines 47-53, 308 — purely cosmetic

Additionally, **3 sets of BookStack API tokens are in git history** (commits `b065704`, `365d485`, and current) — recoverable by anyone with repo access.

**Future fix**:
1. Move BookStack API calls to a server-side proxy
2. Replace PIN with server-side role-based auth from the OAuth identity
3. Run `git filter-repo` or BFG to purge history, then revoke old tokens in BookStack

---

### 21. HIGH — XSS via BookStack Content in Reader (Event Handlers Not Stripped)

**The problem**: `reader.js` lines 34-80 — `sanitizeHtml()` strips `<script>` and `<style>` tags but does **NOT** strip event handler attributes.

```js
// reader.js line 39 — only removes these:
safe = safe.replace(/<script[\s\S]*?<\/script>/gi, "");
safe = safe.replace(/<style[\s\S]*?<\/style>/gi, "");
```

An attacker who can edit a BookStack page can inject:
```html
<img src=x onerror="alert(document.cookie)">
```

This survives the sanitizer and executes when set via `innerHTML` at line 402-404.

**Fix**: Add event handler stripping to `sanitizeHtml()`:
```js
// After stripping script/style tags, add:
safe = safe.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "");
safe = safe.replace(/\s+on\w+\s*=\s*[^\s>]+/gi, "");
```

Or use DOMPurify (a well-tested library) instead of a hand-rolled sanitizer.

---

### 22. HIGH — XSS in Topbar Search Results

**The problem**: `topbar.js` lines 106-111 — BookStack API search result names are inserted raw into innerHTML:

```js
<span class="sd-title">${r.name || r.title || "Untitled"}</span>
<span class="sd-book">${r.book_title || r.book?.name || ""}</span>
```

If a BookStack page title contains HTML, it renders as DOM.

**Fix**: Escape all API response values before insertion. An `escapeHtml()` utility already exists in `dom.js` — use it:
```js
<span class="sd-title">${escapeHtml(r.name || r.title || "Untitled")}</span>
```

---

### 23. HIGH — XSS in Admin Publish Flow (textToHtml)

**The problem**: `admin.js` lines 17-23 — `textToHtml()` wraps user input in `<p>` tags without HTML-escaping:

```js
.map(para => `<p>${para.trim().replace(/\n/g, "<br>")}</p>`)
```

Content typed in the admin textarea (line 513) is sent to BookStack as-is. If an admin types `<img src=x onerror=alert(1)>`, it executes on every future page view.

**Fix**: HTML-escape content before wrapping in tags:
```js
.map(para => `<p>${escapeHtml(para.trim()).replace(/\n/g, "<br>")}</p>`)
```

---

### 24. HIGH — XSS via Valuation JSON Import

**The problem**: `valuation.js` lines 3218-3225 — when importing a JSON snapshot, stored HTML is injected directly:

```js
Object.entries(snapshot.outputs.tables || {}).forEach(([id, html]) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
});
```

A maliciously crafted JSON import file can contain arbitrary JavaScript. Since snapshots are shared between auditors, this is a realistic attack vector.

**Fix**: Sanitize imported HTML through DOMPurify or the existing sanitizer before setting innerHTML.

---

### 25. HIGH — Auth Fail-Open When TM Is Unreachable

**The problem**: `auth.js` lines 48-52:

```js
} catch {
    console.warn("[hub-auth] Task Manager unreachable — running unauthenticated.");
    return { email: "", name: "" };
}
```

When the TM authentication endpoint is down (network error, server restart), `initAuth()` returns a fake user instead of blocking access. The entire hub loads without authentication — any user on the network can access all features including the admin panel.

**Fix**: On auth failure, redirect to an error page or block loading:
```js
} catch {
    console.error("[hub-auth] Task Manager unreachable.");
    document.body.innerHTML = '<div style="padding:2rem;text-align:center"><h2>Service unavailable</h2><p>Please try again later.</p></div>';
    throw new Error("Auth service unreachable");
}
```

---

### 26. HIGH — `@CrossOrigin` Without Parameters Allows All Origins

**The problem**: Two controllers have `@CrossOrigin` with no parameters, which defaults to allowing ALL origins:

- `TaskController.java` line 24: `@CrossOrigin`
- `EmployeeController.java` line 12: `@CrossOrigin`

This may override the centralized CORS config in `SecurityConfig.corsConfigurationSource()` which correctly restricts to `hub.treppides.com`. The `BudgetKpiController` and `PerformanceController` do NOT have `@CrossOrigin` (correct).

**Fix**: Remove `@CrossOrigin` from both controllers. The centralized config handles CORS:
```java
// Delete this line from TaskController.java and EmployeeController.java:
// @CrossOrigin
```

---

### 27. HIGH — Email Header Injection via Task Titles

**The problem**: `NotificationService.java` lines 24-25, 73-75 — task titles are user-controlled and included directly in email subjects:

```java
message.setSubject("Task Assigned: " + task.getTitle());
```

An attacker can inject `\r\n` into a task title to add BCC/CC headers, modify the email body, or use the server as a spam relay. No input validation exists on task titles (see finding #33).

**Fix**: Sanitize subjects by stripping newlines:
```java
String safeTitle = task.getTitle().replaceAll("[\\r\\n]", " ");
message.setSubject("Task Assigned: " + safeTitle);
```

---

### 28. HIGH — `staff.json` Committed to GitHub (GDPR / PII)

**The problem**: `~/treppides-hub/staff.json` (982 lines, ~120 employees) contains full names, departments, office locations, and phone extensions. It is tracked in git and pushed to `github.com/andreas1612/treppides-hub`. The `.gitignore` excludes `staff.xlsx` but NOT `staff.json`.

This is personal employee data. If the GitHub repo is accessible outside the organization, it is a GDPR data exposure.

**Fix**:
```bash
# 1. Stop tracking the file
cd ~/treppides-hub
echo "staff.json" >> .gitignore
git rm --cached staff.json

# 2. Commit
git commit -m "security: remove staff.json from tracking (PII)"
```

The file remains on disk for the app to use, but is no longer pushed to GitHub.

---

### 29. HIGH — Spring Boot Bound to All Interfaces (Bypasses nginx)

**The problem**: `application.properties` has no `server.address` setting. Spring Boot defaults to `0.0.0.0:8080`, meaning it is directly reachable at `http://192.168.0.221:8080` — **bypassing nginx entirely**. This means:
- No TLS encryption
- No security headers (HSTS, CSP, X-Frame-Options)
- No rate limiting
- No access logging via nginx

Confirmed by `ss -tlnp`: `*:8080 *:*` (listening on all interfaces).

**Fix**: Add to `application.properties`:
```properties
server.address=127.0.0.1
```

Then only nginx (which proxies to `127.0.0.1:8080`) can reach the app.

---

### 30. HIGH — Docker Services with Weak/Placeholder Credentials

**BookStack** (`~/bookstack/docker-compose.yml`):
```yaml
DB_PASS=<REDACTED>          # line 13
MYSQL_ROOT_PASSWORD=<REDACTED> # line 30
MYSQL_PASSWORD=<REDACTED>    # line 33
```

**OpenProject** (`~/openproject/docker-compose.yml`):
```yaml
DATABASE_URL=postgresql://openproject:openproject@db/openproject  # username=password
SECRET_KEY_BASE=<REDACTED>            # placeholder
POSTGRES_PASSWORD=openproject                                      # trivially guessable
```

Both files have `664` permissions.

**Fix**: Change passwords, rotate `SECRET_KEY_BASE`, and `chmod 600` both files.

---

### 31. HIGH — `show-sql=true` Leaks All SQL to Logs

**The problem**: `application.properties` line 8:

```properties
spring.jpa.show-sql=true
```

All Hibernate-generated SQL is logged to the journal, exposing table structures, column names, and query patterns.

**Fix**: Set to `false`:
```properties
spring.jpa.show-sql=false
```

---

### 32. HIGH — config.js Servable Over HTTPS from Web Root

**The problem**: The nginx `location /` block serves from `/home/tech-admin/treppides-hub` with `try_files`. The `config.js` file sits at the root. The `location ~ /\.(?!well-known)` block only protects dotfiles (names starting with `.`), not `config.js`.

Any LAN user can fetch `https://hub.treppides.com/config.js` and obtain the BookStack API token and admin PIN.

**Fix**: Add to the nginx `hub.treppides.com` server block:
```nginx
location = /config.js { deny all; }
```

---

### 33. MEDIUM — No Input Validation on Any DTO

**The problem**: No DTO in the Task Manager uses Bean Validation annotations (`@Valid`, `@NotBlank`, `@Size`, `@Pattern`). No controller method uses `@Valid` on `@RequestBody` parameters. `spring-boot-starter-validation` is not in `pom.xml`.

This means:
- Task titles can be null or arbitrarily long
- Status/priority can be any string
- Email fields have no format validation
- `assignedTo` entries are unchecked

**Files**: `CreateTaskRequest.java`, `UpdateTaskRequest.java`, `AddCommentRequest.java`, `UpdateStatusRequest.java`

**Fix**: Add `spring-boot-starter-validation` to `pom.xml` and annotate DTOs:
```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-validation</artifactId>
</dependency>
```

```java
public class CreateTaskRequest {
    @NotBlank @Size(max = 500) private String title;
    @Size(max = 5000) private String description;
    // etc.
}
```

---

### 34. MEDIUM — RuntimeException Messages Leak Internal Details

**The problem**: `TaskService.java` throws `RuntimeException` with messages like `"Employee not found: " + email` and `"Task not found"` at 24+ throw sites (lines 75, 86, 255, 261, 285, etc.). Spring Boot's default error handler returns these in JSON responses.

This confirms whether specific emails/task IDs exist, enabling enumeration.

**Fix**: Add a `@ControllerAdvice` exception handler that returns generic messages:
```java
@ControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<Map<String,String>> handle(RuntimeException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(Map.of("error", "Invalid request"));
    }
}
```

---

### 35. MEDIUM — Incomplete HTML Attribute Escaping

**The problem**: `reader.js` lines 189-191:

```js
function escAttr(str) {
  return String(str || "").replace(/"/g, "&quot;");
}
```

Only escapes double quotes. When used inside inline `onclick` handlers (line 485) with single-quoted strings, a book name containing `');alert('XSS` breaks out of the string literal.

**Fix**: Escape all HTML-significant characters:
```js
function escAttr(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
```

---

### 36. MEDIUM — Valuation Financial Data in localStorage

**The problem**: `valuation.js` lines 3021-3028, 3244 — the entire valuation form state (financial data, company names, shareholder info, valuation figures) is stored in `localStorage`. Unlike `sessionStorage`, this persists indefinitely and is accessible to any JavaScript on the same origin. Any XSS vulnerability can exfiltrate this data.

**Fix**: Use `sessionStorage` instead of `localStorage` for draft data, or encrypt before storing.

---

### 37. MEDIUM — `trustServerCertificate=true` on Both JDBC Connections

**The problem**: `application.properties` lines 1 and 62 — both JDBC URLs include `trustServerCertificate=true`, disabling TLS certificate validation. A MITM attacker on the network can intercept database traffic.

**Fix**: Remove `trustServerCertificate=true` and install the SQL Server CA certificate in the Java truststore, or use `encrypt=true;trustServerCertificate=false`.

---

### 38. MEDIUM — Missing CSP + Permissions-Policy on tasks.treppides.com

**The problem**: The `tasks.treppides.com` nginx server block has HSTS and basic headers but does NOT include `Content-Security-Policy` or `Permissions-Policy` headers, unlike the `hub.treppides.com` block.

**Fix**: Add matching headers to the `tasks.treppides.com` block in `/etc/nginx/sites-enabled/treppides-hub`.

---

### 39. MEDIUM — CSP Allows `unsafe-inline` and `unsafe-eval`

**The problem**: nginx config line 86:
```
script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'
```

This effectively nullifies XSS protection from CSP. Any injected inline script executes.

**Fix**: Long-term — refactor inline scripts to external files and use nonce-based CSP. Short-term — acceptable for LAN-only, but note that XSS findings above (#21-24) are all exploitable because of this.

---

### 40. MEDIUM — Flask Health Endpoint Leaks Auth Mode

**The problem**: `app.py` lines 215-217:
```python
return jsonify({"status": "ok", "auth_mode": AUTH_MODE, "targets_loaded": len(TARGETS)})
```

The unauthenticated `/api/performance/health` endpoint reveals whether dev or prod auth mode is active — directly aiding exploitation of finding #19.

**Fix**: Return only `{"status": "ok"}` with no internal details.

---

### 41. MEDIUM — Backup Script Copies Secrets in Plaintext

**The problem**: `~/treppides-hub/backup.sh` lines 25-28 copy `config.js` (with API tokens and admin PIN) and both `.env` files to the backup directory in plaintext. If the backup directory (`/home/tech-admin/backups/`) has wider permissions or is synced elsewhere, secrets propagate.

**Fix**: Either encrypt backups or exclude sensitive files from the backup set.

---

### 42. MEDIUM — SSH Config Group-Readable + Git SSL Verify Disabled

Two infrastructure issues:
1. `~/.ssh/config` has `664` permissions — should be `600`
2. `~/.gitconfig` has `sslVerify = false` — allows MITM on all git push/pull operations

**Fix**:
```bash
chmod 600 ~/.ssh/config
git config --global http.sslVerify true
```

---

### 43. MEDIUM — No CSRF Protection on Flask Fee Adjustment Endpoints

**The problem**: `app.py` lines 733-773 and `app_legacy.py` lines 647-681 — POST and DELETE endpoints for fee adjustments have no CSRF token validation, no `SameSite` cookie policy, and no custom header check.

**Fix**: Add `flask-wtf` CSRF protection or require a custom header (e.g., `X-Requested-With`) on all state-changing requests.

---

### 44. MEDIUM — Orphan Flask Processes from Claude Sessions

**The problem**: Two Flask processes (PIDs 830664 and 832381) were spawned from Claude Code shell snapshots. They are not managed by systemd, have no log rotation, no restart strategy, and expose unauthenticated admin endpoints on all interfaces.

**Fix**: Kill them and, if needed, run through systemd with proper binding and auth:
```bash
pkill -f "python3 app_legacy.py"
pkill -f "python3 app.py"
```

---

### 45. LOW — File Permissions on Credential-Bearing Files

Eight files containing credentials have `664` permissions (group/other-readable) but should be `600`:

```bash
chmod 600 ~/taskmanager/src/main/resources/application.properties
chmod 600 ~/performance-tester/.env
chmod 600 ~/bookstack/docker-compose.yml
chmod 600 ~/openproject/docker-compose.yml
chmod 600 ~/budget_per_manager_seed_sqlserver.sql
chmod 600 ~/.ssh/config
chmod 600 ~/CLAUDE.md
chmod 600 ~/DEPLOY_GUIDE.md
```

---

### 46. LOW — `System.out.println` and `e.printStackTrace()` in Production

**Files**: `NotificationService.java` lines 57, 60, 62, 104, 108, 110; `TaskReminderScheduler.java` lines 33, 43-48, 58

Using `System.out.println` instead of SLF4J bypasses log level controls and rotation. `e.printStackTrace()` dumps full stack traces including internal class names and library versions.

**Fix**: Replace with `private static final Logger log = LoggerFactory.getLogger(...)` and `log.error("message", e)`.

---

### 47. LOW — `spring-boot-devtools` in pom.xml

**File**: `pom.xml` lines 27-31 — `spring-boot-devtools` with `<scope>runtime</scope>`. Auto-disables in packaged JARs, but if ever run in exploded/IDE mode in production, enables live-reload and other dev features.

**Fix**: Change scope to `provided` or remove entirely for production builds.

---

### 48. LOW — No Rate Limiting on Task/Email-Triggering Endpoints

`NotificationService.sendTaskAssignedEmail()` is called for each assignee during task creation. An attacker can create tasks with large `assignedTo` lists to trigger mass email sending. No rate limiting exists on any endpoint.

**Fix**: Add rate limiting via Spring's `bucket4j-spring-boot-starter` or nginx `limit_req`.

---

## Findings Summary

| Severity | Original (1-14) | Deep Audit (15-48) | Total |
|----------|-----------------|-------------------|-------|
| CRITICAL | 2 | 6 (+ 1 deferred) | 8 (+1) |
| HIGH | 3 | 12 | 15 |
| MEDIUM | 4 | 11 | 15 |
| LOW | 2 | 4 | 6 |
| INFO | 3 | 0 | 3 |
| **Total** | **14** | **34** | **48** |

**Deferred**: Finding #20 (BookStack API tokens / admin PIN) — will be addressed after the application is feature-complete.

---

## Implementation Order

### Batch A — Immediate Hardening (no code changes, one TM restart)

| Step | Fix # | Description | Where |
|---|---|---|---|
| A1 | 45 | `chmod 600` on all credential-bearing files | Shell |
| A2 | 32 | ~~Block `config.js` from nginx~~ REVERTED — breaks SPA, admin-only auth mitigates | nginx |
| A3 | 44 | Kill orphan Flask processes | Shell |
| A4 | 29 | Add `server.address=127.0.0.1` to application.properties | TM properties |
| A5 | 31 | Set `show-sql=false` | TM properties |
| A6 | 4 | Reduce logging to WARN | TM properties |
| A7 | 42 | Fix SSH config perms + enable git SSL verify | Shell |

**Deploy**: Batch A4-A6 together → one TM build + restart. A1-A3, A7 are shell-only.

### Batch B — Spring Security Fixes (one TM restart)

| Step | Fix # | Description | Where |
|---|---|---|---|
| B1 | 1 | Domain filter (block external users) | TM Java |
| B2 | 2 | Move secrets to env vars | TM properties + systemd |
| B3 | 9 | Remove localhost CORS origins | TM Java |
| B4 | 26 | Remove `@CrossOrigin` from TaskController + EmployeeController | TM Java |
| B5 | 7,8 | Session timeout, SameSite, explicit redirect URI | TM properties |
| B6 | 10 | Email case `.toLowerCase()` | TM Java |
| B7 | 11 | Clean up stale comments in properties | TM properties |

**Deploy**: All batch B → one commit + one TM restart.

### Batch C — Authorization & Input Validation (one TM restart)

| Step | Fix # | Description | Where |
|---|---|---|---|
| C1 | 15 | Add authorization checks to TaskController | TM Java |
| C2 | 16 | Derive changedBy/createdBy from session | TM Java |
| C3 | 27 | Sanitize email subjects (strip newlines) | TM Java |
| C4 | 33 | Add Bean Validation to DTOs | TM Java + pom.xml |
| C5 | 34 | Add `@ControllerAdvice` global exception handler | TM Java |
| C6 | 46 | Replace System.out with SLF4J | TM Java |

**Deploy**: All batch C → one commit + one TM restart.

### Batch D — Frontend XSS Fixes (no restart needed)

| Step | Fix # | Description | Where |
|---|---|---|---|
| D1 | 21 | Strip event handlers in sanitizeHtml() | `reader.js` |
| D2 | 22 | Escape search result names in topbar | `topbar.js` |
| D3 | 23 | HTML-escape textToHtml() in admin | `admin.js` |
| D4 | 24 | Sanitize imported JSON snapshot HTML | `valuation.js` |
| D5 | 25 | Block hub load on auth failure (fail-closed) | `auth.js` |
| D6 | 35 | Fix escAttr() to escape all chars | `reader.js` |

**Deploy**: `cd ~/treppides-hub && git add js/ components/ && git commit && git push`

### Batch E — Infrastructure & Config

| Step | Fix # | Description | Where |
|---|---|---|---|
| E1 | 28 | Remove staff.json from git tracking | Hub git |
| E2 | 5 | Fix seed SQL domain mismatch | `~/performance_targets_seed.sql` |
| E3 | 38,39 | Add CSP + Permissions-Policy to tasks.treppides.com | nginx |
| E4 | 12 | Remove deprecated X-XSS-Protection | nginx |
| E5 | 30 | Rotate Docker service credentials | bookstack + openproject |
| E6 | 18,19 | ~~Fix Flask tester~~ N/A — Flask tester killed, replaced by hub | N/A |
| E7 | 3 | Enable CSRF (do separately, test carefully) | TM Java |
| E8 | 37 | Remove trustServerCertificate=true from JDBC | TM properties |

---

## Deploy Sequences

### Task Manager (Batch A properties + B + C)

```bash
# 1. Build
cd ~/taskmanager && ./mvnw package -DskipTests 2>&1 | tail -5

# 2. Update systemd (if secrets moved to env vars)
sudo systemctl daemon-reload

# 3. Restart
echo '<REDACTED>' | sudo -S systemctl restart taskmanager

# 4. Wait and verify
sleep 15
sudo systemctl status taskmanager --no-pager | head -20

# 5. Smoke test
curl -s -o /dev/null -w "%{http_code}" https://tasks.treppides.com/api/reports/performance/me
# Expected: 401

curl -s -o /dev/null -w "%{http_code}" https://tasks.treppides.com/api/reports/budget-kpi/me
# Expected: 401

# 6. Verify Spring only on loopback
curl -s --connect-timeout 3 http://192.168.0.221:8080/api/me
# Expected: connection refused (if server.address=127.0.0.1 applied)
```

### nginx (Batch E3, E4)

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### Hub Frontend (Batch D + E1)

```bash
cd ~/treppides-hub
git add js/ components/ .gitignore
git rm --cached staff.json
git commit -m "security: fix XSS vectors, fail-closed auth, remove staff.json from tracking"
git push origin main
```

### Immediate Hardening (Batch A shell commands)

```bash
# File permissions
chmod 600 ~/taskmanager/src/main/resources/application.properties
chmod 600 ~/performance-tester/.env
chmod 600 ~/bookstack/docker-compose.yml
chmod 600 ~/openproject/docker-compose.yml
chmod 600 ~/budget_per_manager_seed_sqlserver.sql
chmod 600 ~/.ssh/config
chmod 600 ~/CLAUDE.md
chmod 600 ~/DEPLOY_GUIDE.md

# Kill orphan Flask processes
pkill -f "python3 app_legacy.py" 2>/dev/null
pkill -f "python3 app.py" 2>/dev/null

# Git SSL
git config --global http.sslVerify true
```

---

## Git Workflow

### Task Manager (`~/taskmanager`, branch `deployment`)

```bash
cd ~/taskmanager
git diff  # verify NO secrets in diff
git add -p  # review each hunk
git commit -m "security: domain filter, authorization, input validation, harden config"
git push origin deployment
```

### Hub Frontend (`~/treppides-hub`, branch `main`)

```bash
cd ~/treppides-hub
git diff  # review changes
git add js/ components/ .gitignore
git rm --cached staff.json  # if not already done
git commit -m "security: fix XSS vectors, fail-closed auth, remove PII from tracking"
git push origin main
```

**NEVER push secrets.** Always run `git diff` and scan for passwords/tokens before committing.

---

## What We Cannot Fix Without Azure Portal Access

These require someone with Azure AD admin access:

1. **Rotate the client secret** — the current one is in git history and should be considered compromised
2. **Restrict app to "Accounts in this organizational directory only"** (single-tenant)
3. **Configure optional claims** — adding `acct` claim to distinguish member vs guest accounts
4. **Configure App Roles** — defining `Admin`/`Manager` roles to eliminate hardcoded admin email lists
5. **Remove guest user access** — restrict app via Enterprise Application user assignment

---

## Verification Checklist (After All Fixes)

### Auth & Access
- [ ] `@finalogic.com` user gets 403 when trying to log in
- [ ] `@treppides.com` user can still log in and see their data
- [ ] User A cannot read/modify User B's tasks via direct API call
- [ ] `changedBy` in task history matches the session user, not a client-supplied value
- [ ] Hub shows error page (not empty shell) when TM is unreachable

### Secrets & Config
- [ ] `git diff` of `application.properties` shows NO plaintext secrets
- [ ] `curl https://hub.treppides.com/config.js` returns 403
- [ ] `curl http://192.168.0.221:8080/api/me` returns connection refused
- [ ] `stat -c %a ~/taskmanager/src/main/resources/application.properties` returns 600
- [ ] `staff.json` not in `git ls-files` output

### Logging & Runtime
- [ ] `systemctl status taskmanager` shows running after restart
- [ ] `journalctl -u taskmanager --since "5 min ago"` — no DEBUG/TRACE, no SQL dumps
- [ ] `ss -tlnp | grep 8080` shows `127.0.0.1:8080` not `*:8080`
- [ ] `ss -tlnp | grep -E "909[12]"` returns empty (Flask testers killed)

### Frontend
- [ ] BookStack page with `<img src=x onerror=alert(1)>` in title — no alert fires in reader
- [ ] Search for that page in topbar — no alert fires in results dropdown
- [ ] Performance and Budget KPI pages load correctly for a logged-in treppides.com user

### Smoke Tests
```bash
curl -s -o /dev/null -w "%{http_code}" https://tasks.treppides.com/api/reports/performance/me  # 401
curl -s -o /dev/null -w "%{http_code}" https://tasks.treppides.com/api/reports/budget-kpi/me    # 401
curl -s -o /dev/null -w "%{http_code}" https://hub.treppides.com/                               # 200
curl -s -o /dev/null -w "%{http_code}" https://hub.treppides.com/config.js                      # 403
curl -s --connect-timeout 3 http://192.168.0.221:8080/ 2>&1 | head -1                           # refused
```

---

## Session Continuity

> This section ensures any new Claude session can pick up security remediation seamlessly.
> Update this section at the end of every session that touches security fixes.

### How to Use This Document Across Sessions

1. **Start of session**: Read `~/SECURITY_AUDIT.md` top to bottom
2. **Check progress**: Look at the "Fix Status Tracker" below to see what's done vs pending
3. **Do work**: Implement fixes in batch order (A → B → C → D → E)
4. **End of session**: Update the tracker below, then commit this file

### Fix Status Tracker

> Update this table as fixes are implemented. Use: `PENDING`, `IN PROGRESS`, `DONE`, `DEFERRED`, `BLOCKED`.

| Fix # | Severity | Short Description | Status | Session Date | Notes |
|---|---|---|---|---|---|
| 1 | CRITICAL | Domain filter (block external users) | DONE | 2026-06-16 | DomainFilter.java blocks non-@treppides.com, registered in SecurityConfig |
| 2 | CRITICAL | Move secrets to env vars | DONE | 2026-06-16 | 4 secrets moved to systemd Environment= vars |
| 3 | HIGH | Enable CSRF | PENDING | | Do separately, test carefully |
| 4 | HIGH | Reduce logging to WARN | DONE | 2026-06-16 | Set to WARN, removed azure.spring=DEBUG |
| 5 | HIGH | Seed SQL domain mismatch | DONE | 2026-06-16 | 103 occurrences fixed in seed SQL |
| 6 | MEDIUM | Explicit OAuth2 redirect URI | DONE | 2026-06-16 | Added {baseUrl}/login/oauth2/code/{registrationId} |
| 7 | MEDIUM | Session timeout 8h | DONE | 2026-06-16 | server.servlet.session.timeout=8h |
| 8 | MEDIUM | SameSite cookie | DONE | 2026-06-16 | server.servlet.session.cookie.same-site=lax |
| 9 | MEDIUM | Remove localhost CORS | DONE | 2026-06-16 | Only https://hub.treppides.com in CORS origins |
| 10 | MEDIUM | Email case .toLowerCase() | DONE | 2026-06-16 | resolveEmail() in both controllers + AuthController |
| 11 | LOW | Remove stale Azure config comments | DONE | 2026-06-16 | Deleted lines 29-33 from application.properties |
| 12 | LOW | Remove X-XSS-Protection header | PENDING | | |
| 13 | INFO | Flask tester port docs | PENDING | | |
| 14 | INFO | Stale nginx sites-available | PENDING | | |
| 15 | CRITICAL | IDOR — add authorization to TaskController | PENDING | | |
| 16 | CRITICAL | Derive changedBy/createdBy from session | PENDING | | |
| 17 | CRITICAL | Remove credentials from markdown docs | PENDING | | |
| 18 | CRITICAL | Flask tester zero auth + all interfaces | N/A | 2026-06-16 | Flask tester killed — replaced by hub |
| 19 | CRITICAL | Flask dev auth defaults to on | N/A | 2026-06-16 | Flask tester killed — replaced by hub |
| 20 | CRITICAL | BookStack tokens + PIN in config.js | DEFERRED | 2026-06-16 | Will rotate after app is feature-complete |
| 21 | HIGH | XSS — reader sanitizeHtml event handlers | DONE | 2026-06-16 | Strip all on* attributes via DOM walk |
| 22 | HIGH | XSS — topbar search results | DONE | 2026-06-16 | escapeHtml() on result names/titles |
| 23 | HIGH | XSS — admin textToHtml | DONE | 2026-06-16 | escapeHtml() before wrapping in <p> |
| 24 | HIGH | XSS — valuation JSON import | DONE | 2026-06-16 | DOMParser sanitizer on snapshot HTML |
| 25 | HIGH | Auth fail-open when TM unreachable | DONE | 2026-06-16 | Fail-closed with error page + throw |
| 26 | HIGH | Remove @CrossOrigin from controllers | DONE | 2026-06-16 | Removed from TaskController + EmployeeController |
| 27 | HIGH | Email header injection via task titles | PENDING | | |
| 28 | HIGH | staff.json committed to GitHub (PII) | DONE | 2026-06-16 | Added to .gitignore, git rm --cached |
| 29 | HIGH | Spring Boot bound to all interfaces | DONE | 2026-06-16 | server.address=127.0.0.1, verified loopback only |
| 30 | HIGH | Docker weak/placeholder credentials | PENDING | | |
| 31 | HIGH | show-sql=true in production | DONE | 2026-06-16 | Set to false |
| 32 | HIGH | config.js servable from web root | REVERTED | 2026-06-16 | Broke SPA (main.js imports config.js). Admin-only auth mitigates. |
| 33 | MEDIUM | No input validation on DTOs | PENDING | | |
| 34 | MEDIUM | RuntimeException leaks internal details | PENDING | | |
| 35 | MEDIUM | Incomplete escAttr() | DONE | 2026-06-16 | Full HTML entity escaping for &, ", ', <, > |
| 36 | MEDIUM | Valuation data in localStorage | PENDING | | |
| 37 | MEDIUM | trustServerCertificate=true on JDBC | PENDING | | |
| 38 | MEDIUM | Missing CSP on tasks.treppides.com | PENDING | | |
| 39 | MEDIUM | CSP allows unsafe-inline/unsafe-eval | PENDING | | |
| 40 | MEDIUM | Flask health endpoint leaks auth mode | PENDING | | |
| 41 | MEDIUM | Backup copies secrets in plaintext | PENDING | | |
| 42 | MEDIUM | SSH config perms + git SSL verify | DONE | 2026-06-16 | chmod 600, git sslVerify=true |
| 43 | MEDIUM | No CSRF on Flask fee adjustments | PENDING | | |
| 44 | MEDIUM | Orphan Flask processes | DONE | 2026-06-16 | Killed. All features ported to hub (performance, budget KPI, fee adjustments) |
| 45 | LOW | chmod 600 on credential files | DONE | 2026-06-16 | All 8 files set to 600 |
| 46 | LOW | System.out.println in production | PENDING | | |
| 47 | LOW | spring-boot-devtools in pom.xml | PENDING | | |
| 48 | LOW | No rate limiting on task endpoints | PENDING | | |

### End-of-Session Checklist

Before ending a session that touched security fixes:

```markdown
1. Update the Fix Status Tracker above (change PENDING → DONE / IN PROGRESS)
2. Add the session date and any notes
3. If new findings were discovered, append them and add to the tracker
4. Commit this file:
   - For ~/SECURITY_AUDIT.md (unredacted, local only): just save
   - For ~/treppides-hub/SECURITY_AUDIT.md (redacted): see below
5. Update ~/NEXT_SESSION.md if the overall project state changed
```

### Maintaining the Redacted Copy

There are two copies of this file:
- `~/SECURITY_AUDIT.md` — **full version with all credentials** (local only, never commit)
- `~/treppides-hub/SECURITY_AUDIT.md` — **redacted** (committed to git)

After updating the local copy, regenerate the redacted version:
```bash
# Create redacted copy (replace all known secrets with <REDACTED>)
sed \
  -e 's/<REDACTED>/<REDACTED>/g' \
  -e 's/PTEuF\*R5%GcOrts34GHfeOL/<REDACTED>/g' \
  -e 's/<REDACTED>/<REDACTED>/g' \
  -e 's/i~X8Q~CKB2sDufDt5lD\.c~kN_my9jotK_PWKxdez/<REDACTED>/g' \
  -e 's/<REDACTED>/<REDACTED>/g' \
  -e 's/<REDACTED>/<REDACTED>/g' \
  -e 's/<REDACTED>/<REDACTED>/g' \
  -e 's/<REDACTED>/<REDACTED>/g' \
  -e 's/<REDACTED>/<REDACTED>/g' \
  -e 's/<REDACTED>/<REDACTED>/g' \
  -e 's/<REDACTED>/<REDACTED>/g' \
  -e 's/<REDACTED>/<REDACTED>/g' \
  -e 's/<REDACTED>/<REDACTED>/g' \
  -e 's/<REDACTED>/<REDACTED>/g' \
  -e 's/<REDACTED>/<REDACTED>/g' \
  ~/SECURITY_AUDIT.md > ~/treppides-hub/SECURITY_AUDIT.md

# Commit the redacted version
cd ~/treppides-hub
git add SECURITY_AUDIT.md
git commit -m "docs: update security audit ($(date +%Y-%m-%d))"
```

### New Session Prompt

Copy-paste this prompt to start a new session focused on security remediation:

```
Read ~/SECURITY_AUDIT.md — it is the master security audit for the Treppides Hub platform.
It contains 48 findings across ~/treppides-hub (frontend), ~/taskmanager (Spring Boot backend),
~/performance-tester (Flask), and infrastructure (nginx, systemd, file permissions).

Also read: ~/CLAUDE.md (system context), ~/NEXT_SESSION.md (project state),
~/PERFORMANCE_DATA_PIPELINE.md (data flow), ~/HUB_AUTH_DESIGN.md (auth design).

Look at the "Fix Status Tracker" table in SECURITY_AUDIT.md to see what is PENDING vs DONE.
Implement the next batch of PENDING fixes in the order specified in "Implementation Order".

Rules:
- Follow the exact fix code provided in each finding
- Test each fix before marking DONE
- Update the Fix Status Tracker after each fix
- NEVER write to eSoft or InternalTools databases (we are read-only consumers)
- At the end of the session, update the tracker, regenerate the redacted copy,
  and commit the redacted version to ~/treppides-hub
- For API tokens and admin PIN (finding #20): leave as-is, they are DEFERRED

Start by telling me which batch you will work on and which fixes are next.
```
