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

## Last Session --- 2026-06-08 (Task Manager Integration)

**What was done:**
- DNS A record added: `tasks.treppides.com` -> `192.168.0.221`
- Nginx: new server block for `tasks.treppides.com` proxying all traffic to localhost:8080
- Nginx: hub server block updated with `/projects/*` (prefix-stripping proxy to TM), `/oauth2/*`, and `/login/oauth2/*` proxy paths
- Auth flow wired: `auth.js` checks `/projects/api/me` --- if 401, shows hub-branded login page
- `login.html` created: hub-branded login page that sends users directly to `/oauth2/authorization/azure` (proxied to Task Manager's Spring Boot OAuth2)
- Azure AD SSO callback handled via `/login/oauth2/code/azure` proxy path
- Spring Boot configured for auto-generated redirect-uri from request Host header (works for both `hub.treppides.com` and `tasks.treppides.com` without hardcoding)
- Task Manager fully accessible both via hub sidebar (`/projects`) and directly at `tasks.treppides.com`
- All documentation files updated to reflect current state

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
| 1 | BookStack port `127.0.0.1:6875` | High | Bind to localhost in `~/bookstack/docker-compose.yml` --- currently on 0.0.0.0, blocked by UFW but should be fixed |
| 2 | Active monitoring notifications | Medium | Email/Slack alerts when healthcheck fails --- currently log-only |
| 3 | Mobile reader navigation | Medium | Drawer/bottom sheet for the in-app BookStack reader |
| 4 | Task Manager email notifications | Medium | Configured (Office 365 SMTP) but untested in production |
| 5 | Server-side BookStack token proxy | Low | Removes token from browser; enables per-session rate limiting |

---

## Critical Rules

1. **Never `localhost` in frontend** --- always relative paths (`/api/...`). Nginx proxies.
2. **`config.js` is gitignored** --- only on server. Never commit.
3. **No build step** --- edit files, push, hard-refresh. Done.
4. **No CDN** --- vendor all JS libs under `vendor/`.
5. **BookStack token expires 15/08/2026** --- rotate in BookStack admin -> API Tokens.
6. **SSL cert expires 22/11/2026** --- renewal alerts run monthly.
7. **`media/` dirs gitignored** --- uploaded files live only on server, backed up daily.
8. **Never hardcode redirect-uri** --- Task Manager auto-generates from Host header. Hardcoding breaks hub vs direct access.
9. **TM backend changes need rebuild** --- `cd ~/taskmanager && ./mvnw package -DskipTests && sudo systemctl restart taskmanager`.
10. **Auth proxy paths are critical** --- `/projects/*`, `/oauth2/*`, `/login/oauth2/*` must all proxy to port 8080.
