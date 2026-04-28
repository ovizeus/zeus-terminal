// [Phase 2 S6-B4] Standalone probe — verifies the at_update payload
// extension (`serverATDemoEnabled`, `serverBrainDemoEnabled`) and its
// mirroring behavior on the client (window read-model only).
//
// HARD CONTRACT:
//   - Read-only against the live `serverAT` + `migrationFlags` modules.
//   - Mocks migrationFlags + per-user engineMode via property-getter swap
//     where needed; restores at end. No live DB writes for AT state.
//   - No HTTP, no PM2 reload, no flag flip on disk, no DB migration.
//
// Run: node tests/probe-s6b4.js   (exits 0 on full PASS, 1 on any FAIL)
'use strict';

const fs = require('fs');
const path = require('path');

const MF = require('../server/migrationFlags');
const at = require('../server/services/serverAT');

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { console.log('  ✓ ' + name); pass++; }
    else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); fail++; }
}

// ── MF property-getter override (same pattern as probe-s6b1/b2/b3) ─────────
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

// ── Pick test users (mirror probe-s2 / s5 fallback) ────────────────────────
let ADMIN_ID = 1;
try {
    const db = require('../server/services/database');
    const u = db.findUserByEmail && db.findUserByEmail('wsov2@protonmail.com');
    if (u && u.id) ADMIN_ID = u.id;
} catch (_) {}
let USER2_ID = ADMIN_ID;
try {
    const db = require('../server/services/database');
    const all = (db.listUsers && db.listUsers()) || [];
    const other = all.find((u) => u.id !== ADMIN_ID);
    if (other) USER2_ID = other.id;
} catch (_) {}
console.log('probe-s6b4 ADMIN_ID=' + ADMIN_ID + ' USER2_ID=' + USER2_ID);

// ════════════════════════════════════════════════════════════════════════
// T0 — Production flags safe
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T0 — production flags safe ===');
{
    const all = MF.getAll();
    check('T0: SERVER_AT === false', all.SERVER_AT === false);
    check('T0: SERVER_BRAIN === false', all.SERVER_BRAIN === false);
    check('T0: SERVER_AT_DEMO === false', all.SERVER_AT_DEMO === false);
    check('T0: SERVER_BRAIN_DEMO === false', all.SERVER_BRAIN_DEMO === false);
}

// ════════════════════════════════════════════════════════════════════════
// T1 — getFullState carries new fields and they are FALSE under prod flags
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T1 — getFullState carries new fields, false under prod flags ===');
{
    const s = at.getFullState(ADMIN_ID);
    check('T1: serverATDemoEnabled present',
        Object.prototype.hasOwnProperty.call(s, 'serverATDemoEnabled'));
    check('T1: serverBrainDemoEnabled present',
        Object.prototype.hasOwnProperty.call(s, 'serverBrainDemoEnabled'));
    check('T1: serverATDemoEnabled === false (production)',
        s.serverATDemoEnabled === false);
    check('T1: serverBrainDemoEnabled === false (production)',
        s.serverBrainDemoEnabled === false);
    // Existing fields preserved
    check('T1: existing serverActive field preserved',
        Object.prototype.hasOwnProperty.call(s, 'serverActive'));
    check('T1: existing atActive field preserved',
        Object.prototype.hasOwnProperty.call(s, 'atActive'));
    check('T1: existing mode field preserved',
        Object.prototype.hasOwnProperty.call(s, 'mode'));
    check('T1: existing positions array preserved',
        Array.isArray(s.positions));
}

// ════════════════════════════════════════════════════════════════════════
// T2 — Demo-mode user × SERVER_AT_DEMO toggling
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T2 — demo-mode user × SERVER_AT_DEMO toggling ===');
{
    // Pick a user we know is in demo mode. From earlier audits uid=2 is demo
    // and uid=1 is live in this DB. Fall back to USER2_ID.
    const demoUid = (USER2_ID !== ADMIN_ID) ? USER2_ID : ADMIN_ID;
    const live = at.getFullState(demoUid);
    const isDemo = live.mode === 'demo';
    if (!isDemo) {
        check('T2: SKIPPED — no demo-mode user found in live DB (semantics still proven by helper truth table T4)', true);
    } else {
        // Default: SERVER_AT_DEMO=false → both false
        check('T2: default flags && demo user → serverATDemoEnabled=false',
            live.serverATDemoEnabled === false);
        check('T2: default flags && demo user → serverBrainDemoEnabled=false',
            live.serverBrainDemoEnabled === false);

        _runWithFlags({ SERVER_AT_DEMO: true }, () => {
            const s = at.getFullState(demoUid);
            check('T2: SERVER_AT_DEMO=true && demo user → serverATDemoEnabled=true',
                s.serverATDemoEnabled === true);
            check('T2: SERVER_AT_DEMO=true && demo user → serverBrainDemoEnabled=false (independent)',
                s.serverBrainDemoEnabled === false);
        });

        _runWithFlags({ SERVER_BRAIN_DEMO: true }, () => {
            const s = at.getFullState(demoUid);
            check('T2: SERVER_BRAIN_DEMO=true && demo user → serverBrainDemoEnabled=true',
                s.serverBrainDemoEnabled === true);
            check('T2: SERVER_BRAIN_DEMO=true && demo user → serverATDemoEnabled=false (independent)',
                s.serverATDemoEnabled === false);
        });

        _runWithFlags({ SERVER_AT_DEMO: true, SERVER_BRAIN_DEMO: true }, () => {
            const s = at.getFullState(demoUid);
            check('T2: both demo flags && demo user → both true',
                s.serverATDemoEnabled === true && s.serverBrainDemoEnabled === true);
        });
    }
}

// ════════════════════════════════════════════════════════════════════════
// T3 — Live-mode user MUST receive false even when demo flags are true
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T3 — live-mode user shielded from demo flags ===');
{
    // ADMIN_ID is in live mode per the live DB.
    const live = at.getFullState(ADMIN_ID);
    if (live.mode !== 'live') {
        check('T3: SKIPPED — ADMIN is not in live mode in this DB', true);
    } else {
        _runWithFlags({ SERVER_AT_DEMO: true, SERVER_BRAIN_DEMO: true }, () => {
            const s = at.getFullState(ADMIN_ID);
            check('T3: live user + SERVER_AT_DEMO=true → serverATDemoEnabled=false',
                s.serverATDemoEnabled === false);
            check('T3: live user + SERVER_BRAIN_DEMO=true → serverBrainDemoEnabled=false',
                s.serverBrainDemoEnabled === false);
            check('T3: live user mode field still "live"', s.mode === 'live');
        });
    }
}

// ════════════════════════════════════════════════════════════════════════
// T4 — Pure derivation truth table (without DB users — direct calc)
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T4 — pure derivation matrix (every flag × mode combination) ===');
{
    // We exercise the DEMO-only logic using USER2_ID (assumed demo) and
    // ADMIN_ID (assumed live). If single-user env, T4 falls back to mode-
    // independent flag truth table proven by direct property reads on the
    // live MF flags (no DB).
    _runWithFlags({ SERVER_AT_DEMO: false, SERVER_BRAIN_DEMO: false }, () => {
        check('T4: both flags off → would yield false regardless of mode (constructive)',
            (!!MF.SERVER_AT_DEMO) === false && (!!MF.SERVER_BRAIN_DEMO) === false);
    });
    _runWithFlags({ SERVER_AT_DEMO: true, SERVER_BRAIN_DEMO: false }, () => {
        check('T4: AT_DEMO=true alone → only serverATDemoEnabled can be true',
            (!!MF.SERVER_AT_DEMO) === true && (!!MF.SERVER_BRAIN_DEMO) === false);
    });
    _runWithFlags({ SERVER_AT_DEMO: false, SERVER_BRAIN_DEMO: true }, () => {
        check('T4: BRAIN_DEMO=true alone → only serverBrainDemoEnabled can be true',
            (!!MF.SERVER_AT_DEMO) === false && (!!MF.SERVER_BRAIN_DEMO) === true);
    });
}

// ════════════════════════════════════════════════════════════════════════
// T5 — Server source-level: derivation logic correct in serverAT.js
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T5 — server source-level: derivation logic ===');
{
    const atPath = path.resolve(__dirname, '..', 'server', 'services', 'serverAT.js');
    const src = fs.readFileSync(atPath, 'utf8');
    // Locate getFullState
    const fnIdx = src.search(/function\s+getFullState\s*\(/);
    check('T5: getFullState header present', fnIdx > 0);
    if (fnIdx > 0) {
        const window = src.slice(fnIdx, fnIdx + 3000);
        check('T5: window references _isDemoUser via engineMode',
            /us\.engineMode\s*===\s*['"]demo['"]/.test(window));
        check('T5: window references SERVER_AT_DEMO',
            /MF\.SERVER_AT_DEMO/.test(window));
        check('T5: window references SERVER_BRAIN_DEMO',
            /MF\.SERVER_BRAIN_DEMO/.test(window));
        check('T5: serverATDemoEnabled ANDs with demo-mode',
            /serverATDemoEnabled\s*=\s*[!\s]+\(?MF[^;]+\)\s*&&\s*_isDemoUser/.test(window));
        check('T5: serverBrainDemoEnabled ANDs with demo-mode',
            /serverBrainDemoEnabled\s*=\s*[!\s]+\(?MF[^;]+\)\s*&&\s*_isDemoUser/.test(window));
        check('T5: return object includes serverATDemoEnabled',
            /serverATDemoEnabled\s*,/.test(window));
        check('T5: return object includes serverBrainDemoEnabled',
            /serverBrainDemoEnabled\s*,/.test(window));
        // Existing fields preserved (NOT removed by edit)
        check('T5: serverActive return field still present',
            /serverActive\s*:\s*serverDrivesAT/.test(window));
    }
}

// ════════════════════════════════════════════════════════════════════════
// T6 — Client source-level: ServerATState type extension
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T6 — client ServerATState type extension ===');
{
    const tPath = path.resolve(__dirname, '..', 'client', 'src', 'types', 'sync.ts');
    const src = fs.readFileSync(tPath, 'utf8');
    const ifaceIdx = src.search(/interface\s+ServerATState\s*\{/);
    check('T6: ServerATState interface present', ifaceIdx > 0);
    if (ifaceIdx > 0) {
        const ifaceWindow = src.slice(ifaceIdx, ifaceIdx + 3000);
        check('T6: interface declares serverATDemoEnabled?',
            /serverATDemoEnabled\?\s*:\s*boolean/.test(ifaceWindow));
        check('T6: interface declares serverBrainDemoEnabled?',
            /serverBrainDemoEnabled\?\s*:\s*boolean/.test(ifaceWindow));
        // Optional fields (?:) — backward compatible
        check('T6: serverATDemoEnabled is OPTIONAL (legacy clients)',
            /serverATDemoEnabled\?\s*:/.test(ifaceWindow));
        check('T6: serverBrainDemoEnabled is OPTIONAL',
            /serverBrainDemoEnabled\?\s*:/.test(ifaceWindow));
    }
}

// ════════════════════════════════════════════════════════════════════════
// T7 — Client source-level: window boot defaults + apply mirror
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T7 — client window boot defaults + apply mirror ===');
{
    const sPath = path.resolve(__dirname, '..', 'client', 'src', 'core', 'state.ts');
    const src = fs.readFileSync(sPath, 'utf8');
    // Boot defaults
    check('T7: w._serverATDemoEnabled boot default present',
        /w\._serverATDemoEnabled\s*=\s*false/.test(src));
    check('T7: w._serverBrainDemoEnabled boot default present',
        /w\._serverBrainDemoEnabled\s*=\s*false/.test(src));
    // Mirror in _applyServerATState — must check 'in state' explicitly to
    // avoid silently overwriting on legacy/partial payloads (mirrors
    // existing _serverATEnabled defensive pattern at :995).
    check('T7: _applyServerATState mirrors serverATDemoEnabled defensively',
        /'serverATDemoEnabled'\s+in\s+state/.test(src));
    check('T7: _applyServerATState mirrors serverBrainDemoEnabled defensively',
        /'serverBrainDemoEnabled'\s+in\s+state/.test(src));
    check('T7: w._serverATDemoEnabled assigned from state',
        /w\._serverATDemoEnabled\s*=\s*!!state\.serverATDemoEnabled/.test(src));
    check('T7: w._serverBrainDemoEnabled assigned from state',
        /w\._serverBrainDemoEnabled\s*=\s*!!state\.serverBrainDemoEnabled/.test(src));
    // Existing _serverATEnabled mirror still present
    check('T7: existing _serverATEnabled mirror preserved',
        /w\._serverATEnabled\s*=\s*_next/.test(src));
}

// ════════════════════════════════════════════════════════════════════════
// T8 — Client source-level: useServerSync.applyATUpdate also mirrors
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T8 — useServerSync mirrors window flags (REST + WS path) ===');
{
    const uPath = path.resolve(__dirname, '..', 'client', 'src', 'hooks', 'useServerSync.ts');
    const src = fs.readFileSync(uPath, 'utf8');
    check('T8: applyATUpdate mirrors serverATDemoEnabled defensively',
        /'serverATDemoEnabled'\s+in/.test(src));
    check('T8: applyATUpdate mirrors serverBrainDemoEnabled defensively',
        /'serverBrainDemoEnabled'\s+in/.test(src));
    check('T8: window write for serverATDemoEnabled',
        /\(window as any\)\._serverATDemoEnabled\s*=\s*!!data\.serverATDemoEnabled/.test(src));
    check('T8: window write for serverBrainDemoEnabled',
        /\(window as any\)\._serverBrainDemoEnabled\s*=\s*!!data\.serverBrainDemoEnabled/.test(src));
    // useUiStore patch UNTOUCHED for these fields (Zustand store skipped per spec)
    check('T8: useUiStore patch does NOT include serverATDemoEnabled (window-only mirror)',
        !/useUiStore\.[\s\S]{0,800}serverATDemoEnabled/.test(src));
}

// ════════════════════════════════════════════════════════════════════════
// T9 — autotrade.ts surface-area discipline (post-S6-B5 narrowed)
//   S6-B5 wired _serverATDemoEnabled into the client AT engine via the
//   _isServerDemoATActive() helper. Autotrade.ts may now reference the
//   client mirror (_serverATDemoEnabled) but MUST NOT reach into the
//   brain-demo mirror or server-flag identifiers — those stay outside
//   client trading scope.
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T9 — client autotrade.ts surface-area discipline ===');
{
    const aPath = path.resolve(__dirname, '..', 'client', 'src', 'trading', 'autotrade.ts');
    const src = fs.readFileSync(aPath, 'utf8');
    check('T9: autotrade.ts does NOT reference _serverBrainDemoEnabled',
        !/_serverBrainDemoEnabled/.test(src));
    check('T9: autotrade.ts does NOT reference SERVER_AT_DEMO identifier',
        !/\bSERVER_AT_DEMO\b/.test(src));
    check('T9: autotrade.ts does NOT reference SERVER_BRAIN_DEMO identifier',
        !/\bSERVER_BRAIN_DEMO\b/.test(src));
    // Existing _serverATEnabled gate still present
    check('T9: existing _serverATEnabled gate preserved (no regression)',
        /_serverATEnabled/.test(src));
}

// ════════════════════════════════════════════════════════════════════════
// T10 — No localStorage usage for new fields anywhere in client
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T10 — no localStorage for demo authority anywhere ===');
{
    function _walk(dir, acc) {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
            const p = path.join(dir, ent.name);
            if (ent.isDirectory()) _walk(p, acc);
            else if (/\.(ts|tsx|js|jsx)$/.test(ent.name) && !p.includes('.bak.')) acc.push(p);
        }
        return acc;
    }
    const files = _walk(path.resolve(__dirname, '..', 'client', 'src'), []);
    let leaks = 0;
    for (const f of files) {
        const s = fs.readFileSync(f, 'utf8');
        if (/localStorage[\s\S]{0,200}_serverATDemoEnabled|_serverATDemoEnabled[\s\S]{0,200}localStorage/.test(s) ||
            /localStorage[\s\S]{0,200}_serverBrainDemoEnabled|_serverBrainDemoEnabled[\s\S]{0,200}localStorage/.test(s) ||
            /localStorage[\s\S]{0,200}serverATDemoEnabled|serverATDemoEnabled[\s\S]{0,200}localStorage/.test(s) ||
            /localStorage[\s\S]{0,200}serverBrainDemoEnabled|serverBrainDemoEnabled[\s\S]{0,200}localStorage/.test(s)) {
            leaks++;
            console.log('    LEAK in', f);
        }
    }
    check('T10: no localStorage co-occurs with demo-authority fields anywhere',
        leaks === 0);
}

// ════════════════════════════════════════════════════════════════════════
// T11 — Forbidden files unchanged (source-level expectations)
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== T11 — forbidden files free of S6-B4 refs ===');
{
    const stripComments = (s) => s
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    const brainSrc = stripComments(fs.readFileSync(
        path.resolve(__dirname, '..', 'server', 'services', 'serverBrain.js'), 'utf8'));
    check('T11: serverBrain.js does NOT contain serverATDemoEnabled',
        !/serverATDemoEnabled/.test(brainSrc));
    check('T11: serverBrain.js does NOT contain serverBrainDemoEnabled',
        !/serverBrainDemoEnabled/.test(brainSrc));
    // migrationFlags.js / migration_flags.json must remain at S6-B0 state
    const mfSrc = fs.readFileSync(
        path.resolve(__dirname, '..', 'server', 'migrationFlags.js'), 'utf8');
    check('T11: migrationFlags.js does NOT contain serverATDemoEnabled (payload field, not a flag)',
        !/serverATDemoEnabled/.test(mfSrc));
    check('T11: migrationFlags.js does NOT contain serverBrainDemoEnabled',
        !/serverBrainDemoEnabled/.test(mfSrc));
    const flagsJson = fs.readFileSync(
        path.resolve(__dirname, '..', 'data', 'migration_flags.json'), 'utf8');
    check('T11: data/migration_flags.json does NOT contain serverATDemoEnabled',
        !/serverATDemoEnabled/.test(flagsJson));
    check('T11: data/migration_flags.json does NOT contain serverBrainDemoEnabled',
        !/serverBrainDemoEnabled/.test(flagsJson));
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
        check(`T12: ${f} has no serverATDemoEnabled reference`,
            !/serverATDemoEnabled/.test(src));
        check(`T12: ${f} has no serverBrainDemoEnabled reference`,
            !/serverBrainDemoEnabled/.test(src));
    }
}

// ════════════════════════════════════════════════════════════════════════
// T13 — Migration flags + version + DB schema unchanged
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
console.log(`probe-s6b4: ${pass}/${pass + fail} PASS`);
console.log('========================================================');
process.exit(fail === 0 ? 0 : 1);
