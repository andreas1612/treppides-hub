#!/bin/bash
# ============================================================
# SETUP.sh — Full server setup pipeline for Treppides Hub
# Run this on the VM (192.168.0.221) as tech-admin via SSH.
# Run with: bash SETUP.sh
# ============================================================

set -e  # stop on any error

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
echo -n "Hub (port 80):        "
curl -s -o /dev/null -w "%{http_code}" http://192.168.0.221/
echo ""
echo -n "BookStack API:        "
curl -s -o /dev/null -w "%{http_code}" http://192.168.0.221/docs/api/books \
  -H "Authorization: Token $(grep API_TOKEN_ID ~/treppides-hub/config.js | grep -o '"[^"]*"' | tail -1 | tr -d '"'):$(grep API_TOKEN_SECRET ~/treppides-hub/config.js | grep -o '"[^"]*"' | tail -1 | tr -d '"')"
echo ""
echo -n "ClickUp Fees API:     "
curl -s -o /dev/null -w "%{http_code}" http://192.168.0.221/api/clickup/fees
echo ""

echo ""
echo "=== All done. Hub is live at http://192.168.0.221/ ==="
