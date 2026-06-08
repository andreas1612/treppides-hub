# Treppides Employee Hub

**Status: LIVE IN PRODUCTION**
**Server:** 192.168.0.221 (tech-srv) - Ubuntu 24.04.4 LTS
**URLs:** https://hub.treppides.com | https://tasks.treppides.com
**Last updated:** 2026-06-08

Internal company portal replacing SharePoint. Staff land here daily for announcements, knowledge base, AML/fees dashboards, valuation tool, Group Dashboard, Task Manager, and IT support. LAN-only, self-hosted.

> **Long-term planning (200 users, 3-year horizon, VM sizing, video roadmap):**
> see **[SESSION_15.md](SESSION_15.md)** --- the canonical capacity & architecture reference.

---

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS --- zero dependencies, no build step, ES modules
- **Backend (wiki):** BookStack (PHP/Laravel) in Docker, port 6875, proxied at `/docs/*`
- **Backend (fees + uploads):** FastAPI Python, systemd `clickup-fees`, port 8001
- **Backend (valuation):** FastAPI Python, systemd `valuation-api`, port 8002
- **Backend (companies):** FastAPI Python, systemd `companies-api`, port 8003
- **Backend (tasks):** Spring Boot Java, systemd `taskmanager`, port 8080 --- Azure AD OAuth2
- **Static media:** Uploaded images/videos served at `/media/`
- **Web server:** Nginx --- HTTPS, HTTP/2, rate limiting, security headers
- **Database:** MariaDB in Docker (BookStack), SQLite (valuation + companies), SQL Server on KTDEV:1433 (Task Manager)
- **Authentication:** Azure AD SSO via Task Manager's Spring Boot OAuth2 --- session-based
- **Deployment:** `git push` -> `git pull` on server -> live immediately (frontend); backend services need restart
- **Vendor libs:** Chart.js, jsPDF, html2canvas bundled in `/vendor/` (no CDN)

---

## Live Sections

| Section | Source | Notes |
|---|---|---|
| Announcements | BookStack book 58 | Social post feed with inline images/video |
| Knowledge Base | BookStack shelf 57 | 12 dept books, dedicated full-page view |
| Policies & Procedures | BookStack book 3 | Card feed |
| Training & Development | BookStack book 59 | Card feed |
| In-app Reader | BookStack API | PDF preview, chapters, pushState routing |
| AML Dashboard | ClickUp -> FastAPI | 3 lists (new/rejected/disengaged), per-list breakdown |
| Fees Dashboard | ClickUp -> FastAPI | Chart, drilldown with badges, CSV export |
| Valuation Tool | FastAPI + SQLite | DCF builder, historical Damodaran archive 2008-2026, edition picker, FX rates, draft auto-save + JSON export/import, PDF report |
| Group Dashboard | ClickUp -> FastAPI + SQLite | Unified company list, Chart view (by company/UBO), Custom Total, cascading filters, color-coded services, subtask linking. Master DB via companies-api (port 8003) |
| Task Manager | Spring Boot + SQL Server | Full project/task management --- dashboard, my tasks, team tasks, create/detail views. Azure AD SSO. Accessible via hub at `/projects` or directly at `tasks.treppides.com` |
| Staff Directory | /staff.json | Accordion, search, dept filter |
| Admin Panel | BookStack API + upload API | PIN-protected, photo/video/YouTube media composer |
| IT Support Modal | FormSubmit -> email | -> apieri@treppides.com |
| Search | BookStack full-text | Topbar, 400ms debounce |

---

## Services

| Service | Type | Port | Management |
|---|---|---|---|
| nginx | systemd | 80, 443 | `sudo systemctl reload nginx` |
| clickup-fees | systemd | 8001 (localhost) | `sudo systemctl restart clickup-fees` |
| valuation-api | systemd | 8002 (localhost) | `sudo systemctl restart valuation-api` |
| companies-api | systemd | 8003 (localhost) | `sudo systemctl restart companies-api` |
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

**Flow:**
1. User visits `hub.treppides.com` --- `auth.js` checks `/projects/api/me`
2. If 401 (not authenticated), hub shows the branded login page (`login.html`)
3. Login page sends user to `/oauth2/authorization/azure` (proxied to Task Manager)
4. Azure AD authenticates the user, redirects back to `/login/oauth2/code/azure`
5. Task Manager sets a session cookie on `hub.treppides.com` --- hub loads

**Azure AD app registration:**
- Client ID: `dc4895f7-ea14-4387-a368-cbccacee7270`
- Tenant: `6e5d13a9-1138-4013-913d-f32a1be7dced`
- Redirect URI: auto-generated from the request Host header (no hardcoding)

Task Manager is also accessible directly at `https://tasks.treppides.com` with its own session.

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
| System updates | Unattended-upgrades enabled; all packages patched 2026-06-02 |
| SQLite | WAL mode, busy timeout, connection pooling |

---

## File Structure

```
treppides-hub/
+-- index.html, main.js
+-- login.html                          Hub-branded login page (redirects to Azure SSO)
+-- config.js                           GITIGNORED --- only on server
+-- config.example.js
+-- staff.json
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
|
+-- components/
|   +-- shell/    sidebar.js, topbar.js, admin.js, support.js
|   +-- pages/    aml.js, companies.js, fees.js, knowledgebase.js, projects.js, reader.js, staff.js, valuation.js
|   +-- widgets/  announcements.js, policies.js, training.js, quicklinks.js
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
|       +-- server.py                   FastAPI --- company finder + group dashboard
|       +-- sync.py                     ClickUp -> SQLite sync (incremental + full)
|       +-- .env                        ClickUp credentials (gitignored)
|       +-- venv/                       Python virtualenv (gitignored)
|
+-- styles/
|   +-- theme.css, base.css, layout.css, cards.css, modals.css
|   +-- pages/    aml.css, fees.css, knowledgebase.css, reader.css, staff.css, valuation.css, companies.css
|   +-- widgets/  announcements.css
|
+-- utils/
|   +-- dom.js                          escapeHtml, renderSkeleton, renderError, renderEmpty
|   +-- format.js                       formatDate, excerptFromHtml
|
+-- media/                              Uploaded images + videos (gitignored)
|
+-- vendor/                             Chart.js, jsPDF, html2canvas (bundled, no CDN)

~/taskmanager/                          Spring Boot Task Manager (separate repo/directory)
+-- src/                                Java source
+-- pom.xml                             Maven build
+-- target/                             Built JAR
+-- application.properties              DB + OAuth2 config
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
7. **Never hardcode redirect-uri** --- Task Manager auto-generates it from the request Host header. Hardcoding breaks hub vs direct access.
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
| BookStack port `127.0.0.1:6875` | High | Bind to localhost in `~/bookstack/docker-compose.yml` |
| Active monitoring notifications | Medium | Email/Slack alerts when healthcheck fails |
| Mobile reader navigation | Medium | Drawer/bottom sheet |
| API token server-side proxy | Low | Phase 2 |
| Task Manager email notifications | Low | Configured but untested in production (Office 365 SMTP) |

---

*K.Treppides & Co - Built by Andreas Pieri - Vanilla HTML/CSS/JS - Zero dependencies*
