#!/bin/bash
# Zeus Terminal — M1 Burn-In AUTOMATED Daily Check + Telegram Alert
#
# Cron wrapper around m1-burnin-daily-check.sh care:
# 1. Rulează daily SL coverage audit
# 2. Logs structured la /var/log/m1-burnin.log
# 3. Trimite Telegram admin alert DAR pe alarm only (exit 1 = no-SL detected)
#
# Cron schedule (recommended):
#   0 6,23 * * *  /root/zeus-terminal/scripts/m1-burnin-auto.sh
#
# Refs: M1_CLOSURE_HANDBOOK_20260514.md, MILESTONES §M1.7+M1.8
'use strict' >/dev/null 2>&1  # noop pentru a evita lint

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="/var/log/m1-burnin.log"
ENV_FILE="/root/zeus-terminal/.env"

# Acquire bot token + chat from env
BOT_TOKEN=$(grep "^TELEGRAM_BOT_TOKEN=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2)
ADMIN_CHAT=$(grep "^TG_ADMIN_CHAT_ID=\|^TELEGRAM_ADMIN_CHAT_ID=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d'=' -f2)
# Fallback: try ADMIN_CHAT from migration_flags or zeus log convention
[ -z "$ADMIN_CHAT" ] && ADMIN_CHAT="6029985138"  # known operator chat ID per memory

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
LINE_PREFIX="[$TS] [M1-BURNIN-AUTO]"

# Run daily check, capture output + exit code
OUTPUT=$(bash "$SCRIPT_DIR/m1-burnin-daily-check.sh" 2>&1) && EXIT=0 || EXIT=$?

# Extract verdict line
VERDICT=$(echo "$OUTPUT" | grep "^VERDICT:" | head -1 | sed 's/^VERDICT: *//')
[ -z "$VERDICT" ] && VERDICT="UNKNOWN (script error)"

# Log all output to /var/log
{
    echo "════════════════════════════════════════════════════════════════"
    echo "$LINE_PREFIX Run start"
    echo "$OUTPUT"
    echo "$LINE_PREFIX Exit code: $EXIT"
    echo "════════════════════════════════════════════════════════════════"
} >> "$LOG_FILE"

# Send Telegram alert ONLY on alarm (exit 1)
if [ "$EXIT" -eq 1 ] && [ -n "$BOT_TOKEN" ] && [ -n "$ADMIN_CHAT" ]; then
    MSG=$(cat <<MSGEOF
🚨🚨 *M1 BURN-IN ALARM* 🚨🚨

$VERDICT

Date: $(date -u +%Y-%m-%d)
Time: $TS

*IMMEDIATE ACTION:*
1. Check PM2: \`pm2 logs zeus --lines 100 | grep -i 'sl\\|safety'\`
2. Check audit_log pentru SAT_ENTRY_FILLED post-deploy
3. Consider emergency rollback: flag flip LIVE_ENTRY_UNIFIED=false
4. Investigate root cause + restart 14-day clock from 0

Log: $LOG_FILE
MSGEOF
)
    # URL encode message
    ENCODED_MSG=$(echo "$MSG" | python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read()))")
    curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
        -d "chat_id=${ADMIN_CHAT}" \
        -d "text=${ENCODED_MSG}" \
        -d "parse_mode=Markdown" \
        -o /dev/null && echo "$LINE_PREFIX Telegram alarm sent" >> "$LOG_FILE"
fi

# Send weekly summary on Mondays 06:00 UTC (regardless of alarm)
DOW=$(date -u +%u)  # 1=Mon
HOUR=$(date -u +%H)
if [ "$DOW" = "1" ] && [ "$HOUR" = "06" ] && [ -n "$BOT_TOKEN" ] && [ -n "$ADMIN_CHAT" ]; then
    # Weekly summary: last 7 days
    SUMMARY=$(grep -A 20 "Run start" "$LOG_FILE" | grep "VERDICT:" | tail -7 | sed 's/^VERDICT: *//' | nl)
    WEEKLY_MSG=$(cat <<WMEOF
📊 *M1 Burn-In Weekly Summary*

Last 7 days verdicts:
\`\`\`
$SUMMARY
\`\`\`

Current state: $VERDICT
Day of burn-in: ~$((($(date +%s) - $(date -d '2026-05-14' +%s)) / 86400)) of 14

Next milestone: Day 14 = 2026-05-28
WMEOF
)
    ENCODED_WEEKLY=$(echo "$WEEKLY_MSG" | python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read()))")
    curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
        -d "chat_id=${ADMIN_CHAT}" \
        -d "text=${ENCODED_WEEKLY}" \
        -d "parse_mode=Markdown" \
        -o /dev/null && echo "$LINE_PREFIX Telegram weekly summary sent" >> "$LOG_FILE"
fi

exit $EXIT
