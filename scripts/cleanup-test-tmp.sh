#!/usr/bin/env bash
# [2026-11-22] Curatarea saptamanala a dosarelor lasate de teste in /tmp.
#
# Fiecare rulare de teste (jest/vitest) isi face in /tmp un dosar cu o baza de date de
# proba (`r5-post-AbC123`, `omega-w3-p150-XyZ789`, `doctor-seed-…`); multe teste nu-l
# sterg la final. Pe 22 nov erau ~28.000 de dosare, 29 GB. Nimic nu le citeste dupa test.
#
# Reguli de siguranta:
#   - doar dosare de pe primul nivel din TMP_ROOT (implicit /tmp),
#   - doar nume de forma `prefix-XXXXXX` (6 caractere aleatoare, ca la mkdtemp),
#   - doar mai vechi de MIN_AGE_MIN minute (implicit 2 zile),
#   - nu ruleaza deloc daca exact atunci ruleaza teste (jest/vitest).
# Programat: crontab root, duminica 04:00 UTC (dupa backup-ul offsite de la 03:30).
set -u
TMP_ROOT="${TMP_ROOT:-/tmp}"
MIN_AGE_MIN="${MIN_AGE_MIN:-2880}"
LOG="${LOG:-/opt/zeus-terminal/data/logs/cleanup-test-tmp.log}"
NAME_RE="${TMP_ROOT%/}/[A-Za-z0-9._-]+-[A-Za-z0-9]{6}"

ts() { date -u +'%Y-%m-%d %H:%M:%S'; }

if [ -z "${SKIP_RUNNING_CHECK:-}" ] && pgrep -f 'jest|vitest' >/dev/null 2>&1; then
    echo "$(ts) SKIP: teste in curs" >> "$LOG"
    exit 0
fi

before=$(du -sk "$TMP_ROOT" 2>/dev/null | awk '{print $1}')
n=$(find "$TMP_ROOT" -maxdepth 1 -mindepth 1 -type d -mmin +"$MIN_AGE_MIN" \
        -regextype posix-extended -regex "$NAME_RE" -print 2>/dev/null | wc -l)
find "$TMP_ROOT" -maxdepth 1 -mindepth 1 -type d -mmin +"$MIN_AGE_MIN" \
     -regextype posix-extended -regex "$NAME_RE" -exec rm -rf {} + 2>/dev/null
after=$(du -sk "$TMP_ROOT" 2>/dev/null | awk '{print $1}')
freed=$(( (${before:-0} - ${after:-0}) / 1024 ))
echo "$(ts) OK: sterse $n dosare de test, eliberat ~${freed} MB" >> "$LOG"
