#!/bin/bash
# ============================================================
# healthcheck.sh — Service health monitor for Treppides Hub
# Cron: */5 * * * * /home/tech-admin/treppides-hub/healthcheck.sh
# Checks all services, logs failures.
# ============================================================

LOG="/var/log/hub-health.log"
ALERT_LOG="/var/log/hub-health-alerts.log"
FAILURES=0

check_service() {
    local name="$1"
    if ! systemctl is-active --quiet "$name" 2>/dev/null; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] FAIL: $name is not running" >> "$LOG"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] FAIL: $name is not running" >> "$ALERT_LOG"
        FAILURES=$((FAILURES + 1))
    fi
}

check_url() {
    local name="$1"
    local url="$2"
    local http_code
    http_code=$(curl -sk -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 "$url" 2>/dev/null)
    if [ "$http_code" != "200" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] FAIL: $name returned HTTP $http_code" >> "$LOG"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] FAIL: $name returned HTTP $http_code" >> "$ALERT_LOG"
        FAILURES=$((FAILURES + 1))
    fi
}

check_docker() {
    local name="$1"
    local status
    status=$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null)
    if [ "$status" != "true" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] FAIL: Docker container $name is not running" >> "$LOG"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] FAIL: Docker container $name is not running" >> "$ALERT_LOG"
        FAILURES=$((FAILURES + 1))
    fi
}

# --- Check systemd services ---
check_service nginx
check_service clickup-fees
check_service valuation-api
check_service docker

# --- Check Docker containers ---
check_docker bookstack
check_docker bookstack_db

# --- Check HTTP endpoints ---
check_url "Hub HTTPS"       "https://hub.treppides.com/"
check_url "ClickUp Health"  "http://127.0.0.1:8001/health"
check_url "Valuation Health" "http://127.0.0.1:8002/api/valuation/health"

# --- Log summary ---
if [ $FAILURES -eq 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] OK: All 9 checks passed" >> "$LOG"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ALERT: $FAILURES check(s) failed" >> "$LOG"
fi
