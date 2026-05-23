// [Phase 2 S2.C] Probe — verifies PANIC gates on manual/server entry paths.
// HTTP layer gates (/api/order/place, /api/order/modify, /api/addon) are covered
// by the smoke harness against the running server; this probe focuses on direct
// function-level gates that don't require exchange creds (registerManualPosition
// live vs demo + non-regression of S1/S2 helpers).
// Run: node tests/probe-s2c.js
'use strict';

const db = require('../server/services/database');
const serverAT = require('../server/services/serverAT');

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { console.log('  ✓ ' + name); pass++; }
    else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); fail++; }
}

// Snapshot halt so we restore it at the end
const _preHalt = db.atGetState('global:halt');

let ADMIN_ID;
try { const u = db.findUserByEmail('hidden.kode@proton.me'); ADMIN_ID = u ? u.id : 1; } catch (_) { ADMIN_ID = 1; }
console.log('probe-s2c admin uid=' + ADMIN_ID);

// Clean AT state + ensure halt OFF at start
try { serverAT.reset(ADMIN_ID); } catch (_) {}
db.atSetState('global:halt', { active: false, by: ADMIN_ID, ts: Date.now(), reason: null }, ADMIN_ID);

console.log('\n=== T1 — registerManualPosition DEMO unaffected by PANIC ===');
// Arm halt
serverAT.setGlobalHalt(true, ADMIN_ID, 'probe-s2c');
check('isGlobalHaltActive() true', serverAT.isGlobalHaltActive() === true);

const demoReg = serverAT.registerManualPosition(ADMIN_ID, {
    symbol: 'BTCUSDT',
    side: 'BUY',
    entryPrice: 50000,
    qty: 0.001,
    leverage: 10,
    mode: 'demo',
    dslParams: null,
});
check('DEMO manual registration allowed under PANIC', demoReg && demoReg.ok === true, JSON.stringify(demoReg));
check('DEMO registration returned seq', demoReg && typeof demoReg.seq === 'number');

console.log('\n=== T2 — registerManualPosition LIVE blocked by PANIC ===');
const liveReg = serverAT.registerManualPosition(ADMIN_ID, {
    symbol: 'ETHUSDT',
    side: 'BUY',
    entryPrice: 3000,
    qty: 0.01,
    leverage: 10,
    mode: 'live',
    dslParams: null,
});
check('LIVE manual registration blocked under PANIC', liveReg && liveReg.ok === false, JSON.stringify(liveReg));
check('error mentions GLOBAL_HALT', liveReg && /GLOBAL_HALT/.test(liveReg.error || ''), liveReg && liveReg.error);

console.log('\n=== T3 — After disarm, LIVE manual registration allowed ===');
serverAT.setGlobalHalt(false, ADMIN_ID, null);
check('isGlobalHaltActive() false', serverAT.isGlobalHaltActive() === false);

const liveReg2 = serverAT.registerManualPosition(ADMIN_ID, {
    symbol: 'SOLUSDT',
    side: 'BUY',
    entryPrice: 150,
    qty: 0.1,
    leverage: 5,
    mode: 'live',
    dslParams: null,
});
check('LIVE manual registration allowed after disarm', liveReg2 && liveReg2.ok === true, JSON.stringify(liveReg2));

console.log('\n=== T4 — S2 brain-path gate still works (non-regression) ===');
serverAT.reset(ADMIN_ID);
serverAT.setGlobalHalt(true, ADMIN_ID, 'probe-s2c-t4');
const fakeDecision = {
    fusion: { decision: 'LARGE', dir: 'LONG', confidence: 85, score: 75 },
    symbol: 'BNBUSDT',
    price: 400,
    priceTs: Date.now(),
    cycle: 'probe-s2c-t4-' + Date.now(),
    regime: { regime: 'TREND_UP' },
};
const fakeStc = { size: 100, lev: 10, slPct: 1, rr: 2, maxPos: 5, dslMode: 'default' };
const brainEntry = serverAT.processBrainDecision(fakeDecision, fakeStc, ADMIN_ID);
check('processBrainDecision still blocked under PANIC', brainEntry === null);

console.log('\n=== T5 — Post-disarm, brain entry flows ===');
serverAT.setGlobalHalt(false, ADMIN_ID, null);
serverAT.reset(ADMIN_ID);
// [S6-B2 compatibility] Admin is in engineMode='live' on this DB. The S6-B2
// paranoid gate refuses live brain dispatch unless MF.SERVER_AT === true.
// Mock the flag for the duration of this single processBrainDecision call so
// the original S2.B post-disarm assertion still proves what it intended:
// "the global-halt brain gate releases on disarm". MF.SERVER_AT is restored
// immediately after the call (no other test uses it).
const _MF_S2C = require('../server/migrationFlags');
const _origSAT = Object.getOwnPropertyDescriptor(_MF_S2C, 'SERVER_AT');
Object.defineProperty(_MF_S2C, 'SERVER_AT', { configurable: true, enumerable: true, get: () => true });
let brainOk;
try { brainOk = serverAT.processBrainDecision(fakeDecision, fakeStc, ADMIN_ID); }
finally {
    if (_origSAT) Object.defineProperty(_MF_S2C, 'SERVER_AT', _origSAT);
}
check('brain entry created post-disarm', !!brainOk);
check('entry still has decisionId (S2.A intact)', brainOk && /^[0-9a-f]{8}$/.test(brainOk.decisionId));

console.log('\n=== Cleanup ===');
try { serverAT.reset(ADMIN_ID); } catch (_) {}
if (_preHalt) {
    db.atSetState('global:halt', _preHalt, _preHalt.by || ADMIN_ID);
    console.log('  Restored pre-existing halt row');
} else {
    try { require('../server/services/database').atDeleteState && require('../server/services/database').atDeleteState('global:halt'); } catch (_) {}
    console.log('  No pre-existing halt row — leaving current state disarmed');
}

console.log('\n=== Summary ===');
console.log(`  PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
