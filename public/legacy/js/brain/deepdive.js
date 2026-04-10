// Zeus v122 — brain/deepdive.js
// PM (Pattern Matcher), ARES, ARES_MIND — deep analysis engines
'use strict';

// PM module
const PM = (function () {
  const KEY = 'zeus_postmortem_v1';
  const MAX_REC = 200;   // max înregistrări păstrate
  const DECAY_48 = 0.50;  // ponderea tranzacțiilor > 48h
  const DECAY_96 = 0.25;  // ponderea tranzacțiilor > 96h

  // ── Utilitar: citire/scriere sigură localStorage ─────────────────
  function _load() {
    try { const r = localStorage.getItem(KEY); return r ? JSON.parse(r) : []; }
    catch (_) { return []; }
  }
  function _save(records) {
    try { _safeLocalStorageSet(KEY, records.slice(0, MAX_REC)); }
    catch (_) { }
    if (typeof _ucMarkDirty === 'function') _ucMarkDirty('postmortem');
    if (typeof _userCtxPush === 'function') _userCtxPush();
  }

  // ── Calcul ATR simplu pe klines locale (nu modifica S.atr) ───────
  function _calcATR(klines, period) {
    period = period || 14;
    if (!klines || klines.length < period + 1) return null;
    let sum = 0;
    for (let i = klines.length - period; i < klines.length; i++) {
      const k = klines[i], prev = klines[i - 1];
      const tr = Math.max(
        k.high - k.low,
        Math.abs(k.high - prev.close),
        Math.abs(k.low - prev.close)
      );
      sum += tr;
    }
    return sum / period;
  }

  // ── Simulare contrafactuală: ce s-ar fi întâmplat cu SL mai larg ─
  function _simWiderSL(klines, entryIdx, side, entryPrice, slMultiplier, atr, tpPrice) {
    if (!atr || entryIdx < 0 || entryIdx >= klines.length) return null;
    const widerSL = side === 'LONG'
      ? entryPrice - atr * slMultiplier
      : entryPrice + atr * slMultiplier;
    let slHit = false, tpHit = false;
    for (let i = entryIdx + 1; i < Math.min(entryIdx + 60, klines.length); i++) {
      const k = klines[i];
      if (side === 'LONG') {
        if (k.low <= widerSL) { slHit = true; break; }
        if (tpPrice && k.high >= tpPrice) { tpHit = true; break; }
      } else {
        if (k.high >= widerSL) { slHit = true; break; }
        if (tpPrice && k.low <= tpPrice) { tpHit = true; break; }
      }
    }
    return { slHit, tpHit, widerSL: +widerSL.toFixed(4) };
  }

  // ── Simulare intrare întârziată cu N lumânări ─────────────────────
  function _simLateEntry(klines, entryIdx, side, originalSL, tpPrice, delay) {
    const lateIdx = entryIdx + delay;
    if (lateIdx >= klines.length) return null;
    const latePrice = klines[lateIdx].close;
    let slHit = false, tpHit = false;
    for (let i = lateIdx + 1; i < Math.min(lateIdx + 60, klines.length); i++) {
      const k = klines[i];
      if (side === 'LONG') {
        if (k.low <= originalSL) { slHit = true; break; }
        if (tpPrice && k.high >= tpPrice) { tpHit = true; break; }
      } else {
        if (k.high >= originalSL) { slHit = true; break; }
        if (tpPrice && k.low <= tpPrice) { tpHit = true; break; }
      }
    }
    const latePnlPct = side === 'LONG'
      ? ((tpHit ? tpPrice : originalSL) - latePrice) / latePrice * 100
      : (latePrice - (tpHit ? tpPrice : originalSL)) / latePrice * 100;
    return { slHit, tpHit, latePrice: +latePrice.toFixed(4), estPnlPct: +latePnlPct.toFixed(2) };
  }

  // ── Verifică dacă după SL hit prețul a revenit în direcție ───────
  function _checkRebound(klines, exitIdx, side, entryPrice, windowCandles) {
    windowCandles = windowCandles || 8;
    if (exitIdx < 0) return false;
    const end = Math.min(exitIdx + windowCandles, klines.length);
    for (let i = exitIdx + 1; i < end; i++) {
      if (side === 'LONG' && klines[i].close > entryPrice) return true;
      if (side === 'SHORT' && klines[i].close < entryPrice) return true;
    }
    return false;
  }

  // ── Funcție publică principală: apelată din closeDemoPos ─────────
  function run(pos, pnl, exitPrice) {
    try {
      const klines = S.klines;
      if (!klines || klines.length < 20) return; // date insuficiente

      const entryTime = Math.floor((pos.openTs || pos.id) / 1000);
      const entryIdx = klines.findIndex(k => k.time >= entryTime);
      if (entryIdx < 2) return; // nu avem context suficient

      const atr = _calcATR(klines);
      const slDist = pos.entry && pos.sl ? Math.abs(pos.entry - pos.sl) : null;
      const slAtrRatio = (atr && slDist) ? +(slDist / atr).toFixed(2) : null;
      const isLoss = pnl < 0;

      // Simulare SL mai larg (1.5x și 2x ATR)
      const sim15 = _simWiderSL(klines, entryIdx, pos.side, pos.entry, 1.5, atr, pos.tp);
      const sim20 = _simWiderSL(klines, entryIdx, pos.side, pos.entry, 2.0, atr, pos.tp);

      // Simulare intrare târzie (+1, +2, +3 lumânări)
      const lateEntry = [1, 2, 3].map(d =>
        _simLateEntry(klines, entryIdx, pos.side, pos.sl, pos.tp, d)
      );

      // Verificare rebound după loss
      const exitIdx = klines.findIndex(k => k.time >= Math.floor(Date.now() / 1000) - 60);
      const rebound = isLoss ? _checkRebound(klines, exitIdx < 0 ? klines.length - 1 : exitIdx, pos.side, pos.entry) : false;

      // Construim înregistrarea post-mortem
      const record = {
        ts: Date.now(),
        sym: pos.sym,
        side: pos.side,
        regime: BM.regime || '—',
        session: (typeof _detectSession === 'function' ? _detectSession() : '—'),
        profile: S.profile || 'fast',
        entry: pos.entry,
        exitPrice: +exitPrice,
        sl: pos.sl,
        tp: pos.tp,
        lev: pos.lev,
        pnl: +pnl.toFixed(2),
        isLoss,
        atr: atr ? +atr.toFixed(4) : null,
        slAtrRatio,
        // Scor de intrare la momentul tranzacției (dacă a fost logat)
        entryScore: BM.entryScore || null,
        // Simulări contrafactuale
        sim: {
          sl15x: sim15,
          sl20x: sim20,
          lateEntry1: lateEntry[0],
          lateEntry2: lateEntry[1],
          lateEntry3: lateEntry[2],
        },
        rebound,  // prețul a revenit în direcție după SL?
        // Insight pre-calculat pentru afișare rapidă
        insight: _buildInsight(pnl, slAtrRatio, sim15, sim20, lateEntry, rebound, atr),
      };

      // Salvăm în localStorage
      const records = _load();
      records.unshift(record);
      _save(records);

      // Actualizăm panoul vizual
      if (typeof PM_render === 'function') PM_render();

    } catch (e) {
      console.warn('[PostMortem] run() error:', e.message);
    }
  }

  // ── Construiește insight text concis pentru afișare ───────────────
  function _buildInsight(pnl, slAtrRatio, sim15, sim20, lateEntry, rebound, atr) {
    const parts = [];
    if (pnl < 0) {
      // SL prea strâns?
      if (slAtrRatio && slAtrRatio < 1.0)
        parts.push('SL sub 1×ATR — posibil prea strâns');
      if (sim15 && !sim15.slHit && sim15.tpHit)
        parts.push('SL 1.5×ATR ar fi prins TP');
      else if (sim20 && !sim20.slHit && sim20.tpHit)
        parts.push('SL 2×ATR ar fi prins TP');
      if (rebound)
        parts.push('Prețul a revenit în direcție după SL — probabil noise');
    }
    // Intrare prematură?
    const betterLate = lateEntry.find(l => l && l.tpHit && !l.slHit);
    if (betterLate)
      parts.push(`Intrare +${lateEntry.indexOf(betterLate) + 1} lumânări ar fi prins TP`);
    return parts.length ? parts.join(' · ') : (pnl >= 0 ? 'Execuție conformă' : '—');
  }

  // ── Statistici agregate cu decay temporal ────────────────────────
  function getStats() {
    const records = _load();
    if (!records.length) return null;
    const now = Date.now();
    let slTightCount = 0, lateEntryWouldHelp = 0, reboundCount = 0;
    let lossCount = 0, totalWeight = 0;
    let sumSlAtr = 0, countSlAtr = 0;

    records.forEach(r => {
      const ageH = (now - r.ts) / 3600000;
      const w = ageH > 96 ? DECAY_96 : ageH > 48 ? DECAY_48 : 1.0;
      totalWeight += w;
      if (r.isLoss) {
        lossCount += w;
        if (r.slAtrRatio && r.slAtrRatio < 1.0) slTightCount += w;
        if (r.rebound) reboundCount += w;
        const bl = r.sim && [r.sim.lateEntry1, r.sim.lateEntry2, r.sim.lateEntry3].find(l => l && l.tpHit && !l.slHit);
        if (bl) lateEntryWouldHelp += w;
      }
      if (r.slAtrRatio) { sumSlAtr += r.slAtrRatio; countSlAtr++; }
    });

    return {
      total: records.length,
      slTightPct: lossCount > 0 ? Math.round(slTightCount / lossCount * 100) : 0,
      reboundPct: lossCount > 0 ? Math.round(reboundCount / lossCount * 100) : 0,
      lateEntryHelpPct: lossCount > 0 ? Math.round(lateEntryWouldHelp / lossCount * 100) : 0,
      avgSlAtrRatio: countSlAtr > 0 ? +(sumSlAtr / countSlAtr).toFixed(2) : null,
      lastRecord: records[0] || null,
    };
  }

  return { run, getStats, load: _load };
})();

// Expunere globală pentru apel din closeDemoPos
function runPostMortem(pos, pnl, exitPrice) { PM.run(pos, pnl, exitPrice); }

// ── POST-MORTEM RENDER — panou vizual integrat în sr-strip ────────
function PM_render() {
  const container = document.getElementById('pm-panel-body');
  if (!container) return;
  const stats = PM.getStats();
  const records = PM.load();

  if (!stats || !records.length) {
    container.innerHTML = '<div style="padding:12px;text-align:center;font-size:12px;color:#445566;letter-spacing:1px">Nicio tranzacție analizată încă.</div>';
    return;
  }

  // ── Header statistici agregate ────────────────────────────────
  const last = stats.lastRecord;
  const regimeLbl = last ? last.regime : '—';
  const insightHtml = last
    ? `<div style="padding:5px 10px 3px;font-size:11px;color:#f0c04099;letter-spacing:.5px;border-bottom:1px solid #0a1520;line-height:1.7">
        <b style="color:#f0c040">LAST:</b> ${escHtml(last.insight)}
       </div>`
    : '';

  const statsHtml = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:3px;padding:6px 10px;border-bottom:1px solid #0a1520">
      <div style="text-align:center">
        <div style="font-size:10px;color:#445566;letter-spacing:1px;margin-bottom:2px">SL PREA STRÂNS</div>
        <div style="font-size:11px;font-weight:700;color:${stats.slTightPct > 50 ? '#ff4466' : '#00d97a'}">${stats.slTightPct}%</div>
        <div style="font-size:10px;color:#334455">din pierderi</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:10px;color:#445566;letter-spacing:1px;margin-bottom:2px">REBOUND DUPĂ SL</div>
        <div style="font-size:11px;font-weight:700;color:${stats.reboundPct > 40 ? '#ff4466' : '#778899'}">${stats.reboundPct}%</div>
        <div style="font-size:10px;color:#334455">pierderi evitabile</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:10px;color:#445566;letter-spacing:1px;margin-bottom:2px">ATR OPTIM</div>
        <div style="font-size:11px;font-weight:700;color:#00d9ff">${stats.avgSlAtrRatio ? stats.avgSlAtrRatio + '×' : '—'}</div>
        <div style="font-size:10px;color:#334455">raport SL/ATR mediu</div>
      </div>
    </div>
    ${insightHtml}`;

  // ── Listă ultimele 5 tranzacții analizate ─────────────────────
  const listHtml = records.slice(0, 5).map(r => {
    const pnlCol = r.pnl >= 0 ? '#00d97a' : '#ff4466';
    const sideCol = r.side === 'LONG' ? '#00ff88' : '#ff3355';
    return `<div style="padding:5px 10px;border-bottom:1px solid #06080e;font-size:11px;line-height:1.8">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
        <span style="color:${sideCol};font-weight:700">${escHtml(r.side)}</span>
        <span style="color:#778899">${escHtml(r.sym.replace('USDT', ''))}</span>
        <span style="color:#445566">${escHtml(r.regime)}</span>
        <span style="color:${pnlCol};font-weight:700">${r.pnl >= 0 ? '+' : ''}$${r.pnl.toFixed(2)}</span>
      </div>
      <div style="color:#556677;font-size:11px;line-height:1.6">${escHtml(r.insight)}</div>
    </div>`;
  }).join('');

  container.innerHTML = statsHtml + listHtml;
}

// ── CSS Post-Mortem Panel ─────────────────────────────────────────
(function _pmInjectCSS() {
  const s = document.createElement('style');
  s.textContent = `
  #pm-strip { background:transparent; border-bottom:none; margin:3px 6px; }
  #pm-strip-bar { display:flex;align-items:center;justify-content:space-between;padding:0;min-height:44px;cursor:pointer;user-select:none;gap:0;transition:border-color .25s,box-shadow .25s;background:none;border:none;border-radius:10px;opacity:1;position:relative;overflow:hidden; }
  #pm-strip-bar:hover { }
  #pm-strip-title { font-size:13px;font-weight:700;letter-spacing:2px;color:#f0c040;display:flex;align-items:center;gap:5px; }
  #pm-strip-stat { display:none; }
  #pm-strip-chev { font-size:8px;color:#f0c04044;transition:transform .25s;flex-shrink:0;opacity:.35; }
  #pm-strip-panel { max-height:0;overflow:hidden;transition:max-height .3s ease; }
  #pm-strip.open #pm-strip-panel { max-height:400px; }
  #pm-strip.open #pm-strip-chev { transform:rotate(180deg); }
  #pm-strip.open #pm-strip-bar { opacity:1; }
  #pm-strip.open #pm-strip-stat { display:inline; }
  #pm-panel-body { background:#010508;border-top:1px solid #f0c04015;border-radius:0 0 10px 10px;margin:2px 8px 0; }
  `;
  document.head.appendChild(s);
})();

// ── Inițializare panou Post-Mortem după boot ──────────────────────
function initPMPanel() {
  // Inserăm panoul imediat după sr-strip dacă nu există deja
  if (document.getElementById('pm-strip')) return;
  const srStrip = document.getElementById('sr-strip');
  if (!srStrip) return;

  const panel = document.createElement('div');
  panel.id = 'pm-strip';
  panel.innerHTML = `
    <div id="pm-strip-bar" onclick="this.closest('#pm-strip').classList.toggle('open');PM_render()">
      <div class="v6-accent"><div class="v6-ico"><svg viewBox="0 0 24 24"><circle cx="12" cy="10" r="6"/><line x1="12" y1="16" x2="12" y2="22"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="10" y1="8" x2="10" y2="12"/><line x1="14" y1="8" x2="14" y2="12"/></svg></div><span class="v6-lbl">POST<br>MORT</span></div>
      <div class="v6-content">
        <div id="pm-strip-title"><span>POST-MORTEM</span></div>
        <div style="display:flex;align-items:center;gap:8px">
          <span id="pm-strip-stat" style="font-size:11px;color:#f0c04066;letter-spacing:.5px"></span>
          <span id="pm-strip-chev">▼</span>
        </div>
      </div>
    </div>
    <div id="pm-strip-panel">
      <div id="pm-panel-body">
        <div style="padding:12px;text-align:center;font-size:12px;color:#445566;letter-spacing:1px">Nicio tranzacție analizată încă.</div>
      </div>
    </div>`;

  srStrip.insertAdjacentElement('afterend', panel);

  // Actualizează counter în header
  const stat = document.getElementById('pm-strip-stat');
  if (stat) {
    const records = PM.load();
    if (records.length) stat.textContent = records.length + ' analize';
  }
}

function _pmStripUpdateStat() {
  const stat = document.getElementById('pm-strip-stat');
  if (!stat) return;
  const st = PM.getStats();
  if (st) stat.textContent = st.total + ' analize · SL strâns: ' + st.slTightPct + '%';
}

function _pmCheckRegimeTransition() {
  try {
    const klines = S.klines;
    if (!klines || klines.length < 25) return;
    function _ema200slope(data) {
      const p = Math.min(200, data.length);
      const k2 = 2 / (p + 1); let e = data[0];
      const out = data.map(v => { e = v * k2 + e * (1 - k2); return e; });
      const last = out.length;
      return out[last - 1] - out[last - 8 < 0 ? 0 : last - 8];
    }
    const closes = klines.map(c => c.close);
    const slopeRecent = _ema200slope(closes);
    const slopePrevWindow = _ema200slope(closes.slice(0, closes.length - 8));
    const slopeFlatRatio = Math.abs(slopeRecent) / (Math.abs(slopePrevWindow) + 1e-9);

    const atrNow = S.atr || 0;
    const slice20 = klines.slice(-21);
    let atrSum = 0;
    for (let i = 1; i < slice20.length; i++) {
      const k = slice20[i], pr = slice20[i - 1];
      atrSum += Math.max(k.high - k.low, Math.abs(k.high - pr.close), Math.abs(k.low - pr.close));
    }
    const atrMean = atrSum / 20;
    const atrRatio = atrMean > 0 ? atrNow / atrMean : 1;

    const last5 = klines.slice(-5);
    const pUp = last5[4].close > last5[0].close;
    const vDown = last5[4].volume < last5[0].volume * 0.75;
    const divPts = (pUp && vDown) ? 30 : 0;
    const flatPts = Math.max(0, Math.min(50, (1 - Math.min(slopeFlatRatio, 2)) * 50));
    const atrPts = atrRatio < 0.7 ? 20 : (atrRatio > 1.8 ? 15 : 0);
    const score = Math.round(flatPts + atrPts + divPts);

    if (score >= 80) {
      if (typeof BlockReason !== 'undefined' && !BlockReason.get())
        BlockReason.set('REGIME_TRANSITION', `Tranziție regim iminentă (scor ${score}) — intrări blocate`);
    } else if (score >= 60) {
      if (typeof atLog === 'function') atLog('warn', `[RegimeWatch] Alertă tranziție regim — scor ${score}`);
    } else {
      if (typeof BlockReason !== 'undefined') {
        const br = BlockReason.get();
        if (br && br.code === 'REGIME_TRANSITION') BlockReason.clear();
      }
    }
  } catch (e) { console.warn('[RegimeWatch]', e.message); }
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  ARES 1.0 — Adaptive Reinforcement Engine for Strategic growth           ║
// ║  READ-ONLY — observă, calculează, verbalizează. Nu execută nimic.        ║
// ║  Contact cu sistemul existent: citire S, BM, AT, TP, PM — zero scrieri. ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// ARES module
const ARES = (function () {

  // ── Configurare țintă ────────────────────────────────────────────────────
  const TARGET = 1_000_000;
  const DAYS_MAX = 365;

  // ── Stări posibile ────────────────────────────────────────────────────────
  const STATES = {
    DETERMINED: { id: 'DETERMINED', color: '#00d9ff', glow: '#00d9ff', label: 'DETERMINED', emoji: _ZI.bolt },
    RESILIENT: { id: 'RESILIENT', color: '#00ff88', glow: '#00ff88', label: 'RESILIENT', emoji: _ZI.rfsh },
    FOCUSED: { id: 'FOCUSED', color: '#f0c040', glow: '#f0c040', label: 'FOCUSED', emoji: _ZI.tgt },
    STRATEGIC: { id: 'STRATEGIC', color: '#aa44ff', glow: '#aa44ff', label: 'STRATEGIC', emoji: _ZI.hex },
    MOMENTUM: { id: 'MOMENTUM', color: '#00ff44', glow: '#00ff44', label: 'MOMENTUM', emoji: _ZI.tup },
    FRUSTRATED: { id: 'FRUSTRATED', color: '#ff8800', glow: '#ff8800', label: 'FRUSTRATED', emoji: _ZI.w },
    DEFENSIVE: { id: 'DEFENSIVE', color: '#ff3355', glow: '#ff3355', label: 'DEFENSIVE', emoji: _ZI.sh },
    REVENGE_GUARD: { id: 'REVENGE_GUARD', color: '#ff0044', glow: '#ff0044', label: 'REVENGE GUARD', emoji: _ZI.noent },
  };

  // ══════════════════════════════════════════════════════════════════════
  // ARES WALLET — Mission Equity Tracker
  // ══════════════════════════════════════════════════════════════════════
  const ARES_LS_KEY = 'ARES_MISSION_STATE_V1';
  const ARES_WALLET = (function () {
    const FEE_MAKER = 0.0002;
    const FEE_TAKER = 0.00055;
    const WK = ARES_LS_KEY + '_vw2';
    let _w = { balance: 0, locked: 0, realizedPnL: 0, fundedTotal: 0, updatedTs: 0 };
    try {
      const stored = JSON.parse(localStorage.getItem(WK) || 'null');
      if (stored && Number.isFinite(stored.balance)) _w = Object.assign(_w, stored);
    } catch (_) { }

    // ── D) recalc() — single source of invariants, called after every mutation ──
    function recalc() {
      _w.balance = Math.max(0, _w.balance);
      _w.locked = Math.max(0, Math.min(_w.locked, _w.balance));
      // available is DERIVED — never stored independently
      _w.updatedTs = Date.now();
    }
    function _save() {
      recalc(); // always enforce before save
      try { localStorage.setItem(WK, JSON.stringify(_w)); } catch (_) { }
      if (typeof _ucMarkDirty === 'function') _ucMarkDirty('aresData');
      if (typeof _userCtxPush === 'function') _userCtxPush();
    }
    // run once on load to fix any stale state
    recalc();
    // [FIX A8] On reload: ARES_POSITIONS is memory-only (lost on reload),
    // but wallet persists with locked funds → release phantom locks.
    // This runs at ARES_WALLET init time (before ARES_POSITIONS is populated).
    if (_w.locked > 0) {
      _w.locked = 0;
      _save();
    }

    return {
      // ── Getters ────────────────────────────────────────────────
      get balance() { return _w.balance; },
      get available() { return Math.max(0, _w.balance - _w.locked); },
      get locked() { return _w.locked; },
      get realizedPnL() { return _w.realizedPnL; },
      get fundedTotal() { return _w.fundedTotal; },
      get updatedTs() { return _w.updatedTs; },
      // ── Core methods ───────────────────────────────────────────
      fund(amount) {
        const v = parseFloat(amount);
        if (!Number.isFinite(v) || v <= 0) return false;
        _w.balance += v;
        _w.fundedTotal += v;
        _save(); return true;
      },
      withdraw(amount, openPositionsCount) {
        // F) only when locked===0 and no open positions
        if (_w.locked > 0 || (openPositionsCount || 0) > 0) return false;
        const v = parseFloat(amount);
        if (!Number.isFinite(v) || v <= 0) return false;
        _w.balance = Math.max(0, _w.balance - v);
        _save(); return true;
      },
      canSpend(amount) {
        return Number.isFinite(amount) && (Math.max(0, _w.balance - _w.locked)) >= amount;
      },
      reserve(amount) {
        const v = parseFloat(amount);
        const avail = Math.max(0, _w.balance - _w.locked);
        if (!Number.isFinite(v) || v <= 0 || avail < v) return false;
        _w.locked += v;
        _save(); return true;
      },
      release(amount) {
        const v = parseFloat(amount);
        if (!Number.isFinite(v) || v <= 0) return false;
        _w.locked = Math.max(0, _w.locked - Math.min(v, _w.locked));
        _save(); return true;
      },
      applyPnL(pnlNet) {
        const v = parseFloat(pnlNet);
        if (!Number.isFinite(v)) return false;
        _w.balance += v;
        _w.realizedPnL += v;
        _save(); return true;
      },
      // ── Fees ──────────────────────────────────────────────────
      feesFor(notional, isMaker) { return notional * (isMaker ? FEE_MAKER : FEE_TAKER); },
      roundTripFees(notional) { return notional * FEE_TAKER * 2; },
      // ── Legacy shims ─────────────────────────────────────────
      get equity() { return _w.balance; },
      // [FIX A9] Renamed from 'isLive' to 'isActive' — this only means wallet was updated
      // recently, NOT that it's connected to a live exchange. Kept 'isLive' as alias for compat.
      get isActive() { return _w.updatedTs > 0 && (Date.now() - _w.updatedTs) < 300000; },
      get isLive() { return this.isActive; },
    };
  })();

  // ══════════════════════════════════════════════════════════════════════
  // ARES POSITIONS — Autonomous BTC Positions Registry
  // ══════════════════════════════════════════════════════════════════════
  const ARES_POSITIONS = (function () {
    const POS_LS_KEY = 'ARES_POSITIONS_V1';
    let _positions = [];
    let _posIdCtr = 1;
    let _closingAll = false; // [FIX F2] reentrancy guard for closeAll

    // [P0.2] Load persisted positions (survives reload)
    try {
      const stored = JSON.parse(localStorage.getItem(POS_LS_KEY) || 'null');
      if (Array.isArray(stored) && stored.length > 0) {
        _positions = stored;
        _posIdCtr = _positions.reduce((m, p) => {
          const n = parseInt(String(p.id).replace('ARES_POS_', ''), 10);
          return (n >= m) ? n + 1 : m;
        }, _posIdCtr);
      }
    } catch (_) { }
    function _savePositions() {
      try { localStorage.setItem(POS_LS_KEY, JSON.stringify(_positions)); } catch (_) { }
      if (typeof _ucMarkDirty === 'function') _ucMarkDirty('aresData');
      if (typeof _userCtxPush === 'function') _userCtxPush();
    }

    function _makeClientId() {
      return 'ARES_' + Date.now() + '_' + Math.floor(Math.random() * 9999);
    }

    function calcUPnL(pos, markPrice) {
      if (!pos || !markPrice) return 0;
      const direction = pos.side === 'LONG' ? 1 : -1;
      const priceDiff = (markPrice - pos.entryPrice) * direction;
      return (priceDiff / pos.entryPrice) * pos.notional;
    }

    function calcLiqPrice(pos) {
      // Simplified liq price for isolated margin
      const marginRatio = 1 / pos.leverage;
      if (pos.side === 'LONG') return pos.entryPrice * (1 - marginRatio + 0.005);
      return pos.entryPrice * (1 + marginRatio - 0.005);
    }

    function open(params) {
      // params: { side, leverage, notional, entryPrice, confidence, policy, reason, stakeVirtual }
      const id = 'ARES_POS_' + (_posIdCtr++);
      const clientOrderId = _makeClientId();
      const fees = ARES_WALLET.roundTripFees(params.notional);
      const pos = {
        id,
        clientOrderId,
        symbol: 'BTCUSDT',
        owner: 'ARES',
        meta: {
          owner: 'ARES',
          missionId: 'ARES_V1',
          createdTs: Date.now(),
          policy: params.policy || 'BALANCED',
          reason: params.reason || 'signal',
        },
        side: params.side,
        leverage: params.leverage,
        marginMode: 'ISOLATED',
        notional: params.notional,
        stakeVirtual: params.stakeVirtual || 0, // [FIX F3] part of schema, not bolted on
        entryPrice: params.entryPrice,
        liqPrice: 0,
        markPrice: params.entryPrice,
        uPnL: 0,
        uPnLPct: 0,
        feesEstimate: fees,
        targetNetPnL: params.targetNetPnL || 10,
        openTs: Date.now(),
        confidence: params.confidence || 50,
        status: 'OPEN',
      };
      pos.liqPrice = calcLiqPrice(pos);
      _positions.push(pos);
      _savePositions(); // [P0.2] persist
      return pos;
    }

    function updatePrices(markPrice) {
      if (!markPrice || !Number.isFinite(markPrice)) return;
      let totalUPnL = 0;
      _positions.filter(p => p.status === 'OPEN').forEach(pos => {
        pos.markPrice = markPrice;
        pos.uPnL = calcUPnL(pos, markPrice);
        pos.uPnLPct = (pos.uPnL / pos.notional) * 100;
        totalUPnL += pos.uPnL;
      });
      // totalUPnL available for display if needed
    }

    function closePosition(posId) {
      const pos = _positions.find(p => p.id === posId && p.status === 'OPEN');
      if (!pos) return null;
      pos.status = 'CLOSED';
      pos.closeTs = Date.now();
      // If netPnl was pre-computed by ARES_MONITOR (live close), use that.
      // Otherwise fall back to uPnL-based estimate (virtual close).
      const netPnL = (pos.netPnl !== undefined && pos.netPnl !== null)
        ? pos.netPnl
        : (pos.uPnL - pos.feesEstimate);
      // Wallet: release margin stake, then apply net PnL
      const stakeVirtual = pos.stakeVirtual || 0; // [FIX F3] read from schema, not _stakeVirtual
      if (stakeVirtual > 0) ARES_WALLET.release(stakeVirtual);
      ARES_WALLET.applyPnL(netPnL);
      _savePositions(); // [P0.2] persist
      return { posId, netPnL, feesEstimate: pos.feesEstimate };
    }

    function closeAll() {
      // [FIX F2] Synchronous deterministic close — no staggered setTimeout race
      if (_closingAll) return 0; // reentrancy guard
      _closingAll = true;
      const open = _positions.filter(p => p.status === 'OPEN');
      const results = [];
      open.forEach(pos => {
        const r = closePosition(pos.id);
        if (r) results.push(r);
      });
      _closingAll = false;
      return results.length;
    }

    function getOpen() { return _positions.filter(p => p.status === 'OPEN'); }
    function getAll() { return _positions; }
    function getClosed() { return _positions.filter(p => p.status === 'CLOSED'); }
    function save() { _savePositions(); }
    // [P0.2] Update a position field and persist
    function updatePos(posId, fields) {
      const pos = _positions.find(p => p.id === posId);
      if (!pos) return null;
      Object.assign(pos, fields);
      _savePositions();
      return pos;
    }

    return { open, updatePrices, closePosition, closeAll, getOpen, getAll, getClosed, save, updatePos };
  })();

  // ── State intern ARES ─────────────────────────────────────────────────────
  const STATE_LS_KEY = 'ARES_STATE_V1';
  let _state = {
    current: STATES.DETERMINED,
    confidence: 72,
    trajectoryDelta: 0,
    startBalance: null,
    startTs: null,
    daysPassed: 0,
    targetBalance: 0,   // expected balance today
    nodes: {
      trajectory: { label: 'TRAJECTORY', value: '—', active: false, score: 0 },
      regime: { label: 'REGIME', value: '—', active: false, score: 0 },
      signal: { label: 'SIGNAL', value: '—', active: false, score: 0 },
      memory: { label: 'MEMORY', value: '—', active: false, score: 0 },
      volatility: { label: 'VOLATILITY', value: '—', active: false, score: 0 },
      session: { label: 'SESSION', value: '—', active: false, score: 0 },
    },
    thoughtLines: [],
    lastLesson: '—',
    tradeHistory: [],   // últimas 10 tranzacții [true=win, false=loss]
    consecutiveLoss: 0,
    consecutiveWin: 0,
    lastLossTs: 0,
    winRate10: 0,
    lastUpdateTs: 0,
    totalAresTrades: 0,
    totalAresWins: 0,
    totalAresLosses: 0,
  };
  // [P0.2] Restore persisted learning state
  try {
    const _saved = JSON.parse(localStorage.getItem(STATE_LS_KEY) || 'null');
    if (_saved) {
      _state.tradeHistory = Array.isArray(_saved.tradeHistory) ? _saved.tradeHistory : [];
      _state.consecutiveLoss = _saved.consecutiveLoss || 0;
      _state.consecutiveWin = _saved.consecutiveWin || 0;
      _state.lastLossTs = _saved.lastLossTs || 0;
      _state.totalAresTrades = _saved.totalAresTrades || 0;
      _state.totalAresWins = _saved.totalAresWins || 0;
      _state.totalAresLosses = _saved.totalAresLosses || 0;
    }
  } catch (_) { }
  function _saveState() {
    try {
      localStorage.setItem(STATE_LS_KEY, JSON.stringify({
        tradeHistory: _state.tradeHistory,
        consecutiveLoss: _state.consecutiveLoss,
        consecutiveWin: _state.consecutiveWin,
        lastLossTs: _state.lastLossTs,
        totalAresTrades: _state.totalAresTrades,
        totalAresWins: _state.totalAresWins,
        totalAresLosses: _state.totalAresLosses,
      }));
    } catch (_) { }
    if (typeof _ucMarkDirty === 'function') _ucMarkDirty('aresData');
    if (typeof _userCtxPush === 'function') _userCtxPush();
  }

  // ── Utilities ─────────────────────────────────────────────────────────────
  function _balance() {
    // [P0.2] ARES wallet is the ONLY source of truth. No TP fallback.
    // If ARES is not funded, balance is 0. Period.
    try { return ARES_WALLET.balance || 0; } catch (_) { return 0; }
  }
  function _regime() {
    // [P0.4 FIX] BM.regime was never assigned — BRAIN.regime is the real source (set in brain.js)
    try { return (typeof BRAIN !== 'undefined' && BRAIN.regime) ? BRAIN.regime : '—'; }
    catch (_) { return '—'; }
  }
  function _atr() {
    try { return (typeof S !== 'undefined' && S.atr) ? S.atr : 0; }
    catch (_) { return 0; }
  }
  function _entryScore() {
    try { return (BM && BM.entryScore) ? BM.entryScore : 0; }
    catch (_) { return 0; }
  }
  function _session() {
    const h = new Date().getUTCHours();
    if (h >= 1 && h < 8) return 'ASIA';
    if (h >= 7 && h < 12) return 'LONDON';
    if (h >= 13 && h < 21) return 'NEW YORK';
    return 'OFF-HOURS';
  }
  function _push(line) {
    _state.thoughtLines.unshift(line);
    if (_state.thoughtLines.length > 28) _state.thoughtLines = _state.thoughtLines.slice(0, 28);
  }

  // ── Calcul traiectorie ────────────────────────────────────────────────────
  function _calcTrajectory(balance) {
    const KEY_INIT = 'ares_init_v1';
    let init;
    try { init = JSON.parse(localStorage.getItem(KEY_INIT) || 'null'); } catch (_) { init = null; }
    if (!init || !init.balance || !init.ts) {
      init = { balance: balance || 1000, ts: Date.now() };
      try { localStorage.setItem(KEY_INIT, JSON.stringify(init)); } catch (_) { }
    }
    _state.startBalance = init.balance;
    _state.startTs = init.ts;
    const daysPassed = Math.max(1, (Date.now() - init.ts) / 86400000);
    _state.daysPassed = +daysPassed.toFixed(1);
    const daysLeft = Math.max(1, DAYS_MAX - daysPassed);
    // Rată zilnică necesară: (TARGET/startBalance)^(1/daysLeft) - 1
    const dailyRate = Math.pow(TARGET / init.balance, 1 / DAYS_MAX) - 1;
    const expectedNow = init.balance * Math.pow(1 + dailyRate, daysPassed);
    _state.targetBalance = expectedNow;
    const delta = balance > 0 ? ((balance - expectedNow) / expectedNow * 100) : 0;
    _state.trajectoryDelta = +delta.toFixed(2);
    return { dailyRate: +(dailyRate * 100).toFixed(3), expectedNow: +expectedNow.toFixed(2), delta, daysLeft: +daysLeft.toFixed(0) };
  }

  // ── Determinare stare ─────────────────────────────────────────────────────
  function _computeState(traj, balance) {
    const { delta } = traj;
    const cl = _state.consecutiveLoss;
    const cw = _state.consecutiveWin;
    const wr = _state.winRate10;
    const timeSinceLoss = Date.now() - _state.lastLossTs;

    if (cl >= 3 && timeSinceLoss < 300000) return STATES.REVENGE_GUARD;
    if (cl >= 4 || delta < -15 || (AT && AT.killTriggered)) return STATES.DEFENSIVE;
    if (cl >= 3 || delta < -8) return STATES.FRUSTRATED;
    if (cw >= 3 && wr >= 65) return STATES.MOMENTUM;
    if (delta > 5 && wr >= 55) return STATES.STRATEGIC;
    if (wr < 50 || delta < -3) return STATES.FOCUSED;
    if (cl >= 1 && cl <= 2) return STATES.RESILIENT;
    return STATES.DETERMINED;
  }

  // ── Calcul confidence score ────────────────────────────────────────────────
  function _computeConfidence(traj) {
    let score = 50;
    const regime = _regime();
    const es = _entryScore();
    const atr = _atr();

    // Regime quality
    if (regime === 'STRONG BULL' || regime === 'STRONG BEAR') score += 15;
    else if (regime === 'BULL' || regime === 'BEAR') score += 8;
    else if (regime === 'RANGE') score -= 10;

    // Entry score
    if (es >= 80) score += 12;
    else if (es >= 65) score += 5;
    else if (es < 45) score -= 12;

    // Trajectory
    if (traj.delta > 5) score += 8;
    else if (traj.delta > 0) score += 3;
    else if (traj.delta < -10) score -= 15;
    else if (traj.delta < -3) score -= 7;

    // Win rate
    score += Math.round((_state.winRate10 - 50) * 0.3);

    // ATR relative (se calculează intern)
    const atrNode = _state.nodes.volatility;
    if (atrNode.score > 0) score += 5;
    else if (atrNode.score < 0) score -= 5;

    return Math.min(99, Math.max(1, score));
  }

  // ── Update noduri ─────────────────────────────────────────────────────────
  function _updateNodes(traj, balance) {
    const regime = _regime();
    const es = _entryScore();
    const session = _session();
    const pmStats = (typeof PM !== 'undefined') ? PM.getStats() : null;

    // TRAJECTORY node
    const n_traj = _state.nodes.trajectory;
    n_traj.value = (traj.delta >= 0 ? '+' : '') + traj.delta + '%';
    n_traj.score = traj.delta;
    n_traj.active = Math.abs(traj.delta) > 1;

    // REGIME node
    const n_reg = _state.nodes.regime;
    n_reg.value = regime;
    n_reg.score = (regime.includes('STRONG')) ? 2 : (regime === 'RANGE') ? -1 : 1;
    n_reg.active = regime !== '—';

    // SIGNAL node
    const n_sig = _state.nodes.signal;
    n_sig.value = es ? es + ' pts' : '—';
    n_sig.score = es >= 70 ? 1 : es < 50 ? -1 : 0;
    n_sig.active = es > 0;

    // MEMORY node
    const n_mem = _state.nodes.memory;
    if (pmStats) {
      n_mem.value = pmStats.slTightPct + '% SL tight';
      n_mem.score = pmStats.slTightPct > 60 ? -1 : 0;
      n_mem.active = pmStats.total > 0;
    } else {
      n_mem.value = 'learning...'; n_mem.score = 0; n_mem.active = false;
    }

    // VOLATILITY node
    const n_vol = _state.nodes.volatility;
    const atr = _atr();
    if (atr > 0 && S.klines && S.klines.length > 20) {
      const recent = S.klines.slice(-20).map(k => k.high - k.low);
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      const ratio = atr / mean;
      n_vol.value = ratio > 0 ? ratio.toFixed(2) + '×' : '—';
      n_vol.score = ratio > 1.5 ? 1 : ratio < 0.7 ? -1 : 0;
      n_vol.active = true;
    } else {
      n_vol.value = '—'; n_vol.score = 0; n_vol.active = false;
    }

    // SESSION node
    const n_ses = _state.nodes.session;
    n_ses.value = session;
    n_ses.score = (session === 'LONDON' || session === 'NEW YORK') ? 1 : session === 'ASIA' ? 0 : -1;
    n_ses.active = session !== 'OFF-HOURS';
  }

  // ── Generare thought stream ───────────────────────────────────────────────
  function _generateThought(traj, prevState, newState) {
    const regime = _regime();
    const es = _entryScore();
    const session = _session();
    const balance = _balance();

    const thoughts = [];

    // Analiza regime
    thoughts.push(`Regime scan → ${regime || 'undefined'}${regime.includes('STRONG') ? ' ✓ high conviction' : regime === 'RANGE' ? ' ! low conviction' : ''}`);

    // Entry score
    if (es > 0) thoughts.push(`Entry score ${es} / 100 → ${es >= 70 ? 'ABOVE threshold' : es >= 55 ? 'marginal' : 'BELOW threshold — caution'}`);

    // Trajectory
    thoughts.push(`Trajectory Δ ${traj.delta >= 0 ? '+' : ''}${traj.delta}% vs curve day ${_state.daysPassed} → ${Math.abs(traj.delta) < 1 ? 'ON TRACK' : traj.delta > 0 ? 'AHEAD — conserve gains' : 'BEHIND — controlled pressure'}`);

    // Session
    thoughts.push(`Session: ${session} → ${session === 'LONDON' || session === 'NEW YORK' ? 'prime liquidity window' : session === 'ASIA' ? 'reduced volume' : 'low activity period'}`);

    // Win rate
    if (_state.winRate10 > 0) thoughts.push(`Win rate last 10: ${_state.winRate10}% → ${_state.winRate10 >= 60 ? 'edge confirmed' : _state.winRate10 >= 50 ? 'edge marginal' : 'edge degraded — reassess'}`);

    // State transition
    if (prevState && prevState.id !== newState.id)
      thoughts.push(`STATE TRANSITION: ${prevState.label} → ${newState.label}`);

    // Memory
    const pmStats = (typeof PM !== 'undefined') ? PM.getStats() : null;
    if (pmStats && pmStats.slTightPct > 60)
      thoughts.push(`Memory alert: ${pmStats.slTightPct}% losses had SL < 1×ATR — widening threshold recommended`);
    if (pmStats && pmStats.reboundPct > 50)
      thoughts.push(`Memory alert: ${pmStats.reboundPct}% SL hits reversed — noise filtering needed`);

    // Balance vs target
    const pctToTarget = balance > 0 ? ((balance / TARGET) * 100).toFixed(4) : 0;
    thoughts.push(`Mission: $${balance.toFixed(0)} / $1,000,000 → ${pctToTarget}% complete — day ${_state.daysPassed}/${DAYS_MAX}`);

    thoughts.forEach(t => _push(t));
  }

  // ── Tick principal — apelat din interval ─────────────────────────────────
  function tick() {
    try {
      // One-shot reconciliation on first tick
      if (!_reconciled) _reconcile();
      // FIX v118: Reset automat la schimbare de zi
      if (typeof _bmResetDailyIfNeeded === 'function') _bmResetDailyIfNeeded();
      const balance = _balance();
      const traj = _calcTrajectory(balance);
      const prevState = _state.current;

      // [P0.2] winRate10 is computed from ARES's own tradeHistory, not AT/TP globals.
      // Already set in onTradeClosed(). No need to recalculate from TP here.

      // ── Update ARES positions with latest mark price ──────────────────
      try {
        let markPrice = 0;
        if (typeof S !== 'undefined' && S.price) markPrice = S.price;
        else { // [PATCH1 B5] safe kline access
          const _lk = (typeof safeLastKline === 'function') ? safeLastKline() : null;
          if (_lk) markPrice = _lk.close;
        }
        if (markPrice > 0) ARES_POSITIONS.updatePrices(markPrice);
      } catch (_) { }

      // ── Kill-switch gate: close all ARES positions ────────────────────
      try {
        const ksActive = (typeof AT !== 'undefined') && (AT.killTriggered || AT.killSwitch);
        if (ksActive && ARES_POSITIONS.getOpen().length > 0) {
          // [ZT-AUD-003] Route live positions through exchange close, virtual positions through memory close
          let markPrice = 0;
          try { if (typeof S !== 'undefined' && S.price) markPrice = S.price; } catch (_) { }
          const openPos = ARES_POSITIONS.getOpen();
          let liveClosed = 0, virtualClosed = 0;
          for (const pos of openPos) {
            if (pos.isLive && typeof ARES_MONITOR !== 'undefined' && ARES_MONITOR.closeLivePosition) {
              try {
                ARES_MONITOR.closeLivePosition(pos, markPrice || pos.markPrice || 0, 'kill_switch');
                liveClosed++;
              } catch (ksErr) {
                _push('[KILL] Live close failed for ' + (pos.symbol || 'pos') + ' — ' + (ksErr.message || ksErr));
              }
            } else {
              ARES_POSITIONS.closePosition(pos.id);
              virtualClosed++;
            }
          }
          _push('[KILL] ARES positions closed (live=' + liveClosed + ' virtual=' + virtualClosed + ')');
        }
      } catch (_) { }

      _updateNodes(traj, balance);
      const newState = _computeState(traj, balance);
      _state.current = newState;
      _state.confidence = _computeConfidence(traj);
      _generateThought(traj, prevState, newState);

      // Last lesson din PM
      try {
        const pmR = PM.load();
        if (pmR && pmR[0] && pmR[0].insight) _state.lastLesson = pmR[0].insight;
      } catch (_) { }

      // ── P0.6: Monitor open ARES live positions (SL management, fill detection) ──
      try {
        if (typeof ARES_MONITOR !== 'undefined' && ARES_MONITOR.check) {
          ARES_MONITOR.check().catch(function (e) { console.warn('[ARES] monitor async error:', e.message); });
        }
      } catch (monErr) { console.warn('[ARES] monitor error:', monErr.message); }

      // ── P0.4/P0.5: Decision engine → live execution ──
      try {
        if (typeof ARES_DECISION !== 'undefined' && typeof ARES_EXECUTE === 'function') {
          const decision = ARES_DECISION.evaluate();
          if (decision.shouldTrade) {
            _push('[DECISION] GO ' + decision.side + ' — ' + decision.reasons.join(', '));
            ARES_EXECUTE(decision).catch(function (e) {
              _push('[EXEC ERROR] ' + (e.message || e));
              console.error('[ARES] execution async error:', e);
            });
          }
        }
      } catch (decErr) { console.warn('[ARES] decision error:', decErr.message); }

      _state.lastUpdateTs = Date.now();
      _aresRender();
    } catch (e) {
      console.warn('[ARES] tick error:', e.message);
    }
  }

  // ── Hook din closeDemoPos pentru tracking W/L ─────────────────────────────
  function onTradeClosed(pnl, pos) {
    try {
      const isWin = pnl > 0;
      const isNeutral = pnl === 0;
      _state.tradeHistory.unshift(isWin);
      if (_state.tradeHistory.length > 10) _state.tradeHistory = _state.tradeHistory.slice(0, 10);
      _state.totalAresTrades++;
      if (isWin) {
        _state.consecutiveWin++;
        _state.consecutiveLoss = 0;
        _state.totalAresWins++;
      } else if (!isNeutral) {
        _state.consecutiveLoss++;
        _state.consecutiveWin = 0;
        _state.lastLossTs = Date.now();
        _state.totalAresLosses++;
      }
      // [P0.2] Update winRate10 from ARES's own trade history
      const wins10 = _state.tradeHistory.filter(Boolean).length;
      _state.winRate10 = _state.tradeHistory.length > 0 ? Math.round(wins10 / _state.tradeHistory.length * 100) : 0;
      _saveState();
      // Report PnL to server risk guard (ARES tracker)
      fetch('/api/risk/pnl', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pnl, owner: 'ARES' }) }).catch(() => { });
      tick();
    } catch (_) { }
  }

  function getState() { return _state; }

  // ── Reconciliation: sync localStorage ARES positions with exchange reality ──
  // Runs once on boot. If ARES has OPEN positions locally but exchange has no
  // matching BTCUSDT position, the exchange SL/TP was triggered while offline.
  let _reconciled = false;
  async function _reconcile() {
    if (_reconciled) return;
    _reconciled = true;
    const openLocal = ARES_POSITIONS.getOpen();
    if (openLocal.length === 0) return;
    try {
      if (typeof liveApiGetPositions !== 'function') return;
      const exchangePositions = await liveApiGetPositions();
      const btcPos = exchangePositions.find(function (p) { return p.symbol === 'BTCUSDT'; });
      openLocal.forEach(function (pos) {
        // If exchange has no BTC position at all, or side doesn't match → closed externally
        const sideMatch = btcPos && btcPos.side === pos.side && btcPos.size > 0;
        if (!sideMatch) {
          _push('[RECONCILE] Position ' + pos.id + ' closed externally (SL/TP hit while offline)');
          // Close with last known uPnL (best estimate since we don't have fill price)
          ARES_POSITIONS.closePosition(pos.id);
          onTradeClosed(pos.uPnL - pos.feesEstimate, pos);
        }
      });
    } catch (e) {
      console.warn('[ARES] reconciliation error:', e.message);
    }
  }

  return { tick, onTradeClosed, getState, reconcile: _reconcile, wallet: ARES_WALLET, positions: ARES_POSITIONS, saveState: _saveState, push: _push, balance: _balance, regime: _regime, atr: _atr, entryScore: _entryScore, session: _session };
})();

// ═══════════════════════════════════════════════════════════════════════════
// ARES TRADING ENGINE — Leverage + Sizing + Position Opening (spec D/E/F)
// [FIX A7] NON-PRODUCTION / DEBUG ONLY — This function is fully implemented
// but has ZERO callers in the codebase. It must not be wired into the live
// trading engine without full integration. Guarded to prevent accidental use.
// ═══════════════════════════════════════════════════════════════════════════
window.ARES_openPosition = function (opts) {
  // [FIX A7] Guard: block execution unless explicitly enabled for debug
  if (!window.__ARES_OPEN_POS_DEBUG__) {
    console.warn('[ARES_openPosition] BLOCKED — non-production function. Set window.__ARES_OPEN_POS_DEBUG__=true to enable for testing.');
    return null;
  }
  // opts: { side:'LONG'|'SHORT', confidence:0-100, reason, policy }
  if (typeof ARES === 'undefined') return null;
  const wallet = ARES.wallet;
  const positions = ARES.positions;
  if (!wallet || !positions) return null;

  // Check kill-switch
  try { if (typeof AT !== 'undefined' && (AT.killTriggered || AT.killSwitch)) { console.warn('[ARES] Kill-switch active — blocking open'); return null; } } catch (_) { }

  // Get current price
  let markPrice = 0;
  try {
    if (typeof S !== 'undefined' && S.price) markPrice = S.price;
    else { // [PATCH1 B5] safe kline access
      const _lk = (typeof safeLastKline === 'function') ? safeLastKline() : null;
      if (_lk) markPrice = _lk.close;
    }
  } catch (_) { }
  if (!markPrice || markPrice <= 0) { console.warn('[ARES] No mark price — blocking open'); return null; }

  const confidence = Math.min(100, Math.max(0, opts.confidence || 50));
  const bal = wallet.balance;
  const avail = wallet.available;
  const openCount = positions.getOpen().length;

  // ── E) Block if no available funds
  if (avail <= 0) { console.warn('[ARES] No available funds'); return null; }

  // ── E) calcStakeVirtual ─────────────────────────────────────────────────
  function calcStakeVirtual(balance, available, openPositionsCount, confidenceScore, volatilityScore) {
    // maxPos by balance tier
    let maxPos;
    if (balance < 300) maxPos = 1;
    else if (balance < 1000) maxPos = 2;
    else if (balance < 5000) maxPos = 3;
    else maxPos = 5;
    if (openPositionsCount >= maxPos) return null; // signal: block

    // stakePct by balance tier
    let stakePct;
    if (balance < 300) stakePct = 0.10;
    else if (balance < 1000) stakePct = 0.12;
    else if (balance < 5000) stakePct = 0.15;
    else if (balance < 10000) stakePct = 0.18;
    else stakePct = 0.20;

    // optional confidence/vol adj
    if (confidenceScore >= 80) stakePct += 0.03;
    const volScore = volatilityScore || 0;
    if (volScore >= 80) stakePct -= 0.05;
    stakePct = Math.min(0.25, Math.max(0.05, stakePct));

    let stake = balance * stakePct;
    stake = Math.max(5, Math.min(stake, available, balance * 0.25));
    return Math.round(stake * 100) / 100;
  }

  // ATR → volatility score (0-100)
  let volScore = 50;
  try {
    if (typeof S !== 'undefined' && S.atr && markPrice > 0) {
      const atrPct = (S.atr / markPrice) * 100;
      volScore = Math.min(100, Math.round(atrPct / 3 * 100)); // 3% ATR = vol 100
    }
  } catch (_) { }

  const stakeVirtual = calcStakeVirtual(bal, avail, openCount, confidence, volScore);
  if (stakeVirtual === null) {
    console.warn('[ARES] Max positions reached — blocking open (openCount=' + openCount + ')');
    return null;
  }
  if (!wallet.reserve(stakeVirtual)) {
    console.warn('[ARES] reserve failed — avail:', avail, 'need:', stakeVirtual);
    return null;
  }

  // ATR pct for leverage
  let atrPct = 1.5;
  try { if (typeof S !== 'undefined' && S.atr && markPrice > 0) atrPct = (S.atr / markPrice) * 100; } catch (_) { }
  const base = 10, k = 0.5, m = 2;
  const L = Math.min(100, Math.max(10, Math.round(base + k * confidence - m * atrPct)));

  // notional derived from stake
  let notional = Math.round(stakeVirtual * L * 10) / 10;
  if (notional < 5) notional = 5;

  const feesEst = wallet.roundTripFees(notional);
  const targetNetPnL = Math.max(5, Math.round(notional * 0.005));

  const pos = positions.open({
    side: opts.side || 'LONG',
    leverage: L,
    notional,
    entryPrice: markPrice,
    confidence,
    policy: opts.policy || 'BALANCED',
    reason: opts.reason || 'signal',
    targetNetPnL,
    stakeVirtual, // [FIX F3] passed through schema, no post-hoc assignment
  });
  console.log(`[ARES] Opened ${pos.side} BTCUSDT x${L} ISO, notional=${notional}, stake=${stakeVirtual}, fees≈${feesEst.toFixed(2)}, clientId=${pos.clientOrderId}`);
  try { _aresRender(); } catch (_) { }
  return pos;
};

// ═══════════════════════════════════════════════════════════════════════════
// P0.4 — ARES DECISION ENGINE (Minimal Rule-Based)
// Evaluates market conditions + ARES state → trade/no-trade decision
// Conservative thresholds for first production version
// ═══════════════════════════════════════════════════════════════════════════
window.ARES_DECISION = (function () {
  'use strict';

  // ── Config ──
  const MIN_CONFIDENCE = 68;          // ARES confidence must be >= this
  const MIN_ENTRY_SCORE = 55;         // BM.entryScore must be >= this
  const MAX_OPEN_POSITIONS = 1;       // Max simultaneous ARES positions
  const MIN_BALANCE_USDT = 5;         // Minimum wallet to trade
  const COOLDOWN_MS = 5 * 60 * 1000;  // 5 min between trades
  const LOSS_STREAK_BLOCK = 3;        // Block after N consecutive losses
  const REVENGE_COOLDOWN_MS = 10 * 60 * 1000; // 10 min after 3 losses
  // Regimes that allow trading (lowercase from BRAIN.regime)
  const TRADE_REGIMES = new Set(['trend', 'breakout']);
  // Sessions that allow trading
  const TRADE_SESSIONS = new Set(['LONDON', 'NEW YORK']);

  let _lastTradeTs = 0;
  let _lastDecision = null;
  // Persist _lastTradeTs so cooldown survives reload
  try { _lastTradeTs = parseInt(localStorage.getItem('ARES_LAST_TRADE_TS') || '0', 10) || 0; } catch (_) { }

  /**
   * Evaluate all inputs and produce a trade decision.
   * @returns {{ shouldTrade:boolean, side:string|null, confidence:number, reasons:string[], sources:object }}
   */
  function evaluate() {
    const reasons = [];
    const blocks = [];
    const sources = {};

    // 1. ARES must exist and be funded
    if (typeof ARES === 'undefined') { return _block(['ARES not loaded'], sources); }
    const bal = ARES.balance();
    sources.balance = bal;
    if (bal < MIN_BALANCE_USDT) {
      blocks.push('Wallet too low: $' + bal.toFixed(2) + ' < $' + MIN_BALANCE_USDT);
    }

    // 2. Wallet available (not all reserved)
    const avail = ARES.wallet.available;
    sources.available = avail;
    if (avail < MIN_BALANCE_USDT) {
      blocks.push('No available funds: $' + avail.toFixed(2));
    }

    // 3. Check open positions count
    const openPos = ARES.positions.getOpen();
    sources.openPositions = openPos.length;
    if (openPos.length >= MAX_OPEN_POSITIONS) {
      blocks.push('Max open positions reached: ' + openPos.length + '/' + MAX_OPEN_POSITIONS);
    }

    // 4. Kill switch
    try {
      if (typeof AT !== 'undefined' && (AT.killTriggered || AT.killSwitch)) {
        blocks.push('Kill switch active');
      }
    } catch (_) { }

    // 5. Cooldown since last ARES trade
    const now = Date.now();
    if (_lastTradeTs > 0 && (now - _lastTradeTs) < COOLDOWN_MS) {
      blocks.push('Cooldown active: ' + Math.round((COOLDOWN_MS - (now - _lastTradeTs)) / 1000) + 's remaining');
    }

    // 6. Regime
    const regime = ARES.regime();
    sources.regime = regime;
    if (!TRADE_REGIMES.has(regime)) {
      blocks.push('Regime not favorable: ' + regime + ' (need trend/breakout)');
    }

    // 7. Session
    const session = ARES.session();
    sources.session = session;
    if (!TRADE_SESSIONS.has(session)) {
      blocks.push('Session inactive: ' + session);
    }

    // 8. ARES internal state — block on DEFENSIVE / REVENGE_GUARD
    const state = ARES.getState();
    sources.state = state.current.id;
    if (state.current.id === 'DEFENSIVE' || state.current.id === 'REVENGE_GUARD') {
      blocks.push('ARES state: ' + state.current.id + ' — blocking trades');
    }

    // 9. Loss streak
    if (state.consecutiveLoss >= LOSS_STREAK_BLOCK) {
      const sinceLoss = now - state.lastLossTs;
      if (sinceLoss < REVENGE_COOLDOWN_MS) {
        blocks.push('Loss streak ' + state.consecutiveLoss + ' — revenge cooldown: ' + Math.round((REVENGE_COOLDOWN_MS - sinceLoss) / 1000) + 's');
      }
    }

    // 10. Entry score
    const entryScore = ARES.entryScore();
    sources.entryScore = entryScore;
    if (entryScore < MIN_ENTRY_SCORE) {
      blocks.push('Entry score too low: ' + entryScore + ' < ' + MIN_ENTRY_SCORE);
    }

    // 11. ARES confidence
    const confidence = state.confidence;
    sources.confidence = confidence;
    if (confidence < MIN_CONFIDENCE) {
      blocks.push('Confidence too low: ' + confidence + ' < ' + MIN_CONFIDENCE);
    }

    // 12. Signal direction — bullCount vs bearCount
    let side = null;
    try {
      const bulls = (typeof S !== 'undefined' && S.signalData) ? (S.signalData.bullCount || 0) : 0;
      const bears = (typeof S !== 'undefined' && S.signalData) ? (S.signalData.bearCount || 0) : 0;
      sources.bullCount = bulls;
      sources.bearCount = bears;
      if (bulls > bears && (regime === 'trend' || regime === 'breakout')) {
        side = 'LONG';
        reasons.push('Signals favor LONG (' + bulls + ' bull vs ' + bears + ' bear)');
      } else if (bears > bulls && (regime === 'trend' || regime === 'breakout')) {
        side = 'SHORT';
        reasons.push('Signals favor SHORT (' + bears + ' bear vs ' + bulls + ' bull)');
      } else {
        blocks.push('No clear signal direction (bull=' + bulls + ' bear=' + bears + ')');
      }
    } catch (_) {
      blocks.push('Signal data unavailable');
    }

    // 13. ATR sanity — extreme volatility blocks trading
    const atr = ARES.atr();
    sources.atr = atr;
    try {
      const price = (typeof S !== 'undefined' && S.price) ? S.price : 0;
      if (price > 0 && atr > 0) {
        const atrPct = (atr / price) * 100;
        sources.atrPct = atrPct;
        if (atrPct > 3.0) {
          blocks.push('Extreme volatility: ATR ' + atrPct.toFixed(2) + '% > 3%');
        }
      }
    } catch (_) { }

    // ── Final decision ──
    if (blocks.length > 0) {
      return _block(blocks, sources);
    }

    // All gates passed
    reasons.push('Regime: ' + regime);
    reasons.push('Session: ' + session);
    reasons.push('Confidence: ' + confidence);
    reasons.push('EntryScore: ' + entryScore);
    reasons.push('Balance: $' + bal.toFixed(2));

    _lastDecision = {
      shouldTrade: true,
      side: side,
      confidence: confidence,
      reasons: reasons,
      sources: sources,
      ts: now,
    };
    return _lastDecision;
  }

  function _block(reasons, sources) {
    _lastDecision = { shouldTrade: false, side: null, confidence: 0, reasons: reasons, sources: sources, ts: Date.now() };
    return _lastDecision;
  }

  function recordTrade() {
    _lastTradeTs = Date.now();
    try { localStorage.setItem('ARES_LAST_TRADE_TS', String(_lastTradeTs)); } catch (_) { }
    if (typeof _ucMarkDirty === 'function') _ucMarkDirty('aresData');
  }
  function getLastDecision() { return _lastDecision; }

  return { evaluate, recordTrade, getLastDecision };
})();

// ═══════════════════════════════════════════════════════════════════════════
// ARES TRADE JOURNAL — Logs every trade with full inputs/outputs for ML dataset
// Stored in localStorage. Max 200 entries (rolling).
// ═══════════════════════════════════════════════════════════════════════════
window.ARES_JOURNAL = (function () {
  'use strict';
  const LS_KEY = 'ARES_JOURNAL_V1';
  const MAX_ENTRIES = 200;
  let _journal = [];
  try { _journal = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (_) { _journal = []; }

  function _save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(_journal)); } catch (_) { }
    if (typeof _ucMarkDirty === 'function') _ucMarkDirty('aresData');
    if (typeof _userCtxPush === 'function') _userCtxPush();
  }

  /**
   * Record a trade entry (at open time).
   * @param {object} decision — ARES_DECISION output (sources, side, confidence, reasons)
   * @param {object} pos — ARES_POSITIONS entry
   * @param {number} markPrice
   */
  function recordOpen(decision, pos, markPrice) {
    const entry = {
      id: pos.id,
      openTs: Date.now(),
      symbol: 'BTCUSDT',
      side: decision.side,
      entryPrice: markPrice,
      leverage: pos.leverage,
      notional: pos.notional,
      confidence: decision.confidence,
      // All decision inputs for ML feature extraction
      inputs: {
        regime: decision.sources.regime || null,
        session: decision.sources.session || null,
        entryScore: decision.sources.entryScore || 0,
        atrPct: decision.sources.atrPct || 0,
        bullCount: decision.sources.bullCount || 0,
        bearCount: decision.sources.bearCount || 0,
        balance: decision.sources.balance || 0,
        openPositions: decision.sources.openPositions || 0,
        aresState: decision.sources.state || null,
      },
      reasons: decision.reasons,
      // Will be filled on close
      closeTs: null,
      closePrice: null,
      netPnl: null,
      closeReason: null,
      durationMs: null,
      outcome: null, // 'WIN' | 'LOSS' | 'NEUTRAL'
    };
    _journal.unshift(entry);
    if (_journal.length > MAX_ENTRIES) _journal = _journal.slice(0, MAX_ENTRIES);
    _save();
    return entry;
  }

  /**
   * Complete a journal entry when the trade closes.
   * @param {string} posId
   * @param {object} closeData — { closePrice, netPnl, closeReason }
   */
  function recordClose(posId, closeData) {
    const entry = _journal.find(function (e) { return e.id === posId; });
    if (!entry) return;
    entry.closeTs = Date.now();
    entry.closePrice = closeData.closePrice || 0;
    entry.netPnl = closeData.netPnl || 0;
    entry.closeReason = closeData.closeReason || 'unknown';
    entry.durationMs = entry.closeTs - entry.openTs;
    entry.outcome = entry.netPnl > 0 ? 'WIN' : (entry.netPnl < 0 ? 'LOSS' : 'NEUTRAL');
    _save();
  }

  function getAll() { return _journal; }
  function getCompleted() { return _journal.filter(function (e) { return e.closeTs !== null; }); }

  return { recordOpen, recordClose, getAll, getCompleted };
})();

// ═══════════════════════════════════════════════════════════════════════════
// P0.5 — ARES LIVE EXECUTION — Connects decision engine → live orders
// Replaces the debug-blocked ARES_openPosition with real exchange execution
// ═══════════════════════════════════════════════════════════════════════════
window.ARES_EXECUTE = async function (decision) {
  if (!decision || !decision.shouldTrade || !decision.side) return null;
  if (typeof ARES === 'undefined') return null;
  if (typeof aresPlaceOrder !== 'function') {
    console.error('[ARES_EXECUTE] aresPlaceOrder not available — liveApi.js not loaded?');
    return null;
  }

  const wallet = ARES.wallet;
  const positions = ARES.positions;
  const bal = wallet.balance;
  const avail = wallet.available;
  const confidence = decision.confidence;

  // Get mark price
  let markPrice = 0;
  try {
    if (typeof S !== 'undefined' && S.price) markPrice = S.price;
    else {
      const _lk = (typeof safeLastKline === 'function') ? safeLastKline() : null;
      if (_lk) markPrice = _lk.close;
    }
  } catch (_) { }
  if (!markPrice || markPrice <= 0) {
    console.warn('[ARES_EXECUTE] No mark price');
    return null;
  }

  // ── Sizing (reuse calcStakeVirtual logic) ──
  const openCount = positions.getOpen().length;
  let maxPos;
  if (bal < 300) maxPos = 1;
  else if (bal < 1000) maxPos = 2;
  else if (bal < 5000) maxPos = 3;
  else maxPos = 5;
  if (openCount >= maxPos) return null;

  let stakePct;
  if (bal < 300) stakePct = 0.10;
  else if (bal < 1000) stakePct = 0.12;
  else if (bal < 5000) stakePct = 0.15;
  else if (bal < 10000) stakePct = 0.18;
  else stakePct = 0.20;
  if (confidence >= 80) stakePct += 0.03;
  let volScore = 50;
  try {
    if (typeof S !== 'undefined' && S.atr && markPrice > 0) {
      const atrPct = (S.atr / markPrice) * 100;
      volScore = Math.min(100, Math.round(atrPct / 3 * 100));
    }
  } catch (_) { }
  if (volScore >= 80) stakePct -= 0.05;
  stakePct = Math.min(0.25, Math.max(0.05, stakePct));

  let stakeVirtual = bal * stakePct;
  stakeVirtual = Math.max(5, Math.min(stakeVirtual, avail, bal * 0.25));
  stakeVirtual = Math.round(stakeVirtual * 100) / 100;

  // ── Leverage from ATR ──
  let atrPct = 1.5;
  try {
    if (typeof S !== 'undefined' && S.atr && markPrice > 0) atrPct = (S.atr / markPrice) * 100;
  } catch (_) { }
  const leverage = Math.min(20, Math.max(5, Math.round(10 + 0.5 * confidence - 2 * atrPct)));

  // ── Calculate quantity ──
  let notional = stakeVirtual * leverage;
  if (notional < 5) notional = 5;
  const qty = Math.floor((notional / markPrice) * 1000) / 1000; // 3 decimal BTC
  if (qty <= 0) {
    console.warn('[ARES_EXECUTE] Calculated qty=0');
    return null;
  }

  // ── Reserve wallet funds ──
  if (!wallet.reserve(stakeVirtual)) {
    console.warn('[ARES_EXECUTE] Wallet reserve failed, avail=' + avail + ' need=' + stakeVirtual);
    return null;
  }

  // ── Build journal entry ──
  const journal = {
    decision: decision,
    markPrice: markPrice,
    stakeVirtual: stakeVirtual,
    leverage: leverage,
    notional: notional,
    qty: qty,
    atrPct: atrPct,
    volScore: volScore,
    stakePct: stakePct,
    ts: Date.now(),
  };

  const binanceSide = decision.side === 'LONG' ? 'BUY' : 'SELL';

  try {
    // 1. Place MARKET entry order on exchange
    ARES.push('[EXEC] Placing ' + decision.side + ' BTCUSDT x' + leverage + ' stake=$' + stakeVirtual.toFixed(2) + ' qty=' + qty);
    const fill = await aresPlaceOrder({
      symbol: 'BTCUSDT',
      side: binanceSide,
      quantity: qty,
      leverage: leverage,
    });

    const fillPrice = fill.avgPrice || markPrice;
    const fillQty = fill.executedQty || qty;

    // 2. Register in ARES_POSITIONS
    const pos = positions.open({
      side: decision.side,
      leverage: leverage,
      notional: fillQty * fillPrice,
      entryPrice: fillPrice,
      confidence: confidence,
      policy: 'BALANCED',
      reason: decision.reasons.join(' | '),
      targetNetPnL: Math.max(5, Math.round(notional * 0.005)),
      stakeVirtual: stakeVirtual,
    });

    // Attach live data to position
    positions.updatePos(pos.id, {
      liveOrderId: fill.orderId,
      liveQty: fillQty,
      liveFillPrice: fillPrice,
      journal: journal,
      isLive: true,
    });

    // 3. Set SL at exchange (ATR-based: 1.5× ATR below/above entry)
    const slDistance = markPrice * (atrPct / 100) * 1.5;
    const slPrice = decision.side === 'LONG'
      ? Math.round((fillPrice - slDistance) * 100) / 100
      : Math.round((fillPrice + slDistance) * 100) / 100;

    try {
      const slResult = await aresSetStopLoss({
        symbol: 'BTCUSDT',
        side: binanceSide,
        quantity: fillQty,
        stopPrice: slPrice,
      });
      positions.updatePos(pos.id, { slPrice: slPrice, slOrderId: slResult.orderId });
      ARES.push('[SL SET] ' + decision.side + ' SL @ $' + slPrice.toFixed(2));
    } catch (slErr) {
      ARES.push('[SL FAIL] ' + (slErr.message || slErr) + ' — monitor client-side');
      positions.updatePos(pos.id, { slPrice: slPrice, slOrderId: null });
    }

    // 4. Set TP at exchange (2× ATR reward)
    const tpDistance = markPrice * (atrPct / 100) * 2.0;
    const tpPrice = decision.side === 'LONG'
      ? Math.round((fillPrice + tpDistance) * 100) / 100
      : Math.round((fillPrice - tpDistance) * 100) / 100;

    try {
      const tpResult = await aresSetTakeProfit({
        symbol: 'BTCUSDT',
        side: binanceSide,
        quantity: fillQty,
        stopPrice: tpPrice,
      });
      positions.updatePos(pos.id, { tpPrice: tpPrice, tpOrderId: tpResult.orderId });
      ARES.push('[TP SET] ' + decision.side + ' TP @ $' + tpPrice.toFixed(2));
    } catch (tpErr) {
      ARES.push('[TP FAIL] ' + (tpErr.message || tpErr) + ' — monitor client-side');
      positions.updatePos(pos.id, { tpPrice: tpPrice, tpOrderId: null });
    }

    // 5. Record trade timing + journal entry for ML dataset
    ARES_DECISION.recordTrade();
    if (typeof ARES_JOURNAL !== 'undefined') ARES_JOURNAL.recordOpen(decision, pos, fillPrice);
    ARES.push('[ARES LIVE OPEN] ' + decision.side + ' BTCUSDT x' + leverage + ' @ $' + fillPrice.toFixed(2) + ' qty=' + fillQty + ' stake=$' + stakeVirtual.toFixed(2) + ' SL=$' + slPrice.toFixed(2) + ' TP=$' + tpPrice.toFixed(2));

    try { _aresRender(); } catch (_) { }
    return pos;

  } catch (err) {
    // Order failed — release wallet reservation
    wallet.release(stakeVirtual);
    ARES.push('[ARES EXEC FAIL] ' + (err.message || err));
    console.error('[ARES_EXECUTE] Order failed:', err);
    return null;
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// P0.6 — ARES POSITION MONITOR + DSL (Dynamic Stop Loss Manager)
// Phase 1: breakeven move → Phase 2: ATR trail → Phase 3: tighten on profit
// Hard exchange SL always active as safety net; DSL moves it progressively.
// ═══════════════════════════════════════════════════════════════════════════
window.ARES_MONITOR = (function () {
  'use strict';

  // DSL configuration — all distances as multiples of ATR
  const DSL = {
    BE_TRIGGER: 1.0,     // Move SL to breakeven after 1× ATR profit
    TRAIL_TRIGGER: 1.5,  // Start trailing after 1.5× ATR profit
    TRAIL_DIST: 1.0,     // Trail distance: keep SL 1× ATR behind price
    TIGHTEN_TRIGGER: 3.0,// Tighten trail after 3× ATR profit
    TIGHTEN_DIST: 0.5,   // Tightened trail: 0.5× ATR behind price
    MIN_MOVE: 0.001,     // Min price move (0.1%) before updating exchange SL
  };

  function _getAtrPct() {
    let atrPct = 1.5; // fallback
    try {
      if (typeof S !== 'undefined' && S.atr && S.price > 0) {
        const ap = (S.atr / S.price) * 100;
        if (ap > 0) atrPct = ap;
      }
    } catch (_) { }
    return atrPct;
  }

  /**
   * Compute the ideal SL price based on DSL phases.
   * Returns null if SL should not be moved yet.
   */
  function _computeDslStop(pos, markPrice) {
    const dir = pos.side === 'LONG' ? 1 : -1;
    const priceDiff = (markPrice - pos.entryPrice) * dir;
    const atrPct = _getAtrPct();
    const atrPrice = pos.entryPrice * (atrPct / 100); // ATR in price terms

    // Phase 3: deep profit → tight trail
    if (priceDiff >= atrPrice * DSL.TIGHTEN_TRIGGER) {
      const trailDist = atrPrice * DSL.TIGHTEN_DIST;
      return pos.side === 'LONG'
        ? markPrice - trailDist
        : markPrice + trailDist;
    }
    // Phase 2: moderate profit → standard trail
    if (priceDiff >= atrPrice * DSL.TRAIL_TRIGGER) {
      const trailDist = atrPrice * DSL.TRAIL_DIST;
      return pos.side === 'LONG'
        ? markPrice - trailDist
        : markPrice + trailDist;
    }
    // Phase 1: enough profit for breakeven
    if (priceDiff >= atrPrice * DSL.BE_TRIGGER) {
      const buffer = pos.entryPrice * 0.001; // 0.1% buffer above entry
      return pos.side === 'LONG'
        ? pos.entryPrice + buffer
        : pos.entryPrice - buffer;
    }
    return null; // not enough profit to move SL
  }

  /**
   * Check all ARES open positions, manage DSL, detect fills.
   * Called from ARES tick() every 5 min.
   */
  async function check() {
    if (typeof ARES === 'undefined') return;
    const openPos = ARES.positions.getOpen();
    if (openPos.length === 0) return;

    let markPrice = 0;
    try {
      if (typeof S !== 'undefined' && S.price) markPrice = S.price;
    } catch (_) { }
    if (!markPrice) return;

    for (const pos of openPos) {
      if (!pos.isLive) continue;

      // ── DSL: compute ideal stop and move exchange SL if needed ──
      if (pos.slPrice) {
        const idealSl = _computeDslStop(pos, markPrice);
        if (idealSl !== null) {
          // Only move SL forward (toward profit), never backward
          const isBetter = pos.side === 'LONG'
            ? idealSl > pos.slPrice
            : idealSl < pos.slPrice;
          // Only update if move is significant (avoid exchange spam)
          const movePct = Math.abs(idealSl - pos.slPrice) / pos.entryPrice;
          if (isBetter && movePct >= DSL.MIN_MOVE) {
            const newSl = Math.round(idealSl * 100) / 100;
            try {
              if (pos.slOrderId) {
                await aresCancelOrder('BTCUSDT', pos.slOrderId);
              }
              const slResult = await aresSetStopLoss({
                symbol: 'BTCUSDT',
                side: pos.side === 'LONG' ? 'BUY' : 'SELL',
                quantity: pos.liveQty || pos.qty,
                stopPrice: newSl,
              });
              const phase = _computeDslStop(pos, markPrice) !== null ? 'DSL' : 'BE';
              ARES.positions.updatePos(pos.id, {
                slPrice: newSl,
                slOrderId: slResult.orderId,
                _slMovedBE: true,
                _dslPhase: phase,
              });
              ARES.push('[DSL] ' + pos.side + ' SL → $' + newSl.toFixed(2) + ' (was $' + pos.slPrice.toFixed(2) + ')');
            } catch (e) {
              ARES.push('[DSL FAIL] ' + (e.message || e));
            }
          }
        }
      }

      // ── Client-side emergency close if SL/TP orders failed to place ──
      if (!pos.slOrderId && pos.slPrice) {
        const slHit = (pos.side === 'LONG' && markPrice <= pos.slPrice) ||
          (pos.side === 'SHORT' && markPrice >= pos.slPrice);
        if (slHit) {
          ARES.push('[EMERGENCY SL] Client-side SL trigger for ' + pos.id);
          await _closeLivePosition(pos, markPrice, 'emergency_sl');
          continue;
        }
      }
      if (!pos.tpOrderId && pos.tpPrice) {
        const tpHit = (pos.side === 'LONG' && markPrice >= pos.tpPrice) ||
          (pos.side === 'SHORT' && markPrice <= pos.tpPrice);
        if (tpHit) {
          ARES.push('[EMERGENCY TP] Client-side TP trigger for ' + pos.id);
          await _closeLivePosition(pos, markPrice, 'emergency_tp');
          continue;
        }
      }
    }
  }

  /**
   * Close an ARES live position on exchange and update local state.
   */
  async function _closeLivePosition(pos, markPrice, reason) {
    try {
      // Cancel outstanding SL/TP orders first
      if (pos.slOrderId) {
        try { await aresCancelOrder('BTCUSDT', pos.slOrderId); } catch (_) { }
      }
      if (pos.tpOrderId) {
        try { await aresCancelOrder('BTCUSDT', pos.tpOrderId); } catch (_) { }
      }

      // Close on exchange
      const closeResult = await aresClosePosition({
        symbol: 'BTCUSDT',
        side: pos.side,
        qty: pos.liveQty || pos.qty,
      });

      const closePrice = closeResult.avgPrice || markPrice;
      const dir = pos.side === 'LONG' ? 1 : -1;
      const grossPnl = ((closePrice - pos.entryPrice) * dir / pos.entryPrice) * (pos.notional || 0);
      const fees = ARES.wallet.roundTripFees(pos.notional || 0);
      const netPnl = grossPnl - fees;

      // Update position in ARES_POSITIONS
      ARES.positions.updatePos(pos.id, {
        closePrice: closePrice,
        closeReason: reason,
        grossPnl: grossPnl,
        netPnl: netPnl,
        fees: fees,
      });

      // Close in ARES_POSITIONS (releases wallet, applies PnL)
      ARES.positions.closePosition(pos.id);

      // Update ARES learning
      ARES.onTradeClosed(netPnl, pos);

      // Journal: complete the trade record for ML dataset
      if (typeof ARES_JOURNAL !== 'undefined') ARES_JOURNAL.recordClose(pos.id, { closePrice, netPnl, closeReason: reason });

      ARES.push('[ARES CLOSE] ' + pos.side + ' @ $' + closePrice.toFixed(2) + ' PnL=$' + netPnl.toFixed(2) + ' reason=' + reason);
      try { _aresRender(); } catch (_) { }
      return { netPnl, closePrice };

    } catch (err) {
      ARES.push('[ARES CLOSE FAIL] ' + (err.message || err));
      console.error('[ARES_MONITOR] Close failed:', err);
      return null;
    }
  }

  return { check, closeLivePosition: _closeLivePosition };
})();

// ── Hook ARES în closeDemoPos ─────────────────────────────────────────────
// [P2-4] Replaced monkey-patch with hook registration pattern
(function _aresHookClose() {
  if (!window._demoCloseHooks) window._demoCloseHooks = [];

  // ── helpers extracție PnL ──
  function _sN(v) { v = +v; return Number.isFinite(v) ? v : null; }

  function _pnlFromPos(pos) {
    if (!pos) return null;
    const d = _sN(pos.netPnL) ?? _sN(pos.pnlNet) ?? _sN(pos.pnl) ??
      _sN(pos.realizedPnL) ?? _sN(pos.realized) ?? _sN(pos.profit) ?? null;
    if (d !== null) return d;
    const g = _sN(pos.grossPnL);
    if (g !== null) return g - (_sN(pos.fee) ?? _sN(pos.fees) ?? 0);
    return null;
  }

  window._demoCloseHooks.push(function (pos, pnl, reason) {
    if (typeof ARES === 'undefined' || typeof ARES.onTradeClosed !== 'function') return;
    setTimeout(function () {
      try {
        // Use pnl from closeDemoPos directly; fallback to pos extraction
        var finalPnl = Number.isFinite(pnl) ? pnl : _pnlFromPos(pos);
        if (!Number.isFinite(finalPnl)) finalPnl = 0;
        ARES.onTradeClosed(finalPnl, pos);
      } catch (_) { }
    }, 350);
  });
})();

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  ARES NEURAL COMMAND CENTER — UI                                         ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// ── CSS ARES ──────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════
// ║  ARES COGNITIVE ENGINE — Funcții de gândire în timp real (v109)       ║
// ║  Memorie pe termen scurt, auto-evaluare, predicție contextuală        ║
// ══════════════════════════════════════════════════════════════════════════

// ARES_MIND module
const ARES_MIND = (function () {
  // ── Memorie pe termen scurt (ultimele 10 decizii) ──────────────────────
  const _shortMemory = [];   // { ts, price, regime, score, dir, outcome }
  const _predictions = [];   // { ts, price, dir, targetPrice, resolved, correct }
  let _cognitiveClarityPct = 0;
  let _pulseSpeed = 18;      // viteza animației (s) — se adaptează la ATR

  function recordDecision(dir, score, regime, price) {
    _shortMemory.unshift({ ts: Date.now(), dir, score, regime, price, outcome: null });
    if (_shortMemory.length > 10) _shortMemory.pop();
    _makePrediction(dir, price);
    _recalcClarity();
  }

  function resolveOutcome(pnl) {
    const pending = _shortMemory.find(m => m.outcome === null);
    if (pending) pending.outcome = pnl >= 0 ? 'win' : 'loss';
    _resolvePredictions();
  }

  function _makePrediction(dir, price) {
    if (!price || price <= 0) return;
    const movePct = 0.003 + Math.random() * 0.004;  // 0.3–0.7%
    const target = dir === 'LONG' ? price * (1 + movePct) : price * (1 - movePct);
    _predictions.unshift({ ts: Date.now(), price, dir, targetPrice: target, resolved: false, correct: null });
    if (_predictions.length > 20) _predictions.pop();
  }

  function _resolvePredictions() {
    const now = Date.now();
    const curPrice = (typeof S !== 'undefined') ? S.price : 0;
    _predictions.forEach(p => {
      if (p.resolved) return;
      const age = now - p.ts;
      if (age < 300000) return;  // < 5 min → nu rezolvăm
      if (!curPrice) return;
      p.resolved = true;
      p.correct = (p.dir === 'LONG' && curPrice >= p.targetPrice) ||
        (p.dir === 'SHORT' && curPrice <= p.targetPrice);
    });
  }

  function _recalcClarity() {
    // Claritate bazată pe: calitate date + consistența semnalelor + volatilitate
    let score = 50;
    const price = (typeof S !== 'undefined') ? S.price : 0;
    const regime = (typeof BM !== 'undefined') ? BM.regime : null;
    const atr = (typeof S !== 'undefined') ? S.atr : null;
    if (price > 0) score += 15;
    if (regime && regime !== '—') score += 10;
    if (atr > 0) score += 10;
    // Consistență: ultimele 3 decizii în aceeași direcție = +10
    if (_shortMemory.length >= 3) {
      const last3 = _shortMemory.slice(0, 3).map(m => m.dir);
      if (last3.every(d => d === last3[0])) score += 10;
    }
    // Penalizare volatilitate extremă
    if (atr > 0 && price > 0 && (atr / price) > 0.02) score -= 15;
    _cognitiveClarityPct = Math.min(100, Math.max(0, Math.round(score)));
    // Adaptăm viteza pulsului la volatilitate (ATR)
    if (atr > 0 && price > 0) {
      const volRatio = atr / price;
      _pulseSpeed = volRatio > 0.015 ? 6 : volRatio > 0.008 ? 12 : 18;
    }
  }

  function getPredictionAccuracy() {
    const resolved = _predictions.filter(p => p.resolved);
    if (!resolved.length) return null;
    const correct = resolved.filter(p => p.correct).length;
    return Math.round((correct / resolved.length) * 100);
  }

  function getPatternInsight() {
    if (_shortMemory.length < 3) return 'Acumulez date cognitive...';
    const wins = _shortMemory.filter(m => m.outcome === 'win').length;
    const losses = _shortMemory.filter(m => m.outcome === 'loss').length;
    const longs = _shortMemory.filter(m => m.dir === 'LONG').length;
    const shorts = _shortMemory.filter(m => m.dir === 'SHORT').length;
    const bias = longs > shorts ? 'LONG' : shorts > longs ? 'SHORT' : 'NEUTRU';
    if (wins > losses * 2) return `Pattern detectat: bias ${bias} cu win-rate ridicat`;
    if (losses > wins * 2) return `Alertă cognitivă: rezultate slabe recent — recalibrez`;
    return `Memorie echilibrată: ${wins}W / ${losses}L, bias ${bias}`;
  }

  function getClarity() { return _cognitiveClarityPct; }
  function getPulseSpeed() { return _pulseSpeed; }
  function getMemory() { return _shortMemory; }

  return {
    recordDecision, resolveOutcome, getClarity, getPulseSpeed,
    getPredictionAccuracy, getPatternInsight, getMemory
  };
})();

// ── Hook ARES_MIND în ARES.onTradeClosed (non-distructiv) ──────────────────
(function _hookAresMind() {
  const _origTick = (typeof ARES !== 'undefined') ? ARES.tick : null;
  if (!_origTick) return;
  const _origOnClose = (typeof ARES !== 'undefined') ? ARES.onTradeClosed : null;
  if (_origOnClose) {
    ARES.onTradeClosed = function (pnl) {
      ARES_MIND.resolveOutcome(pnl);
      return _origOnClose.call(ARES, pnl);
    };
  }
})();

(function _aresCSS() {
  const s = document.createElement('style');
  s.textContent = `
  /* ══ ARES Strip Banner ══ */
  #ares-strip { background:transparent; border-bottom:none; margin:3px 6px; position:relative; }
  #ares-strip-bar { display:flex;align-items:center;justify-content:space-between;padding:0;min-height:44px;cursor:pointer;user-select:none;gap:0;transition:border-color .25s,box-shadow .25s;background:none;border:none;border-radius:10px;opacity:1;position:relative;overflow:hidden; }
  #ares-strip-bar:hover { }
  #ares-strip-title { font-size:13px;font-weight:700;letter-spacing:2px;color:#00d9ff;display:flex;align-items:center;gap:6px;font-family:monospace; }
  #ares-strip-badge { font-size:11px;padding:2px 6px;border-radius:999px;letter-spacing:1px;font-weight:700;border:1px solid currentColor;font-family:monospace;box-shadow:0 0 8px currentColor; }
  /* UI-2 closed: hide conf+imm+emotion */
  #ares-strip-conf,#ares-imm-span,#ares-emotion-span { display:none; }
  #ares-strip.open #ares-strip-conf,#ares-strip.open #ares-imm-span,#ares-strip.open #ares-emotion-span { display:inline; }
  #ares-strip-chev { font-size:8px;color:#00d9ff44;transition:transform .25s;flex-shrink:0;opacity:.35; }
  #ares-strip-panel { max-height:0;overflow:hidden;transition:max-height .5s cubic-bezier(.4,0,.2,1); }
  #ares-strip.open #ares-strip-panel { max-height:900px; }
  #ares-strip.open #ares-strip-chev { transform:rotate(180deg); }
  #ares-strip.open #ares-strip-bar { opacity:1; }

  /* ══ ARES Main Panel ══ */
  #ares-panel { background:linear-gradient(180deg,#00050f 0%,#000818 60%,#000d20 100%);padding:0;font-family:monospace;position:relative;overflow:hidden; }
  #ares-panel::before { content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 50% 20%,#0080ff0a 0%,#00d9ff04 40%,transparent 75%);pointer-events:none;z-index:0; }

  /* ══ Neural Network Background Canvas ══ */
  #ares-neural-bg { position:absolute;inset:0;pointer-events:none;z-index:0;opacity:.35; }

  /* ══ Mission Arc ══ */
  #ares-arc-wrap { padding:12px 12px 0;position:relative;z-index:2; }
  #ares-arc-svg { width:100%;height:64px;display:block; }

  /* ══ Neural Brain Core ══ */
  #ares-core-wrap { display:flex;justify-content:center;align-items:center;padding:4px 0 0;position:relative;z-index:2; }
  #ares-core-svg { width:100%;max-width:480px;height:auto;display:block;overflow:visible; }

  /* ══ Cognitive Bar (sotto il brain) ══ */
  #ares-cog-bar { display:flex;align-items:center;gap:8px;margin:4px 12px 6px;z-index:2;position:relative; }
  #ares-cog-label { font-size:10px;color:#0080ff77;letter-spacing:2px;flex-shrink:0; }
  #ares-cog-track { flex:1;height:3px;background:#0080ff11;border-radius:2px;overflow:hidden; }
  #ares-cog-fill  { height:3px;background:linear-gradient(90deg,#0080ff,#00d9ff,#ffffff);border-radius:2px;transition:width .8s ease;box-shadow:0 0 6px #00d9ffaa; }
  #ares-cog-pct   { font-size:10px;color:#00d9ffaa;letter-spacing:1px;min-width:28px;text-align:right; }

  /* ══ Animations ══ */
  @keyframes aresHexPulse {
    0%,100% { opacity:.8;transform:scale(1); }
    50% { opacity:1;transform:scale(1.03); }
  }
  @keyframes aresNodePulse {
    0%,100% { opacity:.45; }
    50% { opacity:1; }
  }
  @keyframes aresRingRotate {
    from { transform:rotate(0deg); }
    to   { transform:rotate(360deg); }
  }
  @keyframes aresRingRotateRev {
    from { transform:rotate(0deg); }
    to   { transform:rotate(-360deg); }
  }
  @keyframes aresCoreDot {
    0%,100% { opacity:.5; }
    50%     { opacity:1; }
  }
  @keyframes aresLineFlow {
    0%   { stroke-dashoffset:40; opacity:.2; }
    50%  { opacity:.9; }
    100% { stroke-dashoffset:0; opacity:.2; }
  }
  @keyframes aresThoughtScroll {
    0%   { transform:translateY(0); }
    100% { transform:translateY(-50%); }
  }
  @keyframes aresGlitch {
    0%,94%,100% { transform:translateX(0); opacity:1; }
    95% { transform:translateX(-2px); opacity:.7; }
    97% { transform:translateX(3px); opacity:.8; }
    99% { transform:translateX(0); opacity:1; }
  }
  @keyframes aresBlink {
    0%,49%,100% { opacity:1; } 50%,99% { opacity:0; }
  }
  @keyframes aresParticleFloat {
    0%   { opacity:0; transform:translate(0,0) scale(.5); }
    30%  { opacity:.9; }
    100% { opacity:0; transform:translate(var(--px),var(--py)) scale(1.4); }
  }
  @keyframes aresBrainPulse {
    0%,100% { filter:drop-shadow(0 0 8px #00d9ff66) drop-shadow(0 0 20px #0080ff33); }
    50%     { filter:drop-shadow(0 0 16px #00d9ffcc) drop-shadow(0 0 40px #0080ff66) drop-shadow(0 0 60px #ffffff22); }
  }
  @keyframes aresCircuitFlow {
    0%   { stroke-dashoffset:200; opacity:.15; }
    50%  { opacity:.7; }
    100% { stroke-dashoffset:0; opacity:.15; }
  }
  @keyframes aresNodeAppear {
    0%   { r:1; opacity:0; }
    40%  { opacity:1; }
    80%  { r:4; opacity:.9; }
    100% { r:3; opacity:.6; }
  }

  /* ══ Thought Stream ══ */
  #ares-thought-wrap { height:68px;overflow:hidden;position:relative;margin:4px 12px;border:1px solid #0080ff18;border-radius:3px;background:#000510;z-index:2; }
  #ares-thought-wrap::before { content:'';position:absolute;top:0;left:0;right:0;height:18px;background:linear-gradient(180deg,#000510,transparent);z-index:3;pointer-events:none; }
  #ares-thought-wrap::after  { content:'';position:absolute;bottom:0;left:0;right:0;height:18px;background:linear-gradient(0deg,#000510,transparent);z-index:3;pointer-events:none; }
  #ares-thought-inner { position:absolute;width:100%; }
  .ares-thought-line { padding:2px 8px;font-size:11px;color:#0080ff55;letter-spacing:.5px;line-height:1.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
  .ares-thought-line.new { color:#00d9ffcc;text-shadow:0 0 8px #00d9ff66; }
  .ares-thought-line.alert { color:#ff6644cc; }

  /* ══ Stats row ══ */
  #ares-stats-row { display:grid;grid-template-columns:repeat(4,1fr);gap:1px;margin:6px 12px;border:1px solid #0080ff12;border-radius:3px;overflow:hidden;z-index:2;position:relative; }
  .ares-stat-cell { background:#000510;padding:5px 4px;text-align:center; }
  .ares-stat-label { font-size:10px;color:#0080ff44;letter-spacing:1.2px;margin-bottom:2px; }
  .ares-stat-val   { font-size:13px;font-weight:900;letter-spacing:1px; }
  .ares-stat-sub   { font-size:10px;color:#0080ff33;margin-top:1px; }

  /* ══ Last Lesson ══ */
  #ares-lesson-wrap { margin:6px 12px 10px;padding:7px 10px;background:#000510;border:1px solid #f0c04018;border-radius:3px;position:relative;z-index:2; }
  #ares-lesson-label { font-size:10px;color:#f0c04055;letter-spacing:2px;margin-bottom:4px; }
  #ares-lesson-text { font-size:11px;color:#f0c040aa;line-height:1.7;letter-spacing:.3px; }
  #ares-history-bar { display:flex;gap:2px;margin-top:6px; }
  .ares-hist-dot { width:14px;height:8px;border-radius:1px;flex-shrink:0; }

  /* ══ Scanlines overlay ══ */
  #ares-panel::after { content:'';position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,.08) 3px,rgba(0,0,0,.08) 4px);pointer-events:none;z-index:10; }
  `;
  document.head.appendChild(s);
})();

// ── ARES Render — Supreme Neural Brain v109 ──────────────────────────────
function _aresRender() {
  try { // [v119-p10 FIX] wrap complet — orice eroare internă NU mai aruncă uncaught → nu mai aprinde ENGINE ERROR banner
    const panel = document.getElementById('ares-core-svg');
    if (!panel) return;
    const st = ARES.getState();
    const col = st.current.color;
    const glow = st.current.glow;

    // Cognitive clarity from ARES_MIND
    const clarity = ARES_MIND.getClarity();
    const pulseSpeed = ARES_MIND.getPulseSpeed();
    const predAcc = ARES_MIND.getPredictionAccuracy();

    // Update badge in header
    const badge = document.getElementById('ares-strip-badge');
    if (badge) {
      badge.innerHTML = st.current.emoji + ' ' + st.current.label;
      badge.style.color = col;
      badge.style.borderColor = col + '88';
      badge.style.textShadow = `0 0 10px ${glow}`;
      badge.style.boxShadow = `0 0 8px ${glow}`;
    }
    const confEl = document.getElementById('ares-strip-conf');
    if (confEl) confEl.textContent = 'CONF ' + st.confidence + '%  ·  CLARITY ' + clarity + '%';

    // ── v114: IMM + emotion + wound + stage + lob dots ────────────────────────

    // 1) IMM — Immortality Score (progress spre 1M in %)
    try {
      const bal = (typeof ARES !== 'undefined' && ARES.wallet) ? ARES.wallet.balance : 0;
      const immPct = bal > 0 ? Math.min(100, +(bal / 10000).toFixed(2)) : 0;
      const immEl = document.getElementById('ares-imm-span');
      if (immEl) immEl.textContent = ' · IMM ' + immPct.toFixed(1) + '%';
    } catch (_) { }

    // 2) Emotion suffix pe badge (derivat din stare + context)
    try {
      const EMOTION_MAP = {
        DETERMINED: 'Focused',
        RESILIENT: 'Recovering',
        FOCUSED: 'Calm',
        STRATEGIC: 'Ambition Rising',
        MOMENTUM: 'High Energy',
        FRUSTRATED: 'Pain Detected',
        DEFENSIVE: 'Guard Mode',
        REVENGE_GUARD: 'Revenge Guard',
      };
      const emotionEl = document.getElementById('ares-emotion-span');
      if (emotionEl) {
        const emo = EMOTION_MAP[st.current.id] || '';
        emotionEl.textContent = emo ? ' — ' + emo : '';
      }
    } catch (_) { }

    // 3) Mortal Wound (DEFENSIVE sau REVENGE_GUARD cu 3+ consecutive losses)
    try {
      const woundEl = document.getElementById('ares-wound-line');
      if (woundEl) {
        const isWounded = (st.current.id === 'DEFENSIVE' || st.current.id === 'REVENGE_GUARD') && st.consecutiveLoss >= 3;
        if (isWounded) {
          woundEl.style.display = 'block';
          woundEl.innerHTML = _ZI.w + ' MORTAL WOUND — ' + st.consecutiveLoss + ' consecutive losses · Risk Reduced';
        } else {
          woundEl.style.display = 'none';
        }
      }
    } catch (_) { }

    // P0.7) Mission Failed — wallet depleted below minimum tradeable amount
    try {
      const bal = (typeof ARES !== 'undefined' && ARES.wallet) ? ARES.wallet.balance : 0;
      const woundEl = document.getElementById('ares-wound-line');
      if (woundEl && bal < 5 && bal >= 0) {
        woundEl.style.display = 'block';
        woundEl.style.color = '#ff0044';
        woundEl.innerHTML = _ZI.skull + ' MISSION FAILED — Wallet depleted ($' + bal.toFixed(2) + '). REFILL to resume trading.';
      }
    } catch (_) { }

    // P0.7) Decision Engine status — show last decision summary
    try {
      if (typeof ARES_DECISION !== 'undefined') {
        const lastDec = ARES_DECISION.getLastDecision();
        const decEl = document.getElementById('ares-decision-line');
        if (decEl && lastDec) {
          if (lastDec.shouldTrade) {
            decEl.style.display = 'block';
            decEl.style.color = '#00ff88';
            decEl.innerHTML = _ZI.ok + ' DECISION: ' + escHtml(lastDec.side) + ' — ' + lastDec.reasons.slice(0, 3).map(escHtml).join(' · ');
          } else {
            decEl.style.display = 'block';
            decEl.style.color = '#ff8800';
            decEl.innerHTML = _ZI.pause + ' BLOCKED: ' + lastDec.reasons.slice(0, 2).map(escHtml).join(' · ');
          }
        }
      }
    } catch (_) { }

    // 4) Stage Progress + Objectives
    try {
      // ARES_WALLET is the single source of truth — never TP.demoBalance
      const bal = (typeof ARES !== 'undefined' && ARES.wallet) ? ARES.wallet.balance : 0;

      // ── B) Stage Progress — correct range logic ─────────────────────────
      const STAGES = [
        { name: 'SEED', from: 0, to: 1000, next: '1,000' },
        { name: 'ASCENT', from: 1000, to: 10000, next: '10,000' },
        { name: 'SOVEREIGN', from: 10000, to: 1000000, next: '1,000,000' },
      ];
      let activeStage = STAGES[0];
      for (const s of STAGES) { if (bal >= s.from) activeStage = s; }
      // pct within current stage range only
      const stagePct = Math.min(100, Math.max(0, Math.round(
        ((bal - activeStage.from) / (activeStage.to - activeStage.from)) * 100
      )));
      const filled = Math.floor(stagePct / 10);
      const bar = '█'.repeat(filled) + '░'.repeat(10 - filled) + ' ' + stagePct + '%';

      const nameEl = document.getElementById('ares-stage-name');
      const barEl = document.getElementById('ares-prog-bar');
      const nextEl = document.getElementById('ares-prog-next');
      if (nameEl) nameEl.textContent = activeStage.name;
      if (barEl) barEl.textContent = bar;
      if (nextEl && bal < activeStage.to) nextEl.textContent = 'Next: ' + activeStage.next;
      else if (nextEl) nextEl.textContent = '✓ COMPLETE';

      // ── C) Objectives — strict wallet balance truth, no demoBalance ──────
      // Each objective has its own from/to; progress is 0 until from reached.
      // DONE only when balance >= to (upper bound).
      const aresEquity = (bal > 0) ? bal : null;

      const OBJ_DEFS = [
        { id: 0, from: 100, to: 1000, label: '100 → 1,000', col: 'rgba(0,255,140,0.95)', colDim: 'rgba(0,255,140,0.55)' },
        { id: 1, from: 1000, to: 10000, label: '1,000 → 10,000', col: 'rgba(70,200,255,0.95)', colDim: 'rgba(70,200,255,0.55)' },
        { id: 2, from: 10000, to: 1000000, label: '10,000 → 1M', col: 'rgba(255,200,60,0.95)', colDim: 'rgba(255,200,60,0.55)' },
      ];

      // C) rangeProgress: bal must exceed from to show any %; DONE only at >= to
      function rangeProgress(x, a, b) {
        if (!Number.isFinite(x) || x <= a) return 0;
        if (x >= b) return 1;
        return (x - a) / (b - a);
      }

      // Title update — show status
      const objTitleEl = document.getElementById('ares-obj-title');
      if (objTitleEl) {
        if (!aresEquity) {
          objTitleEl.textContent = 'OBJECTIVES';
          objTitleEl.style.color = '#ff335566';
        } else if (aresEquity < 100) {
          objTitleEl.textContent = 'OBJECTIVES — SEED NOT FUNDED';
          objTitleEl.style.color = '#f0c04099';
        } else {
          objTitleEl.textContent = 'OBJECTIVES';
          objTitleEl.style.color = '#0080ff66';
        }
      }

      OBJ_DEFS.forEach(o => {
        const el = document.getElementById('aobj-' + o.id);
        const elb = document.getElementById('aobj-' + o.id + 'b');
        if (!el) return;
        const eq = aresEquity;
        let prog = 0;
        if (eq !== null) {
          prog = rangeProgress(eq, o.from, o.to);
        }
        const pct2 = Math.round(prog * 100);
        const notStarted = eq === null || eq <= o.from;
        const done = prog >= 1;
        const active = !notStarted && !done;

        el.className = 'ares-obj-item' + (done ? ' done' : active ? ' active' : '');
        el.style.color = done ? o.colDim : active ? o.col : 'rgba(255,255,255,0.28)';
        el.textContent = o.label;
        if (elb) {
          if (!eq || (notStarted && !done)) {
            elb.innerHTML = `<div style="display:flex;align-items:center;gap:4px;justify-content:flex-end">
            <div style="width:60px;height:4px;background:rgba(255,255,255,0.12);border-radius:2px;overflow:hidden"><div style="width:0%;height:100%;background:${o.col}"></div></div>
            <span style="color:rgba(255,255,255,0.28);font-size:11px">0%</span>
          </div>`;
          } else if (done) {
            elb.innerHTML = `<div style="display:flex;align-items:center;gap:4px;justify-content:flex-end">
            <div style="width:60px;height:4px;background:rgba(255,255,255,0.12);border-radius:2px;overflow:hidden"><div style="width:100%;height:100%;background:${o.col};box-shadow:0 0 10px ${o.col}"></div></div>
            <span style="color:${o.col};font-size:11px;font-weight:700">✓ DONE</span>
          </div>`;
          } else {
            const w = Math.round(prog * 60);
            elb.innerHTML = `<div style="display:flex;align-items:center;gap:4px;justify-content:flex-end">
            <div style="width:60px;height:4px;background:rgba(255,255,255,0.12);border-radius:2px;overflow:hidden"><div style="width:${w}px;height:100%;background:${o.col};box-shadow:0 0 8px ${o.col};transition:width 0.4s"></div></div>
            <span style="color:${o.col};font-size:11px;font-weight:700">${pct2}%</span>
          </div>`;
          }
        }
      });

      // ── WALLET UI update (v118-2) ─────────────────────────────────────
      try {
        const wlt = (typeof ARES !== 'undefined' && ARES.wallet) ? ARES.wallet : null;
        const wBal = wlt ? wlt.balance : 0;
        const wAvl = wlt ? wlt.available : 0;
        const wLck = wlt ? wlt.locked : 0;
        const openCnt = (typeof ARES !== 'undefined' && ARES.positions) ? ARES.positions.getOpen().length : 0;
        const fmt = v => '$' + (v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const fmt0 = v => '$' + (v || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const wBalEl = document.getElementById('ares-wallet-balance');
        const wAvlEl = document.getElementById('ares-wallet-avail-val');
        const wLckEl = document.getElementById('ares-wallet-lock-val');
        const wFailEl = document.getElementById('ares-wallet-fail');
        const wWdBtn = document.getElementById('ares-wallet-withdraw-btn');
        const wWdTip = document.getElementById('ares-wallet-withdraw-tip');
        if (wBalEl) { wBalEl.textContent = fmt(wBal); wBalEl.style.color = wBal > 0 ? '#00ff88' : 'rgba(255,255,255,0.25)'; }
        if (wAvlEl) wAvlEl.textContent = fmt0(wAvl);
        if (wLckEl) wLckEl.textContent = fmt0(wLck);
        // NO FUNDS badge — show only if balance > 0 but available = 0 (all locked)
        if (wFailEl) {
          const noFunds = (wAvl <= 0 && wBal > 0);
          wFailEl.style.display = noFunds ? 'block' : 'none';
        }
        // F) WITHDRAW button — disabled when locked > 0 or open positions exist
        const wdBlocked = (wLck > 0 || openCnt > 0);
        if (wWdBtn) {
          wWdBtn.disabled = wdBlocked;
          wWdBtn.style.opacity = wdBlocked ? '0.38' : '1';
          wWdBtn.style.cursor = wdBlocked ? 'not-allowed' : 'pointer';
          wWdBtn.style.borderColor = wdBlocked ? 'rgba(255,80,80,0.15)' : 'rgba(255,80,80,0.3)';
        }
        if (wWdTip) wWdTip.style.display = wdBlocked ? 'block' : 'none';
      } catch (_) { }

      // Consciousness dots (în SVG)
      const CONS_STAGES = ['SEED', 'ASCENT', 'SOVEREIGN'];
      const activeIdx = STAGES.indexOf(activeStage);
      const dotCols = ['#00ff88', '#00ff88', '#00ff88'];
      const dotFades = ['#4a6655', '#4a6655', '#4a6655'];
      const dotIds = ['ldot-c0', 'ldot-c1', 'ldot-c2'];
      const txtIds = ['ldot-parietal-seed', 'ldot-parietal-ascent', 'ldot-parietal-sovereign'];
      dotIds.forEach((did, ci) => {
        const dotEl = document.getElementById(did);
        const txtEl = document.getElementById(txtIds[ci]);
        const isActive = ci === activeIdx;
        if (dotEl) dotEl.setAttribute('fill', isActive ? '#00ff88' : ci < activeIdx ? '#00d9ff88' : '#444466');
        if (dotEl) dotEl.setAttribute('opacity', isActive ? '0.95' : ci < activeIdx ? '0.55' : '0.35');
        if (txtEl) txtEl.setAttribute('fill', isActive ? '#00ff88' : ci < activeIdx ? '#00d9ff' : '#556677');
        if (txtEl) txtEl.setAttribute('opacity', isActive ? '0.90' : ci < activeIdx ? '0.55' : '0.38');
      });
    } catch (_) { }

    // ── 4b) ARES POSITIONS render ─────────────────────────────────────────
    try {
      const posWrap = document.getElementById('ares-positions-wrap');
      if (posWrap && typeof ARES !== 'undefined' && ARES.positions) {
        const openPositions = ARES.positions.getOpen();
        const posListEl = document.getElementById('ares-positions-list');
        const closeAllBtn = document.getElementById('ares-close-all-btn');
        if (closeAllBtn) closeAllBtn.style.display = openPositions.length >= 2 ? 'inline-block' : 'none';
        if (posListEl) {
          if (openPositions.length === 0) {
            posListEl.innerHTML = '<div style="color:rgba(255,255,255,0.25);font-size:12px;font-family:monospace;padding:2px 0">— none —</div>';
          } else {
            posListEl.innerHTML = openPositions.map(pos => {
              const pnlColor = pos.uPnL > 0 ? 'rgba(0,255,140,0.95)' : pos.uPnL < 0 ? 'rgba(255,60,60,0.95)' : 'rgba(70,200,255,0.95)';
              const pnlSign = pos.uPnL >= 0 ? '+' : '';
              const pnlPctStr = pnlSign + pos.uPnLPct.toFixed(2) + '%';
              const pnlAbsStr = pnlSign + pos.uPnL.toFixed(2) + ' USDT';
              const sideColor = pos.side === 'LONG' ? 'rgba(0,255,140,0.9)' : 'rgba(255,80,80,0.9)';
              const mark = Number.isFinite(pos.markPrice) ? pos.markPrice.toFixed(1) : '—';
              const entry = Number.isFinite(pos.entryPrice) ? pos.entryPrice.toFixed(1) : '—';
              const liq = Number.isFinite(pos.liqPrice) ? pos.liqPrice.toFixed(1) : '—';
              const sz = pos.notional.toFixed(1);
              // P0.8: Enhanced fields for live ARES positions
              const slStr = pos.slPrice ? '$' + pos.slPrice.toFixed(1) : '—';
              const tpStr = pos.tpPrice ? '$' + pos.tpPrice.toFixed(1) : '—';
              const liveTag = pos.isLive ? '<span style="color:#00ff88;font-size:10px;letter-spacing:1px"> LIVE</span>' : '';
              const beTag = pos._slMovedBE ? '<span style="color:#00d9ff;font-size:10px"> BE</span>' : '';
              const reasonStr = pos.reason ? pos.reason.substring(0, 80) : '';
              const closeAction = pos.isLive
                ? `(function(){if(typeof ARES_MONITOR!=='undefined'){ARES_MONITOR.closeLivePosition(ARES.positions.getOpen().find(function(p){return p.id==='${pos.id}';}),${pos.markPrice || 0},'manual');setTimeout(_aresRender,500);}})()`
                : `(function(){if(typeof ARES!=='undefined'&&ARES.positions){ARES.positions.closePosition('${pos.id}');_aresRender();}})()`;
              return `<div style="border-left:2px solid ${pnlColor};padding:4px 6px;margin-bottom:5px;background:rgba(0,0,0,0.25);border-radius:0 3px 3px 0">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1px">
                <span style="font-family:monospace;font-size:13px;color:rgba(255,255,255,0.85);letter-spacing:0.5px">
                  <span style="color:rgba(70,200,255,0.9)">[BTCUSDT]</span>
                  <span style="color:${sideColor};font-weight:700">&nbsp;${pos.side}</span>
                  <span style="color:rgba(255,200,60,0.85)">&nbsp;x${pos.leverage}</span>
                  <span style="color:rgba(255,255,255,0.45)">&nbsp;ISO&nbsp;&nbsp;Size: ${sz} USDT</span>${liveTag}${beTag}
                </span>
                <button onclick="${closeAction}" style="background:rgba(255,50,50,0.18);border:1px solid rgba(255,50,50,0.5);color:rgba(255,100,100,0.9);font-family:monospace;font-size:11px;padding:2px 6px;cursor:pointer;border-radius:2px;letter-spacing:1px">CLOSE</button>
              </div>
              <div style="font-family:monospace;font-size:11px;color:rgba(255,255,255,0.45);margin-bottom:1px">
                Entry ${entry} &nbsp;Mark ${mark} &nbsp;Liq <span style="color:rgba(255,120,50,0.75)">${liq}</span> &nbsp;SL <span style="color:rgba(255,60,60,0.7)">${slStr}</span> &nbsp;TP <span style="color:rgba(0,255,140,0.7)">${tpStr}</span>
              </div>
              <div style="font-family:monospace;font-size:12px;color:${pnlColor};font-weight:700;text-shadow:0 0 8px ${pnlColor}55">
                uPnL ${pnlPctStr} &nbsp; ${pnlAbsStr}
              </div>
              ${reasonStr ? '<div style="font-family:monospace;font-size:11px;color:rgba(255,255,255,0.3);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + reasonStr + '</div>' : ''}
            </div>`;
            }).join('');
          }
        }
      }
    } catch (_) { }

    // 5) Lob dots — setare status per lob
    try {
      // Helper setLobDot(id, level, text)
      // level: ok | bad | warn
      const LOB_COLORS = {
        ok: '#00E5FF',  // cyan electric (science/online)
        bad: '#C1121F',  // crimson profund (risk/fail)
        warn: '#FFB000'   // amber "nuclear" (action/exec)
      };
      function setLobDot(id, level, txt) {
        const col = LOB_COLORS[level] || LOB_COLORS.warn;
        const dotEl = document.getElementById(id + '-c');
        const txtEl = document.getElementById(id);
        if (dotEl) { dotEl.setAttribute('fill', col); dotEl.setAttribute('style', 'filter:drop-shadow(0 0 3px ' + col + ')'); }
        if (txtEl) { txtEl.textContent = txt; txtEl.setAttribute('fill', col); }
      }

      const sid = st.current.id;
      const isBad = sid === 'DEFENSIVE' || sid === 'REVENGE_GUARD';
      const isMortal = isBad && st.consecutiveLoss >= 3;

      // A) Lobul frontal — POLICY
      const policyTxt = isMortal ? 'POLICY: CONSERVATIVE' : isBad ? 'POLICY: DEFENSIVE' : 'POLICY: BALANCED';
      setLobDot('ldot-frontal', isMortal ? 'bad' : isBad ? 'warn' : 'ok', policyTxt);

      // B) Lobul temporal — MEMORY
      const consLoss = st.consecutiveLoss || 0;
      const memTxt = consLoss >= 3 ? 'MEMORY: REPEAT' : consLoss >= 1 ? 'MEMORY: PENALTY' : 'MEMORY: OK';
      setLobDot('ldot-temporal', consLoss >= 3 ? 'bad' : consLoss >= 1 ? 'warn' : 'ok', memTxt);

      // C) Lobul occipital — VISION (regim)
      const reg = (typeof BM !== 'undefined' && BM.regime) ? BM.regime.toUpperCase() : '—';
      const visionOk = reg !== '—' && reg !== 'UNKNOWN' && reg !== 'STALLED';
      const visionClear = reg === 'STRONG_TREND' || reg === 'TREND' || reg === 'RANGE';
      const visionTxt = !visionOk ? 'VISION: STALLED' : visionClear ? 'VISION: CLEAR' : 'VISION: UNCERTAIN';
      setLobDot('ldot-occipital', !visionOk ? 'bad' : visionClear ? 'ok' : 'warn', visionTxt);

      // D) Cerebel — EXEC / EQS
      // EQS estimat din winRate10 (fallback)
      const eqs = (st.winRate10 > 0) ? st.winRate10 : -1;
      const execTxt = eqs < 0 ? 'EXEC: —' : eqs >= 70 ? 'EXEC: GOOD (' + eqs + '%)' : eqs >= 50 ? 'EXEC: OK (' + eqs + '%)' : 'EXEC: BAD (' + eqs + '%)';
      setLobDot('ldot-cerebel', eqs < 0 ? 'warn' : eqs >= 70 ? 'ok' : eqs >= 50 ? 'warn' : 'bad', execTxt);

      // E) Trunchi — SURVIVAL
      const ksActive = (typeof AT !== 'undefined' && AT.killSwitch);
      const dailyCapHit = isMortal;
      const survTxt = ksActive ? 'SURVIVAL: GUARD' : dailyCapHit ? 'SURVIVAL: DEFENSIVE' : 'SURVIVAL: STABLE';
      setLobDot('ldot-trunchi', ksActive || dailyCapHit ? (ksActive ? 'bad' : 'warn') : 'ok', survTxt);

    } catch (_) { }

    // ── COGNITIVE BAR update ─────────────────────────────────────────────
    const cogFill = document.getElementById('ares-cog-fill');
    const cogPct = document.getElementById('ares-cog-pct');
    if (cogFill) cogFill.style.width = clarity + '%';
    if (cogPct) cogPct.textContent = clarity + '%';

    // ── BRAIN SVG — Low-poly exact ca în imagine: creier lateral, fețe colorate, noduri albe ──
    const cx = 168, cy = 135;

    // ══════════════════════════════════════════════════════════════════
    // 28 VERTECȘI — silueta exactă a creierului din imagine
    // Lateral stânga: frontal rotunjit stânga, parietal sus,
    // occipital ascuțit dreapta-jos, cerebel jos-dreapta, trunchi jos
    // ══════════════════════════════════════════════════════════════════
    const V = [
      // Contur exterior (0-15)
      { x: cx - 12, y: cy + 58 },  // 0  trunchi jos
      { x: cx - 35, y: cy + 45 },  // 1  temporal bas
      { x: cx - 68, y: cy + 22 },  // 2  frontal lateral jos
      { x: cx - 80, y: cy - 10 },  // 3  frontal lateral
      { x: cx - 74, y: cy - 44 },  // 4  frontal sus
      { x: cx - 50, y: cy - 70 },  // 5  frontal-parietal
      { x: cx - 15, y: cy - 84 },  // 6  coroana stânga
      { x: cx + 22, y: cy - 80 },  // 7  coroana dreapta
      { x: cx + 55, y: cy - 65 },  // 8  parietal sus
      { x: cx + 82, y: cy - 38 },  // 9  parietal lateral
      { x: cx + 88, y: cy - 5 },   // 10 parietal-occipital
      { x: cx + 78, y: cy + 28 },  // 11 occipital sus
      { x: cx + 62, y: cy + 52 },  // 12 occipital (ascuțit)
      { x: cx + 38, y: cy + 65 },  // 13 cerebel sus
      { x: cx + 14, y: cy + 70 },  // 14 cerebel centru
      { x: cx - 10, y: cy + 62 },  // 15 cerebel-trunchi
      // Noduri interioare (16-27)
      { x: cx - 52, y: cy - 28 },  // 16 frontal interior
      { x: cx - 28, y: cy - 56 },  // 17 frontal-parietal int
      { x: cx + 10, y: cy - 58 },  // 18 parietal interior sus
      { x: cx + 46, y: cy - 40 },  // 19 parietal interior
      { x: cx + 66, y: cy + 10 },  // 20 occipital interior
      { x: cx + 46, y: cy + 42 },  // 21 cerebel interior
      { x: cx + 14, y: cy + 48 },  // 22 cerebel-trunchi int
      { x: cx - 14, y: cy + 32 },  // 23 temporal interior
      { x: cx - 46, y: cy + 8 },   // 24 frontal-temporal int
      { x: cx - 10, y: cy - 18 },  // 25 centru
      { x: cx + 28, y: cy - 8 },   // 26 centru-dreapta
      { x: cx + 10, y: cy + 22 },  // 27 centru-jos
    ];

    // ══════════════════════════════════════════════════════════════════
    // TRIUNGHIURI — 36 fețe, organizate pe 6 zone cu culori diferite
    // z=0 frontal(roz/mov), z=1 parietal(alb), z=2 occipital(albastru deschis)
    // z=3 cerebel(albastru), z=4 trunchi(gri), z=5 interior(dark)
    // ══════════════════════════════════════════════════════════════════
    const TRIS = [
      // Frontal roz/mov
      { t: [0, 1, 24], z: 0 }, { t: [1, 2, 24], z: 0 }, { t: [2, 3, 16], z: 0 },
      { t: [2, 16, 24], z: 0 }, { t: [3, 4, 16], z: 0 }, { t: [4, 5, 17], z: 0 },
      { t: [4, 16, 17], z: 0 }, { t: [5, 6, 17], z: 0 },
      // Parietal alb-albastru
      { t: [6, 7, 17], z: 1 }, { t: [7, 8, 18], z: 1 }, { t: [6, 17, 18], z: 1 },
      { t: [7, 18, 19], z: 1 }, { t: [8, 9, 19], z: 1 }, { t: [9, 10, 19], z: 1 },
      // Occipital albastru deschis
      { t: [10, 11, 20], z: 2 }, { t: [9, 19, 20], z: 2 }, { t: [10, 20, 19], z: 2 },
      { t: [11, 12, 20], z: 2 },
      // Cerebel albastru mediu
      { t: [12, 13, 21], z: 3 }, { t: [13, 14, 22], z: 3 }, { t: [12, 21, 22], z: 3 },
      { t: [14, 15, 22], z: 3 },
      // Trunchi gri
      { t: [0, 15, 23], z: 4 }, { t: [15, 22, 23], z: 4 }, { t: [0, 23, 24], z: 4 },
      // Interior dark (centru creier)
      { t: [16, 17, 25], z: 5 }, { t: [17, 18, 25], z: 5 }, { t: [18, 19, 26], z: 5 },
      { t: [17, 25, 26], z: 5 }, { t: [19, 20, 26], z: 5 }, { t: [20, 21, 26], z: 5 },
      { t: [21, 22, 27], z: 5 }, { t: [22, 23, 27], z: 5 }, { t: [23, 24, 25], z: 5 },
      { t: [24, 16, 25], z: 5 }, { t: [25, 26, 27], z: 5 }, { t: [26, 20, 27], z: 5 },
    ];

    // Culori zone (A=luminos, B=întunecat) — puls alternant = efect 3D
    const ZC = [
      ['#e855a8', '#88226655'],  // 0 frontal roz/mov
      ['#d8e8ff', '#5577bb44'],  // 1 parietal alb-bleu
      ['#88ccff', '#1144aa33'],  // 2 occipital bleu deschis
      ['#5599ee', '#0a2a6633'],  // 3 cerebel bleu
      ['#3366aa', '#0a1a4422'],  // 4 trunchi gri-bleu
      ['#0d1a30', '#060e1ecc'],  // 5 interior dark
    ];

    // Noduri hot — se aprind mai tare (vârfurile mari din imagine)
    const HOT = new Set([0, 5, 6, 9, 12, 14, 17, 18, 20, 25, 26]);

    // Edges deduplicate
    const _eSet = new Set(); const EDGES = [];
    TRIS.forEach(({ t: [a, b, c] }) => {
      [[a, b], [b, c], [a, c]].forEach(([p, q]) => {
        const k = Math.min(p, q) + '-' + Math.max(p, q);
        if (!_eSet.has(k)) { _eSet.add(k); EDGES.push([p, q]); }
      });
    });

    // Zone anatomice (etichete MICI pe creier, nu lateral)
    const ZONES = [
      { name: 'FRONTAL', f1: 'Decizie·Risc', col: '#2962FF', lx: cx - 52, ly: cy - 8 },
      { name: 'PARIETAL', f1: 'Mișcare·Simț', col: '#00E5FF', lx: cx + 18, ly: cy - 60 },
      { name: 'OCCIPITAL', f1: 'Vizual·Chart', col: '#00E5FF', lx: cx + 72, ly: cy + 14 },
      { name: 'CEREBEL', f1: 'Echilibru·SL', col: '#FFB000', lx: cx + 32, ly: cy + 58 },
      { name: 'TRUNCHI', f1: 'AutoTrade·Kill', col: '#C1121F', lx: cx - 12, ly: cy + 52 },
      { name: 'TEMPORAL', f1: 'Memorie·Timp', col: '#2962FF', lx: cx - 65, ly: cy + 18 },
    ];

    // ════════════════════════════ SVG BUILD ═══════════════════════════
    let svg = `
  <defs>
    <radialGradient id="bgG" cx="50%" cy="50%" r="55%">
      <stop offset="0%"   stop-color="#33006622"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
    <radialGradient id="pinkG" cx="30%" cy="58%" r="42%">
      <stop offset="0%"   stop-color="#cc224477"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
    <filter id="fN" x="-120%" y="-120%" width="340%" height="340%">
      <feGaussianBlur stdDeviation="3.5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <ellipse cx="${cx - 25}" cy="${cy + 12}" rx="72" ry="68"
    fill="url(#pinkG)" style="animation:aresBrainPulse ${(pulseSpeed * 0.7).toFixed(1)}s ease-in-out infinite"/>
  <ellipse cx="${cx}" cy="${cy}" rx="105" ry="95" fill="url(#bgG)"/>
  `;

    // Fețe triunghiuri — puls per față
    TRIS.forEach(({ t: [a, b, c], z }, i) => {
      const [ca, cb] = ZC[z];
      const pts = `${V[a].x},${V[a].y} ${V[b].x},${V[b].y} ${V[c].x},${V[c].y}`;
      const light = (a + b + c) % 2 === 0;
      const fill = light ? ca + '2a' : cb;
      const dur = (2.8 + (i % 9) * 0.4).toFixed(1);
      const del = (i * 0.16 % 3.5).toFixed(2);
      svg += `<polygon points="${pts}" fill="${fill}"
      style="animation:aresNodePulse ${dur}s ease-in-out infinite ${del}s"/>`;
    });

    // Muchii albe
    EDGES.forEach(([a, b], i) => {
      const hot = HOT.has(a) || HOT.has(b);
      const op = hot ? '0.88' : '0.32';
      const lw = hot ? 1.3 : 0.65;
      const dur = (2.0 + (i % 7) * 0.45).toFixed(1);
      svg += `<line x1="${V[a].x}" y1="${V[a].y}" x2="${V[b].x}" y2="${V[b].y}"
      stroke="white" stroke-width="${lw}" stroke-opacity="${op}"
      ${hot ? `style="animation:aresLineFlow ${dur}s linear infinite ${(i * 0.06).toFixed(2)}s"` : ''}/>`;
    });

    // Noduri albe
    V.forEach((n, i) => {
      const hot = HOT.has(i);
      const r = hot ? 4.8 : 2.6;
      const dur = (1.4 + (i % 8) * 0.28).toFixed(1);
      const del = (i * 0.12).toFixed(2);
      svg += `
    <circle cx="${n.x}" cy="${n.y}" r="${r + 6}" fill="white" opacity="0.05" filter="url(#fN)"/>
    <circle cx="${n.x}" cy="${n.y}" r="${r}" fill="white"
      style="filter:drop-shadow(0 0 ${hot ? 8 : 4}px white) drop-shadow(0 0 ${hot ? 16 : 6}px #88aaff);
             animation:aresNodePulse ${dur}s ease-in-out infinite ${del}s"/>`;
    });

    // Particule curg pe muchii
    EDGES.filter((_, i) => i % 2 === 0).forEach(([a, b], i) => {
      const dur = (1.5 + i * 0.2).toFixed(1);
      svg += `<circle r="2" fill="white" opacity="0.85"
      style="filter:drop-shadow(0 0 5px white)">
      <animateMotion dur="${dur}s" repeatCount="indefinite" begin="${(i * 0.22).toFixed(1)}s"
        path="M${V[a].x},${V[a].y} L${V[b].x},${V[b].y}"/>
    </circle>`;
    });

    // Etichete mici pe creier
    ZONES.forEach((z, zi) => {
      const active = st.confidence > 30 + zi * 8;
      const op = active ? '0.9' : '0.42';
      svg += `
    <circle cx="${z.lx}" cy="${z.ly}" r="3" fill="${z.col}" opacity="${op}"
      style="filter:drop-shadow(0 0 5px ${z.col})"/>
    <text x="${z.lx}" y="${z.ly - 7}" text-anchor="middle"
      font-family="monospace" font-size="6" font-weight="900"
      fill="${z.col}" opacity="${op}">${z.name}</text>
    <text x="${z.lx}" y="${z.ly + 5}" text-anchor="middle"
      font-family="monospace" font-size="4.5" fill="${z.col}" opacity="${Number(op) * 0.65}">${z.f1}</text>`;
    });

    // Brain SVG randat O SINGURĂ DATĂ la init prin initAriaBrain()
    // _aresRender updatează doar badge/stats — nu mai rescrie SVG-ul
    if (!panel.dataset.abInit) { initAriaBrain(); panel.dataset.abInit = '1'; }

    // ── THOUGHT STREAM cu date reale + cognitive insights ────────────────
    const thoughtInner = document.getElementById('ares-thought-inner');
    if (thoughtInner) {
      const mindInsight = ARES_MIND.getPatternInsight();
      const price = (typeof S !== 'undefined' && S.price > 0) ? fP(S.price) : '—';
      const regime = (typeof BM !== 'undefined' ? BM.regime : null) || '—';
      const cogLines = [
        `COGNITIV: ${mindInsight}`,
        `PREDICȚIE: ${predAcc != null ? predAcc + '% acuratețe pe ultimele semnale' : 'în colectare date...'}`,
        `CLARITATE MENTALĂ: ${clarity}% — ${clarity > 75 ? 'OPTIMAL' : clarity > 50 ? 'ACCEPTABIL' : 'RECALIBREZ'}`,
        `PREȚ CURENT: ${price} — REGIM: ${regime}`,
      ];
      const combined = [...cogLines, ...st.thoughtLines, ...cogLines, ...st.thoughtLines];
      thoughtInner.style.animation = `aresThoughtScroll ${Math.max(14, combined.length * 1.2)}s linear infinite`;
      thoughtInner.innerHTML = combined.map((l, i) => {
        const isCog = i < cogLines.length || (i >= st.thoughtLines.length + cogLines.length && i < combined.length - st.thoughtLines.length);
        const isAlert = l.toLowerCase().includes('alertă') || l.toLowerCase().includes('recalib');
        return `<div class="ares-thought-line${i === 0 ? ' new' : isAlert ? ' alert' : isCog ? ' new' : ''}">
        <span style="color:${col}66">›</span> ${escHtml(l)}
      </div>`;
      }).join('');
    }

    // ── STATS ROW — 4 celule (+ predicție) ──────────────────────────────
    const statDelta = document.getElementById('ares-stat-delta');
    const statDay = document.getElementById('ares-stat-day');
    const statWR = document.getElementById('ares-stat-wr');
    const statPred = document.getElementById('ares-stat-pred');
    const st2 = ARES.getState();
    if (statDelta) {
      const d = st2.trajectoryDelta;
      statDelta.textContent = (d >= 0 ? '+' : '') + d + '%';
      statDelta.style.color = d >= 0 ? '#00ff88' : '#ff4466';
    }
    if (statDay) statDay.textContent = Math.floor(st2.daysPassed) + ' / 365';
    if (statWR) statWR.textContent = st2.winRate10 + '%';
    if (statPred) {
      statPred.textContent = predAcc != null ? predAcc + '%' : '—';
      statPred.style.color = predAcc != null ? (predAcc > 55 ? '#00d9ff' : '#ff9944') : '#445566';
    }

    // Update mission arc
    _aresRenderArc();

    // Update lesson + cognitive insight
    const lessonEl = document.getElementById('ares-lesson-text');
    if (lessonEl) lessonEl.textContent = st2.lastLesson + '  |  ' + ARES_MIND.getPatternInsight();

    // Update history dots
    const histBar = document.getElementById('ares-history-bar');
    if (histBar && st2.tradeHistory.length) {
      histBar.innerHTML = st2.tradeHistory.map(w =>
        `<div class="ares-hist-dot" style="background:${w ? '#0080ff66' : '#ff446666'};border:1px solid ${w ? '#00d9ff' : '#ff4466'};box-shadow:0 0 4px ${w ? '#00d9ff44' : '#ff446644'}"></div>`
      ).join('');
    }
  } catch (e) { console.warn('[_aresRender]', e && e.message ? e.message : e); } // [v119-p10 FIX]
}

function _aresRenderArc() {
  try { // [v119-p10 FIX]
    if (typeof _balance === 'undefined') return; // [v122 BONUS] _balance is IIFE-scoped; guard prevents ReferenceError
    const svg = document.getElementById('ares-arc-svg');
    if (!svg) return;
    const st = ARES.getState();
    const pct = st.startBalance ? Math.min(1, (_balance() - st.startBalance) / (TARGET - st.startBalance)) : 0;
    const tPct = st.startBalance ? Math.min(1, (st.targetBalance - st.startBalance) / (TARGET - st.startBalance)) : 0;
    const col = st.current.color;

    const W = 260, H = 56, pad = 20;
    const arcW = W - pad * 2;

    // Progress values to x positions
    const xActual = pad + pct * arcW;
    const xTarget = pad + tPct * arcW;

    svg.innerHTML = `
        <line x1="${pad}" y1="32" x2="${pad + arcW}" y2="32" stroke="#0a1520" stroke-width="4" stroke-linecap="round"/>
        <line x1="${pad}" y1="32" x2="${pad + arcW}" y2="32" stroke="${col}22" stroke-width="2" stroke-dasharray="3 5" stroke-linecap="round"/>
        <line x1="${pad}" y1="32" x2="${xActual.toFixed(1)}" y2="32" stroke="${col}" stroke-width="3" stroke-linecap="round"
      style="filter:drop-shadow(0 0 4px ${col})"/>
        <line x1="${xTarget.toFixed(1)}" y1="26" x2="${xTarget.toFixed(1)}" y2="38" stroke="${col}88" stroke-width="1" stroke-dasharray="2 2"/>
        <circle cx="${xActual.toFixed(1)}" cy="32" r="5" fill="${col}" stroke="#010408" stroke-width="2"
      style="filter:drop-shadow(0 0 8px ${col});animation:aresCoreDot 1.5s ease-in-out infinite"/>
        <text x="${pad}" y="52" font-family="monospace" font-size="7" fill="${col}44">$${st.startBalance ? Math.round(st.startBalance).toLocaleString() : '?'}</text>
    <text x="${pad + arcW}" y="52" font-family="monospace" font-size="7" fill="${col}44" text-anchor="end">$1,000,000</text>
    <text x="${pad + arcW / 2}" y="16" font-family="monospace" font-size="6" fill="${col}88" text-anchor="middle" letter-spacing="2">MISSION ARC — DAY ${Math.floor(st.daysPassed)}/${365}</text>
        ${Math.abs(st.trajectoryDelta) > 0.1 ? `
    <text x="${xActual.toFixed(1)}" y="${xActual > xTarget ? '22' : '46'}"
      font-family="monospace" font-size="6" fill="${st.trajectoryDelta >= 0 ? '#00ff88' : '#ff4466'}"
      text-anchor="middle" style="filter:drop-shadow(0 0 4px ${st.trajectoryDelta >= 0 ? '#00ff88' : '#ff4466'})">
      ${st.trajectoryDelta >= 0 ? '+' : ''}${st.trajectoryDelta}%
    </text>` : ''}
  `;
  } catch (e) { console.warn("[_aresRenderArc]", e && e.message ? e.message : e); } // [v119-p10 FIX]
}


// ══════════════════════════════════════════════════════════════════════
// ARIA BRAIN — Overlay exact cu 136 noduri detectate din imagine
// Chirurgical: doar SVG overlay + CSS scoped, zero impact pe restul app
// ══════════════════════════════════════════════════════════════════════
(function _ariaBrainCSS() {
  const s = document.createElement('style');
  s.textContent = `
  /* ARIA BRAIN — scoped */
  #aria-brain-wrap { position:relative; width:100%; overflow:visible; }
  #aria-brain-svg  { width:100%; max-width:336px; height:auto; display:block; margin:0 auto; }

  @keyframes ariaPulse {
    0%,100% { opacity:.25; r:2.2; }
    50%      { opacity:.92;  r:3.6; }
  }
  @keyframes ariaHot {
    0%,100% { opacity:.40; r:3.5; }
    50%      { opacity:.95;  r:5.5; }
  }
  @keyframes ariaZone {
    0%,100% { opacity:.12; }
    50%      { opacity:.32; }
  }
  @keyframes ariaEdge {
    0%   { stroke-dashoffset:60; opacity:.08; }
    50%  { opacity:.45; }
    100% { stroke-dashoffset:0; opacity:.08; }
  }
  @keyframes ariaParticle {
    0%   { opacity:0; }
    20%  { opacity:.9; }
    80%  { opacity:.7; }
    100% { opacity:0; }
  }
  `;
  document.head.appendChild(s);
})();

/* v114 micro CSS injected via style tag */
(function _v114CSS() {
  const s = document.createElement('style');
  s.textContent = `
/* ═══════════════════════════════════════════════════════════════
   ARES v114 — micro additions: lob dots, stage progress, IMM, emotions
   SCOPED — zero impact pe restul app
   ═══════════════════════════════════════════════════════════════ */

/* ── Header bar extras ─────────────────────────────────────────── */
#ares-imm-span {
  font-size:11px; color:#f0c04088; letter-spacing:1px;
  font-family:monospace; white-space:nowrap;
}
#ares-wound-line {
  font-size:13px; color:#ff335588; letter-spacing:1px;
  font-family:monospace; padding:1px 10px 0;
  display:none;
}
#ares-decision-line {
  font-size:12px; letter-spacing:0.5px;
  font-family:monospace; padding:1px 10px 0;
  display:none;
}

/* ── Stage + Objectives row ────────────────────────────────────── */
#ares-meta-row {
  display:flex; justify-content:space-between; align-items:flex-start;
  padding:6px 12px 2px; gap:8px; position:relative; z-index:2;
}
#ares-stage-col {
  flex:0 0 auto; min-width:110px;
}
#ares-obj-col {
  flex:0 0 auto; text-align:right; min-width:130px;
}
.ares-meta-title {
  font-size:11px; letter-spacing:2px; color:#0080ff66;
  font-family:monospace; margin-bottom:2px; text-transform:uppercase;
}
.ares-stage-name {
  font-size:10px; color:#00ff88e8; font-family:monospace;
  letter-spacing:1px; font-weight:700;
}
.ares-prog-bar {
  font-size:13px; color:#00ff88bb; font-family:monospace;
  letter-spacing:0; margin-top:1px;
}
.ares-prog-next {
  font-size:12px; color:#0080ff99; font-family:monospace; margin-top:1px;
}
.ares-obj-item {
  font-size:13px; font-family:monospace; margin-bottom:3px;
  opacity:0.82; color:#8899aa;
}
.ares-obj-item.active { color:#00ff88cc; opacity:0.92; }
.ares-obj-item.done   { color:#00d9ff88; opacity:0.75; }
.ares-obj-bar {
  font-size:12px; font-family:monospace; color:#00ff8877; margin-top:0px;
}

/* ── Lob status dots (SVG text overlay — stilizare via fill/opacity pe SVG) */
/* Nimic extra CSS — se gestionează din JS setAttribute pe SVG text */

/* ── Emotion suffix pe badge ───────────────────────────────────── */
#ares-emotion-span {
  font-size:11px; color:#ffffff66; letter-spacing:1px;
  font-family:monospace; margin-left:2px;
}
`;
  document.head.appendChild(s);
})();

/* v116 OBJECTIVES + POSITIONS CSS */
(function _v116CSS() {
  const s = document.createElement('style');
  s.textContent = `
:root {
  --obj1: rgba(0,255,140,0.95);
  --obj2: rgba(70,200,255,0.95);
  --obj3: rgba(255,200,60,0.95);
}
/* Objectives v116 — bright, real progress */
.ares-obj-item {
  font-size:12px; font-family:monospace; margin-bottom:1px;
  letter-spacing:0.3px; opacity:1;
}
.ares-obj-item.active { font-weight:700; }
.ares-obj-item.done   { opacity:0.65; }
.ares-obj-bar {
  font-size:11px; font-family:monospace; margin-bottom:4px;
}

/* POSITIONS block */
#ares-positions-wrap {
  border-top: 1px solid rgba(0,150,255,0.12);
}
#ares-positions-list::-webkit-scrollbar { width:3px; }
#ares-positions-list::-webkit-scrollbar-thumb { background:rgba(0,200,255,0.25); border-radius:2px; }
#ares-close-all-btn:hover {
  background: rgba(255,50,50,0.3) !important;
  border-color: rgba(255,80,80,0.7) !important;
}
`;
  document.head.appendChild(s);
})();

/* ── ARES META ROW — ALIGNMENT FIX (v118-2 patch) — v2 MOBILE SAFE ──
   Replace the previous (function _aresMetaLayoutFix(){...})(); block with this.
*/
(function _aresMetaLayoutFix_v2() {
  const s = document.createElement('style');
  s.textContent = `
/* Base: stable 3-column grid, no overflow */
#ares-meta-row{
  display:grid !important;
  grid-template-columns: minmax(120px, 1fr) minmax(108px, .92fr) minmax(120px, 1fr) !important;
  align-items:start !important;
  gap: 8px !important;
  padding: 6px 10px 2px !important;
  box-sizing:border-box !important;
  width:100% !important;
}
#ares-stage-col, #ares-wallet-col, #ares-obj-col{
  min-width:0 !important;
  overflow:hidden !important;
  box-sizing:border-box !important;
}
#ares-stage-col{ padding-left: 14px !important; }
#ares-wallet-col{ padding: 0 4px !important; }
#ares-obj-col{ padding-right: 6px !important; }

/* Objectives: prevent bleed */
#ares-obj-col .ares-obj-item,
#ares-obj-col .ares-obj-bar{
  white-space:nowrap !important;
  overflow:hidden !important;
  text-overflow:ellipsis !important;
}

/* POSITIONS block: keep it off the hard-left edge */
#ares-positions-wrap{
  padding-left: 14px !important;
  padding-right: 12px !important;
  box-sizing:border-box !important;
}
/* Open positions cards are injected with inline padding;
   we shift them safely using margin-left (not overridden inline). */
#ares-positions-list > div{
  margin-left: 10px !important;
}
/* The "— none —" placeholder is also a div; keep it aligned */
#ares-positions-list > div[style*="— none —"]{
  margin-left: 10px !important;
}

/* ── MOBILE portrait tightening: pulls everything inward so Objectives never exits ── */
@media (max-width: 420px){
  #ares-meta-row{
    grid-template-columns: minmax(108px, 1fr) minmax(96px, .88fr) minmax(108px, 1fr) !important;
    gap: 6px !important;
    padding: 6px 6px 2px !important;
  }
  #ares-stage-col{ padding-left: 16px !important; }
  #ares-wallet-col{ padding: 0 2px !important; }
  #ares-obj-col{ padding-right: 4px !important; }

  /* Slightly tighter typography to avoid overflow */
  #ares-obj-col .ares-obj-item{ font-size: 11px !important; letter-spacing: .2px !important; }
  #ares-obj-col .ares-obj-bar{  font-size: 11px !important; }

  /* Positions: still not glued to the edge */
  #ares-positions-wrap{ padding-left: 12px !important; padding-right: 10px !important; }
  #ares-positions-list > div{ margin-left: 8px !important; }
}

/* ── Ultra-narrow devices (tiny phones): last resort safe clamp ── */
@media (max-width: 360px){
  #ares-meta-row{
    grid-template-columns: minmax(100px, 1fr) minmax(88px, .82fr) minmax(100px, 1fr) !important;
    gap: 5px !important;
    padding: 6px 5px 2px !important;
  }
  #ares-obj-col .ares-obj-item{ font-size: 12px !important; }
  #ares-obj-col .ares-obj-bar{  font-size: 11px !important; }
}
`;
  document.head.appendChild(s);
})();

// ===============================
// ARES Desktop Readability Enhancement (CSS only, no logic)
// Makes all ARES panel text larger and more readable on desktop
// Mobile stays untouched via min-width media query
// ===============================
(function _aresDesktopCSS() {
  const s = document.createElement('style');
  s.id = 'ares-desktop-readability';
  s.textContent = `
@media (min-width: 768px) {

  /* ── Strip Header Bar ── */
  #ares-strip-bar { height:44px !important; padding:0 14px !important; }
  #ares-strip-title { font-size:13px !important; letter-spacing:5px !important; gap:8px !important; }
  #ares-strip-title > span:first-child { font-size:15px !important; }
  #ares-strip-title > span:last-child { font-size:13px !important; letter-spacing:1.5px !important; }
  #ares-strip-badge { font-size:10px !important; padding:3px 10px !important; letter-spacing:1.2px !important; }
  #ares-strip-conf { font-size:10.5px !important; letter-spacing:1.2px !important; }
  #ares-strip-chev { font-size:11px !important; }
  #ares-imm-span { font-size:10px !important; letter-spacing:1.2px !important; }
  #ares-emotion-span { font-size:10px !important; }

  /* ── Wound / Decision Lines ── */
  #ares-wound-line { font-size:11px !important; padding:2px 14px 0 !important; }
  #ares-decision-line { font-size:11px !important; padding:3px 14px 0 !important; }

  /* ── Expand main panel max-height for larger content ── */
  #ares-strip.open #ares-strip-panel { max-height:1200px !important; }

  /* ── Meta Titles (STAGE PROGRESS, WALLET, OBJECTIVES, POSITIONS) ── */
  .ares-meta-title { font-size:13px !important; letter-spacing:2.5px !important; margin-bottom:3px !important; }

  /* ── Stage Progress ── */
  .ares-stage-name { font-size:14px !important; letter-spacing:1.5px !important; }
  .ares-prog-bar { font-size:12px !important; margin-top:2px !important; }
  .ares-prog-next { font-size:10.5px !important; margin-top:2px !important; }

  /* ── Wallet Column ── */
  #ares-wallet-col { min-width:140px !important; padding:0 10px !important; }
  #ares-wallet-balance { font-size:16px !important; letter-spacing:1.5px !important; }
  #ares-wallet-avail { font-size:13px !important; margin-top:2px !important; }
  #ares-wallet-add-btn { font-size:13px !important; padding:3px 10px !important; }
  #ares-wallet-withdraw-btn { font-size:13px !important; padding:3px 10px !important; }
  #ares-wallet-withdraw-tip { font-size:12px !important; }
  #ares-wallet-fail { font-size:13px !important; padding:2px 7px !important; }

  /* ── Objectives ── */
  .ares-obj-item { font-size:10.5px !important; margin-bottom:4px !important; letter-spacing:.4px !important; }
  .ares-obj-bar { font-size:13px !important; margin-bottom:5px !important; }

  /* ── Meta Row Grid — widen for larger text ── */
  #ares-meta-row {
    gap:12px !important;
    padding:8px 14px 4px !important;
  }

  /* ── Positions Block ── */
  #ares-positions-wrap { margin:6px 14px 0 !important; padding:6px 0 4px !important; }
  #ares-close-all-btn { font-size:13px !important; padding:3px 9px !important; }
  #ares-positions-list { max-height:280px !important; }
  /* Position cards — override deeply nested inline font-sizes */
  #ares-positions-list > div { margin-bottom:6px !important; padding:5px 8px !important; }
  #ares-positions-list > div span { font-size:10.5px !important; }
  #ares-positions-list > div button { font-size:13px !important; padding:3px 8px !important; }
  #ares-positions-list > div > div:nth-child(2) { font-size:13px !important; }
  #ares-positions-list > div > div:nth-child(3) { font-size:10.5px !important; }
  #ares-positions-list > div > div:nth-child(4) { font-size:13px !important; }

  /* ── Cognitive Clarity Bar ── */
  #ares-cog-bar { margin:6px 14px 8px !important; gap:10px !important; }
  #ares-cog-label { font-size:12px !important; letter-spacing:2.5px !important; }
  #ares-cog-track { height:5px !important; }
  #ares-cog-fill { height:5px !important; }
  #ares-cog-pct { font-size:13px !important; min-width:36px !important; }

  /* ── Stats Row (4-column) ── */
  #ares-stats-row { margin:8px 14px !important; gap:2px !important; }
  .ares-stat-cell { padding:7px 6px !important; }
  .ares-stat-label { font-size:11px !important; letter-spacing:1.5px !important; margin-bottom:3px !important; }
  .ares-stat-val { font-size:13px !important; letter-spacing:1.2px !important; }
  .ares-stat-sub { font-size:11px !important; margin-top:2px !important; }

  /* ── Thought Stream ── */
  #ares-thought-wrap { height:100px !important; margin:6px 14px !important; }
  .ares-thought-line { font-size:13px !important; padding:3px 10px !important; line-height:1.9 !important; letter-spacing:.6px !important; }

  /* ── Last Lesson ── */
  #ares-lesson-wrap { margin:8px 14px 12px !important; padding:9px 12px !important; }
  #ares-lesson-label { font-size:13px !important; letter-spacing:2.5px !important; margin-bottom:5px !important; }
  #ares-lesson-text { font-size:10px !important; line-height:1.8 !important; letter-spacing:.4px !important; }
  #ares-history-bar { gap:3px !important; margin-top:8px !important; }
  .ares-hist-dot { width:18px !important; height:10px !important; }

  /* ── Mission Arc SVG ── */
  #ares-arc-wrap { padding:14px 14px 0 !important; }
  #ares-arc-svg { height:72px !important; }

}
`;
  document.head.appendChild(s);
})();

// ===============================
// ARES Brain Color Override (no-logic, CSS only)
// Re-map pink/purple/magenta -> science/power palette
// ===============================
(function ARES_BRAIN_COLOR_OVERRIDE() {
  try {
    if (document.getElementById('ares-brain-color-override')) return;

    const css = `
/* --- TEXT (lob labels etc.) inline style colors --- */
#ares-strip [style*="#bb44ff"],
#ares-strip [style*="rgb(187, 68, 255)"] { color:#2962FF !important; } /* cobalt */

#ares-strip [style*="#ff66"],
#ares-strip [style*="#ff3355"],
#ares-strip [style*="rgb(255, 51, 85)"],
#ares-strip [style*="rgb(255, 102, 170)"] { color:#C1121F !important; } /* crimson */

#ares-strip [style*="#ff77ff"],
#ares-strip [style*="#ff55cc"],
#ares-strip [style*="rgb(255, 85, 204)"] { color:#2962FF !important; } /* cobalt */

/* --- SVG nodes: override exact old fills/strokes --- */
#ares-strip svg [fill="#bb44ff"],
#ares-strip svg [fill="rgb(187,68,255)"] { fill:#2962FF !important; }

#ares-strip svg [stroke="#bb44ff"],
#ares-strip svg [stroke="rgb(187,68,255)"] { stroke:#2962FF !important; }

#ares-strip svg [fill="#ff3355"],
#ares-strip svg [fill="rgb(255,51,85)"] { fill:#C1121F !important; }

#ares-strip svg [stroke="#ff3355"],
#ares-strip svg [stroke="rgb(255,51,85)"] { stroke:#C1121F !important; }

#ares-strip svg [fill="#39ff14"],
#ares-strip svg [stroke="#39ff14"] { fill:#00E5FF !important; stroke:#00E5FF !important; } /* cyan */

/* brainViz nodes */
#brainViz svg [fill="#bb44ff"],
#brainViz svg [stroke="#bb44ff"] { fill:#2962FF !important; stroke:#2962FF !important; }
#brainViz svg [fill="#ff3355"],
#brainViz svg [stroke="#ff3355"] { fill:#C1121F !important; stroke:#C1121F !important; }
#brainViz svg [fill="#39ff14"],
#brainViz svg [stroke="#39ff14"] { fill:#00E5FF !important; stroke:#00E5FF !important; }

/* --- neutral / inactive nodes (make colder, less cute) --- */
#ares-strip .b-node,
#ares-strip .brain-node,
#brainViz .b-node { stroke:#4B5D73 !important; }
`;

    const st = document.createElement('style');
    st.id = 'ares-brain-color-override';
    st.textContent = css;
    document.head.appendChild(st);
  } catch (e) { }
})();

function initAriaBrain() {
  try { // [v119-p12 FIX] outer try/catch — protejează setTimeout(initAriaBrain,200) de la boot (linia ~20526)
    // [v119-p9 FIX] Guard anti-double-init:
    // initAriaBrain() este apelata atât din setTimeout(200ms) cât și din _aresRender().
    // A doua apelare distruge DOM-ul primului RAF loop → TypeError necontrolat → ENGINE ERROR.
    // Soluție: flag global setat DOAR după ce panel-ul a fost găsit și inițializat cu succes.
    if (window.__ARIA_BRAIN_INIT__) return;

    const panel = document.getElementById('ares-core-svg');
    if (!panel) return; // nu setăm flag-ul — va putea reîncerca când ARES se deschide

    window.__ARIA_BRAIN_INIT__ = true; // [v119-p9] setat DUPĂ confirmare panel valid

    // ── 136 noduri detectate programatic din imaginea de referință ──────
    console.log('[ARIA BRAIN] nodeCount =', 136);
    const BRAIN_NODES = [[175.8, 93.6], [105.6, 172.3], [106.7, 127.4], [91.9, 115.7], [84.0, 149.6], [167.4, 87.2], [224.9, 146.7], [192.7, 169.4], [217.0, 139.1], [177.9, 104.1], [122.5, 82.5], [131.5, 177.6], [136.7, 204.4], [112.5, 91.8], [84.0, 123.3], [92.4, 105.3], [184.3, 164.2], [164.7, 125.7], [59.7, 82.5], [154.2, 161.2], [148.4, 92.4], [141.0, 192.1], [204.3, 95.3], [247.1, 122.7], [93.5, 175.2], [114.6, 250.5], [38.0, 104.1], [53.3, 161.8], [170.0, 230.1], [249.2, 132.7], [238.1, 202.6], [152.6, 141.4], [289.8, 233.6], [113.0, 79.6], [278.2, 107.6], [75.0, 11.9], [213.3, 200.3], [136.2, 142.6], [94.0, 132.1], [100.9, 179.9], [100.9, 95.9], [101.4, 199.7], [74.5, 151.9], [40.1, 178.7], [164.7, 149.0], [183.7, 87.8], [197.5, 100.6], [173.7, 133.2], [139.9, 78.4], [119.3, 179.3], [60.2, 199.7], [123.0, 63.3], [118.3, 128.0], [166.8, 175.2], [128.3, 122.7], [226.5, 88.9], [162.6, 114.0], [149.4, 179.3], [80.3, 199.1], [71.8, 130.3], [74.5, 77.8], [230.2, 156.0], [70.2, 169.4], [180.0, 68.5], [261.9, 141.4], [80.3, 90.7], [105.1, 140.8], [111.9, 155.4], [245.0, 178.7], [77.6, 182.2], [153.6, 100.0], [156.3, 64.4], [220.2, 74.3], [201.2, 152.5], [124.1, 111.7], [122.5, 51.0], [104.5, 83.1], [201.7, 185.7], [72.3, 103.5], [107.2, 209.6], [73.9, 116.9], [80.8, 158.3], [252.9, 110.5], [217.0, 179.3], [184.8, 137.3], [170.0, 213.1], [146.8, 125.1], [180.6, 153.1], [94.5, 160.1], [132.5, 156.6], [160.0, 30.6], [231.2, 36.4], [203.3, 77.3], [183.2, 116.9], [96.6, 218.4], [114.6, 233.6], [76.6, 46.3], [103.0, 228.9], [128.8, 268.0], [75.0, 62.7], [34.3, 82.5], [306.2, 107.6], [203.8, 173.5], [307.8, 191.0], [120.9, 195.1], [191.1, 209.6], [236.0, 191.6], [158.4, 207.3], [243.9, 72.6], [145.7, 114.0], [126.7, 101.8], [294.1, 107.6], [227.5, 121.0], [198.5, 124.5], [279.3, 188.1], [186.4, 195.1], [240.7, 233.6], [44.9, 200.3], [212.2, 229.5], [166.8, 261.6], [121.4, 37.0], [289.8, 195.6], [238.1, 266.2], [44.4, 82.5], [224.9, 105.8], [205.9, 111.7], [223.9, 163.0], [60.7, 135.6], [95.0, 206.1], [262.9, 153.1], [90.3, 184.6], [165.8, 201.5], [123.6, 208.5], [161.0, 183.4], [36.4, 229.5], [28.0, 182.8]];
    const N = BRAIN_NODES.length;

    // ── Noduri "hot" — cele mai luminoase (detecție prin intensitate) ───
    // Indecșii corespund nodurilor cu clustering-size mare (>80px)
    const HOT_IDX = new Set([0, 5, 9, 22, 23, 29, 31, 34, 55, 63, 72, 82, 91, 92, 101, 108, 111, 112, 124, 125]);

    // ── Conexiuni: fiecare nod se conectează la cei mai apropiați 2-3 vecini
    function buildEdges(nodes, maxDist = 52, maxPer = 3) {
      const edges = [];
      const used = new Set();
      for (let i = 0; i < nodes.length; i++) {
        const [ax, ay] = nodes[i];
        // distanțe la toți ceilalți
        const dists = nodes.map(([bx, by], j) => ({ j, d: Math.hypot(bx - ax, by - ay) }))
          .filter(({ j, d }) => j !== i && d < maxDist)
          .sort((a, b) => a.d - b.d)
          .slice(0, maxPer);
        for (const { j } of dists) {
          const key = Math.min(i, j) + '-' + Math.max(i, j);
          if (!used.has(key)) { used.add(key); edges.push([i, j]); }
        }
      }
      return edges;
    }
    const EDGES = buildEdges(BRAIN_NODES, 50, 3);

    // ── Cele 6 zone anatomice (coordonate centroid în spațiul SVG) ──────
    // Poziționate corect pe creierul lateral din imagine
    const ZONES = [
      { name: 'Lobul frontal', sub: 'Decizie · Planificare', cx: 85, cy: 110, r: 52, col: '#2962FF', pinX: 87, pinY: 80 },
      { name: 'Lobul parietal', sub: 'Mișcare · Senzații', cx: 190, cy: 95, r: 55, col: '#00E5FF', pinX: 155, pinY: 30 },
      { name: 'Lobul temporal', sub: 'Memorie · Auz', cx: 100, cy: 175, r: 45, col: '#2962FF', pinX: 87, pinY: 178 },
      { name: 'Lobul occipital', sub: 'Vizual · Chart', cx: 240, cy: 145, r: 48, col: '#00E5FF', pinX: 253, pinY: 125 },
      { name: 'Cerebelul', sub: 'Echilibru · SL/TP', cx: 195, cy: 215, r: 42, col: '#FFB000', pinX: 218, pinY: 248 },
      { name: 'Trunchi cerebral', sub: 'AutoTrade · Kill-switch', cx: 140, cy: 215, r: 35, col: '#C1121F', pinX: 127, pinY: 232 },
    ];

    // ── BUILD SVG ────────────────────────────────────────────────────────
    let svg = `
  <defs>
    <filter id="abFN" x="-150%" y="-150%" width="400%" height="400%">
      <feGaussianBlur stdDeviation="4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="abHot" x="-150%" y="-150%" width="400%" height="400%">
      <feGaussianBlur stdDeviation="6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <radialGradient id="abPink" cx="32%" cy="58%" r="40%">
      <stop offset="0%" stop-color="#cc224488"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
    <radialGradient id="abBlue" cx="70%" cy="40%" r="45%">
      <stop offset="0%" stop-color="#0044aa44"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
  </defs>
    <ellipse cx="90" cy="155" rx="80" ry="70" fill="url(#abPink)"
    style="animation:ariaZone 3.5s ease-in-out infinite"/>
  <ellipse cx="230" cy="120" rx="85" ry="75" fill="url(#abBlue)"
    style="animation:ariaZone 4.2s ease-in-out infinite 0.8s"/>
  `;

    // Zone highlights (contur discret + puls)
    ZONES.forEach((z, zi) => {
      const dur = (2.8 + zi * 0.45).toFixed(1);
      const del = (zi * 0.6).toFixed(1);
      svg += `
    <ellipse cx="${z.cx}" cy="${z.cy}" rx="${z.r}" ry="${z.r * 0.72}"
    fill="none" stroke="${z.col}" stroke-width="1" stroke-opacity="0.35"
    stroke-dasharray="5 4"
    style="animation:ariaZone ${dur}s ease-in-out infinite ${del}s"/>`;
    });

    // Edges (linii subțiri albe)
    EDGES.forEach(([a, b], i) => {
      const [ax, ay] = BRAIN_NODES[a], [bx, by] = BRAIN_NODES[b];
      const hot = HOT_IDX.has(a) || HOT_IDX.has(b);
      const op = hot ? '0.55' : '0.22';
      const lw = hot ? 1.0 : 0.55;
      const dur = (2.5 + (i % 8) * 0.4).toFixed(1);
      svg += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"
    stroke="white" stroke-width="${lw}" stroke-opacity="${op}"
    ${hot ? `stroke-dasharray="6 3" style="animation:ariaEdge ${dur}s linear infinite ${(i * 0.05 % 2).toFixed(2)}s"` : ''}/>`;
    });

    // Noduri (136 bucăți exacte) — neuron-star shape, RAF-driven wave
    // PRNG seeded pentru colorGroup stabil
    let _cSeed = 0x7F3A9C21;
    function _cPrng() { _cSeed ^= _cSeed << 13; _cSeed ^= _cSeed >> 17; _cSeed ^= _cSeed << 5; return ((_cSeed >>> 0) / 0xFFFFFFFF); }

    // 25% noduri colored, 75% alb
    const ACCENT_COLS = [
      '#00E5FF', // electric cyan (science/online)
      '#2962FF', // cobalt (authority)
      '#FFB000', // amber (action/exec)
      '#C1121F', // deep crimson (risk/fail)
      '#B0BEC5'  // steel/silver (neutral hardware)
    ];
    const NODE_ACCENT = BRAIN_NODES.map((_, i) => {
      const hot = HOT_IDX.has(i);
      if (hot) return ACCENT_COLS[Math.floor(_cPrng() * ACCENT_COLS.length)]; // hot=colored
      return _cPrng() < 0.22 ? ACCENT_COLS[Math.floor(_cPrng() * ACCENT_COLS.length)] : null; // 22% colored
    });

    // Generare path neuron-star: nucleu + 4 spikes asimetrice
    function _starPath(cx, cy, rCore, nSpikes, spikeLen) {
      let d = '';
      for (let s = 0; s < nSpikes; s++) {
        const ang = (s / nSpikes) * Math.PI * 2;
        const angB = ang + Math.PI / nSpikes;
        const ox1 = cx + Math.cos(ang) * rCore;
        const oy1 = cy + Math.sin(ang) * rCore;
        const ox2 = cx + Math.cos(ang) * (rCore + spikeLen);
        const oy2 = cy + Math.sin(ang) * (rCore + spikeLen);
        const mx = cx + Math.cos(angB) * rCore * 0.45;
        const my = cy + Math.sin(angB) * rCore * 0.45;
        d += `M${ox1.toFixed(2)},${oy1.toFixed(2)} L${ox2.toFixed(2)},${oy2.toFixed(2)} L${mx.toFixed(2)},${my.toFixed(2)} `;
      }
      return d.trim();
    }

    BRAIN_NODES.forEach(([x, y], i) => {
      const hot = HOT_IDX.has(i);
      const rCore = hot ? 2.8 : 1.6;
      const nSpikes = hot ? 6 : 4;
      const spikeL = hot ? 3.5 : 2.2;
      const baseOp = hot ? 0.70 : 0.28;
      const accentCol = NODE_ACCENT[i];
      const fillCol = accentCol || 'white';
      const glowCol = accentCol || '#aaccff';
      const starD = _starPath(x, y, rCore, nSpikes, spikeL);
      svg += `
  <circle id="abn-g${i}" cx="${x}" cy="${y}" r="${rCore + 5}" fill="${fillCol}" opacity="0.03" filter="url(#abFN)"/>
  <circle id="abn-c${i}" cx="${x}" cy="${y}" r="${rCore}" fill="${fillCol}" opacity="${baseOp}"
    style="filter:drop-shadow(0 0 ${hot ? 9 : 3}px ${glowCol}) drop-shadow(0 0 ${hot ? 16 : 6}px ${glowCol})"/>
  <path  id="abn-${i}"  d="${starD}" fill="${fillCol}" opacity="${(baseOp * 0.7).toFixed(2)}"
    stroke="${fillCol}" stroke-width="0.3" stroke-opacity="0.5"/>`;
    });

    // Particule pe edges hot
    EDGES.filter((_, i) => HOT_IDX.has(EDGES[i]?.[0]) || HOT_IDX.has(EDGES[i]?.[1])).slice(0, 20).forEach(([a, b], i) => {
      const [ax, ay] = BRAIN_NODES[a], [bx, by] = BRAIN_NODES[b];
      const dur = (1.4 + i * 0.18).toFixed(1);
      svg += `<circle r="2" fill="white" opacity="0.85"
    style="filter:drop-shadow(0 0 5px white)">
    <animateMotion dur="${dur}s" repeatCount="indefinite" begin="${(i * 0.3).toFixed(1)}s"
      path="M${ax},${ay} L${bx},${by}"/>
  </circle>`;
    });

    // Etichete zone cu pin + linie
    ZONES.forEach((z, zi) => {
      const dur = (3.0 + zi * 0.5).toFixed(1);
      const del = (zi * 0.55).toFixed(1);
      const isLeft = z.pinX < 130;
      const isBottom = z.pinY > 250;
      const ta = isLeft ? 'end' : isBottom ? 'middle' : 'start';
      const lx2 = isLeft ? z.pinX + 32 : isBottom ? z.pinX : z.pinX - 32;
      const ly2 = isBottom ? z.pinY - 12 : z.pinY;
      svg += `
  ${zi === 1 ? `
  ` : ''}
  <circle cx="${z.cx}" cy="${z.cy}" r="3.5" fill="${z.col}"
    style="filter:drop-shadow(0 0 6px ${z.col});animation:ariaHot ${dur}s ease-in-out infinite ${del}s"/>
  <line x1="${z.cx}" y1="${z.cy}" x2="${lx2}" y2="${ly2}"
    stroke="${z.col}" stroke-width="0.8" stroke-opacity="0.7" stroke-dasharray="4 3"/>
  <text x="${z.pinX}" y="${isBottom ? z.pinY + 12 : z.pinY - 8}" text-anchor="${ta}"
    font-family="monospace" font-size="7" font-weight="900"
    fill="${z.col}" style="filter:drop-shadow(0 0 5px ${z.col})88;opacity:0.88">${z.name}</text>
  <text x="${z.pinX}" y="${isBottom ? z.pinY + 21 : z.pinY + 2}" text-anchor="${ta}"
    font-family="monospace" font-size="5" fill="${z.col}" opacity="0.62">${z.sub}</text>`;
    });


    // ── LOB STATUS DOTS — adăugate ca SVG <g> DUPĂ etichete ─────────────────
    // SEED / ASCENT / SOVEREIGN — în Lobul parietal (zi=1, pinX=155, pinY=30)
    // Dot-uri micro sub fiecare label de lob
    // Format: ● STATUS_TEXT (verde/rosu/galben)
    const LOB_DOTS = [
      // [ zi, offsetY, dotId, defaultText, defaultLevel ]
      [0, 14, 'ldot-frontal', 'POLICY: BALANCED', 'ok'],  // Lobul frontal, sub sub-text
      [1, 14, 'ldot-parietal', '', 'ok'],  // Lobul parietal — consciousness
      [2, 14, 'ldot-temporal', 'MEMORY: OK', 'ok'],  // Lobul temporal
      [3, 14, 'ldot-occipital', 'VISION: CLEAR', 'ok'],  // Lobul occipital
      [4, 14, 'ldot-cerebel', 'EXEC: —', 'warn'],  // Cerebelul
      [5, 14, 'ldot-trunchi', 'SURVIVAL: STABLE', 'ok'],  // Trunchi cerebral
    ];
    const DOT_COLORS = { ok: '#00ff88', bad: '#ff3355', warn: '#f0c040' };

    LOB_DOTS.forEach(([zi, offY, dotId, txt, lvl]) => {
      const z = ZONES[zi];
      const isB = z.pinY > 250;
      const isL = z.pinX < 130;
      const ta = isL ? 'end' : isB ? 'middle' : 'start';
      const baseY = isB ? z.pinY + 21 : z.pinY + 2;  // exact unde e sub-textul
      const dotY = baseY + offY;
      const col = DOT_COLORS[lvl] || DOT_COLORS.warn;

      if (zi === 1) {
        // Parietal: CONSCIOUSNESS cu 3 dots
        svg += `
  <circle id="ldot-c0" cx="${z.pinX + (isL ? -6 : 6)}" cy="${dotY - 1}" r="2.2" fill="#00ff88" opacity="0.85"
    style="filter:drop-shadow(0 0 3px #00ff88)"/>
  <text id="ldot-parietal-seed" x="${z.pinX + (isL ? -11 : 11)}" y="${dotY + 1}" text-anchor="${ta}"
    font-family="monospace" font-size="5" fill="#00ff88" opacity="0.82">SEED</text>
  <circle id="ldot-c1" cx="${z.pinX + (isL ? -6 : 6)}" cy="${dotY + 8}" r="2.2" fill="#555577" opacity="0.6"/>
  <text id="ldot-parietal-ascent" x="${z.pinX + (isL ? -11 : 11)}" y="${dotY + 10}" text-anchor="${ta}"
    font-family="monospace" font-size="5" fill="#7788aa" opacity="0.55">ASCENT</text>
  <circle id="ldot-c2" cx="${z.pinX + (isL ? -6 : 6)}" cy="${dotY + 16}" r="2.2" fill="#555577" opacity="0.6"/>
  <text id="ldot-parietal-sovereign" x="${z.pinX + (isL ? -11 : 11)}" y="${dotY + 18}" text-anchor="${ta}"
    font-family="monospace" font-size="5" fill="#7788aa" opacity="0.55">SOVEREIGN</text>`;
      } else {
        svg += `
  <circle id="${dotId}-c" cx="${z.pinX + (isL ? -6 : 6)}" cy="${dotY - 1}" r="2.2" fill="${col}" opacity="0.85"
    style="filter:drop-shadow(0 0 3px ${col})"/>
  <text id="${dotId}" x="${z.pinX + (isL ? -11 : 11)}" y="${dotY + 1}" text-anchor="${ta}"
    font-family="monospace" font-size="5" fill="${col}" opacity="0.75">${txt}</text>`;
      }
    });

    panel.innerHTML = svg;
    console.log('[ARIA BRAIN] nodeCount =', N);

    // ══ NEURON STARFIELD — RAF WAVE ENGINE v113 ══════════════════════════
    // prefers-reduced-motion guard
    const _reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Referințe DOM — preluate O SINGURĂ DATĂ (nu re-creăm nimic)
    const _elCore = BRAIN_NODES.map((_, i) => document.getElementById('abn-c' + i)); // nucleu
    const _elStar = BRAIN_NODES.map((_, i) => document.getElementById('abn-' + i));  // spikes path
    const _elGlow = BRAIN_NODES.map((_, i) => document.getElementById('abn-g' + i)); // halo glow

    // Per-nod: baseOp, faza individuala, coordonate normalizate, distanta centru
    const CX = 160, CY = 145;
    const _BOP = BRAIN_NODES.map((_, i) => HOT_IDX.has(i) ? 0.62 : 0.26);
    const _PHASE = BRAIN_NODES.map((_, i) => (i * 2.39996) % (Math.PI * 2)); // golden angle
    const _NX = BRAIN_NODES.map(([x]) => x / 336);
    const _NY = BRAIN_NODES.map(([, y]) => y / 280);
    const _NDIST = BRAIN_NODES.map(([x, y]) => Math.hypot(x - CX, y - CY) / 180); // norm 0..1

    // Wave modes: LR=0, TB=1, DIAG=2, RADIAL=3
    let _waveMode = 0;
    let _waveModeTimer = Date.now();
    const WAVE_CYCLE = 8000; // ms per mode

    // Parametri wave
    const WAVE_SPEED = 0.42;
    const WAVE_SCALE = 2.8;
    const WAVE_AMP = 0.52;
    const WAVE_BASE = 0.26; // NU e folosit direct; folsoim _BOP per nod
    const WAVE_MIN = 0.18; // hard floor
    const WAVE_MAX = 0.95; // hard ceil

    // ARES color overlay (subtil, lerp spre alb)
    let _waveColor = null; // null = white
    let _waveColorAlpha = 0;

    if (_reducedMotion) {
      // Fara animatie: setam base opacity si gata
      BRAIN_NODES.forEach((_, i) => {
        if (_elCore[i]) _elCore[i].setAttribute('opacity', _BOP[i].toFixed(3));
        if (_elStar[i]) _elStar[i].setAttribute('opacity', (_BOP[i] * 0.65).toFixed(3));
      });
      console.log('[ARIA BRAIN] reduced-motion: static base opacity set');
    } else {
      // RAF loop principal
      let _rafId = null;
      function _waveFrame() {
        try { // [v119-p12 FIX] RAF body wrapped — uncaught din setAttribute/DOM nu mai aprinde banner
          const t = performance.now() * 0.001;

          // Rotate wave mode la fiecare WAVE_CYCLE ms
          if (Date.now() - _waveModeTimer > WAVE_CYCLE) {
            _waveMode = (_waveMode + 1) % 4;
            _waveModeTimer = Date.now();
          }

          for (let i = 0; i < N; i++) {
            // w = directional coordinate [0..1] in functie de mode
            let w;
            switch (_waveMode) {
              case 0: w = _NX[i]; break; // LR
              case 1: w = _NY[i]; break; // TB
              case 2: w = (_NX[i] + _NY[i]) * 0.5; break; // DIAG
              case 3: w = _NDIST[i]; break; // RADIAL
            }

            // Sinusoida de val: fara random per-frame
            const pulse = 0.5 + 0.5 * Math.sin(
              WAVE_SCALE * w * Math.PI * 2 - t * WAVE_SPEED * Math.PI * 2 + _PHASE[i]
            );

            // Alpha clamped
            const alpha = Math.min(WAVE_MAX, Math.max(WAVE_MIN,
              _BOP[i] + WAVE_AMP * pulse
            ));
            // Star spikes: mai subtile (alpha*0.62)
            const alphaS = Math.min(0.85, alpha * 0.62);

            // Culoare: accent daca pulse > 0.72, altfel white
            const accCol = NODE_ACCENT[i];
            let fillCol = 'white';
            if (accCol && pulse > 0.68) {
              // Lerp spre accent color: culoarea apare doar la varf
              const blend = (pulse - 0.68) / 0.32; // 0..1
              // Aplicam fill = accent cu alpha*blend, altfel white
              fillCol = accCol; // SVG fill e solid, lucram cu opacity
            }

            const el = _elCore[i];
            const es = _elStar[i];
            if (el) {
              el.setAttribute('opacity', alpha.toFixed(3));
              if (accCol && pulse > 0.68) el.setAttribute('fill', accCol);
              else el.setAttribute('fill', 'white');
            }
            if (es) es.setAttribute('opacity', alphaS.toFixed(3));
          }

          _rafId = requestAnimationFrame(_waveFrame);
        } catch (e) { console.warn('[ARIA BRAIN RAF]', e && e.message ? e.message : e); /* nu re-schedule pe eroare */ }
      }
      _rafId = requestAnimationFrame(_waveFrame);
      console.log('[ARIA BRAIN] neuron-starfield RAF wave active, mode=LR');

      // Expune API extern pentru schimbare culoare din ARES state
      const STATE_COLORS = {
        'FOCUSED': '#f0c040',
        'STRATEGIC': '#00d9ff',
        'DEFENSIVE': '#ff4455',
        'RESILIENT': '#00ff88',
        'DETERMINED': '#aaccff',
      };

      function _readAresState() {
        const badge = document.getElementById('ares-strip-badge');
        if (!badge) return null;
        const txt = badge.textContent.trim().toUpperCase();
        for (const k of Object.keys(STATE_COLORS)) {
          if (txt.includes(k)) return k;
        }
        return null;
      }

      // Override accent colors pe noduri colored in functie de starea ARES
      window._ariaBrainWave = function (stateName) {
        const col = STATE_COLORS[stateName];
        if (!col) return;
        // Propagare din centru: delay per dist
        BRAIN_NODES.forEach((_, i) => {
          if (!NODE_ACCENT[i]) return;
          const delayMs = _NDIST[i] * 1800;
          setTimeout(() => {
            try { // [v119-p12 FIX] async setTimeout — scapă din outer try/catch
              NODE_ACCENT[i] = col;
              setTimeout(() => {
                try { NODE_ACCENT[i] = ACCENT_COLS[Math.floor(Math.abs(Math.sin(i * 7.3)) * ACCENT_COLS.length)]; } catch (_) { }
              }, 4000);
            } catch (_) { }
          }, delayMs);
        });
      };

      // Auto-init wave la open panel
      setTimeout(() => {
        const st = _readAresState();
        if (st) window._ariaBrainWave(st);
      }, 1000);

      // Observer badge schimbare
      const _badgeEl = document.getElementById('ares-strip-badge');
      if (_badgeEl && window.MutationObserver) {
        new MutationObserver(() => {
          try { // [v119-p12 FIX]
            const st = _readAresState();
            if (st) window._ariaBrainWave(st);
          } catch (_) { }
        }).observe(_badgeEl, { childList: true, subtree: true, characterData: true });
      }
    }

    console.log('[ARIA BRAIN] neuron-starfield v113 init complete, nodes=', N);
  } catch (e) { window.__ARIA_BRAIN_INIT__ = false; console.warn('[ARIA BRAIN] initAriaBrain error:', e && e.message ? e.message : e); } // [v119-p12 FIX] rollback flag → permite re-încercare la următorul _aresRender
}

// ── initARES — inserează panoul în UI ─────────────────────────────────────
function initARES() {
  if (document.getElementById('ares-strip')) return;
  const pmStrip = document.getElementById('pm-strip');
  const srStrip = document.getElementById('sr-strip');
  const anchor = pmStrip || srStrip;
  if (!anchor) return;

  const wrap = document.createElement('div');
  wrap.id = 'ares-strip';
  wrap.innerHTML = `
    <div id="ares-strip-bar" onclick="this.closest('#ares-strip').classList.toggle('open');_aresRender()">
      <div class="v6-accent"><div class="v6-ico"><svg viewBox="0 0 24 24"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="8"/><line x1="22" y1="8.5" x2="16" y2="12"/><line x1="12" y1="22" x2="12" y2="16"/><line x1="2" y1="8.5" x2="8" y2="12"/></svg></div><span class="v6-lbl">ARES</span></div>
      <div class="v6-content">
        <div id="ares-strip-title">
          <span>ARES</span>
          <span style="font-size:11px;color:#00d9ff44;letter-spacing:1px">NEURAL COMMAND</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span id="ares-strip-badge" style="color:#00d9ff;border-color:#00d9ff88">${_ZI.bolt} DETERMINED</span>
          <span id="ares-strip-conf" style="font-size:11px;color:#00d9ff66">CONF —%</span><span id="ares-imm-span"> · IMM —%</span><span id="ares-emotion-span"></span>
          <span id="ares-strip-chev">▼</span>
        </div>
      </div>
    </div>
    <div id="ares-wound-line">${_ZI.w} —</div>
    <div id="ares-decision-line" style="display:none;font-size:12px;padding:2px 8px;font-family:monospace;"></div>
    <div id="ares-strip-panel">
      <div id="ares-panel">

                <div id="ares-meta-row">
          <div id="ares-stage-col">
            <div class="ares-meta-title">STAGE PROGRESS</div>
            <div class="ares-stage-name" id="ares-stage-name">SEED</div>
            <div class="ares-prog-bar" id="ares-prog-bar">██░░░░░░░░ 0%</div>
            <div class="ares-prog-next" id="ares-prog-next">Next: 1,000</div>
          </div>

                    <div id="ares-wallet-col" style="flex:0 0 auto;min-width:110px;text-align:center;border-left:1px solid rgba(0,150,255,0.12);border-right:1px solid rgba(0,150,255,0.12);padding:0 8px">
            <div class="ares-meta-title" style="text-align:center">WALLET</div>
            <div id="ares-wallet-balance" style="font-family:monospace;font-size:11px;font-weight:700;color:#00ff88;letter-spacing:1px">$0.00</div>
            <div id="ares-wallet-avail" style="font-family:monospace;font-size:11px;color:#6a9a7a;margin-top:1px">Avail: <span id="ares-wallet-avail-val">$0</span> · Rest To Trade: <span id="ares-wallet-lock-val">$0</span></div>
            <div style="margin-top:4px;display:flex;align-items:center;justify-content:center;gap:4px;flex-wrap:wrap">
              <button id="ares-wallet-add-btn" onclick="(function(){
                const v=prompt('Fund ARES Wallet (USDT amount):','100');
                if(v===null) return;
                const n=parseFloat(v);
                if(!Number.isFinite(n)||n<=0){alert('Invalid amount');return;}
                if(typeof ARES!=='undefined'&&ARES.wallet&&ARES.wallet.fund(n)){
                  try{_aresRender();}catch(_){}
                }
              })()" style="background:rgba(0,255,136,0.1);border:1px solid rgba(0,255,136,0.35);color:#00ff88;font-family:monospace;font-size:11px;padding:2px 8px;cursor:pointer;border-radius:2px;letter-spacing:1px">[+] ADD</button>
              <button id="ares-wallet-withdraw-btn" onclick="(function(){
                if(typeof ARES==='undefined'||!ARES.wallet) return;
                const wlt=ARES.wallet;
                const openCnt=ARES.positions?ARES.positions.getOpen().length:0;
                if(wlt.locked>0||openCnt>0){alert('Withdraw disabled while positions are active.');return;}
                const v=prompt('Withdraw from ARES Wallet (USDT amount):','');
                if(v===null) return;
                const n=parseFloat(v);
                if(!Number.isFinite(n)||n<=0){alert('Invalid amount');return;}
                if(wlt.withdraw(n,openCnt)){try{_aresRender();}catch(_){}}
                else{alert('Withdraw failed — check positions.');}
              })()" id="ares-wallet-withdraw-btn" style="background:rgba(255,80,80,0.08);border:1px solid rgba(255,80,80,0.3);color:rgba(255,110,110,0.8);font-family:monospace;font-size:11px;padding:2px 8px;cursor:pointer;border-radius:2px;letter-spacing:1px">[-] WITHDRAW</button>
            </div>
            <div id="ares-wallet-withdraw-tip" style="display:none;font-family:monospace;font-size:10px;color:#ff555566;margin-top:2px">withdraw disabled while positions active</div>
            <span id="ares-wallet-fail" style="display:none;background:rgba(255,40,40,0.18);border:1px solid rgba(255,50,50,0.45);color:#ff5555;font-family:monospace;font-size:11px;padding:1px 5px;border-radius:2px;letter-spacing:1px;margin-top:3px;display:block">NO FUNDS</span>
          </div>

          <div id="ares-obj-col">
            <div class="ares-meta-title" id="ares-obj-title" style="text-align:right">OBJECTIVES</div>
            <div class="ares-obj-item" id="aobj-0">100 → 1,000</div>
            <div class="ares-obj-bar"  id="aobj-0b" style="text-align:right"></div>
            <div class="ares-obj-item" id="aobj-1">1,000 → 10,000</div>
            <div class="ares-obj-bar"  id="aobj-1b" style="text-align:right"></div>
            <div class="ares-obj-item" id="aobj-2">10,000 → 1M</div>
            <div class="ares-obj-bar"  id="aobj-2b" style="text-align:right"></div>
          </div>
        </div>

                <div id="ares-positions-wrap" style="margin:4px 12px 0;padding:4px 0 2px;border-top:1px solid rgba(0,150,255,0.12)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
            <div class="ares-meta-title" style="margin:0">POSITIONS</div>
            <button id="ares-close-all-btn" onclick="(function(){if(typeof ARES!=='undefined'&&ARES.positions){ARES.positions.closeAll();setTimeout(_aresRender,100);}})()" style="display:none;background:rgba(255,50,50,0.15);border:1px solid rgba(255,50,50,0.4);color:rgba(255,100,100,0.85);font-family:monospace;font-size:11px;padding:2px 7px;cursor:pointer;border-radius:2px;letter-spacing:1px">CLOSE ALL</button>
          </div>
          <div id="ares-positions-list" style="max-height:220px;overflow-y:auto">
            <div style="color:rgba(255,255,255,0.25);font-size:12px;font-family:monospace;padding:2px 0">— none —</div>
          </div>
        </div>

                <div id="ares-arc-wrap">
          <svg id="ares-arc-svg" viewBox="0 0 260 56" preserveAspectRatio="xMidYMid meet"></svg>
        </div>

                <div id="ares-core-wrap">
          <svg id="ares-core-svg" viewBox="0 0 336 280" preserveAspectRatio="xMidYMid meet">
            <text x="160" y="155" text-anchor="middle" font-family="monospace" font-size="8" fill="#0080ff44">INITIALIZING NEURAL BRAIN...</text>
          </svg>
        </div>

                <div id="ares-cog-bar">
          <span id="ares-cog-label">CLARITATE COGNITIVĂ</span>
          <div id="ares-cog-track"><div id="ares-cog-fill" style="width:0%"></div></div>
          <span id="ares-cog-pct">—</span>
        </div>

                <div id="ares-stats-row">
          <div class="ares-stat-cell">
            <div class="ares-stat-label">TRAJECTORY Δ</div>
            <div class="ares-stat-val" id="ares-stat-delta" style="color:#00d9ff">—</div>
            <div class="ares-stat-sub">vs curve</div>
          </div>
          <div class="ares-stat-cell">
            <div class="ares-stat-label">MISSION DAY</div>
            <div class="ares-stat-val" id="ares-stat-day" style="color:#00d9ff">— / 365</div>
            <div class="ares-stat-sub">elapsed</div>
          </div>
          <div class="ares-stat-cell">
            <div class="ares-stat-label">WIN RATE</div>
            <div class="ares-stat-val" id="ares-stat-wr" style="color:#00d9ff">—%</div>
            <div class="ares-stat-sub">last 10</div>
          </div>
          <div class="ares-stat-cell">
            <div class="ares-stat-label">PRED ACC</div>
            <div class="ares-stat-val" id="ares-stat-pred" style="color:#0080ff">—</div>
            <div class="ares-stat-sub">5min pred</div>
          </div>
        </div>

                <div id="ares-thought-wrap">
          <div id="ares-thought-inner">
            <div class="ares-thought-line new">› ARES 1.0 — Neural Command Center online</div>
            <div class="ares-thought-line">› AUTONOMOUS mode — managing positions independently</div>
            <div class="ares-thought-line">› Awaiting market data...</div>
          </div>
        </div>

                <div id="ares-lesson-wrap">
          <div id="ares-lesson-label">◈ LAST LESSON FROM MEMORY</div>
          <div id="ares-lesson-text">Awaiting first trade analysis...</div>
          <div id="ares-history-bar"></div>
        </div>

      </div>
    </div>`;

  anchor.insertAdjacentElement('afterend', wrap);

  // Prim tick la 1s după init
  setTimeout(function () { if (typeof ARES !== 'undefined') ARES.tick(); }, 1000);
}

function _demoTick() {
  const active = TP.demoPositions.filter(p => !p.closed);
  if (active.length) {
    checkDemoPositionsSLTP();
    renderDemoPositions();
  }
  // Check demo pending limit orders for fill
  if (typeof checkPendingOrders === 'function') checkPendingOrders();
  // Render pending orders (live distance update)
  if (typeof renderPendingOrders === 'function') renderPendingOrders();
}
// [V1.5] Legacy API_KEY/API_SECRET removed — credentials are server-side only (credentialStore)

function connectLiveAPI() {
  var st = el('apiStatus');
  if (st) { st.innerHTML = _ZI.timer + ' Se verifică conexiunea exchange...'; st.style.color = 'var(--yel)'; }
  // Check user's exchange connection status via backend
  fetch('/api/exchange/status', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (data) {
    if (!data.ok || !data.connected) {
      if (st) {
        st.innerHTML = _ZI.w + ' Nicio conexiune exchange configurată.<br><span style="color:#00afff;cursor:pointer" onclick="openM(\'msettings\');swtab(\'msettings\',\'set-exchange\',document.querySelector(\'[data-extab]\'))">' + _ZI.bolt + ' Configurează în Settings → Exchange API</span>';
        st.style.color = '#f0c040';
      }
      return;
    }
    // Connected — show status and enable trading
    var exchange = data.exchange || 'binance';
    var mode = data.mode || 'live';
    TP.liveConnected = true; TP.liveExchange = exchange;
    if (st) {
      st.innerHTML = _ZI.ok + ' <b>' + exchange.toUpperCase() + '</b> — ' + mode.toUpperCase() + '<br><span style="font-size:8px;color:#556">API: ' + (data.maskedKey || '***') + ' · Last verified: ' + (data.lastVerified || 'N/A') + '</span>';
      st.style.color = 'var(--grn)';
    }
    var form = el('liveOrderForm'); if (form) form.style.display = 'block';
    var btn = el('btnConnectExchange'); if (btn) btn.style.display = 'none';
    // Sync balance + positions
    if (typeof liveApiSyncState === 'function') liveApiSyncState();
  }).catch(function (err) {
    if (st) { st.innerHTML = _ZI.x + ' Backend unreachable: ' + escHtml(err.message || err); st.style.color = 'var(--red)'; }
  });
}
// FIX 13: LIVE TRADING — now wired to backend proxy
// [FIX A6] DISABLED — this function created orphan live orders (not tracked in TP.livePositions).
// Use the standard live trading path (autoTrade.js → liveApi.js) instead.
function placeLiveOrder() {
  toast('placeLiveOrder disabled — use standard Live Trading panel', 0, _ZI.x);
  if (typeof atLog === 'function') atLog('warn', '[BLOCK] placeLiveOrder is disabled (orphan order path — use Live Trading panel)');
  return;
}
function connectLiveExchange() {
  // Alias kept for any onclick references
  toast('LIVE TRADING DEZACTIVAT — backend necesar.', 0, _ZI.dRed);
}
function loadSavedAPI() {
  // Exchange keys are now managed server-side (Settings → Exchange API)
  // Clean up any stale client-side data from old versions
  localStorage.removeItem('zt_api_key');
  localStorage.removeItem('zt_api_secret');
  localStorage.removeItem('zt_api_token');
  localStorage.removeItem('zt_api_exchange');
  // Auto-check exchange connection on load
  connectLiveAPI();
}

// ===== PWA INSTALL =====
function installPWA() {
  const prompt = window._dip || window._deferredPrompt;
  if (prompt) { prompt.prompt(); prompt.userChoice.then(() => { const b = el('installBtn'); if (b) b.style.display = 'none'; window._dip = null; window._deferredPrompt = null; }); }
  else toast('Deschide in Chrome/Brave → meniu → Instaleaza aplicatia');
}


// ===== INDICATOR DEFINITIONS =====
// [MOVED TO TOP] INDICATORS

// Indicator state
if (!S.activeInds) S.activeInds = { ema: true, wma: true, st: true, vp: true };
if (!S.macdData) S.macdData = [];
if (!S.signalData) S.signalData = {};

function openIndPanel() {
  const ov = document.getElementById('indOverlay');
  const pan = document.getElementById('indPanel');
  const body = document.getElementById('indPanelBody');
  if (!ov || !pan || !body) return;

  // Build indicator list — active indicators first
  body.innerHTML = '';
  var _sorted = INDICATORS.slice().sort(function (a, b) {
    var aOn = S.activeInds[a.id] ? 1 : 0;
    var bOn = S.activeInds[b.id] ? 1 : 0;
    return bOn - aOn; // active first
  });
  _sorted.forEach(ind => {
    const on = !!S.activeInds[ind.id];
    const row = document.createElement('div');
    row.className = 'ind-row';
    row.innerHTML = `
      <div class="ind-row-l">
        <span class="ind-row-ico">${ind.ico}</span>
        <div>
          <div class="ind-row-name">${ind.name}</div>
          <div class="ind-row-desc">${ind.desc}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span class="ind-gear" onclick="event.stopPropagation();openIndSettings('${ind.id}')" title="Settings">${_ZI.bolt}</span>
        <div class="ind-toggle ${on ? 'on' : ''}" onclick="toggleInd('${ind.id}',this)">
          <div class="ind-toggle-dot"></div>
        </div>
      </div>
    `;
    body.appendChild(row);
  });

  ov.classList.add('open');
  pan.classList.add('open');
}

function closeIndPanel() {
  document.getElementById('indOverlay')?.classList.remove('open');
  document.getElementById('indPanel')?.classList.remove('open');
}

function toggleInd(id, toggleEl) {
  S.activeInds[id] = !S.activeInds[id];
  S.indicators[id] = S.activeInds[id]; // [FIX BUG1] sync both dicts
  if (S.activeInds[id]) toggleEl.classList.add('on');
  else toggleEl.classList.remove('on');
  applyIndVisibility(id, S.activeInds[id]);
  if (S.activeInds[id] && typeof renderChart === 'function') renderChart();
  renderActBar();
  toast(S.activeInds[id] ? INDICATORS.find(i => i.id === id)?.name + ' ON' : INDICATORS.find(i => i.id === id)?.name + ' OFF');
  // Save + IMMEDIATE push to server (explicit user action)
  if (typeof _usSave === 'function') _usSave();
  if (typeof _userCtxPushNow === 'function') _userCtxPushNow();
}

function applyIndVisibility(id, visible) {
  const show = visible;
  switch (id) {
    case 'ema':
      if (ema50S) ema50S.applyOptions({ visible: show });
      if (ema200S) ema200S.applyOptions({ visible: show });
      break;
    case 'wma':
      if (wma20S) wma20S.applyOptions({ visible: show });
      if (wma50S) wma50S.applyOptions({ visible: show });
      break;
    case 'st':
      if (stS) stS.applyOptions({ visible: show });
      break;
    case 'bb':
      if (show) initBBSeries();
      if (bbUpperS) bbUpperS.applyOptions({ visible: show });
      if (bbMiddleS) bbMiddleS.applyOptions({ visible: show });
      if (bbLowerS) bbLowerS.applyOptions({ visible: show });
      if (show) updateBB();
      break;
    case 'ichimoku':
      if (show) initIchimokuSeries();
      ichimokuSeries.forEach(s => { try { s.applyOptions({ visible: show }); } catch (_) { } });
      if (show) updateIchimoku();
      break;
    case 'fib':
      if (show) updateFib();
      else { fibSeries.forEach(s => { try { mainChart.removeSeries(s); } catch (_) { } }); fibSeries = []; }
      break;
    case 'pivot':
      if (show) updatePivot();
      else { pivotSeries.forEach(s => { try { mainChart.removeSeries(s); } catch (_) { } }); pivotSeries = []; }
      break;
    case 'vp':
      if (show) updateVP();
      else { vpSeries.forEach(s => { try { mainChart.removeSeries(s); } catch (_) { } }); vpSeries = []; }
      break;
    case 'vwap':
      S.vwapOn = show;
      if (show) { if (typeof renderVWAP === 'function') renderVWAP(); }
      else { if (typeof vwapSeries !== 'undefined') { vwapSeries.forEach(s => { try { mainChart.removeSeries(s); } catch (_) { } }); vwapSeries = []; } }
      const vBtn = document.getElementById('vwapBtn');
      if (vBtn) vBtn.classList.toggle('on', show);
      break;
    case 'cvd':
      const cvdEl = document.getElementById('cc');
      if (cvdEl) cvdEl.style.display = show ? '' : 'none';
      break;
    case 'macd':
      const mc = document.getElementById('macdChart');
      if (mc) mc.style.display = show ? '' : 'none';
      if (show) initMACDChart();
      break;
    case 'rsi14':
      const rc = document.getElementById('rsiChart');
      if (rc) rc.style.display = show ? '' : 'none';
      if (show) initRSIChart();
      break;
    case 'stoch':
      const sc = document.getElementById('stochChart');
      if (sc) sc.style.display = show ? '' : 'none';
      if (show) initStochChart();
      break;
    case 'atr':
      const ac = document.getElementById('atrChart');
      if (ac) ac.style.display = show ? '' : 'none';
      if (show) initATRChart();
      break;
    case 'obv':
      const oc = document.getElementById('obvChart');
      if (oc) oc.style.display = show ? '' : 'none';
      if (show) initOBVChart();
      break;
    case 'mfi':
      const mfc = document.getElementById('mfiChart');
      if (mfc) mfc.style.display = show ? '' : 'none';
      if (show) initMFIChart();
      break;
    case 'cci':
      const cc = document.getElementById('cciChart');
      if (cc) cc.style.display = show ? '' : 'none';
      if (show) initCCIChart();
      break;
  }
}

// ══════════════════════════════════════════════════════════════
// INDICATOR SETTINGS MODAL
// ══════════════════════════════════════════════════════════════
function openIndSettings(id) {
  const cfg = IND_SETTINGS[id];
  if (!cfg || Object.keys(cfg).length === 0) { toast('No settings for ' + id.toUpperCase()); return; }
  const ind = INDICATORS.find(i => i.id === id);
  const labels = {
    p1: 'Period 1', p2: 'Period 2', period: 'Period', mult: 'Multiplier',
    stdDev: 'Std Deviation', kPeriod: 'K Period', dPeriod: 'D Period', smooth: 'Smoothing',
    fast: 'Fast', slow: 'Slow', signal: 'Signal', tenkan: 'Tenkan', kijun: 'Kijun',
    senkou: 'Senkou Span B', rows: 'Rows', type: 'Type'
  };
  let html = `<div class="ind-set-title">${ind ? ind.ico : _ZI.bolt} ${ind ? ind.name : id.toUpperCase()} Settings</div>`;
  for (const [key, val] of Object.entries(cfg)) {
    if (key === 'levels' || key === 'type') continue;
    html += `<div class="ind-set-row"><label>${labels[key] || key}</label><input type="number" id="indset-${id}-${key}" value="${val}" min="1" max="500" step="any" class="ind-set-input"></div>`;
  }
  html += `<div style="display:flex;gap:8px;margin-top:10px"><button class="ind-set-btn" onclick="applyIndSettings('${id}')">Apply</button><button class="ind-set-btn cancel" onclick="closeIndSettings()">Cancel</button></div>`;
  let modal = document.getElementById('indSettingsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'indSettingsModal';
    modal.className = 'ind-settings-modal';
    document.body.appendChild(modal);
  }
  modal.innerHTML = html;
  modal.style.display = 'flex';
}
function closeIndSettings() {
  const m = document.getElementById('indSettingsModal');
  if (m) m.style.display = 'none';
}
function applyIndSettings(id) {
  const cfg = IND_SETTINGS[id];
  if (!cfg) return;
  for (const key of Object.keys(cfg)) {
    if (key === 'levels' || key === 'type') continue;
    const inp = document.getElementById('indset-' + id + '-' + key);
    if (inp) { const v = parseFloat(inp.value); if (isFinite(v) && v > 0) cfg[key] = v; }
  }
  closeIndSettings();
  // Persist + sync indicator settings cross-device
  if (typeof _indSettingsSave === 'function') _indSettingsSave();
  if (typeof _userCtxPush === 'function') _userCtxPush();
  // Re-render the indicator with new settings
  if (S.activeInds[id]) {
    if (typeof renderChart === 'function') renderChart();
    applyIndVisibility(id, true);
  }
  toast(id.toUpperCase() + ' settings updated', 0, _ZI.bolt);
}

// ══════════════════════════════════════════════════════════════
// OVERLAY INDICATORS — Bollinger Bands
// ══════════════════════════════════════════════════════════════
function initBBSeries() {
  if (bbUpperS || !mainChart) return;
  bbUpperS = mainChart.addLineSeries({ color: '#ff668866', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 2 });
  bbMiddleS = mainChart.addLineSeries({ color: '#ff6688', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  bbLowerS = mainChart.addLineSeries({ color: '#ff668866', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 2 });
}
function updateBB() {
  if (!mainChart || !S.klines.length) return;
  initBBSeries();
  const c = S.klines.map(k => k.close);
  const p = Math.round(IND_SETTINGS.bb.period) || 20;
  const sd = IND_SETTINGS.bb.stdDev || 2;
  const upper = [], middle = [], lower = [];
  for (let i = 0; i < c.length; i++) {
    if (i < p - 1) { upper.push({ time: S.klines[i].time, value: 0 }); middle.push({ time: S.klines[i].time, value: 0 }); lower.push({ time: S.klines[i].time, value: 0 }); continue; }
    let sum = 0; for (let j = i - p + 1; j <= i; j++) sum += c[j]; const avg = sum / p;
    let variance = 0; for (let j = i - p + 1; j <= i; j++) variance += Math.pow(c[j] - avg, 2); const stdDev = Math.sqrt(variance / p);
    middle.push({ time: S.klines[i].time, value: avg });
    upper.push({ time: S.klines[i].time, value: avg + sd * stdDev });
    lower.push({ time: S.klines[i].time, value: avg - sd * stdDev });
  }
  try { bbMiddleS.setData(middle.filter(d => d.value > 0)); bbUpperS.setData(upper.filter(d => d.value > 0)); bbLowerS.setData(lower.filter(d => d.value > 0)); } catch (_) { }
}

// ══════════════════════════════════════════════════════════════
// OVERLAY — Ichimoku Cloud
// ══════════════════════════════════════════════════════════════
function initIchimokuSeries() {
  if (ichimokuSeries.length || !mainChart) return;
  const tenkanS = mainChart.addLineSeries({ color: '#0496ff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'Tenkan' });
  const kijunS = mainChart.addLineSeries({ color: '#ff3355', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'Kijun' });
  const spanAS = mainChart.addLineSeries({ color: '#00d97a66', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 2 });
  const spanBS = mainChart.addLineSeries({ color: '#ff335566', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 2 });
  const chikouS = mainChart.addLineSeries({ color: '#aa44ff66', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 3 });
  ichimokuSeries = [tenkanS, kijunS, spanAS, spanBS, chikouS];
}
function _ichiHL(klines, p, idx) {
  let h = -Infinity, l = Infinity;
  for (let j = Math.max(0, idx - p + 1); j <= idx; j++) { h = Math.max(h, klines[j].high); l = Math.min(l, klines[j].low); }
  return (h + l) / 2;
}
function updateIchimoku() {
  if (!mainChart || !S.klines.length || ichimokuSeries.length < 5) return;
  const k = S.klines; const cfg = IND_SETTINGS.ichimoku;
  const tenkan = [], kijun = [], spanA = [], spanB = [], chikou = [];
  for (let i = 0; i < k.length; i++) {
    const tv = i >= cfg.tenkan - 1 ? _ichiHL(k, cfg.tenkan, i) : null;
    const kv = i >= cfg.kijun - 1 ? _ichiHL(k, cfg.kijun, i) : null;
    if (tv !== null) tenkan.push({ time: k[i].time, value: tv });
    if (kv !== null) kijun.push({ time: k[i].time, value: kv });
    if (tv !== null && kv !== null && i + cfg.kijun < k.length) spanA.push({ time: k[i + cfg.kijun].time, value: (tv + kv) / 2 });
    if (i >= cfg.senkou - 1 && i + cfg.kijun < k.length) spanB.push({ time: k[i + cfg.kijun].time, value: _ichiHL(k, cfg.senkou, i) });
    if (i >= cfg.kijun) chikou.push({ time: k[i - cfg.kijun].time, value: k[i].close });
  }
  try { ichimokuSeries[0].setData(tenkan); ichimokuSeries[1].setData(kijun); ichimokuSeries[2].setData(spanA); ichimokuSeries[3].setData(spanB); ichimokuSeries[4].setData(chikou); } catch (_) { }
}

// ══════════════════════════════════════════════════════════════
// OVERLAY — Fibonacci Retracement (auto swing H/L)
// ══════════════════════════════════════════════════════════════
function updateFib() {
  fibSeries.forEach(s => { try { mainChart.removeSeries(s); } catch (_) { } }); fibSeries = [];
  if (!mainChart || !S.klines.length) return;
  const k = S.klines; let swH = -Infinity, swL = Infinity, hiIdx = 0, loIdx = 0;
  // Use last 100 bars for swing detection
  const start = Math.max(0, k.length - 100);
  for (let i = start; i < k.length; i++) { if (k[i].high > swH) { swH = k[i].high; hiIdx = i; } if (k[i].low < swL) { swL = k[i].low; loIdx = i; } }
  if (swH <= swL) return;
  const isUptrend = loIdx < hiIdx;
  const colors = ['#ffffff44', '#00d97a55', '#00b8d455', '#f0c04066', '#ff880066', '#ff335566', '#ff668866'];
  const levels = IND_SETTINGS.fib.levels;
  levels.forEach((lv, idx) => {
    const price = isUptrend ? swH - lv * (swH - swL) : swL + lv * (swH - swL);
    const s = mainChart.addLineSeries({ color: colors[idx] || '#888', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: (lv * 100).toFixed(1) + '%', lineStyle: 2 });
    s.setData([{ time: k[start].time, value: price }, { time: k[k.length - 1].time, value: price }]);
    fibSeries.push(s);
  });
}

// ══════════════════════════════════════════════════════════════
// OVERLAY — Pivot Points (Standard)
// ══════════════════════════════════════════════════════════════
function updatePivot() {
  pivotSeries.forEach(s => { try { mainChart.removeSeries(s); } catch (_) { } }); pivotSeries = [];
  if (!mainChart || !S.klines.length) return;
  const k = S.klines;
  // Use previous day's OHLC — find last full day
  const now = Date.now() / 1000;
  const dayStart = Math.floor(now / 86400) * 86400;
  const prevDay = k.filter(b => b.time >= dayStart - 86400 && b.time < dayStart);
  if (!prevDay.length) return;
  let ph = -Infinity, pl = Infinity, pc = prevDay[prevDay.length - 1].close;
  prevDay.forEach(b => { ph = Math.max(ph, b.high); pl = Math.min(pl, b.low); });
  const P = (ph + pl + pc) / 3;
  const R1 = 2 * P - pl, S1 = 2 * P - ph;
  const R2 = P + (ph - pl), S2 = P - (ph - pl);
  const R3 = ph + 2 * (P - pl), S3 = pl - 2 * (ph - P);
  const today = k.filter(b => b.time >= dayStart);
  if (!today.length) return;
  const t0 = today[0].time, t1 = today[today.length - 1].time;
  const add = (price, color, label) => {
    const s = mainChart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: label, lineStyle: 2 });
    s.setData([{ time: t0, value: price }, { time: t1, value: price }]);
    pivotSeries.push(s);
  };
  add(P, '#f0c040', 'P');
  add(R1, '#ff335566', 'R1'); add(R2, '#ff335588', 'R2'); add(R3, '#ff3355aa', 'R3');
  add(S1, '#00d97a66', 'S1'); add(S2, '#00d97a88', 'S2'); add(S3, '#00d97aaa', 'S3');
}

// ══════════════════════════════════════════════════════════════
// OVERLAY — Volume Profile
// ══════════════════════════════════════════════════════════════
function updateVP() {
  vpSeries.forEach(s => { try { mainChart.removeSeries(s); } catch (_) { } }); vpSeries = [];
  if (!mainChart || !S.klines.length) return;
  const k = S.klines; const rows = IND_SETTINGS.vp.rows || 70;
  let hi = -Infinity, lo = Infinity;
  k.forEach(b => { hi = Math.max(hi, b.high); lo = Math.min(lo, b.low); });
  if (hi <= lo) return;
  const step = (hi - lo) / rows;
  const buckets = new Array(rows).fill(0);
  k.forEach(b => {
    const idx = Math.min(rows - 1, Math.floor((b.close - lo) / step));
    buckets[idx] += b.volume;
  });
  const maxVol = Math.max(...buckets);
  if (!maxVol) return;
  // Draw VP as horizontal markers using line series
  const t0 = k[0].time, t1 = k[k.length - 1].time;
  const vpS = mainChart.addHistogramSeries({
    color: '#00b8d422', priceFormat: { type: 'price' }, priceScaleId: 'vp', scaleMargins: { top: 0, bottom: 0 },
  });
  try {
    mainChart.priceScale('vp').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.05 }, visible: false });
  } catch (_) { }
  // Map buckets to histogram data on the time axis
  const vpData = [];
  const step2 = Math.floor(k.length / rows);
  for (let i = 0; i < rows && i * step2 < k.length; i++) {
    vpData.push({ time: k[i * step2].time, value: buckets[i], color: buckets[i] === maxVol ? '#f0c04044' : '#00b8d422' });
  }
  vpS.setData(vpData);
  vpSeries.push(vpS);
}

// ══════════════════════════════════════════════════════════════
// OSCILLATOR HELPER — create a sub-chart with sync
// ══════════════════════════════════════════════════════════════
function _createSubChart(containerId, height) {
  const container = document.getElementById(containerId);
  if (!container || typeof LightweightCharts === 'undefined') return null;
  container.style.height = (height || 60) + 'px';
  const chart = LightweightCharts.createChart(container, {
    width: typeof getChartW === 'function' ? getChartW() : container.offsetWidth,
    height: height || 60,
    layout: { background: { color: '#0a0f16' }, textColor: '#7a9ab8' },
    grid: { vertLines: { color: '#1a2030' }, horzLines: { color: '#1a2030' } },
    rightPriceScale: { borderColor: '#1e2530', visible: true, width: 70, scaleMargins: { top: 0.1, bottom: 0.1 } },
    timeScale: { visible: false, rightOffset: 12 },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    handleScroll: { mouseWheel: true, pressedMouseMove: true },
    handleScale: { mouseWheel: true, pinch: true },
  });
  chart.applyOptions({ localization: { timeFormatter: ts => typeof fmtTime === 'function' ? fmtTime(ts) : '', dateFormatter: ts => typeof fmtDate === 'function' ? fmtDate(ts) : '' } });
  // Sync time with main chart
  if (mainChart) {
    try {
      const tr = mainChart.timeScale().getVisibleLogicalRange();
      if (tr) chart.timeScale().setVisibleLogicalRange(tr);
    } catch (_) { }
  }
  return chart;
}
function _syncSubChartsToMain() {
  if (!mainChart) return;
  try {
    const r = mainChart.timeScale().getVisibleLogicalRange();
    if (!r) return;
    [_rsiChart, _stochChart, _atrChart, _obvChart, _mfiChart, _cciChart, _macdChart].forEach(ch => {
      if (ch) try { ch.timeScale().setVisibleLogicalRange(r); } catch (_) { }
    });
  } catch (_) { }
}

// ══════════════════════════════════════════════════════════════
// OSCILLATOR — RSI
// ══════════════════════════════════════════════════════════════
function initRSIChart() {
  if (_rsiInited && _rsiChart) { updateRSI(); return; }
  _rsiChart = _createSubChart('rsiChart', 60);
  if (!_rsiChart) return;
  _rsiSeries = _rsiChart.addLineSeries({ color: '#f5c842', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'RSI' });
  _rsiInited = true;
  updateRSI();
}
function updateRSI() {
  if (!_rsiInited || !_rsiSeries || !S.klines.length) return;
  const c = S.klines.map(k => k.close);
  const p = Math.round(IND_SETTINGS.rsi14.period) || 14;
  const rsiData = [];
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < c.length; i++) {
    const change = c[i] - c[i - 1];
    if (i <= p) {
      if (change > 0) avgGain += change; else avgLoss -= change;
      if (i === p) { avgGain /= p; avgLoss /= p; const rs = avgLoss === 0 ? 100 : avgGain / avgLoss; rsiData.push({ time: S.klines[i].time, value: 100 - 100 / (1 + rs) }); }
    } else {
      avgGain = (avgGain * (p - 1) + Math.max(change, 0)) / p;
      avgLoss = (avgLoss * (p - 1) + Math.max(-change, 0)) / p;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsiData.push({ time: S.klines[i].time, value: 100 - 100 / (1 + rs) });
    }
  }
  try { _rsiSeries.setData(rsiData); _syncSubChartsToMain(); } catch (_) { }
}

// ══════════════════════════════════════════════════════════════
// OSCILLATOR — Stochastic RSI
// ══════════════════════════════════════════════════════════════
function initStochChart() {
  if (_stochInited && _stochChart) { updateStoch(); return; }
  _stochChart = _createSubChart('stochChart', 60);
  if (!_stochChart) return;
  _stochKSeries = _stochChart.addLineSeries({ color: '#00e5ff', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: '%K' });
  _stochDSeries = _stochChart.addLineSeries({ color: '#ff8800', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: '%D' });
  _stochInited = true;
  updateStoch();
}
function updateStoch() {
  if (!_stochInited || !_stochKSeries || !S.klines.length) return;
  const c = S.klines.map(k => k.close);
  const p = Math.round(IND_SETTINGS.stoch.kPeriod) || 14;
  const dP = Math.round(IND_SETTINGS.stoch.dPeriod) || 3;
  const sm = Math.round(IND_SETTINGS.stoch.smooth) || 3;
  // First calc RSI
  const rsi = [];
  let avgG = 0, avgL = 0;
  for (let i = 1; i < c.length; i++) {
    const ch = c[i] - c[i - 1];
    if (i <= 14) { if (ch > 0) avgG += ch; else avgL -= ch; if (i === 14) { avgG /= 14; avgL /= 14; } }
    else { avgG = (avgG * 13 + Math.max(ch, 0)) / 14; avgL = (avgL * 13 + Math.max(-ch, 0)) / 14; }
    if (i >= 14) { const rs = avgL === 0 ? 100 : avgG / avgL; rsi.push(100 - 100 / (1 + rs)); }
  }
  // Stoch of RSI
  const rawK = [];
  for (let i = p - 1; i < rsi.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - p + 1; j <= i; j++) { hi = Math.max(hi, rsi[j]); lo = Math.min(lo, rsi[j]); }
    rawK.push(hi === lo ? 50 : (rsi[i] - lo) / (hi - lo) * 100);
  }
  // Smooth K
  const sK = []; for (let i = sm - 1; i < rawK.length; i++) { let s = 0; for (let j = 0; j < sm; j++) s += rawK[i - j]; sK.push(s / sm); }
  // D = SMA of smoothK
  const sD = []; for (let i = dP - 1; i < sK.length; i++) { let s = 0; for (let j = 0; j < dP; j++) s += sK[i - j]; sD.push(s / dP); }
  const offset = 14 + p - 1 + sm - 1;
  const kData = sK.map((v, i) => ({ time: S.klines[offset + i]?.time, value: v })).filter(d => d.time);
  const dOffset = offset + dP - 1;
  const dData = sD.map((v, i) => ({ time: S.klines[dOffset + i]?.time, value: v })).filter(d => d.time);
  try { _stochKSeries.setData(kData); _stochDSeries.setData(dData); _syncSubChartsToMain(); } catch (_) { }
}

// ══════════════════════════════════════════════════════════════
// OSCILLATOR — ATR
// ══════════════════════════════════════════════════════════════
function initATRChart() {
  if (_atrInited && _atrChart) { updateATRInd(); return; }
  _atrChart = _createSubChart('atrChart', 60);
  if (!_atrChart) return;
  _atrSeries = _atrChart.addLineSeries({ color: '#ff8800', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'ATR' });
  _atrInited = true;
  updateATRInd();
}
function updateATRInd() {
  if (!_atrInited || !_atrSeries || !S.klines.length) return;
  const k = S.klines; const p = Math.round(IND_SETTINGS.atr.period) || 14;
  const tr = []; for (let i = 0; i < k.length; i++) {
    if (i === 0) tr.push(k[i].high - k[i].low);
    else tr.push(Math.max(k[i].high - k[i].low, Math.abs(k[i].high - k[i - 1].close), Math.abs(k[i].low - k[i - 1].close)));
  }
  const atrData = []; let atr = 0;
  for (let i = 0; i < tr.length; i++) {
    if (i < p) { atr += tr[i]; if (i === p - 1) { atr /= p; atrData.push({ time: k[i].time, value: atr }); } }
    else { atr = (atr * (p - 1) + tr[i]) / p; atrData.push({ time: k[i].time, value: atr }); }
  }
  try { _atrSeries.setData(atrData); _syncSubChartsToMain(); } catch (_) { }
}

// ══════════════════════════════════════════════════════════════
// OSCILLATOR — OBV
// ══════════════════════════════════════════════════════════════
function initOBVChart() {
  if (_obvInited && _obvChart) { updateOBV(); return; }
  _obvChart = _createSubChart('obvChart', 60);
  if (!_obvChart) return;
  _obvSeries = _obvChart.addLineSeries({ color: '#00b8d4', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'OBV' });
  _obvInited = true;
  updateOBV();
}
function updateOBV() {
  if (!_obvInited || !_obvSeries || !S.klines.length) return;
  const k = S.klines; let obv = 0;
  const data = k.map((b, i) => {
    if (i > 0) { if (b.close > k[i - 1].close) obv += b.volume; else if (b.close < k[i - 1].close) obv -= b.volume; }
    return { time: b.time, value: obv };
  });
  try { _obvSeries.setData(data); _syncSubChartsToMain(); } catch (_) { }
}

// ══════════════════════════════════════════════════════════════
// OSCILLATOR — MFI
// ══════════════════════════════════════════════════════════════
function initMFIChart() {
  if (_mfiInited && _mfiChart) { updateMFI(); return; }
  _mfiChart = _createSubChart('mfiChart', 60);
  if (!_mfiChart) return;
  _mfiSeries = _mfiChart.addLineSeries({ color: '#00d97a', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'MFI' });
  _mfiInited = true;
  updateMFI();
}
function updateMFI() {
  if (!_mfiInited || !_mfiSeries || !S.klines.length) return;
  const k = S.klines; const p = Math.round(IND_SETTINGS.mfi.period) || 14;
  const tp = k.map(b => (b.high + b.low + b.close) / 3);
  const mfData = [];
  for (let i = p; i < k.length; i++) {
    let posFlow = 0, negFlow = 0;
    for (let j = i - p + 1; j <= i; j++) {
      const flow = tp[j] * k[j].volume;
      if (tp[j] > tp[j - 1]) posFlow += flow; else negFlow += flow;
    }
    const mfi = negFlow === 0 ? 100 : 100 - 100 / (1 + posFlow / negFlow);
    mfData.push({ time: k[i].time, value: mfi });
  }
  try { _mfiSeries.setData(mfData); _syncSubChartsToMain(); } catch (_) { }
}

// ══════════════════════════════════════════════════════════════
// OSCILLATOR — CCI
// ══════════════════════════════════════════════════════════════
function initCCIChart() {
  if (_cciInited && _cciChart) { updateCCI(); return; }
  _cciChart = _createSubChart('cciChart', 60);
  if (!_cciChart) return;
  _cciSeries = _cciChart.addLineSeries({ color: '#ff3355', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'CCI' });
  _cciInited = true;
  updateCCI();
}
function updateCCI() {
  if (!_cciInited || !_cciSeries || !S.klines.length) return;
  const k = S.klines; const p = Math.round(IND_SETTINGS.cci.period) || 20;
  const tp = k.map(b => (b.high + b.low + b.close) / 3);
  const cciData = [];
  for (let i = p - 1; i < tp.length; i++) {
    let sum = 0; for (let j = i - p + 1; j <= i; j++) sum += tp[j]; const avg = sum / p;
    let madSum = 0; for (let j = i - p + 1; j <= i; j++) madSum += Math.abs(tp[j] - avg); const mad = madSum / p;
    const cci = mad === 0 ? 0 : (tp[i] - avg) / (0.015 * mad);
    cciData.push({ time: k[i].time, value: cci });
  }
  try { _cciSeries.setData(cciData); _syncSubChartsToMain(); } catch (_) { }
}

// ══════════════════════════════════════════════════════════════
// HOOK — update all active indicators on each renderChart()
// ══════════════════════════════════════════════════════════════
function _indRenderHook() {
  if (S.activeInds.bb) updateBB();
  if (S.activeInds.ichimoku) updateIchimoku();
  if (S.activeInds.fib) updateFib();
  if (S.activeInds.pivot) updatePivot();
  if (S.activeInds.vp) updateVP();
  if (S.activeInds.rsi14 && _rsiInited) updateRSI();
  if (S.activeInds.stoch && _stochInited) updateStoch();
  if (S.activeInds.atr && _atrInited) updateATRInd();
  if (S.activeInds.obv && _obvInited) updateOBV();
  if (S.activeInds.mfi && _mfiInited) updateMFI();
  if (S.activeInds.cci && _cciInited) updateCCI();
}

function renderActBar() {
  const bar = document.getElementById('actIndBar');
  const cnt = document.getElementById('actCount');
  if (!bar) return;
  const active = INDICATORS.filter(i => S.activeInds[i.id]);
  if (cnt) cnt.textContent = active.length;
  bar.innerHTML = active.map(i => `
    <span class="act-pill" style="color:${getIndColor(i.id)};border-color:${getIndColor(i.id)}44;background:${getIndColor(i.id)}11"
      onclick="deactivateInd('${i.id}')">
      ${i.ico} ${i.id.toUpperCase()} <span class="kill">✕</span>
    </span>`).join('');
}

function getIndColor(id) {
  const map = { ema: '#f0c040', wma: '#aa44ff', st: '#ff8800', vp: '#00b8d4', macd: '#00e5ff', bb: '#ff6688', rsi14: '#f5c842', vwap: '#00d97a', fib: '#aa44ff', ichimoku: '#44aaff', stoch: '#ffaa00', obv: '#00b8d4', atr: '#ff8800', pivot: '#f0c040', mfi: '#00d97a', cci: '#ff3355' };
  return map[id] || '#888';
}

function deactivateInd(id) {
  S.activeInds[id] = false;
  S.indicators[id] = false; // [FIX] sync both dicts
  applyIndVisibility(id, false);
  renderActBar();
  if (typeof _usSave === 'function') _usSave();
}

function toggleActBar() {
  const bar = document.getElementById('actIndBar');
  if (!bar) return;
  bar.style.display = bar.style.display === 'none' ? 'flex' : 'none';
}

// ===== MACD CALCULATION =====
function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  if (!closes || closes.length < slow + signal) return null;
  const ema = (arr, p) => {
    const k = 2 / (p + 1); let v = arr[0];
    return arr.map((x, i) => i === 0 ? v : (v = x * k + v * (1 - k)));
  };
  const fastE = ema(closes, fast);
  const slowE = ema(closes, slow);
  const macdLine = fastE.map((v, i) => v - slowE[i]).slice(slow - 1);
  const sigLine = ema(macdLine, signal);
  const histogram = macdLine.map((v, i) => v - sigLine[i]);
  const last = macdLine.length - 1;
  return {
    macd: macdLine[last],
    signal: sigLine[last],
    hist: histogram[last],
    prevHist: histogram[last - 1] || 0,
    prevMacd: macdLine[last - 1] || 0,
    prevSignal: sigLine[last - 1] || 0,
  };
}

// ===== FIX 8: MACD CHART — real implementation =====
// [MOVED TO TOP] _macdChart
// [MOVED TO TOP] _macdInited

function initMACDChart() {
  if (_macdInited && _macdChart) { _updateMACDChart(); return; }
  const container = document.getElementById('macdChart');
  if (!container || typeof LightweightCharts === 'undefined') return;

  container.style.height = '60px';
  const w = getChartW();

  _macdChart = LightweightCharts.createChart(container, {
    width: w, height: 60,
    layout: { background: { color: '#0a0f16' }, textColor: '#7a9ab8' },
    grid: { vertLines: { color: '#1a2030' }, horzLines: { color: '#1a2030' } },
    rightPriceScale: { borderColor: '#1e2530', scaleMargins: { top: 0.1, bottom: 0.1 } },
    timeScale: { borderColor: '#1e2530', timeVisible: true, secondsVisible: false, rightOffset: 12 },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    handleScroll: { mouseWheel: true, pressedMouseMove: true },
    handleScale: { mouseWheel: true, pinch: true },
  });
  _macdChart.applyOptions({ localization: { timeFormatter: ts => fmtTime(ts), dateFormatter: ts => fmtDate(ts) } });
  _macdChart.timeScale().applyOptions({ visible: false, rightOffset: 12 }); // v104: rightOffset matches main
  _macdChart.applyOptions({ rightPriceScale: { visible: true, borderColor: '#1e2530', width: 70 } });

  _macdLineSeries = _macdChart.addLineSeries({
    color: '#00e5ff', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'MACD'
  });
  _macdSigSeries = _macdChart.addLineSeries({
    color: '#ff8800', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'SIG'
  });
  _macdHistSeries = _macdChart.addHistogramSeries({
    color: '#00d97a44', priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
    priceScaleId: '', scaleMargins: { top: 0.8, bottom: 0 }
  });
  _macdInited = true;
  _updateMACDChart();
}

function _updateMACDChart() {
  if (!_macdInited || !_macdChart || !_macdLineSeries) return;
  const klines = S.klines;
  if (!klines || klines.length < 35) return;

  const closes = klines.map(k => k.close);
  const fast = 12, slow = 26, signal = 9;
  const emaFn = (arr, p) => {
    const k = 2 / (p + 1); let v = arr[0];
    return arr.map((x, i) => i === 0 ? v : (v = x * k + v * (1 - k)));
  };
  const fastE = emaFn(closes, fast);
  const slowE = emaFn(closes, slow);
  const macdArr = fastE.map((v, i) => v - slowE[i]).slice(slow - 1);
  const times = klines.map(k => k.time).slice(slow - 1);
  const sigArr = emaFn(macdArr, signal);
  const histArr = macdArr.map((v, i) => v - sigArr[i]);

  const macdData = times.map((t, i) => ({ time: t, value: macdArr[i] })).filter(d => Number.isFinite(d.value));
  const sigData = times.map((t, i) => ({ time: t, value: sigArr[i] })).filter(d => Number.isFinite(d.value));
  const histData = times.map((t, i) => ({
    time: t, value: histArr[i],
    color: histArr[i] >= 0 ? (histArr[i] >= (histArr[i - 1] || 0) ? '#00d97a' : '#00d97a66') : (histArr[i] <= (histArr[i - 1] || 0) ? '#ff3355' : '#ff335566')
  })).filter(d => Number.isFinite(d.value));

  try {
    _macdLineSeries.setData(macdData);
    _macdSigSeries.setData(sigData);
    _macdHistSeries.setData(histData);
    // Sync time scale with main chart
    if (mainChart && _macdChart) {
      const tr = mainChart.timeScale().getVisibleRange();
      if (tr) _macdChart.timeScale().setVisibleRange(tr);
    }
  } catch (e) { console.warn('[MACD]', e); }
}

// Call update whenever klines refresh

// Deep dive chart data hook
const _origSetChartData = typeof setChartData !== 'undefined' ? setChartData : null;
function _macdKlineHook() {
  if (_macdInited && _macdChart) _updateMACDChart();
}

// ===== SUPERTREND RSI FLIP DETECTOR =====
function detectSupertrendFlip(bars) {
  if (!bars || bars.length < 2) return null;
  // Simple check: if the last bar closes above or below previous supertrend
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  if (!last || !prev) return null;
  const lClose = last.close, pClose = prev.close;
  const lHigh = last.high, lLow = last.low;
  const pHigh = prev.high, pLow = prev.low;
  // Detect trend change
  // ATR via unified Wilder (14 bars) — uses last 20 bars for warm-up safety
  const _stBars = bars.slice(-20);
  const atr14 = _calcATRSeries(_stBars, 14, 'wilder').last || (last.high - last.low);
  const mult = 3;
  const upperBand = ((last.high + last.low) / 2) + mult * atr14;
  const lowerBand = ((last.high + last.low) / 2) - mult * atr14;
  if (lClose > upperBand && pClose < upperBand) return 'bull';
  if (lClose < lowerBand && pClose > lowerBand) return 'bear';
  return null;
}

// ===== RSI DIVERGENCE DETECTOR =====
function detectRSIDivergence(closes, rsiVal) {
  if (!closes || closes.length < 20 || !rsiVal) return null;
  const slice = closes.slice(-20);
  const minP = Math.min(...slice), maxP = Math.max(...slice);
  const midP = (minP + maxP) / 2;
  const lastP = closes[closes.length - 1];
  // Bullish: price near low, RSI above 40 (hidden divergence)
  if (lastP < midP && rsiVal > 45 && rsiVal < 60) return 'bull_div';
  // Bearish: price near high, RSI below 60
  if (lastP > midP && rsiVal < 55 && rsiVal > 40) return 'bear_div';
  return null;
}

// ===== SIGNAL SCANNER ENGINE =====
function runSignalScan() {
  const bars = S.chartBars || [];
  if (bars.length < 30) return;
  const closes = bars.map(b => b.close);
  const rsiNow = S.rsiData?.['5m'] || parseFloat(document.getElementById('rn')?.textContent) || 50;
  const rsi1h = S.rsiData?.['1h'] || 60;
  const rsi4h = S.rsiData?.['4h'] || 60;
  const price = S.price || 0;
  const vol24h = S.vol24h || 0;

  // Run detectors
  const macdRes = calcMACD(closes);
  const stFlip = detectSupertrendFlip(bars);
  const rsiDiv = detectRSIDivergence(closes, rsiNow);

  const signals = [];
  let bullCount = 0, bearCount = 0;

  // 1. MACD Cross
  if (macdRes) {
    const cross = macdRes.macd > macdRes.signal && macdRes.prevMacd <= macdRes.prevSignal;
    const dcross = macdRes.macd < macdRes.signal && macdRes.prevMacd >= macdRes.prevSignal;
    if (cross) { signals.push({ name: 'MACD Crossover', det: `MACD: ${macdRes.macd.toFixed(2)} | Signal: ${macdRes.signal.toFixed(2)}`, dir: 'bull', str: 'BULLISH' }); bullCount++; }
    if (dcross) { signals.push({ name: 'MACD Crossunder', det: `MACD: ${macdRes.macd.toFixed(2)} | Signal: ${macdRes.signal.toFixed(2)}`, dir: 'bear', str: 'BEARISH' }); bearCount++; }
    // Hist momentum
    if (macdRes.hist > 0 && macdRes.prevHist < macdRes.hist) { signals.push({ name: 'MACD Histogram +', det: `Histograma: +${macdRes.hist.toFixed(2)}`, dir: 'bull', str: 'BULLISH' }); bullCount++; }
    if (macdRes.hist < 0 && macdRes.prevHist > macdRes.hist) { signals.push({ name: 'MACD Histogram −', det: `Histograma: ${macdRes.hist.toFixed(2)}`, dir: 'bear', str: 'BEARISH' }); bearCount++; }
  }

  // 2. RSI Signals
  if (rsiNow < 30) { signals.push({ name: 'RSI Supravanzut (5m)', det: `RSI: ${rsiNow.toFixed(1)} < 30`, dir: 'bull', str: 'STRONG BULL' }); bullCount += 2; }
  if (rsiNow > 70) { signals.push({ name: 'RSI Supracumparat (5m)', det: `RSI: ${rsiNow.toFixed(1)} > 70`, dir: 'bear', str: 'STRONG BEAR' }); bearCount += 2; }
  if (rsiDiv === 'bull_div') { signals.push({ name: 'RSI Divergenta Bullish', det: `Pret jos + RSI mai sus`, dir: 'bull', str: 'BULLISH' }); bullCount++; }
  if (rsiDiv === 'bear_div') { signals.push({ name: 'RSI Divergenta Bearish', det: `Pret sus + RSI mai jos`, dir: 'bear', str: 'BEARISH' }); bearCount++; }

  // 3. Supertrend Flip
  if (stFlip === 'bull') { signals.push({ name: 'Supertrend Flip ↑', det: `Schimbare de trend BULLISH`, dir: 'bull', str: 'STRONG BULL' }); bullCount += 2; }
  if (stFlip === 'bear') { signals.push({ name: 'Supertrend Flip ↓', det: `Schimbare de trend BEARISH`, dir: 'bear', str: 'STRONG BEAR' }); bearCount += 2; }

  // 4. Multi-TF RSI alignment
  if (rsiNow > 55 && rsi1h > 55 && rsi4h > 55) { signals.push({ name: 'RSI Aliniat Bullish MTF', det: `5m:${rsiNow.toFixed(0)} 1h:${rsi1h.toFixed(0)} 4h:${rsi4h.toFixed(0)}`, dir: 'bull', str: 'BULLISH' }); bullCount++; }
  if (rsiNow < 45 && rsi1h < 45 && rsi4h < 45) { signals.push({ name: 'RSI Aliniat Bearish MTF', det: `5m:${rsiNow.toFixed(0)} 1h:${rsi1h.toFixed(0)} 4h:${rsi4h.toFixed(0)}`, dir: 'bear', str: 'BEARISH' }); bearCount++; }

  // 5. Trend strength
  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
  if (price > sma20 && sma20 > sma50) { signals.push({ name: 'Trend Bullish (SMA)', det: `Pret>${sma20.toFixed(0)} > SMA50:${sma50.toFixed(0)}`, dir: 'bull', str: 'BULLISH' }); bullCount++; }
  if (price < sma20 && sma20 < sma50) { signals.push({ name: 'Trend Bearish (SMA)', det: `Pret<${sma20.toFixed(0)} < SMA50:${sma50.toFixed(0)}`, dir: 'bear', str: 'BEARISH' }); bearCount++; }

  // Store results
  S.signalData = { signals, bullCount, bearCount };
  renderSignals(signals, bullCount, bearCount);
  updateDeepDive(); // [DeepDive] refresh after new signal scan

  // Play sound if strong signal
  if ((bullCount >= 3 || bearCount >= 3) && S.alerts?.enabled) {
    playAlertSound();
    if (bullCount >= 3) sendAlert('SEMNAL STRONG BULL', '3+ indicatori aliniati bullish', 'scan');
    if (bearCount >= 3) sendAlert('SEMNAL STRONG BEAR', '3+ indicatori aliniati bearish', 'scan');
  }

  // [SR] Înregistrăm semnalele puternice individuale (STRONG BULL/BEAR din scan)
  signals.filter(s => s.str.includes('STRONG')).forEach(s => {
    srRecord('scan', s.name, s.dir === 'bull' ? 'LONG' : 'SHORT', s.str);
  });
  // [SR] Înregistrăm şi semnalul agregat dacă 3+ indicatori aliniati
  if (bullCount >= 3) srRecord('scan', 'Scan STRONG BULL ×' + bullCount, 'LONG', bullCount * 20);
  if (bearCount >= 3) srRecord('scan', 'Scan STRONG BEAR ×' + bearCount, 'SHORT', bearCount * 20);
}

// ════════════════════════════════════════════════════════════════
// DEEP DIVE — Narrative Context Generator
// READ-ONLY: never writes to S, BRAIN, AT, BM or any global state.
// ════════════════════════════════════════════════════════════════

// Debounce timer for updateDeepDive

// Deep dive timer
let _ddTimer = null;

function generateDeepDive() {
  try {
    // ── Guard: need at least some price data ──────────────────────
    if (!S || !S.price || !S.klines || S.klines.length < 20) {
      return '<div class="dd-loading">Waiting for market data...</div>';
    }

    const price = S.price;
    const sym = (S.symbol || 'BTC').replace('USDT', '');
    const closes = S.klines.map(k => k.close);
    const bars = S.chartBars || S.klines;

    // ── 1. REGIME ─────────────────────────────────────────────────
    const regime = (BRAIN && BRAIN.regime) || 'unknown';
    const regConf = (BRAIN && BRAIN.regimeConfidence) || 0;
    const regAtrPct = (BRAIN && BRAIN.regimeAtrPct) || 0;
    const regSlope = (BRAIN && BRAIN.regimeSlope) || 0;

    const regLabels = {
      trend: regSlope > 0 ? 'UPTREND' : 'DOWNTREND',
      range: 'RANGING',
      volatile: 'VOLATILE',
      breakout: 'BREAKOUT',
      unknown: 'SCANNING',
    };
    const regBadge = {
      trend: regSlope > 0 ? 'trend' : 'trend-dn',
      range: 'range',
      volatile: 'volatile',
      breakout: 'breakout',
      unknown: 'neut',
    };
    const regLabel = regLabels[regime] || regime.toUpperCase();
    const regCls = regBadge[regime] || 'neut';
    const confStr = regConf > 0 ? ` <span class="dd-hl-dim">(conf ${regConf}%)</span>` : '';
    const atrStr = regAtrPct > 0 ? ` · ATR <span class="dd-hl-neut">${regAtrPct.toFixed(2)}%</span>` : '';

    const secRegime = `
<div class="dd-section">
  <div class="dd-title">${_ZI.chart} REGIME</div>
  <div class="dd-body">
    <span class="dd-badge ${regCls}">${regLabel}</span>${confStr}${atrStr}
  </div>
</div>`;

    // ── 2. LIQUIDITY ──────────────────────────────────────────────
    let secLiq = '';
    try {
      const magnets = (S.magnets) || { above: [], below: [] };
      const nearAbove = magnets.above && magnets.above[0];
      const nearBelow = magnets.below && magnets.below[0];
      const bias = (S.magnetBias || S.magnets?.bias || 'neut').toLowerCase();
      const biasCls = bias === 'bull' ? 'dd-hl-bull' : bias === 'bear' ? 'dd-hl-bear' : 'dd-hl-neut';
      const biasLbl = bias === 'bull' ? 'BULLISH PULL' : bias === 'bear' ? 'BEARISH PULL' : 'NEUTRAL';

      let aboveStr = '—';
      let belowStr = '—';

      if (nearAbove && nearAbove.price) {
        const distA = ((nearAbove.price - price) / price * 100).toFixed(2);
        const volA = nearAbove.usd > 0 ? ` · $${fmt(nearAbove.usd)}` : '';
        aboveStr = `<span class="dd-hl-bear">$${fP(nearAbove.price)}</span> <span class="dd-hl-dim">(+${distA}%${volA})</span>`;
      }
      if (nearBelow && nearBelow.price) {
        const distB = ((price - nearBelow.price) / price * 100).toFixed(2);
        const volB = nearBelow.usd > 0 ? ` · $${fmt(nearBelow.usd)}` : '';
        belowStr = `<span class="dd-hl-bull">$${fP(nearBelow.price)}</span> <span class="dd-hl-dim">(-${distB}%${volB})</span>`;
      }

      secLiq = `
<div class="dd-section">
  <div class="dd-title">${_ZI.mag} LIQUIDITY</div>
  <div class="dd-body">
    Bias: <span class="${biasCls}">${biasLbl}</span><br>
    Nearest above: ${aboveStr}<br>
    Nearest below: ${belowStr}
  </div>
</div>`;
    } catch (_) {
      secLiq = `
<div class="dd-section">
  <div class="dd-title">${_ZI.mag} LIQUIDITY</div>
  <div class="dd-body"><span class="dd-hl-dim">Scanning magnets...</span></div>
</div>`;
    }

    // ── 3. INDICATORS ─────────────────────────────────────────────
    let secInd = '';
    try {
      // RSI
      const rsi5m = _safe.rsi(S.rsiData?.['5m'] || S.rsi?.['5m']);
      const rsi1h = _safe.rsi(S.rsiData?.['1h'] || S.rsi?.['1h'] || 50);
      const rsi4h = _safe.rsi(S.rsiData?.['4h'] || S.rsi?.['4h'] || 50);
      const rsiCls = v => v >= 70 ? 'dd-hl-bear' : v <= 30 ? 'dd-hl-bull' : 'dd-hl-neut';
      const rsiLbl = v => v >= 70 ? 'overbought' : v <= 30 ? 'oversold' : 'neutral';

      // MACD (uses existing closes)
      let macdStr = '—';
      try {
        const macdR = calcMACD(closes);
        if (macdR) {
          const macdDir = macdR.hist > 0 ? '<span class="dd-hl-bull">▲ BULL</span>' : '<span class="dd-hl-bear">▼ BEAR</span>';
          const histStr = Math.abs(macdR.hist).toFixed(1);
          macdStr = `${macdDir} <span class="dd-hl-dim">(hist ${macdR.hist > 0 ? '+' : ''}${macdR.hist.toFixed(1)})</span>`;
        }
      } catch (_) { }

      // Supertrend
      let stStr = '—';
      try {
        const stFlip = detectSupertrendFlip(bars);
        const sigSt = S.signalData?.signals?.find(sg => sg.name.includes('Supertrend'));
        const stDir = sigSt ? sigSt.dir : (stFlip === 'bull' ? 'bull' : stFlip === 'bear' ? 'bear' : null);
        if (stDir === 'bull') stStr = '<span class="dd-hl-bull">▲ BULL</span>';
        else if (stDir === 'bear') stStr = '<span class="dd-hl-bear">▼ BEAR</span>';
        else stStr = '<span class="dd-hl-neut">—</span>';
      } catch (_) { }

      // Funding Rate
      let frStr = '—';
      if (S.fr !== null && S.fr !== undefined) {
        const frPct = (S.fr * 100).toFixed(4);
        const frCls = S.fr > 0.0001 ? 'dd-hl-bear' : S.fr < -0.0001 ? 'dd-hl-bull' : 'dd-hl-neut';
        const frLbl = S.fr > 0.0001 ? 'longs pay' : S.fr < -0.0001 ? 'shorts pay' : 'neutral';
        frStr = `<span class="${frCls}">${frPct}%</span> <span class="dd-hl-dim">(${frLbl})</span>`;
      }

      // OI Delta (5m)
      let oiStr = '—';
      if (S.oi && S.oiPrev && S.oiPrev > 0) {
        const oiChg = ((S.oi - S.oiPrev) / S.oiPrev * 100);
        const oiCls = oiChg > 0 ? 'dd-hl-bull' : 'dd-hl-bear';
        oiStr = `<span class="${oiCls}">${oiChg > 0 ? '+' : ''}${oiChg.toFixed(2)}%</span>`;
      }

      // OFI blend
      const ofi = BRAIN?.ofi?.blendBuy || 50;
      const ofiCls = ofi > 55 ? 'dd-hl-bull' : ofi < 45 ? 'dd-hl-bear' : 'dd-hl-neut';
      const ofiStr = `<span class="${ofiCls}">${ofi.toFixed(0)}% buy</span>`;

      secInd = `
<div class="dd-section">
  <div class="dd-title">${_ZI.ruler} INDICATORS</div>
  <div class="dd-body">
    RSI 5m: <span class="${rsiCls(rsi5m)}">${rsi5m.toFixed(0)}</span> <span class="dd-hl-dim">(${rsiLbl(rsi5m)})</span>
    · 1h: <span class="${rsiCls(rsi1h)}">${rsi1h.toFixed(0)}</span>
    · 4h: <span class="${rsiCls(rsi4h)}">${rsi4h.toFixed(0)}</span><br>
    MACD: ${macdStr} · ST: ${stStr}<br>
    Funding: ${frStr} · OI Δ: ${oiStr}<br>
    Order Flow: ${ofiStr}
  </div>
</div>`;
    } catch (_) {
      secInd = `
<div class="dd-section">
  <div class="dd-title">${_ZI.ruler} INDICATORS</div>
  <div class="dd-body"><span class="dd-hl-dim">Calculating...</span></div>
</div>`;
    }

    // ── 4. CONCLUSION ─────────────────────────────────────────────
    let secConc = '';
    try {
      const bullC = S.signalData?.bullCount || 0;
      const bearC = S.signalData?.bearCount || 0;
      const ofi = BRAIN?.ofi?.blendBuy || 50;
      const rsi5m = _safe.rsi(S.rsiData?.['5m'] || S.rsi?.['5m']);
      const mBias = (S.magnetBias || S.magnets?.bias || 'neut').toLowerCase();

      let verdict = '';
      let verdictCls = 'neut';

      const bullScore = bullC + (ofi > 55 ? 1 : 0) + (rsi5m > 55 ? 1 : 0) + (mBias === 'bull' ? 1 : 0)
        + (regime === 'trend' && regSlope > 0 ? 2 : 0);
      const bearScore = bearC + (ofi < 45 ? 1 : 0) + (rsi5m < 45 ? 1 : 0) + (mBias === 'bear' ? 1 : 0)
        + (regime === 'trend' && regSlope < 0 ? 2 : 0);

      if (regime === 'volatile') {
        verdict = 'Highly volatile conditions — avoid new entries until regime stabilizes.';
        verdictCls = 'dd-hl-neut';
      } else if (bullScore > bearScore + 2) {
        const nearRes = S.magnets?.above?.[0];
        const resWarn = nearRes ? ` Price approaching resistance at $${fP(nearRes.price)} — wait for retest.` : '';
        verdict = `Bullish bias with ${bullC} aligned signal(s).${resWarn}`;
        verdictCls = 'dd-hl-bull';
      } else if (bearScore > bullScore + 2) {
        const nearSup = S.magnets?.below?.[0];
        const supWarn = nearSup ? ` Watch support at $${fP(nearSup.price)}.` : '';
        verdict = `Bearish pressure with ${bearC} aligned signal(s).${supWarn}`;
        verdictCls = 'dd-hl-bear';
      } else if (regime === 'range') {
        verdict = `Market ranging with no clear directional edge. Wait for breakout confirmation.`;
        verdictCls = 'dd-hl-neut';
      } else {
        verdict = `Mixed signals — no strong directional conviction. Neutral stance advised.`;
        verdictCls = 'dd-hl-neut';
      }

      secConc = `
<div class="dd-section">
  <div class="dd-title">${_ZI.brain} CONCLUSION</div>
  <div class="dd-body"><span class="${verdictCls}">${verdict}</span></div>
</div>`;
    } catch (_) {
      secConc = `
<div class="dd-section">
  <div class="dd-title">${_ZI.brain} CONCLUSION</div>
  <div class="dd-body"><span class="dd-hl-dim">Analyzing...</span></div>
</div>`;
    }

    // ── 5. INVALIDATION ───────────────────────────────────────────
    let secInval = '';
    try {
      const nearBelow = S.magnets?.below?.[0];
      const nearAbove = S.magnets?.above?.[0];
      const bullC = S.signalData?.bullCount || 0;
      const bearC = S.signalData?.bearCount || 0;
      const ofi = BRAIN?.ofi?.blendBuy || 50;
      const isBull = (bullC > bearC) || (ofi > 55);

      let invalStr = '';
      if (isBull && nearBelow && nearBelow.price) {
        invalStr = `Daily close below <span class="dd-hl-bear">$${fP(nearBelow.price)}</span> invalidates bullish scenario.`;
      } else if (!isBull && nearAbove && nearAbove.price) {
        invalStr = `Reclaim above <span class="dd-hl-bull">$${fP(nearAbove.price)}</span> would invalidate bearish scenario.`;
      } else if (regime === 'volatile') {
        invalStr = `Volatility cool-down below ATR <span class="dd-hl-neut">${(regAtrPct * 0.5).toFixed(2)}%</span> needed for trend confirmation.`;
      } else {
        invalStr = `Regime shift or sudden OFI reversal would invalidate current read.`;
      }

      secInval = `
<div class="dd-section">
  <div class="dd-title">${_ZI.w} INVALIDATION</div>
  <div class="dd-body">${invalStr}</div>
</div>`;
    } catch (_) {
      secInval = `
<div class="dd-section">
  <div class="dd-title">${_ZI.w} INVALIDATION</div>
  <div class="dd-body"><span class="dd-hl-dim">—</span></div>
</div>`;
    }

    return secRegime + secLiq + secInd + secConc + secInval;

  } catch (err) {
    // Top-level safety net — Deep Dive error must NEVER bubble up
    console.warn('[DeepDive] generateDeepDive error:', err);
    return '<div class="dd-loading">Analysis unavailable — waiting for data.</div>';
  }
}

function updateDeepDive() {
  // Debounce: skip if called within 500ms of a previous call
  if (_ddTimer) return;
  _ddTimer = setTimeout(function () {
    _ddTimer = null;
    try {
      const el_c = document.getElementById('deepdive-content');
      const el_t = document.getElementById('deepdive-upd');
      if (!el_c) return;
      el_c.innerHTML = generateDeepDive();
      if (el_t) el_t.textContent = 'updated ' + fmtNow();
    } catch (err) {
      console.warn('[DeepDive] updateDeepDive error:', err);
    }
  }, 500);
}

// ════════════════════════════════════════════════════════════════
// DEVELOPER MODE / TEST HARNESS
// READ-ONLY hooks. Does NOT modify trading logic, BRAIN, AT, BM.
// Gated: DEV.enabled must be true for panel to be visible.
// ════════════════════════════════════════════════════════════════
