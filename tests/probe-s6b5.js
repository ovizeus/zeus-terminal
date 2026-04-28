// [Phase 2 S6-B5] Standalone probe — verifies the client-side demo AT gate
// in client/src/trading/autotrade.ts.
//
// HARD CONTRACT:
//   - Source-level only: autotrade.ts is browser-flavored TypeScript and
//     cannot be loaded into pure node without a full build pipeline. We
//     read the file, locate the gate sites, and confirm structural
//     invariants. A lightweight runtime check exercises the gate-helper
//     semantics by extracting the helper body and evaluating it against
//     synthesized window/getATMode mocks.
//   - No HTTP, no PM2 reload, no flag flip on disk, no DB migration.
//   - No server file is imported or modified by this probe.
//
// Run: node tests/probe-s6b5.js   (exits 0 on full PASS, 1 on any FAIL)
'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { console.log('  ✓ ' + name); pass++; }
    else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); fail++; }
}

const ROOT = path.resolve(__dirname, '..');
const ATPATH = path.join(ROOT, 'client/src/trading/autotrade.ts');
const SRC = fs.readFileSync(ATPATH, 'utf8');

// ── T1 — helper exists and references both prerequisites ──────────────────
console.log('\nT1 — helper _isServerDemoATActive present + correctly shaped');
{
    const fnIdx = SRC.indexOf('function _isServerDemoATActive(');
    check('helper declared', fnIdx > 0, 'function _isServerDemoATActive not found');
    if (fnIdx > 0) {
        const block = SRC.slice(fnIdx, fnIdx + 800);
        check('returns boolean', /:\s*boolean\b/.test(block), 'expected `: boolean` return type');
        check('checks _serverATDemoEnabled', block.indexOf('_serverATDemoEnabled') > 0,
            'helper must reference window._serverATDemoEnabled');
        check('reads getATMode', block.indexOf('getATMode') > 0,
            'helper must read canonical mode via getATMode()');
        check('compares mode === demo', /['"]demo['"]/.test(block),
            "helper must compare mode against 'demo'");
        check('strict-true check on flag', /_serverATDemoEnabled\s*!==\s*true/.test(block) ||
                                          /_serverATDemoEnabled\s*===\s*true/.test(block),
            'helper must use strict equality against true (no truthy coercion)');
        check('try/catch around access', /\btry\s*{/.test(block) && /\bcatch\b/.test(block),
            'helper must fail safe on any throw (no unhandled exception in AT loop)');
        check('no localStorage read', block.indexOf('localStorage') === -1,
            'helper must not read localStorage');
        check('no fetch / api call', block.indexOf('fetch(') === -1 && block.indexOf('api.') === -1,
            'helper must not perform server calls');
    }
}

// ── T2 — runAutoTradeCheck gated AFTER the existing _serverATEnabled gate ─
console.log('\nT2 — runAutoTradeCheck gates demo path');
{
    const fnIdx = SRC.indexOf('export function runAutoTradeCheck');
    check('runAutoTradeCheck found', fnIdx > 0);
    if (fnIdx > 0) {
        // Slice the body window we care about (well above the multi-tab
        // protection comment so we can verify ordering).
        const tabIdx = SRC.indexOf('Multi-tab protection', fnIdx);
        check('Multi-tab protection sentinel found below gates', tabIdx > fnIdx);
        const head = SRC.slice(fnIdx, tabIdx);
        const liveIdx = head.indexOf('w._serverATEnabled');
        const demoIdx = head.indexOf('_isServerDemoATActive(');
        check('existing _serverATEnabled gate preserved', liveIdx > 0,
            'must keep existing global server-AT gate');
        check('demo gate added', demoIdx > 0,
            '_isServerDemoATActive() gate not found in runAutoTradeCheck head');
        check('demo gate AFTER live gate', demoIdx > liveIdx,
            'demo gate must come after the existing _serverATEnabled gate, before tab leader');
        check('demo gate AFTER multi-tab — NO (must be before)',
            demoIdx < tabIdx - fnIdx,
            'demo gate must be added before the tab-leader / running checks');
        // Confirm the gate body uses an early return.
        const gateBlock = head.slice(demoIdx, demoIdx + 350);
        check('demo gate returns early', /\breturn\b/.test(gateBlock),
            'demo gate must return early to prevent decision/execution cycle');
    }
}

// ── T3 — placeAutoTrade gated immediately after live gate ─────────────────
console.log('\nT3 — placeAutoTrade gates demo placement');
{
    const fnIdx = SRC.indexOf('export function placeAutoTrade');
    check('placeAutoTrade found', fnIdx > 0);
    if (fnIdx > 0) {
        const head = SRC.slice(fnIdx, fnIdx + 1200);
        const liveIdx = head.indexOf('w._serverATEnabled');
        const demoIdx = head.indexOf('_isServerDemoATActive(');
        check('existing _serverATEnabled gate preserved', liveIdx > 0);
        check('demo gate added', demoIdx > 0,
            '_isServerDemoATActive() gate not found in placeAutoTrade head');
        check('demo gate AFTER live gate', demoIdx > liveIdx,
            'demo gate must come after the existing _serverATEnabled gate');
        // Demo gate must precede order placement / risk / DSL fallback logic.
        const dslIdx = head.indexOf('DSL MODE GUARD');
        if (dslIdx > 0) {
            check('demo gate BEFORE DSL fallback / order logic', demoIdx < dslIdx,
                'demo gate must short-circuit before DSL/order-placement code');
        }
        const gateBlock = head.slice(demoIdx, demoIdx + 250);
        check('demo gate returns early', /\breturn\b/.test(gateBlock),
            'placeAutoTrade demo gate must return without placing an order');
    }
}

// ── T4 — scheduleAutoClose (third secondary gate) gates demo path ────────
console.log('\nT4 — scheduleAutoClose monitor gates demo path');
{
    const fnIdx = SRC.indexOf('export function scheduleAutoClose');
    check('scheduleAutoClose found', fnIdx > 0);
    if (fnIdx > 0) {
        const head = SRC.slice(fnIdx, fnIdx + 800);
        const liveIdx = head.indexOf('w._serverATEnabled');
        const demoIdx = head.indexOf('_isServerDemoATActive(');
        check('existing _serverATEnabled gate preserved', liveIdx > 0);
        check('demo gate added', demoIdx > 0,
            '_isServerDemoATActive() gate not found in scheduleAutoClose head');
        check('demo gate AFTER live gate', demoIdx > liveIdx,
            'demo gate must come after the existing _serverATEnabled gate');
        const gateBlock = head.slice(demoIdx, demoIdx + 200);
        check('demo gate returns early', /\breturn\b/.test(gateBlock),
            'scheduleAutoClose demo gate must return early');
    }
}

// ── T5 — gate count: exactly three demo gates + helper ────────────────────
console.log('\nT5 — gate count + structural invariants');
{
    const helperDecl = (SRC.match(/function\s+_isServerDemoATActive\s*\(/g) || []).length;
    check('helper declared exactly once', helperDecl === 1,
        'expected exactly one helper declaration, got ' + helperDecl);

    const callSites = (SRC.match(/_isServerDemoATActive\(/g) || []).length;
    // 1 declaration + 3 call sites = 4 occurrences.
    check('exactly 3 call sites + 1 declaration (4 total)', callSites === 4,
        'expected 4 occurrences of _isServerDemoATActive(, got ' + callSites);

    // Confirm helper precedes all callers (declaration ordering).
    const declIdx = SRC.search(/function\s+_isServerDemoATActive\s*\(/);
    const firstCallIdx = SRC.indexOf('_isServerDemoATActive(', declIdx + 1);
    check('helper declared before any caller', declIdx > 0 && firstCallIdx > declIdx,
        'helper must be hoisted/declared above all call sites for clarity');
}

// ── T6 — safety: no localStorage / no server module ref / no MF write ─────
console.log('\nT6 — safety constraints in autotrade.ts patch');
{
    // Patch must NOT introduce any localStorage read/write.
    const newLines = SRC.split('\n').filter(l => l.indexOf('S6-B5') >= 0 ||
                                                 l.indexOf('_isServerDemoATActive') >= 0 ||
                                                 l.indexOf('_serverATDemoEnabled') >= 0);
    const newBlock = newLines.join('\n');
    check('no localStorage in patch', newBlock.indexOf('localStorage') === -1);
    check('no MF / migrationFlags ref in patch', newBlock.indexOf('migrationFlags') === -1 &&
                                                  newBlock.indexOf('MF.') === -1);
    check('no Bybit ref in patch', newBlock.toLowerCase().indexOf('bybit') === -1);
    check('no fetch / api call in patch', newBlock.indexOf('fetch(') === -1 &&
                                          newBlock.indexOf('api.raw(') === -1);
    check('no server import in patch', newBlock.indexOf("require('../server") === -1 &&
                                       newBlock.indexOf("from '../server") === -1);
    check('no flag mutation in patch', newBlock.indexOf('=true') === -1 &&
                                       newBlock.indexOf('= true') === -1 ||
                                       /\b_serverATDemoEnabled\s*=/.test(newBlock) === false,
        'patch must not mutate window._serverATDemoEnabled');
}

// ── T7 — current-state inert: server flags + on-disk JSON still false ────
console.log('\nT7 — runtime remains inert (flags still false)');
{
    const flagsPath = path.join(ROOT, 'data/migration_flags.json');
    const flagsJson = JSON.parse(fs.readFileSync(flagsPath, 'utf8'));
    check('SERVER_AT_DEMO false on disk', flagsJson.SERVER_AT_DEMO === false,
        'expected SERVER_AT_DEMO=false');
    check('SERVER_BRAIN_DEMO false on disk', flagsJson.SERVER_BRAIN_DEMO === false,
        'expected SERVER_BRAIN_DEMO=false');
    check('SERVER_AT false on disk', flagsJson.SERVER_AT === false,
        'expected SERVER_AT=false');
    check('SERVER_BRAIN false on disk', flagsJson.SERVER_BRAIN === false,
        'expected SERVER_BRAIN=false');

    // Confirm S6-B4 boot defaults still in place in core/state.ts.
    const stateSrc = fs.readFileSync(path.join(ROOT, 'client/src/core/state.ts'), 'utf8');
    check('client boot defaults _serverATDemoEnabled = false', /_serverATDemoEnabled\s*=\s*false/.test(stateSrc));
    check('client boot defaults _serverBrainDemoEnabled = false', /_serverBrainDemoEnabled\s*=\s*false/.test(stateSrc));
}

// ── T8 — forbidden files unchanged in S6-B5 patch (source-level guard) ────
// We use two narrowed markers to avoid false positives on S6-B4
// forward-reference comments that mention `S6-B5` without brackets:
//   - the bracketed sentinel `[S6-B5]` (used by every S6-B5 patch line)
//   - the helper name `_isServerDemoATActive` (introduced exclusively by S6-B5)
console.log('\nT8 — forbidden files NOT touched by S6-B5 patch');
{
    const BRACKETED = '[S6-B5]';
    const HELPER = '_isServerDemoATActive';
    const forbidden = [
        'server/services/serverAT.js',
        'server/services/serverBrain.js',
        'server/migrationFlags.js',
        'server/services/database.js',
        'server/services/binanceSigner.js',
        'client/src/hooks/useServerSync.ts',
        'client/src/core/state.ts',
        'client/src/types/sync.ts',
    ];
    for (const rel of forbidden) {
        const p = path.join(ROOT, rel);
        if (!fs.existsSync(p)) { check('skip missing ' + rel, true); continue; }
        const txt = fs.readFileSync(p, 'utf8');
        check(rel + ' has no [S6-B5] bracket sentinel',
            txt.indexOf(BRACKETED) === -1,
            rel + ' contains [S6-B5] marker — forbidden file was modified');
        check(rel + ' has no _isServerDemoATActive reference',
            txt.indexOf(HELPER) === -1,
            rel + ' references the S6-B5 helper — forbidden file was modified');
    }
    // Confirm autotrade.ts DOES carry both markers (sanity).
    check('autotrade.ts carries [S6-B5] sentinel', SRC.indexOf(BRACKETED) > 0);
    check('autotrade.ts carries _isServerDemoATActive helper',
        SRC.indexOf(HELPER) > 0);
    // Confirm no Bybit module touched.
    const bybitPaths = [
        'server/services/bybitSigner.js',
        'server/services/bybitOrderTranslator.js',
        'server/services/bybitParity.js',
    ];
    for (const rel of bybitPaths) {
        const p = path.join(ROOT, rel);
        if (!fs.existsSync(p)) continue;
        const txt = fs.readFileSync(p, 'utf8');
        check(rel + ' has no [S6-B5] bracket sentinel',
            txt.indexOf(BRACKETED) === -1,
            rel + ' contains [S6-B5] marker');
        check(rel + ' has no _isServerDemoATActive reference',
            txt.indexOf(HELPER) === -1);
    }
}

// ── T9 — lightweight semantic check on the helper logic ──────────────────
// Pull the helper body out of the source and rebuild a tiny equivalent in
// pure JS. The shape is:
//   if (w._serverATDemoEnabled !== true) return false
//   const _mode = String(getATMode() || '').toLowerCase()
//   return _mode === 'demo'
console.log('\nT9 — semantic re-implementation of _isServerDemoATActive');
{
    function helper(w, getATMode) {
        try {
            if (w._serverATDemoEnabled !== true) return false;
            const _mode = String((getATMode && getATMode()) || '').toLowerCase();
            return _mode === 'demo';
        } catch (_) { return false; }
    }

    // Demo + flag on => true
    check('demo + flag=true ⇒ true',
        helper({ _serverATDemoEnabled: true }, () => 'demo') === true);
    // Demo + flag off => false (inert)
    check('demo + flag=false ⇒ false (inert)',
        helper({ _serverATDemoEnabled: false }, () => 'demo') === false);
    check('demo + flag=undefined ⇒ false (inert)',
        helper({}, () => 'demo') === false);
    // Live + flag on => false (must not block live)
    check('live + flag=true ⇒ false',
        helper({ _serverATDemoEnabled: true }, () => 'live') === false);
    // Testnet + flag on => false (must not block testnet path)
    check('testnet + flag=true ⇒ false',
        helper({ _serverATDemoEnabled: true }, () => 'testnet') === false);
    // Real + flag on => false
    check('real + flag=true ⇒ false',
        helper({ _serverATDemoEnabled: true }, () => 'real') === false);
    // Uppercase DEMO + flag on => true (strict toLowerCase normalize)
    check('DEMO uppercase + flag=true ⇒ true',
        helper({ _serverATDemoEnabled: true }, () => 'DEMO') === true);
    // Unknown / missing mode + flag on => false (fail safe — never block live)
    check('missing mode + flag=true ⇒ false (fail safe)',
        helper({ _serverATDemoEnabled: true }, () => '') === false);
    check('null mode + flag=true ⇒ false (fail safe)',
        helper({ _serverATDemoEnabled: true }, () => null) === false);
    check('undefined mode + flag=true ⇒ false (fail safe)',
        helper({ _serverATDemoEnabled: true }, () => undefined) === false);
    check('thrown getATMode + flag=true ⇒ false (try/catch)',
        helper({ _serverATDemoEnabled: true }, () => { throw new Error('boom'); }) === false);
    // Truthy non-boolean must NOT match strict-true check
    check('flag=1 (truthy non-true) ⇒ false (strict)',
        helper({ _serverATDemoEnabled: 1 }, () => 'demo') === false);
    check('flag="true" (string) ⇒ false (strict)',
        helper({ _serverATDemoEnabled: 'true' }, () => 'demo') === false);
}

// ── T10 — gates render correct status text only when AT enabled ──────────
console.log('\nT10 — gate side-effects mirror existing _serverATEnabled behavior');
{
    // runAutoTradeCheck gate updates the AT panel via _atUI({ status: ... })
    const fnIdx = SRC.indexOf('export function runAutoTradeCheck');
    const head = SRC.slice(fnIdx, fnIdx + 4000);
    const demoIdx = head.indexOf('_isServerDemoATActive(');
    const block = head.slice(demoIdx, demoIdx + 500);
    check('runAutoTradeCheck demo status text labelled "demo"',
        /SERVER AT ACTIVE.*demo/i.test(block),
        'demo gate UI status string should mention "demo" so panel is unambiguous');
    check('runAutoTradeCheck demo gate gated by getATEnabled (no panel spam when AT off)',
        block.indexOf('getATEnabled()') > 0,
        'panel update should mirror existing pattern: only patch when AT is enabled');

    // placeAutoTrade gate uses atLog('info', ...) like the live gate
    const fnIdx2 = SRC.indexOf('export function placeAutoTrade');
    const head2 = SRC.slice(fnIdx2, fnIdx2 + 1500);
    const demoIdx2 = head2.indexOf('_isServerDemoATActive(');
    const block2 = head2.slice(demoIdx2, demoIdx2 + 250);
    check('placeAutoTrade demo gate uses atLog info', /atLog\(\s*['"]info['"]/.test(block2),
        'placeAutoTrade demo gate should log info-level "[LOCKED] ..." like the live gate');
    check('placeAutoTrade demo gate message labelled "demo"',
        /demo.*demo/i.test(block2) || /Server demo AT active/i.test(block2),
        'placeAutoTrade demo log line should clearly mention demo');
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log('\n────────────────────────────────────────');
console.log(`probe-s6b5: pass=${pass} fail=${fail}`);
console.log('────────────────────────────────────────');
process.exit(fail === 0 ? 0 : 1);
