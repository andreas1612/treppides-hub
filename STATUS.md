# STATUS — Treppides Hub

**Last updated: 2026-05-25 (session 14)**
**→ Start every session from [NEXT_SESSION.md](NEXT_SESSION.md)**

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
| Internal DNS | ⏳ Pending | Add A record: `hub.treppides.com` → `192.168.0.221` on office DNS/router |
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

| Feature | Priority | Notes |
|---|---|---|
| Internal DNS record | **Do this now** | Add A record `hub.treppides.com` → `192.168.0.221` on office DNS/router |
| OpenProject at `/projects` | High | `~/openproject/docker-compose.yml` already on server |
| Mobile reader navigation | Medium | Drawer/bottom sheet |
| LDAP/SSO auth | Low | Phase 2 |
| API token server-side proxy | Low | Phase 2 |
