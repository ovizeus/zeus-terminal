#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
# [2026-11-09] Deploys the remaining server repairs and PROVES the state.
#
# Everything else is already live. What this turns on:
#   • the candle-history watchdog — refills any symbol below the 50-bar line
#     every 5 minutes, at most 3 per pass so the repair cannot become a burst
#   • the boot guard — never fires the history fetch into an active IP ban,
#     which is the cascade that caused the 21:16–02:21 outage
#
# Neither is urgent: the system recovered on its own at 02:21 and all eight
# accounts are trading. These only make the NEXT unlucky restart heal in
# minutes instead of hours.
#
# Reads the live database read-only and never writes to it. Safe to re-run.
# ──────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd /opt/zeus-terminal || exit 1

echo "── 1/5  version.js (R-OP-6)"
node -e "const v=require('./server/version.js'); if(!v.version||!v.build){console.error('   version.js invalid — ABORT');process.exit(1)} console.log('   OK', v.version, 'b'+v.build);" || exit 1

echo "── 2/5  Is Binance quiet right now? (reloading into a ban is what hurt us)"
sudo -u zeus sqlite3 -readonly data/zeus.db \
  "SELECT '   ban='||banned_until||'  warm='||warm_until||'  strikes='||consecutive_ban_count FROM binance_rate_state;"
NOW_MS=$(( $(date +%s) * 1000 ))
BAN=$(sudo -u zeus sqlite3 -readonly data/zeus.db "SELECT banned_until FROM binance_rate_state;")
if [ "${BAN:-0}" -gt "$NOW_MS" ]; then
    echo "   A ban is ACTIVE. Stopping — try again once it clears."
    echo "   (With the guard deployed this would be safe; it is not deployed yet.)"
    exit 1
fi
echo "   clear"

echo "── 3/5  Reloading"
sudo -u zeus pm2 reload zeus --update-env >/dev/null 2>&1 || { echo "   reload FAILED"; exit 1; }
echo "   reloaded"

echo "── 4/5  Letting it settle"
sleep 90

echo "── 5/5  Verdict"
echo
echo "  Candle history fetched at boot (0 would mean it was refused):"
grep -oE "[A-Z]+ [0-9a-z]+: [0-9]+ initial candles" data/logs/zeus.log | tail -4 | sed 's/^/    /'
echo
echo "  Engine state restored for:"
grep -oE "State restored uid=[0-9]+" data/logs/zeus.log | tail -10 | sort -u | tr '\n' ' ' | sed 's/^/    /'; echo
echo
echo "  Accounts receiving brain decisions in the last 3 minutes:"
sudo -u zeus sqlite3 -readonly data/zeus.db \
  "SELECT '    uid='||user_id||'  ('||COUNT(*)||')' FROM brain_decisions
   WHERE ts > (strftime('%s','now')-180)*1000 GROUP BY user_id;" 2>/dev/null
N=$(sudo -u zeus sqlite3 -readonly data/zeus.db "SELECT COUNT(DISTINCT user_id) FROM brain_decisions WHERE ts > (strftime('%s','now')-180)*1000;" 2>/dev/null)
echo
if [ "${N:-0}" -ge 8 ]; then
    echo "  ✅ All 8 accounts are in. Nothing further to do."
else
    echo "  ⏳ Only ${N:-0} so far — symbols cross the 50-bar line one at a time."
    echo "     The watchdog is now running; re-run this script in ten minutes."
fi
echo
echo "  Errors since the reload:"
sudo -u zeus pm2 logs zeus --nostream --lines 60 2>/dev/null | grep -cE "\[ERROR\]" | sed 's/^/    /'
