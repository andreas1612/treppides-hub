# STATUS --- Treppides Hub

**Last updated: 2026-06-17**
**Long-term capacity plan:** detailed in former `SESSION_15.md` (consolidated away 2026-06-03, commit 358efa1); session summaries now inline in [NEXT_SESSION.md](NEXT_SESSION.md).

---

## Services

| Service | Status | How it runs | Notes |
|---|---|---|---|
| **Nginx** | Active | systemd | TLS 1.2+, HTTP/2, rate limits, security headers. Routes both hub.treppides.com and tasks.treppides.com |
| **BookStack** | Active | Docker `bookstack` | APP_URL: `https://hub.treppides.com/docs`, port bound to `127.0.0.1:6875` |
| **MariaDB** | Active | Docker `bookstack_db` | |
| **ClickUp Fees + Upload API** | Active | systemd `clickup-fees` (port 8001) | 2 workers, 512 MB cap, sandboxed. AML fees + media upload |
| **Valuation Reference API** | Active | systemd `valuation-api` (port 8002) | 2 workers, 384 MB cap, sandboxed, SQLite WAL |
| **Company Finder API** | Active | systemd `companies-api` (port 8003) | 2 workers, 384 MB cap, sandboxed, SQLite WAL. Master DB of all ClickUp tasks; 3-min incremental sync via cron |
| **Task Manager** | Active | systemd `taskmanager` (port 8080) | Spring Boot Java, SQL Server backend (KTDEV:1433), Azure AD OAuth2. Proxied at `/projects` on hub, direct at tasks.treppides.com |
| **UFW Firewall** | Active | ufw | Deny all except 22/80/443 |
| **fail2ban** | Active | systemd | SSH (5 tries/1hr) + nginx rate-limit jail |

---

## Hub Sections

| Section | Status | Source | Notes |
|---|---|---|---|
| Announcements | Live | BookStack book 58 | Social post feed, 10 posts, inline images/video |
| Knowledge Base | Live | BookStack shelf 57 | 12 dept books, dedicated full-page view |
| Policies & Procedures | Live | BookStack book 3 | Card feed |
| Training & Development | Live | BookStack book 59 | Card feed |
| Quick Links | Live | --- | KB / Projects / IT Support |
| In-app Reader | Live | BookStack API | PDF preview, chapters, pushState routing |
| AML Dashboard | Live | ClickUp -> FastAPI | 3 lists; per-list breakdown by status/rejection/disengagement reason |
| Fees Dashboard | Live | ClickUp -> FastAPI | Chart, drilldown with reason badges, CSV export |
| Staff Directory | Live | /staff.json | Accordion, search, dept filter |
| Admin Panel | Live | BookStack API + upload API | PIN-protected, photo/video/YouTube media composer |
| IT Support Modal | Live | FormSubmit -> email | -> apieri@treppides.com |
| Search | Live | BookStack full-text | Topbar, 400ms debounce |
| Valuation Tool | Live | FastAPI + SQLite (Damodaran) | DCF builder; historical archive 2008-2026 with edition picker; country/industry/currency reference auto-fill; historical FX (2015-2025); draft auto-save + JSON export/import; PDF report. **On-site guided tour** (2026-06-17): coachmark/spotlight walkthrough (17 steps) launched from a **Tutorial** button in the header, auto-offered to first-time users (localStorage flag). Zero-dep, no-build — `valuation-tour.js` + `valuation-tour.css`. Pure frontend, no new API calls |
| TB Ratio Tool | **In progress** | Client-side (vendored xlsx) | Trial-balance importer (`tbratio.js`, vendored `vendor/xlsx.full.min.js`). Nav wired (sidebar + mobile); not yet feature-complete as of 2026-06-17 |
| Group Dashboard | Live | ClickUp -> FastAPI + SQLite | Sidebar "Group Dashboard" --- one unified **searchable + filterable** company list (sortable, paginated; row opens that company's deals) + a **Chart** view comparing Deal Value **by company or by UBO** (bar chart via vendored Chart.js; defaults to top 15, or pick specific ones). 'By company' groups on the **Dashboard TID (GID)** field --- a higher-level group key that rolls several companies into one bar, labelled with a synthesized supername (shared core of the group's company names) + a **Custom Total** view (tick individual deals -> combined sum, selection persists across filters). Per-company **total Deal Value (fees)** (active vs rejected/lost; no-deal `---`) + **filtered grand-total** banner. Detail lists **deal tasks only**, color-coded Service, with "subtask of {parent}" on subtask deals. **Cascading multi-select filters**: Space, Project Year, Business Year, Service, Assignee, Department --- options narrow to the selection; fee totals recompute to the filter. Space names prettified (`_CRM` dropped, `KT` -> `K. Treppides`). Master DB (`companies-api`, port 8003, ~9.8k tasks; indexed service/year/business_year/department + UBO columns) synced every 3 min via `date_updated_gt` (reconcile gated 15 min); manual Refresh. Instant SQL |
| Task Manager | Live | Spring Boot + SQL Server | Full task/project management. Dashboard, my tasks, team tasks, create task, task details. Azure AD SSO auth. Proxied at `/projects` on hub; also accessible directly at `tasks.treppides.com` |

---

## HTTPS / SSL

| Item | Status | Notes |
|---|---|---|
| SSL certificate | Live | Sectigo wildcard `*.treppides.com` --- valid until 22 Nov 2026 |
| TLS | 1.2+ only | TLS 1.0/1.1 dropped |
| HTTP/2 | Enabled | |
| Security headers | Live | HSTS, CSP (incl. `blob:` in frame-src), X-Frame, X-Content-Type, Permissions-Policy, X-XSS-Protection |
| OCSP stapling | Enabled | |
| Internal DNS | Live | `hub.treppides.com` -> `192.168.0.221` resolves; HTTPS padlock confirmed |
| Internal DNS | Live | `tasks.treppides.com` -> `192.168.0.221` resolves; direct Task Manager access |

---

## Authentication

| Item | Detail |
|---|---|
| Method | Azure AD SSO via Spring Boot OAuth2 (Task Manager) |
| Azure AD client ID | `dc4895f7-ea14-4387-a368-cbccacee7270` |
| Azure AD tenant | `6e5d13a9-1138-4013-913d-f32a1be7dced` |
| Hub auth flow | `auth.js` checks `/projects/api/me` -> if 401, redirect to `/login.html` -> Azure SSO -> callback -> session cookie set -> hub loads. **Fail-closed**: auth service unreachable halts boot (no silent fallback) |
| Admin gate | **Admin-only** (Batch C, pulled 2026-06-17): `auth.js` blocks non-admin users (`isAdmin !== true`) with an "Access Restricted" page. Performance + Budget KPI are admin sections |
| Session type | Server-side session cookie (Spring Boot), set on hub.treppides.com |
| TM direct access | `tasks.treppides.com` has its own session (same Azure AD app, separate cookie) |
| Redirect URI | Auto-generated from request Host header (never hardcoded) |

---

## Server Hardening (deployed 2026-06-02)

| Component | Detail |
|---|---|
| Firewall | UFW --- deny all incoming except 22/80/443 |
| fail2ban | SSH jail (5 tries/1hr ban) + nginx-limit-req jail (10 hits/10min ban) |
| Rate limits | API: 30 req/s, uploads: 5 req/min, per-IP connection limit --- returns HTTP 429 |
| CORS | Restricted to `hub.treppides.com` + `192.168.0.221` (was `*`) |
| Error sanitization | ClickUp API errors logged server-side, generic message to client |
| Service sandbox | PrivateTmp, NoNewPrivileges, ProtectSystem=strict, memory/CPU caps |
| nginx | server_tokens off, gzip, worker_connections 2048, multi_accept |
| File permissions | Sensitive files (config.js, .env, SSL key) locked to 600 owner-only |
| System updates | Unattended-upgrades enabled; all packages patched 2026-06-02 |

---

## Backups & Monitoring

| What | Schedule | Details |
|---|---|---|
| Backup | Daily 2 AM | Configs, SQLite, MariaDB, media -> `~/backups/hub/` (14-day retention) |
| Health check | Every 5 min | Services + Docker containers + HTTP endpoints |
| Renewal alert | Monthly (1st) | SSL cert + BookStack token expiry |

Logs: `/var/log/hub-health.log`, `/var/log/hub-health-alerts.log`, `/var/log/hub-backup.log`

**Limitation:** Monitoring writes to log files only --- no email/Slack notifications.

Full ops details in **[SERVER-OPS.md](SERVER-OPS.md)**.

---

## Credentials & Expiry

| Item | Expires | Action |
|---|---|---|
| BookStack API token | **15/08/2026** | BookStack admin -> My Account -> API Tokens -> rotate -> update config.js |
| ClickUp API token | Never | Regenerate in ClickUp settings if revoked |
| SSL cert (*.treppides.com) | **22/11/2026** | Re-issue from Sectigo |
| Azure AD client secret | Check Azure portal | Azure Portal -> App registrations -> Certificates & secrets |
| Damodaran reference data | Annual (Jan) + optional July | `venv/bin/python update_damodaran.py && sudo systemctl restart valuation-api` |
| FX rates (year-end) | Annual (Jan) | `python fetch_exchange_rates.py --end <year>` |

---

## Known Issues

| # | Severity | Description |
|---|---|---|
| 1 | Low | Reader nav hidden on mobile --- out of scope |
| 2 | Low | Sidebar Home always `.active` on first load --- acceptable |
| 3 | Info | `--brand-green` CSS vars defined but unused --- reserved |
| 4 | Medium | BookStack token plaintext in config.js --- mitigated: gitignored, LAN-only |
| 6 | Low | Valuation FX field silent when date falls back to nearest-prior row |
| 7 | Low | Croatian Kuna has no FX data after 2022 (currency retired) |
| 8 | Info | Perpetual Growth Rate is hardcoded 5.67% and not linked to Revenue Growth Override |
| 9 | Info | Source Excel "Country Risk Free Premium" reads ERP (col 5) not CRP (col 6) --- hub is correct |
| 10 | Info | Pre-2024 editions have no Rates4 (currency risk-free) data --- UI shows inline note |
| 11 | Low | Industry betas only backfilled to 2014 --- pre-2014 archive uses different schema |
| 12 | Low | Switching editions doesn't clear stale dropdown selection |
| 13 | Info | Monitoring is log-only --- no active notifications (email/Slack/push) |

| 15 | Info | Auth is session-based (Azure AD SSO) --- no per-user LDAP integration yet (no user-level rate limiting or audit log) |

---

## What Is NOT Done Yet

| Feature | Priority | Notes |
|---|---|---|
| Server-side BookStack token proxy | High | Removes token from browser; enables per-session rate limiting |
| Active notifications | Medium | Email/Slack alerts when healthcheck fails |
| Mobile reader navigation | Medium | Drawer/bottom sheet |
| Task Manager email notifications | Medium | Configured in application.properties (Office 365 SMTP) but untested in production |
| Video subsystem (HLS pipeline) | Planned | Phase B --- depends on VM resize (plan was in former `SESSION_15.md`, consolidated 2026-06-03) |
