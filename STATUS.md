# STATUS — Treppides Hub

**Last updated: 2026-05-11 (session 6)**
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
| AML Dashboard | ✅ Live | ClickUp → FastAPI | 3 lists (new/rejected/disengaged), chart + drilldown |
| New Client UBO Fees | ✅ Live | ClickUp → FastAPI | 5 months data, per-year aggregate tabs, CSV export |
| Staff Directory | ✅ Live | /staff.json | Accordion, Nicosia/Limassol filter, name search |
| Admin Panel | ✅ Live | BookStack API | PIN-protected, publish/delete/upload |
| IT Support Modal | ✅ Live | FormSubmit → email | Forwards to apieri@treppides.com |
| Search | ✅ Live | BookStack full-text | Topbar, 400ms debounce |

---

## HTTPS / SSL Status

| Item | Status | Notes |
|---|---|---|
| SSL certificate | ✅ Received | Sectigo wildcard `*.treppides.com` — in `TREPPIDES.zip` on laptop |
| Cert chain built | ⏳ Pending | See NEXT_SESSION.md — scp certs → server, build chain |
| nginx HTTPS config | ✅ Written | `nginx-treppides-hub.conf` updated — deploy once certs are on server |
| Internal DNS record | ⏳ Pending | `hub.treppides.com` → `192.168.0.221` — add to office DNS/router |
| config.js BASE_URL | ⏳ Pending | Update to `https://hub.treppides.com/docs` after DNS is live |

---

## Credentials & Expiry

| Item | Value | Expires | Action when expired |
|---|---|---|---|
| BookStack API token | `th0aMsvxEBeW86m52FuLs20hYfiBZB6e` | **15/08/2026** | BookStack admin → My Account → API Tokens → rotate → update config.js |
| ClickUp API token | `pk_93846472_...` (in `api/clickup/.env`) | Never | Regenerate in ClickUp settings if revoked |
| SSL cert (*.treppides.com) | Sectigo wildcard | **Check cert — typically 1 year from issue** | Re-issue from Sectigo with same CSR or new CSR |

---

## Nginx Routing (post-HTTPS)

| Path | Proxied to | Notes |
|---|---|---|
| `http://*` (port 80) | Redirect → HTTPS | All HTTP auto-redirects to https://hub.treppides.com |
| `https://hub.treppides.com/` | `~/treppides-hub` (files) | SPA — `try_files` → index.html |
| `https://hub.treppides.com/docs/*` | `localhost:6875` | BookStack Docker |
| `https://hub.treppides.com/api/clickup/*` | `localhost:8001` | ClickUp Fees API |
| `https://hub.treppides.com/projects` | `localhost:3000` | OpenProject (not yet deployed) |

Config file: `/etc/nginx/sites-enabled/treppides-hub`
Repo copy: `nginx-treppides-hub.conf` — edit this, then `sudo cp` and `sudo systemctl reload nginx`

---

## SSL Certificates on Server (after install)

| File | Path | Notes |
|---|---|---|
| Certificate chain | `/etc/nginx/ssl/treppides_chain.crt` | STAR cert + 3 Sectigo intermediates, in order |
| Private key | `/etc/nginx/ssl/treppides.key` | `chmod 600`, owned by root — never copy elsewhere |

---

## Known Issues

| # | Severity | Description | Fix |
|---|---|---|---|
| 1 | Low | Reader nav hidden on mobile — no mobile support planned | N/A |
| 2 | Low | Sidebar Home always `.active` — never updates | Acceptable for now |
| 3 | Info | `--brand-green` CSS vars defined but unused | Reserved for future |
| 4 | Medium | BookStack token plaintext in config.js | Mitigated: gitignored, read-only, LAN-only |
| 5 | Low | Projects link goes nowhere | Blocked on OpenProject deployment |

---

## What Is NOT Done Yet

| Feature | Priority | Blocked on |
|---|---|---|
| HTTPS live on server | **Critical** | Cert install + internal DNS record |
| Real Treppides logo in sidebar | High | Logo asset — check GitHub gallery (2 latest additions) |
| OpenProject at `/projects` | High | Docker setup on VM |
| Mobile reader navigation | Medium | Dev time |
| LDAP / SSO auth | Low | Phase 2 post-launch |
| API token server-side proxy | Low | Phase 2 — low risk on LAN |
