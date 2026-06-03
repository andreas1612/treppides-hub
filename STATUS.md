# STATUS — Treppides Hub

**Last updated: 2026-06-03**
**Long-term capacity plan: [SESSION_15.md](SESSION_15.md)**

---

## Services

| Service | Status | How it runs | Notes |
|---|---|---|---|
| **Nginx** | Active | systemd | TLS 1.2+, HTTP/2, rate limits, security headers |
| **BookStack** | Active | Docker `bookstack` | |
| **MariaDB** | Active | Docker `bookstack_db` | |
| **ClickUp Fees + Upload API** | Active | systemd `clickup-fees` (port 8001) | 2 workers, 512 MB cap, sandboxed. AML fees + media upload (Company Finder moved to its own service) |
| **Valuation Reference API** | Active | systemd `valuation-api` (port 8002) | 2 workers, 384 MB cap, sandboxed, SQLite WAL |
| **Company Finder API** | Active | systemd `companies-api` (port 8003) | 2 workers, 384 MB cap, sandboxed, SQLite WAL. Master DB of all ClickUp tasks; 3-min incremental sync via cron |
| **UFW Firewall** | Active | ufw | Deny all except 22/80/443 |
| **fail2ban** | Active | systemd | SSH (5 tries/1hr) + nginx rate-limit jail |

---

## Hub Sections

| Section | Status | Source | Notes |
|---|---|---|---|
| Announcements | Live | BookStack book 58 | Social post feed, 10 posts, inline images/video |
| Knowledge Base | Live | BookStack shelf 57 | 12 dept books, dedicated full-page view |
| Policies & Procedures | Live | BookStack book 3 | Card feed |
| Training & Development | Live | BookStack book 59 | Card feed |
| Quick Links | Live | — | KB / Projects / IT Support |
| In-app Reader | Live | BookStack API | PDF preview, chapters, pushState routing |
| AML Dashboard | Live | ClickUp → FastAPI | 3 lists; per-list breakdown by status/rejection/disengagement reason |
| Fees Dashboard | Live | ClickUp → FastAPI | Chart, drilldown with reason badges, CSV export |
| Staff Directory | Live | /staff.json | Accordion, search, dept filter |
| Admin Panel | Live | BookStack API + upload API | PIN-protected, photo/video/YouTube media composer |
| IT Support Modal | Live | FormSubmit → email | → apieri@treppides.com |
| Search | Live | BookStack full-text | Topbar, 400ms debounce |
| Valuation Tool | Live | FastAPI + SQLite (Damodaran) | DCF builder; historical archive 2008-2026 with edition picker; country/industry/currency reference auto-fill; historical FX (2015-2025); draft auto-save + JSON export/import; PDF report |
| Group Dashboard | Live | ClickUp → FastAPI + SQLite | Sidebar "Group Dashboard" → AML-style landing with two views: **Search** (name/TID-XXXXX) and **All Companies** (sortable, paginated table; row opens that company's deals). Per-company **total Deal Value (fees)** (active vs rejected/lost; no-deal flagged `—`) + a **filtered grand-total** banner. Detail lists **deal tasks only**, with the **color-coded Service** field. **Multi-select advanced filters** (project year, service, assignee, department — apply on click-away) on both views; fee totals recompute to the filter. Space names prettified on display (`_CRM` dropped, `KT`→`K. Treppides`). Backed by master DB (`companies-api`, port 8003, ~9.8k tasks; indexed service/year/department columns) synced every 3 min via `date_updated_gt` (reconcile gated 15 min); manual Refresh. Instant SQL |
| Projects | Stub | — | "Under development" placeholder |

---

## HTTPS / SSL

| Item | Status | Notes |
|---|---|---|
| SSL certificate | Live | Sectigo wildcard `*.treppides.com` — valid until 22 Nov 2026 |
| TLS | 1.2+ only | TLS 1.0/1.1 dropped |
| HTTP/2 | Enabled | |
| Security headers | Live | HSTS, CSP, X-Frame, X-Content-Type, Permissions-Policy, X-XSS-Protection |
| OCSP stapling | Enabled | |
| Internal DNS | Live | `hub.treppides.com` → `192.168.0.221` resolves; HTTPS padlock confirmed |

---

## Server Hardening (deployed 2026-06-02)

| Component | Detail |
|---|---|
| Firewall | UFW — deny all incoming except 22/80/443 |
| fail2ban | SSH jail (5 tries/1hr ban) + nginx-limit-req jail (10 hits/10min ban) |
| Rate limits | API: 30 req/s, uploads: 5 req/min, per-IP connection limit — returns HTTP 429 |
| CORS | Restricted to `hub.treppides.com` + `192.168.0.221` (was `*`) |
| Error sanitization | ClickUp API errors logged server-side, generic message to client |
| Service sandbox | PrivateTmp, NoNewPrivileges, ProtectSystem=strict, memory/CPU caps |
| nginx | server_tokens off, gzip, worker_connections 2048, multi_accept |
| File permissions | Sensitive files (config.js, .env, SSL key) locked to 600 owner-only |
| System updates | Unattended-upgrades enabled; all packages patched 2026-06-02 |

---

## Backups & Monitoring

| What | Schedule | Details |
|---|---|---|
| Backup | Daily 2 AM | Configs, SQLite, MariaDB, media → `~/backups/hub/` (14-day retention) |
| Health check | Every 5 min | 9 checks: 4 services + 2 Docker containers + 3 HTTP endpoints |
| Renewal alert | Monthly (1st) | SSL cert + BookStack token expiry |

Logs: `/var/log/hub-health.log`, `/var/log/hub-health-alerts.log`, `/var/log/hub-backup.log`

**Limitation:** Monitoring writes to log files only — no email/Slack notifications.

Full ops details in **[SERVER-OPS.md](SERVER-OPS.md)**.

---

## Credentials & Expiry

| Item | Expires | Action |
|---|---|---|
| BookStack API token | **15/08/2026** | BookStack admin → My Account → API Tokens → rotate → update config.js |
| ClickUp API token | Never | Regenerate in ClickUp settings if revoked |
| SSL cert (*.treppides.com) | **22/11/2026** | Re-issue from Sectigo |
| Damodaran reference data | Annual (Jan) + optional July | `venv/bin/python update_damodaran.py && sudo systemctl restart valuation-api` |
| FX rates (year-end) | Annual (Jan) | `python fetch_exchange_rates.py --end <year>` |

---

## Known Issues

| # | Severity | Description |
|---|---|---|
| 1 | Low | Reader nav hidden on mobile — out of scope |
| 2 | Low | Sidebar Home always `.active` on first load — acceptable |
| 3 | Info | `--brand-green` CSS vars defined but unused — reserved |
| 4 | Medium | BookStack token plaintext in config.js — mitigated: gitignored, LAN-only |
| 5 | Low | Projects sidebar link → stub page only |
| 6 | Low | Valuation FX field silent when date falls back to nearest-prior row |
| 7 | Low | Croatian Kuna has no FX data after 2022 (currency retired) |
| 8 | Info | Perpetual Growth Rate is hardcoded 5.67% and not linked to Revenue Growth Override |
| 9 | Info | Source Excel "Country Risk Free Premium" reads ERP (col 5) not CRP (col 6) — hub is correct |
| 10 | Info | Pre-2024 editions have no Rates4 (currency risk-free) data — UI shows inline note |
| 11 | Low | Industry betas only backfilled to 2014 — pre-2014 archive uses different schema |
| 12 | Low | Switching editions doesn't clear stale dropdown selection |
| 13 | Info | Monitoring is log-only — no active notifications (email/Slack/push) |
| 14 | Medium | BookStack Docker port 6875 binds `0.0.0.0` — blocked by UFW but should be `127.0.0.1` |

---

## What Is NOT Done Yet

| Feature | Priority | Notes |
|---|---|---|
| BookStack port `127.0.0.1:6875` | High | Bind to localhost in `~/bookstack/docker-compose.yml` |
| OpenProject at `/projects` | High | `~/openproject/docker-compose.yml` already on server |
| Server-side BookStack token proxy | High | Removes token from browser; enables per-session rate limiting |
| Active notifications | Medium | Email/Slack alerts when healthcheck fails |
| Mobile reader navigation | Medium | Drawer/bottom sheet |
| LDAP/SSO auth | Medium | Unlocks per-user rate limiting + audit log |
| Video subsystem (HLS pipeline) | Planned | Phase B — depends on VM resize. See [SESSION_15.md](SESSION_15.md) |
