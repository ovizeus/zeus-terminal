/**
 * Sprint 2 — Final Verification
 * Cross-cutting integration checks across S2B1 + S2B2
 * Validates no regressions between batches, API surface intact,
 * state management coherence, and untouched file guards.
 */
'use strict';

let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, label) {
    if (cond) { passed++; console.log(`  \u2705 ${label}`); }
    else { failed++; failures.push(label); console.error(`  \u274c FAIL: ${label}`); }
}

const fs = require('fs');
const path = require('path');

function src(relPath) { return fs.readFileSync(path.join(__dirname, relPath), 'utf8'); }

const stateSrc = src('public/js/core/state.js');
const bootSrc = src('public/js/core/bootstrap.js');
const forecastSrc = src('public/js/brain/forecast.js');
const mdSrc = src('public/js/data/marketData.js');
const tabSrc = src('public/js/core/tabLeader.js');

// ═══════════════════════════════════════════════════════════════
// 1. S2B1: Regime Reset still intact after S2B2 edits
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 1. Regime Reset (S2B1 \u2192 regression guard) \u2550\u2550');
(function () {
    assert(forecastSrc.includes('function resetForecast()'), '1a resetForecast() exists');
    assert(mdSrc.includes("resetForecast === 'function') resetForecast()"), '1b setSymbol calls resetForecast');
    assert(mdSrc.includes('BM.confluenceScore = 50'), '1c BM.confluenceScore reset');
    assert(mdSrc.includes("BRAIN.state = 'scanning'"), '1d BRAIN.state reset');
    assert(mdSrc.includes("BRAIN.regime = 'unknown'"), '1e BRAIN.regime reset');
})();

// ═══════════════════════════════════════════════════════════════
// 2. S2B1: Race condition gates still intact
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 2. Race Condition Gates (S2B1 \u2192 regression guard) \u2550\u2550');
(function () {
    assert(stateSrc.includes('let _merging = false'), '2a _merging flag declared');
    assert(stateSrc.includes('if (_syncing || _merging)'), '2b push blocked during merge');
    assert(stateSrc.includes('_merging = true'), '2c _merging set true in pullAndMerge');
    // Tab leader read-after-write
    assert(tabSrc.includes('setTimeout(function'), '2d tab leader read-after-write verification');
})();

// ═══════════════════════════════════════════════════════════════
// 3. S2B2: Dirty flag infrastructure
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 3. Dirty Flag Infrastructure (S2B2-T1) \u2550\u2550');
(function () {
    assert(stateSrc.includes('let _dirty = false;'), '3a _dirty flag');
    assert(stateSrc.includes('let _lastEditTs = 0;'), '3b _lastEditTs');
    assert(stateSrc.includes('let _stateVersion = 0;'), '3c _stateVersion');
    assert(stateSrc.includes('let _saving = false;'), '3d _saving flag');
    assert(stateSrc.includes('function markDirty()'), '3e markDirty() declared');
    assert(stateSrc.includes('v: _stateVersion'), '3f version serialized');
    assert(stateSrc.includes('lastEditTs: _lastEditTs'), '3g lastEditTs serialized');
})();

// ═══════════════════════════════════════════════════════════════
// 4. S2B2: Save/push guards
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 4. Save/Push Guards (S2B2-T1) \u2550\u2550');
(function () {
    assert(stateSrc.includes('_saving = true;'), '4a save() sets _saving');
    assert(stateSrc.includes("finally { _saving = false; }"), '4b save() clears _saving');
    assert(stateSrc.includes('var _pushDirtySnapshot = _dirty;'), '4c push snapshots dirty');
    assert(stateSrc.includes('if (_pushDirtySnapshot && _dirty && _lastEditTs <= data.lastEditTs) { _dirty = false; }'), '4d conditional dirty clear');
})();

// ═══════════════════════════════════════════════════════════════
// 5. S2B2: Freshness guards in pull paths
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 5. Freshness Guards (S2B2-T1+T2) \u2550\u2550');
(function () {
    // pullAndMerge freshness
    assert(stateSrc.includes("if (_saving) { console.log('[sync] pullAndMerge deferred"), '5a pullAndMerge defers on _saving');
    assert(stateSrc.includes('!(_dirty && _lastEditTs > _serverEditTs)'), '5b pullAndMerge balance freshness guard');
    // Visibility freshness
    assert(bootSrc.includes('!(ZState.isMerging && ZState.isMerging())'), '5c visibility isMerging gate');
    assert(bootSrc.includes('var _localDirty = (typeof ZState'), '5d visibility dirty check');
    // Boot freshness
    assert(bootSrc.includes('var _bootFresh ='), '5e boot freshness guard');
    assert(bootSrc.includes('_bootFresh &&'), '5f boot freshness gates balance overwrite');
})();

// ═══════════════════════════════════════════════════════════════
// 6. S2B2: Comprehensive closedIds (3 locations)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 6. Comprehensive ClosedIds (S2B2-T2) \u2550\u2550');
(function () {
    // All 3 merge paths must use journal + _zeusRecentlyClosed + serverSnap.closedIds

    // 6a: pullAndMerge in state.js
    var pmIdx = stateSrc.indexOf('function pullAndMerge()');
    var pmSection = stateSrc.substring(pmIdx, pmIdx + 2000);
    assert(pmSection.includes('_zeusRecentlyClosed'), '6a pullAndMerge uses _zeusRecentlyClosed');
    assert(pmSection.includes('serverSnap.closedIds'), '6a pullAndMerge uses serverSnap.closedIds');
    assert(pmSection.includes('TP.journal'), '6a pullAndMerge uses journal');

    // 6b: Boot pull in bootstrap.js
    var bootClosedComment = bootSrc.indexOf('[S2B2-T2] Comprehensive closedIds');
    assert(bootClosedComment > -1, '6b boot closedIds has S2B2-T2 tag');
    var bootClosedSection = bootSrc.substring(bootClosedComment, bootClosedComment + 500);
    assert(bootClosedSection.includes('_zeusRecentlyClosed'), '6b boot uses _zeusRecentlyClosed');

    // 6c: Visibility pull in bootstrap.js
    var visAnchor = bootSrc.indexOf('Cross-device pull on tab resume');
    var visClosedComment = bootSrc.indexOf('[S2B2-T2] Comprehensive closedIds', visAnchor);
    assert(visClosedComment > visAnchor, '6c visibility closedIds has S2B2-T2 tag');
    var visClosedSection = bootSrc.substring(visClosedComment, visClosedComment + 500);
    assert(visClosedSection.includes('_zeusRecentlyClosed'), '6c visibility uses _zeusRecentlyClosed');
})();

// ═══════════════════════════════════════════════════════════════
// 7. API Surface — ZState exports
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 7. ZState API Surface \u2550\u2550');
(function () {
    // All required public methods
    // The final return is a single long line — grab everything from the last "return {" to "};"
    var lastReturn = stateSrc.lastIndexOf('return { save:');
    assert(lastReturn > -1, '7a ZState return block found');
    if (lastReturn > -1) {
        var api = stateSrc.substring(lastReturn, stateSrc.indexOf('};', lastReturn) + 2);
        assert(api.includes('save:'), '7b save exposed');
        assert(api.includes('saveLocal:'), '7c saveLocal exposed');
        assert(api.includes('load'), '7d load exposed');
        assert(api.includes('restore'), '7e restore exposed');
        assert(api.includes('scheduleSave:'), '7f scheduleSave exposed');
        assert(api.includes('syncToServer'), '7g syncToServer exposed');
        assert(api.includes('pullFromServer'), '7h pullFromServer exposed');
        assert(api.includes('pullAndMerge'), '7i pullAndMerge exposed');
        assert(api.includes('markDirty'), '7j markDirty exposed');
        assert(api.includes('isDirty'), '7k isDirty exposed');
        assert(api.includes('isMerging'), '7l isMerging exposed');
        assert(api.includes('markSyncReady'), '7m markSyncReady exposed');
        assert(api.includes('startATPolling'), '7n startATPolling exposed');
    }
})();

// ═══════════════════════════════════════════════════════════════
// 8. Ordering: markDirty before save timer
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 8. scheduleSaveAndSync Ordering \u2550\u2550');
(function () {
    var ssIdx = stateSrc.indexOf('function scheduleSaveAndSync()');
    var mdIdx = stateSrc.indexOf('markDirty();', ssIdx);
    var stIdx = stateSrc.indexOf('setTimeout(saveAndSync', ssIdx);
    assert(ssIdx > -1 && mdIdx > ssIdx && stIdx > mdIdx, '8a markDirty called before setTimeout');
})();

// ═══════════════════════════════════════════════════════════════
// 9. Cross-cutting: No S1 regressions
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 9. Sprint 1 Regression Guards \u2550\u2550');
(function () {
    // AT mode ambiguity (S1B1)
    assert(stateSrc.includes('_modeConfirmed'), '9a AT mode ambiguity guard present');
    // SL retry delays (S1B3)
    var satSrc = src('server/services/serverAT.js');
    assert(satSrc.includes('SL_RETRY_DELAYS'), '9b SL retry delays present');
    assert(satSrc.includes('TP_RETRY_DELAYS'), '9c TP retry delays present');
    // OI stale guard (S1B3)
    var confSrc = src('public/js/brain/confluence.js');
    assert(confSrc.includes('oiStale'), '9d OI stale guard present');
    // DSL timestamp (S1B3)
    var dslSrc = src('public/js/trading/dsl.js');
    assert(dslSrc.includes('lastTickTs'), '9e DSL timestamp check present');
    // Reconciliation (S1B2)
    var reconSrc = src('server/services/reconciliation.js');
    assert(reconSrc.includes('_comparePositions') || reconSrc.includes('comparePositions'), '9f reconciliation mismatch detection');
    // ARES close (S1B2)
    var ddSrc = src('public/js/brain/deepdive.js');
    assert(ddSrc.includes('closeLivePosition') || ddSrc.includes('aresClosePosition'), '9g ARES live close path');
})();

// ═══════════════════════════════════════════════════════════════
// 10. Untouched files: No Sprint 2 markers in wrong places
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 10. Untouched File Guards \u2550\u2550');
(function () {
    var indexHtml = src('public/index.html');
    assert(!indexHtml.includes('[S2B'), '10a index.html has no S2 batch markers');
    var mainCss = src('public/css/main.css');
    assert(!mainCss.includes('[S2B'), '10b main.css has no S2 batch markers');
    var serverJs = src('server.js');
    assert(!serverJs.includes('[S2B'), '10c server.js has no S2 batch markers');
    var configJs = src('server/config.js');
    assert(!configJs.includes('[S2B'), '10d server/config.js has no S2 batch markers');
    // Auth routes should be untouched
    var authJs = src('server/routes/auth.js');
    assert(!authJs.includes('[S2B'), '10e auth.js has no S2 batch markers');
    assert(authJs.includes('/login') || authJs.includes('login'), '10f auth login route intact');
})();

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════
console.log(`\n${'='.repeat(60)}`);
console.log(`SPRINT 2 \u2014 FINAL VERIFICATION: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(60)}`);
if (failures.length > 0) {
    console.log('\nFailed:');
    failures.forEach(function (f) { console.log('  \u274c ' + f); });
}
if (failed > 0) process.exit(1);
