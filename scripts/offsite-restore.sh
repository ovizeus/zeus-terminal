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

TMPD="$OUT.dec.$$"
trap 'rm -f "$TMPD"' EXIT
if ! openssl enc -d -aes-256-cbc -pbkdf2 -in "$IN" -out "$TMPD" -pass "file:$KEY"; then
  echo "FATAL: decrypt failed (wrong key?)" >&2; exit 1
fi

# [2026-10-07] Backups are gzipped before encryption from this date on, but the
# operator still holds 8 older uncompressed ones. Detect by gzip magic (1f 8b)
# rather than by filename, so BOTH restore with the same command and an old
# backup never silently fails.
MAGIC=$(head -c 2 "$TMPD" | od -An -tx1 | tr -d ' \n')
if [ "$MAGIC" = "1f8b" ]; then
  if ! gzip -dc "$TMPD" > "$OUT"; then echo "FATAL: gunzip failed" >&2; exit 1; fi
  echo "(compressed backup — decompressed)"
else
  mv "$TMPD" "$OUT"
  echo "(legacy uncompressed backup)"
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
