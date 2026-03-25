/**
 * Sprint 2 / Batch 2 — Smoke Tests (source verification)
 * T1: State sync / freshness / dirty flags — _dirty, _lastEditTs, _stateVersion, _saving
 * T2: Cross-device / restore — boot + visibility closedIds comprehensive, boot balance freshness guard
 */
'use strict';

let passed = 0;
let failed = 0;
function assert(cond, label) {
    if (cond) { passed++; console.log(`  \u2705 ${label}`); }
    else { failed++; console.error(`  \u274c FAIL: ${label}`); }
}

const fs = require('fs');

const stateSrc = fs.readFileSync('./public/js/core/state.js', 'utf8');
const bootSrc = fs.readFileSync('./public/js/core/bootstrap.js', 'utf8');

// ═══════════════════════════════════════════════════════════════
// T1: State Sync / Freshness / Dirty Flags
// ═══════════════════════════════════════════════════════════════
console.log('\n── T1: State Sync / Freshness / Dirty Flags ──');

// 1a) Dirty flag + version counter + freshness tracking fields
(function testDirtyFlagDeclarations() {
    assert(stateSrc.includes('let _dirty = false;'), 'T1.1a _dirty flag declared (false)');
    assert(stateSrc.includes('let _lastEditTs = 0;'), 'T1.1a _lastEditTs declared (0)');
    assert(stateSrc.includes('let _stateVersion = 0;'), 'T1.1a _stateVersion declared (0)');
    assert(stateSrc.includes('let _saving = false;'), 'T1.1a _saving flag declared (false)');
})();

// 1b) markDirty function exists and sets all three fields
(function testMarkDirty() {
    assert(stateSrc.includes('function markDirty()'), 'T1.1b markDirty() declared');
    assert(stateSrc.includes('_dirty = true'), 'T1.1b markDirty sets _dirty = true');
    assert(stateSrc.includes('_lastEditTs = Date.now()'), 'T1.1b markDirty sets _lastEditTs');
    assert(stateSrc.includes('_stateVersion++'), 'T1.1b markDirty increments _stateVersion');
})();

// 1c) _serialize includes v + lastEditTs
(function testSerializeFreshness() {
    assert(stateSrc.includes('v: _stateVersion'), 'T1.1c _serialize includes v: _stateVersion');
    assert(stateSrc.includes('lastEditTs: _lastEditTs'), 'T1.1c _serialize includes lastEditTs');
})();

// 1d) save() gates with _saving flag
(function testSaveGuard() {
    assert(stateSrc.includes('_saving = true;'), 'T1.1d save() sets _saving = true');
    assert(stateSrc.includes("finally { _saving = false; }"), 'T1.1d save() clears _saving in finally');
    // Verify save logs version
    assert(stateSrc.includes("'v:', data.v"), 'T1.1d save() logs version number');
})();

// 1e) _pushToServer snapshots dirty + conditional clear
(function testPushDirtySnapshot() {
    assert(stateSrc.includes('var _pushDirtySnapshot = _dirty;'), 'T1.1e _pushToServer snapshots _dirty');
    assert(stateSrc.includes('_lastEditTs <= data.lastEditTs'), 'T1.1e dirty cleared only if no new mutations');
    // Verify it's inside .finally()
    assert(stateSrc.includes('if (_pushDirtySnapshot && _dirty && _lastEditTs <= data.lastEditTs) { _dirty = false; }'), 'T1.1e conditional dirty clear in .finally()');
})();

// 1f) scheduleSaveAndSync calls markDirty
(function testScheduleMarksDirty() {
    // scheduleSaveAndSync must call markDirty() before scheduling the timer
    var schedIdx = stateSrc.indexOf('function scheduleSaveAndSync()');
    var markIdx = stateSrc.indexOf('markDirty();', schedIdx);
    var timeoutIdx = stateSrc.indexOf('setTimeout(saveAndSync', schedIdx);
    assert(schedIdx > -1, 'T1.1f scheduleSaveAndSync function found');
    assert(markIdx > -1 && markIdx > schedIdx, 'T1.1f markDirty() called in scheduleSaveAndSync');
    assert(markIdx < timeoutIdx, 'T1.1f markDirty() called before setTimeout');
})();

// 1g) pullAndMerge gates on _saving
(function testPullMergeGate() {
    assert(stateSrc.includes("if (_saving) { console.log('[sync] pullAndMerge deferred"), 'T1.1g pullAndMerge gates on _saving');
    assert(stateSrc.includes('return Promise.resolve(false);'), 'T1.1g deferred pullAndMerge returns resolved false');
})();

// 1h) pullAndMerge balance freshness guard
(function testPullMergeFreshness() {
    assert(stateSrc.includes("var _serverEditTs = serverSnap.lastEditTs || serverSnap.ts || 0;"), 'T1.1h pullAndMerge computes _serverEditTs');
    assert(stateSrc.includes("!(_dirty && _lastEditTs > _serverEditTs)"), 'T1.1h pullAndMerge freshness guard on balance');
})();

// 1i) Visibility resume gates on isMerging()
(function testVisibilityMergingGate() {
    assert(bootSrc.includes('ZState.isMerging && ZState.isMerging()'), 'T1.1i visibility resume checks isMerging()');
    // Make sure it's a negated gate (skip pull if merging)
    assert(bootSrc.includes('!(ZState.isMerging && ZState.isMerging())'), 'T1.1i negated gate — skip pull if merging');
})();

// 1j) Visibility balance overwrite freshness guard
(function testVisibilityBalanceFreshness() {
    assert(bootSrc.includes('var _localDirty = (typeof ZState'), 'T1.1j visibility freshness guard checks ZState.isDirty');
    assert(bootSrc.includes("!(_localDirty && (serverSnap.lastEditTs || 0) < (localSnap && localSnap.lastEditTs || 0))"), 'T1.1j visibility freshness condition prevents stale overwrite');
})();

// 1k) API exports
(function testAPIExports() {
    assert(stateSrc.includes('markDirty,'), 'T1.1k markDirty exported on return');
    assert(stateSrc.includes('isDirty: function () { return _dirty; }'), 'T1.1k isDirty() exported');
    assert(stateSrc.includes('isMerging: function () { return _merging; }'), 'T1.1k isMerging() exported');
})();

// ═══════════════════════════════════════════════════════════════
// T2: Cross-Device / Restore — Comprehensive ClosedIds + Boot Freshness
// ═══════════════════════════════════════════════════════════════
console.log('\n── T2: Cross-Device / Restore ──');

// 2a) Boot pull closedIds — comprehensive (journal + recentlyClosed + server)
(function testBootClosedIdsComprehensive() {
    // Find the boot pull section (not visibility, not pullAndMerge)
    var bootPullComment = bootSrc.indexOf('// [S2B2-T2] Comprehensive closedIds');
    assert(bootPullComment > -1, 'T2.2a Boot closedIds has S2B2-T2 comment');
    // Check that it uses all 3 sources
    var bootSection = bootSrc.substring(bootPullComment, bootPullComment + 500);
    assert(bootSection.includes('(TP.journal || []).forEach'), 'T2.2a Boot closedIds uses TP.journal');
    assert(bootSection.includes('window._zeusRecentlyClosed'), 'T2.2a Boot closedIds uses _zeusRecentlyClosed');
    assert(bootSection.includes('serverSnap.closedIds'), 'T2.2a Boot closedIds uses serverSnap.closedIds');
})();

// 2b) Visibility resume closedIds — comprehensive
(function testVisibilityClosedIdsComprehensive() {
    // Find the visibility section's closedIds (after "Cross-device pull on tab resume")
    var visAnchor = bootSrc.indexOf('Cross-device pull on tab resume');
    assert(visAnchor > -1, 'T2.2b Visibility resume section found');
    var visClosedComment = bootSrc.indexOf('// [S2B2-T2] Comprehensive closedIds', visAnchor);
    assert(visClosedComment > -1, 'T2.2b Visibility closedIds has S2B2-T2 comment');
    var visSection = bootSrc.substring(visClosedComment, visClosedComment + 500);
    assert(visSection.includes('(TP.journal || []).forEach'), 'T2.2b Visibility closedIds uses TP.journal');
    assert(visSection.includes('window._zeusRecentlyClosed'), 'T2.2b Visibility closedIds uses _zeusRecentlyClosed');
    assert(visSection.includes('serverSnap.closedIds'), 'T2.2b Visibility closedIds uses serverSnap.closedIds');
})();

// 2c) Boot balance freshness guard
(function testBootBalanceFreshnessGuard() {
    var guardComment = bootSrc.indexOf('[S2B2-T2] Freshness guard: skip overwrite if local has unsaved newer edits');
    assert(guardComment > -1, 'T2.2c Boot balance freshness guard comment present');
    var guardSection = bootSrc.substring(guardComment, guardComment + 500);
    assert(guardSection.includes('var _bootLocalEditTs ='), 'T2.2c Boot freshness: _bootLocalEditTs computed');
    assert(guardSection.includes('var _bootServerEditTs ='), 'T2.2c Boot freshness: _bootServerEditTs computed');
    assert(guardSection.includes('var _bootLocalDirty ='), 'T2.2c Boot freshness: _bootLocalDirty computed');
    assert(guardSection.includes('var _bootFresh ='), 'T2.2c Boot freshness: _bootFresh compound condition');
    assert(guardSection.includes('ZState.isDirty && ZState.isDirty()'), 'T2.2c Boot freshness checks ZState.isDirty()');
    assert(guardSection.includes('_bootFresh &&'), 'T2.2c Boot freshness gates the main if condition');
})();

// 2d) pullAndMerge closedIds — still comprehensive (regression guard)
(function testPullMergeClosedIds() {
    var pmSection = stateSrc.indexOf('function pullAndMerge()');
    assert(pmSection > -1, 'T2.2d pullAndMerge function found');
    var pmBody = stateSrc.substring(pmSection, pmSection + 2000);
    assert(pmBody.includes('var _closedSet = new Set()'), 'T2.2d pullAndMerge uses comprehensive _closedSet');
    assert(pmBody.includes('TP.journal'), 'T2.2d pullAndMerge closedIds includes journal');
    assert(pmBody.includes('window._zeusRecentlyClosed'), 'T2.2d pullAndMerge closedIds includes _zeusRecentlyClosed');
    assert(pmBody.includes('serverSnap.closedIds'), 'T2.2d pullAndMerge closedIds includes serverSnap.closedIds');
})();

// 2e) No regression — _merging gate still present in pullAndMerge
(function testMergingGateRegression() {
    assert(stateSrc.includes('_merging = true;'), 'T2.2e _merging = true before merge');
    assert(stateSrc.includes('if (_syncing || _merging)'), 'T2.2e push blocked when _merging');
})();

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════
console.log('\n══════════════════════════');
console.log(`  S2B2 Smoke: ${passed} passed, ${failed} failed — ${passed + failed} total`);
console.log('══════════════════════════');
if (failed > 0) process.exit(1);
