#!/bin/bash
# ============================================================
# renewal-alert.sh — Monthly cert/token expiry checker
# Cron: 0 9 1 * * /home/tech-admin/treppides-hub/renewal-alert.sh
# ============================================================

LOG="/var/log/hub-health.log"
ALERT_LOG="/var/log/hub-health-alerts.log"

log_alert() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] RENEWAL: $1" >> "$LOG"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] RENEWAL: $1" >> "$ALERT_LOG"
}

# --- Check SSL cert expiry ---
CERT_FILE="/etc/nginx/ssl/treppides_chain.crt"
if [ -f "$CERT_FILE" ]; then
    EXPIRY=$(openssl x509 -enddate -noout -in "$CERT_FILE" 2>/dev/null | cut -d= -f2)
    EXPIRY_EPOCH=$(date -d "$EXPIRY" +%s 2>/dev/null)
    NOW_EPOCH=$(date +%s)
    DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))

    if [ "$DAYS_LEFT" -le 30 ]; then
        log_alert "SSL CERT EXPIRES IN $DAYS_LEFT DAYS (on $EXPIRY) — RENEW NOW"
    elif [ "$DAYS_LEFT" -le 60 ]; then
        log_alert "SSL cert expires in $DAYS_LEFT days (on $EXPIRY) — plan renewal"
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] RENEWAL: SSL cert OK — $DAYS_LEFT days remaining" >> "$LOG"
    fi
fi

# --- BookStack API token reminder (hardcoded expiry: 2026-08-15) ---
BS_EXPIRY_EPOCH=$(date -d "2026-08-15" +%s 2>/dev/null)
NOW_EPOCH=$(date +%s)
BS_DAYS_LEFT=$(( (BS_EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))

if [ "$BS_DAYS_LEFT" -le 30 ]; then
    log_alert "BOOKSTACK TOKEN EXPIRES IN $BS_DAYS_LEFT DAYS (2026-08-15) — ROTATE NOW"
    log_alert "  Rotate at: BookStack Admin → My Account → API Tokens"
elif [ "$BS_DAYS_LEFT" -le 60 ]; then
    log_alert "BookStack token expires in $BS_DAYS_LEFT days (2026-08-15) — plan rotation"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] RENEWAL: BookStack token OK — $BS_DAYS_LEFT days remaining" >> "$LOG"
fi
