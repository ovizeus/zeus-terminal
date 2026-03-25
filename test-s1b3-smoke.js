/**
 * Sprint 1 / Batch 3 — Smoke Tests
 * Ticket 1: SL retry delays — ALREADY PRESENT (ZT-AUD-007 from Batch 1)
 * Ticket 2: DSL timestamp — ALREADY PRESENT (ZT-AUD-008 from Batch 1)
 * Ticket 3: OI stale guard in confluence — NEW PATCH
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
// Ticket 1: SL retry too long (ALREADY PRESENT — verify intact)
// ═══════════════════════════════════════════════════════════════
console.log('\n── Ticket 1: SL/TP Retry Delays (ALREADY PRESENT) ──');
(function testTicket1() {
    const src = fs.readFileSync('./server/services/serverAT.js', 'utf8');

    // 1a) SL retry delays = [1000, 3000]
    assert(src.includes('SL_RETRY_DELAYS = [1000, 3000]'), 'serverAT.js: SL_RETRY_DELAYS = [1000, 3000]');

    // 1b) TP retry delays = [1000, 3000]
    assert(src.includes('TP_RETRY_DELAYS = [1000, 3000]'), 'serverAT.js: TP_RETRY_DELAYS = [1000, 3000]');

    // 1c) Emergency close fallback intact for SL
    assert(src.includes('EMERGENCY CLOSE') || src.includes('EMERGENCY_CLOSE'), 'serverAT.js: SL emergency close fallback exists');

    // 1d) Emergency close fallback intact for TP
    assert(src.includes('TP EMERGENCY CLOSE') || src.includes('TP_EMERGENCY_CLOSE'), 'serverAT.js: TP emergency close fallback exists');

    // 1e) No old [2000, 5000, 10000] values
    assert(!src.includes('[2000, 5000, 10000]') && !src.includes('[2000,5000,10000]'), 'serverAT.js: no old [2000,5000,10000] delays');
})();

// ═══════════════════════════════════════════════════════════════
// Ticket 2: DSL no timestamp (ALREADY PRESENT — verify intact)
// ═══════════════════════════════════════════════════════════════
console.log('\n── Ticket 2: DSL Timestamp (ALREADY PRESENT) ──');
(function testTicket2() {
    const dslServer = fs.readFileSync('./server/services/serverDSL.js', 'utf8');
    const dslClient = fs.readFileSync('./public/js/trading/dsl.js', 'utf8');

    // 2a) Server stamps lastTickTs
    assert(dslServer.includes('lastTickTs = Date.now()'), 'serverDSL.js: lastTickTs stamped in tick()');

    // 2b) Server exposes lastTickTs in getState()
    assert(dslServer.includes('lastTickTs:'), 'serverDSL.js: lastTickTs exposed in getState()');

    // 2c) Client checks for stale DSL (>60s)
    assert(dslClient.includes('60000'), 'dsl.js: 60s stale threshold exists');
    assert(dslClient.includes('lastTickTs'), 'dsl.js: checks lastTickTs for freshness');

    // 2d) Non-breaking — stale flag is display-only
    assert(dslClient.includes('_stale') || dslClient.includes('stale'), 'dsl.js: stale flag set for display');
})();

// ═══════════════════════════════════════════════════════════════
// Ticket 3: OI stale in confluence (NEW PATCH)
// ═══════════════════════════════════════════════════════════════
console.log('\n── Ticket 3: OI Stale Guard (NEW PATCH) ──');
(function testTicket3() {
    const mdSrc = fs.readFileSync('./public/js/data/marketData.js', 'utf8');
    const confSrc = fs.readFileSync('./public/js/brain/confluence.js', 'utf8');

    // 3a) marketData stamps S.oiTs on successful OI fetch
    assert(mdSrc.includes('S.oiTs = Date.now()'), 'marketData.js: S.oiTs timestamp set on OI fetch');

    // 3b) Timestamp is set AFTER S.oi assignment (correct order)
    const mdLines = mdSrc.split('\n');
    const oiAssignLine = mdLines.findIndex(l => l.includes('S.oiPrev = S.oi') && l.includes('S.oi ='));
    const oiTsLine = mdLines.findIndex(l => l.includes('S.oiTs = Date.now()'));
    assert(oiTsLine > oiAssignLine, 'marketData.js: oiTs stamped after S.oi assignment');

    // 3c) confluence.js checks for OI staleness
    assert(confSrc.includes('oiStale'), 'confluence.js: oiStale variable exists');

    // 3d) Stale threshold is 300000ms (5 minutes)
    assert(confSrc.includes('300000'), 'confluence.js: 5-minute stale threshold (300000ms)');

    // 3e) oiStale checks for missing oiTs
    assert(confSrc.includes('!S.oiTs'), 'confluence.js: guards against missing oiTs');

    // 3f) oiScore neutralises when stale (falls back to 50)
    const oiScoreLine = confSrc.split('\n').find(l => l.includes('oiScore') && l.includes('oiStale'));
    assert(oiScoreLine && oiScoreLine.includes('!oiStale'), 'confluence.js: oiScore requires !oiStale for non-neutral value');

    // 3g) oiDir neutralises when stale
    const oiDirLine = confSrc.split('\n').find(l => l.includes('oiDir') && l.includes('oiStale'));
    assert(oiDirLine && oiDirLine.includes('neut'), 'confluence.js: oiDir falls back to neut when stale');

    // 3h) [FIX R1] neutral fallback for null is preserved
    assert(confSrc.includes('S.oi == null && S.oiPrev == null'), 'confluence.js: FIX R1 null fallback preserved');

    // 3i) Simulate: stale scenario → neutral
    const S = { oiTs: Date.now() - 400000, oi: 1000000, oiPrev: 900000 };
    const oiStale = !S.oiTs || (Date.now() - S.oiTs > 300000);
    const oiScore = (!oiStale && S.oiPrev && S.oi) ? 70 : 50;
    const oiDir = (oiStale || (S.oi == null && S.oiPrev == null)) ? 'neut' : 'bull';
    assert(oiStale === true, 'Sim: 400s-old OI is stale');
    assert(oiScore === 50, 'Sim: stale OI → score neutral (50)');
    assert(oiDir === 'neut', 'Sim: stale OI → direction neutral');

    // 3j) Simulate: fresh scenario → scores normally
    const S2 = { oiTs: Date.now() - 10000, oi: 1000000, oiPrev: 900000 };
    const oiStale2 = !S2.oiTs || (Date.now() - S2.oiTs > 300000);
    const oiScore2 = (!oiStale2 && S2.oiPrev && S2.oi) ? 70 : 50;
    const oiDir2 = (oiStale2 || (S2.oi == null && S2.oiPrev == null)) ? 'neut' : ((S2.oi > S2.oiPrev) ? 'bull' : 'bear');
    assert(oiStale2 === false, 'Sim: 10s-old OI is fresh');
    assert(oiScore2 === 70, 'Sim: fresh OI with >0.1% change → score 70');
    assert(oiDir2 === 'bull', 'Sim: fresh OI with increase → bull');

    // 3k) Simulate: no oiTs at all → stale (first-load protection)
    const S3 = { oiTs: undefined, oi: 1000000, oiPrev: 900000 };
    const oiStale3 = !S3.oiTs || (Date.now() - S3.oiTs > 300000);
    assert(oiStale3 === true, 'Sim: missing oiTs → treated as stale');
})();

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`Sprint 1 / Batch 3 Smoke: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(50)}`);
if (failed > 0) process.exit(1);
