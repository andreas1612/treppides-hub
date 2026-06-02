# Treppides Employee Hub

**Status: LIVE IN PRODUCTION**
**Server:** 192.168.0.221 (tech-srv) · Ubuntu 24.04.4 LTS
**Live URL:** https://hub.treppides.com
**Last updated:** 2026-06-02

Internal company portal replacing SharePoint. Staff land here daily for announcements, knowledge base, AML/fees dashboards, valuation tool, and IT support. LAN-only, self-hosted.

> **Long-term planning (200 users, 3-year horizon, VM sizing, video roadmap):**
> see **[SESSION_15.md](SESSION_15.md)** — the canonical capacity & architecture reference.

---

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS — zero dependencies, no build step, ES modules
- **Backend (wiki):** BookStack (PHP/Laravel) in Docker, port 6875, proxied at `/docs/*`
- **Backend (fees + uploads):** FastAPI Python, systemd `clickup-fees`, port 8001
- **Backend (valuation):** FastAPI Python, systemd `valuation-api`, port 8002
- **Static media:** Uploaded images/videos served at `/media/`
- **Web server:** Nginx — HTTPS, HTTP/2, rate limiting, security headers
- **Database:** MariaDB in Docker (BookStack), SQLite (valuation reference data)
- **Deployment:** `git push` → `git pull` on server → live immediately
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
| AML Dashboard | ClickUp → FastAPI | 3 lists (new/rejected/disengaged), per-list breakdown |
| Fees Dashboard | ClickUp → FastAPI | Chart, drilldown with badges, CSV export |
| Valuation Tool | FastAPI + SQLite | DCF builder, historical Damodaran archive 2008-2026, edition picker, FX rates, draft auto-save + JSON export/import, PDF report |
| Staff Directory | /staff.json | Accordion, search, dept filter |
| Admin Panel | BookStack API + upload API | PIN-protected, photo/video/YouTube media composer |
| IT Support Modal | FormSubmit → email | → apieri@treppides.com |
| Search | BookStack full-text | Topbar, 400ms debounce |
| Projects | — | Stub ("under development") |

---

## Services

| Service | Type | Port | Management |
|---|---|---|---|
| nginx | systemd | 80, 443 | `sudo systemctl reload nginx` |
| clickup-fees | systemd | 8001 (localhost) | `sudo systemctl restart clickup-fees` |
| valuation-api | systemd | 8002 (localhost) | `sudo systemctl restart valuation-api` |
| bookstack | Docker | 6875 (localhost) | `cd ~/bookstack && sudo docker compose restart` |
| bookstack_db | Docker (MariaDB) | 3306 (internal) | same docker-compose |

Both API services run with 2 workers, memory caps, CPU quotas, and a security sandbox (PrivateTmp, NoNewPrivileges, ProtectSystem=strict).

---

## Nginx Routing

```
https://hub.treppides.com
  /                → ~/treppides-hub (SPA, try_files → index.html)
  /docs/*          → localhost:6875 (BookStack)
  /api/clickup/*   → localhost:8001 (ClickUp Fees API)
  /api/upload/*    → localhost:8001 (Media uploads)
  /api/valuation/* → localhost:8002 (Valuation Reference API)
  /media/          → ~/treppides-hub/media/ (static uploaded files)
  http :80         → redirect → HTTPS
```

Rate limits: 30 req/s per IP on API, 5 req/min on uploads. Exceeding returns HTTP 429 and may trigger a fail2ban ban.

---

## Server Security (hardened 2026-06-02)

| Layer | Status |
|---|---|
| HTTPS | TLS 1.2+ only, HTTP/2, HSTS, strong ciphers, OCSP stapling |
| Security headers | CSP, X-Frame-Options, X-Content-Type-Options, Permissions-Policy |
| Firewall (UFW) | Active — only 22/80/443 open |
| fail2ban | SSH (5 tries → 1hr ban) + nginx rate-limit jail |
| CORS | Restricted to `hub.treppides.com` + `192.168.0.221` |
| Error responses | Sanitized — no internal details leak to clients |
| File permissions | Sensitive files (config.js, .env, SSL key) locked to 600 |
| System updates | Unattended-upgrades enabled; all packages patched 2026-06-02 |
| SQLite | WAL mode, busy timeout, connection pooling |

---

## File Structure

```
treppides-hub/
├── index.html, main.js
├── config.js                         GITIGNORED — only on server
├── config.example.js
├── staff.json
├── nginx-treppides-hub.conf          Nginx site config
├── clickup-fees.service              systemd unit — ClickUp API
├── valuation-api.service             systemd unit — Valuation API
├── SETUP.sh                          Idempotent server provisioning
├── backup.sh                         Daily backup (cron 2 AM)
├── healthcheck.sh                    Service health monitor (cron 5 min)
├── renewal-alert.sh                  Cert/token expiry checker (cron monthly)
├── SERVER-OPS.md                     Full ops reference
│
├── components/
│   ├── shell/    sidebar.js, topbar.js, admin.js, support.js
│   ├── pages/    aml.js, fees.js, knowledgebase.js, projects.js, reader.js, staff.js, valuation.js
│   └── widgets/  announcements.js, policies.js, training.js, quicklinks.js
│
├── api/
│   ├── bookstack.js                  All BookStack API calls
│   └── clickup/
│       ├── server.py                 FastAPI — fees data + media uploads
│       ├── .env                      ClickUp credentials (gitignored)
│       └── venv/                     Python virtualenv (gitignored)
│   └── valuation/
│       ├── main.py                   FastAPI — valuation reference data
│       ├── build_database.py         SQLAlchemy models + schema
│       ├── seed_database.py          Baseline data (Jan 2024 CSVs)
│       ├── backfill_damodaran.py     Historical archive 2008-2024
│       ├── update_damodaran.py       Append current edition
│       ├── fetch_exchange_rates.py   Year-end FX from Frankfurter/ECB
│       └── venv/                     Python virtualenv (gitignored)
│
├── styles/
│   ├── theme.css, base.css, layout.css, cards.css, modals.css
│   ├── pages/    aml.css, fees.css, knowledgebase.css, reader.css, staff.css, valuation.css
│   └── widgets/  announcements.css
│
├── utils/
│   ├── dom.js                        escapeHtml, renderSkeleton, renderError, renderEmpty
│   └── format.js                     formatDate, excerptFromHtml
│
├── media/                            Uploaded images + videos (gitignored)
│
└── vendor/                           Chart.js, jsPDF, html2canvas (bundled, no CDN)
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
# Hard-refresh browser (Ctrl+Shift+R) — no restart needed for frontend changes
# Restart service only if backend code changed:
sudo systemctl restart clickup-fees      # if server.py changed
sudo systemctl restart valuation-api     # if main.py changed
sudo systemctl reload nginx              # if nginx config changed
```

### Critical rules

1. **Never `localhost` in frontend** — use relative paths (`/api/...`). Nginx proxies everything.
2. **`config.js` is gitignored** — only on server. Never commit.
3. **No build step** — edit, push, hard-refresh. Done.
4. **No CDN** — vendor all JS libs under `vendor/`.
5. **`media/` is gitignored** — uploaded files live only on server, backed up daily.
6. **SSL private key** — `/etc/nginx/ssl/treppides.key`, chmod 600, never commit.

---

## Credentials & Expiry

| Item | Expires | Action |
|---|---|---|
| BookStack API token | **15/08/2026** | BookStack admin → My Account → API Tokens → rotate → update config.js |
| ClickUp API token | Never | Regenerate in ClickUp settings if revoked |
| SSL cert (*.treppides.com) | **22/11/2026** | Re-issue from Sectigo |
| Damodaran reference data | Annual (Jan) | `cd api/valuation && venv/bin/python update_damodaran.py && sudo systemctl restart valuation-api` |
| FX rates | Annual (Jan) | `python fetch_exchange_rates.py --end <year>` after year-end |

---

## Backups & Monitoring

Daily backups at 2 AM to `~/backups/hub/` (14-day retention). Health checks every 5 minutes. Renewal alerts monthly.

See **[SERVER-OPS.md](SERVER-OPS.md)** for the full ops reference — backup contents, restore procedures, monitoring details, firewall rules, fail2ban jails, and all file locations.

---

## Fresh VM Setup

```bash
sudo bash ~/treppides-hub/SETUP.sh
```

Handles: packages (fail2ban, UFW, sqlite3), firewall, fail2ban jails, nginx config, Python venvs, systemd services, backup/monitoring crons, smoke tests.

Manual steps after SETUP.sh:
1. Copy `config.example.js` → `config.js` and fill in all values
2. Copy `api/clickup/.env.example` → `api/clickup/.env` and fill in ClickUp credentials
3. Bootstrap valuation DB: `cd api/valuation && venv/bin/python seed_database.py && venv/bin/python backfill_damodaran.py && venv/bin/python update_damodaran.py`

---

## Troubleshooting

**Hub shows old content after a push:**
Hard-refresh the browser (`Ctrl+Shift+R`). No restart needed.

**All sections show "Could not reach the knowledge base":**
BookStack API token has expired. Rotate in BookStack admin → My Account → API Tokens → update `config.js`.

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

---

## Next Features

| Feature | Priority | Notes |
|---|---|---|
| OpenProject at `/projects` | High | `~/openproject/docker-compose.yml` already on server |
| Active monitoring notifications | Medium | Email/Slack alerts when healthcheck fails |
| Mobile reader navigation | Medium | Drawer/bottom sheet |
| LDAP/SSO auth | Low | Phase 2 |
| API token server-side proxy | Low | Phase 2 |

---

*K.Treppides & Co · Built by Andreas Pieri · Vanilla HTML/CSS/JS · Zero dependencies*
