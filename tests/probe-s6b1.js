// [Phase 2 S6-B1] Standalone probe — verifies the inert per-user-mode
// dispatch gate added in serverBrain.js (`_shouldRunMainCycle` and
// `_isServerAuthoritativeForUser`).
//
// HARD CONTRACT:
//   - Read-only against the live `serverBrain` module + live flags.
//   - Mocks migrationFlags via property-getter override on the SAME module
//     instance the helper reads — assertion-driven, restored at end.
//   - No `pm2 reload`, no flag flip on disk, no DB writes, no HTTP.
//
// Run: node tests/probe-s6b1.js   (exits 0 on full PASS, 1 on any FAIL)
'use strict';

const fs = require('fs');
const path = require('path');

const MF = require('../server/migrationFlags');
const brain = require('../server/services/serverBrain');
const Hk = brain._s6b1TestHooks;

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { console.log('  ✓ ' + name); pass++; }
    else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); fail++; }
}

// ── MF property-getter override (preserves and restores) ───────────────────
// migrationFlags exports per-flag getters defined via { get x() { return flags.x } }
// in a plain object literal — getters are configurable, so we can swap them
// for the duration of one assertion and restore.
const _origDescriptors = new Map();
function _mockFlag(key, value) {
    if (!_origDescriptors.has(key)) {
        _origDescriptors.set(key, Object.getOwnPropertyDescriptor(MF, key) || null);
    }
    Object.defineProperty(MF, key, {
        configurable: true, enumerable: true,
        get: () => value,
    });
}
function _restoreFlags() {
    for (const [key, desc] of _origDescriptors) {
        if (desc) Object.defineProperty(MF, key, desc);
        else delete MF[key];
    }
    _origDescriptors.clear();
}
process.on('exit', _restoreFlags);

function _runWithFlags(over, fn) {
    for (const [k, v] of Object.entries(over)) _mockFlag(k, v);
    try { return fn(); } finally { _restoreFlags(); }
}

// ════════════════════════════════════════════════════════════════════════
// T0 — Test hook surface
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T0 — _s6b1TestHooks export surface ===');
{
    check('T0: _s6b1TestHooks is an object', typeof Hk === 'object' && Hk !== null);
    check('T0: _s6b1TestHooks frozen', Object.isFrozen(Hk));
    check('T0: hooks expose exactly { shouldRunMainCycle, isServerAuthoritativeForUser }',
        Object.keys(Hk).sort().join(',') ===
        'isServerAuthoritativeForUser,shouldRunMainCycle');
    check('T0: shouldRunMainCycle is a function', typeof Hk.shouldRunMainCycle === 'function');
    check('T0: isServerAuthoritativeForUser is a function',
        typeof Hk.isServerAuthoritativeForUser === 'function');
    check('T0: brain._s5TestHooks still present (S5 invariant)',
        typeof brain._s5TestHooks === 'object' && Object.isFrozen(brain._s5TestHooks));
}

// ════════════════════════════════════════════════════════════════════════
// T1 — Real production flags: gate is INERT
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T1 — production flags: gate inert ===');
{
    const all = MF.getAll();
    check('T1: MF.SERVER_BRAIN === false', all.SERVER_BRAIN === false);
    check('T1: MF.SERVER_AT === false', all.SERVER_AT === false);
    check('T1: MF.SERVER_BRAIN_DEMO === false', all.SERVER_BRAIN_DEMO === false);
    check('T1: MF.SERVER_AT_DEMO === false', all.SERVER_AT_DEMO === false);
    // With production flags, helpers must return false
    check('T1: _shouldRunMainCycle() === false',
        Hk.shouldRunMainCycle() === false);
    check('T1: _isServerAuthoritativeForUser({mode:demo}) === false',
        Hk.isServerAuthoritativeForUser({ engineMode: 'demo' }) === false);
    check('T1: _isServerAuthoritativeForUser({mode:live}) === false',
        Hk.isServerAuthoritativeForUser({ engineMode: 'live' }) === false);
    check('T1: _isServerAuthoritativeForUser(null) === false (defensive)',
        Hk.isServerAuthoritativeForUser(null) === false);
    check('T1: _isServerAuthoritativeForUser(undefined) === false (defensive)',
        Hk.isServerAuthoritativeForUser(undefined) === false);
}

// ════════════════════════════════════════════════════════════════════════
// T2 — _shouldRunMainCycle truth table
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T2 — _shouldRunMainCycle truth table ===');
{
    // (SERVER_BRAIN=false, SERVER_BRAIN_DEMO=false) → false
    _runWithFlags({ SERVER_BRAIN: false, SERVER_BRAIN_DEMO: false }, () => {
        check('T2: both false → main cycle does NOT start',
            Hk.shouldRunMainCycle() === false);
    });
    // (SERVER_BRAIN=true, SERVER_BRAIN_DEMO=false) → true (full)
    _runWithFlags({ SERVER_BRAIN: true, SERVER_BRAIN_DEMO: false }, () => {
        check('T2: SERVER_BRAIN alone → main cycle starts',
            Hk.shouldRunMainCycle() === true);
    });
    // (SERVER_BRAIN=false, SERVER_BRAIN_DEMO=true) → true (carve-out)
    _runWithFlags({ SERVER_BRAIN: false, SERVER_BRAIN_DEMO: true }, () => {
        check('T2: SERVER_BRAIN_DEMO alone → main cycle starts (demo carve-out)',
            Hk.shouldRunMainCycle() === true);
    });
}

// ════════════════════════════════════════════════════════════════════════
// T3 — _isServerAuthoritativeForUser truth table
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T3 — _isServerAuthoritativeForUser truth table ===');
{
    const demo = { engineMode: 'demo' };
    const live = { engineMode: 'live' };

    // SERVER_AT=true → both demo and live dispatched
    _runWithFlags({ SERVER_AT: true, SERVER_AT_DEMO: false }, () => {
        check('T3: SERVER_AT=true && demo → authoritative',
            Hk.isServerAuthoritativeForUser(demo) === true);
        check('T3: SERVER_AT=true && live → authoritative',
            Hk.isServerAuthoritativeForUser(live) === true);
    });

    // SERVER_AT=false, SERVER_AT_DEMO=true → ONLY demo dispatched
    _runWithFlags({ SERVER_AT: false, SERVER_AT_DEMO: true }, () => {
        check('T3: SERVER_AT=false, SERVER_AT_DEMO=true && demo → authoritative',
            Hk.isServerAuthoritativeForUser(demo) === true);
        check('T3: SERVER_AT=false, SERVER_AT_DEMO=true && live → NOT authoritative',
            Hk.isServerAuthoritativeForUser(live) === false);
    });

    // Both false → never authoritative
    _runWithFlags({ SERVER_AT: false, SERVER_AT_DEMO: false }, () => {
        check('T3: both false && demo → NOT authoritative',
            Hk.isServerAuthoritativeForUser(demo) === false);
        check('T3: both false && live → NOT authoritative',
            Hk.isServerAuthoritativeForUser(live) === false);
    });

    // SERVER_AT_DEMO=true with non-demo modes (paranoid coverage)
    _runWithFlags({ SERVER_AT: false, SERVER_AT_DEMO: true }, () => {
        check('T3: SERVER_AT_DEMO=true && testnet → NOT authoritative',
            Hk.isServerAuthoritativeForUser({ engineMode: 'testnet' }) === false);
        check('T3: SERVER_AT_DEMO=true && real → NOT authoritative',
            Hk.isServerAuthoritativeForUser({ engineMode: 'real' }) === false);
        check('T3: SERVER_AT_DEMO=true && undefined mode → NOT authoritative',
            Hk.isServerAuthoritativeForUser({ engineMode: undefined }) === false);
        check('T3: SERVER_AT_DEMO=true && empty stc → NOT authoritative',
            Hk.isServerAuthoritativeForUser({}) === false);
    });
}

// ════════════════════════════════════════════════════════════════════════
// T4 — Source-level: dispatch sites are guarded by the new gate
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T4 — source-level dispatch gating ===');
{
    const brainPath = path.resolve(__dirname, '..', 'server', 'services', 'serverBrain.js');
    const src = fs.readFileSync(brainPath, 'utf8');
    // The per-user loop must call _isServerAuthoritativeForUser before any
    // processBrainDecision dispatch.
    check('T4: per-user loop has _isServerAuthoritativeForUser gate',
        /if\s*\(\s*!_isServerAuthoritativeForUser\s*\(\s*stc\s*\)\s*\)\s*continue/.test(src));
    // The dispatch points still exist (we didn't remove them).
    const dispatchCount = (src.match(/serverAT\.processBrainDecision\(/g) || []).length;
    check('T4: serverAT.processBrainDecision still has 3 call sites',
        dispatchCount === 3);
    // The gate sits BEFORE the dispatch — gate's "continue" line index <
    // first dispatch line index.
    const gateIdx = src.search(/!_isServerAuthoritativeForUser\(stc\)\)\s*continue/);
    const firstDispatchIdx = src.indexOf('serverAT.processBrainDecision(');
    check('T4: gate appears BEFORE first dispatch site',
        gateIdx > 0 && firstDispatchIdx > 0 && gateIdx < firstDispatchIdx);
    // start() now calls _shouldRunMainCycle.
    check('T4: start() uses _shouldRunMainCycle',
        /if\s*\(\s*_shouldRunMainCycle\s*\(\s*\)\s*\)/.test(src));
    // The shadow cycle suppresses when main cycle would run.
    check('T4: _runShadowCycle suppresses when _shouldRunMainCycle()',
        /!MF\.PARITY_SHADOW_ENABLED\s*\|\|\s*_shouldRunMainCycle\(\)/.test(src));
}

// ════════════════════════════════════════════════════════════════════════
// T5 — No forbidden refs introduced
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T5 — no forbidden refs introduced ===');
{
    const brainPath = path.resolve(__dirname, '..', 'server', 'services', 'serverBrain.js');
    const stripComments = (s) => s
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    const src = stripComments(fs.readFileSync(brainPath, 'utf8'));
    check('T5: no localStorage refs', !/\blocalStorage\b/.test(src));
    check('T5: no window. refs', !/\bwindow\.[A-Za-z_]/.test(src));
    check('T5: no Bybit module imports',
        !/require\(['"][^'"]*bybit[A-Z][^'"]*['"]\)/.test(src));
    check('T5: no fetch( / axios / http*.request introduced',
        !/\bfetch\s*\(/.test(src) && !/\baxios\b/.test(src) &&
        !/\bhttps?\.request\b/.test(src));
}

// ════════════════════════════════════════════════════════════════════════
// T6 — client autotrade.ts remains flag-free (until S6-B5).
// NOTE: serverAT.js references SERVER_AT_DEMO / SERVER_BRAIN_DEMO as of
// S6-B2 (paranoid live gate) and S6-B4 (at_update payload contract);
// those references are intentional and covered by probe-s6b2 / probe-s6b4.
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T6 — client autotrade.ts still flag-free (until S6-B5) ===');
{
    const stripComments = (s) => s
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    const clientATSrc = stripComments(fs.readFileSync(
        path.resolve(__dirname, '..', 'client', 'src', 'trading', 'autotrade.ts'), 'utf8'));
    check('T6: client autotrade.ts does NOT reference SERVER_AT_DEMO (until S6-B5)',
        !/\bSERVER_AT_DEMO\b/.test(clientATSrc));
    check('T6: client autotrade.ts does NOT reference SERVER_BRAIN_DEMO (until S6-B5)',
        !/\bSERVER_BRAIN_DEMO\b/.test(clientATSrc));
}

// ════════════════════════════════════════════════════════════════════════
// T7 — Bybit modules byte-identical (still untouched)
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T7 — Bybit modules untouched ===');
{
    const stripComments = (s) => s
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    for (const f of ['bybitSigner.js', 'bybitOrderTranslator.js', 'bybitParityShadow.js']) {
        const src = stripComments(fs.readFileSync(
            path.resolve(__dirname, '..', 'server', 'services', f), 'utf8'));
        check(`T7: ${f} has no SERVER_AT_DEMO reference`,
            !/\bSERVER_AT_DEMO\b/.test(src));
        check(`T7: ${f} has no SERVER_BRAIN_DEMO reference`,
            !/\bSERVER_BRAIN_DEMO\b/.test(src));
    }
}

// ════════════════════════════════════════════════════════════════════════
// T8 — Migration flags JSON unchanged (still 14 keys, both demo flags false)
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T8 — migration_flags.json unchanged ===');
{
    const j = JSON.parse(fs.readFileSync(
        path.resolve(__dirname, '..', 'data', 'migration_flags.json'), 'utf8'));
    check('T8: SERVER_AT === false', j.SERVER_AT === false);
    check('T8: SERVER_BRAIN === false', j.SERVER_BRAIN === false);
    check('T8: SERVER_AT_DEMO === false', j.SERVER_AT_DEMO === false);
    check('T8: SERVER_BRAIN_DEMO === false', j.SERVER_BRAIN_DEMO === false);
    check('T8: CLIENT_AT === true', j.CLIENT_AT === true);
    check('T8: CLIENT_BRAIN === true', j.CLIENT_BRAIN === true);
    check('T8: POSITIONS_WS === true', j.POSITIONS_WS === true);
    check('T8: PARITY_SHADOW_ENABLED === true', j.PARITY_SHADOW_ENABLED === true);
    check('T8: BYBIT_DRY_RUN_ONLY === true', j.BYBIT_DRY_RUN_ONLY === true);
    check('T8: BYBIT_LIVE_ENABLED === false', j.BYBIT_LIVE_ENABLED === false);
    check('T8: BYBIT_TESTNET_ENABLED === false', j.BYBIT_TESTNET_ENABLED === false);
}

// ════════════════════════════════════════════════════════════════════════
// T9 — S5/S6-A invariants survive
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T9 — S5 + S6-A invariants survive ===');
{
    check('T9: brain._s5TestHooks frozen', Object.isFrozen(brain._s5TestHooks));
    check('T9: cooldowns Map exists',
        brain._s5TestHooks.cooldowns instanceof Map);
    check('T9: prevRegimes Map exists',
        brain._s5TestHooks.prevRegimes instanceof Map);
    const at = require('../server/services/serverAT');
    check('T9: serverAT._s6TestHooks still present (S6-A invariant)',
        typeof at._s6TestHooks === 'object' && Object.isFrozen(at._s6TestHooks));
    check('T9: serverAT._s5TestHooks still present',
        typeof at._s5TestHooks === 'object' && Object.isFrozen(at._s5TestHooks));
}

// ════════════════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════════════════
console.log('\n========================================================');
console.log(`probe-s6b1: ${pass}/${pass + fail} PASS`);
console.log('========================================================');
process.exit(fail === 0 ? 0 : 1);
