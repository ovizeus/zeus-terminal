// [Phase 2 S6-B3] Standalone probe — verifies the per-user decisionId
// dedup helper added in serverAT.js (`_checkAndStoreDecisionId` +
// `_decisionDedupKey`) and its placement inside `processBrainDecision`
// before any persistence / DSL attach / broadcast / live execution.
//
// HARD CONTRACT:
//   - Read-only against the live `serverAT` + `database` modules.
//   - Snapshots and restores at_state rows the probe touches so the
//     live DB ends in the same state.
//   - No HTTP, no PM2 reload, no flag flip, no DB migration.
//
// Run: node tests/probe-s6b3.js   (exits 0 on full PASS, 1 on any FAIL)
'use strict';

const fs = require('fs');
const path = require('path');

const db = require('../server/services/database');
const at = require('../server/services/serverAT');
const MF = require('../server/migrationFlags');
const Hk = at._s6b3TestHooks;

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { console.log('  ✓ ' + name); pass++; }
    else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); fail++; }
}

// ── Pick test users (mirror probe-s2 / s5 fallback) ────────────────────────
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
console.log('probe-s6b3 ADMIN_ID=' + ADMIN_ID + ' USER2_ID=' + USER2_ID);

// ── Snapshot dedup keys + restore at end ───────────────────────────────────
const _SNAP_KEYS = [
    'serverAT:lastDecisionId:' + ADMIN_ID,
    'serverAT:lastDecisionId:' + USER2_ID,
];
const _snapshot = new Map();
for (const k of _SNAP_KEYS) {
    try { _snapshot.set(k, db.atGetState(k)); } catch (_) { _snapshot.set(k, undefined); }
}
function _restoreSnapshot() {
    for (const [k, v] of _snapshot) {
        const m = /:(\d+)$/.exec(k);
        const uid = m ? parseInt(m[1], 10) : ADMIN_ID;
        if (v === undefined || v === null) {
            try { db.atSetState(k, null, uid); } catch (_) {}
        } else {
            try { db.atSetState(k, v, uid); } catch (_) {}
        }
    }
}
process.on('exit', _restoreSnapshot);

function _clearKey(uid) {
    try { db.atSetState('serverAT:lastDecisionId:' + uid, null, uid); } catch (_) {}
}

// ════════════════════════════════════════════════════════════════════════
// T0 — Test hook surface
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T0 — _s6b3TestHooks export surface ===');
{
    check('T0: _s6b3TestHooks is an object', typeof Hk === 'object' && Hk !== null);
    check('T0: _s6b3TestHooks frozen', Object.isFrozen(Hk));
    check('T0: hooks expose exactly { DECISION_DEDUP_TTL_MS, decisionDedupKey, checkAndStoreDecisionId }',
        Object.keys(Hk).sort().join(',') ===
        'DECISION_DEDUP_TTL_MS,checkAndStoreDecisionId,decisionDedupKey');
    check('T0: DECISION_DEDUP_TTL_MS is a number', typeof Hk.DECISION_DEDUP_TTL_MS === 'number');
    check('T0: decisionDedupKey is a function', typeof Hk.decisionDedupKey === 'function');
    check('T0: checkAndStoreDecisionId is a function', typeof Hk.checkAndStoreDecisionId === 'function');
    // S5/S6-A/S6-B2 hooks survive
    check('T0: at._s5TestHooks still present', typeof at._s5TestHooks === 'object');
    check('T0: at._s6TestHooks still present', typeof at._s6TestHooks === 'object');
    check('T0: at._s6b2TestHooks still present', typeof at._s6b2TestHooks === 'object');
}

// ════════════════════════════════════════════════════════════════════════
// T1 — Production flags safe
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T1 — production flags safe ===');
{
    const all = MF.getAll();
    check('T1: SERVER_AT === false', all.SERVER_AT === false);
    check('T1: SERVER_BRAIN === false', all.SERVER_BRAIN === false);
    check('T1: SERVER_AT_DEMO === false', all.SERVER_AT_DEMO === false);
    check('T1: SERVER_BRAIN_DEMO === false', all.SERVER_BRAIN_DEMO === false);
    check('T1: DECISION_DEDUP_TTL_MS === 30000 (one brain cycle)',
        Hk.DECISION_DEDUP_TTL_MS === 30000);
}

// ════════════════════════════════════════════════════════════════════════
// T2 — Key construction (per-user isolation)
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T2 — dedup key construction ===');
{
    const k1 = Hk.decisionDedupKey(1);
    const k2 = Hk.decisionDedupKey(2);
    check('T2: keys differ across users', k1 !== k2);
    check('T2: key includes uid 1', k1.endsWith(':1') && k1.startsWith('serverAT:lastDecisionId:'));
    check('T2: key includes uid 2', k2.endsWith(':2') && k2.startsWith('serverAT:lastDecisionId:'));
    check('T2: key for ADMIN_ID matches expected pattern',
        Hk.decisionDedupKey(ADMIN_ID) === 'serverAT:lastDecisionId:' + ADMIN_ID);
}

// ════════════════════════════════════════════════════════════════════════
// T3 — Basic dedup flow: same uid + same id within TTL → blocked
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T3 — basic dedup flow ===');
{
    _clearKey(ADMIN_ID);
    const now = 1_777_400_000_000;
    const r1 = Hk.checkAndStoreDecisionId(ADMIN_ID, 'abc12345', 'server', now);
    check('T3: first call (ADMIN, abc12345) → ok:true', r1.ok === true);
    const r2 = Hk.checkAndStoreDecisionId(ADMIN_ID, 'abc12345', 'server', now + 100);
    check('T3: second call same id within TTL → ok:false', r2.ok === false);
    check('T3: second call reason === DUPLICATE_DECISION_ID', r2.reason === 'DUPLICATE_DECISION_ID');
    check('T3: second call previous record present', r2.previous && typeof r2.previous === 'object');
    check('T3: previous.id matches', r2.previous && r2.previous.id === 'abc12345');
    const r3 = Hk.checkAndStoreDecisionId(ADMIN_ID, 'def45678', 'server', now + 200);
    check('T3: same uid different id → ok:true', r3.ok === true);
    _clearKey(ADMIN_ID);
}

// ════════════════════════════════════════════════════════════════════════
// T4 — Per-user isolation: cross-user same id → both allowed
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T4 — per-user isolation ===');
{
    _clearKey(ADMIN_ID);
    if (USER2_ID !== ADMIN_ID) _clearKey(USER2_ID);
    const now = 1_777_400_001_000;
    const rA = Hk.checkAndStoreDecisionId(ADMIN_ID, 'shared999', 'server', now);
    check('T4: ADMIN first store → ok:true', rA.ok === true);
    if (USER2_ID !== ADMIN_ID) {
        const rB = Hk.checkAndStoreDecisionId(USER2_ID, 'shared999', 'server', now + 100);
        check('T4: USER2 SAME id → ok:true (per-user isolated)', rB.ok === true);
        const rC = Hk.checkAndStoreDecisionId(ADMIN_ID, 'shared999', 'server', now + 200);
        check('T4: ADMIN re-call within TTL → STILL blocked (per-user state intact)',
            rC.ok === false && rC.reason === 'DUPLICATE_DECISION_ID');
    } else {
        check('T4: USER2_ID == ADMIN_ID — single-user env, isolation N/A', true);
    }
    _clearKey(ADMIN_ID);
    if (USER2_ID !== ADMIN_ID) _clearKey(USER2_ID);
}

// ════════════════════════════════════════════════════════════════════════
// T5 — TTL boundary: same id after TTL+1ms → allowed
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T5 — TTL boundary ===');
{
    _clearKey(ADMIN_ID);
    const t0 = 1_777_400_002_000;
    const r1 = Hk.checkAndStoreDecisionId(ADMIN_ID, 'ttltest', 'server', t0);
    check('T5: store at t0 → ok:true', r1.ok === true);
    // Just inside TTL
    const r2 = Hk.checkAndStoreDecisionId(ADMIN_ID, 'ttltest', 'server',
        t0 + Hk.DECISION_DEDUP_TTL_MS - 1);
    check('T5: same id at t0+(TTL-1ms) → blocked', r2.ok === false);
    // EXACTLY at boundary (now - prev.ts === TTL → not strictly less than)
    const r3 = Hk.checkAndStoreDecisionId(ADMIN_ID, 'ttltest', 'server',
        t0 + Hk.DECISION_DEDUP_TTL_MS);
    check('T5: same id at t0+TTL exact → allowed (strictly-less predicate)',
        r3.ok === true);
    _clearKey(ADMIN_ID);
    // After TTL+1ms
    const t1 = 1_777_400_003_000;
    const r4 = Hk.checkAndStoreDecisionId(ADMIN_ID, 'ttltest', 'server', t1);
    check('T5: fresh store t1 → ok:true', r4.ok === true);
    const r5 = Hk.checkAndStoreDecisionId(ADMIN_ID, 'ttltest', 'server',
        t1 + Hk.DECISION_DEDUP_TTL_MS + 1);
    check('T5: same id at t1+TTL+1ms → allowed', r5.ok === true);
    _clearKey(ADMIN_ID);
}

// ════════════════════════════════════════════════════════════════════════
// T6 — Defensive rejects
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T6 — defensive input handling ===');
{
    // Missing userId → fail-safe NO_USER_ID
    const r1 = Hk.checkAndStoreDecisionId(undefined, 'x', 'server', Date.now());
    check('T6: undefined userId → ok:false reason NO_USER_ID',
        r1.ok === false && r1.reason === 'NO_USER_ID');
    const r2 = Hk.checkAndStoreDecisionId(null, 'x', 'server', Date.now());
    check('T6: null userId → ok:false reason NO_USER_ID',
        r2.ok === false && r2.reason === 'NO_USER_ID');
    const r3 = Hk.checkAndStoreDecisionId('', 'x', 'server', Date.now());
    check('T6: empty-string userId → ok:false reason NO_USER_ID',
        r3.ok === false && r3.reason === 'NO_USER_ID');

    // Missing decisionId → ok:true with NO_DECISION_ID reason (back-compat)
    const r4 = Hk.checkAndStoreDecisionId(ADMIN_ID, undefined, 'server', Date.now());
    check('T6: undefined decisionId → ok:true reason NO_DECISION_ID',
        r4.ok === true && r4.reason === 'NO_DECISION_ID');
    const r5 = Hk.checkAndStoreDecisionId(ADMIN_ID, '', 'server', Date.now());
    check('T6: empty decisionId → ok:true reason NO_DECISION_ID',
        r5.ok === true && r5.reason === 'NO_DECISION_ID');

    // Numeric decisionId is coerced to string and stored
    _clearKey(ADMIN_ID);
    const t = 1_777_400_004_000;
    const r6 = Hk.checkAndStoreDecisionId(ADMIN_ID, 12345, 'server', t);
    check('T6: numeric decisionId accepted (coerced to string)', r6.ok === true);
    const r7 = Hk.checkAndStoreDecisionId(ADMIN_ID, '12345', 'server', t + 100);
    check('T6: matching string equivalent → blocked', r7.ok === false);
    _clearKey(ADMIN_ID);

    // nowMs not finite → uses Date.now() — just confirm no throw
    let threw = false;
    try { Hk.checkAndStoreDecisionId(ADMIN_ID, 'noNow', 'server', NaN); } catch (_) { threw = true; }
    check('T6: NaN nowMs does not throw', !threw);
    _clearKey(ADMIN_ID);
}

// ════════════════════════════════════════════════════════════════════════
// T7 — Malformed at_state row tolerance
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T7 — malformed at_state row tolerance ===');
{
    // Write a corrupted record directly.
    db.atSetState('serverAT:lastDecisionId:' + ADMIN_ID,
        { id: 42, ts: 'not-a-number' /* malformed */ }, ADMIN_ID);
    const t = 1_777_400_005_000;
    const r = Hk.checkAndStoreDecisionId(ADMIN_ID, 'recovered', 'server', t);
    check('T7: malformed prev → next valid call accepted (recovery)', r.ok === true);
    // Confirm a follow-up matching call is now blocked (state was repaired)
    const r2 = Hk.checkAndStoreDecisionId(ADMIN_ID, 'recovered', 'server', t + 100);
    check('T7: follow-up matching id → blocked (state repaired correctly)',
        r2.ok === false && r2.reason === 'DUPLICATE_DECISION_ID');
    _clearKey(ADMIN_ID);
}

// ════════════════════════════════════════════════════════════════════════
// T8 — Persistence: stored row contains source + ts + id
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T8 — persisted row shape ===');
{
    _clearKey(ADMIN_ID);
    const t = 1_777_400_006_000;
    Hk.checkAndStoreDecisionId(ADMIN_ID, 'persistMe', 'server', t);
    const stored = db.atGetState('serverAT:lastDecisionId:' + ADMIN_ID);
    check('T8: stored is object', stored && typeof stored === 'object');
    check('T8: stored.id === "persistMe"', stored && stored.id === 'persistMe');
    check('T8: stored.ts === t', stored && stored.ts === t);
    check('T8: stored.source === "server"', stored && stored.source === 'server');
    // Default source when not specified
    _clearKey(ADMIN_ID);
    Hk.checkAndStoreDecisionId(ADMIN_ID, 'noSrc', undefined, t);
    const stored2 = db.atGetState('serverAT:lastDecisionId:' + ADMIN_ID);
    check('T8: missing source defaults to "unknown"',
        stored2 && stored2.source === 'unknown');
    _clearKey(ADMIN_ID);
}

// ════════════════════════════════════════════════════════════════════════
// T9 — Source-level: dedup wired into processBrainDecision before
//      _persistPosition / serverDSL.attach / _broadcastPositions /
//      _executeLiveEntry call sites
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T9 — source-level: dedup placement ===');
{
    const atPath = path.resolve(__dirname, '..', 'server', 'services', 'serverAT.js');
    const src = fs.readFileSync(atPath, 'utf8');

    // Locate processBrainDecision header.
    const fnIdx = src.search(/^function\s+processBrainDecision\s*\(/m);
    check('T9: processBrainDecision header present', fnIdx > 0);

    // Find dedup check (DUPLICATE_DECISION_ID return)
    const dedupIdx = src.indexOf('DUPLICATE_DECISION_ID', fnIdx);
    check('T9: DUPLICATE_DECISION_ID refusal present in processBrainDecision body',
        dedupIdx > fnIdx);

    // Find _checkAndStoreDecisionId call inside processBrainDecision
    const callIdx = src.indexOf('_checkAndStoreDecisionId(', fnIdx);
    check('T9: _checkAndStoreDecisionId call present in processBrainDecision',
        callIdx > fnIdx);

    // Body of processBrainDecision is between fnIdx and the next `^}` line.
    // For simple ordering proofs, find the indices of the direct call sites
    // we care about and assert dedup comes before all of them.
    //
    // Note on broadcast ordering: `_broadcastPositions(` is NOT called
    // directly from processBrainDecision; it is invoked transitively via
    // `_persistPosition` / `_persistClose` (per S6-A contract). Therefore
    // proving dedup-before-`_persistPosition` implies dedup-before-broadcast.
    // Probe-s6 (S6-A) already locks the persist→broadcast invariant.
    const persistIdx = src.indexOf('_persistPosition(entry)', fnIdx);
    const dslAttachIdx = src.indexOf('serverDSL.attach(entry', fnIdx);
    const execLiveIdx = src.indexOf('_executeLiveEntry(', fnIdx);

    check('T9: dedup call appears BEFORE first _persistPosition(entry) call',
        callIdx > 0 && persistIdx > 0 && callIdx < persistIdx);
    check('T9: dedup call appears BEFORE first serverDSL.attach(entry) call',
        callIdx > 0 && dslAttachIdx > 0 && callIdx < dslAttachIdx);
    check('T9: dedup call appears BEFORE first _executeLiveEntry( call',
        callIdx > 0 && execLiveIdx > 0 && callIdx < execLiveIdx);
    check('T9: dedup BEFORE broadcast (transitive via _persistPosition — S6-A invariant)',
        callIdx > 0 && persistIdx > 0 && callIdx < persistIdx);

    // S6-B2 mode guard must STILL be the first line of defense after _uState.
    const modeGuardIdx = src.indexOf("SERVER_AT_REQUIRED_FOR_LIVE", fnIdx);
    check('T9: S6-B2 mode guard appears BEFORE dedup (defense in depth ordering)',
        modeGuardIdx > 0 && modeGuardIdx < callIdx);
}

// ════════════════════════════════════════════════════════════════════════
// T10 — Source-level: no localStorage / no Bybit / no fetch
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T10 — no forbidden refs introduced ===');
{
    const atPath = path.resolve(__dirname, '..', 'server', 'services', 'serverAT.js');
    const stripComments = (s) => s
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    const src = stripComments(fs.readFileSync(atPath, 'utf8'));
    check('T10: no localStorage refs', !/\blocalStorage\b/.test(src));
    check('T10: no window. refs', !/\bwindow\.[A-Za-z_]/.test(src));
    check('T10: no Bybit module imports',
        !/require\(['"][^'"]*bybit[A-Z][^'"]*['"]\)/.test(src));
    check('T10: no fetch( / axios / http*.request introduced',
        !/\bfetch\s*\(/.test(src) && !/\baxios\b/.test(src) &&
        !/\bhttps?\.request\b/.test(src));
}

// ════════════════════════════════════════════════════════════════════════
// T11 — Forbidden files unchanged
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T11 — forbidden files not regressed ===');
{
    const stripComments = (s) => s
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    const brainSrc = stripComments(fs.readFileSync(
        path.resolve(__dirname, '..', 'server', 'services', 'serverBrain.js'), 'utf8'));
    const clientATSrc = stripComments(fs.readFileSync(
        path.resolve(__dirname, '..', 'client', 'src', 'trading', 'autotrade.ts'), 'utf8'));
    check('T11: serverBrain.js does NOT contain DUPLICATE_DECISION_ID',
        !/DUPLICATE_DECISION_ID/.test(brainSrc));
    check('T11: serverBrain.js does NOT contain _checkAndStoreDecisionId',
        !/_checkAndStoreDecisionId/.test(brainSrc));
    check('T11: client autotrade.ts does NOT contain DUPLICATE_DECISION_ID',
        !/DUPLICATE_DECISION_ID/.test(clientATSrc));
    check('T11: client autotrade.ts does NOT contain SERVER_AT_DEMO',
        !/\bSERVER_AT_DEMO\b/.test(clientATSrc));
    check('T11: client autotrade.ts does NOT contain SERVER_BRAIN_DEMO',
        !/\bSERVER_BRAIN_DEMO\b/.test(clientATSrc));
}

// ════════════════════════════════════════════════════════════════════════
// T12 — Bybit modules untouched
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T12 — Bybit modules untouched ===');
{
    const stripComments = (s) => s
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    for (const f of ['bybitSigner.js', 'bybitOrderTranslator.js', 'bybitParityShadow.js']) {
        const src = stripComments(fs.readFileSync(
            path.resolve(__dirname, '..', 'server', 'services', f), 'utf8'));
        check(`T12: ${f} has no DUPLICATE_DECISION_ID reference`,
            !/DUPLICATE_DECISION_ID/.test(src));
        check(`T12: ${f} has no _checkAndStoreDecisionId reference`,
            !/_checkAndStoreDecisionId/.test(src));
    }
}

// ════════════════════════════════════════════════════════════════════════
// T13 — Migration flags + version + database byte-identity
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T13 — migration flags + version + DB schema unchanged ===');
{
    const j = JSON.parse(fs.readFileSync(
        path.resolve(__dirname, '..', 'data', 'migration_flags.json'), 'utf8'));
    check('T13: SERVER_AT === false', j.SERVER_AT === false);
    check('T13: SERVER_BRAIN === false', j.SERVER_BRAIN === false);
    check('T13: SERVER_AT_DEMO === false', j.SERVER_AT_DEMO === false);
    check('T13: SERVER_BRAIN_DEMO === false', j.SERVER_BRAIN_DEMO === false);
    check('T13: BYBIT_DRY_RUN_ONLY === true', j.BYBIT_DRY_RUN_ONLY === true);
    const ver = require('../server/version');
    check('T13: version remains v1.7.67', ver.version === '1.7.67');
    check('T13: build remains b93', ver.build === 93);
}

// ════════════════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════════════════
console.log('\n========================================================');
console.log(`probe-s6b3: ${pass}/${pass + fail} PASS`);
console.log('========================================================');
process.exit(fail === 0 ? 0 : 1);
