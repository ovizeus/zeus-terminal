// Zeus v122 — teacher/teacherBrain.js
// TEACHER V2 — Autonomous Decision Brain
// Makes entry/exit/no-trade decisions from indicator snapshot + memory
// 100% sandboxed — reads ONLY TEACHER state + teacherIndicators output
// ZERO writes to BM, BRAIN, AT, TP, S, CORE_STATE, or any live object
'use strict';

// ══════════════════════════════════════════════════════════════════
// PROFILE DEFINITIONS — FAST / SWING / DEFENSE
// Each profile has distinct SL/TP/leverage/timing parameters
// ══════════════════════════════════════════════════════════════════

var TEACHER_PROFILES = {
  FAST: {
    name: 'FAST',
    slPct: 0.5,
    tpPct: 1.0,
    leverageX: 10,
    dslEnabled: true,
    dslActivation: 0.3,
    dslTrailPct: 0.2,
    maxBarsInTrade: 30,
    feeProfile: 'fast',
    orderType: 'MARKET',
    // Entry thresholds
    minADX: 20,
    minConfluence: 55,
    rsiOversold: 35,
    rsiOverbought: 65,
    // Regime preference
    preferredRegimes: ['TREND', 'EXPANSION', 'RECOVERY'],
    avoidRegimes: ['CAPITULATION'],
  },
  SWING: {
    name: 'SWING',
    slPct: 1.5,
    tpPct: 3.0,
    leverageX: 5,
    dslEnabled: true,
    dslActivation: 1.0,
    dslTrailPct: 0.5,
    maxBarsInTrade: 80,
    feeProfile: 'swing',
    orderType: 'MARKET',
    minADX: 18,
    minConfluence: 60,
    rsiOversold: 30,
    rsiOverbought: 70,
    preferredRegimes: ['TREND', 'RANGE', 'RECOVERY'],
    avoidRegimes: ['CAPITULATION'],
  },
  DEFENSE: {
    name: 'DEFENSE',
    slPct: 0.8,
    tpPct: 1.6,
    leverageX: 3,
    dslEnabled: true,
    dslActivation: 0.5,
    dslTrailPct: 0.3,
    maxBarsInTrade: 50,
    feeProfile: 'defensive',
    orderType: 'MARKET',
    minADX: 15,
    minConfluence: 65,
    rsiOversold: 28,
    rsiOverbought: 72,
    preferredRegimes: ['RANGE', 'SQUEEZE', 'RECOVERY'],
    avoidRegimes: ['CAPITULATION', 'EXPANSION'],
  },
};

// ══════════════════════════════════════════════════════════════════
// REGIME DETECTION (V2 — enhanced, 6 regimes)
// Uses ONLY OHLCV-derived indicators — zero OF dependency
// ══════════════════════════════════════════════════════════════════

/**
 * Detect market regime from OHLCV indicators.
 * @param {Object} ind — indicator snapshot from teacherComputeIndicators()
 * @param {Array} bars — visible bars up to cursor
 * @returns {{ regime:string, confidence:number, volatilityState:string, trendBias:string }}
 *
 * Regimes:
 *   TREND        — ADX > 25, directional bias clear
 *   RANGE        — ADX < 20, price oscillating
 *   SQUEEZE      — BB squeeze active, low volatility compression
 *   EXPANSION    — BB bandwidth expanding fast, ADX rising, breakout
 *   CAPITULATION — extreme vol + climax + large wick chaos + fast move
 *   RECOVERY     — post-capitulation, vol declining, price reclaiming
 */
function teacherDetectRegimeV2(ind, bars) {
  if (!ind || !bars || bars.length < 30) {
    return { regime: 'RANGE', confidence: 30, volatilityState: 'normal', trendBias: 'neutral' };
  }

  var adx = ind.adx;
  var rsi = ind.rsi;
  var atr = ind.atr;
  var squeeze = ind.bbSqueeze;
  var bbBandwidth = ind.bbBandwidth || 0;
  var confluence = ind.confluence;
  var macdDir = ind.macdDir;
  var stDir = ind.stDir;
  var climax = ind.climax;
  var wickChaos = ind.wickChaos || 0;

  // Calculate recent price velocity (20 bars)
  var recentBars = bars.slice(-20);
  var priceChange20 = recentBars.length >= 2
    ? (recentBars[recentBars.length - 1].close - recentBars[0].close) / recentBars[0].close * 100
    : 0;
  var absPriceChange20 = Math.abs(priceChange20);

  // Calculate ATR% for volatility state
  var lastClose = bars[bars.length - 1].close;
  var atrPct = (atr && lastClose > 0) ? (atr / lastClose) * 100 : 0;

  // Volatility state
  var volatilityState = 'normal';
  if (atrPct > 2.0) volatilityState = 'extreme';
  else if (atrPct > 1.0) volatilityState = 'high';
  else if (atrPct < 0.3) volatilityState = 'low';

  // Trend bias
  var trendBias = 'neutral';
  if (macdDir === 'bull' && stDir === 'bull') trendBias = 'bullish';
  else if (macdDir === 'bear' && stDir === 'bear') trendBias = 'bearish';
  else if (macdDir === 'bull' || stDir === 'bull') trendBias = 'lean_bull';
  else if (macdDir === 'bear' || stDir === 'bear') trendBias = 'lean_bear';

  // BB bandwidth expansion rate (compare current to 10-bar avg)
  var bbExpanding = false;
  if (bars.length >= 30 && ind.bbUpper && ind.bbLower && ind.bbMiddle) {
    var curBW = (ind.bbUpper - ind.bbLower) / ind.bbMiddle * 100;
    // Simple: check if bandwidth is above 1.5x average
    var avgBW = 0;
    var bwSamples = 0;
    for (var bi = Math.max(0, bars.length - 30); bi < bars.length - 1; bi++) {
      var bHigh = bars[bi].high;
      var bLow = bars[bi].low;
      var bMid = (bHigh + bLow) / 2;
      if (bMid > 0) { avgBW += (bHigh - bLow) / bMid * 100; bwSamples++; }
    }
    if (bwSamples > 0) {
      avgBW /= bwSamples;
      bbExpanding = curBW > avgBW * 1.5;
    }
  }

  // ── CAPITULATION check ──
  // Extreme volatility + volume climax + large wicks + fast directional move
  if (volatilityState === 'extreme' && climax && wickChaos >= 60 && absPriceChange20 > 5) {
    return { regime: 'CAPITULATION', confidence: 80, volatilityState: volatilityState, trendBias: trendBias };
  }
  // Weaker capitulation: extreme vol + big move
  if (volatilityState === 'extreme' && absPriceChange20 > 8) {
    return { regime: 'CAPITULATION', confidence: 65, volatilityState: volatilityState, trendBias: trendBias };
  }

  // ── RECOVERY check ──
  // After a big drop: vol declining, price reclaiming, RSI recovering from oversold
  var was_oversold_recently = false;
  if (bars.length >= 40) {
    // Check if RSI was < 25 in recent 20 bars by checking if price had a big drop then recovered
    var low20 = Infinity, high20pre = 0;
    for (var ri = Math.max(0, bars.length - 40); ri < bars.length - 20; ri++) {
      if (bars[ri].high > high20pre) high20pre = bars[ri].high;
    }
    for (var ri2 = bars.length - 20; ri2 < bars.length; ri2++) {
      if (bars[ri2].low < low20) low20 = bars[ri2].low;
    }
    var dropPct = high20pre > 0 ? (high20pre - low20) / high20pre * 100 : 0;
    was_oversold_recently = dropPct > 5 && rsi !== null && rsi > 40 && rsi < 60;
  }
  if (was_oversold_recently && volatilityState !== 'extreme' && priceChange20 > 1) {
    return { regime: 'RECOVERY', confidence: 60, volatilityState: volatilityState, trendBias: trendBias };
  }

  // ── EXPANSION check ──
  // BB expanding + ADX rising + strong directional move
  if (bbExpanding && adx !== null && adx > 25 && absPriceChange20 > 2) {
    return { regime: 'EXPANSION', confidence: 75, volatilityState: volatilityState, trendBias: trendBias };
  }

  // ── SQUEEZE check ──
  if (squeeze) {
    return { regime: 'SQUEEZE', confidence: 70, volatilityState: volatilityState, trendBias: trendBias };
  }

  // ── TREND check ──
  if (adx !== null && adx >= 25) {
    var trendConf = 60;
    if (adx >= 35) trendConf = 80;
    if (macdDir === stDir && macdDir !== 'neut') trendConf += 10;
    return { regime: 'TREND', confidence: Math.min(95, trendConf), volatilityState: volatilityState, trendBias: trendBias };
  }

  // ── RANGE (fallback) ──
  var rangeConf = 50;
  if (adx !== null && adx < 15) rangeConf = 75;
  else if (adx !== null && adx < 20) rangeConf = 60;
  return { regime: 'RANGE', confidence: rangeConf, volatilityState: volatilityState, trendBias: trendBias };
}

// ══════════════════════════════════════════════════════════════════
// OHLCV PROXY SIGNALS — approximate OF concepts from candle data
// Clearly marked as PROXY — NOT real orderflow
// ══════════════════════════════════════════════════════════════════

function teacherOHLCVProxies(bars) {
  if (!bars || bars.length < 5) return { volumeImbalance: 0, wickAbsorption: null, volumeSpike: false, gapDetected: false };

  var last = bars[bars.length - 1];
  var prev = bars[bars.length - 2];
  var range = last.high - last.low;

  // Volume imbalance proxy: bullish candle body = buy pressure
  var body = last.close - last.open;
  var volumeImbalance = range > 0 ? body / range : 0; // -1 to +1

  // Wick absorption proxy: long lower wick = buy absorption, long upper wick = sell absorption
  var wickAbsorption = null;
  if (range > 0) {
    var lowerWick = Math.min(last.open, last.close) - last.low;
    var upperWick = last.high - Math.max(last.open, last.close);
    if (lowerWick / range > 0.4) wickAbsorption = { side: 'BUY', strength: lowerWick / range };
    else if (upperWick / range > 0.4) wickAbsorption = { side: 'SELL', strength: upperWick / range };
  }

  // Volume spike proxy: current vol > 2x SMA(10)
  var volSum = 0;
  var volCount = Math.min(10, bars.length - 1);
  for (var i = bars.length - 1 - volCount; i < bars.length - 1; i++) {
    volSum += bars[i].volume;
  }
  var volAvg = volCount > 0 ? volSum / volCount : 0;
  var volumeSpike = volAvg > 0 && last.volume > volAvg * 2;

  // Gap proxy: open significantly different from prev close
  var gapPct = prev.close > 0 ? Math.abs(last.open - prev.close) / prev.close * 100 : 0;
  var gapDetected = gapPct > 0.1; // > 0.1% gap

  return {
    volumeImbalance: parseFloat(volumeImbalance.toFixed(3)),
    wickAbsorption: wickAbsorption,
    volumeSpike: volumeSpike,
    gapDetected: gapDetected,
    _isProxy: true, // clearly marked
  };
}

// ══════════════════════════════════════════════════════════════════
// AUTO-PROFILE SELECTION
// Chooses FAST/SWING/DEFENSE based on regime + volatility
// ══════════════════════════════════════════════════════════════════

function teacherAutoSelectProfile(regimeInfo) {
  if (!regimeInfo) return TEACHER_PROFILES.SWING;

  var r = regimeInfo.regime;
  var v = regimeInfo.volatilityState;

  // CAPITULATION → DEFENSE (protect capital)
  if (r === 'CAPITULATION') return TEACHER_PROFILES.DEFENSE;

  // EXPANSION → FAST (catch breakout)
  if (r === 'EXPANSION') return TEACHER_PROFILES.FAST;

  // SQUEEZE → FAST (prepare for breakout)
  if (r === 'SQUEEZE' && v === 'low') return TEACHER_PROFILES.FAST;

  // TREND + normal/high vol → SWING
  if (r === 'TREND') {
    if (v === 'high' || v === 'extreme') return TEACHER_PROFILES.DEFENSE;
    return TEACHER_PROFILES.SWING;
  }

  // RECOVERY → SWING (ride recovery)
  if (r === 'RECOVERY') return TEACHER_PROFILES.SWING;

  // RANGE + low vol → DEFENSE
  if (r === 'RANGE') {
    if (v === 'low') return TEACHER_PROFILES.DEFENSE;
    return TEACHER_PROFILES.SWING;
  }

  return TEACHER_PROFILES.SWING; // fallback
}

// ══════════════════════════════════════════════════════════════════
// ENTRY DECISION — Should we enter? What side?
// Returns: { action:'LONG'|'SHORT'|'NO_TRADE', reasons:[], confidence:number, warnings:[] }
// ══════════════════════════════════════════════════════════════════

function teacherDecideEntry(ind, regimeInfo, profile, equity, memory) {
  var result = { action: 'NO_TRADE', reasons: [], confidence: 0, warnings: [], noTradeReasons: [] };

  if (!ind || !regimeInfo || !profile) return result;

  var adx = ind.adx;
  var rsi = ind.rsi;
  var confluence = ind.confluence;
  var macdDir = ind.macdDir;
  var stDir = ind.stDir;
  var squeeze = ind.bbSqueeze;

  // ── CAPITAL GUARD ──
  if (equity && equity.currentDDPct > 15) {
    result.noTradeReasons.push('DD_HIGH (>' + equity.currentDDPct.toFixed(1) + '%)');
    result.warnings.push('Drawdown too high — skip');
    return result;
  }

  // ── REGIME AVOID ──
  if (profile.avoidRegimes && profile.avoidRegimes.indexOf(regimeInfo.regime) !== -1) {
    result.noTradeReasons.push('REGIME_AVOIDED:' + regimeInfo.regime);
    return result;
  }

  // ── ADX FILTER ──
  if (adx !== null && adx < profile.minADX) {
    result.noTradeReasons.push('LOW_ADX:' + (adx ? adx.toFixed(0) : '?'));
  }

  // ── CONFLUENCE FILTER ──
  if (confluence === null || confluence === undefined) {
    result.noTradeReasons.push('NO_CONFLUENCE');
    return result;
  }

  // ── SCORING: accumulate bull/bear evidence ──
  var bullScore = 0;
  var bearScore = 0;
  var bullReasons = [];
  var bearReasons = [];

  // RSI
  if (rsi !== null) {
    if (rsi < profile.rsiOversold) { bullScore += 25; bullReasons.push('RSI_OVERSOLD'); }
    if (rsi > profile.rsiOverbought) { bearScore += 25; bearReasons.push('RSI_OVERBOUGHT'); }
    // Mid-range RSI gives slight directional nudge
    if (rsi > 50 && rsi < profile.rsiOverbought) { bullScore += 5; }
    if (rsi < 50 && rsi > profile.rsiOversold) { bearScore += 5; }
  }

  // MACD direction
  if (macdDir === 'bull') { bullScore += 20; bullReasons.push('MACD_BULL'); }
  if (macdDir === 'bear') { bearScore += 20; bearReasons.push('MACD_BEAR'); }

  // SuperTrend
  if (stDir === 'bull') { bullScore += 20; bullReasons.push('ST_BULL'); }
  if (stDir === 'bear') { bearScore += 20; bearReasons.push('ST_BEAR'); }

  // BB Squeeze (directional breakout expected)
  if (squeeze) {
    // Don't add direction — squeeze is neutral, adds to both
    bullScore += 5;
    bearScore += 5;
    bullReasons.push('BB_SQUEEZE');
    bearReasons.push('BB_SQUEEZE');
  }

  // Confluence
  if (confluence >= 70) { bullScore += 15; bullReasons.push('CONF_HIGH'); }
  if (confluence <= 30) { bearScore += 15; bearReasons.push('CONF_LOW'); }

  // ADX trend strength
  if (adx !== null && adx >= 30) {
    if (macdDir === 'bull') { bullScore += 10; bullReasons.push('HIGH_ADX_TREND'); }
    if (macdDir === 'bear') { bearScore += 10; bearReasons.push('HIGH_ADX_TREND'); }
  }

  // Regime bonus
  if (regimeInfo.regime === 'TREND') {
    if (regimeInfo.trendBias === 'bullish') { bullScore += 10; bullReasons.push('REGIME_TREND_UP'); }
    if (regimeInfo.trendBias === 'bearish') { bearScore += 10; bearReasons.push('REGIME_TREND_DN'); }
  }
  if (regimeInfo.regime === 'EXPANSION') {
    bullScore += 5; bearScore += 5; // expansion benefits both sides
  }

  // Divergence
  if (ind.divergence) {
    if (ind.divergence.type === 'bull') { bullScore += 15; bullReasons.push('DIVERGENCE_BULL'); }
    if (ind.divergence.type === 'bear') { bearScore += 15; bearReasons.push('DIVERGENCE_BEAR'); }
  }

  // ── DECIDE ──
  var threshold = profile.minConfluence;
  var winner = null;
  var winnerScore = 0;
  var winnerReasons = [];

  if (bullScore > bearScore && bullScore >= threshold) {
    winner = 'LONG';
    winnerScore = bullScore;
    winnerReasons = bullReasons;
  } else if (bearScore > bullScore && bearScore >= threshold) {
    winner = 'SHORT';
    winnerScore = bearScore;
    winnerReasons = bearReasons;
  }

  if (!winner) {
    // Conflict or too weak
    if (bullScore > 0 && bearScore > 0 && Math.abs(bullScore - bearScore) < 15) {
      result.noTradeReasons.push('CONFLICT:bull=' + bullScore + ',bear=' + bearScore);
    } else {
      result.noTradeReasons.push('WEAK_SIGNAL:bull=' + bullScore + ',bear=' + bearScore);
    }
    return result;
  }

  // ── MEMORY CHECK (pre-trade lookback) ──
  if (memory && typeof teacherPreTradeLookback === 'function') {
    var lookback = teacherPreTradeLookback(winner, ind);
    if (lookback && lookback.warnings && lookback.warnings.length > 0) {
      for (var w = 0; w < lookback.warnings.length; w++) {
        result.warnings.push(lookback.warnings[w]);
      }
      // Penalize confidence but don't block unless memory score very low
      if (lookback.memoryScore !== undefined && lookback.memoryScore < 20) {
        result.noTradeReasons.push('MEMORY_WARNS:score=' + lookback.memoryScore);
        return result;
      }
    }
  }

  result.action = winner;
  result.reasons = winnerReasons;
  result.confidence = Math.min(100, winnerScore);

  return result;
}

// ══════════════════════════════════════════════════════════════════
// EXIT DECISION — Enhanced signal exit with profile awareness
// Returns: exit reason string or null
// ══════════════════════════════════════════════════════════════════

function teacherDecideExit(trade, ind, regimeInfo, profile) {
  if (!trade || !ind) return null;
  var isLong = trade.side === 'LONG';

  // MACD flip
  if (ind.macdDir) {
    if (isLong && ind.macdDir === 'bear') return 'SIGNAL_FLIP';
    if (!isLong && ind.macdDir === 'bull') return 'SIGNAL_FLIP';
  }

  // SuperTrend flip
  if (ind.stDir && ind.stDir !== 'neut') {
    if (isLong && ind.stDir === 'bear') return 'SIGNAL_FLIP';
    if (!isLong && ind.stDir === 'bull') return 'SIGNAL_FLIP';
  }

  // Confluence collapse
  if (ind.confluence !== null && ind.confluence !== undefined) {
    if (isLong && ind.confluence <= 25) return 'CONFLUENCE_DROP';
    if (!isLong && ind.confluence >= 75) return 'CONFLUENCE_DROP';
  }

  // Regime shift to unfavorable
  if (regimeInfo && regimeInfo.regime === 'CAPITULATION') return 'REGIME_CAPITULATION';

  // Time stop (profile-aware)
  if (profile && trade.barsHeld !== undefined) {
    var barsHeld = (window.TEACHER && window.TEACHER.cursor) ? window.TEACHER.cursor - trade.entryBar : 0;
    if (barsHeld >= profile.maxBarsInTrade) return 'TIME_STOP';
  }

  return null;
}

// ══════════════════════════════════════════════════════════════════
// SIZING — Fixed Fraction based on equity and profile
// Returns: { leverageX:n, slPct:n, tpPct:n } or null
// ══════════════════════════════════════════════════════════════════

function teacherAutoSize(profile, equity, ind) {
  if (!profile || !equity) return null;

  var capital = equity.currentCapital || equity.startCapital || 10000;
  var riskPct = 1.0; // 1% risk per trade baseline

  // Reduce risk in high drawdown
  if (equity.currentDDPct > 10) riskPct = 0.5;
  if (equity.currentDDPct > 5) riskPct = 0.75;

  // ATR-adaptive SL: if ATR suggests wider stop, scale SL up (max 2x profile default)
  var slPct = profile.slPct;
  if (ind && ind.atr && ind.atr > 0) {
    var lastClose = 0;
    var T = window.TEACHER;
    if (T && T.dataset && T.dataset.bars && T.cursor >= 0) {
      lastClose = T.dataset.bars[T.cursor].close;
    }
    if (lastClose > 0) {
      var atrSlPct = (ind.atr / lastClose) * 100 * 1.5; // 1.5x ATR as SL
      slPct = Math.max(profile.slPct, Math.min(profile.slPct * 2, atrSlPct));
    }
  }

  // TP = SL × R:R ratio (profile default keeps 2:1)
  var rrRatio = profile.tpPct / profile.slPct;
  var tpPct = slPct * rrRatio;

  var leverageX = profile.leverageX;

  // Volume sanity: don't over-leverage in low vol
  if (equity.currentDDPct > 8) {
    leverageX = Math.max(1, Math.floor(leverageX * 0.5));
  }

  return {
    leverageX: leverageX,
    slPct: parseFloat(slPct.toFixed(2)),
    tpPct: parseFloat(tpPct.toFixed(2)),
    capitalUSD: capital,
    riskPct: riskPct,
    dslEnabled: profile.dslEnabled,
    dslActivation: profile.dslActivation,
    dslTrailPct: profile.dslTrailPct,
    feeProfile: profile.feeProfile,
    orderType: profile.orderType,
  };
}

// ══════════════════════════════════════════════════════════════════
// TRADE CLASSIFICATION — Good/Bad/Mistake/Avoidable/GoodLoss
// ══════════════════════════════════════════════════════════════════

function teacherClassifyTradeV2(trade) {
  if (!trade) return 'UNKNOWN';

  var score = 0;
  if (typeof teacherScoreTrade === 'function') {
    var result = teacherScoreTrade(trade);
    score = result.score;
  }

  if (trade.outcome === 'WIN') {
    if (score >= 70) return 'GOOD_TRADE';
    if (score >= 40) return 'OK_TRADE';
    return 'LUCKY_TRADE'; // won but poor entry/execution
  }

  if (trade.outcome === 'LOSS') {
    // Good loss: proper setup, proper execution, market just went against
    if (score >= 50 && trade.exitReason === 'SL_HIT') return 'GOOD_LOSS';
    if (score >= 50 && trade.exitReason === 'DSL_HIT') return 'GOOD_LOSS';
    // Avoidable: clear conflict or poor signal
    if (trade.entryReasons && trade.entryReasons.length <= 1) return 'AVOIDABLE_LOSS';
    // Mistake: very low score
    if (score < 30) return 'MISTAKE';
    return 'BAD_TRADE';
  }

  return 'BREAKEVEN';
}

// ══════════════════════════════════════════════════════════════════
// AUTO TF SELECTION — Based on curriculum hint + regime
// ══════════════════════════════════════════════════════════════════

function teacherAutoSelectTF(regimeInfo, curriculumHint) {
  // If curriculum suggests a TF, use it
  if (curriculumHint && curriculumHint.tf) return curriculumHint.tf;

  // Default: regime-aware selection
  if (!regimeInfo) return '15m';

  var r = regimeInfo.regime;
  // CAPITULATION / EXPANSION → shorter TFs to catch fast moves
  if (r === 'CAPITULATION' || r === 'EXPANSION') return '5m';
  // TREND → medium TFs for swing
  if (r === 'TREND') return '15m';
  // RANGE / SQUEEZE → longer TFs for less noise
  if (r === 'RANGE' || r === 'SQUEEZE') return '1h';
  // RECOVERY → medium
  if (r === 'RECOVERY') return '15m';

  return '15m'; // fallback
}

// ══════════════════════════════════════════════════════════════════
// AUTO REPLAY SPEED — Accelerate boring, slow for action
// ══════════════════════════════════════════════════════════════════

function teacherAutoSpeed(hasOpenTrade, ind, regimeInfo) {
  // In trade → slow (100ms)
  if (hasOpenTrade) return 100;

  // Strong signal forming → moderate (80ms)
  if (ind && ind.confluence !== null) {
    if (ind.confluence >= 70 || ind.confluence <= 30) return 80;
  }

  // Interesting regime → moderate (60ms)
  if (regimeInfo && (regimeInfo.regime === 'EXPANSION' || regimeInfo.regime === 'CAPITULATION')) return 60;

  // Boring → fast (20ms)
  return 20;
}
