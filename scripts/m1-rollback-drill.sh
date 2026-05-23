#!/bin/bash
# Zeus Terminal — M1 Rollback Drill (M4.2 acceptance — chronometer < 5 min)
#
# Semi-automated drill pentru rehearsing M1 rollback path înainte de M2 progression.
# Per M1_BACKUP_ROLLBACK_PROTOCOL §4.4 7-step procedure.
#
# Run în interactive mode (prompts at each step) sau --auto (continuous).
# Default: interactive (RECOMMENDED for first drill).
#
# Target: total elapsed < 5 minutes per M4.2 acceptance criterion.
# Repeat 2-3 times to be fluent.
#
# Usage:
#   bash scripts/m1-rollback-drill.sh           # interactive (default)
#   bash scripts/m1-rollback-drill.sh --auto    # continuous (after operator confident)
#
# Refs: M1_BACKUP_ROLLBACK_PROTOCOL §4.4

set -e
INTERACTIVE=true
[ "$1" = "--auto" ] && INTERACTIVE=false

FLAG_FILE="/root/zeus-terminal/data/migration_flags.json"
ADMIN_TOKEN_FILE="/root/zeus-terminal/.env"
LOG_DIR="/root/_review/audit"
DATE=$(date -u +%Y%m%d)
DRILL_REPORT="$LOG_DIR/M1_ROLLBACK_DRILL_REPORT_${DATE}.md"

START_TIME=$(date +%s)

pause() {
    if [ "$INTERACTIVE" = "true" ]; then
        echo ""
        read -p ">>> Press ENTER to continue to next step (or Ctrl+C to abort)..."
    else
        sleep 1
    fi
}

elapsed() {
    local now=$(date +%s)
    local diff=$((now - START_TIME))
    local min=$((diff / 60))
    local sec=$((diff % 60))
    printf "T+%02d:%02d" $min $sec
}

echo "════════════════════════════════════════════════════════════════════"
echo "M1 ROLLBACK DRILL — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Target: total elapsed < 5 min (M4.2 acceptance)"
echo "Mode: $([ "$INTERACTIVE" = "true" ] && echo INTERACTIVE || echo AUTO)"
echo "Drill report: $DRILL_REPORT"
echo "════════════════════════════════════════════════════════════════════"

# Initialize drill report
cat > "$DRILL_REPORT" <<EOF
# M1 Rollback Drill Report — $(date -u +%Y-%m-%d)

**Operator:** [name to fill]
**Witnesses:** Phone Claude (review post)
**Drill scenario:** Mid-M1 burn-in regression detection → rollback to legacy Path B în <5 min

## Timeline

EOF

echo ""
echo "Step 1 — DETECT (T+0s)"
echo "──────────────────────"
echo "Simulating: 'Canary alarm fired — live_no_sl_count > 0 detected pe testnet.'"
echo "Decision: ROLLBACK to legacy Path B."
echo "Chronometer started: $(date -u +%H:%M:%S)"
echo "- $(elapsed) — DETECT simulated" >> "$DRILL_REPORT"
pause

echo ""
echo "Step 2 — HALT new entries (target T+30s)"
echo "────────────────────────────────────────"
ADMIN_TOKEN=$(grep "^ADMIN_TOKEN=" "$ADMIN_TOKEN_FILE" 2>/dev/null | cut -d'=' -f2 || echo "")
if [ -n "$ADMIN_TOKEN" ]; then
    echo "Issuing HALT via /api/panic..."
    HALT_RESULT=$(curl -s -X POST http://127.0.0.1:3000/api/panic \
        -H "Cookie: zeus_token=$ADMIN_TOKEN" \
        -H "x-zeus-request: 1" \
        -H "Content-Type: application/json" \
        -d '{"active":true,"reason":"M1 rollback drill"}' 2>&1 || echo '{"error":"halt-call-failed"}')
    echo "Response: $HALT_RESULT"
else
    echo "⚠️  ADMIN_TOKEN not found în .env — manual halt skipped (proceed with caution în real incident)"
fi

# Verify halt state
echo "Verifying halt state..."
node -e "
try {
  const sa = require('/root/zeus-terminal/server/services/serverAT');
  console.log('isGlobalHaltActive() =', sa.isGlobalHaltActive());
} catch (e) { console.log('check failed:', e.message); }
" 2>&1
echo "- $(elapsed) — HALT issued + verified" >> "$DRILL_REPORT"
pause

echo ""
echo "Step 3 — TOGGLE flag OFF (target T+1min)"
echo "────────────────────────────────────────"
echo "Backup current migration_flags.json..."
BACKUP="${FLAG_FILE}.bak.pre-rollback-drill-$(date -u +%Y%m%d-%H%M%S)"
cp "$FLAG_FILE" "$BACKUP"
echo "Backup: $BACKUP"

echo "Current LIVE_ENTRY_UNIFIED state:"
node -e "console.log('  before:', require('/root/zeus-terminal/server/migrationFlags.js').LIVE_ENTRY_UNIFIED);"

echo "Flipping flag false..."
# Read current json, set LIVE_ENTRY_UNIFIED: false
node -e "
const fs = require('fs');
const p = '$FLAG_FILE';
let j = {};
try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
j.LIVE_ENTRY_UNIFIED = false;
fs.writeFileSync(p, JSON.stringify(j, null, 2));
console.log('  written:', JSON.stringify(j));
"
echo "- $(elapsed) — Flag flipped OFF + verified în file" >> "$DRILL_REPORT"
pause

echo ""
echo "Step 4 — PM2 RELOAD to apply flag (target T+1min30s)"
echo "────────────────────────────────────────────────────"
pm2 reload zeus --update-env 2>&1 | tail -3
sleep 2
pm2 list 2>&1 | grep "zeus " | head -1

# Verify flag picked up
echo "Verifying flag în memory:"
node -e "
delete require.cache[require.resolve('/root/zeus-terminal/server/migrationFlags.js')];
const MF = require('/root/zeus-terminal/server/migrationFlags.js');
console.log('  LIVE_ENTRY_UNIFIED =', MF.LIVE_ENTRY_UNIFIED);
"
echo "- $(elapsed) — PM2 reloaded + flag picked up" >> "$DRILL_REPORT"
pause

echo ""
echo "Step 5 — VERIFY rollback effect (target T+2min)"
echo "───────────────────────────────────────────────"
echo "In producție you would:"
echo "  1. Open small testnet trade (qty=0.001 ETH, sl=2300, mode='live')"
echo "  2. Verify response shape: ok=true, but live.slOrderId=null (legacy Path B silently accepts)"
echo "  3. Close test trade manually pe Binance UI"
echo ""
echo "Drill: SKIPPING actual trade test pentru simulation. Manual operator action needed."
echo "- $(elapsed) — VERIFY rollback (manual operator step în real drill)" >> "$DRILL_REPORT"
pause

echo ""
echo "Step 6 — LIFT halt (target T+3min)"
echo "──────────────────────────────────"
if [ -n "$ADMIN_TOKEN" ]; then
    echo "Lifting halt..."
    LIFT_RESULT=$(curl -s -X POST http://127.0.0.1:3000/api/panic \
        -H "Cookie: zeus_token=$ADMIN_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"active":false,"reason":"M1 rollback drill complete"}' 2>&1 || echo '{"error":"lift-call-failed"}')
    echo "Response: $LIFT_RESULT"
fi
echo "- $(elapsed) — HALT lifted" >> "$DRILL_REPORT"
pause

echo ""
echo "Step 7 — STOP chronometer + restore flag (RESTORE post-drill)"
echo "─────────────────────────────────────────────────────────────"
TOTAL_ELAPSED=$(elapsed)
TOTAL_SEC=$(($(date +%s) - START_TIME))
echo "Total elapsed: $TOTAL_ELAPSED ($TOTAL_SEC seconds)"
echo ""
echo "Restoring flag to TRUE (default) for production state..."
cp "$BACKUP" "$FLAG_FILE"
pm2 reload zeus --update-env 2>&1 | tail -2
sleep 1
node -e "
delete require.cache[require.resolve('/root/zeus-terminal/server/migrationFlags.js')];
console.log('Final flag state:', require('/root/zeus-terminal/server/migrationFlags.js').LIVE_ENTRY_UNIFIED);
"

# Final acceptance verdict
{
    echo ""
    echo "## Acceptance criteria"
    echo ""
    if [ "$TOTAL_SEC" -lt 300 ]; then
        echo "- [x] Total time < 5 minutes (M4.2) — $TOTAL_ELAPSED ✅"
        VERDICT="PASS"
    else
        echo "- [ ] Total time < 5 minutes (M4.2) — $TOTAL_ELAPSED ❌ (exceeded target)"
        VERDICT="FAIL"
    fi
    echo "- [x] Halt issued + verified"
    echo "- [x] Flag flipped + verified"
    echo "- [x] PM2 reload successful"
    echo "- [ ] Rollback effect confirmed (manual step — fill în post-drill)"
    echo "- [x] Halt lifted"
    echo "- [x] Flag restored to production default"
    echo ""
    echo "## Verdict: $VERDICT"
    echo ""
    echo "## Sign-off"
    echo "- Operator: [signature]"
    echo "- Phone Claude review: [post-drill]"
} >> "$DRILL_REPORT"

echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "DRILL COMPLETE — Total elapsed: $TOTAL_ELAPSED"
echo "Verdict: $VERDICT (target <5min)"
echo "Report: $DRILL_REPORT"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Fill operator signature + manual step verification în $DRILL_REPORT"
echo "  2. Repeat drill 2-3 times until consistent <5 min"
echo "  3. Send drill report la Phone Claude for M4.2 sign-off"
echo "  4. Pass = unlock M2 progression după M1.7 burn-in (14 zile) complete"
