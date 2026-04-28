// [Phase 2 S6-B0] Standalone probe — flag-freeze + mutex-carve-out
// verification for the inert DEMO server-authority flags shipped in S6-B0
// (`SERVER_AT_DEMO`, `SERVER_BRAIN_DEMO`).
//
// HARD CONTRACT:
//   - Read-only against the live `migrationFlags` module.
//   - Uses `_s6b0TestHooks.validateMutex` to exercise mutex carve-outs on
//     synthetic flag combinations without mutating live state.
//   - No `set()` calls, no JSON writes, no PM2 reload.
//
// Run: node tests/probe-s6b0.js   (exits 0 on full PASS, 1 on any FAIL)
'use strict';

const fs = require('fs');
const path = require('path');

const MF = require('../server/migrationFlags');
const Hk = MF._s6b0TestHooks;

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { console.log('  ✓ ' + name); pass++; }
    else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); fail++; }
}

// Build a baseline flag object equal to current live defaults; helper to
// override a few keys for each mutex test.
function _base() {
    return Object.assign({}, MF.getAll());
}
function _with(over) { return Object.assign(_base(), over); }

// ════════════════════════════════════════════════════════════════════════
// T0 — Test hook surface
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T0 — _s6b0TestHooks export surface ===');
{
    check('T0: _s6b0TestHooks is an object', typeof Hk === 'object' && Hk !== null);
    check('T0: _s6b0TestHooks frozen', Object.isFrozen(Hk));
    check('T0: hooks expose exactly { validateMutex }',
        Object.keys(Hk).sort().join(',') === 'validateMutex');
    check('T0: validateMutex is a function', typeof Hk.validateMutex === 'function');
    check('T0: live MF.getAll exposes a snapshot', typeof MF.getAll === 'function');
    check('T0: live module exports DEFAULTS', typeof MF.DEFAULTS === 'object');
}

// ════════════════════════════════════════════════════════════════════════
// T1 — DEFAULTS contain the new DEMO carve-out flags, both false
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T1 — DEFAULTS surface includes new DEMO flags ===');
{
    check('T1: DEFAULTS.SERVER_AT_DEMO exists',
        Object.prototype.hasOwnProperty.call(MF.DEFAULTS, 'SERVER_AT_DEMO'));
    check('T1: DEFAULTS.SERVER_BRAIN_DEMO exists',
        Object.prototype.hasOwnProperty.call(MF.DEFAULTS, 'SERVER_BRAIN_DEMO'));
    check('T1: DEFAULTS.SERVER_AT_DEMO === false', MF.DEFAULTS.SERVER_AT_DEMO === false);
    check('T1: DEFAULTS.SERVER_BRAIN_DEMO === false', MF.DEFAULTS.SERVER_BRAIN_DEMO === false);
    // Per-flag getter surface
    check('T1: MF.SERVER_AT_DEMO === false', MF.SERVER_AT_DEMO === false);
    check('T1: MF.SERVER_BRAIN_DEMO === false', MF.SERVER_BRAIN_DEMO === false);
    // getAll() carries them
    const all = MF.getAll();
    check('T1: getAll().SERVER_AT_DEMO === false', all.SERVER_AT_DEMO === false);
    check('T1: getAll().SERVER_BRAIN_DEMO === false', all.SERVER_BRAIN_DEMO === false);
}

// ════════════════════════════════════════════════════════════════════════
// T2 — data/migration_flags.json carries the new flags, both false
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T2 — data/migration_flags.json carries new flags ===');
{
    const jsonPath = path.resolve(__dirname, '..', 'data', 'migration_flags.json');
    const raw = fs.readFileSync(jsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    check('T2: JSON is valid object', typeof parsed === 'object' && parsed !== null);
    check('T2: JSON.SERVER_AT_DEMO present and false',
        Object.prototype.hasOwnProperty.call(parsed, 'SERVER_AT_DEMO') &&
        parsed.SERVER_AT_DEMO === false);
    check('T2: JSON.SERVER_BRAIN_DEMO present and false',
        Object.prototype.hasOwnProperty.call(parsed, 'SERVER_BRAIN_DEMO') &&
        parsed.SERVER_BRAIN_DEMO === false);
    // Existing Bybit safety flags must remain at safe defaults
    check('T2: JSON.BYBIT_TESTNET_ENABLED still false', parsed.BYBIT_TESTNET_ENABLED === false);
    check('T2: JSON.BYBIT_LIVE_ENABLED still false', parsed.BYBIT_LIVE_ENABLED === false);
    check('T2: JSON.BYBIT_PARITY_ENABLED still false', parsed.BYBIT_PARITY_ENABLED === false);
    check('T2: JSON.BYBIT_DRY_RUN_ONLY still true', parsed.BYBIT_DRY_RUN_ONLY === true);
    // Existing AT/BRAIN flags must remain unchanged
    check('T2: JSON.SERVER_AT still false', parsed.SERVER_AT === false);
    check('T2: JSON.SERVER_BRAIN still false', parsed.SERVER_BRAIN === false);
    check('T2: JSON.CLIENT_AT still true', parsed.CLIENT_AT === true);
    check('T2: JSON.CLIENT_BRAIN still true', parsed.CLIENT_BRAIN === true);
    check('T2: JSON.POSITIONS_WS still true', parsed.POSITIONS_WS === true);
}

// ════════════════════════════════════════════════════════════════════════
// T3 — Existing mutex still rejects pre-S6-B0 violations
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T3 — existing mutex rules preserved ===');
{
    const v1 = Hk.validateMutex(_with({ SERVER_AT: true, CLIENT_AT: true }));
    check('T3: SERVER_AT && CLIENT_AT rejected', v1.ok === false &&
        v1.violations.some(s => s.includes('SERVER_AT && CLIENT_AT')));
    const v2 = Hk.validateMutex(_with({ SERVER_BRAIN: true, CLIENT_BRAIN: true }));
    check('T3: SERVER_BRAIN && CLIENT_BRAIN rejected', v2.ok === false &&
        v2.violations.some(s => s.includes('SERVER_BRAIN && CLIENT_BRAIN')));
    const v3 = Hk.validateMutex(_with({ BYBIT_TESTNET_ENABLED: true, BYBIT_LIVE_ENABLED: true }));
    check('T3: BYBIT_TESTNET_ENABLED && BYBIT_LIVE_ENABLED rejected', v3.ok === false &&
        v3.violations.some(s => s.includes('BYBIT_TESTNET_ENABLED && BYBIT_LIVE_ENABLED')));
    const v4 = Hk.validateMutex(_with({ BYBIT_LIVE_ENABLED: true, BYBIT_DRY_RUN_ONLY: true }));
    check('T3: BYBIT_LIVE_ENABLED && BYBIT_DRY_RUN_ONLY rejected', v4.ok === false &&
        v4.violations.some(s => s.includes('BYBIT_LIVE_ENABLED && BYBIT_DRY_RUN_ONLY')));
}

// ════════════════════════════════════════════════════════════════════════
// T4 — New ALLOWED carve-out combinations
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T4 — new DEMO carve-out combinations ALLOWED ===');
{
    // SERVER_AT_DEMO=true alongside CLIENT_AT=true (NEW carve-out)
    const v1 = Hk.validateMutex(_with({
        SERVER_AT: false, CLIENT_AT: true, SERVER_AT_DEMO: true,
    }));
    check('T4: SERVER_AT_DEMO && CLIENT_AT && !SERVER_AT — accepted',
        v1.ok === true, JSON.stringify(v1.violations));

    // SERVER_BRAIN_DEMO=true alongside CLIENT_BRAIN=true (NEW carve-out)
    const v2 = Hk.validateMutex(_with({
        SERVER_BRAIN: false, CLIENT_BRAIN: true, SERVER_BRAIN_DEMO: true,
    }));
    check('T4: SERVER_BRAIN_DEMO && CLIENT_BRAIN && !SERVER_BRAIN — accepted',
        v2.ok === true, JSON.stringify(v2.violations));

    // Both DEMO carve-outs together while globals remain false
    const v3 = Hk.validateMutex(_with({
        SERVER_AT: false, SERVER_BRAIN: false,
        CLIENT_AT: true, CLIENT_BRAIN: true,
        SERVER_AT_DEMO: true, SERVER_BRAIN_DEMO: true,
    }));
    check('T4: SERVER_AT_DEMO && SERVER_BRAIN_DEMO together — accepted',
        v3.ok === true, JSON.stringify(v3.violations));

    // Asymmetric combos (AT_DEMO without BRAIN_DEMO and vice versa) — both legal
    const v4 = Hk.validateMutex(_with({
        SERVER_AT: false, CLIENT_AT: true, SERVER_AT_DEMO: true,
        SERVER_BRAIN: false, CLIENT_BRAIN: true, SERVER_BRAIN_DEMO: false,
    }));
    check('T4: SERVER_AT_DEMO && !SERVER_BRAIN_DEMO — accepted (asymmetric ok)',
        v4.ok === true, JSON.stringify(v4.violations));
    const v5 = Hk.validateMutex(_with({
        SERVER_AT: false, CLIENT_AT: true, SERVER_AT_DEMO: false,
        SERVER_BRAIN: false, CLIENT_BRAIN: true, SERVER_BRAIN_DEMO: true,
    }));
    check('T4: !SERVER_AT_DEMO && SERVER_BRAIN_DEMO — accepted (asymmetric ok)',
        v5.ok === true, JSON.stringify(v5.violations));
}

// ════════════════════════════════════════════════════════════════════════
// T5 — New BANNED combinations
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T5 — new DEMO carve-out BANNED combinations ===');
{
    // (a) SERVER_AT_DEMO + SERVER_AT — banned (one-way ratchet)
    const v1 = Hk.validateMutex(_with({
        SERVER_AT: true, CLIENT_AT: false, SERVER_AT_DEMO: true,
    }));
    check('T5: SERVER_AT_DEMO && SERVER_AT rejected', v1.ok === false &&
        v1.violations.some(s => s.includes('SERVER_AT_DEMO && SERVER_AT')));

    // (b) SERVER_BRAIN_DEMO + SERVER_BRAIN — banned (one-way ratchet)
    const v2 = Hk.validateMutex(_with({
        SERVER_BRAIN: true, CLIENT_BRAIN: false, SERVER_BRAIN_DEMO: true,
    }));
    check('T5: SERVER_BRAIN_DEMO && SERVER_BRAIN rejected', v2.ok === false &&
        v2.violations.some(s => s.includes('SERVER_BRAIN_DEMO && SERVER_BRAIN')));

    // (c) SERVER_AT_DEMO + BYBIT_LIVE_ENABLED — banned (no exchange routing)
    // Need DRY_RUN_ONLY=false to avoid colliding with the existing BYBIT mutex
    const v3 = Hk.validateMutex(_with({
        SERVER_AT_DEMO: true, BYBIT_LIVE_ENABLED: true, BYBIT_DRY_RUN_ONLY: false,
    }));
    check('T5: SERVER_AT_DEMO && BYBIT_LIVE_ENABLED rejected', v3.ok === false &&
        v3.violations.some(s => s.includes('SERVER_AT_DEMO && BYBIT_LIVE_ENABLED')));

    // (d) SERVER_AT_DEMO + BYBIT_TESTNET_ENABLED — banned
    const v4 = Hk.validateMutex(_with({
        SERVER_AT_DEMO: true, BYBIT_TESTNET_ENABLED: true,
    }));
    check('T5: SERVER_AT_DEMO && BYBIT_TESTNET_ENABLED rejected', v4.ok === false &&
        v4.violations.some(s => s.includes('SERVER_AT_DEMO && BYBIT_TESTNET_ENABLED')));
}

// ════════════════════════════════════════════════════════════════════════
// T6 — Existing Bybit safety flags remain at safe defaults
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T6 — Bybit safety flags unchanged ===');
{
    const all = MF.getAll();
    check('T6: BYBIT_TESTNET_ENABLED === false', all.BYBIT_TESTNET_ENABLED === false);
    check('T6: BYBIT_LIVE_ENABLED === false', all.BYBIT_LIVE_ENABLED === false);
    check('T6: BYBIT_PARITY_ENABLED === false', all.BYBIT_PARITY_ENABLED === false);
    check('T6: BYBIT_DRY_RUN_ONLY === true', all.BYBIT_DRY_RUN_ONLY === true);
}

// ════════════════════════════════════════════════════════════════════════
// T7 — Module loaded successfully (current process state safe)
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T7 — module-load + current-state safety ===');
{
    const all = MF.getAll();
    // Current live flags must be a valid mutex state (we just loaded, no throw)
    const v = Hk.validateMutex(all);
    check('T7: live MF.getAll() passes _validateMutex',
        v.ok === true, JSON.stringify(v.violations));
    // SERVER_AT must remain false in production
    check('T7: SERVER_AT remains false', all.SERVER_AT === false);
    check('T7: SERVER_BRAIN remains false', all.SERVER_BRAIN === false);
    check('T7: CLIENT_AT remains true', all.CLIENT_AT === true);
    check('T7: CLIENT_BRAIN remains true', all.CLIENT_BRAIN === true);
    check('T7: POSITIONS_WS remains true', all.POSITIONS_WS === true);
    // New flags must be false in production
    check('T7: SERVER_AT_DEMO remains false (S6-B0 inert)', all.SERVER_AT_DEMO === false);
    check('T7: SERVER_BRAIN_DEMO remains false (S6-B0 inert)', all.SERVER_BRAIN_DEMO === false);
}

// ════════════════════════════════════════════════════════════════════════
// T8 — Downstream consumer files (serverAT + client autotrade) remain
// flag-free. NOTE: serverBrain.js MAY reference the new flags after S6-B1
// ships (the dispatch gate is the entire point of S6-B1) — that case is
// covered by probe-s6b1 instead. S6-B2 will add references to serverAT,
// S6-B5 will add references to the client. Until those batches ship, both
// files must remain flag-free.
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T8 — downstream consumer files still flag-free ===');
{
    const stripComments = (s) => s
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    const atSrc = stripComments(fs.readFileSync(
        path.resolve(__dirname, '..', 'server', 'services', 'serverAT.js'), 'utf8'));
    const clientATSrc = stripComments(fs.readFileSync(
        path.resolve(__dirname, '..', 'client', 'src', 'trading', 'autotrade.ts'), 'utf8'));

    check('T8: serverAT.js does NOT reference SERVER_AT_DEMO (until S6-B2)',
        !/\bSERVER_AT_DEMO\b/.test(atSrc));
    check('T8: serverAT.js does NOT reference SERVER_BRAIN_DEMO (until S6-B2)',
        !/\bSERVER_BRAIN_DEMO\b/.test(atSrc));
    check('T8: client autotrade.ts does NOT reference SERVER_AT_DEMO (until S6-B5)',
        !/\bSERVER_AT_DEMO\b/.test(clientATSrc));
    check('T8: client autotrade.ts does NOT reference SERVER_BRAIN_DEMO (until S6-B5)',
        !/\bSERVER_BRAIN_DEMO\b/.test(clientATSrc));
}

// ════════════════════════════════════════════════════════════════════════
// T9 — Per-flag getter surface complete
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T9 — per-flag getter surface ===');
{
    // Every flag in DEFAULTS must have a corresponding getter on MF.
    for (const key of Object.keys(MF.DEFAULTS)) {
        const desc = Object.getOwnPropertyDescriptor(MF, key);
        check(`T9: getter for ${key} present`,
            desc !== undefined && typeof desc.get === 'function',
            'descriptor: ' + JSON.stringify(desc));
    }
}

// ════════════════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════════════════
console.log('\n========================================================');
console.log(`probe-s6b0: ${pass}/${pass + fail} PASS`);
console.log('========================================================');
process.exit(fail === 0 ? 0 : 1);
