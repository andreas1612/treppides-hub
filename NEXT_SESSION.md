# NEXT SESSION — Start Here

> **Read this first, then follow links for deeper context.**

---

## Quick Orient

| What | Where |
|---|---|
| Full project context + tech stack | [PROJECT_BRIEF.md](PROJECT_BRIEF.md) |
| Current live status of all services | [STATUS.md](STATUS.md) |
| Server ops (backups, monitoring, firewall, crons) | [SERVER-OPS.md](SERVER-OPS.md) |
| Full VM provisioning | `sudo bash SETUP.sh` |

**Server:** `192.168.0.221` · Claude runs directly on the server — no SSH needed
**Live URL:** https://hub.treppides.com
**Repo:** `~/treppides-hub` (git, origin = github.com:andreas1612/treppides-hub)

---

## Last Session — 2026-06-02 (Backend Hardening)

**What was done:**
- `/etc/nginx/nginx.conf` hardened: gzip, server_tokens off, worker_connections 2048, TLS 1.2+ only, rate limit zones (api/upload/addr)
- `api/clickup/server.py`: CORS restricted to hub origin, error responses sanitized
- `api/valuation/main.py`: SQLite WAL mode + connection pooling
- Both `.service` files rewritten: 2 workers, memory/CPU caps, security sandbox
- `nginx-treppides-hub.conf`: `aio on` removed (unsupported on this platform)
- New scripts: `backup.sh`, `healthcheck.sh`, `renewal-alert.sh`
- `SETUP.sh` rewritten: idempotent, installs fail2ban + UFW + crons + services
- UFW firewall active (22/80/443 only)
- fail2ban active (SSH + nginx rate-limit jails)
- All services verified active, all health endpoints returning 200

---

## Session 15 — Live Server Assessment + Long-Term Capacity Plan (2026-05-29)

**Scope:** Documentation + planning only. No code changes, no server changes. Read-only SSH against `tech-admin@192.168.0.221`.

**What was done:**
- Live SSH audit of `tech-srv`: 4 vCPU (AMD EPYC 7F72), 9.5 GiB RAM (980 MiB used), 72 GB root disk (15% used), load ~0.00
- Confirmed BookStack on `0.0.0.0:6875` — bypasses nginx TLS (severity: High). Fix: bind to `127.0.0.1:6875`
- Both FastAPI services correctly on `127.0.0.1` only (good)
- No backups, no crontab, no monitoring — all flagged as Phase A blockers
- nginx at Ubuntu defaults (worker_connections 768, no gzip_types, no rate limits)
- **Recommended target spec (≤24 months):** 8 vCPU / 16 GB RAM / 250 GB root + 1 TB SSD for video
- **Architecture recommendation:** start with Option 1 (single VM vertically scaled), document migration to Option 2 (hub-srv + media-srv) but don't execute until trigger conditions fire
- Designed layered rate-limiting (per-session + per-IP backstop + global transcode ceiling)
- Full details: [SESSION_15.md was here] — key sections: live snapshot (§2), optimal resources (§3), architecture options (§4), rate limiting (§5), operational gaps (§6-7)

---

## Session 16 — Company Finder + Company Master Database (2026-06-02/03)

**Status:** Built, verified, cleaned up. Committed (b0594e1). Deploy to server pending.

**What was built:**
- New **Company Finder** dashboard: search by company name or `TID-XXXXX`, see total Deal Value (fees) across all 10 ClickUp CRM spaces
- New service: **`companies-api`** (port 8003) — FastAPI + SQLite WAL, lives in `api/companies/`
- DB: 9,779 tasks / 4,515 companies / 10 spaces synced from ClickUp
- Incremental sync every 3 min (~12s), full reconcile gated to every 15 min
- Frontend: `components/pages/companies.js` + `styles/pages/companies.css`

**Day 2 fixes:**
- Lost-status config changed: `COMPANIES_LOST_STATUSES` = `rejected,approved terminated` (was `rejected,on hold - stall`)
- Fixed SQLite param cap bug (chunked upserts for large spaces like KT_CRM with 6,874 rows)
- Fixed sync concurrency bug (RLock for re-entrant locking)
- Visual: deal value shown inline in search results, no-deal companies flagged

**Cleanup done:** v1 in-memory company code removed from `api/clickup/server.py`

**Deploy steps (not yet done):**
- `git pull` on server → `cd ~/treppides-hub/api/companies` → create venv, pip install, create `.env` with `CLICKUP_API_TOKEN` + `CLICKUP_SPACE_IDS`
- Initial build: `python sync.py --full` (~2-3 min)
- Install service: `sudo cp companies-api.service /etc/systemd/system/ && sudo systemctl enable --now companies-api`
- Reload nginx (config already has `/api/companies/*` proxy)
- Add cron: `*/3 * * * * curl -s http://127.0.0.1:8003/api/companies/sync >/dev/null`
- Or run `bash SETUP.sh` which does venv+service+cron+build automatically

**Key decisions (settled):** own service on 8003 ✓ · EUR ✓ · Deal Value only (not Fees field) ✓ · active vs lost split ✓ · 3-min sync + 15-min reconcile ✓ · detail shows deals only ✓

**Reference docs:** `COMPANY_DB_DESIGN.md` (feasibility/design), `api/companies/OUTLINE.md` (build & ops guide)

---

## Priority 1 — Internal DNS Record (5-minute task)

Add an A record to the **office router / Active Directory DNS**:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `hub.treppides.com` | `192.168.0.221` | 300 |

Once added: any LAN browser hitting `https://hub.treppides.com` gets the padlock.

---

## Priority 2 — OpenProject Deployment

Deploy OpenProject at `https://hub.treppides.com/projects`.

```bash
cd ~/openproject && sudo docker compose up -d
sudo systemctl reload nginx   # nginx config already has the /projects proxy block
```

---

## Priority 3 — Active Monitoring Notifications

Healthcheck currently writes to log files only. Options:
- Email alerts via `msmtp` / `sendmail`
- Telegram bot
- Webhook to internal system

---

## Service Health Check

```bash
# Quick status
systemctl is-active nginx clickup-fees valuation-api docker

# Health endpoints
curl -s http://127.0.0.1:8001/health
curl -s http://127.0.0.1:8002/api/valuation/health

# Recent health log
tail -5 /var/log/hub-health.log

# Firewall + fail2ban
sudo ufw status
sudo fail2ban-client status
```

---

## Critical Rules

1. **Never `localhost` in frontend** — always relative paths (`/api/...`). Nginx proxies.
2. **`config.js` is gitignored** — only on server. Never commit.
3. **No build step** — edit files, push, hard-refresh. Done.
4. **No CDN** — vendor all JS libs under `vendor/`.
5. **BookStack token expires 15/08/2026** — rotate in BookStack admin → API Tokens.
6. **SSL cert expires 22/11/2026** — renewal alerts run monthly.
7. **`media/` dirs gitignored** — uploaded files live only on server, backed up daily.
