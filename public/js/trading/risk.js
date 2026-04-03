// Zeus v122 — trading/risk.js
// Macro cortex, adaptive parameters, performance tracking
'use strict';

// Macro cortex computation
function computeMacroCortex() {
  try {
    var now = Date.now();
    var prev = BM.macro.composite || 0;

    // Regime component (0..40)
    var reg = (typeof BRAIN !== 'undefined') ? (BRAIN.regime || 'unknown') : 'unknown';
    var regConf = _clamp((typeof BRAIN !== 'undefined' ? (BRAIN.regimeConfidence || 0) : 0), 0, 100) / 100;
    var regScore = 20;
    if (reg.includes('trend')) regScore = 30;
    if (reg.includes('breakout')) regScore = 34;
    if (reg.includes('range')) regScore = 18;
    if (reg.includes('volatile')) regScore = 14;
    regScore *= (0.6 + 0.4 * regConf);

    // Volatility penalty via ATR% (0..25)
    var atrPct = _clamp((typeof BRAIN !== 'undefined' ? (BRAIN.regimeAtrPct || 0) : 0) * 100, 0, 8);
    var volScore = _clamp(25 - atrPct * 3, 0, 25);

    // Flow score from OFI (0..20)
    var flowScore = 10;
    if (typeof BRAIN !== 'undefined' && BRAIN.ofi) {
      var buy = BRAIN.ofi.buy || 0;
      var sell = BRAIN.ofi.sell || 0;
      var bias = (buy + sell > 0) ? (buy - sell) / (buy + sell) : 0;
      flowScore = 10 + bias * 10;
    }

    // Sentiment (0..15) — read from DOM F&G widget; fallback 7
    var sentScore = 7;
    try {
      var fgEl = document.getElementById('fgval');
      var fgRaw = fgEl ? parseInt(fgEl.textContent) : NaN;
      if (!isNaN(fgRaw) && fgRaw >= 0 && fgRaw <= 100) {
        // Map 0-100 F&G to 0-15 (50=neutral=7.5, extremes push up/down)
        sentScore = _clamp(Math.round((fgRaw / 100) * 15), 0, 15);
      }
    } catch (_) { }

    var composite = _clamp(Math.round(regScore + volScore + flowScore + sentScore), 0, 100);
    var slope = _clamp((composite - prev) / 25, -1, 1);

    BM.macro.cycleScore = composite;
    BM.macro.flowScore = _clamp(Math.round(flowScore * 5), 0, 100);
    BM.macro.sentimentScore = _clamp(Math.round(sentScore * 6.6), 0, 100);
    BM.macro.composite = composite;
    BM.macro.slope = parseFloat(slope.toFixed(3));
    BM.macro.phase = _macroPhaseFromComposite(composite);
    BM.macro.confidence = _clamp(Math.round(30 + (typeof BRAIN !== 'undefined' ? (BRAIN.regimeConfidence || 0) : 0) * 0.7), 0, 100);
    BM.macro.lastUpdate = now;

    // Update adapt.lastPhase if changed
    if (BM.adapt.lastPhase !== BM.macro.phase) {
      if (DEV.enabled) devLog('[Macro] Phase: ' + BM.adapt.lastPhase + ' → ' + BM.macro.phase + ' (' + composite + ')', 'info');
      BM.adapt.lastPhase = BM.macro.phase;
    }

    // Recompute sizing after macro update
    computePositionSizingMult();
    // Update UI
    updateMacroUI();

  } catch (e) {
    console.warn('[Macro] computeMacroCortex error:', e.message);
  }
}

function updateMacroUI() {
  try {
    var m = BM.macro;
    var ps = BM.positionSizing;
    var ph = m.phase || 'NEUTRAL';
    var col = {
      ACCUMULATION: 'var(--grn)', EARLY_BULL: '#44eebb', LATE_BULL: 'var(--gold)',
      DISTRIBUTION: 'var(--orange)', TOP_RISK: 'var(--red)', NEUTRAL: 'var(--txt-dim)'
    }[ph] || 'var(--txt-dim)';

    var badge = document.getElementById('macro-phase-badge');
    if (badge) {
      badge.textContent = ph.replace('_', ' ');
      badge.className = 'macro-phase-' + ph;
    }
    var conf = document.getElementById('macro-conf');
    if (conf) conf.textContent = 'conf ' + m.confidence + '%';

    var adaptSt = document.getElementById('macro-adapt-status');
    if (adaptSt) {
      adaptSt.textContent = BM.adapt.enabled ? 'ADAPT ON' : 'ADAPT OFF';
      adaptSt.style.color = BM.adapt.enabled ? 'var(--grn)' : 'var(--dim)';
    }

    var bar = document.getElementById('macro-composite-bar');
    if (bar) { bar.style.width = m.composite + '%'; bar.style.background = col; }
    var compVal = document.getElementById('macro-composite-val');
    if (compVal) { compVal.textContent = m.composite; compVal.style.color = col; }

    var setTxt = function (id, val) { var e = document.getElementById(id); if (e) e.textContent = val; };
    setTxt('macro-cycle-val', m.cycleScore);
    setTxt('macro-flow-val', m.flowScore);
    setTxt('macro-sent-val', m.sentimentScore);
    setTxt('macro-slope-val', m.slope > 0 ? '▲' + m.slope.toFixed(2) : m.slope < 0 ? '▼' + Math.abs(m.slope).toFixed(2) : '—');

    var sizeMult = document.getElementById('macro-size-mult');
    if (sizeMult) { sizeMult.textContent = '×' + (ps.finalMult || 1).toFixed(2); sizeMult.style.color = ps.finalMult > 1 ? 'var(--grn)' : ps.finalMult < 1 ? 'var(--orange)' : 'var(--gold)'; }
    var perfMult = document.getElementById('macro-perf-mult');
    if (perfMult) perfMult.textContent = '×' + (ps.perfMult || 1).toFixed(2);

    // Per-regime perf table
    var tbl = document.getElementById('macro-perf-table');
    if (tbl && BM.performance && BM.performance.byRegime) {
      tbl.innerHTML = Object.keys(BM.performance.byRegime).map(function (k) {
        var r = BM.performance.byRegime[k];
        var wr = r.trades > 0 ? Math.round(r.wins / r.trades * 100) : null;
        var isCur = (k === ph);
        return '<div style="display:flex;justify-content:space-between;' + (isCur ? 'color:var(--gold)' : '') + '">'
          + '<span>' + k.replace('_', ' ') + (isCur ? ' ◀' : '') + '</span>'
          + '<span>' + (wr !== null ? wr + '% (' + r.trades + 't)' : '—') + '</span>'
          + '<span>×' + (r.mult || 1).toFixed(2) + '</span>'
          + '</div>';
      }).join('');
    }

    var upd = document.getElementById('macro-upd');
    if (upd && m.lastUpdate) upd.textContent = 'updated ' + (typeof fmtNow === 'function' ? fmtNow() : '');

  } catch (e) { /* silent */ }
}

// ══════════════════════════════════════════════════════════════════
// FEE / SLIPPAGE MODEL — shared function for backtest + live analytics
// ══════════════════════════════════════════════════════════════════

// Fee schedule (Binance Futures defaults)
const FEE_MODEL = {
  makerPct: 0.0002,   // 0.02% maker
  takerPct: 0.0004,   // 0.04% taker
  slippagePct: {
    fast: 0.0003,  // 0.03% — small TF = more slippage
    swing: 0.0002,  // 0.02%
    defensive: 0.0001,  // 0.01% — large TF = less slippage
  },
};
window.FEE_MODEL = FEE_MODEL;

/**
 * Estimate round-trip fees + slippage for a trade.
 * @param {number} notional — position notional value ($)
 * @param {string} orderType — 'MARKET' | 'LIMIT' (default MARKET)
 * @param {string} profile — 'fast' | 'swing' | 'defensive' (for slippage)
 * @returns {{ entryFee:number, exitFee:number, slippage:number, total:number }}
 */
function estimateRoundTripFees(notional, orderType, profile) {
  var n = Math.abs(notional) || 0;
  var isLimit = (orderType || '').toUpperCase() === 'LIMIT';
  var feePct = isLimit ? FEE_MODEL.makerPct : FEE_MODEL.takerPct;
  var prof = (profile || S.profile || 'fast').toLowerCase();
  var slipPct = FEE_MODEL.slippagePct[prof] || FEE_MODEL.slippagePct.fast;
  // Limit orders: assume 0 slippage
  if (isLimit) slipPct = 0;
  var entryFee = n * feePct;
  var exitFee = n * feePct;
  var slippage = n * slipPct * 2; // entry + exit
  return { entryFee: entryFee, exitFee: exitFee, slippage: slippage, total: entryFee + exitFee + slippage };
}
window.estimateRoundTripFees = estimateRoundTripFees;

// ══════════════════════════════════════════════════════════════════
// ETAPA 5 — ADAPTIVE CONTROL ENGINE
// recalcAdaptive(): citește journal CLOSE, grupează pe buckets,
// calculează multiplieri cu guard min 30 trades, clamp [0.8, 1.2].
// OFF by default — engine nu citește multiplieri când disabled.
// ══════════════════════════════════════════════════════════════════


// Macro UI
// Adaptive save/load/recalc
function _adaptSave() {
  try {
    const payload = {
      enabled: BM.adaptive.enabled,
      lastRecalcTs: BM.adaptive.lastRecalcTs,
      entryMult: BM.adaptive.entryMult,
      sizeMult: BM.adaptive.sizeMult,
      exitMult: BM.adaptive.exitMult,
      buckets: BM.adaptive.buckets,
    };
    _safeLocalStorageSet('zeus_adaptive_v1', payload);
    if (typeof _ucMarkDirty === 'function') _ucMarkDirty('adaptive');
    if (typeof _userCtxPush === 'function') _userCtxPush();
  } catch (_) { }
}

function _adaptLoad() {
  try {
    const raw = localStorage.getItem('zeus_adaptive_v1');
    if (!raw) return;
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object') return;
    BM.adaptive.enabled = !!p.enabled;
    BM.adaptive.lastRecalcTs = p.lastRecalcTs || 0;
    BM.adaptive.entryMult = _adaptClamp(p.entryMult, 1.0);
    BM.adaptive.sizeMult = _adaptClamp(p.sizeMult, 1.0);
    BM.adaptive.exitMult = _adaptClamp(p.exitMult, 1.0);
    BM.adaptive.buckets = (p.buckets && typeof p.buckets === 'object') ? p.buckets : {};
    // Sync UI toggle
    const tog = document.getElementById('adaptiveToggleBtn');
    if (tog) tog.innerHTML = BM.adaptive.enabled ? _ZI.brain + ' ADAPTIVE ON' : _ZI.brain + ' ADAPTIVE OFF';
    if (tog) tog.style.borderColor = BM.adaptive.enabled ? 'var(--grn)' : '#2a3a4a';
    if (tog) tog.style.color = BM.adaptive.enabled ? 'var(--grn)' : 'var(--txt-dim)';
  } catch (e) {
    // [v106 FIX1] Eroare la restore adaptive state — logat, nu inghetit silentios
    console.warn('[_adaptLoad] Restore failed:', e.message);
    if (typeof ZLOG !== 'undefined') ZLOG.push('ERROR', '[_adaptLoad] ' + e.message);
  }
}

// [v107 FIX] _adaptClamp restaurat ca functie separata
// In v106 } de inchidere al _adaptLoad lipsea — corpul lui _adaptClamp
// ajunsese lipit inauntrul catch-ului, fara declaratie de functie.
function _adaptClamp(v, def) {
  var n = parseFloat(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(0.8, Math.min(1.2, n));
}

function recalcAdaptive(isStartup) {
  try {
    // Guard: dacă ADAPTIVE OFF și nu e startup load, nu face nimic
    if (!BM.adaptive.enabled && !isStartup) return;

    // Guard anti-spam: nu recalculăm dacă < 30min de la ultimul recalc
    var now = Date.now();
    var THROTTLE_MS = 30 * 60 * 1000; // 30 minute
    if ((now - BM.adaptive.lastRecalcTs) < THROTTLE_MS) return;

    // Citește doar trades CLOSE din jurnal — max 1000 pentru perf
    var journal = (TP && TP.journal) ? TP.journal : [];
    var closedTrades = journal
      .filter(function (t) { return t.journalEvent === 'CLOSE' && t.exit !== null && Number.isFinite(t.pnl); })
      .slice(0, 1000);

    if (!closedTrades.length) return;

    // Calculează SL% din setări pentru R-calc — [P1] TC first, DOM fallback
    var slPct = (typeof TC !== 'undefined' && Number.isFinite(TC.slPct)) ? TC.slPct : (parseFloat(document.getElementById('atSL')?.value) || 1.5);
    var rrRatio = (typeof TC !== 'undefined' && Number.isFinite(TC.rr)) ? TC.rr : (parseFloat(document.getElementById('atRR')?.value) || 2);

    // Grupează pe bucketuri: regime|profile|volRegime
    var newBuckets = {};
    closedTrades.forEach(function (t) {
      var regime = t.regime || '—';
      var profile = t.profile || '—';
      var volRegime = t.volRegime || '—';
      var key = regime + '|' + profile + '|' + volRegime;

      if (!newBuckets[key]) {
        newBuckets[key] = { trades: 0, wins: 0, totalR: 0, avgR: 0, winrate: 0, mult: 1.0 };
      }
      var b = newBuckets[key];
      b.trades++;
      // R-calc: profit/loss în multipli de SL
      var entryPrice = t.entry || 1;
      var slAbs = entryPrice * slPct / 100;
      var slValue = (t.size || 200) * (slPct / 100);
      var R = slValue > 0 ? t.pnl / slValue : 0;
      if (t.pnl >= 0) b.wins++;
      b.totalR += R;
    });

    // Calculează stats + multiplieri per bucket
    var BUCKET_MIN_TRADES = 30;
    var CLAMP_LO = 0.8;
    var CLAMP_HI = 1.2;

    Object.keys(newBuckets).forEach(function (key) {
      var b = newBuckets[key];
      b.avgR = b.trades > 0 ? parseFloat((b.totalR / b.trades).toFixed(3)) : 0;
      b.winrate = b.trades > 0 ? parseFloat((b.wins / b.trades).toFixed(3)) : 0;

      // Guard: sub 30 trades → mult rămâne 1.0
      if (b.trades < BUCKET_MIN_TRADES) {
        b.mult = 1.0;
        return;
      }

      // Ajustare multiplier bazat pe winrate
      // WR > 60% → up, WR < 40% → down, altfel 1.0
      var adj = 1.0;
      if (b.winrate > 0.60) {
        adj = 1.0 + Math.min((b.winrate - 0.60) * 0.5, 0.2);  // max +20%
      } else if (b.winrate < 0.40) {
        adj = 1.0 - Math.min((0.40 - b.winrate) * 0.5, 0.2);  // max -20%
      }
      b.mult = parseFloat(Math.max(CLAMP_LO, Math.min(CLAMP_HI, adj)).toFixed(3));
    });

    BM.adaptive.buckets = newBuckets;

    // Calculează multiplieri globali: media bucketelor cu >=30 trades
    var validBuckets = Object.values(newBuckets).filter(function (b) { return b.trades >= BUCKET_MIN_TRADES; });
    if (validBuckets.length > 0) {
      var avgMult = validBuckets.reduce(function (s, b) { return s + b.mult; }, 0) / validBuckets.length;
      // Toți 3 multiplieri pornesc din același avgMult dar pot diverge în viitor
      BM.adaptive.entryMult = _adaptClamp(avgMult, 1.0);
      BM.adaptive.sizeMult = _adaptClamp(avgMult, 1.0);
      BM.adaptive.exitMult = _adaptClamp(avgMult, 1.0);
    } else {
      // Insuficiente date — reset la 1.0 (safe)
      BM.adaptive.entryMult = 1.0;
      BM.adaptive.sizeMult = 1.0;
      BM.adaptive.exitMult = 1.0;
    }

    BM.adaptive.lastRecalcTs = now;
    _adaptSave();
    _renderAdaptivePanel();

    if (typeof atLog === 'function') {
      atLog('info', '[ADAPT] Adaptive recalc: ' + Object.keys(newBuckets).length + ' buckets | valid:' + validBuckets.length
        + ' | entryMult:' + BM.adaptive.entryMult.toFixed(2)
        + ' sizeMult:' + BM.adaptive.sizeMult.toFixed(2)
        + ' exitMult:' + BM.adaptive.exitMult.toFixed(2));
    }
  } catch (e) {
    if (typeof atLog === 'function') atLog('warn', '[ERR] recalcAdaptive error: ' + e.message);
  }
}

function _renderAdaptivePanel() {
  try {
    var body = document.getElementById('adaptive-panel-body');
    if (!body) return;

    var ad = BM.adaptive;
    var buckets = ad.buckets || {};
    var keys = Object.keys(buckets);

    // Header stats
    var headerEl = document.getElementById('adaptive-mults-row');
    if (headerEl) {
      var color = function (v) { return v > 1.0 ? 'var(--grn)' : v < 1.0 ? 'var(--orange)' : 'var(--txt-dim)'; };
      headerEl.innerHTML =
        '<span style="color:var(--dim)">ENTRY</span><span style="color:' + color(ad.entryMult) + ';font-weight:700">×' + ad.entryMult.toFixed(2) + '</span>' +
        '<span style="color:var(--dim)">SIZE</span><span style="color:' + color(ad.sizeMult) + ';font-weight:700">×' + ad.sizeMult.toFixed(2) + '</span>' +
        '<span style="color:var(--dim)">EXIT</span><span style="color:' + color(ad.exitMult) + ';font-weight:700">×' + ad.exitMult.toFixed(2) + '</span>';
    }

    // Bucket table
    var tbl = document.getElementById('adaptive-bucket-table');
    if (!tbl) return;
    if (!keys.length) {
      tbl.innerHTML = '<div style="color:var(--dim);font-size:11px;padding:4px 0">Niciun trade cu context — rulează după prime trades CLOSE.</div>';
      return;
    }

    tbl.innerHTML = keys.map(function (k) {
      var b = buckets[k];
      var wr = b.trades > 0 ? Math.round(b.winrate * 100) : null;
      var hasData = b.trades >= 30;
      var wrColor = hasData ? (b.winrate > 0.60 ? 'var(--grn)' : b.winrate < 0.40 ? 'var(--red)' : 'var(--gold)') : '#556677';
      var multColor = hasData ? (b.mult > 1.0 ? 'var(--grn)' : b.mult < 1.0 ? 'var(--orange)' : 'var(--txt-dim)') : '#556677';
      return '<div style="display:grid;grid-template-columns:1fr 40px 40px 45px;gap:2px;font-size:11px;padding:2px 0;border-bottom:1px solid #0d1520;color:#6a8090">'
        + '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + k + '">' + k + '</span>'
        + '<span>' + b.trades + 't</span>'
        + '<span style="color:' + wrColor + '">' + (wr !== null ? wr + '%' : '—') + '</span>'
        + '<span style="color:' + multColor + '">' + (hasData ? '×' + b.mult.toFixed(2) : '<30 ' + _ZI.lock + '') + '</span>'
        + '</div>';
    }).join('');

    // Timestamp
    var tsEl = document.getElementById('adaptive-last-upd');
    if (tsEl && ad.lastRecalcTs) {
      tsEl.textContent = 'upd ' + new Date(ad.lastRecalcTs).toLocaleTimeString();
    }
    // Actualizează bara condensată
    if (typeof _updateAdaptiveBarTxt === 'function') _updateAdaptiveBarTxt();
  } catch (_) { }
}

function toggleAdaptive() {
  BM.adaptive.enabled = !BM.adaptive.enabled;
  // Sync buton din panou MI (dacă există)
  var tog = document.getElementById('adaptiveToggleBtn');
  if (tog) {
    tog.innerHTML = BM.adaptive.enabled ? _ZI.brain + ' ADAPTIVE ON' : _ZI.brain + ' ADAPTIVE OFF';
    tog.style.borderColor = BM.adaptive.enabled ? 'var(--grn)' : '#2a3a4a';
    tog.style.color = BM.adaptive.enabled ? 'var(--grn)' : 'var(--txt-dim)';
  }
  if (!BM.adaptive.enabled) {
    BM.adaptive.entryMult = 1.0;
    BM.adaptive.sizeMult = 1.0;
    BM.adaptive.exitMult = 1.0;
    _renderAdaptivePanel();
  }
  _adaptSave();
  _updateAdaptiveBarTxt();
  if (typeof atLog === 'function') atLog('info', '[ADAPT] Adaptive Control: ' + (BM.adaptive.enabled ? 'ON' : 'OFF'));
}

// Actualizează textul condensat pe bara adaptive-strip
function _updateAdaptiveBarTxt() {
  var el = document.getElementById('adaptive-bar-txt');
  if (!el) return;
  var ad = BM.adaptive;
  if (!ad.enabled) {
    el.textContent = 'OFF · ×1.00 ×1.00 ×1.00';
    el.style.color = 'var(--pur)';
    return;
  }
  var buckets = Object.values(ad.buckets || {});
  var validBuckets = buckets.filter(function (b) { return b.trades >= 30; });
  var txt = 'ON · E×' + ad.entryMult.toFixed(2) + ' S×' + ad.sizeMult.toFixed(2) + ' X×' + ad.exitMult.toFixed(2);
  if (validBuckets.length > 0) txt += ' · ' + validBuckets.length + 'B';
  else txt += ' · <30t';
  el.textContent = txt;
  var avg = (ad.entryMult + ad.sizeMult + ad.exitMult) / 3;
  el.style.color = avg > 1.0 ? 'var(--grn)' : avg < 1.0 ? 'var(--orange)' : 'var(--pur)';
}

// Toggle strip open/close
let _adaptStripOpen = false;
function adaptiveStripToggle() {
  var strip = document.getElementById('adaptive-strip');
  if (!strip) return;
  _adaptStripOpen = !_adaptStripOpen;
  if (_adaptStripOpen) strip.classList.add('adaptive-open');
  else strip.classList.remove('adaptive-open');
  try { localStorage.setItem('zeus_adaptive_strip_open', _adaptStripOpen ? '1' : '0'); } catch (_) { }
}

// Mută conținutul din #adaptive-sec în #adaptive-strip-panel (run o dată la boot)
function initAdaptiveStrip() {
  var panel = document.getElementById('adaptive-strip-panel');
  var src = document.getElementById('adaptive-sec');
  if (!panel || !src) return;
  // Mută inner content (nu elementul însuși)
  while (src.firstChild) panel.appendChild(src.firstChild);
  src.style.display = 'none'; // ascunde containerul gol din MI
  // Restaurează stare open
  try {
    if (localStorage.getItem('zeus_adaptive_strip_open') === '1') {
      _adaptStripOpen = true;
      var strip = document.getElementById('adaptive-strip');
      if (strip) strip.classList.add('adaptive-open');
    }
  } catch (_) { }
  _updateAdaptiveBarTxt();
}

// ── (2) Entry score macro-adjustment ────────────────────────────
// Gated: only runs when BM.adapt.enabled === true.
// Returns adjusted score; original score untouched.
function macroAdjustEntryScore(dir, score) {
  try {
    if (!BM.adapt || !BM.adapt.enabled) return score;
    var ph = (BM.macro && BM.macro.phase) ? BM.macro.phase : 'NEUTRAL';
    var m = MACRO_MULT[ph] || MACRO_MULT.NEUTRAL;
    var mult = (dir === 'bull') ? m.long : m.short;
    return Math.round(score * mult);
  } catch (e) { return score; }
}

// ── (3) Exit risk macro-adjustment ──────────────────────────────
// Wrapper around existing computeExitRisk output. No DSL touch.
function macroAdjustExitRisk(risk) {
  try {
    if (!BM.adapt || !BM.adapt.enabled) return risk;
    var ph = (BM.macro && BM.macro.phase) ? BM.macro.phase : 'NEUTRAL';
    var m = MACRO_MULT[ph] || MACRO_MULT.NEUTRAL;
    return _clamp(Math.round(risk * (m.exitRisk || 1)), 0, 100);
  } catch (e) { return risk; }
}

// Position sizing
function computePositionSizingMult() {
  try {
    var ph = (BM.macro && BM.macro.phase) ? BM.macro.phase : 'NEUTRAL';
    var rm = (MACRO_MULT[ph] && MACRO_MULT[ph].risk) ? MACRO_MULT[ph].risk : 1.0;
    var pm = (BM.performance && BM.performance.byRegime && BM.performance.byRegime[ph])
      ? (BM.performance.byRegime[ph].mult || 1.0)
      : 1.0;
    BM.positionSizing.regimeMult = _clamp(rm, 0.5, 1.5);
    BM.positionSizing.perfMult = _clamp(pm, 0.7, 1.3);
    BM.positionSizing.finalMult = _clamp(
      BM.positionSizing.baseRiskPct * BM.positionSizing.regimeMult * BM.positionSizing.perfMult,
      0.5, 1.6
    );
  } catch (e) { }
}

// ── (5) Regime performance memory ───────────────────────────────
function perfRecordTrade(ph, R) {
  try {
    if (!BM.performance || !BM.performance.byRegime) return;
    var m = BM.performance.byRegime[ph] || BM.performance.byRegime.NEUTRAL;
    m.trades++;
    if (R > 0) m.wins++;
    // EMA of avgR — window capped at 50
    var a = 2 / (Math.min(50, m.trades) + 1);
    m.avgR = (m.trades === 1) ? R : parseFloat((m.avgR * (1 - a) + R * a).toFixed(3));
    // Need min 20 trades before adapting mult
    if (m.trades < 20) { m.mult = 1.00; return; }
    var winrate = m.wins / m.trades;
    var mult = 1.0
      + (winrate - 0.5) * 0.30          // ±15% from winrate
      + _clamp(m.avgR, -1, 1) * 0.10;  // ±10% from avgR
    m.mult = _clamp(parseFloat(mult.toFixed(3)), 0.80, 1.20);
    // Recompute sizing after perf update
    computePositionSizingMult();
  } catch (e) { }
}

// ── _posR helper (R-multiple for a position) ─────────────────────
function _posR(pos) {
  try {
    var dslPos = (typeof DSL !== 'undefined' && DSL.positions) ? DSL.positions[String(pos.id)] : null;
    var sl = (dslPos && dslPos.currentSL) ? dslPos.currentSL : pos.sl;
    if (!sl) return null;
    var risk = Math.abs(pos.entry - sl);
    if (risk <= 0) return null;
    var cur = (typeof getSymPrice === 'function') ? getSymPrice(pos) : (S.price || pos.entry);
    var pnl = (pos.side === 'LONG') ? (cur - pos.entry) : (pos.entry - cur);
    // [FIX v85 B9] Scade comisioanele din PnL înainte de calculul R-multiple (0.04% per side)
    var commissionPct = 0.0004; // 0.04% per side (0.08% round-trip)
    var commission = pos.entry * commissionPct * 2; // open + close
    var netPnl = pnl - commission;
    return parseFloat((netPnl / risk).toFixed(3));
  } catch (e) { return null; }
}

// ════════════════════════════════════════════════════════════════
// QUANTUM EXIT BRAIN — Advisory-first, DSL-safe
// ────────────────────────────────────────────────────────────────


// ─── Macro Phase from Composite ──────────────────────────────
function _macroPhaseFromComposite(x) {
  if (x <= 30) return 'ACCUMULATION';
  if (x <= 55) return 'EARLY_BULL';
  if (x <= 75) return 'LATE_BULL';
  if (x <= 90) return 'DISTRIBUTION';
  return 'TOP_RISK';
}
