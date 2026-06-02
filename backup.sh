#!/bin/bash
# ============================================================
# backup.sh — Daily automated backup for Treppides Hub
# Cron: 0 2 * * * /home/tech-admin/treppides-hub/backup.sh
# Keeps 14 daily backups with rotation.
# ============================================================

set -euo pipefail

BACKUP_BASE="/home/tech-admin/backups/hub"
DATE=$(date +%Y-%m-%d)
DEST="${BACKUP_BASE}/${DATE}"
HUB_DIR="/home/tech-admin/treppides-hub"
LOG="/var/log/hub-backup.log"
RETAIN_DAYS=14

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG"; }

log "=== Backup started ==="

mkdir -p "$DEST"

# 1. Config files
log "Backing up config files..."
cp -f "$HUB_DIR/config.js"             "$DEST/" 2>/dev/null || true
cp -f "$HUB_DIR/staff.json"            "$DEST/" 2>/dev/null || true
cp -f "$HUB_DIR/api/clickup/.env"      "$DEST/clickup.env" 2>/dev/null || true

# 2. Valuation SQLite (hot backup — safe while DB is in use with WAL)
log "Backing up valuation database..."
if [ -f "$HUB_DIR/api/valuation/valuation_reference.db" ]; then
    sqlite3 "$HUB_DIR/api/valuation/valuation_reference.db" ".backup '$DEST/valuation_reference.db'"
fi

# 3. BookStack MariaDB
log "Backing up BookStack MariaDB..."
BOOKSTACK_DB_CONTAINER=$(docker ps --filter "name=bookstack_db" --format "{{.Names}}" 2>/dev/null | head -1)
if [ -n "$BOOKSTACK_DB_CONTAINER" ]; then
    docker exec "$BOOKSTACK_DB_CONTAINER" \
        mariadb-dump -u root --all-databases --single-transaction 2>/dev/null \
        | gzip > "$DEST/bookstack_mariadb.sql.gz"
fi

# 4. Uploaded media (incremental — only changed files)
log "Backing up media..."
if [ -d "$HUB_DIR/media" ]; then
    rsync -a --delete "$HUB_DIR/media/" "$DEST/media/" 2>/dev/null || true
fi

# 5. Rotate old backups
log "Rotating backups older than $RETAIN_DAYS days..."
find "$BACKUP_BASE" -maxdepth 1 -type d -mtime +$RETAIN_DAYS -exec rm -rf {} \; 2>/dev/null || true

# 6. Report
BACKUP_SIZE=$(du -sh "$DEST" 2>/dev/null | cut -f1)
log "=== Backup complete: $DEST ($BACKUP_SIZE) ==="
