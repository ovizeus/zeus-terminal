/**
 * Sprint 2 / Batch 1 — Smoke Tests (source verification)
 * T1: Regime reset at symbol change — all brain/BM/forecast state resets
 * T2: PullAndMerge race condition — _merging flag gates _pushToServer
 * T3: Tab leader race window — read-after-write verification on claim race
 */
'use strict';

let passed = 0;
let failed = 0;
function assert(cond, label) {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.error(`  ❌ FAIL: ${label}`); }
}

const fs = require('fs');

// ═══════════════════════════════════════════════════════════════
// T1: Regime Reset at Symbol Change
// ═══════════════════════════════════════════════════════════════
console.log('\n── T1: Regime reset at symbol change ──');
(function testRegimeReset() {
    // 1a) forecast.js: resetForecast() exists and clears _qebLastRegime
    const forecastSrc = fs.readFileSync('./public/js/brain/forecast.js', 'utf8');
    assert(forecastSrc.includes('function resetForecast()'), 'resetForecast() function declared');
    assert(forecastSrc.includes('_qebLastRegime = null'), 'resetForecast clears _qebLastRegime to null');

    // 1b) marketData.js setSymbol() calls resetForecast
    const mdSrc = fs.readFileSync('./public/js/data/marketData.js', 'utf8');
    assert(mdSrc.includes("resetForecast === 'function') resetForecast()"), 'setSymbol calls resetForecast()');

    // 1c) BM.confluenceScore reset to 50
    assert(mdSrc.includes('BM.confluenceScore = 50'), 'BM.confluenceScore reset to 50');

    // 1d) BM.probScore reset to 0
    assert(mdSrc.includes('BM.probScore = 0'), 'BM.probScore reset to 0');

    // 1e) BM.probBreakdown reset
    assert(mdSrc.includes("BM.probBreakdown = { regime: 0, liquidity: 0, signals: 0, flow: 0 }"), 'BM.probBreakdown reset to zeros');

    // 1f) BM.entryScore + entryReady reset
    assert(mdSrc.includes('BM.entryScore = 0'), 'BM.entryScore reset to 0');
    assert(mdSrc.includes('BM.entryReady = false'), 'BM.entryReady reset to false');

    // 1g) BM.gates reset
    assert(mdSrc.includes('BM.gates = {}'), 'BM.gates reset to empty');

    // 1h) BM.sweep reset
    assert(mdSrc.includes("BM.sweep = { type: 'none', reclaim: false, displacement: false }"), 'BM.sweep reset');

    // 1i) BM.flow reset
    assert(mdSrc.includes("BM.flow = { cvd: 'neut', delta: 0, ofi: 'neut' }"), 'BM.flow reset');

    // 1j) BM.mtf reset
    assert(mdSrc.includes("BM.mtf = { '15m': 'neut', '1h': 'neut', '4h': 'neut' }"), 'BM.mtf reset');

    // 1k) BM.atmosphere reset
    assert(mdSrc.includes("BM.atmosphere = { category: 'neutral', allowEntry: true"), 'BM.atmosphere reset');

    // 1l) BM.qexit reset
    assert(mdSrc.includes("BM.qexit = { risk: 0, signals:"), 'BM.qexit reset');
    assert(mdSrc.includes("action: 'HOLD', lastTs: 0"), 'BM.qexit action HOLD + lastTs 0');

    // 1m) BM.danger + conviction reset
    assert(mdSrc.includes('BM.danger = 0'), 'BM.danger reset to 0');
    assert(mdSrc.includes('BM.conviction = 0'), 'BM.conviction reset to 0');
    assert(mdSrc.includes('BM.convictionMult = 1.0'), 'BM.convictionMult reset to 1.0');

    // 1n) BM.structure reset
    assert(mdSrc.includes("BM.structure = { regime: 'unknown'"), 'BM.structure reset');

    // 1o) BRAIN reset
    assert(mdSrc.includes("BRAIN.state = 'scanning'"), 'BRAIN.state reset to scanning');
    assert(mdSrc.includes("BRAIN.regime = 'unknown'"), 'BRAIN.regime reset to unknown');
    assert(mdSrc.includes('BRAIN.regimeConfidence = 0'), 'BRAIN.regimeConfidence reset to 0');
    assert(mdSrc.includes('BRAIN.score = 0'), 'BRAIN.score reset to 0');
    assert(mdSrc.includes('BRAIN.thoughts = []'), 'BRAIN.thoughts reset to empty');
    assert(mdSrc.includes('BRAIN.neurons = {}'), 'BRAIN.neurons reset to empty');
    assert(mdSrc.includes("BRAIN.ofi = { buy: 0, sell: 0, blendBuy: 50, tape: [] }"), 'BRAIN.ofi reset to defaults');

    // 1p) CORE_STATE reset
    assert(mdSrc.includes('CORE_STATE.score = 50'), 'CORE_STATE.score reset to 50');
    assert(mdSrc.includes('CORE_STATE.lastUpdate = Date.now()'), 'CORE_STATE.lastUpdate set to now');

    // 1q) BM.dangerBreakdown reset
    assert(mdSrc.includes("BM.dangerBreakdown = { volatility: 0, spread: 0, liquidations: 0, volume: 0, funding: 0 }"), 'BM.dangerBreakdown reset');

    // 1r) Verify reset block is inside setSymbol function
    const setSymIdx = mdSrc.indexOf('function setSymbol(');
    const resetIdx = mdSrc.indexOf('BM.confluenceScore = 50');
    assert(setSymIdx > -1 && resetIdx > setSymIdx, 'Reset block is inside setSymbol()');

    // 1s) RegimeEngine.reset() still called
    assert(mdSrc.includes('RegimeEngine.reset()'), 'RegimeEngine.reset() still present');
    assert(mdSrc.includes('PhaseFilter.reset()'), 'PhaseFilter.reset() still present');
})();

// ═══════════════════════════════════════════════════════════════
// T2: PullAndMerge Race Condition
// ═══════════════════════════════════════════════════════════════
console.log('\n── T2: PullAndMerge race condition ──');
(function testPullAndMergeRace() {
    const src = fs.readFileSync('./public/js/core/state.js', 'utf8');

    // 2a) _merging flag exists
    assert(src.includes('let _merging = false'), '_merging flag declared');

    // 2b) _pushToServer gates on _merging
    assert(src.includes('_syncing || _merging'), '_pushToServer checks _merging flag');

    // 2c) pullAndMerge sets _merging = true at start
    const pullIdx = src.indexOf('function pullAndMerge()');
    const mergingTrueIdx = src.indexOf('_merging = true', pullIdx);
    const pullFromIdx = src.indexOf('pullFromServer()', pullIdx);
    assert(mergingTrueIdx > pullIdx && mergingTrueIdx < pullFromIdx, '_merging = true set before pullFromServer()');

    // 2d) .finally() releases _merging = false
    assert(src.includes('.finally(function () { _merging = false; })'), '_merging = false in .finally()');

    // 2e) _syncQueued = true when blocked by _merging (ensures deferred push)
    const pushFn = src.substring(src.indexOf('function _pushToServer()'));
    const firstLine = pushFn.substring(0, pushFn.indexOf('\n', pushFn.indexOf('_merging')));
    assert(firstLine.includes('_syncQueued = true'), 'Push queues when blocked by _merging');

    // 2f) Original _syncing logic still intact
    assert(src.includes("_syncing = true;\n    _syncQueued = false;"), '_syncing = true still sets _syncQueued = false');

    // 2g) pullAndMerge still has .catch for error handling
    assert(src.includes("pullAndMerge failed"), 'pullAndMerge error handling intact');
})();

// ═══════════════════════════════════════════════════════════════
// T3: Tab Leader Race Window
// ═══════════════════════════════════════════════════════════════
console.log('\n── T3: Tab leader race window ──');
(function testTabLeaderRace() {
    const src = fs.readFileSync('./public/js/core/tabLeader.js', 'utf8');

    // 3a) Read-after-write verification exists
    assert(src.includes('Read-after-write verification'), 'Read-after-write comment present');

    // 3b) After claim(), 200ms re-check is scheduled
    assert(src.includes('setTimeout(function ()'), 'Verification setTimeout exists');
    assert(src.includes(', 200)'), '200ms delay for verification');

    // 3c) Re-read localStorage to check who actually won
    assert(src.includes('var check = _read()'), 'Re-reads localStorage after claim');

    // 3d) Yields leadership if another tab won
    assert(src.includes('check.id !== tabId'), 'Compares read-back id vs own tabId');
    assert(src.includes('_isLeader = false'), 'Sets _isLeader = false on yield');

    // 3e) Clears heartbeat on yield
    assert(src.includes('clearInterval(_heartbeatTimer)'), 'Clears heartbeat timer on yield');
    assert(src.includes('_heartbeatTimer = null'), 'Nulls heartbeat timer on yield');

    // 3f) Logs the yield event
    assert(src.includes('Yielded'), 'Logs yield event');

    // 3g) Original claim jitter still present (50-150ms)
    assert(src.includes('50 + Math.random() * 100'), 'Original claim jitter 50-150ms preserved');

    // 3h) Storage event handler still distinguishes null vs new value
    assert(src.includes("if (!e.newValue)"), 'Storage event null check preserved');
    assert(src.includes("data.id !== tabId"), 'Storage event new-value leader detection preserved');

    // 3i) HEARTBEAT_MS and STALE_MS unchanged
    const hbMatch = src.match(/HEARTBEAT_MS\s*=\s*(\d+)/);
    assert(hbMatch && hbMatch[1] === '3000', 'HEARTBEAT_MS still 3000');
    const stMatch = src.match(/STALE_MS\s*=\s*(\d+)/);
    assert(stMatch && stMatch[1] === '5000', 'STALE_MS still 5000');

    // 3j) Window.TabLeader API preserved
    assert(src.includes('window.TabLeader = {'), 'TabLeader global API preserved');
    assert(src.includes('isLeader:'), 'isLeader method preserved');
    assert(src.includes('checkLeader:'), 'checkLeader method preserved');
    assert(src.includes('claim:'), 'claim method preserved');
    assert(src.includes('release:'), 'release method preserved');
})();

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════
console.log(`\n═══ S2B1 SMOKE: ${passed} passed, ${failed} failed ═══`);
if (failed > 0) process.exit(1);
