// [Phase 2 S6-A] Standalone probe — contract verification for the
// positions.changed WS frame already emitted by serverAT._broadcastPositions
// (MIGRATION-F5 / b89). This batch does NOT perform the DEMO server-
// authoritative decision-engine flip — that is S6-B and remains BLOCKED.
//
// Approach: drive _broadcastPositions through serverAT._s6TestHooks while
// stubbing global.__zeusWsBroadcastToUser to capture the emitted frames.
// Snapshot/restore any test-touched at_positions rows so the live DB ends
// in the same state.
//
// Run: node tests/probe-s6.js   (exits 0 on full PASS, 1 on any FAIL)
'use strict';

const fs = require('fs');
const path = require('path');

const db = require('../server/services/database');
const at = require('../server/services/serverAT');
const MF = require('../server/migrationFlags');
const Sh = at._s6TestHooks;

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { console.log('  ✓ ' + name); pass++; }
    else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); fail++; }
}

// ── Pick test users (mirror probe-s2 / probe-s5 fallback) ──────────────────
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
console.log('probe-s6 ADMIN_ID=' + ADMIN_ID + ' USER2_ID=' + USER2_ID);

// ── Snapshot at_positions rows we will create / mutate ─────────────────────
// We use very-large seq numbers so we never collide with real positions.
const SEQ_PROBE_BASE = 9_000_000_000;
const SEQ_ADMIN_A = SEQ_PROBE_BASE + 1;
const SEQ_ADMIN_B = SEQ_PROBE_BASE + 2;
const SEQ_USER2_A = SEQ_PROBE_BASE + 3;
const SEQ_DB_ONLY = SEQ_PROBE_BASE + 4; // exists in DB but not in _positions

// Capture original WS broadcaster so we can restore.
const _origBroadcaster = global.__zeusWsBroadcastToUser;

// Stub broadcaster: records every (uid, frame) call.
let _calls = [];
function _stubBroadcaster() {
    _calls = [];
    global.__zeusWsBroadcastToUser = function (uid, frame) {
        _calls.push({ uid, frame });
    };
}
function _restoreBroadcaster() {
    if (typeof _origBroadcaster === 'function') global.__zeusWsBroadcastToUser = _origBroadcaster;
    else delete global.__zeusWsBroadcastToUser;
}

// Best-effort cleanup of probe-injected rows
function _cleanupProbeRows() {
    for (const seq of [SEQ_ADMIN_A, SEQ_ADMIN_B, SEQ_USER2_A, SEQ_DB_ONLY]) {
        try { db.atRemovePosition(seq); } catch (_) {}
    }
    // Also drop any in-memory copies that may have been added
    if (Array.isArray(Sh.positions)) {
        for (let i = Sh.positions.length - 1; i >= 0; i--) {
            const p = Sh.positions[i];
            if (p && p.seq >= SEQ_PROBE_BASE) Sh.positions.splice(i, 1);
        }
    }
}
process.on('exit', () => {
    try { _cleanupProbeRows(); } catch (_) {}
    try { _restoreBroadcaster(); } catch (_) {}
});

function _makePosition(seq, userId, symbol, mode, sourceMode) {
    return {
        seq,
        userId,
        symbol,
        side: 'LONG',
        entryPrice: 50000,
        qty: 0.001,
        leverage: 10,
        lev: 10,
        mode: mode || 'demo',
        status: 'OPEN',
        autoTrade: sourceMode === 'auto',
        sourceMode: sourceMode || 'manual',
        controlMode: sourceMode === 'auto' ? 'auto' : 'user',
        opened_at: Date.now(),
    };
}

// ════════════════════════════════════════════════════════════════════════
// T0 — Test hook surface
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T0 — _s6TestHooks export surface ===');
{
    check('T0: at._s6TestHooks is an object', typeof Sh === 'object' && Sh !== null);
    check('T0: at._s6TestHooks frozen', Object.isFrozen(Sh));
    check('T0: hooks expose exactly { broadcastPositions, normalizePositionRow, positions }',
        Object.keys(Sh).sort().join(',') ===
        'broadcastPositions,normalizePositionRow,positions');
    check('T0: broadcastPositions is a function', typeof Sh.broadcastPositions === 'function');
    check('T0: normalizePositionRow is a function', typeof Sh.normalizePositionRow === 'function');
    check('T0: positions is an Array (in-memory _positions ref)', Array.isArray(Sh.positions));
    check('T0: at._s5TestHooks still present (S5 invariant survives)',
        typeof at._s5TestHooks === 'object' && Object.isFrozen(at._s5TestHooks));
}

// ════════════════════════════════════════════════════════════════════════
// T1 — Frame shape matches WsPositionsChanged contract
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T1 — positions.changed frame shape ===');
{
    _cleanupProbeRows();
    _stubBroadcaster();

    db.atSavePosition(_makePosition(SEQ_ADMIN_A, ADMIN_ID, 'BTCUSDT', 'demo', 'manual'));
    Sh.broadcastPositions(ADMIN_ID);

    check('T1: stub broadcaster called exactly once', _calls.length === 1);
    const c = _calls[0] || {};
    check('T1: broadcaster called with ADMIN_ID', c.uid === ADMIN_ID);
    const f = c.frame || {};
    check('T1: frame.type === "positions.changed"', f.type === 'positions.changed');
    check('T1: frame.updated_at is finite number', Number.isFinite(f.updated_at));
    check('T1: frame.snapshot is an object', f.snapshot && typeof f.snapshot === 'object');
    check('T1: frame.snapshot.updated_at === frame.updated_at',
        f.snapshot && f.snapshot.updated_at === f.updated_at);
    check('T1: frame.snapshot.positions is an Array',
        f.snapshot && Array.isArray(f.snapshot.positions));
    check('T1: NO `userId` field on frame (scope from connection)',
        !Object.prototype.hasOwnProperty.call(f, 'userId'));

    _cleanupProbeRows();
    _restoreBroadcaster();
}

// ════════════════════════════════════════════════════════════════════════
// T2 — Per-user broadcaster called with correct uid
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T2 — broadcaster called with correct per-user uid ===');
{
    _cleanupProbeRows();
    _stubBroadcaster();

    db.atSavePosition(_makePosition(SEQ_ADMIN_A, ADMIN_ID, 'BTCUSDT', 'demo', 'manual'));
    Sh.broadcastPositions(ADMIN_ID);
    check('T2: ADMIN broadcast targets ADMIN_ID',
        _calls.length === 1 && _calls[0].uid === ADMIN_ID);

    if (USER2_ID !== ADMIN_ID) {
        _calls = [];
        db.atSavePosition(_makePosition(SEQ_USER2_A, USER2_ID, 'ETHUSDT', 'demo', 'manual'));
        Sh.broadcastPositions(USER2_ID);
        check('T2: USER2 broadcast targets USER2_ID',
            _calls.length === 1 && _calls[0].uid === USER2_ID);
        check('T2: USER2 broadcast did NOT route to ADMIN_ID',
            _calls.every(c => c.uid !== ADMIN_ID));
    } else {
        check('T2: USER2_ID == ADMIN_ID — single-user env, N/A', true);
    }

    _cleanupProbeRows();
    _restoreBroadcaster();
}

// ════════════════════════════════════════════════════════════════════════
// T3 — DB-authoritative snapshot (anti-zombie semantics)
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T3 — snapshot pulls from DB, not in-memory _positions ===');
{
    _cleanupProbeRows();
    _stubBroadcaster();

    // Insert a row in DB without adding to in-memory _positions.
    db.atSavePosition(_makePosition(SEQ_DB_ONLY, ADMIN_ID, 'XRPUSDT', 'demo', 'auto'));
    const inMemSeqs = Sh.positions.filter(p => p.userId === ADMIN_ID).map(p => p.seq);
    check('T3: SEQ_DB_ONLY NOT in in-memory _positions',
        !inMemSeqs.includes(SEQ_DB_ONLY));

    Sh.broadcastPositions(ADMIN_ID);
    check('T3: broadcast called once', _calls.length === 1);
    const positions = _calls[0] && _calls[0].frame && _calls[0].frame.snapshot && _calls[0].frame.snapshot.positions || [];
    const seqs = positions.map(p => p.seq);
    check('T3: snapshot includes the DB-only row (anti-zombie / DB authority)',
        seqs.includes(SEQ_DB_ONLY));

    _cleanupProbeRows();
    _restoreBroadcaster();
}

// ════════════════════════════════════════════════════════════════════════
// T4 — Normalized rows carry Phase 9C2 defensive fields
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T4 — normalized rows have Phase 9C2 defensive fields ===');
{
    _cleanupProbeRows();
    _stubBroadcaster();

    // Save a row WITHOUT autoTrade/sourceMode/controlMode/lev so the
    // normalizer must defensively fill them.
    db.atSavePosition({
        seq: SEQ_ADMIN_A,
        userId: ADMIN_ID,
        symbol: 'BTCUSDT',
        side: 'LONG',
        entryPrice: 50000,
        qty: 0.001,
        mode: 'demo',
        status: 'OPEN',
    });
    Sh.broadcastPositions(ADMIN_ID);
    const positions = (_calls[0] && _calls[0].frame && _calls[0].frame.snapshot && _calls[0].frame.snapshot.positions) || [];
    const row = positions.find(p => p.seq === SEQ_ADMIN_A);
    check('T4: row found in snapshot', !!row);
    if (row) {
        check('T4: row.autoTrade is boolean', typeof row.autoTrade === 'boolean');
        check('T4: row.sourceMode is string', typeof row.sourceMode === 'string' && row.sourceMode.length > 0);
        check('T4: row.controlMode is string', typeof row.controlMode === 'string' && row.controlMode.length > 0);
        check('T4: row.lev is positive number', typeof row.lev === 'number' && row.lev > 0);
        check('T4: row.dsl key present (may be null)', Object.prototype.hasOwnProperty.call(row, 'dsl'));
    }

    _cleanupProbeRows();
    _restoreBroadcaster();
}

// ════════════════════════════════════════════════════════════════════════
// T5 — POSITIONS_WS current production state is true
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T5 — POSITIONS_WS production state ===');
{
    check('T5: POSITIONS_WS === true', MF.POSITIONS_WS === true);
}

// ════════════════════════════════════════════════════════════════════════
// T6 — POSITIONS_WS=false simulated (try property override; skip if unsafe)
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T6 — POSITIONS_WS=false skips broadcast (mock-toggled) ===');
{
    let canMock = false;
    const desc = Object.getOwnPropertyDescriptor(MF, 'POSITIONS_WS');
    if (desc && desc.configurable) {
        try {
            Object.defineProperty(MF, 'POSITIONS_WS', { get: () => false, configurable: true });
            canMock = MF.POSITIONS_WS === false;
        } catch (_) { canMock = false; }
    }
    if (canMock) {
        _cleanupProbeRows();
        _stubBroadcaster();
        db.atSavePosition(_makePosition(SEQ_ADMIN_A, ADMIN_ID, 'BTCUSDT', 'demo', 'manual'));
        Sh.broadcastPositions(ADMIN_ID);
        check('T6: broadcaster NOT called when POSITIONS_WS=false', _calls.length === 0);
        _cleanupProbeRows();
        _restoreBroadcaster();
        // Restore real getter
        try { Object.defineProperty(MF, 'POSITIONS_WS', desc); } catch (_) {}
        check('T6: POSITIONS_WS restored to original true', MF.POSITIONS_WS === true);
    } else {
        check('T6: POSITIONS_WS getter not configurable — skipped (documented)', true);
    }
}

// ════════════════════════════════════════════════════════════════════════
// T7 — Missing __zeusWsBroadcastToUser: must not throw
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T7 — missing global broadcaster: silent skip, no throw ===');
{
    _cleanupProbeRows();
    db.atSavePosition(_makePosition(SEQ_ADMIN_A, ADMIN_ID, 'BTCUSDT', 'demo', 'manual'));
    const orig = global.__zeusWsBroadcastToUser;
    delete global.__zeusWsBroadcastToUser;
    let threw = false;
    try { Sh.broadcastPositions(ADMIN_ID); } catch (_) { threw = true; }
    check('T7: _broadcastPositions did NOT throw when broadcaster missing', !threw);
    if (typeof orig === 'function') global.__zeusWsBroadcastToUser = orig;
    _cleanupProbeRows();
}

// ════════════════════════════════════════════════════════════════════════
// T8 — Per-user isolation in normalized rows
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T8 — per-user isolation in snapshot rows ===');
{
    _cleanupProbeRows();
    _stubBroadcaster();
    db.atSavePosition(_makePosition(SEQ_ADMIN_A, ADMIN_ID, 'BTCUSDT', 'demo', 'manual'));
    db.atSavePosition(_makePosition(SEQ_ADMIN_B, ADMIN_ID, 'ETHUSDT', 'demo', 'auto'));
    if (USER2_ID !== ADMIN_ID) {
        db.atSavePosition(_makePosition(SEQ_USER2_A, USER2_ID, 'SOLUSDT', 'demo', 'manual'));
    }

    Sh.broadcastPositions(ADMIN_ID);
    const adminPositions = (_calls[0] && _calls[0].frame && _calls[0].frame.snapshot && _calls[0].frame.snapshot.positions) || [];
    const adminSeqs = adminPositions.map(p => p.seq);
    check('T8: ADMIN snapshot includes both ADMIN seqs',
        adminSeqs.includes(SEQ_ADMIN_A) && adminSeqs.includes(SEQ_ADMIN_B));
    if (USER2_ID !== ADMIN_ID) {
        check('T8: ADMIN snapshot does NOT include USER2 seq (no cross-user bleed)',
            !adminSeqs.includes(SEQ_USER2_A));
    } else {
        check('T8: USER2_ID == ADMIN_ID — N/A', true);
    }
    check('T8: every position in snapshot has userId === ADMIN_ID',
        adminPositions.every(p => p.userId === ADMIN_ID));

    _cleanupProbeRows();
    _restoreBroadcaster();
}

// ════════════════════════════════════════════════════════════════════════
// T9 — Empty positions snapshot is empty array, not undefined
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T9 — empty positions snapshot ===');
{
    _cleanupProbeRows();
    _stubBroadcaster();
    // Pick a uid that will not have any open positions in DB.
    Sh.broadcastPositions(ADMIN_ID);
    // Note: real ADMIN may have legitimate open positions today; we cannot
    // safely synthesise "no rows" without disturbing live state. Verify
    // shape only — array must exist and be defined.
    const f = (_calls[0] && _calls[0].frame) || {};
    check('T9: snapshot.positions defined and is Array',
        f.snapshot && Array.isArray(f.snapshot.positions));
    _restoreBroadcaster();
}

// ════════════════════════════════════════════════════════════════════════
// T10 — at_update and positions.changed are independent paths (source-level)
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T10 — at_update and positions.changed are independent ===');
{
    const serverJsPath = path.resolve(__dirname, '..', 'server.js');
    const atPath = path.resolve(__dirname, '..', 'server', 'services', 'serverAT.js');
    const serverSrc = fs.readFileSync(serverJsPath, 'utf8');
    const atSrc = fs.readFileSync(atPath, 'utf8');
    check('T10: server.js emits at_update', /'at_update'/.test(serverSrc) || /"at_update"/.test(serverSrc));
    check('T10: serverAT.js emits positions.changed', /'positions\.changed'/.test(atSrc) || /"positions\.changed"/.test(atSrc));
    check('T10: serverAT.js does NOT emit at_update (separate channel)',
        !/'at_update'/.test(atSrc) && !/"at_update"/.test(atSrc));
}

// ════════════════════════════════════════════════════════════════════════
// T11 — Source-level: no localStorage / window. refs in serverAT.js
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T11 — serverAT.js source: no client-state refs ===');
{
    const atPath = path.resolve(__dirname, '..', 'server', 'services', 'serverAT.js');
    const atSrc = fs.readFileSync(atPath, 'utf8');
    const stripped = atSrc
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    check('T11: no localStorage in serverAT code', !/\blocalStorage\b/.test(stripped));
    check('T11: no window. in serverAT code', !/\bwindow\.[A-Za-z_]/.test(stripped));
}

// ════════════════════════════════════════════════════════════════════════
// T12 — Source-level: no Bybit imports in serverAT.js
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T12 — serverAT.js source: no Bybit imports ===');
{
    const atPath = path.resolve(__dirname, '..', 'server', 'services', 'serverAT.js');
    const atSrc = fs.readFileSync(atPath, 'utf8');
    const stripped = atSrc
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    check('T12: no require(...bybit*...) in serverAT code',
        !/require\(['"][^'"]*bybit[A-Z][^'"]*['"]\)/.test(stripped));
}

// ════════════════════════════════════════════════════════════════════════
// T13 — Client positionsStore: no localStorage truth for positions/balance/stats
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T13 — client positionsStore: no localStorage truth ===');
{
    const storePath = path.resolve(__dirname, '..', 'client', 'src', 'stores', 'positionsStore.ts');
    const storeSrc = fs.readFileSync(storePath, 'utf8');
    const stripped = storeSrc
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    check('T13: positionsStore.ts has no localStorage references',
        !/\blocalStorage\b/.test(stripped));
}

// ════════════════════════════════════════════════════════════════════════
// T14 — Migration flags safe (didn't accidentally flip)
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T14 — migration flags safe ===');
{
    const all = MF.getAll();
    check('T14: SERVER_AT === false (DEMO flip not done)', all.SERVER_AT === false);
    check('T14: CLIENT_AT === true (client engine still owns decisions)', all.CLIENT_AT === true);
    check('T14: POSITIONS_WS === true (broadcast active)', all.POSITIONS_WS === true);
    check('T14: BYBIT_DRY_RUN_ONLY === true', all.BYBIT_DRY_RUN_ONLY === true);
    check('T14: BYBIT_PARITY_ENABLED === false', all.BYBIT_PARITY_ENABLED === false);
}

// ════════════════════════════════════════════════════════════════════════
// T15 — Logger.warn observability hardening present in source
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T15 — _broadcastPositions catch uses logger.warn (S6-A hardening) ===');
{
    const atPath = path.resolve(__dirname, '..', 'server', 'services', 'serverAT.js');
    const atSrc = fs.readFileSync(atPath, 'utf8');
    check('T15: _broadcastPositions catch uses logger.warn',
        /broadcastPositions failed uid=/.test(atSrc));
    check('T15: legacy silent catch (broadcast is best-effort) gone',
        !/catch\s*\(\s*_\s*\)\s*\{\s*\/\*\s*broadcast is best-effort\s*\*\/\s*\}/.test(atSrc));
}

// ════════════════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════════════════
console.log('\n========================================================');
console.log(`probe-s6: ${pass}/${pass + fail} PASS`);
console.log('========================================================');
process.exit(fail === 0 ? 0 : 1);
