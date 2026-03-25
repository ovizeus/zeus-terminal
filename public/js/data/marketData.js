// Zeus v122 — data/marketData.js
// WebSocket connections, data fetching, chart rendering, main update loops
// WARNING: This is the tightly-coupled core — kept together for stability
'use strict';

// ===== ERROR HANDLER =====
// [PATCH5 S1] Escape helper for safe innerHTML
function _escHtml(s) {
  if (typeof s !== 'string') return String(s == null ? '' : s);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
window._escHtml = _escHtml;

// ===== HELPERS =====
// [MOVED TO TOP] el
// [MOVED TO TOP] fmt
// [MOVED TO TOP] fP

// ═══ UNIVERSAL TIME HELPERS — Europe/Bucharest FORCED ═══════════
// [MOVED TO TOP] _TZ
// [MOVED TO TOP] _dtfTime
// [MOVED TO TOP] _dtfTimeSec
// [MOVED TO TOP] _dtfDate
// [MOVED TO TOP] _dtfFull
// fmtTime(tsSec|tsMs) → "14:35"
// [FIX v85 B1] Formatoarele sunt acum dinamice — folosesc S.tz (schimbabil din UI) în loc de _TZ hardcodat
function fmtTime(ts) { if (!ts) return '—'; const ms = ts > 1e10 ? ts : ts * 1000; return new Intl.DateTimeFormat('ro-RO', { timeZone: (typeof S !== 'undefined' && S.tz) || _TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms)); }
// fmtTimeSec(tsSec|tsMs) → "14:35:22"
function fmtTimeSec(ts) { if (!ts) return '—'; const ms = ts > 1e10 ? ts : ts * 1000; return new Intl.DateTimeFormat('ro-RO', { timeZone: (typeof S !== 'undefined' && S.tz) || _TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(ms)); }
// fmtDate(tsSec|tsMs) → "23 feb. '26"
function fmtDate(ts) { if (!ts) return '—'; const ms = ts > 1e10 ? ts : ts * 1000; return new Intl.DateTimeFormat('ro-RO', { timeZone: (typeof S !== 'undefined' && S.tz) || _TZ, day: '2-digit', month: 'short', year: '2-digit' }).format(new Date(ms)); }
// fmtFull(tsSec|tsMs) → "23 feb. '26, 14:35"
function fmtFull(ts) { if (!ts) return '—'; const ms = ts > 1e10 ? ts : ts * 1000; return new Intl.DateTimeFormat('ro-RO', { timeZone: (typeof S !== 'undefined' && S.tz) || _TZ, day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms)); }
// fmtNow() → "14:35:22" current time in RO tz
function fmtNow(sec) { return sec ? fmtTimeSec(Date.now()) : fmtTime(Date.now()); }
function toast(msg, dur = 3000, icon) {
  let t = el('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);background:#1a2530;border:1px solid #f0c04044;color:#f0c040;padding:8px 16px;border-radius:4px;font-size:10px;z-index:9999;pointer-events:none;transition:.3s;max-width:80%;display:flex;align-items:center;gap:4px'; document.body.appendChild(t); }
  if (icon) { t.innerHTML = ''; var _s = document.createElement('span'); _s.innerHTML = icon; t.appendChild(_s); t.appendChild(document.createTextNode(' ' + msg)); }
  else { t.textContent = msg; }
  t.style.opacity = '1';
  clearTimeout(t._t); t._t = setTimeout(() => t.style.opacity = '0', dur);
}

// ===== STATE =====
// [MOVED TO TOP] S

// ===== CHART VARS =====
// [MOVED TO TOP] chartVars
// [MOVED TO TOP] liqSeries

// ===== ATR UNIFIED (Wilder) — single source of truth v88 =====
// Input : klines array [{high, low, close}, ...], period (int), method ('wilder'|'sma')
// Output: { series: Float64Array|Array (same length, null for warm-up), last: number|null }
function _calcATRSeries(klines, period, method) {
  try {
    period = (period && period > 0) ? Math.round(period) : 14;
    method = method || 'wilder';
    const n = klines ? klines.length : 0;
    const series = new Array(n).fill(null);
    if (n < period + 2) {
      // not enough data — return safe nulls + last=null
      return { series, last: null };
    }
    // Step 1: compute True Range for all bars (starting at index 1)
    const tr = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      const h = klines[i].high, l = klines[i].low, pc = klines[i - 1].close;
      tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    }
    if (method === 'sma') {
      // SMA ATR — average of period TRs (debug/legacy)
      for (let i = period; i < n; i++) {
        let s = 0;
        for (let j = i - period + 1; j <= i; j++) s += tr[j];
        series[i] = s / period;
      }
    } else {
      // Wilder ATR — seed with SMA of first `period` TRs, then smooth
      let seedSum = 0;
      for (let j = 1; j <= period; j++) seedSum += tr[j];
      series[period] = seedSum / period;
      for (let j = period + 1; j < n; j++) {
        series[j] = (series[j - 1] * (period - 1) + tr[j]) / period;
      }
    }
    // Find last non-null value
    let last = null;
    for (let i = n - 1; i >= 0; i--) {
      if (series[i] !== null) { last = series[i]; break; }
    }
    return { series, last };
  } catch (e) {
    console.warn('[_calcATRSeries] error:', e.message);
    return { series: [], last: null };
  }
}

// ===== RSI =====
function calcRSI(prices, p = 14) {
  if (prices.length < p + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = prices[i] - prices[i - 1]; if (d > 0) g += d; else l += Math.abs(d); }
  let ag = g / p, al = l / p;
  for (let i = p + 1; i < prices.length; i++) { const d = prices[i] - prices[i - 1]; if (d > 0) { ag = (ag * (p - 1) + d) / p; al = al * (p - 1) / p; } else { ag = ag * (p - 1) / p; al = (al * (p - 1) + Math.abs(d)) / p; } }
  // [FIX R13] Flat market: both avgGain and avgLoss are 0 → RSI = 50 (neutral), not 100
  if (ag === 0 && al === 0) return 50;
  return al === 0 ? 100 : 100 - (100 / (1 + (ag / al)));
}

// ===== CHART INIT =====
function getChartH() { return window.innerWidth >= 1000 ? 320 : 280; }
function getChartW() {
  const page = document.querySelector('.page');
  if (window.innerWidth >= 1000 && page) {
    // right column = total page width minus 390px left sidebar minus gap
    return Math.max(400, page.offsetWidth - 390 - 2);
  }
  return Math.min(window.innerWidth, 480);
}
function initCharts() {
  const W = getChartW();
  const TZ = S.tz || 'Europe/Bucharest';
  // FIX ORA CHART: Convertim UTC→Romania direct in formatter, FARA sa modificam timestamps
  // Asa functioneaza corect pe ORICE timeframe (5m, 1h, 4h, 1d, 1w)
  const locFmt = {
    timeFormatter: ts => fmtTime(ts),
    dateFormatter: ts => fmtDate(ts)
  };
  const base = (h) => ({
    width: W, height: h,
    layout: { background: { color: '#0a0f16' }, textColor: '#7a9ab8' },
    grid: { vertLines: { color: '#1a2530' }, horzLines: { color: '#1a2530' } },
    rightPriceScale: { borderColor: '#1e2530', scaleMargins: { top: .05, bottom: .15 } },
    timeScale: { borderColor: '#1e2530', timeVisible: false, secondsVisible: false, ticksVisible: false, rightOffset: 12 },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
  });
  mainChart = LightweightCharts.createChart(el('mc'), base(getChartH()));
  cSeries = mainChart.addCandlestickSeries({ upColor: '#00d97a', downColor: '#ff3355', borderUpColor: '#00d97a', borderDownColor: '#ff3355', wickUpColor: '#00d97a77', wickDownColor: '#ff335577' });
  // LLV: load persisted settings and ensure canvas is ready
  llvLoadSettings();
  llvEnsureCanvas();
  // Reaplică culorile salvate de utilizator (dacă există)
  if (S._savedChartColors) {
    const c = S._savedChartColors;
    cSeries.applyOptions({ upColor: c.bull, downColor: c.bear, borderUpColor: c.bull, borderDownColor: c.bear, wickUpColor: (c.bullW || c.bull) + '77', wickDownColor: (c.bearW || c.bear) + '77' });
    if (mainChart) mainChart.applyOptions({ layout: { background: { color: c.priceBg || '#0a0f16' }, textColor: c.priceText || '#7a9ab8' }, rightPriceScale: { textColor: c.priceText || '#7a9ab8' } });
  }
  ema50S = mainChart.addLineSeries({ color: '#f0c040', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  ema200S = mainChart.addLineSeries({ color: '#00b8d4', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  wma20S = mainChart.addLineSeries({ color: '#aa44ff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  wma50S = mainChart.addLineSeries({ color: '#ff8822', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 2 });
  stS = mainChart.addLineSeries({ color: '#ff8800', lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
  const co = Object.assign(base(65), { rightPriceScale: { borderColor: '#1e2530', scaleMargins: { top: .1, bottom: .1 } } });
  cvdChart = LightweightCharts.createChart(el('cc'), co);
  cvdS = cvdChart.addLineSeries({ color: '#f0c040', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'CVD' });
  const vo = Object.assign(base(48), { rightPriceScale: { borderColor: '#1e2530', scaleMargins: { top: .05, bottom: 0 } } });
  volChart = LightweightCharts.createChart(el('vc'), vo);
  volS = volChart.addHistogramSeries({ color: '#00b8d444', priceFormat: { type: 'volume' }, priceScaleId: '', scaleMargins: { top: 0, bottom: 0 } });
  // Force localization on main chart only at ROOT
  if (mainChart) mainChart.applyOptions({ localization: locFmt });

  // CVD + VOL: hide timeScale (only main chart shows time axis)
  // v96 FIX ALIGNMENT: rightPriceScale gets same fixed width as main chart scale
  // so plot area (candle zone) is pixel-identical across all charts → zero X drift
  // v104: rightOffset:12 matches main → last candle aligned on same vertical line
  if (cvdChart) cvdChart.applyOptions({
    localization: locFmt,
    timeScale: { visible: false, timeVisible: false, secondsVisible: false, borderVisible: false, rightOffset: 12 },
    rightPriceScale: { visible: true, borderColor: '#1e2530', width: 70 }
  });
  if (volChart) volChart.applyOptions({
    localization: locFmt,
    timeScale: { visible: true, timeVisible: true, secondsVisible: false, borderVisible: true, borderColor: '#1e2530', rightOffset: 12 },
    rightPriceScale: { visible: true, borderColor: '#1e2530', width: 70 }
  });

  let syncing = false;
  mainChart.timeScale().subscribeVisibleLogicalRangeChange(r => {
    if (syncing || !r) return; syncing = true;
    try { cvdChart.timeScale().setVisibleLogicalRange(r); volChart.timeScale().setVisibleLogicalRange(r); } catch (_) { }
    // [INDICATORS] sync all sub-charts
    try { if (typeof _syncSubChartsToMain === 'function') _syncSubChartsToMain(); } catch (_) { }
    syncing = false;
  });
}

// ===== FETCH KLINES =====
async function fetchKlines(tf) {
  if (!FetchLock.try('klines')) return;
  try {
    const sym = S.symbol || 'BTCUSDT';
    // [v106 FIX] AbortController — timeout 10s pe fetch klines
    // [v107 FIX] Guard explicit pe r dupa abort — previne TypeError "Cannot read 'ok' of undefined"
    const _ac = new AbortController();
    const _acTimer = setTimeout(() => _ac.abort(), 10000);
    let r;
    try {
      r = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${tf}&limit=1000`, { signal: _ac.signal });
    } catch (fetchErr) {
      clearTimeout(_acTimer);
      if (fetchErr.name === 'AbortError') throw new Error('Timeout fetch klines (>10s) — verifica conexiunea');
      throw fetchErr;
    }
    clearTimeout(_acTimer);
    if (!r || !r.ok) throw new Error(`HTTP ${r ? r.status : 'no response'}`);
    const d = await r.json();
    if (!Array.isArray(d)) throw new Error('Răspuns invalid de la Binance (klines)');
    if (!Array.isArray(d) || !d.length) return;
    // [PATCH4 W3] Stale fetch guard: if symbol changed during await, discard response
    if (S.symbol !== sym) {
      console.warn('[fetchKlines] stale response for ' + sym + ' (current: ' + S.symbol + ') — discarded');
      return;
    }
    // P7: validate each candle OHLC — skip aberrant candles
    const _rawKlines = d.map(k => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
    S.klines = _rawKlines.filter(k => {
      // Basic sanity: all OHLC positive, high>=low, close within [low,high]
      if (!k.open || !k.high || !k.low || !k.close) return false;
      if (k.high < k.low || k.close < k.low || k.close > k.high) return false;
      if (k.open <= 0 || k.close <= 0) return false;
      // Price sanity using existing guard (if available)
      if (typeof _isPriceSane === 'function' && !_isPriceSane(k.close)) return false;
      return true;
    });
    if (!S.klines.length) { console.warn('[fetchKlines] all candles failed sanity'); return; }
    _resetKlineWatchdog();
    renderChart();
    const symLow = sym.toLowerCase();
    const _klineGen = window.__wsGen; // capture generation at socket-open time
    S.wsK = WS.open('kline', `wss://fstream.binance.com/ws/${symLow}@kline_${tf}`, {
      onmessage: e => {
        // Gen guard: discard messages from a previous symbol's socket
        if (window.__wsGen !== _klineGen) return;
        const j = JSON.parse(e.data); const k = j.k;
        const bar = { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v };
        const last = S.klines[S.klines.length - 1];
        if (last && last.time === bar.time) S.klines[S.klines.length - 1] = bar;
        else { S.klines.push(bar); if (S.klines.length > 1500) S.klines = S.klines.slice(-1200); }
        _resetKlineWatchdog();
        try { cSeries.update(bar); } catch (_) { }
        updOvrs();
        // [CHART MARKERS] Throttled refresh on live candle updates
        if (!window._tmThrottle) { window._tmThrottle = setTimeout(function () { window._tmThrottle = null; renderTradeMarkers(); }, 5000); }
      }
    });
  } catch (e) {
    console.error('[fetchKlines]', e.message);
    toast(`Chart: nu pot încărca datele (${e.message})`);
  }
  finally { FetchLock.release('klines'); }
}

// ===== RENDER CHART =====
function renderChart() {
  if (!cSeries || !S.klines.length) return;
  try {
    S.chartBars = S.klines.map(k => ({ time: k.time, open: k.open, high: k.high, low: k.low, close: k.close }));
    cSeries.setData(S.klines);
    // Auto-center chart to current price after symbol change
    try { mainChart.timeScale().scrollToRealTime(); } catch (_) { }
    const c = S.klines.map(k => k.close);
    // EMA — uses IND_SETTINGS
    function calcEMA(data, p) { const k = 2 / (p + 1); let e = data[0]; return data.map(v => { e = v * k + e * (1 - k); return e; }); }
    if (S.indicators.ema) {
      const _ep1 = (typeof IND_SETTINGS !== 'undefined' && IND_SETTINGS.ema) ? Math.round(IND_SETTINGS.ema.p1) : 50;
      const _ep2 = (typeof IND_SETTINGS !== 'undefined' && IND_SETTINGS.ema) ? Math.round(IND_SETTINGS.ema.p2) : 200;
      const e50 = calcEMA(c, _ep1).map((v, i) => ({ time: S.klines[i].time, value: v }));
      const e200 = calcEMA(c, _ep2).map((v, i) => ({ time: S.klines[i].time, value: v }));
      ema50S.setData(e50); ema200S.setData(e200);
    } else { ema50S.setData([]); ema200S.setData([]); }
    // WMA — uses IND_SETTINGS
    if (S.indicators.wma) {
      const _wp1 = (typeof IND_SETTINGS !== 'undefined' && IND_SETTINGS.wma) ? Math.round(IND_SETTINGS.wma.p1) : 20;
      const _wp2 = (typeof IND_SETTINGS !== 'undefined' && IND_SETTINGS.wma) ? Math.round(IND_SETTINGS.wma.p2) : 50;
      function calcWMA(data, p) { return data.map((v, i) => { if (i < p - 1) return { time: S.klines[i].time, value: 0 }; let s = 0, w = 0; for (let j = 0; j < p; j++) { s += data[i - j] * (p - j); w += p - j; } return { time: S.klines[i].time, value: s / w }; }); }
      wma20S.setData(calcWMA(c, _wp1)); wma50S.setData(calcWMA(c, _wp2));
    } else { wma20S.setData([]); wma50S.setData([]); }
    // SuperTrend — uses IND_SETTINGS
    if (S.indicators.st && S.atr) {
      const atr = S.atr;
      const mult = (typeof IND_SETTINGS !== 'undefined' && IND_SETTINGS.st) ? IND_SETTINGS.st.mult : 3;
      let stData = []; let up = 0, dn = 0, trend = 1;
      S.klines.forEach((k, i) => {
        const hl2 = (k.high + k.low) / 2;
        const bu = hl2 + mult * atr, bl = hl2 - mult * atr;
        if (i === 0) { up = bu; dn = bl; }
        else { up = bu < stData[i - 1]?.up || c[i - 1] > stData[i - 1]?.up ? bu : stData[i - 1].up; dn = bl > stData[i - 1]?.dn || c[i - 1] < stData[i - 1]?.dn ? bl : stData[i - 1].dn; }
        if (c[i] > up) trend = 1; else if (c[i] < dn) trend = -1;
        stData.push({ time: k.time, value: trend === 1 ? dn : up, up, dn, trend });
      });
      stS.setData(stData.map(d => ({ time: d.time, value: d.value })));
    } else { stS.setData([]); }
    // CVD
    let cvd = 0;
    const cvdData = S.klines.map(k => { cvd += k.close > k.open ? k.volume : -k.volume; return { time: k.time, value: cvd }; });
    cvdS.setData(cvdData);
    // Volume
    const volData = S.klines.map(k => ({ time: k.time, value: k.volume, color: k.close >= k.open ? '#00d97a44' : '#ff335544' }));
    volS.setData(volData);
    // FIX 8: update MACD chart if active
    if (typeof _macdKlineHook === 'function') _macdKlineHook();
    // [INDICATORS] update all active indicators
    if (typeof _indRenderHook === 'function') _indRenderHook();
    updOvrs();
    if (S.vwapOn) renderVWAP();
    if (S.oviOn) { clearTimeout(S._oviRefreshT); S._oviRefreshT = setTimeout(renderOviLiquid, 15000); }
    renderTradeMarkers();
  } catch (e) { console.error('renderChart', e); }
}

// ===== OVERLAYS =====
function updOvrs() {
  if (S.overlays.liq) renderHeatmapOverlay();
  if (S.overlays.sr) renderSROverlay();
  if (S.oviOn) renderOviLiquid();
}
function togOvr(o, btn) {
  S.overlays[o] = !S.overlays[o];
  if (btn) btn.classList.toggle('act', S.overlays[o]);
  if (o === 'liq') { clearHeatmap(); if (S.overlays.liq) renderHeatmapOverlay(); }
  if (o === 'sr') { clearSR(); if (S.overlays.sr) renderSROverlay(); }
  if (o === 'zs') { clearZS(); if (S.overlays.zs) renderZS(); }
  if (o === 'llv') { clearLiqLevels(); if (S.overlays.llv) renderLiqLevels(); }
}
function clearHeatmap() { liqSeries.forEach(s => { try { mainChart.removeSeries(s); } catch (_) { } }); liqSeries = []; }
function clearSR() { srSeries.forEach(s => { try { mainChart.removeSeries(s); } catch (_) { } }); srSeries = []; }

// ═══════════════════════════════════════════════════════
// ===== TRADE MARKERS (chart overlay) =====
// ═══════════════════════════════════════════════════════
var _tradePriceLines = [];  // cSeries price line refs for SL/TP of open positions

function _tsToBarTime(tsMs) {
  // Convert ms epoch → chart bar time (seconds, floored to nearest kline)
  if (!tsMs || !S.klines.length) return 0;
  var tsSec = Math.floor(tsMs / 1000);
  // Binary search for the last kline whose time <= tsSec
  var lo = 0, hi = S.klines.length - 1, best = S.klines[0].time;
  while (lo <= hi) {
    var mid = (lo + hi) >>> 1;
    if (S.klines[mid].time <= tsSec) { best = S.klines[mid].time; lo = mid + 1; }
    else hi = mid - 1;
  }
  return best;
}

function _classifyExitReason(reason) {
  if (!reason) return 'CLOSE';
  var r = reason.toUpperCase();
  if (r.includes('SL') || r.includes('STOP LOSS') || r.includes('SL HIT')) return 'SL';
  if (r.includes('TP') && !r.includes('TTP') || r.includes('TAKE PROFIT') || r.includes('TP HIT')) return 'TP';
  if (r.includes('DSL') || r.includes('DSL')) return 'DSL';
  if (r.includes('TTP')) return 'TTP';
  if (r.includes('EMERGENCY') || r.includes('EMERGENCY')) return 'EMERGENCY';
  if (r.includes('EXPIR') || r.includes('LIQ') || r.includes('LIQUIDATED')) return 'EXPIRY';
  if (r.includes('MANUAL') || r.includes('MANUAL') || r.includes('CLOSE ALL')) return 'MANUAL_CLOSE';
  if (r.includes('PARTIAL') || r.includes('◑')) return 'PARTIAL';
  return 'CLOSE';
}

function _exitMarkerMeta(exitType) {
  // Returns { color, text } for each exit type
  switch (exitType) {
    case 'SL': return { color: '#ff3355', text: 'SL' };
    case 'TP': return { color: '#00d97a', text: 'TP' };
    case 'DSL': return { color: '#aa44ff', text: 'DSL' };
    case 'TTP': return { color: '#f0c040', text: 'TTP' };
    case 'MANUAL_CLOSE': return { color: '#f0c040', text: 'CLOSE' };
    case 'EMERGENCY': return { color: '#ff8800', text: 'EMRG' };
    case 'EXPIRY': return { color: '#888888', text: 'EXP' };
    case 'PARTIAL': return { color: '#00b8d4', text: 'PART' };
    default: return { color: '#888888', text: 'EXIT' };
  }
}

function renderTradeMarkers() {
  if (!cSeries || !S.klines || !S.klines.length) return;
  try {
    // 1) Clear old SL/TP price lines
    _tradePriceLines.forEach(function (pl) { try { cSeries.removePriceLine(pl); } catch (_) { } });
    _tradePriceLines = [];

    var curMode = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo';
    var markers = [];
    var curSym = (S.symbol || 'BTCUSDT').toUpperCase();

    // 2) Open positions — ENTRY markers + SL/TP price lines (current mode only)
    var openPos = curMode === 'live' ? (TP.livePositions || []) : (TP.demoPositions || []);
    openPos.forEach(function (pos) {
      if (pos.closed || pos.status === 'closing') return;
      var posSym = (pos.sym || pos.symbol || '').toUpperCase();
      if (posSym !== curSym) return;

      var entryBarTime = _tsToBarTime(pos.openTs || pos.id);
      if (!entryBarTime) return;

      var isAuto = !!pos.autoTrade;
      var isLong = pos.side === 'LONG';
      var label = (isAuto ? 'AT ' : 'MAN ') + pos.side;
      var entryColor = isAuto
        ? (isLong ? '#00d97a' : '#ff3355')
        : (isLong ? '#00b8d4' : '#ff8822');

      markers.push({
        time: entryBarTime,
        position: isLong ? 'belowBar' : 'aboveBar',
        color: entryColor,
        shape: isLong ? 'arrowUp' : 'arrowDown',
        text: label,
      });

      // SL price line
      var effectiveSL = pos.sl;
      if (typeof DSL !== 'undefined' && DSL.positions && DSL.positions[String(pos.id)]) {
        var dsl = DSL.positions[String(pos.id)];
        if (dsl.active && dsl.currentSL > 0) effectiveSL = dsl.currentSL;
      }
      if (effectiveSL && Number.isFinite(effectiveSL)) {
        _tradePriceLines.push(cSeries.createPriceLine({
          price: effectiveSL,
          color: '#ff335599',
          lineWidth: 1,
          lineStyle: 2, // dashed
          axisLabelVisible: true,
          title: 'SL ' + (isAuto ? 'AT' : 'MAN'),
        }));
      }
      // TP price line
      if (pos.tp && Number.isFinite(pos.tp)) {
        _tradePriceLines.push(cSeries.createPriceLine({
          price: pos.tp,
          color: '#00d97a99',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'TP ' + (isAuto ? 'AT' : 'MAN'),
        }));
      }
    });

    // 3) Closed trades from journal — ENTRY + EXIT markers (current mode only, current symbol)
    var journal = (typeof TP !== 'undefined' && Array.isArray(TP.journal)) ? TP.journal : [];
    journal.forEach(function (t) {
      if (t.journalEvent !== 'CLOSE') return;
      // Mode filter: use explicit mode field, fallback isLive flag, fallback to demo
      var tMode = t.mode || (t.isLive ? 'live' : 'demo');
      if (tMode !== curMode) return;
      var tSym = ((t.sym || '') + 'USDT').toUpperCase();
      if (tSym !== curSym) return;
      if (t.entry == null || t.exit == null) return;

      var isAuto = !!t.autoTrade;
      var isLong = (t.side || '').toUpperCase() === 'LONG';
      var entryLabel = (isAuto ? 'AT ' : 'MAN ') + (t.side || '?');

      // Entry marker (use openTs if available, else id as timestamp)
      var entryTs = t.openTs || t.id;
      var entryBarTime = _tsToBarTime(entryTs);
      if (entryBarTime) {
        var eColor = isAuto ? (isLong ? '#00d97a' : '#ff3355') : (isLong ? '#00b8d4' : '#ff8822');
        markers.push({
          time: entryBarTime,
          position: isLong ? 'belowBar' : 'aboveBar',
          color: eColor,
          shape: isLong ? 'arrowUp' : 'arrowDown',
          text: entryLabel,
        });
      }

      // Exit marker (use closedAt if available, else current-ish)
      var exitTs = t.closedAt || (t.id ? t.id + 60000 : 0); // fallback: entry + 1min
      var exitBarTime = _tsToBarTime(exitTs);
      if (exitBarTime) {
        var exitType = _classifyExitReason(t.reason);
        var meta = _exitMarkerMeta(exitType);
        markers.push({
          time: exitBarTime,
          position: isLong ? 'aboveBar' : 'belowBar',
          color: meta.color,
          shape: 'circle',
          text: meta.text,
        });
      }
    });

    // 4) Sort markers by time (Lightweight Charts requires ascending order)
    markers.sort(function (a, b) { return a.time - b.time; });

    // 5) Apply to chart
    cSeries.setMarkers(markers);
  } catch (e) { console.warn('[TradeMarkers]', e); }
}

// [p19 LLV START] ── LIQ Levels V2 ──────────────────────────────────────
var _llvLines = []; // price line refs for cleanup (kept for compat, no longer populated)

// ── LLV Canvas Overlay ──────────────────────────────────────────────────
var _llvCanvas = null;
var _llvCtx = null;
var _llvResizeObs = null;
var _llvRenderTimer = null;

function llvEnsureCanvas() {
  var mcEl = document.getElementById('mc');
  if (!mcEl) return;
  var parent = mcEl.parentElement;
  if (!parent) return;
  // Safety: parent must be positioned
  var pos = getComputedStyle(parent).position;
  if (pos === 'static') parent.style.position = 'relative';
  // Reuse existing canvas if valid
  if (_llvCanvas && _llvCanvas.parentElement === parent) return;
  // Create canvas
  _llvCanvas = document.createElement('canvas');
  _llvCanvas.id = 'llvCanvas';
  _llvCanvas.style.cssText = 'position:absolute;inset:0;z-index:10;pointer-events:none;';
  parent.appendChild(_llvCanvas);
  _llvCtx = _llvCanvas.getContext('2d');
  llvResizeCanvas();
  // Auto-resize on container resize
  if (_llvResizeObs) _llvResizeObs.disconnect();
  _llvResizeObs = new ResizeObserver(function () {
    llvResizeCanvas();
    if (S.overlays.llv) llvRequestRender();
  });
  _llvResizeObs.observe(parent);
  // Redraw on zoom/scroll
  if (mainChart) {
    mainChart.timeScale().subscribeVisibleLogicalRangeChange(llvRequestRender);
  }
}

function llvResizeCanvas() {
  if (!_llvCanvas) return;
  var parent = _llvCanvas.parentElement;
  if (!parent) return;
  _llvCanvas.width = parent.offsetWidth;
  _llvCanvas.height = parent.offsetHeight;
}

function llvClearCanvas() {
  if (_llvCanvas && _llvCtx) {
    _llvCtx.clearRect(0, 0, _llvCanvas.width, _llvCanvas.height);
  }
}

function llvRequestRender() {
  if (!S.overlays.llv) return;
  if (_llvRenderTimer) clearTimeout(_llvRenderTimer);
  _llvRenderTimer = setTimeout(function () {
    _llvRenderTimer = null;
    renderLiqLevels();
  }, 250);
}
// ── /LLV Canvas Overlay ─────────────────────────────────────────────────

function clearLiqLevels() {
  _llvLines.forEach(function (pl) {
    try {
      if (mainChart && pl && pl._series) { pl._series.removePriceLine(pl._line); }
    } catch (_) { }
  });
  _llvLines = [];
  llvClearCanvas();
}

function renderLiqLevels() {
  if (!mainChart || !S.llvBuckets || !cSeries) return;
  try {
    llvEnsureCanvas();
    llvClearCanvas();
    if (!_llvCanvas || !_llvCtx) return;

    var st = S.llvSettings;
    var curPrice = S.price || 0;
    if (!curPrice) return;

    var buckets = Object.values(S.llvBuckets);
    if (!buckets.length) return;

    // Time window filter
    var twMap = { '1d': 86400, '3d': 259200, '7d': 604800, '14d': 1209600, '30d': 2592000 };
    var twSec = twMap[st.timeWindow || '7d'] || 604800;
    var now = Date.now();
    var cutoff = now - twSec * 1000;

    var minUsd = st.minUsd || 0;
    var longCol = st.longCol || '#00d4aa';
    var shortCol = st.shortCol || '#ff4466';
    var opRaw = st.opacity != null ? st.opacity : 70;
    var opacity = opRaw <= 1 ? opRaw : opRaw / 100; // normalize: 0.7 or 70 → both → 0.7
    var maxBarWidthPct = st.maxBarWidthPct || 30;
    var showLabels = st.showLabels !== false;

    var canvasW = _llvCanvas.width;
    var canvasH = _llvCanvas.height;
    var xEnd = canvasW - 8;

    // Filter buckets
    var visible = buckets.filter(function (b) {
      if (b.ts < cutoff) return false;
      if ((b.longUSD + b.shortUSD) < minUsd) return false;
      return true;
    });
    if (!visible.length) return;

    // Max USD in view for scaling
    var maxUsdInView = 0;
    visible.forEach(function (b) {
      var t = b.longUSD + b.shortUSD;
      if (t > maxUsdInView) maxUsdInView = t;
    });
    if (!maxUsdInView) return;

    var ctx = _llvCtx;
    ctx.save();
    ctx.globalAlpha = opacity;

    visible.forEach(function (b) {
      var y = cSeries.priceToCoordinate(b.price);
      if (y == null || y < 0 || y > canvasH) return;

      var longUSD = b.longUSD;
      var shortUSD = b.shortUSD;
      var totalUSD = longUSD + shortUSD;
      var totalBTC = b.longBTC + b.shortBTC;

      var barMaxW = canvasW * (maxBarWidthPct / 100);

      // Draw LONG bar (left → right, green)
      if (longUSD > 0) {
        var longW = (longUSD / maxUsdInView) * barMaxW;
        ctx.fillStyle = longCol;
        ctx.fillRect(0, y - 2, longW, 4);
      }

      // Draw SHORT bar (left → right, red) offset below
      if (shortUSD > 0) {
        var shortW = (shortUSD / maxUsdInView) * barMaxW;
        ctx.fillStyle = shortCol;
        ctx.fillRect(0, y + 2, shortW, 4);
      }

      // Label
      if (showLabels) {
        var btcStr;
        if (totalBTC >= 1000) { btcStr = (totalBTC / 1000).toFixed(1) + 'k'; }
        else if (totalBTC >= 1) { btcStr = totalBTC.toFixed(1); }
        else if (totalBTC >= 0.01) { btcStr = totalBTC.toFixed(2); }
        else { btcStr = totalBTC.toFixed(3); }
        var distPct = Math.abs(b.price - curPrice) / curPrice * 100;
        var label = btcStr + ' BTC | ' + distPct.toFixed(1) + '%';
        ctx.font = 'bold 9px monospace';
        ctx.fillStyle = '#00ff88';
        ctx.shadowColor = 'rgba(0,0,0,0.9)';
        ctx.shadowBlur = 3;
        ctx.globalAlpha = Math.min(opacity + 0.2, 1);
        ctx.fillText(label, 4, y - 5);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = opacity;
      }
    });

    ctx.restore();
  } catch (e) {
    console.warn('[LLV] renderLiqLevels error:', e);
  }
}
// ── LLV Persist Settings ────────────────────────────────────────────────
function llvSaveSettings() {
  try {
    localStorage.setItem('zeus_llv_settings', JSON.stringify(S.llvSettings));
    if (typeof _ucMarkDirty === 'function') _ucMarkDirty('llvSettings');
    if (typeof _userCtxPush === 'function') _userCtxPush();
  } catch (e) { console.warn('[LLV] save settings error:', e); }
  renderLiqLevels();
  closeM('mllv');
}

function llvLoadSettings() {
  try {
    var raw = localStorage.getItem('zeus_llv_settings');
    if (!raw) return;
    var saved = JSON.parse(raw);
    // Merge saved → S.llvSettings (do not replace object reference)
    Object.keys(saved).forEach(function (k) { S.llvSettings[k] = saved[k]; });
    // Sync modal controls to loaded values
    var st = S.llvSettings;
    var bEl = document.getElementById('llvBucket');
    if (bEl) { var bv = Math.round(st.bucketPct / 0.1); bEl.value = bv; document.getElementById('llvBucketV').textContent = st.bucketPct.toFixed(1) + '%'; }
    var mEl = document.getElementById('llvMinUsd');
    if (mEl) { mEl.value = st.minUsd / 1000; document.getElementById('llvMinUsdV').textContent = '$' + (st.minUsd / 1000) + 'k'; }
    var slEl = document.getElementById('llvShowLabels');
    if (slEl) slEl.checked = st.showLabels !== false;
    var lEl = document.getElementById('llvLongCol');
    if (lEl) lEl.value = st.longCol || '#00d4aa';
    var scEl = document.getElementById('llvShortCol');
    if (scEl) scEl.value = st.shortCol || '#ff4466';
    var mbwEl = document.getElementById('llvMaxBarW');
    if (mbwEl) { mbwEl.value = st.maxBarWidthPct || 30; document.getElementById('llvMaxBarWV').textContent = (st.maxBarWidthPct || 30) + '%'; }
    var opEl = document.getElementById('llvOpacity');
    if (opEl) { opEl.value = st.opacity != null ? st.opacity : 70; document.getElementById('llvOpacityV').textContent = (st.opacity != null ? st.opacity : 70) + '%'; }
    var twEl = document.getElementById('llvTimeWindow');
    if (twEl) twEl.value = st.timeWindow || '7d';
  } catch (e) { console.warn('[LLV] load settings error:', e); }
}
// ── /LLV Persist Settings ───────────────────────────────────────────────
var _llvPressTimer = null;
var _llvLongFired = false;
function _llvPressStart(e) {
  _llvLongFired = false;
  _llvPressTimer = setTimeout(function () {
    _llvLongFired = true;
    _llvPressTimer = null;
    openM('mllv');
  }, 500);
}
function _llvPressEnd(e) {
  if (_llvPressTimer) { clearTimeout(_llvPressTimer); _llvPressTimer = null; }
}
// [p19 LLV END] ────────────────────────────────────────────────────────

// ===== HEATMAP =====
function calcHeatmapPockets(klines) {
  if (!klines || klines.length < 50) return [];
  const hs = S.heatmapSettings;
  const closes = klines.map(k => k.close);
  // ATR via unified Wilder — uses hs.atrLen (default 121) as period
  const _hmAtrRes = _calcATRSeries(klines, hs.atrLen || 121, 'wilder');
  const A = (_hmAtrRes.last || 0) * hs.atrBandPct;
  // Pivots
  const w = hs.pivotWidth; const pockets = [];
  for (let i = w; i < klines.length - w; i++) {
    const k = klines[i];
    let isHigh = true, isLow = true;
    for (let j = i - w; j <= i + w; j++) { if (j === i) continue; if (klines[j].high >= k.high) isHigh = false; if (klines[j].low <= k.low) isLow = false; }
    if (isHigh) { pockets.push({ idx: i, side: -1, price: k.high, top: k.high + A, bot: k.high, weight: k.volume * ((k.high - k.low) || 1) * 100, hit: false }); }
    if (isLow) { pockets.push({ idx: i, side: 1, price: k.low, top: k.low, bot: k.low - A, weight: k.volume * ((k.high - k.low) || 1) * 100, hit: false }); }
  }
  const cur = closes[closes.length - 1];
  pockets.forEach(p => { p.hit = p.side === 1 ? cur < p.top : cur > p.bot; });
  return pockets.filter(p => p.weight >= hs.minWeight);
}
function renderHeatmapOverlay() {
  if (!mainChart || !S.klines.length) return;
  clearHeatmap();
  const pockets = calcHeatmapPockets(S.klines.slice(-S.heatmapSettings.lookback));
  if (!pockets.length) return;
  const weights = pockets.map(p => p.weight);
  const maxW = Math.max(...weights) || 1;
  const hs = S.heatmapSettings;
  pockets.slice(-100).forEach(p => {
    const norm = p.weight / maxW;
    const alpha = Math.max(0.05, norm * hs.heatContrast);
    const col = p.side === 1 ? hs.longCol : hs.shortCol;
    const hex = n => Math.round(n * 255).toString(16).padStart(2, '0');
    const colA = col + hex(alpha);
    const mid = (p.top + p.bot) / 2;
    const startIdx = Math.max(0, p.idx);
    const end = p.hit && !hs.keepTouched ? p.idx + hs.extendUnhit / 2 : p.idx + hs.extendUnhit;
    const endIdx = Math.min(S.klines.length - 1, end);
    const pocketTs = S.klines.slice(startIdx, endIdx + 1).map(k => k.time);
    if (!pocketTs.length) return;
    try {
      const topL = mainChart.addLineSeries({ color: col + '33', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      topL.setData(pocketTs.map(t => ({ time: t, value: p.top }))); liqSeries.push(topL);
      const botL = mainChart.addLineSeries({ color: col + '33', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      botL.setData(pocketTs.map(t => ({ time: t, value: p.bot }))); liqSeries.push(botL);
      const distPct = S.price ? ((mid - S.price) / S.price * 100).toFixed(2) : null;
      const amtLabel = p.weight >= 1e6 ? '$' + (p.weight / 1e6).toFixed(1) + 'M' : p.weight >= 1e3 ? '$' + (p.weight / 1e3).toFixed(0) + 'K' : '$' + p.weight.toFixed(0);
      const liqLabel = `${p.side === 1 ? 'LIQ↑' : 'LIQ↓'} ${amtLabel}${distPct ? ' | ' + (distPct > 0 ? '+' : '') + distPct + '%' : ''}`;
      const sm = mainChart.addLineSeries({ color: col + '55', lineWidth: Math.max(4, Math.round(norm * 16)), priceLineVisible: false, lastValueVisible: true, title: liqLabel });
      sm.setData(pocketTs.map(t => ({ time: t, value: mid }))); liqSeries.push(sm);
    } catch (_) { }
  });
}
function renderSROverlay() {
  if (!mainChart || !S.klines.length) return;
  clearSR();
  // Simple support/resistance from recent highs/lows
  const recent = S.klines.slice(-50);
  const highs = recent.map(k => k.high).sort((a, b) => b - a).slice(0, 3);
  const lows = recent.map(k => k.low).sort((a, b) => a - b).slice(0, 3);
  // [PATCH1 B5] Guard against empty klines array
  const _lastK = S.klines[S.klines.length - 1];
  if (!_lastK) return;
  const lastT = _lastK.time;
  const firstT = S.klines[Math.max(0, S.klines.length - 50)].time;
  [...highs.map(v => ({ v, c: '#ff335566' })), ...lows.map(v => ({ v, c: '#00d97a66' }))].forEach(({ v, c }) => {
    try {
      const s = mainChart.addLineSeries({ color: c, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 2 });
      s.setData([{ time: firstT, value: v }, { time: lastT, value: v }]); srSeries.push(s);
    } catch (_) { }
  });
}

// ===== TIMEFRAME =====
function setTF(tf, btn) {
  S.chartTf = tf;
  document.querySelectorAll('.tfb').forEach(b => b.classList.remove('act'));
  if (btn) btn.classList.add('act');
  // Sync dropdown label + active state
  var _ztfLbl = document.getElementById('ztfLabel');
  if (_ztfLbl) _ztfLbl.textContent = tf;
  var _ztfDd = document.getElementById('ztfDropdown');
  if (_ztfDd) _ztfDd.querySelectorAll('.ztf-item').forEach(function (b) {
    b.classList.toggle('act', b.textContent.trim() === tf);
  });
  clearHeatmap(); clearSR();
  // [v108 FIX] Release lock BEFORE fetch — identic cu fix-ul din setSymbol
  FetchLock.release('klines');
  fetchKlines(tf);
  // Re-apply localization AFTER data rebuild so axis doesn't jump
  setTimeout(() => {
    const lf = { timeFormatter: ts => fmtTime(ts), dateFormatter: ts => fmtDate(ts) };
    [mainChart, cvdChart, volChart].forEach(ch => {
      try { if (ch) ch.applyOptions({ localization: lf }); } catch (_) { }
    });
  }, 200);
  _usScheduleSave();  // [US] persist TF change
  setTimeout(updateDeepDive, 500); // [DeepDive] refresh narrative on TF change
}
// Alias pentru HTML care foloseste setTf (lowercase f)
const setTf = setTF;

// ── Timeframe dropdown (Visual-style) ──
function ztfToggle() {
  var w = document.getElementById('ztfWrap');
  if (!w) return;
  w.classList.toggle('open');
}
function ztfPick(tf, btn) {
  // Update dropdown state
  var dd = document.getElementById('ztfDropdown');
  if (dd) dd.querySelectorAll('.ztf-item').forEach(function (b) { b.classList.remove('act'); });
  if (btn) btn.classList.add('act');
  // Update trigger label
  var lbl = document.getElementById('ztfLabel');
  if (lbl) lbl.textContent = tf;
  // Close dropdown
  var w = document.getElementById('ztfWrap');
  if (w) w.classList.remove('open');
  // Call real TF setter
  if (typeof setTF === 'function') setTF(tf, btn);
}
// Close dropdown on outside click
document.addEventListener('click', function (e) {
  var w = document.getElementById('ztfWrap');
  if (w && w.classList.contains('open') && !w.contains(e.target)) {
    w.classList.remove('open');
  }
});
// Sync dropdown label when TF is set externally (e.g. settings hub)
(function _ztfSyncOnLoad() {
  if (typeof S !== 'undefined' && S.chartTf) {
    var lbl = document.getElementById('ztfLabel');
    if (lbl) lbl.textContent = S.chartTf;
    var dd = document.getElementById('ztfDropdown');
    if (dd) {
      dd.querySelectorAll('.ztf-item').forEach(function (b) {
        b.classList.toggle('act', b.textContent.trim() === S.chartTf);
      });
    }
  }
})();

// ===== INDICATORS =====
// [FIX BUG2] togInd defined once in dom.js — this stub removed to prevent overwrite
// function togInd() is now in dom.js with unified state sync

// ===== FULLSCREEN =====
function toggleFS() {
  const sec = el('csec'); const btn = el('fsbtn') || el('fsBtn');
  if (!sec) return;
  const isFull = sec.classList.toggle('fsm');
  if (btn) btn.textContent = isFull ? '⊡' : '⊞';
  const cc = el('cc'); const vc = el('vc');
  if (isFull) {
    // In fullscreen: main chart takes full height, hide CVD+Vol (no overlap)
    const h = window.innerHeight - 100;
    if (mainChart) mainChart.applyOptions({ height: h });
    if (cc) cc.style.display = 'none';
    if (vc) vc.style.display = 'none';
  } else {
    // Restore normal layout
    if (mainChart) mainChart.applyOptions({ height: getChartH() });
    if (cvdChart) cvdChart.applyOptions({ height: window.innerWidth >= 1000 ? 80 : 60 });
    if (volChart) volChart.applyOptions({ height: window.innerWidth >= 1000 ? 60 : 44 });
    if (cc) cc.style.display = '';
    if (vc) vc.style.display = '';
  }
}

// ===== PRICE UPDATE =====
function updatePriceDisplay() {
  if (document.hidden) return; // [PERF] skip DOM writes when tab hidden
  const e = el('bprice'); if (e) e.textContent = '$' + fP(S.price);
  const c = (S.price - S.prevPrice) / S.prevPrice * 100;
  const bc = el('bchg');
  if (bc) { bc.className = 'bchg ' + (c >= 0 ? 'up' : 'dn'); bc.textContent = (c >= 0 ? '▲ ' : '▼ ') + Math.abs(c).toFixed(2) + '%'; }
  calcSRTable();
  updateMetrics();
  // Actualizeaza liq price in timp real
  if (TP.demoOpen) updateDemoLiqPrice();
  if (TP.liveOpen) updateLiveLiqPrice();
  if (typeof _demoTick === 'function') _demoTick();
}

// ===== FUNDING COUNTDOWN =====
function calcFrCd() {
  if (S.frCd === null) return '—';
  const now = new Date();
  const h = now.getUTCHours(), m = now.getUTCMinutes(), s = now.getUTCSeconds();
  const nextH = Math.ceil((h + 1) / 8) * 8 % 24;
  const diff = (nextH * 3600) - (h * 3600 + m * 60 + s);
  const d = diff < 0 ? diff + 86400 : diff;
  return Math.floor(d / 3600).toString().padStart(2, '0') + ':' + Math.floor((d % 3600) / 60).toString().padStart(2, '0') + ':' + Math.floor(d % 60).toString().padStart(2, '0');
}

// ===== SAFE FETCH WRAPPER (v119) =====
// Inlocuieste fetch() simplu — are timeout, retry, nu blocheaza engine.
// Folosit DOAR pentru endpoint-uri care returneaza JSON.
async function safeFetch(url, options = {}, timeout = 8000, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.json();
    } catch (err) {
      if (i === retries) {
        console.error('[safeFetch] failed after retries:', url, err.message);
        throw err;
      }
      // small backoff before retry
      await new Promise(r => setTimeout(r, 300 * (i + 1)));
    }
  }
}

// ===== THROTTLED UI UPDATE (v119) =====
// Throttle DOAR pentru render DOM — calc/trade nu sunt atinse.
let _lastMainMetricsUpdate = 0;
function throttledMainMetrics() {
  const now = Date.now();
  if (now - _lastMainMetricsUpdate < 500) return; // 500ms throttle pe UI
  _lastMainMetricsUpdate = now;
  if (typeof updateMainMetrics === 'function') updateMainMetrics();
}

// ===== API FETCHES =====
async function fetchRSI(tf) {
  try {
    const sym = S.symbol || 'BTCUSDT';
    const map = { '5m': '5m', '15m': '15m', '1h': '1h', '3h': '4h', '4h': '4h', '1d': '1d' }; // [v122 FIX#1] 3h→4h: Binance fapi klines does not support 3h, returns HTTP 400
    const itf = map[tf] || tf;
    const d = await safeFetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${itf}&limit=50`);
    if (!Array.isArray(d)) throw new Error('Răspuns invalid RSI');
    const closes = d.map(k => +k[4]);
    const rsi = calcRSI(closes);
    S.rsi[tf] = rsi;
    // Store for signal scanner
    if (!S.rsiData) S.rsiData = {};
    S.rsiData[tf] = rsi;
    renderRSI();
    if (rsi !== null) checkRSIAlerts(rsi, tf);
  } catch (e) {
    console.warn('[fetchRSI]', tf, e.message);
  }
}
async function fetchAllRSI() {
  const now = new Date();
  const upd = el('rsiupd'); if (upd) upd.textContent = 'UPD ' + now.toLocaleTimeString('ro-RO', { timeZone: S.tz || 'Europe/Bucharest' });
  await Promise.all(['5m', '15m', '1h', '3h', '4h', '1d'].map(fetchRSI));
}
async function fetchFG() {
  try {
    const d = await safeFetch('/api/fng');
    if (!d.data || !d.data[0]) throw new Error('Date Fear&Greed invalide');
    const val = +d.data[0].value, cls = d.data[0].value_classification;
    const yd = d.data[1] ? +d.data[1].value : null;
    const colors = { 'Fear': '#ff8800', 'Extreme Fear': '#ff3355', 'Greed': '#00cc77', 'Extreme Greed': '#00ff99', 'Neutral': '#7a9ab8' };
    const col = colors[cls] || '#7a9ab8';
    // Bug fix: ID-uri corecte din HTML
    const ev = el('fgval'); if (ev) { ev.textContent = val; ev.style.color = col; }
    const el2 = el('fglbl'); if (el2) { el2.textContent = cls.toUpperCase(); el2.style.color = col; }
    const efg = el('fgf'); if (efg) { efg.style.width = val + '%'; efg.style.background = col; }
    const ech = el('fgch'); if (ech) ech.textContent = 'Yesterday: ' + (yd || '—') + ' | Week: —';
    // Bug fix: Folosim SVG arc, nu canvas
    const arc = el('fgarc');
    if (arc) {
      const circ = 175.93;
      const offset = circ - (val / 100) * circ;
      arc.style.strokeDashoffset = offset;
      arc.style.stroke = col;
    }
  } catch (e) { console.warn('[fetchFG]', e.message); }
}
async function fetchATR() {
  try {
    const sym = S.symbol || 'BTCUSDT';
    // NOTE: fetches 1h klines (different TF than S.klines which is 5m) — intentional, unchanged
    const d = await safeFetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1h&limit=32`);
    if (!Array.isArray(d) || d.length < 16) throw new Error('Date ATR insuficiente');
    // Convert raw Binance klines to {high,low,close} for _calcATRSeries
    const klinesForATR = d.map(k => ({ high: +k[2], low: +k[3], close: +k[4] }));
    const atrRes = _calcATRSeries(klinesForATR, 14, 'wilder');
    if (atrRes.last === null) throw new Error('ATR Wilder: date insuficiente dupa calcul');
    S.atr = atrRes.last;
    S.atrSeries1h = atrRes.series; // store for optional use
    renderChart(); throttledMainMetrics();
  } catch (e) { console.warn('[fetchATR]', e.message); }
}
async function fetchOI() {
  try {
    const sym = S.symbol || 'BTCUSDT';
    const d = await safeFetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${sym}`);
    if (!d.openInterest) throw new Error('Date OI invalide');
    S.oiPrev = S.oi; S.oi = +d.openInterest * (S.price || 1);
    S.oiTs = Date.now(); // [ZT-AUD-B3] OI freshness timestamp
    updateMetrics(); throttledMainMetrics();
  } catch (e) { console.warn('[fetchOI]', e.message); }
}
async function fetchLS() {
  try {
    const sym = S.symbol || 'BTCUSDT';
    const d = await safeFetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=5m&limit=1`);
    if (Array.isArray(d) && d[0]) { S.ls = { l: +d[0].longAccount, s: +d[0].shortAccount }; updateMetrics(); updateMainMetrics(); }
  } catch (e) { console.warn('[fetchLS]', e.message); }
}
async function fetch24h() {
  try {
    const sym = S.symbol || 'BTCUSDT';
    const d = await safeFetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${sym}`);
    if (!d.highPrice) throw new Error('Date 24h invalide');
    S.high = +d.highPrice; S.low = +d.lowPrice;
    const h = el('d24h'); const l = el('d24l');
    if (h) h.textContent = 'H: $' + fP(S.high);
    if (l) l.textContent = 'L: $' + fP(S.low);
  } catch (e) { console.warn('[fetch24h]', e.message); }
}

// ===== METRICS TABLE =====
function setDtTf(tf, btn) {
  S.dtTf = tf;
  document.querySelectorAll('.dtt').forEach(b => b.classList.remove('act'));
  if (btn) btn.classList.add('act');
  updateMetrics();
}
function updateMetrics() {
  // Bug fix: Folosim ID-urile individuale din HTML (dtp, dtoi, dtfr, dtls, dtrsi)
  // PRICE
  const dtp = el('dtp'), dtpc = el('dtpc'), dtps = el('dtps');
  if (dtp) dtp.textContent = S.price ? '$' + fP(S.price) : '—';
  if (dtpc) { const c = S.prevPrice ? ((S.price - S.prevPrice) / S.prevPrice * 100).toFixed(2) + '%' : '—'; dtpc.textContent = c; dtpc.style.color = S.price >= S.prevPrice ? 'var(--grn)' : 'var(--red)'; }
  if (dtps) { dtps.textContent = S.price > S.prevPrice ? 'BULL' : 'BEAR'; dtps.style.color = S.price > S.prevPrice ? 'var(--grn)' : 'var(--red)'; }
  // OPEN INTEREST
  const dtoi = el('dtoi'), dtoic = el('dtoic'), dtois = el('dtois');
  if (dtoi) dtoi.textContent = S.oi ? '$' + fmt(S.oi) : '—';
  if (dtoic) dtoic.textContent = S.oiPrev && S.oi ? (((S.oi - S.oiPrev) / S.oiPrev) * 100).toFixed(2) + '%' : '—';
  if (dtois) { const s = S.oi > S.oiPrev ? 'RISING' : 'FALLING'; dtois.textContent = s; dtois.style.color = s === 'RISING' ? 'var(--grn)' : 'var(--red)'; }
  // FUNDING RATE
  const dtfr = el('dtfr'), dtfrc = el('dtfrc'), dtfrs = el('dtfrs');
  if (dtfr) dtfr.textContent = S.fr !== null && S.fr !== undefined ? (S.fr * 100).toFixed(4) + '%' : '—';
  if (dtfrc) dtfrc.textContent = calcFrCd();
  if (dtfrs) { const s = S.fr > 0 ? 'LONGS PAY' : S.fr < 0 ? 'SHORTS PAY' : 'NEUTRAL'; dtfrs.textContent = s; dtfrs.style.color = S.fr > 0 ? 'var(--red)' : S.fr < 0 ? 'var(--grn)' : 'var(--dim)'; }
  // LONG/SHORT
  const dtls = el('dtls'), dtlsc = el('dtlsc'), dtlss = el('dtlss');
  if (dtls) dtls.textContent = S.ls ? S.ls.l.toFixed(1) + '% / ' + S.ls.s.toFixed(1) + '%' : '—';
  if (dtlsc) dtlsc.textContent = '—';
  if (dtlss) { const s = S.ls ? (S.ls.l > 55 ? 'LONG HEAVY' : S.ls.s > 55 ? 'SHORT HEAVY' : 'BALANCED') : '—'; if (dtlss) dtlss.textContent = s; if (dtlss) dtlss.style.color = s === 'LONG HEAVY' ? 'var(--grn)' : s === 'SHORT HEAVY' ? 'var(--red)' : 'var(--dim)'; }
  // RSI
  const dtrsi = el('dtrsi'), dtrsic = el('dtrsic'), dtrsis = el('dtrsis');
  const rsi5 = S.rsi['5m'], rsi1h = S.rsi['1h'];
  if (dtrsi) dtrsi.textContent = rsi5 ? rsi5.toFixed(1) : '—';
  if (dtrsic) dtrsic.textContent = rsi1h ? rsi1h.toFixed(1) : '—';
  if (dtrsis) { const s = rsi5 > 70 ? 'OVERBOUGHT' : rsi5 < 30 ? 'OVERSOLD' : 'NEUTRAL'; dtrsis.textContent = s; dtrsis.style.color = rsi5 > 70 ? 'var(--red)' : rsi5 < 30 ? 'var(--grn)' : 'var(--dim)'; }
}

// ===== RSI DISPLAY =====
function renderRSI() {
  // Map: elementId → timeframe key in S.rsi, barId
  const map = [
    { eid: 'rn', bid: 'rb0', tf: '5m' },
    { eid: 'r15', bid: 'rb1', tf: '15m' },
    { eid: 'r1h', bid: 'rb2', tf: '1h' },
    { eid: 'r3h', bid: 'rb3', tf: '3h' },
    { eid: 'r4h', bid: 'rb4', tf: '4h' },
    { eid: 'r1d', bid: 'rb5', tf: '1d' },
  ];
  map.forEach(({ eid, bid, tf }) => {
    const e = el(eid); if (!e) return;
    const v = S.rsi[tf];
    if (v === null || v === undefined) { e.textContent = '—'; e.className = 'rsiv mid'; return; }
    e.textContent = v.toFixed(2);
    e.className = 'rsiv ' + (v > 70 ? 'ob' : v < 30 ? 'os' : 'mid');
    const bar = el(bid);
    const col = v > 70 ? '#ff3355' : v < 30 ? '#00d97a' : '#7a9ab8';
    if (bar) { bar.style.width = Math.max(5, Math.min(100, v)) + '%'; bar.style.background = col; }
  });
}

// ===== SR TABLE =====
function calcSRTable() {
  const p = S.price; if (!p) return;
  const atr = S.atr || p * 0.01;
  // Bug fix: ID-urile corecte din HTML: sr3/sd3, sr2/sd2, etc.
  const levels = [
    { pid: 'sr3', did: 'sd3', v: p + atr * 3 },
    { pid: 'sr2', did: 'sd2', v: p + atr * 2 },
    { pid: 'sr1', did: 'sd1', v: p + atr },
    { pid: 'srdt', did: 'sddt', v: p + atr * 0.5 },
    { pid: 'srnow', did: null, v: p },
    { pid: 'srdb', did: 'sddb', v: p - atr * 0.5 },
    { pid: 'ss1', did: 'sds1', v: p - atr },
    { pid: 'ss2', did: 'sds2', v: p - atr * 2 },
    { pid: 'ss3', did: 'sds3', v: p - atr * 3 },
    { pid: 'szh', did: 'sdh', v: p + atr * 4 },
    { pid: 'szl', did: 'sdl', v: p - atr * 4 },
  ];
  levels.forEach(lv => {
    const ev = el(lv.pid), ed = lv.did ? el(lv.did) : null;
    if (ev) ev.textContent = '$' + fP(lv.v);
    if (ed) { const d = ((lv.v - p) / p * 100); ed.textContent = (d >= 0 ? '+' : '') + d.toFixed(2) + '%'; ed.style.color = d > 0 ? 'var(--grn)' : 'var(--red)'; }
  });
}

// ===== CONNECT BINANCE WS =====
// ── WS RECONNECT BACKOFF STATE ──────────────────────────────
const _wsBackoff = { bnb: 0, byb: 0, wl: 0 };
function _nextBackoff(key, base, cap) {
  const attempt = _wsBackoff[key] || 0;
  const delay = Math.min(cap, base * Math.pow(2, attempt));
  _wsBackoff[key] = attempt + 1;
  return delay;
}
function _resetBackoff(key) { _wsBackoff[key] = 0; }

function connectBNB() {
  const sym = (S.symbol || 'BTCUSDT').toLowerCase();
  const url = `wss://fstream.binance.com/stream?streams=${sym}@markPrice@1s/${sym}@depth20@500ms/!forceOrder@arr`;
  const _bnbGen = window.__wsGen; // capture generation
  console.log(`[connectBNB] attempt | sym=${sym} | gen=${_bnbGen}`);
  WS.open('bnb', url, {
    onopen: () => {
      console.log(`[connectBNB] onopen | gen=${window.__wsGen} (my gen=${_bnbGen})`);
      S.bnbOk = true; _resetBackoff('bnb'); _exitRecoveryMode(); updConn();
    },
    onclose: () => {
      console.log(`[connectBNB] onclose | S.bnbOk → false`);
      S.bnbOk = false; _enterRecoveryMode('BNB'); updConn();
      // [FIX v85 BUG3] Reconectare doar dacă generația n-a fost schimbată (setSymbol nu a fost apelat)
      Timeouts.set('bnbReconnect', () => {
        if (window.__wsGen !== _bnbGen) return; // simbol schimbat, nu reconecta — noul connectBNB() deja rulează
        _exitRecoveryMode(); connectBNB();
      }, _nextBackoff('bnb', 3000, 30000));
    },
    onerror: (e) => {
      console.error(`[connectBNB] onerror`, e);
      if (typeof ZLOG !== 'undefined') ZLOG.push('WARN', '[WS BNB] onerror');
      S.bnbOk = false; updConn();
    },
    onmessage: e => {
      if (window.__wsGen !== _bnbGen) return; // gen guard
      const j = JSON.parse(e.data);
      if (j.stream) {
        const d = j.data; const st = j.stream;
        if (st.includes('markPrice')) {
          if (ingestPrice(d.p, 'BNB')) {
            S.fr = _safe.num(d.r, 'fr', 0); S.frCd = +d.T;
            updatePriceDisplay(); updateMainMetrics();
            if (TP.demoPositions?.some(p => p.autoTrade)) renderATPositions();
          }
        } else if (st.includes('depth20')) {
          S.bids = (d.b || []).map(([p, q]) => ({ p: +p, q: +q }));
          S.asks = (d.a || []).map(([p, q]) => ({ p: +p, q: +q }));
          renderOB();
        } else if (st.includes('forceOrder')) {
          if (Array.isArray(d)) d.forEach(o => procLiq(o.o || o, 'bnb'));
          else procLiq(d.o || d, 'bnb');
        }
      }
    }
  });
}

// ===== CONNECT BYBIT WS =====
// [FIX] BYB ping keepalive — Bybit v5 requires {"op":"ping"} every 20s or server disconnects
let _bybPingTimer = null;
function _stopBybPing() {
  if (_bybPingTimer) { clearInterval(_bybPingTimer); _bybPingTimer = null; }
}
function connectBYB() {
  _stopBybPing(); // cleanup any leftover ping timer before reconnect
  const sym = S.symbol || 'BTCUSDT';
  const _bybGen = window.__wsGen; // capture generation
  console.log(`[connectBYB] attempt | sym=${sym} | gen=${_bybGen}`);
  WS.open('byb', 'wss://stream.bybit.com/v5/public/linear', {
    onopen: () => {
      console.log(`[connectBYB] onopen | gen=${window.__wsGen} (my gen=${_bybGen})`);
      S.bybOk = true; _resetBackoff('byb'); _exitDegradedMode('BYB'); updConn();
      S.liqMetrics.byb.connected = true; S.liqMetrics.byb.connectedAt = Date.now();
      const wsi = WS.get('byb');
      if (wsi) wsi.send(JSON.stringify({ op: 'subscribe', args: [`liquidation.${sym}`] }));
      // ── BYB PING KEEPALIVE — 20s interval ──
      _stopBybPing(); // ensure no duplicate
      _bybPingTimer = setInterval(() => {
        try {
          const ws = WS.get('byb');
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: 'ping' }));
          }
        } catch (_) { /* send fail is harmless — onclose will handle reconnect */ }
      }, 20000);
    },
    onclose: () => {
      _stopBybPing();
      console.log(`[connectBYB] onclose | S.bybOk → false`);
      S.bybOk = false; S.liqMetrics.byb.connected = false; S.liqMetrics.byb.reconnects++; _enterDegradedMode('BYB'); updConn();
      // [FIX v85 BUG3] Reconectare doar dacă generația n-a fost schimbată
      Timeouts.set('bybReconnect', () => {
        if (window.__wsGen !== _bybGen) return;
        connectBYB();
      }, _nextBackoff('byb', 5000, 30000));
    },
    onerror: () => {
      if (typeof ZLOG !== 'undefined') ZLOG.push('WARN', '[WS BYB] onerror');
    },
    onmessage: e => {
      if (window.__wsGen !== _bybGen) return; // gen guard
      const j = JSON.parse(e.data);
      if (j.topic && j.topic.includes('liquidation') && j.data) {
        const d = j.data;
        const o = { s: d.symbol, S: d.side === 'Buy' ? 'SELL' : 'BUY', q: +d.size, p: +d.price };
        S.liqMetrics.byb.msgCount++;
        procLiq(o, 'byb');
      }
    }
  });
}

// ===== CONNECTION STATUS =====
function updConn() {
  const dot = el('ldot'), lbl = el('llbl');
  const ok = S.bnbOk || S.bybOk;
  const degraded = _isDegradedOnly();
  // dot: green=live, yellow=degraded, grey=disconnected
  if (dot) {
    dot.className = 'ldot' + (ok ? (degraded ? ' degraded' : ' on') : '');
  }
  if (lbl) lbl.textContent = ok ? (degraded ? 'DEGRADED' : 'LIVE') : 'CONNECTING';
  const bv = el('bns'); const byv = el('bys');
  if (bv) bv.textContent = 'BNB:' + (S.bnbOk ? 'LIVE' : '—');
  if (byv) byv.textContent = 'BYB:' + (S.bybOk ? 'LIVE' : '—' + (degraded ? ' [!]' : ''));
  updBybHealth();
}

// ===== PROCESS LIQUIDATION =====
function procLiq(o, src) {
  if (!o || !o.q || !o.p) return;
  src = src || 'bnb'; // default to Binance if untagged
  const qty = +o.q, price = +o.p;
  const sym = (o.s || '').replace('USDT', '').substring(0, 3);
  const usd = qty * price;
  if (usd < S.liqMinUsd) return;
  const isLong = o.S === 'SELL';
  // ── Liq Metrics per source ──
  const m = S.liqMetrics[src] || S.liqMetrics.bnb;
  m.count++; m.usd += usd; m.lastTs = Date.now();
  S.totalUSD += usd; if (isLong) S.longUSD += usd; else S.shortUSD += usd;
  S.cnt++; if (isLong) S.longCnt++; else S.shortCnt++;
  // ── Dedup: check similarity with last 3 events (same sym, side, ±0.1% price, <2s) ──
  const now = Date.now();
  let dupFlag = false;
  for (let i = 0; i < Math.min(3, S.events.length); i++) {
    const prev = S.events[i];
    if (prev.sym === sym && prev.isLong === isLong && now - prev.ts < 2000 &&
      Math.abs(prev.price - price) / price < 0.001) {
      dupFlag = true; break;
    }
  }
  // Buckets
  const bi = S.bIdx % 20;
  S.buckets[bi].l += isLong ? usd : 0; S.buckets[bi].s += isLong ? 0 : usd;
  // Events (with source tag + dedup marker)
  S.events.unshift({ sym, usd, isLong, price, ts: now, src, dup: dupFlag });
  if (S.events.length > 100) S.events.pop();
  updLiqStats(); renderFeed();
  if (sym === 'BTC' || sym === S.symbol.replace('USDT', '').substring(0, 3)) {
    var _bkt = S.llvSettings.bucketPct || 0.3;
    var _step = price * _bkt / 100;
    var _pkey = Math.round(price / _step) * _step;
    _pkey = Math.round(_pkey);
    // Legacy clusters (keep existing)
    var _pk100 = Math.round(price / 100) * 100;
    S.btcClusters[_pk100] = S.btcClusters[_pk100] || { price: _pk100, vol: 0, isLong, bnbUsd: 0, bybUsd: 0 };
    S.btcClusters[_pk100].vol += usd;
    if (src === 'byb') S.btcClusters[_pk100].bybUsd += usd; else S.btcClusters[_pk100].bnbUsd += usd;
    // LLV enhanced buckets
    S.llvBuckets = S.llvBuckets || {};
    S.llvBuckets[_pkey] = S.llvBuckets[_pkey] || { price: _pkey, longUSD: 0, shortUSD: 0, longBTC: 0, shortBTC: 0, ts: Date.now() };
    if (isLong) { S.llvBuckets[_pkey].longUSD += usd; S.llvBuckets[_pkey].longBTC += qty; }
    else { S.llvBuckets[_pkey].shortUSD += usd; S.llvBuckets[_pkey].shortBTC += qty; }
    S.llvBuckets[_pkey].ts = Date.now();
    // Refresh overlay if active
    if (S.overlays.llv) { llvRequestRender(); }
  }
  checkLiqAlert(usd, qty, isLong ? 'LONG' : 'SHORT', sym);
}

// ===== LIQ STATS =====
function updLiqStats() {
  // Bug fix: ID-uri corecte din HTML
  const le = el('llc'), se = el('lsc'); // llc/lsc (nu lcntl/lcnts)
  if (le) le.textContent = S.longCnt; if (se) se.textContent = S.shortCnt;
  const lu = el('llu'), su = el('lsu'); // llu/lsu (nu lusd/susd)
  if (lu) lu.textContent = '$' + fmt(S.longUSD); if (su) su.textContent = '$' + fmt(S.shortUSD);
  const avgl = el('lla'), avgs = el('lsa'); // lla/lsa (nu lavg/savg)
  if (avgl) avgl.textContent = S.longCnt ? 'avg: $' + fmt(S.longUSD / S.longCnt) : 'avg: —';
  if (avgs) avgs.textContent = S.shortCnt ? 'avg: $' + fmt(S.shortUSD / S.shortCnt) : 'avg: —';
  const rate = el('lrate'); if (rate) rate.textContent = ((S.longCnt + S.shortCnt) / Math.max(1, (Date.now() - performance.timeOrigin) * 0.001) * 60).toFixed(0);
  const loss = el('lloss'); if (loss) loss.textContent = '$' + fmt(S.totalUSD);
  // Totals in LIQUIDATION OVERVIEW section
  const t1 = el('tv'), tl = el('lv'), ts = el('sv'), tc = el('cv'); // tv/lv/sv/cv (nu ltot1/ltotl/ltots/ltotc)
  if (t1) t1.textContent = '$' + fmt(S.totalUSD);
  if (tl) tl.textContent = '$' + fmt(S.longUSD);
  if (ts) ts.textContent = '$' + fmt(S.shortUSD);
  if (tc) tc.textContent = S.cnt;
  // Ratio bar - rfill/lplbl/splbl (nu lsbar/lslong/lsshort)
  const bar = el('rfill');
  if (bar && S.totalUSD > 0) { const lp = S.longUSD / S.totalUSD * 100; bar.style.width = lp + '%'; }
  const lpc = el('lplbl'), spc = el('splbl');
  if (lpc && S.totalUSD > 0) lpc.textContent = 'LONG ' + ((S.longUSD / S.totalUSD) * 100).toFixed(0) + '%';
  if (spc && S.totalUSD > 0) spc.textContent = 'SHORT ' + ((S.shortUSD / S.totalUSD) * 100).toFixed(0) + '%';
  // Calm indicator
  const calm = el('calm');
  if (calm) {
    const recent = S.events.filter(e => Date.now() - e.ts < 60000);
    const bigLiq = recent.filter(e => e.usd > 100000).length;
    calm.innerHTML = bigLiq > 5 ? _ZI.fire + ' HOT' : bigLiq > 2 ? _ZI.bolt + ' ACTIVE' : 'CALM';
    calm.style.color = bigLiq > 5 ? 'var(--red)' : bigLiq > 2 ? 'var(--ylw)' : 'var(--dim)';
  }
  // Window stats
  const now = Date.now();
  const w1m = S.events.filter(e => now - e.ts < 60000);
  const w5m = S.events.filter(e => now - e.ts < 300000);
  const w15m = S.events.filter(e => now - e.ts < 900000);
  // 1m stats - t1l/t1s/t1v
  const e1m = el('t1l'), e1ms = el('t1s'), e1mv = el('t1v');
  if (e1m) e1m.textContent = w1m.filter(e => e.isLong).length + 'L';
  if (e1ms) e1ms.textContent = w1m.filter(e => !e.isLong).length + 'S';
  if (e1mv) e1mv.textContent = '$' + fmt(w1m.reduce((a, e) => a + e.usd, 0));
  // 5m stats - t5l/t5s/t5v
  const e5ml = el('t5l'), e5ms = el('t5s'), e5mv = el('t5v');
  if (e5ml) e5ml.textContent = w5m.filter(e => e.isLong).length + 'L';
  if (e5ms) e5ms.textContent = w5m.filter(e => !e.isLong).length + 'S';
  if (e5mv) e5mv.textContent = '$' + fmt(w5m.reduce((a, e) => a + e.usd, 0));
  // 15m stats - t15l/t15s/t15v
  const e15ml = el('t15l'), e15ms = el('t15s'), e15mv = el('t15v');
  if (e15ml) e15ml.textContent = w15m.filter(e => e.isLong).length + 'L';
  if (e15ms) e15ms.textContent = w15m.filter(e => !e.isLong).length + 'S';
  if (e15mv) e15mv.textContent = '$' + fmt(w15m.reduce((a, e) => a + e.usd, 0));
  // Hot zones si market pressure
  renderHotZones();
  updMarketPressure();
  updLiqSourceMetrics();
}

// ===== LIQ SOURCE METRICS =====
function updLiqSourceMetrics() {
  const mb = S.liqMetrics.bnb, my = S.liqMetrics.byb;
  const total = mb.count + my.count || 1;
  const bnbPct = (mb.count / total * 100).toFixed(0);
  const bybPct = (my.count / total * 100).toFixed(0);
  const ebc = el('lm-bnb-cnt'), ebu = el('lm-bnb-usd'), ebp = el('lm-bnb-pct');
  const eyc = el('lm-byb-cnt'), eyu = el('lm-byb-usd'), eyp = el('lm-byb-pct');
  if (ebc) ebc.textContent = mb.count;
  if (ebu) ebu.textContent = '$' + fmt(mb.usd);
  if (ebp) ebp.textContent = bnbPct + '%';
  if (eyc) eyc.textContent = my.count;
  if (eyu) eyu.textContent = '$' + fmt(my.usd);
  if (eyp) eyp.textContent = bybPct + '%';
  // Last source indicator
  const elast = el('lm-last-src');
  if (elast) {
    const lastEvt = S.events[0];
    if (lastEvt) { elast.textContent = lastEvt.src === 'byb' ? 'BYB' : 'BNB'; elast.style.color = lastEvt.src === 'byb' ? 'var(--ylw)' : 'var(--grn)'; }
  }
  // Dedup count
  const edup = el('lm-dup-cnt');
  if (edup) edup.textContent = S.events.filter(e => e.dup).length;
}

// ===== BYB HEALTH PANEL =====
function updBybHealth() {
  const my = S.liqMetrics.byb;
  const eSt = el('byb-h-status'), eRc = el('byb-h-reconn'), eRate = el('byb-h-rate'), eAge = el('byb-h-age');
  if (eSt) {
    const st = S.bybOk ? 'CONNECTED' : (my.reconnects > 0 ? 'DEGRADED' : 'DISCONNECTED');
    eSt.textContent = st;
    eSt.style.color = S.bybOk ? 'var(--grn)' : 'var(--red)';
  }
  if (eRc) eRc.textContent = my.reconnects;
  if (eRate) {
    // events per minute over last 60s
    const now = Date.now();
    const recent = S.events.filter(e => e.src === 'byb' && now - e.ts < 60000);
    eRate.textContent = recent.length + '/min';
  }
  if (eAge) {
    if (my.lastTs) {
      const age = Math.round((Date.now() - my.lastTs) / 1000);
      eAge.textContent = age < 60 ? age + 's ago' : Math.round(age / 60) + 'm ago';
      eAge.style.color = age > 120 ? 'var(--red)' : age > 60 ? 'var(--ylw)' : 'var(--dim)';
    } else { eAge.textContent = '—'; }
  }
}

// ===== ORDER BOOK ===== [PERF] throttled to 300ms
var _lastRenderOB = 0;
function renderOB() {
  var _now = Date.now(); if (_now - _lastRenderOB < 300) return; _lastRenderOB = _now;
  if (!S.asks.length && !S.bids.length) return;
  const top = 5;
  let ah = '', bh = '';
  const maxSz = Math.max(...S.asks.slice(0, top).map(x => x.q), ...S.bids.slice(0, top).map(x => x.q), 1);
  S.asks.slice(0, top).reverse().forEach(a => {
    const pct = a.q / maxSz * 100;
    ah += `<tr><td style="color:var(--red)">${fP(a.p)}</td><td style="color:var(--dim);text-align:right">${a.q.toFixed(3)}</td><td style="width:60px"><div style="height:6px;background:#ff335533;width:${pct}%"></div></td></tr>`;
  });
  S.bids.slice(0, top).forEach(b => {
    const pct = b.q / maxSz * 100;
    bh += `<tr><td style="color:var(--grn)">${fP(b.p)}</td><td style="color:var(--dim);text-align:right">${b.q.toFixed(3)}</td><td style="width:60px"><div style="height:6px;background:#00d97a33;width:${pct}%"></div></td></tr>`;
  });
  const ae = el('askc'), be = el('bidc');
  if (ae) ae.innerHTML = ah; if (be) be.innerHTML = bh;
  const sp = S.asks.length && S.bids.length ? S.asks[0].p - S.bids[0].p : 0;
  const spe = el('spread'); if (spe) spe.textContent = 'SPREAD: $' + sp.toFixed(2);
}


// ===== HOT ZONES =====
function renderHotZones() {
  const hz = el('hzc'); if (!hz) return; // Bug fix: 'hzc' nu 'hotz'
  const clusters = Object.values(S.btcClusters).sort((a, b) => b.vol - a.vol).slice(0, 5);
  if (!clusters.length) { hz.innerHTML = '<div style="color:var(--dim);font-size:13px;text-align:center;padding:12px">Accumulating data...</div>'; return; }
  const maxV = Math.max(...clusters.map(c => c.vol), 1);
  hz.innerHTML = clusters.map(c => {
    const pct = c.vol / maxV * 100;
    const col = c.isLong ? 'var(--red)' : 'var(--grn)';
    const dist = S.price ? ((c.price - S.price) / S.price * 100) : 0;
    return `<div class="hzrow">
      <div style="color:${col};font-size:13px">${c.isLong ? 'LONG' : 'SHORT'} $${fP(c.price)} <span style="color:var(--dim)">${dist >= 0 ? '+' : ''}${dist.toFixed(2)}%</span></div>
      <div style="display:flex;align-items:center;gap:4px"><div style="flex:1;height:4px;background:#1a2530;border-radius:2px"><div style="height:4px;background:${col};width:${pct}%;border-radius:2px"></div></div><span style="color:var(--whi);font-size:12px">$${fmt(c.vol)}</span></div>
    </div>`;
  }).join('');
}

// ===== MARKET PRESSURE =====
function updMarketPressure() {
  const e = el('pvv'); if (!e) return; // Bug fix: 'pvv' nu 'mpres'
  const total = S.totalUSD; if (!total) { e.textContent = 'NEUTRAL'; e.className = 'pvv neut'; return; }
  const ratio = S.longUSD / total;
  if (ratio > 0.65) { e.textContent = 'SHORT HEAVY'; e.className = 'pvv bears'; }
  else if (ratio < 0.35) { e.textContent = 'LONG HEAVY'; e.className = 'pvv bulls'; }
  else { e.textContent = 'NEUTRAL'; e.className = 'pvv neut'; }
}

// ===== FEED =====
// ── Source filter state for liq feed ──
let _liqSrcFilter = 'all'; // 'all' | 'bnb' | 'byb'
function setLiqSrcFilter(v) { _liqSrcFilter = v; renderFeed(); updLiqFilterBtns(); }
function updLiqFilterBtns() {
  ['all', 'bnb', 'byb'].forEach(k => {
    const b = el('lf-' + k);
    if (b) b.className = 'liq-fbtn' + (_liqSrcFilter === k ? ' act' : '');
  });
}
function renderFeed() {
  const fd = el('fdlist'); if (!fd) return;
  // Filter events by current symbol (base asset)
  const base = (S.symbol || 'BTCUSDT').replace('USDT', '').replace('BUSD', '');
  let filtered = S.events.filter(e => e.sym && e.sym.toUpperCase().startsWith(base.toUpperCase()));
  // Source filter
  if (_liqSrcFilter !== 'all') filtered = filtered.filter(e => e.src === _liqSrcFilter);
  const html = filtered.slice(0, 30).map(e => {
    const col = e.isLong ? 'var(--red)' : 'var(--grn)';
    const icon = e.usd >= 1e6 ? _ZI.fire : e.usd >= 500000 ? _ZI.boom : _ZI.drop;
    const srcTag = e.src === 'byb' ? '<span class="liq-src-byb">BYB</span>' : '<span class="liq-src-bnb">BNB</span>';
    const dupTag = e.dup ? '<span class="liq-dup">DUP?</span>' : '';
    return `<div class="fdrow" style="border-left:2px solid ${col};padding-left:6px">
      <span style="color:${col}">${icon} ${e.sym} ${e.isLong ? 'LONG LIQ' : 'SHORT LIQ'}</span>
      ${srcTag}${dupTag}
      <span style="color:var(--whi)">$${fmt(e.usd)}</span>
      <span style="color:var(--dim)">@${fP(e.price)}</span>
    </div>`;
  }).join('');
  fd.innerHTML = html || `<div style="color:var(--dim);font-size:13px;padding:8px">Waiting for ${base} liquidations...</div>`;
  const cnt = el('fcnt'); if (cnt) cnt.textContent = filtered.length + ' events' + (_liqSrcFilter !== 'all' ? ' (' + _liqSrcFilter.toUpperCase() + ')' : '');
}

// ===== MODULE: SYMBOL =====
// ===== SYMBOL SWITCH =====
function setSymbol(sym) {
  console.log(`[setSymbol] called with '${sym}' | current __wsGen=${window.__wsGen}`);
  // [PATCH4 W2] Wrap entire body in try/finally so chained wrappers in orderflow never break
  try {
    // ── GENERATION TOKEN: invalidates all old WS handlers ──
    window.__wsGen = (window.__wsGen || 0) + 1;
    console.log(`[setSymbol] __wsGen incremented → ${window.__wsGen}`);
    // ── CLOSE WS FIRST before clearing buffers ──
    WS.closeSymbolFeeds();           // closes 'bnb', 'byb', 'kline', 'of_agg'
    if (S.wsK) { try { S.wsK.close(); } catch (_) { } S.wsK = null; }
    // [FIX v85 BUG10] Curăță seriile de sesiune la schimb simbol pentru a preveni memory leak
    if (typeof clearAllSessionOverlays === 'function') clearAllSessionOverlays();
    // ── Clear buffers AFTER WS closed ──
    S.symbol = sym;
    if (typeof ZLOG !== 'undefined') ZLOG.push('INFO', '[SYM] → ' + sym);
    const lbl = el('chartTitleLbl'); if (lbl) lbl.textContent = sym;
    S.klines = []; S.btcClusters = {}; S.events = [];
    S.price = 0; S.totalUSD = 0; S.longUSD = 0; S.shortUSD = 0; S.cnt = 0; S.longCnt = 0; S.shortCnt = 0;
    // [PATCH4 W1] Clear stale orderbook + liquidation buffers on symbol switch
    S.bids = []; S.asks = [];
    // [PATCH P2-1 + P2-2] Reset RegimeEngine/PhaseFilter state + BM cached results on symbol switch
    if (typeof RegimeEngine !== 'undefined' && RegimeEngine.reset) RegimeEngine.reset();
    if (typeof PhaseFilter !== 'undefined' && PhaseFilter.reset) PhaseFilter.reset();
    if (typeof resetForecast === 'function') resetForecast(); // [S2B1-T1] Clear _qebLastRegime
    if (typeof BM !== 'undefined') {
      BM.regimeEngine = { regime: 'RANGE', confidence: 0, trendBias: 'neutral', volatilityState: 'normal', trapRisk: 0, notes: ['switching symbol'] };
      BM.phaseFilter = { allow: false, phase: 'RANGE', reason: 'switching symbol', riskMode: 'reduced', sizeMultiplier: 0.5, allowedSetups: [], blockedSetups: [] };
      // [S2B1-T1] Reset all brain-derived BM fields to defaults — prevent ghost signals from previous symbol
      BM.confluenceScore = 50;
      BM.probScore = 0;
      BM.probBreakdown = { regime: 0, liquidity: 0, signals: 0, flow: 0 };
      BM.entryScore = 0;
      BM.entryReady = false;
      BM.gates = {};
      BM.sweep = { type: 'none', reclaim: false, displacement: false };
      BM.flow = { cvd: 'neut', delta: 0, ofi: 'neut' };
      BM.mtf = { '15m': 'neut', '1h': 'neut', '4h': 'neut' };
      BM.atmosphere = { category: 'neutral', allowEntry: true, cautionLevel: 'medium', confidence: 0, reasons: ['switching symbol'], sizeMultiplier: 1.0 };
      BM.qexit = { risk: 0, signals: { divergence: { type: null, conf: 0 }, climax: { dir: null, mult: 0 }, regimeFlip: { from: null, to: null, conf: 0 }, liquidity: { nearestAboveDistPct: null, nearestBelowDistPct: null, bias: 'neutral' } }, action: 'HOLD', lastTs: 0, lastReason: '', shadowStop: null, confirm: { div: 0, climax: 0 } };
      BM.danger = 0;
      BM.dangerBreakdown = { volatility: 0, spread: 0, liquidations: 0, volume: 0, funding: 0 };
      BM.conviction = 0;
      BM.convictionMult = 1.0;
      BM.structure = { regime: 'unknown', adx: 0, atrPct: 0, squeeze: false, volMode: '—', structureLabel: '—', mtfAlign: { '15m': 'neut', '1h': 'neut', '4h': 'neut' }, score: 0, lastUpdate: 0 };
    }
    // [S2B1-T1] Reset BRAIN to scanning defaults on symbol switch
    if (typeof BRAIN !== 'undefined') {
      BRAIN.state = 'scanning';
      BRAIN.regime = 'unknown';
      BRAIN.regimeConfidence = 0;
      BRAIN.score = 0;
      BRAIN.thoughts = [];
      BRAIN.neurons = {};
      BRAIN.ofi = { buy: 0, sell: 0, blendBuy: 50, tape: [] };
    }
    // [S2B1-T1] Reset CORE_STATE score
    if (typeof CORE_STATE !== 'undefined') {
      CORE_STATE.score = 50;
      CORE_STATE.lastUpdate = Date.now();
    }
    // ── [v108 FIX] Release FetchLock BEFORE fetchKlines —
    FetchLock.release('klines');
    // ── Fetch fresh data ──
    fetchKlines(S.chartTf);
    fetchATR(); fetchOI(); fetchLS(); fetch24h(); fetchAllRSI();
    // ── Open new WS feeds ──
    connectBNB(); connectBYB();
  } catch (_setSymErr) {
    console.error('[setSymbol] error:', _setSymErr.message || _setSymErr);
  }
}

// ===== SOUND =====
function toggleSnd() {
  S.soundOn = !S.soundOn;
  // FIX 17: force audio context resume on user interaction (iOS requirement)
  _initAudio();
  const e = el('snd'); if (e) e.innerHTML = S.soundOn ? _ZI.bell : _ZI.bellX;
  // Persist sound state to UI context
  if (typeof _ctxSave === 'function') _ctxSave();
}

// ===== MODAL =====
function openM(id) { const e = el(id); if (e) e.style.display = 'flex'; }
function closeM(id) { const e = el(id); if (e) { e.style.display = 'none'; const m = e.querySelector('.modal'); if (m) { m.style.transform = ''; m.style.left = ''; m.style.top = ''; m.style.position = ''; } } }

// ===== MODAL DRAG BEHAVIOR =====
function _initModalDrag() {
  document.querySelectorAll('.mover').forEach(function (ov) {
    const modal = ov.querySelector('.modal');
    const hdr = ov.querySelector('.mhdr');
    if (!modal || !hdr) return;
    hdr.style.cursor = 'grab';
    let ox = 0, oy = 0, mx = 0, my = 0, dragging = false;
    function onDown(e) {
      if (e.target.closest('.mclose')) return;
      dragging = true;
      const r = modal.getBoundingClientRect();
      ox = r.left; oy = r.top; mx = e.clientX; my = e.clientY;
      modal.style.position = 'fixed';
      modal.style.left = ox + 'px'; modal.style.top = oy + 'px';
      modal.style.margin = '0';
      hdr.style.cursor = 'grabbing';
      e.preventDefault();
    }
    function onMove(e) {
      if (!dragging) return;
      let nx = ox + (e.clientX - mx), ny = oy + (e.clientY - my);
      const mw = modal.offsetWidth, mh = modal.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;
      nx = Math.max(0, Math.min(nx, vw - mw));
      ny = Math.max(0, Math.min(ny, vh - mh));
      modal.style.left = nx + 'px'; modal.style.top = ny + 'px';
      modal.style.transform = 'none';
    }
    function onUp() { if (dragging) { dragging = false; hdr.style.cursor = 'grab'; } }
    hdr.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _initModalDrag);
else _initModalDrag();
function swtab(modalId, paneId, btn) {
  const modal = el(modalId); if (!modal) return;
  // Hide all panes in this modal
  modal.querySelectorAll('.mbody').forEach(p => p.classList.remove('act'));
  modal.querySelectorAll('.mtab').forEach(b => b.classList.remove('act'));
  const pane = el(paneId); if (pane) pane.classList.add('act');
  if (btn) btn.classList.add('act');
}

// ===== UPDATE MAIN MARKET METRICS PANEL =====
function updateMainMetrics() {
  if (document.hidden) return; // [PERF] skip DOM writes when tab hidden
  const fr = el('frv'), frs_el = el('frs'), oi = el('oiv'), ois_el = el('ois'), atr = el('atrv'), ls = el('lsv'), lss_el = el('lss');
  // Funding Rate
  if (fr) fr.textContent = S.fr !== null && S.fr !== undefined ? (S.fr * 100).toFixed(4) + '%' : '—';
  if (fr) fr.style.color = S.fr > 0 ? 'var(--red)' : S.fr < 0 ? 'var(--grn)' : 'var(--dim)';
  if (frs_el) {
    if (S.frCd) { const d = new Date(S.frCd); frs_el.textContent = 'next: ' + fmtTime(d.getTime()); }
    else frs_el.textContent = 'next: —';
  }
  // Open Interest
  if (oi) oi.textContent = S.oi ? '$' + fmt(S.oi) : '—';
  if (ois_el) {
    if (S.oiPrev && S.oi) { const ch = ((S.oi - S.oiPrev) / S.oiPrev * 100).toFixed(2); ois_el.textContent = (ch > 0 ? '▲' : ch < 0 ? '▼' : '') + ch + '%'; ois_el.style.color = ch > 0 ? 'var(--grn)' : 'var(--red)'; }
    else ois_el.textContent = '—';
  }
  // ATR
  if (atr) atr.textContent = S.atr ? '$' + fP(S.atr) : '—';
  // L/S Ratio
  if (ls) ls.textContent = S.ls ? S.ls.l.toFixed(1) + '% / ' + S.ls.s.toFixed(1) + '%' : '—';
  if (lss_el) {
    if (S.ls) { const bull = S.ls.l > 55; const bear = S.ls.s > 55; lss_el.textContent = bull ? '▲ LONGS' : bear ? '▼ SHORTS' : 'BALANCED'; lss_el.style.color = bull ? 'var(--grn)' : bear ? 'var(--red)' : 'var(--dim)'; }
    else lss_el.textContent = '—';
  }
  trackOIDelta();
}

// ===== CHART SETTINGS TABS =====
function showTab(tab, btn) {
  document.querySelectorAll('.ctab-pane').forEach(p => p.classList.remove('act'));
  document.querySelectorAll('.ctab-btn').forEach(b => b.classList.remove('act'));
  const pane = el('ct-' + tab); if (pane) pane.classList.add('act');
  if (btn) btn.classList.add('act');
}
function applyChartColors() {
  const uc = el('ccBull')?.value || '#00d97a'; const dc = el('ccBear')?.value || '#ff3355';
  const uw = el('ccBullW')?.value || '#00d97a77'; const dw = el('ccBearW')?.value || '#ff335577';
  if (cSeries) cSeries.applyOptions({ upColor: uc, downColor: dc, borderUpColor: uc, borderDownColor: dc, wickUpColor: uw, wickDownColor: dw });
  toast('Colors applied');
  if (typeof _usScheduleSave === 'function') _usScheduleSave();
}
function setCandleStyle(style, btn) {
  document.querySelectorAll('#ct-candles .qb').forEach(b => b.classList.remove('act'));
  if (btn) btn.classList.add('act');
  toast('Style: ' + style);
}
function setTZ(tz, btn) {
  S.tz = tz;
  document.querySelectorAll('#cst .qb').forEach(b => b.classList.remove('act'));
  if (btn) btn.classList.add('act');
  const n = { 'Europe/Bucharest': 'RO', 'UTC': 'UTC', 'America/New_York': 'NY', 'Asia/Tokyo': 'TK', 'Europe/London': 'LN' };
  const lbl = el('chartTZLbl'); if (lbl) lbl.textContent = n[tz] || tz;
  // FIX: Actualizam TOATE chart-urile cu noul timezone si ambele formatoare
  const months = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const fmtLoc = {
    timeFormatter: ts => new Date(ts * 1000).toLocaleTimeString('ro-RO', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }),
    dateFormatter: ts => { const d = new Date(ts * 1000); const day = d.toLocaleDateString('en-US', { timeZone: tz, day: 'numeric' }); const month = d.toLocaleDateString('en-US', { timeZone: tz, month: 'numeric' }); const year = d.toLocaleDateString('en-US', { timeZone: tz, year: '2-digit' }); return day + ' ' + months[parseInt(month) - 1] + '. \'' + year; }
  };

  toast('Timezone: ' + tz);
  _usScheduleSave();  // [US] persist timezone change
}
function applyHeatmapSettings() {
  const hs = S.heatmapSettings;
  const gv = id => +el(id)?.value || 0;
  hs.lookback = gv('hmLookback') || 400; hs.pivotWidth = gv('hmPivotW') || 1; hs.atrLen = gv('hmAtrLen') || 121;
  hs.atrBandPct = gv('hmAtrBand') || 0.05; hs.extendUnhit = gv('hmExtend') || 30; hs.heatContrast = gv('hmContrast') || 0.3;
  hs.minWeight = 0; hs.keepTouched = el('hmKeepTouched')?.checked !== false;
  hs.longCol = el('hmLongCol')?.value || '#01c4fe'; hs.shortCol = el('hmShortCol')?.value || '#ffe400';
  if (S.overlays.liq) renderHeatmapOverlay();
  closeM('mcharts'); toast('Heatmap updated');
  _usScheduleSave();  // [US] persist heatmap settings
}

// ===== ALERTS =====
// toggleAlerts moved to new version above
function sendAlert(title, body, tag = 'zt') {
  if (!S.alerts.enabled) return;
  // Try SW notification first (works in background)
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'NOTIFY', title, body, tag });
  } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const n = new Notification(title, { body, tag, icon: '', badge: '', vibrate: [200, 100, 200], requireInteraction: false, silent: false });
      setTimeout(() => n.close(), 8000);
    } catch (_) { }
  }
  toast(title + ': ' + body);
  ncAdd('info', 'alert', title + (body ? ': ' + body : ''));  // [NC]
}

// ===== SERVICE WORKER FOR BACKGROUND NOTIFICATIONS =====
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // SW requires secure context (HTTPS or localhost) and cannot use Blob URLs
  const proto = location.protocol;
  const host = location.hostname;
  const isSecure = (proto === 'https:') || (host === 'localhost') || (host === '127.0.0.1');
  const isFileOrContent = (proto === 'file:') || (proto === 'content:');
  if (!isSecure || isFileOrContent) {
    console.log('[ZeuS] SW disabled (no https / file context). sendAlert() will use fallback.');
    return;
  }
  // Requires sw.js served from same origin (not Blob URL)
  try {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      console.log('[ZeuS] SW registered via sw.js');
      Intervals.set('swKeepalive', () => {
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'KEEPALIVE' });
        }
      }, 20000);
    }).catch(err => console.warn('[ZeuS] SW register failed (sw.js missing?):', err));
  } catch (err) { console.warn('[ZeuS] SW register error:', err); }
}

function checkLiqAlert(usd, qty, side, sym) {
  if (!S.alerts.liqAlerts) return;
  if (qty < S.alerts.liqMinBtc) return;
  if (!checkLiqAlert._last || Date.now() - checkLiqAlert._last > 5000) {
    checkLiqAlert._last = Date.now();
    sendAlert(`${sym} LIQUIDATION`, `$${fmt(usd)} ${side}`, 'liq');
  }
}
function checkRSIAlerts(rsi, tf) {
  if (!S.alerts.rsiAlerts) return;
  const key = 'rsi_' + tf;
  if (!checkRSIAlerts._last) checkRSIAlerts._last = {};
  if (checkRSIAlerts._last[key] && Date.now() - checkRSIAlerts._last[key] < 300000) return;
  if (rsi > 70) { checkRSIAlerts._last[key] = Date.now(); sendAlert('RSI OVERBOUGHT', `${tf} RSI: ${rsi.toFixed(1)}`, 'rsi'); }
  if (rsi < 30) { checkRSIAlerts._last[key] = Date.now(); sendAlert('RSI OVERSOLD', `${tf} RSI: ${rsi.toFixed(1)}`, 'rsi'); }
}
function testNotification() { sendAlert('ZeuS Terminal', 'Test alert working!', 'test'); }

// ===== SAVE ALERTS SETTINGS =====
function saveAlerts() {
  S.alerts.liqAlerts = el('aLiqEn')?.checked !== false;
  S.alerts.rsiAlerts = el('aDivEn')?.checked !== false;
  const liqMin = el('aLiqMin'); if (liqMin) S.alerts.liqMinBtc = +liqMin.value || 0;
  toast('Alert settings saved');
  _usScheduleSave();  // [US] persist alert changes
}

// ===== S/R SETTINGS APPLY =====
function applySR() {
  const en = el('srEn')?.checked !== false;
  S.overlays.sr = en;
  clearSR();
  if (en) renderSROverlay();
  const btn = el('bsr'); if (btn) btn.classList.toggle('act', en);
  toast('S/R settings applied');
}

// ===== ZEUS SUPREMUS APPLY =====
function applyZS() {
  S.zsSettings = S.zsSettings || {};
  // Checkboxes
  const cbIds = ['zshh', 'zshl', 'zsll', 'zslh', 'zsbb', 'zsfi', 'zspi', 'zsvi', 'zsse', 'zsds', 'zspu', 'zspd', 'zspivot', 'zsvwap', 'zsShowZones', 'zsExtendZones'];
  cbIds.forEach(id => { const e = el(id); if (e) S.zsSettings[id] = e.checked; });
  // Color inputs
  const colIds = ['zshhCol', 'zshlCol', 'zslhCol', 'zsllCol', 'zsUpperCol', 'zsLowerCol', 'zsVwapDc', 'zsVwapWc', 'zsVwapMc'];
  colIds.forEach(id => { const e = el(id); if (e) S.zsSettings[id] = e.value; });
  // Number inputs
  const numIds = ['zsZoneWidth', 'zsPivotLen', 'zsPivotCount'];
  numIds.forEach(id => { const e = el(id); if (e) S.zsSettings[id] = +e.value; });
  // VWAP checkboxes
  ['zsVwapD', 'zsVwapW', 'zsVwapM'].forEach(id => { const e = el(id); if (e) S.zsSettings[id] = e.checked; });
  toast('Supremus settings saved', 3000, _ZI.crown);
  if (S.overlays.zs) { clearZS(); renderZS(); }
}
// [MOVED TO TOP] zsSeries
function clearZS() { zsSeries.forEach(s => { try { mainChart.removeSeries(s); } catch (_) { } }); zsSeries = []; }
function renderZS() {
  if (!S.klines || S.klines.length < 20) return;
  const cfg = S.zsSettings || {};
  const klines = S.klines;
  const n = klines.length;
  const pivW = Math.max(2, Math.round((cfg.zsPivotLen) || 8));
  const showHH = cfg.zshh !== false, showHL = cfg.zshl !== false;
  const showLH = cfg.zslh !== false, showLL = cfg.zsll !== false;
  const hhCol = cfg.zshhCol || '#00d97a', hlCol = cfg.zshlCol || '#44aaff';
  const lhCol = cfg.zslhCol || '#ff8800', llCol = cfg.zsllCol || '#ff3355';
  // Detect pivots
  const pivHigh = [], pivLow = [];
  for (let i = pivW; i < n - pivW; i++) {
    let isH = true, isL = true;
    for (let j = i - pivW; j <= i + pivW; j++) {
      if (j === i) continue;
      if (klines[j].high >= klines[i].high) isH = false;
      if (klines[j].low <= klines[i].low) isL = false;
    }
    if (isH) pivHigh.push(i);
    if (isL) pivLow.push(i);
  }
  // Market structure: classify HH/LH and HL/LL
  const lastBarTime = klines[n - 1].time;
  function addHLine(price, col, title) {
    const s = mainChart.addLineSeries({ color: col, lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title, lineStyle: 1 });
    // Draw horizontal line from pivot bar to current bar
    s.setData([{ time: klines[Math.max(0, n - 100)].time, value: price }, { time: lastBarTime, value: price }]);
    zsSeries.push(s);
  }
  // Draw last few pivot highs (LH vs HH)
  const maxPivots = Math.min(pivHigh.length, +(cfg.zsPivotCount) || 3);
  for (let pi = pivHigh.length - maxPivots; pi < pivHigh.length; pi++) {
    if (pi < 0 || pi >= pivHigh.length) continue;
    const idx = pivHigh[pi];
    const price = klines[idx].high;
    const prev = pivHigh[pi - 1];
    let isHH = prev != null && price > klines[prev].high;
    if (isHH && showHH) addHLine(price, hhCol, 'HH');
    else if (!isHH && showLH) addHLine(price, lhCol, 'LH');
  }
  // Draw last few pivot lows (HL vs LL)
  for (let pi = pivLow.length - maxPivots; pi < pivLow.length; pi++) {
    if (pi < 0 || pi >= pivLow.length) continue;
    const idx = pivLow[pi];
    const price = klines[idx].low;
    const prev = pivLow[pi - 1];
    let isHL = prev != null && price > klines[prev].low;
    if (isHL && showHL) addHLine(price, hlCol, 'HL');
    else if (!isHL && showLL) addHLine(price, llCol, 'LL');
  }
  // FIX 15: all settings from S.zsSettings, no hardcoded constants
  const extendZones = cfg.zsExtendZones === true;
  const maxExtend = extendZones ? n : 80; // extend to latest bar if toggled
  // Nova zones (supply/demand)
  if (cfg.zsShowZones !== false) {
    const zW = +(cfg.zsZoneWidth) || 6;
    const upCol = (cfg.zsUpperCol || '#00b8d4') + '44';
    const dnCol = (cfg.zsLowerCol || '#aa44ff') + '44';
    const lastPH = pivHigh[pivHigh.length - 1];
    const lastPL = pivLow[pivLow.length - 1];
    if (lastPH != null) {
      const ph = klines[lastPH].high;
      const zoneTop = ph + zW * 0.1 * (S.atr || ph * 0.001);
      const zoneBtm = ph - zW * 0.1 * (S.atr || ph * 0.001);
      const sTop = mainChart.addLineSeries({ color: upCol, lineWidth: Math.max(1, zW), priceLineVisible: false, lastValueVisible: false });
      const mid = (zoneTop + zoneBtm) / 2;
      sTop.setData([{ time: klines[Math.max(0, n - maxExtend)].time, value: mid }, { time: lastBarTime, value: mid }]);
      zsSeries.push(sTop);
    }
    if (lastPL != null) {
      const pl = klines[lastPL].low;
      const mid = pl + zW * 0.05 * (S.atr || pl * 0.001);
      const sDn = mainChart.addLineSeries({ color: dnCol, lineWidth: Math.max(1, zW), priceLineVisible: false, lastValueVisible: false });
      sDn.setData([{ time: klines[Math.max(0, n - maxExtend)].time, value: mid }, { time: lastBarTime, value: mid }]);
      zsSeries.push(sDn);
    }
  }
}

// ===== CLOUD CLEAR =====
function cloudClear() {
  const ei = el('cloudEmail');
  if (ei) ei.value = '';
  // [FIX v85 BUG1] S.cloudEmail eliminat — nu mai stocăm emailul în state
  toast('Email cleared');
}

// ===== INJECT FAKE WHALE (for testing) =====
function injectFakeWhale() {
  const sym = S.symbol || 'BTCUSDT';
  const side = Math.random() > 0.5;
  const usd = Math.floor(Math.random() * 5000000) + 500000;
  const qty = usd / (S.price || 67000);
  const ev = { sym, isLong: side, usd, qty, price: S.price || 67000, ts: Date.now() };
  S.events.unshift(ev);
  if (S.events.length > 200) S.events.pop();
  renderFeed();
  checkLiqAlert(usd, qty, side ? 'LONG' : 'SHORT', sym);
  toast(`Fake whale: $${fmt(usd)} ${side ? 'LONG' : 'SHORT'} ${sym}`);
}

// ===== LIQ CHART FILTER FUNCTIONS =====
function setLiqSym(sym, btn) {
  S.liqFilter = S.liqFilter || { sym: 'BTC', minUsd: 0, tw: 24 };
  S.liqFilter.sym = sym;
  const q = document.getElementById('lsymq');
  if (q) q.querySelectorAll('.qb').forEach(b => b.classList.remove('act'));
  if (btn) btn.classList.add('act');
  toast('Filter: ' + sym);
}
function setLiqUsd(val, btn) {
  S.liqFilter = S.liqFilter || { sym: 'BTC', minUsd: 0, tw: 24 };
  S.liqFilter.minUsd = val;
  const container = btn?.parentElement;
  if (container) container.querySelectorAll('.qb').forEach(b => b.classList.remove('act'));
  if (btn) btn.classList.add('act');
  toast('Min size: $' + fmt(val));
}
function setLiqTW(hours, btn) {
  S.liqFilter = S.liqFilter || { sym: 'BTC', minUsd: 0, tw: 24 };
  S.liqFilter.tw = hours;
  const container = btn?.parentElement;
  if (container) container.querySelectorAll('.qb').forEach(b => b.classList.remove('act'));
  if (btn) btn.classList.add('act');
  toast('Time window: ' + hours + 'h');
}

// ===== CLOUD SYNC =====
async function hashEmail(email) {
  const b = new TextEncoder().encode(email.toLowerCase().trim());
  const h = await crypto.subtle.digest('SHA-256', b);
  return Array.from(new Uint8Array(h)).map(x => x.toString(16).padStart(2, '0')).join('');
}
async function cloudSave() {
  const ei = el('cloudEmail'); if (!ei || !ei.value.trim()) { toast('Enter email first'); return; }
  const hash = await hashEmail(ei.value);
  // [FIX v85 BUG1] Nu stocăm email-ul în clar în S.cloudEmail sau localStorage
  // Save ALL settings
  const data = {
    symbol: S.symbol, chartTf: S.chartTf, tz: S.tz,
    indicators: S.indicators,
    overlays: S.overlays,
    activeInds: S.activeInds,
    heatmapSettings: S.heatmapSettings,
    alerts: S.alerts,
    zsSettings: S.zsSettings || {},
    sessions: S.sessions || { asia: false, london: false, ny: false },
    vwapOn: S.vwapOn || false,
    ts: Date.now()
  };
  localStorage.setItem('zt_cloud_' + hash, JSON.stringify(data));
  localStorage.setItem('zt_cloud_last_hash', hash);
  // [FIX v85 BUG1] Eliminat: localStorage.setItem('zt_cloud_email_hint', ...) — nu salvăm emailul în clar
  const st = el('cloudStatus'); if (st) st.textContent = 'Saved at ' + new Date().toLocaleTimeString('ro-RO', { timeZone: S.tz || 'Europe/Bucharest' });
  toast('Settings saved to cloud!', 3000, _ZI.ok);
}
async function cloudLoad() {
  const ei = el('cloudEmail'); if (!ei || !ei.value.trim()) { toast('Enter email first'); return; }
  const hash = await hashEmail(ei.value);
  const raw = localStorage.getItem('zt_cloud_' + hash);
  if (!raw) { toast('No saved settings for this email', 3000, _ZI.x); return; }
  const data = JSON.parse(raw);
  // Restore ALL settings
  if (data.symbol && data.symbol !== S.symbol) setSymbol(data.symbol);
  if (data.chartTf) setTF(data.chartTf);
  if (data.tz) setTZ(data.tz);
  if (data.indicators) Object.assign(S.indicators, data.indicators);
  if (data.overlays) Object.assign(S.overlays, data.overlays);
  if (data.activeInds) {
    S.activeInds = Object.assign({}, data.activeInds);
    // Apply visibility for all indicators
    INDICATORS.forEach(ind => applyIndVisibility(ind.id, !!S.activeInds[ind.id]));
    renderActBar();
  }
  if (data.heatmapSettings) Object.assign(S.heatmapSettings, data.heatmapSettings);
  if (data.alerts) Object.assign(S.alerts, data.alerts);
  if (data.zsSettings) S.zsSettings = data.zsSettings;
  if (data.sessions) { S.sessions = data.sessions; applySessionSettings(); }
  if (data.vwapOn && !S.vwapOn) toggleVWAP(el('vwapBtn'));
  localStorage.setItem('zt_cloud_last_hash', hash);
  // [FIX v85 BUG1] Eliminat: localStorage.setItem('zt_cloud_email_hint', ...) — nu salvăm emailul în clar
  const st = el('cloudStatus'); if (st) st.textContent = 'Loaded from ' + new Date(data.ts).toLocaleString('ro-RO', { timeZone: S.tz || 'Europe/Bucharest' });
  toast('Settings restored!', 3000, _ZI.ok);
}
function initCloudSettings() {
  // Auto-restore on startup
  const hash = localStorage.getItem('zt_cloud_last_hash');
  // [FIX v85 BUG1] Nu mai citim zt_cloud_email_hint — emailul nu se stochează în clar
  localStorage.removeItem('zt_cloud_email_hint'); // curăță orice hint vechi
  if (!hash) return;
  const raw = localStorage.getItem('zt_cloud_' + hash);
  if (!raw) return;
  try {
    const d = JSON.parse(raw);
    if (d.tz) S.tz = d.tz;
    if (d.symbol) S.symbol = d.symbol;
    if (d.chartTf) S.chartTf = d.chartTf;
    if (d.indicators) Object.assign(S.indicators, d.indicators);
    if (d.activeInds) S.activeInds = Object.assign({}, d.activeInds);
    if (d.overlays) Object.assign(S.overlays, d.overlays);
    if (d.heatmapSettings) Object.assign(S.heatmapSettings, d.heatmapSettings);
    if (d.alerts) Object.assign(S.alerts, d.alerts);
    if (d.zsSettings) S.zsSettings = d.zsSettings;
    if (d.sessions) S.sessions = d.sessions;
    if (d.vwapOn) S.vwapOn = d.vwapOn;
    // [FIX v85 BUG1] Eliminat: nu mai populăm câmpul email cu hint-ul
    const st = el('cloudStatus');
    if (st) st.textContent = 'Auto-restored from ' + fmtFull(d.ts);
    toast('Settings auto-restored', 3000, _ZI.cloud);
  } catch (e) {
    // [v106 FIX1] Cloud settings corupte — logat, aplicatia continua cu defaults
    console.warn('[initCloudSettings] Restore failed:', e.message);
    if (typeof ZLOG !== 'undefined') ZLOG.push('ERROR', '[initCloudSettings] ' + e.message);
  }
}
function applySessionSettings() {
  if (!S.sessions) return;
  ['asia', 'london', 'ny'].forEach(s => {
    const btn = el('sess' + s.charAt(0).toUpperCase() + s.slice(1));
    if (S.sessions[s] && btn) { btn.classList.add('on'); renderSessionOverlay(s, true); }
  });
}

// ===== TRADING PANELS =====
// [MOVED TO TOP] TP

// ═══════════════════════════════════════════════════════
// GLOBAL MODE SWITCH — DEMO / LIVE (mutual exclusive)
// ═══════════════════════════════════════════════════════
function switchGlobalMode(mode) {
  const currentMode = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo';
  if (currentMode === mode) {
    // Same mode — just toggle the trade panel open/close
    _toggleManualPanel();
    return;
  }
  if (mode === 'demo') {
    _showConfirmDialog(
      'Activate Demo Mode?',
      'You are about to switch the entire system to DEMO mode.\n\nAll new manual and auto trades will run in simulated mode.\nNo real Binance orders will be executed.\nLive mode will be turned off.\n\nExisting live positions will remain live and continue independently.',
      'Cancel', 'Activate Demo',
      function () { _executeGlobalModeSwitch('demo'); }
    );
  } else {
    _showConfirmDialog(
      'Activate Real Trading Mode?',
      'You are about to switch the entire system to LIVE mode.\n\nAll new manual and auto trades may use REAL funds.\nReal Binance execution requires valid API keys configured in Settings.\nDemo mode will be turned off.\n\nExisting demo positions will remain demo and continue independently.\n\nOnly continue if you understand the risks of real-money trading.',
      'Cancel', 'Activate Live',
      function () { _executeGlobalModeSwitch('live'); }
    );
  }
}

function _executeGlobalModeSwitch(mode) {
  fetch('/api/at/mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ mode: mode })
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.ok) {
        if (typeof AT !== 'undefined') AT._serverMode = mode;
        _applyGlobalModeUI(mode);
        if (mode === 'demo') {
          toast('Demo Mode Activated — Global simulated trading is now ON. Real mode is OFF.', 3000, _ZI.ok);
        } else {
          if (!window._apiConfigured) {
            toast('Live Mode Activated — Execution LOCKED until API keys are configured in Settings.', 3000, _ZI.w);
          } else {
            toast('Real Trading Mode Activated — Global live trading is now ON. Demo mode is OFF.', 3000, _ZI.ok);
          }
        }
        // Open manual trade panel
        _showManualPanel();
        // Force DSL rerender immediately for mode-filtered display
        if (typeof runDSLBrain === 'function') runDSLBrain();
        // Force poll to get fresh server state
        if (typeof _atPollOnce === 'function') setTimeout(_atPollOnce, 500);
      } else {
        toast('Mode switch failed: ' + (data.error || 'Unknown error'));
      }
    })
    .catch(function () { toast('Network error — could not switch mode', 3000, _ZI.x); });
}

function _applyGlobalModeUI(mode) {
  const btnD = el('btnDemo'), btnL = el('btnLive');
  if (mode === 'live') {
    if (btnD) btnD.classList.remove('active');
    if (btnL) btnL.classList.add('active');
  } else {
    if (btnD) btnD.classList.add('active');
    if (btnL) btnL.classList.remove('active');
  }
  // AT panel mode display
  const atModeDisp = el('atModeDisplay');
  const atModeLbl = el('atModeLabel');
  const atWarn = el('atLiveWarn');
  const execLocked = mode === 'live' && !window._apiConfigured;
  if (mode === 'live') {
    if (atModeDisp) {
      atModeDisp.innerHTML = execLocked ? _ZI.dRed + ' LIVE MODE &middot; ' + _ZI.w + ' EXEC LOCKED' : _ZI.dRed + ' LIVE MODE';
      atModeDisp.style.color = execLocked ? '#ff8800' : '#ff4444';
      atModeDisp.style.borderColor = execLocked ? '#ff880044' : '#ff444444';
    }
    if (atModeLbl) { atModeLbl.innerHTML = execLocked ? _ZI.dRed + ' LIVE ' + _ZI.w : _ZI.dRed + ' LIVE'; atModeLbl.style.color = execLocked ? '#ff8800' : '#ff4444'; }
    if (atWarn) {
      atWarn.style.display = 'block';
      atWarn.textContent = execLocked
        ? 'EXECUTION LOCKED — API keys not configured. Configure in Settings → Exchange API.'
        : 'LIVE MODE ACTIVE: Auto trades will execute with REAL funds';
      atWarn.style.color = execLocked ? '#ff8800' : '';
    }
  } else {
    if (atModeDisp) { atModeDisp.innerHTML = _ZI.pad + ' DEMO MODE'; atModeDisp.style.color = '#aa44ff'; atModeDisp.style.borderColor = '#aa44ff44'; }
    if (atModeLbl) { atModeLbl.innerHTML = _ZI.pad + ' DEMO'; atModeLbl.style.color = '#aa44ff'; }
    if (atWarn) { atWarn.style.display = 'none'; atWarn.style.color = ''; }
  }
  // Update add funds / reset demo visibility (only show in demo)
  const af = el('btnAddFunds'), rd = el('btnResetDemo');
  if (af) af.style.display = mode === 'demo' ? '' : 'none';
  if (rd) rd.style.display = mode === 'demo' ? '' : 'none';
  // Update manual order button label based on mode + executionReady
  const execBtn = el('demoExec');
  if (execBtn) {
    if (mode === 'live') {
      if (window._apiConfigured) {
        execBtn.innerHTML = _ZI.dRed + ' PLACE REAL ORDER';
        execBtn.disabled = false;
        execBtn.style.opacity = '';
      } else {
        execBtn.innerHTML = _ZI.lock + ' PLACE REAL ORDER (EXEC LOCKED)';
        // [BUG4 FIX] Don't disable — let placeDemoOrder guard show the toast message
        execBtn.disabled = false;
        execBtn.style.opacity = '0.6';
      }
    } else {
      execBtn.innerHTML = _ZI.pad + ' PLACE DEMO ORDER';
      execBtn.disabled = false;
      execBtn.style.opacity = '';
    }
  }
  // Update manual panel header to match mode
  const panelHdr = document.querySelector('#panelDemo .tp-hdr span:first-child');
  if (panelHdr) panelHdr.innerHTML = mode === 'live' ? _ZI.dRed + ' MANUAL TRADE (LIVE)' : _ZI.pad + ' MANUAL TRADE';
  // [CHART MARKERS] Rebuild trade markers for the new mode
  if (typeof renderTradeMarkers === 'function') renderTradeMarkers();
  // Update balance display in manual panel
  const balSpan = el('demoBalance');
  if (balSpan) {
    if (mode === 'live') {
      if (window._apiConfigured && typeof TP !== 'undefined' && TP.liveBalance > 0) {
        balSpan.textContent = 'BAL: $' + TP.liveBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      } else {
        balSpan.textContent = 'BAL: API not configured';
      }
    } else if (typeof updateDemoBalance === 'function') {
      updateDemoBalance();
    }
  }
}

function _toggleManualPanel() {
  TP.demoOpen = !TP.demoOpen;
  const p = el('panelDemo');
  if (p) p.style.display = TP.demoOpen ? 'block' : 'none';
  if (TP.demoOpen && S.price) { const ei = el('demoEntry'); if (ei) ei.placeholder = '$' + fP(S.price); }
}

function _showManualPanel() {
  TP.demoOpen = true;
  const p = el('panelDemo');
  if (p) p.style.display = 'block';
  if (S.price) { const ei = el('demoEntry'); if (ei) ei.placeholder = '$' + fP(S.price); }
}

// ═══════════════════════════════════════════════════════
// CONFIRM DIALOG (reusable modal)
// ═══════════════════════════════════════════════════════
function _showConfirmDialog(title, message, cancelText, confirmText, onConfirm) {
  // Remove any existing dialog
  const old = document.getElementById('zeusConfirmOverlay');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = 'zeusConfirmOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';

  const safeTitle = typeof escHtml === 'function' ? escHtml(title) : title;
  const safeMsg = (typeof escHtml === 'function' ? escHtml(message) : message).replace(/\n/g, '<br>');
  const safeCancelText = typeof escHtml === 'function' ? escHtml(cancelText) : cancelText;
  const safeConfirmText = typeof escHtml === 'function' ? escHtml(confirmText) : confirmText;

  const isLive = confirmText.toLowerCase().includes('live');
  const confirmColor = isLive ? '#ff4444' : '#00d4ff';
  const confirmBg = isLive ? '#2a0000' : '#001a33';
  const confirmBorder = isLive ? '#ff4444' : '#00aaff';

  overlay.innerHTML = '<div style="background:#0a0a1a;border:1px solid ' + confirmBorder + '66;border-radius:8px;max-width:420px;width:100%;padding:24px;font-family:var(--ff,monospace)">' +
    '<div style="font-size:14px;font-weight:700;color:' + confirmColor + ';margin-bottom:16px;letter-spacing:1px">' + safeTitle + '</div>' +
    '<div style="font-size:11px;color:#ccc;line-height:1.7;margin-bottom:24px">' + safeMsg + '</div>' +
    '<div style="display:flex;gap:12px;justify-content:flex-end">' +
    '<button id="zeusConfirmCancel" style="padding:8px 20px;background:#1a1a2e;border:1px solid #333;color:#888;border-radius:4px;cursor:pointer;font-family:var(--ff,monospace);font-size:11px;letter-spacing:1px">' + safeCancelText + '</button>' +
    '<button id="zeusConfirmOk" style="padding:8px 20px;background:' + confirmBg + ';border:1px solid ' + confirmBorder + ';color:' + confirmColor + ';border-radius:4px;cursor:pointer;font-family:var(--ff,monospace);font-size:11px;font-weight:700;letter-spacing:1px">' + safeConfirmText + '</button>' +
    '</div></div>';

  document.body.appendChild(overlay);

  document.getElementById('zeusConfirmCancel').onclick = function () { overlay.remove(); };
  overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
  document.getElementById('zeusConfirmOk').onclick = function () {
    overlay.remove();
    if (typeof onConfirm === 'function') onConfirm();
  };
}

// ═══════════════════════════════════════════════════════
// ADD FUNDS / RESET DEMO
// ═══════════════════════════════════════════════════════
function promptAddFunds() {
  const amount = prompt('Enter amount to add to demo balance (USD):', '5000');
  if (!amount) return;
  const num = parseFloat(amount);
  if (!num || num <= 0 || num > 1000000) { toast('Invalid amount', 3000, _ZI.w); return; }
  fetch('/api/at/demo/add-funds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ amount: num })
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.ok) {
        TP.demoBalance = data.balance;
        updateDemoBalance();
        toast('Added $' + num.toLocaleString() + ' to demo balance → $' + data.balance.toLocaleString());
        if (typeof _atPollOnce === 'function') setTimeout(_atPollOnce, 500);
      } else { toast((data.error || 'Failed to add funds'), 3000, _ZI.x); }
    })
    .catch(function () { toast('Network error', 3000, _ZI.x); });
}

function promptResetDemo() {
  _showConfirmDialog(
    'Reset Demo Balance?',
    'This will reset your demo balance to $10,000 and clear all trading statistics.\n\nOpen positions will NOT be closed — they will continue running.\n\nThis action cannot be undone.',
    'Cancel', 'Reset Demo',
    function () {
      fetch('/api/at/demo/reset-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin'
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.ok) {
            TP.demoBalance = data.balance;
            TP._serverStartBalance = data.startBalance;
            updateDemoBalance();
            toast('Demo balance reset to $10,000', 3000, _ZI.ok);
            if (typeof _atPollOnce === 'function') setTimeout(_atPollOnce, 500);
          } else { toast((data.error || 'Reset failed'), 3000, _ZI.x); }
        })
        .catch(function () { toast('Network error', 3000, _ZI.x); });
    }
  );
}

// Legacy compat — old code may call toggleTradePanel
function toggleTradePanel(type) { _toggleManualPanel(); }
function setDemoSide(side) { TP.demoSide = side; el('demoLongBtn')?.classList.toggle('act', side === 'LONG'); el('demoShortBtn')?.classList.toggle('act', side === 'SHORT'); const de = el('demoExec'); if (de) { const _m = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo'; if (_m === 'live' && !window._apiConfigured) { de.innerHTML = _ZI.lock + ' PLACE REAL ORDER (EXEC LOCKED)'; } else if (_m === 'live') { de.innerHTML = side === 'LONG' ? _ZI.dGrn + ' OPEN LONG (LIVE)' : _ZI.dRed + ' OPEN SHORT (LIVE)'; } else { de.innerHTML = side === 'LONG' ? _ZI.dGrn + ' OPEN LONG' : _ZI.dRed + ' OPEN SHORT'; } } updateDemoLiqPrice(); }
function setLiveSide(side) { TP.liveSide = side; el('liveLongBtn')?.classList.toggle('act', side === 'LONG'); el('liveShortBtn')?.classList.toggle('act', side === 'SHORT'); updateLiveLiqPrice(); }

// ===== ORDER TYPE TOGGLE =====
function onDemoOrdTypeChange() {
  var sel = el('demoOrdType');
  var entryInput = el('demoEntry');
  var entryLabel = el('demoEntryLabel');
  if (!sel || !entryInput) return;
  var isMarket = sel.value === 'market';
  if (isMarket) {
    entryInput.readOnly = true;
    entryInput.value = '';
    entryInput.placeholder = 'Market Price';
    entryInput.style.opacity = '0.5';
    if (entryLabel) entryLabel.textContent = 'ENTRY PRICE (MARKET)';
  } else {
    entryInput.readOnly = false;
    entryInput.value = S.price ? fP(S.price) : '';
    entryInput.placeholder = 'Limit Price';
    entryInput.style.opacity = '1';
    if (entryLabel) entryLabel.textContent = 'LIMIT PRICE';
  }
  updateDemoLiqPrice();
}

// ===== LEVERAGE CUSTOM =====
function getDemoLev() {
  const sel = el('demoLev');
  if (!sel) return 1;
  if (sel.value === 'custom') { const c = +el('demoCustomLev')?.value || 20; return Math.min(150, Math.max(1, c)); }
  return parseInt(sel.value) || 1;
}
function getLiveLev() {
  const sel = el('liveLev');
  if (!sel) return 1;
  if (sel.value === 'custom') { const c = +el('liveCustomLev')?.value || 20; return Math.min(150, Math.max(1, c)); }
  return parseInt(sel.value) || 1;
}
// Handler pentru select custom leverage
function onDemoLevChange() {
  const sel = el('demoLev'); const row = el('demoCustomLevRow');
  if (sel && row) row.style.display = sel.value === 'custom' ? 'flex' : 'none';
  updateDemoLiqPrice();
}
function onLiveLevChange() {
  const sel = el('liveLev'); const row = el('liveCustomLevRow');
  if (sel && row) row.style.display = sel.value === 'custom' ? 'flex' : 'none';
  updateLiveLiqPrice();
}

// ===== LIQUIDATION PRICE =====
// Formula: Long LIQ = Entry * (1 - 1/Lev + 0.004)  (0.4% maintenance margin)
// Formula: Short LIQ = Entry * (1 + 1/Lev - 0.004)
function calcLiqPrice(entry, lev, side) {
  const e = _safe.num(entry, 'liq_entry', 0);
  const l = _safe.num(lev, 'liq_lev', 0);
  if (!e || !l || l <= 0) return null;
  const mm = 0.004; // maintenance margin ~0.4%
  if (side === 'LONG') return e * (1 - 1 / l + mm);
  else return e * (1 + 1 / l - mm);
}
function updateDemoLiqPrice() {
  const entry = parseFloat(el('demoEntry')?.value) || S.price;
  const lev = getDemoLev();
  const liq = calcLiqPrice(entry, lev, TP.demoSide);
  const e = el('demoLiqPrice');
  if (e) e.textContent = liq ? '$' + fP(liq) : '—';
}
function updateLiveLiqPrice() {
  const entry = parseFloat(el('liveEntry')?.value) || S.price;
  const lev = getLiveLev();
  const liq = calcLiqPrice(entry, lev, TP.liveSide);
  const e = el('liveLiqPrice');
  if (e) e.textContent = liq ? '$' + fP(liq) : '—';
}

function setDemoPct(pct) { const e = el('demoSize'); if (e) e.value = (TP.demoBalance * pct / 100).toFixed(0); }
// [FIX P6] Use actual liveBalance, not hardcoded 100
function setLivePct(pct) { const e = el('liveSize'); if (e) e.value = ((TP.liveBalance || 100) * pct / 100).toFixed(0); }
function updateDemoBalance() {
  const e = el('demoBalance'); if (!e) return;
  const _gm = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo';
  if (_gm === 'live') {
    if (window._apiConfigured && typeof TP !== 'undefined' && TP.liveBalance > 0) {
      e.textContent = 'BAL: $' + TP.liveBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else {
      e.textContent = 'BAL: API not configured';
    }
  } else {
    e.textContent = 'BAL: $' + TP.demoBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
function placeDemoOrder() {
  // Block real orders in live mode without API
  const _curMode = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo';
  if (_curMode === 'live' && !window._apiConfigured) {
    toast('Cannot place real order in LIVE mode — API keys not configured. Go to Settings → Exchange API.', 3000, _ZI.lock);
    return;
  }
  // [HARDENING] Require explicit confirmation for LIVE real orders
  if (_curMode === 'live' && window._apiConfigured) {
    _showConfirmDialog(
      'Place Real Order?',
      'You are about to place a REAL order on Binance with REAL funds.\n\nThis action cannot be undone.\n\nConfirm you want to proceed.',
      'Cancel', 'Place Real Order',
      function () { _executePlaceDemoOrder(); }
    );
    return;
  }
  _executePlaceDemoOrder();
}
function _executePlaceDemoOrder() {
  var _curMode = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo';
  var orderTypeSel = el('demoOrdType');
  var orderType = (orderTypeSel && orderTypeSel.value === 'limit') ? 'LIMIT' : 'MARKET';
  var size = parseFloat(el('demoSize')?.value || 100);
  var lev = getDemoLev();
  var tp = parseFloat(el('demoTP')?.value) || null;
  var sl = parseFloat(el('demoSL')?.value) || null;
  var entry;
  if (orderType === 'MARKET') {
    entry = S.price;
  } else {
    entry = parseFloat(el('demoEntry')?.value);
    if (!entry || entry <= 0) { toast('Limit price is required', 3000, _ZI.w); return; }
  }
  if (!entry || !size) { toast('Entry price and size required', 3000, _ZI.w); return; }
  if (size <= 0) { toast('Size must be positive', 3000, _ZI.w); return; }
  if (entry <= 0) { toast('Entry price must be positive', 3000, _ZI.w); return; }
  // [FIX BUG1] Validate LIMIT price direction — must be on correct side of current price
  if (orderType === 'LIMIT') {
    if (TP.demoSide === 'LONG' && entry >= S.price) { toast('LONG LIMIT price ($' + fP(entry) + ') must be below current price ($' + fP(S.price) + ')'); return; }
    if (TP.demoSide === 'SHORT' && entry <= S.price) { toast('SHORT LIMIT price ($' + fP(entry) + ') must be above current price ($' + fP(S.price) + ')'); return; }
  }
  // Validate SL/TP direction
  var _valEntry = (orderType === 'LIMIT') ? entry : S.price;
  if (sl) {
    if (TP.demoSide === 'LONG' && sl >= _valEntry) { toast('LONG SL must be below entry ($' + fP(_valEntry) + ')'); return; }
    if (TP.demoSide === 'SHORT' && sl <= _valEntry) { toast('SHORT SL must be above entry ($' + fP(_valEntry) + ')'); return; }
  }
  if (tp) {
    if (TP.demoSide === 'LONG' && tp <= _valEntry) { toast('LONG TP must be above entry ($' + fP(_valEntry) + ')'); return; }
    if (TP.demoSide === 'SHORT' && tp >= _valEntry) { toast('SHORT TP must be below entry ($' + fP(_valEntry) + ')'); return; }
  }
  // Branch: DEMO vs LIVE
  if (_curMode === 'live') {
    _executeLiveManualOrder(orderType, size, entry, lev, tp, sl);
  } else {
    _executeDemoManualOrder(orderType, size, entry, lev, tp, sl);
  }
}

// ═══════════════════════════════════════════════════════════════
// DEMO MANUAL ORDER — local engine, no exchange
// ═══════════════════════════════════════════════════════════════
function _executeDemoManualOrder(orderType, size, entry, lev, tp, sl) {
  if (size > TP.demoBalance) { toast('Insufficient demo balance', 3000, _ZI.x); return; }
  if (orderType === 'MARKET') {
    // Instant fill at current market price
    var fillPrice = S.price;
    var liqPrice = calcLiqPrice(fillPrice, lev, TP.demoSide);
    var pos = _buildManualPosition(fillPrice, size, lev, tp, sl, liqPrice, 'demo', orderType);
    TP.demoPositions.push(pos);
    TP.demoBalance -= size;
    updateDemoBalance(); renderDemoPositions();
    onPositionOpened(pos, 'manual_demo');
    ZState.save();
    renderTradeMarkers();
    toast(pos.side + ' ' + pos.sym.replace('USDT', '') + ' $' + fmt(size) + ' @$' + fP(fillPrice) + ' ' + lev + 'x MARKET');
  } else {
    // LIMIT — add to pending, wait for price to reach limit
    var pending = {
      id: Date.now(),
      side: TP.demoSide,
      sym: S.symbol,
      limitPrice: entry,
      size: size,
      lev: lev,
      tp: tp,
      sl: sl,
      mode: 'demo',
      orderType: 'LIMIT',
      status: 'WAITING',
      createdAt: Date.now(),
    };
    TP.pendingOrders.push(pending);
    TP.demoBalance -= size; // Reserve margin
    updateDemoBalance();
    renderPendingOrders();
    ZState.save();
    toast(' LIMIT ' + pending.side + ' ' + pending.sym.replace('USDT', '') + ' @$' + fP(entry) + ' $' + fmt(size) + ' ' + lev + 'x — waiting for fill');
  }
}

// ═══════════════════════════════════════════════════════════════
// LIVE MANUAL ORDER — real Binance exchange execution
// ═══════════════════════════════════════════════════════════════
function _executeLiveManualOrder(orderType, size, entry, lev, tp, sl) {
  if (typeof manualLivePlaceOrder !== 'function') {
    toast('Live API not available', 3000, _ZI.lock); return;
  }
  // Calculate quantity from USDT size: qty = size * leverage / price
  var refPrice = (orderType === 'MARKET') ? S.price : entry;
  var qty = (size * lev) / refPrice;
  var binanceSide = (TP.demoSide === 'LONG') ? 'BUY' : 'SELL';
  // Disable button to prevent double-submit
  var execBtn = el('demoExec');
  if (execBtn) { execBtn.disabled = true; execBtn.textContent = 'Placing...'; }
  manualLivePlaceOrder({
    symbol: S.symbol,
    side: binanceSide,
    type: orderType,
    quantity: qty.toFixed(8),
    price: (orderType === 'LIMIT') ? String(entry) : undefined,
    leverage: lev,
    referencePrice: S.price,
  }).then(function (result) {
    if (execBtn) { execBtn.disabled = false; setDemoSide(TP.demoSide); }
    if (orderType === 'MARKET') {
      // MARKET fill — sync position from exchange
      toast('LIVE MARKET ' + binanceSide + ' ' + S.symbol.replace('USDT', '') + ' filled @$' + fP(result.avgPrice || S.price) + ' orderId=' + (result.orderId || ''));
      // Place SL/TP protection orders on exchange if provided
      if (sl) {
        manualLiveSetSL({ symbol: S.symbol, side: TP.demoSide, quantity: qty.toFixed(8), stopPrice: sl }).then(function (slRes) {
          toast('SL set @$' + fP(sl) + ' orderId=' + (slRes.orderId || ''));
        }).catch(function (e) { toast('SL placement failed: ' + (e.message || e)); });
      }
      if (tp) {
        manualLiveSetTP({ symbol: S.symbol, side: TP.demoSide, quantity: qty.toFixed(8), stopPrice: tp }).then(function (tpRes) {
          toast('TP set @$' + fP(tp) + ' orderId=' + (tpRes.orderId || ''));
        }).catch(function (e) { toast('TP placement failed: ' + (e.message || e)); });
      }
      // Sync from exchange to get real position data
      if (typeof liveApiSyncState === 'function') setTimeout(liveApiSyncState, 1000);
    } else {
      // LIMIT placed on exchange — track as pending
      var pendingLive = {
        id: result.orderId || Date.now(),
        exchangeOrderId: result.orderId,
        side: TP.demoSide,
        binanceSide: binanceSide,
        sym: S.symbol,
        limitPrice: entry,
        size: size,
        qty: qty,
        lev: lev,
        tp: tp,
        sl: sl,
        mode: 'live',
        orderType: 'LIMIT',
        status: 'WAITING',
        createdAt: Date.now(),
      };
      TP.manualLivePending.push(pendingLive);
      renderPendingOrders();
      ZState.save();
      toast('LIVE LIMIT ' + TP.demoSide + ' ' + S.symbol.replace('USDT', '') + ' @$' + fP(entry) + ' placed on Binance — orderId=' + (result.orderId || ''));
      // Start polling for fill
      _startLivePendingSync();
    }
  }).catch(function (err) {
    if (execBtn) { execBtn.disabled = false; setDemoSide(TP.demoSide); }
    toast('LIVE order failed: ' + (err.message || err));
  });
}

// ═══════════════════════════════════════════════════════════════
// Helper: build a manual position object
// ═══════════════════════════════════════════════════════════════
function _buildManualPosition(fillPrice, size, lev, tp, sl, liqPrice, mode, orderType) {
  return {
    id: Date.now(), side: TP.demoSide, sym: S.symbol, entry: fillPrice, size: size, lev: lev, tp: tp, sl: sl, liqPrice: liqPrice, pnl: 0,
    mode: mode,
    orderType: orderType,
    sourceMode: 'paper',
    controlMode: 'paper',
    brainModeAtOpen: (S.mode || 'assist'),
    dslParams: Object.assign({
      pivotLeftPct: parseFloat(el('dslTrailPct')?.value) || 0.8,
      pivotRightPct: parseFloat(el('dslTrailSusPct')?.value) || 1.0,
      impulseVPct: parseFloat(el('dslExtendPct')?.value) || 20,
    }, typeof calcDslTargetPrice === 'function' ? calcDslTargetPrice(TP.demoSide, fillPrice, tp) : {
      openDslPct: 1.5, dslTargetPrice: TP.demoSide === 'LONG' ? fillPrice * 1.015 : fillPrice * 0.985
    }),
    dslAdaptiveState: 'calm',
    dslHistory: [],
    openTs: Date.now(),
    filledAt: Date.now(),
  };
}
function getSymPrice(pos) {
  // BUG1 FIX: use allPrices map, never fall back to S.price (wrong symbol)
  if (allPrices[pos.sym] && allPrices[pos.sym] > 0) return allPrices[pos.sym];
  const wlEntry = wlPrices[pos.sym] || wlPrices[pos.sym?.toUpperCase()];
  // [v105 FIX Bug3] Verifica freshness — pret mai vechi de 30s e considerat stale
  // Returnam null in loc de pos.entry: scheduleAutoClose si checkDemoPositionsSLTP au deja guard if(!cur)
  if (wlEntry?.price && wlEntry.price > 0) {
    const age = wlEntry.ts ? (Date.now() - wlEntry.ts) : 0;
    if (age < 30000) return wlEntry.price; // pret fresh — ok
    console.warn('[getSymPrice] Stale price for', pos.sym, 'age:', Math.round(age / 1000) + 's');
    return null; // pret stale — nu il folosi pentru SL/TP
  }
  const k = S.klines?.[pos.sym];
  if (k && k.length) return k[k.length - 1].close;
  return null; // [v105 FIX Bug3] null in loc de pos.entry — opreste verificarile SL/TP pana se reconnecteaza WS
}

// ═══════════════════════════════════════════════════════════════
// PENDING ORDERS ENGINE — checks DEMO limits for fill by price tick
// ═══════════════════════════════════════════════════════════════
function checkPendingOrders() {
  if (!TP.pendingOrders || !TP.pendingOrders.length) return;
  var toFill = [];
  TP.pendingOrders.forEach(function (ord) {
    if (ord.status !== 'WAITING' || ord.mode !== 'demo') return;
    var cur = getSymPrice(ord) || (allPrices[ord.sym] ? allPrices[ord.sym] : null);
    if (!cur || cur <= 0) return;
    // LONG LIMIT fills when price drops to or below limit price
    // SHORT LIMIT fills when price rises to or above limit price
    var filled = false;
    if (ord.side === 'LONG' && cur <= ord.limitPrice) filled = true;
    if (ord.side === 'SHORT' && cur >= ord.limitPrice) filled = true;
    if (filled) toFill.push(ord);
  });
  toFill.forEach(function (ord) { _fillDemoPendingOrder(ord); });
}

function _fillDemoPendingOrder(ord) {
  ord.status = 'FILLED';
  ord.filledAt = Date.now();
  // Remove from pending
  var idx = TP.pendingOrders.indexOf(ord);
  if (idx >= 0) TP.pendingOrders.splice(idx, 1);
  // Create open position at limit price
  var liqPrice = calcLiqPrice(ord.limitPrice, ord.lev, ord.side);
  var pos = {
    id: ord.id,
    side: ord.side,
    sym: ord.sym,
    entry: ord.limitPrice,
    size: ord.size,
    lev: ord.lev,
    tp: ord.tp,
    sl: ord.sl,
    liqPrice: liqPrice,
    pnl: 0,
    mode: 'demo',
    orderType: 'LIMIT',
    sourceMode: 'paper',
    controlMode: 'paper',
    brainModeAtOpen: (S.mode || 'assist'),
    dslParams: Object.assign({
      pivotLeftPct: parseFloat(el('dslTrailPct')?.value) || 0.8,
      pivotRightPct: parseFloat(el('dslTrailSusPct')?.value) || 1.0,
      impulseVPct: parseFloat(el('dslExtendPct')?.value) || 20,
    }, typeof calcDslTargetPrice === 'function' ? calcDslTargetPrice(ord.side, ord.limitPrice, ord.tp) : {
      openDslPct: 1.5, dslTargetPrice: ord.side === 'LONG' ? ord.limitPrice * 1.015 : ord.limitPrice * 0.985
    }),
    dslAdaptiveState: 'calm',
    dslHistory: [],
    openTs: Date.now(),
    filledAt: Date.now(),
    createdAt: ord.createdAt,
  };
  TP.demoPositions.push(pos);
  // Balance already reserved at order creation
  updateDemoBalance();
  renderDemoPositions();
  renderPendingOrders();
  if (typeof onPositionOpened === 'function') onPositionOpened(pos, 'manual_demo_limit_fill');
  ZState.save();
  if (typeof renderTradeMarkers === 'function') renderTradeMarkers();
  toast('LIMIT FILLED: ' + ord.side + ' ' + ord.sym.replace('USDT', '') + ' @$' + fP(ord.limitPrice) + ' $' + fmt(ord.size) + ' ' + ord.lev + 'x');
  addTradeToJournal({
    id: pos.id, time: (typeof fmtNow === 'function' ? fmtNow() : new Date().toISOString()),
    side: pos.side, sym: pos.sym.replace('USDT', ''), entry: pos.entry, exit: null,
    pnl: 0, reason: 'LIMIT Fill', lev: pos.lev, autoTrade: false,
    journalEvent: 'OPEN', orderType: 'LIMIT', mode: 'demo',
    openTs: pos.openTs, createdAt: ord.createdAt, filledAt: pos.filledAt,
  });
}

function cancelPendingOrder(id) {
  var strId = String(id);
  var idx = TP.pendingOrders.findIndex(function (o) { return String(o.id) === strId; });
  if (idx >= 0) {
    var ord = TP.pendingOrders[idx];
    // Return reserved margin to demo balance
    if (ord.mode === 'demo') {
      TP.demoBalance += ord.size;
      updateDemoBalance();
    }
    TP.pendingOrders.splice(idx, 1);
    renderPendingOrders();
    ZState.save();
    toast('Pending LIMIT cancelled: ' + ord.side + ' ' + ord.sym.replace('USDT', '') + ' @$' + fP(ord.limitPrice));
    return;
  }
  // Check live pending
  var liveIdx = TP.manualLivePending.findIndex(function (o) { return String(o.id) === strId || String(o.exchangeOrderId) === strId; });
  if (liveIdx >= 0) {
    var liveOrd = TP.manualLivePending[liveIdx];
    if (typeof manualLiveCancelOrder === 'function' && liveOrd.exchangeOrderId) {
      manualLiveCancelOrder(liveOrd.sym, liveOrd.exchangeOrderId).then(function () {
        TP.manualLivePending.splice(liveIdx, 1);
        renderPendingOrders();
        ZState.save();
        toast('LIVE LIMIT cancelled on Binance: ' + liveOrd.sym.replace('USDT', '') + ' orderId=' + liveOrd.exchangeOrderId);
      }).catch(function (err) {
        toast('Cancel failed: ' + (err.message || err));
      });
    }
  }
}

function modifyPendingPrice(id) {
  var strId = String(id);
  // Demo pending
  var demoOrd = TP.pendingOrders.find(function (o) { return String(o.id) === strId; });
  if (demoOrd && demoOrd.mode === 'demo') {
    var newPrice = prompt('New limit price for ' + demoOrd.sym + ':', fP(demoOrd.limitPrice));
    if (!newPrice) return;
    var np = parseFloat(newPrice);
    if (!np || np <= 0) { toast('Invalid price', 3000, _ZI.w); return; }
    demoOrd.limitPrice = np;
    renderPendingOrders();
    ZState.save();
    toast('EDIT Limit price updated to $' + fP(np));
    return;
  }
  // Live pending
  var liveOrd = TP.manualLivePending.find(function (o) { return String(o.id) === strId || String(o.exchangeOrderId) === strId; });
  if (liveOrd && liveOrd.exchangeOrderId) {
    var _newPrice = prompt('New limit price for ' + liveOrd.sym + ' (Binance cancel+replace):', fP(liveOrd.limitPrice));
    if (!_newPrice) return;
    var _np = parseFloat(_newPrice);
    if (!_np || _np <= 0) { toast('Invalid price', 3000, _ZI.w); return; }
    if (typeof manualLiveModifyLimit !== 'function') { toast('Live API not available', 3000, _ZI.lock); return; }
    manualLiveModifyLimit(liveOrd.sym, liveOrd.exchangeOrderId, _np, liveOrd.binanceSide).then(function (res) {
      liveOrd.exchangeOrderId = res.orderId;
      liveOrd.id = res.orderId;
      liveOrd.limitPrice = _np;
      renderPendingOrders();
      ZState.save();
      toast('EDIT LIVE LIMIT modified on Binance: new orderId=' + res.orderId + ' @$' + fP(_np));
    }).catch(function (err) {
      toast('Modify failed: ' + (err.message || err));
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// RENDER PENDING ORDERS — unified for both demo and live
// ═══════════════════════════════════════════════════════════════
function renderPendingOrders() {
  var cont = el('pendingOrdersTable');
  if (!cont) return;
  var _gMode = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo';
  var allPending = [];
  // Demo pending (only show in demo mode)
  if (_gMode === 'demo') {
    (TP.pendingOrders || []).forEach(function (o) {
      if (o.status === 'WAITING') allPending.push(o);
    });
  }
  // Live pending (only show in live mode)
  if (_gMode === 'live') {
    (TP.manualLivePending || []).forEach(function (o) {
      if (o.status === 'WAITING') allPending.push(o);
    });
  }
  if (!allPending.length) {
    cont.innerHTML = '<div style="color:var(--dim);text-align:center;padding:4px;font-size:9px">No pending orders</div>';
    return;
  }
  var html = allPending.map(function (ord) {
    var symBase = escHtml((ord.sym || '').replace('USDT', ''));
    var sideColor = ord.side === 'LONG' ? '#00d4ff' : '#00bcd4';
    var modeBadge = ord.mode === 'live'
      ? '<span style="background:#ff444422;color:#ff4444;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;margin-left:4px">LIVE</span>'
      : '<span style="background:#aa44ff22;color:#aa44ff;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;margin-left:4px">DEMO</span>';
    var age = Date.now() - (ord.createdAt || Date.now());
    var ageStr = age < 60000 ? Math.floor(age / 1000) + 's' : Math.floor(age / 60000) + 'm';
    var curPrice = getSymPrice(ord) || (allPrices[ord.sym] || 0);
    var distPct = curPrice > 0 ? (((ord.limitPrice - curPrice) / curPrice) * 100).toFixed(2) : '?';
    return '<div class="pos-row pos-pending" style="border-color:' + sideColor + '">'
      + '<div style="display:flex;justify-content:space-between;align-items:center">'
      + '<span style="font-weight:700;color:' + sideColor + '">'
      + '<span style="background:#00d4ff22;color:#00d4ff;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:700;margin-right:4px"> WAITING LIMIT</span>'
      + escHtml(ord.side) + ' ' + symBase + ' ' + ord.lev + 'x' + modeBadge
      + '</span>'
      + '<div style="display:flex;gap:4px">'
      + '<button onclick="modifyPendingPrice(\'' + ord.id + '\')" style="padding:6px 10px;background:#001a33;border:1px solid #00aaff;color:#00d4ff;border-radius:3px;font-size:9px;cursor:pointer;font-weight:700;min-height:36px">EDIT MODIFY</button>'
      + '<button onclick="cancelPendingOrder(\'' + ord.id + '\')" style="padding:6px 10px;background:#2a0010;border:1px solid #ff4466;color:#ff4466;border-radius:3px;font-size:9px;cursor:pointer;font-weight:700;min-height:36px">✕ CANCEL</button>'
      + '</div>'
      + '</div>'
      + '<div style="display:flex;justify-content:space-between;font-size:12px;margin-top:3px;color:var(--dim)">'
      + '<span>Limit: $' + fP(ord.limitPrice) + ' | Size: $' + fmt(ord.size) + '</span>'
      + '<span>Now: $' + (curPrice > 0 ? fP(curPrice) : '—') + ' (' + distPct + '%)</span>'
      + '</div>'
      + '<div style="font-size:11px;color:var(--dim);margin-top:1px">'
      + (ord.sl ? 'SL: $' + fP(ord.sl) + ' ' : '') + (ord.tp ? 'TP: $' + fP(ord.tp) + ' ' : '') + '| ' + ageStr + ' ago'
      + (ord.exchangeOrderId ? ' | OID: ' + ord.exchangeOrderId : '')
      + '</div>'
      + '</div>';
  }).join('');
  cont.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════
// LIVE PENDING ORDERS SYNC — poll Binance to detect fills/cancels
// ═══════════════════════════════════════════════════════════════
var _livePendingSyncTimer = null;
function _startLivePendingSync() {
  if (_livePendingSyncTimer) return; // already running
  _livePendingSyncTimer = setInterval(_syncLivePendingOrders, 5000);
  // Run immediately too
  setTimeout(_syncLivePendingOrders, 500);
}
function _stopLivePendingSync() {
  if (_livePendingSyncTimer) { clearInterval(_livePendingSyncTimer); _livePendingSyncTimer = null; }
}

function _syncLivePendingOrders() {
  if (!TP.manualLivePending || !TP.manualLivePending.length) { _stopLivePendingSync(); return; }
  if (typeof manualLiveGetOpenOrders !== 'function') return;
  // Get all symbols we're tracking
  var symbols = {};
  TP.manualLivePending.forEach(function (o) { symbols[o.sym] = true; });
  var symList = Object.keys(symbols);
  // Query open orders for each symbol
  var _remaining = symList.length;
  var _exchangeOrderIds = new Set();
  symList.forEach(function (sym) {
    manualLiveGetOpenOrders(sym).then(function (orders) {
      (orders || []).forEach(function (o) { _exchangeOrderIds.add(String(o.orderId)); });
      _remaining--;
      if (_remaining <= 0) _reconcileLivePending(_exchangeOrderIds);
    }).catch(function () {
      _remaining--;
      if (_remaining <= 0) _reconcileLivePending(_exchangeOrderIds);
    });
  });
}

function _reconcileLivePending(exchangeOrderIds) {
  var toRemove = [];
  TP.manualLivePending.forEach(function (ord) {
    if (!exchangeOrderIds.has(String(ord.exchangeOrderId))) {
      // Order no longer on exchange — it was filled or cancelled
      toRemove.push(ord);
    }
  });
  if (!toRemove.length) return;
  toRemove.forEach(function (ord) {
    var idx = TP.manualLivePending.indexOf(ord);
    if (idx >= 0) TP.manualLivePending.splice(idx, 1);
    ord.status = 'FILLED';
    ord.filledAt = Date.now();
    toast('LIVE LIMIT FILLED: ' + ord.side + ' ' + ord.sym.replace('USDT', '') + ' @$' + fP(ord.limitPrice));
    // Place SL/TP protection orders if set at creation
    if (ord.tp && typeof manualLiveSetTP === 'function') {
      var _qty = ord.qty || ((ord.size * ord.lev) / ord.limitPrice);
      manualLiveSetTP({ symbol: ord.sym, side: ord.side, quantity: _qty.toFixed(8), stopPrice: ord.tp }).catch(function (e) {
        toast('TP placement failed after fill: ' + (e.message || e));
      });
    }
    if (ord.sl && typeof manualLiveSetSL === 'function') {
      var _qty2 = ord.qty || ((ord.size * ord.lev) / ord.limitPrice);
      manualLiveSetSL({ symbol: ord.sym, side: ord.side, quantity: _qty2.toFixed(8), stopPrice: ord.sl }).catch(function (e) {
        toast('SL placement failed after fill: ' + (e.message || e));
      });
    }
    addTradeToJournal({
      id: ord.id, time: (typeof fmtNow === 'function' ? fmtNow() : new Date().toISOString()),
      side: ord.side, sym: (ord.sym || '').replace('USDT', ''), entry: ord.limitPrice, exit: null,
      pnl: 0, reason: 'LIVE LIMIT Fill', lev: ord.lev, autoTrade: false,
      journalEvent: 'OPEN', orderType: 'LIMIT', mode: 'live', isLive: true,
      openTs: Date.now(), createdAt: ord.createdAt, filledAt: Date.now(),
    });
  });
  // Sync live positions from exchange
  if (typeof liveApiSyncState === 'function') setTimeout(liveApiSyncState, 500);
  renderPendingOrders();
  ZState.save();
  // Stop polling if no more pending
  if (!TP.manualLivePending.length) _stopLivePendingSync();
}

// Resume polling on load if there are pending live orders
function _resumeLivePendingSyncIfNeeded() {
  if (TP.manualLivePending && TP.manualLivePending.length > 0) {
    _startLivePendingSync();
  }
}

// ═══════════════════════════════════════════════════════════════
// SL/TP EDITING ON OPEN POSITION CARDS
// ═══════════════════════════════════════════════════════════════
function savePosSLTP(posId, mode) {
  var strId = String(posId);
  var slInput = el('slEdit_' + strId);
  var tpInput = el('tpEdit_' + strId);
  var newSL = slInput ? parseFloat(slInput.value) || null : null;
  var newTP = tpInput ? parseFloat(tpInput.value) || null : null;
  if (mode === 'demo') {
    var pos = TP.demoPositions.find(function (p) { return String(p.id) === strId; });
    if (!pos) { toast('Position not found', 3000, _ZI.w); return; }
    // Validate direction
    if (newSL) {
      if (pos.side === 'LONG' && newSL >= pos.entry) { toast('LONG SL must be below entry', 3000, _ZI.w); return; }
      if (pos.side === 'SHORT' && newSL <= pos.entry) { toast('SHORT SL must be above entry', 3000, _ZI.w); return; }
    }
    if (newTP) {
      if (pos.side === 'LONG' && newTP <= pos.entry) { toast('LONG TP must be above entry', 3000, _ZI.w); return; }
      if (pos.side === 'SHORT' && newTP >= pos.entry) { toast('SHORT TP must be below entry', 3000, _ZI.w); return; }
    }
    pos.sl = newSL;
    pos.tp = newTP;
    renderDemoPositions();
    ZState.save();
    toast('SL/TP updated: SL=' + (newSL ? '$' + fP(newSL) : 'none') + ' TP=' + (newTP ? '$' + fP(newTP) : 'none'));
  } else if (mode === 'live') {
    // Live — update on Binance via protection orders
    var livePos = TP.livePositions.find(function (p) { return String(p.id) === strId; });
    if (!livePos) { toast('Position not found', 3000, _ZI.w); return; }
    var _qty = livePos.qty || livePos.size;
    // Validate direction
    if (newSL) {
      if (livePos.side === 'LONG' && newSL >= livePos.entry) { toast('LONG SL must be below entry', 3000, _ZI.w); return; }
      if (livePos.side === 'SHORT' && newSL <= livePos.entry) { toast('SHORT SL must be above entry', 3000, _ZI.w); return; }
    }
    if (newTP) {
      if (livePos.side === 'LONG' && newTP <= livePos.entry) { toast('LONG TP must be above entry', 3000, _ZI.w); return; }
      if (livePos.side === 'SHORT' && newTP >= livePos.entry) { toast('SHORT TP must be below entry', 3000, _ZI.w); return; }
    }
    var promises = [];
    if (typeof manualLiveSetSL === 'function') {
      if (newSL) {
        promises.push(
          manualLiveSetSL({ symbol: livePos.sym, side: livePos.side, quantity: String(_qty), stopPrice: newSL, cancelOrderId: livePos._slOrderId || undefined })
            .then(function (res) { livePos._slOrderId = res.orderId; livePos.sl = newSL; })
        );
      } else if (livePos._slOrderId) {
        promises.push(
          manualLiveCancelOrder(livePos.sym, livePos._slOrderId)
            .then(function () { livePos._slOrderId = null; livePos.sl = null; })
            .catch(function () { })
        );
      }
    }
    if (typeof manualLiveSetTP === 'function') {
      if (newTP) {
        promises.push(
          manualLiveSetTP({ symbol: livePos.sym, side: livePos.side, quantity: String(_qty), stopPrice: newTP, cancelOrderId: livePos._tpOrderId || undefined })
            .then(function (res) { livePos._tpOrderId = res.orderId; livePos.tp = newTP; })
        );
      } else if (livePos._tpOrderId) {
        promises.push(
          manualLiveCancelOrder(livePos.sym, livePos._tpOrderId)
            .then(function () { livePos._tpOrderId = null; livePos.tp = null; })
            .catch(function () { })
        );
      }
    }
    Promise.all(promises).then(function () {
      renderLivePositions();
      toast('LIVE SL/TP updated on Binance: SL=' + (newSL ? '$' + fP(newSL) : 'none') + ' TP=' + (newTP ? '$' + fP(newTP) : 'none'));
    }).catch(function (err) {
      toast('SL/TP update failed: ' + (err.message || err));
      renderLivePositions();
    });
  }
}

// FIX MAJOR: Verifica TP/SL pentru pozitii demo - SEPARAT de render
// REGULA CRITICA:
//   - Pozitii autoTrade → gestionate EXCLUSIV de scheduleAutoClose (care citeste dsl.currentSL)
//   - Pozitii manuale (paper trading) → verificate aici cu pos.sl/pos.tp original
// Asta previne DSL sa inchida pozitii automat via tick de pret
function checkDemoPositionsSLTP() {
  if (!TP.demoPositions.length) return;
  const toClose = [];
  TP.demoPositions.forEach(pos => {
    if (pos.closed) return;
    // SKIP pozitii autoTrade - le gestioneaza scheduleAutoClose
    // scheduleAutoClose citeste dsl.currentSL corect si nu afecteaza close manual
    // [v85 B2 ANALYZED] Skip-ul este intenționat: scheduleAutoClose verifică deja tp/sl/liq/dsl.currentSL
    // Dacă am elimina return, risc de double-close (ambele funcții închid aceeași poziție simultan)
    if (pos.autoTrade) return;
    // --- Doar pozitii manuale (paper trading) ---
    const curPrice = getSymPrice(pos);
    // [PATCH P1-5] Null/stale price guard — skip this tick, next tick will retry
    if (!curPrice || !Number.isFinite(curPrice) || curPrice <= 0) return;
    let reason = null;
    if (pos.side === 'LONG') {
      if (pos.tp && curPrice >= pos.tp) reason = 'TP HIT';
      else if (pos.sl && curPrice <= pos.sl) reason = 'SL HIT';
      else if (pos.liqPrice && curPrice <= pos.liqPrice) reason = 'LIQUIDATED';
    } else {
      if (pos.tp && curPrice <= pos.tp) reason = 'TP HIT';
      else if (pos.sl && curPrice >= pos.sl) reason = 'SL HIT';
      else if (pos.liqPrice && curPrice >= pos.liqPrice) reason = 'LIQUIDATED';
    }
    if (reason) toClose.push({ id: pos.id, reason });
  });
  toClose.forEach(({ id, reason }) => closeDemoPos(id, reason));
}

// [PERF] throttle renderDemoPositions — 500ms min interval
var _lastRenderDemo = 0, _pendingRenderDemo = 0;
function renderDemoPositions() {
  var _now = Date.now();
  if (_now - _lastRenderDemo < 500) { if (!_pendingRenderDemo) _pendingRenderDemo = setTimeout(renderDemoPositions, 500 - (_now - _lastRenderDemo)); return; }
  _lastRenderDemo = _now; _pendingRenderDemo = 0;
  const table = el('demoPosTable'); if (!table) return;
  // [FIX BUG2] Skip full re-render while user is editing SL/TP — prevents focus loss
  var _ae = document.activeElement;
  if (_ae && _ae.tagName === 'INPUT' && (_ae.id && (_ae.id.startsWith('slEdit_') || _ae.id.startsWith('tpEdit_'))) && table.contains(_ae)) return;
  // FIX: Afisam DOAR pozitiile manuale (nu autoTrade) si care nu sunt closed
  // Filter: only manual (non-autoTrade), non-closed, matching current globalMode
  const _gMode = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo';
  const manualPos = TP.demoPositions.filter(p => !p.closed && !p.autoTrade && (p.mode || 'demo') === _gMode);
  if (!manualPos.length) {
    table.innerHTML = '<div style="color:var(--dim);text-align:center;padding:8px">No open positions</div>';
    const pnlEl = el('demoPnL'); if (pnlEl) { pnlEl.textContent = '$0.00'; pnlEl.className = 'tp-pnl-val neut'; }
    return;
  }
  // DOAR RENDER - fara close logic
  let totalPnL = 0;
  const html = manualPos.map(pos => {
    const curPrice = getSymPrice(pos);
    // [FIX P9] Guard null/stale price — show 0 PnL instead of giant spike
    if (!curPrice || !Number.isFinite(curPrice) || curPrice <= 0) {
      pos.pnl = 0;
      totalPnL += 0;
      const symBase = escHtml((pos.sym || 'BTC').replace('USDT', ''));
      const _posMode = (pos.mode || pos._serverMode || 'demo');
      const _modeBadge = _posMode === 'live'
        ? '<span style="background:#ff444422;color:#ff4444;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700;margin-left:6px">LIVE</span>'
        : '<span style="background:#aa44ff22;color:#aa44ff;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700;margin-left:6px">DEMO</span>';
      return `<div class="pos-row ${escHtml(pos.side) === 'LONG' ? 'pos-long' : 'pos-short'}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:700">${escHtml(pos.side)} ${symBase} ${pos.lev}x${_modeBadge}</span>
          <button data-id="${pos.id}" style="padding:10px 14px;background:#2a0010;border:2px solid #ff4466;color:#ff4466;border-radius:4px;font-size:10px;cursor:pointer;touch-action:manipulation;min-height:52px;font-weight:700;display:block;user-select:none;">✕ CLOSE</button>
        </div>
        <div style="font-size:13px;margin-top:3px;color:#ff8800">Price unavailable — waiting for data...</div>
      </div>`;
    }
    const diff = curPrice - pos.entry;
    pos.pnl = _safePnl(pos.side, diff, pos.entry, pos.size, pos.lev, true);
    totalPnL += pos.pnl;
    const pnlPct = pos.size > 0 ? (pos.pnl / _safe.num(pos.size, null, 1) * 100).toFixed(2) : '0.00';
    // [FIX v85] Calcule extra: Margin / Notional / Fees estimative / ROE
    const margin = _safe.num(pos.size, null, 0);          // size = margin în app (scăzut din demoBalance)
    const lev = _safe.num(pos.lev, null, 1);
    const notional = margin * lev;
    const feeRate = _safe.num(typeof S !== 'undefined' ? S.feeRate : null, null, 0.0004); // 0.04% taker fallback
    const estFees = notional * feeRate * 2;                // entry + exit estimat
    const roe = margin > 0 ? (pos.pnl / margin * 100).toFixed(2) : '0.00';
    const liqCol = pos.liqPrice ? (pos.side === 'LONG' ? '#ff3355' : '#00d97a') : '#555';
    const symBase = escHtml((pos.sym || 'BTC').replace('USDT', ''));  // [v105 FIX Bug6] escHtml
    const posMode = (pos.mode || pos._serverMode || 'demo');
    const modeBadge = posMode === 'live'
      ? '<span style="background:#ff444422;color:#ff4444;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700;margin-left:6px">LIVE</span>'
      : '<span style="background:#aa44ff22;color:#aa44ff;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700;margin-left:6px">DEMO</span>';
    return `<div class="pos-row ${escHtml(pos.side) === 'LONG' ? 'pos-long' : 'pos-short'}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:700">${escHtml(pos.side)} ${symBase} ${pos.lev}x${modeBadge}</span>
        <button data-id="${pos.id}" style="padding:10px 14px;background:#2a0010;border:2px solid #ff4466;color:#ff4466;border-radius:4px;font-size:10px;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:rgba(255,68,102,.3);min-height:52px;font-weight:700;display:block;user-select:none;">✕ CLOSE</button>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-top:3px">
        <span style="color:var(--dim)">Entry: $${fP(pos.entry)} | Now: $${fP(curPrice)}</span>
        <span style="color:${pos.pnl >= 0 ? 'var(--grn)' : 'var(--red)'}">${pos.pnl >= 0 ? '+' : ''}$${pos.pnl.toFixed(2)} (${pnlPct}%)</span>
      </div>
      <div style="font-size:12px;color:var(--dim);margin-top:1px">Margin: $${fmt(margin)} | Notional: $${fmt(notional)} | Fees≈$${fmt(estFees)} | ROE: ${roe}%</div>
      ${(() => { const _dslSt = typeof DSL !== 'undefined' && DSL.positions ? DSL.positions[String(pos.id)] : null; const _dslActive = _dslSt && _dslSt.active; const _slVal = _dslActive && _dslSt.currentSL > 0 ? _dslSt.currentSL : pos.sl; const _slLabel = _dslActive ? 'DSL' : 'SL'; const _slColor = _dslActive ? '#39ff14' : '#ff6644'; return _dslActive ? `<div style="font-size:12px;color:${_slColor};margin-top:1px">${_slLabel}: $${fP(_slVal)}${pos.tp ? ' | TP: $' + fP(pos.tp) : ''}</div>` : ''; })()}
      <div style="display:flex;gap:4px;margin-top:3px;align-items:center">
        <span style="font-size:10px;color:#ff6644;width:22px">SL:</span>
        <input id="slEdit_${pos.id}" type="number" step="0.1" value="${pos.sl || ''}" placeholder="—" style="flex:1;background:#0a0a14;border:1px solid #333;color:#ff6644;padding:3px 5px;border-radius:3px;font-size:11px;font-family:var(--ff);width:60px">
        <span style="font-size:10px;color:#00ff88;width:22px">TP:</span>
        <input id="tpEdit_${pos.id}" type="number" step="0.1" value="${pos.tp || ''}" placeholder="—" style="flex:1;background:#0a0a14;border:1px solid #333;color:#00ff88;padding:3px 5px;border-radius:3px;font-size:11px;font-family:var(--ff);width:60px">
        <button onclick="savePosSLTP('${pos.id}','demo')" style="padding:3px 8px;background:#001a22;border:1px solid #00aaff;color:#00d4ff;border-radius:3px;font-size:9px;cursor:pointer;font-weight:700;min-height:24px">SAVE</button>
      </div>
      ${pos.liqPrice ? `<div style="font-size:12px;color:${liqCol};margin-top:1px">LIQ: $${fP(pos.liqPrice)}</div>` : ''}
    </div>`;
  }).join('');
  table.innerHTML = html;
  // Long-press pe fiecare buton CLOSE - previne inchideri accidentale la scroll
  table.querySelectorAll('button[data-id]').forEach(function (btn) {
    const posId = btn.getAttribute('data-id');
    attachConfirmClose(btn, function () { closeDemoPos(posId); });
  });
  const pnlEl = el('demoPnL'); if (pnlEl) { pnlEl.textContent = '$' + totalPnL.toFixed(2); pnlEl.className = 'tp-pnl-val ' + (totalPnL > 0 ? 'pos' : totalPnL < 0 ? 'neg' : 'neut'); }
  const total = TP.demoWins + TP.demoLosses;
  const wr = el('demoWR'); if (wr) wr.textContent = total ? Math.round(TP.demoWins / total * 100) + '%' : '0%';
  const tr = el('demoTrades'); if (tr) tr.textContent = total;
}
// calcPosPnL — convenience wrapper over _safePnl for position objects
function calcPosPnL(pos, cur) {
  return _safePnl(pos.side, cur, pos.entry, pos.size, pos.lev, false);
}
// ─── Live balance UI update ───
function updateLiveBalance() {
  const balEl = el('liveBalanceAmt') || el('demoBalanceAmt');
  if (balEl && TP.liveBalance) balEl.textContent = '$' + Number(TP.liveBalance).toFixed(2);
  const pnlEl = el('liveUnrealizedPnl');
  if (pnlEl && typeof TP.liveUnrealizedPnL === 'number') pnlEl.textContent = (TP.liveUnrealizedPnL >= 0 ? '+' : '') + '$' + TP.liveUnrealizedPnL.toFixed(2);
}
// [FIX P4] Separate live positions renderer — never touches demoBalance — now renders actual HTML
function renderLivePositions() {
  const cont = el('livePositions');
  if (!cont) return;
  // [FIX BUG2] Skip full re-render while user is editing SL/TP — prevents focus loss
  var _ae = document.activeElement;
  if (_ae && _ae.tagName === 'INPUT' && (_ae.id && (_ae.id.startsWith('slEdit_') || _ae.id.startsWith('tpEdit_'))) && cont.contains(_ae)) return;
  const live = TP.livePositions.filter(p => !p.closed && p.status !== 'closing');
  if (!live.length) { cont.innerHTML = '<div style="color:var(--dim);text-align:center;padding:8px;font-size:9px">No live positions</div>'; return; }
  let totalPnl = 0;
  const html = live.map(function (pos) {
    const cur = getSymPrice(pos);
    if (!cur || !Number.isFinite(cur) || cur <= 0) {
      pos.pnl = 0;
      return `<div class="pos-row ${pos.side === 'LONG' ? 'pos-long' : 'pos-short'}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:700">${_ZI.dRed} ${escHtml(pos.side)} ${escHtml((pos.sym || '').replace('USDT', ''))} ${pos.lev}x</span>
          <button data-live-id="${pos.id}" style="padding:10px 14px;background:#2a0010;border:2px solid #ff4466;color:#ff4466;border-radius:4px;font-size:10px;cursor:pointer;touch-action:manipulation;min-height:52px;font-weight:700;user-select:none;">✕ CLOSE</button>
        </div>
        <div style="font-size:13px;margin-top:3px;color:#ff8800">Price unavailable</div>
      </div>`;
    }
    const pnl = calcPosPnL(pos, cur);
    pos.pnl = pnl;
    totalPnl += pnl;
    const pnlPct = pos.size > 0 ? (pnl / _safe.num(pos.size, null, 1) * 100).toFixed(2) : '0.00';
    const symBase = escHtml((pos.sym || '').replace('USDT', ''));
    return `<div class="pos-row ${pos.side === 'LONG' ? 'pos-long' : 'pos-short'}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:700">${_ZI.dRed} ${escHtml(pos.side)} ${symBase} ${pos.lev}x</span>
        <button data-live-id="${pos.id}" style="padding:10px 14px;background:#2a0010;border:2px solid #ff4466;color:#ff4466;border-radius:4px;font-size:10px;cursor:pointer;touch-action:manipulation;min-height:52px;font-weight:700;user-select:none;">✕ CLOSE</button>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-top:3px">
        <span style="color:var(--dim)">Entry: $${fP(pos.entry)} | Now: $${fP(cur)}</span>
        <span style="color:${pnl >= 0 ? 'var(--grn)' : 'var(--red)'}">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct}%)</span>
      </div>
      ${pos.liqPrice ? `<div style="font-size:12px;color:#ff3355;margin-top:1px">LIQ: $${fP(pos.liqPrice)}</div>` : ''}
      <div style="display:flex;gap:4px;margin-top:3px;align-items:center">
        <span style="font-size:10px;color:#ff6644;width:22px">SL:</span>
        <input id="slEdit_${pos.id}" type="number" step="0.1" value="${pos.sl || ''}" placeholder="—" style="flex:1;background:#0a0a14;border:1px solid #333;color:#ff6644;padding:3px 5px;border-radius:3px;font-size:11px;font-family:var(--ff);width:60px">
        <span style="font-size:10px;color:#00ff88;width:22px">TP:</span>
        <input id="tpEdit_${pos.id}" type="number" step="0.1" value="${pos.tp || ''}" placeholder="—" style="flex:1;background:#0a0a14;border:1px solid #333;color:#00ff88;padding:3px 5px;border-radius:3px;font-size:11px;font-family:var(--ff);width:60px">
        <button onclick="savePosSLTP('${pos.id}','live')" style="padding:3px 8px;background:#001a22;border:1px solid #00aaff;color:#00d4ff;border-radius:3px;font-size:9px;cursor:pointer;font-weight:700;min-height:24px">SAVE</button>
      </div>
    </div>`;
  }).join('');
  cont.innerHTML = html;
  // Attach long-press close buttons
  cont.querySelectorAll('button[data-live-id]').forEach(function (btn) {
    var posId = btn.getAttribute('data-live-id');
    attachConfirmClose(btn, function () { closeLivePos(posId); });
  });
}
// BUG2 FIX: close only from livePositions — now sends counter-order through backend
function closeLivePos(id, reason) {
  const strId = String(id); // [FIX BUG7] String comparison — parseInt loses precision on large Binance orderIds
  const idx = TP.livePositions.findIndex(p => String(p.id) === strId);
  if (idx < 0) return;
  const pos = TP.livePositions[idx];
  // [PATCH2 B3] Prevent double-close: if already closing/closed, skip
  if (pos.status === 'closing' || pos.closed) return;
  // [BUG1 FIX] If server-managed position, tell server to close it too
  if (window._serverATEnabled && pos._serverSeq) {
    if (typeof window._zeusRequestServerClose === 'function') window._zeusRequestServerClose(pos._serverSeq, pos.id);
    fetch('/api/at/close', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seq: pos._serverSeq })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.ok && typeof window._zeusConfirmServerClose === 'function') window._zeusConfirmServerClose(pos._serverSeq);
    }).catch(function () { /* pending close guard handles timeout */ });
  }
  // [FIX SYNC-M1] Proactively clear posCheck interval on close (don't wait for next tick)
  if (typeof Intervals !== 'undefined' && Intervals.clear) Intervals.clear('posCheck_' + pos.id);
  const cur = getSymPrice(pos);
  const pnl = calcPosPnL(pos, cur);
  pos.pnl = pnl;
  // [PATCH2 B3] Mark as 'closing' — do NOT remove from array yet
  pos.status = 'closing';
  atLog('info', '[LIVE] CLOSING: ' + pos.side + ' ' + pos.sym + ' PnL: ' + (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2) + ' | ' + (reason || 'manual'));
  renderLivePositions();
  // Send close order to exchange — wait for confirmation before removing
  if (typeof liveApiClosePosition === 'function') {
    liveApiClosePosition(pos).then(function (res) {
      // [PATCH2 B3] Exchange confirmed close — NOW remove from array
      pos.closed = true;
      pos.status = 'closed';
      // [FIX R5] Use exchange fill price for PnL instead of browser price
      const fillPrice = (res && parseFloat(res.avgPrice)) || cur;
      const fillPnl = calcPosPnL(pos, fillPrice);
      pos.pnl = fillPnl;
      const finalIdx = TP.livePositions.findIndex(p => p.id === pos.id);
      if (finalIdx >= 0) TP.livePositions.splice(finalIdx, 1);
      // [FIX C5] Journal entry for live closes
      if (typeof addTradeToJournal === 'function') {
        addTradeToJournal({ id: pos.id, time: fmtNow(), side: pos.side, sym: (pos.sym || '').replace('USDT', ''), entry: pos.entry, exit: fillPrice, pnl: fillPnl, reason: reason || 'Manual', lev: pos.lev, autoTrade: !!pos.autoTrade, journalEvent: 'CLOSE', regime: (typeof BM !== 'undefined' ? BM.regime || '—' : '—'), isLive: true, openTs: pos.openTs || pos.id, closedAt: Date.now(), mode: 'live' });
      }
      // [FIX M1] Clean DSL state for closed live position
      if (typeof DSL !== 'undefined') {
        delete DSL.positions[String(pos.id)];
        if (DSL._attachedIds) DSL._attachedIds.delete(String(pos.id));
      }
      atLog('info', '[LIVE] CLOSE CONFIRMED: orderId=' + (res.orderId || '?') + ' ' + pos.sym + ' fillPrice=' + fillPrice);
      renderLivePositions();
      // [FIX A5] Notify ARES of live close — same hook as demo path
      try { if (typeof ARES !== 'undefined' && typeof ARES.onTradeClosed === 'function') ARES.onTradeClosed(fillPnl); } catch (_) { }
      // [FIX BUG1] Report AT live PnL to server-side risk guard
      if (pos.autoTrade) {
        try { fetch('/api/risk/pnl', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pnl: fillPnl, owner: 'AT' }) }).catch(function () { }); } catch (_) { }
      }
      // Sync balance after close
      if (typeof liveApiSyncState === 'function') liveApiSyncState();
    }).catch(function (err) {
      // [PATCH2 B3] Exchange rejected close — revert to open, keep position in array
      pos.status = 'open';
      pos.closed = false;
      atLog('warn', 'LIVE CLOSE FAILED on exchange: ' + (err.message || err) + ' — position reverted to OPEN');
      toast('Close failed for ' + pos.sym + ' — position still open on exchange');
      renderLivePositions();
      // [FIX SYNC-N1] Single retry after 2s if exchange temporarily rejected (429/503/timeout)
      if (!pos._closeRetried) {
        pos._closeRetried = true;
        setTimeout(function () {
          if (!pos.closed && pos.status === 'open') {
            atLog('info', '[RETRY] RETRYING close for ' + pos.sym + '...');
            closeLivePos(pos.id, reason || 'Retry');
          }
        }, 2000);
      }
    });
  } else {
    // No live API available — remove locally anyway (fallback)
    pos.closed = true;
    pos.status = 'closed';
    TP.livePositions.splice(idx, 1);
    renderLivePositions();
  }
}
function closeDemoPos(id, reason) {
  // pos nu e disponibil încă (id lookup mai jos) — hook-ul se apelă după găsire
  // NOTA: _bmPostClose e apelat mai jos după ce avem pos
  // parseInt garanteaza ca id-ul e number chiar daca vine ca string din onclick HTML
  const numId = (typeof id === 'string') ? parseInt(id, 10) : Number(id);
  const idx = TP.demoPositions.findIndex(p => p.id === numId || p.id === id);
  if (idx < 0) {
    // Pozitia nu mai exista - curata UI oricum
    setTimeout(() => { renderDemoPositions(); renderATPositions(); }, 0);
    return;
  }
  const pos = TP.demoPositions[idx];
  if (pos.closed || pos.status === 'closing') return; // [FIX H3] Atomic guard: skip if already closing or closed
  pos.closed = true;
  pos.status = 'closing'; // [FIX H3] Prevent concurrent close attempts
  // [BUG1 FIX] If server-managed position, tell server to close it too
  if (window._serverATEnabled && pos._serverSeq) {
    if (typeof window._zeusRequestServerClose === 'function') window._zeusRequestServerClose(pos._serverSeq, pos.id);
    fetch('/api/at/close', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seq: pos._serverSeq })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.ok && typeof window._zeusConfirmServerClose === 'function') window._zeusConfirmServerClose(pos._serverSeq);
    }).catch(function () { /* pending close guard handles timeout */ });
  }
  // FIX: _bmPostClose primeşte pos → dailyTrades creşte DOAR pt AutoTrade
  if (typeof _bmPostClose === 'function') _bmPostClose(pos, reason);
  // [FIX P10] Guard null/stale price at close — use entry as fallback (flat close)
  const curPrice = getSymPrice(pos) || pos.entry;
  const diff = curPrice - pos.entry;
  const pnl = _safePnl(pos.side, diff, pos.entry, pos.size, pos.lev, true);
  // [FIX BUG4] Store final PnL on pos for callers to use (prevents price-race drift)
  pos._closePnl = pnl;
  if (typeof ZLOG !== 'undefined') ZLOG.push('AT', '[CLOSE DEMO] ' + pos.side + ' ' + pos.sym + ' PnL=' + pnl.toFixed(2) + ' ' + (reason || 'Manual'), { id: pos.id, sym: pos.sym, side: pos.side, pnl: pnl, reason: reason || 'Manual' });
  // Returnam margin (size) + profit/pierdere la balanta
  TP.demoBalance += pos.size + pnl;
  // [FIX P13] Clamp balance to 0 — prevent permanent lockout from negative balance
  if (TP.demoBalance < 0) TP.demoBalance = 0;
  if (pnl >= 0) TP.demoWins++; else TP.demoLosses++;
  // [SR] actualizăm outcome pe semnalul asociat (dacă există)
  srUpdateOutcome(pos, pnl);
  // Kill switch immediate check after realized loss
  if (pos.autoTrade && Number.isFinite(pnl)) {
    AT.realizedDailyPnL = (AT.realizedDailyPnL || 0) + pnl;
    AT.closedTradesToday = (AT.closedTradesToday || 0) + 1;
    checkKillThreshold();
  }
  // Curata DSL state
  delete DSL.positions[String(pos.id)];
  // [FIX H4] Clean _attachedIds to prevent DSL attach dedup leak
  if (DSL._attachedIds) DSL._attachedIds.delete(String(pos.id));
  addTradeToJournal({
    id: pos.id,  // [FIX v85.1 F4] necesar pentru closedPosIds la restore
    time: fmtNow(),
    side: pos.side, sym: pos.sym.replace('USDT', ''),
    entry: pos.entry, exit: curPrice,
    pnl, reason: reason || 'Manual', lev: pos.lev,
    autoTrade: !!pos.autoTrade,  // FIX v118: marcat pentru filtrare dailyTrades
    // [Etapa 4] Journal Context — salvat la CLOSE pentru Historical Regime Memory
    journalEvent: 'CLOSE',
    regime: BM.regime || BM.structure?.regime || '—',
    alignmentScore: BM.structure?.score ?? null,
    volRegime: BM.volRegime || '—',
    profile: S.profile || 'fast',
    // [CHART MARKERS] real timestamps + mode for chart overlay anchoring
    openTs: pos.openTs || pos.id,
    closedAt: Date.now(),
    mode: pos.mode || ((typeof AT !== 'undefined' && AT._serverMode) || 'demo'),
  });
  TP.demoPositions.splice(idx, 1);
  // Track recently closed IDs — prevents pullAndMerge from resurrecting them
  window._zeusRecentlyClosed = window._zeusRecentlyClosed || [];
  window._zeusRecentlyClosed.push(pos.id);
  // [BUG1 FIX v2] Also track _serverSeq to prevent AT poll resurrection
  if (pos._serverSeq && pos._serverSeq !== pos.id) window._zeusRecentlyClosed.push(pos._serverSeq);
  if (window._zeusRecentlyClosed.length > 200) window._zeusRecentlyClosed = window._zeusRecentlyClosed.slice(-100);
  // FIX SYNC: Ambele panouri se updateaza - Paper Trading SI AutoTrade
  setTimeout(() => {
    updateDemoBalance();
    renderDemoPositions(); // Sync Paper Trading panel
    renderATPositions();   // Sync AT panel
    // Curata DSL pentru aceasta pozitie
    TP.demoPositions = (TP.demoPositions || []).filter(p => !p.closed); // cleanup
    const autoPosns = TP.demoPositions.filter(p => p.autoTrade);
    if (autoPosns.length === 0) document.getElementById('atPosCount').textContent = '0 pozitii';
    renderTradeMarkers();  // [CHART MARKERS] refresh after close
  }, 0);
  toast(`${(reason && (reason.includes('TP') || reason.includes('TP HIT'))) ? 'WIN' : 'CLOSED'} ${reason || 'Inchis'}: ${pos.side} ${pos.sym.replace('USDT', '')} PnL ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);
  // [NC] notificare trade închis — severity bazată pe PnL
  ncAdd(pnl >= 0 ? 'info' : 'warning', 'trade',
    `${pnl >= 0 ? 'WIN' : 'LOSS'} ${reason || 'Inchis'}: ${pos.side} ${pos.sym.replace('USDT', '')} PnL ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`
  );
  ZState.syncNow();  // IMMEDIATE push — ensures other devices see the close fast
  // ── EXIT OVERLAY (only auto trades) ──
  if (pos.autoTrade && typeof onTradeClosed === 'function') {
    const _openTs = pos.openTs || pos.id;
    const _durMs = Date.now() - _openTs;
    const _durMin = Math.round(_durMs / 60000);
    onTradeClosed({ sym: pos.sym, pnl, percent: (pnl / pos.size * 100), duration: (_durMin > 0 ? _durMin + 'm' : '<1m'), reason: reason || 'CLOSE', isLive: pos.isLive });
  }
  // ── POST-MORTEM: analiză retrospectivă după fiecare tranzacție închisă ──
  // Async cu delay 200ms — nu blochează closeDemoPos, nu afectează UI sync
  setTimeout(function () { if (typeof runPostMortem === 'function') runPostMortem(pos, pnl, curPrice); }, 200);
  // [P2-4] Notify registered close hooks (ARES, extensions, etc.) — replaces monkey-patch
  if (Array.isArray(window._demoCloseHooks)) {
    var _hPos = pos, _hPnl = pnl, _hReason = reason;
    window._demoCloseHooks.forEach(function (fn) { try { fn(_hPos, _hPnl, _hReason); } catch (_) { } });
  }
}
// ╔══════════════════════════════════════════════════════════════════╗
// ║  POST-MORTEM ENGINE — ZeuS v107                                  ║
// ║  Analiză retrospectivă după fiecare tranzacție închisă.          ║
// ║  READ-ONLY față de BM / AT / DSL / BlockReason.                  ║
// ║  Scrie exclusiv în localStorage['zeus_postmortem_v1'].           ║
// ╚══════════════════════════════════════════════════════════════════╝
