// Zeus v122 — analytics/perfStore.js
// PERF persistence + expectancy calculator
// Brain does NOT touch this file. Analytics only measures.
'use strict';

var _PERF_STORAGE_KEY = 'zeus_perf_v1';

// ── Save PERF to localStorage ────────────────────────────────
function savePerfToStorage() {
    try {
        var payload = {};
        Object.keys(PERF).forEach(function (k) {
            var p = PERF[k];
            payload[k] = {
                wins: p.wins, losses: p.losses, weight: p.weight,
                pnlSum: p.pnlSum || 0, feeSum: p.feeSum || 0,
                winPnl: p.winPnl || 0, lossPnl: p.lossPnl || 0
            };
        });
        if (typeof _safeLocalStorageSet === 'function') {
            _safeLocalStorageSet(_PERF_STORAGE_KEY, payload);
        }
    } catch (e) {
        console.warn('[perfStore] save failed:', e.message);
    }
}

// ── Load PERF from localStorage ──────────────────────────────
function loadPerfFromStorage() {
    try {
        var raw = localStorage.getItem(_PERF_STORAGE_KEY);
        if (!raw) return;
        var data = JSON.parse(raw);
        if (!data || typeof data !== 'object') return;
        Object.keys(data).forEach(function (k) {
            if (!PERF[k]) return;
            var d = data[k];
            PERF[k].wins = d.wins || 0;
            PERF[k].losses = d.losses || 0;
            PERF[k].weight = d.weight || 1.0;
            PERF[k].pnlSum = d.pnlSum || 0;
            PERF[k].feeSum = d.feeSum || 0;
            PERF[k].winPnl = d.winPnl || 0;
            PERF[k].lossPnl = d.lossPnl || 0;
        });
        if (typeof renderPerfTracker === 'function') renderPerfTracker();
    } catch (e) {
        console.warn('[perfStore] load failed:', e.message);
    }
}

// ── Record PnL + fees for a specific indicator ───────────────
// Called alongside recordIndicatorPerformance when a trade closes
function recordIndicatorPnl(indicatorId, pnl, fees) {
    var p = PERF[indicatorId];
    if (!p) return;
    var pnlVal = Number.isFinite(pnl) ? pnl : 0;
    var feeVal = Number.isFinite(fees) ? fees : 0;
    p.pnlSum = (p.pnlSum || 0) + pnlVal;
    p.feeSum = (p.feeSum || 0) + feeVal;
    if (pnlVal >= 0) p.winPnl = (p.winPnl || 0) + pnlVal;
    else p.lossPnl = (p.lossPnl || 0) + Math.abs(pnlVal);
}

// ── Expectancy per indicator ──────────────────────────────────
// E = (WR × AvgWin) − ((1−WR) × AvgLoss)
function calcExpectancy(indicatorId) {
    var p = PERF[indicatorId];
    if (!p) return 0;
    var tot = p.wins + p.losses;
    if (tot < 1) return 0;
    var wr = p.wins / tot;
    var avgWin = p.wins > 0 ? (p.winPnl || 0) / p.wins : 0;
    var avgLoss = p.losses > 0 ? (p.lossPnl || 0) / p.losses : 0;
    return (wr * avgWin) - ((1 - wr) * avgLoss);
}

// ── Global expectancy (all indicators combined) ──────────────
function calcGlobalExpectancy() {
    var totalWins = 0, totalLosses = 0, totalWinPnl = 0, totalLossPnl = 0;
    Object.values(PERF).forEach(function (p) {
        totalWins += p.wins || 0;
        totalLosses += p.losses || 0;
        totalWinPnl += p.winPnl || 0;
        totalLossPnl += p.lossPnl || 0;
    });
    var tot = totalWins + totalLosses;
    if (tot < 1) return 0;
    var wr = totalWins / tot;
    var avgWin = totalWins > 0 ? totalWinPnl / totalWins : 0;
    var avgLoss = totalLosses > 0 ? totalLossPnl / totalLosses : 0;
    return (wr * avgWin) - ((1 - wr) * avgLoss);
}

// ── Expectancy per profile ───────────────────────────────────
// Uses TP.journal to filter closed trades by profile
function calcExpectancyByProfile(profile) {
    var journal = (typeof TP !== 'undefined' && Array.isArray(TP.journal)) ? TP.journal : [];
    var trades = journal.filter(function (t) {
        return t.journalEvent === 'CLOSE' && t.exit !== null && Number.isFinite(t.pnl) && (t.profile || 'fast') === profile;
    });
    if (!trades.length) return { expectancy: 0, trades: 0, wr: 0 };
    var wins = trades.filter(function (t) { return t.pnl >= 0; });
    var losses = trades.filter(function (t) { return t.pnl < 0; });
    var wr = wins.length / trades.length;
    var avgWin = wins.length > 0 ? wins.reduce(function (s, t) { return s + t.pnl; }, 0) / wins.length : 0;
    var avgLoss = losses.length > 0 ? losses.reduce(function (s, t) { return s + Math.abs(t.pnl); }, 0) / losses.length : 0;
    return {
        expectancy: (wr * avgWin) - ((1 - wr) * avgLoss),
        trades: trades.length,
        wr: Math.round(wr * 100)
    };
}

// ── Reset PERF (preserves structure) ─────────────────────────
function resetPerfStore() {
    Object.keys(PERF).forEach(function (k) {
        PERF[k].wins = 0; PERF[k].losses = 0; PERF[k].weight = 1.0;
        PERF[k].pnlSum = 0; PERF[k].feeSum = 0;
        PERF[k].winPnl = 0; PERF[k].lossPnl = 0;
    });
    savePerfToStorage();
    if (typeof renderPerfTracker === 'function') renderPerfTracker();
}

// Window exports
window.savePerfToStorage = savePerfToStorage;
window.loadPerfFromStorage = loadPerfFromStorage;
window.recordIndicatorPnl = recordIndicatorPnl;
window.calcExpectancy = calcExpectancy;
window.calcGlobalExpectancy = calcGlobalExpectancy;
window.calcExpectancyByProfile = calcExpectancyByProfile;
window.resetPerfStore = resetPerfStore;
