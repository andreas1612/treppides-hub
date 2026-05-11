#!/bin/bash
# ============================================================
# SETUP.sh — Full server setup pipeline for Treppides Hub
# Run this on the VM (192.168.0.221) as tech-admin via SSH.
# Run with: bash SETUP.sh
#
# Prerequisites before running:
#   1. SSL certs must already be in /etc/nginx/ssl/
#      (run the ssl-install block below if not done yet)
#   2. config.js must exist at ~/treppides-hub/config.js
#   3. api/clickup/.env must exist
# ============================================================

set -e  # stop on any error

# ---- SSL install (run once — skip if certs already in place) ----
# Uncomment this block on first run after copying certs from laptop:
#
# echo "=== [0/5] Installing SSL certificates ==="
# sudo mkdir -p /etc/nginx/ssl
# cat ~/ssl-upload/STAR_treppides_com.crt \
#     ~/ssl-upload/SectigoPublicServerAuthenticationCADVR36.crt \
#     ~/ssl-upload/SectigoPublicServerAuthenticationRootR46_USERTrust.crt \
#     ~/ssl-upload/USERTrustRSACertificationAuthority.crt \
#     | sudo tee /etc/nginx/ssl/treppides_chain.crt > /dev/null
# sudo cp ~/ssl-upload/PRIVATE\ KEY.txt /etc/nginx/ssl/treppides.key
# sudo chmod 600 /etc/nginx/ssl/treppides.key
# sudo chown root:root /etc/nginx/ssl/treppides.key
# rm -rf ~/ssl-upload
# echo "SSL certs installed."

echo ""
echo "=== [1/5] Installing nginx config ==="
sudo cp ~/treppides-hub/nginx-treppides-hub.conf /etc/nginx/sites-enabled/treppides-hub
sudo nginx -t
sudo systemctl reload nginx
echo "OK"

echo ""
echo "=== [2/5] Installing Python venv + dependencies ==="
cd ~/treppides-hub/api/clickup
python3 -m venv venv
venv/bin/pip install -r requirements.txt --quiet
echo "OK"

echo ""
echo "=== [3/5] Installing ClickUp Fees API as systemd service ==="
sudo cp ~/treppides-hub/clickup-fees.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now clickup-fees
echo "OK"

echo ""
echo "=== [4/5] Verifying services ==="
echo "--- nginx ---"
sudo systemctl status nginx --no-pager | head -5
echo "--- clickup-fees ---"
sudo systemctl status clickup-fees --no-pager | head -5
echo "--- BookStack containers ---"
cd ~/bookstack && sudo docker compose ps

echo ""
echo "=== [5/5] Smoke tests ==="
sleep 2
echo -n "Hub HTTPS redirect:   "
curl -s -o /dev/null -w "%{http_code}" http://192.168.0.221/
echo ""
echo -n "Hub HTTPS:            "
curl -s -o /dev/null -w "%{http_code}" https://hub.treppides.com/ --resolve hub.treppides.com:443:192.168.0.221 2>/dev/null || echo "DNS not yet set — expected"
echo ""
echo -n "BookStack API:        "
curl -s -o /dev/null -w "%{http_code}" https://hub.treppides.com/docs/api/books \
  -H "Authorization: Token $(grep API_TOKEN_ID ~/treppides-hub/config.js | grep -o '"[^"]*"' | tail -1 | tr -d '"'):$(grep API_TOKEN_SECRET ~/treppides-hub/config.js | grep -o '"[^"]*"' | tail -1 | tr -d '"')" \
  --resolve hub.treppides.com:443:192.168.0.221 2>/dev/null || echo "DNS not yet set"
echo ""
echo -n "ClickUp Fees API:     "
curl -s -o /dev/null -w "%{http_code}" https://hub.treppides.com/api/clickup/fees \
  --resolve hub.treppides.com:443:192.168.0.221 2>/dev/null || echo "DNS not yet set"
echo ""

echo ""
echo "=== All done. ==="
echo "  HTTP  → https://hub.treppides.com  (redirects automatically)"
echo "  HTTPS → https://hub.treppides.com"
echo ""
echo "  Next step: add internal DNS record hub.treppides.com → 192.168.0.221"
echo "  Then update config.js: BASE_URL and DOCS_URL → https://hub.treppides.com/docs"
