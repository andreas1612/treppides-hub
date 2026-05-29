# PROJECT_BRIEF — Treppides Hub
> Paste this at the start of a new chat and say "continue the Treppides Hub project"

**Status: LIVE IN PRODUCTION — fully operational**
**Last session: 2026-05-29 (session 15) — live capacity assessment + long-term plan**
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
| HTTPS — Sectigo wildcard *.treppides.com | ✅ Live |

---

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS — zero dependencies, no build step, ES modules
- **Backend (wiki):** BookStack (PHP/Laravel) in Docker, port 6875, proxied at `/docs/*`
- **Backend (fees + uploads):** FastAPI Python, systemd `clickup-fees`, port 8001
  - proxied at `/api/clickup/*` and `/api/upload/*`
- **Static media:** uploaded images/videos served at `/media/` from `~/treppides-hub/media/`
- **Web server:** Nginx — HTTPS termination, SPA routing, all proxy blocks
- **Database:** MariaDB in Docker (BookStack data)
- **Deployment:** `git push` from server → live immediately (nginx serves repo dir directly)
- **Vendor libs:** Chart.js + datalabels bundled in `/vendor/` (no CDN)

---

## Infrastructure

```
VM: 192.168.0.221 (tech-srv) — Ubuntu Server 24.04

nginx (HTTPS :443)
  /                → ~/treppides-hub (SPA, try_files → index.html)
  /docs/*          → localhost:6875 (BookStack Docker)
  /api/clickup/*   → localhost:8001 (FastAPI)
  /api/upload/*    → localhost:8001 (FastAPI — media uploads)
  /media/          → ~/treppides-hub/media/ (static uploaded files)
  /projects        → localhost:3000 (OpenProject — not yet deployed)
  http :80         → redirect → HTTPS
```

**Services:**
- `sudo systemctl reload nginx`
- `sudo systemctl start|stop|restart clickup-fees`
- `cd ~/bookstack && sudo docker compose up -d`

---

## File Structure

```
treppides-hub/
├── index.html, main.js
├── config.js                        GITIGNORED — only on server
├── config.example.js
├── nginx-treppides-hub.conf         deploy: sudo cp → /etc/nginx/sites-enabled/ + reload
├── clickup-fees.service
├── staff.json                       static staff data
├── media/
│   ├── images/                      GITIGNORED
│   └── videos/                      GITIGNORED
├── components/
│   ├── shell/    sidebar.js, topbar.js, admin.js, support.js
│   ├── pages/    aml.js, fees.js, knowledgebase.js, projects.js, reader.js, staff.js
│   └── widgets/  announcements.js, policies.js, training.js, quicklinks.js
├── api/
│   ├── bookstack.js
│   └── clickup/server.py            FastAPI: fees data + /api/upload/image + /api/upload/video
├── styles/
│   ├── theme.css, base.css, layout.css, cards.css, modals.css
│   ├── pages/    aml.css, fees.css, knowledgebase.css, reader.css, staff.css
│   └── widgets/  announcements.css
├── utils/
│   ├── dom.js    escapeHtml, renderSkeleton, renderError, renderEmpty
│   └── format.js formatDate, excerptFromHtml
└── vendor/       Chart.js + datalabels (bundled, no CDN)
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

---

## Session Log

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

Confirmed v3-flagged findings on the live box: BookStack port 6875
binds `0.0.0.0`; no crontab / no backups; `worker_connections=768`;
no `limit_req_zone`; kernel mostly at defaults. FastAPI services
both correctly on `127.0.0.1` (v3 worry doesn't apply).

Files touched: SESSION_15.md (new — canonical reference), STATUS.md
(server-resources block + DNS marked live + operational gaps added),
PROJECT_BRIEF.md (header refreshed), README.md (server-resources
section appended).

### 2026-05-25 (sessions 11–14) — see SESSION_11.md … SESSION_14.md

Valuation Tool full port from Valtrix (S11), live FX + CRP/ERP
continent-average fallback (S12), historical Damodaran archive
2008–2025 with edition picker (S13), valuation draft auto-save +
JSON export/import (S14).

### 2026-05-12 (session 10) — AML dashboard per-list fee breakdown

- Each AML list now has its own breakdown field driving the chart, KPI
  cards, and drill-down table badges:
  - `new` → `client_status` (Existing / New) — unchanged
  - `rejected` → `rejection_reason`
  - `disengaged` → `disengaged_reason`
- Fixes silent bug where rejected/disengaged showed €0 in Existing/New
  KPI cards and force-bucketed every chart bar as "Existing".
- KPI cards become list-aware: Top {Reason} + Distinct {Reason}s replace
  Existing/New on non-new lists.
- Chart datasets and legend built dynamically from distinct values present.
- Stable per-load colour palette so colours don't shuffle between tab switches.
- Drill-down breakdown column rendered as colour-coded badges.
- One unverified assumption — exact snake-cased keys in ClickUp may differ;
  see NEXT_SESSION.md Priority 1.
- Single file changed: `components/pages/fees.js`.

### 2026-05-12 (session 9) — Social announcements + media upload infrastructure

- Announcements redesigned as social post feed (LinkedIn/FB style, 10 posts, inline media)
- Admin panel: media composer — Photo / Video (≤150MB) / YouTube+Vimeo with live previews
- FastAPI: `/api/upload/image` and `/api/upload/video` endpoints
- Nginx: `/media/` static block, `/api/upload/` proxy, `client_max_body_size 160m`
- `window.__hub_announcements.refresh()` exposed; auto-called after admin publish
- New: `styles/widgets/announcements.css`

### 2026-05-12 (session 8) — File structure refactor

- `components/` split into `shell/`, `pages/`, `widgets/`
- `styles/` split into `pages/`, `widgets/`
- All import paths updated — pure structural move, no logic changes

### 2026-05-11 (session 7) — HTTPS, Staff Directory, AML multi-list, Projects stub

- Sectigo wildcard cert deployed, nginx HTTPS live at `hub.treppides.com`
- Staff Directory built (`staff.js`, `staff.css`, `staff.json`)
- AML multi-list landing (new/rejected/disengaged)
- KB, Staff, AML, Projects moved to dedicated full-page views
- Active nav state via `hub:navchange` events

### 2026-05-06 (sessions 4–6) — Infrastructure, fees dashboard, admin

- FastAPI as systemd service, Chart.js bundled in `vendor/`
- Admin panel, IT Support modal, Fees dashboard v3 (chart, CSV export)

### 2026-04-03 (sessions 1–3) — Core portal

- Announcements, Policies, Training, KB, In-app Reader, BookStack API, credential hygiene

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

1. **OpenProject** — deploy at `/projects` (docker-compose at `~/openproject/`)
2. **Mobile reader navigation** — drawer/bottom sheet
3. **LDAP/SSO auth** — Phase 2
4. **API token server-side proxy** — Phase 2
