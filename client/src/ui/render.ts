// Zeus v122 — ui/render.ts
// Chart and main rendering functions
// Ported 1:1 from public/js/ui/render.js
import { getKlines, getTimezone, getSymbol, getPrice, getFR, getFG, getOI, getLS, getTPObject, getBrainObject, getBrainMetrics, getTCMaxPos } from '../services/stateAccessors'
import { fmtNow } from '../data/marketDataHelpers'
import { fmt, fP } from '../utils/format'
import { el } from '../utils/dom'
import { _ZI } from '../constants/icons'
const w = window as any; // kept for w.PERF (self-ref SKIP), w.calcADX, w.calcExpectancy, w.calcGlobalExpectancy, w.BEXT, w.MSCAN, w.wlPrices, w.DHF, w.WVE_CONFIG, w.SESS_CFG, w._sessLastBt, w.scheduleAutoClose

// Indicator performance render
export function recordIndicatorPerformance(indicatorId: any, won: any) {
  const PERF = w.PERF;
  const p = PERF[indicatorId];
  if (!p) return;
  if (won) p.wins++; else p.losses++;
  // Update dynamic weight: WR * 1.5 capped at 2.0, min 0.3
  const tot = p.wins + p.losses;
  if (tot >= 3) {
    const wr = p.wins / tot;
    p.weight = Math.max(0.3, Math.min(2.0, wr * 2.0));
  }
}

// BUG6 FIX: record ALL indicators from signalData, not just hardcoded 3
export function recordAllIndicators(pos: any, won: any) {
  const PERF = w.PERF;
  const usedIndicators = pos.signalData?.indicators || pos.signalData?.signals?.map((s: any) => s.id || s.name?.toLowerCase().replace(/\s/g, '')) || [];
  if (usedIndicators.length) {
    usedIndicators.forEach((ind: any) => {
      // Normalize to PERF key
      const key = ind in PERF ? ind
        : ind.includes('rsi') ? 'rsi'
          : ind.includes('macd') ? 'macd'
            : ind.includes('super') || ind.includes('st_') ? 'supertrend'
              : ind.includes('adx') ? 'adx'
                : ind.includes('vol') ? 'volume'
                  : ind.includes('fund') ? 'funding'
                    : ind.includes('conf') ? 'confluence'
                      : null;
      if (key) recordIndicatorPerformance(key, won);
    });
  } else {
    // Fallback: record confluence + supertrend as before
    recordIndicatorPerformance('confluence', won);
    recordIndicatorPerformance('supertrend', won);
    if (pos.rsiAtEntry !== undefined) recordIndicatorPerformance('rsi', won);
  }
  recalcPerfWeights();
  renderPerfTracker();
}

export function recalcPerfWeights() {
  const PERF = w.PERF;
  Object.values(PERF).forEach((p: any) => {
    const tot = p.wins + p.losses;
    if (tot >= 3) p.weight = Math.max(0.3, Math.min(2.0, (p.wins / tot) * 2.0));
  });
}

export function renderPerfTracker() {
  const PERF = w.PERF;
  const body = el('perfTrackerBody');
  if (!body) return;
  const entries = Object.entries(PERF);
  if (entries.every(([, p]: any) => p.wins + p.losses === 0)) {
    body.innerHTML = '<div style="padding:16px;text-align:center;font-size:13px;color:var(--dim)">Se colecteaza date din Auto Trade...</div>';
    return;
  }
  body.innerHTML = entries.map(([name, p]: any) => {
    const tot = p.wins + p.losses;
    const wr = tot ? Math.round(p.wins / tot * 100) : 0;
    const barColor = wr >= 65 ? 'var(--grn)' : wr >= 50 ? 'var(--gold)' : 'var(--red)';
    const weightDisplay = (p.weight * 100).toFixed(0) + '%';
    // v122 analytics: expectancy + pnl
    const avgW = p.wins > 0 ? ((p.winPnl || 0) / p.wins) : 0;
    const avgL = p.losses > 0 ? ((p.lossPnl || 0) / p.losses) : 0;
    const exp = typeof w.calcExpectancy === 'function' ? w.calcExpectancy(name) : 0;
    const netPnl = (p.pnlSum || 0) - (p.feeSum || 0);
    const expColor = exp > 0 ? 'var(--grn)' : exp < 0 ? 'var(--red)' : 'var(--dim)';
    const pnlColor = netPnl > 0 ? 'var(--grn)' : netPnl < 0 ? 'var(--red)' : 'var(--dim)';
    return `<div class="perf-row">
      <div class="perf-name">${name.toUpperCase()}</div>
      <div class="perf-bar-wrap"><div class="perf-bar-fill" style="width:${wr}%;background:${barColor}"></div></div>
      <div class="perf-wr" style="color:${barColor}">${tot ? wr + '%' : '\u2014'}</div>
      <div class="perf-trades">${tot}t</div>
      <div class="perf-weight">W:${weightDisplay}</div>
      <div class="perf-avgw" title="Avg Win">${avgW ? '$' + avgW.toFixed(2) : '\u2014'}</div>
      <div class="perf-avgl" title="Avg Loss">${avgL ? '-$' + avgL.toFixed(2) : '\u2014'}</div>
      <div class="perf-exp" style="color:${expColor}" title="Expectancy">${tot ? '$' + exp.toFixed(2) : '\u2014'}</div>
      <div class="perf-net" style="color:${pnlColor}" title="Net PnL">$${netPnl.toFixed(2)}</div>
      <div class="perf-fees" title="Fees">-$${(p.feeSum || 0).toFixed(2)}</div>
    </div>`;
  }).join('');
  // Global expectancy row
  const gExp = typeof w.calcGlobalExpectancy === 'function' ? w.calcGlobalExpectancy() : 0;
  const gExpColor = gExp > 0 ? 'var(--grn)' : gExp < 0 ? 'var(--red)' : 'var(--dim)';
  body.innerHTML += `<div class="perf-row perf-total-row">
    <div class="perf-name" style="color:var(--cyan)">GLOBAL</div>
    <div class="perf-bar-wrap"></div><div class="perf-wr"></div><div class="perf-trades"></div><div class="perf-weight"></div>
    <div class="perf-avgw"></div><div class="perf-avgl"></div>
    <div class="perf-exp" style="color:${gExpColor};font-weight:700">E: $${gExp.toFixed(2)}</div>
    <div class="perf-net"></div><div class="perf-fees"></div>
  </div>`;
  { const _oe = el('perfUpdTime'); if (_oe) _oe.textContent = `Upd ${fmtNow()}`; }
}

// Hook into existing closeDemoPos to record performance
export const _origAutoClose_recordPerf = w.scheduleAutoClose;

// --- ADX NEURON INTEGRATION ---

// Brain extension UI
export function getCurrentADX() {
  return w.calcADX(getKlines());
}

// ===================================================================
// END MULTI-SYMBOL + DAY/HOUR + PERF TRACKER
// ===================================================================

// ===================================================================
// ZEUS BRAIN EXTENSION — NEURAL DATA STREAM
// ===================================================================
// [MOVED TO TOP] BEXT

// --- QUANTUM CLOCK ---
export function updateQuantumClock() {
  const now = new Date();
  const tz = getTimezone();
  // Use canonical S.tz for Romania time
  const roTime = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const h = roTime.getHours(), m = roTime.getMinutes(), s = roTime.getSeconds();
  // UTC hours for session detection
  const hUTC = now.getUTCHours();

  // Hand angles
  const secDeg = (s / 60) * 360;
  const minDeg = ((m + s / 60) / 60) * 360;
  const hourDeg = ((h % 12 + (m / 60)) / 12) * 360;

  const sh = el('qSecHand'), mh = el('qMinHand'), hh = el('qHourHand');
  if (sh) sh.setAttribute('transform', `rotate(${secDeg},28,28)`);
  if (mh) mh.setAttribute('transform', `rotate(${minDeg},28,28)`);
  if (hh) hh.setAttribute('transform', `rotate(${hourDeg},28,28)`);

  // Second arc fills per second in minute (0..60)
  const secArc = el('qSecArc');
  if (secArc) {
    const circ = 2 * Math.PI * 19;
    const fill = (s / 60) * circ;
    secArc.setAttribute('stroke-dasharray', `${fill.toFixed(1)} ${circ}`);
    // Color pulses at :00
    const secColor = s < 10 ? 'var(--grn-bright)' : s < 30 ? 'var(--pur)' : '#4400aa';
    secArc.setAttribute('stroke', secColor);
  }

  // Time label
  const _roTz = getTimezone();
  const ct = el('qClockTime');
  if (ct) ct.textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');

  // Market phase (session) detection uses UTC
  const phaseEl = el('brainMarketPhase');
  if (phaseEl) {
    if (hUTC >= 0 && hUTC < 8) { phaseEl.textContent = 'ASIA SESSION'; phaseEl.className = 'market-phase asian'; }
    else if (hUTC >= 8 && hUTC < 13) { phaseEl.textContent = 'LONDON SESSION'; phaseEl.className = 'market-phase london'; }
    else if (hUTC >= 13 && hUTC < 21) { phaseEl.textContent = 'NY SESSION'; phaseEl.className = 'market-phase ny'; }
    else { phaseEl.textContent = 'QUIET HOURS'; phaseEl.className = 'market-phase dead'; }
    // Always update all 3 session backtest stats
    updateSessionBacktest(hUTC);
  }
}
// [clock interval started in startApp()]

// --- SESSION BACKTEST STATS ---
// [MOVED TO TOP] SESSION_HOURS_BT
export function getSessionKey(hUTC: number) {
  if (hUTC >= 0 && hUTC < 8) return 'asia';
  if (hUTC >= 8 && hUTC < 13) return 'london';
  if (hUTC >= 13 && hUTC < 21) return 'ny';
  return null;
}
// [MOVED TO TOP] _sessLastBt

// -- Session info config --
// [MOVED TO TOP] SESS_CFG

export function updateSessionBacktest(hUTC: number) {
  const _sessLastBt = w._sessLastBt;
  const SESS_CFG = w.SESS_CFG;
  const box = el('sessBacktestBox'); if (!box) return;

  const nowTs = Date.now();
  // Refresh max every 90 seconds
  if ((nowTs - _sessLastBt.ts) < 90000 && box.innerHTML) return;
  _sessLastBt.ts = nowTs;

  const klines = getKlines();
  if (klines.length < 20) { box.innerHTML = ''; return; }

  const yearMs = 365 * 24 * 3600 * 1000;
  const monthMs = 30 * 24 * 3600 * 1000;
  const weekMs = 7 * 24 * 3600 * 1000;
  const curSess = getSessionKey(hUTC);

  function calcStats(sh: any, fromMs: number) {
    let longs = 0, shorts = 0;
    klines.forEach((k: any) => {
      const ts = k.time * 1000;
      if (ts < fromMs) return;
      const h = new Date(ts).getUTCHours();
      if (h >= sh.start && h < sh.end) {
        if (k.close > k.open) longs++; else shorts++;
      }
    });
    const tot = longs + shorts;
    if (!tot) return null;
    return { long: Math.round(longs / tot * 100), short: Math.round(shorts / tot * 100), tot };
  }

  function dotHtml(pctLong: number) {
    const cls = pctLong >= 60 ? 'bull' : pctLong <= 40 ? 'bear' : 'idle';
    return '<span class="sess-bt-dot ' + cls + '"></span>';
  }

  function miniStat(st: any) {
    if (!st || st.tot < 2) return '<span style="color:#1a2a3a">\u2014</span>';
    const bull = st.long > 50;
    const pct = bull ? st.long : st.short;
    const col = bull ? '#00d97a' : '#ff3355';
    return dotHtml(st.long) + '<span style="color:' + col + ';font-weight:700">' + pct + '%</span>';
  }

  // Build 3 rows — one per session
  let html = '<table style="width:100%;border-collapse:collapse;font-size:10px;line-height:1.7">';
  // Header
  html += '<tr><td style="color:#1a3a5a;padding:0 2px"></td>'
    + '<td style="color:#2a4a6a;padding:0 3px;text-align:center">YEAR</td>'
    + '<td style="color:#2a4a6a;padding:0 3px;text-align:center">MONTH</td>'
    + '<td style="color:#2a4a6a;padding:0 3px;text-align:center">WEEK</td></tr>';

  (['asia', 'london', 'ny'] as string[]).forEach((sk: string) => {
    const cfg = SESS_CFG[sk];
    const sh = cfg.h;
    const isNow = sk === curSess;
    const yr = calcStats(sh, nowTs - yearMs);
    const mo = calcStats(sh, nowTs - monthMs);
    const wk = calcStats(sh, nowTs - weekMs);
    const labelStyle = 'color:' + cfg.col + (isNow ? ';font-weight:700;text-shadow:0 0 6px ' + cfg.col + '88' : ';opacity:0.6') + ';padding:0 3px;white-space:nowrap';
    html += '<tr style="' + (isNow ? 'background:#ffffff07' : '') + ';">'
      + '<td style="' + labelStyle + '">' + (isNow ? '\u25b6 ' : '') + cfg.label + '</td>'
      + '<td style="text-align:center;padding:0 3px">' + miniStat(yr) + '</td>'
      + '<td style="text-align:center;padding:0 3px">' + miniStat(mo) + '</td>'
      + '<td style="text-align:center;padding:0 3px">' + miniStat(wk) + '</td>'
      + '</tr>';
  });
  html += '</table>';

  box.innerHTML = html;
}


// --- SYMBOL PULSE BARS ---
export function updateSymPulseRows() {
  const BEXT = w.BEXT;
  const TP = getTPObject();
  const syms = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT'];
  const labels = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA'];
  const container = el('symPulseRows'); if (!container) return;
  const _sym = getSymbol(), _price = getPrice();

  // Track price history for sparklines
  syms.forEach((sym: string, i: number) => {
    const p = sym === _sym ? _price : (w.wlPrices[sym]?.price || 0);
    if (!p) return;
    if (!BEXT.priceHistory[sym]) BEXT.priceHistory[sym] = [];
    BEXT.priceHistory[sym].push(p);
    if (BEXT.priceHistory[sym].length > 14) BEXT.priceHistory[sym].shift();
  });

  container.innerHTML = syms.map((sym: string, i: number) => {
    const hist = BEXT.priceHistory[sym] || [];
    const curP = hist[hist.length - 1] || 0;
    const chg = w.wlPrices[sym]?.chg || 0;
    const chgCls = chg > 0 ? 'up' : chg < 0 ? 'down' : 'neut';
    const col = chg > 0 ? 'var(--grn-bright)' : chg < 0 ? 'var(--red)' : '#555';

    // Sparkline bars
    const maxP = hist.length ? Math.max(...hist) : 1;
    const minP = hist.length ? Math.min(...hist) : 0;
    const range = maxP - minP || 1;
    const bars = hist.map((p: any, j: number) => {
      const h = Math.max(10, ((p - minP) / range) * 100);
      const isLast = j === hist.length - 1;
      const barCol = isLast ? col : (chg > 0 ? '#00aa4488' : '#ff336688');
      return `<div class="sym-pulse-bar" style="height:${h}%;background:${barCol};${isLast ? `box-shadow:0 0 4px ${col}` : ''}"></div>`;
    }).join('');

    const alreadyOpen = (TP.demoPositions || []).some((p: any) => p.sym === sym && p.autoTrade && !p.closed); // [FIX M2]
    const openDot = alreadyOpen ? `<span style="color:#aa44ff;font-size:12px">\u25cf</span>` : '';

    return `<div class="sym-pulse-row">
      <div class="sym-pulse-label">${openDot}${labels[i]}</div>
      <div class="sym-pulse-bars">${bars || '<div style="flex:1;background:#0d1520;border-radius:1px;height:3px"></div>'}</div>
      <div class="sym-pulse-price" style="color:${col}">${curP ? '$' + fP(curP) : '\u2014'}</div>
      <div class="sym-pulse-chg" style="color:${col}">${chg ? (chg > 0 ? '+' : '') + chg.toFixed(2) + '%' : '\u2014'}</div>
    </div>`;
  }).join('');
}

// --- NEURAL HEATMAP ---
export function updateBrainHeatmap() {
  const MSCAN = w.MSCAN;
  const syms = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA'];
  const symsFull = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT'];
  const container = el('brainHeatmap'); if (!container) return;

  container.innerHTML = syms.map((sym: string, i: number) => {
    const fullSym = symsFull[i];
    const scan = MSCAN.data[fullSym];
    const chg = w.wlPrices[fullSym]?.chg || 0;
    const score = scan?.score || 50;
    const dir = scan?.dir || 'neut';

    // Heatmap color by momentum score
    const intensity = Math.abs(chg) / 3; // 0-1
    let bg: string, textCol: string;
    if (dir === 'bull') { bg = `rgba(0,217,122,${Math.min(.3, intensity * .2 + .05)})`; textCol = 'var(--grn-bright)'; }
    else if (dir === 'bear') { bg = `rgba(255,68,102,${Math.min(.3, intensity * .2 + .05)})`; textCol = 'var(--red)'; }
    else { bg = 'transparent'; textCol = '#444'; }

    const barW = score + '%';
    const barCol = score >= 65 ? 'var(--grn)' : score >= 50 ? 'var(--gold)' : 'var(--red)';

    return `<div class="nheat-cell" style="background:${bg}">
      <div class="nheat-sym">${sym}</div>
      <div class="nheat-val" style="color:${textCol}">${score}</div>
      <div class="nheat-bar" style="width:${barW};background:${barCol}"></div>
    </div>`;
  }).join('');
}

// --- RISK GAUGES ---
export function updateRiskGauges() {
  const BRAIN = getBrainObject();
  const TP = getTPObject();
  const BM = getBrainMetrics();
  // Volatility gauge (from ATR%)
  const atrPct = BRAIN.regimeAtrPct || 1;
  const volPct = Math.min(100, atrPct * 30);
  const volCol = volPct > 70 ? 'var(--red)' : volPct > 40 ? 'var(--gold)' : 'var(--grn)';
  setRiskGauge('vol', volPct, volCol, atrPct.toFixed(2) + '%');

  // Position risk gauge
  const openAuto = (TP.demoPositions || []).filter((p: any) => p.autoTrade && !p.closed).length; // [FIX M2]
  const maxPos = getTCMaxPos();
  const posPct = openAuto / maxPos * 100;
  const posCol = posPct >= 100 ? 'var(--red)' : posPct >= 50 ? 'var(--gold)' : 'var(--grn)';
  setRiskGauge('pos', posPct, posCol, openAuto + '/' + maxPos);

  // Sentiment gauge (FR + LS + fear&greed combined)
  const fr = getFR();
  const frVal = fr ? Math.abs(fr) * 10000 : 0;
  const fg = getFG();
  const sentimentBull = fg > 50 ? fg : (100 - fg);
  const sentPct = Math.min(100, sentimentBull);
  const sentCol = sentPct > 65 ? 'var(--grn)' : sentPct > 40 ? 'var(--gold)' : 'var(--red)';
  setRiskGauge('sent', sentPct, sentCol, fg + '/100');

  // Confluence gauge
  const confScore = (typeof BM !== 'undefined' ? BM.confluenceScore : 0) || 0; // [FIX v85.1 F3] din memorie
  const confCol = confScore >= 70 ? 'var(--grn)' : confScore >= 50 ? 'var(--gold)' : 'var(--red)';
  setRiskGauge('conf', confScore, confCol, confScore + '');
}

export function setRiskGauge(id: string, pct: number, col: string, label: string) {
  const fill = el('rg-' + id); const val = el('rgv-' + id);
  if (fill) { fill.style.width = pct + '%'; fill.style.background = `linear-gradient(90deg,${col}88,${col})`; }
  if (val) { val.textContent = label; val.style.color = col; }
}

// --- DATA STREAM TICKER ---
export function updateDataStream() {
  const BRAIN = getBrainObject();
  const syms = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT'];
  const labels = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA'];
  const _sym = getSymbol(), _price = getPrice();

  const items: any[] = [];

  // Symbol prices
  syms.forEach((sym: string, i: number) => {
    const p = sym === _sym ? _price : (w.wlPrices[sym]?.price || 0);
    const chg = w.wlPrices[sym]?.chg || 0;
    const cls = chg > 0 ? 'up' : chg < 0 ? 'down' : 'neut';
    const arrow = chg > 0 ? '\u25b2' : chg < 0 ? '\u25bc' : '\u2014';
    if (p) items.push({ text: `${labels[i]} $${fP(p)} ${arrow}${Math.abs(chg).toFixed(2)}%`, cls });
  });

  // Extra brain data
  const fr = getFR();
  if (fr !== null) items.push({ text: `FR ${(fr * 100).toFixed(4)}%`, cls: fr < 0 ? 'up' : 'down' });
  const oi = getOI().oi;
  if (oi) items.push({ text: `OI $${fmt(oi)}`, cls: 'neut' });
  const ls = getLS();
  if (ls) items.push({ text: `L/S ${ls.l?.toFixed(0)}%/${ls.s?.toFixed(0)}%`, cls: ls.l > 50 ? 'up' : 'down' });
  items.push({ text: `REGIM ${BRAIN.regime.toUpperCase()}`, cls: 'neut' });
  items.push({ text: `ADX ${getCurrentADX() || '\u2014'}`, cls: 'neut' });
  items.push({ text: `BRAIN ${BRAIN.state.toUpperCase()}`, cls: BRAIN.state === 'ready' ? 'up' : BRAIN.state === 'blocked' ? 'down' : 'neut' });
  items.push({ text: `TIME ${new Date().toUTCString().slice(17, 22)} UTC`, cls: 'neut' });

  // Duplicate for seamless loop
  const allItems = [...items, ...items];
  const inner = el('dstreamInner');
  if (inner) inner.innerHTML = allItems.map((it: any) => `<div class="dstream-item ${it.cls}">${it.text}</div>`).join('');
}

// --- BRAIN EXTENSION MAIN UPDATE ---
export function updateBrainExtension() {
  updateSymPulseRows();
  updateBrainHeatmap();
  updateRiskGauges();
  updateDataStream();
}
// [brainExt interval started in startApp()]

// ===================================================================


// --- DAY/HOUR FILTER (DHF) ---
// FIX: Folosim ora Romaniei (Europe/Bucharest) in loc de UTC
// BUG3 FIX: Unified UTC time — no more timezone inconsistency
export function getTimeUTC() {
  const d = new Date();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    day: dayNames[d.getUTCDay()],
    dayNum: d.getUTCDay(),
    hour: d.getUTCHours()
  };
}
// getRoTime() — returneaza ora reala Romania (DST automat, UTC+2/+3)
// PATCH A FIX: anterior era alias la getTimeUTC() (gresit - afisa UTC)
// Data layer (DHF.hours) ramane UTC — aceasta e doar pentru UI/display
export function getRoTime() {
  const now = new Date();
  let parts: any = null;
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Bucharest',
      weekday: 'short',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    } as any).formatToParts(now);
  } catch (e) {
    // Fallback: local time (mai bine decat UTC gresit)
    parts = new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    } as any).formatToParts(now);
  }
  const get = (t: string) => (parts.find((p: any) => p.type === t)?.value) || '00';
  const dow = get('weekday');
  const hh = parseInt(get('hour'), 10) || 0;
  const mm = parseInt(get('minute'), 10) || 0;
  const ss = parseInt(get('second'), 10) || 0;
  return { now, dow, hh, mm, ss };
}

export function isCurrentTimeOK() {
  const DHF = w.DHF;
  if (!el('dhfEnabled')?.checked) return true;
  const { day, hour } = getTimeUTC();
  const dayWR = DHF.days[day]?.wr || 60;
  const hourWR = DHF.hours[hour]?.wr || 60;
  // Unified WR threshold: use WVE_CONFIG.wrFilter.minWR (default 55) for consistency
  // with the execution veto in placeAutoTrade — prevents misleading green conditions
  const _wrMin = (w.WVE_CONFIG && w.WVE_CONFIG.wrFilter && w.WVE_CONFIG.wrFilter.minWR) || 55;
  return dayWR >= 50 && hourWR >= _wrMin;
}

export function renderDHF() {
  const DHF = w.DHF;
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const { day: curDay, hour: curHour } = getTimeUTC(); // data layer: UTC (consistent cu DHF.hours indexing)
  const roT = getRoTime();                       // UI highlight: ora RO reala
  const curHourRO = roT.hh;                      // ora RO pentru highlight vizual
  const now = new Date();
  const utcTimeStr = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')} UTC`;

  const dayGrid = el('dhfDayGrid');
  const hourGrid = el('dhfHourGrid');
  const curSlot = el('dhfCurrentSlot');

  if (curSlot) {
    const dayWR = DHF.days[curDay]?.wr || 60;
    const hourWR = DHF.hours[curHour]?.wr || 60;
    // [FIX BUG5] Use same _wrMin threshold as isCurrentTimeOK gate — prevents misleading green
    const _wrMinRender = (w.WVE_CONFIG && w.WVE_CONFIG.wrFilter && w.WVE_CONFIG.wrFilter.minWR) || 55;
    const isOK = dayWR >= 50 && hourWR >= _wrMinRender;
    curSlot.innerHTML = `${curDay} ${String(curHour).padStart(2, '0')}:00 UTC (${utcTimeStr}) \u2014 WR:${Math.min(dayWR, hourWR)}% \u2014 ${isOK ? _ZI.ok + ' OK' : _ZI.noent + ' EVITA'}`;
    curSlot.style.color = isOK ? 'var(--grn-bright)' : 'var(--red)';
  }

  if (dayGrid) {
    dayGrid.innerHTML = dayNames.map((d: string) => {
      const wr = DHF.days[d]?.wr || 60;
      const isCur = d === curDay;
      const cls = wr >= 60 ? 'good' : wr >= 45 ? 'ok' : 'bad';
      return `<div class="dhf-cell ${cls}" style="${isCur ? 'outline:1px solid #00ff88;outline-offset:1px' : ''}" title="${d}: ${wr}% WR">
        <div class="dhf-cell-day">${d}</div>
        <div class="dhf-cell-wr">${wr}%</div>
      </div>`;
    }).join('');
  }

  if (hourGrid) {
    hourGrid.innerHTML = Array.from({ length: 24 }, (_: any, h: number) => {
      const wr = DHF.hours[h]?.wr || 60;
      const isCur = h === curHour; // highlight UTC (consistent cu DHF.hours indexing)
      const cls = wr >= 60 ? 'good' : wr >= 45 ? 'ok' : 'bad';
      return `<div class="dhf-cell ${cls}" style="${isCur ? 'outline:1px solid #00ff88;outline-offset:1px' : ''}font-size:10px" title="Ora ${String(h).padStart(2, '0')}:00 Romania \u2014 ${wr}% WR">
        <div class="dhf-cell-day">${String(h).padStart(2, '0')}h</div>
        <div class="dhf-cell-wr" style="font-size:11px">${wr}%</div>
      </div>`;
    }).join('');
  }
}
