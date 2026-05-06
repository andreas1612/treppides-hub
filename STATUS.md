# STATUS — Treppides Hub

**Last updated: 2026-05-06 (session 4)**
**→ Start every session from [NEXT_SESSION.md](NEXT_SESSION.md)**

---

## Services

| Service | Status | How it runs | Notes |
|---|---|---|---|
| **Nginx** | ✅ Running | systemd | `sudo systemctl reload nginx` after config changes |
| **BookStack** | ✅ Running | Docker `bookstack` | Up 5+ weeks |
| **MariaDB** | ✅ Running | Docker `bookstack_db` | Up 5+ weeks |
| **ClickUp Fees API** | ✅ Running | systemd `clickup-fees` | Installed session 4 — survives reboots |

---

## Hub Sections

| Section | Status | Source | Notes |
|---|---|---|---|
| Announcements | ✅ Live | BookStack book 58 | Shows last 5 pages |
| Knowledge Base | ✅ Live | BookStack shelf 57 | All 12 dept books |
| Policies & Procedures | ✅ Live | BookStack book 3 | Shows last 3 pages |
| Training & Development | ✅ Live | BookStack book 59 | Shows last 3 pages |
| Quick Links | ✅ Live | — | KB + Projects (placeholder) + IT Support |
| In-app Reader | ✅ Live | BookStack API | PDF preview, chapters, pushState routing |
| New Client UBO Fees | ✅ Live | ClickUp → FastAPI | 5 months data, chart + drilldown |
| Admin Panel | ✅ Live | BookStack API | PIN-protected, publish/delete/upload |
| IT Support Modal | ✅ Live | FormSubmit → email | Forwards to apieri@treppides.com |
| Search | ✅ Live | BookStack full-text | Topbar, 400ms debounce |

---

## Credentials & Expiry

| Item | Value | Expires | Action when expired |
|---|---|---|---|
| BookStack API token | `th0aMsvxEBeW86m52FuLs20hYfiBZB6e` | **15/08/2026** | BookStack admin → My Account → API Tokens → rotate → update config.js |
| ClickUp API token | `pk_93846472_...` (in `api/clickup/.env`) | Never | Regenerate in ClickUp settings if revoked |

---

## Nginx Routing

| Path | Proxied to | Notes |
|---|---|---|
| `/` | `~/treppides-hub` (files) | SPA — `try_files` → index.html |
| `/docs/*` | `localhost:6875` | BookStack Docker |
| `/api/clickup/*` | `localhost:8001` | ClickUp Fees API (added session 4) |

Config file: `/etc/nginx/sites-enabled/treppides-hub`
Repo copy: `nginx-treppides-hub.conf` — edit this, then `sudo cp` and `sudo systemctl reload nginx`

---

## Known Issues

| # | Severity | Description | Fix |
|---|---|---|---|
| 1 | Low | Reader nav hidden on mobile — no mobile support planned for this portal | N/A |
| 2 | Low | Sidebar Home always `.active` — never updates | Acceptable for now |
| 3 | Info | `--brand-green` CSS vars defined but unused | Reserved for future |
| 4 | Medium | BookStack token plaintext in config.js | Mitigated: gitignored, read-only, LAN-only |
| 5 | Low | Projects link goes nowhere | Blocked on OpenProject deployment |

---

## What Is NOT Done Yet

| Feature | Priority | Blocked on |
|---|---|---|
| Real Treppides logo in sidebar | High | Logo asset from client |
| OpenProject at `/projects` | High | Docker setup on VM |
| Mobile reader navigation | Medium | Dev time |
| HTTPS / SSL | Low | Domain name decision |
| LDAP / SSO auth | Low | Phase 2 post-launch |
| API token server-side proxy | Low | Phase 2 — low risk on LAN |
