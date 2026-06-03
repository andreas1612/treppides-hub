# Treppides Hub — Server Operations Reference

> **Server:** 192.168.0.221 (tech-srv) · Ubuntu 24.04.4 LTS  
> **Last hardened:** 2026-06-02 · **Last patched:** 2026-06-02

---

## Services

| Service | Type | Port | Status command |
|---------|------|------|----------------|
| nginx | systemd | 80, 443 | `systemctl status nginx` |
| clickup-fees | systemd | 8001 (localhost) | `systemctl status clickup-fees` |
| valuation-api | systemd | 8002 (localhost) | `systemctl status valuation-api` |
| companies-api | systemd | 8003 (localhost) | `systemctl status companies-api` |
| bookstack | Docker | 6875 (localhost) | `sudo docker ps \| grep bookstack` |
| bookstack_db | Docker (MariaDB) | 3306 (internal) | `sudo docker ps \| grep bookstack_db` |

### API Health Endpoints

```
curl http://127.0.0.1:8001/health          # ClickUp Fees API
curl http://127.0.0.1:8002/api/valuation/health   # Valuation API
curl http://127.0.0.1:8003/api/companies/health   # Company Finder API
```

### Restarting Services

```bash
sudo systemctl restart clickup-fees
sudo systemctl restart valuation-api
sudo systemctl restart companies-api
sudo systemctl reload nginx          # reload config without downtime
cd ~/bookstack && sudo docker compose restart
```

### Company Finder — master database

The Company Finder (`companies-api`, port 8003) keeps a SQLite master DB
(`api/companies/companies.db`) of every ClickUp task across the 10 CRM spaces.
- **Initial build (one-time):** `cd ~/treppides-hub/api/companies && source venv/bin/activate && python sync.py --full` (~2-3 min).
- **Incremental sync** runs every 3 min via cron (fast, ~10s — only tasks changed since last sync). Deletion reconcile (heavier, re-lists all spaces) runs at most every 15 min.
- **Manual refresh:** the dashboard's Refresh button, or `curl 'http://127.0.0.1:8003/api/companies/sync?wait=true'`.
- **Rebuild from scratch:** `python sync.py --full` (or `curl '.../sync?full=true&wait=true'`).
- **DB freshness:** `curl http://127.0.0.1:8003/api/companies/status`

---

## Firewall (UFW)

**Status:** Active — deny all incoming except:

| Port | Purpose |
|------|---------|
| 22/tcp | SSH |
| 80/tcp | HTTP → HTTPS redirect |
| 443/tcp | HTTPS |

```bash
sudo ufw status verbose              # view rules
sudo ufw allow <port>/tcp            # open a port
sudo ufw deny <port>/tcp             # close a port
```

---

## fail2ban

**Jails active:**

| Jail | Trigger | Ban duration |
|------|---------|-------------|
| sshd | 5 failed logins in 10 min | 1 hour |
| nginx-limit-req | 10 rate-limit hits | 10 minutes |

```bash
sudo fail2ban-client status              # list jails
sudo fail2ban-client status sshd         # show banned IPs
sudo fail2ban-client set sshd unbanip <IP>   # unban an IP
```

**Config:** `/etc/fail2ban/jail.local`

---

## File Permissions

Sensitive files are locked to owner-only (600):

| File | Permissions | Contains |
|------|-------------|----------|
| `~/treppides-hub/config.js` | 600 | BookStack API token |
| `~/treppides-hub/api/clickup/.env` | 600 | ClickUp API token |
| `~/treppides-hub/api/companies/.env` | 600 | ClickUp API token (Company Finder) |
| `~/bookstack/config/www/.env` | 600 | BookStack DB credentials |
| `/etc/nginx/ssl/treppides.key` | 600 (root) | SSL private key |

---

## Backups

**Script:** `~/treppides-hub/backup.sh`  
**Schedule:** Daily at 02:00 (cron)  
**Destination:** `/home/tech-admin/backups/hub/YYYY-MM-DD/`  
**Retention:** 14 days, then auto-deleted  
**Log:** `/var/log/hub-backup.log`

### What gets backed up

| Item | Source | Method |
|------|--------|--------|
| App config | `config.js`, `staff.json` | File copy |
| ClickUp secrets | `api/clickup/.env` | File copy |
| Valuation database | `api/valuation/valuation_reference.db` | `sqlite3 .backup` (WAL-safe) |
| BookStack database | MariaDB in Docker | `mariadb-dump` → gzipped |
| Uploaded media | `media/` (images + videos) | `rsync` (incremental) |

### Manual backup

```bash
bash ~/treppides-hub/backup.sh
cat /var/log/hub-backup.log          # check result
ls -lh ~/backups/hub/                # list all backups
```

### Restoring from backup

```bash
# 1. Config files — just copy back
cp ~/backups/hub/2026-06-01/config.js ~/treppides-hub/

# 2. Valuation DB — stop service, replace file, start service
sudo systemctl stop valuation-api
cp ~/backups/hub/2026-06-01/valuation_reference.db ~/treppides-hub/api/valuation/
sudo systemctl start valuation-api

# 3. BookStack MariaDB — pipe gzipped dump back into container
gunzip -c ~/backups/hub/2026-06-01/bookstack_mariadb.sql.gz \
  | sudo docker exec -i bookstack_db mariadb -u root

# 4. Media — rsync back
rsync -a ~/backups/hub/2026-06-01/media/ ~/treppides-hub/media/
```

---

## Monitoring

### Health checks

**Script:** `~/treppides-hub/healthcheck.sh`  
**Schedule:** Every 5 minutes (cron)  
**Log:** `/var/log/hub-health.log`  
**Alerts:** `/var/log/hub-health-alerts.log`

**What it checks (9 checks):**

| # | Check | Type |
|---|-------|------|
| 1 | nginx | systemd service |
| 2 | clickup-fees | systemd service |
| 3 | valuation-api | systemd service |
| 4 | docker | systemd service |
| 5 | bookstack | Docker container |
| 6 | bookstack_db | Docker container |
| 7 | https://hub.treppides.com/ | HTTP 200 |
| 8 | http://127.0.0.1:8001/health | HTTP 200 |
| 9 | http://127.0.0.1:8002/api/valuation/health | HTTP 200 |

### Reading the logs

```bash
# Latest health status
tail -5 /var/log/hub-health.log

# Only failures
cat /var/log/hub-health-alerts.log

# Run a check now
bash ~/treppides-hub/healthcheck.sh && tail -1 /var/log/hub-health.log
```

### Renewal alerts

**Script:** `~/treppides-hub/renewal-alert.sh`  
**Schedule:** 1st of each month at 09:00 (cron)  
**Log:** Same as health log files

**What it tracks:**

| Item | Expiry date | Action needed |
|------|-------------|---------------|
| SSL certificate | 2026-11-22 | Renew via Sectigo, rebuild chain, copy to `/etc/nginx/ssl/` |
| BookStack API token | 2026-08-15 | Rotate at BookStack Admin → My Account → API Tokens, update `config.js` |

```bash
# Run manually
bash ~/treppides-hub/renewal-alert.sh && tail -3 /var/log/hub-health.log
```

### Known limitation

All monitoring **writes to log files only**. There are no email/Slack/push notifications. You must manually check the logs or set up an alerting layer on top.

---

## Cron Jobs

```bash
crontab -l       # view all crons
```

| Schedule | Script | Purpose |
|----------|--------|---------|
| `0 2 * * *` | `backup.sh` | Daily backup at 2 AM |
| `*/5 * * * *` | `healthcheck.sh` | Health check every 5 min |
| `0 9 1 * *` | `renewal-alert.sh` | Cert/token expiry check monthly |
| `*/3 * * * *` | `curl -s http://127.0.0.1:8003/api/companies/sync >/dev/null` | Company Finder incremental sync every 3 min |

---

## nginx Configuration

| File | Purpose |
|------|---------|
| `/etc/nginx/nginx.conf` | Global settings: gzip, TLS 1.2+, rate limit zones, worker tuning |
| `/etc/nginx/sites-enabled/treppides-hub` | Site config: upstreams, security headers, video streaming, proxying |

### Rate limits defined in nginx.conf

| Zone | Rate | Applies to |
|------|------|-----------|
| `api` | 30 req/sec per IP | API endpoints |
| `upload` | 5 req/min per IP | File upload endpoints |
| `addr` | Connection limit per IP | All connections |

Exceeding limits returns **HTTP 429** (Too Many Requests) and may trigger a fail2ban ban after 10 hits.

### Testing config changes

```bash
sudo nginx -t                  # test syntax
sudo systemctl reload nginx    # apply without downtime
```

---

## API Service Details

Both APIs run under systemd with security hardening:

| Setting | clickup-fees | valuation-api |
|---------|-------------|---------------|
| Workers | 2 | 2 |
| Memory cap | 512 MB | 384 MB |
| CPU quota | 200% (2 cores) | 200% (2 cores) |
| Max requests per worker | 10,000 (then recycle) | 10,000 |
| Sandbox | PrivateTmp, NoNewPrivileges, ProtectSystem=strict | Same |

**Service files:** `~/treppides-hub/clickup-fees.service`, `~/treppides-hub/valuation-api.service`  
**Deployed to:** `/etc/systemd/system/`

### Viewing logs

```bash
journalctl -u clickup-fees --since "1 hour ago" --no-pager
journalctl -u valuation-api --since "1 hour ago" --no-pager
```

---

## SSL Certificates

**Location:** `/etc/nginx/ssl/`  
**Chain file:** `treppides_chain.crt` (wildcard *.treppides.com)  
**Private key:** `treppides.key` (permissions: 600, owner: root)  
**Expires:** 2026-11-22

### Renewal process

1. Purchase/renew cert from Sectigo
2. Upload new cert files to server
3. Rebuild chain: `cat STAR_treppides_com.crt Intermediate1.crt Intermediate2.crt Root.crt | sudo tee /etc/nginx/ssl/treppides_chain.crt`
4. Replace private key: `sudo cp NEW_KEY.txt /etc/nginx/ssl/treppides.key && sudo chmod 600 /etc/nginx/ssl/treppides.key`
5. Test and reload: `sudo nginx -t && sudo systemctl reload nginx`
6. Update expiry date in `renewal-alert.sh` (hardcoded BookStack token date)

---

## File Locations Quick Reference

| What | Path |
|------|------|
| Hub web root | `~/treppides-hub/` |
| ClickUp API code | `~/treppides-hub/api/clickup/` |
| Valuation API code | `~/treppides-hub/api/valuation/` |
| Valuation database | `~/treppides-hub/api/valuation/valuation_reference.db` |
| Company Finder API code | `~/treppides-hub/api/companies/` |
| Company master database | `~/treppides-hub/api/companies/companies.db` |
| Company Finder secrets | `~/treppides-hub/api/companies/.env` |
| ClickUp secrets | `~/treppides-hub/api/clickup/.env` |
| App config | `~/treppides-hub/config.js` |
| Staff list | `~/treppides-hub/staff.json` |
| Uploaded media | `~/treppides-hub/media/` |
| Backups | `~/backups/hub/` |
| BookStack (Docker) | `~/bookstack/` |
| nginx site config | `/etc/nginx/sites-enabled/treppides-hub` |
| nginx global config | `/etc/nginx/nginx.conf` |
| SSL certs | `/etc/nginx/ssl/` |
| fail2ban config | `/etc/fail2ban/jail.local` |
| Health log | `/var/log/hub-health.log` |
| Alert log | `/var/log/hub-health-alerts.log` |
| Backup log | `/var/log/hub-backup.log` |
| Setup script | `~/treppides-hub/SETUP.sh` |

---

## System Updates

Unattended-upgrades is enabled — security patches install automatically.

```bash
sudo apt update && sudo apt upgrade -y    # manual full update
apt list --upgradable                      # check pending
```

Last manual patch: 2026-06-02 (0 pending after).
