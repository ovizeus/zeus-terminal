// Zeus v122 — ui/panels.ts
// Panel toggles, strip UI, eye panel
// Ported 1:1 from public/js/ui/panels.js
import { fmtNow, toast, _calcATRSeries } from '../data/marketDataHelpers'
import { fmt, fP } from '../utils/format'
import { escHtml, el } from '../utils/dom'
import { _ZI } from '../constants/icons'
import { getDrawdownStats, getLastNDays, getWeeklyRollup } from '../engine/dailyPnl'
import { calcExpectancyByProfile } from '../engine/perfStore'
import { refreshLiqCycleLight, refreshSweepLight } from '../core/config'

const w = window as any; // kept for w.S (mixed reads/writes), w.mainChart, w.oviSeries, w.BT, w.BT_INDICATORS, w.renderChart capture

// vwapSeries — owned by this module
let vwapSeries: any[] = []
export function getVwapSeries(): any[] { return vwapSeries }
export function resetVwapSeries(): void { vwapSeries = [] }

// [REMOVED] Eye panel — indicator control is now unified in "Select Indicator" panel
export function openEyePanel() { /* removed — use openIndPanel() */ }
export function closeEyePanel() { /* removed */ }
export function eyeToggle() { /* removed */ }


// Magnets
// LIQUIDITY MAGNET SCANNER
// Sources: Order Book Walls + Liq Clusters + OI Levels + S/R
// ===================================================================
(function () {
  if (!w.S) return;
  w.S.magnets = { above: [], below: [], lastScan: 0 };
})();

export async function scanLiquidityMagnets() {
  const S = w.S;
  if (!S || !S.price) return;
  if (!S.magnets) S.magnets = { above: [], below: [], lastScan: 0 };
  const now = Date.now();
  S.magnets.lastScan = now;

  const magnets: any[] = [];

  // --- 1. ORDER BOOK WHALE WALLS ---
  const ob = { asks: S.asks || [], bids: S.bids || [] };
  if (ob.asks.length && ob.bids.length) {
    const allQ = [...ob.asks.map((x: any) => x.q), ...ob.bids.map((x: any) => x.q)];
    const avgQ = allQ.reduce((a: any, b: any) => a + b, 0) / allQ.length;
    const threshold = avgQ * 3.5; // 3.5x average = whale wall

    ob.asks.forEach((a: any) => {
      if (a.q >= threshold) {
        const usd = a.q * a.p;
        magnets.push({
          price: a.p, type: 'ob_wall', direction: 'above',
          strength: Math.min(100, Math.round(a.q / avgQ * 20)),
          usd, label: `Perete ASK $${fmt(usd)}`,
          source: 'Order Book', qty: a.q.toFixed(2)
        });
      }
    });
    ob.bids.forEach((b: any) => {
      if (b.q >= threshold) {
        const usd = b.q * b.p;
        magnets.push({
          price: b.p, type: 'ob_wall', direction: 'below',
          strength: Math.min(100, Math.round(b.q / avgQ * 20)),
          usd, label: `Perete BID $${fmt(usd)}`,
          source: 'Order Book', qty: b.q.toFixed(2)
        });
      }
    });
  }

  // --- 2. LIQUIDATION CLUSTERS ---
  const clusters = Object.values(S.btcClusters || {}) as any[];
  if (clusters.length) {
    const maxVol = Math.max(...clusters.map((c: any) => c.vol), 1);
    clusters.sort((a: any, b: any) => b.vol - a.vol).slice(0, 8).forEach((c: any) => {
      const dir = c.price > S.price ? 'above' : 'below';
      const strength = Math.round(c.vol / maxVol * 100);
      if (strength < 15) return;
      magnets.push({
        price: c.price, type: 'liq_cluster', direction: dir,
        strength, usd: c.vol,
        label: `Cluster LIQ $${fmt(c.vol)} ${c.isLong ? 'LONG' : 'SHORT'}`,
        source: 'Liq Clusters', qty: null
      });
    });
  }

  // --- 3. KLINE-BASED LEVELS (high volume nodes) ---
  if (S.klines && S.klines.length > 50) {
    const recentBars = S.klines.slice(-100);
    const maxVol = Math.max(...recentBars.map((k: any) => k.volume));
    // Find bars with volume > 70th percentile
    const volThreshold = maxVol * 0.7;
    recentBars.forEach((k: any) => {
      if (k.volume < volThreshold) return;
      // High volume candle = liquidity zone
      const level = (k.high + k.low) / 2;
      const dir = level > S.price ? 'above' : 'below';
      const strength = Math.round(k.volume / maxVol * 80);
      magnets.push({
        price: level, type: 'vol_node', direction: dir,
        strength,
        usd: k.volume * level,
        label: `Nod Volum Mare (${(k.volume / 1000).toFixed(1)}K)`,
        source: 'Volume', qty: null
      });
    });
  }

  // --- 4. ATR-BASED KEY LEVELS ---
  if (S.atr && S.price) {
    const atr = S.atr;
    [1, 2, 3, 1.618, 2.618].forEach((mult: any) => {
      const above = S.price + atr * mult;
      const below = S.price - atr * mult;
      const isGolden = mult === 1.618 || mult === 2.618;
      magnets.push({
        price: above, type: 'atr_level', direction: 'above',
        strength: isGolden ? 70 : 50,
        usd: 0,
        label: `ATR\u00d7${mult} ${isGolden ? '(Golden)' : ''}`,
        source: 'ATR', qty: null
      });
      magnets.push({
        price: below, type: 'atr_level', direction: 'below',
        strength: isGolden ? 70 : 50,
        usd: 0,
        label: `ATR\u00d7${mult} ${isGolden ? '(Golden)' : ''}`,
        source: 'ATR', qty: null
      });
    });
  }

  // --- 5. MERGE & DEDUPLICATE NEARBY LEVELS ---
  const priceZone = S.price * 0.002; // 0.2% zone = merge
  const merged: any[] = [];
  const sorted = magnets.sort((a: any, b: any) => a.price - b.price);
  sorted.forEach((m: any) => {
    const existing = merged.find((e: any) => Math.abs(e.price - m.price) < priceZone && e.direction === m.direction);
    if (existing) {
      existing.strength = Math.min(100, existing.strength + m.strength * 0.4);
      if (m.usd > 0) existing.usd += m.usd;
      existing.sources = (existing.sources || [existing.source]);
      if (!existing.sources.includes(m.source)) existing.sources.push(m.source);
      // Keep the most important label
      if (m.type === 'ob_wall' || m.type === 'liq_cluster') existing.label = m.label;
    } else {
      merged.push({ ...m, sources: [m.source] });
    }
  });

  // --- 6. SORT & FILTER ---
  const above = merged.filter((m: any) => m.direction === 'above' && m.price > S.price && m.strength > 20)
    .sort((a: any, b: any) => a.price - b.price) // nearest first
    .slice(0, 5);
  const below = merged.filter((m: any) => m.direction === 'below' && m.price < S.price && m.strength > 20)
    .sort((a: any, b: any) => b.price - a.price) // nearest first
    .slice(0, 5);

  S.magnets = { above, below, lastScan: now };
  renderMagnets();

  // Update auto trade with magnet bias
  updateMagnetBias();
  // Recalc BM.liqCycle distances + sweep imediat dupa scan nou
  refreshLiqCycleLight();
  refreshSweepLight();
}

export function renderMagnets() {
  const S = w.S;
  const { above, below } = S.magnets;
  const p = S.price;
  if (!p) return;

  const nearAboveEl = el('magNearAbove');
  const nearBelowEl = el('magNearBelow');
  const biasEl = el('magBias');
  const cpEl = el('magCurrentPrice');
  const updEl = el('magUpdTime');
  const aboveCntEl = el('magAboveCnt');
  const belowCntEl = el('magBelowCnt');

  if (cpEl) cpEl.textContent = '$' + fP(p);
  if (updEl) updEl.textContent = 'UPD ' + new Date().toLocaleTimeString('ro-RO', { timeZone: S.tz || 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (aboveCntEl) aboveCntEl.textContent = above.length + ' magneti';
  if (belowCntEl) belowCntEl.textContent = below.length + ' magneti';

  // Nearest magnets summary
  const nearAbove = above[0];
  const nearBelow = below[0];
  if (nearAboveEl && nearAbove) {
    const distPct = ((nearAbove.price - p) / p * 100).toFixed(2);
    nearAboveEl.textContent = '$' + fP(nearAbove.price) + ' (+' + distPct + '%)';
  }
  if (nearBelowEl && nearBelow) {
    const distPct = ((p - nearBelow.price) / p * 100).toFixed(2);
    nearBelowEl.textContent = '$' + fP(nearBelow.price) + ' (-' + distPct + '%)';
  }

  // Bias: nearer & stronger magnet determines bias
  if (biasEl && nearAbove && nearBelow) {
    const distA = (nearAbove.price - p) / p * 100;
    const distB = (p - nearBelow.price) / p * 100;
    const scoreA = nearAbove.strength / (distA + 0.1);
    const scoreB = nearBelow.strength / (distB + 0.1);
    let biasDir: any, biasClass: any, biasLabel: any;
    if (scoreB > scoreA * 1.3) { biasDir = 'bull'; biasClass = 'bull'; biasLabel = _ZI.dGrn + ' BULL \u2014 Magnet jos atrage'; }
    else if (scoreA > scoreB * 1.3) { biasDir = 'bear'; biasClass = 'bear'; biasLabel = _ZI.dRed + ' BEAR \u2014 Magnet sus atrage'; }
    else { biasDir = 'neut'; biasClass = 'neut'; biasLabel = _ZI.bolt + ' NEUTRU'; }
    biasEl.innerHTML = biasLabel;
    biasEl.className = 'mag-bias ' + biasClass;
    S.magnets.bias = biasDir;
  }

  // Render lists
  const renderList = (list: any[], containerId: string, isAbove: boolean) => {
    const c = el(containerId); if (!c) return;
    if (!list.length) { c.innerHTML = `<div style="padding:8px;text-align:center;font-size:13px;color:var(--dim)">No magnet detected</div>`; return; }
    c.innerHTML = list.map((m: any, _i: number) => {
      const dist = isAbove ? ((m.price - p) / p * 100) : (p - m.price) / p * 100 * -1;
      const distStr = (dist >= 0 ? '+' : '') + dist.toFixed(2) + '%';
      const cls = isAbove ? (m.strength > 70 ? 'strong-above' : 'above') : (m.strength > 70 ? 'strong-below' : 'below');
      const distCls = isAbove ? 'above' : 'below';
      const dots = [...Array(Math.ceil(m.strength / 20))].map(() => `<div class="mag-dot" style="background:${isAbove ? '#ff3355' : '#00d97a'};width:${Math.min(8, 4 + m.strength / 20)}px;height:${Math.min(8, 4 + m.strength / 20)}px;border-radius:50%;box-shadow:0 0 4px ${isAbove ? '#ff3355' : '#00d97a'}"></div>`).join('');
      const srcTag = m.sources ? (m.sources.join(' + ')) : m.source;
      return `<div class="mag-level ${cls}" data-action="jumpToMagnet" data-price="${m.price}">
        <div class="mag-bar-fill" style="width:${m.strength}%"></div>
        <div class="mag-icon">${m.type === 'ob_wall' ? _ZI.whale : m.type === 'liq_cluster' ? _ZI.boom : m.type === 'vol_node' ? _ZI.chart : _ZI.ruler}</div>
        <div class="mag-info">
          <div class="mag-price">$${fP(m.price)}</div>
          <div class="mag-desc">${srcTag} ${m.usd > 0 ? '\u00b7 $' + fmt(m.usd) : ''}</div>
          <div class="mag-strength">${dots}</div>
        </div>
        <div class="mag-dist ${distCls}">${distStr}</div>
      </div>`;
    }).join('');
  };

  renderList(above, 'magAboveList', true);
  renderList(below, 'magBelowList', false);

  // Event delegation for jumpToMagnet — replaces onclick="jumpToMagnet(...)"
  ;['magAboveList', 'magBelowList'].forEach(id => {
    const c = el(id); if (!c || c.dataset.magDelegated) return
    c.dataset.magDelegated = '1'
    c.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest('[data-action="jumpToMagnet"]')
      if (row) { const price = parseFloat(row.getAttribute('data-price') || '0'); if (price > 0) jumpToMagnet(price) }
    })
  })
}

export function updateMagnetBias() {
  const S = w.S;
  // Feed bias into auto trade conditions
  S.magnetBias = S.magnets?.bias || S.magnetBias || 'neut';
}

export function jumpToMagnet(price: any) {
  const S = w.S;
  // Flash a toast with the price level
  toast(`Magnet: $${fP(price)} | Dist: ${((Math.abs(price - S.price) / S.price) * 100).toFixed(2)}%`);
}


// Backtest results render
// ===================================================================
// BACKTEST ENGINE
// Tests each indicator on historical kline data
// ===================================================================
// [MOVED TO TOP] BT

// [MOVED TO TOP] BT_INDICATORS

export async function runBacktest() {
  const S = w.S;
  const BT = w.BT;
  const BT_INDICATORS = w.BT_INDICATORS;
  if (BT.running) return;
  if (!S.klines || S.klines.length < 60) { toast('No historical data. Wait for the chart to load.'); return; }

  BT.running = true;
  const runBtn = el('btRunBtn');
  if (runBtn) runBtn.className = 'bt-btn bt-btn-run running';
  { const _bp = el('btProgress'); if (_bp) _bp.style.display = 'block'; }
  { const _oe = el('btResults'); if (_oe) _oe.style.display = 'none'; }
  { const _oe = el('btEmpty'); if (_oe) _oe.style.display = 'none'; }

  const lookback = parseInt(el('btLookback')?.value || '') || 500;
  const fwdBars = parseInt(el('btFwdBars')?.value || '') || 5;
  const minMovePct = parseFloat(el('btMinMove')?.value || '') || 0.5;

  const bars = S.klines.slice(-lookback);
  const results: any = {};
  const equityCurve = [1000]; // start with $1000 virtual

  BT_INDICATORS.forEach((ind: any) => { results[ind.id] = { wins: 0, losses: 0, trades: [], pnls: [] }; });

  // --- PRE-COMPUTE INDICATORS ---
  const closes = bars.map((b: any) => b.close);
  const volumes = bars.map((b: any) => b.volume);
  const n = bars.length;

  // EMA
  const calcEMA = (data: any[], p: number) => { const k = 2 / (p + 1); let e = data[0]; return data.map((v: any) => { e = v * k + e * (1 - k); return e; }); };
  const ema50 = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, 200);

  // RSI per bar
  function calcRSIArr(prices: any[], p = 14) {
    const out = new Array(prices.length).fill(null);
    if (prices.length < p + 1) return out;
    let g = 0, l = 0;
    for (let i = 1; i <= p; i++) { const d = prices[i] - prices[i - 1]; if (d > 0) g += d; else l += Math.abs(d); }
    let ag = g / p, al = l / p;
    out[p] = al === 0 ? 100 : 100 - (100 / (1 + (ag / al)));
    for (let i = p + 1; i < prices.length; i++) {
      const d = prices[i] - prices[i - 1];
      if (d > 0) { ag = (ag * (p - 1) + d) / p; al = al * (p - 1) / p; }
      else { ag = ag * (p - 1) / p; al = (al * (p - 1) + Math.abs(d)) / p; }
      out[i] = al === 0 ? 100 : 100 - (100 / (1 + (ag / al)));
    }
    return out;
  }
  const rsiArr = calcRSIArr(closes);

  // MACD per bar
  const emaFast = calcEMA(closes, 12);
  const emaSlow = calcEMA(closes, 26);
  // [FIX v85 BUG6] Verificari de lungime inainte de slice/concat
  if (emaFast.length !== closes.length || emaSlow.length !== closes.length) {
    console.error('[Backtest] EMA length mismatch — abort MACD calc');
    return;
  }
  const macdLine = emaFast.map((v: any, i: number) => v - emaSlow[i]);
  // Necesitem cel putin 25+9=34 bare pentru signal MACD
  let macdFull: any[];
  if (macdLine.length < 34) {
    console.warn('[Backtest] Not enough data for MACD signal — filling with null');
    macdFull = new Array(macdLine.length).fill(null);
  } else {
    const macdSignal = calcEMA(macdLine.slice(25), 9);
    const signalPadded = new Array(25).fill(null).concat(macdSignal);
    // Asigura aceeasi lungime cu macdLine
    while (signalPadded.length < macdLine.length) signalPadded.push(null);
    macdFull = signalPadded;
  }

  // SuperTrend per bar
  // Pre-compute ATR array using Wilder's smoothing (correct historical ATR, NOT global S.atr)
  const ATR_PERIOD = 14;
  const COMMISSION_PCT = 0.04; // 0.04% per side, 0.08% round-trip
  function buildAtrArray(brs: any, period: number) {
    // Delegate to global _calcATRSeries — same Wilder implementation as live
    try {
      return _calcATRSeries(brs, period, 'wilder').series;
    } catch (e: any) {
      console.warn('[buildAtrArray] fallback null array:', e.message);
      return new Array(brs ? brs.length : 0).fill(null);
    }
  }
  const atrArr = buildAtrArray(bars, ATR_PERIOD);

  function calcSTArr(bs: any[], mult = 3) {
    const st = new Array(bs.length).fill(null);
    let prevUp = 0, prevDn = 0, prevTrend = 1;
    bs.forEach((b: any, i: number) => {
      // Use pre-computed Wilder ATR — never fall back to live S.atr in backtest
      const atr = atrArr[i] ?? (b.high - b.low);
      const hl2 = (b.high + b.low) / 2;
      const up = hl2 + mult * atr; const dn = hl2 - mult * atr;
      const finalUp = up < prevUp || closes[i - 1] > prevUp ? up : prevUp;
      const finalDn = dn > prevDn || closes[i - 1] < prevDn ? dn : prevDn;
      let trend = closes[i] > finalUp ? 1 : closes[i] < finalDn ? -1 : prevTrend;
      st[i] = trend; prevUp = finalUp; prevDn = finalDn; prevTrend = trend;
    });
    return st;
  }
  const stArr = calcSTArr(bars);

  // Volume average
  const volAvg = volumes.reduce((a: any, b: any) => a + b, 0) / volumes.length;

  // --- SCAN EACH BAR ---
  const totalSteps = n - fwdBars - 30;
  let equityConfluence = 1000;

  for (let i = 30; i < n - fwdBars; i++) {
    // Progress update every 50 bars
    if (i % 50 === 0) {
      const pct = Math.round((i - 30) / totalSteps * 100);
      { const _oe = el('btProgressPct'); if (_oe) _oe.textContent = String(pct); }
      { const _oe = el('btProgressFill'); if (_oe) _oe.style.width = pct + '%'; }
      await new Promise(r => setTimeout(r, 0)); // yield to UI
    }

    const price = closes[i];
    // Future return
    const futureClose = closes[i + fwdBars];
    const ret = (futureClose - price) / price * 100;

    // --- CHECK EACH INDICATOR SIGNAL ---
    const signals: any[] = [];

    // RSI Overbought -> SHORT expected (price should fall)
    if (rsiArr[i] !== null && rsiArr[i] > 70) {
      signals.push({ id: 'rsi_ob', dir: 'short', ret: -ret }); // short = negative return = good
    }
    // RSI Oversold -> LONG expected
    if (rsiArr[i] !== null && rsiArr[i] < 30) {
      signals.push({ id: 'rsi_os', dir: 'long', ret });
    }
    // MACD Bullish Cross
    if (macdFull[i] !== null && macdFull[i - 1] !== null) {
      if (macdLine[i] > macdFull[i] && macdLine[i - 1] <= macdFull[i - 1]) {
        signals.push({ id: 'macd_cross', dir: 'long', ret });
      }
      if (macdLine[i] < macdFull[i] && macdLine[i - 1] >= macdFull[i - 1]) {
        signals.push({ id: 'macd_under', dir: 'short', ret: -ret });
      }
    }
    // SuperTrend flip
    if (stArr[i] === 1 && stArr[i - 1] === -1) {
      signals.push({ id: 'st_bull', dir: 'long', ret });
    }
    if (stArr[i] === -1 && stArr[i - 1] === 1) {
      signals.push({ id: 'st_bear', dir: 'short', ret: -ret });
    }
    // EMA cross
    if (ema50[i] > ema200[i] && ema50[i - 1] <= ema200[i - 1]) {
      signals.push({ id: 'ema_cross', dir: 'long', ret });
    }
    // Volume spike -> follow price direction
    if (volumes[i] > volAvg * 2) {
      const barDir = closes[i] >= bars[i].open ? 'long' : 'short';
      signals.push({ id: 'vol_spike', dir: barDir, ret: barDir === 'long' ? ret : -ret });
    }
    // Confluence (simulate: RSI aligned + EMA aligned + STR)
    const rsiAligned = rsiArr[i] !== null && (rsiArr[i] > 55 || rsiArr[i] < 45);
    const emaAligned = ema50[i] > ema200[i];
    const stAligned = stArr[i] !== null;
    if (rsiAligned && emaAligned && stAligned) {
      const confDir = rsiArr[i] > 50 && ema50[i] > ema200[i] && stArr[i] === 1 ? 'long' : 'short';
      signals.push({ id: 'confluence_bull', dir: confDir, ret: confDir === 'long' ? ret : -ret });
      // Track equity curve for confluence
      if (Math.abs(ret) >= minMovePct) {
        const tradePnL = confDir === 'long' ? ret : -ret;
        equityConfluence *= (1 + tradePnL / 100);
        equityCurve.push(Math.round(equityConfluence));
      }
    }

    // --- RECORD RESULTS ---
    signals.forEach((sig: any) => {
      const r = results[sig.id]; if (!r) return;
      if (Math.abs(sig.ret) < minMovePct) return; // too small, skip
      // Apply round-trip commission: entry (0.04%) + exit (0.04%) = 0.08%
      const netRet = sig.ret - COMMISSION_PCT * 2;
      const win = netRet > 0;
      if (win) r.wins++; else r.losses++;
      r.pnls.push(netRet);
    });
  }

  BT.running = false;
  BT.results = results;
  BT.equityCurve = equityCurve;

  renderBacktestResults(results, equityCurve, fwdBars, lookback, minMovePct);
  { const _oe = el('btRunBtn'); if (_oe) _oe.className = 'bt-btn bt-btn-run'; }
  { const _bp = el('btProgress'); if (_bp) _bp.style.display = 'none'; }
  { const _oe = el('btResults'); if (_oe) _oe.style.display = 'block'; }
  { const _oe = el('btLastRun'); if (_oe) _oe.textContent = `${lookback} bare | +${fwdBars} | \u2265${minMovePct}% | ${fmtNow()}`; }
}

export function renderBacktestResults(results: any, equityCurve: any, _fwdBars: any, lookback: any, _minMovePct: any) {
  const BT_INDICATORS = w.BT_INDICATORS;
  const rows: any[] = [];
  let totalWins = 0, totalTrades = 0, bestWR = 0, bestName = '\u2014';
  let confWR = 0;

  BT_INDICATORS.forEach((ind: any) => {
    const r = results[ind.id];
    const tot = r.wins + r.losses;
    if (!tot) return;
    const wr = Math.round(r.wins / tot * 100);
    const avgWin = r.pnls.filter((p: any) => p > 0).reduce((a: any, b: any) => a + b, 0) / (r.pnls.filter((p: any) => p > 0).length || 1);
    const avgLoss = Math.abs(r.pnls.filter((p: any) => p < 0).reduce((a: any, b: any) => a + b, 0) / (r.pnls.filter((p: any) => p < 0).length || 1));
    const rr = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : '\u2014';
    const grade = wr >= 65 ? 'A' : wr >= 55 ? 'B' : wr >= 45 ? 'C' : 'D';
    totalWins += r.wins; totalTrades += tot;
    if (wr > bestWR) { bestWR = wr; bestName = ind.name; }
    if (ind.id === 'confluence_bull') confWR = wr;
    rows.push({ ind, wr, tot, rr, grade, avgWin: avgWin.toFixed(2), avgLoss: avgLoss.toFixed(2) });
  });

  rows.sort((a: any, b: any) => b.wr - a.wr);

  const avgWR = totalTrades ? Math.round(totalWins / totalTrades * 100) : 0;

  // Summary
  { const _oe = el('btBestInd'); if (_oe) _oe.textContent = bestName + ' (' + bestWR + '%)'; }
  { const _oe = el('btAvgWR'); if (_oe) _oe.textContent = avgWR + '%'; }
  { const _oe = el('btAvgWR'); if (_oe) _oe.style.color = avgWR >= 55 ? 'var(--grn)' : avgWR >= 45 ? 'var(--ylw)' : 'var(--red)'; }
  { const _oe = el('btTotalSig'); if (_oe) _oe.textContent = String(totalTrades); }
  { const _oe = el('btConfWR'); if (_oe) _oe.textContent = confWR ? confWR + '%' : '\u2014'; }
  { const _oe = el('btConfWR'); if (_oe) _oe.style.color = confWR >= 60 ? 'var(--grn)' : confWR >= 50 ? 'var(--ylw)' : 'var(--red)'; }

  // Table
  const grid = el('btResultGrid');
  if (grid) {
    grid.innerHTML = rows.map((row: any) => {
      const wrCls = row.wr >= 65 ? 'good' : row.wr >= 55 ? 'ok' : 'bad';
      const barColor = row.wr >= 65 ? 'var(--grn)' : row.wr >= 55 ? 'var(--ylw)' : 'var(--red)';
      return `<div class="bt-ind-row">
        <div class="bt-ind-name">
          <span style="color:${row.ind.color}">${row.ind.ico}</span>
          <span style="font-size:12px">${row.ind.name}</span>
        </div>
        <div>
          <div style="display:flex;align-items:center;gap:4px">
            <span class="bt-wr-val ${wrCls}">${row.wr}%</span>
            <span style="font-size:11px;color:var(--dim)">${row.ind.wins || 0}W/${row.ind.losses || 0}L</span>
          </div>
          <div class="bt-wr-bar"><div class="bt-wr-fill" style="width:${row.wr}%;background:${barColor}"></div></div>
        </div>
        <div class="bt-trades-num">${row.tot}</div>
        <div class="bt-rr-val" style="color:${row.rr >= 1.5 ? 'var(--grn)' : row.rr >= 1 ? 'var(--ylw)' : 'var(--red)'}">${row.rr}:1</div>
        <div style="text-align:center"><span class="bt-grade ${row.grade}">${row.grade}</span></div>
      </div>`;
    }).join('');
  }

  // Equity curve SVG
  const svgEl = el('btEquitySvg');
  if (svgEl && equityCurve.length > 2) {
    const pts = equityCurve;
    const minV = Math.min(...pts); const maxV = Math.max(...pts);
    const range = maxV - minV || 1;
    const cw = 400, h = 50;
    const pathPts = pts.map((v: any, i: number) => `${(i / (pts.length - 1)) * cw},${h - ((v - minV) / range * h * 0.85 + h * 0.07)}`).join(' ');
    const finalVal = pts[pts.length - 1];
    const finalColor = finalVal >= 1000 ? '#00d97a' : '#ff3355';
    svgEl.innerHTML = `
      <polyline points="${pathPts}" fill="none" stroke="${finalColor}" stroke-width="1.5" opacity="0.9"/>
      <text x="5" y="12" fill="#555" font-size="11" font-family="monospace">$${Math.round(minV)}</text>
      <text x="5" y="46" fill="#555" font-size="11" font-family="monospace">$${Math.round(maxV)}</text>
      <text x="370" y="12" fill="${finalColor}" font-size="12" font-family="monospace" text-anchor="end">$${Math.round(finalVal)}</text>
    `;
  }

  // Detail note update
  const bestRow = rows[0];
  const _detailNote = el('btDetailNote');
  if (bestRow && _detailNote) {
    _detailNote.innerHTML = `
      ${_ZI.ok} <strong style="color:${bestRow.ind.color}">${bestRow.ind.name}</strong> \u2014 cel mai bun indicator pe ultimele ${lookback} bare cu <strong style="color:var(--grn)">${bestRow.wr}% win rate</strong> (${bestRow.tot} semnale, R:R ${bestRow.rr}:1).<br>
      ${_ZI.lbulb} Confluence Score: <strong style="color:var(--pur)">${confWR}% win rate</strong> \u2014 combina toti indicatorii pentru precizie maxima.<br>
      ${_ZI.w} Backtestul e pe date istorice \u2014 performanta trecuta nu garanteaza rezultate viitoare.
    `;
  }
}

// ===================================================================
// END LIQUIDITY MAGNET + BACKTEST
// ===================================================================

// ===================================================================
// DYNAMIC SL BRAIN — TRAILING STOP ENGINE
// ===================================================================
// [MOVED TO TOP] DSL


// VWAP
// ===== VWAP + BANDS OVERLAY =====
// [MOVED TO TOP] vwapSeries
(function () {
  if (!w.S) return;
  w.S.vwapOn = false;
})();

export function calcVWAPBands(klines: any) {
  if (!klines || klines.length < 2) return null;
  // Daily VWAP - reset at session start (UTC midnight)
  const now = Date.now() / 1000;
  const dayStart = Math.floor(now / 86400) * 86400;
  const dayBars = klines.filter((k: any) => k.time >= dayStart);
  if (dayBars.length < 2) return null;
  let cumTPV = 0, cumV = 0;
  const vwapData: any[] = []; const upper1: any[] = []; const lower1: any[] = []; const upper2: any[] = []; const lower2: any[] = [];
  let cumVar = 0;
  const vcfg = (w as any).IND_SETTINGS?.vwap || {};
  const sd1 = vcfg.stdDev  > 0 ? vcfg.stdDev  : 1;
  const sd2 = vcfg.stdDev2 > 0 ? vcfg.stdDev2 : 2;
  dayBars.forEach((k: any, _i: number) => {
    const tp = (k.high + k.low + k.close) / 3;
    cumTPV += tp * k.volume; cumV += k.volume;
    const vwap = cumV > 0 ? cumTPV / cumV : tp;
    cumVar += k.volume * Math.pow(tp - vwap, 2);
    const std = cumV > 0 ? Math.sqrt(cumVar / cumV) : 0;
    vwapData.push({ time: k.time, value: vwap });
    upper1.push({ time: k.time, value: vwap + sd1 * std });
    lower1.push({ time: k.time, value: vwap - sd1 * std });
    upper2.push({ time: k.time, value: vwap + sd2 * std });
    lower2.push({ time: k.time, value: vwap - sd2 * std });
  });
  return { vwap: vwapData, upper1, lower1, upper2, lower2 };
}

export function renderVWAP() {
  const S = w.S;
  // Clear existing
  vwapSeries.forEach((s: any) => { try { w.mainChart.removeSeries(s); } catch (_) { } });
  vwapSeries = [];
  if (!S.vwapOn || !S.klines.length) return;
  const res = calcVWAPBands(S.klines);
  if (!res) return;
  try {
    const vw = w.mainChart.addLineSeries({ color: '#00d97a', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'VWAP' });
    vw.setData(res.vwap); vwapSeries.push(vw);
    const u1 = w.mainChart.addLineSeries({ color: '#00d97a66', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 2 });
    u1.setData(res.upper1); vwapSeries.push(u1);
    const l1 = w.mainChart.addLineSeries({ color: '#00d97a66', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 2 });
    l1.setData(res.lower1); vwapSeries.push(l1);
    const u2 = w.mainChart.addLineSeries({ color: '#00d97a33', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 3 });
    u2.setData(res.upper2); vwapSeries.push(u2);
    const l2 = w.mainChart.addLineSeries({ color: '#00d97a33', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 3 });
    l2.setData(res.lower2); vwapSeries.push(l2);
  } catch (_) { }
}

export function toggleVWAP(btn: any) {
  const S = w.S;
  S.vwapOn = !S.vwapOn;
  if (btn) btn.classList.toggle('on', S.vwapOn);
  if (S.vwapOn) renderVWAP();
  else { vwapSeries.forEach((s: any) => { try { w.mainChart.removeSeries(s); } catch (_) { } }); vwapSeries = []; }
  toast(S.vwapOn ? 'VWAP + Bands ON' : 'VWAP OFF');
}

// =================================================================
// OVI LIQUID — Liquidation Heatmap (Port from Pine Script)
// =================================================================
// [MOVED TO TOP] oviSeries
// [MOVED TO TOP] oviPriceSeries
(function () {
  if (!w.S) return;
  w.S.oviOn = false;
  w.S.oviCfg = {
    lookback: 400,
    pivotW: 1,
    secW: 1,
    atrLen: 121,
    atrBandPct: 1.0,      // % of ATR used as band height
    extend: 25,
    weightMode: 'Vol x Range',
    minWeight: 5,
    heatContrast: 0.7,
    longCol: '#01c4fe',
    shortCol: '#ffe400',
    touchTransp: 8,
    showScale: true,
    keepTouched: true
  };
})();

// -- Read settings from panel --

// OVI (Order Volume Imbalance)
export function oviReadSettings() {
  const S = w.S;
  const c = S.oviCfg;
  c.lookback = parseInt(el('oviLookback')?.value || '') || 400;
  c.pivotW = parseInt(el('oviPivotW')?.value || '') || 1;
  c.secW = parseInt(el('oviSecW')?.value || '') || 1;
  c.atrLen = parseInt(el('oviAtrLen')?.value || '') || 121;
  c.atrBandPct = parseFloat(el('oviAtrBand')?.value || '') || 1.0;
  c.extend = parseInt(el('oviExtend')?.value || '') || 25;
  c.minWeight = parseFloat(el('oviMinW')?.value || '') || 0;
  c.heatContrast = parseFloat(el('oviContrast')?.value || '') || 0.7;
  c.longCol = el('oviLongCol')?.value || '#01c4fe';
  c.shortCol = el('oviShortCol')?.value || '#ffe400';
  c.touchTransp = parseInt(el('oviTouchT')?.value || '') || 8;
  c.showScale = el('oviShowScale')?.checked !== false;
  c.keepTouched = el('oviKeepTouched')?.checked !== false;
  const wm = document.querySelector('input[name="oviWeightMode"]:checked') as any;
  c.weightMode = wm ? wm.value : 'Vol x Range';
}

export function oviApplySettings() {
  oviReadSettings();
  if (w.S.oviOn) renderOviLiquid();
}

// -- ATR calculation --
export function oviCalcATR(klines: any[], period: number) {
  if (klines.length < 2) return klines.map(() => 0);
  const tr = [Math.abs(klines[0].high - klines[0].low)];
  for (let i = 1; i < klines.length; i++) {
    const k = klines[i], p = klines[i - 1];
    tr.push(Math.max(
      k.high - k.low,
      Math.abs(k.high - p.close),
      Math.abs(k.low - p.close)
    ));
  }
  // Wilder's smoothed ATR (RMA)
  const atr = new Array(klines.length).fill(0);
  let sum = 0;
  for (let i = 0; i < Math.min(period, tr.length); i++) sum += tr[i];
  atr[Math.min(period - 1, klines.length - 1)] = sum / Math.min(period, tr.length);
  for (let i = period; i < klines.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  return atr;
}

// -- Pivot detection: pivotHigh / pivotLow --
// Returns array: null or the pivot value, at the pivot bar index
export function oviPivots(klines: any[], width: number, side: string) {
  // side: 'high' | 'low'
  const n = klines.length;
  const out = new Array(n).fill(null);
  for (let i = width; i < n - width; i++) {
    const val = side === 'high' ? klines[i].high : klines[i].low;
    let isPivot = true;
    for (let j = i - width; j <= i + width; j++) {
      if (j === i) continue;
      const cmp = side === 'high' ? klines[j].high : klines[j].low;
      if (side === 'high' && cmp >= val) { isPivot = false; break; }
      if (side === 'low' && cmp <= val) { isPivot = false; break; }
    }
    if (isPivot) out[i] = val;
  }
  return out;
}

// -- Weight metric --
export function oviWeightAt(k: any, mode: string) {
  const rangeMet = (k.high - k.low) * 100.0;
  const volMet = k.volume || rangeMet;
  switch (mode) {
    case 'Volume': return volMet;
    case 'Range': return rangeMet;
    default: return volMet * rangeMet; // Vol x Range
  }
}

// -- Color from weight --
export function oviColor(weight: any, side: any, vMin: any, vMax: any, contrast: any, longCol: any, shortCol: any, alpha: any) {
  const base = side === 1 ? longCol : shortCol;
  const rng = vMax - vMin || 1;
  let norm = (weight - vMin) / rng;
  norm = Math.max(0, Math.min(1, norm));
  const adj = Math.pow(norm, contrast);
  // Convert hex + alpha to rgba
  const c = base.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const a = alpha !== undefined ? alpha : (0.08 + adj * 0.85);
  return "rgba(" + r + "," + g + "," + b + "," + a.toFixed(2) + ")";
}
//  -- Build pockets from klines --
export function oviCalcPockets(klines: any[]) {
  const S = w.S;
  const c = S.oviCfg;
  const n = klines.length;
  if (n < c.atrLen + c.pivotW * 2 + 5) return [];

  const atr = oviCalcATR(klines, c.atrLen);

  // Weight stats for colour normalisation
  const weights = klines.map((k: any) => oviWeightAt(k, c.weightMode));
  const wArr = weights.filter((wt: any) => wt > 0);
  const vMax = wArr.length ? Math.max(...wArr) : 1;
  const vMin = wArr.length ? Math.min(...wArr) : 0;
  const vMinAdj = vMin === vMax ? vMin * 0.9 : vMin;

  const pockets: any[] = [];

  function addPocket(idx: number, side: number, price: number, weight: number) {
    if (weight < c.minWeight) return;
    const band = atr[idx] * (c.atrBandPct / 100.0);
    const top = side === -1 ? price + band : price;      // short liq: above pivot high
    const bot = side === -1 ? price : price - band; // long  liq: below pivot low
    pockets.push({
      idx,
      side,         // 1=long liq pocket (below swing low), -1=short liq pocket (above swing high)
      top,
      bot,
      weight,
      hit: false,
      hitIdx: -1,
      vMin: vMinAdj,
      vMax
    });
  }

  // Primary pivots
  const pivH = oviPivots(klines, c.pivotW, 'high');
  const pivL = oviPivots(klines, c.pivotW, 'low');
  for (let i = 0; i < n; i++) {
    if (pivH[i] !== null) addPocket(i, -1, pivH[i], weights[i]);
    if (pivL[i] !== null) addPocket(i, 1, pivL[i], weights[i]);
  }

  // Secondary pivots
  if (c.secW > 0 && c.secW !== c.pivotW) {
    const pivH2 = oviPivots(klines, c.secW, 'high');
    const pivL2 = oviPivots(klines, c.secW, 'low');
    for (let i = 0; i < n; i++) {
      if (pivH2[i] !== null) addPocket(i, -1, pivH2[i], weights[i]);
      if (pivL2[i] !== null) addPocket(i, 1, pivL2[i], weights[i]);
    }
  }

  // Mark which pockets have been hit by price
  pockets.forEach((p: any) => {
    const mid = (p.top + p.bot) / 2;
    for (let i = p.idx + 1; i < n; i++) {
      const k = klines[i];
      if (k.high >= mid && k.low <= mid) {
        p.hit = true;
        p.hitIdx = i;
        break;
      }
    }
  });

  // Filter pockets still within lookback
  return pockets.filter((p: any) => (n - 1 - p.idx) <= c.lookback);
}

// -- Render OVI LIQUID on chart --
export function renderOviLiquid() {
  const S = w.S;
  clearOviLiquid();
  if (!w.mainChart || !S.klines.length) return;

  const c = S.oviCfg;
  const kl = S.klines;
  const n = kl.length;

  // Auto-scale pivotW for higher timeframes to avoid too many false pivots
  const savedPivotW = c.pivotW;
  const tf = S.interval || '5m';
  if (tf === '1d' || tf === '3d' || tf === '1w' || tf === '1M') c.pivotW = Math.max(c.pivotW, 3);
  else if (tf === '4h' || tf === '6h' || tf === '8h' || tf === '12h') c.pivotW = Math.max(c.pivotW, 2);

  const pockets = oviCalcPockets(kl);
  c.pivotW = savedPivotW; // restore
  if (!pockets.length) return;

  // Sort by weight for scale reference
  const allW = pockets.map((p: any) => p.weight);
  const gMax = Math.max(...allW);
  const gMin = Math.min(...allW);

  pockets.forEach((p: any) => {
    const mid = (p.top + p.bot) / 2;
    const startI = Math.max(0, p.idx);

    // End index: hit pockets stop at hit bar; unhit extend forward
    let endI: number;
    if (p.hit && p.hitIdx >= 0) {
      endI = p.hitIdx;
    } else {
      endI = Math.min(n - 1, p.idx + c.extend);
    }

    if (endI <= startI) endI = Math.min(n - 1, startI + 1); // ensure at least 2 points

    // Build time arrays
    const slice = kl.slice(startI, endI + 1);
    if (slice.length < 2) return; // need at least 2 points to draw a line (not a vertical bar)

    // Normalise weight for colour
    const rng = gMax - gMin || 1;
    let norm = (p.weight - gMin) / rng;
    norm = Math.max(0, Math.min(1, norm));
    const adj = Math.pow(norm, c.heatContrast);

    const baseCol = p.side === 1 ? c.longCol : c.shortCol;
    const hexToRGB = (hex: string) => {
      const h = hex.replace('#', '');
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    };
    const [r, g, b] = hexToRGB(baseCol);

    // Alpha: unhit = full heat, touched = faded based on transparency setting
    const hitAlpha = (100 - c.touchTransp) / 100 * 0.4;
    const fillAlpha = p.hit ? hitAlpha : (0.05 + adj * 0.75);
    const lineAlpha = p.hit ? hitAlpha * 0.6 : (0.15 + adj * 0.5);

    const fillCol = "rgba(" + r + "," + g + "," + b + "," + fillAlpha.toFixed(2) + ")";
    const lineCol = "rgba(" + r + "," + g + "," + b + "," + lineAlpha.toFixed(2) + ")";

    // Line width based on weight (1-6px)
    const lineW = Math.max(1, Math.round(1 + adj * 5));

    try {
      // TOP border line
      const topS = w.mainChart.addLineSeries({
        color: lineCol,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      });
      topS.setData(slice.map((k: any) => ({ time: k.time, value: p.top })));
      w.oviSeries.push(topS);

      // BOTTOM border line
      const botS = w.mainChart.addLineSeries({
        color: lineCol,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      });
      botS.setData(slice.map((k: any) => ({ time: k.time, value: p.bot })));
      w.oviSeries.push(botS);

      // MID fill line (thick, creates visual fill between top/bot)
      // LightweightCharts doesn't support area between lines directly,
      // so we use a thick mid line. Thickness = proportional to pocket height in price.
      const midS = w.mainChart.addLineSeries({
        color: fillCol,
        lineWidth: lineW,
        priceLineVisible: false,
        lastValueVisible: !p.hit,  // Show label on last unhit pocket's mid
        crosshairMarkerVisible: false,
        title: !p.hit ? (p.side === 1 ? '\u2191' : '\u2193') + ' L' : ''
      });
      midS.setData(slice.map((k: any) => ({ time: k.time, value: mid })));
      w.oviSeries.push(midS);

    } catch (_) { }
  });

  // Scale display (simple price lines as reference)
  if (c.showScale) {
    oviRenderScale(gMin, gMax);
  }
}

// -- Scale: display min/max weight labels --
export function oviRenderScale(gMin: any, gMax: any) {
  const S = w.S;
  // FIX 14: showScale actually creates visible price-line legend on chart
  const fmtW = (wt: any) => wt >= 1e9 ? (wt / 1e9).toFixed(1) + 'B' : wt >= 1e6 ? (wt / 1e6).toFixed(1) + 'M' : wt >= 1e3 ? (wt / 1e3).toFixed(0) + 'K' : wt.toFixed(0);
  try {
    const kl = S.klines; if (!kl.length) return;
    const last = kl[kl.length - 1];

    const scaleS = w.mainChart.addLineSeries({
      color: 'rgba(240,192,64,0.01)',
      priceLineVisible: true,
      lastValueVisible: true,
      visible: true,
      priceLineColor: '#f0c04044',
      priceLineWidth: 1,
      title: `OVI: ${fmtW(gMin)}\u2013${fmtW(gMax)}`
    });
    scaleS.setData([{ time: last.time, value: last.close }]);
    scaleS.createPriceLine({ price: last.close, color: '#f0c04033', lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: `OVI max:${fmtW(gMax)}` });
    w.oviSeries.push(scaleS);
  } catch (_) { }
}

// -- Clear all OVI series --
export function clearOviLiquid() {
  w.oviSeries.forEach((s: any) => { try { w.mainChart.removeSeries(s); } catch (_) { } });
  w.oviSeries = [];
}

// -- Toggle OVI LIQUID on/off --
export function toggleOviLiquid(btn: any) {
  const S = w.S;
  S.oviOn = !S.oviOn;
  if (btn) {
    btn.classList.toggle('on', S.oviOn);
    btn.style.color = S.oviOn ? 'var(--gold)' : '#f0c04088';
    btn.style.background = S.oviOn ? '#f0c04015' : 'transparent';
    btn.style.borderColor = S.oviOn ? '#f0c04066' : '#f0c04033';
  }
  if (S.oviOn) {
    oviReadSettings();
    renderOviLiquid();
    toast('OVI LIQUID ON', 0, _ZI.drop);
  } else {
    clearOviLiquid();
    toast('OVI LIQUID OFF');
  }
}

// ===================================================================
// PnL LAB — Performance Analytics Panel
// ===================================================================

export function togglePnlLab() {
  var wrap = el('pnlLabWrap');
  if (!wrap) return;
  var open = wrap.classList.toggle('open');
  if (open) renderPnlLab();
}

export function renderPnlLab() {
  var body = el('pnlLabBody');
  if (!body) { console.warn('[PnL Lab] #pnlLabBody not found'); return; }

  try {
    // Gather data
    var dd = typeof getDrawdownStats === 'function' ? getDrawdownStats() : { peak: 0, currentDD: 0, maxDD: 0, cumPnl: 0, recoveryFactor: 0 };
    var last7 = typeof getLastNDays === 'function' ? getLastNDays(7) : [];
    var weekly = typeof getWeeklyRollup === 'function' ? getWeeklyRollup() : [];

    // Profile expectancies
    var profFast = calcExpectancyByProfile('fast');
    var profSwing = calcExpectancyByProfile('swing');
    var profDef = calcExpectancyByProfile('defensive');

    // [FIX BUG2] Check if we have ANY data at all
    var totalTrades = (profFast.trades || 0) + (profSwing.trades || 0) + (profDef.trades || 0);
    var hasAnyData = dd.cumPnl !== 0 || dd.peak !== 0 || last7.length > 0 || totalTrades > 0;

    var html = '';

    // Empty state banner when no trades at all
    if (!hasAnyData) {
      html += '<div class="pnl-lab-section" style="text-align:center;padding:16px 10px">';
      html += '<div style="font-size:28px;margin-bottom:6px">\ud83d\udcca</div>';
      html += '<div style="color:#00d9ff;font-size:13px;font-weight:700;margin-bottom:4px">PnL Lab \u2014 No Data Yet</div>';
      html += '<div style="color:#3a5068;font-size:11px;line-height:1.5">PnL Lab will populate automatically after you close the first trade.<br>Drawdown, Expectancy, Daily stats \u2014 everything appears here.</div>';
      html += '</div>';
      body.innerHTML = html;
      return;
    }

    // -- Row 1: Drawdown + Cumulative PnL --
    var ddPctStr = dd.peak > 0 ? (dd.currentDD / dd.peak * 100).toFixed(1) + '%' : '0%';
    var maxDDPctStr = dd.peak > 0 ? (dd.maxDD / dd.peak * 100).toFixed(1) + '%' : '0%';
    html += '<div class="pnl-lab-section">';
    html += '<div class="pnl-lab-title">\ud83d\udcca Drawdown & Equity</div>';
    html += '<div class="pnl-lab-grid">';
    html += _pnlLabCard('Cum. PnL', '$' + dd.cumPnl.toFixed(2), dd.cumPnl >= 0 ? 'grn' : 'red');
    html += _pnlLabCard('Peak', '$' + dd.peak.toFixed(2), 'dim');
    html += _pnlLabCard('Cur. DD', '$' + dd.currentDD.toFixed(2) + ' (' + ddPctStr + ')', dd.currentDD > 0 ? 'red' : 'dim');
    html += _pnlLabCard('Max DD', '$' + dd.maxDD.toFixed(2) + ' (' + maxDDPctStr + ')', 'red');
    html += _pnlLabCard('Recovery', dd.recoveryFactor.toFixed(2) + 'x', dd.recoveryFactor >= 1 ? 'grn' : 'dim');
    html += '</div></div>';

    // -- Row 2: Profile Expectancies --
    html += '<div class="pnl-lab-section">';
    html += '<div class="pnl-lab-title">\ud83c\udfaf Expectancy by Profile</div>';
    if (totalTrades === 0) {
      html += '<div class="pnl-lab-empty">No closed trades yet \u2014 expectancy requires trade history</div>';
    } else {
      html += '<div class="pnl-lab-grid">';
      html += _pnlLabProfileCard('FAST', profFast);
      html += _pnlLabProfileCard('SWING', profSwing);
      html += _pnlLabProfileCard('DEF', profDef);
      html += '</div>';
    }
    html += '</div>';

    // -- Row 3: Last 7 Days --
    html += '<div class="pnl-lab-section">';
    html += '<div class="pnl-lab-title">\ud83d\udcc5 Last 7 Days</div>';
    if (last7.length === 0) {
      html += '<div class="pnl-lab-empty">No daily data yet</div>';
    } else {
      html += '<div class="pnl-lab-table"><div class="pnl-lab-table-head">';
      html += '<span>Date</span><span>Trades</span><span>W/L</span><span>Gross</span><span>Fees</span><span>Net</span>';
      html += '</div>';
      last7.forEach(function (d: any) {
        var netCol = d.netPnl >= 0 ? 'grn' : 'red';
        html += '<div class="pnl-lab-table-row">';
        html += '<span>' + d.date.slice(5) + '</span>';
        html += '<span>' + d.trades + '</span>';
        html += '<span style="color:var(--grn)">' + d.wins + '</span>/<span style="color:var(--red)">' + d.losses + '</span>';
        html += '<span>$' + d.grossPnl.toFixed(2) + '</span>';
        html += '<span style="color:var(--dim)">-$' + d.fees.toFixed(2) + '</span>';
        html += '<span style="color:var(--' + netCol + ')">$' + d.netPnl.toFixed(2) + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    // -- Row 4: Weekly Rollup --
    if (weekly.length > 0) {
      html += '<div class="pnl-lab-section">';
      html += '<div class="pnl-lab-title">\ud83d\udcc6 Weekly Rollup</div>';
      html += '<div class="pnl-lab-grid">';
      weekly.forEach(function (wk: any, i: number) {
        var label = i === 0 ? 'This Week' : i + 'w ago';
        var col = wk.netPnl >= 0 ? 'grn' : 'red';
        html += '<div class="pnl-lab-card"><div class="pnl-lab-card-label">' + label + '</div>';
        html += '<div class="pnl-lab-card-val" style="color:var(--' + col + ')">$' + wk.netPnl.toFixed(2) + '</div>';
        html += '<div class="pnl-lab-card-sub">' + wk.trades + 't \u00b7 ' + wk.wins + 'W/' + wk.losses + 'L</div></div>';
      });
      html += '</div></div>';
    }

    body.innerHTML = html;
  } catch (err: any) {
    console.error('[PnL Lab] renderPnlLab error:', err);
    var _errMsg = escHtml(err.message || 'Unknown error');
    var _errStack = escHtml((err.stack || '').split('\n').slice(0, 3).join('\n'));
    body.innerHTML = '<div class="pnl-lab-section" style="text-align:center;padding:16px 10px">' +
      '<div style="color:#ff4466;font-size:12px;font-weight:700">PnL Lab Error</div>' +
      '<div style="color:#3a5068;font-size:11px;margin-top:4px">' + _errMsg + '</div>' +
      '<div style="color:#1e2d42;font-size:9px;margin-top:4px">' + _errStack.replace(/\n/g, '<br>') + '</div></div>';
  }
}

export function _pnlLabCard(label: string, value: string, colorKey: string) {
  return '<div class="pnl-lab-card"><div class="pnl-lab-card-label">' + label + '</div>' +
    '<div class="pnl-lab-card-val" style="color:var(--' + colorKey + ')">' + value + '</div></div>';
}

export function _pnlLabProfileCard(name: string, data: any) {
  var col = data.expectancy > 0 ? 'grn' : data.expectancy < 0 ? 'red' : 'dim';
  return '<div class="pnl-lab-card"><div class="pnl-lab-card-label">' + name + '</div>' +
    '<div class="pnl-lab-card-val" style="color:var(--' + col + ')">E: $' + data.expectancy.toFixed(2) + '</div>' +
    '<div class="pnl-lab-card-sub">' + data.trades + 't \u00b7 WR ' + data.wr + '%</div></div>';
}

// togglePnlLab, renderPnlLab — self-ref removed (direct calls)

// -- Long-press / right-click on OVI button -> open settings --
(function () {
  let _oviHold: any;
  const btn = () => el('oviBtn');
  const openSettings = () => { const p = el('oviPanel'); if (p) (p as HTMLElement).style.display = 'block'; };
  function _initOviBtn() {
    const b = btn();
    if (!b) return;
    b.addEventListener('contextmenu', (e: any) => { e.preventDefault(); openSettings(); });
    b.addEventListener('touchstart', () => { _oviHold = setTimeout(openSettings, 600); }, { passive: true });
    b.addEventListener('touchend', () => clearTimeout(_oviHold));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _initOviBtn)
  else setTimeout(_initOviBtn, 500);
})();

// -- Auto-refresh OVI when klines update --

// Session overlays
export const _origRenderChart_ovi = w.renderChart;

// ===================================================================
// END OVI LIQUID
// ===================================================================


// ===== SESSION OVERLAYS =====
(function () {
  if (!w.S) return;
  w.S.sessions = w.S.sessions || { asia: false, london: false, ny: false };
})();
const sessionSeries: any = {};

// Session hours UTC
const SESSIONS: any = {
  asia: { start: 0, end: 9, color: '#ffcc0022', borderColor: '#ffcc0044', label: 'ASIA' },
  london: { start: 8, end: 17, color: '#4488ff22', borderColor: '#4488ff44', label: 'LONDON' },
  ny: { start: 13, end: 22, color: '#ff664422', borderColor: '#ff664444', label: 'NY' }
};

export function toggleSession(sess: string, btn: any) {
  const S = w.S;
  S.sessions[sess] = !S.sessions[sess];
  if (btn) btn.classList.toggle('on', S.sessions[sess]);
  renderSessionOverlay(sess, S.sessions[sess]);
  toast(`${SESSIONS[sess].label} session ${S.sessions[sess] ? 'ON' : 'OFF'}`);
}

// [FIX v85 BUG10] Functie de curatare completa a tuturor seriilor de sesiune (apelata la schimb simbol)
export function clearAllSessionOverlays() {
  Object.keys(sessionSeries).forEach((sess: string) => {
    if (sessionSeries[sess] && sessionSeries[sess].length) {
      sessionSeries[sess].forEach((s: any) => {
        try { if (w.mainChart) w.mainChart.removeSeries(s); } catch (_) { }
      });
      sessionSeries[sess] = [];
    }
  });
}

export function renderSessionOverlay(sess: string, on: boolean) {
  const S = w.S;
  if (!w.mainChart) return; // [FIX v85 BUG10] Guard: chart poate sa nu existe
  // Remove existing
  if (sessionSeries[sess]) {
    sessionSeries[sess].forEach((s: any) => { try { w.mainChart.removeSeries(s); } catch (_) { } });
    sessionSeries[sess] = [];
  }
  if (!on || !S.klines.length) return;
  const cfg = SESSIONS[sess];
  const bars: any[] = [];
  S.klines.forEach((k: any) => {
    const d = new Date(k.time * 1000);
    const h = d.getUTCHours();
    const inSess = cfg.start < cfg.end ? (h >= cfg.start && h < cfg.end) : (h >= cfg.start || h < cfg.end);
    if (inSess) bars.push(k);
  });
  if (!bars.length) return;
  // Group into consecutive blocks
  const blocks: any[] = []; let cur: any = null;
  bars.forEach((b: any) => {
    if (!cur) { cur = { start: b.time, end: b.time }; return; }
    if (b.time - cur.end <= 600) cur.end = b.time;
    else { blocks.push({ ...cur }); cur = { start: b.time, end: b.time }; }
  });
  if (cur) blocks.push(cur);
  sessionSeries[sess] = [];
  // Draw thin line for session start
  blocks.forEach((bl: any) => {
    try {
      const startLine = w.mainChart.addLineSeries({ color: cfg.borderColor, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 1 });
      // Draw vertical-ish indicator at session boundaries
      const blBars = S.klines.filter((k: any) => k.time >= bl.start && k.time <= bl.end);
      if (blBars.length < 1) return;
      const maxP = Math.max(...blBars.map((k: any) => k.high));
      const minP = Math.min(...blBars.map((k: any) => k.low));
      startLine.setData(blBars.map((k: any) => ({ time: k.time, value: (maxP + minP) / 2 })));
      startLine.applyOptions({ title: cfg.label });
      sessionSeries[sess].push(startLine);
    } catch (_) { }
  });
}

// ===== CONFLUENCE SCORE =====
