// Zeus v122 — brain/arianova.js
// ARIA pattern recognition + NOVA forecasting
'use strict';


// ════════════════════════════════════════════════════════════════
// ARIA — Advanced Recognition Intelligence Alerts v1.0
// NOVA — Verdict Logic Strip v1.0
// ════════════════════════════════════════════════════════════════
// Single-instance guard
if (!window._ARIA_NOVA_LOADED) {
  window._ARIA_NOVA_LOADED = true;

  // ── STATE ────────────────────────────────────────────────────────
  // [MOVED TO TOP] ARIA_STATE
  // [MOVED TO TOP] NOVA_STATE

  // ── PERSISTENCE ──────────────────────────────────────────────────
  // [MOVED TO TOP] _AN_KEY_A
  // [MOVED TO TOP] _AN_KEY_N

  function _anLoad() {
    try {
      const a = JSON.parse(localStorage.getItem(_AN_KEY_A) || '{}');
      ARIA_STATE.expanded = !!a.expanded;
      if (a.pattern) ARIA_STATE.pattern = a.pattern;
    } catch (_) { }
    try {
      const n = JSON.parse(localStorage.getItem(_AN_KEY_N) || '{}');
      NOVA_STATE.expanded = !!n.expanded;
      if (Array.isArray(n.log)) NOVA_STATE.log = n.log.slice(-8);
      NOVA_STATE.lastMsg = n.lastMsg || null;
    } catch (_) { }
  }

  function _anSave() {
    try {
      localStorage.setItem(_AN_KEY_A, JSON.stringify({
        expanded: ARIA_STATE.expanded,
        pattern: ARIA_STATE.pattern
          ? {
            name: ARIA_STATE.pattern.name, dir: ARIA_STATE.pattern.dir,
            conf: ARIA_STATE.pattern.conf, svgType: ARIA_STATE.pattern.svgType,
            tf: ARIA_STATE.pattern.tf, verdict: ARIA_STATE.pattern.verdict
          }
          : null
      }));
      localStorage.setItem(_AN_KEY_N, JSON.stringify({
        expanded: NOVA_STATE.expanded,
        log: NOVA_STATE.log.slice(-8).map(e => ({ ts: e.ts, severity: e.severity, msg: e.msg })),
        lastMsg: NOVA_STATE.lastMsg
      }));
    } catch (_) { }
    if (typeof _ucMarkDirty === 'function') _ucMarkDirty('ariaNovaHud');
    if (typeof _userCtxPush === 'function') _userCtxPush();
  }

  // ── TOGGLE ───────────────────────────────────────────────────────
  function ariaToggle() {
    ARIA_STATE.expanded = !ARIA_STATE.expanded;
    const s = document.getElementById('aria-strip');
    if (s) s.classList.toggle('aria-open', ARIA_STATE.expanded);
    _anSave();
  }
  function novaToggle() {
    NOVA_STATE.expanded = !NOVA_STATE.expanded;
    const s = document.getElementById('nova-strip');
    if (s) s.classList.toggle('nova-open', NOVA_STATE.expanded);
    _anSave();
  }

  // ── DSL STRIP TOGGLE ─────────────────────────────────────────────
  // [MOVED TO TOP] _dslStripOpen
  function dslStripToggle() {
    _dslStripOpen = !_dslStripOpen;
    const s = document.getElementById('dsl-strip');
    if (s) s.classList.toggle('dsl-strip-open', _dslStripOpen);
    try { localStorage.setItem('zeus_dsl_strip_open', _dslStripOpen ? '1' : '0'); } catch (_) { }
    if (typeof _ucMarkDirty === 'function') _ucMarkDirty('panels');
    if (typeof _userCtxPush === 'function') _userCtxPush();
  }
  function dslUpdateBanner() {
    const el_s = document.getElementById('dsl-bar-status');
    const el_c = document.getElementById('dsl-bar-count');
    if (!el_s) return;
    const mode = (typeof S !== 'undefined' ? S.mode || 'assist' : 'assist').toLowerCase();
    const dslOn = typeof DSL !== 'undefined' && DSL.enabled;
    const atOn = typeof AT !== 'undefined' && AT.enabled && !AT.killTriggered;
    const armed = typeof S !== 'undefined' && S.assistArmed;
    const nPos = (dslOn && typeof DSL !== 'undefined' && DSL.positions) ? Object.keys(DSL.positions).length : 0;

    el_s.className = '';
    if (!dslOn) {
      el_s.textContent = 'DSL OFFLINE';
      el_s.className = 'dsls-off';
    } else if (mode === 'auto' && atOn) {
      el_s.innerHTML = _ZI.robot + ' AUTO TRADE · DSL BRAIN ACTIV';
      el_s.className = 'dsls-auto';
    } else if (mode === 'auto') {
      el_s.innerHTML = _ZI.robot + ' AUTO MODE · AT OPRIT';
      el_s.className = 'dsls-auto';
    } else if (mode === 'assist' && armed) {
      el_s.innerHTML = _ZI.dYlw + ' ASSIST ARMAT · DSL EXECUTĂ';
      el_s.className = 'dsls-assist-armed';
    } else if (mode === 'assist') {
      el_s.innerHTML = _ZI.lock + ' ASSIST MANUAL · DEZARMAT';
      el_s.className = 'dsls-assist';
    } else {
      el_s.innerHTML = _ZI.hand + ' MANUAL · DSL MONITOR';
      el_s.className = 'dsls-manual';
    }
    if (el_c) el_c.textContent = nPos > 0 ? nPos + ' poz·' : '';
  }

  // ── AT STRIP TOGGLE ──────────────────────────────────────────────
  // [MOVED TO TOP] _atStripOpen
  function atStripToggle() {
    _atStripOpen = !_atStripOpen;
    const s = document.getElementById('at-strip');
    if (s) s.classList.toggle('at-strip-open', _atStripOpen);
    try { localStorage.setItem('zeus_at_strip_open', _atStripOpen ? '1' : '0'); } catch (_) { }
    if (typeof _ucMarkDirty === 'function') _ucMarkDirty('panels');
    if (typeof _userCtxPush === 'function') _userCtxPush();
  }
  function atUpdateBanner() {
    const el_state = document.getElementById('at-bar-state');
    const el_info = document.getElementById('at-bar-info');
    const el_pnl = document.getElementById('at-bar-pnl');
    const el_strip = document.getElementById('at-strip');
    if (!el_state) return;

    const atOn = typeof AT !== 'undefined' && (AT.enabled || window._serverATEnabled);
    const killed = typeof AT !== 'undefined' && AT.killTriggered;
    const mode = window._serverATEnabled ? (AT._serverMode || 'demo') : (typeof AT !== 'undefined' ? (AT.mode || 'demo') : 'demo');
    const brMode = (typeof S !== 'undefined' ? S.mode || 'assist' : 'assist').toLowerCase();

    // Calc live PnL for AUTO positions matching current mode
    const _atMode = mode;
    const _allATPosns = (typeof TP !== 'undefined')
      ? [].concat(TP.demoPositions || [], TP.livePositions || []).filter(p => p.autoTrade && !p.closed && (p.mode || p._serverMode || 'demo') === _atMode)
      : [];
    const autoPosns = _allATPosns;
    const nPos = autoPosns.length;
    let livePnl = 0;
    autoPosns.forEach(p => {
      const price = (p.sym === (typeof S !== 'undefined' ? S.symbol : '') ? (S.price || p.entry) : p.entry);
      const diff = price - p.entry;
      livePnl += _safePnl(p.side, diff, p.entry, p.size || 0, p.lev || 1, true);
    });

    // Color theme on strip
    if (el_strip) {
      el_strip.classList.remove('ats-profit', 'ats-loss', 'ats-neutral');
      if (nPos === 0) el_strip.classList.add('ats-neutral');
      else if (livePnl > 0) el_strip.classList.add('ats-profit');
      else el_strip.classList.add('ats-loss');
    }

    // State badge
    el_state.className = '';
    if (killed) {
      el_state.innerHTML = _ZI.skull + ' KILL SWITCH';
      el_state.className = 'atbs-kill';
    } else if (atOn) {
      if (nPos === 0) el_state.className = 'atbs-on-neutral';
      else if (livePnl > 0) el_state.className = 'atbs-on-profit';
      else el_state.className = 'atbs-on-loss';
      var _arEnv = window._resolvedEnv || (mode === 'demo' ? 'DEMO' : 'LIVE');
      el_state.innerHTML = _ZI.dGrn + ' AT ON · ' + (_arEnv === 'TESTNET' ? 'TESTNET' : (mode === 'live' ? 'LIVE' : 'DEMO'));
    } else {
      var _arEnv2 = window._resolvedEnv || (mode === 'demo' ? 'DEMO' : 'LIVE');
      el_state.innerHTML = _ZI.dRed + ' AT OFF · ' + (_arEnv2 === 'TESTNET' ? 'TESTNET' : (mode === 'live' ? 'LIVE' : 'DEMO'));
      el_state.className = 'atbs-off';
    }

    // Info
    const modeTag = brMode === 'auto' ? 'AUTO' : brMode === 'assist' ? 'ASSIST' : 'MANUAL';
    const execLocked = mode === 'live' && !window._apiConfigured;
    el_info.innerHTML = modeTag + (execLocked ? ' · ' + _ZI.w + ' EXEC LOCKED' : '') + (nPos > 0 ? ' · ' + nPos + ' poz active' : ' · fără poziții');

    // PnL
    if (el_pnl) {
      if (nPos === 0 || Math.abs(livePnl) < 0.01) {
        el_pnl.textContent = ''; el_pnl.className = 'atp-zero';
      } else if (livePnl > 0) {
        el_pnl.textContent = '+$' + livePnl.toFixed(2); el_pnl.className = 'atp-pos';
      } else {
        el_pnl.textContent = '-$' + Math.abs(livePnl).toFixed(2); el_pnl.className = 'atp-neg';
      }
    }
  }

  // ── PT STRIP TOGGLE ──────────────────────────────────────────────
  // [MOVED TO TOP] _ptStripOpen
  function ptStripToggle() {
    _ptStripOpen = !_ptStripOpen;
    const s = document.getElementById('pt-strip');
    if (s) s.classList.toggle('pt-strip-open', _ptStripOpen);
    try { localStorage.setItem('zeus_pt_strip_open', _ptStripOpen ? '1' : '0'); } catch (_) { }
  }
  function ptUpdateBanner() {
    const el_state = document.getElementById('pt-bar-state');
    const el_info = document.getElementById('pt-bar-info');
    const el_pnl = document.getElementById('pt-bar-pnl');
    const el_strip = document.getElementById('pt-strip');
    if (!el_state) return;

    // All positions matching current globalMode
    var globalMode = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo';
    var allDemo = (typeof TP !== 'undefined' && Array.isArray(TP.demoPositions))
      ? TP.demoPositions.filter(p => !p.closed) : [];
    var allLive = (typeof TP !== 'undefined' && Array.isArray(TP.livePositions))
      ? TP.livePositions.filter(p => !p.closed) : [];
    const allPosns = globalMode === 'live' ? allLive : allDemo;
    const nPos = allPosns.length;
    const isLiveMode = globalMode === 'live';
    const demobal = (typeof TP !== 'undefined') ? (TP.demoBalance || 10000) : 10000;
    const liveBal = (typeof TP !== 'undefined') ? (TP.liveBalance || 0) : 0;
    const bal = isLiveMode ? liveBal : demobal;
    const startBal = isLiveMode ? liveBal : ((typeof TP !== 'undefined' && TP._serverStartBalance) ? TP._serverStartBalance : 10000);
    const balPnl = isLiveMode ? 0 : (demobal - startBal);
    const balPct = (startBal > 0 ? (balPnl / startBal * 100) : 0).toFixed(2);

    // Live unrealized PnL across all open positions
    let livePnl = 0;
    allPosns.forEach(p => {
      const price = (p.sym === (typeof S !== 'undefined' ? S.symbol : '') ? (S.price || p.entry) : p.entry);
      const diff = price - p.entry;
      livePnl += _safePnl(p.side, diff, p.entry, p.size || 0, p.lev || 1, true);
    });

    // Color theme
    if (el_strip) {
      el_strip.classList.remove('pts-profit', 'pts-loss', 'pts-neutral');
      if (nPos === 0) el_strip.classList.add('pts-neutral');
      else if (livePnl > 0) el_strip.classList.add('pts-profit');
      else el_strip.classList.add('pts-loss');
    }

    // State badge — reflects global mode
    var globalMode = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo';
    var _ptEnv = window._resolvedEnv || (globalMode === 'demo' ? 'DEMO' : 'REAL');
    var modeLabel = globalMode === 'demo' ? 'DEMO MODE' : (_ptEnv === 'TESTNET' ? 'TESTNET MODE' : 'LIVE MODE');
    el_state.className = '';
    if (nPos === 0) {
      el_state.innerHTML = _ZI.fold + ' ' + modeLabel; el_state.className = 'ptbs-empty';
    } else if (livePnl > 0) {
      el_state.innerHTML = _ZI.tup + ' ' + modeLabel + ' PROFIT'; el_state.className = 'ptbs-profit';
    } else if (livePnl < 0) {
      el_state.innerHTML = _ZI.drop + ' ' + modeLabel + ' LOSS'; el_state.className = 'ptbs-loss';
    } else {
      el_state.innerHTML = _ZI.fold + ' ' + modeLabel; el_state.className = 'ptbs-neutral';
    }

    // Info: balance + positions
    if (isLiveMode && bal <= 0 && !window._apiConfigured) {
      el_info.textContent = 'Balance unavailable · Exchange not configured' + (nPos > 0 ? ' · ' + nPos + ' poz active' : '');
    } else if (isLiveMode) {
      el_info.textContent = 'BAL $' + bal.toFixed(0) + (nPos > 0 ? ' · ' + nPos + ' poz active' : ' · fără poziții');
    } else {
      const balStr = balPnl >= 0 ? '+$' + balPnl.toFixed(2) : '-$' + Math.abs(balPnl).toFixed(2);
      el_info.textContent = 'BAL $' + bal.toFixed(0) + ' (' + balStr + ') · ' + (nPos > 0 ? nPos + ' poz active' : 'fără poziții');
    }

    // Live PnL unrealized
    if (el_pnl) {
      if (nPos === 0 || Math.abs(livePnl) < 0.01) {
        el_pnl.textContent = ''; el_pnl.className = 'ptp-zero';
      } else if (livePnl > 0) {
        el_pnl.textContent = '+$' + livePnl.toFixed(2); el_pnl.className = 'ptp-pos';
      } else {
        el_pnl.textContent = '-$' + Math.abs(livePnl).toFixed(2); el_pnl.className = 'ptp-neg';
      }
    }
  }

  function novaLog(severity, msg) {
    // Per-severity cooldown: danger=30s, warn=15s, info/ok=8s (Fix 4)
    const now = Date.now();
    const cd = NOVA_STATE._cooldowns[severity] || 8000;
    const lastTs = NOVA_STATE._lastBySeverity[severity] || 0;
    if (now - lastTs < cd) return;
    // Also skip exact same message regardless of severity within 5s
    const last = NOVA_STATE.log[0];
    if (last && last.msg === msg && (now - last._ms) < 5000) return;

    NOVA_STATE._lastBySeverity[severity] = now;

    const tz = (typeof S !== 'undefined' && S.tz) || 'Europe/Bucharest';
    const ts = new Date().toLocaleTimeString('ro-RO',
      { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' });

    NOVA_STATE.log.unshift({ ts, severity, msg, _ms: now });
    if (NOVA_STATE.log.length > 8) NOVA_STATE.log.pop();
    NOVA_STATE.lastMsg = { severity, msg };

    // Feed to atLog only for danger/warn (anti-spam)
    if ((severity === 'danger' || severity === 'warn') && typeof atLog === 'function') {
      atLog('warn', '[NOVA] ' + msg);
    }
    _novaRenderBar();
    _novaRenderLog();
  }

  // ── SVG PATTERNS ─────────────────────────────────────────────────
  const _ARIA_SVG = {
    doji: '<line x1="40" y1="2" x2="40" y2="46" stroke="#00ffcc88" stroke-width="1.5"/>'
      + '<rect x="29" y="20" width="22" height="8" fill="none" stroke="#00ffcc" stroke-width="1.5"/>',
    hammer: '<rect x="32" y="8" width="16" height="20" fill="#00d97a22" stroke="#00d97a" stroke-width="1.5"/>'
      + '<line x1="40" y1="28" x2="40" y2="46" stroke="#00d97a" stroke-width="1.5"/>',
    invhammer: '<rect x="32" y="20" width="16" height="20" fill="#f0c04022" stroke="#f0c040" stroke-width="1.5"/>'
      + '<line x1="40" y1="20" x2="40" y2="2" stroke="#f0c040" stroke-width="1.5"/>',
    pinbarbull: '<line x1="40" y1="2" x2="40" y2="46" stroke="#00ffcc88" stroke-width="1"/>'
      + '<rect x="32" y="28" width="16" height="10" fill="#00d97a22" stroke="#00d97a" stroke-width="1.5"/>',
    pinbarbear: '<line x1="40" y1="2" x2="40" y2="46" stroke="#00ffcc88" stroke-width="1"/>'
      + '<rect x="32" y="10" width="16" height="10" fill="#ff335522" stroke="#ff3355" stroke-width="1.5"/>',
    engulfbull: '<rect x="24" y="14" width="14" height="22" fill="#ff335511" stroke="#ff335577" stroke-width="1.2"/>'
      + '<rect x="42" y="8"  width="16" height="32" fill="#00d97a22" stroke="#00d97a" stroke-width="1.5"/>',
    engulfbear: '<rect x="24" y="14" width="14" height="22" fill="#00d97a11" stroke="#00d97a77" stroke-width="1.2"/>'
      + '<rect x="42" y="8"  width="16" height="32" fill="#ff335522" stroke="#ff3355" stroke-width="1.5"/>',
    morningstar: '<rect x="2"  y="6" width="16" height="24" fill="#ff335511" stroke="#ff355577" stroke-width="1.1"/>'
      + '<rect x="28" y="20" width="12" height="8"  fill="none"       stroke="#f0c040"    stroke-width="1.2"/>'
      + '<rect x="52" y="10" width="16" height="24" fill="#00d97a22" stroke="#00d97a"    stroke-width="1.5"/>',
    eveningstar: '<rect x="2"  y="10" width="16" height="24" fill="#00d97a11" stroke="#00d97a77" stroke-width="1.1"/>'
      + '<rect x="28" y="20" width="12" height="8"  fill="none"       stroke="#f0c040"    stroke-width="1.2"/>'
      + '<rect x="52" y="6"  width="16" height="24" fill="#ff335522" stroke="#ff3355"    stroke-width="1.5"/>',
    doubletop: '<polyline points="2,46 18,8 32,28 50,8 66,28 78,28" fill="none" stroke="#ff3355" stroke-width="1.5"/>'
      + '<line x1="2" y1="28" x2="78" y2="28" stroke="#ff335533" stroke-width="1" stroke-dasharray="3 3"/>',
    doublebottom: '<polyline points="2,4 18,42 32,22 50,42 66,22 78,22" fill="none" stroke="#00d97a" stroke-width="1.5"/>'
      + '<line x1="2" y1="22" x2="78" y2="22" stroke="#00d97a33" stroke-width="1" stroke-dasharray="3 3"/>',
    hs: '<polyline points="4,44 14,24 24,38 38,4 52,38 62,24 76,44" fill="none" stroke="#ff3355" stroke-width="1.5"/>'
      + '<line x1="4" y1="38" x2="76" y2="38" stroke="#ff335533" stroke-width="1" stroke-dasharray="3 3"/>',
    ihs: '<polyline points="4,4 14,26 24,10 38,44 52,10 62,26 76,4" fill="none" stroke="#00d97a" stroke-width="1.5"/>'
      + '<line x1="4" y1="10" x2="76" y2="10" stroke="#00d97a33" stroke-width="1" stroke-dasharray="3 3"/>',
    tri_asc: '<line x1="4" y1="10" x2="72" y2="28" stroke="#ff3355" stroke-width="1.5"/>'
      + '<line x1="4" y1="44" x2="72" y2="44" stroke="#00d97a" stroke-width="1.5"/>'
      + '<line x1="72" y1="28" x2="72" y2="44" stroke="#00ffcc44" stroke-width="1" stroke-dasharray="2 2"/>',
    tri_desc: '<line x1="4" y1="6"  x2="72" y2="6"  stroke="#ff3355" stroke-width="1.5"/>'
      + '<line x1="4" y1="44" x2="72" y2="26" stroke="#00d97a" stroke-width="1.5"/>'
      + '<line x1="72" y1="6" x2="72" y2="26" stroke="#00ffcc44" stroke-width="1" stroke-dasharray="2 2"/>',
    tri_sym: '<line x1="4" y1="4"  x2="68" y2="24" stroke="#ff3355" stroke-width="1.5"/>'
      + '<line x1="4" y1="44" x2="68" y2="24" stroke="#00d97a" stroke-width="1.5"/>',
    wedge_rise: '<line x1="4" y1="38" x2="72" y2="16" stroke="#ff3355" stroke-width="1.5"/>'
      + '<line x1="4" y1="46" x2="72" y2="26" stroke="#f0c040" stroke-width="1.5"/>',
    wedge_fall: '<line x1="4" y1="14" x2="72" y2="36" stroke="#00d97a" stroke-width="1.5"/>'
      + '<line x1="4" y1="4"  x2="72" y2="24" stroke="#f0c040" stroke-width="1.5"/>',
    // ── Batch 1: Candle Power patterns ──
    shootingstar: '<rect x="32" y="28" width="16" height="12" fill="#ff335522" stroke="#ff3355" stroke-width="1.5"/>'
      + '<line x1="40" y1="28" x2="40" y2="4" stroke="#ff3355" stroke-width="1.5"/>',
    hangingman: '<rect x="32" y="8" width="16" height="14" fill="#ff335522" stroke="#ff3355" stroke-width="1.5"/>'
      + '<line x1="40" y1="22" x2="40" y2="46" stroke="#ff3355" stroke-width="1.5"/>',
    soldiers: '<rect x="6" y="28" width="14" height="16" fill="#00d97a22" stroke="#00d97a" stroke-width="1.3"/>'
      + '<rect x="24" y="20" width="14" height="16" fill="#00d97a33" stroke="#00d97a" stroke-width="1.3"/>'
      + '<rect x="42" y="10" width="14" height="18" fill="#00d97a44" stroke="#00d97a" stroke-width="1.5"/>',
    crows: '<rect x="6" y="6" width="14" height="16" fill="#ff335522" stroke="#ff3355" stroke-width="1.3"/>'
      + '<rect x="24" y="14" width="14" height="16" fill="#ff335533" stroke="#ff3355" stroke-width="1.3"/>'
      + '<rect x="42" y="24" width="14" height="18" fill="#ff335544" stroke="#ff3355" stroke-width="1.5"/>',
    tweezertop: '<rect x="18" y="8" width="14" height="20" fill="#00d97a22" stroke="#00d97a" stroke-width="1.3"/>'
      + '<rect x="40" y="8" width="14" height="20" fill="#ff335522" stroke="#ff3355" stroke-width="1.3"/>'
      + '<line x1="14" y1="8" x2="58" y2="8" stroke="#f0c040" stroke-width="1" stroke-dasharray="2 2"/>',
    tweezerbottom: '<rect x="18" y="20" width="14" height="20" fill="#ff335522" stroke="#ff3355" stroke-width="1.3"/>'
      + '<rect x="40" y="20" width="14" height="20" fill="#00d97a22" stroke="#00d97a" stroke-width="1.3"/>'
      + '<line x1="14" y1="40" x2="58" y2="40" stroke="#f0c040" stroke-width="1" stroke-dasharray="2 2"/>',
    darkcloud: '<rect x="16" y="14" width="16" height="26" fill="#00d97a22" stroke="#00d97a" stroke-width="1.3"/>'
      + '<rect x="38" y="8" width="16" height="22" fill="#ff335533" stroke="#ff3355" stroke-width="1.5"/>'
      + '<line x1="38" y1="25" x2="54" y2="25" stroke="#f0c04066" stroke-width="1" stroke-dasharray="2 2"/>',
    piercing: '<rect x="16" y="8" width="16" height="26" fill="#ff335522" stroke="#ff3355" stroke-width="1.3"/>'
      + '<rect x="38" y="18" width="16" height="22" fill="#00d97a33" stroke="#00d97a" stroke-width="1.5"/>'
      + '<line x1="38" y1="21" x2="54" y2="21" stroke="#f0c04066" stroke-width="1" stroke-dasharray="2 2"/>',
    // ── Batch 2: Smart Money patterns ──
    fvg_bull: '<rect x="10" y="10" width="14" height="14" fill="#00d97a22" stroke="#00d97a" stroke-width="1.3"/>'
      + '<rect x="30" y="4" width="14" height="8" fill="#00d97a11" stroke="#00d97a44" stroke-width="1"/>'
      + '<rect x="30" y="32" width="14" height="14" fill="#00d97a33" stroke="#00d97a" stroke-width="1.3"/>'
      + '<rect x="50" y="6" width="14" height="14" fill="#00d97a22" stroke="#00d97a" stroke-width="1.3"/>'
      + '<line x1="30" y1="12" x2="44" y2="12" stroke="#00ffcc" stroke-width="1" stroke-dasharray="2 2"/>'
      + '<line x1="30" y1="32" x2="44" y2="32" stroke="#00ffcc" stroke-width="1" stroke-dasharray="2 2"/>',
    fvg_bear: '<rect x="10" y="24" width="14" height="14" fill="#ff335522" stroke="#ff3355" stroke-width="1.3"/>'
      + '<rect x="30" y="36" width="14" height="8" fill="#ff335511" stroke="#ff335544" stroke-width="1"/>'
      + '<rect x="30" y="4" width="14" height="14" fill="#ff335533" stroke="#ff3355" stroke-width="1.3"/>'
      + '<rect x="50" y="22" width="14" height="14" fill="#ff335522" stroke="#ff3355" stroke-width="1.3"/>'
      + '<line x1="30" y1="18" x2="44" y2="18" stroke="#ff3355" stroke-width="1" stroke-dasharray="2 2"/>'
      + '<line x1="30" y1="36" x2="44" y2="36" stroke="#ff3355" stroke-width="1" stroke-dasharray="2 2"/>',
    ob_bull: '<rect x="10" y="26" width="18" height="18" fill="#00d97a22" stroke="#00d97a" stroke-width="1.5"/>'
      + '<polyline points="32,44 42,28 52,18 68,8" fill="none" stroke="#00d97a" stroke-width="1.5"/>'
      + '<line x1="10" y1="26" x2="68" y2="26" stroke="#00ffcc44" stroke-width="1" stroke-dasharray="2 2"/>',
    ob_bear: '<rect x="10" y="6" width="18" height="18" fill="#ff335522" stroke="#ff3355" stroke-width="1.5"/>'
      + '<polyline points="32,6 42,22 52,32 68,42" fill="none" stroke="#ff3355" stroke-width="1.5"/>'
      + '<line x1="10" y1="24" x2="68" y2="24" stroke="#ff335544" stroke-width="1" stroke-dasharray="2 2"/>',
    liq_sweep: '<polyline points="4,24 20,12 36,18 52,6 68,16" fill="none" stroke="#f0c040" stroke-width="1.3"/>'
      + '<line x1="4" y1="8" x2="68" y2="8" stroke="#ff335566" stroke-width="1" stroke-dasharray="3 3"/>'
      + '<circle cx="52" cy="6" r="4" fill="none" stroke="#ff3355" stroke-width="1.5"/>'
      + '<polyline points="52,6 58,14 68,20" fill="none" stroke="#ff3355" stroke-width="1.5"/>',
    bos_bull: '<polyline points="4,40 18,28 30,34 44,18 60,12 76,8" fill="none" stroke="#00d97a" stroke-width="1.5"/>'
      + '<line x1="4" y1="28" x2="76" y2="28" stroke="#00ffcc44" stroke-width="1" stroke-dasharray="3 3"/>'
      + '<text x="66" y="28" fill="#00d97a" font-size="8" font-family="monospace">BOS</text>',
    bos_bear: '<polyline points="4,8 18,20 30,14 44,30 60,36 76,40" fill="none" stroke="#ff3355" stroke-width="1.5"/>'
      + '<line x1="4" y1="20" x2="76" y2="20" stroke="#ff335544" stroke-width="1" stroke-dasharray="3 3"/>'
      + '<text x="66" y="20" fill="#ff3355" font-size="8" font-family="monospace">BOS</text>',
    choch_bull: '<polyline points="4,8 16,22 28,12 42,30 56,20 68,38" fill="none" stroke="#ff3355" stroke-width="1.2"/>'
      + '<polyline points="56,20 68,10" fill="none" stroke="#00d97a" stroke-width="2"/>'
      + '<line x1="4" y1="22" x2="68" y2="22" stroke="#f0c04044" stroke-width="1" stroke-dasharray="2 2"/>',
    choch_bear: '<polyline points="4,40 16,26 28,36 42,18 56,28 68,10" fill="none" stroke="#00d97a" stroke-width="1.2"/>'
      + '<polyline points="56,28 68,38" fill="none" stroke="#ff3355" stroke-width="2"/>'
      + '<line x1="4" y1="26" x2="68" y2="26" stroke="#f0c04044" stroke-width="1" stroke-dasharray="2 2"/>',
    // ── Batch 3: Chart Power patterns ──
    tripletop: '<polyline points="2,44 12,10 22,30 34,8 46,30 58,10 72,44" fill="none" stroke="#ff3355" stroke-width="1.5"/>'
      + '<line x1="2" y1="10" x2="72" y2="10" stroke="#ff335544" stroke-width="1" stroke-dasharray="3 3"/>',
    triplebottom: '<polyline points="2,6 12,40 22,18 34,42 46,18 58,40 72,6" fill="none" stroke="#00d97a" stroke-width="1.5"/>'
      + '<line x1="2" y1="40" x2="72" y2="40" stroke="#00d97a44" stroke-width="1" stroke-dasharray="3 3"/>',
    chan_up: '<line x1="4" y1="32" x2="72" y2="6" stroke="#00d97a" stroke-width="1.5"/>'
      + '<line x1="4" y1="46" x2="72" y2="20" stroke="#00d97a" stroke-width="1.5"/>'
      + '<polyline points="8,44 20,28 32,38 46,18 58,28 68,10" fill="none" stroke="#00ffcc66" stroke-width="1"/>',
    chan_down: '<line x1="4" y1="6" x2="72" y2="32" stroke="#ff3355" stroke-width="1.5"/>'
      + '<line x1="4" y1="20" x2="72" y2="46" stroke="#ff3355" stroke-width="1.5"/>'
      + '<polyline points="8,8 20,22 32,14 46,30 58,24 68,38" fill="none" stroke="#ff335566" stroke-width="1"/>',
    // ── Batch 4: Momentum Intel patterns ──
    ema_cross_bull: '<polyline points="4,38 20,34 36,30 52,22 68,12" fill="none" stroke="#00d97a" stroke-width="1.5"/>'
      + '<polyline points="4,32 20,32 36,32 52,30 68,26" fill="none" stroke="#f0c040" stroke-width="1.2"/>'
      + '<circle cx="42" cy="30" r="4" fill="none" stroke="#00ffcc" stroke-width="1.5"/>',
    ema_cross_bear: '<polyline points="4,12 20,16 36,22 52,30 68,40" fill="none" stroke="#ff3355" stroke-width="1.5"/>'
      + '<polyline points="4,18 20,18 36,20 52,22 68,24" fill="none" stroke="#f0c040" stroke-width="1.2"/>'
      + '<circle cx="42" cy="20" r="4" fill="none" stroke="#ff3355" stroke-width="1.5"/>',
    rsi_div_bull: '<polyline points="4,10 24,34 52,28 72,40" fill="none" stroke="#ff335588" stroke-width="1.2"/>'
      + '<polyline points="4,40 24,34 52,22 72,16" fill="none" stroke="#00d97a" stroke-width="1.5"/>'
      + '<text x="38" y="46" fill="#00d97a" font-size="7" font-family="monospace">RSI↑</text>',
    rsi_div_bear: '<polyline points="4,40 24,16 52,22 72,10" fill="none" stroke="#00d97a88" stroke-width="1.2"/>'
      + '<polyline points="4,10 24,16 52,28 72,34" fill="none" stroke="#ff3355" stroke-width="1.5"/>'
      + '<text x="38" y="46" fill="#ff3355" font-size="7" font-family="monospace">RSI↓</text>',
    breakout: '<rect x="4" y="18" width="40" height="24" fill="none" stroke="#f0c04066" stroke-width="1" stroke-dasharray="3 3"/>'
      + '<polyline points="44,22 56,10 68,4" fill="none" stroke="#00d97a" stroke-width="2"/>'
      + '<line x1="4" y1="18" x2="68" y2="18" stroke="#00ffcc44" stroke-width="1"/>',
    breakdown: '<rect x="4" y="8" width="40" height="24" fill="none" stroke="#f0c04066" stroke-width="1" stroke-dasharray="3 3"/>'
      + '<polyline points="44,28 56,38 68,44" fill="none" stroke="#ff3355" stroke-width="2"/>'
      + '<line x1="4" y1="32" x2="68" y2="32" stroke="#ff335544" stroke-width="1"/>',
    vol_climax: '<rect x="8" y="30" width="8" height="14" fill="#f0c04044" stroke="#f0c040" stroke-width="1"/>'
      + '<rect x="20" y="26" width="8" height="18" fill="#f0c04055" stroke="#f0c040" stroke-width="1"/>'
      + '<rect x="32" y="20" width="8" height="24" fill="#f0c04066" stroke="#f0c040" stroke-width="1"/>'
      + '<rect x="44" y="6" width="8" height="38" fill="#f0c04099" stroke="#f0c040" stroke-width="1.5"/>'
      + '<rect x="56" y="28" width="8" height="16" fill="#f0c04044" stroke="#f0c040" stroke-width="1"/>',
    none: '<text x="40" y="28" text-anchor="middle" fill="#00ffcc22" font-size="12" font-family="monospace">—</text>',
  };

  // ── HELPERS ───────────────────────────────────────────────────────
  function _linSlope(arr) {
    const n = arr.length; if (n < 2) return 0;
    const mx = (n - 1) / 2;
    const my = arr.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (i - mx) * (arr[i] - my); den += (i - mx) * (i - mx); }
    return den === 0 ? 0 : num / den / (my || 1);
  }

  function _peaks(arr, w) {
    const out = [];
    for (let i = w; i < arr.length - w; i++) {
      let ok = true;
      for (let j = i - w; j <= i + w; j++) { if (j !== i && arr[j] >= arr[i]) { ok = false; break; } }
      if (ok) out.push({ i, v: arr[i] });
    }
    return out;
  }
  function _valleys(arr, w) {
    const out = [];
    for (let i = w; i < arr.length - w; i++) {
      let ok = true;
      for (let j = i - w; j <= i + w; j++) { if (j !== i && arr[j] <= arr[i]) { ok = false; break; } }
      if (ok) out.push({ i, v: arr[i] });
    }
    return out;
  }

  // ── CANDLE PATTERN DETECTION ─────────────────────────────────────
  function _detectCandle(kl) {
    if (!kl || kl.length < 3) return null;
    const c = kl[kl.length - 1], p = kl[kl.length - 2], p2 = kl[kl.length - 3];
    const body = Math.abs(c.close - c.open);
    const rng = c.high - c.low; if (!rng) return null;
    const upW = c.high - Math.max(c.open, c.close);
    const dnW = Math.min(c.open, c.close) - c.low;
    const br = body / rng;

    if (br < 0.08) return { name: 'Doji', dir: 'watch', svgType: 'doji', score: 22 };
    if (dnW > body * 2.2 && upW < body * .35 && br > .08)
      return { name: 'Hammer', dir: 'bull', svgType: 'hammer', score: 35 };
    if (upW > body * 2.2 && dnW < body * .35 && br > .08)
      return { name: 'Inv. Hammer', dir: 'watch', svgType: 'invhammer', score: 24 };
    if (dnW > rng * .62 && body < rng * .28)
      return { name: 'Pin Bar (Bull)', dir: 'bull', svgType: 'pinbarbull', score: 36 };
    if (upW > rng * .62 && body < rng * .28)
      return { name: 'Pin Bar (Bear)', dir: 'bear', svgType: 'pinbarbear', score: 36 };

    const pb = Math.abs(p.close - p.open); const cb = body;
    if (p.close > p.open && c.close < c.open && c.open >= p.close && c.close <= p.open && cb > pb * .88)
      return { name: 'Bearish Engulfing', dir: 'bear', svgType: 'engulfbear', score: 42 };
    if (p.close < p.open && c.close > c.open && c.open <= p.close && c.close >= p.open && cb > pb * .88)
      return { name: 'Bullish Engulfing', dir: 'bull', svgType: 'engulfbull', score: 42 };

    const p2b = Math.abs(p2.close - p2.open);
    const starBig = pb < p2b * .55;
    if (p2.close < p2.open && starBig && c.close > c.open && c.close > (p2.open + p2.close) / 2)
      return { name: 'Morning Star', dir: 'bull', svgType: 'morningstar', score: 46 };
    if (p2.close > p2.open && starBig && c.close < c.open && c.close < (p2.open + p2.close) / 2)
      return { name: 'Evening Star', dir: 'bear', svgType: 'eveningstar', score: 46 };

    // ── Batch 1: Candle Power (8 new patterns) ──

    // Shooting Star — long upper wick after uptrend (bearish reversal)
    if (upW > body * 2.2 && dnW < body * .35 && br > .08 && c.close < c.open
      && p.close > p.open && p.close > p2.close)
      return { name: 'Shooting Star', dir: 'bear', svgType: 'shootingstar', score: 38 };

    // Hanging Man — long lower wick at top of uptrend (bearish warning)
    if (dnW > body * 2.2 && upW < body * .35 && br > .08
      && p.close > p.open && p.close > p2.close)
      return { name: 'Hanging Man', dir: 'bear', svgType: 'hangingman', score: 34 };

    // Three White Soldiers — 3 consecutive bullish candles, each closing higher
    if (kl.length >= 4) {
      const p3 = kl[kl.length - 4];
      const allBull = c.close > c.open && p.close > p.open && p2.close > p2.open;
      const rising = c.close > p.close && p.close > p2.close && p2.close > p3.close;
      const noLongWicks = upW < body * 0.5 && (p.high - p.close) < Math.abs(p.close - p.open) * 0.5;
      if (allBull && rising && noLongWicks)
        return { name: '3 White Soldiers', dir: 'bull', svgType: 'soldiers', score: 48 };
    }

    // Three Black Crows — 3 consecutive bearish candles, each closing lower
    if (kl.length >= 4) {
      const p3 = kl[kl.length - 4];
      const allBear = c.close < c.open && p.close < p.open && p2.close < p2.open;
      const falling = c.close < p.close && p.close < p2.close && p2.close < p3.close;
      const noLongWicks = dnW < body * 0.5 && (p2.open - p2.high) < Math.abs(p2.close - p2.open) * 0.5;
      if (allBear && falling && noLongWicks)
        return { name: '3 Black Crows', dir: 'bear', svgType: 'crows', score: 48 };
    }

    // Tweezer Top — two candles with matching highs at top (bearish reversal)
    if (p.close > p.open && c.close < c.open) {
      const highDiff = Math.abs(c.high - p.high) / Math.max(c.high, p.high);
      if (highDiff < 0.002)
        return { name: 'Tweezer Top', dir: 'bear', svgType: 'tweezertop', score: 36 };
    }

    // Tweezer Bottom — two candles with matching lows at bottom (bullish reversal)
    if (p.close < p.open && c.close > c.open) {
      const lowDiff = Math.abs(c.low - p.low) / Math.min(c.low, p.low);
      if (lowDiff < 0.002)
        return { name: 'Tweezer Bottom', dir: 'bull', svgType: 'tweezerbottom', score: 36 };
    }

    // Dark Cloud Cover — bearish candle opens above prev close, closes >50% into prev body
    if (p.close > p.open && c.close < c.open && c.open > p.close
      && c.close < (p.open + p.close) / 2 && c.close > p.open)
      return { name: 'Dark Cloud Cover', dir: 'bear', svgType: 'darkcloud', score: 40 };

    // Piercing Line — bullish candle opens below prev close, closes >50% into prev body
    if (p.close < p.open && c.close > c.open && c.open < p.close
      && c.close > (p.open + p.close) / 2 && c.close < p.open)
      return { name: 'Piercing Line', dir: 'bull', svgType: 'piercing', score: 40 };

    return null;
  }

  // ── CHART PATTERN DETECTION ───────────────────────────────────────
  function _detectChart(kl) {
    if (!kl || kl.length < 22) return null;
    const r = kl.slice(-50);
    const hi = r.map(c => c.high), lo = r.map(c => c.low);

    const pk = _peaks(hi, 3), vl = _valleys(lo, 3);

    // Double Top
    if (pk.length >= 2) {
      const a = pk[pk.length - 2], b = pk[pk.length - 1];
      const diff = Math.abs(a.v - b.v) / Math.max(a.v, b.v);
      if (diff < .016 && b.i - a.i >= 5) {
        const mid = vl.filter(v => v.i > a.i && v.i < b.i);
        if (mid.length) return { name: 'Double Top', dir: 'bear', svgType: 'doubletop', score: 44 };
      }
    }
    // Double Bottom
    if (vl.length >= 2) {
      const a = vl[vl.length - 2], b = vl[vl.length - 1];
      const diff = Math.abs(a.v - b.v) / Math.min(a.v, b.v);
      if (diff < .016 && b.i - a.i >= 5) {
        const mid = pk.filter(p => p.i > a.i && p.i < b.i);
        if (mid.length) return { name: 'Double Bottom', dir: 'bull', svgType: 'doublebottom', score: 44 };
      }
    }
    // Head & Shoulders
    if (pk.length >= 3) {
      const s1 = pk[pk.length - 3], hd = pk[pk.length - 2], s2 = pk[pk.length - 1];
      if (hd.v > s1.v * 1.008 && hd.v > s2.v * 1.008 &&
        Math.abs(s1.v - s2.v) / Math.max(s1.v, s2.v) < .03)
        return { name: 'Head & Shoulders', dir: 'bear', svgType: 'hs', score: 50 };
    }
    // Inverted H&S
    if (vl.length >= 3) {
      const s1 = vl[vl.length - 3], hd = vl[vl.length - 2], s2 = vl[vl.length - 1];
      if (hd.v < s1.v * .992 && hd.v < s2.v * .992 &&
        Math.abs(s1.v - s2.v) / Math.min(s1.v, s2.v) < .03)
        return { name: 'Inv. H&S', dir: 'bull', svgType: 'ihs', score: 50 };
    }
    // Triangles & Wedges (need at least 20 bars)
    if (r.length >= 20) {
      const h20 = hi.slice(-20), l20 = lo.slice(-20);
      const hs = _linSlope(h20), ls = _linSlope(l20);
      if (hs < -.00008 && ls > .00008)
        return { name: 'Symm. Triangle', dir: 'watch', svgType: 'tri_sym', score: 32 };
      if (hs < -.00008 && Math.abs(ls) < Math.abs(hs) * .35)
        return { name: 'Asc. Triangle', dir: 'bull', svgType: 'tri_asc', score: 36 };
      if (ls > .00008 && Math.abs(hs) < Math.abs(ls) * .35)
        return { name: 'Desc. Triangle', dir: 'bear', svgType: 'tri_desc', score: 36 };
      if (hs > .00008 && ls > .00008 && ls > hs * 1.15)
        return { name: 'Rising Wedge', dir: 'bear', svgType: 'wedge_rise', score: 38 };
      if (hs < -.00008 && ls < -.00008 && hs < ls * 1.15)
        return { name: 'Falling Wedge', dir: 'bull', svgType: 'wedge_fall', score: 38 };
    }

    // ── Batch 3: Chart Power ──

    // Triple Top — 3 peaks at similar level with valleys between
    if (pk.length >= 3) {
      const a = pk[pk.length - 3], b = pk[pk.length - 2], c = pk[pk.length - 1];
      const avg = (a.v + b.v + c.v) / 3;
      const spread = Math.max(a.v, b.v, c.v) - Math.min(a.v, b.v, c.v);
      if (spread / avg < 0.02 && c.i - a.i >= 8) {
        const mids = vl.filter(v => v.i > a.i && v.i < c.i);
        if (mids.length >= 2)
          return { name: 'Triple Top', dir: 'bear', svgType: 'tripletop', score: 52 };
      }
    }

    // Triple Bottom — 3 valleys at similar level with peaks between
    if (vl.length >= 3) {
      const a = vl[vl.length - 3], b = vl[vl.length - 2], c = vl[vl.length - 1];
      const avg = (a.v + b.v + c.v) / 3;
      const spread = Math.max(a.v, b.v, c.v) - Math.min(a.v, b.v, c.v);
      if (spread / avg < 0.02 && c.i - a.i >= 8) {
        const mids = pk.filter(p => p.i > a.i && p.i < c.i);
        if (mids.length >= 2)
          return { name: 'Triple Bottom', dir: 'bull', svgType: 'triplebottom', score: 52 };
      }
    }

    // Ascending Channel — parallel upward trendlines (both slopes positive, similar magnitude)
    if (r.length >= 20) {
      const h20 = hi.slice(-20), l20 = lo.slice(-20);
      const hs2 = _linSlope(h20), ls2 = _linSlope(l20);
      if (hs2 > .00008 && ls2 > .00008 && Math.abs(hs2 - ls2) / Math.max(Math.abs(hs2), Math.abs(ls2)) < 0.5)
        return { name: 'Asc. Channel', dir: 'bull', svgType: 'chan_up', score: 40 };
      // Descending Channel — parallel downward trendlines
      if (hs2 < -.00008 && ls2 < -.00008 && Math.abs(hs2 - ls2) / Math.max(Math.abs(hs2), Math.abs(ls2)) < 0.5)
        return { name: 'Desc. Channel', dir: 'bear', svgType: 'chan_down', score: 40 };
    }

    return null;
  }

  // ── ADVANCED PATTERN DETECTION (higher lows, lower highs, flag, pennant) ──
  function _detectAdvanced(kl) {
    if (!kl || kl.length < 25) return null;
    const r = kl.slice(-40);
    const hi = r.map(c => c.high), lo = r.map(c => c.low);
    const pk = _peaks(hi, 3), vl = _valleys(lo, 3);

    // Higher Lows (bullish structure) — 3 consecutive rising valleys
    if (vl.length >= 3) {
      const a = vl[vl.length - 3], b = vl[vl.length - 2], c = vl[vl.length - 1];
      if (c.v > b.v * 1.002 && b.v > a.v * 1.002)
        return { name: 'Higher Lows', dir: 'bull', svgType: 'wedge_fall', score: 40 };
    }
    // Lower Highs (bearish structure) — 3 consecutive falling peaks
    if (pk.length >= 3) {
      const a = pk[pk.length - 3], b = pk[pk.length - 2], c = pk[pk.length - 1];
      if (c.v < b.v * 0.998 && b.v < a.v * 0.998)
        return { name: 'Lower Highs', dir: 'bear', svgType: 'wedge_rise', score: 40 };
    }
    // Bull Flag — sharp move up then tight consolidation (range < 40% of impulse)
    if (r.length >= 20) {
      const impulse = r.slice(-20, -8);
      const flag = r.slice(-8);
      const impH = Math.max(...impulse.map(c => c.high));
      const impL = Math.min(...impulse.map(c => c.low));
      const impRng = impH - impL;
      const flH = Math.max(...flag.map(c => c.high));
      const flL = Math.min(...flag.map(c => c.low));
      const flRng = flH - flL;
      if (impRng > 0 && impulse[impulse.length - 1].close > impulse[0].close * 1.008
        && flRng < impRng * 0.4 && flRng > 0) {
        return { name: 'Bull Flag', dir: 'bull', svgType: 'tri_asc', score: 42 };
      }
      // Bear Flag — sharp drop then tight consolidation
      if (impRng > 0 && impulse[impulse.length - 1].close < impulse[0].close * 0.992
        && flRng < impRng * 0.4 && flRng > 0) {
        return { name: 'Bear Flag', dir: 'bear', svgType: 'tri_desc', score: 42 };
      }
    }
    // Pennant — converging range from highs and lows in consolidation
    if (r.length >= 20) {
      const cons = r.slice(-12);
      const cHi = cons.map(c => c.high), cLo = cons.map(c => c.low);
      const hSlope = _linSlope(cHi), lSlope = _linSlope(cLo);
      // Pennant needs converging slopes (one negative, one positive)
      if (hSlope < -0.00005 && lSlope > 0.00005) {
        // Determine direction from prior impulse
        const pre = r.slice(-20, -12);
        const preDir = pre[pre.length - 1].close > pre[0].close ? 'bull' : 'bear';
        return { name: preDir === 'bull' ? 'Bull Pennant' : 'Bear Pennant', dir: preDir, svgType: 'tri_sym', score: 38 };
      }
    }

    // ── Batch 2: Smart Money Concepts ──

    // Fair Value Gap (FVG) — gap between candle 1 high and candle 3 low (or vice versa)
    if (r.length >= 6) {
      for (let i = r.length - 1; i >= 2; i--) {
        const c1 = r[i - 2], c2 = r[i - 1], c3 = r[i];
        const atr = (c2.high - c2.low) || 1;
        // Bullish FVG: gap up — candle3.low > candle1.high
        if (c3.low > c1.high && (c3.low - c1.high) > atr * 0.15
          && c3.close > c3.open && c1.close > c1.open)
          return { name: 'FVG (Bull)', dir: 'bull', svgType: 'fvg_bull', score: 42 };
        // Bearish FVG: gap down — candle3.high < candle1.low
        if (c3.high < c1.low && (c1.low - c3.high) > atr * 0.15
          && c3.close < c3.open && c1.close < c1.open)
          return { name: 'FVG (Bear)', dir: 'bear', svgType: 'fvg_bear', score: 42 };
        if (i <= r.length - 3) break; // only check last 3-bar window
      }
    }

    // Order Block — last opposing candle before a strong impulse move
    if (r.length >= 8) {
      const last5 = r.slice(-5);
      const impulse = last5[last5.length - 1];
      const preBlock = last5[0];
      const impBody = Math.abs(impulse.close - impulse.open);
      const avgBody = last5.slice(0, 4).reduce((s, x) => s + Math.abs(x.close - x.open), 0) / 4;
      // Bullish OB: last candle is strong bull, preBlock was bearish
      if (impulse.close > impulse.open && impBody > avgBody * 1.8
        && preBlock.close < preBlock.open)
        return { name: 'Order Block (Bull)', dir: 'bull', svgType: 'ob_bull', score: 44 };
      // Bearish OB: last candle is strong bear, preBlock was bullish
      if (impulse.close < impulse.open && impBody > avgBody * 1.8
        && preBlock.close > preBlock.open)
        return { name: 'Order Block (Bear)', dir: 'bear', svgType: 'ob_bear', score: 44 };
    }

    // Liquidity Sweep — price pierces above/below recent high/low then reverses sharply
    if (pk.length >= 2 && vl.length >= 2) {
      const lastC = r[r.length - 1], prevC = r[r.length - 2];
      const recentHigh = Math.max(...pk.slice(-3).map(p => p.v));
      const recentLow = Math.min(...vl.slice(-3).map(v => v.v));
      // Bearish sweep: wick above recent high then closes below it
      if (lastC.high > recentHigh && lastC.close < recentHigh && lastC.close < lastC.open)
        return { name: 'Liquidity Sweep', dir: 'bear', svgType: 'liq_sweep', score: 46 };
      // Bullish sweep: wick below recent low then closes above it
      if (lastC.low < recentLow && lastC.close > recentLow && lastC.close > lastC.open)
        return { name: 'Liquidity Sweep', dir: 'bull', svgType: 'liq_sweep', score: 46 };
    }

    // Break of Structure (BOS) — new higher high in uptrend or lower low in downtrend
    if (pk.length >= 3 && vl.length >= 3) {
      const pk1 = pk[pk.length - 3], pk2 = pk[pk.length - 2], pk3 = pk[pk.length - 1];
      const vl1 = vl[vl.length - 3], vl2 = vl[vl.length - 2], vl3 = vl[vl.length - 1];
      // Bullish BOS: higher highs + higher lows, latest breaks above
      if (pk3.v > pk2.v && pk2.v > pk1.v && vl3.v > vl2.v)
        return { name: 'BOS (Bull)', dir: 'bull', svgType: 'bos_bull', score: 44 };
      // Bearish BOS: lower lows + lower highs, latest breaks below
      if (vl3.v < vl2.v && vl2.v < vl1.v && pk3.v < pk2.v)
        return { name: 'BOS (Bear)', dir: 'bear', svgType: 'bos_bear', score: 44 };
    }

    // Change of Character (CHoCH) — trend reversal: uptrend makes lower low, or downtrend makes higher high
    if (pk.length >= 3 && vl.length >= 3) {
      const pk2 = pk[pk.length - 2], pk3 = pk[pk.length - 1];
      const vl1 = vl[vl.length - 3], vl2 = vl[vl.length - 2], vl3 = vl[vl.length - 1];
      const pk1 = pk[pk.length - 3];
      // Bearish CHoCH: was making higher highs, now lower high + lower low
      if (pk2.v > pk1.v && pk3.v < pk2.v * 0.998 && vl3.v < vl2.v * 0.998)
        return { name: 'CHoCH (Bear)', dir: 'bear', svgType: 'choch_bear', score: 48 };
      // Bullish CHoCH: was making lower lows, now higher low + higher high
      if (vl2.v < vl1.v && vl3.v > vl2.v * 1.002 && pk3.v > pk2.v * 1.002)
        return { name: 'CHoCH (Bull)', dir: 'bull', svgType: 'choch_bull', score: 48 };
    }

    return null;
  }

  // ── MOMENTUM INTEL DETECTION (Batch 4) ──────────────────────────
  function _detectMomentum(kl) {
    if (!kl || kl.length < 30) return null;
    const closes = kl.slice(-30).map(c => c.close);
    const vols = kl.slice(-30).map(c => c.volume || 0);

    // EMA helper (inline, period n over arr)
    function _ema(arr, n) {
      const k = 2 / (n + 1);
      const out = [arr[0]];
      for (let i = 1; i < arr.length; i++) out.push(arr[i] * k + out[i - 1] * (1 - k));
      return out;
    }

    // EMA 9 / EMA 21 Cross
    const ema9 = _ema(closes, 9);
    const ema21 = _ema(closes, 21);
    const len = ema9.length;
    const cur9 = ema9[len - 1], cur21 = ema21[len - 1];
    const prev9 = ema9[len - 2], prev21 = ema21[len - 2];
    // Bullish cross: EMA9 crosses above EMA21
    if (prev9 <= prev21 && cur9 > cur21)
      return { name: 'EMA Cross (Bull)', dir: 'bull', svgType: 'ema_cross_bull', score: 40 };
    // Bearish cross: EMA9 crosses below EMA21
    if (prev9 >= prev21 && cur9 < cur21)
      return { name: 'EMA Cross (Bear)', dir: 'bear', svgType: 'ema_cross_bear', score: 40 };

    // RSI (14-period) for divergence detection
    const rsiPeriod = 14;
    if (closes.length >= rsiPeriod + 6) {
      const gains = [], losses = [];
      for (let i = 1; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        gains.push(d > 0 ? d : 0);
        losses.push(d < 0 ? -d : 0);
      }
      // Smoothed RSI
      let avgG = gains.slice(0, rsiPeriod).reduce((a, b) => a + b, 0) / rsiPeriod;
      let avgL = losses.slice(0, rsiPeriod).reduce((a, b) => a + b, 0) / rsiPeriod;
      const rsiArr = [];
      for (let i = rsiPeriod; i < gains.length; i++) {
        avgG = (avgG * (rsiPeriod - 1) + gains[i]) / rsiPeriod;
        avgL = (avgL * (rsiPeriod - 1) + losses[i]) / rsiPeriod;
        rsiArr.push(avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL));
      }
      if (rsiArr.length >= 6) {
        const rLen = rsiArr.length;
        const priceLow1 = closes[closes.length - 6], priceLow2 = closes[closes.length - 1];
        const rsiLow1 = rsiArr[rLen - 6], rsiLow2 = rsiArr[rLen - 1];
        // Bullish RSI Divergence: price makes lower low but RSI makes higher low
        if (priceLow2 < priceLow1 * 0.998 && rsiLow2 > rsiLow1 + 3 && rsiLow2 < 45)
          return { name: 'RSI Divergence (Bull)', dir: 'bull', svgType: 'rsi_div_bull', score: 44 };
        // Bearish RSI Divergence: price makes higher high but RSI makes lower high
        if (priceLow2 > priceLow1 * 1.002 && rsiLow2 < rsiLow1 - 3 && rsiLow2 > 55)
          return { name: 'RSI Divergence (Bear)', dir: 'bear', svgType: 'rsi_div_bear', score: 44 };
      }
    }

    // Breakout / Breakdown — price exits range of last 20 bars
    if (closes.length >= 22) {
      const range = closes.slice(-22, -2);
      const rangeHigh = Math.max(...range);
      const rangeLow = Math.min(...range);
      const rangeSpan = rangeHigh - rangeLow;
      const current = closes[closes.length - 1];
      // Breakout: closes above range high with momentum
      if (current > rangeHigh && rangeSpan > 0 && (current - rangeHigh) > rangeSpan * 0.15)
        return { name: 'Breakout', dir: 'bull', svgType: 'breakout', score: 46 };
      // Breakdown: closes below range low with momentum
      if (current < rangeLow && rangeSpan > 0 && (rangeLow - current) > rangeSpan * 0.15)
        return { name: 'Breakdown', dir: 'bear', svgType: 'breakdown', score: 46 };
    }

    // Volume Climax — current volume > 2.5x average of last 20 bars
    if (vols.length >= 22) {
      const avgVol = vols.slice(-22, -2).reduce((a, b) => a + b, 0) / 20;
      const curVol = vols[vols.length - 1];
      if (avgVol > 0 && curVol > avgVol * 2.5) {
        const lastC = kl[kl.length - 1];
        const dir = lastC.close > lastC.open ? 'bull' : 'bear';
        return { name: 'Volume Climax', dir, svgType: 'vol_climax', score: 42 };
      }
    }

    return null;
  }

  // ── MTF STACK ────────────────────────────────────────────────────
  function _getMTF() {
    const tfs = ['5m', '15m', '30m', '1h', '4h', '1D'];
    const res = {};
    if (typeof BM !== 'undefined' && BM.mtf) {
      ['15m', '1h', '4h'].forEach(t => {
        const v = BM.mtf[t];
        res[t] = v === 'bull' ? 'bull' : v === 'bear' ? 'bear' : 'neut';
      });
    }
    if (typeof S !== 'undefined' && S.klines && S.klines.length >= 12) {
      const kl = S.klines;
      const last = kl[kl.length - 1], ref = kl[Math.max(0, kl.length - 10)];
      const t = last.close > ref.close * 1.001 ? 'bull' : last.close < ref.close * .999 ? 'bear' : 'neut';
      res['5m'] = t;
      if (!res['30m']) res['30m'] = t;
    }
    tfs.forEach(t => { if (!res[t]) res[t] = '—'; });
    return res;
  }

  // ── VOLUME TREND ─────────────────────────────────────────────────
  function _volTrend(kl) {
    if (!kl || kl.length < 8) return 'flat';
    const r = kl.slice(-4), o = kl.slice(-8, -4);
    if (!o.length) return 'flat';
    const rv = r.reduce((a, k) => a + (k.volume || 0), 0) / r.length;
    const ov = o.reduce((a, k) => a + (k.volume || 0), 0) / o.length;
    if (!ov) return 'flat';
    return rv > ov * 1.25 ? 'rising' : rv < ov * .78 ? 'falling' : 'flat';
  }

  // ── CONFIDENCE (Fix 2 v92) ────────────────────────────────────────
  // Base: patScore + candle bonus + vol bonus + trendCtx
  // [FIX BUG5] BM modifiers REMOVED here — applied only in _anUpdate() cfAdj block
  function _conf(patScore, candleName, vol, trendCtx) {
    let cs = 0;
    if (candleName && candleName !== '—' && candleName !== 'none') cs = 20;
    if (candleName && (candleName.includes('Engulfing') || candleName.includes('Star'))) cs = 30;
    const vs = vol === 'rising' ? 10 : vol === 'flat' ? 4 : 0;
    const base = patScore + cs + vs + (trendCtx || 5);
    return Math.min(100, Math.max(0, base));
  }

  // ── VERDICT ──────────────────────────────────────────────────────
  function _verdict(conf, dir) {
    const bullTxt = ['Breakout signal — confirm close', 'Momentum building', 'Buy pressure detected'];
    const bearTxt = ['Reversal signal — confirm close', 'Selling pressure', 'Distribution zone'];
    const watchTxt = ['Wait candle close', 'Low confidence — observe', 'Monitor next bar'];
    if (conf >= 75) {
      const t = dir === 'bull' ? bullTxt[0] : dir === 'bear' ? bearTxt[0] : watchTxt[0];
      return { label: 'CONFIRMED', cls: 'aria-vconf', txt: t };
    }
    if (conf >= 60) {
      const t = dir === 'bull' ? bullTxt[1] : dir === 'bear' ? bearTxt[1] : watchTxt[1];
      return { label: 'READY', cls: dir === 'bull' ? 'aria-vbull' : dir === 'bear' ? 'aria-vbear' : '', txt: t };
    }
    return { label: 'WATCH', cls: '', txt: watchTxt[2] };
  }

  // ── RENDER — BAR ─────────────────────────────────────────────────
  function _ariaRenderBar(pat) {
    const txt = document.getElementById('aria-bar-txt');
    const dot = document.getElementById('aria-dot');
    if (!txt || !dot) return;
    if (!pat) {
      txt.textContent = 'scanning\u2026'; txt.className = '';
      dot.className = 'aria-dot aria-scan'; return;
    }
    const cls = pat.dir === 'bull' ? 'aria-bar-bull' : pat.dir === 'bear' ? 'aria-bar-bear' : 'aria-bar-watch';
    const ic = pat.dir === 'bull' ? _ZI.dGrn : pat.dir === 'bear' ? _ZI.dRed : _ZI.dYlw;
    txt.innerHTML = `${ic} PATTERN: ${pat.name} — ${pat.conf}%`;
    txt.className = cls;
    dot.className = 'aria-dot ' + (pat.dir === 'bull' ? 'aria-bull' : pat.dir === 'bear' ? 'aria-bear' : 'aria-watch');
  }

  function _ariaRenderPanel(pat) {
    if (!pat) return;
    const svg = document.getElementById('aria-psvg');
    if (svg) svg.innerHTML = _ARIA_SVG[pat.svgType] || _ARIA_SVG['none'];

    const _s = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    _s('aria-pname', pat.name);
    _s('aria-ptf', pat.tf || '—');
    const confEl = document.getElementById('aria-pconf');
    if (confEl) {
      confEl.textContent = pat.conf + '%';
      confEl.style.color = pat.conf >= 75 ? '#00d97a' : pat.conf >= 60 ? '#f0c040' : '#00ffcc44';
    }
    _s('aria-ctype', pat.candleType || '—');
    const volEl = document.getElementById('aria-cvol');
    if (volEl) {
      volEl.textContent = pat.volTrend || '—';
      volEl.style.color = pat.volTrend === 'rising' ? '#00d97a' : pat.volTrend === 'falling' ? '#ff3355' : '#00ffcc66';
    }
    const mtfEl = document.getElementById('aria-mtf');
    if (mtfEl && pat.mtf) {
      mtfEl.innerHTML = ['5m', '15m', '30m', '1h', '4h', '1D'].map(tf => {
        const v = pat.mtf[tf] || '—';
        const ic = v === 'bull' ? '✓' : v === 'bear' ? '✗' : '~';
        const c = v === 'bull' ? 'aria-mtf-bull' : v === 'bear' ? 'aria-mtf-bear' : v === '—' ? 'aria-mtf-na' : 'aria-mtf-neut';
        return `<div class="aria-mtf-row"><span>${tf}</span><span class="${c}">${ic} ${v}</span></div>`;
      }).join('');
    }
    const vEl = document.getElementById('aria-verdict');
    const vtEl = document.getElementById('aria-verdict-txt');
    if (pat.verdict) {
      if (vEl) { vEl.textContent = pat.verdict.label; vEl.className = 'aria-verdict ' + (pat.verdict.cls || ''); }
      if (vtEl) vtEl.textContent = pat.verdict.txt;
    }

    // Fix 5 v92: MTF context hint from BM.structure + vol regime from BM.volRegime
    // Displayed below verdict — read-only, zero engine impact
    try {
      const ctxEl = document.getElementById('aria-ctx-hint');
      if (ctxEl) {
        const parts = [];
        if (typeof BM !== 'undefined' && BM.structure && BM.structure.mtfAlign) {
          const ma = BM.structure.mtfAlign;
          const mtfStr = ['15m', '1h', '4h'].map(tf => {
            const v = ma[tf] || '—';
            const ic = v === 'bull' ? '↑' : v === 'bear' ? '↓' : '~';
            return `${tf}:${ic}`;
          }).join(' ');
          if (mtfStr) parts.push('MTF ' + mtfStr);
        }
        if (typeof BM !== 'undefined' && BM.volRegime && BM.volRegime !== '—') {
          const vrColor = BM.volRegime === 'EXTREME' ? '#ff3355' : BM.volRegime === 'HIGH' ? '#f0c040' :
            BM.volRegime === 'LOW' ? '#556677' : '#00d97a';
          parts.push(`<span style="color:${vrColor}">VOL:${BM.volRegime}</span>`);
        }
        ctxEl.innerHTML = parts.length ? parts.join(' · ') : '';
      }
    } catch (e) { }

    // Fix 5 v93: MTF score + VOL regime dedicated elements (GPT spec)
    try {
      const mtfScore = BM?.structure?.score ?? null;
      _s('aria-mtfscore', mtfScore !== null ? `${mtfScore}/100` : '—');
      const volRegEl = document.getElementById('aria-volreg');
      if (volRegEl) {
        const vr = BM?.volRegime || '—';
        volRegEl.textContent = vr;
        volRegEl.style.color = vr === 'EXTREME' ? '#ff3355' : vr === 'HIGH' ? '#f0c040' :
          vr === 'LOW' ? '#556677' : vr === 'MED' ? '#00d97a' : '#00ffcc44';
      }
    } catch (e) { }

    // v94: Trap rate + Magnet bias — permanent display
    try {
      const liq = BM?.liqCycle;

      const trapEl = document.getElementById('aria-traprate');
      if (trapEl) {
        const tr = liq?.trapRate ?? null;
        if (tr === null) {
          trapEl.textContent = '—';
          trapEl.style.color = '#00ffcc44';
        } else {
          const trPct = Math.round(tr * 100);
          trapEl.innerHTML = trPct + '%' + (tr >= 0.55 ? ' ' + _ZI.w : '');
          trapEl.style.color = tr >= 0.65 ? '#ff3355' : tr >= 0.55 ? '#f0c040' : '#00d97a';
        }
      }

      const magEl = document.getElementById('aria-magnet');
      if (magEl) {
        const bias = liq?.magnetBias || '—';
        const biasDisplay = bias === 'above' ? '▲ ABOVE' :
          bias === 'below' ? '▼ BELOW' :
            bias === 'neut' ? '~ neut' : '—';
        magEl.textContent = biasDisplay;
        magEl.style.color = bias === 'above' ? '#00d97a' :
          bias === 'below' ? '#ff3355' : '#00ffcc44';
      }
    } catch (e) { }
  }

  function _novaRenderBar() {
    const el = document.getElementById('nova-bar-txt');
    if (!el) return;
    const lm = NOVA_STATE.lastMsg;
    if (!lm) { el.textContent = 'idle'; el.className = ''; _novaRenderAriaSummary(); return; }
    el.textContent = lm.msg.length > 48 ? lm.msg.slice(0, 48) + '\u2026' : lm.msg;
    el.className = lm.severity === 'danger' ? 'nova-blocked' : lm.severity === 'ok' ? 'nova-ready' : '';
    // NOVA Improvement 1: update ARIA mini-summary in NOVA
    _novaRenderAriaSummary();
  }

  function _novaRenderLog() {
    const el = document.getElementById('nova-log');
    if (!el) return;
    if (!NOVA_STATE.log.length) {
      el.innerHTML = '<div class="nova-empty">No verdicts yet \u2014 monitoring market\u2026</div>';
      return;
    }
    // NOVA Improvement 3: correlate current ARIA pattern with latest log entry
    const pat = ARIA_STATE.pattern;
    const patTag = pat ? ` <span style="opacity:.4;font-size:7px">[` + pat.name + ' ' + (pat.dir === 'bull' ? '\u{1F7E2}' : pat.dir === 'bear' ? '\u{1F534}' : '\u{1F7E1}') + ' ' + pat.conf + `%]</span>` : '';
    el.innerHTML = NOVA_STATE.log.map((e, i) =>
      `<div class="nova-log-row nova-log-${e.severity}">
      <span class="nova-log-ts">${e.ts}</span>
      <span class="nova-log-msg">${e.msg}${i === 0 ? patTag : ''}</span>
    </div>`
    ).join('');
    // NOVA Improvement 2: render ARIA history inside NOVA panel
    _novaRenderAriaHist();
  }

  // ── RAF PAINT ─────────────────────────────────────────────────────
  function _anPaint() {
    ARIA_STATE._rafPending = false;
    _ariaRenderBar(ARIA_STATE.pattern);
    _ariaRenderPanel(ARIA_STATE.pattern);
    _novaRenderBar();
    _novaRenderLog();
  }
  function _anSchedulePaint() {
    if (!ARIA_STATE._rafPending) {
      ARIA_STATE._rafPending = true;
      requestAnimationFrame(_anPaint);
    }
  }

  // ── NOVA CONTEXT VERDICTS (v93 — multi-context, logs ALL active alerts) ──
  // [FIX BUG3] Removed early returns — collects worst severity, logs highest-priority msg
  function _novaContext() {
    if (typeof S === 'undefined' || typeof BM === 'undefined') return;
    let worst = null; // {severity, msg} — tracks most severe alert
    const _pick = (sev, msg) => {
      const rank = { danger: 4, warn: 3, info: 2, ok: 1 };
      if (!worst || (rank[sev] || 0) > (rank[worst.severity] || 0)) worst = { severity: sev, msg };
    };

    // [1] Funding rate extremes
    if (typeof S?.fr === 'number' && !isNaN(S.fr)) {
      if (S.fr > 0.0012) _pick('warn', 'Funding rate high — longs overextended');
      if (S.fr < -0.0012) _pick('warn', 'Funding rate negative — shorts crowded');
    }

    // [2] Crowd sentiment — Long/Short ratio
    const ls = S?.ls ?? null;
    const lsRatio = typeof ls === 'number' ? ls
      : (ls && typeof ls.l === 'number' ? ls.l / 100 : null);
    if (lsRatio !== null && !isNaN(lsRatio)) {
      if (lsRatio >= 0.75) _pick('warn', 'Crowd LONG heavy (>=75%) — risk of dump/sweep');
      if ((1 - lsRatio) >= 0.75) _pick('warn', 'Crowd SHORT heavy (>=75%) — risk of squeeze');
    }

    // [3] Volatility regime
    const vr = BM?.volRegime || '—';
    if (vr === 'EXTREME') _pick('warn', 'VOL EXTREME — widen stops, reduce size, avoid chasing');
    else if (vr === 'LOW') _pick('info', 'VOL LOW — false breakouts more likely');

    // [4] Liquidity magnet + trapRate
    try {
      const liq = BM?.liqCycle;
      const magnetBias = liq?.magnetBias || S?.magnetBias || null;
      const trapRate = liq?.trapRate ?? null;
      if (magnetBias === 'above' || magnetBias === 'bull') _pick('info', 'Liquidity magnet ABOVE — watch for sweep up');
      if (magnetBias === 'below' || magnetBias === 'bear') _pick('info', 'Liquidity magnet BELOW — watch for sweep down');
      if (trapRate !== null && trapRate >= 0.55) _pick('warn', `TrapRate high ${(trapRate * 100).toFixed(0)}% — sweeps failing often`);
    } catch (e) { }

    // [5] Ranging market
    if (typeof BM?.regime === 'string' && (BM.regime.includes('RANGE') || BM.regime.includes('CHOP'))) {
      _pick('warn', 'Market ranging — breakout bias unreliable');
    }

    // [6] Pattern verdict
    const p = ARIA_STATE.pattern;
    if (p && p.verdict) {
      if (p.verdict.label === 'CONFIRMED') _pick('ok', `Setup valid: ${p.name} ${p.dir.toUpperCase()} @ ${p.conf}%`);
      else if (p.verdict.label === 'READY') _pick('info', `Wait close: ${p.name} — ${p.conf}% conf`);
    }

    // Emit the highest-severity alert found
    if (worst) novaLog(worst.severity, worst.msg);
  }

  // ── MAIN UPDATE (v93 — cfAdj post-adjust + ageBars aging) ────────
  function _anUpdate() {
    const now = Date.now();
    if (now - ARIA_STATE._updateTs < 250) return;
    ARIA_STATE._updateTs = now;

    if (typeof S === 'undefined') return;
    const kl = S.klines;
    if (!kl || kl.length < 5) return;

    const last = kl[kl.length - 1];
    const barKey = last.time + '_' + last.close.toFixed(2);

    if (ARIA_STATE._barKey === barKey && ARIA_STATE.pattern) {
      // Same bar — existing _patternAge fade (v92 logic preserved)
      ARIA_STATE._patternAge++;
      if (ARIA_STATE._patternAge > 8 && ARIA_STATE.pattern) {
        const fadeConf = Math.max(0, ARIA_STATE.pattern.conf - Math.floor((ARIA_STATE._patternAge - 8) * 1.5));
        if (fadeConf !== ARIA_STATE.pattern.conf) {
          ARIA_STATE.pattern = {
            ...ARIA_STATE.pattern, conf: fadeConf,
            verdict: _verdict(fadeConf, ARIA_STATE.pattern.dir)
          };
          _anSchedulePaint();
        }
        if (fadeConf < 25) { ARIA_STATE.pattern = null; ARIA_STATE._patternAge = 0; _anSchedulePaint(); }
      }
      _novaContext();
      return;
    }
    ARIA_STATE._barKey = barKey;
    ARIA_STATE._patternAge = 0;

    const candle = _detectCandle(kl);
    const chart = _detectChart(kl);
    const advanced = _detectAdvanced(kl);
    const momentum = _detectMomentum(kl);
    let chosen = null;
    // Pick highest-scoring pattern from all four detectors
    const _candidates = [candle, chart, advanced, momentum].filter(Boolean);
    if (_candidates.length) chosen = _candidates.reduce((a, b) => b.score > a.score ? b : a);

    const vol = _volTrend(kl);
    const mtf = _getMTF();

    if (chosen) {
      // Fix 2: ageBars reset on new chosen
      chosen.ageBars = 0;
      chosen.lastSeenTs = now;

      let trendCtx = 5;
      if (typeof BM !== 'undefined') {
        const aligned = (chosen.dir === 'bull' && BM.entryScore > 50) ||
          (chosen.dir === 'bear' && BM.entryScore < -20);
        trendCtx = aligned ? 10 : 3;
      }
      const cn = candle && candle !== chosen ? candle.name : null;
      const cf = _conf(chosen.score, cn, vol, trendCtx);

      // Fix 2 v93: multiplicative post-adjust (GPT spec exact)
      let cfAdj = cf;
      try {
        const mtfScore = BM?.structure?.score ?? null;
        const volReg = BM?.volRegime || '—';
        if (mtfScore !== null) {
          if (mtfScore < 45) cfAdj *= 0.85;  // weak MTF alignment → penalize both dirs
          else if (mtfScore > 70) cfAdj *= 1.08; // strong alignment → small boost
        }
        if (volReg === 'LOW') cfAdj *= 0.92;
        if (volReg === 'EXTREME') cfAdj *= 0.90;
        cfAdj = Math.round(Math.min(100, Math.max(0, cfAdj)));
      } catch (e) { cfAdj = cf; }

      const vd = _verdict(cfAdj, chosen.dir);

      const prevName = ARIA_STATE.pattern?.name;
      if (chosen.name !== prevName || Math.abs(cfAdj - (ARIA_STATE.pattern?.conf || 0)) > 12) {
        const sev = cfAdj >= 75 ? 'ok' : cfAdj >= 60 ? 'warn' : 'info';
        novaLog(sev, `ARIA: ${chosen.name} (${chosen.dir.toUpperCase()}) ${cfAdj}% @ ${S.chartTf || '5m'}`);
        if (cfAdj >= 72 && typeof atLog === 'function')
          atLog('info', `[ARIA] ${chosen.name} ${chosen.dir === 'bull' ? 'BULL' : 'BEAR'} ${cfAdj}%`);
      }

      ARIA_STATE.pattern = {
        ...chosen,
        candleType: cn || 'none (waiting close)',
        volTrend: vol, mtf, conf: cfAdj,   // cfAdj not cf
        verdict: vd, tf: S.chartTf || '5m',
      };
      _ariaHistPush(ARIA_STATE.pattern);

    } else {
      // Fix 3 v93: aging on new bar without chosen (GPT spec — ageBars)
      if (ARIA_STATE.pattern) {
        const ageBars = (ARIA_STATE.pattern.ageBars || 0) + 1;
        const agedConf = Math.max(0, ARIA_STATE.pattern.conf - 4);
        if (ageBars >= 6 || agedConf <= 20) {
          ARIA_STATE.pattern = null;
        } else {
          ARIA_STATE.pattern = {
            ...ARIA_STATE.pattern,
            ageBars,
            conf: agedConf,
            verdict: _verdict(agedConf, ARIA_STATE.pattern.dir),
          };
          _anSchedulePaint(); // re-render so bar shows faded conf
        }
      }
      // if pattern was null already, stays null
    }

    _novaContext();
    _anSave();
    _anSchedulePaint();
  }

  // ── INIT ──────────────────────────────────────────────────────────
  function initARIANOVA() {
    if (window._ARIA_NOVA_INITED) {
      console.warn('[ARIA/NOVA] Already inited — skip');
      return;
    }
    window._ARIA_NOVA_INITED = true;

    // WebSocket / offline fallback
    const wsOk = typeof WebSocket !== 'undefined';
    if (!wsOk) novaLog('warn', 'WebSocket unavailable — offline demo mode');

    _anLoad();

    // Restore UI state
    const ariaS = document.getElementById('aria-strip');
    const novaS = document.getElementById('nova-strip');
    if (ariaS && ARIA_STATE.expanded) ariaS.classList.add('aria-open');
    if (novaS && NOVA_STATE.expanded) novaS.classList.add('nova-open');

    // Paint any persisted data
    if (ARIA_STATE.pattern) _ariaRenderBar(ARIA_STATE.pattern);
    if (ARIA_STATE.pattern) _ariaRenderPanel(ARIA_STATE.pattern);
    if (NOVA_STATE.log.length) { _novaRenderBar(); _novaRenderLog(); }

    // Register update interval (reuses Intervals if available, else setInterval)
    if (typeof Intervals !== 'undefined' && typeof Intervals.set === 'function') {
      Intervals.set('aria_nova', _anUpdate, 2500);
    } else {
      setInterval(_anUpdate, 2500);
    }

    // First run after data settles
    setTimeout(_anUpdate, 6000);

    console.log('[ARIA/NOVA] ARIA + NOVA initialized');
  }

  // ── NOVA CLIPBOARD EXPORT ──────────────────────────────────────────
  function novaCopyLog() {
    if (!NOVA_STATE.log.length) { toast('NOVA log empty', 0, _ZI.brain); return; }
    const txt = NOVA_STATE.log.map(e => `[${e.ts}] [${e.severity.toUpperCase()}] ${e.msg}`).join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(() => toast('NOVA log copied', 0, _ZI.clip)).catch(() => toast('Copy failed', 0, _ZI.x));
    } else { toast('Clipboard unavailable', 0, _ZI.x); }
  }

  // ── NOVA IMPROVEMENT 1: ARIA mini-summary in NOVA bar + panel ────
  function _novaRenderAriaSummary() {
    const pat = ARIA_STATE.pattern;
    // Bar inline hint
    const barEl = document.getElementById('nova-bar-aria');
    if (barEl) {
      barEl.innerHTML = pat
        ? `${pat.dir === 'bull' ? _ZI.dGrn : pat.dir === 'bear' ? _ZI.dRed : _ZI.dYlw} ${pat.name} ${pat.conf}%`
        : '';
    }
    // Panel summary row
    const nameEl = document.getElementById('nova-aria-name');
    const dirEl = document.getElementById('nova-aria-dir');
    const confEl = document.getElementById('nova-aria-conf');
    const tfEl = document.getElementById('nova-aria-tf');
    if (nameEl) nameEl.textContent = pat ? pat.name : '—';
    if (dirEl) {
      dirEl.innerHTML = pat ? (pat.dir === 'bull' ? _ZI.dGrn + ' BULL' : pat.dir === 'bear' ? _ZI.dRed + ' BEAR' : _ZI.dYlw + ' WATCH') : '';
    }
    if (confEl) {
      confEl.textContent = pat ? `${pat.conf}%` : '';
      if (pat) confEl.style.color = pat.conf >= 70 ? '#00d97a' : pat.conf >= 50 ? '#f0c040' : '#ff335588';
    }
    if (tfEl) tfEl.textContent = pat ? pat.tf : '';
  }

  // ── NOVA IMPROVEMENT 2: ARIA history inside NOVA panel ───────────
  function _novaRenderAriaHist() {
    const el = document.getElementById('nova-aria-hist');
    if (!el) return;
    if (!_ariaHist.length) { el.innerHTML = '<span style="opacity:.3">—</span>'; return; }
    el.innerHTML = _ariaHist.map(h => {
      const ic = h.dir === 'bull' ? _ZI.dGrn : h.dir === 'bear' ? _ZI.dRed : _ZI.dYlw;
      const cc = h.dir === 'bull' ? '#00d97a' : h.dir === 'bear' ? '#ff3355' : '#f0c040';
      return `<div style="display:flex;gap:4px;padding:1px 0">`
        + `<span style="opacity:.4">${h.ts}</span>`
        + `<span>${ic}</span>`
        + `<span style="color:${cc}">${h.name}</span>`
        + `<span style="opacity:.5">${h.conf}% ${h.tf}</span>`
        + `</div>`;
    }).join('');
  }

  // ── ARIA PATTERN HISTORY (last 5 detections) ───────────────────
  const _ariaHist = [];
  function _ariaHistPush(pat) {
    if (!pat || !pat.name) return;
    const tz = (typeof S !== 'undefined' && S.tz) || 'Europe/Bucharest';
    const ts = new Date().toLocaleTimeString('ro-RO',
      { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    // Dedupe: skip if same pattern name as last entry within 60s
    const last = _ariaHist[0];
    if (last && last.name === pat.name && (Date.now() - last._ms) < 60000) return;
    _ariaHist.unshift({ name: pat.name, dir: pat.dir, conf: pat.conf, tf: pat.tf, ts, _ms: Date.now() });
    if (_ariaHist.length > 5) _ariaHist.pop();
    _ariaHistRender();
  }
  function _ariaHistRender() {
    const el = document.getElementById('aria-history');
    if (!el) return;
    if (!_ariaHist.length) { el.innerHTML = '<span style="opacity:.3">—</span>'; return; }
    el.innerHTML = _ariaHist.map(h => {
      const ic = h.dir === 'bull' ? _ZI.dGrn : h.dir === 'bear' ? _ZI.dRed : _ZI.dYlw;
      const cc = h.dir === 'bull' ? '#00d97a' : h.dir === 'bear' ? '#ff3355' : '#f0c040';
      return `<div style="display:flex;gap:4px;padding:1px 0">`
        + `<span style="opacity:.4">${h.ts}</span>`
        + `<span>${ic}</span>`
        + `<span style="color:${cc}">${h.name}</span>`
        + `<span style="opacity:.5">${h.conf}% ${h.tf}</span>`
        + `</div>`;
    }).join('');
  }

  // ── EXPORTS (block-scoped in strict mode — must expose to window) ──
  window.initARIANOVA = initARIANOVA;
  window.ariaToggle = ariaToggle;
  window.novaToggle = novaToggle;
  window.dslStripToggle = dslStripToggle;
  window.atStripToggle = atStripToggle;
  window.ptStripToggle = ptStripToggle;
  window.dslUpdateBanner = dslUpdateBanner;
  window.atUpdateBanner = atUpdateBanner;
  window.ptUpdateBanner = ptUpdateBanner;
  window.novaLog = novaLog;
  window.novaCopyLog = novaCopyLog;
} // end _ARIA_NOVA_LOADED guard

(function () {
  if (window.__ZEUS_PATCHV2__) return;
  window.__ZEUS_PATCHV2__ = true;

  /* ── 1. engineErrorBanner garantat in <body> ── */
  (function ensureEngineErrorBanner() {
    try {
      let b = document.getElementById('engineErrorBanner');
      if (!b) {
        b = document.createElement('div');
        b.id = 'engineErrorBanner';
        b.style.cssText = [
          'display:none',
          'position:fixed',
          'top:0', 'left:0', 'width:100%',
          'background:#ff0033', 'color:#fff',
          'text-align:center', 'padding:8px',
          'z-index:999999',
          'font-weight:bold',
          'letter-spacing:.5px'
        ].join(';');
        b.textContent = '\u26A0\uFE0F ENGINE ERROR \u2014 fallback mode active (check console)';
        (document.body || document.documentElement).appendChild(b);
      } else if (document.body && b.parentNode !== document.body) {
        document.body.appendChild(b);
      }
    } catch (_) { }
  })();

  /* ── 2. LAST_SCAN + MAGNETS populate (dynamic, throttled) ── */
  window._wireFusionInputs = function () {
    try {
      if (!window.LAST_SCAN) window.LAST_SCAN = { sigDir: null, ts: 0 };
      if (!window.MAGNETS) window.MAGNETS = { nearPct: null, ts: 0 };

      // ===== LAST_SCAN =====
      let best = { score: -Infinity, dir: null };

      if (window.MSCAN && window.MSCAN.data) {
        for (const sym in window.MSCAN.data) {
          const d = window.MSCAN.data[sym];
          if (d && (d.dir === 'bull' || d.dir === 'bear')) {
            const sc = Number(d.score);
            if (Number.isFinite(sc) && sc > best.score) {
              best = { score: sc, dir: d.dir };
            }
          }
        }
      }

      if (best.score >= 65 && best.dir) {
        window.LAST_SCAN.sigDir = best.dir;
        window.LAST_SCAN.ts = Date.now();
      }

      // ===== MAGNETS =====
      const mags = window.S?.magnets;
      const price = window.S?.price;

      if (mags && price && price > 0) {
        let bestDist = Infinity;

        if (Array.isArray(mags.above)) {
          for (const m of mags.above) {
            if (m?.price && m.price > price) {
              const dist = ((m.price - price) / price) * 100;
              if (dist < bestDist) bestDist = dist;
            }
          }
        }

        if (Array.isArray(mags.below)) {
          for (const m of mags.below) {
            if (m?.price && m.price < price) {
              const dist = ((price - m.price) / price) * 100;
              if (dist < bestDist) bestDist = dist;
            }
          }
        }

        if (Number.isFinite(bestDist) && bestDist < 100) {
          window.MAGNETS.nearPct = bestDist;
          window.MAGNETS.ts = Date.now();
        }
      }

    } catch (_) { }
  };

  // run once immediately
  window._wireFusionInputs();

  // ── 2b. Adaptive interval: 2s visible / 10s hidden (no duplicate guards) ──
  if (!window.__fusionWireInterval__) {
    window.__fusionWireInterval__ = setInterval(ZT_safeInterval('fusionWire', function () { // [v119-p6 FIX2C]
      if (typeof window._wireFusionInputs === 'function') {
        window._wireFusionInputs();
      }
    }, 2000), 2000);

    // [patch FIX D] interval always 2000 — OS-level throttling handles background tabs.
    // On visibility restore: call immediately once so UI is fresh without waiting 2s.
    document.addEventListener('visibilitychange', function () {
      if (window.__fusionWireInterval__) {
        clearInterval(window.__fusionWireInterval__);
        window.__fusionWireInterval__ = null;
      }
      const ms = 2000; // always 2000 — removed hidden→10000 throttle (breaks critical wiring)
      if (!document.hidden && typeof window._wireFusionInputs === 'function') {
        window._wireFusionInputs(); // immediate refresh on tab restore
      }
      window.__fusionWireInterval__ = setInterval(ZT_safeInterval('fusionWire', function () { // [v119-p6 FIX2C]
        if (typeof window._wireFusionInputs === 'function') {
          window._wireFusionInputs();
        }
      }, ms), ms);
    }, { passive: true });
  }

  /* ── 3. Size guard — detectiv only by default; set ZT_ENFORCE_SIZE_GUARD=true to block ── */
  window.ZT_ENFORCE_SIZE_GUARD = window.ZT_ENFORCE_SIZE_GUARD || false;
  (function patchSizeDoubleApply() {
    try {
      if (window.__ZEUS_SIZE_GUARD__) return;
      window.__ZEUS_SIZE_GUARD__ = true;

      const fnName = 'placeAutoTrade';
      const orig = window[fnName];
      if (typeof orig !== 'function') return;

      window[fnName] = function (...args) {
        const before = {
          walletBal: Number(window.ARES?.wallet?.balance),
          walletAvail: Number(window.ARES?.wallet?.available ??
            (window.ARES?.wallet?.balance - window.ARES?.wallet?.locked)),
        };

        const res = orig.apply(this, args);

        try {
          const size = Number(res?.size ?? res?.qtyUSDT ?? res?.notional);
          const bal = before.walletBal;
          if (Number.isFinite(size) && Number.isFinite(bal) && bal > 0) {
            const ratio = size / bal;
            if (ratio > 0.35) {
              if (window.ZT_ENFORCE_SIZE_GUARD) {
                console.warn('[SIZE_GUARD] BLOCKED — size exceeds 35% of wallet:',
                  { size, bal, ratio: ratio.toFixed(2), res });
                return null; // hard block upstream
              } else {
                console.warn('[SIZE_GUARD] size seems too large vs wallet (advisory):',
                  { size, bal, ratio: ratio.toFixed(2), res });
              }
            }
          }
        } catch (_) { }

        return res;
      };
    } catch (_) { }
  })();

})();


(function () {
  try {
    if (window.__ZEUS_WVE_V2__) return;
    window.__ZEUS_WVE_V2__ = true;

    const CFG = window.WVE_CONFIG = Object.assign({
      scoreScale: 20, thresholdLong: 12, thresholdShort: -12,
      minValidFactors: 3, minConfidence: 0.55, hysteresisPts: 2,
      decisionCooldownMs: 1000, stalenessMs: 120000, logThrottleMs: 30000,
      maxStakeFracWarn: 0.35
    }, window.WVE_CONFIG || {});

    // PATCH B: WR Filter config (merge safe — nu suprascrie dacă există deja)
    window.WVE_CONFIG.wrFilter = Object.assign({
      enabled: true,
      minWR: 55,         // sub 55% => veto exec
      warnEveryMs: 15000 // throttle log
    }, window.WVE_CONFIG.wrFilter || {});

    const ST = window.WVE_STATE = window.WVE_STATE || {
      lastDecision: "INIT", lastDecisionTs: 0, lastEvalTs: 0, lastLogTs: 0,
      lastScore: 0, lastConf: 0, lastValid: 0, lastReasons: []
    };

    const now = () => Date.now();
    const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
    const safeNum = (x, def = null) => (typeof x === "number" && isFinite(x)) ? x : def;
    const sgn = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;

    function getOpenCount() {
      try { if (window.ARES && ARES.positions && typeof ARES.positions.getOpen === "function") { const o = ARES.positions.getOpen(); return Array.isArray(o) ? o.length : (safeNum(o, 0) || 0); } } catch (_) { } return 0;
    }
    function getWalletAvail() {
      try { if (window.ARES && ARES.wallet) { const a = safeNum(ARES.wallet.available, null); if (a !== null) return a; const b = safeNum(ARES.wallet.balance, null); const l = safeNum(ARES.wallet.locked, 0); if (b !== null) return Math.max(0, b - l); } } catch (_) { } return null;
    }
    function updateCoreState() {
      const S0 = window.S || {}, BM0 = window.BM || {};
      let scanDir = null;
      try { if (window.LAST_SCAN && LAST_SCAN.sigDir && LAST_SCAN.ts && now() - LAST_SCAN.ts <= CFG.stalenessMs) scanDir = LAST_SCAN.sigDir; } catch (_) { }
      let nearPct = null;
      try {
        nearPct = safeNum(window.MAGNETS && MAGNETS.nearPct, null);
        if (nearPct === null && S0.magnets && safeNum(S0.price, null)) {
          const price = S0.price; let best = Infinity;
          const scanArr = (arr, above) => { if (!Array.isArray(arr)) return; for (const m of arr) { const mp = safeNum(m && m.price, null); if (mp === null) continue; if (above && mp <= price) continue; if (!above && mp >= price) continue; const d = Math.abs((mp - price) / price) * 100; if (d < best) best = d; } };
          scanArr(S0.magnets.above, true); scanArr(S0.magnets.below, false); if (isFinite(best)) nearPct = best;
        }
      } catch (_) { }
      // [FIX BUG6] liqCycle is object {trapRate, magnetBias}, volRegime is string — parse properly
      const _liqRaw = BM0.liqCycle || null;
      let _liqScore = null;
      if (_liqRaw && typeof _liqRaw === 'object') {
        const tr = safeNum(_liqRaw.trapRate, null);
        if (tr !== null) _liqScore = tr > 0.6 ? -6 : tr > 0.4 ? -2 : 2;
      } else { _liqScore = safeNum(_liqRaw, null); }
      const _vrRaw = BM0.volRegime || null;
      let _vrScore = null;
      if (typeof _vrRaw === 'string') {
        _vrScore = _vrRaw === 'EXTREME' ? -7 : _vrRaw === 'HIGH' ? -3 : _vrRaw === 'LOW' ? -4 : _vrRaw === 'MED' ? 1 : null;
      } else { _vrScore = safeNum(_vrRaw, null); }
      return { ts: now(), symbol: S0.symbol || window.SYMBOL || null, price: safeNum(S0.price, null), dataStalled: !!(window._SAFETY && _SAFETY.dataStalled), protectMode: !!(BM0 && BM0.protectMode), scanDir, nearPct, structure: BM0.structure || null, confluenceScore: safeNum(BM0.confluenceScore, safeNum(BM0.entryScore, null)), flowCvd: safeNum(BM0.flow && BM0.flow.cvd, null), sweep: safeNum(BM0.sweep, null), liqCycle: _liqScore, volRegime: _vrScore, atrPct: safeNum(BM0.atrPct, null) };
    }
    function hasVeto(core) {
      try {
        if (core.dataStalled) return { veto: true, reason: "DATA_STALLED" };
        const AT0 = window.AT || {};
        if (AT0.killTriggered || AT0.killSwitch) return { veto: true, reason: "KILL_SWITCH" };
        if (core.protectMode) return { veto: true, reason: "PROTECT_MODE" };
        // [FIX A1] Only veto NO_FUNDS if ARES wallet was explicitly funded by user (fundedTotal > 0).
        // Unfunded default ($0) MUST NOT block normal Zeus trading.
        const avail = getWalletAvail(); const _funded = Number(window.ARES && ARES.wallet && ARES.wallet.fundedTotal) || 0; if (_funded > 0 && avail !== null && avail <= 0) return { veto: true, reason: "NO_FUNDS" };
        const openCnt = getOpenCount();
        try { if (typeof window.maxPos === "function" && window.ARES && ARES.wallet) { const bal = safeNum(ARES.wallet.balance, null); if (bal !== null) { const mp = window.maxPos(bal); if (safeNum(mp, null) !== null && openCnt >= mp) return { veto: true, reason: "MAX_POS" }; } } } catch (_) { }
        if (AT0 && safeNum(AT0.cooldownMs, null) !== null && safeNum(AT0.lastTradeTs, null) !== null && (now() - AT0.lastTradeTs) < AT0.cooldownMs) return { veto: true, reason: "COOLDOWN" };
      } catch (_) { }
      return { veto: false, reason: null };
    }
    function factor(name, val, weight = 1) { const missing = (val === null || typeof val !== "number" || !isFinite(val)); return { name, val: missing ? 0 : clamp(val, -10, 10), weight, missing }; }
    function computeFactors(dir, core) {
      const dsign = (dir === "LONG") ? 1 : -1; const out = [];
      let reg = null; try { const st = core.structure || {}; if (st && typeof st.trendSign === "number") reg = clamp(st.trendSign * 10, -10, 10); else if (st && (st.dir === "bull" || st.dir === "bear")) reg = (st.dir === "bull") ? +7 : -7; } catch (_) { }
      out.push(factor("regime", (reg === null ? null : reg * dsign), 1.2));
      let flow = null; if (core.flowCvd !== null) flow = clamp(sgn(core.flowCvd) * 6, -10, 10);
      out.push(factor("flow", (flow === null ? null : flow * dsign), 1.0));
      let conf = null; if (core.confluenceScore !== null) conf = clamp(((core.confluenceScore - 50) / 50) * 10, -10, 10);
      out.push(factor("confluence", (conf === null ? null : conf * dsign), 1.4));
      let liq = null; if (core.sweep !== null) liq = clamp(sgn(core.sweep) * 6, -10, 10); else if (core.liqCycle !== null) liq = clamp(core.liqCycle, -10, 10);
      out.push(factor("liquidity", (liq === null ? null : liq * dsign), 1.0));
      let mag = null; if (core.nearPct !== null) { const p = core.nearPct; mag = p < 0.25 ? -7 : p < 0.6 ? -3 : p < 1.5 ? 0 : +3; }
      out.push(factor("magnet", mag, 0.9));
      let vol = null; if (core.atrPct !== null) { const a = core.atrPct; vol = a > 2.5 ? -7 : a > 1.8 ? -4 : a > 1.0 ? -1 : +2; } else if (core.volRegime !== null) { vol = clamp(core.volRegime, -10, 10); }
      out.push(factor("volatility", vol, 0.8));
      let scan = null; if (core.scanDir) { if (dir === "LONG" && core.scanDir === "bull") scan = +4; if (dir === "SHORT" && core.scanDir === "bear") scan = +4; if ((dir === "LONG" && core.scanDir === "bear") || (dir === "SHORT" && core.scanDir === "bull")) scan = -4; }
      out.push(factor("last_scan", scan, 0.6));
      return out;
    }
    // [WVE_v2] A1/A2/A3 — confidence conservator + anti-one-factor + evidence strength
    function _wveRegimeStrict(core) {
      // Returns true when regime is high-risk → minValidFactors=5
      try {
        const reg = String((window.BM && window.BM.regime) || '').toUpperCase();
        if (reg === 'SQUEEZE' || reg === 'DATA_STALL') return true;
        if (reg.indexOf('PERF') !== -1 && reg.indexOf('HEAVY') !== -1) return true;
      } catch (_) { }
      if (core && core.dataStalled) return true;
      return false;
    }
    function computeWVE(dir, core) {
      const factors = computeFactors(dir, core);
      let wSum = 0, sSum = 0, valid = 0, sumAbsVotes = 0, maxAbsVote = 0;
      const missing = [];
      for (const f of factors) {
        if (f.missing) { missing.push(f.name); continue; }
        valid++; wSum += f.weight; sSum += f.val * f.weight;
        const av = Math.abs(f.val * f.weight); sumAbsVotes += av; if (av > maxAbsVote) maxAbsVote = av;
      }
      // A1: dynamic minValidFactors based on regime
      const strictRegime = _wveRegimeStrict(core);
      const minVF = strictRegime ? 5 : 3;
      if (wSum <= 0 || valid < minVF) {
        // No-evidence result: confidence=0, evidence=0, NO_TRADE/ADVISORY gating upstream
        return { scaledScore: 0, confidence: 0, evidence: 0, validCount: valid, minValidFactors: minVF, missingNames: missing, factors, reason: 'INSUFFICIENT_FACTORS' };
      }
      const raw = sSum / wSum;
      const scaled = clamp((raw / 10) * CFG.scoreScale, -CFG.scoreScale, CFG.scoreScale);
      const availFrac = clamp(valid / Math.max(1, factors.length), 0, 1);
      const intensity = clamp(Math.abs(scaled) / CFG.scoreScale, 0, 1);
      let confidence = clamp(0.25 + 0.75 * (0.55 * availFrac + 0.45 * intensity), 0, 1);
      // A2: anti-one-factor penalty — if one factor dominates (>60% of abs-votes), penalize
      if (sumAbsVotes > 0) {
        const topShare = maxAbsVote / sumAbsVotes;
        if (topShare > 0.60) { confidence = clamp(confidence * (1 - (topShare - 0.60)), 0, 1); }
      }
      // A3: evidence strength (0..100) — valid factor coverage × vote intensity × data health
      const dataStallPenalty = (core && core.dataStalled) ? 0.6 : 1.0;
      const normVotes = clamp(sumAbsVotes / Math.max(wSum * 10, 0.001), 0, 1);
      const evidence = Math.round(clamp((availFrac * 0.6 + normVotes * 0.4) * dataStallPenalty, 0, 1) * 100);
      return { scaledScore: scaled, confidence, evidence, validCount: valid, minValidFactors: minVF, missingNames: missing, factors };
    }
    function evaluateDecision(core) {
      const t = now();
      if (t - ST.lastEvalTs < CFG.decisionCooldownMs) return { decision: ST.lastDecision, reason: ["COOLDOWN_EVAL"], core };
      ST.lastEvalTs = t;
      const veto = hasVeto(core);
      if (veto.veto) { ST.lastDecision = "BLOCK"; ST.lastDecisionTs = t; ST.lastReasons = [veto.reason]; return { decision: "BLOCK", reason: [veto.reason], core }; }
      const L = computeWVE("LONG", core), Sx = computeWVE("SHORT", core);
      const pick = (Math.abs(L.scaledScore) >= Math.abs(Sx.scaledScore)) ? { dir: "LONG", r: L } : { dir: "SHORT", r: Sx };
      const r = pick.r; ST.lastScore = r.scaledScore; ST.lastConf = r.confidence; ST.lastValid = r.validCount;
      // A1: no-evidence gate (confidence===0 or evidence===0 → INSUFFICIENT_FACTORS → NO_TRADE)
      if (r.confidence === 0 || r.evidence === 0) {
        ST.lastDecision = "NO_TRADE"; ST.lastDecisionTs = t;
        ST.lastReasons = ["INSUFFICIENT_FACTORS", "valid=" + r.validCount + "/minVF=" + r.minValidFactors];
        return { decision: "NO_TRADE", dir: pick.dir, wve: r, reason: ST.lastReasons, core };
      }
      if (r.validCount < CFG.minValidFactors) { const dec = "ADVISORY_ONLY"; ST.lastDecision = dec; ST.lastDecisionTs = t; ST.lastReasons = ["INSUFFICIENT_DATA", "valid=" + r.validCount]; return { decision: dec, dir: pick.dir, wve: r, reason: ST.lastReasons, core }; }
      if (r.confidence < CFG.minConfidence) { ST.lastDecision = "NO_TRADE"; ST.lastDecisionTs = t; ST.lastReasons = ["LOW_CONF", "conf=" + r.confidence.toFixed(2)]; return { decision: "NO_TRADE", dir: pick.dir, wve: r, reason: ST.lastReasons, core }; }
      // A3: evidence gate — regime-aware minEvidence
      const strictReg = _wveRegimeStrict(core);
      const minEvid = strictReg ? 50 : 35;
      if (r.evidence < minEvid) {
        ST.lastDecision = "NO_TRADE"; ST.lastDecisionTs = t;
        ST.lastReasons = ["LOW_EVIDENCE", "evid=" + r.evidence + "/min=" + minEvid];
        return { decision: "NO_TRADE", dir: pick.dir, wve: r, reason: ST.lastReasons, core };
      }
      const extra = (ST.lastDecision === "NO_TRADE") ? CFG.hysteresisPts : 0;
      if (pick.dir === "LONG") { ST.lastDecision = r.scaledScore >= (CFG.thresholdLong + extra) ? "LONG_OK" : "NO_TRADE"; }
      else { ST.lastDecision = r.scaledScore <= (CFG.thresholdShort - extra) ? "SHORT_OK" : "NO_TRADE"; }
      ST.lastDecisionTs = t; ST.lastReasons = ["dir=" + pick.dir, "score=" + r.scaledScore.toFixed(1), "conf=" + r.confidence.toFixed(2), "evid=" + r.evidence, "valid=" + r.validCount];
      return { decision: ST.lastDecision, dir: pick.dir, wve: r, reason: ST.lastReasons, core };
    }
    function throttledLog(payload) { const t = now(); if (t - ST.lastLogTs < CFG.logThrottleMs) return; ST.lastLogTs = t; try { console.log("[WVE_v2]", payload); } catch (_) { } }

    setInterval(function () { try { const core = updateCoreState(); const out = evaluateDecision(core); throttledLog({ decision: out.decision, dir: out.dir, score: ST.lastScore, conf: ST.lastConf, valid: ST.lastValid, reasons: out.reason }); } catch (_) { } }, 2000);

    const fnName = "placeAutoTrade", orig = window[fnName];
    if (typeof orig === "function") {
      window[fnName] = function () {
        let core, out;
        try { core = updateCoreState(); out = evaluateDecision(core); } catch (_) { return orig.apply(this, arguments); }
        // [v119-p12] Return contract normalizat: {ok,blocked,reason,source,decision}
        // Callerii existenți ignoră return — compatibilitate păstrată.
        // Callerii viitori verifică r?.ok sau r?.blocked.
        if (out && out.decision === "BLOCK") {
          throttledLog({ blocked: true, reason: out.reason });
          // [FIX A2] Surface WVE_v2 block via user-visible log/block-reason path
          try { if (typeof BlockReason !== 'undefined') BlockReason.set('WVE_BLOCK', 'WVE: ' + ((out.reason || []).join(', ')), 'WVE_v2'); } catch (_e) { }
          try { if (typeof atLog === 'function') atLog('warn', '[WVE] BLOCK: ' + ((out.reason || []).join(', '))); } catch (_e) { }
          return { ok: false, blocked: true, reason: out.reason, source: 'WVE', decision: "BLOCK" };
        }
        if (out && out.decision === "NO_TRADE") {
          throttledLog({ blocked: true, reason: out.reason });
          // [FIX A2] Surface WVE_v2 NO_TRADE via user-visible log/block-reason path
          try { if (typeof BlockReason !== 'undefined') BlockReason.set('WVE_NO_TRADE', 'WVE: ' + ((out.reason || []).join(', ')), 'WVE_v2'); } catch (_e) { }
          try { if (typeof atLog === 'function') atLog('warn', '[WVE] NO_TRADE: ' + ((out.reason || []).join(', '))); } catch (_e) { }
          return { ok: false, blocked: true, reason: out.reason, source: 'WVE', decision: "NO_TRADE" };
        }
        if (out && out.decision === "ADVISORY_ONLY") {
          throttledLog({ advisory: true, reason: out.reason });
          // advisory: lasă originalul să execute, returnează ce returnează el
          return orig.apply(this, arguments);
        }
        return orig.apply(this, arguments);
      };
    } else {
      throttledLog({ info: "placeAutoTrade not found; WVE_v2 advisory/log mode only." });
    }
  } catch (e) { try { console.warn("WVE_v2 patch error:", e); } catch (_) { } }
})();
