// [Phase 2 S2] Standalone probe — exercises idempotency helpers + global halt
// persistence. Does NOT hit exchange (no creds, demo mode only for entries).
// Runs against the real DB but snapshots/restores at_state(global:halt) and
// resets test-user positions at the end.
// Run: node tests/probe-s2.js
'use strict';

const db = require('../server/services/database');
const serverAT = require('../server/services/serverAT');

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { console.log('  ✓ ' + name); pass++; }
    else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); fail++; }
}

// ── Snapshot existing halt state so we can restore it ──
const _preHalt = db.atGetState('global:halt');

// ── Find an admin user to own the halt row (FK CASCADE requires it) ──
// Fallback to id=1 which is always the bootstrap admin per auth.js.
let ADMIN_ID;
try {
    const u = db.findUserByEmail('wsov2@protonmail.com');
    ADMIN_ID = u ? u.id : 1;
} catch (_) { ADMIN_ID = 1; }

// Pick a second user id for collision tests — use whatever findable exists or
// fall back to ADMIN_ID for single-user collision via different symbols.
let USER2_ID = ADMIN_ID;
try {
    const all = db.listUsers();
    const other = all.find((u) => u.id !== ADMIN_ID);
    if (other) USER2_ID = other.id;
} catch (_) {}

console.log('Test admin uid=' + ADMIN_ID + ', collision uid=' + USER2_ID);

// Baseline: reset AT state for test users so we start clean
try { serverAT.reset(ADMIN_ID); } catch (_) {}
if (USER2_ID !== ADMIN_ID) { try { serverAT.reset(USER2_ID); } catch (_) {} }

// Ensure no global halt armed at start (saved in _preHalt, will be restored)
db.atSetState('global:halt', { active: false, by: ADMIN_ID, ts: Date.now(), reason: null }, ADMIN_ID);

const fakeDecision = {
    fusion: { decision: 'LARGE', dir: 'LONG', confidence: 85, score: 75 },
    symbol: 'BTCUSDT',
    price: 50000,
    priceTs: Date.now(),
    cycle: 'probe-s2-' + Date.now(),
    regime: { regime: 'TREND_UP' },
};
const fakeStc = { size: 100, lev: 10, slPct: 1, rr: 2, maxPos: 5, dslMode: 'default' };

console.log('\n=== T1 — Idempotency primitives ===');
const e1 = serverAT.processBrainDecision(fakeDecision, fakeStc, ADMIN_ID);
check('processBrainDecision returns entry', !!e1);
check('entry.decisionId matches ^[0-9a-f]{8}$', !!e1 && typeof e1.decisionId === 'string' && /^[0-9a-f]{8}$/.test(e1.decisionId), e1 && e1.decisionId);
check('entry.seq > 0', !!e1 && e1.seq > 0);

// Duplicate guard: second identical decision → null (existing position blocks)
const e2 = serverAT.processBrainDecision(fakeDecision, fakeStc, ADMIN_ID);
check('same (user,symbol,side) second call → null (dup-guarded by _positions)', e2 === null);

// clientOrderId format
const cid1 = `SAT_${e1.seq}_${e1.decisionId}`;
check('derived clientOrderId ≤ 36 chars (Binance limit)', cid1.length <= 36, 'len=' + cid1.length + ' val=' + cid1);
check('derived clientOrderId format SAT_<seq>_<8hex>', /^SAT_\d+_[0-9a-f]{8}$/.test(cid1), cid1);

console.log('\n=== T2 — Collision safety ===');
serverAT.reset(ADMIN_ID);
// [S6-B3 compatibility] Each test scenario uses a distinct cycle string so
// the per-user decisionId dedup (S6-B3) does not collapse logically distinct
// decisions across test blocks. Within T2, both calls share cycleT2 so the
// (symbol, cycle) key still differentiates BTC from ETH (per S6-B3 design).
const cycleT2 = 'probe-s2-T2-' + Date.now();
const eA = serverAT.processBrainDecision({ ...fakeDecision, symbol: 'BTCUSDT', cycle: cycleT2 }, fakeStc, ADMIN_ID);
const eB = serverAT.processBrainDecision({ ...fakeDecision, symbol: 'ETHUSDT', cycle: cycleT2 }, fakeStc, ADMIN_ID);
check('same user, different symbols → both entries created', !!eA && !!eB);
check('different symbols → different decisionIds', !!eA && !!eB && eA.decisionId !== eB.decisionId);
const cidA = `SAT_${eA.seq}_${eA.decisionId}`;
const cidB = `SAT_${eB.seq}_${eB.decisionId}`;
check('different entries → different clientOrderIds', cidA !== cidB);

// Same symbol, same user, while position open → null
const eC = serverAT.processBrainDecision({ ...fakeDecision, symbol: 'BTCUSDT', cycle: cycleT2 }, fakeStc, ADMIN_ID);
check('same symbol re-decision during open position → null', eC === null);

// Opposite side on same symbol — should still be blocked? Existing logic checks
// same side only. Let's document actual behavior rather than assert.
// [S6-B3] Use distinct cycle so the per-user dedup row from above does not
// preempt the duplicate-position guard we are exercising here.
const cycleT2b = 'probe-s2-T2b-' + Date.now();
const eD = serverAT.processBrainDecision({ ...fakeDecision, symbol: 'BTCUSDT', cycle: cycleT2b, fusion: { ...fakeDecision.fusion, dir: 'SHORT' } }, fakeStc, ADMIN_ID);
check('opposite side same symbol → allowed (different entry ok)', !!eD);
check('opposite side gets own decisionId', !!eD && eD.decisionId !== eA.decisionId);

console.log('\n=== T3 — Global PANIC halt ===');
serverAT.reset(ADMIN_ID);

// Initial: not halted
const s0 = serverAT.getGlobalHaltState();
check('initial halt state active=false', s0.active === false);
check('isGlobalHaltActive() false', serverAT.isGlobalHaltActive() === false);

// Arm halt
const s1 = serverAT.setGlobalHalt(true, ADMIN_ID, 'probe-test');
check('setGlobalHalt(true) returns active=true', s1.active === true);
check('by=ADMIN_ID recorded', s1.by === ADMIN_ID);
check('reason stored', s1.reason === 'probe-test');
check('isGlobalHaltActive() now true', serverAT.isGlobalHaltActive() === true);

// Decision blocked while halted
// [S6-B3] Distinct cycle so the dedup row from T2 does not pre-empt the
// halt-gate test (we want the halt to be the reason for null, not dedup).
const cycleT3 = 'probe-s2-T3-' + Date.now();
const eHalted = serverAT.processBrainDecision({ ...fakeDecision, symbol: 'BNBUSDT', cycle: cycleT3 }, fakeStc, ADMIN_ID);
check('processBrainDecision returns null while halted', eHalted === null);

// Persistence: reload serverAT module → halt state survives because DB is truth
delete require.cache[require.resolve('../server/services/serverAT')];
const serverATReload = require('../server/services/serverAT');
check('halt state persists after module reload', serverATReload.isGlobalHaltActive() === true);
const sReload = serverATReload.getGlobalHaltState();
check('reload preserves by + reason', sReload.by === ADMIN_ID && sReload.reason === 'probe-test');

// Disarm
serverATReload.setGlobalHalt(false, ADMIN_ID, null);
check('after disarm, isGlobalHaltActive() false', serverATReload.isGlobalHaltActive() === false);
const sDone = serverATReload.getGlobalHaltState();
check('disarmed state active=false', sDone.active === false);

// Guard: setGlobalHalt without byUserId throws
let threw = false;
try { serverATReload.setGlobalHalt(true, null, 'nobody'); } catch (_) { threw = true; }
check('setGlobalHalt throws without byUserId', threw);

console.log('\n=== T4 — No regression on S1 path ===');
const fs2 = serverATReload.getFullState(ADMIN_ID);
check('getFullState returns object', fs2 && typeof fs2 === 'object');
check('getFullState has atActive', 'atActive' in fs2);
check('getFullState has positions array', Array.isArray(fs2.positions));

// Post-disarm: decisions flow normally
serverATReload.reset(ADMIN_ID);
// [S6-B3] Distinct cycle for T4 so any prior dedup row does not block.
const cycleT4 = 'probe-s2-T4-' + Date.now();
const eNormal = serverATReload.processBrainDecision({ ...fakeDecision, symbol: 'SOLUSDT', cycle: cycleT4 }, fakeStc, ADMIN_ID);
check('post-disarm entry created', !!eNormal);
check('post-disarm entry.decisionId present', eNormal && /^[0-9a-f]{8}$/.test(eNormal.decisionId));

console.log('\n=== Cleanup ===');
try { serverATReload.reset(ADMIN_ID); } catch (_) {}
if (USER2_ID !== ADMIN_ID) { try { serverATReload.reset(USER2_ID); } catch (_) {} }

// Restore pre-existing halt state (if any)
if (_preHalt) {
    db.atSetState('global:halt', _preHalt, _preHalt.by || ADMIN_ID);
    console.log('  Restored pre-existing halt row');
} else {
    // Remove the test halt row so DB is left clean
    try { db._raw && db._raw.prepare("DELETE FROM at_state WHERE key = 'global:halt'").run(); } catch (_) {}
    console.log('  No pre-existing halt row — left current state as disarmed');
}

console.log('\n=== Summary ===');
console.log(`  PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
