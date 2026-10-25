#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# G-8 — a fost refuzul gărzii cauza dominantă a pending-urilor orfane?
# ──────────────────────────────────────────────────────────────────────
#
# Ipoteza (scrisă 2026-10-25, ÎNAINTE de a avea datele): pe calea pending,
# `updateAction` era chemat doar înăuntrul lui `if (entry)`, deci un pending
# declanşat şi refuzat de autotrade rămânea `pending_created` pe veci — 33 677
# de rânduri, 43% din toate. b318 a adăugat ramura `else`, care scrie
# `pending_blocked`.
#
# Criteriul, cu ambele ramuri scrise dinainte:
#   • `pending_blocked` creşte ŞI orfanii scad aproape la zero → ipoteza era
#     CORECTĂ.
#   • orfanii rămân la 33–52% iar `pending_blocked` stă mic → ipoteza era
#     GREŞITĂ, cauza e alta (probabil simboluri scoase din selecţie, unde
#     `checkPending` nu mai e chemat deloc) — şi se scrie ca RETRACTARE.
#
# De ce fereastra se opreşte cu 2 ore în urmă: un rând rămâne `pending_created`
# şi cât timp pending-ul e ÎNCĂ DESCHIS. Un pending în aşteptare şi un orfan
# arată identic în tabelă. Două ore sunt mult peste durata unui pending, deci
# ce e încă `pending_created` acolo chiar n-a ajuns niciodată la o stare finală.
#
# DOAR SELECT. Nu scrie nimic în baza de date (R-OP-13).
# Rulare:  sudo -u zeus bash scripts/g8-check.sh

set -euo pipefail
# cron porneste cu un PATH minimal — fixeaza-l, altfel `sqlite3` nu se gaseste
export PATH=/usr/local/bin:/usr/bin:/bin

DB="/opt/zeus-terminal/data/zeus.db"
BASELINE=1792956933593          # repornirea care a adus b318 — 2026-10-25 19:35:33
CUTOFF=$(( $(date +%s)000 - 7200000 ))   # acum minus 2 ore

echo "═══ G-8 — $(date '+%Y-%m-%d %H:%M:%S') ═══"
echo "reper: b318 pornit la $(date -d @$((BASELINE/1000)) '+%Y-%m-%d %H:%M:%S')"
echo "ore scurse de atunci: $(( ($(date +%s)000 - BASELINE) / 3600000 ))"
echo

echo "── pâlnia pending-urilor create DUPĂ b318 (doar cele mai vechi de 2h) ──"
echo "   (gol = încă nu s-au adunat pending-uri mai vechi de 2h de la repornire)"
sqlite3 -column -header "$DB" "
SELECT final_action AS stare,
       COUNT(*)     AS randuri,
       ROUND(100.0 * COUNT(*) / NULLIF((SELECT COUNT(*) FROM brain_decisions
           WHERE ts > $BASELINE AND ts < $CUTOFF
             AND final_action LIKE 'pending_%'), 0), 1) AS procent
FROM brain_decisions
WHERE ts > $BASELINE AND ts < $CUTOFF AND final_action LIKE 'pending_%'
GROUP BY 1 ORDER BY 2 DESC;"

echo
echo "── verdictul, pe cifre ──"
sqlite3 "$DB" "
WITH w AS (SELECT final_action a FROM brain_decisions
           WHERE ts > $BASELINE AND ts < $CUTOFF AND final_action LIKE 'pending_%')
SELECT 'pending-uri create in fereastra: ' || COUNT(*) FROM w
UNION ALL SELECT 'inca pending_created (ORFANI): ' || COALESCE(SUM(a='pending_created'),0) FROM w
UNION ALL SELECT 'pending_blocked (refuz scris): ' || COALESCE(SUM(a='pending_blocked'),0) FROM w
UNION ALL SELECT 'rata orfanilor ACUM: ' ||
  COALESCE(ROUND(100.0*SUM(a='pending_created')/NULLIF(COUNT(*),0),1),'-') || '%  (istoric: 33-52%)'
FROM w;"

echo
echo "── pentru comparaţie, totalurile istorice ──"
sqlite3 -column "$DB" "
SELECT final_action, COUNT(*) FROM brain_decisions
WHERE final_action LIKE 'pending_%' GROUP BY 1 ORDER BY 2 DESC;"
