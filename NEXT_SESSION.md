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
