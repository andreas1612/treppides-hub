#!/bin/bash
# ============================================================
# SETUP.sh — Idempotent server setup for Treppides Hub
# Run: sudo bash SETUP.sh
#
# Safe to re-run — skips already-completed steps.
#
# Prerequisites:
#   1. SSL certs in /etc/nginx/ssl/
#   2. config.js exists at ~/treppides-hub/config.js
#   3. api/clickup/.env exists
# ============================================================

set -euo pipefail

HUB_DIR="/home/tech-admin/treppides-hub"
USER="tech-admin"

section() { echo ""; echo "=== [$1] $2 ==="; }
ok()      { echo "  ✓ $1"; }

# ---- 1. System packages -------------------------------------------
section "1/10" "Installing system packages"

apt-get update -qq
apt-get install -y -qq fail2ban ufw sqlite3 > /dev/null

ok "fail2ban, ufw, sqlite3 installed"

# ---- 2. Firewall (UFW) --------------------------------------------
section "2/10" "Configuring firewall"

ufw --force reset > /dev/null 2>&1
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP redirect'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable

ok "UFW active — only 22, 80, 443 open"

# ---- 3. fail2ban ---------------------------------------------------
section "3/10" "Configuring fail2ban"

cat > /etc/fail2ban/jail.local << 'JAIL'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5
backend  = systemd

[sshd]
enabled  = true
port     = ssh
filter   = sshd
maxretry = 5
bantime  = 3600

[nginx-limit-req]
enabled  = true
port     = http,https
filter   = nginx-limit-req
logpath  = /var/log/nginx/error.log
maxretry = 10
bantime  = 600
JAIL

systemctl enable --now fail2ban > /dev/null 2>&1
systemctl restart fail2ban

ok "fail2ban active — SSH (5 tries/1hr ban) + nginx rate limit jail"

# ---- 4. nginx config -----------------------------------------------
section "4/10" "Deploying nginx configuration"

cp "$HUB_DIR/nginx-treppides-hub.conf" /etc/nginx/sites-enabled/treppides-hub
nginx -t
systemctl reload nginx

ok "nginx reloaded with hardened config"

# ---- 5. ClickUp API venv -------------------------------------------
section "5/10" "Setting up ClickUp API"

cd "$HUB_DIR/api/clickup"
if [ ! -d venv ]; then
    sudo -u "$USER" python3 -m venv venv
fi
sudo -u "$USER" venv/bin/pip install -q -r requirements.txt

ok "ClickUp venv ready"

# ---- 6. Valuation API venv -----------------------------------------
section "6/10" "Setting up Valuation API"

cd "$HUB_DIR/api/valuation"
if [ ! -d venv ]; then
    sudo -u "$USER" python3 -m venv venv
fi
sudo -u "$USER" venv/bin/pip install -q -r requirements.txt

ok "Valuation venv ready"

# ---- 6b. Company Finder API venv -----------------------------------
section "6b/10" "Setting up Company Finder API"

cd "$HUB_DIR/api/companies"
if [ ! -d venv ]; then
    sudo -u "$USER" python3 -m venv venv
fi
sudo -u "$USER" venv/bin/pip install -q -r requirements.txt
# Build the master DB on first install if it doesn't exist yet (~2-3 min).
if [ ! -f companies.db ]; then
    echo "  Building company master database (initial full sync)..."
    sudo -u "$USER" venv/bin/python sync.py --full || echo "  (build deferred — run 'python sync.py --full' once .env is set)"
fi

ok "Company Finder venv ready"

# ---- 7. Systemd services -------------------------------------------
section "7/10" "Installing systemd services"

cp "$HUB_DIR/clickup-fees.service"  /etc/systemd/system/
cp "$HUB_DIR/valuation-api.service" /etc/systemd/system/
cp "$HUB_DIR/companies-api.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now clickup-fees
systemctl enable --now valuation-api
systemctl enable --now companies-api
systemctl restart clickup-fees
systemctl restart valuation-api
systemctl restart companies-api

ok "All three API services running with sandboxing"

# Company Finder incremental sync — every 3 min via cron (idempotent install).
CRON_LINE='*/3 * * * * curl -s http://127.0.0.1:8003/api/companies/sync >/dev/null 2>&1'
( crontab -u "$USER" -l 2>/dev/null | grep -v 'api/companies/sync' ; echo "$CRON_LINE" ) | crontab -u "$USER" -
ok "Company Finder 3-min sync cron installed"

# ---- 8. Backup cron ------------------------------------------------
section "8/10" "Installing backup cron"

chmod +x "$HUB_DIR/backup.sh"
mkdir -p /home/tech-admin/backups/hub

# Add cron if not already present
CRON_BACKUP="0 2 * * * $HUB_DIR/backup.sh"
(crontab -u "$USER" -l 2>/dev/null | grep -v "backup.sh"; echo "$CRON_BACKUP") | crontab -u "$USER" -

ok "Daily backup at 2 AM configured"

# ---- 9. Health check + renewal alert crons -------------------------
section "9/10" "Installing monitoring crons"

chmod +x "$HUB_DIR/healthcheck.sh"
chmod +x "$HUB_DIR/renewal-alert.sh"
touch /var/log/hub-health.log /var/log/hub-health-alerts.log /var/log/hub-backup.log
chown "$USER":"$USER" /var/log/hub-health.log /var/log/hub-health-alerts.log /var/log/hub-backup.log

CRON_HEALTH="*/5 * * * * $HUB_DIR/healthcheck.sh"
CRON_RENEW="0 9 1 * * $HUB_DIR/renewal-alert.sh"

(crontab -u "$USER" -l 2>/dev/null | grep -v "healthcheck.sh" | grep -v "renewal-alert.sh"; echo "$CRON_HEALTH"; echo "$CRON_RENEW") | crontab -u "$USER" -

ok "Health check (5min) + renewal alert (monthly) installed"

# ---- 10. Smoke tests -----------------------------------------------
section "10/10" "Running smoke tests"

sleep 3

echo -n "  nginx:          "; systemctl is-active nginx
echo -n "  clickup-fees:   "; systemctl is-active clickup-fees
echo -n "  valuation-api:  "; systemctl is-active valuation-api
echo -n "  companies-api:  "; systemctl is-active companies-api
echo -n "  docker:         "; systemctl is-active docker
echo -n "  fail2ban:       "; systemctl is-active fail2ban
echo -n "  ufw:            "; ufw status | head -1

echo ""
echo -n "  HTTPS (443):    "
curl -sk -o /dev/null -w "%{http_code}" https://hub.treppides.com/ --connect-timeout 5 --resolve hub.treppides.com:443:127.0.0.1 2>/dev/null || echo "SKIP (DNS)"
echo ""
echo -n "  ClickUp API:    "
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8001/health --connect-timeout 5
echo ""
echo -n "  Valuation API:  "
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8002/api/valuation/health --connect-timeout 5
echo ""
echo -n "  Company API:    "
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8003/api/companies/health --connect-timeout 5
echo ""

echo ""
echo "=== Setup complete ==="
echo ""
echo "  Firewall:   UFW active (22/80/443 only)"
echo "  fail2ban:   SSH + nginx jails"
echo "  nginx:      TLS 1.2+, gzip, rate limits, DDoS protection, video streaming"
echo "  APIs:       2 workers each, sandboxed, resource-capped"
echo "  Backups:    Daily at 2 AM → /home/tech-admin/backups/hub/"
echo "  Health:     Every 5 min → /var/log/hub-health.log"
echo "  Renewals:   Monthly → /var/log/hub-health-alerts.log"
echo ""
echo "  Key dates:"
echo "    BookStack API token expires: 2026-08-15"
echo "    SSL cert expires:            2026-11-22"
echo ""
