# STATUS — Treppides Hub

**Last updated: 2026-05-12 (session 10)**
**→ Start every session from [NEXT_SESSION.md](NEXT_SESSION.md)**

---

## Services

| Service | Status | How it runs | Notes |
|---|---|---|---|
| **Nginx** | ✅ Running | systemd | `sudo systemctl reload nginx` after config changes |
| **BookStack** | ✅ Running | Docker `bookstack` | |
| **MariaDB** | ✅ Running | Docker `bookstack_db` | |
| **ClickUp Fees + Upload API** | ✅ Running | systemd `clickup-fees` (port 8001) | Serves AML data + media upload endpoints |

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
| `/media/` | `~/treppides-hub/media/` | Static uploaded files, 7d cache |
| `/projects` | `localhost:3000` | OpenProject (not deployed yet) |

---

## Credentials & Expiry

| Item | Expires | Action |
|---|---|---|
| BookStack API token | **15/08/2026** | BookStack admin → My Account → API Tokens → rotate → update config.js |
| ClickUp API token | Never | Regenerate in ClickUp settings if revoked |
| SSL cert (*.treppides.com) | **22/11/2026** | Re-issue from Sectigo |

---

## Known Issues

| # | Severity | Description |
|---|---|---|
| 1 | Low | Reader nav hidden on mobile — out of scope |
| 2 | Low | Sidebar Home always `.active` on first load — acceptable |
| 3 | Info | `--brand-green` CSS vars defined but unused — reserved |
| 4 | Medium | BookStack token plaintext in config.js — mitigated: gitignored, LAN-only |
| 5 | Low | Projects sidebar link → stub page only |

---

## What Is NOT Done Yet

| Feature | Priority | Notes |
|---|---|---|
| Internal DNS record | **Do this now** | Add A record `hub.treppides.com` → `192.168.0.221` on office DNS/router |
| OpenProject at `/projects` | High | `~/openproject/docker-compose.yml` already on server |
| Mobile reader navigation | Medium | Drawer/bottom sheet |
| LDAP/SSO auth | Low | Phase 2 |
| API token server-side proxy | Low | Phase 2 |
