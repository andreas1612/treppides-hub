# STATUS — Treppides Hub

**Last updated: 2026-05-29 (session 15)**
**→ Start every session from [NEXT_SESSION.md](NEXT_SESSION.md)**
**→ Live capacity & long-term plan: [SESSION_15.md](SESSION_15.md)**

---

## Server Resources (live, 2026-05-29)

| Resource | Current | Target (≤ 24 months) | Notes |
|---|---|---|---|
| CPU | 4 vCPU AMD EPYC 7F72 | **8 vCPU** | Load avg 0.06; transcoder is the only future contention |
| RAM | 9.5 GiB (8.6 GiB available) | **16 GiB** | Reserves for OpenProject + FFmpeg worker |
| Root disk | 72 GB (9.7 GB used, 15 %) | **250 GB** | Plus a dedicated **1 TB SSD** for `/srv/media` |
| Swap | 4 GiB (0 used) | unchanged | |
| Uptime | 65 days at snapshot | — | All services stable |

Full sizing rationale, architecture options (1 VM vs 2 VM vs 3 VM) and
rate-limiting design are in **[SESSION_15.md](SESSION_15.md)** — that
is the canonical long-term plan reference. Planning target: **200 total
staff, ~60–80 concurrent at peak, 3-year horizon**.

---

## Services

| Service | Status | How it runs | Notes |
|---|---|---|---|
| **Nginx** | ✅ Running | systemd | `sudo systemctl reload nginx` after config changes |
| **BookStack** | ✅ Running | Docker `bookstack` | |
| **MariaDB** | ✅ Running | Docker `bookstack_db` | |
| **ClickUp Fees + Upload API** | ✅ Running | systemd `clickup-fees` (port 8001) | Serves AML data + media upload endpoints |
| **Valuation Reference API** | ✅ Running | systemd `valuation-api` (port 8002) | Damodaran + tax + FX reference data for the valuation tool |

---

## Hub Sections

| Section | Status | Source | Notes |
|---|---|---|---|
| Announcements | ✅ Live | BookStack book 58 | Social post feed, 10 posts, inline images/video |
| Knowledge Base | ✅ Live | BookStack shelf 57 | 12 dept books, dedicated full-page view |
| Policies & Procedures | ✅ Live | BookStack book 3 | Card feed |
| Training & Development | ✅ Live | BookStack book 59 | Card feed |
| Quick Links | ✅ Live | — | KB / Projects / IT Support |
| In-app Reader | ✅ Live | BookStack API | PDF preview, chapters, pushState routing |
| AML Dashboard | ✅ Live | ClickUp → FastAPI | 3 lists; each breaks fees down by its own field (status / rejection reason / disengagement reason) |
| Fees Dashboard | ✅ Live | ClickUp → FastAPI | Chart, drilldown with reason badges, CSV export |
| Staff Directory | ✅ Live | /staff.json | Accordion, search, dept filter |
| Admin Panel | ✅ Live | BookStack API + upload API | PIN-protected, photo/video/YouTube media composer |
| IT Support Modal | ✅ Live | FormSubmit → email | → apieri@treppides.com |
| Search | ✅ Live | BookStack full-text | Topbar, 400ms debounce |
| Valuation Tool | ✅ Live | FastAPI + SQLite (Damodaran) | DCF builder; **historical Damodaran archive 2008-2026** with edition picker; country/industry/currency reference auto-fill; historical FX (2015–2025 year-end, 43 ccys); continent-average fallback; **draft auto-save + JSON export/import** (audit-trail snapshot); PDF report |
| Projects | ⏳ Stub | — | "Under development" placeholder |

---

## HTTPS / SSL

| Item | Status | Notes |
|---|---|---|
| SSL certificate | ✅ Live | Sectigo wildcard `*.treppides.com` — valid until 22 Nov 2026 |
| Cert chain | ✅ Live | `/etc/nginx/ssl/treppides_chain.crt` |
| nginx HTTPS config | ✅ Live | Deployed at `/etc/nginx/sites-enabled/treppides-hub` |
| Internal DNS | ✅ Live | `hub.treppides.com` → `192.168.0.221` resolves correctly; HTTPS padlock confirmed in browsers |
| config.js BASE_URL | ✅ Done | `https://hub.treppides.com/docs` |

---

## Nginx Routing

| Path | Target | Notes |
|---|---|---|
| `http://*` (port 80) | → HTTPS redirect | |
| `/` | `~/treppides-hub` | SPA, try_files |
| `/docs/*` | `localhost:6875` | BookStack Docker |
| `/api/clickup/*` | `localhost:8001` | FastAPI fees data |
| `/api/upload/*` | `localhost:8001` | FastAPI media upload |
| `/api/valuation/*` | `localhost:8002` | FastAPI valuation reference data |
| `/media/` | `~/treppides-hub/media/` | Static uploaded files, 7d cache |
| `/projects` | `localhost:3000` | OpenProject (not deployed yet) |

---

## Credentials & Expiry

| Item | Expires | Action |
|---|---|---|
| BookStack API token | **15/08/2026** | BookStack admin → My Account → API Tokens → rotate → update config.js |
| ClickUp API token | Never | Regenerate in ClickUp settings if revoked |
| SSL cert (*.treppides.com) | **22/11/2026** | Re-issue from Sectigo |
| Damodaran reference data | Annual (Jan) + optional July | `cd ~/treppides-hub/api/valuation && venv/bin/python update_damodaran.py && sudo systemctl restart valuation-api` — appends a new edition, does not wipe history |
| FX rates (year-end) | Annual (Jan) | Run `python fetch_exchange_rates.py --end <year>` after year-end |

---

## Known Issues

| # | Severity | Description |
|---|---|---|
| 1 | Low | Reader nav hidden on mobile — out of scope |
| 2 | Low | Sidebar Home always `.active` on first load — acceptable |
| 3 | Info | `--brand-green` CSS vars defined but unused — reserved |
| 4 | Medium | BookStack token plaintext in config.js — mitigated: gitignored, LAN-only |
| 5 | Low | Projects sidebar link → stub page only |
| 6 | Low | Valuation FX field silent when date falls back to nearest-prior row (no UI hint) |
| 7 | Low | Croatian Kuna has no FX data after 2022 (currency retired) — no UI message |
| 8 | Info | Perpetual Growth Rate is hardcoded 5.67% and not linked to Revenue Growth Override — design parked for next session |
| 9 | Info | Source Excel workbook's "Country Risk Free Premium" cell reads col 5 of Damodaran Rates2 = ERP (mislabel); hub correctly reads col 6 = CRP. Side-by-side QA against the workbook will show that single cell disagreeing — hub is right. |
| 10 | Info | Pre-2024 editions have no Rates4 (currency risk-free) data — Damodaran didn't archive it. UI surfaces an inline note when this happens; auditor enters the risk-free rate manually. |
| 11 | Low | Industry betas (Rates1) only backfilled to 2014 — pre-2014 archive is US-only with a different schema. Selecting a 2008-2013 edition leaves industry-driven fields empty. |
| 12 | Low | Switching editions doesn't clear the currently-selected country/industry/currency, even if the chosen edition has fewer entries. Dropdowns reload but the stale selection remains visible. |

---

## What Is NOT Done Yet

### Operational (confirmed live 2026-05-29 — must land before firm-wide launch)

| Item | Priority | Notes |
|---|---|---|
| Off-box backups | **High** | No crontab, no `~/backups/`. Nightly tar+rsync of BookStack DB, `media/`, `valuation_reference.db`, nginx/systemd configs. See [SESSION_15.md §6.2](SESSION_15.md) |
| Monitoring (Netdata) | **High** | Currently blind beyond `systemctl status`. Install + UI restricted to IT subnet via ufw |
| BookStack port `0.0.0.0:6875` | **High** | LAN-reachable bypassing nginx TLS. Bind to `127.0.0.1:6875` in `~/bookstack/docker-compose.yml` |
| nginx `worker_connections=768` | Medium | Raise to 4096. Currently Ubuntu default |
| nginx `gzip_types` empty | Medium | gzip is on but no types declared — no actual compression of CSS/JS/JSON |
| Layered rate limiting | Medium | No `limit_req_zone` configured. Design in [SESSION_15.md §5](SESSION_15.md) |
| Kernel `vm.swappiness=60`, `tcp_fin_timeout=60` | Low | Defaults; tune to 10 / 15 |
| ADMIN_PIN strength | **High** | Rotate from any default; document the rotation cadence |

### Features (longer horizon)

| Feature | Priority | Notes |
|---|---|---|
| OpenProject at `/projects` | High | `~/openproject/docker-compose.yml` already on server |
| Server-side BookStack token proxy | High | Removes token from browser; enables real PIN auth + per-session rate limiting |
| Mobile reader navigation | Medium | Drawer/bottom sheet |
| LDAP/SSO auth | Medium | Unlocks per-user rate limiting + audit log |
| Video subsystem (HLS pipeline) | Planned | Phase B — depends on VM resize to 8 vCPU / 16 GB / 1 TB |
| `media-srv` VM split | Future | Only when video viewership > 100 concurrent. See [SESSION_15.md §4.2](SESSION_15.md) |
