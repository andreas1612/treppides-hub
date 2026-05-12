# NEXT SESSION — Start Here

> **This is the entry point for every session.**
> Read this first, then follow the links below for deeper context.

---

## Quick Orient

| What | Where |
|---|---|
| Full project context, tech stack, rules | [PROJECT_BRIEF.md](PROJECT_BRIEF.md) |
| Infrastructure, config, troubleshooting | [README.md](README.md) |
| Current live status of all services | [STATUS.md](STATUS.md) |
| Full VM provisioning (fresh install) | `bash SETUP.sh` |

**Server:** `ssh tech-admin@192.168.0.221`
**Hub live at:** https://hub.treppides.com (HTTPS live — DNS record needed on office router/AD DNS)
**Direct IP:** https://192.168.0.221 (works now, cert warning expected — use hostname after DNS)
**Repo:** `git@github.com:andreas1612/treppides-hub.git`

---

## Last Session — 2026-05-11 (Session 7)

**What was done:**
- Copied certs from laptop to server, built cert chain at `/etc/nginx/ssl/treppides_chain.crt`
- Private key at `/etc/nginx/ssl/treppides.key` — chmod 600, root owned
- Deployed nginx HTTPS config — HTTP→HTTPS redirect live, security headers set
- Updated `config.js` BASE_URL/DOCS_URL to `https://hub.treppides.com/docs`
- Verified: `curl -sk https://192.168.0.221/ | grep "<title>"` returns hub title with valid cert
- Cert: Sectigo wildcard `*.treppides.com`, valid until 22 Nov 2026

**HTTPS is fully live. One thing remaining: DNS.**

---

## Priority 1 — DNS Record (5-minute task)

Add an A record to the **office router / Active Directory DNS**:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `hub.treppides.com` | `192.168.0.221` | 300 |

Once added: any LAN browser hitting `https://hub.treppides.com` gets the padlock with no warning.

**Temporary workaround** (per-PC, while waiting for DNS): add to Windows hosts file `C:\Windows\System32\drivers\etc\hosts` (requires admin):
```
192.168.0.221   hub.treppides.com
```

---

## Priority 2 — Treppides Logo

Logo assets added to GitHub repo gallery (2 latest images). Check the repo.

To replace the SVG globe placeholder:
- File: `components/sidebar.js` — `globeSvg()` function (around line 99)
- Also update `favicon.svg` in repo root
- Ask Claude to do this once you have the logo file path or paste the SVG/PNG

---

## Priority 3 — OpenProject Deployment

Deploy OpenProject at `https://hub.treppides.com/projects`.

- `docker-compose.yml` already at `~/openproject/` on server
- nginx proxy block already in `nginx-treppides-hub.conf`
- Run: `cd ~/openproject && sudo docker compose up -d`
- Then: `sudo systemctl reload nginx`

---

## Critical Rules — Don't Forget

1. **Never `localhost` in frontend code** — always relative paths (`/api/...`) or `https://hub.treppides.com`. Nginx proxies everything.
2. **`config.js` is gitignored** — only exists on the server at `~/treppides-hub/config.js`. Never commit it.
3. **BookStack token expires 15/08/2026** — rotate early in BookStack admin → avatar → My Account → API Tokens.
4. **No build step** — edit files, push, done. nginx serves the repo directly. Hard-refresh browser after push.
5. **Chart.js is in `vendor/`** — do not switch to CDN.
6. **SSL private key** — lives only at `/etc/nginx/ssl/treppides.key` on server. `chmod 600`. Never email, never commit.
7. **cert chain order** — STAR cert first, then intermediates in order, then root. Wrong order = SSL error.

---

## SSL Certificate Details

| Item | Value |
|---|---|
| Issuer | Sectigo (via CA DV R36) |
| Type | Wildcard `*.treppides.com` |
| Covers | `hub.treppides.com`, `docs.treppides.com`, any `*.treppides.com` |
| Does NOT cover | `treppides.com` (bare domain — wildcard needs a subdomain) |
| Chain files | `treppides_chain.crt` = STAR + 3 intermediates concatenated |
| Key | `treppides.key` — from `PRIVATE KEY.txt` in TREPPIDES.zip |
| Laptop copy | `C:\Users\Andreas.Pi\Downloads\treppides-ssl\` — delete private key from here after install |

---

## Service Health Check

Quick manual check before starting work:
```bash
sudo systemctl status nginx clickup-fees --no-pager
cd ~/bookstack && sudo docker compose ps
curl -sk https://192.168.0.221/ | grep "<title>"
curl -sk https://192.168.0.221/api/clickup/fees | python3 -m json.tool | head -5
```

After DNS record is set (hub.treppides.com → 192.168.0.221):
```bash
curl -s https://hub.treppides.com/ | grep "<title>"
```

---

*Update this file at the end of every session with what was done and what's next.*
