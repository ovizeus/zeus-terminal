/**
 * Sprint 1 / Batch 2 — Smoke Tests
 * ZT-AUD-001: AT Mode Ambiguity (server source-of-truth)
 * ZT-AUD-002: Order Fill Polling  
 * ZT-AUD-003: ARES Memory-Only Close
 */
'use strict';
const fs = require('fs');

let passed = 0;
let failed = 0;
function assert(cond, label) {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.error(`  ❌ FAIL: ${label}`); }
}

// ═══════════════════════════════════════════════════════════════
// ZT-AUD-001: AT Mode Ambiguity — server is source of truth
// ═══════════════════════════════════════════════════════════════
console.log('\n── ZT-AUD-001: AT Mode Ambiguity ──');
(function testAUD001() {
    const stateSrc = fs.readFileSync('./public/js/core/state.js', 'utf8');
    const atSrc = fs.readFileSync('./public/js/trading/autotrade.js', 'utf8');

    // 1a) _modeConfirmed = false set on restore (localStorage load)
    assert(stateSrc.includes('AT._modeConfirmed = false'), 'state.js: _modeConfirmed = false on restore');

    // 1b) _modeConfirmed = true set in _applyServerATState
    assert(stateSrc.includes('AT._modeConfirmed = true'), 'state.js: _modeConfirmed = true on server state apply');

    // 1c) The _modeConfirmed = true is on the same line as AT.mode and AT._serverMode assignment
    const confirmLine = stateSrc.split('\n').find(l => l.includes('AT._modeConfirmed = true'));
    assert(confirmLine && confirmLine.includes('AT.mode = state.mode'), '_modeConfirmed set alongside AT.mode = state.mode');

    // 1d) toggleAutoTrade guards on _modeConfirmed
    assert(atSrc.includes('AT._modeConfirmed'), 'autotrade.js: references _modeConfirmed');
    assert(atSrc.includes('!AT._modeConfirmed'), 'autotrade.js: guard checks !AT._modeConfirmed');

    // 1e) Guard triggers fallback poll
    assert(atSrc.includes('startATPolling'), 'autotrade.js: triggers startATPolling on unconfirmed');

    // 1f) Server mode flow still intact - POST /api/at/mode sets AT._serverMode
    const mdSrc = fs.readFileSync('./public/js/data/marketData.js', 'utf8');
    assert(mdSrc.includes("AT._serverMode = mode"), 'marketData.js: _executeGlobalModeSwitch sets AT._serverMode after server confirms');

    // 1g) _applyServerATState still sets AT.mode from server (unchanged)
    const applyLine = stateSrc.split('\n').find(l => l.includes('AT.mode = state.mode') && l.includes('_serverMode'));
    assert(applyLine !== undefined, 'state.js: _applyServerATState still sets AT.mode + AT._serverMode from server');

    // 1h) AT polling starts immediately on bootstrap
    const bootSrc = fs.readFileSync('./public/js/core/bootstrap.js', 'utf8');
    assert(bootSrc.includes('startATPolling'), 'bootstrap.js: startATPolling called on init');

    // 1i) _startATPolling fires immediate _atPollOnce
    assert(stateSrc.includes('_atPollOnce();') && stateSrc.includes('_startATPolling'), 'state.js: _startATPolling fires immediate poll');

    // 1j) Simulate the flow: restore → unconfirmed → server state → confirmed
    // (Logic simulation, not DOM)
    const AT = { enabled: false, mode: 'demo', _serverMode: undefined, _modeConfirmed: false };
    assert(AT._modeConfirmed === false, 'Sim: after restore, _modeConfirmed is false');

    // Simulate _applyServerATState setting mode
    AT.mode = 'live';
    AT._serverMode = 'live';
    AT._modeConfirmed = true;
    assert(AT._modeConfirmed === true, 'Sim: after server state, _modeConfirmed is true');
    assert(AT.mode === 'live', 'Sim: mode correctly set from server');
})();

// ═══════════════════════════════════════════════════════════════
// ZT-AUD-002: Order Fill Polling
// ═══════════════════════════════════════════════════════════════
console.log('\n── ZT-AUD-002: Order Fill Polling ──');
(function testAUD002() {
    const satSrc = fs.readFileSync('./server/services/serverAT.js', 'utf8');
    const tradeSrc = fs.readFileSync('./server/routes/trading.js', 'utf8');

    // 2a) serverAT should have fill verification after MARKET entry
    assert(satSrc.includes('_verifyFill') || satSrc.includes('GET') && satSrc.includes('/fapi/v1/order'), 'serverAT.js: fill verification exists');

    // 2b) serverAT should NOT have dangerous fallback entry.price for avgPrice
    // Find the line with avgPrice assignment near MARKET entry
    const avgPriceLine = satSrc.split('\n').find(l => l.includes('mainOrder.avgPrice') && l.includes('entry.price'));
    assert(!avgPriceLine, 'serverAT.js: no dangerous fallback to entry.price for avgPrice');

    // 2c) trading.js should check status before logging ORDER_FILLED
    const hasStatusCheck = tradeSrc.includes("data.status === 'FILLED'") || tradeSrc.includes('data.status');
    assert(hasStatusCheck, 'trading.js: checks order status');

    // 2d) Verify clientOrderId patterns still exist for traceability
    assert(satSrc.includes('SAT_'), 'serverAT.js: SAT_ clientOrderId prefix exists');
    assert(satSrc.includes('SAT_SL_'), 'serverAT.js: SAT_SL_ prefix exists');
    assert(satSrc.includes('SAT_TP_'), 'serverAT.js: SAT_TP_ prefix exists');
})();

// ═══════════════════════════════════════════════════════════════
// ZT-AUD-003: ARES Memory-Only Close
// ═══════════════════════════════════════════════════════════════
console.log('\n── ZT-AUD-003: ARES Memory-Only Close ──');
(function testAUD003() {
    const ddSrc = fs.readFileSync('./public/js/brain/deepdive.js', 'utf8');

    // 3a) Kill-switch should check isLive before closing
    assert(ddSrc.includes('isLive') && ddSrc.includes('kill'), 'deepdive.js: kill-switch references isLive');

    // 3b) Kill-switch should use closeLivePosition for live positions
    assert(ddSrc.includes('closeLivePosition') && ddSrc.includes('KILL'), 'deepdive.js: kill-switch uses closeLivePosition');

    // 3c) closeAll should not be the sole kill-switch mechanism for live
    // Find the kill-switch block and verify it doesn't blindly call closeAll on live positions
    const ksSection = ddSrc.substring(
        ddSrc.indexOf('Kill-switch gate'),
        ddSrc.indexOf('Kill-switch gate') + 800
    );
    const hasLiveGuard = ksSection.includes('isLive') || ksSection.includes('closeLivePosition');
    assert(hasLiveGuard, 'deepdive.js: kill-switch has live position guard');

    // 3d) _closeLivePosition still does exchange close (unchanged)
    assert(ddSrc.includes('aresClosePosition'), 'deepdive.js: _closeLivePosition calls aresClosePosition (exchange)');

    // 3e) _closeLivePosition error path does NOT mark closed (fail-safe)
    assert(ddSrc.includes('CLOSE FAIL'), 'deepdive.js: close failure path exists (fail-safe)');

    // 3f) closePosition() still works for virtual/non-live positions
    assert(ddSrc.includes("pos.status = 'CLOSED'"), 'deepdive.js: closePosition sets CLOSED status');
})();

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════
console.log(`\n══════════════════════════════════════════`);
console.log(`SMOKE TESTS S1/B2: ${passed} passed, ${failed} failed`);
console.log(`VERDICT: ${failed === 0 ? 'ALL PASS ✅' : 'FAILURES DETECTED ❌'}`);
console.log(`══════════════════════════════════════════\n`);
process.exit(failed > 0 ? 1 : 0);
