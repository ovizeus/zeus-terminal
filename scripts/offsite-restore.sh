#!/usr/bin/env bash
# [T1-4 2026-06-08] Restore an offsite encrypted zeus.db backup.
# Usage: scripts/offsite-restore.sh <encrypted-input.db.enc> <output.db>
# Decrypts with /root/.zeus_backup_key and verifies SQLite integrity.
set -uo pipefail

KEY="/root/.zeus_backup_key"
IN="${1:-}"
OUT="${2:-}"

if [ -z "$IN" ] || [ -z "$OUT" ]; then
  echo "Usage: $0 <encrypted-input.db.enc> <output.db>" >&2; exit 2
fi
[ -f "$KEY" ] || { echo "FATAL: backup key $KEY missing (need the offline copy)" >&2; exit 1; }
[ -f "$IN" ]  || { echo "FATAL: input $IN missing" >&2; exit 1; }

if ! openssl enc -d -aes-256-cbc -pbkdf2 -in "$IN" -out "$OUT" -pass "file:$KEY"; then
  echo "FATAL: decrypt failed (wrong key?)" >&2; exit 1
fi

# Verify the restored DB is a valid, non-corrupt SQLite file
CHECK=$(sqlite3 "$OUT" "PRAGMA quick_check;" 2>&1 | head -1)
if [ "$CHECK" = "ok" ]; then
  echo "RESTORED OK → $OUT (integrity: ok)"
  exit 0
else
  echo "WARNING: restored to $OUT but quick_check = $CHECK" >&2
  exit 1
fi
