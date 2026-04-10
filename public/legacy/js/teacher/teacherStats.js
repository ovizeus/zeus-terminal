// Zeus v122 — teacher/teacherStats.js
// THE TEACHER — Aggregated statistics across sessions
// Computes cross-session performance, per-timeframe/regime/pattern breakdown,
// rolling windows, best/worst trades, session-over-session comparison
// Reads/writes ONLY window.TEACHER — fully sandboxed
'use strict';

// ══════════════════════════════════════════════════════════════════
// CORE SESSION STATS — Compute full stats from a single session
// ══════════════════════════════════════════════════════════════════

/**
 * Compute comprehensive stats from a list of closed trades.
 * @param {Array} trades — closed trades with pnlNet, pnlPct, outcome, etc.
 * @returns {Object} stats snapshot
 */
function teacherComputeStats(trades) {
  if (!trades || trades.length === 0) return _teacherEmptyStats();

  var wins = 0, losses = 0, breakevens = 0;
  var totalPnl = 0, totalPnlPct = 0;
  var grossWins = 0, grossLosses = 0;
  var bestPnl = -Infinity, worstPnl = Infinity;
  var bestTrade = null, worstTrade = null;
  var totalBars = 0;
  var totalFees = 0;
  var longWins = 0, longLosses = 0, shortWins = 0, shortLosses = 0;

  for (var i = 0; i < trades.length; i++) {
    var t = trades[i];
    totalPnl += t.pnlNet;
    totalPnlPct += t.pnlPct;
    totalBars += t.barsHeld || 0;
    totalFees += t.totalFees || 0;

    if (t.outcome === 'WIN') {
      wins++;
      grossWins += t.pnlNet;
      if (t.side === 'LONG') longWins++; else shortWins++;
    } else if (t.outcome === 'LOSS') {
      losses++;
      grossLosses += Math.abs(t.pnlNet);
      if (t.side === 'LONG') longLosses++; else shortLosses++;
    } else {
      breakevens++;
    }

    if (t.pnlNet > bestPnl) { bestPnl = t.pnlNet; bestTrade = t.id; }
    if (t.pnlNet < worstPnl) { worstPnl = t.pnlNet; worstTrade = t.id; }
  }

  var total = trades.length;
  var winRate = total > 0 ? (wins / total) * 100 : 0;
  var avgPnl = total > 0 ? totalPnl / total : 0;
  var avgBars = total > 0 ? totalBars / total : 0;
  var profitFactor = grossLosses > 0 ? grossWins / grossLosses : (grossWins > 0 ? Infinity : 0);
  var expectancy = total > 0 ? totalPnl / total : 0;

  // Avg win / avg loss
  var avgWin = wins > 0 ? grossWins / wins : 0;
  var avgLoss = losses > 0 ? grossLosses / losses : 0;
  var wlRatio = avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? Infinity : 0);

  return {
    totalTrades:   total,
    wins:          wins,
    losses:        losses,
    breakevens:    breakevens,
    winRate:       _r2(winRate),
    totalPnl:      _r2(totalPnl),
    totalPnlPct:   _r2(totalPnlPct),
    avgPnl:        _r2(avgPnl),
    avgPnlPct:     _r2(total > 0 ? totalPnlPct / total : 0),
    grossWins:     _r2(grossWins),
    grossLosses:   _r2(grossLosses),
    profitFactor:  _r2(profitFactor),
    expectancy:    _r2(expectancy),
    avgWin:        _r2(avgWin),
    avgLoss:       _r2(avgLoss),
    wlRatio:       _r2(wlRatio),
    avgBarsHeld:   _r2(avgBars),
    totalFees:     _r2(totalFees),
    bestTrade:     { id: bestTrade, pnl: _r2(bestPnl) },
    worstTrade:    { id: worstTrade, pnl: _r2(worstPnl) },
    longWinRate:   _r2((longWins + longLosses) > 0 ? (longWins / (longWins + longLosses)) * 100 : 0),
    shortWinRate:  _r2((shortWins + shortLosses) > 0 ? (shortWins / (shortWins + shortLosses)) * 100 : 0),
  };
}

function _teacherEmptyStats() {
  return {
    totalTrades: 0, wins: 0, losses: 0, breakevens: 0, winRate: 0,
    totalPnl: 0, totalPnlPct: 0, avgPnl: 0, avgPnlPct: 0,
    grossWins: 0, grossLosses: 0, profitFactor: 0, expectancy: 0,
    avgWin: 0, avgLoss: 0, wlRatio: 0, avgBarsHeld: 0, totalFees: 0,
    bestTrade: { id: null, pnl: 0 }, worstTrade: { id: null, pnl: 0 },
    longWinRate: 0, shortWinRate: 0,
  };
}

function _r2(n) {
  if (!isFinite(n)) return n === Infinity ? 999 : (n === -Infinity ? -999 : 0);
  return parseFloat(n.toFixed(2));
}

// ══════════════════════════════════════════════════════════════════
// GROUPED STATS — Per regime, pattern, exit reason, side, timeframe
// ══════════════════════════════════════════════════════════════════

/**
 * Group trades by a key extractor and compute stats per group.
 * @param {Array} trades
 * @param {Function} keyFn — trade → string key
 * @returns {Object} { groupName: stats }
 */
function teacherGroupStats(trades, keyFn) {
  if (!trades || !keyFn) return {};

  var groups = {};
  for (var i = 0; i < trades.length; i++) {
    var key = keyFn(trades[i]);
    if (!key) key = 'UNKNOWN';
    if (!groups[key]) groups[key] = [];
    groups[key].push(trades[i]);
  }

  var result = {};
  var keys = Object.keys(groups);
  for (var i = 0; i < keys.length; i++) {
    result[keys[i]] = teacherComputeStats(groups[keys[i]]);
  }
  return result;
}

/**
 * Stats grouped by side (LONG / SHORT).
 */
function teacherStatsBySide(trades) {
  return teacherGroupStats(trades, function (t) { return t.side; });
}

/**
 * Stats grouped by exit reason.
 */
function teacherStatsByExitReason(trades) {
  return teacherGroupStats(trades, function (t) { return t.exitReason; });
}

/**
 * Stats grouped by primary detected regime at entry.
 */
function teacherStatsByRegime(trades) {
  return teacherGroupStats(trades, function (t) {
    var reasons = t.entryReasons || [];
    for (var i = 0; i < reasons.length; i++) {
      if (reasons[i] === 'REGIME_TREND') return 'TREND';
      if (reasons[i] === 'REGIME_BREAKOUT') return 'BREAKOUT';
      if (reasons[i] === 'REGIME_RANGE') return 'RANGE';
    }
    return 'UNKNOWN';
  });
}

/**
 * Stats grouped by primary classified pattern.
 */
function teacherStatsByPattern(trades) {
  return teacherGroupStats(trades, function (t) {
    var pats = teacherClassifyPattern(t);
    return pats.length > 0 ? pats[0].name : 'UNCLASSIFIED';
  });
}

// ══════════════════════════════════════════════════════════════════
// ROLLING WINDOW STATS — Last N trades
// ══════════════════════════════════════════════════════════════════

/**
 * Stats for the last N trades.
 * @param {Array} trades
 * @param {number} n — window size (default 20)
 */
function teacherRollingStats(trades, n) {
  if (!trades || trades.length === 0) return _teacherEmptyStats();
  n = n || 20;
  var window = trades.slice(-n);
  return teacherComputeStats(window);
}

// ══════════════════════════════════════════════════════════════════
// SESSION COMPARISON — Compare last session to overall average
// ══════════════════════════════════════════════════════════════════

/**
 * Compare a session's stats to overall aggregated stats.
 * @param {Object} sessionStats — current session stats
 * @param {Object} overallStats — aggregated all-time stats
 * @returns {{ improvements:[], regressions:[], neutral:[] }}
 */
function teacherCompareSessionStats(sessionStats, overallStats) {
  if (!sessionStats || !overallStats) return { improvements: [], regressions: [], neutral: [] };

  var imp = [], reg = [], neu = [];
  var fields = [
    { key: 'winRate', label: 'Win Rate', higher: true },
    { key: 'profitFactor', label: 'Profit Factor', higher: true },
    { key: 'avgPnl', label: 'Avg PnL', higher: true },
    { key: 'avgBarsHeld', label: 'Avg Hold Time', higher: false },
    { key: 'wlRatio', label: 'Win/Loss Ratio', higher: true },
    { key: 'expectancy', label: 'Expectancy', higher: true },
  ];

  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var sv = sessionStats[f.key] || 0;
    var ov = overallStats[f.key] || 0;
    var diff = sv - ov;
    var diffPct = ov !== 0 ? (diff / Math.abs(ov)) * 100 : (diff > 0 ? 100 : (diff < 0 ? -100 : 0));

    var item = { key: f.key, label: f.label, session: sv, overall: ov, diff: _r2(diff), diffPct: _r2(diffPct) };

    if (Math.abs(diffPct) < 5) {
      neu.push(item);
    } else if ((f.higher && diff > 0) || (!f.higher && diff < 0)) {
      imp.push(item);
    } else {
      reg.push(item);
    }
  }

  return { improvements: imp, regressions: reg, neutral: neu };
}

// ══════════════════════════════════════════════════════════════════
// AGGREGATE STATS — Merge multiple sessions into all-time stats
// ══════════════════════════════════════════════════════════════════

/**
 * Aggregate stats from multiple session summaries.
 * @param {Array} sessions — saved sessions from storage (each has .trades or .stats)
 * @returns {Object} aggregated stats
 */
function teacherAggregateStats(sessions) {
  if (!sessions || sessions.length === 0) return _teacherEmptyStats();

  // Collect all trades across sessions
  var allTrades = [];
  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    if (s.trades && Array.isArray(s.trades)) {
      for (var j = 0; j < s.trades.length; j++) {
        allTrades.push(s.trades[j]);
      }
    }
  }

  var stats = teacherComputeStats(allTrades);
  stats.sessionCount = sessions.length;
  stats.tradeCount = allTrades.length;
  return stats;
}

// ══════════════════════════════════════════════════════════════════
// PNL DISTRIBUTION — Histogram buckets for PnL
// ══════════════════════════════════════════════════════════════════

/**
 * Build PnL distribution histogram.
 * @param {Array} trades
 * @param {number} [bucketSize=5] — bucket width in $
 * @returns {Array} [{from, to, count}]
 */
function teacherPnlDistribution(trades, bucketSize) {
  if (!trades || trades.length === 0) return [];
  bucketSize = bucketSize || 5;

  var buckets = {};
  for (var i = 0; i < trades.length; i++) {
    var pnl = trades[i].pnlNet;
    var key = Math.floor(pnl / bucketSize) * bucketSize;
    if (!buckets[key]) buckets[key] = 0;
    buckets[key]++;
  }

  var result = [];
  var keys = Object.keys(buckets).map(Number).sort(function (a, b) { return a - b; });
  for (var i = 0; i < keys.length; i++) {
    result.push({ from: keys[i], to: keys[i] + bucketSize, count: buckets[keys[i]] });
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════
// HOURLY PERFORMANCE — Win rate by hour-of-day
// ══════════════════════════════════════════════════════════════════

/**
 * Break down trade performance by entry hour.
 * @param {Array} trades
 * @returns {Array} 24 entries [{hour, trades, wins, losses, winRate}]
 */
function teacherHourlyPerformance(trades) {
  var hours = [];
  for (var h = 0; h < 24; h++) {
    hours.push({ hour: h, trades: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0 });
  }

  if (!trades) return hours;

  for (var i = 0; i < trades.length; i++) {
    var ts = trades[i].entryTs;
    if (!ts) continue;
    // entryTs is seconds (or ms) — detect
    var d = new Date(ts > 1e12 ? ts : ts * 1000);
    var h = d.getUTCHours();
    hours[h].trades++;
    hours[h].totalPnl += trades[i].pnlNet || 0;
    if (trades[i].outcome === 'WIN') hours[h].wins++;
    else if (trades[i].outcome === 'LOSS') hours[h].losses++;
  }

  for (var h = 0; h < 24; h++) {
    hours[h].totalPnl = _r2(hours[h].totalPnl);
    hours[h].winRate = hours[h].trades > 0 ? _r2((hours[h].wins / hours[h].trades) * 100) : 0;
  }
  return hours;
}

// ══════════════════════════════════════════════════════════════════
// TOP / BOTTOM TRADES — Select best and worst N trades
// ══════════════════════════════════════════════════════════════════

function teacherTopTrades(trades, n) {
  if (!trades || trades.length === 0) return [];
  n = n || 5;
  var sorted = trades.slice().sort(function (a, b) { return b.pnlNet - a.pnlNet; });
  return sorted.slice(0, n);
}

function teacherBottomTrades(trades, n) {
  if (!trades || trades.length === 0) return [];
  n = n || 5;
  var sorted = trades.slice().sort(function (a, b) { return a.pnlNet - b.pnlNet; });
  return sorted.slice(0, n);
}
