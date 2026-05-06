# PROJECT_BRIEF — Treppides Hub
> Paste this at the start of a new chat and say "continue the Treppides Hub project"

**Status: LIVE IN PRODUCTION — fully operational**
**Last session: 2026-05-06 (session 4)**
**Server: 192.168.0.221 (tech-srv) · User: tech-admin**

---

## Project

**Name:** Treppides Company Hub
**Owner:** Andreas Pieri
**Purpose:** Self-hosted internal employee portal replacing SharePoint. Staff land here daily. Pulls live content from BookStack (wiki/KB backend) and ClickUp (fees dashboard). LAN-only — no external exposure. No domain yet.

---

## What is live and working

| Feature | Status |
|---|---|
| Announcements feed (BookStack) | ✅ Live |
| Knowledge Base — department books grid | ✅ Live |
| In-app BookStack reader (PDF preview, chapters) | ✅ Live |
| Policies & Procedures feed | ✅ Live |
| Training & Development feed | ✅ Live |
| Quick links widget (KB, Projects, IT Support) | ✅ Live |
| New Client UBO Fees dashboard (ClickUp) | ✅ Live |
| Admin panel (PIN-protected, publish/delete/upload) | ✅ Live |
| IT Support ticket modal (FormSubmit) | ✅ Live |
| Live search (BookStack full-text) | ✅ Live |

---

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS — zero dependencies, no build step, ES modules
- **Backend (wiki):** BookStack (PHP/Laravel) in Docker, port 6875, proxied at `/docs/*`
- **Backend (fees):** FastAPI Python, systemd service, port 8001, proxied at `/api/clickup/*`
- **Web server:** Nginx on host, port 80
- **Database:** MariaDB in Docker (BookStack data)
- **Deployment:** `git push` → live immediately (nginx serves repo dir directly)
- **Vendor libs:** Chart.js + datalabels bundled in `/vendor/` (no CDN)

---

## Infrastructure

```
VM: 192.168.0.221 (tech-srv) — Ubuntu Server — 3 devs with SSH access

nginx (port 80)
  /               → ~/treppides-hub (this repo)
  /docs/*         → localhost:6875 (BookStack Docker)
  /api/clickup/*  → localhost:8001 (ClickUp Fees API systemd service)
```

**Services:**
- `sudo systemctl reload nginx`
- `sudo systemctl start|stop|restart clickup-fees`
- `cd ~/bookstack && sudo docker compose up -d`

**Fresh VM:** `bash ~/treppides-hub/SETUP.sh`

---

## Session Log

### 2026-05-06 (session 4) — Infrastructure fixes, fees dashboard operational

- BookStack API token expired → rotated. New token expires **15/08/2026**.
- ClickUp Fees API was never persistent — installed as systemd service (`clickup-fees.service`)
- `localhost` bug: `fees.js` was fetching `localhost:8001` which fails in all non-VM browsers → fixed to relative `/api/clickup/fees` via nginx proxy
- Chart.js was loading from CDN → bundled locally in `vendor/` (LAN browsers may have no internet)
- `SETUP.sh` written for full VM provisioning in one command

### 2026-04-07 (session 3) — Admin panel + IT Support modal

- `components/admin.js` — PIN-protected publisher; creates/deletes/uploads to BookStack
- `components/support.js` — IT Support ticket modal; FormSubmit → email
- `styles/modals.css` — shared modal styles
- `api/bookstack.js` — added `createPage`, `deletePage`, `uploadAttachment`

### 2026-04-07 (session 2.5) — Fees dashboard v3

- `components/fees.js` — full-page ClickUp fees dashboard: KPI cards, month tabs, per-UBO/per-company toggle, horizontal bar chart, drill-down table
- `api/clickup/server.py` — FastAPI backend; fetches all ClickUp tasks, flattens custom fields, 5-min cache
- `styles/fees.css` — all fees styles

### 2026-04-03 (session 2) — Credential hygiene

- `config.js` gitignored; `config.example.js` committed
- Hardcoded IPs removed from `reader.js`

### 2026-04-03 (session 1) — Reader + KB

- `components/knowledgebase.js`, `components/reader.js`, `styles/reader.css`
- Full in-app reader: breadcrumbs, chapters, pushState routing, PDF blob preview

---

## File Structure

```
treppides-hub/
├── index.html, main.js           Shell + entry point
├── config.js                     All config — GITIGNORED, never committed
├── config.example.js             Template — copy to config.js on new VM
├── SETUP.sh                      Full VM provisioning script
├── nginx-treppides-hub.conf      Nginx config (copy to /etc/nginx/sites-enabled/)
├── clickup-fees.service          systemd service (copy to /etc/systemd/system/)
├── components/                   All UI components (one file per section)
│   ├── fees.js                   UBO Fees dashboard
│   ├── reader.js                 In-app BookStack reader
│   ├── admin.js                  PIN-protected content admin
│   ├── support.js                IT Support ticket modal
│   └── [sidebar, topbar, announcements, knowledgebase, policies, training, quicklinks]
├── api/
│   ├── bookstack.js              11 BookStack API functions
│   ├── mock.js                   Dev mock data (USE_MOCK=false in production)
│   └── clickup/
│       ├── server.py             FastAPI fees backend
│       ├── .env                  ClickUp token + list ID (GITIGNORED)
│       └── venv/                 Python venv (GITIGNORED)
├── styles/                       [theme, base, layout, cards, reader, modals, fees]
└── vendor/                       chart.umd.min.js + chartjs-plugin-datalabels.min.js
```

---

## config.js Keys

| Key | Value / Notes |
|---|---|
| `BASE_URL` | `http://192.168.0.221/docs` |
| `API_TOKEN_ID` | BookStack token — expires 15/08/2026 |
| `API_TOKEN_SECRET` | In config.js on server |
| `DEPARTMENTS_SHELF_ID` | `57` |
| `ANNOUNCEMENTS_BOOK_ID` | `58` |
| `POLICIES_BOOK_ID` | `3` |
| `TRAINING_BOOK_ID` | `59` |
| `CLICKUP_FEES_API` | `/api/clickup/fees` (relative, nginx-proxied) |
| `ENV_LIVE` | `true` |
| `SEARCH_ENABLED` | `true` |
| `ADMIN_PIN` | Set on server |
| `SUPPORT_EMAIL` | `apieri@treppides.com` |

---

## Critical Rules for Developers

1. **Never use `localhost` in frontend code** — browsers on other LAN machines will hit their own localhost, not the VM. Use relative paths (`/api/...`) which nginx proxies correctly.
2. **config.js is gitignored** — it exists only on the server. Never commit it.
3. **No build step** — drop files in the repo, push, done. nginx serves directly.
4. **BookStack token expires** — check expiry date in config.js comments. Rotate in BookStack admin before it expires.
5. **Chart.js is in vendor/** — do not switch back to CDN. LAN browsers may have no internet.

---

## Next Features — Priority Order

1. **Treppides logo** — replace SVG globe in sidebar with real logo asset
2. **OpenProject** — deploy at `192.168.0.221/projects`; update `PROJECTS_URL`
3. **Mobile reader nav** — reader sidebar hidden on mobile, needs drawer/bottom sheet
4. **Active nav routing** — sidebar active class should reflect current section
5. **SSL / HTTPS** — Let's Encrypt once a domain is confirmed
6. **LDAP/SSO auth** — Phase 2 post-launch
7. **Credential migration** — server-side proxy so BookStack token never reaches browser
