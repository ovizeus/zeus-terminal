// Zeus v122 — teacher/teacherEngine.js
// THE TEACHER — Replay engine: bar-by-bar stepping, auto-play, indicator compute
// Zero look-ahead bias: only bars[0..cursor] visible at each tick
// Reads/writes ONLY window.TEACHER — fully sandboxed
'use strict';

// ══════════════════════════════════════════════════════════════════
// REPLAY STATE (internal, not global)
// ══════════════════════════════════════════════════════════════════
var _teacherPlayTimer = null;     // setInterval ID for auto-play
var _teacherOnTick = null;        // external callback: function(tickData)
var _teacherOnComplete = null;    // external callback: function(summary)

// ══════════════════════════════════════════════════════════════════
// INIT REPLAY — load dataset into TEACHER, set cursor to start
// ══════════════════════════════════════════════════════════════════

/**
 * Initialize a replay session.
 * @param {Object} dataset — from teacherLoadDataset()
 * @param {Object} [opts]
 * @param {number} [opts.startBar] — cursor start (default: lookback)
 * @param {Function} [opts.onTick] — called each step with tick data
 * @param {Function} [opts.onComplete] — called when replay reaches end
 */
function teacherInitReplay(dataset, opts) {
  opts = opts || {};
  var T = window.TEACHER;
  if (!T) throw new Error('TEACHER state not initialized');

  // Validate dataset
  var validation = teacherValidateDataset(dataset);
  if (!validation.valid) throw new Error('Invalid dataset: ' + validation.errors.join(', '));

  // Stop any running replay
  teacherStopReplay();

  // Set dataset
  T.dataset = dataset;
  T.cursor = opts.startBar || Math.min(TEACHER_REPLAY_DEFAULTS.lookback, dataset.bars.length - 1);
  T.replaying = false;
  T.paused = false;
  T.openTrade = null;
  T.trades = [];
  T.stats = null;

  // Set callbacks
  _teacherOnTick = typeof opts.onTick === 'function' ? opts.onTick : null;
  _teacherOnComplete = typeof opts.onComplete === 'function' ? opts.onComplete : null;

  // Compute indicators for initial position
  _teacherComputeAtCursor();

  return {
    totalBars: dataset.bars.length,
    startCursor: T.cursor,
    tf: dataset.tf,
    range: dataset.range,
  };
}

// ══════════════════════════════════════════════════════════════════
// CURSOR — Internal: compute indicators for current cursor position
// ZERO LOOK-AHEAD: only bars[0..cursor] are passed to indicators
// ══════════════════════════════════════════════════════════════════

function _teacherComputeAtCursor() {
  var T = window.TEACHER;
  if (!T || !T.dataset || !T.dataset.bars) return;

  // CRITICAL: slice only UP TO cursor (inclusive) — zero look-ahead
  var visibleBars = T.dataset.bars.slice(0, T.cursor + 1);

  // Compute all indicators from visible bars only
  T.indicators = teacherComputeIndicators(visibleBars);

  return T.indicators;
}

// ══════════════════════════════════════════════════════════════════
// STEP — Advance one bar forward
// ══════════════════════════════════════════════════════════════════

/**
 * Step forward by N bars (default 1). Returns tick data or null if at end.
 * @param {number} [n=1]
 * @returns {Object|null} tick data
 */
function teacherStep(n) {
  n = n || 1;
  var T = window.TEACHER;
  if (!T || !T.dataset) return null;

  var maxCursor = T.dataset.bars.length - 1;

  // Already at end?
  if (T.cursor >= maxCursor) {
    _teacherReplayEnd();
    return null;
  }

  // Advance cursor
  T.cursor = Math.min(T.cursor + n, maxCursor);

  // Recompute indicators
  _teacherComputeAtCursor();

  // Get current bar info
  var bar = T.dataset.bars[T.cursor];
  var prevBar = T.cursor > 0 ? T.dataset.bars[T.cursor - 1] : null;

  // Build tick data
  var tick = {
    barIndex: T.cursor,
    bar: bar,
    prevBar: prevBar,
    indicators: T.indicators,
    progress: T.cursor / maxCursor,
    barsLeft: maxCursor - T.cursor,
    openTrade: T.openTrade,
  };

  // Check open trade against this bar (SL/TP/DSL processing)
  if (T.openTrade) {
    _teacherProcessTradeBar(tick);
  }

  // Notify
  if (_teacherOnTick) {
    try { _teacherOnTick(tick); } catch (e) { console.warn('[TEACHER] onTick error:', e.message); }
  }

  // End of dataset?
  if (T.cursor >= maxCursor) {
    _teacherReplayEnd();
  }

  return tick;
}

// ══════════════════════════════════════════════════════════════════
// STEP BACK — Go back N bars (re-computes indicators, no trade undo)
// ══════════════════════════════════════════════════════════════════
function teacherStepBack(n) {
  n = n || 1;
  var T = window.TEACHER;
  if (!T || !T.dataset) return null;

  T.cursor = Math.max(0, T.cursor - n);
  _teacherComputeAtCursor();

  var bar = T.dataset.bars[T.cursor];
  return {
    barIndex: T.cursor,
    bar: bar,
    indicators: T.indicators,
    progress: T.cursor / (T.dataset.bars.length - 1),
    barsLeft: T.dataset.bars.length - 1 - T.cursor,
    openTrade: T.openTrade,
  };
}

// ══════════════════════════════════════════════════════════════════
// JUMP — Go to specific bar index
// ══════════════════════════════════════════════════════════════════
function teacherJumpTo(index) {
  var T = window.TEACHER;
  if (!T || !T.dataset) return null;

  index = Math.max(0, Math.min(index, T.dataset.bars.length - 1));
  T.cursor = index;
  _teacherComputeAtCursor();

  var bar = T.dataset.bars[T.cursor];
  return {
    barIndex: T.cursor,
    bar: bar,
    indicators: T.indicators,
    progress: T.cursor / (T.dataset.bars.length - 1),
    barsLeft: T.dataset.bars.length - 1 - T.cursor,
    openTrade: T.openTrade,
  };
}

// ══════════════════════════════════════════════════════════════════
// AUTO-PLAY — Start/stop/pause timed stepping
// ══════════════════════════════════════════════════════════════════

function teacherPlay() {
  var T = window.TEACHER;
  if (!T || !T.dataset) return false;
  if (T.replaying && !T.paused) return false; // already playing

  T.replaying = true;
  T.paused = false;

  var speed = T.config.speedMs || TEACHER_REPLAY_DEFAULTS.speedMs;

  _teacherPlayTimer = setInterval(function () {
    var result = teacherStep(1);
    if (!result) {
      teacherStopReplay();
    }
  }, speed);

  return true;
}

function teacherPause() {
  var T = window.TEACHER;
  if (!T) return false;

  T.paused = true;
  if (_teacherPlayTimer) {
    clearInterval(_teacherPlayTimer);
    _teacherPlayTimer = null;
  }
  return true;
}

function teacherStopReplay() {
  var T = window.TEACHER;
  if (T) {
    T.replaying = false;
    T.paused = false;
  }
  if (_teacherPlayTimer) {
    clearInterval(_teacherPlayTimer);
    _teacherPlayTimer = null;
  }
}

function teacherSetSpeed(ms) {
  var T = window.TEACHER;
  if (!T) return;
  ms = Math.max(50, Math.min(5000, ms || 500));
  T.config.speedMs = ms;

  // If currently playing, restart timer with new speed
  if (T.replaying && !T.paused) {
    teacherPause();
    teacherPlay();
  }
}

// ══════════════════════════════════════════════════════════════════
// TRADE BAR PROCESSING — SL/TP/DSL check per bar (no look-ahead)
// ══════════════════════════════════════════════════════════════════

function _teacherProcessTradeBar(tick) {
  var T = window.TEACHER;
  var trade = T.openTrade;
  if (!trade) return;

  var bar = tick.bar;
  var isLong = trade.side === 'LONG';

  // === Dynamic Stop Loss (trailing) ===
  if (trade.dsl && trade.dsl.enabled) {
    var moveFromEntry = isLong
      ? (bar.high - trade.entry) / trade.entry * 100
      : (trade.entry - bar.low) / trade.entry * 100;

    if (!trade.dsl.active && moveFromEntry >= trade.dsl.activation) {
      trade.dsl.active = true;
      trade.dsl.bestPrice = isLong ? bar.high : bar.low;
    }

    if (trade.dsl.active) {
      if (isLong) {
        if (bar.high > trade.dsl.bestPrice) trade.dsl.bestPrice = bar.high;
        trade.sl = trade.dsl.bestPrice * (1 - trade.dsl.trailPct / 100);
      } else {
        if (bar.low < trade.dsl.bestPrice) trade.dsl.bestPrice = bar.low;
        trade.sl = trade.dsl.bestPrice * (1 + trade.dsl.trailPct / 100);
      }
    }
  }

  // === Check SL hit ===
  if (trade.sl) {
    var slHit = isLong ? (bar.low <= trade.sl) : (bar.high >= trade.sl);
    if (slHit) {
      var exitPrice = trade.sl; // fill at SL price
      var reason = (trade.dsl && trade.dsl.active) ? 'DSL_HIT' : 'SL_HIT';
      _teacherCloseTrade(exitPrice, reason, tick);
      return;
    }
  }

  // === Check TP hit ===
  if (trade.tp) {
    var tpHit = isLong ? (bar.high >= trade.tp) : (bar.low <= trade.tp);
    if (tpHit) {
      _teacherCloseTrade(trade.tp, 'TP_HIT', tick);
      return;
    }
  }

  // === Update unrealized PnL ===
  trade.unrealizedPnl = _teacherCalcPnl(trade, bar.close);
  trade.barsHeld = tick.barIndex - trade.entryBar;
}

// ══════════════════════════════════════════════════════════════════
// TRADE OPEN — Enter a simulated trade
// ══════════════════════════════════════════════════════════════════

/**
 * Open a simulated trade at current cursor bar.
 * @param {string} side — 'LONG' or 'SHORT'
 * @param {Object} [overrides] — override default SL/TP/leverage etc
 * @returns {Object|null} the opened trade, or null if invalid
 */
function teacherOpenTrade(side, overrides) {
  var T = window.TEACHER;
  if (!T || !T.dataset) return null;
  if (T.openTrade) return null; // already in a trade
  if (side !== 'LONG' && side !== 'SHORT') return null;

  var bar = T.dataset.bars[T.cursor];
  if (!bar) return null;

  var cfg = T.config;
  var ov = overrides || {};
  var entry = bar.close;
  var leverage = Math.min(ov.leverageX || cfg.leverageX, TEACHER_TRADE_DEFAULTS.maxLeverage);
  var capital = cfg.capitalUSD;
  var notional = capital * leverage;
  var qty = notional / entry;
  var slPct = ov.slPct || cfg.slPct;
  var tpPct = ov.tpPct || cfg.tpPct;

  // Calculate SL/TP prices
  var slPrice, tpPrice;
  if (side === 'LONG') {
    slPrice = entry * (1 - slPct / 100);
    tpPrice = entry * (1 + tpPct / 100);
  } else {
    slPrice = entry * (1 + slPct / 100);
    tpPrice = entry * (1 - tpPct / 100);
  }

  // Fee on entry
  var feeProfile = ov.feeProfile || cfg.feeProfile;
  var orderType = ov.orderType || cfg.orderType;
  var fees = teacherEstimateFees(notional, orderType, feeProfile);

  // DSL config
  var dslEnabled = ov.dslEnabled !== undefined ? ov.dslEnabled : cfg.dslEnabled;
  var dsl = dslEnabled ? {
    enabled: true,
    active: false,
    activation: ov.dslActivation || cfg.dslActivation,
    trailPct: ov.dslTrailPct || cfg.dslTrailPct,
    bestPrice: entry,
  } : { enabled: false, active: false };

  // Auto-tag entry reasons from indicators
  var entryReasons = _teacherAutoTagEntry(side, T.indicators);

  var trade = {
    id: 'T_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    side: side,
    entry: entry,
    sl: slPrice,
    tp: tpPrice,
    dsl: dsl,
    entryBar: T.cursor,
    entryTs: bar.time,
    leverage: leverage,
    qty: qty,
    notional: notional,
    capital: capital,
    entryFee: fees.entryFee + fees.slippage / 2,
    feeProfile: feeProfile,
    orderType: orderType,
    entryReasons: entryReasons,
    unrealizedPnl: 0,
    barsHeld: 0,
  };

  T.openTrade = trade;
  return trade;
}

// ══════════════════════════════════════════════════════════════════
// TRADE CLOSE — Exit a simulated trade
// ══════════════════════════════════════════════════════════════════

function _teacherCloseTrade(exitPrice, reason, tick) {
  var T = window.TEACHER;
  if (!T || !T.openTrade) return null;

  var trade = T.openTrade;
  var isLong = trade.side === 'LONG';
  var bar = tick ? tick.bar : (T.dataset ? T.dataset.bars[T.cursor] : null);

  // Calculate PnL
  var priceDiff = isLong ? (exitPrice - trade.entry) : (trade.entry - exitPrice);
  var pnlRaw = priceDiff * trade.qty;

  // Exit fee
  var exitFees = teacherEstimateFees(trade.notional, trade.orderType, trade.feeProfile);
  var exitFee = exitFees.exitFee + exitFees.slippage / 2;
  var totalFees = trade.entryFee + exitFee;

  var pnlNet = pnlRaw - totalFees;
  var pnlPct = trade.capital > 0 ? (pnlNet / trade.capital) * 100 : 0;

  // Build closed trade record
  var closedTrade = {
    id: trade.id,
    side: trade.side,
    entry: trade.entry,
    exit: exitPrice,
    sl: trade.sl,
    tp: trade.tp,
    leverage: trade.leverage,
    qty: trade.qty,
    notional: trade.notional,
    capital: trade.capital,
    entryBar: trade.entryBar,
    exitBar: T.cursor,
    entryTs: trade.entryTs,
    exitTs: bar ? bar.time : 0,
    barsHeld: T.cursor - trade.entryBar,
    pnlRaw: parseFloat(pnlRaw.toFixed(4)),
    pnlNet: parseFloat(pnlNet.toFixed(4)),
    pnlPct: parseFloat(pnlPct.toFixed(2)),
    totalFees: parseFloat(totalFees.toFixed(4)),
    exitReason: reason,
    entryReasons: trade.entryReasons,
    outcome: pnlNet > 0.01 ? 'WIN' : pnlNet < -0.01 ? 'LOSS' : 'BREAKEVEN',
    dslUsed: trade.dsl && trade.dsl.active,
    indicators: {
      entryRSI: null, // filled below
      exitRSI: T.indicators.rsi,
      entryConfluence: null,
      exitConfluence: T.indicators.confluence,
      regime: T.indicators.regime,
    },
  };

  // Store completed trade
  T.trades.push(closedTrade);
  if (T.trades.length > 1000) T.trades = T.trades.slice(-1000);
  T.openTrade = null;

  return closedTrade;
}

// Manual close at current bar's close price
function teacherCloseTrade(reason) {
  var T = window.TEACHER;
  if (!T || !T.openTrade || !T.dataset) return null;

  var bar = T.dataset.bars[T.cursor];
  if (!bar) return null;

  return _teacherCloseTrade(bar.close, reason || 'MANUAL_EXIT', { bar: bar, barIndex: T.cursor });
}

// ══════════════════════════════════════════════════════════════════
// PNL CALCULATOR (pure)
// ══════════════════════════════════════════════════════════════════

function _teacherCalcPnl(trade, currentPrice) {
  if (!trade) return 0;
  var diff = trade.side === 'LONG'
    ? (currentPrice - trade.entry)
    : (trade.entry - currentPrice);
  return parseFloat((diff * trade.qty).toFixed(4));
}

// ══════════════════════════════════════════════════════════════════
// AUTO-TAG ENTRY REASONS — based on current indicators
// ══════════════════════════════════════════════════════════════════

function _teacherAutoTagEntry(side, ind) {
  var tags = [];
  if (!ind) return tags;

  var isLong = side === 'LONG';

  // RSI
  if (ind.rsi !== null) {
    if (ind.rsi < 30 && isLong) tags.push('RSI_OVERSOLD');
    if (ind.rsi > 70 && !isLong) tags.push('RSI_OVERBOUGHT');
  }

  // MACD
  if (ind.macdDir === 'bull' && isLong) tags.push('MACD_CROSS_BULL');
  if (ind.macdDir === 'bear' && !isLong) tags.push('MACD_CROSS_BEAR');

  // SuperTrend
  if (ind.stDir === 'bull' && isLong) tags.push('ST_FLIP_BULL');
  if (ind.stDir === 'bear' && !isLong) tags.push('ST_FLIP_BEAR');

  // Bollinger
  if (ind.bbSqueeze) tags.push('BB_SQUEEZE_BREAK');

  // ADX
  if (ind.adx !== null) {
    if (ind.adx >= 25) tags.push('HIGH_ADX_TREND');
    else tags.push('LOW_ADX_RANGE');
  }

  // Confluence
  if (ind.confluence >= 70 && isLong) tags.push('CONFLUENCE_HIGH');
  if (ind.confluence <= 30 && !isLong) tags.push('CONFLUENCE_LOW');

  // Divergence
  if (ind.divergence) {
    if (ind.divergence.type === 'bull' && isLong) tags.push('DIVERGENCE_BULL');
    if (ind.divergence.type === 'bear' && !isLong) tags.push('DIVERGENCE_BEAR');
  }

  // Volume climax
  if (ind.climax) tags.push('VOLUME_CLIMAX');

  // Regime
  if (ind.regime === 'TREND') tags.push('REGIME_TREND');
  if (ind.regime === 'BREAKOUT') tags.push('REGIME_BREAKOUT');
  if (ind.regime === 'RANGE') tags.push('REGIME_RANGE');

  return tags;
}

// ══════════════════════════════════════════════════════════════════
// REPLAY END — finalize session
// ══════════════════════════════════════════════════════════════════

function _teacherReplayEnd() {
  teacherStopReplay();

  var T = window.TEACHER;
  if (!T) return;

  // Force-close any open trade at last bar's close
  if (T.openTrade && T.dataset && T.dataset.bars.length) {
    var lastBar = T.dataset.bars[T.dataset.bars.length - 1];
    _teacherCloseTrade(lastBar.close, 'MAX_BARS_EXIT', { bar: lastBar, barIndex: T.dataset.bars.length - 1 });
  }

  // Build session summary
  var summary = _teacherBuildSessionSummary();

  // Notify
  if (_teacherOnComplete) {
    try { _teacherOnComplete(summary); } catch (e) { console.warn('[TEACHER] onComplete error:', e.message); }
  }

  return summary;
}

// ══════════════════════════════════════════════════════════════════
// SESSION SUMMARY — basic stats from completed trades
// ══════════════════════════════════════════════════════════════════

function _teacherBuildSessionSummary() {
  var T = window.TEACHER;
  if (!T) return null;

  var trades = T.trades;
  var wins = 0, losses = 0, breakeven = 0;
  var totalPnl = 0, grossProfit = 0, grossLoss = 0;
  var totalFees = 0;

  for (var i = 0; i < trades.length; i++) {
    var t = trades[i];
    totalPnl += t.pnlNet;
    totalFees += t.totalFees;
    if (t.outcome === 'WIN') { wins++; grossProfit += t.pnlNet; }
    else if (t.outcome === 'LOSS') { losses++; grossLoss += Math.abs(t.pnlNet); }
    else breakeven++;
  }

  var totalTrades = trades.length;
  var winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  var profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
  var avgWin = wins > 0 ? grossProfit / wins : 0;
  var avgLoss = losses > 0 ? grossLoss / losses : 0;

  return {
    sessionId: 'S_' + Date.now(),
    tf: T.dataset ? T.dataset.tf : '?',
    totalBars: T.dataset ? T.dataset.bars.length : 0,
    barsReplayed: T.cursor + 1,
    totalTrades: totalTrades,
    wins: wins,
    losses: losses,
    breakeven: breakeven,
    winRate: parseFloat(winRate.toFixed(1)),
    totalPnl: parseFloat(totalPnl.toFixed(2)),
    grossProfit: parseFloat(grossProfit.toFixed(2)),
    grossLoss: parseFloat(grossLoss.toFixed(2)),
    profitFactor: parseFloat(profitFactor.toFixed(2)),
    avgWin: parseFloat(avgWin.toFixed(2)),
    avgLoss: parseFloat(avgLoss.toFixed(2)),
    totalFees: parseFloat(totalFees.toFixed(2)),
    trades: trades,
  };
}

// ══════════════════════════════════════════════════════════════════
// SNAPSHOT — Get current replay state (for UI rendering)
// ══════════════════════════════════════════════════════════════════

function teacherGetSnapshot() {
  var T = window.TEACHER;
  if (!T || !T.dataset) return null;

  var maxCursor = T.dataset.bars.length - 1;
  var bar = T.dataset.bars[T.cursor];

  return {
    cursor: T.cursor,
    totalBars: T.dataset.bars.length,
    progress: maxCursor > 0 ? T.cursor / maxCursor : 0,
    barsLeft: maxCursor - T.cursor,
    bar: bar,
    indicators: T.indicators,
    openTrade: T.openTrade,
    tradeCount: T.trades.length,
    replaying: T.replaying,
    paused: T.paused,
    tf: T.dataset.tf,
  };
}
