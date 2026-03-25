// Zeus v122 — brain/forecast.js
// Quantum Exit Brain, scenario engine, probability score
'use strict';

// QEB swing pivots
function _qebSwingPivots(bars, lookback, window) {
  try {
    lookback = lookback || 60;
    window = window || 3;
    var slice = bars.slice(-lookback);
    var highs = [], lows = [];
    for (var i = window; i < slice.length - window; i++) {
      var isHigh = true, isLow = true;
      for (var j = 1; j <= window; j++) {
        if (slice[i].high <= slice[i - j].high || slice[i].high <= slice[i + j].high) isHigh = false;
        if (slice[i].low >= slice[i - j].low || slice[i].low >= slice[i + j].low) isLow = false;
      }
      if (isHigh) highs.push({ idx: i, price: slice[i].high, ts: slice[i].time });
      if (isLow) lows.push({ idx: i, price: slice[i].low, ts: slice[i].time });
    }
    return { highs: highs.slice(-3), lows: lows.slice(-3) };
  } catch (e) { return { highs: [], lows: [] }; }
}

// ── (A1a) Divergence Detector ────────────────────────────────────
// Uses swing pivots + RSI peaks/valleys. Returns {type, conf} or null.
// 2-pivot minimum (needs 2 swings to compare).
// [v105 FIX Bug2] calcRSIArr la nivel GLOBAL — returneaza array RSI per-bara (anterior era locala in initCharts)
// calcRSI() returna scalar; _qebDetectDivergence avea nevoie de array indexat per pivot — complet rupt
function calcRSIArr(prices, p) {
  p = p || 14;
  var out = new Array(prices.length).fill(null);
  if (prices.length < p + 1) return out;
  var g = 0, l = 0;
  for (var i = 1; i <= p; i++) { var d = prices[i] - prices[i - 1]; if (d > 0) g += d; else l += Math.abs(d); }
  var ag = g / p, al = l / p;
  out[p] = al === 0 ? 100 : 100 - (100 / (1 + (ag / al)));
  for (var i = p + 1; i < prices.length; i++) {
    var d = prices[i] - prices[i - 1];
    if (d > 0) { ag = (ag * (p - 1) + d) / p; al = al * (p - 1) / p; }
    else { ag = ag * (p - 1) / p; al = (al * (p - 1) + Math.abs(d)) / p; }
    out[i] = al === 0 ? 100 : 100 - (100 / (1 + (ag / al)));
  }
  return out;
}

function _qebDetectDivergence(bars, rsiNow) {
  try {
    if (!bars || bars.length < 40) return null;
    var pivots = _qebSwingPivots(bars, 80, 3);
    var closes = bars.map(function (b) { return b.close; });
    // [v105 FIX Bug2] folosim calcRSIArr (array per-bara) in loc de calcRSI (scalar)
    var rsiArr = calcRSIArr(closes, 14);
    var validCount = rsiArr.filter(function (v) { return v !== null; }).length;
    if (!rsiArr || validCount < 10) return null;

    // [FIX QA-H6] Pivot indices are relative to bars.slice(-80). Offset to full array.
    var sliceOffset = Math.max(0, bars.length - 80);

    // Bear divergence: price makes higher high but RSI makes lower high
    var highs = pivots.highs;
    if (highs.length >= 2) {
      var ph1 = highs[highs.length - 2];
      var ph2 = highs[highs.length - 1];
      var rsiH1 = rsiArr[sliceOffset + ph1.idx] != null ? rsiArr[sliceOffset + ph1.idx] : 50;
      var rsiH2 = rsiArr[sliceOffset + ph2.idx] != null ? rsiArr[sliceOffset + ph2.idx] : 50;
      if (ph2.price > ph1.price && rsiH2 < rsiH1 - 3) {
        var conf = Math.min(90, Math.round(50 + (ph2.price - ph1.price) / ph1.price * 800
          + (rsiH1 - rsiH2) * 1.2));
        return { type: 'bear', conf: conf };
      }
    }
    // Bull divergence: price makes lower low but RSI makes higher low
    var lows = pivots.lows;
    if (lows.length >= 2) {
      var pl1 = lows[lows.length - 2];
      var pl2 = lows[lows.length - 1];
      var rsiL1 = rsiArr[sliceOffset + pl1.idx] != null ? rsiArr[sliceOffset + pl1.idx] : 50;
      var rsiL2 = rsiArr[sliceOffset + pl2.idx] != null ? rsiArr[sliceOffset + pl2.idx] : 50;
      if (pl2.price < pl1.price && rsiL2 > rsiL1 + 3) {
        var conf2 = Math.min(90, Math.round(50 + (pl1.price - pl2.price) / pl1.price * 800
          + (rsiL2 - rsiL1) * 1.2));
        return { type: 'bull', conf: conf2 };
      }
    }
    return null;
  } catch (e) { return null; }
}

// ── (A1b) Volume Climax Detector ─────────────────────────────────
// volCur > 3 × SMA20(volume) AND candle direction contra position.
// Returns {dir, mult} or null.
function _qebDetectClimax(bars) {
  try {
    if (!bars || bars.length < 22) return null;
    var recent = bars.slice(-21);
    var sma20vol = recent.slice(0, 20).reduce(function (a, b) { return a + b.volume; }, 0) / 20;
    if (sma20vol <= 0) return null;
    var last = recent[recent.length - 1];
    var mult = last.volume / sma20vol;
    if (mult < 3) return null;
    var dir = last.close < last.open ? 'sell' : 'buy';
    return { dir: dir, mult: parseFloat(mult.toFixed(2)) };
  } catch (e) { return null; }
}

// ── (A1c) Regime Flip Detector ───────────────────────────────────
// Detects trend→range or trend→reversal using BRAIN.regime history.
// Returns {from, to, conf} or null.
var _qebLastRegime = null;
// [S2B1-T1] Reset forecast state on symbol change — called from setSymbol()
function resetForecast() { _qebLastRegime = null; }
function _qebDetectRegimeFlip() {
  try {
    var cur = (typeof BRAIN !== 'undefined') ? BRAIN.regime : null;
    var conf = (typeof BRAIN !== 'undefined') ? (BRAIN.regimeConfidence || 0) : 0;
    if (!cur) return null;
    if (_qebLastRegime && _qebLastRegime !== cur) {
      var prev = _qebLastRegime;
      _qebLastRegime = cur;
      // Only signal flip if previous was trend/breakout → now range/volatile
      var wasStrong = (prev === 'trend' || prev === 'breakout');
      var isWeaker = (cur === 'range' || cur === 'volatile');
      if (wasStrong && isWeaker) {
        return { from: prev, to: cur, conf: conf };
      }
    }
    _qebLastRegime = cur;
    return null;
  } catch (e) { return null; }
}

// ── (A1d) Liquidity Proximity ────────────────────────────────────
// Returns {nearestAboveDistPct, nearestBelowDistPct, bias}.
function _qebLiquidityProximity() {
  try {
    var price = S && S.price ? S.price : 0;
    if (!price) return { nearestAboveDistPct: null, nearestBelowDistPct: null, bias: 'neutral' };
    var magnets = (S && S.magnets) ? S.magnets : { above: [], below: [] };
    var above = magnets.above && magnets.above[0];
    var below = magnets.below && magnets.below[0];
    var distA = above ? ((above.price - price) / price * 100) : null;
    var distB = below ? ((price - below.price) / price * 100) : null;
    var bias = (S && S.magnetBias) ? S.magnetBias : 'neutral';
    return { nearestAboveDistPct: distA, nearestBelowDistPct: distB, bias: bias };
  } catch (e) { return { nearestAboveDistPct: null, nearestBelowDistPct: null, bias: 'neutral' }; }
}
// ── QEB: Position R-multiple calculator ───────────────────────
function _posR(pos) {
  if (!pos || !pos.entry || !pos.sl) return null;
  var price = (typeof S !== 'undefined' && S.price) ? S.price : pos.entry;
  var risk = Math.abs(pos.entry - pos.sl);
  if (risk <= 0) return null;
  var profit = pos.side === 'LONG' ? price - pos.entry : pos.entry - price;
  return profit / risk;
}
// ── (A2) Compute Exit Risk Score (0–100) ─────────────────────────
function computeExitRisk(posDir) {
  try {
    posDir = posDir || 'LONG';
    var risk = 0;
    var sigs = BM.qexit.signals;

    // Divergence: up to 35 pts
    var div = sigs.divergence;
    if (div.type) {
      var divContra = (posDir === 'LONG' && div.type === 'bear') ||
        (posDir === 'SHORT' && div.type === 'bull');
      if (divContra) risk += Math.round(div.conf * 0.35);
    }

    // Climax: up to 40 pts
    var clim = sigs.climax;
    if (clim.dir) {
      var climContra = (posDir === 'LONG' && clim.dir === 'sell') ||
        (posDir === 'SHORT' && clim.dir === 'buy');
      if (climContra) risk += Math.min(40, Math.round(clim.mult * 12));
    }

    // Regime flip: up to 20 pts
    var flip = sigs.regimeFlip;
    if (flip.from && flip.to) {
      // Any flip away from trend is bad for open positions
      risk += Math.round(flip.conf * 0.20);
    }

    // Liquidity trap zone: +10–20 if very close to magnet in contra direction
    var liq = sigs.liquidity;
    // [FIX QA-H9] Use else-if to prevent double-counting proximity risk
    if (posDir === 'LONG' && liq.nearestAboveDistPct !== null && liq.nearestAboveDistPct < 0.4) risk += 18;
    else if (posDir === 'LONG' && liq.nearestAboveDistPct !== null && liq.nearestAboveDistPct < 1.0) risk += 8;
    if (posDir === 'SHORT' && liq.nearestBelowDistPct !== null && liq.nearestBelowDistPct < 0.4) risk += 18;
    else if (posDir === 'SHORT' && liq.nearestBelowDistPct !== null && liq.nearestBelowDistPct < 1.0) risk += 8;

    // OFI/OI contra: up to 15 pts
    var ofi = (typeof BRAIN !== 'undefined' && BRAIN.ofi) ? (BRAIN.ofi.blendBuy || 50) : 50;
    if (posDir === 'LONG' && ofi < 35) risk += Math.round((35 - ofi) * 0.5);
    if (posDir === 'SHORT' && ofi > 65) risk += Math.round((ofi - 65) * 0.5);
    if (S && S.oi && S.oiPrev && S.oiPrev > 0) {
      var oiChg = (S.oi - S.oiPrev) / S.oiPrev * 100;
      if (posDir === 'LONG' && oiChg < -1.5) risk += Math.min(10, Math.round(Math.abs(oiChg) * 2));
      if (posDir === 'SHORT' && oiChg > 1.5) risk += Math.min(10, Math.round(oiChg * 2));
    }

    return Math.min(100, Math.max(0, Math.round(risk)));
  } catch (e) { return 0; }
}

// ── (A3) Decide Exit Action ──────────────────────────────────────
// Does NOT execute anything. Returns action string only.
function decideExitAction(risk, posDir, dslActive) {
  try {
    // 2-bar confirm gate: divergence OR climax must be confirmed ≥2 bars
    var confirmed = (BM.qexit.confirm.div >= 2) || (BM.qexit.confirm.climax >= 2);

    // [Etapa 5] Adaptive exitMult: ajustează doar emergency threshold
    // Gated: BM.adaptive.enabled && exitMult !== 1.0
    var baseEmergency = 80;
    var emergencyTh = (BM.adapt && BM.adapt.enabled && BM.adapt.exitMult !== 1.0)
      ? Math.round(baseEmergency / BM.adapt.exitMult)
      : baseEmergency;
    // Clamp threshold să nu devină absurd (ex: nu sub 65, nu peste 90)
    emergencyTh = Math.max(65, Math.min(90, emergencyTh));

    if (risk < 40) return 'HOLD';
    if (risk < 60) return 'TIGHTEN';
    if (risk < emergencyTh) {
      if (!confirmed) return 'TIGHTEN'; // not confirmed → downgrade
      return dslActive ? 'TIGHTEN' : 'REDUCE';
    }
    // risk >= emergencyTh
    if (!confirmed) return 'TIGHTEN_HARD'; // need 2-bar confirm for EMERGENCY
    if (dslActive) {
      var smartOn = USER_SETTINGS && USER_SETTINGS.autoTrade &&
        USER_SETTINGS.autoTrade.smartExitEnabled === true;
      var divConf = BM.qexit.signals.divergence.conf >= 70;
      var climConf = BM.qexit.signals.climax.mult >= 3;
      var doubleConfirmed = divConf && climConf;
      if (smartOn && doubleConfirmed) return 'EMERGENCY';
      return 'TIGHTEN_HARD';
    }
    return 'EMERGENCY';
  } catch (e) { return 'HOLD'; }
}

// ── (A4) Apply Quantum Exit (advisory-first, exec gated) ─────────
function applyQuantumExit(pos) {
  try {
    if (!pos) return;
    // Cooldown: 60s per position
    var now = Date.now();
    if (now - BM.qexit.lastTs < 60000) return;

    var action = BM.qexit.action;
    var risk = BM.qexit.risk;
    // Profit Gate: if position hasn't reached 0.25R, no tighten/close — advisory only
    var r = _posR(pos);
    if (r !== null && r < 0.25) {
      // Below 0.25R: too early, advisory log only, no action
      if (DEV.enabled && action !== 'HOLD') devLog('[QEB] Profit gate: R=' + r.toFixed(2) + ' < 0.25 → no action', 'info');
      return;
    }

    var smartOn = USER_SETTINGS && USER_SETTINGS.autoTrade &&
      USER_SETTINGS.autoTrade.smartExitEnabled === true;
    var dslActive = (typeof DSL !== 'undefined') &&
      DSL.enabled &&
      DSL.positions &&
      DSL.positions[String(pos.id)] &&
      DSL.positions[String(pos.id)].active === true;
    var reason = 'QEB: ' + action + ' | risk=' + risk + ' | dsl=' + (dslActive ? 'ON' : 'OFF');

    if (action === 'HOLD') return;

    BM.qexit.lastTs = now;
    BM.qexit.lastReason = reason;

    // ── TIGHTEN / TIGHTEN_HARD — advisory only, no close ─────────
    if (action === 'TIGHTEN' || action === 'TIGHTEN_HARD') {
      // Set shadowStop for UI display — does NOT touch DSL
      if (S.atr && pos.entry) {
        var atrMult = action === 'TIGHTEN_HARD' ? 1.0 : 1.5;
        var shadowVal = pos.side === 'LONG'
          ? pos.entry + (S.atr * atrMult)   // tighten above entry as floor ref
          : pos.entry - (S.atr * atrMult);
        BM.qexit.shadowStop = shadowVal;
      }
      _qebNotify(action, reason, pos);
      return;
    }

    // ── REDUCE — only if partial close hook available ─────────────
    if (action === 'REDUCE') {
      // v1: no partial close hook available → fallback to TIGHTEN_HARD advisory
      _qebNotify('TIGHTEN_HARD', reason + ' [no partial close — advisory]', pos);
      return;
    }

    // ── EMERGENCY — gated: smartExitEnabled must be true ─────────
    if (action === 'EMERGENCY') {
      if (!smartOn) {
        // Advisory only — user must enable smart exit
        _qebNotify('EMERGENCY_ADVISORY', reason + ' [auto-exec disabled]', pos);
        return;
      }
      // Extra safety: DSL active → no close unless double-confirmed (handled in decideExitAction)
      // If we reach here: smartOn + action already decided by decideExitAction
      if (typeof closeDemoPos === 'function') {
        closeDemoPos(pos.id, reason);
        _qebNotify('EMERGENCY_EXEC', reason, pos);
        if (typeof srRecord === 'function') {
          try { srRecord('qexit', 'EMERGENCY EXIT', pos.side, risk); } catch (_) { }
        }
      }
    }

  } catch (e) {
    console.warn('[QEB] applyQuantumExit error:', e.message);
  }
}

// ── Notify helper ────────────────────────────────────────────────
function _qebNotify(action, reason, pos) {
  try {
    var sym = pos ? (pos.sym || S.symbol || 'BTC') : (S.symbol || 'BTC');
    var msg = 'QEB [' + sym + '] ' + action + ': ' + reason;
    if (typeof ncAdd === 'function') ncAdd('warning', 'qexit', msg);
    if (typeof devLog === 'function') devLog(msg, action.includes('EMERGENCY') ? 'error' : 'warning');
  } catch (e) { /* silent */ }
}

// ── Main QEB update loop ─────────────────────────────────────────
function runQuantumExitUpdate() {
  try {
    var bars = S.chartBars || S.klines || [];
    if (!bars.length || !S.price) return;

    var rsiNow = (S.rsiData && S.rsiData['5m']) || (S.rsi && S.rsi['5m']) || 50;

    // Run detectors — update BM.qexit.signals
    var divResult = _qebDetectDivergence(bars, rsiNow);
    var climResult = _qebDetectClimax(bars);
    var flipResult = _qebDetectRegimeFlip();
    var liqResult = _qebLiquidityProximity();

    BM.qexit.signals.divergence = divResult || { type: null, conf: 0 };
    BM.qexit.signals.climax = climResult || { dir: null, mult: 0 };
    BM.qexit.signals.regimeFlip = flipResult || { from: null, to: null, conf: 0 };
    BM.qexit.signals.liquidity = liqResult;

    // Find first open position for risk calc (auto positions first)
    var openPos = null;
    if (typeof TP !== 'undefined' && TP.demoPositions) {
      openPos = TP.demoPositions.find(function (p) { return !p.closed && p.autoTrade; })
        || TP.demoPositions.find(function (p) { return !p.closed; });
    }

    var posDir = openPos ? openPos.side : 'LONG';
    var dslActive = openPos && typeof DSL !== 'undefined' && DSL.enabled &&
      DSL.positions && DSL.positions[openPos.id] &&
      DSL.positions[openPos.id].active === true;

    // Update 2-bar confirm counters
    var sig = BM.qexit.signals;
    if (sig.divergence.type) BM.qexit.confirm.div = Math.min(2, BM.qexit.confirm.div + 1);
    else BM.qexit.confirm.div = Math.max(0, BM.qexit.confirm.div - 1);
    if (sig.climax.dir) BM.qexit.confirm.climax = Math.min(2, BM.qexit.confirm.climax + 1);
    else BM.qexit.confirm.climax = Math.max(0, BM.qexit.confirm.climax - 1);

    // Compute risk + macro-adjust
    var rawRisk = computeExitRisk(posDir);
    var risk = macroAdjustExitRisk(rawRisk);
    BM.qexit.risk = risk;
    BM.qexit.action = decideExitAction(risk, posDir, dslActive);

    // Apply (advisory or exec depending on toggle)
    if (openPos) applyQuantumExit(openPos);

    // Compute prob score regardless of open position
    computeProbScore(posDir);

    // Update scenario
    updateScenarioData();

    // Update UI
    _qebUpdateRiskUI();

  } catch (e) {
    console.warn('[QEB] runQuantumExitUpdate error:', e.message);
  }
}

// ── Update risk bar UI ───────────────────────────────────────────
function _qebUpdateRiskUI() {
  try {
    var hasPos = typeof TP !== 'undefined' && TP.demoPositions &&
      TP.demoPositions.some(function (p) { return !p.closed; });
    var strip = document.getElementById('qexit-risk-strip');
    if (strip) strip.style.display = hasPos ? '' : 'none';
    if (!hasPos) return;

    var risk = BM.qexit.risk;
    var action = BM.qexit.action;

    var fillEl = document.getElementById('qexit-bar-fill');
    var valEl = document.getElementById('qexit-risk-val');
    var badgeEl = document.getElementById('qexit-action-badge');
    var sigsEl = document.getElementById('qexit-sigs-detail');
    var advEl = document.getElementById('qexit-advisory');

    var col = risk < 40 ? '#556677' : risk < 60 ? '#f0c040' : risk < 80 ? '#ff8844' : '#ff2244';
    if (fillEl) { fillEl.style.width = risk + '%'; fillEl.style.background = col; }
    if (valEl) { valEl.textContent = risk; valEl.style.color = col; }
    if (badgeEl) { badgeEl.textContent = action; badgeEl.className = 'qexit-action ' + action; }

    // Signal details
    if (sigsEl) {
      var sigs = BM.qexit.signals;
      var fmtPFn = typeof fP === 'function' ? fP : function (n) { return n.toFixed(1); };
      var rows = [];
      if (sigs.divergence.type) {
        rows.push('<span class="qexit-sig-name">DIVERGENCE</span> '
          + (sigs.divergence.type === 'bear' ? '<span style="color:#ff4455">BEAR</span>' : '<span style="color:#00d97a">BULL</span>')
          + ' <span style="color:#556677">conf ' + sigs.divergence.conf + '%</span>');
      }
      if (sigs.climax.dir) {
        rows.push('<span class="qexit-sig-name">VOL CLIMAX</span> '
          + (sigs.climax.dir === 'sell' ? '<span style="color:#ff4455">SELL</span>' : '<span style="color:#00d97a">BUY</span>')
          + ' <span style="color:#556677">×' + sigs.climax.mult + ' avg</span>');
      }
      if (sigs.regimeFlip.from) {
        rows.push('<span class="qexit-sig-name">REGIME FLIP</span> '
          + '<span style="color:#f0c040">' + sigs.regimeFlip.from.toUpperCase() + ' → ' + sigs.regimeFlip.to.toUpperCase() + '</span>');
      }
      if (sigs.liquidity.nearestAboveDistPct !== null) {
        rows.push('<span class="qexit-sig-name">LIQ ABOVE</span> '
          + '<span style="color:#8fa0b0">+' + (sigs.liquidity.nearestAboveDistPct).toFixed(2) + '%</span>');
      }
      sigsEl.innerHTML = rows.map(function (r) {
        return '<div class="qexit-sig-row">' + r + '</div>';
      }).join('');
    }

    // Advisory line
    if (advEl) {
      var smartOn = USER_SETTINGS && USER_SETTINGS.autoTrade &&
        USER_SETTINGS.autoTrade.smartExitEnabled === true;
      advEl.innerHTML = smartOn
        ? _ZI.bolt + ' Smart Exit ENABLED — emergency actions may execute.'
        : _ZI.eye + ' Advisory mode — enable Smart Exit in Settings Hub to allow auto-exec.';
      advEl.style.color = smartOn ? '#f0c040' : '#556677';
    }
  } catch (e) { /* silent */ }
}

// ════════════════════════════════════════════════════════════════
// (B) PROBABILISTIC CONFLUENCE SCORE
// Weighted sum (v1 — no logistic regression yet)
// Reads: BRAIN.regime, S.magnets, S.signalData, BRAIN.ofi, S.fr, S.oi
// Writes: BM.probScore, BM.probBreakdown (additive fields only)

// Prob score
function computeProbScore(dir) {
  try {
    dir = dir || 'LONG';
    var regime = (typeof BRAIN !== 'undefined') ? (BRAIN.regime || 'unknown') : 'unknown';
    var regConf = (typeof BRAIN !== 'undefined') ? (BRAIN.regimeConfidence || 0) : 0;
    var regSlope = (typeof BRAIN !== 'undefined') ? (BRAIN.regimeSlope || 0) : 0;
    var ofi = (typeof BRAIN !== 'undefined' && BRAIN.ofi) ? (BRAIN.ofi.blendBuy || 50) : 50;
    var bullC = (S.signalData && S.signalData.bullCount) || 0;
    var bearC = (S.signalData && S.signalData.bearCount) || 0;
    var liq = _qebLiquidityProximity();

    // 1. Regime alignment (0–35)
    var regScore = 0;
    if (regime === 'trend') {
      var aligned = (dir === 'LONG' && regSlope > 0) || (dir === 'SHORT' && regSlope < 0);
      regScore = aligned ? Math.min(35, Math.round(regConf * 0.35)) : Math.round(regConf * 0.10);
    } else if (regime === 'breakout') {
      regScore = 22;
    } else if (regime === 'range') {
      regScore = 12;
    } else if (regime === 'volatile') {
      regScore = 5;
    }

    // 2. Liquidity bias + distance (0–25)
    var liqScore = 10; // neutral base
    if (liq.bias === dir.toLowerCase().replace('long', 'bull').replace('short', 'bear')) liqScore += 10;
    if (dir === 'LONG' && liq.nearestBelowDistPct !== null && liq.nearestBelowDistPct > 1.5) liqScore += 5;
    if (dir === 'SHORT' && liq.nearestAboveDistPct !== null && liq.nearestAboveDistPct > 1.5) liqScore += 5;
    liqScore = Math.min(25, liqScore);

    // 3. Signal alignment bull/bear counts (0–25)
    var sigScore = 0;
    var relevantC = (dir === 'LONG') ? bullC : bearC;
    sigScore = Math.min(25, Math.round(relevantC * 6));

    // 4. Flow/OI/funding confirmation (0–15)
    var flowScore = 0;
    if (dir === 'LONG' && ofi > 55) flowScore += Math.min(8, Math.round((ofi - 55) * 0.5));
    if (dir === 'SHORT' && ofi < 45) flowScore += Math.min(8, Math.round((45 - ofi) * 0.5));
    if (S.fr !== null && S.fr !== undefined) {
      if (dir === 'LONG' && S.fr < 0) flowScore += 4;  // shorts paying → bullish
      if (dir === 'SHORT' && S.fr > 0) flowScore += 4;  // longs paying  → bearish
    }
    if (S.oi && S.oiPrev && S.oiPrev > 0) {
      var oiChg2 = (S.oi - S.oiPrev) / S.oiPrev * 100;
      if (dir === 'LONG' && oiChg2 > 0.5) flowScore += 3;
      if (dir === 'SHORT' && oiChg2 < -0.5) flowScore += 3;
    }
    flowScore = Math.min(15, flowScore);

    var total = Math.min(100, regScore + liqScore + sigScore + flowScore);

    BM.probScore = total;
    BM.probBreakdown = { regime: regScore, liquidity: liqScore, signals: sigScore, flow: flowScore };

    return total;
  } catch (e) {
    console.warn('[QEB] computeProbScore error:', e.message);
    return 0;
  }
}

// ════════════════════════════════════════════════════════════════
// (C) SCENARIO ENGINE — read-only, UI
// Writes: S.scenario (additive field)
// Never modifies logic, BRAIN, AT, BM trading params.
// ════════════════════════════════════════════════════════════════

// Scenario data
function updateScenarioData() {
  try {
    var regime = (typeof BRAIN !== 'undefined') ? (BRAIN.regime || 'unknown') : 'unknown';
    var regConf = (typeof BRAIN !== 'undefined') ? (BRAIN.regimeConfidence || 0) : 0;
    var regSlope = (typeof BRAIN !== 'undefined') ? (BRAIN.regimeSlope || 0) : 0;
    var price = S.price || 0;
    var liq = _qebLiquidityProximity();
    var bullC = (S.signalData && S.signalData.bullCount) || 0;
    var bearC = (S.signalData && S.signalData.bearCount) || 0;
    var fPFn = typeof fP === 'function' ? fP : function (n) { return n.toFixed(1); };
    var fmtFn = typeof fmt === 'function' ? fmt : function (n) { return n.toFixed(0); };

    var prob = BM.probScore;
    var isBull = (bullC >= bearC) && ((typeof BRAIN !== 'undefined') ? regSlope >= 0 : true);
    var dir = isBull ? 'LONG' : 'SHORT';

    // ── Primary scenario ─────────────────────────────────────────
    var nearTarget = isBull
      ? (S.magnets && S.magnets.above && S.magnets.above[0]
        ? '$' + fPFn(S.magnets.above[0].price)
        : 'next resistance')
      : (S.magnets && S.magnets.below && S.magnets.below[0]
        ? '$' + fPFn(S.magnets.below[0].price)
        : 'next support');
    var primary = (isBull ? _ZI.tup + ' Bullish' : _ZI.drop + ' Bearish')
      + ' — ' + regime.toUpperCase() + ' regime'
      + (regConf > 0 ? ' (' + regConf + '% conf)' : '')
      + '. Target: ' + nearTarget + '.';

    // ── Alternate scenario ───────────────────────────────────────
    var altTarget = isBull
      ? (S.magnets && S.magnets.below && S.magnets.below[0]
        ? '$' + fPFn(S.magnets.below[0].price)
        : 'nearby support')
      : (S.magnets && S.magnets.above && S.magnets.above[0]
        ? '$' + fPFn(S.magnets.above[0].price)
        : 'nearby resistance');
    var altConf = Math.max(10, Math.round(100 - prob));
    var alternate = (isBull ? _ZI.drop + ' Bear reversal' : _ZI.tup + ' Bull reversal')
      + ' scenario (' + altConf + '% alt conf)'
      + '. Watch ' + altTarget + ' for early signs.';

    // ── Failure / Invalidation level ─────────────────────────────
    var failLevel = null;
    if (isBull && S.magnets && S.magnets.below && S.magnets.below[0]) {
      failLevel = S.magnets.below[0].price;
    } else if (!isBull && S.magnets && S.magnets.above && S.magnets.above[0]) {
      failLevel = S.magnets.above[0].price;
    }
    var divSig = BM.qexit.signals.divergence.type;
    var climSig = BM.qexit.signals.climax.dir;
    var failure = 'Invalidation: '
      + (failLevel ? ('close ' + (isBull ? 'below' : 'above') + ' $' + fPFn(failLevel)) : 'loss of structural support')
      + (divSig ? ' + ' + divSig + ' divergence' : '')
      + (climSig ? ' + vol climax (' + climSig + ')' : '')
      + ' would cancel this scenario.';

    S.scenario = {
      primary: primary,
      alternate: alternate,
      failure: failure,
      updated: Date.now(),
    };

  } catch (e) {
    console.warn('[QEB] updateScenarioData error:', e.message);
  }
}

function updateScenarioUI() {
  try {
    var el = document.getElementById('scenario-content');
    var upd = document.getElementById('scenario-upd');
    if (!el) return;

    if (!S.price || !S.klines || S.klines.length < 20) {
      el.innerHTML = '<div style="text-align:center;padding:14px;color:var(--dim);font-size:12px">Waiting for market data...</div>';
      return;
    }

    var sc = S.scenario;
    if (!sc || !sc.primary) {
      el.innerHTML = '<div style="text-align:center;padding:14px;color:var(--dim);font-size:12px">Computing scenarios...</div>';
      return;
    }

    var probStr = BM.probScore;
    var probCls = probStr >= 65 ? 'hi' : probStr >= 40 ? 'med' : 'lo';

    el.innerHTML =
      '<div class="sc-block primary">'
      + '<div class="sc-label primary">' + _ZI.dGrn + ' PRIMARY <span class="sc-conf ' + probCls + '">' + probStr + '% prob</span></div>'
      + '<div class="sc-text">' + sc.primary + '</div>'
      + '</div>'
      + '<div class="sc-block alternate">'
      + '<div class="sc-label alternate">' + _ZI.dYlw + ' ALTERNATE</div>'
      + '<div class="sc-text">' + sc.alternate + '</div>'
      + '</div>'
      + '<div class="sc-block failure">'
      + '<div class="sc-label failure">' + _ZI.w + ' INVALIDATION</div>'
      + '<div class="sc-text">' + sc.failure + '</div>'
      + '</div>';

    if (upd) upd.textContent = 'updated ' + (typeof fmtNow === 'function' ? fmtNow() : '');
  } catch (e) {
    console.warn('[QEB] updateScenarioUI error:', e.message);
  }
}

