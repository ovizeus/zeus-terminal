// Zeus v122 — teacher/teacherSimulator.js
// THE TEACHER — Enhanced trade lifecycle: equity curve, drawdown, signal exits,
// time stops, position sizing, missed-trade detection, multi-trade analytics
// Reads/writes ONLY window.TEACHER — fully sandboxed
'use strict';

// ══════════════════════════════════════════════════════════════════
// EQUITY CURVE — Track capital progression bar-by-bar
// ══════════════════════════════════════════════════════════════════

function teacherInitEquity() {
  var T = window.TEACHER;
  if (!T) return;
  T._equity = {
    startCapital: T.config.capitalUSD,
    capital:      T.config.capitalUSD,
    curve:        [{ bar: T.cursor, capital: T.config.capitalUSD, pnl: 0 }],
    peak:         T.config.capitalUSD,
    maxDrawdown:  0,          // max DD in $
    maxDrawdownPct: 0,        // max DD in %
    currentDD:    0,
    currentDDPct: 0,
    tradeEquity:  [],         // equity snapshot per closed trade
  };
}

function _teacherUpdateEquity(closedTrade) {
  var T = window.TEACHER;
  if (!T || !T._equity) return;

  var eq = T._equity;
  eq.capital += closedTrade.pnlNet;

  // Push to curve
  eq.curve.push({
    bar:     closedTrade.exitBar,
    capital: parseFloat(eq.capital.toFixed(2)),
    pnl:     closedTrade.pnlNet,
    tradeId: closedTrade.id,
  });

  // Trade equity snapshot
  eq.tradeEquity.push({
    tradeNum: T.trades.length,
    capital:  parseFloat(eq.capital.toFixed(2)),
    pnlNet:   closedTrade.pnlNet,
    outcome:  closedTrade.outcome,
  });

  // Update peak and drawdown
  if (eq.capital > eq.peak) {
    eq.peak = eq.capital;
  }
  eq.currentDD = eq.peak - eq.capital;
  eq.currentDDPct = eq.peak > 0 ? (eq.currentDD / eq.peak) * 100 : 0;

  if (eq.currentDD > eq.maxDrawdown) {
    eq.maxDrawdown = parseFloat(eq.currentDD.toFixed(2));
    eq.maxDrawdownPct = parseFloat(eq.currentDDPct.toFixed(2));
  }
}

function teacherGetEquity() {
  var T = window.TEACHER;
  if (!T || !T._equity) return null;
  var eq = T._equity;
  return {
    startCapital:   eq.startCapital,
    currentCapital: parseFloat(eq.capital.toFixed(2)),
    returnPct:      parseFloat(((eq.capital - eq.startCapital) / eq.startCapital * 100).toFixed(2)),
    peak:           parseFloat(eq.peak.toFixed(2)),
    maxDrawdown:    eq.maxDrawdown,
    maxDrawdownPct: eq.maxDrawdownPct,
    currentDD:      parseFloat(eq.currentDD.toFixed(2)),
    currentDDPct:   parseFloat(eq.currentDDPct.toFixed(2)),
    curveLength:    eq.curve.length,
    tradeEquity:    eq.tradeEquity,
  };
}

// ══════════════════════════════════════════════════════════════════
// SIGNAL-BASED EXIT — Auto-exit when indicators flip against trade
// ══════════════════════════════════════════════════════════════════

/**
 * Check if current indicators suggest exiting the open trade.
 * Returns exit reason string or null if no signal exit.
 */
function teacherCheckSignalExit() {
  var T = window.TEACHER;
  if (!T || !T.openTrade) return null;

  var trade = T.openTrade;
  var ind = T.indicators;
  if (!ind) return null;

  var isLong = trade.side === 'LONG';

  // MACD flip: entered on bull, now bear (or vice versa)
  if (ind.macdDir) {
    if (isLong && ind.macdDir === 'bear') return 'SIGNAL_FLIP';
    if (!isLong && ind.macdDir === 'bull') return 'SIGNAL_FLIP';
  }

  // SuperTrend flip
  if (ind.stDir && ind.stDir !== 'neut') {
    if (isLong && ind.stDir === 'bear') return 'SIGNAL_FLIP';
    if (!isLong && ind.stDir === 'bull') return 'SIGNAL_FLIP';
  }

  // Confluence collapse: was strong (>65 long / <35 short), now reversed
  if (ind.confluence !== null && ind.confluence !== undefined) {
    if (isLong && ind.confluence <= 30) return 'CONFLUENCE_DROP';
    if (!isLong && ind.confluence >= 70) return 'CONFLUENCE_DROP';
  }

  // Regime change from trend/breakout to range/volatile
  if (ind.regime) {
    var entryHadTrend = false;
    for (var i = 0; i < trade.entryReasons.length; i++) {
      if (trade.entryReasons[i] === 'REGIME_TREND' || trade.entryReasons[i] === 'REGIME_BREAKOUT') {
        entryHadTrend = true;
        break;
      }
    }
    if (entryHadTrend && (ind.regime === 'RANGE' || ind.regime === 'VOLATILE')) {
      return 'REGIME_CHANGE';
    }
  }

  return null;
}

// ══════════════════════════════════════════════════════════════════
// TIME STOP — Exit after max bars held
// ══════════════════════════════════════════════════════════════════

var TEACHER_MAX_BARS_IN_TRADE = 100; // configurable via teacherSetMaxBars

function teacherSetMaxBarsInTrade(n) {
  TEACHER_MAX_BARS_IN_TRADE = Math.max(5, Math.min(500, n || 100));
}

function teacherCheckTimeStop() {
  var T = window.TEACHER;
  if (!T || !T.openTrade) return null;

  var barsHeld = T.cursor - T.openTrade.entryBar;
  if (barsHeld >= TEACHER_MAX_BARS_IN_TRADE) {
    return 'TIME_STOP';
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════
// ENHANCED STEP — Wraps teacherStep with signal/time exits + equity
// ══════════════════════════════════════════════════════════════════

/**
 * Enhanced step: runs teacherStep + checks signal exits + time stop.
 * @param {Object} [opts]
 * @param {boolean} [opts.signalExits=true] — enable signal-based exits
 * @param {boolean} [opts.timeStop=true] — enable time stop
 * @returns {Object|null} tick data (same as teacherStep)
 */
function teacherEnhancedStep(opts) {
  opts = opts || {};
  var signalExits = opts.signalExits !== false;
  var timeStop = opts.timeStop !== false;

  var tick = teacherStep(1);
  if (!tick) return null;

  var T = window.TEACHER;

  // If trade was closed by SL/TP/DSL in teacherStep, update equity
  if (tick.openTrade === null && T.trades.length > 0) {
    var lastClosed = T.trades[T.trades.length - 1];
    if (lastClosed && lastClosed.exitBar === T.cursor) {
      _teacherUpdateEquity(lastClosed);
    }
  }

  // If still in trade, check additional exit conditions
  if (T.openTrade) {
    var exitReason = null;

    // Signal exit
    if (signalExits && !exitReason) {
      exitReason = teacherCheckSignalExit();
    }

    // Time stop
    if (timeStop && !exitReason) {
      exitReason = teacherCheckTimeStop();
    }

    // Execute exit if triggered
    if (exitReason) {
      var bar = T.dataset.bars[T.cursor];
      var closed = _teacherCloseTrade(bar.close, exitReason, { bar: bar, barIndex: T.cursor });
      if (closed) {
        _teacherUpdateEquity(closed);
        tick.closedTrade = closed;
        tick.openTrade = null;
      }
    }
  }

  return tick;
}

// ══════════════════════════════════════════════════════════════════
// POSITION SIZING MODELS
// ══════════════════════════════════════════════════════════════════

/**
 * Fixed fraction: risk N% of capital per trade.
 * @param {number} capitalUSD
 * @param {number} riskPct — risk per trade (e.g. 1.0 = 1%)
 * @param {number} slDistancePct — distance to SL in %
 * @param {number} entryPrice
 * @param {number} maxLeverage
 * @returns {{ leverage, qty, notional, riskUSD }}
 */
function teacherSizeFixedFraction(capitalUSD, riskPct, slDistancePct, entryPrice, maxLeverage) {
  if (!capitalUSD || !slDistancePct || !entryPrice) return null;
  maxLeverage = maxLeverage || TEACHER_TRADE_DEFAULTS.maxLeverage;
  var riskUSD = capitalUSD * (riskPct / 100);
  // qty = riskUSD / (entry * slDist%)
  var qty = riskUSD / (entryPrice * slDistancePct / 100);
  var notional = qty * entryPrice;
  var leverage = Math.min(maxLeverage, Math.max(1, Math.round(notional / capitalUSD)));
  // Clamp notional after leverage cap
  notional = capitalUSD * leverage;
  qty = notional / entryPrice;
  return {
    leverage: leverage,
    qty:      parseFloat(qty.toFixed(6)),
    notional: parseFloat(notional.toFixed(2)),
    riskUSD:  parseFloat(riskUSD.toFixed(2)),
  };
}

/**
 * Kelly fraction sizing (simplified).
 * @param {number} winRate — 0-1
 * @param {number} avgWinLossRatio — avg win / avg loss
 * @param {number} capitalUSD
 * @param {number} entryPrice
 * @param {number} maxLeverage
 * @returns {{ kellyPct, leverage, qty, notional }}
 */
function teacherSizeKelly(winRate, avgWinLossRatio, capitalUSD, entryPrice, maxLeverage) {
  if (!winRate || !avgWinLossRatio || !capitalUSD || !entryPrice) return null;
  maxLeverage = maxLeverage || TEACHER_TRADE_DEFAULTS.maxLeverage;
  // Kelly: f* = (p*b - q) / b, where p=winRate, q=1-p, b=avg win/loss ratio
  var kellyFull = (winRate * avgWinLossRatio - (1 - winRate)) / avgWinLossRatio;
  // Half-Kelly for safety
  var kellyPct = Math.max(0, Math.min(25, kellyFull * 50));
  var notional = capitalUSD * (kellyPct / 100) * 10; // scale
  var leverage = Math.min(maxLeverage, Math.max(1, Math.round(notional / capitalUSD)));
  notional = capitalUSD * leverage;
  var qty = notional / entryPrice;
  return {
    kellyPct:  parseFloat(kellyPct.toFixed(2)),
    leverage:  leverage,
    qty:       parseFloat(qty.toFixed(6)),
    notional:  parseFloat(notional.toFixed(2)),
  };
}

// ══════════════════════════════════════════════════════════════════
// MISSED TRADE DETECTION — Identify bars that had strong signals
// but user didn't enter. Runs post-session for learning.
// ══════════════════════════════════════════════════════════════════

/**
 * Scan all bars and find strong entry signals that were not traded.
 * @param {Object} dataset
 * @param {Array} trades — completed trades (to exclude traded bars)
 * @param {Object} [opts]
 * @param {number} [opts.minConfluence=65] — min confluence for "strong" signal
 * @param {number} [opts.minADX=25] — min ADX for trend confirmation
 * @returns {Array} missed opportunities [{barIndex, bar, side, reasons, confluence, indicators}]
 */
function teacherFindMissedTrades(dataset, trades, opts) {
  if (!dataset || !dataset.bars) return [];
  opts = opts || {};
  var minConf = opts.minConfluence || 65;
  var minADX = opts.minADX || 25;
  var minBars = TEACHER_REPLAY_DEFAULTS.lookback;

  // Build set of traded bar ranges (entry..exit) to exclude
  var tradedBars = {};
  for (var t = 0; t < trades.length; t++) {
    for (var b = trades[t].entryBar; b <= trades[t].exitBar; b++) {
      tradedBars[b] = true;
    }
  }

  var missed = [];
  // Start from lookback (need enough bars for indicators)
  for (var i = minBars; i < dataset.bars.length; i++) {
    if (tradedBars[i]) continue;

    // Compute indicators for bars up to i
    var visibleBars = dataset.bars.slice(0, i + 1);
    var ind = teacherComputeIndicators(visibleBars);

    // Check for strong long signal
    if (ind.confluence >= minConf && ind.stDir === 'bull' && ind.macdDir === 'bull') {
      if (ind.adx !== null && ind.adx >= minADX) {
        missed.push({
          barIndex:   i,
          bar:        dataset.bars[i],
          side:       'LONG',
          reasons:    _teacherAutoTagEntry('LONG', ind),
          confluence: ind.confluence,
          indicators: ind,
        });
        // Skip ahead to avoid clustering
        i += 5;
        continue;
      }
    }

    // Check for strong short signal
    if (ind.confluence <= (100 - minConf) && ind.stDir === 'bear' && ind.macdDir === 'bear') {
      if (ind.adx !== null && ind.adx >= minADX) {
        missed.push({
          barIndex:   i,
          bar:        dataset.bars[i],
          side:       'SHORT',
          reasons:    _teacherAutoTagEntry('SHORT', ind),
          confluence: ind.confluence,
          indicators: ind,
        });
        i += 5;
        continue;
      }
    }
  }

  return missed;
}

// ══════════════════════════════════════════════════════════════════
// TRADE QUALITY SCORE — Rate each trade's quality (0-100)
// ══════════════════════════════════════════════════════════════════

/**
 * Score a completed trade's quality based on entry, execution, and outcome.
 * @param {Object} trade — closed trade from TEACHER.trades
 * @returns {{ score, components:{}, grade }}
 */
function teacherScoreTrade(trade) {
  if (!trade) return { score: 0, components: {}, grade: 'F' };

  var components = {};
  var total = 0, count = 0;

  // 1. Entry alignment: how many entry reasons?
  var entryScore = Math.min(100, (trade.entryReasons ? trade.entryReasons.length : 0) * 20);
  components.entryAlignment = entryScore;
  total += entryScore; count++;

  // 2. Risk-reward achieved
  var rrAchieved = 0;
  if (trade.outcome === 'WIN' && trade.pnlNet > 0) {
    // Approximate: did we get at least 2:1 R:R?
    var entryFeeEst = trade.totalFees / 2;
    var potentialLoss = Math.abs(trade.entry - trade.sl) * trade.qty;
    if (potentialLoss > 0) {
      rrAchieved = trade.pnlRaw / potentialLoss;
    }
  }
  var rrScore = Math.min(100, Math.round(rrAchieved * 40));
  components.riskReward = rrScore;
  total += rrScore; count++;

  // 3. Exit quality: TP_HIT best, DSL_HIT good, MANUAL ok, SL_HIT worst
  var exitScore = 0;
  if (trade.exitReason === 'TP_HIT') exitScore = 100;
  else if (trade.exitReason === 'DSL_HIT') exitScore = 80;
  else if (trade.exitReason === 'SIGNAL_FLIP') exitScore = 70;
  else if (trade.exitReason === 'MANUAL_EXIT') exitScore = 50;
  else if (trade.exitReason === 'REGIME_CHANGE') exitScore = 60;
  else if (trade.exitReason === 'TIME_STOP') exitScore = 30;
  else if (trade.exitReason === 'SL_HIT') exitScore = 20;
  else if (trade.exitReason === 'MAX_BARS_EXIT') exitScore = 10;
  components.exitQuality = exitScore;
  total += exitScore; count++;

  // 4. PnL efficiency: pnlPct relative to risk
  var effScore = 0;
  if (trade.pnlPct > 5) effScore = 100;
  else if (trade.pnlPct > 2) effScore = 80;
  else if (trade.pnlPct > 0) effScore = 60;
  else if (trade.pnlPct > -1) effScore = 40;
  else effScore = 10;
  components.pnlEfficiency = effScore;
  total += effScore; count++;

  // 5. Bars held: not too long, not too short (sweet spot 5-30)
  var barsScore = 0;
  var bh = trade.barsHeld || 0;
  if (bh >= 5 && bh <= 30) barsScore = 100;
  else if (bh >= 3 && bh <= 50) barsScore = 70;
  else if (bh >= 1 && bh <= 80) barsScore = 40;
  else barsScore = 10;
  components.holdDuration = barsScore;
  total += barsScore; count++;

  var finalScore = count > 0 ? Math.round(total / count) : 0;
  var grade = finalScore >= 80 ? 'A' : finalScore >= 65 ? 'B' : finalScore >= 50 ? 'C' : finalScore >= 35 ? 'D' : 'F';

  return { score: finalScore, components: components, grade: grade };
}

// ══════════════════════════════════════════════════════════════════
// STREAK TRACKER — Win/loss streaks
// ══════════════════════════════════════════════════════════════════

function teacherCalcStreaks(trades) {
  if (!trades || !trades.length) return { currentStreak: 0, currentType: null, maxWinStreak: 0, maxLossStreak: 0 };

  var curType = null, curLen = 0, maxWin = 0, maxLoss = 0;

  for (var i = 0; i < trades.length; i++) {
    var t = trades[i];
    if (t.outcome === 'WIN') {
      if (curType === 'WIN') curLen++;
      else { curType = 'WIN'; curLen = 1; }
      if (curLen > maxWin) maxWin = curLen;
    } else if (t.outcome === 'LOSS') {
      if (curType === 'LOSS') curLen++;
      else { curType = 'LOSS'; curLen = 1; }
      if (curLen > maxLoss) maxLoss = curLen;
    } else {
      curType = null; curLen = 0;
    }
  }

  return { currentStreak: curLen, currentType: curType, maxWinStreak: maxWin, maxLossStreak: maxLoss };
}

// ══════════════════════════════════════════════════════════════════
// R-MULTIPLE — Compute R-multiple for each trade
// R = risk unit = distance to SL * qty
// ══════════════════════════════════════════════════════════════════

function teacherCalcRMultiple(trade) {
  if (!trade || !trade.entry || !trade.sl) return null;
  var riskPerUnit = Math.abs(trade.entry - trade.sl);
  if (riskPerUnit === 0) return null;
  var rDollar = riskPerUnit * trade.qty;
  var rMultiple = rDollar > 0 ? trade.pnlRaw / rDollar : 0;
  return {
    rDollar:   parseFloat(rDollar.toFixed(2)),
    rMultiple: parseFloat(rMultiple.toFixed(2)),
    pnlInR:    parseFloat(rMultiple.toFixed(2)),
  };
}

// ══════════════════════════════════════════════════════════════════
// FULL SESSION ANALYTICS — Extends _teacherBuildSessionSummary
// ══════════════════════════════════════════════════════════════════

function teacherFullSessionAnalytics() {
  var T = window.TEACHER;
  if (!T) return null;

  var trades = T.trades;
  var equity = teacherGetEquity();
  var streaks = teacherCalcStreaks(trades);

  // Per-trade scores and R-multiples
  var scores = [];
  var rMultiples = [];
  var totalR = 0;
  for (var i = 0; i < trades.length; i++) {
    var sc = teacherScoreTrade(trades[i]);
    scores.push({ tradeId: trades[i].id, score: sc.score, grade: sc.grade });
    trades[i]._quality = sc; // attach to trade

    var rm = teacherCalcRMultiple(trades[i]);
    if (rm) {
      rMultiples.push(rm.rMultiple);
      totalR += rm.rMultiple;
      trades[i]._rMultiple = rm;
    }
  }

  // Exit reason breakdown
  var exitBreakdown = {};
  for (var i = 0; i < trades.length; i++) {
    var reason = trades[i].exitReason || 'UNKNOWN';
    if (!exitBreakdown[reason]) exitBreakdown[reason] = { count: 0, totalPnl: 0 };
    exitBreakdown[reason].count++;
    exitBreakdown[reason].totalPnl += trades[i].pnlNet;
  }
  // Round pnl
  var ebKeys = Object.keys(exitBreakdown);
  for (var i = 0; i < ebKeys.length; i++) {
    exitBreakdown[ebKeys[i]].totalPnl = parseFloat(exitBreakdown[ebKeys[i]].totalPnl.toFixed(2));
  }

  // Entry reason frequency
  var entryReasonFreq = {};
  for (var i = 0; i < trades.length; i++) {
    var reasons = trades[i].entryReasons || [];
    for (var j = 0; j < reasons.length; j++) {
      if (!entryReasonFreq[reasons[j]]) entryReasonFreq[reasons[j]] = { count: 0, wins: 0, losses: 0 };
      entryReasonFreq[reasons[j]].count++;
      if (trades[i].outcome === 'WIN') entryReasonFreq[reasons[j]].wins++;
      else if (trades[i].outcome === 'LOSS') entryReasonFreq[reasons[j]].losses++;
    }
  }

  // Average trade quality
  var avgScore = 0;
  for (var i = 0; i < scores.length; i++) avgScore += scores[i].score;
  avgScore = scores.length > 0 ? Math.round(avgScore / scores.length) : 0;

  // Average R
  var avgR = rMultiples.length > 0 ? parseFloat((totalR / rMultiples.length).toFixed(2)) : 0;

  return {
    equity:           equity,
    streaks:          streaks,
    scores:           scores,
    avgTradeQuality:  avgScore,
    rMultiples:       rMultiples,
    avgR:             avgR,
    totalR:           parseFloat(totalR.toFixed(2)),
    exitBreakdown:    exitBreakdown,
    entryReasonFreq:  entryReasonFreq,
  };
}
