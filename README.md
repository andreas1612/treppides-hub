# Treppides Employee Hub

**Status: LIVE IN PRODUCTION**
**Server:** 192.168.0.221 (tech-srv) - Ubuntu 24.04.4 LTS
**URLs:** https://hub.treppides.com | https://tasks.treppides.com
**Last updated:** 2026-07-29

Internal company portal replacing SharePoint. Staff land here daily for announcements, knowledge base, CRM dashboards, valuation/ratio tools, team calendar, performance reporting, and Task Manager. Admin-only access with 5-tier RBAC. LAN-only, self-hosted.

> **Long-term planning (200 users, 3-year horizon, VM sizing, video roadmap):**
> session summaries are inline in **[NEXT_SESSION.md](NEXT_SESSION.md)**. The detailed
> capacity & architecture doc (`SESSION_15.md`) was consolidated away on 2026-06-03
> (commit 358efa1); its §-numbered detail was not migrated.

---

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS --- zero dependencies, no build step, ES modules, SPA routing (History API)
- **Backend (wiki):** BookStack (PHP/Laravel) in Docker, port 6875, proxied at `/docs/*`
- **Backend (fees + uploads):** FastAPI Python, systemd `clickup-fees`, port 8001
- **Backend (valuation):** FastAPI Python, systemd `valuation-api`, port 8002
- **Backend (companies):** FastAPI Python, systemd `companies-api`, port 8003
- **Backend (calendar):** FastAPI Python, systemd `team-calendar`, port 8004
- **Backend (newsletter):** FastAPI Python, systemd `newsletter`, port 8005
- **Backend (staff):** FastAPI Python, systemd `staff-directory`, port 8010
- **Backend (rooms):** FastAPI Python, systemd `roombooking`, port 8090
- **Backend (kyc):** FastAPI Python, systemd `kyc`, port 8091
- **Backend (tasks):** Spring Boot Java, systemd `taskmanager`, port 8080 --- Azure AD OAuth2 + Chamilo OAuth2 Authorization Server
- **Static media:** Uploaded images/videos served at `/media/`
- **Web server:** Nginx --- HTTPS, HTTP/2, rate limiting, security headers
- **Database:** MariaDB in Docker (BookStack), SQLite (valuation + companies), SQL Server on KTDEV:1433 (Task Manager)
- **Authentication:** Azure AD SSO via Task Manager's Spring Boot OAuth2 --- session-based, 5-tier RBAC
- **Deployment:** `git push` -> `git pull` on server -> live immediately (frontend); backend services need restart
- **Vendor libs:** Chart.js, jsPDF, html2canvas, SheetJS bundled in `/vendor/` (no CDN)

---

## Live Sections

| Section | Source | Notes |
|---|---|---|
| Announcements | BookStack book 58 | Social post feed, 10 posts, inline images/video. Paginated carousel (prev/next arrows + dot indicators) |
| Knowledge Base | BookStack shelf 57 | 12 dept books, dedicated full-page view |
| Regulatory & Industry Intelligence | Newsletter API (port 8005) | Dept-scoped regulatory/industry feed with search, filters, tabs (authority/journal), priority badges |
| Quick Links | --- | KB / Projects / IT Support |
| In-app Reader | BookStack API | PDF preview, chapters, pushState routing |
| CRM Landing | --- | Card grid: Deals, Leads, Accounts (Companies/Individuals), Contacts, AML. SUPERVISOR+ tier |
| Deals Dashboard | ClickUp -> FastAPI + SQLite | Unified searchable/filterable company list, Chart view (by company/UBO), Custom Total, cascading filters, color-coded services. Editable status/assignee/comment fields. Linked company on deal tasks |
| Leads Dashboard | ClickUp -> FastAPI | Pipeline tracking with source, industry, jurisdiction, status filters. Charts + forms |
| Accounts Dashboards | ClickUp -> FastAPI | Companies + Individuals --- UBO, client code, industry, country, auditors, risk. Editable fields |
| Contacts Dashboard | ClickUp -> FastAPI | People with linked company, job title, email, phone. Status filter, field-completeness charts, editable fields |
| AML Dashboard | ClickUp -> FastAPI | 3 lists (new/rejected/disengaged); per-list breakdown by status/rejection/disengagement reason |
| Fees Dashboard | ClickUp -> FastAPI | Chart, drilldown with reason badges, CSV export |
| Forms Tool | ClickUp -> FastAPI | Lead + Deal creation forms with schema from backend |
| Valuation Tool | FastAPI + SQLite (Damodaran) | DCF builder; historical archive 2008-2026 with edition picker; auto-fill; FX rates; draft auto-save + JSON export/import; PDF report. On-site guided tour (17 steps) |
| TB Ratio Tool | Client-side (vendored SheetJS) | Trial-balance importer with P&L, Balance Sheet, ratios. Mapping panel, comparative years, .xlsx export. On-site guided tour |
| Team Calendar | Team Calendar API (port 8004) | Leave, meetings & deadlines calendar view |
| Staff Directory | Staff Directory API (port 8010) | Accordion, search, dept filter |
| Performance Report | TM backend | Employee chargeability viewer. STANDARD: self only. FULL/SUPER: browse any employee/manager |
| Budget KPI | TM backend | Manager budget vs invoiced. Monthly breakdown, fee adjustments CRUD. STANDARD: self only. FULL/SUPER: browse any manager |
| Financials | TM backend | Revenue, budget, recoverability, debtors reporting. **SUPER tier only** |
| Task Manager | Spring Boot + SQL Server | Full project/task management. Azure AD SSO + Chamilo OAuth2 provider. Proxied at `/projects` on hub; also at `tasks.treppides.com` |
| Admin Panel | BookStack API + upload API | PIN-protected, photo/video/YouTube media composer |
| IT Support Modal | FormSubmit -> email | -> apieri@treppides.com |
| Search | BookStack full-text | Topbar, 400ms debounce |

---

## TB Ratio Tool

Turns an **E-Soft trial-balance export** into a Profit & Loss statement, a Balance
Sheet, and a panel of financial ratios --- then exports all three to `.xlsx`.

**Flow:** open *TB Ratio Tool* in the sidebar -> drop an `.xlsx`/`.csv` -> the tool
parses it, validates that debits = credits, maps each account to a statement line,
renders the P&L / Balance Sheet / Ratios, and offers an `.xlsx` download. You can
review and reassign any account in the mapping panel and re-run, and optionally upload
a second TB to fill the prior-year comparative columns.

**100% client-side --- no backend.** The upload is parsed in the browser and never
leaves it. SheetJS is vendored at `vendor/xlsx.full.min.js` (no CDN, lazy-loaded on
first open) and handles both reading the upload and writing the export.

**Guided tour.** A *Tutorial* button replays an on-site coachmark tour (same pattern
as the Valuation tool's). First-time users get a one-off prompt
(localStorage `treppides:tbratio:tourSeen:v1`).

### How parsing works

The E-Soft export is a formatted sheet, not a clean table. The parser
(in `components/pages/tbratio.js`) locates the data table by finding the header row that
contains *Code / Name / Type*, resolves columns by header text (tolerating extra or
trailing columns and label variants), skips metadata and roll-up rows (capturing the
roll-ups only to validate), and derives every figure from the **posting rows** --- never
from the printed subtotals. Accounts are grouped by their 1-digit top-level code
(1 Fixed Assets ... 8 Taxation). Signed nets use the convention *Debit positive, Credit
negative*.

### How accounts are detected (and overridden)

Each account is assigned to a statement line **automatically**, by built-in group-code +
name-keyword rules in `components/pages/tbratio.js` (the `DEFAULT_MAPPING` block).
The rules are matched **first-match-wins**, most specific first. The **review & adjust
mapping panel** lets the user reassign any account to the correct line and re-run.
Anything that matches no rule appears in the **unmapped accounts** panel.

### Financial ratios

Ratios are shown in **two separate panels** (and two export sheets):

- **Profit & Loss Ratios** --- profitability (gross / operating / net margin, return on
  equity), as a plain Year 1 / Year 2 list.
- **Balance Sheet Ratios** --- Debt ratio, Current ratio, Working capital, Assets to
  Equity, Debt to Equity. Each computed for Year 1 / Year 2 with Good / Caution / Bad
  status, commentary, and advice.

### Validation & UX

The tool warns if the TB does not balance, shows whether the produced balance sheet
balances (with the difference if not), lists any **unmapped accounts** so nothing is
silently dropped, and lets you adjust the mapping and re-run before exporting.

---

## Services

| Service | Type | Port | Management |
|---|---|---|---|
| nginx | systemd | 80, 443 | `sudo systemctl reload nginx` |
| clickup-fees | systemd | 8001 (localhost) | `sudo systemctl restart clickup-fees` |
| valuation-api | systemd | 8002 (localhost) | `sudo systemctl restart valuation-api` |
| companies-api | systemd | 8003 (localhost) | `sudo systemctl restart companies-api` |
| team-calendar | systemd | 8004 (localhost) | `sudo systemctl restart team-calendar` |
| newsletter | systemd | 8005 (localhost) | `sudo systemctl restart newsletter` |
| staff-directory | systemd | 8010 (localhost) | `sudo systemctl restart staff-directory` |
| roombooking | systemd | 8090 (localhost) | `sudo systemctl restart roombooking` |
| kyc | systemd | 8091 (localhost) | `sudo systemctl restart kyc` |
| taskmanager | systemd | 8080 (all interfaces) | `sudo systemctl restart taskmanager` |
| bookstack | Docker | 6875 (localhost) | `cd ~/bookstack && sudo docker compose restart` |
| bookstack_db | Docker (MariaDB) | 3306 (internal) | same docker-compose |

Python API services run with 2 workers, memory caps, CPU quotas, and a security sandbox (PrivateTmp, NoNewPrivileges, ProtectSystem=strict). Task Manager is a Spring Boot JAR with SQL Server backend.

---

## Nginx Routing

### hub.treppides.com

```
https://hub.treppides.com
  /                  -> ~/treppides-hub (SPA, try_files -> index.html)
  /docs/*            -> localhost:6875 (BookStack)
  /api/clickup/*     -> localhost:8001 (ClickUp Fees API)
  /api/upload/*      -> localhost:8001 (Media uploads)
  /api/valuation/*   -> localhost:8002 (Valuation Reference API)
  /api/companies/*   -> localhost:8003 (Company Finder API)
  /api/calendar/*    -> localhost:8004 (Team Calendar API)
  /api/newsletter/*  -> localhost:8005 (Newsletter Intelligence API)
  /api/staff/*       -> localhost:8010 (Staff Directory API)
  /api/roombooking/* -> localhost:8090 (Room Booking API)
  /api/kyc/*         -> localhost:8091 (KYC Management API)
  /projects/*        -> localhost:8080 (Task Manager proxy, strips /projects prefix)
  /oauth2/*          -> localhost:8080 (OAuth2 authorization flow)
  /login/oauth2/*    -> localhost:8080 (OAuth2 callback from Azure AD)
  /media/            -> ~/treppides-hub/media/ (static uploaded files)
  http :80           -> redirect -> HTTPS
```

### tasks.treppides.com

```
https://tasks.treppides.com
  /*                 -> localhost:8080 (Task Manager direct access, separate session)
```

Rate limits: 30 req/s per IP on API, 5 req/min on uploads. Exceeding returns HTTP 429 and may trigger a fail2ban ban.

---

## Authentication

Hub uses Azure AD SSO, powered by Task Manager's Spring Boot OAuth2 session.
37 admin emails are whitelisted in `application.properties` (`app.admin.emails`).
Non-admins see an "Access Restricted" page.

**Flow:**
1. User visits `hub.treppides.com` --- `auth.js` checks `/projects/api/me`
2. If 401 (not authenticated), hub shows the branded login page (`login.html`)
3. Login page sends user to `/oauth2/authorization/azure` (proxied to Task Manager)
4. Azure AD authenticates the user, redirects back to `/login/oauth2/code/azure`
5. Task Manager sets a session cookie on `hub.treppides.com` --- hub loads with tier-scoped sidebar

### Access Tiers

Controlled by `RoleService.java`. Resolution order: SUPER -> SUPERVISOR -> FULL -> STANDARD -> NONE.

| Tier | Count | Sections | Perf/Budget scope |
|---|---|---|---|
| **SUPER** | 4 | All sections incl. Financials, CRM, simulator | Browse any employee/manager |
| **SUPERVISOR** | 10 | STANDARD + CRM | Self-scoped only |
| **FULL** | 14 | All except Financials | Browse any employee/manager |
| **STANDARD** | Remaining admins | Home, KB, Staff, Tools, Support, Performance, Budget KPI | Self-scoped only |
| **NONE** | Non-admins | Access Restricted | --- |

**Chamilo OAuth2:** Task Manager also acts as OIDC Authorization Server for `learn.treppides.com`. SUPER + HR -> admin role; others -> student.

**Azure AD app registration:**
- Client ID: `dc4895f7-ea14-4387-a368-cbccacee7270`
- Tenant: `6e5d13a9-1138-4013-913d-f32a1be7dced`
- Redirect URI: auto-generated from the request Host header (no hardcoding)

---

## SPA Routing

The hub uses path-based URLs via the History API (`js/router.js`). Every sidebar
button and page transition updates the browser URL. Back/forward and deep-linking work.

| Path | Section |
|---|---|
| `/` | Home |
| `/kb` | Knowledge Base |
| `/staff` | Staff Directory |
| `/tools` | Tools grid |
| `/tools/valuation` | Valuation Tool |
| `/tools/tbratio` | TB Ratio Tool |
| `/tools/fees` | Fees Dashboard |
| `/tools/calendar` | Team Calendar |
| `/crm` | CRM Landing |
| `/crm/deals` | Deals Dashboard |
| `/crm/leads` | Leads Dashboard |
| `/crm/accounts-companies` | Accounts --- Companies |
| `/crm/accounts-individuals` | Accounts --- Individuals |
| `/crm/contacts` | Contacts |
| `/crm/aml` | AML Dashboard |
| `/crm/forms` | Forms Tool |
| `/performance` | Performance Report |
| `/budget-kpi` | Budget KPI |
| `/financials` | Financials |

Nginx `try_files $uri $uri/ /index.html` ensures all paths resolve to the SPA entry point.

---

## Server Security (hardened 2026-06-02)

| Layer | Status |
|---|---|
| HTTPS | TLS 1.2+ only, HTTP/2, HSTS, strong ciphers, OCSP stapling |
| Security headers | CSP, X-Frame-Options, X-Content-Type-Options, Permissions-Policy |
| Firewall (UFW) | Active --- only 22/80/443 open |
| fail2ban | SSH (5 tries -> 1hr ban) + nginx rate-limit jail |
| CORS | Restricted to `hub.treppides.com` + `192.168.0.221` |
| Error responses | Sanitized --- no internal details leak to clients |
| File permissions | Sensitive files (config.js, .env, SSL key) locked to 600 |
| System updates | Unattended-upgrades enabled |
| SQLite | WAL mode, busy timeout, connection pooling |

---

## File Structure

```
treppides-hub/
+-- index.html, main.js
+-- login.html                          Hub-branded login page (redirects to Azure SSO)
+-- config.js                           GITIGNORED --- only on server
+-- config.example.js
+-- nginx-treppides-hub.conf            Nginx site config (both domains)
+-- clickup-fees.service                systemd unit --- ClickUp API
+-- valuation-api.service               systemd unit --- Valuation API
+-- companies-api.service               systemd unit --- Company Finder API
+-- SETUP.sh                            Idempotent server provisioning
+-- backup.sh                           Daily backup (cron 2 AM)
+-- healthcheck.sh                      Service health monitor (cron 5 min)
+-- renewal-alert.sh                    Cert/token expiry checker (cron monthly)
+-- SERVER-OPS.md                       Full ops reference
|
+-- js/
|   +-- auth.js                         Auth gate --- checks /projects/api/me, shows login if 401
|   +-- router.js                       SPA router --- path-based URLs via History API
|
+-- components/
|   +-- shell/    sidebar.js, topbar.js, admin.js, support.js
|   +-- pages/    aml.js, companies.js, crm.js, crm-list.js, fees.js, financials.js,
|   |             forms.js, knowledgebase.js, performance.js, budget-kpi.js,
|   |             projects.js, reader.js, staff.js, team-calendar.js, valuation.js,
|   |             tbratio.js, tbratio-tour.js
|   +-- widgets/  announcements.js, newsletter.js, quicklinks.js
|
+-- api/
|   +-- bookstack.js                    All BookStack API calls
|   +-- clickup/
|   |   +-- server.py                   FastAPI --- fees data + media uploads
|   |   +-- .env                        ClickUp credentials (gitignored)
|   |   +-- venv/                       Python virtualenv (gitignored)
|   +-- valuation/
|   |   +-- main.py                     FastAPI --- valuation reference data
|   |   +-- build_database.py           SQLAlchemy models + schema
|   |   +-- seed_database.py            Baseline data (Jan 2024 CSVs)
|   |   +-- backfill_damodaran.py       Historical archive 2008-2024
|   |   +-- update_damodaran.py         Append current edition
|   |   +-- fetch_exchange_rates.py     Year-end FX from Frankfurter/ECB
|   |   +-- venv/                       Python virtualenv (gitignored)
|   +-- companies/
|       +-- server.py                   FastAPI --- company finder + CRM dashboards
|       +-- sync.py                     ClickUp -> SQLite sync (incremental + full)
|       +-- .env                        ClickUp credentials (gitignored)
|       +-- venv/                       Python virtualenv (gitignored)
|
+-- styles/
|   +-- theme.css, base.css, layout.css, cards.css, modals.css
|   +-- pages/    aml.css, fees.css, knowledgebase.css, reader.css, staff.css,
|   |             valuation.css, companies.css, tbratio.css, tbratio-tour.css,
|   |             crm.css, performance.css, budget-kpi.css, financials.css,
|   |             team-calendar.css, forms.css
|   +-- widgets/  announcements.css, newsletter.css
|
+-- utils/
|   +-- dom.js                          escapeHtml, renderSkeleton, renderError, renderEmpty
|   +-- format.js                       formatDate, excerptFromHtml
|
+-- media/                              Uploaded images + videos (gitignored)
|
+-- vendor/                             Chart.js, jsPDF, html2canvas, xlsx (SheetJS) (bundled, no CDN)

~/taskmanager/                          Spring Boot Task Manager (separate repo/directory)
+-- src/                                Java source
+-- pom.xml                             Maven build
+-- target/                             Built JAR
+-- application.properties              DB + OAuth2 config (gitignored)
```

---

## Developer Access

```bash
ssh tech-admin@192.168.0.221
```

**GitHub repo:** `git@github.com:andreas1612/treppides-hub.git`

### Deploy workflow

```bash
# On dev machine:
git add -A && git commit -m "description" && git push

# On server:
cd ~/treppides-hub && git pull
# Hard-refresh browser (Ctrl+Shift+R) --- no restart needed for frontend changes

# Restart service only if backend code changed:
sudo systemctl restart clickup-fees      # if server.py changed
sudo systemctl restart valuation-api     # if main.py changed
sudo systemctl restart companies-api     # if companies code changed
sudo systemctl reload nginx              # if nginx config changed

# Task Manager rebuild (if Java source changed):
cd ~/taskmanager && ./mvnw package -DskipTests && sudo systemctl restart taskmanager
```

### Critical rules

1. **Never `localhost` in frontend** --- use relative paths (`/api/...`). Nginx proxies everything.
2. **`config.js` is gitignored** --- only on server. Never commit.
3. **No build step** --- edit, push, hard-refresh. Done.
4. **No CDN** --- vendor all JS libs under `vendor/`.
5. **`media/` is gitignored** --- uploaded files live only on server, backed up daily.
6. **SSL private key** --- `/etc/nginx/ssl/treppides.key`, chmod 600, never commit.
7. **Never hardcode redirect-uri** --- Task Manager auto-generates it from the request Host header.
8. **TM rebuild needed for backend changes** --- frontend-only hub changes are instant, but any Task Manager Java changes require `./mvnw package -DskipTests` + service restart.

---

## Credentials & Expiry

| Item | Expires | Action |
|---|---|---|
| BookStack API token | **15/08/2026** | BookStack admin -> My Account -> API Tokens -> rotate -> update config.js |
| ClickUp API token | Never | Regenerate in ClickUp settings if revoked |
| SSL cert (*.treppides.com) | **22/11/2026** | Re-issue from Sectigo |
| Azure AD client secret | Check Azure portal | Azure Portal -> App registrations -> dc4895f7... -> Certificates & secrets |
| Damodaran reference data | Annual (Jan) | `cd api/valuation && venv/bin/python update_damodaran.py && sudo systemctl restart valuation-api` |
| FX rates | Annual (Jan) | `python fetch_exchange_rates.py --end <year>` after year-end |

---

## Backups & Monitoring

Daily backups at 2 AM to `~/backups/hub/` (14-day retention). Health checks every 5 minutes. Renewal alerts monthly.

See **[SERVER-OPS.md](SERVER-OPS.md)** for the full ops reference --- backup contents, restore procedures, monitoring details, firewall rules, fail2ban jails, and all file locations.

---

## Fresh VM Setup

```bash
sudo bash ~/treppides-hub/SETUP.sh
```

Handles: packages (fail2ban, UFW, sqlite3), firewall, fail2ban jails, nginx config, Python venvs, systemd services, backup/monitoring crons, smoke tests.

Manual steps after SETUP.sh:
1. Copy `config.example.js` -> `config.js` and fill in all values
2. Copy `api/clickup/.env.example` -> `api/clickup/.env` and fill in ClickUp credentials
3. Bootstrap valuation DB: `cd api/valuation && venv/bin/python seed_database.py && venv/bin/python backfill_damodaran.py && venv/bin/python update_damodaran.py`
4. Deploy Task Manager: see `~/taskmanager/` --- build with `./mvnw package -DskipTests`, configure `application.properties`, install systemd unit

---

## Troubleshooting

**Hub shows old content after a push:**
Hard-refresh the browser (`Ctrl+Shift+R`). No restart needed.

**All sections show "Could not reach the knowledge base":**
BookStack API token has expired. Rotate in BookStack admin -> My Account -> API Tokens -> update `config.js`.

**Fees dashboard shows "Fees data unreachable":**
```bash
sudo systemctl status clickup-fees
sudo systemctl restart clickup-fees
journalctl -u clickup-fees --since "10 min ago" --no-pager
```

**Valuation tool dropdowns empty:**
```bash
sudo systemctl status valuation-api
curl http://127.0.0.1:8002/api/valuation/health
```

**BookStack container down:**
```bash
cd ~/bookstack && sudo docker compose up -d
```

**Hub login page appears but Azure SSO fails:**
```bash
# Check Task Manager is running
sudo systemctl status taskmanager
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/

# Check nginx proxy paths are working
curl -s -o /dev/null -w "%{http_code}" https://hub.treppides.com/projects/api/me

# Check TM logs for OAuth2 errors
journalctl -u taskmanager --since "10 min ago" --no-pager
```

**Task Manager accessible at tasks.treppides.com but not via hub /projects:**
Nginx proxy issue. Check `/projects` location block in nginx config. Ensure prefix stripping is correct.

**Auth loop (keeps redirecting to login):**
Session cookie may not be setting correctly. Check that the TM session cookie domain matches `hub.treppides.com`. Clear browser cookies and retry.

---

## Next Features

| Feature | Priority | Notes |
|---|---|---|
| Server-side BookStack token proxy | High | Removes token from browser; enables per-session rate limiting |
| Active monitoring notifications | Medium | Email/Slack alerts when healthcheck fails |
| Mobile reader navigation | Medium | Drawer/bottom sheet |
| Task Manager email notifications | Medium | Configured but untested in production (Office 365 SMTP) |
| Video subsystem (HLS pipeline) | Planned | Phase B --- depends on VM resize |

---

*K.Treppides & Co - Built by Andreas Pieri - Vanilla HTML/CSS/JS - Zero dependencies*
