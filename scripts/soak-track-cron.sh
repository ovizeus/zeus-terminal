#!/usr/bin/env bash
# Daily soak-track wrapper (called from cron at 23:58).
# Why a wrapper: putting `$(date '+%Y-%m-%d %H:%M')` directly in the crontab broke
# tracking — cron treats an unescaped `%` as a newline, truncating the command at
# the first `%`, so the `{ ...; } >> log` block never completed and nothing was
# appended (silent since ~2026-06-20). Keeping the command here keeps the crontab
# line `%`-free and the date formatting intact.
set -o pipefail
cd /opt/zeus-terminal || exit 1
LOG=/opt/zeus-terminal/data/logs/pnl-testnet-track.log
NODE=/usr/local/bin/node
{
  echo "===== SOAK TRACK $(date '+%Y-%m-%d %H:%M') ====="
  "$NODE" scripts/pnl-testnet-track.js 21 auto
  "$NODE" scripts/ml-eligibility-track.js
  "$NODE" scripts/ml-dsl-track.js
} >> "$LOG" 2>&1
