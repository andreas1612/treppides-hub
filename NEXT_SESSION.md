# NEXT SESSION --- Start Here

> **Read this first, then follow links for deeper context.**

---

## Quick Orient

| What | Where |
|---|---|
| Full project context + tech stack | [PROJECT_BRIEF.md](PROJECT_BRIEF.md) |
| Current live status of all services | [STATUS.md](STATUS.md) |
| Server ops (backups, monitoring, firewall, crons) | [SERVER-OPS.md](SERVER-OPS.md) |
| Full VM provisioning | `sudo bash SETUP.sh` |

**Server:** `192.168.0.221` - Claude runs directly on the server --- no SSH needed
**Live URLs:** https://hub.treppides.com | https://tasks.treppides.com
**Repo:** `~/treppides-hub` (git, origin = github.com:andreas1612/treppides-hub)

---

## Deploy status

Latest commit (`6202295`, 2026-06-09) is **fully deployed** — Dashboard TID `--full`
re-sync run, `companies-api` + `clickup-fees` restarted, frontend hard-refreshed.
No deploy steps pending.

---

## Last Session --- 2026-06-09 (Dashboard TID chart grouping + security fixes + BookStack)

**What was done:**
- **Chart 'by company' now groups on `Dashboard TID` (GID)** — a new ClickUp custom field
  on the Deals lists that rolls several companies into one dashboard group. List / search /
  detail / UBO views still key on `Clickup_TID`; only the chart's company mode groups on GID.
- **companies-api**: added indexed `dashboard_tid` column (`build_database.py`), extracted it
  in `sync.py normalize()`, and grouped active Deal Value by GID in `main.py`
  (`filtered_group_rows`). Raised the `/chart` `top` cap to 2000 so the picker lists all groups.
- **Supername labels** — each grouped bar is labelled with a synthesized name: the longest
  common leading words across the group's member company names (e.g. "Capital Com", "Nuvei"),
  falling back to a representative company name, then the GID. (`_supername` in `main.py`.)
- **Chart picker** (`components/pages/companies.js`) repointed to `/chart?by=company` so its
  select values are GID keys that match the chart's `select=` param.
- **Security audit fixes (carried from 2026-06-05)** — `api/clickup/server.py` +
  `components/pages/valuation.js`: ClickUp fetch connect/read timeouts + error handling (H1);
  removed API-payload `console.log`s (H2); media-upload hardening — None-filename guard,
  magic-byte sniff, safe uuid name (M1); custom-field key-collision logging (M2); frontend
  error logs message-only (M3).
- **BookStack APP_URL fixed:** Changed `APP_URL` from `http://` to `https://hub.treppides.com/docs` — was causing mixed-content blocking.
- **config.js BASE_URL made relative:** Changed to `/docs` — eliminates cross-origin CSP blocks.
- **Reader overlay visibility fix:** `showOverlay()` removes page-active CSS classes before displaying.
- **Reader image rewrite fix:** Uses `src.includes("/docs/")` instead of `startsWith(CONFIG.BASE_URL)`.
- **CSP frame-src blob: added:** Fixes PDF preview iframe blocking.

---

## Earlier Session --- 2026-06-08 (Task Manager Integration)

**What was done:**
- **BookStack APP_URL fixed:** Changed `APP_URL` in `~/bookstack/docker-compose.yml` from `http://192.168.0.221/docs` to `https://hub.treppides.com/docs` --- was causing mixed-content blocking (all BookStack assets loaded over HTTP when page served via HTTPS). Container recreated.
- **config.js BASE_URL made relative:** Changed from absolute `https://hub.treppides.com/docs` to `/docs` --- eliminates cross-origin CSP blocks when users access hub via IP instead of domain. Updated `config.example.js` to match.
- **Reader overlay visibility fix:** `showOverlay()` in `reader.js` now removes page-active CSS classes (`kb-active`, `staff-active`, etc.) before displaying --- fixes bug where reader was invisible when opened from Knowledge Base page due to `.main.kb-active .reader-overlay { display: none !important }`.
- **Reader image rewrite fix:** Image src rewrite changed from `src.startsWith(CONFIG.BASE_URL)` to `src.includes("/docs/")` --- handles BookStack absolute image URLs correctly with relative BASE_URL.
- **CSP frame-src blob: added:** Added `blob:` to `frame-src` in nginx CSP header --- fixes "This content is blocked" error on PDF preview iframes.
- **BookStack port already secure:** Confirmed `127.0.0.1:6875:80` in docker-compose.yml --- issue #14 was already resolved.

---

## Service Health Check

```bash
# Quick status --- all services
systemctl is-active nginx clickup-fees valuation-api companies-api taskmanager docker

# Health endpoints
curl -s http://127.0.0.1:8001/health                    # ClickUp Fees API
curl -s http://127.0.0.1:8002/api/valuation/health       # Valuation API
curl -s http://127.0.0.1:8003/api/companies/health        # Company Finder API
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/   # Task Manager (expect 302)

# HTTPS endpoints
curl -sk -o /dev/null -w "%{http_code}" https://hub.treppides.com/        # Hub (expect 200)
curl -sk -o /dev/null -w "%{http_code}" https://tasks.treppides.com/      # Task Manager (expect 302)

# Auth check
curl -sk -o /dev/null -w "%{http_code}" https://hub.treppides.com/projects/api/me  # expect 401 if not authenticated

# Recent health log
tail -5 /var/log/hub-health.log

# Firewall + fail2ban
sudo ufw status
sudo fail2ban-client status
```

---

## Priorities

| # | Feature | Priority | Notes |
|---|---|---|---|
| 1 | Active monitoring notifications | Medium | Email/Slack alerts when healthcheck fails --- currently log-only |
| 2 | Mobile reader navigation | Medium | Drawer/bottom sheet for the in-app BookStack reader |
| 3 | Task Manager email notifications | Medium | Configured (Office 365 SMTP) but untested in production |
| 4 | Server-side BookStack token proxy | Low | Removes token from browser; enables per-session rate limiting |

---

## Critical Rules

1. **Never absolute URLs in frontend** --- always relative paths (`/api/...`, `/docs`). Nginx proxies. Absolute URLs break when users access via IP instead of domain (CSP cross-origin block).
2. **`config.js` is gitignored** --- only on server. Never commit.
3. **No build step** --- edit files, push, hard-refresh. Done.
4. **No CDN** --- vendor all JS libs under `vendor/`.
5. **BookStack token expires 15/08/2026** --- rotate in BookStack admin -> API Tokens.
6. **SSL cert expires 22/11/2026** --- renewal alerts run monthly.
7. **`media/` dirs gitignored** --- uploaded files live only on server, backed up daily.
8. **Never hardcode redirect-uri** --- Task Manager auto-generates from Host header. Hardcoding breaks hub vs direct access.
9. **TM backend changes need rebuild** --- `cd ~/taskmanager && ./mvnw package -DskipTests && sudo systemctl restart taskmanager`.
10. **Auth proxy paths are critical** --- `/projects/*`, `/oauth2/*`, `/login/oauth2/*` must all proxy to port 8080.
