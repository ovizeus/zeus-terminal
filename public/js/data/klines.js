// Zeus v122 — data/klines.js
// Kline data processing helpers
'use strict';

// ADX calculator
function calcADX(klines, period = 14) {
  // [v105 FIX Bug10] Wilder smoothing corect (DI+, DI-, ADX) — anterior era DX instantaneu fara smoothing
  // Necesita minim period*3 bare pentru a acumula suficient istoric de smoothing
  if (!klines || klines.length < period * 3 + 1) return null;
  const bars = klines.slice(-(period * 3 + 1));

  // ── Etapa 1: Prima perioadă — seed cu suma simpla (Wilder init) ──
  let sTR = 0, sDMp = 0, sDMm = 0;
  for (let i = 1; i <= period; i++) {
    const h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close;
    const ph = bars[i - 1].high, pl = bars[i - 1].low;
    sTR += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    sDMp += (h - ph > 0 && h - ph > pl - l) ? h - ph : 0;
    sDMm += (pl - l > 0 && pl - l > h - ph) ? pl - l : 0;
  }

  // ── Etapa 2: Smoothing Wilder pentru restul barelor, acumulam DX ──
  let smoothADX = 0, dxCount = 0;
  for (let i = period + 1; i < bars.length; i++) {
    const h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close;
    const ph = bars[i - 1].high, pl = bars[i - 1].low;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    const dp = (h - ph > 0 && h - ph > pl - l) ? h - ph : 0;
    const dm = (pl - l > 0 && pl - l > h - ph) ? pl - l : 0;

    // Wilder smoothing: S(n) = S(n-1) - S(n-1)/period + val(n)
    sTR = sTR - sTR / period + tr;
    sDMp = sDMp - sDMp / period + dp;
    sDMm = sDMm - sDMm / period + dm;

    if (sTR === 0) continue;
    const diP = (sDMp / sTR) * 100;
    const diM = (sDMm / sTR) * 100;
    const dxD = diP + diM;
    const dx = dxD === 0 ? 0 : Math.abs(diP - diM) / dxD * 100;

    // Wilder smoothing pentru ADX (media rulanta a DX)
    if (dxCount === 0) { smoothADX = dx; }
    else { smoothADX = (smoothADX * (period - 1) + dx) / period; }
    dxCount++;
  }
  if (dxCount === 0) return null;
  return Math.round(smoothADX);
}


// RSI from klines
function calcRSIFromKlines(klines, p = 14) {
  if (!klines || klines.length < p + 1) return null;
  const closes = klines.map(k => k.close);
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l += Math.abs(d); }
  let ag = g / p, al = l / p;
  for (let i = p + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) { ag = (ag * (p - 1) + d) / p; al = al * (p - 1) / p; }
    else { ag = ag * (p - 1) / p; al = (al * (p - 1) + Math.abs(d)) / p; }
  }
  return al === 0 ? 100 : parseFloat((100 - (100 / (1 + (ag / al)))).toFixed(1));
}

function detectMACDDir(klines) {
  if (!klines || klines.length < 30) return 'neut';
  const closes = klines.map(k => k.close);
  const calcEMA = (data, p) => { const k = 2 / (p + 1); let e = data[0]; return data.map(v => { e = v * k + e * (1 - k); return e; }); };
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macd = ema12.map((v, i) => v - ema26[i]);
  // [FIX QA-H11] Compute signal EMA on full MACD array (skip first 25 warmup bars), not truncated slice
  const signal = calcEMA(macd.slice(25), 9);
  const last = macd[macd.length - 1];
  const prev = macd[macd.length - 2];
  const sig = signal[signal.length - 1];
  const prevSig = signal[signal.length - 2];
  if (last > sig && prev <= prevSig) return 'bull';
  if (last < sig && prev >= prevSig) return 'bear';
  return last > sig ? 'bull' : 'bear';
}

function detectSTDir(klines, mult = 3) {
  if (!klines || klines.length < 20) return 'neut';
  const bars = klines.slice(-20);
  const closes = bars.map(b => b.close);
  const atrs = bars.slice(1).map((b, i) => Math.max(b.high - b.low, Math.abs(b.high - bars[i].close), Math.abs(b.low - bars[i].close)));
  const atr = atrs.reduce((a, b) => a + b, 0) / atrs.length;
  const last = bars[bars.length - 1];
  const hl2 = (last.high + last.low) / 2;
  const upper = hl2 + mult * atr;
  const lower = hl2 - mult * atr;
  // [FIX QA-C2] Stateful SuperTrend: track direction across bars
  let stUp = lower, stDn = upper, stDir = 1; // 1=bull, -1=bear
  for (let i = 1; i < bars.length; i++) {
    const prevClose = bars[i - 1].close;
    const h2 = (bars[i].high + bars[i].low) / 2;
    const trI = Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - prevClose), Math.abs(bars[i].low - prevClose));
    const curUp = h2 - mult * trI;
    const curDn = h2 + mult * trI;
    stUp = (curUp > stUp || prevClose < stUp) ? curUp : stUp;
    stDn = (curDn < stDn || prevClose > stDn) ? curDn : stDn;
    if (stDir === 1 && bars[i].close < stUp) stDir = -1;
    else if (stDir === -1 && bars[i].close > stDn) stDir = 1;
  }
  return stDir === 1 ? 'bull' : 'bear';
}

// ── WHY BLOCKED PILL — compact AT status indicator ───────────────
// Called by BlockReason.set/clear and from watchdog ticker

// Symbol score
function calcSymbolScore(sym, klines, rsi, macd, stDir, adx) {
  let score = 50;
  let signals = [];
  let dir = 'neut';
  let bullPts = 0, bearPts = 0;

  // RSI (weighted by PERF)
  const rsiWeight = PERF.rsi.wins + PERF.rsi.losses > 5
    ? (PERF.rsi.wins / (PERF.rsi.wins + PERF.rsi.losses)) * 1.5 : 1.0;
  if (rsi !== null) {
    if (rsi < 35) { bullPts += 20 * rsiWeight; signals.push('RSI OS'); }
    else if (rsi < 45) { bullPts += 10 * rsiWeight; }
    else if (rsi > 65) { bearPts += 20 * rsiWeight; signals.push('RSI OB'); }
    else if (rsi > 55) { bearPts += 10 * rsiWeight; }
  }

  // MACD (weighted by PERF)
  const macdWeight = PERF.macd.wins + PERF.macd.losses > 5
    ? (PERF.macd.wins / (PERF.macd.wins + PERF.macd.losses)) * 1.5 : 1.0;
  if (macd === 'bull') { bullPts += 20 * macdWeight; signals.push('MACD↑'); }
  else if (macd === 'bear') { bearPts += 20 * macdWeight; signals.push('MACD↓'); }

  // SuperTrend
  const stWeight = PERF.supertrend.wins + PERF.supertrend.losses > 5
    ? (PERF.supertrend.wins / (PERF.supertrend.wins + PERF.supertrend.losses)) * 1.5 : 1.0;
  if (stDir === 'bull') { bullPts += 25 * stWeight; signals.push('ST↑'); }
  else if (stDir === 'bear') { bearPts += 25 * stWeight; signals.push('ST↓'); }

  // ADX bonus (trend strength)
  const adxWeight = PERF.adx.wins + PERF.adx.losses > 5
    ? (PERF.adx.wins / (PERF.adx.wins + PERF.adx.losses)) * 1.5 : 1.0;
  if (adx !== null) {
    if (adx > 30) { bullPts += 10 * adxWeight; bearPts += 10 * adxWeight; signals.push('ADX' + adx); }
    else if (adx > 20) { bullPts += 5; bearPts += 5; }
  }

  const total = bullPts + bearPts || 1;
  if (bullPts > bearPts) {
    dir = 'bull';
    score = Math.min(98, Math.round(50 + bullPts / total * 50));
  } else if (bearPts > bullPts) {
    dir = 'bear';
    score = Math.min(98, Math.round(50 + bearPts / total * 50));
  } else {
    dir = 'neut';
    score = 50;
  }

  return { score, dir, signals: signals.join(' ') };
}

// ─── FETCH KLINES FOR A SYMBOL ────────────────────────────────
const _klineCache = {};
const _KLINE_CACHE_TTL = 50000; // 50s — shorter than 60s scan interval
async function fetchSymbolKlines(sym, tf = '5m', limit = 100) {
  try {
    const _cacheKey = sym + '_' + tf + '_' + limit;
    const _cached = _klineCache[_cacheKey];
    if (_cached && (Date.now() - _cached.ts) < _KLINE_CACHE_TTL) return _cached.data;
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(tf)}&limit=${encodeURIComponent(limit)}`;
    const _ac = new AbortController();
    const _t = setTimeout(() => _ac.abort(), 8000);
    let r;
    try { r = await fetch(url, { signal: _ac.signal }); }
    catch (fe) { clearTimeout(_t); return _cached ? _cached.data : null; }
    clearTimeout(_t);
    if (!r || !r.ok) return _cached ? _cached.data : null;
    const d = await r.json();
    const parsed = d.map(k => ({
      time: k[0] / 1000, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5]
    }));
    _klineCache[_cacheKey] = { ts: Date.now(), data: parsed };
    return parsed;
  } catch (e) { return null; }
}


// Multi-symbol scan functions
function _updateWhyBlocked(code, text) {
  const pill = document.getElementById('at-why-blocked');
  if (!pill) return;

  // Derive from current state if not passed
  if (code === undefined) {
    const br = BlockReason.get();
    code = br?.code || null;
    text = br?.text || null;
  }

  // Degraded feeds override — show even when not in BlockReason
  if (_isDegradedOnly() && !code) {
    const feeds = [..._SAFETY.degradedFeeds].join(',');
    pill.textContent = '⚠ DEGRADED: ' + feeds;
    pill.className = 'degraded';
    pill.style.display = 'block';
    return;
  }

  if (!code) {
    pill.style.display = 'none';
    pill.className = 'ok';
    return;
  }

  // Map code → pill class + compact label
  let cls = 'blocked';
  let label = '⛔ ' + (text || code);

  if (code === 'SAFETY_FAIL') {
    // Distinguish sub-reasons
    if (text && text.includes('session')) { cls = 'session'; label = '⏱ Session FAIL — outside hours'; }
    else if (text && text.includes('regime')) { cls = 'regime'; label = '⚠ Regime UNSTABLE'; }
    else if (text && text.includes('cooldown')) { cls = 'cooldown'; label = '⏳ Cooldown — wait...'; }
    else { cls = 'blocked'; label = '⛔ Safety: ' + (text || 'FAIL'); }
  } else if (code === 'DATA_STALL') {
    cls = 'degraded'; label = '⚠ Data stalled';
  } else if (code === 'KILL' || code === 'KILL_SWITCH') {
    cls = 'blocked'; label = '🔴 Kill switch activ';
  } else if (code === 'PROTECT' || code === 'PROTECT_MODE') {
    cls = 'blocked'; label = '🛡 Protect mode';
  } else if (code === 'TRIGGER_FAIL') {
    cls = 'regime'; label = '⚡ Trigger neatins';
  } else if (code === 'FAKEOUT') {
    cls = 'regime'; label = '🚫 Anti-fakeout';
  }

  // Cooldown: add live countdown if applicable
  if (cls === 'cooldown') {
    const cdMs = Math.max(0, _getCooldownMs() - (Date.now() - (AT.lastTradeTs || 0)));
    const cdMin = Math.ceil(cdMs / 60000);
    label = '⏳ Cooldown: ' + (cdMin > 0 ? cdMin + 'm' : 'clearing...');
  }

  pill.textContent = label;
  pill.className = cls;
  pill.style.display = 'block';
}

// ─── MAIN MULTI SYMBOL SCAN ───────────────────────────────────
async function runMultiSymbolScan() {
  // [PATCH A] Respect multi-symbol toggle — if OFF, skip entirely
  if (el('atMultiSym')?.checked === false) return;
  if (!FetchLock.try('multiScan')) return;
  if (MSCAN.scanning) { FetchLock.release('multiScan'); return; }
  MSCAN.scanning = true;
  const scanSyms = getActiveMscanSyms();
  try {
    const tbody = el('mscanBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:12px;color:#aa44ff;font-size:12px">⚡ SCANEZ ${scanSyms.length} SIMBOLURI...</td></tr>`;

    let opps = 0;
    const results = [];

    for (const sym of scanSyms) {
      try {
        // Get price from watchlist if available
        const wlPrice = S.symbol === sym ? S.price : (wlPrices[sym]?.price || null);
        const wlChg = wlPrices[sym]?.chg || 0;

        const klines = await fetchSymbolKlines(sym, '5m', 150);
        await new Promise(r => setTimeout(r, 120)); // rate limit

        const rsi = klines ? calcRSIFromKlines(klines) : null;
        const macd = klines ? detectMACDDir(klines) : 'neut';
        const st = klines ? detectSTDir(klines) : 'neut';
        const adx = klines ? calcADX(klines) : null;

        const { score, dir, signals } = calcSymbolScore(sym, klines, rsi, macd, st, adx);

        // [PATCH B1] AT_SCAN log per symbol in multi-symbol path
        if (typeof atLog === 'function') atLog('info', 'AT_SCAN ' + sym.replace('USDT', '') + ' score=' + score + ' dir=' + dir + (adx != null ? ' adx=' + adx : ''));

        const confMin = (typeof BM !== 'undefined' ? BM.confMin : 65) || 65; // [FIX v85.1 F2] sursă unică
        const isOpp = score >= confMin && (dir === 'bull' || dir === 'bear');
        if (isOpp) opps++;

        const alreadyOpen = (TP.demoPositions || []).some(p => p.sym === sym && p.autoTrade && !p.closed);

        results.push({ sym, price: wlPrice, chg: wlChg, rsi, macd, st, adx, score, dir, signals, isOpp, alreadyOpen });
        MSCAN.data[sym] = { price: wlPrice, chg: wlChg, rsi, macd, st, adx, score, dir, signals, isOpp, alreadyOpen };
      } catch (e) {
        results.push({ sym, price: null, chg: 0, rsi: null, macd: 'neut', st: 'neut', adx: null, score: 50, dir: 'neut', signals: 'ERR', isOpp: false, alreadyOpen: false });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    MSCAN.sortedResults = results;

    renderMscanTable(results, opps);
    MSCAN.lastScan = Date.now();

    // If auto trade is on, check each opp
    if (AT.enabled && !AT.killTriggered) {
      runMultiSymbolAutoTrade(results);
    }
  } catch (e) {
    console.error('[multiScan]', e);
  } finally {
    MSCAN.scanning = false;
    FetchLock.release('multiScan');
  }
}

function renderMscanTable(results, opps) {
  const tbody = el('mscanBody');
  const oppsEl = el('mscanOpps');
  const updEl = el('mscanUpdTime');
  if (oppsEl) oppsEl.textContent = opps + ' oportunit' + (opps === 1 ? 'ate' : 'ati');
  if (updEl) updEl.textContent = new Date().toLocaleTimeString('ro-RO', { timeZone: S.tz || 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (!tbody) return;

  const confMin = (typeof BM !== 'undefined' ? BM.confMin : 65) || 65; // [FIX v85.1 F2] sursă unică

  tbody.innerHTML = results.map(r => {
    const symBase = r.sym.replace('USDT', '');
    const priceStr = r.price ? '$' + fP(r.price) : '—';
    const chgCls = r.chg > 0 ? 'pos' : r.chg < 0 ? 'neg' : 'neu';
    const chgStr = r.chg ? (r.chg > 0 ? '+' : '') + r.chg.toFixed(2) + '%' : '—';
    const rsiCls = r.rsi ? r.rsi > 65 ? 'ob' : r.rsi < 35 ? 'os' : 'neu' : 'neu';
    const rsiStr = r.rsi ? r.rsi.toFixed(1) : '—';
    const macdCls = r.macd === 'bull' ? 'bull' : r.macd === 'bear' ? 'bear' : 'neu';
    const macdStr = r.macd === 'bull' ? '▲ BULL' : r.macd === 'bear' ? '▼ BEAR' : '—';
    const stCls = r.st === 'bull' ? 'bull' : r.st === 'bear' ? 'bear' : 'neu';
    const stStr = r.st === 'bull' ? '▲' : r.st === 'bear' ? '▼' : '—';
    const adxCls = r.adx > 20 ? 'strong' : 'weak';
    const adxStr = r.adx !== null ? r.adx : '—';
    const scoreCls = r.score >= confMin ? 'high' : r.score >= 50 ? 'mid' : 'low';

    let actionHtml = '';
    if (r.alreadyOpen) {
      actionHtml = `<div style="font-size:11px;color:#aa44ff">🔴 IN POZ</div>`;
    } else if (r.isOpp && r.dir === 'bull') {
      actionHtml = `<button class="mscan-enter-btn long" onclick="manualEnterFromScan('${r.sym}','LONG',${r.score})">▲ LONG</button>`;
    } else if (r.isOpp && r.dir === 'bear') {
      actionHtml = `<button class="mscan-enter-btn short" onclick="manualEnterFromScan('${r.sym}','SHORT',${r.score})">▼ SHORT</button>`;
    } else {
      actionHtml = `<span class="mscan-enter-btn dis">—</span>`;
    }

    const rowBg = r.isOpp ? (r.dir === 'bull' ? 'background:#00d97a06' : 'background:#ff446606') : '';

    return `<tr style="${rowBg}">
      <td><span class="mscan-sym" style="color:${r.isOpp ? r.dir === 'bull' ? '#00d97a' : '#ff4466' : 'var(--whi)'}">${symBase}</span></td>
      <td class="mscan-price">${priceStr}</td>
      <td class="mscan-chg ${chgCls}">${chgStr}</td>
      <td class="mscan-rsi ${rsiCls}">${rsiStr}</td>
      <td><span class="mscan-ind ${macdCls}">${macdStr}</span></td>
      <td><span class="mscan-ind ${stCls}">${stStr}</span></td>
      <td class="mscan-adx ${adxCls}">${adxStr}</td>
      <td><span class="mscan-score ${scoreCls}">${r.score}</span></td>
      <td class="mscan-signal" style="color:${r.isOpp ? r.dir === 'bull' ? '#00d97a' : '#ff4466' : 'var(--dim)'}" title="${r.signals}">${r.signals || '—'}</td>
      <td>${actionHtml}</td>
    </tr>`;
  }).join('');
}

// ─── MANUAL ENTRY FROM SCANNER ─────────────────────────────────
function manualEnterFromScan(sym, side, score) {
  const maxPos = parseInt(el('atMaxPos')?.value) || 4;
  const openAuto = (TP.demoPositions || []).filter(p => p.autoTrade && !p.closed).length;
  if (openAuto >= maxPos) { toast('Max pozitii atinse (' + maxPos + ')'); return; }

  const price = sym === S.symbol ? S.price : (wlPrices[sym]?.price || 0);
  if (!price) { toast('Nu am pretul pentru ' + sym); return; }

  const fakeEntry = { score, bullCount: 3, bearCount: 0, stDir: side === 'LONG' ? 'bull' : 'bear' };
  // FIX: pass sym+price as explicit params — no S mutation
  placeAutoTrade(side, fakeEntry, sym, price);

  setTimeout(() => runMultiSymbolScan(), 1000);
}

// ─── MULTI-SYMBOL AUTO TRADE ───────────────────────────────────
function _endMultiScan() { FetchLock.release('multiScan'); }
function runMultiSymbolAutoTrade(results) {
  if (!AT.enabled || AT.killTriggered) return;

  // ══ HARD RULES — read S.* only (canonical) ══════════════════════
  const _mode = (S.mode || 'assist').toLowerCase();
  const _prof = (S.profile || 'fast').toLowerCase();

  // MANUAL → never auto-execute
  if (_mode !== 'assist' && _mode !== 'auto') return;

  // ASSIST → only if ARM_ASSIST valid (user confirmed, <5min)
  if (_mode === 'assist') {
    if (!isArmAssistValid()) {
      atLog('info', '🔒 ASSIST — neînarmat. Apasă ARM ASSIST pentru confirmare.');
      return;
    }
  }

  // AUTO → HARD RULES all must pass
  if (_mode === 'auto') {
    // STATE: blocked / protect → hard stop (global safety — applies to all symbols)
    if (BM.protectMode) { BlockReason.set('PROTECT', BM.protectReason || 'Protect mode activ', 'autoCheck'); return; }
    if (AT.killTriggered) { BlockReason.set('KILL', 'Kill switch activ', 'autoCheck'); return; }

    // [P1-2 FIX] Removed current-symbol-only gates from multi-symbol path:
    // computeSafetyGates, BM.sweep, BM.flow, BM.entryScore, _fakeout all read
    // the currently-selected chart symbol's state. Per-symbol scoring from scan
    // results is applied below in the results filter (r.score, r.adx, etc.).
    // Only genuinely global safety checks remain here.

    // DSL active + chaos > prag → no new entries (global: any open DSL position)
    const _chaos = Math.round((BRAIN.regimeAtrPct || 0) * 15 + (BM.newsRisk === 'high' ? 40 : BM.newsRisk === 'med' ? 20 : 0));
    const _anyDSLActive = (TP.demoPositions || []).some(p => p.autoTrade && !p.closed && DSL.positions?.[p.id]?.active);
    if (_anyDSLActive && _chaos > 60) {
      BlockReason.set('CHAOS', `Chaos ${_chaos} > 60 — piață prea volatilă cu DSL activ`, 'autoCheck');
      atLog('warn', '⛔ AUTO BLOCK — DSL active + chaos>60'); return;
    }

    // DSL WAIT > 10min → raise threshold (protect-like behavior)
    const _dslWaitMs = 10 * 60 * 1000;
    const _dslWaiting = (TP.demoPositions || []).some(p => {
      const d = DSL.positions?.[p.id];
      return d && !d.active && p.autoTrade && !p.closed && (Date.now() - p.ts) > _dslWaitMs;
    });
    if (_dslWaiting) { atLog('warn', '⚠ AUTO — DSL WAIT>10min, threshold ridicat'); }
  }

  const maxPos = parseInt(el('atMaxPos')?.value) || 4;
  const openAuto = (TP.demoPositions || []).filter(p => p.autoTrade && !p.closed);
  if (openAuto.length >= maxPos) return;

  // Profile-aware thresholds (single source: S.profile)
  const profileThresh = { fast: [65, 55], swing: [72, 60], defensive: [80, 65] };
  const [confMin, confMinConfl] = profileThresh[S.profile || 'fast'] || [65, 55];
  // [Etapa 5] Adaptive entryMult: ajustează pragul local, nu BM.confMin global
  // Gated: BM.adaptive.enabled. confMinAdj = confMin / entryMult → WR bun = prag mai jos
  const _adaptEntryMult = (BM.adaptive && BM.adaptive.enabled) ? (BM.adaptive.entryMult || 1.0) : 1.0;
  const confMinAdj = Math.max(40, Math.min(95, confMin / _adaptEntryMult));
  const sigMin = parseInt(el('atSigMin')?.value) || 3;

  // Filter: hour/day OK?
  if (!isCurrentTimeOK()) {
    atLog('warn', '⏰ Ora curenta are WR scazut — nu intru (Day/Hour filter)');
    brainThink('bad', '⏰ Hour filter: WR scazut acum, astept ora mai buna');
    return;
  }

  // Get opportunities sorted by score (highest first)
  const opps = results.filter(r => {
    if (!r.isOpp || r.alreadyOpen) return false;
    // [Level 5] Macro-adjust score before confMin gate (gated: BM.adapt.enabled)
    const adjScore = (typeof macroAdjustEntryScore === 'function') ? macroAdjustEntryScore(r.dir, r.score) : r.score;
    r.scoreAdj = adjScore; // store for UI/debug
    if (adjScore < confMinAdj) return false;
    if (r.adx !== null && r.adx < 18) return false; // ADX filter
    const alreadyInDir = (TP.demoPositions || []).some(p =>
      p.sym === r.sym && p.autoTrade && !p.closed &&
      ((r.dir === 'bull' && p.side === 'SHORT') || (r.dir === 'bear' && p.side === 'LONG')));
    if (alreadyInDir) return false;
    return true;
  }).sort((a, b) => b.score - a.score);

  if (!opps.length) return;

  // Enter best opportunity(ies)
  const slots = maxPos - openAuto.length;
  const toEnter = opps.slice(0, slots);

  toEnter.forEach(opp => {
    const side = opp.dir === 'bull' ? 'LONG' : 'SHORT';
    // FIX: get real price for this symbol, never use S.price for other symbols
    const price = opp.sym === S.symbol ? S.price : (wlPrices[opp.sym]?.price || 0);
    if (!price) { atLog('warn', '❌ Nu am pret pentru ' + opp.sym); return; }

    atLog(side === 'LONG' ? 'buy' : 'sell',
      `🔭 MULTI-SYM: ${opp.sym.replace('USDT', '')} ${side} Score:${opp.score} ADX:${opp.adx || '—'} | ${opp.signals}`);
    brainThink('trade', `🔭 ${opp.sym.replace('USDT', '')} ${side} Score:${opp.score} — intru!`);
    // [FIX] Removed early triggerExecCinematic — banner now fires only AFTER
    // placeAutoTrade succeeds, via onTradeExecuted() → triggerExecCinematic()

    // FIX: pass sym+price explicitly — no S mutation
    placeAutoTrade(side, { score: opp.score, bullCount: opp.dir === 'bull' ? 3 : 0, bearCount: opp.dir === 'bear' ? 3 : 0, stDir: opp.dir }, opp.sym, price);
  });

  setTimeout(() => renderMscanTable(MSCAN.sortedResults || results, 0), 500);
}

function toggleMultiSymMode() {
  const on = el('atMultiSym')?.checked;
  _mscanUpdateLabel();
  if (on) atLog('info', '🔭 Multi-Symbol ACTIV — ' + _mscanGetActive().length + ' simboluri');
  else atLog('warn', '⚠️ Multi-Symbol DEZACTIVAT — doar symbol curent');
  _usScheduleSave();
}

/* ── Symbol Picker for MSCAN ── */
function _mscanGetActive() {
  try {
    var saved = localStorage.getItem('zeus_mscan_syms');
    if (saved) {
      var arr = JSON.parse(saved);
      if (Array.isArray(arr) && arr.length > 0) return arr;
    }
  } catch (_) { }
  return MSCAN_SYMS.slice();
}
function _mscanSaveActive(arr) {
  localStorage.setItem('zeus_mscan_syms', JSON.stringify(arr));
  _mscanUpdateLabel();
}
function _mscanUpdateLabel() {
  var lbl = el('atMultiSymLbl');
  if (!lbl) return;
  var on = el('atMultiSym')?.checked;
  if (!on) { lbl.textContent = 'DEZACTIVAT'; return; }
  var active = _mscanGetActive();
  lbl.textContent = 'ACTIV — ' + active.length + ' simboluri';
}
function getActiveMscanSyms() {
  var on = el('atMultiSym')?.checked;
  if (!on) return [typeof S !== 'undefined' ? S.symbol : 'BTCUSDT'];
  return _mscanGetActive();
}
function toggleSymPicker() {
  var drop = el('atSymPickerDrop');
  if (!drop) return;
  var vis = drop.style.display !== 'none';
  if (vis) { drop.style.display = 'none'; return; }
  var list = el('atSymPickerList');
  if (!list) return;
  var active = _mscanGetActive();
  var html = '';
  MSCAN_SYMS.forEach(function (sym) {
    var short = sym.replace('USDT', '');
    var checked = active.indexOf(sym) !== -1 ? 'checked' : '';
    html += '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:3px 4px;border-radius:3px;font-size:8px;color:#ccd" onmouseenter="this.style.background=\'#1a1030\'" onmouseleave="this.style.background=\'transparent\'">' +
      '<input type="checkbox" data-sym="' + sym + '" ' + checked + ' onchange="mscanToggleSym(this)" style="accent-color:#aa44ff">' +
      '<span style="font-weight:700;color:#fff;min-width:38px">' + short + '</span>' +
      '<span style="color:#556;font-size:6px">' + sym + '</span></label>';
  });
  list.innerHTML = html;
  drop.style.display = 'block';
}
function mscanToggleSym(cb) {
  var sym = cb.dataset.sym;
  var active = _mscanGetActive();
  if (cb.checked) {
    if (active.indexOf(sym) === -1) active.push(sym);
  } else {
    active = active.filter(function (s) { return s !== sym; });
  }
  _mscanSaveActive(active);
}
function mscanPickAll(selectAll) {
  var active = selectAll ? MSCAN_SYMS.slice() : [];
  _mscanSaveActive(active);
  var list = el('atSymPickerList');
  if (list) list.querySelectorAll('input[type="checkbox"]').forEach(function (cb) { cb.checked = selectAll; });
}
// Close picker on outside click
document.addEventListener('click', function (e) {
  var drop = document.getElementById('atSymPickerDrop');
  var card = document.getElementById('atSymPickerCard');
  if (drop && drop.style.display !== 'none' && !drop.contains(e.target) && !card.contains(e.target)) {
    drop.style.display = 'none';
  }
});

// ─── DAY / HOUR FILTER ────────────────────────────────────────
