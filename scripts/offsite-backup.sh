#!/usr/bin/env bash
# [T1-4 2026-06-08] Offsite ENCRYPTED backup of the money DB (data/zeus.db).
# Local daily backups already exist (data/db_backups) but sit on the SAME disk
# AND are unencrypted (the DB holds exchange API keys). A disk loss = total loss.
# This takes a consistent SQLite online backup, AES-256-encrypts it with a
# dedicated key (/root/.zeus_backup_key — keep an OFFLINE copy or backups are
# unrecoverable), and rclone-copies it offsite, keeping the last KEEP_N.
#
# Restore:  scripts/offsite-restore.sh <encrypted-file> <output.db>
# Config:   scripts/offsite-backup.conf  (REMOTE_PATH, KEEP_N) — gitignored.
# Cron:     daily (see crontab). Safe to run before REMOTE_PATH is set (skips).
set -uo pipefail

ZEUS_DIR="/root/zeus-terminal"
DB="$ZEUS_DIR/data/zeus.db"
KEY="/root/.zeus_backup_key"
CONF="$ZEUS_DIR/scripts/offsite-backup.conf"
LOG="$ZEUS_DIR/data/logs/offsite-backup.log"

log() { echo "$(date -u '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"
REMOTE_PATH="${REMOTE_PATH:-}"
KEEP_N="${KEEP_N:-14}"

if [ -z "$REMOTE_PATH" ]; then
  log "SKIP: REMOTE_PATH not configured — run 'rclone config', then set REMOTE_PATH in $CONF"
  exit 0
fi
[ -f "$KEY" ] || { log "FATAL: backup key $KEY missing"; exit 1; }
[ -f "$DB" ]  || { log "FATAL: db $DB missing"; exit 1; }

TS=$(date -u '+%Y%m%d-%H%M%S')
TMP="/tmp/zeus-offsite-$TS.db"
ENC="$TMP.enc"
trap 'rm -f "$TMP" "$ENC"' EXIT

# 1. consistent online backup (safe to run against the live WAL DB)
if ! sqlite3 "$DB" ".backup '$TMP'"; then log "FATAL: sqlite .backup failed"; exit 1; fi
SZ=$(du -h "$TMP" | cut -f1)

# 2. encrypt (AES-256-CBC + PBKDF2 + salt)
if ! openssl enc -aes-256-cbc -pbkdf2 -salt -in "$TMP" -out "$ENC" -pass "file:$KEY"; then
  log "FATAL: encrypt failed"; exit 1
fi

# 3. upload offsite
if ! rclone copy "$ENC" "$REMOTE_PATH" --no-traverse 2>>"$LOG"; then
  log "FATAL: rclone upload failed to $REMOTE_PATH"; exit 1
fi
log "OK: uploaded $(basename "$ENC") ($SZ) → $REMOTE_PATH"

# 4. retention — keep the last KEEP_N offsite copies
OLD=$(rclone lsf "$REMOTE_PATH" 2>/dev/null | grep -E '^zeus-offsite-.*\.db\.enc$' | sort | head -n "-${KEEP_N}" || true)
if [ -n "$OLD" ]; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if rclone deletefile "$REMOTE_PATH/$f" 2>>"$LOG"; then log "pruned old offsite: $f"; fi
  done <<< "$OLD"
fi
exit 0
