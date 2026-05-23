// [Phase 2 S6-B2] Standalone probe — verifies the paranoid live execution
// gate added in serverAT.js (`_executeLiveEntry` first-line throw +
// `processBrainDecision` mode-aware refusal).
//
// HARD CONTRACT:
//   - Read-only against the live `serverAT` + `migrationFlags` modules.
//   - Mocks migrationFlags via property-getter override (same pattern as
//     probe-s6b1) — restored at end. No live state mutated.
//   - Tests _executeLiveEntry only on the THROWS path (with mocked
//     SERVER_AT=false). Never calls past the gate, so no in-flight lock,
//     no _positions splice, no _persistPosition, no exchange call.
//   - No HTTP, no DB writes, no PM2 reload.
//
// Run: node tests/probe-s6b2.js   (exits 0 on full PASS, 1 on any FAIL)
'use strict';

const fs = require('fs');
const path = require('path');

const MF = require('../server/migrationFlags');
const at = require('../server/services/serverAT');
const Hk = at._s6b2TestHooks;

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { console.log('  ✓ ' + name); pass++; }
    else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); fail++; }
}

// ── MF property-getter override (same pattern as probe-s6b1) ───────────────
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
console.log('\n=== T0 — _s6b2TestHooks export surface ===');
{
    check('T0: _s6b2TestHooks is an object', typeof Hk === 'object' && Hk !== null);
    check('T0: _s6b2TestHooks frozen', Object.isFrozen(Hk));
    check('T0: hooks expose exactly { executeLiveEntry, canExecute…, isLiveMode… }',
        Object.keys(Hk).sort().join(',') ===
        'canExecuteLiveEntryUnderCurrentFlags,executeLiveEntry,isLiveModeAuthorizedUnderCurrentFlags');
    check('T0: executeLiveEntry is a function', typeof Hk.executeLiveEntry === 'function');
    check('T0: canExecuteLiveEntryUnderCurrentFlags is a function',
        typeof Hk.canExecuteLiveEntryUnderCurrentFlags === 'function');
    check('T0: isLiveModeAuthorizedUnderCurrentFlags is a function',
        typeof Hk.isLiveModeAuthorizedUnderCurrentFlags === 'function');
    check('T0: serverAT._s5TestHooks still present (S5 invariant)',
        typeof at._s5TestHooks === 'object' && Object.isFrozen(at._s5TestHooks));
    check('T0: serverAT._s6TestHooks still present (S6-A invariant)',
        typeof at._s6TestHooks === 'object' && Object.isFrozen(at._s6TestHooks));
}

// ════════════════════════════════════════════════════════════════════════
// T1 — Real production flags: gate is fully restrictive
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T1 — production flags: all live execution refused ===');
{
    const all = MF.getAll();
    check('T1: MF.SERVER_AT === false', all.SERVER_AT === false);
    check('T1: MF.SERVER_BRAIN === false', all.SERVER_BRAIN === false);
    check('T1: MF.SERVER_AT_DEMO === false', all.SERVER_AT_DEMO === false);
    check('T1: MF.SERVER_BRAIN_DEMO === false', all.SERVER_BRAIN_DEMO === false);
    // Pure helper says NO under current flags.
    check('T1: canExecuteLiveEntryUnderCurrentFlags() === false',
        Hk.canExecuteLiveEntryUnderCurrentFlags() === false);
    // Mode-aware helper: demo always allowed, live refused.
    check('T1: isLiveModeAuthorizedUnderCurrentFlags("demo") === true',
        Hk.isLiveModeAuthorizedUnderCurrentFlags('demo') === true);
    check('T1: isLiveModeAuthorizedUnderCurrentFlags("live") === false',
        Hk.isLiveModeAuthorizedUnderCurrentFlags('live') === false);
}

// ════════════════════════════════════════════════════════════════════════
// T2 — canExecuteLiveEntryUnderCurrentFlags truth table
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T2 — canExecuteLiveEntryUnderCurrentFlags truth table ===');
{
    _runWithFlags({ SERVER_AT: false, SERVER_AT_DEMO: false }, () => {
        check('T2: both off → false',
            Hk.canExecuteLiveEntryUnderCurrentFlags() === false);
    });
    _runWithFlags({ SERVER_AT: false, SERVER_AT_DEMO: true }, () => {
        check('T2: SERVER_AT_DEMO=true alone → false (carve-out cannot reach live)',
            Hk.canExecuteLiveEntryUnderCurrentFlags() === false);
    });
    _runWithFlags({ SERVER_AT: true, SERVER_AT_DEMO: false }, () => {
        check('T2: SERVER_AT=true → true (full server-AT)',
            Hk.canExecuteLiveEntryUnderCurrentFlags() === true);
    });
}

// ════════════════════════════════════════════════════════════════════════
// T3 — isLiveModeAuthorizedUnderCurrentFlags truth table
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T3 — isLiveModeAuthorizedUnderCurrentFlags truth table ===');
{
    // SERVER_AT=true → all modes pass through
    _runWithFlags({ SERVER_AT: true, SERVER_AT_DEMO: false }, () => {
        check('T3: SERVER_AT=true && demo → authorized',
            Hk.isLiveModeAuthorizedUnderCurrentFlags('demo') === true);
        check('T3: SERVER_AT=true && live → authorized',
            Hk.isLiveModeAuthorizedUnderCurrentFlags('live') === true);
        check('T3: SERVER_AT=true && testnet → authorized',
            Hk.isLiveModeAuthorizedUnderCurrentFlags('testnet') === true);
        check('T3: SERVER_AT=true && undefined → authorized',
            Hk.isLiveModeAuthorizedUnderCurrentFlags(undefined) === true);
    });
    // SERVER_AT=false, SERVER_AT_DEMO=true → only demo passes
    _runWithFlags({ SERVER_AT: false, SERVER_AT_DEMO: true }, () => {
        check('T3: !SERVER_AT, SERVER_AT_DEMO=true && demo → authorized',
            Hk.isLiveModeAuthorizedUnderCurrentFlags('demo') === true);
        check('T3: !SERVER_AT, SERVER_AT_DEMO=true && live → REFUSED',
            Hk.isLiveModeAuthorizedUnderCurrentFlags('live') === false);
        check('T3: !SERVER_AT, SERVER_AT_DEMO=true && testnet → REFUSED',
            Hk.isLiveModeAuthorizedUnderCurrentFlags('testnet') === false);
        check('T3: !SERVER_AT, SERVER_AT_DEMO=true && real → REFUSED',
            Hk.isLiveModeAuthorizedUnderCurrentFlags('real') === false);
        check('T3: !SERVER_AT, SERVER_AT_DEMO=true && undefined → REFUSED (fail safe)',
            Hk.isLiveModeAuthorizedUnderCurrentFlags(undefined) === false);
        check('T3: !SERVER_AT, SERVER_AT_DEMO=true && null → REFUSED (fail safe)',
            Hk.isLiveModeAuthorizedUnderCurrentFlags(null) === false);
        check('T3: !SERVER_AT, SERVER_AT_DEMO=true && empty string → REFUSED',
            Hk.isLiveModeAuthorizedUnderCurrentFlags('') === false);
    });
    // Both false
    _runWithFlags({ SERVER_AT: false, SERVER_AT_DEMO: false }, () => {
        check('T3: both off && demo → authorized (demo paper-fill always allowed)',
            Hk.isLiveModeAuthorizedUnderCurrentFlags('demo') === true);
        check('T3: both off && live → REFUSED',
            Hk.isLiveModeAuthorizedUnderCurrentFlags('live') === false);
    });
}

// ════════════════════════════════════════════════════════════════════════
// T4 — Direct _executeLiveEntry call: throws under SERVER_AT=false
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T4 — _executeLiveEntry refuses when SERVER_AT=false ===');
{
    // Default flags (SERVER_AT=false). Synthetic minimal entry — we only
    // care about the FIRST statement firing (the gate); we never reach the
    // _livePending mutation, the lock, or any persistence.
    const stub = { seq: 9_900_000_001, userId: 999999, symbol: 'PROBES6B2' };
    let threw = false, msg = '', code = '';
    return Hk.executeLiveEntry(stub, {}).then(() => {
        check('T4: refused with throw (no resolve)', false, 'unexpectedly resolved');
    }).catch((e) => {
        threw = true;
        msg = e && e.message;
        code = e && e.code;
    }).then(() => {
        check('T4: _executeLiveEntry threw under SERVER_AT=false', threw);
        check('T4: error.message === "LIVE_ENTRY_REQUIRES_FULL_SERVER_AT"',
            msg === 'LIVE_ENTRY_REQUIRES_FULL_SERVER_AT');
        check('T4: error.code === "LIVE_ENTRY_REQUIRES_FULL_SERVER_AT"',
            code === 'LIVE_ENTRY_REQUIRES_FULL_SERVER_AT');
        // Verify the synthetic entry was NOT mutated past the gate.
        // _executeLiveEntry sets entry._livePending = true on its second
        // statement; the gate on the FIRST statement must prevent that.
        check('T4: stub.entry._livePending NOT set (gate fired BEFORE state mutation)',
            stub._livePending === undefined);

        // Same call with SERVER_AT_DEMO=true alone must STILL throw (carve-out
        // is demo-only and cannot reach live execution).
        return _runWithFlags({ SERVER_AT: false, SERVER_AT_DEMO: true }, () => {
            const stub2 = { seq: 9_900_000_002, userId: 999999, symbol: 'PROBES6B2X' };
            return Hk.executeLiveEntry(stub2, {}).then(() => {
                check('T4: refused with throw under SERVER_AT_DEMO=true alone', false, 'unexpectedly resolved');
            }).catch((e2) => {
                check('T4: _executeLiveEntry STILL throws when only SERVER_AT_DEMO=true',
                    e2 && e2.code === 'LIVE_ENTRY_REQUIRES_FULL_SERVER_AT');
                check('T4: stub2._livePending NOT set (gate fired BEFORE state mutation)',
                    stub2._livePending === undefined);
            });
        });
    }).then(_finalSync);
}

// Finalize after T4 async — collect remaining synchronous tests + summary.
function _finalSync() {
    // ════════════════════════════════════════════════════════════════════════
    // T5 — Source-level: gate is the FIRST statement of _executeLiveEntry
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n=== T5 — source-level: live execution gate placement ===');
    {
        const atPath = path.resolve(__dirname, '..', 'server', 'services', 'serverAT.js');
        const src = fs.readFileSync(atPath, 'utf8');
        // Locate the function header
        const headerIdx = src.search(/async\s+function\s+_executeLiveEntry\s*\(/);
        check('T5: _executeLiveEntry header present', headerIdx > 0);
        if (headerIdx > 0) {
            // First 2000 chars after header — generous enough for the
            // S6-B2 doc-comment (~700 chars) + the if-block + throw.
            const window = src.slice(headerIdx, headerIdx + 2000);
            const gateIdx = Math.max(
                window.indexOf("'LIVE_ENTRY_REQUIRES_FULL_SERVER_AT'"),
                window.indexOf('"LIVE_ENTRY_REQUIRES_FULL_SERVER_AT"'));
            check('T5: LIVE_ENTRY_REQUIRES_FULL_SERVER_AT token appears in early body window',
                gateIdx !== -1);
            check('T5: window references MF.SERVER_AT !== true',
                /MF\.SERVER_AT\s*!==\s*true/.test(window));
            check('T5: window contains a throw statement',
                /\bthrow\b/.test(window));
            // Within that same window, the FIRST in-flight lock acquisition
            // (`_liveEntryLocks.add`) should NOT appear before the gate.
            const lockIdx = window.indexOf('_liveEntryLocks.add(');
            check('T5: gate appears BEFORE _liveEntryLocks.add (no state mutation before refusal)',
                gateIdx > 0 && (lockIdx === -1 || gateIdx < lockIdx));
            // The first sendSignedRequest in the entire body should be after
            // the gate (additional sanity check that the function still wires
            // sendSignedRequest later in the body).
            const sendIdx = src.indexOf('sendSignedRequest(', headerIdx);
            check('T5: gate appears BEFORE first sendSignedRequest in _executeLiveEntry',
                sendIdx > 0 && (headerIdx + gateIdx) < sendIdx);
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // T6 — Source-level: processBrainDecision mode guard placement
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n=== T6 — source-level: processBrainDecision mode guard ===');
    {
        const atPath = path.resolve(__dirname, '..', 'server', 'services', 'serverAT.js');
        const src = fs.readFileSync(atPath, 'utf8');
        const headerIdx = src.search(/^function\s+processBrainDecision\s*\(/m);
        check('T6: processBrainDecision header present', headerIdx > 0);
        if (headerIdx > 0) {
            // Mode guard string + recordMissedTrade pattern within first 2000 chars
            const window = src.slice(headerIdx, headerIdx + 2000);
            check('T6: SERVER_AT_REQUIRED_FOR_LIVE refusal present near top',
                window.indexOf('SERVER_AT_REQUIRED_FOR_LIVE') !== -1);
            check('T6: mode guard checks engineMode !== "demo"',
                /us\.engineMode\s*!==\s*['"]demo['"]/.test(window));
            check('T6: mode guard checks MF.SERVER_AT !== true',
                /MF\.SERVER_AT\s*!==\s*true/.test(window));
            // Demo branch MUST still exist further down (not removed).
            check('T6: demo branch (us.engineMode === "demo") still present',
                /us\.engineMode\s*===\s*['"]demo['"]/.test(src));
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // T7 — Source-level: no localStorage / no Bybit imports / no fetch
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n=== T7 — no forbidden refs introduced ===');
    {
        const atPath = path.resolve(__dirname, '..', 'server', 'services', 'serverAT.js');
        const stripComments = (s) => s
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        const src = stripComments(fs.readFileSync(atPath, 'utf8'));
        check('T7: no localStorage refs', !/\blocalStorage\b/.test(src));
        check('T7: no window. refs', !/\bwindow\.[A-Za-z_]/.test(src));
        check('T7: no Bybit module imports',
            !/require\(['"][^'"]*bybit[A-Z][^'"]*['"]\)/.test(src));
        check('T7: no fetch( / axios / http*.request introduced',
            !/\bfetch\s*\(/.test(src) && !/\baxios\b/.test(src) &&
            !/\bhttps?\.request\b/.test(src));
    }

    // ════════════════════════════════════════════════════════════════════════
    // T8 — Forbidden files unchanged
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n=== T8 — forbidden files not regressed ===');
    {
        const stripComments = (s) => s
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        const brainSrc = stripComments(fs.readFileSync(
            path.resolve(__dirname, '..', 'server', 'services', 'serverBrain.js'), 'utf8'));
        const clientATSrc = stripComments(fs.readFileSync(
            path.resolve(__dirname, '..', 'client', 'src', 'trading', 'autotrade.ts'), 'utf8'));

        // serverBrain MUST NOT have S6-B2-introduced refusal strings — those
        // belong to serverAT.js.
        check('T8: serverBrain.js does NOT contain LIVE_ENTRY_REQUIRES_FULL_SERVER_AT',
            !/LIVE_ENTRY_REQUIRES_FULL_SERVER_AT/.test(brainSrc));
        check('T8: serverBrain.js does NOT contain SERVER_AT_REQUIRED_FOR_LIVE',
            !/SERVER_AT_REQUIRED_FOR_LIVE/.test(brainSrc));
        // client autotrade.ts MUST NOT reference any S6-B refusal strings yet.
        check('T8: client autotrade.ts does NOT reference SERVER_AT_DEMO',
            !/\bSERVER_AT_DEMO\b/.test(clientATSrc));
        check('T8: client autotrade.ts does NOT reference SERVER_BRAIN_DEMO',
            !/\bSERVER_BRAIN_DEMO\b/.test(clientATSrc));
        check('T8: client autotrade.ts does NOT reference LIVE_ENTRY_REQUIRES_FULL_SERVER_AT',
            !/LIVE_ENTRY_REQUIRES_FULL_SERVER_AT/.test(clientATSrc));
    }

    // ════════════════════════════════════════════════════════════════════════
    // T9 — Bybit modules unchanged
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n=== T9 — Bybit modules untouched ===');
    {
        const stripComments = (s) => s
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        for (const f of ['bybitSigner.js', 'bybitOrderTranslator.js', 'bybitParityShadow.js']) {
            const src = stripComments(fs.readFileSync(
                path.resolve(__dirname, '..', 'server', 'services', f), 'utf8'));
            check(`T9: ${f} has no LIVE_ENTRY_REQUIRES_FULL_SERVER_AT reference`,
                !/LIVE_ENTRY_REQUIRES_FULL_SERVER_AT/.test(src));
            check(`T9: ${f} has no SERVER_AT_REQUIRED_FOR_LIVE reference`,
                !/SERVER_AT_REQUIRED_FOR_LIVE/.test(src));
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // T10 — Migration flags / version unchanged
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n=== T10 — migration flags + version unchanged ===');
    {
        const j = JSON.parse(fs.readFileSync(
            path.resolve(__dirname, '..', 'data', 'migration_flags.json'), 'utf8'));
        check('T10: SERVER_AT === false', j.SERVER_AT === false);
        check('T10: SERVER_BRAIN === false', j.SERVER_BRAIN === false);
        check('T10: SERVER_AT_DEMO === false', j.SERVER_AT_DEMO === false);
        check('T10: SERVER_BRAIN_DEMO === false', j.SERVER_BRAIN_DEMO === false);
        check('T10: CLIENT_AT === true', j.CLIENT_AT === true);
        check('T10: CLIENT_BRAIN === true', j.CLIENT_BRAIN === true);
        check('T10: POSITIONS_WS === true', j.POSITIONS_WS === true);
        check('T10: BYBIT_DRY_RUN_ONLY === true', j.BYBIT_DRY_RUN_ONLY === true);
        const ver = require('../server/version');
        check('T10: version remains v1.7.67', ver.version === '1.7.67');
        check('T10: build remains b93', ver.build === 93);
    }

    // ════════════════════════════════════════════════════════════════════════
    // Summary
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n========================================================');
    console.log(`probe-s6b2: ${pass}/${pass + fail} PASS`);
    console.log('========================================================');
    process.exit(fail === 0 ? 0 : 1);
}
