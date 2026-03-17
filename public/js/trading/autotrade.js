// Zeus v122 — trading/autotrade.js
// AutoTrade engine: conditions, execution, monitoring, kill switch
'use strict';

// AT UI helpers
function toggleAutoTrade() {
  if (AT.killTriggered) {
    toast('⛔ Kill switch activ — apasa butonul RESET din status sau asteapta');
    // Afiseaza butonul de reset daca nu e deja afisat
    const st = el('atStatus');
    if (st && !st.innerHTML.includes('resetKillSwitch')) {
      st.innerHTML = `🚨 KILL ACTIV — <button onclick="resetKillSwitch()" style="color:#00ff88;background:none;border:1px solid #00ff8866;border-radius:2px;padding:1px 5px;font-size:11px;cursor:pointer;font-family:inherit">✅ RESET & REPORNESTE AT</button>`;
    }
    return;
  }
  AT.enabled = !AT.enabled;
  const btn = el('atMainBtn');
  const dot = el('atBtnDot');
  const txt = el('atBtnTxt');
  const panel = el('atPanel');
  if (AT.enabled) {
    // ✅ FIX v118: reset zi dacă s-a schimbat data
    if (typeof _bmResetDailyIfNeeded === 'function') _bmResetDailyIfNeeded();
    // ── INIT: Recalculate daily counters from journal (no stale state) ──
    const _todayRO = new Date().toLocaleDateString('ro-RO', { timeZone: S.tz || 'Europe/Bucharest' });
    const _jToday = (TP.journal || []).filter(j => {
      try { return new Date(j.time || 0).toLocaleDateString('ro-RO', { timeZone: S.tz || 'Europe/Bucharest' }) === _todayRO; } catch (_) { return false; }
    });
    // ✅ FIX v118: numără DOAR trade-urile AutoTrade (nu Paper) pentru dailyTrades / closedTradesToday
    const _jTodayAT = _jToday.filter(j => j.autoTrade === true);
    AT.realizedDailyPnL = _jTodayAT.reduce((acc, j) => acc + (Number.isFinite(+j.pnl) ? +j.pnl : 0), 0);
    AT.closedTradesToday = _jTodayAT.length;
    BM.dailyTrades = AT.closedTradesToday;
    AT.dailyStart = new Date().toDateString();
    // ── Auto-clear stale kill switch if no realized loss today ──
    if (AT.killTriggered && AT.closedTradesToday === 0 && AT.realizedDailyPnL === 0) {
      AT.killTriggered = false;
      const kb = el('atKillBtn'); if (kb) kb.classList.remove('triggered');
      atLog('info', 'ℹ️ KillSwitch state cleared (no realized loss today)');
    }
    if (AT.killTriggered) {
      AT.enabled = false;
      toast('⛔ Kill switch activ cu pierdere reală — apasă RESET înainte');
      return;
    }
    btn.className = 'at-main-btn on';
    dot.style.background = '#00ff88'; dot.style.boxShadow = '0 0 10px #00ff88';
    txt.textContent = 'AUTO TRADE ON';
    { const _oe = el('atStatus'); if (_oe) _oe.textContent = '🟢 Activ — scan la 30s'; }
    atLog('info', `⚡ Auto Trade PORNIT. RealPnL azi: $${AT.realizedDailyPnL.toFixed(2)} | Trades: ${AT.closedTradesToday}`);
    if (!AT.interval) AT.interval = Intervals.set('atCheck', runAutoTradeCheck, 30000);
    setTimeout(runAutoTradeCheck, 2000); // first check immediately
    atUpdateBanner(); ptUpdateBanner();
    ZState.saveLocal();  // persist AT.enabled = true immediately
  } else {
    btn.className = 'at-main-btn off';
    dot.style.background = '#aa44ff'; dot.style.boxShadow = '0 0 6px #aa44ff';
    txt.textContent = 'AUTO TRADE OFF';
    { const _oe = el('atStatus'); if (_oe) _oe.textContent = 'Configureaza mai jos'; }
    atLog('warn', '⏹ Auto Trade OPRIT.');
    Intervals.clear('atCheck'); clearInterval(AT.interval); AT.interval = null;
    atUpdateBanner(); ptUpdateBanner();
    ZState.saveLocal();  // persist AT.enabled = false immediately
  }
}

function updateATMode() {
  const prevMode = AT.mode;
  AT.mode = el('atMode')?.value || 'demo';
  const lbl = el('atModeLabel');
  const warn = el('atLiveWarn');
  if (AT.mode === 'live') {
    if (lbl) lbl.textContent = '🔴 LIVE MODE';
    if (lbl) lbl.style.color = '#ff4444';
    if (warn) warn.style.display = 'block';
    toast('⚠️ Live mode selectat — verificati API-ul!');
    // P5: Clean AUTO demo positions when switching to live — no ghosts
    if (prevMode !== 'live') {
      const demoBefore = (TP.demoPositions || []).filter(p => p.autoTrade).length;
      TP.demoPositions = (TP.demoPositions || []).filter(p => !p.autoTrade);
      if (demoBefore > 0) {
        atLog('warn', `🧹 Mode switch LIVE: ${demoBefore} pozitii AUTO demo curatate`);
        // Reset DSL for removed positions
        if (typeof DSL !== 'undefined' && DSL.positions) {
          Object.keys(DSL.positions).forEach(id => {
            if (!(TP.demoPositions || []).find(p => p.id == id)) delete DSL.positions[id];
          });
        }
        BlockReason.clear();
        setTimeout(() => { renderDemoPositions(); renderATPositions(); updateATStats(); }, 0);
      }
    }
  } else {
    if (lbl) lbl.textContent = '🎮 DEMO MODE';
    if (lbl) lbl.style.color = '#aa44ff';
    if (warn) warn.style.display = 'none';
  }
}

function atLog(type, msg) {
  const now = new Date().toLocaleTimeString('ro-RO', { timeZone: S.tz || 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  AT.log.unshift({ time: now, type, msg });
  if (AT.log.length > 80) AT.log.pop();
  renderATLog();
  // [NC] trimitem doar evenimentele importante (warn, kill, buy, sell)
  if (type === 'warn') ncAdd('warning', 'system', msg);
  if (type === 'kill') ncAdd('critical', 'system', msg);
  if (type === 'buy') ncAdd('info', 'trade', msg);
  if (type === 'sell') ncAdd('info', 'trade', msg);
}

function renderATLog() {
  const c = el('atLog'); if (!c) return;
  c.innerHTML = AT.log.map(l => `<div class="at-log-row">
    <span class="at-log-time">${l.time}</span>
    <span class="at-log-msg ${l.type}">${l.msg}</span>
  </div>`).join('');
}

function updateATStats() {
  const tot = AT.wins + AT.losses;
  const wr = tot ? Math.round(AT.wins / tot * 100) : 0;
  const pnlEl = el('atTotalPnL');
  const wrEl = el('atWinRate');
  const dlEl = el('atDailyLoss');
  const trEl = el('atTotalTrades');
  if (trEl) trEl.textContent = AT.totalTrades;
  if (wrEl) { wrEl.textContent = tot ? wr + '%' : '—'; wrEl.style.color = wr >= 55 ? 'var(--grn)' : wr >= 40 ? 'var(--ylw)' : 'var(--red)'; }
  if (pnlEl) { pnlEl.textContent = (AT.totalPnL >= 0 ? '+' : '') + '$' + AT.totalPnL.toFixed(0); pnlEl.style.color = AT.totalPnL >= 0 ? 'var(--grn)' : 'var(--red)'; }
  if (dlEl) { dlEl.textContent = '$' + Math.abs(AT.dailyPnL).toFixed(0); dlEl.style.color = AT.dailyPnL < 0 ? 'var(--red)' : 'var(--grn)'; }
}

// ─── CONDITION CHECKER ─────────────────────────────────────────

// Condition checker
function checkATConditions() {
  const confMin = (typeof BM !== 'undefined' ? BM.confMin : 65) || 65; // [FIX v85.1 F2] sursă unică — era ||68 inconsistent
  const sigMin = parseInt(el('atSigMin')?.value) || 3;

  // 1. Confluence Score — read from canonical BM state, not DOM
  const score = (typeof BM !== 'undefined' && Number.isFinite(BM.confluenceScore)) ? BM.confluenceScore : 50;
  const isBull = score >= confMin;
  const isBear = score <= (100 - confMin);
  setCondUI('atCondConf', isBull || isBear, isBull ? 'BULL ' + score : isBear ? 'BEAR ' + score : score + ' (neutru)');

  // 2. Signal count
  const { bullCount = 0, bearCount = 0 } = S.signalData || {};
  const sigOk = bullCount >= sigMin || bearCount >= sigMin;
  const sigDir = bullCount >= bearCount ? 'bull' : 'bear';
  setCondUI('atCondSig', sigOk, sigOk ? `${Math.max(bullCount, bearCount)}/${sigMin}` : `${Math.max(bullCount, bearCount)}/${sigMin}`);

  // 3. Supertrend direction
  const stFlip = S.signalData?.signals?.find(s => s.name.includes('Supertrend'));
  const stDir = stFlip?.dir;
  const stOk = !!stFlip;
  setCondUI('atCondST', stOk, stOk ? stDir === 'bull' ? 'BULL ✓' : 'BEAR ✓' : 'Nu e flip');

  // 4. ADX filter
  const adxVal = getCurrentADX();
  const adxOk = adxVal === null || adxVal >= 18;
  setCondUI('atCondADX', adxOk, adxVal !== null ? 'ADX ' + adxVal + (adxOk ? ' ✓' : ' ← slab') : 'Se calc...');

  // 5. Hour filter - BUG3 FIX: UTC
  const hourOk = isCurrentTimeOK();
  const { day: curDay2, hour: curHour2 } = getTimeUTC();
  const hourWR2 = DHF.hours[curHour2]?.wr || 60;
  setCondUI('atCondHour', hourOk, hourOk ? `${curDay2} ${String(curHour2).padStart(2, '0')}h UTC WR:${hourWR2}% ✓` : `${String(curHour2).padStart(2, '0')}h UTC WR:${hourWR2}% — EVITA`);

  // 6. No opposite open position
  // [PATCH P1-1] Include live positions when in live mode (was always [])
  const autoPositions = AT.mode === 'demo'
    ? (TP.demoPositions || []).filter(p => p.autoTrade)
    : (TP.livePositions || []).filter(p => p.autoTrade);
  const dir = isBull ? 'LONG' : 'SHORT';
  const hasOpposite = autoPositions.some(p => (dir === 'LONG' && p.side === 'SHORT') || (dir === 'SHORT' && p.side === 'LONG'));
  setCondUI('atCondOpp', !hasOpposite, hasOpposite ? 'Pozitie opusa activa' : 'OK');

  // 7. Magnet alignment bonus
  const magnetBias = S.magnetBias || 'neut';
  const magnetOk = (isBull && magnetBias === 'bull') || (isBear && magnetBias === 'bear') || magnetBias === 'neut';
  // Not a hard block, but logged

  // Max positions check
  const maxPos = parseInt(el('atMaxPos')?.value) || 4;
  const openAuto = autoPositions.length;
  // BUG FIX: Also prevent opening same symbol twice in single-symbol mode
  const symAlreadyOpen = autoPositions.some(p => p.sym === S.symbol);
  const posOk = openAuto < maxPos && !symAlreadyOpen;

  // Cooldown check — per-symbol in multi-symbol mode
  const nowTs = Date.now();
  const _symCd = (AT._cooldownBySymbol && AT._cooldownBySymbol[S.symbol]) || 0;
  const coolOk = (nowTs - Math.max(AT.lastTradeTs, _symCd)) > AT.cooldownMs;

  const allOk = (isBull || isBear) && sigOk && stOk && adxOk && hourOk && !hasOpposite && posOk && coolOk;

  return {
    allOk,
    isBull: isBull && sigDir === 'bull',
    isBear: isBear && sigDir === 'bear',
    score, bullCount, bearCount,
    stDir, posOk, coolOk, adxOk, hourOk
  };
}

function setCondUI(id, ok, txt) {
  const e = el(id); if (!e) return;
  e.textContent = txt;
  e.className = 'at-cond-val ' + (ok ? 'ok' : 'fail');
}


// ══════════════════════════════════════════════════════════════
// ZEUS SAFETY ENGINE v1.0 — 10 protection systems
// ══════════════════════════════════════════════════════════════

// ── GLOBAL SAFETY STATE ──────────────────────────────────────
// [MOVED TO TOP] _SAFETY

// ── 2. NaN / Infinity GUARD ───────────────────────────────────
// Safe math helpers used everywhere
// [MOVED TO TOP] _safe

// ── 4. PRICE SANITY CHECK ─────────────────────────────────────

// Data quality for autotrade
// ─── STALL GRACE PERIOD FOR AUTOTRADE ─────────────────────────
// STALL_GRACE_MS declared in constants.js (loads first)
function isDataOkForAutoTrade() {
  // [v119-p16] Tab hidden gate
  if (_SAFETY.tabHidden) return false;
  // [P2-5] Tab restore grace: wait 5s after tab becomes visible for fresh data
  if (_SAFETY.tabRestoreTs && (Date.now() - _SAFETY.tabRestoreTs) < 5000) return false;
  if (!_SAFETY.dataStalled) return true;
  return (Date.now() - (_SAFETY.dataStalledSince || 0)) < STALL_GRACE_MS;
}

// ═══════════════════════════════════════════════════════════════
//  FUSION BRAIN v1 — agregator toate modulele → decision verdict
//  Injectat: PATCH v118.2.6 (chirurgical, nu rupe nimic existent)
// ═══════════════════════════════════════════════════════════════

// Fusion decision
function _clampFB01(x) { x = +x; return !Number.isFinite(x) ? 0 : Math.max(0, Math.min(1, x)); }
function _clampFB(x, a, b) { x = +x; return !Number.isFinite(x) ? a : Math.max(a, Math.min(b, x)); }

function computeFusionDecision() {
  const reasons = [];
  const out = { ts: Date.now(), dir: 'neutral', decision: 'NO_TRADE', confidence: 0, score: 0 };

  // 1) Confluence (0..100)
  const conf = Number.isFinite(+BM?.confluenceScore) ? +BM.confluenceScore : 50;
  const confN = _clampFB01((conf - 50) / 50);
  reasons.push('Confluence:' + conf.toFixed(0));

  // 2) Scenario / ProbScore
  let prob = null;
  try {
    if (typeof computeProbScore === 'function') {
      const r = computeProbScore();
      if (Number.isFinite(+r)) prob = +r;
      else if (r && Number.isFinite(+r.score)) prob = +r.score;
      else if (r && Number.isFinite(+r.confidence)) prob = +r.confidence;
    }
  } catch (_) { }
  const probN = prob == null ? 0.5 : _clampFB01(prob / 100);
  if (prob != null) reasons.push('Scenario:' + prob.toFixed(0));

  // 3) Regime
  let regime = (BRAIN && BRAIN.regime) ? String(BRAIN.regime) : 'unknown';
  let regimeN = 0.5;
  if (regime.includes('trend')) regimeN = 0.75;
  if (regime.includes('range')) regimeN = 0.55;
  if (regime.includes('chop') || regime.includes('unstable')) regimeN = 0.35;
  reasons.push('Regime:' + regime);

  // 4) OFI / Orderflow
  const buy = Number.isFinite(+BRAIN?.ofi?.buy) ? +BRAIN.ofi.buy : 0;
  const sell = Number.isFinite(+BRAIN?.ofi?.sell) ? +BRAIN.ofi.sell : 0;
  const ofi = (buy + sell) > 0 ? (buy - sell) / (buy + sell) : 0;
  const ofiN = (ofi + 1) / 2;
  if ((buy + sell) > 0) reasons.push('OFI:' + (ofi * 100).toFixed(0) + '%');

  // 5) Liquidity danger
  let liqDangerN = 0.2;
  try {
    const nearPct = Number.isFinite(+window?.MAGNETS?.nearPct) ? +window.MAGNETS.nearPct : null;
    if (nearPct != null) { liqDangerN = _clampFB01(nearPct / 100); reasons.push('LiqDanger:' + nearPct.toFixed(0) + '%'); }
  } catch (_) { }

  // 6) Hard veto: KillSwitch / Session
  if (!!AT?.killTriggered) {
    out.decision = 'NO_TRADE'; out.confidence = 0; out.dir = 'neutral';
    reasons.push('VETO:KillSwitch');
    return { ...out, reasons };
  }

  // 7) Direction score
  let dirScore = 0;
  dirScore += (ofi * 0.55);
  dirScore += ((conf - 50) / 50) * 0.30;
  try {
    if (window.LAST_SCAN && Date.now() - window.LAST_SCAN.ts > 120000) {
      window.LAST_SCAN.sigDir = null;
    }
    const sigDir = window?.LAST_SCAN?.sigDir;
    if (sigDir === 'bull') dirScore += 0.25;
    if (sigDir === 'bear') dirScore -= 0.25;
  } catch (_) { }
  dirScore = _clampFB(dirScore, -1, 1);
  out.dir = dirScore > 0.15 ? 'long' : dirScore < -0.15 ? 'short' : 'neutral';
  reasons.push('DirScore:' + (dirScore * 100).toFixed(0) + '%');

  // 8) Confidence fusion
  const alignN = out.dir === 'neutral' ? 0 : (out.dir === 'long' ? ofiN : (1 - ofiN));
  let confF = (confN * 0.35) + (probN * 0.25) + (regimeN * 0.20) + (alignN * 0.20);
  confF *= (1 - (liqDangerN * 0.55));
  confF = _clampFB01(confF);
  out.confidence = Math.round(confF * 100);

  // 9) Entry tier
  if (out.dir === 'neutral') {
    out.decision = 'NO_TRADE';
  } else if (out.confidence >= 82 && conf >= 75 && regimeN >= 0.55) {
    out.decision = 'LARGE';
  } else if (out.confidence >= 72 && conf >= 68) {
    out.decision = 'MEDIUM';
  } else if (out.confidence >= 62 && conf >= 60) {
    out.decision = 'SMALL';
  } else {
    out.decision = 'NO_TRADE';
  }

  // [P0.1] ARES wallet is 100% independent — never veto AT decisions.
  // ARES manages its own capital, AT manages its own. No cross-interference.

  reasons.push('Decision:' + out.decision + '(' + out.confidence + '%)');
  out.score = Math.round(dirScore * out.confidence);
  return { ...out, reasons };
}

// Wire Fusion Brain into runAutoTradeCheck (post-call observer)
(function _wireFusionIntoAT() {
  // Will wrap after definition — see sentinel below
  window._FUSION_BRAIN_WIRE_PENDING = true;
})();


// Main AT check loop
function runAutoTradeCheck() {
  // [p19] Predator state refresh — always runs
  if (typeof computePredatorState === 'function') { computePredatorState(); }
  // Prevent overlapping AT check cycles
  if (AT.running) return;
  // RUN gates the entire scan/analysis loop
  if (!S.runMode || AT.killTriggered) return;
  AT.running = true;
  try {
    // B: Data stall grace period check BEFORE exec lock
    if (!isDataOkForAutoTrade()) {
      BlockReason.set('DATA_STALL', 'Data stalled > 10s — AT paused', 'autoCheck');
      return;
    }
    // Safety engine check
    const [_execOk, _execReason] = _isExecAllowed();
    if (!_execOk) { atLog('wait', `⏸ AT wait: ${_execReason}`); return; }

    // Reset daily P&L if new day
    const today = new Date().toDateString();
    // Use server day if synced, else local
    const _serverDay = _SAFETY.storedDayId ? _SAFETY.storedDayId : 0;
    const _localDay = new Date().toDateString();
    if (AT.dailyStart !== _localDay || (_serverDay && _serverDay !== _SAFETY._prevServerDay)) {
      AT.dailyPnL = 0; AT.realizedDailyPnL = 0; AT.closedTradesToday = 0;
      AT.dailyStart = _localDay;
      _SAFETY._prevServerDay = _serverDay;
      atLog('info', '📅 Daily counters reset (server UTC sync)');
    }

    // ── KILL SWITCH — realized + unrealized loss ──
    const killPct = parseFloat(el('atKillPct')?.value) || 5;
    const bal = +(AT.mode === 'demo' ? TP.demoBalance : (TP.liveBalance || 10000)) || 10000;
    const _realPnL = +(AT.realizedDailyPnL) || 0;
    // [PATCH3 R2] Include unrealized PnL in kill switch check
    let _unrealPnL2 = 0;
    const _openList2 = AT.mode === 'demo' ? (TP.demoPositions || []) : (TP.livePositions || []);
    for (let i = 0; i < _openList2.length; i++) {
      const _p = _openList2[i];
      if (_p.closed || _p.status === 'closing') continue;
      const _cur = getSymPrice(_p);
      if (_cur > 0 && _p.entry > 0) {
        // [PATCH P1-6] Use _safePnl for consistency
        const _diff2 = _cur - _p.entry;
        _unrealPnL2 += _safePnl(_p.side, _diff2, _p.entry, _p.size || 0, _p.lev || 1, true);
      }
    }
    const _totalDayPnL2 = _realPnL + _unrealPnL2;
    const _closedToday = +(AT.closedTradesToday) || 0;
    // Guard: need at least one closed trade OR significant unrealized loss
    if (_closedToday === 0 && _unrealPnL2 >= 0) { /* skip */ }
    else if (Number.isFinite(_totalDayPnL2) && _totalDayPnL2 < 0 && Math.abs(_totalDayPnL2) / bal * 100 >= killPct) {
      triggerKillSwitch('daily_loss', _totalDayPnL2, _closedToday, killPct, bal);
      return;
    }

    // Multi-symbol mode: scan all symbols
    const multiOn = el('atMultiSym')?.checked !== false;
    if (multiOn) {
      runMultiSymbolScan();
      return; // multi-sym scan handles entries
    }

    // Single symbol mode (original)
    const cond = checkATConditions();

    // [PATCH B2] AT_SCAN log for single-symbol path
    {
      const _dir2 = cond.isBull ? 'bull' : cond.isBear ? 'bear' : 'neut';
      atLog('info', 'AT_SCAN ' + (S.symbol || '').replace('USDT', '') + ' score=' + cond.score + ' dir=' + _dir2);
    }

    // [v119-p7] FUSION_CACHE — actualizat la FIECARE tick, citit de ML vizual (read-only)
    // Separat de FUSION_LAST (care se scrie doar pe semnal). Nu afectează sizing/trade/DSL.
    try {
      if (typeof computeFusionDecision === 'function') {
        const _fcRaw = computeFusionDecision();
        window.FUSION_CACHE = {
          ts: Date.now(),
          dir: _fcRaw.dir || 'neutral',
          decision: _fcRaw.decision || 'NO_TRADE',
          confidence: _fcRaw.confidence || 0,
          score: _fcRaw.score || 0,
        };
      }
    } catch (_) { /* silent — nu blochează AT */ }

    if (!cond.allOk) {
      // [PATCH B3] AT_BLOCK log with context
      {
        const _bDir = cond.isBull ? 'bull' : cond.isBear ? 'bear' : 'neut';
        const _bRe = (typeof BM !== 'undefined' && BM.regimeEngine) ? BM.regimeEngine.regime : '—';
        const _bPh = (typeof BM !== 'undefined' && BM.phaseFilter) ? BM.phaseFilter.phase : '—';
        const _bParts = [];
        if (!cond.posOk) _bParts.push('max_pos');
        if (!cond.coolOk) _bParts.push('cooldown');
        if (!cond.adxOk) _bParts.push('adx_low');
        if (!cond.hourOk) _bParts.push('hour_filter');
        if (!cond.isBull && !cond.isBear) _bParts.push('no_signal');
        atLog('info', 'AT_BLOCK ' + (S.symbol || '').replace('USDT', '') + ' regime=' + _bRe + ' phase=' + _bPh + ' score=' + cond.score + ' dir=' + _bDir + ' reason=' + (_bParts.join(',') || 'conds_unmet'));
      }
      // Update status
      const reasons = [];
      if (!cond.posOk) reasons.push('max pozitii atins');
      if (!cond.coolOk) reasons.push('cooldown');
      { const _oe = el('atStatus'); if (_oe) _oe.textContent = reasons.length ? '⏳ Wait: ' + reasons.join(', ') : '🔍 Scan... conditii neatinse'; }
      return;
    }

    // ✅ All conditions met — clear any stale block reason
    BlockReason.clear();
    ZState.scheduleSave();

    // AT gates execution — if AT OFF, scan still shows signals but no trade
    if (!AT.enabled) {
      const _sigDir = cond.isBull ? 'LONG' : 'SHORT';
      atLog('info', `🔍 Signal ${_sigDir} (score:${cond.score}) but AT OFF — no execution`);
      { const _oe = el('atStatus'); if (_oe) _oe.textContent = '🔍 Signal found — AT OFF'; }
      return;
    }

    const side = cond.isBull ? 'LONG' : 'SHORT';
    // [PATCH B4] AT_SIGNAL log for allowed entry
    {
      const _sPh = (typeof BM !== 'undefined' && BM.phaseFilter) ? BM.phaseFilter.phase : '—';
      const _sConf = (typeof BM !== 'undefined' && BM.regimeEngine) ? BM.regimeEngine.confidence : 0;
      atLog('info', 'AT_SIGNAL ' + (S.symbol || '').replace('USDT', '') + ' side=' + side + ' conf=' + _sConf + ' score=' + cond.score + ' phase=' + _sPh);
    }
    atLog(side === 'LONG' ? 'buy' : 'sell',
      `🎯 SEMNAL ${side} confirmat! Score:${cond.score} | ${Math.max(cond.bullCount, cond.bearCount)} semnale | ST:${cond.stDir} | Magnet:${S.magnetBias || 'neut'}`);

    // ── FUSION BRAIN v1 — final arbiter before exec ──────────────
    try {
      if (typeof computeFusionDecision === 'function') {
        const _fd = computeFusionDecision();
        window.FUSION_LAST = _fd;
        window.FUSION_SIZE_MULT = _fd.decision === 'LARGE' ? 1.75 : _fd.decision === 'MEDIUM' ? 1.35 : 1.0;
        // Log reasons
        if (typeof brainThink === 'function') {
          const _ic = _fd.decision === 'NO_TRADE' ? 'bad' : _fd.decision === 'LARGE' ? 'ok' : 'info';
          brainThink(_ic, '🧠 Fusion: ' + _fd.dir.toUpperCase() + ' | ' + _fd.decision + ' | ' + _fd.confidence + '%');
        }
        if (typeof atLog === 'function') {
          const _rr = (_fd.reasons || []).slice(0, 4).join(' • ');
          atLog(_fd.decision === 'NO_TRADE' ? 'warn' : 'info', 'Fusion → ' + _fd.dir + '/' + _fd.decision + '/' + _fd.confidence + '% | ' + _rr);
        }
        if (_fd.decision === 'NO_TRADE') {
          window._FUSION_VETO = true;
          BlockReason.set('FUSION', 'Fusion Brain: NO_TRADE (' + _fd.confidence + '%) — ' + (_fd.reasons || []).slice(0, 2).join(', '), 'fusionBrain');
          return;
        }
        window._FUSION_VETO = false;
      }
    } catch (_fb_err) { /* fusion non-blocking */ }
    // ─────────────────────────────────────────────────────────────

    placeAutoTrade(side, cond);
  } finally { AT.running = false; }
}

// ─── PLACE AUTO TRADE ──────────────────────────────────────────

// Place auto trade
function placeAutoTrade(side, cond, _sym, _price) {
  // ── KILL SWITCH: check before exec (2. kill timing) ──────────
  if (AT.killTriggered) {
    BlockReason.set('KILL_SWITCH', 'Kill switch activ — AT blocat', 'placeAutoTrade');
    return;
  }
  // [FIX C5] Prevent re-entrant live execution
  if (AT._liveExecInFlight) {
    atLog('warn', '⚠️ Live exec already in flight — skipping duplicate');
    return;
  }
  if (BM?.protectMode) {
    BlockReason.set('PROTECT_MODE', BM.protectReason || 'Protect mode activ', 'placeAutoTrade');
    return;
  }

  // [DSL MODE GUARD] Block trade if DSL mode not selected
  if (!DSL.mode) {
    BlockReason.set('DSL_MODE', 'DSL mode not set — select ATR/FAST/SWING/DEF/TP in Brain cockpit', 'placeAutoTrade');
    if (typeof toast === 'function') toast('⚠️ Set DSL mode in Brain cockpit before trading');
    atLog('warn', '⛔ DSL MODE NOT SET — trade blocked');
    return;
  }

  // [p19 PREDATOR VETO]
  // PREDATOR semantics: KILL=green/all-clear, HUNT=caution, SLEEP=danger
  // Block trades when NOT in KILL (clear) state
  if (typeof PREDATOR !== 'undefined' && PREDATOR.state !== 'KILL') {
    var _pr = 'PREDATOR ' + PREDATOR.state + ' [' + PREDATOR.reason + ']';
    BlockReason.set('PREDATOR', _pr, 'placeAutoTrade');
    if (typeof atLog === 'function') { atLog('warn', '[PREDATOR] VETO: ' + PREDATOR.state + ' / ' + PREDATOR.reason); }
    return;
  }
  // [/p19 PREDATOR VETO]

  // === PATCH B: WR FILTER (by UTC hour → DHF.hours) — EXEC VETO ONLY ===
  // Brain/MI/scoruri rămân active. Doar execuția e blocată în orele slabe.
  // Data layer: UTC (consistent cu DHF.hours indexing și trade logging)
  // UI/log: afișăm și ora RO pentru claritate
  try {
    const _wrCfg = (window.WVE_CONFIG && window.WVE_CONFIG.wrFilter) || null;
    if (_wrCfg && _wrCfg.enabled) {
      const _utcHour = getTimeUTC().hour;                    // lookup UTC — consistent cu DHF
      const _wrVal = DHF.hours?.[_utcHour]?.wr;
      if (typeof _wrVal === 'number' && _wrVal < _wrCfg.minWR) {
        BlockReason.set('WR_FILTER', 'WR ' + _wrVal + '% < ' + _wrCfg.minWR + '% @ UTC' + String(_utcHour).padStart(2, '0') + 'h', 'placeAutoTrade');
        if (!AT._wrLogTs || (Date.now() - AT._wrLogTs) > _wrCfg.warnEveryMs) {
          AT._wrLogTs = Date.now();
          const _roH = getRoTime().hh; // ora RO doar pentru log
          atLog('warn', '⏱️ WR_FILTER veto: UTC' + String(_utcHour).padStart(2, '0') + 'h (RO ' + String(_roH).padStart(2, '0') + 'h) WR=' + _wrVal + '% < min=' + _wrCfg.minWR + '%');
        }
        return;
      }
    }
  } catch (_wrE) { /* non-blocking — nu oprim execuția dacă filtrul crapă */ }
  // === /WR FILTER ===
  const _snap = buildExecSnapshot(side, cond);
  // [PATCH1 B1] buildExecSnapshot returns null if price invalid — reject early
  if (!_snap) {
    BlockReason.set('INVALID_PRICE', 'Snapshot rejected — preț invalid', 'placeAutoTrade');
    atLog('warn', '❌ buildExecSnapshot rejected (price invalid)'); return;
  }
  // Use snapshot values exclusively — never re-read global state
  const sym = _sym || _snap.symbol;
  const entry = _price || _snap.price;
  if (!isValidMarketPrice(entry)) {
    BlockReason.set('INVALID_PRICE', 'Preț invalid la exec', 'placeAutoTrade');
    atLog('warn', '❌ Nu am pret curent la exec'); return;
  }
  // [FIX H2] Dedup: reject if same symbol already has open AT position
  const _existingPos = (AT.mode === 'demo' ? (TP.demoPositions || []) : (TP.livePositions || []))
    .filter(p => p.autoTrade && !p.closed && p.sym === sym);
  if (_existingPos.length > 0) {
    atLog('warn', '⚠️ DEDUP: ' + sym + ' already has open AT position — skipping');
    return;
  }

  const lev = _snap.lev;
  const size = _snap.size;
  // [Level 5] Adaptive position sizing — gated: BM.adapt.enabled
  // Fusion Brain size multiplier (SMALL=1.0 / MEDIUM=1.35 / LARGE=1.75)
  const _fusionMult = Number.isFinite(+window.FUSION_SIZE_MULT) ? +window.FUSION_SIZE_MULT : 1.0;
  const _sizeMult = ((BM.adapt && BM.adapt.enabled) ? (BM.positionSizing && BM.positionSizing.finalMult ? BM.positionSizing.finalMult : 1) : 1) * _fusionMult;
  const _sizeRaw = Math.round(size * _sizeMult);
  const _sizeMin = Math.round(size * 0.5);
  const _sizeMax = Math.round(size * 1.6);
  const safeFinalSize = Math.max(_sizeMin, Math.min(_sizeMax, _sizeRaw));
  // [Etapa 5] Adaptive sizeMult — aplicat ca ULTIM în lanț, după Level 5 sizing
  // Gated: BM.adaptive.enabled. Clamp explicit min/max.
  const _adaptSizeMult = (BM.adaptive && BM.adaptive.enabled) ? (BM.adaptive.sizeMult || 1.0) : 1.0;
  const _adaptSizeRaw = Math.round(safeFinalSize * _adaptSizeMult);
  const adaptFinalSize = Math.max(_sizeMin, Math.min(_sizeMax, _adaptSizeRaw));
  const slPct = _snap.slPct;
  // [v105 FIX Bug4] rr citit din _snap (atomic snapshot) — anterior era re-citit din DOM dupa snapshot
  // Daca utilizatorul modifica atRR intre decizie si executie, ordinul ar fi plasat cu parametri diferiti
  const rr = (Number.isFinite(_snap.rr) && _snap.rr > 0) ? _snap.rr : 2; // [v119-p6 FIX1] snapshot-only, NO DOM fallback

  const slDist = entry * slPct / 100;
  const tpDist = slDist * rr;

  const sl = side === 'LONG' ? entry - slDist : entry + slDist;
  const tp = side === 'LONG' ? entry + tpDist : entry - tpDist;
  const liq = calcLiqPrice(entry, lev, side);

  // [FIX P8] QTY = notional / price (with leverage), margin = adaptFinalSize (IS the margin)
  const qty = (adaptFinalSize * lev) / entry;   // contracts/coins (notional / price)
  const margin = adaptFinalSize;                  // adaptFinalSize IS the margin deducted from balance
  const tpPnl = (tpDist / entry) * adaptFinalSize * lev;   // $ profit at TP
  const slPnl = -(slDist / entry) * adaptFinalSize * lev;  // $ loss at SL (negative)

  // ── EXECUTION FAIL-SAFE ──────────────────────────────────────────
  // Check entry price sanity (slippage guard)
  // [v105 FIX Bug4] slipPct din _snap — consistent cu restul valorilor atomice
  // [v119-p15] eliminat DOM fallback (|| el('atSL')) — _snap.slPct e mereu >= 0.1 (clamped în buildExecSnapshot)
  const slipPct = _snap.slPct;
  // [FIX P14] totalTrades++ AFTER all early validation returns (including price check)
  if (!entry || entry <= 0) {
    atLog('warn', '⛔ EXEC FAIL-SAFE: preț invalid → PROTECT activat');
    BM.protectMode = true; BM.protectReason = '⛔ BLOCKED: ExecutionRisk (invalid price)';
    if (AT.enabled && (S.mode || 'assist') === 'auto') AT.enabled = false;
    const pb = el('protectBanner'); if (pb) pb.className = 'znc-protect show';
    const pbt = el('protectBannerTxt'); if (pbt) pbt.textContent = BM.protectReason;
    return;
  }
  AT.totalTrades++;

  atLog(side === 'LONG' ? 'buy' : 'sell',
    `📋 ${side} ${sym} @$${fP(entry)} | Lev:${lev}x | SL:$${fP(sl)} | TP:$${fP(tp)} | Size:$${safeFinalSize}${safeFinalSize !== size ? ' (adj×' + _sizeMult.toFixed(2) + ')' : ''}`);

  if (AT.mode === 'demo') {
    const pos = {
      id: Date.now(), side, sym, entry, size: adaptFinalSize, lev,
      tp, sl, liqPrice: liq, pnl: 0,
      qty, margin, tpPnl, slPnl,
      autoTrade: true, openTs: Date.now(),
      label: `🤖 AUTO ${side}`,
      // [Level 5] sizing debug fields
      sizeBase: size, sizeFinal: adaptFinalSize, sizeMult: _sizeMult,
      // [Etapa 5] adaptive sizing debug
      adaptSizeMult: _adaptSizeMult,
      // Per-position control mode metadata
      sourceMode: (S.mode || 'assist').toLowerCase(),  // [PATCH1] immutable — original source
      controlMode: (S.mode || 'assist').toLowerCase(),  // mutable — AI or MANUAL
      brainModeAtOpen: (S.mode || 'assist').toLowerCase(),
      dslParams: Object.assign({
        pivotLeftPct: parseFloat(el('dslTrailPct')?.value) || 0.8,
        pivotRightPct: parseFloat(el('dslTrailSusPct')?.value) || 1.0,
        impulseVPct: parseFloat(el('dslExtendPct')?.value) || 20,
      }, typeof calcDslTargetPrice === 'function' ? calcDslTargetPrice(side, entry, tp) : {
        openDslPct: 1.5, dslTargetPrice: side === 'LONG' ? entry * 1.015 : entry * 0.985
      }),
      dslAdaptiveState: 'calm',
      dslHistory: [],
    };
    // [FIX P3] Margin check — reject if insufficient balance (check matches deduction)
    if (TP.demoBalance < adaptFinalSize) {
      AT.totalTrades--;
      BlockReason.set('MARGIN', 'Margin insuficient: need $' + adaptFinalSize.toFixed(2) + ' have $' + TP.demoBalance.toFixed(2), 'placeAutoTrade');
      atLog('warn', '⛔ MARGIN REJECT: need $' + adaptFinalSize.toFixed(2) + ' but demoBalance=$' + TP.demoBalance.toFixed(2));
      return;
    }
    TP.demoPositions.push(pos);
    AT.lastTradeSide = side;
    AT.lastTradeTs = Date.now();
    if (!AT._cooldownBySymbol) AT._cooldownBySymbol = {};
    AT._cooldownBySymbol[sym] = Date.now();
    TP.demoBalance -= adaptFinalSize;
    updateDemoBalance();
    renderDemoPositions();
    renderATPositions();
    onPositionOpened(pos, 'auto_demo');  // 3: DSL attach for auto-trade positions
    srLinkTrade(pos);  // [SR] leagă cel mai recent semnal de această poziţie
    if (typeof aubBBSnapshot === 'function') aubBBSnapshot('TRADE_OPEN', { sym: pos.sym, side: pos.side, entry: pos.entry, size: pos.size, lev: pos.lev, score: (typeof BM !== 'undefined' ? BM.entryScore : 0) });
    addTradeToJournal({
      time: fmtNow(),
      side, sym: sym.replace('USDT', ''),
      entry, exit: null, pnl: 0, reason: '🤖 AUTO — Score:' + cond.score, lev,
      // [Etapa 4] Journal Context — salvat la OPEN (citit de Etapa 5 doar dacă journalEvent==='CLOSE')
      journalEvent: 'OPEN',
      regime: BM.regime || BM.structure?.regime || '—',
      alignmentScore: BM.structure?.score ?? null,
      volRegime: BM.volRegime || '—',
      profile: S.profile || 'fast',
    });
    { const _oe = el('atStatus'); if (_oe) _oe.textContent = `✅ ${side} deschis @$${fP(entry)}`; }
    toast(`🤖 AUTO ${side} ${sym.replace('USDT', '')} deschis! SL:$${fP(sl)} TP:$${fP(tp)}`);
    ncAdd('info', 'trade', `🤖 AUTO ${side} ${sym.replace('USDT', '')} @$${fP(entry)} | SL:$${fP(sl)} TP:$${fP(tp)}`);  // [NC]
    if (typeof onTradeExecuted === 'function') onTradeExecuted({ ...pos, score: cond?.score || BM?.entryScore || 0 });
    scheduleAutoClose(pos);
    ZState.scheduleSave();  // persist new position
  } else {
    if (!TP.liveConnected) {
      atLog('warn', '❌ LIVE: API neconectat! Conectati in panoul LIVE TRADING.');
      toast('❌ API neconectat — Auto trade anulat');
      AT.totalTrades--;
      return;
    }
    // ─── LIVE EXECUTION via backend API ───
    AT._liveExecInFlight = true; // [FIX C5] guard against concurrent live exec
    (async function _liveExec() {
      let _livePosPushed = false; // [PATCH2 B2] track if position was added to array
      // [FIX R10] Declare pos outside try so catch block can access it
      let pos = null;
      try {
        // Set leverage first (best-effort — some exchanges reject if already set)
        try { await liveApiSetLeverage(sym, lev); } catch (_levErr) {
          atLog('warn', '⚠️ Leverage set failed (may already be set): ' + (_levErr.message || _levErr));
        }
        // Place MARKET order through backend proxy → Binance Testnet
        // [FIX P2] quantity must include leverage: (margin × lev) / price = notional / price
        const result = await liveApiPlaceOrder({
          symbol: sym,
          side: side === 'LONG' ? 'BUY' : 'SELL',
          type: 'MARKET',
          quantity: String((adaptFinalSize * lev) / entry),
          referencePrice: entry,
        });
        // Build position from exchange response
        const fillPrice = parseFloat(result.avgPrice) || entry;
        // [FIX A1] Recalculate SL/TP from actual fill price, not pre-fill entry
        const _liveSlDist = fillPrice * slPct / 100;
        const _liveTpDist = _liveSlDist * rr;
        const _liveSL = side === 'LONG' ? fillPrice - _liveSlDist : fillPrice + _liveSlDist;
        const _liveTP = side === 'LONG' ? fillPrice + _liveTpDist : fillPrice - _liveTpDist;
        const _liveLiq = calcLiqPrice(fillPrice, lev, side);
        pos = {
          id: result.orderId || Date.now(),
          orderId: result.orderId,
          side: side,
          sym: sym,
          entry: fillPrice,
          size: adaptFinalSize,
          lev: lev,
          tp: _liveTP,
          sl: _liveSL,
          liqPrice: _liveLiq,
          pnl: 0,
          qty: parseFloat(result.executedQty) || (adaptFinalSize / fillPrice),
          margin: adaptFinalSize / lev,
          tpPnl: (_liveTpDist / fillPrice) * adaptFinalSize * lev,
          slPnl: -(_liveSlDist / fillPrice) * adaptFinalSize * lev,
          autoTrade: true,
          isLive: true,
          status: 'open', // [PATCH2 B3] explicit lifecycle status
          label: '🔴 LIVE AUTO ' + side,
          // Per-position control mode metadata
          sourceMode: (S.mode || 'assist').toLowerCase(),  // [PATCH1] immutable — original source
          controlMode: (S.mode || 'assist').toLowerCase(),  // mutable — AI or MANUAL
          brainModeAtOpen: (S.mode || 'assist').toLowerCase(),
          dslParams: Object.assign({
            pivotLeftPct: parseFloat(el('dslTrailPct')?.value) || 0.8,
            pivotRightPct: parseFloat(el('dslTrailSusPct')?.value) || 1.0,
            impulseVPct: parseFloat(el('dslExtendPct')?.value) || 20,
          }, typeof calcDslTargetPrice === 'function' ? calcDslTargetPrice(side, fillPrice, _liveTP) : {
            openDslPct: 1.5, dslTargetPrice: side === 'LONG' ? fillPrice * 1.015 : fillPrice * 0.985
          }),
          dslAdaptiveState: 'calm',
          dslHistory: [],
        };
        TP.livePositions.push(pos);
        _livePosPushed = true; // [PATCH2 B2] mark: position now in array
        AT.lastTradeSide = side;
        AT.lastTradeTs = Date.now();
        if (!AT._cooldownBySymbol) AT._cooldownBySymbol = {};
        AT._cooldownBySymbol[sym] = Date.now();
        renderLivePositions();
        atLog('buy', '🔴 LIVE ORDER FILLED: ' + side + ' ' + sym + ' @$' + fP(fillPrice) + ' qty:' + pos.qty + ' orderId:' + pos.orderId);
        toast('🔴 LIVE ' + side + ' ' + sym.replace('USDT', '') + ' FILLED @$' + fP(fillPrice));
        ncAdd('info', 'trade', '🔴 LIVE ' + side + ' ' + sym.replace('USDT', '') + ' @$' + fP(fillPrice) + ' | SL:$' + fP(_liveSL) + ' TP:$' + fP(_liveTP));
        scheduleAutoClose(pos);
        // [FIX QA-H2 + R4] Place exchange-level SL/TP with retry logic
        // If both SL and TP fail after retries, mark position as UNPROTECTED
        let _slOk = false, _tpOk = false;
        for (let _slRetry = 0; _slRetry < 3 && !_slOk; _slRetry++) {
          try {
            await aresSetStopLoss({ symbol: sym, side: side === 'LONG' ? 'BUY' : 'SELL', quantity: String(pos.qty), stopPrice: _liveSL });
            _slOk = true;
            atLog('info', '✅ LIVE SL set @$' + fP(_liveSL));
          } catch (_slErr) {
            atLog('warn', '⚠️ LIVE SL attempt ' + (_slRetry + 1) + '/3 failed: ' + (_slErr.message || _slErr));
            if (_slRetry < 2) await new Promise(r => setTimeout(r, 1000));
          }
        }
        for (let _tpRetry = 0; _tpRetry < 3 && !_tpOk; _tpRetry++) {
          try {
            await aresSetTakeProfit({ symbol: sym, side: side === 'LONG' ? 'BUY' : 'SELL', quantity: String(pos.qty), stopPrice: _liveTP });
            _tpOk = true;
            atLog('info', '✅ LIVE TP set @$' + fP(_liveTP));
          } catch (_tpErr) {
            atLog('warn', '⚠️ LIVE TP attempt ' + (_tpRetry + 1) + '/3 failed: ' + (_tpErr.message || _tpErr));
            if (_tpRetry < 2) await new Promise(r => setTimeout(r, 1000));
          }
        }
        // [FIX R4] If protection failed, flag position and alert user
        if (!_slOk || !_tpOk) {
          pos._unprotected = true;
          pos._unprotectedReason = (!_slOk && !_tpOk) ? 'SL+TP failed' : !_slOk ? 'SL failed' : 'TP failed';
          atLog('warn', '🚨 LIVE POSITION UNPROTECTED: ' + pos._unprotectedReason + ' for ' + sym + ' after 3 retries each');
          ncAdd('critical', 'alert', '🚨 UNPROTECTED LIVE: ' + sym + ' ' + side + ' — ' + pos._unprotectedReason + '. Check exchange manually!');
          toast('🚨 ' + sym + ' UNPROTECTED — ' + pos._unprotectedReason);
        }
        // [FIX C4] Persist live position to local state immediately after push
        ZState.save();
        // Sync balance after trade
        try { await liveApiSyncState(); } catch (_) { }
      } catch (err) {
        AT.totalTrades--;
        // [PATCH2 B2] If position was pushed but post-processing failed, remove zombie
        if (_livePosPushed) {
          const _zIdx = TP.livePositions.findIndex(p => p.orderId && p.orderId === err?._orderId);
          // BUG-09 FIX: Fallback matches by the specific position ID, not just symbol
          // [FIX AT-J1] Guard against pos being null if error thrown before pos assignment
          const _zIdx2 = _zIdx >= 0 ? _zIdx : (pos ? TP.livePositions.findIndex(p => p.id === pos.id) : -1);
          if (_zIdx2 >= 0) {
            TP.livePositions.splice(_zIdx2, 1);
            atLog('warn', '🧹 ZOMBIE CLEANUP: removed orphan live position for ' + sym);
          }
          renderLivePositions();
        }
        atLog('warn', '❌ LIVE ORDER FAILED: ' + (err.message || err));
      } finally {
        AT._liveExecInFlight = false; // [FIX C5] release guard
      }
    })();
  }
  updateATStats();
}

// ─── AUTO-CLOSE MONITOR ────────────────────────────────────────

// Auto-close monitor
function scheduleAutoClose(pos) {
  function getPosPrice() {
    // BUG2 FIX: use allPrices (works for any symbol, live or demo)
    if (allPrices[pos.sym] && allPrices[pos.sym] > 0) return allPrices[pos.sym];
    if (pos.sym === S.symbol || !pos.sym) return S.price;
    // [v105 FIX Bug3] Verifica freshness wlPrices — nu folosi pret stale pentru SL/TP
    const wlEntry = wlPrices[pos.sym] || wlPrices[pos.sym + 'USDT'];
    if (wlEntry?.price && wlEntry.price > 0) {
      const age = wlEntry.ts ? (Date.now() - wlEntry.ts) : 0;
      if (age < 30000) return wlEntry.price;
      console.warn('[getPosPrice] Stale WS price for', pos.sym, '— skip SL/TP check');
      return null;
    }
    return null;
  }

  // [v119-p18] TTP — Trailing Take Profit (watch-only → live-ready)
  // Init la launch — nu persistat, nu rehydratat (resetat automat la fiecare scheduleAutoClose)
  pos.ttpPeak = null;  // cel mai bun pret atins de la open
  pos.ttpPeakTs = 0;     // timestamp peak — pentru log peakAge
  pos.ttpActive = false; // true dupa armare completa
  pos.ttpArmTs = 0;     // timestamp cand profit a depasit pragul (anti-flicker)
  pos.ttpArmProfit = 0;     // profitPct la momentul armarii — black-box diagnostic
  pos.ttpCoolTick = 0;     // tick-counter cooldown dupa armare (anti-wick)

  // Configurare TTP — suprascris din window.WVE_CONFIG.ttp daca exista
  const TTP_CFG = Object.assign({
    armPct: 0.008,
    trailPct: 0.003,
    armHoldMs: 20000,
    coolTicks: 2,
    watchOnly: true,
  }, (window.WVE_CONFIG && window.WVE_CONFIG.ttp) || {});

  const _posKey = 'posCheck_' + pos.id;
  const checkId = Intervals.set(_posKey, () => {
    if (pos.closed) { Intervals.clear(_posKey); return; }
    const cur = getPosPrice();
    if (!cur) { return; }

    const effectiveSL = (DSL.enabled && DSL.positions[String(pos.id)]?.active)
      ? DSL.positions[String(pos.id)].currentSL : pos.sl;

    // Ordinea: TP -> SL/DSL -> LIQ -> TTP
    let reason = null;
    if (pos.side === 'LONG') {
      if (cur >= pos.tp) reason = 'TP \u2705';
      else if (cur <= effectiveSL) reason = DSL.positions[String(pos.id)]?.active ? '\uD83C\uDFAF DSL HIT \uD83D\uDED1' : 'SL \uD83D\uDED1';
      else if (cur <= pos.liqPrice) reason = '\uD83D\uDC80 LIQ';
    } else {
      if (cur <= pos.tp) reason = 'TP \u2705';
      else if (cur >= effectiveSL) reason = DSL.positions[String(pos.id)]?.active ? '\uD83C\uDFAF DSL HIT \uD83D\uDED1' : 'SL \uD83D\uDED1';
      else if (cur >= pos.liqPrice) reason = '\uD83D\uDC80 LIQ';
    }

    // [v119-p18] TTP — ruleaza DOAR daca TP/SL/LIQ nu au decis deja
    if (!reason) {
      try {
        const now = Date.now();
        const origTP = DSL.positions[String(pos.id)]?.originalTP;
        const tpManual = (origTP != null && Math.abs(pos.tp - origTP) > 0.01);

        if (!tpManual && pos.entry && cur && Number.isFinite(cur)) {
          const profitPct = pos.side === 'LONG'
            ? (cur - pos.entry) / pos.entry
            : (pos.entry - cur) / pos.entry;

          // Peak tracking separat pe side
          if (pos.side === 'LONG') {
            if (pos.ttpPeak === null || cur > pos.ttpPeak) { pos.ttpPeak = cur; pos.ttpPeakTs = now; }
          } else {
            if (pos.ttpPeak === null || cur < pos.ttpPeak) { pos.ttpPeak = cur; pos.ttpPeakTs = now; }
          }

          // Armare cu anti-flicker
          if (!pos.ttpActive) {
            if (profitPct >= TTP_CFG.armPct) {
              if (!pos.ttpArmTs) pos.ttpArmTs = now;
              if ((now - pos.ttpArmTs) >= TTP_CFG.armHoldMs) {
                pos.ttpActive = true; pos.ttpArmProfit = profitPct; pos.ttpCoolTick = 0;
                if (typeof ZLOG !== 'undefined')
                  ZLOG.push('INFO', '[TTP] ARMED pos#' + pos.id + ' side=' + pos.side +
                    ' profitAtArm=' + (profitPct * 100).toFixed(2) + '%' +
                    ' peak=' + pos.ttpPeak?.toFixed(2) + ' heldMs=' + (now - pos.ttpArmTs));
              }
            } else {
              // Sync reset — nicio fantoma
              pos.ttpArmTs = 0; pos.ttpPeak = null; pos.ttpPeakTs = 0; pos.ttpArmProfit = 0;
            }
          }

          // Cooldown dupa armare
          if (pos.ttpActive) {
            if (pos.ttpCoolTick < TTP_CFG.coolTicks) {
              pos.ttpCoolTick++;
            } else if (pos.ttpPeak !== null) {
              const retracePct = pos.side === 'LONG'
                ? (pos.ttpPeak - cur) / pos.ttpPeak
                : (cur - pos.ttpPeak) / pos.ttpPeak;

              if (retracePct >= TTP_CFG.trailPct) {
                const peakAgeMs = pos.ttpPeakTs ? (now - pos.ttpPeakTs) : 0;
                const armedForMs = pos.ttpArmTs ? (now - pos.ttpArmTs) : 0;
                const profitAtPeak = pos.side === 'LONG'
                  ? (pos.ttpPeak - pos.entry) / pos.entry
                  : (pos.entry - pos.ttpPeak) / pos.entry;

                if (TTP_CFG.watchOnly) {
                  if (typeof ZLOG !== 'undefined')
                    ZLOG.push('WARN', '[TTP WOULD CLOSE] pos#' + pos.id +
                      ' side=' + pos.side +
                      ' entry=' + pos.entry?.toFixed(2) +
                      ' peak=' + pos.ttpPeak?.toFixed(2) +
                      ' peakAgeMs=' + peakAgeMs +
                      ' cur=' + cur?.toFixed(2) +
                      ' retrace=' + (retracePct * 100).toFixed(2) + '%' +
                      ' profitNow=' + (profitPct * 100).toFixed(2) + '%' +
                      ' profitAtPeak=' + (profitAtPeak * 100).toFixed(2) + '%' +
                      ' profitAtArm=' + (pos.ttpArmProfit * 100).toFixed(2) + '%' +
                      ' armedForMs=' + armedForMs);
                  pos.ttpPeak = cur; pos.ttpPeakTs = now;
                } else {
                  if (!pos.closed) reason = 'TTP \uD83C\uDFAF';
                }
              }
            }
          }
        }
      } catch (ttpErr) {
        try { console.warn('[TTP]', ttpErr && ttpErr.message ? ttpErr.message : ttpErr); } catch (_) { }
      }
    }

    if (reason) {
      Intervals.clear(_posKey); // [v105 FIX Bug5] Intervals.clear — sincronizat cu harta interna, evita intervale orfane
      // ✅ Guard: daca pozitia a fost deja inchisa manual, oprim doar intervalul
      if (pos.closed) return;
      if (reason.includes('DSL HIT') && typeof ZLOG !== 'undefined') ZLOG.push('AT', '[DSL CLOSE TRIGGER] ' + pos.sym + ' ' + pos.side + ' posId=' + pos.id);

      // ─── LIVE vs DEMO branch ───
      if (pos.isLive) {
        // LIVE: verify position still exists in livePositions
        const liveIdx = TP.livePositions.findIndex(p => p.id === pos.id);
        if (liveIdx < 0 || TP.livePositions[liveIdx].closed) {
          if (liveIdx >= 0) TP.livePositions.splice(liveIdx, 1);
          setTimeout(function () { renderLivePositions(); renderATPositions(); }, 0);
          return;
        }
        const cur2 = getPosPrice();
        if (!cur2) return; // stale price — skip this tick, interval will retry
        const diff2 = cur2 - pos.entry;
        const pnl2 = _safePnl(pos.side, diff2, pos.entry, pos.size || 0, pos.lev || 1, true);

        // [PATCH P1-3] Guard: if already closing, skip this tick
        if (pos.status === 'closing') return;

        // Close live position via backend
        closeLivePos(pos.id, '🤖 AUTO ' + reason);

        // AT stats — live close accounting done here (closeLivePos does NOT do AT stats)
        AT.totalPnL += pnl2; AT.dailyPnL += pnl2;
        if (Number.isFinite(pnl2)) { AT.realizedDailyPnL += pnl2; AT.closedTradesToday++; }
        const won2 = pnl2 >= 0;
        if (won2) AT.wins++; else AT.losses++;

        const pnlStr = (pnl2 >= 0 ? '+' : '') + '$' + pnl2.toFixed(2);
        atLog(pnl2 >= 0 ? 'buy' : 'sell', '🔴 LIVE ' + reason + ' — PnL: ' + pnlStr + ' | Close @$' + fP(cur2));
        setTimeout(function () { updateATStats(); }, 50);
        if (S.alerts?.enabled) sendAlert('🤖 Zeus LIVE Auto Trade ' + reason, pos.side + ' ' + pos.sym + ' PnL: ' + pnlStr, 'auto');
      } else {
        // DEMO: original logic (unchanged)
        // ✅ Verifica si daca pozitia exista inca in array (poate a fost inchisa manual din UI)
        // ✅ FIX CRITIC: Daca pozitia nu mai exista sau e closed, sterge din array si oprim
        const posIdx2 = TP.demoPositions.findIndex(p => p.id === pos.id);
        if (posIdx2 < 0 || TP.demoPositions[posIdx2].closed) {
          // Pozitia deja inchisa manual - sterge din array daca mai e acolo
          if (posIdx2 >= 0) TP.demoPositions.splice(posIdx2, 1);
          setTimeout(() => { updateDemoBalance(); renderDemoPositions(); renderATPositions(); }, 0);
          return;
        }

        const cur2 = getPosPrice();
        const diff2 = cur2 - pos.entry;
        const pnl2 = _safePnl(pos.side, diff2, pos.entry, pos.size || 0, pos.lev || 1, true);

        // ✅ Inchidem pozitia — closeDemoPos handles AT.realizedDailyPnL + closedTradesToday
        closeDemoPos(pos.id, '🤖 AUTO ' + reason);

        // [PATCH P0-2] Removed duplicate AT stat accounting — closeDemoPos is single source of truth
        // Only keep AT.totalPnL and AT.dailyPnL (NOT tracked by closeDemoPos)
        AT.totalPnL += pnl2; AT.dailyPnL += pnl2;
        const won2 = pnl2 >= 0;
        if (won2) AT.wins++; else AT.losses++;

        recordAllIndicators(pos, won2); // BUG6 FIX: all indicators from signalData
        const tradeNow = new Date();
        const dayNms = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const tDay = dayNms[tradeNow.getUTCDay()];
        const tHour = tradeNow.getUTCHours();
        if (DHF.days[tDay]) { DHF.days[tDay].trades++; if (won2) DHF.days[tDay].wins++; DHF.days[tDay].wr = Math.round(DHF.days[tDay].wins / DHF.days[tDay].trades * 100); }
        if (DHF.hours[tHour] !== undefined) { DHF.hours[tHour].trades++; if (won2) DHF.hours[tHour].wins++; DHF.hours[tHour].wr = Math.round(DHF.hours[tHour].wins / DHF.hours[tHour].trades * 100); }
        setTimeout(renderDHF, 500);

        const pnlStr = (pnl2 >= 0 ? '+' : '') + '$' + pnl2.toFixed(2);
        atLog(pnl2 >= 0 ? 'buy' : 'sell', reason + ' — PnL: ' + pnlStr + ' | Close @$' + fP(cur2));
        setTimeout(() => updateATStats(), 50);
        if (S.alerts?.enabled) sendAlert(`🤖 Zeus Auto Trade ${reason}`, `${pos.side} ${pos.sym} PnL: ${pnlStr}`, 'auto');
      } // end DEMO branch
    }
  }, 3000);  // [P2-2] 3s polling for responsive SL/TP detection

  // BUG-08 FIX: Removed 24h forced timeout — positions stay monitored indefinitely
  // Interval self-clears when pos.closed is detected
}

// ─── KILL SWITCH ───────────────────────────────────────────────

// ── KILL SWITCH FAST-PATH — call after any PnL update ────────────

// Kill switch
function checkKillThreshold() {
  if (AT.killTriggered) return;
  const killPct = parseFloat(el('atKillPct')?.value) || 5;
  const bal = +(AT.mode === 'demo' ? TP.demoBalance : (TP.liveBalance || 10000)) || 10000;
  const _realPnL = +(AT.realizedDailyPnL) || 0;
  // [PATCH3 R2] Include unrealized PnL from open positions in daily loss check
  let _unrealPnL = 0;
  const _openList = AT.mode === 'demo' ? (TP.demoPositions || []) : (TP.livePositions || []);
  for (let i = 0; i < _openList.length; i++) {
    const _p = _openList[i];
    if (_p.closed || _p.status === 'closing') continue;
    const _cur = getSymPrice(_p);
    if (_cur > 0 && _p.entry > 0) {
      // [PATCH P1-6] Use _safePnl for consistency with closeDemoPos/triggerKillSwitch
      const _diff = _cur - _p.entry;
      _unrealPnL += _safePnl(_p.side, _diff, _p.entry, _p.size || 0, _p.lev || 1, true);
    }
  }
  const _totalDayPnL = _realPnL + _unrealPnL;
  // Guard: need at least one closed trade OR significant unrealized loss
  if (AT.closedTradesToday === 0 && _unrealPnL >= 0) return;
  if (Number.isFinite(_totalDayPnL) && _totalDayPnL < 0 && Math.abs(_totalDayPnL) / bal * 100 >= killPct) {
    triggerKillSwitch('daily_loss', _totalDayPnL, AT.closedTradesToday, killPct, bal);
  }
}

function triggerKillSwitch(reason, realPnL, closedCount2, killPct2, bal2) {
  // [FIX v85 BUG8] Guard complet: dacă deja triggered, nu mai facem nimic (previne race condition)
  if (AT.killTriggered) return;
  AT.killTriggered = true; // setăm imediat, înainte de orice operațiune async
  AT._killTriggeredTs = Date.now(); // [P3-5] timestamp for reset cooldown
  // Log exact values for kill switch
  if (reason === 'daily_loss') {
    atLog('kill', `🚨 KILL SWITCH: Pierdere zilnica ${(+(realPnL) || 0).toFixed(2)}$ >= ${(+(killPct2) || 5).toFixed(1)}% din $${(+(bal2) || 10000).toFixed(0)} | ${+(closedCount2) || 0} trades`);
  }

  AT.enabled = false;
  AT.killTriggered = true;
  Intervals.clear('atCheck'); clearInterval(AT.interval); AT.interval = null;

  // ✅ Inchidem toate pozitiile auto cu PnL corect
  let closedCount = 0;
  let totalEmergencyPnL = 0;
  TP.demoPositions = TP.demoPositions.filter(p => {
    if (!p.autoTrade) return true;
    if (p.closed) return false;
    p.closed = true;
    const closePrice = getSymPrice(p);
    const diff = closePrice - p.entry;
    const pnl = _safePnl(p.side, diff, p.entry, p.size, p.lev, true);
    totalEmergencyPnL += pnl;
    TP.demoBalance += p.size + pnl;
    AT.totalPnL += pnl; AT.dailyPnL += pnl;
    if (pnl >= 0) AT.wins++; else AT.losses++;
    if (DSL.positions[p.id]) delete DSL.positions[p.id];
    if (DSL._attachedIds) DSL._attachedIds.delete(String(p.id));  // 4: cleanup dedupe on close
    addTradeToJournal({
      id: p.id,  // [FIX v85.1 F4] necesar pentru closedPosIds la restore
      time: fmtNow(),
      side: p.side, sym: p.sym.replace('USDT', ''),
      entry: p.entry, exit: closePrice, pnl,
      reason: '🚨 Emergency Stop', lev: p.lev,
      // [Etapa 4] Journal Context — salvat la CLOSE pentru Historical Regime Memory
      journalEvent: 'CLOSE',
      regime: BM.regime || BM.structure?.regime || '—',
      alignmentScore: BM.structure?.score ?? null,
      volRegime: BM.volRegime || '—',
      profile: S.profile || 'fast',
    });
    closedCount++;
    // [FIX C4] Fire side-effects skipped by inline close
    if (typeof _bmPostClose === 'function') _bmPostClose(p, '🚨 Emergency Stop');
    if (typeof srUpdateOutcome === 'function') srUpdateOutcome(p, pnl);
    if (typeof runPostMortem === 'function') setTimeout(function () { runPostMortem(p, pnl, closePrice); }, 200);
    if (Array.isArray(window._demoCloseHooks)) { var _hp = p, _hpnl = pnl; window._demoCloseHooks.forEach(function (fn) { try { fn(_hp, _hpnl, '🚨 Emergency Stop'); } catch (_) { } }); }
    return false;
  });
  // ✅ [PATCH P0-1] Close live positions too (kill switch must cover both modes)
  if (AT.mode === 'live' && Array.isArray(TP.livePositions)) {
    var _liveAT = TP.livePositions.filter(function (p) { return p.autoTrade && !p.closed && p.status !== 'closing'; });
    for (var _li = 0; _li < _liveAT.length; _li++) {
      closeLivePos(_liveAT[_li].id, '🚨 Emergency Stop');
      closedCount++;
    }
  }
  setTimeout(() => { updateDemoBalance(); renderDemoPositions(); renderATPositions(); updateATStats(); }, 0);
  ZState.save();  // immediate save on kill switch (not debounced)

  // Update UI
  const btn = el('atMainBtn');
  if (btn) { btn.className = 'at-main-btn off'; el('atBtnTxt').textContent = 'AUTO TRADE OFF'; }
  const killBtn = el('atKillBtn');
  if (killBtn) killBtn.classList.add('triggered');

  const reasonMap = { manual: 'Stop manual', daily_loss: 'Pierdere zilnica atinsa!' };
  const msg = reasonMap[reason] || reason;
  const pnlStr = (totalEmergencyPnL >= 0 ? '+' : '') + '$' + totalEmergencyPnL.toFixed(2);
  { const _oe = el('atStatus'); if (_oe) _oe.innerHTML = `🚨 KILL ACTIV — <button onclick="resetKillSwitch()" style="color:#00ff88;background:none;border:1px solid #00ff8866;border-radius:2px;padding:1px 5px;font-size:11px;cursor:pointer;font-family:inherit">✅ RESET & REPORNESTE AT</button>`; }
  atLog('kill', `🚨 KILL SWITCH: ${msg} — ${closedCount} pozitii inchise | PnL: ${pnlStr}`);
  toast(`🚨 ${closedCount} pozitii inchise | PnL: ${pnlStr}`);
  if (S.alerts?.enabled) sendAlert('🚨 Zeus Kill Switch', msg, 'kill');
  // [FIX UI] Update banners immediately after kill trigger
  if (typeof atUpdateBanner === 'function') atUpdateBanner();
  if (typeof ptUpdateBanner === 'function') ptUpdateBanner();
}

// ✅ Reset manual imediat - fara asteptare de 30s
function resetKillSwitch() {
  // [P3-5] Minimum 30s cooldown after kill was triggered
  if (AT._killTriggeredTs && (Date.now() - AT._killTriggeredTs) < 30000) {
    var _remaining = Math.ceil((30000 - (Date.now() - AT._killTriggeredTs)) / 1000);
    toast('⏳ Kill switch reset blocat — asteapta ' + _remaining + 's');
    return;
  }
  AT.killTriggered = false;
  AT._killTriggeredTs = 0;
  AT.realizedDailyPnL = 0;
  AT.closedTradesToday = 0;
  AT.dailyPnL = 0;
  AT.enabled = false; // [FIX H5] Ensure AT stays off after reset — user must explicitly re-enable
  const kb = el('atKillBtn');
  if (kb) kb.classList.remove('triggered');
  { const _oe = el('atStatus'); if (_oe) _oe.textContent = '⚡ Resetat — apasa AUTO TRADE pentru a reporni'; }
  atLog('info', '✅ Kill switch resetat manual — poti reactiva Auto Trade');
  toast('✅ Kill switch resetat — apasa AUTO TRADE ON');
  // Persist reset immediately so it survives reload and syncs to server
  if (typeof ZState !== 'undefined') ZState.save();
  atUpdateBanner(); ptUpdateBanner();
}


// Render AT positions — [PERF] throttled to 500ms min interval
var _lastRenderAT = 0, _pendingRenderAT = 0;
function renderATPositions() {
  var _now = Date.now();
  if (_now - _lastRenderAT < 500) { if (!_pendingRenderAT) _pendingRenderAT = setTimeout(renderATPositions, 500 - (_now - _lastRenderAT)); return; }
  _lastRenderAT = _now; _pendingRenderAT = 0;
  const panel = el('atActivePosPanel');
  const cnt = el('atPosCount');
  if (!panel) return;
  // [FIX A2] Include both demo AND live AT positions
  const autoPosns = [
    ...(TP.demoPositions || []).filter(p => p.autoTrade && !p.closed),
    ...(TP.livePositions || []).filter(p => p.autoTrade && !p.closed && p.status !== 'closing'),
  ];
  if (cnt) cnt.textContent = autoPosns.length + ' pozit' + (autoPosns.length === 1 ? 'ie' : 'ii');
  if (!autoPosns.length) {
    panel.innerHTML = '<div style="text-align:center;font-size:13px;color:var(--dim);padding:8px">Nicio pozitie auto deschisa</div>';
    return;
  }
  // Build HTML
  panel.innerHTML = autoPosns.map(pos => {
    // [FIX A5] Use allPrices (consistent with getPosPrice/engine)
    const symPrice = (allPrices[pos.sym] && allPrices[pos.sym] > 0) ? allPrices[pos.sym]
      : (pos.sym === S.symbol ? S.price : (wlPrices[pos.sym]?.price || pos.entry));
    const diff = symPrice - pos.entry;
    const pnl = _safePnl(pos.side, diff, pos.entry, pos.size, pos.lev, true);
    const pnlStr = (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2);
    const pnlPct = (_safe.num(pos.size, null, 1) > 0 ? (pnl / _safe.num(pos.size, null, 1) * 100).toFixed(2) : '0.00');
    const col = pos.side === 'LONG' ? '#00ff88' : '#ff4466';
    const symBase = escHtml((pos.sym || 'BTC').replace('USDT', ''));  // [v105 FIX Bug6] escHtml
    const safeSide = escHtml(pos.side);                           // [v105 FIX Bug6] escHtml

    // TP/SL expected P&L
    const tpPnl = pos.tpPnl || (pos.tp ? Math.abs(pos.tp - pos.entry) / pos.entry * pos.size * pos.lev : 0);
    const slPnl = pos.slPnl || (pos.sl ? -Math.abs(pos.sl - pos.entry) / pos.entry * pos.size * pos.lev : 0);
    const distToTP = pos.tp ? ((Math.abs(symPrice - pos.tp) / symPrice) * 100).toFixed(2) : null;
    const distToSL = pos.sl ? ((Math.abs(symPrice - pos.sl) / symPrice) * 100).toFixed(2) : null;

    // QTY and Margin
    const qty = pos.qty || (pos.size / pos.entry);
    const margin = pos.margin || (pos.size / pos.lev);

    return `<div style="background:#0a0518;border:1px solid ${col}33;border-left:3px solid ${col};border-radius:4px;padding:8px 10px;margin-bottom:6px;font-size:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span style="color:${col};font-weight:700;font-size:14px">🤖 ${safeSide} ${symBase}</span>
        <span style="color:${pnl >= 0 ? '#00ff88' : '#ff4466'};font-size:16px;font-weight:700">${pnlStr} <span style="font-size:12px;opacity:.8">(${pnlPct}%)</span></span>
      </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:5px">
        <div style="color:var(--dim);font-size:11px">Entry<br><span style="color:var(--whi);font-size:13px;font-weight:700">$${fP(pos.entry)}</span></div>
        <div style="color:var(--dim);font-size:11px">Now (${symBase})<br><span style="color:${col};font-size:13px;font-weight:700">$${fP(symPrice)}</span></div>
        <div style="color:var(--dim);font-size:11px">Leverage<br><span style="color:#f0c040;font-size:13px;font-weight:700">${pos.lev}x</span></div>
      </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:5px;padding:4px 6px;background:#060212;border-radius:3px;border:1px solid #1a0a30">
        <div style="color:var(--dim);font-size:11px">QTY (${symBase})<br><span style="color:#00b8d4;font-size:13px;font-weight:700">${qty > 1 ? qty.toFixed(4) : qty.toFixed(6)}</span></div>
        <div style="color:var(--dim);font-size:11px">Margin (USDT)<br><span style="color:#aa44ff;font-size:13px;font-weight:700">$${margin.toFixed(2)}</span></div>
      </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:5px">
        <div style="padding:3px 5px;background:#00d97a0a;border:1px solid #00d97a22;border-radius:3px">
          <div style="font-size:10px;color:#00d97a55;letter-spacing:1px">TP PROFIT</div>
          <div style="font-size:13px;color:#00d97a;font-weight:700">+$${tpPnl.toFixed(2)}</div>
          <div style="font-size:11px;color:var(--dim)">@$${fP(pos.tp)} ${distToTP ? '(' + distToTP + '%)' : ''}</div>
        </div>
        <div style="padding:3px 5px;background:#ff446608;border:1px solid #ff446622;border-radius:3px">
          <div style="font-size:10px;color:#ff446655;letter-spacing:1px">SL RISC</div>
          <div style="font-size:13px;color:#ff4466;font-weight:700">$${slPnl.toFixed(2)}</div>
          <div style="font-size:11px;color:var(--dim)">@$${fP(pos.sl)} ${distToSL ? '(' + distToSL + '%)' : ''}</div>
        </div>
      </div>
            ${pos.liqPrice ? `<div style="font-size:11px;color:#ff8800;margin-bottom:5px">💀 LIQ: $${fP(pos.liqPrice)}</div>` : ''}
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
        <button data-close-id="${pos.id}"
          style="padding:10px 6px;background:#2a0010;border:2px solid #ff4466;color:#ff4466;border-radius:4px;font-size:13px;font-weight:700;cursor:pointer;font-family:var(--ff);touch-action:manipulation;min-height:52px;width:100%;display:block;letter-spacing:.5px;user-select:none;">
          ✕ INCHIDE TOT
        </button>
        <button data-partial-id="${pos.id}"
          style="padding:10px 6px;background:#0d0020;border:2px solid #aa44ff;color:#aa44ff;border-radius:4px;font-size:13px;font-weight:700;cursor:pointer;font-family:var(--ff);touch-action:manipulation;min-height:52px;width:100%;display:block;letter-spacing:.5px;user-select:none;">
          ◑ PARTIAL
        </button>
      </div>
    </div>`;
  }).join('');
  // ✅ Long-press attachment - previne inchideri accidentale la scroll
  panel.querySelectorAll('button[data-close-id]').forEach(function (btn) {
    const id = parseInt(btn.getAttribute('data-close-id'), 10);
    attachConfirmClose(btn, function () { closeAutoPos(id); });
  });
  panel.querySelectorAll('button[data-partial-id]').forEach(function (btn) {
    const id = parseInt(btn.getAttribute('data-partial-id'), 10);
    attachConfirmClose(btn, function () { openPartialClose(id); });
  });
}

// Partial close modal
function openPartialClose(posId) {
  // REQ 2: remove existing modal if already open (prevents duplicate overlay)
  const existing = document.getElementById('partialCloseModal');
  if (existing) existing.remove();

  // [FIX A8] Search both demo and live positions
  const pos = (TP.demoPositions || []).find(p => p.id === posId) || (TP.livePositions || []).find(p => p.id === posId);
  if (!pos) return;
  const symBase = pos.sym.replace('USDT', '');
  const symPrice = (allPrices[pos.sym] && allPrices[pos.sym] > 0) ? allPrices[pos.sym]
    : (pos.sym === S.symbol ? S.price : (wlPrices[pos.sym]?.price || pos.entry));
  const pnl = (pos.side === 'LONG' ? symPrice - pos.entry : pos.entry - symPrice) / pos.entry * pos.size * pos.lev;

  // Simple modal overlay
  const overlay = document.createElement('div');
  overlay.id = 'partialCloseModal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:#06080e;border:1px solid #aa44ff55;border-radius:6px;padding:20px;width:280px;font-family:var(--ff)">
      <div style="font-size:13px;letter-spacing:2px;color:#aa44ff;margin-bottom:12px">◑ INCHIDE PARTIAL — ${pos.side} ${symBase}</div>
      <div style="font-size:12px;color:var(--dim);margin-bottom:4px">Size total: <span style="color:var(--whi)">$${pos.size.toFixed(0)} USDT</span></div>
      <div style="font-size:12px;color:var(--dim);margin-bottom:12px">PnL curent: <span style="color:${pnl >= 0 ? '#00ff88' : '#ff4466'}">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}</span></div>
      <div style="font-size:12px;color:var(--dim);margin-bottom:6px">Procent de inchis:</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px">
        ${[25, 50, 75].map(p => `<button onclick="execPartialClose(${posId},${p})" style="padding:6px;background:#0d1520;border:1px solid #aa44ff33;color:#aa44ff;border-radius:3px;font-size:13px;cursor:pointer;font-family:var(--ff)">${p}%</button>`).join('')}
      </div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:10px">
        <input type="number" id="partialPct" value="50" min="1" max="99" style="flex:1;background:#0a0518;border:1px solid #aa44ff33;color:#cc88ff;padding:5px 8px;font-size:13px;border-radius:3px;font-family:var(--ff)">
        <span style="color:var(--dim);font-size:12px">%</span>
        <button onclick="execPartialClose(${posId},parseInt(document.getElementById('partialPct').value))"
          style="padding:5px 10px;background:#aa44ff22;border:1px solid #aa44ff44;color:#aa44ff;border-radius:3px;font-size:12px;cursor:pointer;font-family:var(--ff)">OK</button>
      </div>
      <button onclick="document.getElementById('partialCloseModal').remove()"
        style="width:100%;padding:5px;background:#1a0008;border:1px solid #ff335533;color:#ff4466;border-radius:3px;font-size:12px;cursor:pointer;font-family:var(--ff)">ANULEAZA</button>
    </div>`;
  document.body.appendChild(overlay);
}

function execPartialClose(posId, pct) {
  document.getElementById('partialCloseModal')?.remove();
  if (!pct || pct <= 0 || pct >= 100) { toast('Procent invalid'); return; }
  // [FIX A3] Search both demo and live positions
  let idx = (TP.demoPositions || []).findIndex(p => p.id === posId);
  let _isLivePartial = false;
  if (idx < 0) { idx = (TP.livePositions || []).findIndex(p => p.id === posId); _isLivePartial = idx >= 0; }
  if (idx < 0) return;
  const pos = _isLivePartial ? TP.livePositions[idx] : TP.demoPositions[idx];
  const symPrice = (allPrices[pos.sym] && allPrices[pos.sym] > 0) ? allPrices[pos.sym]
    : (pos.sym === S.symbol ? S.price : (wlPrices[pos.sym]?.price || pos.entry));
  const fraction = pct / 100;
  const partialSize = pos.size * fraction;
  const diff = symPrice - pos.entry;
  const partialPnl = _safePnl(pos.side, diff, pos.entry, partialSize, pos.lev, true);

  // Reduce position size
  pos.size = pos.size * (1 - fraction);
  pos.qty = (pos.qty || pos.size / pos.entry) * (1 - fraction);
  pos.margin = (pos.margin || (pos.size / pos.lev)) * (1 - fraction);
  // [FIX A3] Live partial: don't touch demoBalance
  if (!_isLivePartial) TP.demoBalance += partialSize + partialPnl;
  if (partialPnl >= 0) { if (!_isLivePartial) TP.demoWins++; } else { if (!_isLivePartial) TP.demoLosses++; }

  addTradeToJournal({
    time: fmtNow(),
    side: pos.side, sym: pos.sym.replace('USDT', ''),
    entry: pos.entry, exit: symPrice,
    pnl: partialPnl, reason: `◑ PARTIAL ${pct}%`, lev: pos.lev,
    // [Etapa 4] Journal Context — salvat la CLOSE pentru Historical Regime Memory
    journalEvent: 'CLOSE',
    regime: BM.regime || BM.structure?.regime || '—',
    alignmentScore: BM.structure?.score ?? null,
    volRegime: BM.volRegime || '—',
    profile: S.profile || 'fast',
  });

  atLog('info', `◑ Partial close ${pct}% — ${pos.sym.replace('USDT', '')} PnL: ${partialPnl >= 0 ? '+' : ''}$${partialPnl.toFixed(2)}`);
  toast(`◑ ${pct}% inchis — PnL: ${partialPnl >= 0 ? '+' : ''}$${partialPnl.toFixed(2)}`);
  updateDemoBalance(); renderDemoPositions(); renderATPositions(); updateATStats();
}

function closeAutoPos(id) {
  const numId = (typeof id === 'string') ? parseInt(id, 10) : Number(id);

  // ─── Check live positions first ───
  const livePos = TP.livePositions.find(p => (p.id === numId || p.id === id) && !p.closed);
  if (livePos) {
    const cur = getSymPrice(livePos);
    const diff = cur - livePos.entry;
    const pnl = _safePnl(livePos.side, diff, livePos.entry, livePos.size, livePos.lev, true);
    closeLivePos(numId, '✋ Manual inchis');
    AT.totalPnL += pnl; AT.dailyPnL += pnl;
    if (pnl >= 0) AT.wins++; else AT.losses++;
    atLog(pnl >= 0 ? 'buy' : 'sell', '🔴 LIVE ✋ MANUAL CLOSE: ' + livePos.sym.replace('USDT', '') + ' PnL: ' + (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2));
    setTimeout(function () { updateATStats(); renderATPositions(); renderLivePositions(); }, 50);
    return;
  }

  // ─── Demo positions (original logic) ───
  const pos = TP.demoPositions.find(p => (p.id === numId || p.id === id) && !p.closed);
  if (!pos) { renderATPositions(); return; }

  const cur = getSymPrice(pos);
  const diff = cur - pos.entry;
  const pnl = _safePnl(pos.side, diff, pos.entry, pos.size, pos.lev, true);

  // ✅ FIX SYNC: Marchez ca autoTrade close manual INAINTE de closeDemoPos
  // asa closeDemoPos stie sa updateze AT stats corect
  pos._manualATClose = true;

  // closeDemoPos sterge din array + updateaza AMBELE panouri
  closeDemoPos(numId, '✋ Manual inchis');

  // AT stats
  AT.totalPnL += pnl; AT.dailyPnL += pnl;
  if (pnl >= 0) AT.wins++; else AT.losses++;
  atLog(pnl >= 0 ? 'buy' : 'sell', `✋ MANUAL CLOSE: ${pos.sym.replace('USDT', '')} PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);
  setTimeout(() => { updateATStats(); renderATPositions(); renderDemoPositions(); }, 50);
}

// ✅ NOU: Inchide TOATE pozitiile (AT + Paper Trading manual)
function closeAllDemoPos() {
  // ─── Close live positions first ───
  const livePosns = [...TP.livePositions].filter(p => !p.closed);
  livePosns.forEach(function (p) {
    // [FIX P7] Let closeLivePos handle the close; track AT stats + kill switch for live AT positions
    if (p.autoTrade) {
      const cur = getSymPrice(p) || p.entry;
      const pnl = calcPosPnL(p, cur);
      AT.totalPnL += pnl; AT.dailyPnL += pnl;
      if (pnl >= 0) AT.wins++; else AT.losses++;
      // [FIX P7] Kill switch accounting for live (closeLivePos doesn't touch these)
      AT.realizedDailyPnL = (AT.realizedDailyPnL || 0) + pnl;
      AT.closedTradesToday = (AT.closedTradesToday || 0) + 1;
    }
    closeLivePos(p.id, '✋ Close All');
  });
  // ─── Close demo positions — closeDemoPos handles balance + kill switch stats ───
  const posns = [...TP.demoPositions].filter(p => !p.closed);
  const totalClosed = livePosns.length + posns.length;
  if (!totalClosed) { toast('📋 Nu exista pozitii deschise'); return; }
  posns.forEach(p => {
    // [FIX P7] Only track AT.totalPnL/dailyPnL/wins/losses here (closeDemoPos handles realizedDailyPnL + closedTradesToday)
    if (p.autoTrade) {
      const cur = getSymPrice(p) || p.entry;
      const diff = cur - p.entry;
      const pnl = _safePnl(p.side, diff, p.entry, p.size, p.lev, true);
      AT.totalPnL += pnl; AT.dailyPnL += pnl;
      if (pnl >= 0) AT.wins++; else AT.losses++;
    }
    closeDemoPos(p.id, '✋ Close All');
  });
  // [FIX P7] Check kill switch after all live closes
  if (livePosns.some(p => p.autoTrade)) checkKillThreshold();
  setTimeout(() => { renderATPositions(); updateATStats(); }, 100);
  toast('✅ Inchis ' + totalClosed + ' pozitii');
}

// ===================================================================
// ⚡ END AUTO TRADE ENGINE
// ===================================================================

// ===================================================================
// ⚡ CLOSE PROTECTION — confirmare în 2 pași (state global, rezistent la HTML rebuild)
// ===================================================================
// State stocat global pe ID-ul pozitiei, nu pe elementul button
// Astfel supravietuieste rebuild-ului HTML din _demoTick

