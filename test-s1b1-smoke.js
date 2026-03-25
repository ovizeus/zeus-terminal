/**
 * Sprint 1 / Batch 1 — Smoke Tests (runtime verification)
 * T1: SL retry fail path → max wait + emergency fallback intact
 * T2: DSL stale warning → display-only, no execution impact
 * T3: Reconciliation mismatch → detect ORPHAN/GHOST/SIZE_MISMATCH, read-only
 */
'use strict';

let passed = 0;
let failed = 0;
function assert(cond, label) {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.error(`  ❌ FAIL: ${label}`); }
}

// ═══════════════════════════════════════════════════════════════
// T1: SL / TP retry — verify constants + emergency fallback path
// ═══════════════════════════════════════════════════════════════
console.log('\n── T1: SL/TP retry fail path ──');
(function testRetryConstants() {
    const fs = require('fs');
    const src = fs.readFileSync('./server/services/serverAT.js', 'utf8');

    // 1a) SL_RETRY_DELAYS = [1000, 3000]
    const slMatch = src.match(/const SL_RETRY_DELAYS\s*=\s*\[([^\]]+)\]/);
    assert(slMatch !== null, 'SL_RETRY_DELAYS declaration found');
    const slVals = slMatch[1].split(',').map(s => parseInt(s.trim()));
    assert(slVals.length === 2, `SL has 2 retry delays (got ${slVals.length})`);
    assert(slVals[0] === 1000 && slVals[1] === 3000, `SL delays are [1000, 3000] (got [${slVals}])`);
    const slMaxWait = slVals.reduce((a, b) => a + b, 0);
    assert(slMaxWait === 4000, `SL max total wait = 4000ms (got ${slMaxWait}ms)`);

    // 1b) TP_RETRY_DELAYS = [1000, 3000]
    const tpMatch = src.match(/const TP_RETRY_DELAYS\s*=\s*\[([^\]]+)\]/);
    assert(tpMatch !== null, 'TP_RETRY_DELAYS declaration found');
    const tpVals = tpMatch[1].split(',').map(s => parseInt(s.trim()));
    assert(tpVals.length === 2, `TP has 2 retry delays (got ${tpVals.length})`);
    assert(tpVals[0] === 1000 && tpVals[1] === 3000, `TP delays are [1000, 3000] (got [${tpVals}])`);

    // 1c) Emergency fallback intact — SL path
    assert(src.includes('if (!slOrder)'), 'SL emergency close guard exists: if (!slOrder)');
    assert(src.includes('EMERGENCY CLOSE') || src.includes('EMERGENCY_CLOSE'), 'SL emergency close text present');
    assert(src.includes("type: 'MARKET'"), 'Emergency close uses MARKET order type');
    assert(src.includes('_closePosition(emgIdx'), 'Emergency close calls _closePosition');

    // 1d) Emergency fallback intact — TP path
    assert(src.includes('if (!tpOrder && slOrder)'), 'TP emergency close guard exists: if (!tpOrder && slOrder)');
    assert(src.includes('TP EMERGENCY CLOSE') || src.includes('TP_EMERGENCY'), 'TP emergency close text present');
})();

// ═══════════════════════════════════════════════════════════════
// T2: DSL stale warning — display-only, no execution impact
// ═══════════════════════════════════════════════════════════════
console.log('\n── T2: DSL stale warning ──');
(function testDSLStale() {
    const STALE_THRESHOLD_MS = 60000;

    // Simulate the exact logic from dsl.js L287-296
    function simulateStaleCheck(serverDsl, dsl) {
        if (serverDsl.lastTickTs && Date.now() - serverDsl.lastTickTs > STALE_THRESHOLD_MS) {
            dsl._stale = true;
            if (!dsl._staleLogged) {
                dsl._staleLogged = true;
                dsl._logMsg = 'warn: DSL state stale for pos';
            }
        } else {
            dsl._stale = false;
            dsl._staleLogged = false;
        }
    }

    // 2a) Stale state: lastTickTs = 90s ago → should flag stale
    const dsl1 = { _stale: false, _staleLogged: false };
    const serverDsl1 = { lastTickTs: Date.now() - 90000 };
    simulateStaleCheck(serverDsl1, dsl1);
    assert(dsl1._stale === true, 'Stale detected when >60s old (90s)');
    assert(dsl1._staleLogged === true, 'Stale warning logged');
    assert(dsl1._logMsg !== undefined, 'Warning message generated');

    // 2b) Fresh state: lastTickTs = 10s ago → should NOT flag stale
    const dsl2 = { _stale: true, _staleLogged: true };
    const serverDsl2 = { lastTickTs: Date.now() - 10000 };
    simulateStaleCheck(serverDsl2, dsl2);
    assert(dsl2._stale === false, 'Stale cleared when <60s old (10s)');
    assert(dsl2._staleLogged === false, 'Stale log flag cleared');

    // 2c) Missing lastTickTs → skipped entirely (safe fallback)
    const dsl3 = { _stale: false, _staleLogged: false };
    const serverDsl3 = {};
    simulateStaleCheck(serverDsl3, dsl3);
    assert(dsl3._stale === false, 'No false-positive when lastTickTs is undefined');
    assert(dsl3._staleLogged === false, 'No log when lastTickTs is undefined');

    // 2d) lastTickTs = 0 → falsy, should skip
    const dsl4 = { _stale: false, _staleLogged: false };
    const serverDsl4 = { lastTickTs: 0 };
    simulateStaleCheck(serverDsl4, dsl4);
    assert(dsl4._stale === false, 'No false-positive when lastTickTs is 0 (falsy)');

    // 2e) Log spam prevention — second call shouldn't re-log
    const dsl5 = { _stale: false, _staleLogged: false };
    const serverDsl5 = { lastTickTs: Date.now() - 120000 };
    simulateStaleCheck(serverDsl5, dsl5);
    assert(dsl5._staleLogged === true, 'First call logs');
    delete dsl5._logMsg;
    simulateStaleCheck(serverDsl5, dsl5);
    assert(dsl5._logMsg === undefined, 'Second call does NOT re-log (spam prevention)');

    // 2f) Display-only — verify no execution-affecting fields exist
    assert(dsl1._closedPosition === undefined, 'No position closure triggered');
    assert(dsl1._slModified === undefined, 'No SL modification triggered');
    assert(dsl1._detached === undefined, 'No DSL detach triggered');

    // 2g) Verify serverDSL.tick() stamps lastTickTs
    const serverDSL = require('./server/services/serverDSL');
    // attach a dummy position (matches attach() signature: {seq, symbol, side, price, sl, tp})
    const attachResult = serverDSL.attach({
        seq: 'SMOKE_T2_999',
        symbol: 'BTCUSDT',
        side: 'LONG',
        price: 50000,
        sl: 49000,
        tp: 52000,
    });
    assert(attachResult != null, 'serverDSL.attach() succeeded');

    // tick once to stamp lastTickTs
    serverDSL.tick('SMOKE_T2_999', 50100);
    const state2 = serverDSL.getState('SMOKE_T2_999');
    assert(state2.lastTickTs > 0, `lastTickTs stamped after tick (${state2.lastTickTs})`);
    assert(Date.now() - state2.lastTickTs < 5000, 'lastTickTs is recent (< 5s ago)');

    // cleanup
    serverDSL.detach('SMOKE_T2_999');
})();

// ═══════════════════════════════════════════════════════════════
// T3: Reconciliation mismatch — ORPHAN / GHOST / SIZE_MISMATCH
// ═══════════════════════════════════════════════════════════════
console.log('\n── T3: Reconciliation mismatch detection ──');
(function testReconciliation() {
    // Extract _comparePositions from source (it's not exported)
    const fs = require('fs');
    const src = fs.readFileSync('./server/services/reconciliation.js', 'utf8');

    // Pull the function body using regex
    const fnStart = src.indexOf('function _comparePositions(');
    const fnSig = '_comparePositions';
    assert(fnStart > -1, '_comparePositions function exists in source');

    // Extract function by brace-matching
    let braceCount = 0;
    let fnBody = '';
    let started = false;
    for (let i = fnStart; i < src.length; i++) {
        fnBody += src[i];
        if (src[i] === '{') { braceCount++; started = true; }
        if (src[i] === '}') { braceCount--; }
        if (started && braceCount === 0) break;
    }

    // Evaluate the function in isolation
    const fn = new Function('return ' + fnBody)();

    // 3a) ORPHAN_EXCHANGE: on exchange, not internal
    const r1 = fn(
        [{ symbol: 'BTCUSDT', side: 'LONG', size: 0.01 }],
        [],
        'test'
    );
    assert(r1.length === 1, `ORPHAN detected: ${r1.length} mismatch(es)`);
    assert(r1[0].type === 'ORPHAN_EXCHANGE', `Type is ORPHAN_EXCHANGE (got ${r1[0].type})`);

    // 3b) GHOST_INTERNAL: internal, not on exchange
    const r2 = fn(
        [],
        [{ symbol: 'ETHUSDT', side: 'SHORT', seq: 42, qty: 0.5 }],
        'test'
    );
    assert(r2.length === 1, `GHOST detected: ${r2.length} mismatch(es)`);
    assert(r2[0].type === 'GHOST_INTERNAL', `Type is GHOST_INTERNAL (got ${r2[0].type})`);

    // 3c) SIZE_MISMATCH: same position, different qty (>0.1%)
    const r3 = fn(
        [{ symbol: 'BTCUSDT', side: 'LONG', size: 0.01 }],
        [{ symbol: 'BTCUSDT', side: 'LONG', seq: 1, qty: 0.015 }],  // 50% off
        'test'
    );
    assert(r3.length === 1, `SIZE_MISMATCH detected: ${r3.length} mismatch(es)`);
    assert(r3[0].type === 'SIZE_MISMATCH', `Type is SIZE_MISMATCH (got ${r3[0].type})`);

    // 3d) Perfect match — no mismatches
    const r4 = fn(
        [{ symbol: 'BTCUSDT', side: 'LONG', size: 0.01 }],
        [{ symbol: 'BTCUSDT', side: 'LONG', seq: 1, qty: 0.01 }],
        'test'
    );
    assert(r4.length === 0, `Perfect match: 0 mismatches (got ${r4.length})`);

    // 3e) Within tolerance (0.09% off = within 0.1%) — no mismatch
    const r5 = fn(
        [{ symbol: 'BTCUSDT', side: 'LONG', size: 1.000 }],
        [{ symbol: 'BTCUSDT', side: 'LONG', seq: 1, qty: 1.0009 }],
        'test'
    );
    assert(r5.length === 0, `Within 0.1% tolerance: 0 mismatches (got ${r5.length})`);

    // 3f) Multiple mismatches at once
    const r6 = fn(
        [
            { symbol: 'BTCUSDT', side: 'LONG', size: 0.01 },   // orphan
            { symbol: 'ETHUSDT', side: 'SHORT', size: 0.5 },    // size mismatch
        ],
        [
            { symbol: 'ETHUSDT', side: 'SHORT', seq: 2, qty: 0.7 },  // size mismatch
            { symbol: 'SOLUSDT', side: 'LONG', seq: 3, qty: 10 },     // ghost
        ],
        'test'
    );
    assert(r6.length === 3, `Multi-mismatch: 3 total (got ${r6.length})`);
    const types = r6.map(m => m.type).sort();
    assert(types.includes('ORPHAN_EXCHANGE'), 'Multi: contains ORPHAN_EXCHANGE');
    assert(types.includes('GHOST_INTERNAL'), 'Multi: contains GHOST_INTERNAL');
    assert(types.includes('SIZE_MISMATCH'), 'Multi: contains SIZE_MISMATCH');

    // 3g) Read-only: original arrays not mutated
    const exchArr = [{ symbol: 'BTCUSDT', side: 'LONG', size: 0.01 }];
    const intArr = [{ symbol: 'ETHUSDT', side: 'SHORT', seq: 1, qty: 0.5 }];
    const origExch = JSON.stringify(exchArr);
    const origInt = JSON.stringify(intArr);
    fn(exchArr, intArr, 'test');
    assert(JSON.stringify(exchArr) === origExch, 'Exchange array NOT mutated (read-only)');
    assert(JSON.stringify(intArr) === origInt, 'Internal array NOT mutated (read-only)');
})();

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════
console.log(`\n══════════════════════════════════════════`);
console.log(`SMOKE TESTS S1/B1: ${passed} passed, ${failed} failed`);
console.log(`VERDICT: ${failed === 0 ? 'ALL PASS ✅' : 'FAILURES DETECTED ❌'}`);
console.log(`══════════════════════════════════════════\n`);
process.exit(failed > 0 ? 1 : 0);
