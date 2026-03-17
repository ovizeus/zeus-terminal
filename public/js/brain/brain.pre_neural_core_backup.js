// Zeus v122 — brain/brain.js
// Brain state machine, neurons, update loop, cockpit
'use strict';

// Neuron updater
function updateNeurons() {
  const rsiV = S.rsi?.['5m'];
  const rsi1h = S.rsi?.['1h'];
  const sigs = S.signalData?.signals || [];
  const bullC = S.signalData?.bullCount || 0;
  const bearC = S.signalData?.bearCount || 0;

  // RSI neuron
  if (rsiV !== null && rsiV !== undefined) {
    const rsiOk = rsiV > 55 || rsiV < 45;
    const rsiDir = rsiV > 55 ? '▲' : rsiV < 45 ? '▼' : '—';
    setNeuron('rsi', rsiOk ? (rsiV > 55 ? 'ok' : 'fail') : 'wait', rsiDir + rsiV.toFixed(0));
  }

  // MACD neuron
  const hasMacd = sigs.some(s => s.name.includes('MACD'));
  const macdDir = sigs.find(s => s.name.includes('MACD'));
  setNeuron('macd', hasMacd ? (macdDir?.dir === 'bull' ? 'ok' : 'fail') : 'wait', hasMacd ? (macdDir?.dir === 'bull' ? '▲' : '▼') : '—');

  // SuperTrend neuron
  const hasST = sigs.some(s => s.name.includes('Supertrend'));
  const stDir = sigs.find(s => s.name.includes('Supertrend'));
  setNeuron('st', hasST ? (stDir?.dir === 'bull' ? 'ok' : 'fail') : 'wait', hasST ? (stDir?.dir === 'bull' ? 'BULL' : 'BEAR') : 'N/A');

  // Volume neuron
  const hasVol = sigs.some(s => s.name.toLowerCase().includes('vol'));
  setNeuron('vol', hasVol ? 'ok' : 'wait', S.vol24h ? '↑' : '—');

  // Funding Rate neuron
  if (S.fr !== null && S.fr !== undefined) {
    const frBull = S.fr < 0;
    const frExtreme = Math.abs(S.fr) * 10000 > 5;
    setNeuron('fr', frExtreme ? (frBull ? 'ok' : 'fail') : 'wait',
      (S.fr >= 0 ? '+' : '') + (S.fr * 100).toFixed(3) + '%');
  }

  // Magnet neuron
  const mb = S.magnetBias;
  setNeuron('mag', mb === 'bull' ? 'ok' : mb === 'bear' ? 'fail' : 'wait',
    mb === 'bull' ? '↑BULL' : mb === 'bear' ? '↓BEAR' : 'NEUT');

  // Regime neuron
  const r = BRAIN.regime;
  setNeuron('reg', r === 'trend' ? 'ok' : r === 'volatile' ? 'fail' : 'wait',
    r === 'trend' ? 'TREND' : r === 'volatile' ? 'VOLAT' : r === 'range' ? 'RANGE' : '—');

  // OFI neuron
  const ofi = BRAIN.ofi.blendBuy || 50;
  setNeuron('ofi', ofi > 57 ? 'ok' : ofi < 43 ? 'fail' : 'wait',
    ofi.toFixed(0) + '%B');

  // ADX neuron — update with live value
  const liveADX = getCurrentADX();
  if (liveADX !== null) {
    setNeuron('adx', liveADX >= 25 ? 'ok' : liveADX >= 18 ? 'wait' : 'fail',
      'ADX ' + (liveADX || '—'));
  }

  // Activate neuron dots on SVG
  const dotColors = {
    0: getNeuronColor('rsi'), 1: getNeuronColor('macd'), 2: getNeuronColor('st'),
    3: getNeuronColor('vol'), 4: getNeuronColor('fr'), 5: getNeuronColor('mag')
  };
  Object.entries(dotColors).forEach(([i, col]) => {
    const dot = el('bdot' + i);
    const line = el('bline' + i);
    if (dot) { dot.setAttribute('fill', col + '33'); dot.setAttribute('stroke', col); }
    if (line) { line.setAttribute('stroke', col); line.setAttribute('opacity', '.6'); }
  });
}

function getNeuronColor(id) {
  const n = BRAIN.neurons[id];
  return n === 'ok' ? '#00ff88' : n === 'fail' ? '#ff4444' : n === 'wait' ? '#f0c040' : '#333';
}

function setNeuron(id, state, val) {
  BRAIN.neurons[id] = state;
  const el2 = el('bn-' + id);
  const valEl = el('bnv-' + id);
  if (el2) el2.className = 'neuron ' + state;
  if (valEl) valEl.textContent = val;
}


// Brain arc
function updateBrainArc(score) {
  const arc = el('brainScoreArc');
  const num = el('brainScoreNum');
  const coreBg = el('brainCoreBg');
  const pulse = el('brainPulse1');
  const ring1 = el('brainRing1');
  const ring2 = el('brainRing2');
  const ring3 = el('brainRing3');
  if (!arc) return;

  const circumference = 2 * Math.PI * 38; // ~239
  const dashArray = (score / 100 * circumference).toFixed(1) + ' ' + circumference;

  // Color based on score
  const col = score >= 70 ? '#00ff88' : score >= 55 ? '#f0c040' : score >= 40 ? '#ff8800' : '#ff4444';
  arc.style.strokeDasharray = dashArray;
  arc.style.stroke = col;

  if (num) {
    num.textContent = score > 0 ? score : '—';
    num.style.color = col;
    num.style.textShadow = `0 0 20px ${col}88`;
  }
  if (coreBg) coreBg.setAttribute('fill', col + '08');
  if (ring1) ring1.setAttribute('stroke', col);
  if (ring2) ring2.setAttribute('stroke', col + '88');
  if (ring3) ring3.setAttribute('stroke', col + '44');
  if (pulse) pulse.setAttribute('stroke', col);
}


// Brain state machine
function updateBrainState() {
  // ✅ FIX: Calculeaza scorul direct, nu citeste din DOM (poate fi stale)
  calcConfluenceScore();
  const score = (typeof BM !== 'undefined' ? BM.confluenceScore : 0) || 0; // [FIX v85.1 F3] din memorie
  const bulls = S.signalData?.bullCount || 0;
  const bears = S.signalData?.bearCount || 0;
  const sigs = bulls + bears;
  const hasAutoPos = (TP.demoPositions || []).some(p => p.autoTrade && !p.closed); // [FIX M2]

  let state = 'scanning';
  let ticker = '';

  if (hasAutoPos) {
    state = 'trading';
    const pos = TP.demoPositions.find(p => p.autoTrade);
    const pnl = pos ? ((pos.side === 'LONG' ? S.price - pos.entry : pos.entry - S.price) / pos.entry * pos.size * (pos.lev || 1)) : 0;
    ticker = `POZITIE ACTIVA ${pos?.side} @$${fP(pos?.entry || 0)} | PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} | MONITORIZEZ TP/SL...`;
  } else if (score >= 68 && sigs >= 3) {
    state = 'ready';
    const dir = bulls >= bears ? 'LONG' : 'SHORT';
    ticker = `SEMNAL ${dir} CONFIRMAT! Score:${score} | ${Math.max(bulls, bears)} semnale | REGIM:${BRAIN.regime.toUpperCase()} | ${AT.enabled ? 'TRIMIT ORDIN...' : 'AUTO TRADE OPRIT'}`;
  } else if (score > 0 && sigs >= 1) {
    state = 'analyzing';
    const needing = 3 - sigs;
    const confNeed = Math.max(0, 68 - score);
    ticker = `ANALIZEZ... Score:${score}/68 | ${sigs}/3 semnale | Mai trebuie: ${confNeed > 0 ? '+' + confNeed + ' confluenta' : ''}${needing > 0 ? ' +' + needing + ' semnale' : ''} | OFI:${(BRAIN.ofi.blendBuy || 50).toFixed(0)}%B`;
  } else if (AT.killTriggered) {
    state = 'blocked';
    ticker = `KILL SWITCH ACTIV — BLOCAT. Asteapt reset 30s...`;
  } else {
    state = 'scanning';
    ticker = `SCANEZ... RSI:${(S.rsi?.['5m'] || 0).toFixed(0)} | FR:${S.fr !== null ? (S.fr * 100).toFixed(3) + '%' : '—'} | REGIM:${BRAIN.regime.toUpperCase()} | MAGNET:${(S.magnetBias || 'neut').toUpperCase()} | ${fmtNow(true)}`;
  }

  // [PATCH BRAIN-AT-IDLE] No READY/decision state when AT is OFF
  if (!AT.enabled && state === 'ready') {
    state = 'analyzing';
    ticker = `ANALIZEZ... Score:${score}/68 | ${sigs} semnale | AT OFF`;
  }

  BRAIN.state = state;
  updateBrainArc(score);

  // State badge
  const badge = el('brainStateBadge');
  if (badge) {
    const labels = { scanning: 'SCANNING', analyzing: 'ANALYZING', ready: '⚡ READY', blocked: '⛔ BLOCKED', trading: '🔴 TRADING' };
    badge.textContent = labels[state] || state.toUpperCase();
    badge.className = 'brain-state-badge ' + state;
  }

  // Ticker
  { const _oe = el('brainTickerText'); if (_oe) _oe.textContent = ticker; }

  // Regime badge
  const regime = detectMarketRegime(S.klines || []);
  const regimeBadge = el('brainRegimeBadge');
  const regimeLabels = { trend: '📈 TREND', range: '📊 RANGE', volatile: '⚡ VOLATIL', unknown: '⏳ LOADING' };
  if (regimeBadge) {
    regimeBadge.textContent = regimeLabels[regime] || regime;
    regimeBadge.className = 'brain-regime ' + regime;
  }

  // Update neurons
  updateNeurons();
  updateOrderFlow();
}

// ─── THOUGHT LOG ───────────────────────────────────────────────

// Thought log
function brainThink(type, msg) {
  const log = el('brainThoughtLog');
  if (!log) return;
  const now = fmtNow(true);
  BRAIN.thoughts.unshift({ time: now, type, msg });
  if (BRAIN.thoughts.length > 5) BRAIN.thoughts.pop();
  log.innerHTML = BRAIN.thoughts.map((t, i) =>
    `<div class="thought-line ${i === 0 ? t.type + ' fresh' : t.type}">
      <span style="color:#3a1a60;flex-shrink:0">${t.time}</span>
      <span>${t.msg}</span>
    </div>`).join('');
}


// Brain main loop
function runBrainUpdate() {
  if (!S.price) return;
  // [FIX H6] Removed unconditional AT.enabled gate — brain must observe even when AT is off
  // Entry scoring and param adaptation are independently gated inside their own functions
  // [PATCH MODE-SWITCH] Skip brain cycle while mode switch modal is open
  if (window.__brainModeSwitching) return;
  // [PATCH BRAIN-GUARD] Re-entry guard — prevents multi-fire from timer + WS overlap
  if (window.__brainCycleRunning) return;
  window.__brainCycleRunning = true;
  try {
    updateBrainState();
    adaptAutoTradeParams();

    // Log thoughts when state changes
    const prevState = BRAIN._prevState;
    if (BRAIN.state !== prevState) {
      const msgs = {
        scanning: '🔍 Scanez piata... astept semnale',
        analyzing: '🧮 Semnal detectat — verific confluenta',
        ready: '✅ Toate conditiile OK — gata de intrare',
        blocked: '⛔ Kill switch activ — suspendat',
        trading: '🔴 Pozitie activa — monitorizez TP/SL'
      };
      brainThink(BRAIN.state === 'ready' ? 'ok' : BRAIN.state === 'blocked' ? 'bad' : 'info',
        msgs[BRAIN.state] || BRAIN.state);
      BRAIN._prevState = BRAIN.state;
    }
  } finally { window.__brainCycleRunning = false; }
}
// [runBrainUpdate loop managed in startApp — single instance]

// ===================================================================
// 🧠 END ZEUS BRAIN
// ===================================================================

// ===================================================================
// 🚀 GRAND UPDATE — Brain Modes, Gates, Entry Score, Risk Rails
// ===================================================================

// ── BRAIN MODE STATE ─────────────────────────────────────────────
// [MOVED TO TOP] BM

// ══════════════════════════════════════════════════════════════════
// SINGLE SOURCE OF TRUTH
// S.mode / S.profile / S.runMode / S.dsl.* are canonical.
// BM.* = read-only mirror. Engine reads S.* only.
// UI buttons → call setMode()/setProfile()/setRunMode() only.
// ══════════════════════════════════════════════════════════════════
S.mode = (S.mode && S.mode !== 'manual') ? S.mode : 'assist';
S.profile = S.profile || 'fast';
S.runMode = S.runMode || false;
S.tz = 'Europe/Bucharest';
if (!S.dsl) S.dsl = { active: false, state: 'OFF', pivotL: 1.2, pivotR: 1.4, impulseV: 70, openDsl: 50 };
S.assistArmed = S.assistArmed || false;   // ASSIST mode: must arm before DSL executes

// ── PROFILE → TF mapping (canonical) ─────────────────────────────
// [MOVED TO TOP] PROFILE_TF

// ── ARM_ASSIST ────────────────────────────────────────────────────
// [MOVED TO TOP] ARM_ASSIST

// Arm assist, sync functions  (no timeout — stays armed until user/mode-switch disarms)
function armAssist() {
  ARM_ASSIST.armed = true; ARM_ASSIST.ts = Date.now();
  S.assistArmed = true;
  brainThink('ok', '🔒 ARM ASSIST activ');
  if (typeof _syncDslAssistUI === 'function') _syncDslAssistUI();
}
function disarmAssist() {
  ARM_ASSIST.armed = false; ARM_ASSIST.ts = 0;
  S.assistArmed = false;
  if (typeof _syncDslAssistUI === 'function') _syncDslAssistUI();
}
function isArmAssistValid() {
  return !!ARM_ASSIST.armed;
}

// ── RADIO BUTTON HELPER ───────────────────────────────────────────
function _setRadio(ids, activeId, baseClass, activeClass) {
  // Force-clear ALL then set one — prevents "stuck" states even after rapid toggling
  ids.forEach(id => {
    const b = el(id);
    if (!b) return;
    // Strip all possible active variants first
    b.className = baseClass;
    // Then apply exactly one
    if (id === activeId) b.className = baseClass + ' ' + activeClass;
  });
}

// ── DSL SYNC FROM PROFILE ─────────────────────────────────────────
function syncDslFromProfile() {
  const p = (S.profile || 'fast').toLowerCase();
  if (!S.dsl) S.dsl = {};
  if (p === 'fast') { S.dsl.pivotL = 0.8; S.dsl.pivotR = 1.0; S.dsl.impulseV = 85; S.dsl.openDsl = 40; }
  else if (p === 'swing') { S.dsl.pivotL = 1.2; S.dsl.pivotR = 1.4; S.dsl.impulseV = 70; S.dsl.openDsl = 50; }
  else { S.dsl.pivotL = 1.6; S.dsl.pivotR = 1.8; S.dsl.impulseV = 55; S.dsl.openDsl = 60; }
  BM.profile = p; // keep mirror in sync
  // Update DSL UI inputs + labels if they exist
  const dslInputs = {
    dslPivotL: S.dsl.pivotL, dslPivotR: S.dsl.pivotR,
    dslImpulse: S.dsl.impulseV, dslOpen: S.dsl.openDsl
  };
  Object.entries(dslInputs).forEach(([id, v]) => { const e = el(id); if (e) e.value = v; });
  // Visual hint: DSL params changed badge
  const dslProfileHint = el('zncDslContract');
  if (dslProfileHint && !S.dsl.active) {
    const p2 = (S.profile || 'fast').toLowerCase();
    const pLabel = { fast: 'FAST↑ trail agresiv', swing: 'SWING moderat', defensive: 'DEF↓ trail larg' }[p2] || p2;
    dslProfileHint.innerHTML = `DSL: <b>OFF</b> · Profile: <b>${pLabel}</b> · PL:${S.dsl.pivotL}% PR:${S.dsl.pivotR}%`;
  }
}

// ── TF PROFILE SYNC (MTF badges + engine) ────────────────────────
function syncTFProfile() {
  const p = (S.profile || 'fast').toLowerCase();
  const tfMap = PROFILE_TF[p] || PROFILE_TF.fast;
  // Update trigger TF badge in cockpit
  const trig = el('mtfTrig');
  if (trig) trig.textContent = 'TRIG:' + tfMap.trigger + ' —';
  // Store in S for engine use
  S.triggerTF = tfMap.trigger;
  S.contextTF = tfMap.context;
  S.biasTF = tfMap.bias;
  S.htfTF = tfMap.htf;
  S.cooldownCloses = tfMap.cooldown;
}

// ── SYNC BRAIN FROM STATE (master sync) ──────────────────────────
function syncBrainFromState() {
  // Fallback: if old state had 'manual', convert to 'assist'
  if (S.mode === 'manual') S.mode = 'assist';
  const mode = (S.mode || 'assist').toLowerCase();
  const prof = (S.profile || 'fast').toLowerCase();

  // Mirror to BM (read-only; engine uses S.*)
  BM.mode = mode;
  BM.profile = prof;
  BM.runMode = S.runMode;

  // Radio buttons — exact one active (no more manual)
  _setRadio(['bmode-assist', 'bmode-auto'], 'bmode-' + mode, 'znc-mbtn', 'act-' + mode);
  _setRadio(['prof-fast', 'prof-swing', 'prof-defensive'], 'prof-' + prof, 'znc-pbtn', 'act-' + prof);

  // Run btn (exclusive ON/OFF)
  const runBtn = el('runModeBtn');
  if (runBtn) { runBtn.textContent = S.runMode ? 'ON' : 'OFF'; runBtn.className = 'znc-run' + (S.runMode ? ' on' : ''); }
  // Extra safety: ensure no leftover classes on mode/profile buttons
  document.querySelectorAll('.znc-mbtn').forEach(b => {
    const id = b.id; if (id && id !== 'bmode-manual') b.className = 'znc-mbtn' + (id === 'bmode-' + S.mode ? ' act-' + S.mode : '');
  });
  document.querySelectorAll('.znc-pbtn').forEach(b => {
    const id = b.id; if (id) b.className = 'znc-pbtn' + (id === 'prof-' + S.profile ? ' act-' + S.profile : '');
  });

  // Control source badge (no more manual)
  const src = el('znc-src');
  if (src) { const m = { assist: ['ASSIST', 'assist'], auto: ['AI', 'ai'] }; src.textContent = (m[mode] || m.assist)[0]; src.className = 'znc-src ' + (m[mode] || m.assist)[1]; }

  // DSL zone — always full opacity (no manual mode)
  const dz = el('dslZone');
  if (dz) dz.style.opacity = '1';

  // Sync TF + DSL params
  syncTFProfile();
  syncDslFromProfile();

  // ── DSL UI control — delegated to _syncDslAssistUI ──
  if (typeof _syncDslAssistUI === 'function') _syncDslAssistUI();
  // ── Trigger cockpit render (single render path) ──
  requestAnimationFrame(() => { if (typeof renderBrainCockpit === 'function') renderBrainCockpit(); });
}

// ── PUBLIC MODE / PROFILE SETTERS (only these touch S.*) ─────────
// Pending mode switch state for confirmation modal
let _pendingModeSwitch = null;

function setMode(mode) {
  mode = mode.toLowerCase();
  if (mode === 'manual') mode = 'assist'; // legacy fallback
  if (mode !== 'assist' && mode !== 'auto') mode = 'assist';
  if (mode === S.mode) return; // no change

  // Check if there are open AT positions
  const openAT = [
    ...(TP.demoPositions || []).filter(p => p.autoTrade && !p.closed),
    ...(TP.livePositions || []).filter(p => !p.closed),
  ];
  if (openAT.length > 0) {
    // Show confirmation modal
    // [PATCH MODE-SWITCH] Lock brain during async modal
    window.__brainModeSwitching = true;
    _pendingModeSwitch = mode;
    const modal = el('brainModeModal');
    const msg = el('brainModeModalMsg');
    if (msg) msg.innerHTML =
      `Switching Brain mode from <b style="color:#00ffcc">${S.mode.toUpperCase()}</b> to <b style="color:#f0c040">${mode.toUpperCase()}</b>.<br><br>` +
      `<span style="color:#ffffffaa">${openAT.length} open position${openAT.length > 1 ? 's' : ''} will <b>keep their current control mode</b>.</span><br>` +
      `<span style="color:#ffffffaa">The new mode applies only to <b>future positions</b>.</span>`;
    if (modal) modal.style.display = 'flex';
    return;
  }
  _applyModeSwitch(mode);
}

function _applyModeSwitch(mode) {
  const prev = S.mode;
  S.mode = mode;
  // Auto-arm / auto-disarm ASSIST on mode switch
  if (mode === 'assist') { armAssist(); }
  else { disarmAssist(); }
  if (typeof ZLOG !== 'undefined') ZLOG.push('INFO', '[BRAIN] mode=' + prev + '→' + mode, { prev: prev, next: mode });
  brainThink('info', `🔧 Mode → ${S.mode.toUpperCase()}`);
  syncBrainFromState();
  setTimeout(renderBrainCockpit, 30);
  dslUpdateBanner();
  atUpdateBanner(); ptUpdateBanner();
}

function confirmBrainModeSwitch() {
  const modal = el('brainModeModal');
  if (modal) modal.style.display = 'none';
  if (_pendingModeSwitch) {
    _applyModeSwitch(_pendingModeSwitch);
    _pendingModeSwitch = null;
  }
  // [PATCH MODE-SWITCH] Unlock brain after mode fully applied
  window.__brainModeSwitching = false;
}

function cancelBrainModeSwitch() {
  const modal = el('brainModeModal');
  if (modal) modal.style.display = 'none';
  _pendingModeSwitch = null;
  // [PATCH MODE-SWITCH] Unlock brain on cancel
  window.__brainModeSwitching = false;
  // Re-sync radio buttons to current mode
  syncBrainFromState();
}
// Keep legacy alias for onclick handlers
function setBrainMode(mode) { setMode(mode); }

function setProfile(profile) {
  S.profile = profile.toLowerCase();
  brainThink('info', `📊 Profile → ${S.profile.toUpperCase()} | Trig:${PROFILE_TF[S.profile]?.trigger || '?'}`);
  syncBrainFromState();
  setTimeout(renderBrainCockpit, 30);
  if (typeof _usScheduleSave === 'function') _usScheduleSave(); // persist profile
}

function setRunMode(on) {
  S.runMode = !!on;
  syncBrainFromState();
}
function toggleRunMode() {
  setRunMode(!S.runMode);
  brainThink(S.runMode ? 'ok' : 'info',
    S.runMode ? '🚀 RUN ON — Brain scan/analysis active' : '⏸ RUN OFF — scan paused, AT idle');
}

// ── TIMEZONE FIX ─────────────────────────────────────────────────
function applyTimezone(tz) {
  tz = tz || S.tz || 'Europe/Bucharest';
  S.tz = tz;
  // Re-apply localization to all charts so crosshair + labels use new TZ
  const lf = { timeFormatter: ts => fmtTime(ts), dateFormatter: ts => fmtDate(ts) };
  [mainChart, cvdChart, volChart].forEach(ch => { try { if (ch) ch.applyOptions({ localization: lf }); } catch (_) { } });
  const fmt = {
    timeFormatter: ts => new Date(ts * 1000).toLocaleTimeString('ro-RO', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }),
    dateFormatter: ts => {
      const d = new Date(ts * 1000);
      const months = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const day = d.toLocaleDateString('en-US', { timeZone: tz, day: 'numeric' });
      const month = parseInt(d.toLocaleDateString('en-US', { timeZone: tz, month: 'numeric' })) - 1;
      const year = d.toLocaleDateString('en-US', { timeZone: tz, year: '2-digit' });
      return day + ' ' + months[month] + '. \'' + year;
    }
  };
  [mainChart, cvdChart, volChart].forEach(c => {
    if (c) try { c.applyOptions({ timeScale: { localization: fmt } }); } catch (_) { }
  });
}

// ── REGIME DETECTOR (ENHANCED) ────────────────────────────────────

// Enhanced regime detection
function detectRegimeEnhanced(klines) {
  if (!klines || klines.length < 50) return { regime: 'unknown', adx: 0, vol: '—', structure: '—', squeeze: false };
  const last = klines.slice(-50);
  const closes = last.map(k => k.close);
  const highs = last.map(k => k.high);
  const lows = last.map(k => k.low);
  const vols = last.map(k => k.volume);

  // ATR
  const atrs = last.slice(1).map((k, i) => Math.max(k.high - k.low, Math.abs(k.high - last[i].close), Math.abs(k.low - last[i].close)));
  const avgATR = atrs.reduce((a, b) => a + b, 0) / atrs.length;
  const atrPct = avgATR / closes[closes.length - 1] * 100;

  // EMA
  const calcEMA = (data, p) => { const k = 2 / (p + 1); let e = data[0]; return data.map(v => { e = v * k + e * (1 - k); return e; }); };
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const slope20 = (ema20[ema20.length - 1] - ema20[ema20.length - 10]) / ema20[ema20.length - 10] * 100;

  // ADX approximation
  let plusDM = 0, minusDM = 0, tr = 0;
  for (let i = 1; i < last.length; i++) {
    const upMove = last[i].high - last[i - 1].high;
    const downMove = last[i - 1].low - last[i].low;
    if (upMove > downMove && upMove > 0) plusDM += upMove;
    if (downMove > upMove && downMove > 0) minusDM += downMove;
    tr += Math.max(last[i].high - last[i].low, Math.abs(last[i].high - last[i - 1].close), Math.abs(last[i].low - last[i - 1].close));
  }
  const adx = tr > 0 ? Math.round(Math.abs(plusDM - minusDM) / tr * 100) : 0;

  // Volume trend
  const avgVolRecent = vols.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const avgVolOld = vols.slice(-20, -5).reduce((a, b) => a + b, 0) / 15;
  const volMode = avgVolRecent > avgVolOld * 1.3 ? 'expansion' : avgVolRecent < avgVolOld * 0.7 ? 'contraction' : 'normal';

  // Structure: HH/HL or LH/LL
  const recentHighs = highs.slice(-10);
  const recentLows = lows.slice(-10);
  const hhCount = recentHighs.slice(1).filter((h, i) => h > recentHighs[i]).length;
  const llCount = recentLows.slice(1).filter((l, i) => l < recentLows[i]).length;
  const structure = hhCount >= 6 ? 'HH/HL' : llCount >= 6 ? 'LH/LL' : 'MIXED';

  // Squeeze: Bollinger inside Keltner
  const bb20 = calcEMA(closes, 20);
  const stddev = Math.sqrt(closes.slice(-20).reduce((a, v) => a + (v - bb20[bb20.length - 1]) ** 2, 0) / 20);
  const squeeze = stddev < avgATR * 1.5;

  // Regime
  let regime = 'unknown';
  if (atrPct > 2.5) regime = 'panic';
  else if (atrPct > 1.5 && volMode === 'expansion' && adx > 30) regime = 'breakout';
  else if (adx > 25 && Math.abs(slope20) > 0.3) regime = 'trend';
  else if (squeeze) regime = 'squeeze';
  else regime = 'range';

  return { regime, adx, volMode, structure, squeeze, atrPct, slope20 };
}

// ── MTF ALIGNMENT ─────────────────────────────────────────────────
function updateMTFAlignment() {
  const tfs = ['15m', '1h', '4h'];
  tfs.forEach(tf => {
    const rsi = S.rsi?.[tf] || 50;
    const dir = rsi > 55 ? 'bull' : rsi < 45 ? 'bear' : 'neut';
    BM.mtf[tf] = dir;
    const badge = el('mtf' + tf);
    if (badge) {
      badge.textContent = tf + ' ' + (dir === 'bull' ? '▲' : dir === 'bear' ? '▼' : '—');
      badge.className = 'mtf-badge ' + dir;
    }
  });
}

// ── SWEEP / DISPLACEMENT DETECTOR ─────────────────────────────────
function detectSweepDisplacement(klines) {
  if (!klines || klines.length < 20) return { type: 'none', reclaim: false, displacement: false };
  const last = klines.slice(-20);
  const cur = last[last.length - 1];
  const prev20High = Math.max(...last.slice(0, -1).map(k => k.high));
  const prev20Low = Math.min(...last.slice(0, -1).map(k => k.low));
  const atr = last.slice(-5).reduce((a, k) => a + (k.high - k.low), 0) / 5;

  let sweep = { type: 'none', reclaim: false, displacement: false, liqDist: 0 };

  // Sweep above: wick above prev high then came back
  if (cur.high > prev20High && cur.close < prev20High) {
    sweep.type = 'above';
    sweep.reclaim = cur.close < prev20High;
    sweep.displacement = (prev20High - cur.close) > atr * 0.5;
    sweep.liqDist = ((cur.high - cur.close) / cur.close * 100).toFixed(2);
  }
  // Sweep below: wick below prev low then came back
  else if (cur.low < prev20Low && cur.close > prev20Low) {
    sweep.type = 'below';
    sweep.reclaim = cur.close > prev20Low;
    sweep.displacement = (cur.close - prev20Low) > atr * 0.5;
    sweep.liqDist = ((cur.close - cur.low) / cur.close * 100).toFixed(2);
  }

  BM.sweep = sweep;
  return sweep;
}

// ── FLOW ENGINE ───────────────────────────────────────────────────
function updateFlowEngine(klines) {
  if (!klines || klines.length < 10) return;
  const last = klines.slice(-10);

  // CVD: cumulative delta approximation
  let cvd = 0;
  last.forEach(k => {
    const buyVol = k.close > k.open ? k.volume * 0.6 : k.volume * 0.4;
    const sellVol = k.volume - buyVol;
    cvd += buyVol - sellVol;
  });
  const cvdDir = cvd > 0 ? 'rising' : 'falling';
  const deltaLast = last[last.length - 1];
  const delta = deltaLast.close > deltaLast.open
    ? (deltaLast.volume * 0.2).toFixed(0)
    : (-deltaLast.volume * 0.2).toFixed(0);

  const ofi = BRAIN.ofi?.blendBuy || 50;
  const ofiDir = ofi > 57 ? 'buy' : ofi < 43 ? 'sell' : 'neut';

  BM.flow = { cvd: cvdDir, delta: parseFloat(delta), ofi: ofiDir };

  // Update UI
  const cvdEl = el('flowCVD'); if (cvdEl) { cvdEl.textContent = cvdDir.toUpperCase(); cvdEl.className = 'flow-cell-val ' + (cvdDir === 'rising' ? 'ok' : 'fail'); }
  const deltaEl = el('flowDelta'); if (deltaEl) { deltaEl.textContent = (parseFloat(delta) >= 0 ? '+' : '') + delta; deltaEl.className = 'flow-cell-val ' + (parseFloat(delta) >= 0 ? 'ok' : 'fail'); }
  const ofiEl = el('flowOFI'); if (ofiEl) { ofiEl.textContent = ofiDir.toUpperCase(); ofiEl.className = 'flow-cell-val ' + (ofiDir === 'buy' ? 'ok' : ofiDir === 'sell' ? 'fail' : 'neut'); }

  // Sweep UI
  const sw = BM.sweep;
  const swEl = el('flowSweep'); if (swEl) { swEl.textContent = sw.type === 'none' ? 'NONE' : sw.type.toUpperCase(); swEl.className = 'flow-cell-val ' + (sw.type !== 'none' ? 'ok' : 'neut'); }
  const rclEl = el('flowReclaim'); if (rclEl) { rclEl.textContent = sw.reclaim ? 'OK' : '—'; rclEl.className = 'flow-cell-val ' + (sw.reclaim ? 'ok' : 'neut'); }
  const dispEl = el('flowDisplacement'); if (dispEl) { dispEl.textContent = sw.displacement ? 'OK' : '—'; dispEl.className = 'flow-cell-val ' + (sw.displacement ? 'ok' : 'neut'); }
}

// ── ENTRY GATES ENGINE ────────────────────────────────────────────

// Gates computation
function computeGates(dir) {
  const regime = BRAIN.regime || 'unknown';
  const ofi = BRAIN.ofi?.blendBuy || 50;
  const rsi5m = S.rsi?.['5m'] || 50;
  const rsi1h = S.rsi?.['1h'] || 50;
  const rsi4h = S.rsi?.['4h'] || 50;
  const adx = BRAIN.liveADX || 0;
  const fr = S.fr || 0;
  const oi = S.oi || 0;
  const oiPrev = S.oiPrev || oi;
  const vol = S.vol24h || 0;
  const isLong = dir === 'long';
  const sw = BM.sweep;
  const profile = BM.profile;
  const regDat = detectRegimeEnhanced(S.klines || []);

  // Current session
  const h = new Date().getUTCHours();
  const sessionOk = (h >= 7 && h < 11) || (h >= 13 && h < 17) || (h >= 19 && h < 23); // London/NY/Asia overlap

  // Cooldown
  const lastTradeTs = AT.lastTradeTs || 0;
  const cooldownMs = profile === 'fast' ? 5 * 60 * 1000 : profile === 'swing' ? 30 * 60 * 1000 : 60 * 60 * 1000;
  const cooldownOff = (Date.now() - lastTradeTs) > cooldownMs;

  // Volume
  const klines = S.klines || [];
  let volConfirm = false;
  if (klines.length >= 20) {
    const recent = klines.slice(-5).reduce((a, k) => a + k.volume, 0) / 5;
    const baseline = klines.slice(-20, -5).reduce((a, k) => a + k.volume, 0) / 15;
    volConfirm = recent > baseline * 1.1;
  }

  // OI
  const oiChange = oiPrev > 0 ? Math.abs(oi - oiPrev) / oiPrev * 100 : 0;
  const oiConfirm = oiChange > 0.05;

  // Risk limits
  const maxDay = parseInt(el('rrMaxDay')?.value) || 5;
  const maxConc = parseInt(el('rrMaxConcurrent')?.value) || 3;
  const dailyDD = parseFloat(el('rrDailyDD')?.value) || 5;
  const lossLim = parseInt(el('rrLossStreak')?.value) || 3;
  const concurrent = (TP.demoPositions || []).filter(p => p.autoTrade && !p.closed).length;
  const riskOk = !BM.protectMode &&
    BM.dailyTrades < maxDay &&
    concurrent < maxConc &&
    BM.lossStreak < lossLim &&
    BM.dailyPnL > -(dailyDD / 100 * (TP.demoBalance || 1000));

  const gates = {
    regime: regime === 'trend' || regime === 'breakout' ? 'ok' : regime === 'range' ? 'wait' : 'fail',
    mtf: (BM.mtf['1h'] === dir && BM.mtf['4h'] !== (isLong ? 'bear' : 'bull')) ? 'ok' : BM.mtf['1h'] === 'neut' ? 'wait' : 'fail',
    volume: volConfirm ? 'ok' : 'wait',
    oi: oiConfirm ? 'ok' : 'wait',
    orderflow: isLong ? (ofi > 57 ? 'ok' : ofi < 43 ? 'fail' : 'wait') : (ofi < 43 ? 'ok' : ofi > 57 ? 'fail' : 'wait'),
    sweep: sw.type !== 'none' && (isLong ? sw.type === 'below' : sw.type === 'above') ? 'ok' : sw.type !== 'none' ? 'fail' : 'wait',
    displacement: sw.displacement ? 'ok' : 'wait',
    session: sessionOk ? 'ok' : 'wait',
    spread: 'ok', // assume ok without real data
    cooldown: cooldownOff ? 'ok' : 'fail',
    risk: riskOk ? 'ok' : 'fail',
    news: BM.newsRisk === 'low' ? 'ok' : BM.newsRisk === 'med' ? 'wait' : 'fail'
  };

  BM.gates = gates;
  return gates;
}

function renderGates(gates) {
  const grid = el('gatesGrid'); if (!grid) return;
  const okCount = Object.values(gates).filter(v => v === 'ok').length;
  const okEl = el('gatesOkCount'); if (okEl) okEl.textContent = okCount + '/' + GATE_DEFS.length + ' OK';

  // Animate synapse dots on brain SVG for gate status
  const dotIds = ['bdot0', 'bdot1', 'bdot2', 'bdot3', 'bdot4', 'bdot5', 'bdot6', 'bdot7'];
  const lineIds = ['bline0', 'bline1', 'bline2', 'bline3', 'bline4', 'bline5'];
  const gateVals = Object.values(gates);
  dotIds.forEach((id, i) => {
    const dot = el(id); if (!dot) return;
    const st = gateVals[i] || 'wait';
    const c = st === 'ok' ? '#39ff14' : st === 'fail' ? '#ff3355' : '#f0c040';
    dot.setAttribute('fill', c + '33');
    dot.setAttribute('stroke', c);
  });
  lineIds.forEach((id, i) => {
    const line = el(id); if (!line) return;
    const st = gateVals[i] || 'wait';
    const c = st === 'ok' ? '#39ff14' : st === 'fail' ? '#ff3355' : '#f0c040';
    line.setAttribute('stroke', c);
    line.setAttribute('opacity', st === 'ok' ? '0.8' : '0.3');
  });

  grid.innerHTML = GATE_DEFS.map(g => {
    const st = gates[g.id] || 'wait';
    return `<div class="gate-row">
      <div class="gate-led ${st}"></div>
      <span class="gate-lbl ${st}">${g.label}${g.required ? '' : ' ◦'}</span>
    </div>`;
  }).join('');
}

// ── ENTRY SCORE ENGINE ────────────────────────────────────────────
function computeEntryScore(gates, dir) {
  const profile = BM.profile;
  const readyThreshold = profile === 'fast' ? 65 : profile === 'defensive' ? 80 : 75;

  // Base score from gates
  let score = 0;
  const reasons = [];
  const weights = {
    regime: 15, mtf: 15, volume: 10, oi: 8,
    orderflow: 12, sweep: 10, displacement: 8,
    session: 8, spread: 4, cooldown: 5, risk: 10, news: 5
  };

  GATE_DEFS.forEach(g => {
    const st = gates[g.id];
    const w = weights[g.id] || 5;
    if (st === 'ok') { score += w; reasons.push({ pos: true, txt: '+ ' + g.label }); }
    else if (st === 'fail') { score -= w * 0.5; reasons.push({ pos: false, txt: '- ' + g.label }); }
  });

  // Bonuses
  if (BM.sweep.reclaim && BM.sweep.displacement) { score += 10; reasons.push({ pos: true, txt: '+ Sweep+Reclaim+Disp' }); }
  // RUN is now a scan gate (not a score bonus) — removed legacy +8 bonus
  const rsi5m = S.rsi?.['5m'] || 50;
  if (dir === 'long' && rsi5m > 55 && rsi5m < 70) { score += 5; reasons.push({ pos: true, txt: '+ RSI bullish zone' }); }
  if (dir === 'short' && rsi5m < 45 && rsi5m > 30) { score += 5; reasons.push({ pos: true, txt: '+ RSI bearish zone' }); }

  score = Math.round(Math.max(0, Math.min(100, score)));

  const label = score >= readyThreshold ? 'READY' : score >= 60 ? 'WAIT' : 'BLOCK';
  const col = score >= readyThreshold ? '#39ff14' : score >= 60 ? '#f0c040' : '#ff3355';

  BM.entryScore = score;
  BM.entryReady = score >= readyThreshold;

  // Update UI
  const numEl = el('entryScoreNum');
  const fillEl = el('entryScoreFill');
  const lblEl = el('entryScoreLabel');
  const reasonsEl = el('entryScoreReasons');
  if (numEl) { numEl.textContent = score; numEl.style.color = col; }
  if (fillEl) { fillEl.style.width = score + '%'; fillEl.style.background = col; }
  if (lblEl) { lblEl.textContent = label; lblEl.style.color = col; }
  if (reasonsEl) {
    const top3 = reasons.slice(0, 4);
    reasonsEl.innerHTML = top3.map(r => `<div class="score-reason ${r.pos ? 'pos' : 'neg'}">${r.txt}</div>`).join('');
  }

  return { score, label, col, readyThreshold };
}

// ── MARKET ATMOSPHERE AGGREGATOR ──────────────────────────────────
// Reads ONLY existing state. Produces BM.atmosphere for pre-filter.
// Priority: trap_risk > toxic_volatility > range > clean_trend > neutral
function computeMarketAtmosphere() {
  try {
    const re = BM.regimeEngine || {};
    const pf = BM.phaseFilter || {};
    const sw = BM.sweep || {};
    const fakeBlocked = (typeof _fakeout !== 'undefined') ? !!_fakeout.invalid : false;
    const ofTrap = (typeof OF !== 'undefined' && OF.trap) ? !!OF.trap.active : false;
    const ofCascade = (typeof OF !== 'undefined' && OF.cascade) ? (OF.cascade.state === 'fired') : false;
    const trapRisk = re.trapRisk || 0;
    const volState = re.volatilityState || 'normal';
    const wickChaos = re._wickChaos || 0; // may not be exposed; fallback 0
    const regime = (re.regime || 'RANGE').toUpperCase();
    const phase = (pf.phase || 'RANGE').toUpperCase();
    const reConf = re.confidence || 0;
    const brainRegime = (typeof BRAIN !== 'undefined' && BRAIN.regime) ? BRAIN.regime : 'unknown';
    const atrPct = (typeof BRAIN !== 'undefined') ? (BRAIN.regimeAtrPct || 0) : 0;
    const volRegime = (typeof BM !== 'undefined') ? (BM.volRegime || 'MED') : 'MED';
    const sweepNoDisp = sw.type !== 'none' && !sw.displacement;

    const reasons = [];
    let category = 'neutral';
    let allowEntry = true;
    let cautionLevel = 'low';
    let confidence = 50;
    let sizeMult = pf.sizeMultiplier || 1.0;

    // ── 1. TRAP RISK (highest priority) ─────────────
    if (ofTrap || ofCascade || trapRisk >= 60 || (fakeBlocked && sweepNoDisp)) {
      category = 'trap_risk';
      allowEntry = false;
      cautionLevel = 'high';
      confidence = Math.min(95, 50 + trapRisk);
      sizeMult = 0;
      if (ofTrap) reasons.push('OF trap active');
      if (ofCascade) reasons.push('OF cascade fired');
      if (trapRisk >= 60) reasons.push('trapRisk ' + trapRisk + '%');
      if (fakeBlocked) reasons.push('fakeout blocked');
      if (sweepNoDisp) reasons.push('sweep without displacement');
    }
    // ── 2. TOXIC VOLATILITY ──────────────────────────
    else if (volState === 'extreme' || regime === 'CHAOS' || regime === 'LIQUIDATION_EVENT' || atrPct > 2.5 || volRegime === 'EXTREME') {
      category = 'toxic_volatility';
      allowEntry = false;
      cautionLevel = 'high';
      confidence = Math.min(95, 40 + Math.round(atrPct * 20));
      sizeMult = 0;
      if (volState === 'extreme') reasons.push('volatility extreme');
      if (regime === 'CHAOS') reasons.push('regime CHAOS');
      if (regime === 'LIQUIDATION_EVENT') reasons.push('liquidation event');
      if (atrPct > 2.5) reasons.push('ATR ' + atrPct.toFixed(2) + '% > 2.5');
      if (volRegime === 'EXTREME') reasons.push('volRegime EXTREME');
    }
    // ── 3. RANGE ─────────────────────────────────────
    else if (phase === 'RANGE' || phase === 'SQUEEZE' || brainRegime === 'range' || brainRegime === 'squeeze') {
      category = 'range';
      allowEntry = true; // allowed but conservative
      cautionLevel = 'medium';
      confidence = Math.max(20, reConf);
      sizeMult = Math.min(sizeMult, 0.7);
      if (phase === 'RANGE') reasons.push('phase RANGE');
      if (phase === 'SQUEEZE') reasons.push('phase SQUEEZE');
      if (brainRegime === 'range') reasons.push('regime range');
      if (brainRegime === 'squeeze') reasons.push('regime squeeze');
    }
    // ── 4. CLEAN TREND ───────────────────────────────
    else if (phase === 'TREND' || phase === 'EXPANSION' || brainRegime === 'trend' || brainRegime === 'breakout') {
      category = 'clean_trend';
      allowEntry = true;
      cautionLevel = 'low';
      confidence = Math.max(60, reConf);
      sizeMult = Math.max(sizeMult, 1.0);
      if (phase === 'TREND') reasons.push('phase TREND');
      if (phase === 'EXPANSION') reasons.push('phase EXPANSION');
      if (brainRegime === 'trend') reasons.push('regime trend');
      if (brainRegime === 'breakout') reasons.push('regime breakout');
    }
    // ── 5. NEUTRAL (fallback) ────────────────────────
    else {
      category = 'neutral';
      allowEntry = true;
      cautionLevel = 'medium';
      confidence = Math.max(30, reConf);
      sizeMult = Math.min(sizeMult, 0.8);
      reasons.push('no clear regime classification');
    }

    // Additional caution bumps (cross-checks)
    if (category !== 'trap_risk' && category !== 'toxic_volatility') {
      if (trapRisk >= 30) { cautionLevel = 'high'; reasons.push('elevated trapRisk ' + trapRisk + '%'); }
      if (volRegime === 'HIGH') { if (cautionLevel === 'low') cautionLevel = 'medium'; reasons.push('volRegime HIGH'); }
      if (fakeBlocked) { reasons.push('fakeout flagged'); }
    }

    if (reasons.length === 0) reasons.push('data insufficient');

    BM.atmosphere = {
      category: category,
      allowEntry: allowEntry,
      cautionLevel: cautionLevel,
      confidence: Math.round(Math.min(100, Math.max(0, confidence))),
      reasons: reasons,
      sizeMultiplier: Math.round(Math.max(0, Math.min(1.5, sizeMult)) * 100) / 100
    };
  } catch (e) {
    console.warn('[Atmosphere] error:', e.message);
    BM.atmosphere = { category: 'neutral', allowEntry: true, cautionLevel: 'medium', confidence: 0, reasons: ['error: ' + (e.message || 'unknown')], sizeMultiplier: 1.0 };
  }
}

// ── CHAOS / RISK BAR ─────────────────────────────────────────────

// Chaos bar, news shield, protect mode
function updateChaosBar() {
  const atrPct = BRAIN.regimeAtrPct || 0;
  const newsW = BM.newsRisk === 'high' ? 40 : BM.newsRisk === 'med' ? 20 : 0;
  const spreadW = 0; // no real spread data
  const chaos = Math.min(100, Math.round(atrPct * 15 + newsW + spreadW));

  const fill = el('chaosBarFill');
  const val = el('chaosVal');
  const col = chaos < 33 ? '#39ff14' : chaos < 66 ? '#f0c040' : '#ff3355';
  if (fill) { fill.style.width = chaos + '%'; fill.style.background = col; }
  if (val) { val.textContent = chaos + '%'; val.style.color = col; }
}

// ── NEWS SHIELD ───────────────────────────────────────────────────
// [MOVED TO TOP] NEWS

function updateNewsShield() {
  // Simulated news risk based on time + volatility + macro calendar
  const atrPct = BRAIN.regimeAtrPct || 0;
  const now = Date.now();

  // Check macro events countdown
  let macroMsg = '';
  BM.macroEvents.forEach(ev => {
    const diff = ev.time - now;
    if (diff > 0 && diff < 30 * 60 * 1000) {
      macroMsg = `⚠ ${ev.name} in ${Math.ceil(diff / 60000)}m`;
      BM.newsRisk = 'high';
    }
  });

  // Simulated: high volatility → raise news risk
  if (atrPct > 2.0) BM.newsRisk = 'high';
  else if (atrPct > 1.2) BM.newsRisk = 'med';
  else BM.newsRisk = BM.newsRisk === 'high' ? 'med' : 'low'; // slow decay

  const badge = el('newsRiskBadge');
  const headline = el('newsHeadline');
  const macroCd = el('macroCd');

  if (badge) { badge.textContent = BM.newsRisk.toUpperCase(); badge.className = 'news-risk-badge ' + BM.newsRisk; }
  if (headline) headline.textContent = macroMsg || (BM.newsRisk === 'high' ? '⚡ High volatility detected — caution' : 'No significant news detected');
  if (macroCd) macroCd.textContent = macroMsg;
}

// ── PROTECT MODE ─────────────────────────────────────────────────
// PROTECT = only: execution risk, news HIGH, REAL risk limit breach
// NOT: session off, regime unstable (those are BLOCK/WAIT only)
function checkProtectMode() {
  const dailyDD = parseFloat(el('rrDailyDD')?.value) || 5;
  const lossLim = parseInt(el('rrLossStreak')?.value) || 3;
  const maxDay = parseInt(el('rrMaxDay')?.value) || 5;
  const _realPnL = +(AT.realizedDailyPnL) || 0;
  const _closedToday = +(AT.closedTradesToday) || 0;
  const bal = +(AT.mode === 'demo' ? TP.demoBalance : 10000) || 10000;

  let reason = null;
  // Loss streak — only if we actually have closed trades
  if (_closedToday > 0 && BM.lossStreak >= lossLim)
    reason = `⛔ PROTECT: ${lossLim} CONSECUTIVE LOSSES (${_closedToday} trades)`;
  // Max daily trades
  if (BM.dailyTrades >= maxDay)
    reason = `⛔ PROTECT: MAX TRADES/DAY (${BM.dailyTrades}/${maxDay})`;
  // Daily DD — only if realized, not unrealized equity swing
  if (_closedToday > 0 && Number.isFinite(_realPnL) && _realPnL < -(dailyDD / 100 * bal))
    reason = `⛔ PROTECT: DAILY DD ${_realPnL.toFixed(2)}$ >= ${dailyDD}%`;
  // News HIGH — block not protect (keep compatible but only in auto)
  if (BM.newsRisk === 'high' && (S.mode || 'assist') === 'auto')
    reason = `⛔ PROTECT: NEWS HIGH — volatilitate extremă`;
  // Kill switch — only if already triggered legitimately
  if (AT.killTriggered) reason = '⛔ BLOCKED: KILL SWITCH';

  if (reason && !BM.protectMode) {
    BM.protectMode = true;
    BM.protectReason = reason;
    if (typeof ZLOG !== 'undefined') ZLOG.push('WARN', '[BRAIN PROTECT] ON ' + reason);
    if (AT.enabled && (S.mode || 'assist') === 'auto') { AT.enabled = false; }
    brainThink('bad', reason);
    toast(reason);
  }

  const banner = el('protectBanner');
  const bannerTxt = el('protectBannerTxt');
  if (banner) banner.className = 'protect-banner' + (BM.protectMode ? ' show' : '');
  if (bannerTxt && BM.protectMode) bannerTxt.textContent = BM.protectReason;
}

function resetProtectMode() {
  BM.protectMode = false;
  BM.protectReason = '';
  if (typeof ZLOG !== 'undefined') ZLOG.push('INFO', '[BRAIN PROTECT] OFF');
  BM.lossStreak = 0;
  const banner = el('protectBanner');
  if (banner) banner.className = 'protect-banner';
  brainThink('ok', '✅ Protect mode resetat manual');
  toast('✅ Protect mode resetat');
}

// ── DSL TELEMETRY UPDATE ──────────────────────────────────────────

// DSL telemetry
function updateDSLTelemetry() {
  const tele = el('dslTelemetry'); if (!tele) return;
  const posns = (TP.demoPositions || []).filter(p => p.autoTrade && !p.closed);

  if (!posns.length || !DSL.enabled) {
    tele.innerHTML = `<div class="dsl-tele-title">DSL TELEMETRY — BRAIN READ</div><div style="font-size:11px;color:#00ffcc22">No active DSL positions</div>`;
    return;
  }

  const pivotLeftPct = parseFloat(el('dslTrailPct')?.value) || 0.8;
  const pivotRightPct = parseFloat(el('dslTrailSusPct')?.value) || 1.0;
  const impulseValPct = parseFloat(el('dslExtendPct')?.value) || 20;

  let html = `<div class="dsl-tele-title">DSL TELEMETRY — BRAIN READ</div>`;
  posns.forEach(pos => {
    const dsl = DSL.positions[String(pos.id)];
    const cur = pos.sym === S.symbol ? S.price : (allPrices[pos.sym] || wlPrices[pos.sym]?.price || pos.entry); // [FIX v85 B7]
    const sym = pos.sym.replace('USDT', '');
    const isActive = dsl?.active || false;
    const pnl = _safePnl(pos.side, cur, pos.entry, pos.size, pos.lev, false);
    const plPrice = dsl?.pivotLeft || 0;
    const plPnl = plPrice ? ((pos.side === 'LONG' ? plPrice - pos.entry : pos.entry - plPrice) / pos.entry * pos.size * pos.lev) : 0;
    const steps = dsl?.log?.filter(l => l.msg.includes('IMPULSE')).length || 0;
    const nextStepDist = dsl?.impulseVal && dsl?.pivotRight
      ? Math.abs(dsl.impulseVal - dsl.pivotRight) / dsl.pivotRight * 100
      : 0;

    html += `<div style="margin-bottom:4px;padding:4px 5px;background:#030a0d;border:1px solid #00ffcc11;border-radius:2px">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px">
        <span style="color:${isActive ? '#00ffcc' : '#3a5068'}">${pos.side} ${sym} ${isActive ? '● DSL ON' : '○ WAIT'}</span>
        <span style="color:${pnl >= 0 ? '#39ff14' : '#ff3355'}">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}</span>
      </div>
      <div class="dsl-tele-grid">
        <div class="dsl-tele-cell"><div class="dsl-tele-lbl">DSL STATE</div><div class="dsl-tele-val">${isActive ? 'ACTIVE' : 'WAIT'}</div></div>
        <div class="dsl-tele-cell"><div class="dsl-tele-lbl">PIVOT LEFT</div><div class="dsl-tele-val" style="color:#ff69b4">${pivotLeftPct}% / $${fP(plPrice)}</div></div>
        <div class="dsl-tele-cell"><div class="dsl-tele-lbl">PIVOT RIGHT</div><div class="dsl-tele-val" style="color:#39ff14">${pivotRightPct}%</div></div>
        <div class="dsl-tele-cell"><div class="dsl-tele-lbl">IMPULSE V</div><div class="dsl-tele-val" style="color:#aa44ff">${impulseValPct}%</div></div>
        <div class="dsl-tele-cell"><div class="dsl-tele-lbl">STEPS DONE</div><div class="dsl-tele-val">${steps}</div></div>
        <div class="dsl-tele-cell"><div class="dsl-tele-lbl">PL PNL IF HIT</div><div class="dsl-tele-val" style="color:${plPnl >= 0 ? '#ff69b4' : '#ff3355'}">${plPnl >= 0 ? '+' : ''}$${plPnl.toFixed(2)}</div></div>
        ${isActive ? `<div class="dsl-tele-cell"><div class="dsl-tele-lbl">NEXT IV DIST</div><div class="dsl-tele-val">${nextStepDist.toFixed(2)}%</div></div>` : ''}
      </div>
    </div>`;
  });
  tele.innerHTML = html;
}

// ── EXECUTION CINEMATIC ───────────────────────────────────────────
function showExecCinematic(side, sym) {
  const banner = document.createElement('div');
  banner.className = 'exec-banner' + (side === 'SHORT' ? ' short' : '');
  banner.textContent = `⚡ ZEUS EXECUTION: ${side} ${sym}`;
  document.body.appendChild(banner);
  setTimeout(() => { try { document.body.removeChild(banner); } catch (_) { } }, 3000);
}

// ── GRAND UPDATE MAIN LOOP ────────────────────────────────────────

// Exec cinematic placeholder
// ─── REGIME STABILIZATION (anti-flip: valid only after 3 closes same) ─────
// [MOVED TO TOP] _regimeHistory
function getStableRegime(current) {
  // Only add if different from last (candle-close trigger)
  if (!_regimeHistory.length || _regimeHistory[_regimeHistory.length - 1] !== current) {
    _regimeHistory.push(current);
  }
  if (_regimeHistory.length > 5) _regimeHistory.shift();
  // Locked = same regime for last 3 consecutive entries
  if (_regimeHistory.length < 3) return null;
  const last3 = _regimeHistory.slice(-3);
  const allSame = last3.every(r => r === last3[0]);
  return allSame ? last3[0] : null;
}

// ─── ANTI-FAKEOUT STATE ───────────────────────────────────────────
// [MOVED TO TOP] _fakeout
function checkAntiFakeout(klines, dir) {
  if (!klines || klines.length < 4) return false;
  const isLong = dir === 'long';
  // [FIX v85 BUG7] Extins de la 2 la ultimele 3 lumânări, confirmare = minim 2 din 3
  // Previne false invalidare pe o singură lumânare contrară
  const c1 = klines[klines.length - 1];
  const c2 = klines[klines.length - 2];
  const c3 = klines[klines.length - 3];
  const bullish = b => b.close > b.open;
  const bearish = b => b.close < b.open;
  let confirmCount = 0;
  if (isLong) {
    if (bullish(c1)) confirmCount++;
    if (bullish(c2)) confirmCount++;
    if (bullish(c3)) confirmCount++;
  } else {
    if (bearish(c1)) confirmCount++;
    if (bearish(c2)) confirmCount++;
    if (bearish(c3)) confirmCount++;
  }
  const followThrough = confirmCount >= 2; // cel puțin 2 din 3 confirmă direcția
  if (!followThrough) {
    _fakeout.invalid = true;
    return false;
  }
  _fakeout.invalid = false;
  return true;
}

// ─── HARD SAFETY GATES (AUTO) ────────────────────────────────────

// Safety gates
function computeSafetyGates(dir) {
  const maxDay = parseInt(el('rrMaxDay')?.value) || 5;
  const maxConc = parseInt(el('rrMaxConcurrent')?.value) || 3;
  const dailyDD = parseFloat(el('rrDailyDD')?.value) || 5;
  const lossLim = parseInt(el('rrLossStreak')?.value) || 3;
  const concurrent = (TP.demoPositions || []).filter(p => p.autoTrade && !p.closed).length;
  const hasOpposite = (TP.demoPositions || []).some(p => p.autoTrade && !p.closed && p.side !== (dir === 'long' ? 'LONG' : 'SHORT'));
  const riskOk = !BM.protectMode && BM.dailyTrades < maxDay && concurrent < maxConc && BM.lossStreak < lossLim && BM.dailyPnL > -(dailyDD / 100 * (TP.demoBalance || 1000));
  const h = new Date().getUTCHours();
  // C: Session gate only applies when session filter checkbox is ON
  const sessionFilterEnabled = el('dhfEnabled')?.checked !== false;  // default ON
  const sessionHourOk = (h >= 7 && h < 11) || (h >= 13 && h < 17) || (h >= 19 && h < 23);
  const sessionOk = !sessionFilterEnabled || sessionHourOk;  // pass if filter OFF
  const klines = S.klines || [];
  const regDat = detectRegimeEnhanced(klines);
  const stableRegime = getStableRegime(regDat.regime);
  // C: Regime — only hard-block on truly unstable; extreme panic = reduce size not full block
  const regimeOk = stableRegime !== null &&
    (stableRegime === 'trend' || stableRegime === 'breakout' || stableRegime === 'range' ||
      stableRegime === 'squeeze');  // squeeze is risky but not an outright block

  return {
    risk: riskOk,
    spread: true, // no real spread data
    cooldown: (Date.now() - (AT.lastTradeTs || 0)) > _getCooldownMs(),
    news: BM.newsRisk !== 'high',
    session: sessionOk,
    noOpposite: !hasOpposite,
    regime: regimeOk
  };
}

function _getCooldownMs() {
  const prof = (S.profile || 'fast').toLowerCase();
  const closes = S.cooldownCloses || PROFILE_TF[prof]?.cooldown || 2;
  // Use trigger TF candle size for cooldown period
  const trigTf = S.triggerTF || PROFILE_TF[prof]?.trigger || '5m';
  const tfMs = { '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000, '1D': 86400000 };
  const candleMs = tfMs[trigTf] || 300000;
  const base = closes * candleMs;
  return BM.lossStreak > 0 ? base * 2 : base;
}

function allSafetyPass(safety) {
  return Object.values(safety).every(v => v === true);
}

// ─── CONTEXT GATES ────────────────────────────────────────────────
function computeContextGates(dir, klines) {
  const ofi = BRAIN.ofi?.blendBuy || 50;
  const isLong = dir === 'long';
  const mtfCount = ['15m', '1h', '4h'].filter(tf => BM.mtf[tf] === (isLong ? 'bull' : 'bear')).length;
  const flowOk = isLong ? (ofi > 57 && BM.flow.cvd === 'rising') : (ofi < 43 && BM.flow.cvd === 'falling');
  const sw = BM.sweep;
  const triggerOk = sw.type !== 'none' && (isLong ? sw.type === 'below' : sw.type === 'above') && sw.reclaim;
  const antiFakeout = checkAntiFakeout(klines, dir);
  return {
    mtf: mtfCount >= 2,
    flow: flowOk,
    trigger: triggerOk,
    antifake: antiFakeout
  };
}

// ─── COCKPIT RENDER ───────────────────────────────────────────────
// ── SESSION BAR — updates both bottom bar + orb overlay ──────────
// ── SESSION BOUNDARIES (real market sessions, UTC) ──────────────
// ASIA:   00:00–08:00 UTC
// LONDON: 08:00–16:00 UTC  (extended to include pre-close)
// NY:     13:00–21:00 UTC
// Overlap: LONDON + NY  13:00–16:00 UTC  → PRIMARY = NY (higher vol)
// [MOVED TO TOP] _SESS_DEF
// Priority order for overlap (higher index = higher priority = PRIMARY)
// [MOVED TO TOP] _SESS_PRIORITY


// Session management
function _getActiveSessions(hUTC) {
  const active = [];
  Object.entries(_SESS_DEF).forEach(([key, def]) => {
    if (hUTC >= def.start && hUTC < def.end) active.push(key);
  });
  // Determine primary (highest priority in active list)
  let primary = null;
  _SESS_PRIORITY.forEach(s => { if (active.includes(s)) primary = s; });
  return { active, primary };
}

function updateSessionPills() {
  const hUTC = new Date().getUTCHours();
  const { active, primary } = _getActiveSessions(hUTC);

  ['asia', 'london', 'ny'].forEach(s => {
    const isActive = active.includes(s);
    const isPrimary = (s === primary);

    // Orb pills (primary display)
    const pill = el('osess-' + s);
    if (pill) {
      // Build class string cleanly
      let cls = 'orb-sess';
      if (isActive) cls += ' active ' + s;
      if (isPrimary) cls += ' primary';
      pill.className = cls;
    }

    // Bottom bar compat stubs
    const b1 = el('zsess-' + s);
    if (b1) {
      b1.className = isActive ? 'active ' + s : '';
    }
  });
}

// Alias for backward compatibility
function renderSessionBar() { updateSessionPills(); }

// ── SINGLE INTERVAL GUARD ────────────────────────────────────────
if (!window._sessIntervalId) {
  updateSessionPills(); // immediate first run
  window._sessIntervalId = Intervals.set('sessionPills', updateSessionPills, 60000);
}

// ── NEURON SCAN — live coin LED pulse ──────────────────────────────
// [MOVED TO TOP] _NEURO_SYMS
// [MOVED TO TOP] _neuroLastScan
function initNeuroCoinLEDs() {
  // Primary: inside orb; secondary: legacy stub (hidden)
  const wrap = el('orbNeuroCoin') || el('zncNeuroCoin');
  if (!wrap) return;
  // Tiny dots only in orb (no label text to save space)
  wrap.innerHTML = _NEURO_SYMS.map(sym => `<div class="znc-nc" id="zncnc-${sym}" title="${sym}"><div class="znc-nc-dot" id="zncndot-${sym}"></div></div>`).join('');
}

function pulseNeuronCoin(sym) {
  // sym can be 'BTCUSDT' or 'BTC'
  const base = sym.replace('USDT', '').replace('usdt', '').toUpperCase();
  const el2 = el('zncnc-' + base);
  if (!el2) return;
  el2.classList.add('pulse');
  setTimeout(() => el2.classList.remove('pulse'), 400);
}

// Hook into wlPrices update — call pulseNeuronCoin when symbol gets update
// Called from the wlWS onmessage handler
function onNeuronScanUpdate(sym) {
  const now = Date.now();
  if ((now - (_neuroLastScan[sym] || 0)) > 1500) { // throttle per coin
    _neuroLastScan[sym] = now;
    pulseNeuronCoin(sym);
  }
}

// Brain Cockpit render (massive)
function renderBrainCockpit() {
  if (!S.price) return;
  const klines = S.klines || [];
  const dir = (S.signalData?.bullCount || 0) >= (S.signalData?.bearCount || 0) ? 'long' : 'short';

  // 1. Timezone
  applyTimezone(S.tz || 'Europe/Bucharest');

  // 2. Regime
  const regDat = detectRegimeEnhanced(klines);
  BRAIN.regime = regDat.regime;
  BRAIN.regimeAtrPct = regDat.atrPct;
  // [PATCH 6] Wire BM.regime from BRAIN.regime so state.js/deepdive consumers see real value
  BM.regime = regDat.regime;

  // 3. MTF + Flow + Sweep
  updateMTFAlignment();
  detectSweepDisplacement(klines);
  updateFlowEngine(klines);

  // 4. Safety gates
  const safety = computeSafetyGates(dir);
  const safetyPass = allSafetyPass(safety);
  // ✅ FIX v118: cache pentru renderCircuitBrain (nu mai citește DOM)
  BRAIN._safetyCache = safety;

  // 5. Context gates
  const ctx = computeContextGates(dir, klines);
  // ✅ FIX v118: cache pentru renderCircuitBrain
  BRAIN._ctxCache = ctx;

  // 6. Entry score
  // [PATCH BRAIN-AT-IDLE] Skip decision score pipeline when AT is OFF
  if (AT.enabled) {
    const gates = computeGates(dir);
    computeEntryScore(gates, dir);
  } else {
    BM.entryScore = 0; BM.entryReady = false;
  }

  // 6b. Market Atmosphere (aggregator — reads all existing signals)
  computeMarketAtmosphere();

  // 7. News + chaos
  updateNewsShield();
  updateChaosBar();

  // 8. Protect mode
  const activePnL = (TP.demoPositions || []).filter(p => p.autoTrade && !p.closed).reduce((a, p) => {
    const cur = p.sym === S.symbol ? S.price : (wlPrices[p.sym]?.price || p.entry);
    return a + (p.side === 'LONG' ? cur - p.entry : p.entry - cur) / p.entry * p.size * p.lev;
  }, 0);
  BM.dailyPnL = (AT.dailyPnL || 0) + activePnL;
  checkProtectMode();

  // 9. Determine ARM state
  const score = BM.entryScore || 0;
  const profile = BM.profile;
  const thresholds = { fast: [65, 55], swing: [72, 60], defensive: [80, 65] };
  const prof = S.profile || 'fast';
  const [scoreThresh, confThresh] = thresholds[prof] || [65, 55];
  const tfMap = PROFILE_TF[prof] || PROFILE_TF.fast;
  const confluenceScore = (typeof BM !== 'undefined' ? BM.confluenceScore : 0) || 0; // [FIX v85.1 F3] din memorie
  const triggerOk = ctx.trigger;
  // [ATMOSPHERE] Pre-filter: block ARM if atmosphere forbids entry
  const atmosAllow = BM.atmosphere ? BM.atmosphere.allowEntry !== false : true;
  const isArmed = !BM.protectMode && safetyPass && ctx.mtf && ctx.flow && triggerOk && !_fakeout.invalid && score >= scoreThresh && confluenceScore >= confThresh && atmosAllow;
  const hasPos = (TP.demoPositions || []).some(p => p.autoTrade && !p.closed);
  const mode = S.mode || 'manual';

  // DSL WAIT > 10min → raise threshold hint
  const anyDSLWait = (TP.demoPositions || []).some(p => {
    const d = DSL.positions?.[p.id];
    return d && !d.active && p.autoTrade && !p.closed;
  });

  let state = BM.protectMode ? 'protect' : AT.killTriggered ? 'blocked' : hasPos ? 'trading' : isArmed ? 'armed' : score > 40 ? 'analyzing' : 'scanning';
  BRAIN.state = state === 'armed' ? 'ready' : state;

  // ── SAFETY LED ROWS ──
  const safetyMap = {
    risk: { led: 'led-risk', lbl: 'lbl-risk', txt: 'Risk ' + (safety.risk ? 'OK' : 'FAIL') },
    spread: { led: 'led-spread', lbl: 'lbl-spread', txt: 'Spread/Slip ' + (safety.spread ? 'OK' : 'FAIL') },
    cooldown: { led: 'led-cooldown', lbl: 'lbl-cooldown', txt: 'Cooldown ' + (safety.cooldown ? 'OFF' : 'WAIT') },
    news: { led: 'led-news', lbl: 'lbl-news', txt: 'News ' + (safety.news ? 'OK' : 'BLOCK-HIGH') },
    session: { led: 'led-session', lbl: 'lbl-session', txt: 'Session ' + (safety.session ? 'OK' : 'OFF') },
    noOpposite: { led: 'led-noopposite', lbl: 'lbl-noopposite', txt: 'No Opposite ' + (safety.noOpposite ? 'OK' : 'FAIL') },
    regime: { led: 'led-regime', lbl: 'lbl-regime', txt: 'Regime ' + (safety.regime ? 'STABLE' : 'UNSTABLE') }
  };
  Object.entries(safetyMap).forEach(([key, { led, lbl, txt }]) => {
    const pass = safety[key];
    const ledEl = el(led), lblEl = el(lbl);
    if (ledEl) ledEl.className = 'znc-led ' + (pass ? 'ok' : 'fail');
    if (lblEl) { lblEl.textContent = txt; lblEl.className = 'znc-gate-lbl ' + (pass ? 'ok' : 'fail'); }
  });

  // ── CONTEXT LED ROWS ──
  const mtfTFs = ['15m', '1h', '4h'];
  const mtfAlignCount = mtfTFs.filter(tf => BM.mtf[tf] === (dir === 'long' ? 'bull' : 'bear')).length;
  const ctxMap = {
    mtf: { led: 'led-mtf', lbl: 'lbl-mtf', txt: `MTF Align ${mtfAlignCount}/3`, pass: ctx.mtf },
    flow: { led: 'led-flow', lbl: 'lbl-flow', txt: `Flow ${ctx.flow ? 'CONFIRM' : 'WEAK'}`, pass: ctx.flow },
    trigger: { led: 'led-trigger', lbl: 'lbl-trigger', txt: `Trigger: ${ctx.trigger ? 'Sweep+Reclaim' : 'NONE'}`, pass: ctx.trigger, wait: true },
    antifake: { led: 'led-antifake', lbl: 'lbl-antifake', txt: `Anti-Fakeout ${_fakeout.invalid ? 'BLOCK' : 'OK'}`, pass: !_fakeout.invalid }
  };
  Object.entries(ctxMap).forEach(([, o]) => {
    const { led, lbl, txt, pass, wait } = o;
    const ledEl = el(led), lblEl = el(lbl);
    const cls = pass ? 'ok' : (wait && !pass) ? 'wait' : 'fail';
    if (ledEl) ledEl.className = 'znc-led ' + cls;
    if (lblEl) { lblEl.textContent = txt; lblEl.className = 'znc-gate-lbl ' + cls; }
  });

  // ── MTF TF BADGES (per profile) ──
  const tfsToShow = prof === 'fast' ? ['5m', '15m', '1h'] : prof === 'swing' ? ['15m', '1h', '4h'] : ['30m', '1h', '4h'];
  ['mtf15m', 'mtf1h', 'mtf4h'].forEach((id, i) => {
    const b = el(id); if (!b) return;
    const tf = tfsToShow[i] || mtfTFs[i];
    const rsi = S.rsi?.[tf] || 50;
    const tdir = rsi > 55 ? 'bull' : rsi < 45 ? 'bear' : 'neut';
    BM.mtf[tf] = tdir;
    b.textContent = tf + ' ' + (tdir === 'bull' ? '▲' : tdir === 'bear' ? '▼' : '—');
    b.className = 'znc-tf-badge ' + tdir + (i === 0 ? ' trigger' : '');
  });
  const trigBadge = el('mtfTrig');
  if (trigBadge) { trigBadge.textContent = 'TRIG:' + tfMap.trigger + ' ' + (BM.flow?.cvd === 'rising' ? '▲' : BM.flow?.cvd === 'falling' ? '▼' : '—'); }

  // ── ORB SCORE ARC ──
  const arc = el('zncScoreArc');
  const numEl = el('zncScoreNum');
  const scoreLbl = el('zncScoreLbl');
  const circum = 302; // 2π×48
  const col = score >= scoreThresh ? '#39ff14' : score >= 60 ? '#f0c040' : '#ff3355';
  if (arc) { arc.setAttribute('stroke-dasharray', `${score / 100 * circum} ${circum}`); arc.setAttribute('stroke', col); }
  if (numEl) { numEl.textContent = score || '—'; numEl.style.color = col; numEl.style.textShadow = `0 0 16px ${col}`; }
  if (scoreLbl) { scoreLbl.textContent = score >= scoreThresh ? 'READY' : score >= 60 ? 'WAIT' : 'BLOCK'; scoreLbl.className = 'znc-state ' + (score >= scoreThresh ? 'armed' : score >= 60 ? 'analyzing' : 'blocked'); }

  // ── ORB LED NODES (gate state → LED ring dots) ──
  const ledStates = [safety.risk, safety.spread, safety.cooldown, safety.news, safety.session, ctx.mtf, ctx.flow, ctx.trigger, !_fakeout.invalid];
  ledStates.forEach((pass, i) => {
    const dot = el('zled' + i); if (!dot) return;
    const c2 = pass ? '#39ff14' : '#ff3355';
    dot.setAttribute('fill', c2 + '22');
    dot.setAttribute('stroke', c2);
    dot.setAttribute('r', pass ? '6' : '4');
  });

  // ── STATE / ARM BADGES ──
  const badge = el('brainStateBadge');
  const stLabels = { scanning: 'SCANNING', analyzing: 'ANALYZING', armed: '⚡ ARMED', trading: '🔴 TRADING', protect: '🛡 PROTECT', blocked: '⛔ BLOCKED' };
  if (badge) { badge.textContent = stLabels[state] || state.toUpperCase(); badge.className = 'znc-state ' + state; }
  const armBadge = el('zncArmBadge');
  if (armBadge) {
    const armTxt = isArmed ? 'ARMED' : BM.protectMode ? 'PROTECT' : hasPos ? 'TRADING' : 'SCANNING';
    armBadge.textContent = armTxt;
    armBadge.className = 'znc-arm-badge ' + (isArmed ? 'armed' : BM.protectMode ? 'protect' : hasPos ? 'trading' : 'scanning');
  }

  // ── CONTROL SOURCE ──
  const srcEl = el('znc-src');
  if (srcEl) {
    const srcMap = { manual: ['USER', 'user'], assist: ['ASSIST', 'assist'], auto: ['AI', 'ai'] };
    srcEl.textContent = srcMap[mode][0];
    srcEl.className = 'znc-src ' + srcMap[mode][1];
  }

  // ── REGIME BADGES ──
  const regLabels = { trend: 'TREND ▲', range: 'RANGE —', breakout: 'BREAKOUT ↑', squeeze: 'SQUEEZE ⚙', panic: 'PANIC 🔥', unknown: '—' };
  [el('brainRegimeBadge'), el('brainRegimeBadge2')].forEach(b => {
    if (!b) return;
    b.textContent = regLabels[BRAIN.regime] || BRAIN.regime;
    b.className = 'znc-regime-val ' + (BRAIN.regime || 'unknown');
  });
  const rd = el('zncRegimeDetail');
  if (rd) rd.textContent = `ADX: ${regDat.adx || '—'} | VOL: ${regDat.volMode || '—'} | ${regDat.structure || '—'}${regDat.squeeze ? ' | SQZ' : ''}`;

  // ── INSIGHT CARDS (use card IDs directly) ──
  const sw = BM.sweep;
  const delta = BM.flow?.delta || 0;
  const chaos = Math.round((BRAIN.regimeAtrPct || 0) * 15 + (BM.newsRisk === 'high' ? 40 : BM.newsRisk === 'med' ? 20 : 0));
  const _card = (cardId, titleId, subId, t, s, cls) => {
    const ca = el(cardId), ti = el(titleId), si = el(subId);
    if (ca) ca.className = 'znc-card ' + cls;
    if (ti) ti.textContent = t;
    if (si) si.textContent = s;
  };
  _card('card-flow', 'card-flow-t', 'card-flow-s', 'Flow ' + (ctx.flow ? 'CONFIRM' : 'WEAK'), 'Delta ' + (delta >= 0 ? '+' : '') + delta, ctx.flow ? 'ok' : 'fail');
  _card('card-sweep', 'card-sweep-t', 'card-sweep-s', sw.type !== 'none' ? 'Sweep ' + sw.type.toUpperCase() + ' ✦' : 'Sweep NONE', sw.reclaim ? '$' + fP(S.price) + ' reclaimed' : 'No reclaim', sw.reclaim ? 'ok' : 'warn');
  _card('card-mtf', 'card-mtf-t', 'card-mtf-s', 'MTF ' + mtfAlignCount + '/3', tfMap.trigger + ' – ' + tfMap.bias, mtfAlignCount >= 2 ? 'ok' : 'warn');
  _card('card-chaos', 'card-chaos-t', 'card-chaos-s', 'Chaos ' + (chaos < 33 ? 'OK' : chaos < 66 ? 'MED' : 'HIGH'), 'ATR ' + (BRAIN.regimeAtrPct || 0).toFixed(2) + '%', chaos < 33 ? 'ok' : chaos < 66 ? 'warn' : 'fail');

  // ── ATMOSPHERE CARD ──
  const atmos = BM.atmosphere || {};
  const aCat = (atmos.category || 'neutral').toLowerCase();
  const aCls = aCat === 'clean_trend' ? 'ok' : aCat === 'range' ? 'warn' : aCat === 'toxic_volatility' ? 'toxic' : aCat === 'trap_risk' ? 'fail' : 'neut';
  const aLabel = (atmos.category || 'NEUTRAL').toUpperCase().replace('_', ' ');
  const aAllow = atmos.allowEntry !== false ? 'ALLOW' : 'BLOCK';
  const aSub = aAllow + ' · conf:' + (atmos.confidence || 0) + ' · ×' + (atmos.sizeMultiplier != null ? atmos.sizeMultiplier : '?');
  _card('card-atmos', 'card-atmos-t', 'card-atmos-s', '⚡ ' + aLabel, aSub, aCls);
  // Chaos shimmer CSS
  const orbWrap = el('zncOrbWrap');
  if (orbWrap) orbWrap.style.animation = chaos > 80 ? 'zHeat .15s infinite' : '';

  // ── THREAT CIRCLES ──
  const newsScore = BM.newsRisk === 'high' ? 80 : BM.newsRisk === 'med' ? 40 : 10;
  const liqScore = Math.round((BRAIN.ofi?.sell || 50) / 100 * 60);
  const volScore = Math.round(Math.min(100, (BRAIN.regimeAtrPct || 0) * 20));
  [[newsScore, 'threat-news', 'threatNewsVal'], [liqScore, 'threat-liq', 'threatLiqVal'], [volScore, 'threat-vol', 'threatVolVal']].forEach(([v, cid, vid]) => {
    const c = el(cid), vv = el(vid);
    const col2 = v < 33 ? '#39ff14' : v < 66 ? '#f0c040' : '#ff3355';
    if (c) c.className = 'znc-circ ' + (v < 33 ? 'low' : v < 66 ? 'med' : 'high');
    if (vv) { vv.textContent = v; vv.style.color = col2; }
  });

  // ── GAUGES ──
  const na = el('newsGaugeArc'); if (na) na.setAttribute('stroke-dasharray', `${newsScore / 100 * 75} 75`);
  const la = el('liqGaugeArc'); if (la) la.setAttribute('stroke-dasharray', `${liqScore / 100 * 75}  75`);
  const nv = el('newsGaugeVal'); if (nv) { nv.textContent = newsScore; nv.style.color = newsScore < 33 ? '#39ff14' : newsScore < 66 ? '#f0c040' : '#ff3355'; }
  const lv = el('liqGaugeVal'); if (lv) { lv.textContent = liqScore; lv.style.color = liqScore < 33 ? '#39ff14' : liqScore < 66 ? '#f0c040' : '#ff3355'; }

  // ── ARM DETAIL + TOP BLOCK REASON (uses S.* canonical) ──
  const trigType = sw.reclaim ? 'Sweep+Reclaim' : sw.displacement ? 'Displacement' : '—';
  const cdLeft = Math.max(0, Math.round((_getCooldownMs() - (Date.now() - (AT.lastTradeTs || 0))) / 60000));
  const _ad = (id, v, arm) => { const e = el(id); if (e) { e.textContent = v; if (arm !== undefined) e.style.color = arm ? '#39ff14' : '#2a4030'; } };
  _ad('zad-mode', mode.toUpperCase(), isArmed);
  _ad('zad-profile', prof.toUpperCase() + '  ' + tfMap.trigger + '/' + tfMap.context + '/' + tfMap.bias);
  _ad('zad-score', score + '/' + (isArmed ? '✓' : scoreThresh + '↑'), isArmed);
  _ad('zad-trigger', trigType, ctx.trigger);
  _ad('zad-tf', 'Trig:' + tfMap.trigger + ' Ctx:' + tfMap.context);
  _ad('zad-cd', cdLeft > 0 ? cdLeft + 'm WAIT' : 'READY', cdLeft === 0);

  // ── GATES SUMMARY + TOP BLOCK REASON ──
  const allGates = Object.assign({}, safety, { mtfCtx: ctx.mtf, flowCtx: ctx.flow, triggerCtx: ctx.trigger, antifakeCtx: !_fakeout.invalid });
  const gatesOk = Object.values(allGates).filter(Boolean).length;
  const gatesTotal = Object.keys(allGates).length;
  const gatesSumEl = el('zad-gates-summary');
  if (gatesSumEl) gatesSumEl.textContent = `Gates: ${gatesOk}/${gatesTotal} pass`;

  // Compute single TOP REASON why not entering
  let topReason = '';
  let reasonCls = 'wait';
  if (BM.protectMode) { topReason = `AUTO BLOCKED: ${BM.protectReason}`; reasonCls = 'block'; }
  else if (AT.killTriggered) { topReason = 'AUTO BLOCKED: Kill switch activ'; reasonCls = 'block'; }
  else if (!safety.news) { topReason = 'AUTO BLOCKED: NewsRisk HIGH → prea periculos'; reasonCls = 'block'; }
  else if (!safety.regime) { topReason = 'AUTO WAIT: Regime unstable (not locked 3 closes)'; reasonCls = 'wait'; }
  else if (!safety.cooldown) { topReason = `AUTO WAIT: Cooldown ${cdLeft}m rămas (${prof})`; reasonCls = 'wait'; }
  else if (!safety.session) { topReason = 'AUTO WAIT: Session OFF — oră nefavorabilă'; reasonCls = 'wait'; }
  else if (!safety.noOpposite) { topReason = 'AUTO BLOCKED: Poziție opusă deschisă'; reasonCls = 'block'; }
  else if (!safety.risk) { topReason = 'AUTO BLOCKED: Risk Limits atinse (DD/Streak/MaxPos)'; reasonCls = 'block'; }
  else if (!ctx.trigger) { topReason = 'AUTO WAIT: Trigger neconfirmat (Sweep+Reclaim sau Disp)'; reasonCls = 'wait'; }
  else if (!ctx.flow) { topReason = 'AUTO WAIT: FlowConfirm FAIL — CVD/Delta neutru'; reasonCls = 'wait'; }
  else if (_fakeout.invalid) { topReason = 'AUTO WAIT: Anti-fakeout — 2 closes fără follow-through'; reasonCls = 'wait'; }
  else if (!ctx.mtf) { topReason = `AUTO WAIT: MTF Align ${mtfAlignCount}/3 (min 2 cerut)`; reasonCls = 'wait'; }
  else if (score < scoreThresh) { topReason = `AUTO WAIT: EntryScore ${score} < ${scoreThresh} (${prof})`; reasonCls = 'wait'; }
  else if (confluenceScore < confThresh) { topReason = `AUTO WAIT: Confluence ${confluenceScore} < ${confThresh}`; reasonCls = 'wait'; }
  else if (!atmosAllow) { topReason = `AUTO BLOCK: Atmosphere ${(BM.atmosphere?.category || '?').toUpperCase()} — ${(BM.atmosphere?.reasons || []).slice(0, 2).join(', ')}`; reasonCls = 'block'; }
  else if (mode === 'assist' && !AT.enabled) { topReason = 'ASSIST: Brain monitoring — enable AutoTrade to execute'; reasonCls = 'wait'; }
  else if (mode === 'assist') { topReason = isArmAssistValid() ? 'ASSIST ARMED: Waiting user confirm' : 'ASSIST: Needs ARM + manual confirm'; reasonCls = 'wait'; }
  else if (isArmed) { topReason = `AUTO ARMED: Entry score ${score} ✓ — waiting close`; reasonCls = 'ok'; }
  else { topReason = `AUTO SCANNING: Score ${score} | ${BRAIN.regime?.toUpperCase() || '—'}`; reasonCls = 'wait'; }

  const brEl = el('zad-block-reason');
  if (brEl) { brEl.textContent = topReason; brEl.className = 'znc-block-reason ' + reasonCls; }

  // ── PROTECT BANNER ──
  const pb = el('protectBanner');
  if (pb) pb.className = 'znc-protect' + (BM.protectMode ? ' show' : '');
  const pbt = el('protectBannerTxt');
  if (pbt && BM.protectMode) pbt.textContent = BM.protectReason;

  // ── DSL STATUS (clear, non-ambiguous) ──
  const dslEl = el('zncDslContract');
  if (dslEl) {
    const _dslMode = (S.mode || 'assist').toLowerCase();
    const _modeTag = _dslMode === 'auto' ? '<span style="color:#39ff14;font-size:10px">●AI</span>' : _dslMode === 'assist' ? '<span style="color:#f0c040;font-size:10px">●USR</span>' : '<span style="color:#2a4030;font-size:10px">●MAN</span>';
    const autoPosnsAll = (TP.demoPositions || []).filter(p => p.autoTrade && !p.closed);
    const activeDSLPosns = autoPosnsAll.filter(p => DSL.positions?.[p.id]?.active);
    const waitDSLPosns = autoPosnsAll.filter(p => DSL.positions?.[p.id] && !DSL.positions[p.id].active);
    if (!DSL.enabled) {
      // Engine completely off
      dslEl.innerHTML = `DSL ENGINE: <b style="color:#aa2233">OFF</b> ${_modeTag} | Activează engine-ul.`;
    } else if (!autoPosnsAll.length) {
      // Engine ready but no auto positions yet
      dslEl.innerHTML = `DSL ENGINE: <b style="color:#f0c040">READY</b> ${_modeTag} · Nicio poziție AUTO deschisă`;
    } else if (!activeDSLPosns.length && waitDSLPosns.length) {
      // Positions exist, waiting for activation threshold
      dslEl.innerHTML = `DSL ENGINE: <b style="color:#f0c040">WAIT</b> ${_modeTag} · ${waitDSLPosns.length} poz. asteaptă activare`;
    } else if (activeDSLPosns.length) {
      // At least one position actively trailed
      const p = activeDSLPosns[0], dsl = DSL.positions[p.id];
      const steps = dsl.log?.filter(l => l.msg?.includes('IMPULSE')).length || 0;
      const sym = (p.sym || '').replace('USDT', '');
      dslEl.innerHTML = `DSL: <b style="color:#00ffcc">TRAILING</b> ${_modeTag} · ${sym} PL:<b>$${fP(dsl.pivotLeft)}</b> PR:<b>$${fP(dsl.pivotRight)}</b> · Steps:<b>${steps}</b>`;
    } else {
      dslEl.innerHTML = `DSL ENGINE: <b style="color:#f0c040">READY</b> ${_modeTag} · ${autoPosnsAll.length} poz. monitorizate`;
    }
  }

  // ── RECEIPT (ARM state) ──
  if (isArmed || hasPos) {
    ['rec-mode', 'rec-score', 'rec-trigger', 'rec-tf'].forEach((id, i) => {
      const e = el(id); if (e) e.textContent = [mode.toUpperCase(), score, trigType, tfMap.trigger + '/' + tfMap.context][i];
    });
  }

  // ── Q-FORECAST DISPLAY (pure display — S.quantumForecast set by Brain engine) ──
  (function renderQForecast() {
    const mainEl = el('bf-main');
    const rangeEl = el('bf-range');
    const stateEl = el('bf-state');
    if (!mainEl) return;

    const qf = S.quantumForecast;
    const sent = qf?.sentiment || 'neutral';
    const strength = +(qf?.strength) || 0;
    const rangeLow = qf?.rangeLow;
    const rangeHigh = qf?.rangeHigh;
    const qfState = qf?.state || '—';

    // Sentiment → css class
    const sentLower = sent.toLowerCase();
    const sentCls = sentLower.includes('bull') ? 'bull'
      : sentLower.includes('bear') ? 'bear'
        : 'neut';
    // strength modifiers
    const glowCls = strength > 70 ? ' glow' : '';
    const dimCls = strength < 40 ? ' dim' : '';

    const sentLabel = strength > 0
      ? sent.charAt(0).toUpperCase() + sent.slice(1).toLowerCase() + ' (' + strength + ')'
      : 'Neutral (0)';

    mainEl.textContent = sentLabel;
    mainEl.className = 'bf-main ' + sentCls + glowCls + dimCls;

    if (rangeEl) {
      rangeEl.textContent = (rangeLow && rangeHigh)
        ? fP(rangeLow) + ' – ' + fP(rangeHigh)
        : '—';
    }
    if (stateEl) stateEl.textContent = strength > 0 ? qfState : '—';
  })();

  // ── WHY ENGINE DISPLAY (pure display — S.why set by trade engine) ──
  (function renderWhyEngine() {
    const stateEl = el('bw-state');
    const reasonsEl = el('bw-reasons');
    if (!stateEl) return;

    const why = S.why;
    const whyState = (why?.state || 'WAIT').toUpperCase();
    const reasons = Array.isArray(why?.reasons) && why.reasons.length
      ? why.reasons
      : ['—'];

    // State → css class
    const stateCls = whyState === 'EXECUTED' ? 'executed'
      : whyState === 'BLOCKED' ? 'blocked'
        : 'wait';

    stateEl.textContent = whyState;
    stateEl.className = 'bw-state ' + stateCls;

    if (reasonsEl) {
      reasonsEl.innerHTML = reasons
        .slice(0, 6)   // cap at 6 lines — no DOM bloat
        .map(r => '<span>' + String(r).replace(/</g, '&lt;') + '</span>')
        .join('');
    }
  })();

  // ── AUB sync — update data badges from brain state ──
  if (typeof _aubUpdateDataBadge === 'function') _aubUpdateDataBadge();
  // ── NEURON COMPAT (setNeuron still called by updateNeurons) ──
  updateNeurons();
  updateOrderFlow();
}

// ── CIRCUIT BRAIN render hook ──
try { renderCircuitBrain(); } catch (_) { }

// ══════════════════════════════════════════════════════════════════
// RAF ANIMATION ENGINE — orb pulse, radar sweep, particles
// SVG + CSS only, no WebGL — performant on Android
// ══════════════════════════════════════════════════════════════════
// [MOVED TO TOP] ZANIM


// Z Particles animation
function initZParticles() {
  const wrap = el('zncParticles');
  if (!wrap) return;
  wrap.innerHTML = '';
  const colors = ['#39ff14', '#00ffcc', '#f0c040', '#aa44ff', '#ff8800'];
  for (let i = 0; i < 18; i++) {
    const d = document.createElement('div');
    d.className = 'znc-particle';
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    const dx = (Math.random() - 0.5) * 80;
    const dy = (Math.random() - 0.5) * 80;
    const dur = 3 + Math.random() * 5;
    const col = colors[Math.floor(Math.random() * colors.length)];
    d.style.cssText = `left:${x}%;top:${y}%;background:${col};--dx:${dx}px;--dy:${dy}px;--dur:${dur}s;animation-delay:${Math.random() * dur}s`;
    wrap.appendChild(d);
  }
}

function zAnimFrame(ts) {
  if (!ZANIM.running) return;
  // [PERF] skip render work when tab hidden
  if (document.hidden) { requestAnimationFrame(zAnimFrame); return; }
  const dt = ts - ZANIM.lastFrame;
  ZANIM.lastFrame = ts;

  // RADAR SWEEP (SVG rotate)
  ZANIM.radarAngle = (ZANIM.radarAngle + dt * 0.12) % 360;
  const sweep = el('zncRadarSweep');
  if (sweep) sweep.setAttribute('transform', `rotate(${ZANIM.radarAngle},110,110)`);

  // ORB PULSE (brightness via filter on core circle)
  ZANIM.orbScale += ZANIM.orbDir;
  if (ZANIM.orbScale > 1.08 || ZANIM.orbScale < 0.95) ZANIM.orbDir *= -1;
  const core = el('zncCore');
  if (core) core.setAttribute('opacity', 0.6 + ZANIM.orbScale * 0.12);

  // SCORE ARC GLOW synapse intensity
  const score = BM.entryScore || 0;
  const synapseOpacity = 0.1 + (score / 100) * 0.5;
  for (let i = 0; i < 9; i++) {
    const syn = el('zsyn' + i);
    if (syn) {
      const base = i < 3 ? '#39ff14' : i < 6 ? '#f0c040' : '#aa44ff';
      syn.setAttribute('stroke', base + Math.round(synapseOpacity * 255).toString(16).padStart(2, '0'));
      syn.setAttribute('stroke-width', 0.8 + synapseOpacity * 1.5);
    }
  }

  requestAnimationFrame(zAnimFrame);
}

function startZAnim() {
  if (ZANIM.running) return;
  ZANIM.running = true;
  ZANIM.lastFrame = performance.now();
  requestAnimationFrame(zAnimFrame);
}


// ══════════════════════════════════════════════════════════
// ZEUS EXECUTION OVERLAY — cinematic entry + exit popups
// Called from trade engine only. Never from UI directly.
// ══════════════════════════════════════════════════════════
// [MOVED TO TOP] _execQueue
// [MOVED TO TOP] _execActive


// Brain dirty cache
const _brainDirtyCache = {};
function _brainDirtySet(key, val) {
  if (_brainDirtyCache[key] === val) return false; // no change — skip
  _brainDirtyCache[key] = val;
  return true; // changed — allow update
}
// Safe DOM update with dirty flag
function _brainSafeSet(elId, val, attr = 'textContent') {
  if (!_brainDirtySet(elId, val)) return;
  const e = el(elId);
  if (e) e[attr] = val;
}


// ✅ FIX v118: getBrainViewSnapshot() — sursă unică de adevăr pentru Brain HUD
// Citește EXCLUSIV din BM/AT/S/_SAFETY — zero DOM reads.
// Dacă un câmp nu există încă, returnează '—' (nu 0, nu fake).
function getBrainViewSnapshot() {
  const _s = typeof S !== 'undefined' ? S : {};
  const _bm = typeof BM !== 'undefined' ? BM : {};
  const _at = typeof AT !== 'undefined' ? AT : {};
  const _sf = typeof _SAFETY !== 'undefined' ? _SAFETY : {};
  const _br = typeof BRAIN !== 'undefined' ? BRAIN : {};

  const mode = (_s.mode || 'assist').toUpperCase();
  const profile = (_s.profile || 'fast').toUpperCase();
  const runMode = !!_s.runMode;

  // Data feed — aceeași sursă ca bannerul
  const price = _s.price || 0;
  const stalled = !!(_sf.dataStalled || _s.dataStalled);
  const recon = !!_sf.isReconnecting;
  const hasWS = !!(_s.bnbOk || _s.bybOk);
  const feedStatus = recon ? 'RECON' : stalled ? 'STALL' : (hasWS && price > 0) ? 'LIVE' : price > 0 ? 'DELAY' : 'WAIT';

  // Regime — din ultimul calc real
  const regime = _br.regime || null;
  const st = _bm.structure || {};
  const adx = (st.adx != null && st.adx !== 0) ? st.adx.toFixed(1) : '—';
  const vol = st.volMode || '—';
  const struct = st.structureLabel || '—';

  // Safety gates — din cache (setat de renderBrainCockpit)
  const safety = _br._safetyCache || null;
  const ctx = _br._ctxCache || null;
  const gatesPass = safety ? Object.values(safety).filter(Boolean).length : null;
  const gatesTotal = safety ? Object.keys(safety).length : null;

  // Score
  const score = _bm.entryScore || 0;

  // Risk/Cooldown
  const kill = !!_at.killTriggered;
  const protect = !!_bm.protectMode;
  const cdMs = typeof _getCooldownMs === 'function' ? _getCooldownMs() : 0;
  const cdLeft = Math.max(0, Math.round((cdMs - (Date.now() - (_at.lastTradeTs || 0))) / 60000));

  // Brain state
  const state = _br.state || 'scanning';

  return {
    mode, profile, runMode, price, feedStatus, hasWS, regime, adx, vol, struct,
    gatesPass, gatesTotal, safety, ctx, score, kill, protect, cdLeft, state
  };
}

// ══════════════════════════════════════════════════════════════════
// CIRCUIT BRAIN RENDER — v117
// Reads existing state, updates circuit brain module nodes only.
// Zero logic changes.
// ══════════════════════════════════════════════════════════════════

// Circuit brain render
function renderCircuitBrain() {
  // ── helpers ──
  const cbn = (id) => document.getElementById(id);
  const setNode = (boxId, valId, subId, statusCls, valTxt, subTxt) => {
    const box = cbn(boxId), val = cbn(valId), sub = cbn(subId);
    if (box) box.className = 'cbn-box ' + statusCls;
    if (val) { val.className = 'cbn-val ' + statusCls; val.textContent = valTxt; }
    if (sub && subTxt !== undefined) sub.textContent = subTxt;
  };
  const svgNode = (id, statusCls) => {
    const n = cbn(id); if (!n) return;
    const animMap = {
      ok: 'cbPulseOk 2.5s ease-in-out infinite',
      warn: 'cbPulseWarn 3.0s ease-in-out infinite',
      bad: 'cbPulseBad 2.2s ease-in-out infinite',
      mem: 'cbPulseMem 3.8s ease-in-out infinite',
      vis: 'cbPulseNeutral 2.9s ease-in-out infinite',
      neutral: 'cbPulseNeutral 3.2s ease-in-out infinite',
    };
    const colMap = {
      ok: '#00E5FF', // ACTIVE / ONLINE
      warn: '#FFB000', // EXEC / ACTION
      bad: '#C1121F', // RISK / FAIL
      mem: '#2962FF', // DOMINANT / POWER (cobalt)
      vis: '#00E5FF', // VISION / FEED (cyan)
      neutral: '#4B5D73'  // INACTIVE / GUNMETAL
    };
    n.setAttribute('stroke', colMap[statusCls] || '#4B5D73');
    n.style.animation = animMap[statusCls] || animMap.neutral;
  };

  // ── 1. GATES summary ──
  try {
    // ✅ FIX v118: citim din BRAIN._safetyCache (real state), NU din DOM LED class-uri
    const _sf = (typeof BRAIN !== 'undefined' && BRAIN._safetyCache) ? BRAIN._safetyCache : null;
    const _cx = (typeof BRAIN !== 'undefined' && BRAIN._ctxCache) ? BRAIN._ctxCache : null;
    let gOk = 0, gTotal = 0;
    if (_sf && _cx) {
      const allGatesSnap = Object.assign({}, _sf, { mtfCtx: _cx.mtf, flowCtx: _cx.flow, triggerCtx: _cx.trigger, antifakeCtx: !((typeof _fakeout !== 'undefined' && _fakeout.invalid)) });
      gTotal = Object.keys(allGatesSnap).length;
      gOk = Object.values(allGatesSnap).filter(Boolean).length;
    } else {
      // fallback DOM (înainte de primul renderBrainCockpit)
      const safetyIds = ['led-risk', 'led-spread', 'led-cooldown', 'led-news', 'led-session', 'led-noopposite', 'led-regime'];
      gTotal = safetyIds.length;
      safetyIds.forEach(id => { const e = document.getElementById(id); if (e && e.className && e.className.includes('ok')) gOk++; });
    }
    const allOk = gTotal > 0 && gOk === gTotal;
    const gCls = allOk ? 'ok' : gOk >= gTotal - 1 ? 'warn' : 'bad';
    // sub-linie: spread + news + cooldown din state real
    const cdLeft = (typeof _getCooldownMs === 'function') ? Math.max(0, Math.round((_getCooldownMs() - (Date.now() - ((typeof AT !== 'undefined' ? AT.lastTradeTs : 0) || 0))) / 60000)) : 0;
    const gSub = [
      _sf ? ('Spread:' + (_sf.spread ? 'OK' : 'FAIL')) : '—',
      _sf ? ('News:' + (_sf.news ? 'OK' : 'BLK')) : '—',
      cdLeft > 0 ? ('CD:' + cdLeft + 'm') : 'CD:OK'
    ].join(' · ');
    setNode('cbn-gates-box', 'cbn-gates-val', 'cbn-gates-sub', gCls, gOk + '/' + gTotal, gSub);
    svgNode('cb-node-gates', gCls);
  } catch (_) { }

  // ── 2. REGIME ──
  try {
    // ✅ FIX v118: citim din BRAIN.regime (real state), NU din DOM text
    const _reg = (typeof BRAIN !== 'undefined' && BRAIN.regime) ? BRAIN.regime : null;
    const regLabels = { trend: 'TREND ▲', range: 'RANGE —', breakout: 'BREAKOUT ↑', squeeze: 'SQUEEZE ⚙', panic: 'PANIC 🔥', unknown: '—' };
    const regTxt = _reg ? (regLabels[_reg] || _reg.toUpperCase()) : '—';
    const regCls = _reg
      ? ({ trend: 'ok', range: 'neutral', breakout: 'ok', squeeze: 'warn', panic: 'bad', unknown: 'neutral' }[_reg] || 'neutral')
      : 'neutral';
    // ADX/VOL din BM.structure (calculat de detectRegimeEnhanced)
    const _st = (typeof BM !== 'undefined' && BM.structure) ? BM.structure : null;
    const adxVal = (_st && _st.adx) ? _st.adx.toFixed(1) : '—';
    const volVal = (_st && _st.volMode) ? _st.volMode : '—';
    const strVal = (_st && _st.structureLabel) ? _st.structureLabel : '—';
    const subTxt = ('ADX:' + adxVal + ' VOL:' + volVal + ' ' + strVal).slice(0, 28);
    setNode('cbn-regime-box', 'cbn-regime-val', 'cbn-regime-sub', regCls, regTxt.replace(' ▲', '').replace(' ↑', ''), subTxt);
    svgNode('cb-node-regime', regCls);
  } catch (_) { }

  // ── 3. SCORE (zncScoreNum & zncScoreLbl already updated by renderBrainCockpit) ──
  try {
    const score = (typeof BM !== 'undefined' ? BM.entryScore : 0) || 0;
    const scoreLbl = document.getElementById('zncScoreLbl');
    const scoreCls = score >= 65 ? 'ok' : score >= 50 ? 'warn' : 'bad';
    const scoreBox = cbn('cbn-score-box');
    if (scoreBox) scoreBox.className = 'cbn-box ' + scoreCls;
    // Update score arc circumference to match new smaller circle r=22 (circumf = 2π×22 ≈ 138)
    const arc = cbn('zncScoreArc');
    if (arc) {
      const circum = 138;
      arc.setAttribute('stroke-dasharray', (score / 100 * circum) + ' ' + circum);
      const col = score >= 65 ? '#39ff14' : score >= 50 ? '#f0c040' : '#ff3355';
      arc.setAttribute('stroke', col);
    }
    svgNode('cb-node-score', scoreCls);
  } catch (_) { }

  // ── 4. RISK RAILS (cooldown, kill, protect) ──
  try {
    // ✅ FIX v118: cooldown din calcul real, NU din cdEl.textContent (DOM)
    const kill = (typeof AT !== 'undefined' && AT.killTriggered);
    const prot = (typeof BM !== 'undefined' && BM.protectMode);
    const cdMs = (typeof _getCooldownMs === 'function') ? _getCooldownMs() : 0;
    const cdLeft = Math.max(0, Math.round((cdMs - (Date.now() - ((typeof AT !== 'undefined' ? AT.lastTradeTs : 0) || 0))) / 60000));
    const riskCls = kill || prot ? 'bad' : cdLeft > 0 ? 'warn' : 'vis';
    const riskVal = kill ? 'KILL' : prot ? 'PROTECT' : cdLeft > 0 ? cdLeft + 'm WAIT' : 'OK';
    const riskSub = 'Cooldown ' + (cdLeft > 0 ? cdLeft + 'm' : 'OFF') + ' · DD%';
    setNode('cbn-risk-box', 'cbn-risk-val', 'cbn-risk-sub', riskCls, riskVal, riskSub);
    svgNode('cb-node-risk', riskCls);
  } catch (_) { }

  // ── 5. DATA FEED ──
  try {
    // ✅ FIX v118: aceeași sursă ca bannerul de feed (S.bnbOk/S.bybOk/S.dataStalled/_SAFETY.isReconnecting)
    // S.reconnecting era NICIODATĂ setat — fix: folosim _SAFETY.isReconnecting
    const price = (typeof S !== 'undefined' && S.price) ? S.price : 0;
    const stall = (typeof S !== 'undefined' && S.dataStalled) || (typeof _SAFETY !== 'undefined' && _SAFETY.dataStalled);
    const recon = (typeof _SAFETY !== 'undefined' && _SAFETY.isReconnecting);
    const hasWS = (typeof S !== 'undefined') && (S.bnbOk || S.bybOk);
    const dataCls = recon ? 'bad' : stall ? 'warn' : hasWS && price > 0 ? 'ok' : price > 0 ? 'warn' : 'neutral';
    const dataVal = recon ? 'RECON' : stall ? 'STALL' : hasWS && price > 0 ? 'LIVE' : price > 0 ? 'DELAY' : 'WAIT';
    const sym = (typeof S !== 'undefined' && S.symbol) ? S.symbol.replace('USDT', '') : '—';
    setNode('cbn-data-box', 'cbn-data-val', 'cbn-data-sub', dataCls, dataVal, sym + ' · ' + (price > 0 ? '$' + (price > 100 ? Math.round(price) : price.toFixed(2)) : '—'));
    svgNode('cb-node-data', dataCls);
  } catch (_) { }

  // ── 6. AUTO-TRADE ──
  try {
    // ✅ FIX v118: citim din BRAIN.state + S.mode + S.profile (real state), NU din DOM
    const _brState = (typeof BRAIN !== 'undefined' && BRAIN.state) ? BRAIN.state : 'scanning';
    const _mode = (typeof S !== 'undefined' && S.mode) ? S.mode.toUpperCase() : 'MANUAL';
    const _prof = (typeof S !== 'undefined' && S.profile) ? S.profile.toUpperCase() : 'FAST';
    const stLabels = { scanning: 'SCANNING', analyzing: 'ANALYZING', ready: '⚡ARMED', trading: '🔴TRADE', protect: '🛡PROT', blocked: '⛔BLOCK' };
    const armTxt = (stLabels[_brState] || _brState.toUpperCase()).slice(0, 8);
    const armCls = (_brState === 'ready' || _brState === 'armed') ? 'ok'
      : _brState === 'trading' ? 'ok'
        : (_brState === 'protect' || _brState === 'blocked') ? 'bad'
          : 'mem';
    const subLine = _mode + ' · ' + _prof;
    setNode('cbn-auto-box', 'cbn-auto-val', 'cbn-auto-sub', armCls, armTxt, subLine.slice(0, 22));
    svgNode('cb-node-auto', armCls);
  } catch (_) { }

  // ── 7. Sync circuit trace colour to overall state ──
  try {
    const state = (typeof BRAIN !== 'undefined' && BRAIN.state) ? BRAIN.state : 'scanning';
    const traceCol = state === 'ready' || state === 'armed' ? '#39ff1444'
      : state === 'trading' ? '#39ff1477'
        : state === 'protect' || state === 'blocked' ? '#ff335544'
          : '#00b8d455';
    document.querySelectorAll('#brainSvg .b-trace').forEach(t => {
      t.style.stroke = traceCol;
    });
  } catch (_) { }
}

function runGrandUpdate() {
  if (document.hidden) return; // [PERF] skip cockpit rebuild when tab hidden
  // [PATCH MODE-SWITCH] Skip cockpit rebuild while mode switch modal is open
  if (window.__brainModeSwitching) return;
  renderBrainCockpit();
  // ✅ FIX v118: renderCircuitBrain era apelat O SINGURĂ DATĂ la parse time — acum se refreshează la fiecare ciclu
  try { renderCircuitBrain(); } catch (_) { }
}

// ─── BRAIN COCKPIT INIT — called from startApp (req 4, 8) ──────
// Was: IIFE that ran at parse time (caused race conditions)
// Now: explicit function called in PHASE 1 of boot sequence

// Grand update
// Brain cockpit init
function _initBrainCockpit() {
  if (window._brainInitDone) {
    console.warn('[ZEUS] _initBrainCockpit() called twice — skipping');
    return;
  }
  window._brainInitDone = true;

  // Single sync from S.* canonical state
  syncBrainFromState();

  // Neuron coin LEDs
  initNeuroCoinLEDs();

  // Particles
  initZParticles();

  // Start RAF loop (single, req 8: one runRenderLoop)
  startZAnim();

  // First render after short delay
  setTimeout(runGrandUpdate, 1500);

  // Single grandUpdate interval (req 8)
  // [PERF] 3000→5000ms — cockpit rebuild is heavy, 5s is sufficient
  if (!window._brainIntervalId) {
    window._brainIntervalId = Intervals.set('grandUpdate', runGrandUpdate, 5000);
  }
}
// triggerExecCinematic lives in positions.js (loaded after brain.js)


// Track trade stats for protect mode — hook into closeDemoPos

// ✅ FIX v118: Reset automat la schimbare de zi (24h)


// ─── Market Regime Detection ─────────────────────────────────
function detectMarketRegime(klines) {
  if (!klines || klines.length < 50) return 'unknown';
  const last = klines.slice(-50);
  const closes = last.map(k => k.close);
  const highs = last.map(k => k.high);
  const lows = last.map(k => k.low);
  const vols = last.map(k => k.volume);

  // ATR for volatility measure
  const atrs = last.slice(1).map((k, i) =>
    Math.max(k.high - k.low, Math.abs(k.high - last[i].close), Math.abs(k.low - last[i].close)));
  const avgATR = atrs.reduce((a, b) => a + b, 0) / atrs.length;
  const atrPct = avgATR / closes[closes.length - 1] * 100;

  // Trend: EMA slope
  const calcEMA = (data, p) => { const k = 2 / (p + 1); let e = data[0]; return data.map(v => { e = v * k + e * (1 - k); return e; }); };
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const slope20 = (ema20[ema20.length - 1] - ema20[ema20.length - 10]) / ema20[ema20.length - 10] * 100;

  // Range: price in tight band
  const priceRange = (Math.max(...closes) - Math.min(...closes)) / closes[closes.length - 1] * 100;

  // Volume trend
  const avgVolRecent = vols.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const avgVolOld = vols.slice(-30, -10).reduce((a, b) => a + b, 0) / 20;
  const volRatio = avgVolRecent / avgVolOld;

  let regime = 'unknown';
  let confidence = 0;

  if (atrPct > 1.8) {
    regime = 'volatile';
    confidence = Math.min(100, Math.round(atrPct * 25));
  } else if (Math.abs(slope20) > 0.3 && ema20[ema20.length - 1] > ema50[ema50.length - 1] * (slope20 > 0 ? 1 : 0.9999)) {
    regime = 'trend';
    confidence = Math.min(100, Math.round(Math.abs(slope20) * 80 + 40));
  } else if (priceRange < 2.5) {
    regime = 'range';
    confidence = Math.min(100, Math.round((2.5 - priceRange) * 30 + 40));
  } else {
    regime = 'range';
    confidence = 45;
  }

  BRAIN.regime = regime;
  BRAIN.regimeConfidence = confidence;
  BRAIN.regimeSlope = slope20;
  BRAIN.regimeAtrPct = atrPct;
  // [PATCH 6] Keep BM.regime in sync for state.js/deepdive consumers
  BM.regime = regime;
  return regime;
}

// ─── Order Flow Update ───────────────────────────────────────
function updateOrderFlow() {
  // Use order book as proxy for OFI
  const bids = S.bids || [];
  const asks = S.asks || [];
  if (!bids.length || !asks.length) return;

  const bidVol = bids.slice(0, 10).reduce((s, b) => s + b.q * b.p, 0);
  const askVol = asks.slice(0, 10).reduce((s, a) => s + a.q * a.p, 0);
  const total = bidVol + askVol || 1;

  BRAIN.ofi.buy = bidVol / total * 100;
  BRAIN.ofi.sell = askVol / total * 100;

  // Also track trade tape delta from liquidation events
  const now = Date.now();
  const recent = (S.events || []).filter(e => now - e.ts < 60000);
  const buyPressure = recent.filter(e => e.isLong).reduce((s, e) => s + e.usd, 0);
  const sellPressure = recent.filter(e => !e.isLong).reduce((s, e) => s + e.usd, 0);
  const tapeTot = buyPressure + sellPressure || 1;

  // Blend OB and tape
  const blendBuy = (BRAIN.ofi.buy * 0.6 + buyPressure / tapeTot * 100 * 0.4);
  const blendSell = 100 - blendBuy;

  // Update UI
  const buyEl = el('ofiBuy'), sellEl = el('ofiSell');
  const buyPctEl = el('ofiBuyPct'), sellPctEl = el('ofiSellPct');
  if (buyEl) buyEl.style.width = blendBuy.toFixed(0) + '%';
  if (sellEl) sellEl.style.width = blendSell.toFixed(0) + '%';
  if (buyPctEl) buyPctEl.textContent = 'BUY ' + blendBuy.toFixed(0) + '%';
  if (sellPctEl) sellPctEl.textContent = 'SELL ' + blendSell.toFixed(0) + '%';

  BRAIN.ofi.blendBuy = blendBuy;
  return blendBuy;
}

// ─── Adaptive Auto-Trade Params ──────────────────────────────
function adaptAutoTradeParams() {
  if (!AT.enabled) return;
  // FIX debounce — only adapt max once every 5 minutes
  const now = Date.now();
  if (BRAIN._lastAdaptTs && now - BRAIN._lastAdaptTs < 300000) return;
  BRAIN._lastAdaptTs = now;

  const recentTrades = (TP.journal || []).filter(t => t.reason?.includes('AUTO')).slice(0, 6);
  if (recentTrades.length < 3) return;

  const wins = recentTrades.filter(t => t.pnl > 0).length;
  const losses = recentTrades.length - wins;
  const wr = wins / recentTrades.length;

  const regime = BRAIN.regime;
  let newSL = parseFloat(el('atSL')?.value) || 1.5;
  let newSize = parseFloat(el('atSize')?.value) || 200;
  let adapted = false;
  let reason = '';

  // If losing streak — tighten SL, reduce size
  if (losses >= 3) {
    newSL = Math.max(0.8, newSL * 0.85);
    newSize = Math.max(50, newSize * 0.75);
    adapted = true;
    reason = `📉 3 pierderi consecutive → SL redus la ${newSL.toFixed(1)}%, Size redus la $${Math.round(newSize)}`;
  }
  // If winning streak — slightly increase size
  else if (wins >= 4 && wr >= 0.7) {
    newSize = Math.min(1000, newSize * 1.15);
    adapted = true;
    reason = `📈 Win streak ${wins}/${recentTrades.length} → Size crescut la $${Math.round(newSize)}`;
  }

  // Regime adjustment
  if (regime === 'volatile') {
    newSL = Math.max(newSL, 2.5); // wider SL in volatile market
    adapted = true;
    reason = (reason ? reason + ' | ' : '') + '⚡ Piata volatila → SL extins la ' + newSL.toFixed(1) + '%';
  } else if (regime === 'range') {
    newSL = Math.min(newSL, 1.0); // tighter SL in range
    adapted = true;
    reason = (reason ? reason + ' | ' : '') + '📊 Range → SL strans la ' + newSL.toFixed(1) + '%';
  }

  if (adapted) {
    const slEl = el('atSL'); if (slEl) slEl.value = newSL.toFixed(1);
    const sizeEl = el('atSize'); if (sizeEl) sizeEl.value = Math.round(newSize);
    BRAIN.adaptParams = { sl: newSL, size: newSize, adjustCount: (BRAIN.adaptParams.adjustCount || 0) + 1 };
    brainThink('trade', `🔧 ADAPTAT: ${reason}`);
    atLog('info', `🔧 Parametri adaptati: ${reason}`);
  }
}
