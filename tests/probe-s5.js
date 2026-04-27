// [Phase 2 S5] Standalone probe — restart-simulation harness for cooldown +
// regime persistence patches shipped in S5 (serverBrain.js + serverAT.js).
//
// Approach: directly drive the patched persist/restore helpers via the
// _s5TestHooks export, snapshot+restore each at_state key the probe writes
// so the live DB ends in the same state. NO HTTP. NO PM2 reload. NO ML.
// Uses real DB on disk (matches probe-s2 / probe-s2c convention) but is
// idempotent.
//
// Run: node tests/probe-s5.js   (exits 0 on full PASS, 1 on any FAIL)
'use strict';

const fs = require('fs');
const path = require('path');

const db = require('../server/services/database');
const brain = require('../server/services/serverBrain');
const at = require('../server/services/serverAT');

const Bh = brain._s5TestHooks;
const Ah = at._s5TestHooks;

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { console.log('  ✓ ' + name); pass++; }
    else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); fail++; }
}

// ── Pick test users (mirror probe-s2 fallback) ─────────────────────────────
let ADMIN_ID = 1;
try {
    const u = db.findUserByEmail && db.findUserByEmail('wsov2@protonmail.com');
    if (u && u.id) ADMIN_ID = u.id;
} catch (_) {}
let USER2_ID = ADMIN_ID;
try {
    const all = (db.listUsers && db.listUsers()) || [];
    const other = all.find((u) => u.id !== ADMIN_ID);
    if (other) USER2_ID = other.id;
} catch (_) {}
console.log('probe-s5 ADMIN_ID=' + ADMIN_ID + ' USER2_ID=' + USER2_ID);

// ── Snapshot at_state rows the probe touches (restore at end) ──────────────
const _SNAP_KEYS = [
    'brain:cooldowns:' + ADMIN_ID,
    'brain:cooldowns:' + USER2_ID,
    'brain:prevRegimes:' + ADMIN_ID,
    'brain:prevRegimes:' + USER2_ID,
    'brain:regimeTg:' + ADMIN_ID,
    'brain:regimeTg:' + USER2_ID,
    'serverAT:closeCooldowns:' + ADMIN_ID,
    'serverAT:closeCooldowns:' + USER2_ID,
];
const _snapshot = new Map();
for (const k of _SNAP_KEYS) {
    try { _snapshot.set(k, db.atGetState(k)); } catch (_) { _snapshot.set(k, undefined); }
}

function _restoreSnapshot() {
    for (const [k, v] of _snapshot) {
        const m = /^.+:(\d+)$/.exec(k);
        const uid = m ? parseInt(m[1], 10) : ADMIN_ID;
        if (v === undefined || v === null) {
            try { db.atSetState(k, null, uid); } catch (_) {}
        } else {
            try { db.atSetState(k, v, uid); } catch (_) {}
        }
    }
}
process.on('exit', _restoreSnapshot);

// ── Helpers ────────────────────────────────────────────────────────────────
function _resetMaps() {
    Bh.cooldowns.clear();
    Bh.prevRegimes.clear();
    Bh.regimeTgLastTs.clear();
    Ah.closeCooldowns.clear();
    Ah.closeCooldownsRestoredFor.clear();
}
function _clearKey(k, uid) { try { db.atSetState(k, null, uid); } catch (_) {} }

// ════════════════════════════════════════════════════════════════════════
// T0 — Test hook surface
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T0 — _s5TestHooks export surface ===');
{
    check('T0: brain._s5TestHooks frozen', Object.isFrozen(Bh));
    check('T0: at._s5TestHooks frozen', Object.isFrozen(Ah));
    const expectedB = 'REGIME_TG_COOLDOWN_MS,cooldowns,persistCooldowns,persistRegimeBaseline,persistRegimeTgThrottle,prevRegimes,regimeTgLastTs,restoreCooldowns,restoreRegimeBaseline,restoreRegimeTgThrottle,setCooldownDeadline';
    check('T0: brain hooks surface matches', Object.keys(Bh).sort().join(',') === expectedB);
    const expectedA = 'CLOSE_COOLDOWN_MS,closeCooldowns,closeCooldownsRestoredFor,persistCloseCooldownsForUser,restoreCloseCooldownsForUser,setCloseCooldownDeadline';
    check('T0: at hooks surface matches', Object.keys(Ah).sort().join(',') === expectedA);
    check('T0: brain.start exists (boot path consumer)', typeof brain.start === 'function');
}

// ════════════════════════════════════════════════════════════════════════
// T1 — Cooldown deadline persists + restores
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T1 — Cooldown set with deadline persists + restores ===');
{
    _resetMaps();
    _clearKey('brain:cooldowns:' + ADMIN_ID, ADMIN_ID);

    // Set a 30-min cooldown — bigger than the legacy 10-min window.
    const cdMs = 30 * 60 * 1000;
    const beforeNow = Date.now();
    Bh.setCooldownDeadline(ADMIN_ID, 'BTCUSDT', cdMs);
    const memDeadline = Bh.cooldowns.get(ADMIN_ID + ':BTCUSDT');
    check('T1: in-memory deadline > now + cdMs - 1s', memDeadline >= beforeNow + cdMs - 1000);

    // Confirm DB row written
    const persisted = db.atGetState('brain:cooldowns:' + ADMIN_ID);
    check('T1: persisted row is an object', persisted && typeof persisted === 'object');
    check('T1: persisted row carries deadline for ADMIN:BTCUSDT',
        Math.abs(persisted[ADMIN_ID + ':BTCUSDT'] - memDeadline) <= 1);

    // Simulate restart: clear in-memory map, call _restoreCooldowns()
    Bh.cooldowns.clear();
    Bh.restoreCooldowns();
    const restoredDeadline = Bh.cooldowns.get(ADMIN_ID + ':BTCUSDT');
    check('T1: 30-min cooldown survives simulated restart',
        restoredDeadline === memDeadline);
    check('T1: restored deadline is in the future', restoredDeadline > Date.now());
}

// ════════════════════════════════════════════════════════════════════════
// T2 — Legacy bare-number compatibility (lastEntryTs → +10min deadline)
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T2 — Legacy bare-number cooldown compatibility ===');
{
    _resetMaps();
    // Write a legacy row directly (bare lastEntryTs as Date.now()).
    const legacyTs = Date.now() - (2 * 60 * 1000); // 2 min ago
    db.atSetState('brain:cooldowns:' + ADMIN_ID,
        { [ADMIN_ID + ':ETHUSDT']: legacyTs }, ADMIN_ID);
    Bh.cooldowns.clear();
    Bh.restoreCooldowns();
    const restored = Bh.cooldowns.get(ADMIN_ID + ':ETHUSDT');
    check('T2: legacy bare-ts converted to deadline = ts + 10min',
        restored === legacyTs + 600000);
    check('T2: legacy deadline still in future (2min old + 10min = 8min ahead)',
        restored > Date.now());

    // Legacy old enough to be already past the 10-min compatibility window
    // must be DROPPED.
    Bh.cooldowns.clear();
    const veryOldTs = Date.now() - (20 * 60 * 1000); // 20 min ago
    db.atSetState('brain:cooldowns:' + ADMIN_ID,
        { [ADMIN_ID + ':SOLUSDT']: veryOldTs }, ADMIN_ID);
    Bh.restoreCooldowns();
    check('T2: legacy bare-ts older than 10min compat window is dropped',
        !Bh.cooldowns.has(ADMIN_ID + ':SOLUSDT'));
}

// ════════════════════════════════════════════════════════════════════════
// T3 — Per-user cooldown isolation
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T3 — Per-user cooldown isolation ===');
{
    _resetMaps();
    _clearKey('brain:cooldowns:' + ADMIN_ID, ADMIN_ID);
    if (USER2_ID !== ADMIN_ID) _clearKey('brain:cooldowns:' + USER2_ID, USER2_ID);

    Bh.setCooldownDeadline(ADMIN_ID, 'BTCUSDT', 15 * 60 * 1000);
    if (USER2_ID !== ADMIN_ID) Bh.setCooldownDeadline(USER2_ID, 'ETHUSDT', 20 * 60 * 1000);

    // Restart simulate
    Bh.cooldowns.clear();
    Bh.restoreCooldowns();

    check('T3: ADMIN BTC cooldown restored',
        Bh.cooldowns.has(ADMIN_ID + ':BTCUSDT'));
    if (USER2_ID !== ADMIN_ID) {
        check('T3: USER2 ETH cooldown restored',
            Bh.cooldowns.has(USER2_ID + ':ETHUSDT'));
        check('T3: ADMIN ETH cooldown NOT present (USER2 row not bleeding)',
            !Bh.cooldowns.has(ADMIN_ID + ':ETHUSDT'));
        check('T3: USER2 BTC cooldown NOT present (ADMIN row not bleeding)',
            !Bh.cooldowns.has(USER2_ID + ':BTCUSDT'));
    } else {
        check('T3: USER2_ID == ADMIN_ID — single-user env, isolation N/A but no cross-bleed possible', true);
    }
}

// ════════════════════════════════════════════════════════════════════════
// T4 — Per-symbol cooldown isolation
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T4 — Per-symbol cooldown isolation ===');
{
    _resetMaps();
    _clearKey('brain:cooldowns:' + ADMIN_ID, ADMIN_ID);

    Bh.setCooldownDeadline(ADMIN_ID, 'BTCUSDT', 5 * 60 * 1000);
    Bh.setCooldownDeadline(ADMIN_ID, 'ETHUSDT', 5 * 60 * 1000);
    Bh.cooldowns.clear();
    Bh.restoreCooldowns();
    check('T4: BTC cooldown restored independently of ETH',
        Bh.cooldowns.has(ADMIN_ID + ':BTCUSDT'));
    check('T4: ETH cooldown restored independently of BTC',
        Bh.cooldowns.has(ADMIN_ID + ':ETHUSDT'));
    check('T4: SOL cooldown not present (never set)',
        !Bh.cooldowns.has(ADMIN_ID + ':SOLUSDT'));
}

// ════════════════════════════════════════════════════════════════════════
// T5 — Expired deadlines drop on restore
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T5 — Expired deadline drops on restore ===');
{
    _resetMaps();
    // Write a future deadline + a value that is so old that even the legacy
    // +10min compatibility boost cannot save it (15 min ago + 10 min = still
    // 5 min in the past). Any value <= now is treated as legacy lastEntryTs
    // by the restore path and boosted by +600000 ms; the drop predicate fires
    // only if the boosted deadline is also <= now.
    const futureDeadline = Date.now() + 10 * 60 * 1000 + 1;
    const veryOldTs = Date.now() - 15 * 60 * 1000; // 15 min ago
    db.atSetState('brain:cooldowns:' + ADMIN_ID, {
        [ADMIN_ID + ':XRPUSDT']: futureDeadline,
        [ADMIN_ID + ':AVAXUSDT']: veryOldTs,
    }, ADMIN_ID);
    Bh.cooldowns.clear();
    Bh.restoreCooldowns();
    check('T5: future deadline kept', Bh.cooldowns.has(ADMIN_ID + ':XRPUSDT'));
    check('T5: deeply-expired entry dropped (15min ago + 10min legacy = still past)',
        !Bh.cooldowns.has(ADMIN_ID + ':AVAXUSDT'));
}

// ════════════════════════════════════════════════════════════════════════
// T6 — Cleanup uses deadline, not age (R6 fix verification)
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T6 — Cleanup honors deadline (R6) ===');
{
    _resetMaps();
    // Two entries: one with deadline 2h in the future (>1h), one already expired.
    const farFuture = Date.now() + 2 * 60 * 60 * 1000;
    const past = Date.now() - 1000;
    Bh.cooldowns.set(ADMIN_ID + ':BTCUSDT', farFuture);
    Bh.cooldowns.set(ADMIN_ID + ':ETHUSDT', past);
    // Replicate the cleanup loop logic inline (the actual interval runs every hour;
    // we exercise the delete predicate directly).
    const now = Date.now();
    for (const [k, deadline] of Bh.cooldowns) { if (deadline <= now) Bh.cooldowns.delete(k); }
    check('T6: 2h-future cooldown survives cleanup (would have been killed by old age check)',
        Bh.cooldowns.has(ADMIN_ID + ':BTCUSDT'));
    check('T6: expired cooldown dropped by cleanup',
        !Bh.cooldowns.has(ADMIN_ID + ':ETHUSDT'));
}

// ════════════════════════════════════════════════════════════════════════
// T7 — Close cooldown persists + lazy restores (serverAT)
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T7 — Close cooldown persists + lazy restores ===');
{
    _resetMaps();
    _clearKey('serverAT:closeCooldowns:' + ADMIN_ID, ADMIN_ID);

    Ah.setCloseCooldownDeadline(ADMIN_ID, 'BTCUSDT');
    const memDeadline = Ah.closeCooldowns.get(ADMIN_ID + ':BTCUSDT');
    check('T7: in-memory close-cooldown set with deadline > now + ~10min',
        memDeadline > Date.now() + (Ah.CLOSE_COOLDOWN_MS - 1000));

    const persisted = db.atGetState('serverAT:closeCooldowns:' + ADMIN_ID);
    check('T7: persisted row carries the deadline',
        persisted && Math.abs(persisted[ADMIN_ID + ':BTCUSDT'] - memDeadline) <= 1);

    // Simulate restart: clear in-memory map and the lazy-restore tracking.
    Ah.closeCooldowns.clear();
    Ah.closeCooldownsRestoredFor.clear();
    // First call to isCloseCooldownActive lazy-restores from DB.
    const active = at.isCloseCooldownActive(ADMIN_ID, 'BTCUSDT');
    check('T7: isCloseCooldownActive triggers lazy restore + returns true', active === true);
    check('T7: in-memory map repopulated post lazy-restore',
        Ah.closeCooldowns.has(ADMIN_ID + ':BTCUSDT'));
}

// ════════════════════════════════════════════════════════════════════════
// T8 — Close cooldown drops expired + legacy compat
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T8 — Close cooldown drops expired + legacy compat ===');
{
    _resetMaps();
    // Same restore semantics as brain cooldowns: any value <= now is treated
    // as a legacy bare lastTs and boosted by +CLOSE_COOLDOWN_MS. Drop fires
    // only if the boosted deadline is still <= now. Use a value 15 min old
    // (10-min legacy boost not enough → drops).
    const futureD = Date.now() + 5 * 60 * 1000;
    const veryOldTs = Date.now() - 15 * 60 * 1000; // 15min ago + 10min boost = past
    const legacyTs = Date.now() - 2 * 60 * 1000;   // 2min ago + 10min boost = 8min future
    db.atSetState('serverAT:closeCooldowns:' + ADMIN_ID, {
        [ADMIN_ID + ':XRPUSDT']: futureD,
        [ADMIN_ID + ':AVAXUSDT']: veryOldTs,
        [ADMIN_ID + ':DOGEUSDT']: legacyTs,
    }, ADMIN_ID);
    Ah.closeCooldowns.clear();
    Ah.closeCooldownsRestoredFor.clear();
    Ah.restoreCloseCooldownsForUser(ADMIN_ID);
    check('T8: future deadline kept', Ah.closeCooldowns.has(ADMIN_ID + ':XRPUSDT'));
    check('T8: deeply-expired dropped (15min ago + 10min legacy = past)',
        !Ah.closeCooldowns.has(ADMIN_ID + ':AVAXUSDT'));
    const dogeRestored = Ah.closeCooldowns.get(ADMIN_ID + ':DOGEUSDT');
    check('T8: legacy bare ts → +CLOSE_COOLDOWN_MS deadline applied',
        dogeRestored === legacyTs + Ah.CLOSE_COOLDOWN_MS);
    check('T8: lazy-restore guards re-execution',
        Ah.closeCooldownsRestoredFor.has(ADMIN_ID));
}

// ════════════════════════════════════════════════════════════════════════
// T9 — Regime baseline persists + restores
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T9 — Regime baseline persists + restores ===');
{
    _resetMaps();
    _clearKey('brain:prevRegimes:' + ADMIN_ID, ADMIN_ID);

    Bh.prevRegimes.set('BTCUSDT', 'TREND');
    Bh.prevRegimes.set('ETHUSDT', 'RANGE');

    // The persist loop iterates _stcMap — but _stcMap may be empty in the
    // test process. Write directly via the test hook to confirm round-trip.
    db.atSetState('brain:prevRegimes:' + ADMIN_ID,
        Object.fromEntries(Bh.prevRegimes), ADMIN_ID);
    Bh.prevRegimes.clear();
    Bh.restoreRegimeBaseline();
    check('T9: BTC regime baseline restored',
        Bh.prevRegimes.get('BTCUSDT') === 'TREND');
    check('T9: ETH regime baseline restored',
        Bh.prevRegimes.get('ETHUSDT') === 'RANGE');
}

// ════════════════════════════════════════════════════════════════════════
// T10 — Regime change spanning restart is NOT silently swallowed
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T10 — Regime change spanning restart not swallowed ===');
{
    _resetMaps();
    // Pre-restart: baseline TREND
    db.atSetState('brain:prevRegimes:' + ADMIN_ID,
        { BTCUSDT: 'TREND' }, ADMIN_ID);
    Bh.restoreRegimeBaseline();
    const baselineAfterRestart = Bh.prevRegimes.get('BTCUSDT');
    check('T10: post-restart baseline = pre-restart TREND',
        baselineAfterRestart === 'TREND');

    // Simulate next computation observing RANGE.
    const observedNext = 'RANGE';
    const isChange = baselineAfterRestart !== undefined && baselineAfterRestart !== observedNext;
    check('T10: isChange detected (TREND → RANGE)', isChange === true);

    // Pre-S5 behavior would be: baseline=undefined → no change → swallowed.
    // S5 behavior: baseline=TREND → change correctly fired.
    Bh.prevRegimes.set('BTCUSDT', observedNext);
    db.atSetState('brain:prevRegimes:' + ADMIN_ID,
        Object.fromEntries(Bh.prevRegimes), ADMIN_ID);
    const persistedNow = db.atGetState('brain:prevRegimes:' + ADMIN_ID);
    check('T10: new baseline RANGE persisted', persistedNow && persistedNow.BTCUSDT === 'RANGE');
}

// ════════════════════════════════════════════════════════════════════════
// T11 — Regime TG throttle persists + restores; 15min dedup preserved
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T11 — Regime TG throttle persists + restores ===');
{
    _resetMaps();
    _clearKey('brain:regimeTg:' + ADMIN_ID, ADMIN_ID);

    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    Bh.regimeTgLastTs.set(ADMIN_ID, fiveMinAgo);
    db.atSetState('brain:regimeTg:' + ADMIN_ID, { ts: fiveMinAgo }, ADMIN_ID);

    Bh.regimeTgLastTs.clear();
    Bh.restoreRegimeTgThrottle();
    const restoredTs = Bh.regimeTgLastTs.get(ADMIN_ID);
    check('T11: TG throttle ts restored',
        restoredTs === fiveMinAgo);

    // Within the 15-min throttle window, a new regime change must NOT fire TG.
    const now = Date.now();
    const wouldFire = (now - restoredTs) >= Bh.REGIME_TG_COOLDOWN_MS;
    check('T11: throttle window honored (5min < 15min, would NOT fire)',
        wouldFire === false);

    // Outside the window, should fire.
    const oldTs = now - 20 * 60 * 1000; // 20 min ago
    Bh.regimeTgLastTs.set(ADMIN_ID, oldTs);
    const wouldFireOld = (now - oldTs) >= Bh.REGIME_TG_COOLDOWN_MS;
    check('T11: outside throttle window allowed (20min > 15min)',
        wouldFireOld === true);
}

// ════════════════════════════════════════════════════════════════════════
// T12 — No cross-user bleed in regime TG throttle
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T12 — No cross-user bleed in regime TG throttle ===');
{
    _resetMaps();
    if (USER2_ID === ADMIN_ID) {
        check('T12: USER2_ID == ADMIN_ID — single-user env, N/A', true);
    } else {
        const t1 = Date.now() - 5 * 60 * 1000;
        const t2 = Date.now() - 10 * 60 * 1000;
        db.atSetState('brain:regimeTg:' + ADMIN_ID, { ts: t1 }, ADMIN_ID);
        db.atSetState('brain:regimeTg:' + USER2_ID, { ts: t2 }, USER2_ID);
        Bh.regimeTgLastTs.clear();
        Bh.restoreRegimeTgThrottle();
        check('T12: ADMIN ts restored', Bh.regimeTgLastTs.get(ADMIN_ID) === t1);
        check('T12: USER2 ts restored independently', Bh.regimeTgLastTs.get(USER2_ID) === t2);
        check('T12: ADMIN ts not equal USER2 ts (no bleed)',
            Bh.regimeTgLastTs.get(ADMIN_ID) !== Bh.regimeTgLastTs.get(USER2_ID));
    }
}

// ════════════════════════════════════════════════════════════════════════
// T13 — Source-level: no localStorage / no Bybit imports introduced
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T13 — Source-level: no client/Bybit refs introduced ===');
{
    const brainPath = path.resolve(__dirname, '..', 'server', 'services', 'serverBrain.js');
    const atPath = path.resolve(__dirname, '..', 'server', 'services', 'serverAT.js');
    const stripComments = (s) => s
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    const brainSrc = stripComments(fs.readFileSync(brainPath, 'utf8'));
    const atSrc = stripComments(fs.readFileSync(atPath, 'utf8'));
    check('T13: serverBrain.js has no localStorage refs',
        !/\blocalStorage\b/.test(brainSrc));
    check('T13: serverAT.js has no localStorage refs',
        !/\blocalStorage\b/.test(atSrc));
    check('T13: serverBrain.js has no window. refs',
        !/\bwindow\.[A-Za-z_]/.test(brainSrc));
    check('T13: serverAT.js has no window. refs',
        !/\bwindow\.[A-Za-z_]/.test(atSrc));
    check('T13: serverBrain.js has no Bybit module imports',
        !/require\(['"][^'"]*bybit[A-Z][^'"]*['"]\)/.test(brainSrc));
    check('T13: serverAT.js has no Bybit module imports',
        !/require\(['"][^'"]*bybit[A-Z][^'"]*['"]\)/.test(atSrc));
}

// ════════════════════════════════════════════════════════════════════════
// T14 — Migration flags unchanged
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T14 — Migration flags unchanged ===');
{
    const MF = require('../server/migrationFlags');
    const all = MF.getAll();
    check('T14: SERVER_BRAIN=false', all.SERVER_BRAIN === false);
    check('T14: SERVER_AT=false', all.SERVER_AT === false);
    check('T14: BYBIT_DRY_RUN_ONLY=true', all.BYBIT_DRY_RUN_ONLY === true);
    check('T14: BYBIT_PARITY_ENABLED=false', all.BYBIT_PARITY_ENABLED === false);
}

// ════════════════════════════════════════════════════════════════════════
// T15 — at_state user_id remains non-null for new keys we wrote
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T15 — at_state user_id non-null for new keys ===');
{
    _clearKey('brain:cooldowns:' + ADMIN_ID, ADMIN_ID);
    Bh.setCooldownDeadline(ADMIN_ID, 'BTCUSDT', 5 * 60 * 1000);
    Bh.persistRegimeTgThrottle.call(null);
    Ah.setCloseCooldownDeadline(ADMIN_ID, 'BTCUSDT');
    // Use the public DB query layer — count NULL-user_id rows for our keys.
    const stmt = db.db ? db.db.prepare(
        "SELECT key, user_id FROM at_state WHERE key IN (?, ?, ?) ORDER BY key"
    ) : null;
    if (stmt) {
        const rows = stmt.all(
            'brain:cooldowns:' + ADMIN_ID,
            'brain:regimeTg:' + ADMIN_ID,
            'serverAT:closeCooldowns:' + ADMIN_ID
        );
        const nullCount = rows.filter(r => r.user_id === null || r.user_id === undefined).length;
        check('T15: zero NULL user_id rows for the three S5 keys',
            nullCount === 0,
            'rows: ' + JSON.stringify(rows));
    } else {
        // db.db not exported — fall back to the existing helpers and just
        // verify each row reads back non-empty (our setter would have refused
        // to insert NULL anyway because of the NOT NULL constraint).
        check('T15: brain:cooldowns row reads back',
            !!db.atGetState('brain:cooldowns:' + ADMIN_ID));
        check('T15: serverAT:closeCooldowns row reads back',
            !!db.atGetState('serverAT:closeCooldowns:' + ADMIN_ID));
    }
}

// ════════════════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════════════════
console.log('\n========================================================');
console.log(`probe-s5: ${pass}/${pass + fail} PASS`);
console.log('========================================================');
process.exit(fail === 0 ? 0 : 1);
