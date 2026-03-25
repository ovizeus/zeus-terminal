// Zeus v122 — teacher/teacherIndicators.js
// THE TEACHER — Pure indicator calculations for sandboxed replay
// ZERO side effects — NO DOM, NO globals read/write, NO BM/S/BRAIN
// Every function takes data in, returns result out.
'use strict';

// [P2] Node.js shim — load config constants if not already available (browser loads via script tag)
// Use a local alias to avoid var-hoisting conflict with const in browser global scope
var _TID = (typeof TEACHER_IND_DEFAULTS !== 'undefined') ? TEACHER_IND_DEFAULTS
         : (typeof require === 'function') ? require('./teacherConfig').TEACHER_IND_DEFAULTS
         : {};

// ══════════════════════════════════════════════════════════════════
// RSI (Wilder smoothing, returns full array)
// ══════════════════════════════════════════════════════════════════
function teacherCalcRSI(closes, period) {
  period = period || _TID.rsiPeriod;
  var len = closes.length;
  var out = new Array(len).fill(null);
  if (len < period + 1) return out;
  var g = 0, l = 0;
  for (var i = 1; i <= period; i++) {
    var d = closes[i] - closes[i - 1];
    if (d > 0) g += d; else l += Math.abs(d);
  }
  var ag = g / period, al = l / period;
  out[period] = al === 0 ? 100 : 100 - (100 / (1 + (ag / al)));
  for (var i = period + 1; i < len; i++) {
    var d = closes[i] - closes[i - 1];
    if (d > 0) { ag = (ag * (period - 1) + d) / period; al = al * (period - 1) / period; }
    else { ag = ag * (period - 1) / period; al = (al * (period - 1) + Math.abs(d)) / period; }
    out[i] = al === 0 ? 100 : parseFloat((100 - (100 / (1 + (ag / al)))).toFixed(1));
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════
// ADX (Wilder smoothing, returns scalar for last bar)
// ══════════════════════════════════════════════════════════════════
function teacherCalcADX(bars, period) {
  period = period || _TID.adxPeriod;
  if (!bars || bars.length < period * 3 + 1) return null;
  var slice = bars.slice(-(period * 3 + 1));
  var sTR = 0, sDMp = 0, sDMm = 0;
  for (var i = 1; i <= period; i++) {
    var h = slice[i].high, l = slice[i].low, pc = slice[i - 1].close;
    var ph = slice[i - 1].high, pl = slice[i - 1].low;
    sTR += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    sDMp += (h - ph > 0 && h - ph > pl - l) ? h - ph : 0;
    sDMm += (pl - l > 0 && pl - l > h - ph) ? pl - l : 0;
  }
  var smoothADX = 0, dxCount = 0;
  for (var i = period + 1; i < slice.length; i++) {
    var h = slice[i].high, l = slice[i].low, pc = slice[i - 1].close;
    var ph = slice[i - 1].high, pl = slice[i - 1].low;
    var tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    var dp = (h - ph > 0 && h - ph > pl - l) ? h - ph : 0;
    var dm = (pl - l > 0 && pl - l > h - ph) ? pl - l : 0;
    sTR = sTR - sTR / period + tr;
    sDMp = sDMp - sDMp / period + dp;
    sDMm = sDMm - sDMm / period + dm;
    if (sTR === 0) continue;
    var diP = (sDMp / sTR) * 100;
    var diM = (sDMm / sTR) * 100;
    var dxD = diP + diM;
    var dx = dxD === 0 ? 0 : Math.abs(diP - diM) / dxD * 100;
    if (dxCount === 0) smoothADX = dx;
    else smoothADX = (smoothADX * (period - 1) + dx) / period;
    dxCount++;
  }
  return dxCount === 0 ? null : Math.round(smoothADX);
}

// ══════════════════════════════════════════════════════════════════
// MACD (returns {macd, signal, hist} for last bar)
// ══════════════════════════════════════════════════════════════════
function teacherCalcMACD(closes, fast, slow, sig) {
  fast = fast || _TID.macdFast;
  slow = slow || _TID.macdSlow;
  sig  = sig  || _TID.macdSignal;
  if (!closes || closes.length < slow + sig) return null;
  var emaCalc = function (data, p) {
    var k = 2 / (p + 1), e = data[0];
    var out = [e];
    for (var i = 1; i < data.length; i++) { e = data[i] * k + e * (1 - k); out.push(e); }
    return out;
  };
  var emaF = emaCalc(closes, fast);
  var emaS = emaCalc(closes, slow);
  var macdLine = [];
  for (var i = 0; i < closes.length; i++) macdLine.push(emaF[i] - emaS[i]);
  var signalLine = emaCalc(macdLine, sig);
  var last = closes.length - 1;
  var m = macdLine[last];
  var s = signalLine[last];
  return { macd: m, signal: s, hist: m - s };
}

// MACD direction (bull/bear/neut)
function teacherDetectMACDDir(closes, fast, slow, sig) {
  fast = fast || _TID.macdFast;
  slow = slow || _TID.macdSlow;
  sig  = sig  || _TID.macdSignal;
  if (!closes || closes.length < slow + sig + 2) return 'neut';
  var emaCalc = function (data, p) {
    var k = 2 / (p + 1), e = data[0];
    var out = [e];
    for (var i = 1; i < data.length; i++) { e = data[i] * k + e * (1 - k); out.push(e); }
    return out;
  };
  var emaF = emaCalc(closes, fast);
  var emaS = emaCalc(closes, slow);
  var macdLine = [];
  for (var i = 0; i < closes.length; i++) macdLine.push(emaF[i] - emaS[i]);
  var signalLine = emaCalc(macdLine, sig);
  var last = closes.length - 1;
  var m = macdLine[last], mp = macdLine[last - 1];
  var s = signalLine[last], sp = signalLine[last - 1];
  if (m > s && mp <= sp) return 'bull';
  if (m < s && mp >= sp) return 'bear';
  return m > s ? 'bull' : 'bear';
}

// ══════════════════════════════════════════════════════════════════
// ATR (Average True Range, returns scalar)
// ══════════════════════════════════════════════════════════════════
function teacherCalcATR(bars, period) {
  period = period || _TID.atrPeriod;
  if (!bars || bars.length < period + 1) return null;
  var slice = bars.slice(-(period + 1));
  var sum = 0;
  for (var i = 1; i < slice.length; i++) {
    sum += Math.max(
      slice[i].high - slice[i].low,
      Math.abs(slice[i].high - slice[i - 1].close),
      Math.abs(slice[i].low - slice[i - 1].close)
    );
  }
  return sum / period;
}

// ══════════════════════════════════════════════════════════════════
// Supertrend direction (bull/bear/neut)
// ══════════════════════════════════════════════════════════════════
function teacherDetectSTDir(bars, mult) {
  mult = mult || _TID.stMult;
  if (!bars || bars.length < 20) return 'neut';
  var slice = bars.slice(-20);
  var closes = [];
  for (var i = 0; i < slice.length; i++) closes.push(slice[i].close);
  var atrs = [];
  for (var i = 1; i < slice.length; i++) {
    atrs.push(Math.max(
      slice[i].high - slice[i].low,
      Math.abs(slice[i].high - slice[i - 1].close),
      Math.abs(slice[i].low - slice[i - 1].close)
    ));
  }
  var atr = 0;
  for (var i = 0; i < atrs.length; i++) atr += atrs[i];
  atr /= atrs.length;
  var last = slice[slice.length - 1];
  var hl2 = (last.high + last.low) / 2;
  var lower = hl2 - mult * atr;
  var upper = hl2 + mult * atr;
  return last.close > lower ? 'bull' : last.close < upper ? 'bear' : 'neut';
}

// ══════════════════════════════════════════════════════════════════
// Bollinger Bands (returns {upper, middle, lower, squeeze})
// ══════════════════════════════════════════════════════════════════
function teacherCalcBB(closes, period, mult) {
  period = period || _TID.bbPeriod;
  mult   = mult   || _TID.bbMult;
  if (!closes || closes.length < period) return null;
  var slice = closes.slice(-period);
  var sum = 0;
  for (var i = 0; i < slice.length; i++) sum += slice[i];
  var sma = sum / period;
  var sqSum = 0;
  for (var i = 0; i < slice.length; i++) sqSum += (slice[i] - sma) * (slice[i] - sma);
  var std = Math.sqrt(sqSum / period);
  var upper = sma + mult * std;
  var lower = sma - mult * std;
  var bandwidth = sma > 0 ? (upper - lower) / sma : 0;
  // Squeeze: bandwidth < 4% of price (tight bands)
  var squeeze = bandwidth < 0.04;
  return { upper: upper, middle: sma, lower: lower, squeeze: squeeze, bandwidth: bandwidth };
}

// ══════════════════════════════════════════════════════════════════
// Wick Chaos (pure — from regime.js logic)
// ══════════════════════════════════════════════════════════════════
function teacherWickChaos(bars, n) {
  n = n || 10;
  if (!bars || bars.length < n) return 0;
  var slice = bars.slice(-n);
  var total = 0, count = 0;
  for (var i = 0; i < slice.length; i++) {
    var range = slice[i].high - slice[i].low;
    if (range <= 0) continue;
    var body = Math.abs(slice[i].close - slice[i].open);
    total += 1 - body / range;
    count++;
  }
  return count === 0 ? 0 : Math.round((total / count) * 100);
}

// ══════════════════════════════════════════════════════════════════
// Breakout Strength (pure — from regime.js logic)
// ══════════════════════════════════════════════════════════════════
function teacherBreakoutStrength(bars) {
  if (!bars || bars.length < 10) return 0;
  var last5 = bars.slice(-5);
  var prev5 = bars.slice(-10, -5);
  var volRecent = 0, volOld = 0, rangeRecent = 0, rangeOld = 0;
  for (var i = 0; i < 5; i++) {
    volRecent += (last5[i].volume || 0);
    volOld    += (prev5[i].volume || 0);
    rangeRecent += last5[i].high - last5[i].low;
    rangeOld    += prev5[i].high - prev5[i].low;
  }
  volRecent /= 5; volOld /= 5; rangeRecent /= 5; rangeOld /= 5;
  var volScore = volOld > 0 ? Math.min(40, Math.round((volRecent / volOld - 1) * 80)) : 0;
  var rangeScore = rangeOld > 0 ? Math.min(30, Math.round((rangeRecent / rangeOld - 1) * 60)) : 0;
  var dir = bars[bars.length - 1].close > bars[bars.length - 1].open ? 1 : -1;
  var ftCount = 0;
  for (var i = bars.length - 3; i < bars.length; i++) {
    if (i < 0) continue;
    var bd = bars[i].close > bars[i].open ? 1 : -1;
    if (bd === dir) ftCount++;
  }
  var ftScore = Math.min(30, ftCount * 10);
  return Math.max(0, volScore + rangeScore + ftScore);
}

// ══════════════════════════════════════════════════════════════════
// Regime Detection (pure — reimplements regime.js core logic)
// Returns { regime, confidence, trendBias, volatilityState, trapRisk }
// ══════════════════════════════════════════════════════════════════
function teacherDetectRegime(bars, adx, rsi) {
  if (!bars || bars.length < 50) {
    return { regime: 'RANGE', confidence: 0, trendBias: 'neutral', volatilityState: 'normal', trapRisk: 0 };
  }
  adx = adx != null ? adx : teacherCalcADX(bars);
  var closes = [];
  for (var i = 0; i < bars.length; i++) closes.push(bars[i].close);
  rsi = rsi != null ? rsi : (function () {
    var arr = teacherCalcRSI(closes);
    return arr[arr.length - 1];
  })();

  var wickScore = teacherWickChaos(bars, 10);
  var brkScore  = teacherBreakoutStrength(bars);
  var atr = teacherCalcATR(bars, 14) || 0;
  var price = bars[bars.length - 1].close;
  var atrPct = price > 0 ? (atr / price) * 100 : 0;

  // Classify
  var regime = 'RANGE', confidence = 0, trendBias = 'neutral', volState = 'normal', trapRisk = 0;

  if (adx != null && adx >= 25 && brkScore >= 40) {
    regime = 'BREAKOUT';
    confidence = Math.min(95, Math.round(adx * 0.8 + brkScore * 0.5));
    trendBias = bars[bars.length - 1].close > bars[bars.length - 6].close ? 'bullish' : 'bearish';
    volState = 'expanding';
    trapRisk = wickScore > 60 ? Math.round(wickScore * 0.6) : 0;
  } else if (adx != null && adx >= 25) {
    regime = 'TREND';
    confidence = Math.min(90, Math.round(adx * 1.2));
    trendBias = rsi != null && rsi > 50 ? 'bullish' : 'bearish';
    volState = atrPct > 1.5 ? 'high' : 'normal';
    trapRisk = wickScore > 50 ? Math.round(wickScore * 0.4) : 0;
  } else if (atrPct > 2.0 || wickScore > 65) {
    regime = 'VOLATILE';
    confidence = Math.min(80, Math.round(atrPct * 20 + wickScore * 0.3));
    volState = 'high';
    trapRisk = Math.round(wickScore * 0.5);
  } else {
    regime = 'RANGE';
    confidence = Math.min(85, Math.round((100 - (adx || 15)) * 0.9));
    volState = atrPct < 0.5 ? 'low' : 'normal';
    trapRisk = brkScore > 20 ? Math.round(brkScore * 0.3) : 0;
  }

  return { regime: regime, confidence: confidence, trendBias: trendBias, volatilityState: volState, trapRisk: trapRisk };
}

// ══════════════════════════════════════════════════════════════════
// Confluence Score (pure math — reimplements confluence.js math only)
// Returns 0-100 score + component breakdown
// ══════════════════════════════════════════════════════════════════
function teacherCalcConfluence(rsi, macdDir, stDir, adx, regime) {
  var scores = [];
  var dirs = [];

  // RSI component
  if (rsi != null) {
    var rsiDir = rsi > 50 ? 'bull' : 'bear';
    var rsiScore = rsi > 70 ? 80 : rsi < 30 ? 80 : rsi > 55 ? 60 : rsi < 45 ? 60 : 50;
    scores.push({ name: 'RSI', score: rsiScore, dir: rsiDir });
    dirs.push(rsiDir);
  }

  // MACD component
  if (macdDir) {
    var macdScore = macdDir === 'bull' ? 75 : macdDir === 'bear' ? 25 : 50;
    scores.push({ name: 'MACD', score: macdScore, dir: macdDir });
    dirs.push(macdDir);
  }

  // SuperTrend component
  if (stDir) {
    var stScore = stDir === 'bull' ? 80 : stDir === 'bear' ? 20 : 50;
    scores.push({ name: 'ST', score: stScore, dir: stDir });
    dirs.push(stDir);
  }

  // ADX → trend strength bias
  if (adx != null) {
    var adxDir = adx >= 25 ? 'bull' : 'bear'; // strong trend = confirmed direction
    scores.push({ name: 'ADX', score: Math.min(100, adx * 2), dir: adxDir });
    dirs.push(adxDir);
  }

  // Regime context
  if (regime) {
    var regDir = regime === 'TREND' || regime === 'BREAKOUT' ? 'bull' : 'bear';
    scores.push({ name: 'REGIME', score: regime === 'TREND' ? 70 : regime === 'BREAKOUT' ? 80 : 40, dir: regDir });
    dirs.push(regDir);
  }

  if (dirs.length === 0) return { score: 50, components: [], alignment: 0 };

  var bullCount = 0;
  for (var i = 0; i < dirs.length; i++) if (dirs[i] === 'bull') bullCount++;
  var dirFactor = bullCount / dirs.length;
  var baseScore = dirFactor * 100;
  var signalBoost = dirs.length >= 4 ? 15 : dirs.length >= 2 ? 8 : 0;
  var final = Math.round(Math.max(0, Math.min(100,
    bullCount > dirs.length - bullCount ? baseScore + signalBoost : baseScore - signalBoost
  )));
  var alignment = Math.round(Math.abs(dirFactor - 0.5) * 200); // 0=split, 100=all agree

  return { score: final, components: scores, alignment: alignment };
}

// ══════════════════════════════════════════════════════════════════
// Swing Pivots (pure — from forecast.js)
// ══════════════════════════════════════════════════════════════════
function teacherSwingPivots(bars, lookback, win) {
  lookback = lookback || 60;
  win = win || 3;
  if (!bars || bars.length < lookback) return { highs: [], lows: [] };
  var slice = bars.slice(-lookback);
  var highs = [], lows = [];
  for (var i = win; i < slice.length - win; i++) {
    var isHigh = true, isLow = true;
    for (var j = 1; j <= win; j++) {
      if (slice[i].high <= slice[i - j].high || slice[i].high <= slice[i + j].high) isHigh = false;
      if (slice[i].low >= slice[i - j].low || slice[i].low >= slice[i + j].low) isLow = false;
    }
    if (isHigh) highs.push({ idx: i, price: slice[i].high, ts: slice[i].time });
    if (isLow)  lows.push({ idx: i, price: slice[i].low, ts: slice[i].time });
  }
  return { highs: highs.slice(-3), lows: lows.slice(-3) };
}

// ══════════════════════════════════════════════════════════════════
// Divergence Detection (pure — from forecast.js)
// Returns {type:'bull'|'bear', conf} or null
// ══════════════════════════════════════════════════════════════════
function teacherDetectDivergence(bars) {
  if (!bars || bars.length < 40) return null;
  var closes = [];
  for (var i = 0; i < bars.length; i++) closes.push(bars[i].close);
  var rsiArr = teacherCalcRSI(closes, 14);
  var validCount = 0;
  for (var i = 0; i < rsiArr.length; i++) if (rsiArr[i] !== null) validCount++;
  if (validCount < 10) return null;

  var pivots = teacherSwingPivots(bars, 80, 3);

  // Bear divergence: price higher high, RSI lower high
  var highs = pivots.highs;
  if (highs.length >= 2) {
    var ph1 = highs[highs.length - 2], ph2 = highs[highs.length - 1];
    var rsiH1 = rsiArr[ph1.idx] != null ? rsiArr[ph1.idx] : 50;
    var rsiH2 = rsiArr[ph2.idx] != null ? rsiArr[ph2.idx] : 50;
    if (ph2.price > ph1.price && rsiH2 < rsiH1 - 3) {
      var conf = Math.min(90, Math.round(50 + (ph2.price - ph1.price) / ph1.price * 800 + (rsiH1 - rsiH2) * 1.2));
      return { type: 'bear', conf: conf };
    }
  }
  // Bull divergence: price lower low, RSI higher low
  var lows = pivots.lows;
  if (lows.length >= 2) {
    var pl1 = lows[lows.length - 2], pl2 = lows[lows.length - 1];
    var rsiL1 = rsiArr[pl1.idx] != null ? rsiArr[pl1.idx] : 50;
    var rsiL2 = rsiArr[pl2.idx] != null ? rsiArr[pl2.idx] : 50;
    if (pl2.price < pl1.price && rsiL2 > rsiL1 + 3) {
      var conf2 = Math.min(90, Math.round(50 + (pl1.price - pl2.price) / pl1.price * 800 + (rsiL2 - rsiL1) * 1.2));
      return { type: 'bull', conf: conf2 };
    }
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════
// Volume Climax (pure — from forecast.js)
// Returns {dir:'buy'|'sell', mult} or null
// ══════════════════════════════════════════════════════════════════
function teacherDetectClimax(bars) {
  if (!bars || bars.length < 22) return null;
  var recent = bars.slice(-21);
  var sma = 0;
  for (var i = 0; i < 20; i++) sma += recent[i].volume;
  sma /= 20;
  if (sma <= 0) return null;
  var last = recent[recent.length - 1];
  var mult = last.volume / sma;
  if (mult < 3) return null;
  var dir = last.close < last.open ? 'sell' : 'buy';
  return { dir: dir, mult: parseFloat(mult.toFixed(2)) };
}

// ══════════════════════════════════════════════════════════════════
// Fee Estimation (pure — mirrors risk.js estimateRoundTripFees)
// ══════════════════════════════════════════════════════════════════
function teacherEstimateFees(notional, orderType, feeProfile) {
  var n = Math.abs(notional) || 0;
  var isLimit = (orderType || '').toUpperCase() === 'LIMIT';
  var feePct = isLimit ? TEACHER_FEES.makerPct : TEACHER_FEES.takerPct;
  var slipPct = TEACHER_FEES.slippage[feeProfile] || TEACHER_FEES.slippage.swing;
  var entryFee = n * feePct;
  var exitFee  = n * feePct;
  var slippage = n * slipPct;
  return { entryFee: entryFee, exitFee: exitFee, slippage: slippage, total: entryFee + exitFee + slippage };
}

// ══════════════════════════════════════════════════════════════════
// MASTER: Compute all indicators for a bar slice (up to cursor)
// Returns a full indicator snapshot — used by replay engine each tick
// ══════════════════════════════════════════════════════════════════
function teacherComputeIndicators(bars) {
  if (!bars || bars.length < 30) {
    return {
      rsi: null, adx: null, macd: null, macdSignal: null, macdHist: null,
      macdDir: 'neut', stDir: 'neut', atr: null,
      bbUpper: null, bbMiddle: null, bbLower: null, bbSqueeze: false, bbBandwidth: 0,
      regime: 'RANGE', regimeConf: 0, trendBias: 'neutral', volatilityState: 'normal', trapRisk: 0,
      confluence: 50, confluenceAlignment: 0,
      divergence: null, climax: null,
      wickChaos: 0, breakoutStr: 0,
    };
  }

  var closes = [];
  for (var i = 0; i < bars.length; i++) closes.push(bars[i].close);

  // Core indicators
  var rsiArr = teacherCalcRSI(closes);
  var rsi = rsiArr[rsiArr.length - 1];
  var adx = teacherCalcADX(bars);
  var macdData = teacherCalcMACD(closes);
  var macdDir = teacherDetectMACDDir(closes);
  var stDir = teacherDetectSTDir(bars);
  var atr = teacherCalcATR(bars);
  var bb = teacherCalcBB(closes);

  // Advanced
  var regimeData = teacherDetectRegime(bars, adx, rsi);
  var confData = teacherCalcConfluence(rsi, macdDir, stDir, adx, regimeData.regime);
  var divergence = teacherDetectDivergence(bars);
  var climax = teacherDetectClimax(bars);
  var wickChaos = teacherWickChaos(bars, 10);
  var breakoutStr = teacherBreakoutStrength(bars);

  return {
    rsi: rsi,
    adx: adx,
    macd: macdData ? macdData.macd : null,
    macdSignal: macdData ? macdData.signal : null,
    macdHist: macdData ? macdData.hist : null,
    macdDir: macdDir,
    stDir: stDir,
    atr: atr,
    bbUpper: bb ? bb.upper : null,
    bbMiddle: bb ? bb.middle : null,
    bbLower: bb ? bb.lower : null,
    bbSqueeze: bb ? bb.squeeze : false,
    bbBandwidth: bb ? bb.bandwidth : 0,
    regime: regimeData.regime,
    regimeConf: regimeData.confidence,
    trendBias: regimeData.trendBias,
    volatilityState: regimeData.volatilityState,
    trapRisk: regimeData.trapRisk,
    confluence: confData.score,
    confluenceAlignment: confData.alignment,
    divergence: divergence,
    climax: climax,
    wickChaos: wickChaos,
    breakoutStr: breakoutStr,
  };
}

// [P2] Node.js compatibility — export pure functions for server use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    teacherCalcRSI, teacherCalcADX, teacherCalcMACD, teacherDetectMACDDir,
    teacherCalcATR, teacherDetectSTDir, teacherCalcBB, teacherWickChaos,
    teacherBreakoutStrength, teacherDetectRegime, teacherCalcConfluence,
    teacherSwingPivots, teacherDetectDivergence, teacherDetectClimax,
    teacherEstimateFees, teacherComputeIndicators,
  };
}
