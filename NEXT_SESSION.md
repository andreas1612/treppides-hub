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
**Hub live at:** http://192.168.0.221/ (HTTP until DNS + cert are applied)
**Target URL:** https://hub.treppides.com (after SSL steps below)
**Repo:** `git@github.com:andreas1612/treppides-hub.git`

---

## Last Session — 2026-05-11 (Session 6)

**What was done:**
- Received Sectigo wildcard SSL certificate `*.treppides.com` (in `TREPPIDES.zip` on laptop)
- Identified cert package contents: `STAR_treppides_com.crt` + 3 Sectigo intermediates + private key
- Decided subdomain: `hub.treppides.com` — **internal LAN only for now** (no public DNS)
- `nginx-treppides-hub.conf` fully updated for HTTPS — HTTP→HTTPS redirect, ssl_protocols, security headers
- `SETUP.sh` updated with SSL install block (commented out — run once when certs land on server)
- `STATUS.md` and `NEXT_SESSION.md` updated

**NOT YET DONE — certs are not on the server yet. DNS not configured.**

---

## Priority 1 — HTTPS (critical — do this first next session)

### Step 1: Copy certs from laptop to server

Run this from the **Windows laptop** in PowerShell:

```powershell
# Create upload folder on server
ssh tech-admin@192.168.0.221 "mkdir -p ~/ssl-upload"

# Copy all cert files
scp "C:\Users\Andreas.Pi\Downloads\treppides-ssl\*" tech-admin@192.168.0.221:~/ssl-upload/
```

Files to copy (all in `C:\Users\Andreas.Pi\Downloads\treppides-ssl\`):
- `STAR_treppides_com.crt`
- `SectigoPublicServerAuthenticationCADVR36.crt`
- `SectigoPublicServerAuthenticationRootR46_USERTrust.crt`
- `USERTrustRSACertificationAuthority.crt`
- `PRIVATE KEY.txt`  ← sensitive — delete from laptop downloads folder after

### Step 2: Install certs on server

SSH into server, then run:

```bash
sudo mkdir -p /etc/nginx/ssl

# Build cert chain (ORDER IS CRITICAL — your cert first, then intermediates, then root)
cat ~/ssl-upload/STAR_treppides_com.crt \
    ~/ssl-upload/SectigoPublicServerAuthenticationCADVR36.crt \
    ~/ssl-upload/SectigoPublicServerAuthenticationRootR46_USERTrust.crt \
    ~/ssl-upload/USERTrustRSACertificationAuthority.crt \
    | sudo tee /etc/nginx/ssl/treppides_chain.crt > /dev/null

sudo cp ~/ssl-upload/PRIVATE\ KEY.txt /etc/nginx/ssl/treppides.key
sudo chmod 600 /etc/nginx/ssl/treppides.key
sudo chown root:root /etc/nginx/ssl/treppides.key

# Clean up — private key must not sit in home directory
rm -rf ~/ssl-upload

# Verify
sudo ls -la /etc/nginx/ssl/
```

### Step 3: Deploy nginx HTTPS config

```bash
sudo cp ~/treppides-hub/nginx-treppides-hub.conf /etc/nginx/sites-enabled/treppides-hub
sudo nginx -t          # must say "syntax is ok" before proceeding
sudo systemctl reload nginx
```

### Step 4: Add internal DNS record

Add this to the **office DNS server / router / Active Directory DNS**:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `hub.treppides.com` | `192.168.0.221` | 300 |

If there's no internal DNS server, add to Windows `hosts` file on each PC as a temporary test:
```
192.168.0.221   hub.treppides.com
```
(file at `C:\Windows\System32\drivers\etc\hosts` — requires admin)

### Step 5: Update config.js on server

```bash
nano ~/treppides-hub/config.js
```

Change:
```js
BASE_URL: "http://192.168.0.221/docs",   → "https://hub.treppides.com/docs",
DOCS_URL: "http://192.168.0.221/docs",   → "https://hub.treppides.com/docs",
```

### Step 6: Test

```bash
# From the server itself (bypasses DNS)
curl -sk https://hub.treppides.com/ --resolve hub.treppides.com:443:192.168.0.221 | head -3

# From any LAN browser (after DNS record is set)
# Visit: https://hub.treppides.com
# Expected: padlock in address bar, no warnings
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
curl -s http://192.168.0.221/api/clickup/fees | python3 -m json.tool | head -5
```

After HTTPS is live:
```bash
curl -sk https://hub.treppides.com/ --resolve hub.treppides.com:443:192.168.0.221 | grep "<title>"
curl -sk https://hub.treppides.com/api/clickup/fees --resolve hub.treppides.com:443:192.168.0.221 | python3 -m json.tool | head -5
```

---

*Update this file at the end of every session with what was done and what's next.*
