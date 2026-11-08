#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
# [2026-11-08] Deploys the last of the multi-user autotrade fixes and PROVES
# whether it worked, in one command.
#
# Why this exists: the first three fixes are already live (accounts receiving
# brain decisions went from 1 to 6). The fourth — fetching bybit candle history
# over REST — is written, tested and verified against 200 real Bybit bars, but
# it only takes effect on a restart, and the assistant's reload was refused by
# the permission classifier as a production deploy.
#
# Safe to run twice. It reads the live database read-only and never writes to it.
# ──────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd /opt/zeus-terminal || exit 1

echo "── 1/4  Checking version.js before touching anything (R-OP-6)"
node -e "const v=require('./server/version.js'); if(!v.version||!v.build) {console.error('version.js invalid — ABORT'); process.exit(1);} console.log('    OK', v.version, 'b'+v.build);" || exit 1

echo "── 2/4  Reloading"
sudo -u zeus pm2 reload zeus --update-env >/dev/null 2>&1 || { echo "    reload FAILED"; exit 1; }
echo "    reloaded"

echo "── 3/4  Waiting out the boot warm gate (the seed retries at 20s/45s/90s/180s)"
for i in $(seq 1 10); do
    sleep 30
    if grep -q "history seeded: [1-9]" data/logs/zeus.log 2>/dev/null; then break; fi
    echo "    ...$((i*30))s"
done

echo "── 4/4  Verdict"
echo
echo "  Bybit candle history:"
grep -oE "history seeded: [0-9]+ bars over [0-9]+ symbol/timeframe pairs" data/logs/zeus.log | tail -1 | sed 's/^/    /'
echo
echo "  Engine state restored for:"
grep -oE "State restored uid=[0-9]+" data/logs/zeus.log | tail -10 | sort -u | tr '\n' ' ' | sed 's/^/    /'; echo
echo
echo "  Accounts receiving brain decisions in the last 5 minutes:"
sudo -u zeus sqlite3 -readonly data/zeus.db \
  "SELECT '    uid='||user_id||'  ('||COUNT(*)||' decisions)' FROM brain_decisions
   WHERE ts > (strftime('%s','now')-300)*1000 GROUP BY user_id;" 2>/dev/null
echo
if sudo -u zeus sqlite3 -readonly data/zeus.db \
   "SELECT 1 FROM brain_decisions WHERE user_id=2 AND ts > (strftime('%s','now')-300)*1000 LIMIT 1;" 2>/dev/null | grep -q 1; then
    echo "  ✅ uid=2 (the bybit account) IS receiving decisions — the chain is complete."
else
    echo "  ⚠️  uid=2 still has no decisions. Give it a few more minutes, or send this"
    echo "      output back and the work continues from here."
fi
echo
echo "  Errors since the reload:"
sudo -u zeus pm2 logs zeus --nostream --lines 60 2>/dev/null | grep -cE "\[ERROR\]" | sed 's/^/    /'
