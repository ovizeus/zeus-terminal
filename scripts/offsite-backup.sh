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

# [2026-10-20 b289] Esecul offsite era MUT: doar o linie "FATAL" intr-un log pe
# care nu-l citeste nimeni. Drive-ul s-a umplut pe 14 oct si disaster-recovery
# a stat mort 7 zile fara sa afle nimeni. Orice FATAL pleaca acum pe Telegram.
alert() {
  local msg="$1"
  local token chat
  token=$(grep "^TELEGRAM_BOT_TOKEN=" "$ZEUS_DIR/.env" 2>/dev/null | cut -d'=' -f2)
  chat=$(grep "^TELEGRAM_CHAT_ID=" "$ZEUS_DIR/.env" 2>/dev/null | cut -d'=' -f2)
  if [ -z "$token" ] || [ -z "$chat" ]; then
    log "alerta NEtrimisa (fara credentiale Telegram): $msg"
    return 0
  fi
  curl -s -m 15 -X POST "https://api.telegram.org/bot${token}/sendMessage" \
    -d "chat_id=${chat}" \
    -d "text=ZEUS offsite backup: ${msg}" -o /dev/null \
    && log "alerta trimisa pe Telegram" || log "trimiterea alertei a picat"
}

fatal() { log "FATAL: $1"; alert "EUSEC — $1"; exit 1; }

# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"
REMOTE_PATH="${REMOTE_PATH:-}"
KEEP_N="${KEEP_N:-14}"
# Cate copii offsite nu se sterg NICIODATA, orice s-ar intampla cu spatiul.
MIN_KEEP="${MIN_KEEP:-3}"
# `rclone about` vrea remote-ul, nu calea: "gdrive:zeus-backups" -> "gdrive:"
REMOTE_PATH_REMOTE_ONLY="${REMOTE_PATH%%:*}:"
# --dry-run: arata planul de retentie si se opreste inainte sa urce/stearga.
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1
export ZEUS_DIR

if [ -z "$REMOTE_PATH" ]; then
  log "SKIP: REMOTE_PATH not configured — run 'rclone config', then set REMOTE_PATH in $CONF"
  exit 0
fi
[ -f "$KEY" ] || fatal "cheia de backup $KEY lipseste"
[ -f "$DB" ]  || fatal "baza de date $DB lipseste"

TS=$(date -u '+%Y%m%d-%H%M%S')
TMP="/tmp/zeus-offsite-$TS.db"
ENC="$TMP.enc"
trap 'rm -f "$TMP" "$ENC"' EXIT

# 1. consistent online snapshot (safe to run against the live WAL DB)
# [2026-10-07] Was `.backup`, which restarts its copy whenever the source is
# written. Against the live engine that can stall indefinitely — observed here
# sitting at 509 MB of 2616 MB with no progress at all. `VACUUM INTO` writes a
# single consistent snapshot in one pass instead: 16.5 s for the same DB,
# measured. It also drops free pages, so the snapshot is never larger than the
# live file.
if ! sqlite3 "$DB" "VACUUM INTO '$TMP';"; then fatal "sqlite VACUUM INTO a picat"; fi
SZ=$(du -h "$TMP" | cut -f1)

# [2026-10-07] 1b. COMPRESS before encrypting.
# Offsite backups had been failing for 101 days with Google Drive
# storageQuotaExceeded: the uncompressed copies grew with the DB (1.37 GB ->
# 2.17 GB each) and filled the 15 GB quota, while retention prunes by COUNT
# (KEEP_N) and so never kicked in. A SQLite file compresses about 10x — measured
# on the live DB: 2616 MB -> 262 MB in 31 s — so compressing makes each backup
# fit in the free space again WITHOUT deleting any of the operator's existing
# copies. Encryption must come AFTER compression; ciphertext does not compress.
GZ="$TMP.gz"
trap 'rm -f "$TMP" "$ENC" "$GZ"' EXIT
if ! gzip -c "$TMP" > "$GZ"; then fatal "gzip a picat"; fi
GZSZ=$(du -h "$GZ" | cut -f1)

# 2. encrypt (AES-256-CBC + PBKDF2 + salt)
if ! openssl enc -aes-256-cbc -pbkdf2 -salt -in "$GZ" -out "$ENC" -pass "file:$KEY"; then
  fatal "criptarea a picat"
fi

# [2026-10-20 b289] 2b. RETENTIE INAINTE DE URCARE, judecata pe SPATIU.
# Retentia veche tagea dupa NUMAR si rula DUPA urcare (pasul 4, adica dupa
# `exit 1` al pasului de upload). Pe Drive erau exact 14 obiecte = exact
# KEEP_N, deci `head -n -14` nu intorcea nimic; ca sa devina 15 trebuia o
# urcare reusita, care nu reusea fiindca nu era spatiu. Impas inchis:
# fara spatiu -> fara urcare -> fara retentie -> fara spatiu. 7 zile mort.
# Planul se calculeaza in scripts/lib/offsitePrunePlan.js (functie pura,
# testata la mutatie) si e FAIL-CLOSED: daca nici stergand tot ce e permis
# nu incape, nu sterge nimic si raporteaza.
NEED=$(stat -c %s "$ENC")
ABOUT=$(rclone about "$REMOTE_PATH_REMOTE_ONLY" --json 2>>"$LOG" || echo '{}')
LSJSON=$(rclone lsjson "$REMOTE_PATH" 2>>"$LOG" || echo '[]')
PLAN=$(NEED="$NEED" KEEP_N="$KEEP_N" MIN_KEEP="$MIN_KEEP" ABOUT="$ABOUT" LSJSON="$LSJSON" \
  node -e '
  const { planOffsitePrune } = require(process.env.ZEUS_DIR + "/scripts/lib/offsitePrunePlan");
  let about = {}, files = [];
  try { about = JSON.parse(process.env.ABOUT || "{}"); } catch (_) {}
  try { files = JSON.parse(process.env.LSJSON || "[]"); } catch (_) {}
  const entries = files
    .filter(f => !f.IsDir && /^zeus-offsite-.*\.db\.enc$/.test(f.Name))
    .map(f => ({ name: f.Name, size: Number(f.Size), mtime: Date.parse(f.ModTime) || undefined }));
  const free = Number.isFinite(Number(about.free)) ? Number(about.free) : NaN;
  const r = planOffsitePrune({
    files: entries, freeBytes: free, needBytes: Number(process.env.NEED),
    keepN: Number(process.env.KEEP_N), minKeep: Number(process.env.MIN_KEEP),
    headroom: 64 * 1024 * 1024,
  });
  console.log(JSON.stringify(r));
  ' 2>>"$LOG")

PLAN_OK=$(echo "$PLAN" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).ok?"1":"0")}catch(e){console.log("?")}})')
PLAN_REASON=$(echo "$PLAN" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).reason||"")}catch(e){console.log("plan nedecodabil")}})')

if [ "$PLAN_OK" = "0" ]; then
  fatal "nu incape offsite si retentia nu poate elibera destul — $PLAN_REASON"
fi
if [ "$PLAN_OK" = "?" ]; then
  log "WARN: planul de retentie nu s-a putut calcula ($PLAN_REASON) — continui fara pre-prune"
else
  log "plan retentie: $PLAN_REASON"
  echo "$PLAN" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{(JSON.parse(s).toDelete||[]).forEach(n=>console.log(n))}catch(e){}})' \
  | while IFS= read -r f; do
      [ -z "$f" ] && continue
      if [ "$DRY_RUN" = "1" ]; then
        log "DRY-RUN ar sterge offsite: $f"
      elif rclone deletefile "$REMOTE_PATH/$f" --drive-use-trash=false 2>>"$LOG"; then
        # --drive-use-trash=false: altfel fisierul merge in COSUL Drive si
        # continua sa ocupe cota, deci "stersul" nu elibereaza nimic.
        log "sters offsite (definitiv): $f"
      else
        log "WARN: nu s-a putut sterge offsite: $f"
      fi
    done
fi

if [ "$DRY_RUN" = "1" ]; then
  log "DRY-RUN: m-am oprit inainte de urcare (db $SZ -> gz $GZSZ, enc ${NEED}B)"
  exit 0
fi

# 3. upload offsite
# [2026-10-20 b289] Reincercare cu asteptare: cota Google Drive e EVENTUAL
# CONSISTENTA. Prima rulare a fix-ului a sters corect 1,4 GB, dar urcarea a
# pornit o secunda mai tarziu si Drive inca raporta cota veche -> 403
# storageQuotaExceeded desi spatiul exista (verificat imediat dupa: 1477 MiB
# liberi). Deci dupa un prune trebuie lasat timp de asezare, nu doar reincercat.
UPLOAD_OK=0
for attempt in 1 2 3; do
  if rclone copy "$ENC" "$REMOTE_PATH" --no-traverse 2>>"$LOG"; then
    UPLOAD_OK=1; break
  fi
  if [ "$attempt" -lt 3 ]; then
    log "urcarea a picat (incercarea $attempt/3) — astept 45s sa se asezeze cota remote"
    sleep 45
  fi
done
[ "$UPLOAD_OK" = "1" ] || fatal "rclone upload a picat spre $REMOTE_PATH (3 incercari)"
log "OK: uploaded $(basename "$ENC") (db $SZ → gz $GZSZ) → $REMOTE_PATH"

# 4. retention — keep the last KEEP_N offsite copies
OLD=$(rclone lsf "$REMOTE_PATH" 2>/dev/null | grep -E '^zeus-offsite-.*\.db\.enc$' | sort | head -n "-${KEEP_N}" || true)
if [ -n "$OLD" ]; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if rclone deletefile "$REMOTE_PATH/$f" --drive-use-trash=false 2>>"$LOG"; then log "pruned old offsite: $f"; fi
  done <<< "$OLD"
fi
exit 0
