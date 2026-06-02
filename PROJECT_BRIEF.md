# PROJECT_BRIEF — Treppides Hub
> Paste this at the start of a new chat and say "continue the Treppides Hub project"

**Status: LIVE IN PRODUCTION — fully operational**
**Last session: 2026-06-02 (backend hardening)**
**Server: 192.168.0.221 (tech-srv) · User: tech-admin**
**Live URL: https://hub.treppides.com**

**Long-term planning target:** 200 total staff, ~60–80 concurrent at peak, 3-year horizon.
**Live resources (2026-05-29):** 4 vCPU EPYC 7F72 · 9.5 GiB RAM · 72 GB root (15 % used) · uptime 65 d.
**Target spec (≤ 24 months):** 8 vCPU · 16 GiB RAM · 250 GB root + 1 TB SSD for `/srv/media`.
**Canonical plan reference:** [SESSION_15.md](SESSION_15.md) — sizing, VM options, rate-limiting design.

---

## Project

**Name:** Treppides Company Hub
**Owner:** Andreas Pieri
**Purpose:** Self-hosted internal employee portal replacing SharePoint. Staff land here daily. Pulls live content from BookStack (wiki/KB backend) and ClickUp (fees dashboard). LAN-only.

---

## What is live and working

| Feature | Status |
|---|---|
| Announcements feed — social post style (images/video inline) | ✅ Live |
| Knowledge Base — department books grid, dedicated full-page | ✅ Live |
| In-app BookStack reader (PDF preview, chapters, pushState routing) | ✅ Live |
| Policies & Procedures feed | ✅ Live |
| Training & Development feed | ✅ Live |
| Quick links widget (KB, Projects, IT Support) | ✅ Live |
| Staff Directory — accordion, search, department filter | ✅ Live |
| AML Dashboard (ClickUp — new/rejected/disengaged) | ✅ Live |
| New Client UBO Fees dashboard (chart, drilldown, CSV export) | ✅ Live |
| Admin panel — PIN, publish with media (photo/video/YouTube), delete | ✅ Live |
| IT Support ticket modal (FormSubmit → email) | ✅ Live |
| Live search (BookStack full-text, topbar) | ✅ Live |
| Projects page — stub ("under development") | ✅ Visible |
| Valuation Tool (DCF, Damodaran archive, edition picker, FX, PDF) | ✅ Live |
| HTTPS — Sectigo wildcard *.treppides.com, TLS 1.2+ | ✅ Live |
| Server hardening — UFW, fail2ban, rate limits, sandboxed services | ✅ Live |
| Automated backups + health monitoring + renewal alerts | ✅ Live |

---

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS — zero dependencies, no build step, ES modules
- **Backend (wiki):** BookStack (PHP/Laravel) in Docker, port 6875, proxied at `/docs/*`
- **Backend (fees + uploads):** FastAPI Python, systemd `clickup-fees`, port 8001
  - proxied at `/api/clickup/*` and `/api/upload/*`
- **Backend (valuation):** FastAPI Python, systemd `valuation-api`, port 8002
  - proxied at `/api/valuation/*`
- **Static media:** uploaded images/videos served at `/media/` from `~/treppides-hub/media/`
- **Web server:** Nginx — HTTPS, HTTP/2, rate limiting, security headers, SPA routing
- **Database:** MariaDB in Docker (BookStack), SQLite (valuation reference data)
- **Deployment:** `git push` from server → live immediately (nginx serves repo dir directly)
- **Vendor libs:** Chart.js, jsPDF, html2canvas bundled in `/vendor/` (no CDN)

---

## Infrastructure

```
VM: 192.168.0.221 (tech-srv) — Ubuntu Server 24.04

nginx (HTTPS :443, HTTP/2, TLS 1.2+)
  /                → ~/treppides-hub (SPA, try_files → index.html)
  /docs/*          → localhost:6875 (BookStack Docker)
  /api/clickup/*   → localhost:8001 (FastAPI — fees + uploads)
  /api/upload/*    → localhost:8001 (FastAPI — media uploads)
  /api/valuation/* → localhost:8002 (FastAPI — valuation reference)
  /media/          → ~/treppides-hub/media/ (static uploaded files)
  /projects        → localhost:3000 (OpenProject — not yet deployed)
  http :80         → redirect → HTTPS

Security: UFW (22/80/443), fail2ban (SSH + nginx), rate limits (30r/s API, 5r/m upload)
```

**Services:**
- `sudo systemctl reload nginx`
- `sudo systemctl restart clickup-fees`
- `sudo systemctl restart valuation-api`
- `cd ~/bookstack && sudo docker compose up -d`

**Ops:** See [SERVER-OPS.md](SERVER-OPS.md) for backups, monitoring, firewall, crons, and restore procedures.

---

## File Structure

```
treppides-hub/
├── index.html, main.js
├── config.js                         GITIGNORED — only on server
├── config.example.js
├── nginx-treppides-hub.conf          Nginx site config
├── clickup-fees.service              systemd unit — ClickUp API
├── valuation-api.service             systemd unit — Valuation API
├── SETUP.sh                          Idempotent server provisioning
├── backup.sh                         Daily backup (cron 2 AM)
├── healthcheck.sh                    Health monitor (cron 5 min)
├── renewal-alert.sh                  Cert/token expiry (cron monthly)
├── staff.json                        Static staff data
├── SERVER-OPS.md                     Full ops reference
├── media/
│   ├── images/                       GITIGNORED
│   └── videos/                       GITIGNORED
├── components/
│   ├── shell/    sidebar.js, topbar.js, admin.js, support.js
│   ├── pages/    aml.js, fees.js, knowledgebase.js, projects.js, reader.js, staff.js, valuation.js
│   └── widgets/  announcements.js, policies.js, training.js, quicklinks.js
├── api/
│   ├── bookstack.js
│   ├── clickup/server.py             FastAPI: fees data + media uploads
│   └── valuation/
│       ├── main.py                   FastAPI: valuation reference data
│       ├── build_database.py         Schema + models
│       ├── seed_database.py          Baseline seed (Jan 2024)
│       ├── backfill_damodaran.py     Historical archive 2008-2024
│       ├── update_damodaran.py       Append current edition
│       └── fetch_exchange_rates.py   Year-end FX from Frankfurter/ECB
├── styles/
│   ├── theme.css, base.css, layout.css, cards.css, modals.css
│   ├── pages/    aml.css, fees.css, knowledgebase.css, reader.css, staff.css, valuation.css
│   └── widgets/  announcements.css
├── utils/
│   ├── dom.js    escapeHtml, renderSkeleton, renderError, renderEmpty
│   └── format.js formatDate, excerptFromHtml
└── vendor/       Chart.js, jsPDF, html2canvas (bundled, no CDN)
```

---

## config.js Keys

| Key | Value |
|---|---|
| `BASE_URL` | `https://hub.treppides.com/docs` |
| `API_TOKEN_ID` | BookStack token — **expires 15/08/2026** |
| `API_TOKEN_SECRET` | In config.js on server |
| `DEPARTMENTS_SHELF_ID` | `57` |
| `ANNOUNCEMENTS_BOOK_ID` | `58` |
| `POLICIES_BOOK_ID` | `3` |
| `TRAINING_BOOK_ID` | `59` |
| `CLICKUP_FEES_API` | `/api/clickup/fees` |
| `ENV_LIVE` | `true` |
| `ADMIN_PIN` | Set on server |
| `SUPPORT_EMAIL` | `apieri@treppides.com` |

**Token rotation:** BookStack admin → My Account → API Tokens → delete old → create new → update `config.js`.

---

## Session Log

### 2026-06-02 — Backend hardening

- nginx.conf: gzip, server_tokens off, TLS 1.2+, worker tuning, rate limit zones
- ClickUp API: CORS restricted, error responses sanitized
- Valuation API: SQLite WAL mode, connection pooling
- Both service files rewritten: 2 workers, memory/CPU caps, security sandbox
- New scripts: backup.sh, healthcheck.sh, renewal-alert.sh
- SETUP.sh rewritten: idempotent, installs fail2ban + UFW + crons + services
- UFW firewall + fail2ban deployed and active
- SERVER-OPS.md created as full ops reference
- File permissions hardened, system packages updated

### 2026-05-29 (session 15) — Live server assessment + long-term plan

Documentation pass only — no code, no server changes. Read-only SSH
into `tech-admin@192.168.0.221` to ground the v1–v3 capacity docx in
real numbers. Recorded:

- Live resource snapshot (CPU/RAM/disk/services/listeners/tuning state).
- Optimal target spec for 200 staff / 3-year horizon.
- Three architecture options (single VM scaled · two VMs split · three
  VMs full split), with a decision matrix and migration playbook
  Option 1 → Option 2.
- Layered rate-limiting design (per-session cookie primary · per-IP
  backstop · per-endpoint global ceiling) replacing the v3 IP-only
  proposal.

Files touched: SESSION_15.md (new — canonical reference), STATUS.md,
PROJECT_BRIEF.md, README.md.

### 2026-05-25 (sessions 13-14) — Valuation: Damodaran archive + draft persistence

- Schema rebuilt around per-edition keying (2008-2026)
- backfill_damodaran.py for historical ingest from Damodaran archive
- Edition picker in valuation form, all reference calls edition-scoped
- Draft auto-save to localStorage, JSON export/import for audit trail
- valuation_reference.db removed from git (rebuilt server-side)

### 2026-05-19 (session 12) — Valuation: FX data + tax auto-fill + PDF polish

- Real year-end FX rates: 43 currencies, 2015-2025, sourced from Frankfurter/ECB
- Country selection auto-fills CRP + ERP + statutory tax rate
- CRP continent-average fallback (matches Excel IFERROR logic)
- PDF report layout refined

### 2026-05-14 (session 11) — Valuation Tool port (Valtrix → Hub)

- Full valuation page ported: sidebar wiring, form, FastAPI backend
- CDN deps vendored (jsPDF, html2canvas), API namespaced under /api/valuation
- systemd unit + nginx proxy block

### 2026-05-12 (sessions 8-10) — AML breakdown, social announcements, refactor

- AML per-list fee breakdown (status/rejection/disengagement reason)
- Social post feed with inline media, media upload endpoints
- File structure refactor (components/shell, pages, widgets)

### 2026-05-11 (session 7) — HTTPS, Staff Directory, AML multi-list

- Sectigo wildcard cert, nginx HTTPS, Staff Directory, AML multi-list landing

### 2026-04-03 to 2026-05-06 (sessions 1-6) — Core portal + infrastructure

- Announcements, Policies, Training, KB, In-app Reader, BookStack API
- Admin panel, IT Support modal, Fees dashboard, credential hygiene
- FastAPI as systemd service, Chart.js bundled

---

## Critical Rules

1. **Never `localhost` in frontend** — use relative paths. Nginx proxies everything.
2. **`config.js` is gitignored** — only on server. Never commit.
3. **No build step** — edit, push, hard-refresh. Done.
4. **BookStack token expires 15/08/2026** — rotate in BookStack admin → API Tokens.
5. **Chart.js in `vendor/`** — never use CDN.
6. **SSL private key** — `/etc/nginx/ssl/treppides.key`, chmod 600, never commit.
7. **`media/` dirs gitignored** — uploaded files live only on server.

---

## Next Features

1. **BookStack port `127.0.0.1:6875`** — bind to localhost in `~/bookstack/docker-compose.yml`
2. **OpenProject** — deploy at `/projects` (docker-compose at `~/openproject/`)
3. **Server-side BookStack token proxy** — removes token from browser
4. **Active monitoring notifications** — email/Slack alerts when healthcheck fails
5. **Mobile reader navigation** — drawer/bottom sheet
6. **LDAP/SSO auth** — Phase 2
