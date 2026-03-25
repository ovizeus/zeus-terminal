// Zeus v122 — analytics/dailyPnl.js
// Daily PnL aggregation, drawdown tracking, rollup stats
// Pure analytics — no decision logic here.
'use strict';

var _DAILY_PNL_KEY = 'zeus_daily_pnl_v1';
var _DAILY_MAX_DAYS = 90;

// ── Record a single closed trade into DAILY_STATS ────────────
function recordDailyClose(trade) {
    if (!trade || !Number.isFinite(trade.pnl)) return;
    var ds = (typeof DAILY_STATS !== 'undefined') ? DAILY_STATS : null;
    if (!ds) return;

    var dateKey = _todayKey(trade.closedAt || trade.time || Date.now());
    if (!ds.days[dateKey]) {
        ds.days[dateKey] = { trades: 0, wins: 0, losses: 0, grossPnl: 0, fees: 0, netPnl: 0 };
    }
    var day = ds.days[dateKey];
    day.trades += 1;
    if (trade.pnl >= 0) day.wins += 1;
    else day.losses += 1;
    day.grossPnl += trade.pnl;

    // Estimate fees if available
    var fees = 0;
    if (Number.isFinite(trade.fees)) {
        fees = trade.fees;
    } else if (typeof estimateRoundTripFees === 'function' && Number.isFinite(trade.notional)) {
        var feeResult = estimateRoundTripFees(trade.notional, 'taker', trade.profile || 'fast');
        fees = feeResult.total || 0;
    }
    day.fees += fees;
    day.netPnl = day.grossPnl - day.fees;

    // Update cumulative + drawdown
    ds.cumPnl += trade.pnl - fees;
    _updateDrawdown(ds);
    saveDailyPnl();
}

// ── Rebuild DAILY_STATS from journal (on startup) ────────────
// [FIX BUG1+3] Skip full reset if loadDailyPnl() already restored data.
// Only rebuild from journal when days is empty (first run or corrupted storage).
function rebuildDailyFromJournal() {
    var ds = (typeof DAILY_STATS !== 'undefined') ? DAILY_STATS : null;
    if (!ds) return;

    // If loadDailyPnl already populated days, skip destructive reset
    var hasDays = ds.days && Object.keys(ds.days).length > 0;
    if (hasDays) {
        // Just reconcile: add any journal trades not yet in DAILY_STATS
        _reconcileJournalIntoDailyStats(ds);
        return;
    }

    var journal = (typeof TP !== 'undefined' && Array.isArray(TP.journal)) ? TP.journal : [];

    // Full reset + rebuild (only when days is empty)
    ds.days = {};
    ds.peak = 0;
    ds.currentDD = 0;
    ds.maxDD = 0;
    ds.cumPnl = 0;

    // Process closed trades oldest-first
    var closed = journal.filter(function (t) {
        return t.journalEvent === 'CLOSE' && t.exit !== null && Number.isFinite(t.pnl);
    }).reverse(); // journal is newest-first, we reverse for chronological

    closed.forEach(function (trade) {
        _addTradeToDailyStats(ds, trade);
    });

    _pruneOldDays(ds);
    saveDailyPnl();
}

// ── Reconcile: merge journal trades into existing DAILY_STATS ─
function _reconcileJournalIntoDailyStats(ds) {
    var journal = (typeof TP !== 'undefined' && Array.isArray(TP.journal)) ? TP.journal : [];
    var closed = journal.filter(function (t) {
        return t.journalEvent === 'CLOSE' && t.exit !== null && Number.isFinite(t.pnl);
    });
    // Count trades per day from journal
    var journalCounts = {};
    closed.forEach(function (t) {
        var dk = _todayKey(t.closedAt || t.time || Date.now());
        journalCounts[dk] = (journalCounts[dk] || 0) + 1;
    });
    // If journal has more trades for today than DAILY_STATS, add the diff
    var todayKey = _todayKey(Date.now());
    var todayDS = ds.days[todayKey];
    var todayJournal = journalCounts[todayKey] || 0;
    if (todayJournal > 0 && (!todayDS || todayDS.trades < todayJournal)) {
        // Rebuild just today from journal
        ds.days[todayKey] = { trades: 0, wins: 0, losses: 0, grossPnl: 0, fees: 0, netPnl: 0 };
        var todayTrades = closed.filter(function (t) {
            return _todayKey(t.closedAt || t.time || Date.now()) === todayKey;
        }).reverse();
        var prevCum = ds.cumPnl - (todayDS ? todayDS.netPnl : 0);
        ds.cumPnl = prevCum;
        todayTrades.forEach(function (trade) {
            _addTradeToDailyStats(ds, trade);
        });
        _pruneOldDays(ds);
        saveDailyPnl();
    }
}

// ── Shared: add a single trade to ds ─────────────────────────
function _addTradeToDailyStats(ds, trade) {
    var dateKey = _todayKey(trade.closedAt || trade.time || Date.now());
    if (!ds.days[dateKey]) {
        ds.days[dateKey] = { trades: 0, wins: 0, losses: 0, grossPnl: 0, fees: 0, netPnl: 0 };
    }
    var day = ds.days[dateKey];
    day.trades += 1;
    if (trade.pnl >= 0) day.wins += 1;
    else day.losses += 1;
    day.grossPnl += trade.pnl;

    var fees = 0;
    if (Number.isFinite(trade.fees)) {
        fees = trade.fees;
    } else if (typeof estimateRoundTripFees === 'function' && Number.isFinite(trade.notional)) {
        var feeResult = estimateRoundTripFees(trade.notional, 'taker', trade.profile || 'fast');
        fees = feeResult.total || 0;
    }
    day.fees += fees;
    day.netPnl = day.grossPnl - day.fees;

    ds.cumPnl += trade.pnl - fees;
    _updateDrawdown(ds);
}

// ── Drawdown helper ──────────────────────────────────────────
function _updateDrawdown(ds) {
    if (ds.cumPnl > ds.peak) ds.peak = ds.cumPnl;
    ds.currentDD = ds.peak > 0 ? ds.peak - ds.cumPnl : 0;
    if (ds.currentDD > ds.maxDD) ds.maxDD = ds.currentDD;
}

// ── Get stats for a specific day ─────────────────────────────
function getDailyStats(dateStr) {
    if (!DAILY_STATS || !DAILY_STATS.days) return null;
    return DAILY_STATS.days[dateStr] || null;
}

// ── Last N days array (sorted newest-first) ──────────────────
function getLastNDays(n) {
    if (!DAILY_STATS || !DAILY_STATS.days) return [];
    return Object.keys(DAILY_STATS.days)
        .filter(function (key) {
            var d = DAILY_STATS.days[key];
            return d && typeof d === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(key);
        })
        .sort().reverse()
        .slice(0, n || 7)
        .map(function (key) {
            var d = DAILY_STATS.days[key];
            return {
                date: key, trades: d.trades || 0, wins: d.wins || 0, losses: d.losses || 0,
                grossPnl: d.grossPnl || 0, fees: d.fees || 0, netPnl: d.netPnl || 0
            };
        });
}

// ── Weekly rollup (last 4 weeks) ─────────────────────────────
function getWeeklyRollup() {
    return _rollup(28, 7);
}

// ── Monthly rollup (last 3 months) ──────────────────────────
function getMonthlyRollup() {
    return _rollup(90, 30);
}

// ── Generic rollup: last `totalDays` grouped into `periodDays` ─
function _rollup(totalDays, periodDays) {
    if (!DAILY_STATS || !DAILY_STATS.days) return [];
    var now = new Date();
    var buckets = [];
    for (var i = 0; i < Math.ceil(totalDays / periodDays); i++) {
        buckets.push({ start: '', end: '', trades: 0, wins: 0, losses: 0, grossPnl: 0, fees: 0, netPnl: 0 });
    }
    var allDays = Object.keys(DAILY_STATS.days).sort().reverse();
    allDays.forEach(function (dayKey) {
        var d = DAILY_STATS.days[dayKey];
        if (!d || typeof d !== 'object') return;
        var dt = new Date(dayKey + 'T00:00:00');
        if (isNaN(dt.getTime())) return; // skip invalid date keys
        var daysAgo = Math.floor((now - dt) / 86400000);
        if (daysAgo < 0 || daysAgo >= totalDays || !Number.isFinite(daysAgo)) return;
        var idx = Math.floor(daysAgo / periodDays);
        if (idx < 0 || idx >= buckets.length) return;
        var b = buckets[idx];
        b.trades += (d.trades || 0); b.wins += (d.wins || 0); b.losses += (d.losses || 0);
        b.grossPnl += (d.grossPnl || 0); b.fees += (d.fees || 0); b.netPnl += (d.netPnl || 0);
        if (!b.end || dayKey > b.end) b.end = dayKey;
        if (!b.start || dayKey < b.start) b.start = dayKey;
    });
    return buckets.filter(function (b) { return b.trades > 0; });
}

// ── Drawdown stats ───────────────────────────────────────────
function getDrawdownStats() {
    if (!DAILY_STATS) return { peak: 0, currentDD: 0, maxDD: 0, cumPnl: 0, recoveryFactor: 0 };
    var rf = DAILY_STATS.maxDD > 0 ? DAILY_STATS.cumPnl / DAILY_STATS.maxDD : 0;
    return {
        peak: DAILY_STATS.peak || 0,
        currentDD: DAILY_STATS.currentDD || 0,
        maxDD: DAILY_STATS.maxDD || 0,
        cumPnl: DAILY_STATS.cumPnl || 0,
        recoveryFactor: Math.round(rf * 100) / 100
    };
}

// ── Save/Load ────────────────────────────────────────────────
function saveDailyPnl() {
    try {
        if (!DAILY_STATS) return;
        var payload = {
            days: DAILY_STATS.days,
            peak: DAILY_STATS.peak,
            currentDD: DAILY_STATS.currentDD,
            maxDD: DAILY_STATS.maxDD,
            cumPnl: DAILY_STATS.cumPnl
        };
        if (typeof _safeLocalStorageSet === 'function') {
            _safeLocalStorageSet(_DAILY_PNL_KEY, payload);
        }
        if (typeof _ucMarkDirty === 'function') _ucMarkDirty('dailyPnl');
        if (typeof _userCtxPush === 'function') _userCtxPush();
    } catch (e) {
        console.warn('[dailyPnl] save failed:', e.message);
    }
}

function loadDailyPnl() {
    try {
        var raw = localStorage.getItem(_DAILY_PNL_KEY);
        if (!raw) return;
        var data = JSON.parse(raw);
        if (!data || typeof data !== 'object') return;
        if (data.days && typeof data.days === 'object') {
            // Sanitize: remove null/invalid day entries and bad date keys
            var clean = {};
            Object.keys(data.days).forEach(function (k) {
                var d = data.days[k];
                if (d && typeof d === 'object' && Number.isFinite(d.trades) && /^\d{4}-\d{2}-\d{2}$/.test(k)) {
                    clean[k] = d;
                }
            });
            DAILY_STATS.days = clean;
        }
        if (Number.isFinite(data.peak)) DAILY_STATS.peak = data.peak;
        if (Number.isFinite(data.currentDD)) DAILY_STATS.currentDD = data.currentDD;
        if (Number.isFinite(data.maxDD)) DAILY_STATS.maxDD = data.maxDD;
        if (Number.isFinite(data.cumPnl)) DAILY_STATS.cumPnl = data.cumPnl;
        _pruneOldDays(DAILY_STATS);
    } catch (e) {
        console.warn('[dailyPnl] load failed:', e.message);
    }
}

// ── Date helpers ─────────────────────────────────────────────
function _todayKey(tsOrDate) {
    var d = tsOrDate instanceof Date ? tsOrDate : new Date(tsOrDate || Date.now());
    if (isNaN(d.getTime())) d = new Date();
    return new Intl.DateTimeFormat('en-CA', { timeZone: (typeof S !== 'undefined' && S.tz) || 'Europe/Bucharest' }).format(d);
}

function _pruneOldDays(ds) {
    var keys = Object.keys(ds.days).sort();
    while (keys.length > _DAILY_MAX_DAYS) {
        delete ds.days[keys.shift()];
    }
}

// ── Reset ────────────────────────────────────────────────────
function resetDailyPnl() {
    if (!DAILY_STATS) return;
    DAILY_STATS.days = {};
    DAILY_STATS.peak = 0;
    DAILY_STATS.currentDD = 0;
    DAILY_STATS.maxDD = 0;
    DAILY_STATS.cumPnl = 0;
    saveDailyPnl();
}

// Window exports
window.recordDailyClose = recordDailyClose;
window.rebuildDailyFromJournal = rebuildDailyFromJournal;
window.getDailyStats = getDailyStats;
window.getLastNDays = getLastNDays;
window.getWeeklyRollup = getWeeklyRollup;
window.getMonthlyRollup = getMonthlyRollup;
window.getDrawdownStats = getDrawdownStats;
window.saveDailyPnl = saveDailyPnl;
window.loadDailyPnl = loadDailyPnl;
window.resetDailyPnl = resetDailyPnl;
