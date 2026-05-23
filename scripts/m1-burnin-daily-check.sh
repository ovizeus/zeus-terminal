#!/bin/bash
# Zeus Terminal — M1 Burn-In Daily SQL Audit (M1.7 + M1.8 acceptance)
#
# Run daily during M1 burn-in (14 zile observation post-deploy 2026-05-14).
# Verifies SL coverage 100% pe live trades closed that day — canary metric
# pentru M1.8 acceptance criterion.
#
# Exit code: 0 = clean (all live trades cu SL on Binance), 1 = no-SL detected
# Output: structured one-line summary + detail breakdown
#
# Recommended cron: daily 23:55 UTC + 06:00 UTC morning check
# Or invoke ad-hoc: bash scripts/m1-burnin-daily-check.sh [YYYY-MM-DD]
#
# Refs: MILESTONES_M1-M8 §M1.8 + §M2.2 + §M2.4

set -e
DATE="${1:-$(date -u +%Y-%m-%d)}"
DB="/root/zeus-terminal/data/zeus.db"
LOG_DIR="/root/_review/audit/m1_burnin_logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/burnin-${DATE}.log"

echo "════════════════════════════════════════════════════════════════════"
echo "M1 Burn-In Daily SL Coverage Audit — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Target date: $DATE"
echo "════════════════════════════════════════════════════════════════════"

# Query at_closed positions closed pe $DATE — count total live + no_sl breakdown
RESULT=$(sqlite3 "$DB" "
SELECT
  COUNT(*) AS total_live,
  SUM(CASE WHEN json_extract(data,'\$.live.slOrderId') IS NULL THEN 1 ELSE 0 END) AS no_sl,
  SUM(CASE WHEN json_extract(data,'\$.live.slOrderId') IS NOT NULL THEN 1 ELSE 0 END) AS with_sl
FROM at_closed
WHERE json_extract(data,'\$.mode') = 'live'
  AND date(closed_at) = '$DATE';
")

TOTAL=$(echo "$RESULT" | cut -d'|' -f1)
NO_SL=$(echo "$RESULT" | cut -d'|' -f2)
WITH_SL=$(echo "$RESULT" | cut -d'|' -f3)
NO_SL=${NO_SL:-0}
WITH_SL=${WITH_SL:-0}
TOTAL=${TOTAL:-0}

if [ "$TOTAL" -eq 0 ]; then
    PCT_NO_SL="N/A"
    VERDICT="🟡 NO_DATA — no live trades closed on $DATE"
    EXIT=0
elif [ "$NO_SL" -eq 0 ]; then
    PCT_NO_SL="0.00%"
    VERDICT="🟢 CLEAN — 100% SL coverage ($WITH_SL/$WITH_SL live trades cu SL)"
    EXIT=0
else
    PCT_NO_SL=$(echo "scale=2; $NO_SL * 100 / $TOTAL" | bc)
    VERDICT="🔴 FAIL — ${PCT_NO_SL}% no-SL detected ($NO_SL/$TOTAL)"
    EXIT=1
fi

# External positions (sync via _syncExternalPosition) count
EXTERNAL_COUNT=$(sqlite3 "$DB" "
SELECT COUNT(*) FROM at_closed
WHERE json_extract(data,'\$.source') = 'external'
  AND date(closed_at) = '$DATE';
" || echo "0")
EXTERNAL_COUNT=${EXTERNAL_COUNT:-0}

# Total positions opened (active + closed) on this date
OPENED_TODAY=$(sqlite3 "$DB" "
SELECT COUNT(*) FROM at_closed
WHERE date(opened_at) = '$DATE' OR date(closed_at) = '$DATE';
" 2>/dev/null || echo "0")

# Print report
{
  echo "VERDICT:     $VERDICT"
  echo "Date:        $DATE"
  echo ""
  echo "Live trades breakdown:"
  echo "  Total closed:    $TOTAL"
  echo "  With SL (✅):   $WITH_SL"
  echo "  Without SL (❌): $NO_SL"
  echo "  % no-SL:        $PCT_NO_SL"
  echo ""
  echo "External sync:"
  echo "  External positions closed: $EXTERNAL_COUNT"
  echo ""
  echo "Volume:"
  echo "  Positions opened/closed today: $OPENED_TODAY"
  echo ""
  echo "════════════════════════════════════════════════════════════════════"
  if [ "$EXIT" -eq 1 ]; then
    echo "⚠️  ALARM: NO-SL detected. Investigate immediately:"
    echo "   - Check PM2 logs: pm2 logs zeus --lines 100 | grep -i 'sl\\|safety'"
    echo "   - Check audit_log: SELECT * FROM audit_log WHERE action='SAT_ENTRY_FILLED' AND created_at > '$DATE 00:00:00'"
    echo "   - Consider emergency flag flip: LIVE_ENTRY_UNIFIED=false + PM2 reload"
  fi
} | tee "$LOG_FILE"

# Summary one-liner pentru cron alert (last line if EXIT=1)
if [ "$EXIT" -eq 1 ]; then
    echo "[M1-BURNIN-ALARM] $DATE: ${PCT_NO_SL} no-SL ($NO_SL/$TOTAL) — IMMEDIATE INVESTIGATION REQUIRED" >&2
fi

exit $EXIT
