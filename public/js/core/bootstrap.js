// Zeus v122 — core/bootstrap.js
// Application init, startApp, initZeusGroups
'use strict';

// Init zeus groups (DOM structure)
function initZeusGroups() {
  // ── REQ 1: UI_BUILT guard — never run twice ──────────────────
  if (window.UI_BUILT) {
    console.warn('[ZEUS] initZeusGroups() called twice — skipping (UI_BUILT set)');
    return;
  }
  window.UI_BUILT = true;

  const mi = document.getElementById('zg-body-mi');
  // UI FIX: TE and RP are aliases of MI — all content goes into one group, no duplicates
  const te = mi;
  const rp = mi;
  if (!mi) { window.UI_BUILT = false; return; }

  // ── RECOVERY MODE helpers ────────────────────────────────────
  const _failedElements = [];

  function _markPending(el) {
    if (el) el.classList.add('zg-pending-move');
  }
  function _recoverElement(el) {
    // Can't move — make visible in place with recovery marker
    if (!el) return;
    el.classList.remove('zg-pending-move');
    el.classList.add('zg-recovery-mode');
    _failedElements.push(el.id || el.className || '(anon)');
  }
  function _showRecoveryBanner() {
    let banner = document.getElementById('zg-recovery-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'zg-recovery-banner';
      document.body.insertAdjacentElement('afterbegin', banner);
    }
    banner.innerHTML = '\u26A0\uFE0F Unele panouri nu s-au putut \u00eenc\u0103rca corect. <strong>Apas\u0103 aici pentru a re\u00eencerca.</strong>';
    banner.style.display = 'block';
    banner.onclick = function () {
      window.UI_BUILT = false;
      // Remove recovery classes so panels can be moved again
      document.querySelectorAll('.zg-recovery-mode').forEach(el => {
        el.classList.remove('zg-recovery-mode');
      });
      banner.style.display = 'none';
      initZeusGroups();
    };
  }

  // ── REQ 2: move element by ID — with recovery fallback ──────
  function mv(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    _markPending(el);
    if (!target) { _recoverElement(el); return; }
    if (el.parentElement === target) { el.classList.remove('zg-pending-move'); return; }
    target.appendChild(el);
    el.classList.remove('zg-pending-move');
  }

  // ── REQ 2: move anonymous .sec — with recovery fallback ──────
  function mvSec(childSel, target) {
    try {
      const child = document.querySelector(childSel);
      if (!child) return;
      // Walk up to find the enclosing .sec
      let node = child;
      while (node && node !== document.body) {
        if (node.classList && (node.classList.contains('sec') ||
          node.classList.contains('znc') ||
          node.classList.contains('bext') ||
          node.classList.contains('dsl-zone') ||
          node.classList.contains('at-panel') ||
          node.classList.contains('trade-panel') ||
          node.classList.contains('trade-sep') ||
          node.classList.contains('at-sep'))) {
          _markPending(node);
          if (!target) { _recoverElement(node); return; }
          if (node.parentElement === target) { node.classList.remove('zg-pending-move'); return; }
          target.appendChild(node);
          node.classList.remove('zg-pending-move');
          return;
        }
        node = node.parentElement;
      }
    } catch (_) { }
  }

  // ── MARKET INTELLIGENCE ────────────────────────────────────────
  // AUB este în fluxul paginii după zeus-groups — îl mutăm explicit primul
  mv('aub', mi);   // Alien Upgrade Bay — PRIMUL în MI
  mv('sr-strip', mi);   // Signal Registry strip — imediat după AUB
  mv('csec', mi);   // chart section (mc, cc, vc inside)
  mv('aria-strip', mi); // ARIA HUD strip
  mv('teacher-strip', mi); // THE TEACHER — Replay & Practice Lab
  mv('pnl-lab-strip', mi); // PnL Lab strip — between ARIA and DSL
  mv('dsl-strip', mi); // DSL banner strip
  mv('at-strip', mi); // AT banner strip
  mv('pt-strip', mi); // Paper Trading banner strip
  mv('nova-strip', mi); // NOVA HUD strip
  mv('mtf-strip', mi); // MTF Structural Model — Etapa 1
  mv('zeusBrain', mi);  // brain / cockpit
  mv('brainExt', mi);   // brain extension panel
  mvSec('#rsiupd', mi);  // RSI Multi-TF
  mvSec('.dttabs', mi);  // AI Metrics
  mvSec('.conf-widget', mi);  // Confluence Score
  mvSec('.fgc', mi);  // Fear & Greed
  mvSec('#frv', mi);  // BTC Market Metrics
  mvSec('#askc', mi);  // Order Book
  mvSec('.srgrid', mi);  // S/R Levels
  mvSec('.lmcs', mi);  // Liquidations Monitor
  mvSec('#tv', mi);  // Liquidation Overview
  mvSec('.fdlist', mi);  // Live Feed
  mv('magSec', mi);   // Liquidity Magnet Radar
  mv('mscanSec', mi);   // Multi-Symbol Scanner
  mv('dhfSec', mi);   // Day/Hour Win Rate Filter
  mv('sigScanSec', mi); // Signal Scanner
  mv('deepdive-sec', mi); // Deep Dive — Narrative Context Panel
  mv('scenario-sec', mi); // Scenario Engine — separate advisory block
  mv('macro-sec', mi); // Cycle Intelligence — Level 5
  mv('adaptive-sec', mi); // Adaptive Control — Etapa 5
  if (DEV.enabled) mv('dev-sec', mi); // Developer Mode — only if enabled (gated)

  // ── TRADE ENGINE ───────────────────────────────────────────────
  // ── TRADE ENGINE → AT banner (atPanel + kill/journal) ───────────
  const _atPanel = document.getElementById('at-strip-panel');
  if (_atPanel) {
    mv('atPanel', _atPanel);  // Auto Trade Engine (kill switch, journal, config)
    mvSec('.at-sep', _atPanel);  // AT separator
  }
  // ── PAPER TRADING → PT banner (panelDemo + trade controls) ──────
  const _ptPanel = document.getElementById('pt-strip-panel');
  if (_ptPanel) {
    mvSec('.trade-sep', _ptPanel); // Trade panel toggle buttons
    mv('panelDemo', _ptPanel); // Paper Trading panel
    mv('panelLive', _ptPanel); // Live Trading panel
  }

  // ── RISK & PERFORMANCE ─────────────────────────────────────────
  const _dslPanel = document.getElementById('dsl-strip-panel');
  if (_dslPanel) mv('dslZone', _dslPanel); // DSL Zone → banner colapsabil
  mv('perfSec', rp);   // Performance Tracker
  mv('btSec', rp);   // Backtest Engine

  // ── SAFETY TIMER: orice element rămas cu .zg-pending-move → recovery ──
  setTimeout(function () {
    document.querySelectorAll('.zg-pending-move').forEach(function (el) {
      console.warn('[ZEUS] Recovery: element stuck in pending-move state:', el.id || el.className);
      _recoverElement(el);
    });
    if (_failedElements.length > 0) {
      console.warn('[ZEUS] Recovery mode activated for:', _failedElements);
      _showRecoveryBanner();
    }
  }, 500);

  // ── COLLAPSE BEHAVIOR (Step 3) ─────────────────────────────────
  const saved = {};
  try {
    const raw = localStorage.getItem('zeus_groups');
    if (raw) Object.assign(saved, JSON.parse(raw));
  } catch (_) { }

  document.querySelectorAll('.zg').forEach(function (sec) {
    const id = sec.id;
    if (saved[id] === false) {
      sec.classList.add('collapsed');
    }
    const hdr = sec.querySelector('.zg-hdr');
    if (!hdr) return;
    hdr.onclick = function () {
      sec.classList.toggle('collapsed');
      const state = !sec.classList.contains('collapsed');
      saved[id] = state;
      try { localStorage.setItem('zeus_groups', JSON.stringify(saved)); } catch (_) { }
    };
  });

  // ── MOBILE BEHAVIOR (Step 4) ────────────────────────────────────
  if (window.innerWidth < 700) {
    const te_sec = document.getElementById('zg-te');
    const rp_sec = document.getElementById('zg-rp');
    if (te_sec && saved['zg-te'] === undefined) te_sec.classList.add('collapsed');
    if (rp_sec && saved['zg-rp'] === undefined) rp_sec.classList.add('collapsed');
    // MI starts EXPANDED on mobile (user can collapse manually)
    const mi_sec = document.getElementById('zg-mi');
    if (mi_sec && saved['zg-mi'] === undefined) mi_sec.classList.remove('collapsed');
  }
}

// ─── FEED-GATED EXTRAS (req 5) ─────────────────────────────────
// DSL, AutoTrade scanner, multi-symbol scan start ONLY after
// price feed is confirmed alive (S.bnbOk or S.bybOk = true)

// Feed-gated extras
function _waitForFeedThenStartExtras() {
  // [FIX v85 B3] Folosim Intervals.set în loc de setTimeout recursiv
  // Previne acumularea de timere la reconnectări multiple
  Intervals.clear('feedWait'); // curăță orice interval anterior
  const MAX_WAIT_MS = 30000;
  const CHECK_MS = 500;
  let waited = 0;

  Intervals.set('feedWait', () => {
    const feedOk = S.bnbOk || S.bybOk;
    waited += CHECK_MS;

    if (feedOk || waited >= MAX_WAIT_MS) {
      Intervals.clear('feedWait'); // stop polling
      if (!feedOk) {
        atLog('warn', '⚠️ Extras started without confirmed feed (timeout)');
      } else {
        atLog('info', '✅ Feed confirmed — starting DSL + scanner extras');
      }
      _startExtras();
    }
  }, CHECK_MS);
}

function _startExtras() {
  // DSL — single start, guarded (req 5)
  startDSLIntervals();
  Intervals.set('dslTrim', _dslTrimAll, 300000);

  // Multi-symbol scan — gated (req 5) + [PATCH A] respect toggle
  setTimeout(runMultiSymbolScan, 3000);
  Intervals.set('multiscan', () => { if (AT.enabled && el('atMultiSym')?.checked !== false) runMultiSymbolScan(); }, 60000);

  // [FIX v85 B6] Salvare periodică blackbox (la fiecare 30s, doar dacă dirty)
  Intervals.set('bbSave', () => { if (typeof _aubSaveBB === 'function') _aubSaveBB(); }, 30000);

  atLog('info', '🔧 Extras module online');

  // ── Resume AutoTrade if it was enabled before reload ──
  if (typeof AT !== 'undefined' && AT.enabled && !AT.killTriggered) {
    // AT.enabled was restored from localStorage — kick-start the scan interval + UI
    console.log('[startApp] ♻️ AT was enabled before reload — resuming');
    // Update UI to reflect ON state
    const _btn = el('atMainBtn'); if (_btn) _btn.className = 'at-main-btn on';
    const _dot = el('atBtnDot'); if (_dot) { _dot.style.background = '#00ff88'; _dot.style.boxShadow = '0 0 10px #00ff88'; }
    const _txt = el('atBtnTxt'); if (_txt) _txt.textContent = 'AUTO TRADE ON';
    const _st = el('atStatus'); if (_st) _st.textContent = '🟢 Activ — scan la 30s';
    if (!AT.interval) AT.interval = Intervals.set('atCheck', runAutoTradeCheck, 30000);
    setTimeout(runAutoTradeCheck, 3000); // first check after brief settle
    if (typeof atUpdateBanner === 'function') atUpdateBanner();
    if (typeof ptUpdateBanner === 'function') ptUpdateBanner();
    atLog('info', '♻️ AutoTrade resumed from saved state');
  }
}



// Health checks
function runHealthChecks() {
  const checks = {};

  // Helper: check element exists and has at least one child matching selector
  function _check(parentId, childSel) {
    const parent = document.getElementById(parentId);
    if (!parent) return false;
    if (!childSel) return true;
    return !!parent.querySelector(childSel);
  }

  // [HEALTH] MI: #zg-body-mi exists and has at least one .sec child
  checks.mi = _check('zg-body-mi', '.sec');
  // [HEALTH] DSL: #dsl-strip-panel contains #dslZone
  checks.dsl = _check('dsl-strip-panel', '#dslZone');
  // [HEALTH] AT: #at-strip-panel contains #atPanel
  checks.at = _check('at-strip-panel', '#atPanel');
  // [HEALTH] PT: #pt-strip-panel contains #panelDemo AND #panelLive
  checks.pt = _check('pt-strip-panel', '#panelDemo') && _check('pt-strip-panel', '#panelLive');

  console.log('[HEALTH] MI mounted:', checks.mi ? 'OK' : 'FAIL');
  console.log('[HEALTH] DSL mounted:', checks.dsl ? 'OK' : 'FAIL');
  console.log('[HEALTH] AT mounted:', checks.at ? 'OK' : 'FAIL');
  console.log('[HEALTH] PT mounted:', checks.pt ? 'OK' : 'FAIL');

  const anyFail = !checks.mi || !checks.dsl || !checks.at || !checks.pt;

  // Store health in S object for programmatic access
  if (typeof S !== 'undefined') {
    S.uiHealth = {
      mi: checks.mi,
      dsl: checks.dsl,
      at: checks.at,
      pt: checks.pt,
      ok: !anyFail,
      ts: Date.now(),
    };
  }

  if (anyFail) {
    console.warn('[HEALTH] ⚠️ One or more modules failed to mount:', checks);
    let banner = document.getElementById('zg-health-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'zg-health-banner';
      // Insert after recovery banner (or at top of body)
      const rb = document.getElementById('zg-recovery-banner');
      if (rb) rb.insertAdjacentElement('afterend', banner);
      else document.body.insertAdjacentElement('afterbegin', banner);
    }
    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k.toUpperCase()).join(', ');
    banner.textContent = `⚠️ Interfață incompletă – modulele [${failed}] nu s‑au încărcat. Reîmprospătează pagina.`;
    banner.style.display = 'block';
  } else {
    // Hide banner if all good
    const banner = document.getElementById('zg-health-banner');
    if (banner) banner.style.display = 'none';
    console.log('[HEALTH] ✅ All modules mounted OK');
  }

  return checks;
}

// [v122 ANALYTICS] Update PnL Lab condensed pills in header bar
function _updatePnlLabCondensed() {
  try {
    var ds = (typeof DAILY_STATS !== 'undefined') ? DAILY_STATS : null;
    var cumEl = document.getElementById('pnl-lab-cum');
    var ddEl = document.getElementById('pnl-lab-dd');
    var expEl = document.getElementById('pnl-lab-exp');

    // [FIX BUG2] Check if we have any real data
    var hasData = ds && (ds.cumPnl !== 0 || ds.peak !== 0 || (ds.days && Object.keys(ds.days).length > 0));

    if (cumEl) {
      if (!hasData) {
        cumEl.textContent = 'PnL: —';
        cumEl.style.color = '#3a5068';
      } else {
        var c = ds.cumPnl || 0;
        cumEl.textContent = 'PnL: ' + (c >= 0 ? '+' : '') + '$' + c.toFixed(2);
        cumEl.style.color = c >= 0 ? '#00d97a' : '#ff4466';
      }
    }
    if (ddEl) {
      if (!hasData) {
        ddEl.textContent = 'DD: —';
        ddEl.style.color = '#3a5068';
      } else {
        ddEl.textContent = 'DD: $' + (ds.currentDD || 0).toFixed(2);
        ddEl.style.color = ds.currentDD > 0 ? '#ff4466' : 'var(--dim)';
      }
    }
    if (expEl) {
      if (typeof calcGlobalExpectancy !== 'function') {
        expEl.textContent = 'E: —';
        expEl.style.color = '#3a5068';
      } else {
        var e = calcGlobalExpectancy();
        if (e === 0 && !hasData) {
          expEl.textContent = 'E: —';
          expEl.style.color = '#3a5068';
        } else {
          expEl.textContent = 'E: ' + (e >= 0 ? '+' : '') + '$' + e.toFixed(2);
          expEl.style.color = e > 0 ? '#00d97a' : e < 0 ? '#ff4466' : 'var(--dim)';
        }
      }
    }
  } catch (_) { }
}

// [RISK RAILS] Update summary line from live input values
function updateRRSummary() {
  var el = document.getElementById('rr-summary');
  if (!el) return;
  var v = function (id, d) { var e = document.getElementById(id); return e ? e.value : d; };
  el.textContent =
    v('rrRiskPct', '1') + '% risk · ' +
    v('rrMaxDay', '5') + ' trades/day · ' +
    v('rrMaxConcurrent', '3') + ' pos · ' +
    v('rrDailyDD', '5') + '% DD · ' +
    v('rrLossStreak', '3') + ' streak · ' +
    v('rrMaxAddon', '2') + ' add-ons';
}

// startApp — MAIN ENTRY POINT
function startApp() {
  // ─── GLOBAL BOOT GUARD (req 1, 7) ──────────────────────────
  if (window.ZEUS_STARTED) {
    console.warn('[ZEUS] startApp() called twice — ignoring duplicate boot');
    return;
  }
  window.ZEUS_STARTED = true;
  window.ZEUS_BOOTED = false;  // set true after full init
  // ── IMMEDIATE STATE RESTORE (before any code can save empty TP) ──
  const _earlyRestored = ZState.restore();
  if (_earlyRestored) {
    console.log('[startApp] ✅ State restored immediately at boot — positions in TP before Phase 1');
  }
  // ── BUILD MANIFEST (single source of truth) ──────────────────
  window.BUILD = window.BUILD || {
    name: 'ZeuS',
    version: 'v90 OVI',
    features: ['ATR Parity', 'CoreTick', 'ZLOG'],
    ts: Date.now(),
  };
  console.log('[startApp] 🚀 boot sequence starting | __wsGen=', window.__wsGen);

  if (typeof LightweightCharts === 'undefined') {
    window.ZEUS_STARTED = false;  // allow retry
    setTimeout(startApp, 100);
    return;
  }
  // ═══════════════════════════════════════════════════════
  // PHASE 1 — CORE: charts, groups, UI shell (no data yet)
  // ═══════════════════════════════════════════════════════
  initCharts();
  // [DEV] Restore DEV.enabled BEFORE initZeusGroups so the panel is moved correctly
  try {
    var _devRaw = localStorage.getItem('zeus_dev_enabled');
    if (_devRaw === 'true') {
      DEV.enabled = true;
      var _devPanel = document.getElementById('dev-sec');
      if (_devPanel) _devPanel.style.display = '';
    }
  } catch (_) { }
  initZeusGroups();       // move panels into collapsible group wrappers
  initMidStack();         // wrap 5 strips in #midStack + drag&drop reorder
  initAdaptiveStrip();    // [Etapa 5] mută conținut adaptive-sec → adaptive-strip-panel
  initMTFStrip();         // MTF Structural Model — restaurează stare panou + interval gating
  loadUserSettings();     // [US] restore persisted user preferences (TF, TZ, indicators, AT params)
  _srLoad();              // [SR] restore signal registry from localStorage
  _ncLoad();              // [NC] restore notification center from localStorage
  // Health checks run after a short delay to let the 500ms safety timer settle
  setTimeout(runHealthChecks, 700);
  setTimeout(() => { _srUpdateStats(); _srRenderList(); srStripUpdateBar(); }, 800); // [SR] render initial
  setTimeout(_ncUpdateBadge, 900);  // [NC] update badge after load
  initAUB();              // Alien Upgrade Bay — UI shell only, no intervals
  initARIANOVA();         // ARIA + NOVA HUD strips — init after groups moved
  initPMPanel();          // [v107] Post-Mortem panel — insertat după sr-strip
  initARES();             // [v108] ARES Neural Command Center — READ ONLY
  setTimeout(initAriaBrain, 200); // [v110] Brain overlay — 136 noduri exacte
  if (typeof initTeacher === 'function') initTeacher(); // THE TEACHER — Batch 6
  // DSL strip: restore open state + init banner
  try { if (localStorage.getItem('zeus_dsl_strip_open') === '1') { _dslStripOpen = true; const _ds = document.getElementById('dsl-strip'); if (_ds) _ds.classList.add('dsl-strip-open'); } } catch (_) { }
  dslUpdateBanner();
  // AT strip: restore open state + init banner
  try { if (localStorage.getItem('zeus_at_strip_open') === '1') { _atStripOpen = true; const _as = document.getElementById('at-strip'); if (_as) _as.classList.add('at-strip-open'); } } catch (_) { }
  atUpdateBanner();
  // PT strip: restore open state + init banner
  try { if (localStorage.getItem('zeus_pt_strip_open') === '1') { _ptStripOpen = true; const _ps = document.getElementById('pt-strip'); if (_ps) _ps.classList.add('pt-strip-open'); } } catch (_) { }
  ptUpdateBanner();
  initCloudSettings();
  loadSavedAPI();
  loadJournalFromStorage();
  // [v122 ANALYTICS] Load persisted PERF + daily PnL, then rebuild from journal
  if (typeof loadPerfFromStorage === 'function') loadPerfFromStorage();
  if (typeof loadDailyPnl === 'function') loadDailyPnl();
  if (typeof rebuildDailyFromJournal === 'function') rebuildDailyFromJournal();
  // [ghost guard late-restore] Dacă ZState.restore s-a executat înainte ca jurnalul să fie disponibil,
  // pozițiile au fost stocate în _pendingPositions. Le aplicăm acum că avem jurnalul.
  try {
    if (ZState._pendingPositions && Array.isArray(ZState._pendingPositions) && ZState._pendingPositions.length) {
      const _pend = ZState._pendingPositions;
      delete ZState._pendingPositions;
      const _existing2 = new Set((TP.demoPositions || []).map(p => String(p.id)));
      const _closed2 = new Set((TP.journal || []).map(j => j.id).filter(Boolean).map(String));
      _pend.forEach(p => {
        if (p.closed || _closed2.has(String(p.id))) return;
        if (!_existing2.has(String(p.id))) {
          TP.demoPositions = TP.demoPositions || [];
          const _rp = { ...p, _restored: true };
          TP.demoPositions.push(_rp);
          if (typeof onPositionOpened === 'function') onPositionOpened(_rp, 'restore');
        }
      });
      if (typeof renderDemoPositions === 'function') setTimeout(renderDemoPositions, 300);
      if (typeof renderATPositions === 'function') setTimeout(renderATPositions, 300);
      console.log('[ZState] Late-restore applied:', _pend.length, 'pending positions after journal load');
    }
  } catch (_pendErr) { console.warn('[ZState late-restore]', _pendErr.message); }
  _adaptLoad();  // [Etapa 5] restaurează BM.adaptive din localStorage (multiplieri imediat disponibili)
  registerServiceWorker();
  setPWAVersion();
  setupPWAReloadBtn();

  // Brain visual init (rAF + neurons) — purely visual, no data
  _initBrainCockpit();    // was IIFE, now gated function (req 4)

  // ═══════════════════════════════════════════════════════
  // PHASE 2 — DATA: safety engine + REST fetches (no WS yet)
  // WS connections are deferred to Phase 3 to ensure __wsGen
  // is fully stable after all synchronous initialization
  // ═══════════════════════════════════════════════════════
  initSafetyEngine();
  // [p19] Predator initial state — aprindem pillurile imediat la boot
  setTimeout(function () { if (typeof computePredatorState === 'function') { computePredatorState(); } }, 2000);

  // ── __wsGen MUTATION TRACER (debug — logs any increment with stack) ──
  (function () {
    let _tracerActive = true;
    const _rawGen = window.__wsGen || 0;
    let _value = _rawGen;
    Object.defineProperty(window, '__wsGen', {
      get() { return _value; },
      set(v) {
        if (_tracerActive && v !== _value) {
          console.warn(`[__wsGen] changed ${_value} → ${v}`, new Error().stack?.split('\n').slice(1, 4).join(' | '));
        }
        _value = v;
      },
      configurable: true,
    });
    // Disable tracer after 10s (avoid noise during normal symbol switches)
    setTimeout(() => { _tracerActive = false; }, 10000);
  })();

  // ── ZLOG install + safeAsync hooks (v90) ────────────────────────
  // Install patches over atLog/devLog — non-invasive, idempotent
  ZLOG.install();
  // Wrap async fetch/scan functions with safeAsync — at boot, after all fn declarations
  // opts.silent=true → no atLog UI noise for routine fetchers (just ZLOG + console)
  fetchKlines = safeAsync(fetchKlines, 'fetchKlines', { silent: true });
  fetchAllRSI = safeAsync(fetchAllRSI, 'fetchAllRSI', { silent: true });
  fetchFG = safeAsync(fetchFG, 'fetchFG', { silent: true });
  fetchATR = safeAsync(fetchATR, 'fetchATR', { silent: true });
  fetchOI = safeAsync(fetchOI, 'fetchOI', { silent: true });
  fetchLS = safeAsync(fetchLS, 'fetchLS', { silent: true });
  fetch24h = safeAsync(fetch24h, 'fetch24h', { silent: true });
  fetchSymbolKlines = safeAsync(fetchSymbolKlines, 'fetchSymbolKlines', { silent: true });
  runMultiSymbolScan = safeAsync(runMultiSymbolScan, 'runMultiSymbolScan', { silent: false });
  runBacktest = safeAsync(runBacktest, 'runBacktest', { silent: false });
  ZLOG.push('INFO', '[ZLOG v90] installed — safeAsync hooks active on 10 functions');
  console.log('[ZLOG v90] install complete | safeAsync hooks: 10 functions wrapped');

  // Initial REST fetches (cold start data)
  fetchKlines('5m');
  fetchAllRSI();
  fetchFG();
  fetchATR();
  fetchOI();
  fetchLS();
  fetch24h();

  // [ATR PARITY CHECK v88] — runs once after data warms up (~8s delay)
  setTimeout(function () {
    try {
      const atrLive = S.atr || null;
      // Compute ATR from S.klines (5m TF) for comparison — different TF than live (1h), expected delta
      const atrFrom5m = (S.klines && S.klines.length >= 16)
        ? _calcATRSeries(S.klines.slice(-32), 14, 'wilder').last
        : null;
      const diffPct = (atrLive && atrFrom5m)
        ? Math.abs(atrLive - atrFrom5m) / atrLive * 100
        : null;
      console.log('[ATR PARITY v88]', {
        atrLive_1h: atrLive ? atrLive.toFixed(4) : null,
        atrFrom5m: atrFrom5m ? atrFrom5m.toFixed(4) : null,
        diffPct: diffPct ? diffPct.toFixed(1) + '%' : 'N/A',
        note: 'TF mismatch normal (live=1h, check=5m). Backtest uses same Wilder fn.'
      });
    } catch (e) { console.warn('[ATR PARITY] check error:', e.message); }
  }, 8000);

  // Periodic DATA intervals (req 4 — data tier)
  Intervals.set('rsi', fetchAllRSI, 120000);
  Intervals.set('fg', fetchFG, 300000);
  Intervals.set('atr', fetchATR, 300000);
  Intervals.set('oi', fetchOI, 30000);
  Intervals.set('ls', fetchLS, 60000);
  Intervals.set('h24', fetch24h, 60000);
  Intervals.set('oidelta', trackOIDelta, 30000);
  Intervals.set('clock', updateQuantumClock, 1000);
  // [Etapa 5] Adaptive Control — startup recalc (safe mode: delay 2s, throttled la 30min)
  // Dacă ADAPTIVE OFF la boot → nu recalculează (mai puțin CPU)
  setTimeout(function () {
    if (BM.adaptive && BM.adaptive.enabled) {
      recalcAdaptive(true); // isStartup=true, ignoră throttle guard la primul run
    }
    _renderAdaptivePanel();
  }, 2000);
  // Interval 1h pentru recalc periodic
  Intervals.set('adaptiveRecalc', function () { recalcAdaptive(false); _pmCheckRegimeTransition(); }, 60 * 60 * 1000);
  // Interval 5m pentru RegimeWatch — detecție mai frecventă decât recalcAdaptive
  Intervals.set('regimeWatch', function () { _pmCheckRegimeTransition(); if (typeof ARES !== 'undefined') ARES.tick(); }, 5 * 60 * 1000);

  // ═══════════════════════════════════════════════════════
  // PHASE 3 — STATE: restore saved state, THEN open WS
  // WS connect here so __wsGen is already at its final value
  // ═══════════════════════════════════════════════════════
  setTimeout(() => {
    // Restore already ran at boot (top of startApp). Refresh UI now that DOM is ready.
    if (_earlyRestored) {
      atLog('info', '💾 State restaurat din localStorage. Pozitii rambarcate.');
      setTimeout(() => { updateATStats(); updateDemoBalance(); renderDemoPositions(); renderATPositions(); }, 200);
    }

    // Server sync pull — merge newer state from server (PC <-> Phone)
    console.log('[sync] Starting pullFromServer...');
    var _isPulling = true; // [FIX H10] guard: prevent save during pull
    ZState.pullFromServer().then(function (serverSnap) {
      console.log('[sync] pullFromServer returned:', serverSnap ? 'data (ts=' + serverSnap.ts + ', pos=' + (serverSnap.positions || []).length + ')' : 'null');
      if (!serverSnap || !serverSnap.ts) { ZState.markSyncReady(); return; }
      var localSnap = ZState.load();
      var localTs = (localSnap && localSnap.ts) ? localSnap.ts : 0;
      var localPositions = (typeof TP !== 'undefined' && Array.isArray(TP.demoPositions)) ? TP.demoPositions.length : 0;
      var serverPositions = (serverSnap.positions || []).length;
      console.log('[sync] serverTs:', serverSnap.ts, 'localTs:', localTs, 'localPos:', localPositions, 'serverPos:', serverPositions);
      // Apply if: server is newer OR we have no local positions but server does
      if (serverSnap.ts > localTs || (localPositions === 0 && serverPositions > 0)) {
        console.log('[sync] Applying server state (reason:', serverSnap.ts > localTs ? 'newer' : 'local empty, server has positions', ')');
        if (typeof TP !== 'undefined') {
          // [PATCH5] Guard: do not overwrite balance from server if local has active positions but server has none
          var _localActive = (TP.demoPositions || []).filter(function (p) { return !p.closed; }).length;
          var _serverPosN = (serverSnap.positions || []).length;
          // [FIX C9] Also guard against large position set divergence (>2 positions difference)
          var _posDivergence = Math.abs(_localActive - _serverPosN);
          if (_localActive > 0 && _serverPosN === 0) {
            console.warn('[sync] Boot — server has 0 positions but local has ' + _localActive + ' — skipping balance overwrite');
          } else if (_posDivergence > 2 && _localActive > 0) {
            console.warn('[sync] Boot — position sets diverge by ' + _posDivergence + ' — skipping balance overwrite to prevent corruption');
          } else {
            if (typeof serverSnap.demoBalance === 'number' && isFinite(serverSnap.demoBalance)) TP.demoBalance = serverSnap.demoBalance;
            if (typeof serverSnap.demoPnL === 'number' && isFinite(serverSnap.demoPnL)) TP.demoPnL = serverSnap.demoPnL;
            if (typeof serverSnap.demoWins === 'number' && isFinite(serverSnap.demoWins)) TP.demoWins = serverSnap.demoWins;
            if (typeof serverSnap.demoLosses === 'number' && isFinite(serverSnap.demoLosses)) TP.demoLosses = serverSnap.demoLosses;
          }
        }
        // [PATCH2] Merge AT state from server (kill switch, daily counters)
        if (serverSnap.at && typeof AT !== 'undefined') {
          if (typeof serverSnap.at.killTriggered === 'boolean') AT.killTriggered = serverSnap.at.killTriggered;
          if (typeof serverSnap.at.realizedDailyPnL === 'number') AT.realizedDailyPnL = serverSnap.at.realizedDailyPnL;
          if (typeof serverSnap.at.closedTradesToday === 'number') AT.closedTradesToday = serverSnap.at.closedTradesToday;
        }
        if (serverSnap.positions && serverSnap.positions.length && typeof TP !== 'undefined') {
          TP.demoPositions = TP.demoPositions || [];
          var existingIds = new Set(TP.demoPositions.map(function (p) { return String(p.id); }));
          var closedIds = new Set((TP.journal || []).map(function (j) { return j.id; }).filter(Boolean).map(String));
          console.log('[sync] Merging', serverSnap.positions.length, 'server positions. Existing:', existingIds.size, 'Closed:', closedIds.size);
          serverSnap.positions.forEach(function (p) {
            if (p.closed || closedIds.has(String(p.id)) || existingIds.has(String(p.id))) {
              console.log('[sync] Skipped position', p.id, '(closed/exists)');
              return;
            }
            console.log('[sync] Adding position', p.id, p.side, p.sym);
            TP.demoPositions.push(Object.assign({}, p, { _restored: true }));
          });
        }
        setTimeout(function () {
          if (typeof updateDemoBalance === 'function') updateDemoBalance();
          if (typeof renderDemoPositions === 'function') renderDemoPositions();
          if (typeof renderATPositions === 'function') renderATPositions();
        }, 300);
        // Persist merged TP state (not raw server snap) — prevents overwrite of local positions
        ZState.saveLocal();
        console.log('[sync] Applied — bal: $' + (TP.demoBalance || 0).toFixed(2) + ', pos: ' + (TP.demoPositions || []).length);
      }
      _isPulling = false; // [FIX H10] release guard
      ZState.markSyncReady();
    }).catch(function () { _isPulling = false; ZState.markSyncReady(); });
    // Also pull journal from server — merge missing entries
    ZState.pullJournalFromServer().then(function (srvJournal) {
      if (!srvJournal || !srvJournal.length) return;
      if (!TP.journal || TP.journal.length === 0) {
        TP.journal = srvJournal;
        if (typeof renderTradeJournal === 'function') renderTradeJournal();
        console.log('[sync] Journal pulled from server:', srvJournal.length, 'entries');
      } else {
        var localIds = new Set(TP.journal.map(function (j) { return j.id; }).filter(Boolean).map(String));
        var added = 0;
        srvJournal.forEach(function (j) {
          if (j.id && !localIds.has(String(j.id))) { TP.journal.push(j); added++; }
        });
        if (added > 0) {
          TP.journal.sort(function (a, b) { return (b.id || 0) - (a.id || 0); });
          if (TP.journal.length > 200) TP.journal.length = 200;
          _safeLocalStorageSet('zt_journal', TP.journal.slice(0, 50));
          if (typeof renderTradeJournal === 'function') renderTradeJournal();
          console.log('[sync] Merged', added, 'journal entries from server');
        }
      }
    }).catch(function () { });

    Intervals.set('stateSave', function () { ZState.saveLocal(); }, 30000);

    // Connect WebSockets AFTER all state restore — ensures __wsGen is stable
    console.log('[startApp] 📡 phase 3: connecting WebSockets | __wsGen=', window.__wsGen);
    connectBNB();
    connectBYB();
    connectWatchlist();
  }, 1500);

  // ═══════════════════════════════════════════════════════
  // PHASE 4 — UI: brain loop, renders, signal scan
  // ═══════════════════════════════════════════════════════
  initActBar();
  startFRCountdown();

  // [US] Event delegation — salvăm setările AT la orice schimbare de input
  // Delegăm pe document pentru că panoul AT e mutat de initZeusGroups()
  document.addEventListener('change', function (e) {
    const t = e.target;
    const AT_INPUT_IDS = ['atLev', 'atSL', 'atRR', 'atSize', 'atMaxPos', 'atKillPct', 'atConfMin', 'atSigMin', 'atMultiSym'];
    if (AT_INPUT_IDS.includes(t.id)) {
      // [FIX v85.1 F2] Sync BM.confMin la schimbare UI — sursă unică de adevăr
      if (t.id === 'atConfMin' && typeof BM !== 'undefined') {
        BM.confMin = parseFloat(t.value) || 65;
      }
      _usScheduleSave();
    }
  });
  document.addEventListener('input', function (e) {
    const t = e.target;
    const AT_INPUT_IDS = ['atSL', 'atRR', 'atSize', 'atMaxPos', 'atKillPct', 'atConfMin', 'atSigMin'];
    if (AT_INPUT_IDS.includes(t.id)) {
      // [FIX v85.1 F2] Sync BM.confMin la input live
      if (t.id === 'atConfMin' && typeof BM !== 'undefined') {
        BM.confMin = parseFloat(t.value) || 65;
      }
      _usScheduleSave();
    }
  });

  // [US] Salvare periodică (fallback — capturează orice schimbare neinterceptată)
  Intervals.set('userSettingsSave', _usSave, 300000);  // la 5 minute

  // [v122 ANALYTICS] Periodic PERF save + PnL Lab condensed update
  Intervals.set('perfSave', function () {
    if (typeof savePerfToStorage === 'function') savePerfToStorage();
    _updatePnlLabCondensed();
  }, 60000);
  setTimeout(_updatePnlLabCondensed, 3000);

  // [RISK RAILS] Summary line — update on any input change inside .rr-panel
  var _rrPanel = document.querySelector('.rr-panel');
  if (_rrPanel) _rrPanel.addEventListener('input', updateRRSummary);
  updateRRSummary();

  setTimeout(runBrainUpdate, 2500);
  Intervals.set('brain', runBrainUpdate, 5000);
  Intervals.set('dslBanner', dslUpdateBanner, 2000);
  Intervals.set('atBanner', atUpdateBanner, 2000);
  Intervals.set('ptBanner', ptUpdateBanner, 2000); // update PT strip banner
  Intervals.set('brainExt', updateBrainExtension, 5000);

  setTimeout(renderDHF, 1200);
  Intervals.set('dhf', renderDHF, 60000);
  setTimeout(renderPerfTracker, 2000);
  setTimeout(() => { updateQuantumClock(); updateBrainExtension(); }, 3000);
  setTimeout(() => {
    brainThink('info', '🧠 Zeus Brain initializat. Astept date live...');
  }, 3200);

  // Signal scan + confluence (UI derived from data)
  setTimeout(runSignalScan, 4000);
  setTimeout(calcConfluenceScore, 5500);
  setTimeout(scanLiquidityMagnets, 9000);
  setTimeout(updateDeepDive, 11000); // [DeepDive] first render after data is ready
  setTimeout(runQuantumExitUpdate, 12000); // [QEB] first run after klines loaded
  setTimeout(updateScenarioUI, 13000); // [Scenario] first render
  setTimeout(computeMacroCortex, 8000); // [Macro] first compute after data settles
  // [DevMode] ready log — only visible if user enables dev panel
  setTimeout(function () {
    try { devLog('Developer Mode ready. Enable from Settings Hub ⚙️ → DEVELOPER tab.', 'info'); } catch (_) { }
  }, 5000);
  // [SettingsHub] populate once DOM + data are settled
  setTimeout(function () {
    try { hubPopulate(); } catch (_) { }
  }, 3000);
  // [P1-3] Chain confluence after scan for data coherence — single interval
  Intervals.set('scan', function () { runSignalScan(); try { calcConfluenceScore(); } catch (_) { } }, 30000);
  Intervals.set('magnets', ZT_safeInterval('magnets', scanLiquidityMagnets, 60000), 60000); // [v119-p6 FIX2B]
  Intervals.set('deepdive', updateDeepDive, 10000); // Deep Dive — narrative panel
  Intervals.set('qexit', runQuantumExitUpdate, 5000); // Quantum Exit Brain
  Intervals.set('scenario', updateScenarioUI, 3000); // Scenario Engine UI
  Intervals.set('macroCortex', computeMacroCortex, 6 * 60 * 60 * 1000); // Macro Cortex — 6h

  // ═══════════════════════════════════════════════════════
  // PHASE 5 — EXTRAS: DSL, scanner, AT — GATED on feed (req 5)
  // These only start after price feed is confirmed live
  // ═══════════════════════════════════════════════════════
  _waitForFeedThenStartExtras();

  // Restore VWAP if saved
  if (S.vwapOn) { const vb = el('vwapBtn'); if (vb) vb.classList.add('on'); }

  // [PERF] Global visibility flag — render functions check this to skip work when tab hidden
  window._ztVisible = !document.hidden;

  // Visibility refresh
  document.addEventListener('visibilitychange', () => {
    window._ztVisible = !document.hidden;
    if (document.visibilityState === 'visible') {
      fetchOI(); fetchLS(); fetchAllRSI();
      // Restart RAF chains that were paused
      if (typeof ZANIM !== 'undefined' && !ZANIM.running) startZAnim();
      // Pull latest state from server when app comes back to foreground
      if (typeof ZState !== 'undefined' && ZState.pullFromServer) {
        ZState.pullFromServer().then(function (serverSnap) {
          if (!serverSnap || !serverSnap.ts) return;
          var localSnap = ZState.load();
          var localTs = (localSnap && localSnap.ts) ? localSnap.ts : 0;
          if (serverSnap.ts > localTs) {
            console.log('[sync] Visibility resume — server has newer state, applying');
            if (typeof TP !== 'undefined') {
              // [PATCH5] Guard: do not overwrite balance from server if local has active positions but server has none
              var _localActiveCount = (TP.demoPositions || []).filter(function (p) { return !p.closed; }).length;
              var _serverPosCount = (serverSnap.positions || []).length;
              // [FIX C9] Also guard against large position set divergence
              var _visDivergence = Math.abs(_localActiveCount - _serverPosCount);
              if (_localActiveCount > 0 && _serverPosCount === 0) {
                console.warn('[sync] Visibility resume — server has 0 positions but local has ' + _localActiveCount + ' — skipping balance overwrite');
              } else if (_visDivergence > 2 && _localActiveCount > 0) {
                console.warn('[sync] Visibility resume — position sets diverge by ' + _visDivergence + ' — skipping balance overwrite');
              } else {
                if (typeof serverSnap.demoBalance === 'number') TP.demoBalance = serverSnap.demoBalance;
                if (typeof serverSnap.demoPnL === 'number') TP.demoPnL = serverSnap.demoPnL;
                if (typeof serverSnap.demoWins === 'number') TP.demoWins = serverSnap.demoWins;
                if (typeof serverSnap.demoLosses === 'number') TP.demoLosses = serverSnap.demoLosses;
              }
              // [PATCH2] Merge AT state from server (kill switch, daily counters)
              if (serverSnap.at && typeof AT !== 'undefined') {
                if (typeof serverSnap.at.killTriggered === 'boolean') AT.killTriggered = serverSnap.at.killTriggered;
                if (typeof serverSnap.at.realizedDailyPnL === 'number') AT.realizedDailyPnL = serverSnap.at.realizedDailyPnL;
                if (typeof serverSnap.at.closedTradesToday === 'number') AT.closedTradesToday = serverSnap.at.closedTradesToday;
              }
              // Merge positions
              if (serverSnap.positions && serverSnap.positions.length) {
                var existingIds = new Set((TP.demoPositions || []).map(function (p) { return String(p.id); }));
                var closedIds = new Set((TP.journal || []).map(function (j) { return j.id; }).filter(Boolean).map(String));
                serverSnap.positions.forEach(function (p) {
                  if (p.closed || closedIds.has(String(p.id)) || existingIds.has(String(p.id))) return;
                  TP.demoPositions.push(Object.assign({}, p, { _restored: true }));
                });
              }
              // Persist merged TP state (not raw server snap)
              ZState.saveLocal();
              setTimeout(function () {
                if (typeof updateDemoBalance === 'function') updateDemoBalance();
                if (typeof renderDemoPositions === 'function') renderDemoPositions();
                if (typeof renderATPositions === 'function') renderATPositions();
              }, 200);
            }
          }
        }).catch(function () { });
      }
    } else {
      // Pause RAF chains— saves CPU in background tab
      if (typeof ZANIM !== 'undefined') ZANIM.running = false;
      // Save state locally when app goes to background (critical for mobile PWA)
      if (typeof ZState !== 'undefined') ZState.saveLocal();
    }
  });

  // [v119-p16] Sentinel — tab hidden gate + health indicator
  // Adițional față de handler-ul de mai sus, nu îl înlocuiește
  (function _installSentinel() {
    try {
      if (window.__ZT_SENTINEL_V1__) return;
      window.__ZT_SENTINEL_V1__ = true;

      // ── Setează flag tabHidden pe _SAFETY (citit de isDataOkForAutoTrade) ──
      function _onVisibilityChange() {
        try {
          const hidden = document.hidden;
          if (typeof _SAFETY !== 'undefined') _SAFETY.tabHidden = hidden;
          if (hidden) {
            // Când tab intră în background → BlockReason imediat, nu așteptăm watchdog
            if (typeof BlockReason !== 'undefined')
              BlockReason.set('TAB_HIDDEN', 'Tab în background — AT paused', 'sentinel');
            if (typeof ZLOG !== 'undefined')
              ZLOG.push('WARN', '[SENTINEL] Tab hidden → AT paused (tabHidden=true)');
          } else {
            // Tab revenit în foreground — set grace period for fresh data
            if (typeof _SAFETY !== 'undefined') { _SAFETY.tabHidden = false; _SAFETY.tabRestoreTs = Date.now(); }
            // BlockReason.clear() nu e chemat direct — îl va reseta runAutoTradeCheck
            // la primul tick bun, pentru a nu crea race cu alte blocaje active
            if (typeof ZLOG !== 'undefined')
              ZLOG.push('INFO', '[SENTINEL] Tab visible → tabHidden cleared, AT va relua la tick fresh');
          }
          _updateSentinelBar();
        } catch (_) { }
      }
      document.addEventListener('visibilitychange', _onVisibilityChange);

      // ── Health indicator UI — read-only, nu scrie în logică ──
      function _updateSentinelBar() {
        try {
          const bar = document.getElementById('zt-sentinel-bar');
          if (!bar) return;
          const hidden = document.hidden;
          const sf = (typeof _SAFETY !== 'undefined') ? _SAFETY : {};
          const lastTs = sf.lastPriceTs || 0;
          const dataAge = lastTs ? Math.round((Date.now() - lastTs) / 1000) : null;
          const stalled = !!sf.dataStalled;

          let txt, bg, col;
          if (hidden) {
            txt = '🔕 TAB HIDDEN — AT PAUSED';
            bg = 'rgba(180,100,0,0.18)'; col = '#FFB000';
          } else if (stalled) {
            txt = '⚠️ DATA STALLED — AT PAUSED';
            bg = 'rgba(255,0,51,0.15)'; col = '#ff3355';
          } else if (dataAge !== null && dataAge > 8) {
            txt = '⏳ DATA LAG ' + dataAge + 's';
            bg = 'rgba(180,100,0,0.12)'; col = '#f0c040';
          } else if (dataAge !== null) {
            txt = '✅ FEED OK ' + dataAge + 's';
            bg = 'rgba(0,200,100,0.10)'; col = '#00cc66';
          } else {
            txt = '— SENTINEL —';
            bg = 'rgba(60,80,100,0.10)'; col = '#445566';
          }
          bar.style.display = 'block';
          bar.style.background = bg;
          bar.style.color = col;
          bar.style.border = '1px solid ' + col + '44';
          bar.textContent = txt;
        } catch (_) { }
      }

      // ── Setare inițială la boot ──
      if (typeof _SAFETY !== 'undefined') _SAFETY.tabHidden = document.hidden;

      // ── Update UI periodic — interval mic, read-only, zero impact pe trading ──
      if (!window.__ZT_SENTINEL_TMR__) {
        window.__ZT_SENTINEL_TMR__ = Intervals.set('sentinel', function () {
          try { _updateSentinelBar(); } catch (_) { }
        }, 3000);
      }

      // Render imediat
      setTimeout(_updateSentinelBar, 500);

    } catch (e) { console.warn('[SENTINEL]', e && e.message ? e.message : e); }
  })();

  // Mark fully booted
  setTimeout(() => {
    window.ZEUS_BOOTED = true;
    window.dispatchEvent(new CustomEvent('zeusReady'));  // req 2: engine ready event
    atLog('info', '🛸 Zeus Terminal booted — PHASE 5 active');
    _renderBuildInfo(); // populate BUILD INFO panel once BUILD is guaranteed set
  }, 15000);

  // [SR] FALLBACK — garantăm că sr-sec ajunge în MI și e vizibil
  // Rulează la 3s după boot (după ce initZeusGroups a terminat sigur)
  setTimeout(_srEnsureVisible, 3000);

  // [DEV] FALLBACK — garantăm că dev-sec ajunge în MI și e vizibil dacă DEV.enabled
  // Rulează la 3.5s (după _srEnsureVisible, după ce toate mv() s-au stabilizat)
  setTimeout(_devEnsureVisible, 3500);

  setTimeout(() => { atLog('info', '🤖 Zeus Auto Trade Engine initializat. Configureaza si porneste mai sus.'); }, 6000);
}

// ── _renderBuildInfo() — populează #hub-build-info din window.BUILD ──
// Apelat la boot (după ce BUILD e setat). Safe fallback dacă elementul lipsește.

// Build info
function _renderBuildInfo() {
  try {
    var el = document.getElementById('hub-build-info');
    if (!el) return;
    var b = window.BUILD || {};
    var name = b.name || 'ZeuS';
    var ver = b.version || 'v90';
    var feat = Array.isArray(b.features) ? b.features.join(' · ') : '';
    var ts = b.ts ? new Date(b.ts).toLocaleTimeString() : '—';
    el.innerHTML =
      'Version: ' + name + ' ' + ver + '<br>' +
      (feat ? 'Features: ' + feat + '<br>' : '') +
      'Boot: ' + ts;
  } catch (e) { /* fallback static text remains */ }
}
// ✅ Window aliases for Android WebView compatibility
// Samsung Internet/WebView poate bloca accesul la functii din innerHTML onclick
if (typeof window !== 'undefined') {
  window.closeDemoPos = closeDemoPos;
  window.closeAutoPos = closeAutoPos;
  window.closeAllDemoPos = closeAllDemoPos;
  window.openPartialClose = openPartialClose;
  window.closeLivePos = closeLivePos; // BUG2: expose live close
  window.masterReset = masterReset;

  // [SettingsHub + DevMode] — critice pentru Samsung WebView / Android (onchange/onclick în innerHTML)
  window.hubToggleDev = hubToggleDev;
  window.hubPopulate = hubPopulate;
  window.hubSaveAll = hubSaveAll;
  window.hubLoadAll = hubLoadAll;
  window.hubSetTf = hubSetTf;
  window.hubSetTZ = hubSetTZ;
  window.hubApplyChartColors = hubApplyChartColors;
  window.hubCloudSave = hubCloudSave;
  window.hubCloudLoad = hubCloudLoad;
  window.hubCloudClear = hubCloudClear;
  window.hubResetDefaults = hubResetDefaults;
  window.devLog = devLog;
  window.devClearLog = devClearLog;
  window.devExportLog = devExportLog;
  window.devInjectSignal = devInjectSignal;
  window.devInjectLiquidation = devInjectLiquidation;
  window.devInjectWhale = devInjectWhale;
  window.devFeedDisconnect = devFeedDisconnect;
  window.devFeedRecover = devFeedRecover;
  window.devTriggerKillSwitch = devTriggerKillSwitch;
  window.devResetProtect = devResetProtect;
  window.devReplayStart = devReplayStart;
  window.devReplayStop = devReplayStop;
  // [QEB + Scenario] — advisory engine public API
  window.runQuantumExitUpdate = runQuantumExitUpdate;
  window.updateScenarioUI = updateScenarioUI;
  window.computeExitRisk = computeExitRisk;
  window.computeProbScore = computeProbScore;
  // [Level 5] Macro Cortex + Adaptive
  window.computeMacroCortex = computeMacroCortex;
  window.computePositionSizingMult = computePositionSizingMult;
  window.macroAdjustEntryScore = macroAdjustEntryScore;
  window.macroAdjustExitRisk = macroAdjustExitRisk;
  window.perfRecordTrade = perfRecordTrade;
  window.updateMacroUI = updateMacroUI;
  window.toggleAdaptive = toggleAdaptive;    // [Etapa 5]
  window.recalcAdaptive = recalcAdaptive;    // [Etapa 5]
  window.adaptiveStripToggle = adaptiveStripToggle; // [Etapa 5]

  // FIX 18: ZEUS namespace — centralized public API (backward compat, no breakage)
  window.ZEUS = window.ZEUS || {};
  Object.assign(window.ZEUS, {
    // Core state
    getState: () => S,
    getAT: () => AT,
    getDSL: () => DSL,
    getPerf: () => PERF,
    getTP: () => TP,
    // Key actions
    masterReset,
    setSymbol: typeof setSymbol !== 'undefined' ? setSymbol : null,
    setTf: typeof setTf !== 'undefined' ? setTf : null,
    // Diagnostics
    version: 'v122',
    allPrices,
    getPrice: sym => allPrices[sym] || wlPrices[sym]?.price || null,
  });
  // PWA setup runs from within startApp() Phase 1 — referenced via window aliases below
}

// PWA Service Worker registration and update banner logic
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    // Auto-reload when a new SW takes control (critical for phone getting new code)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('[PWA] New service worker activated — reloading page');
      window.location.reload();
    });
    navigator.serviceWorker.register('/sw.js').then(reg => {
      // Force update check on every page load (don't wait 24h)
      reg.update().catch(() => { });
      // Listen for updates
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed') {
              if (navigator.serviceWorker.controller) {
                // Send SKIP_WAITING to activate new SW immediately
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              }
            }
          });
        }
      });
    }).catch(err => {
      console.warn('[PWA] Service worker registration failed:', err);
    });
  }
}

function showPWAUpdateBanner() {
  const banner = document.getElementById('pwaUpdateBanner');
  if (banner) banner.style.display = 'flex';
}

function hidePWAUpdateBanner() {
  const banner = document.getElementById('pwaUpdateBanner');
  if (banner) banner.style.display = 'none';
}

// Set version display
function setPWAVersion() {
  const versionEl = document.getElementById('pwaVersion');
  if (versionEl && window.BUILD && window.BUILD.version) {
    versionEl.textContent = window.BUILD.version;
  }
}

// Add reload button logic
function setupPWAReloadBtn() {
  const btn = document.getElementById('pwaReloadBtn');
  if (btn) {
    btn.onclick = () => {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ action: 'skipWaiting' });
      }
      window.location.reload();
    };
  }
}

// PWA setup runs from within startApp() Phase 1 — no extra DOMContentLoaded needed


// Master reset
function masterReset() {
  if (!window.confirm('⚠️ MASTER RESET\nȘterge TOATE datele și repornește Zeus Terminal?\n\n• Poziții demo ✓\n• AT stats ✓\n• DSL state ✓\n• PERF tracker ✓\n• DHF win rates ✓\n• localStorage ✓')) return;

  // localStorage
  try { localStorage.clear(); } catch (e) { }

  // Session API keys
  API_KEY = ''; API_SECRET = '';

  // Demo positions
  if (typeof TP !== 'undefined') {
    TP.demoPositions = [];
    TP.livePositions = [];
    TP.demoBalance = 10000;
    TP.demoPnL = 0; TP.demoWins = 0; TP.demoLosses = 0;
  }

  // AT stats
  if (typeof AT !== 'undefined') {
    AT.enabled = false;
    AT.killTriggered = false;
    AT.totalTrades = 0; AT.wins = 0; AT.losses = 0;
    AT.totalPnL = 0; AT.dailyPnL = 0; AT.realizedDailyPnL = 0;
    AT.closedTradesToday = 0;
    AT.lastTradeTs = 0; AT.lastTradeSide = null;
  }

  // DSL state
  if (typeof DSL !== 'undefined') {
    DSL.positions = {};
    DSL.enabled = false;
  }

  // PERF tracker
  if (typeof PERF !== 'undefined') {
    Object.keys(PERF).forEach(k => { PERF[k].wins = 0; PERF[k].losses = 0; PERF[k].weight = 1.0; });
  }

  // DHF stats
  if (typeof DHF !== 'undefined') {
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(d => { if (DHF.days[d]) DHF.days[d].wins = DHF.days[d].losses = DHF.days[d].trades = 0; DHF.days[d].wr = 60; });
    Object.keys(DHF.hours || {}).forEach(h => { DHF.hours[h].wins = DHF.hours[h].losses = DHF.hours[h].trades = 0; DHF.hours[h].wr = 60; });
  }

  // BM protect mode
  if (typeof BM !== 'undefined') {
    BM.protectMode = false;
    BM.protectReason = '';
  }

  // BlockReason
  if (typeof BlockReason !== 'undefined') BlockReason.clear();

  // BUG-11 FIX: Clear all managed intervals and close all websockets before reload
  if (typeof Intervals !== 'undefined') Intervals.clearAll();
  if (typeof WS !== 'undefined') WS.closeAll();

  toast('🔄 Master Reset complet — reîncărcare...');
  setTimeout(() => location.reload(), 800);
}

// ─── HEARTBEAT RECONNECT ─────────────────────────────────────────

// Heartbeat reconnect
// ─── HEARTBEAT RECONNECT ─────────────────────────────────────────
(function () {
  let _lastTick = 0;
  let _armed = false;
  // Track every price tick
  const _origIngest = window.ingestPrice;
  window.ingestPrice = function (raw, source) {
    _lastTick = Date.now();
    _armed = true;
    return _origIngest ? _origIngest(raw, source) : false;
  };
  // Check every 5s — if no tick for 10s, force reconnect
  setInterval(function () {
    if (!_armed) return; // don't warn before first tick arrives
    if (Date.now() - _lastTick > 10000) {
      console.warn('[ZEUS] Heartbeat: no tick for 10s — forcing reconnect');
      try {
        if (typeof connectKlineWS === 'function') connectKlineWS(S.symbol || 'BTCUSDT', S.tf || '5m');
        if (typeof connectWatchlist === 'function') connectWatchlist();
      } catch (e) { console.error('[ZEUS] Reconnect error', e); }
      _lastTick = Date.now(); // prevent reconnect storm
    }
  }, 5000);
})();

// REQ 4: DOMContentLoaded #2 — closeAllBtn long-press
// (DOMContentLoaded #1 is OVI button in its own IIFE — both are benign)
if (!window._closeAllBtnInited) {
  window._closeAllBtnInited = true;
  document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('closeAllBtn');
    if (btn) {
      attachConfirmClose(btn, closeAllDemoPos);
    }
  });
}

// FIX: sigScanSec and other elements defined AFTER this script block.
// ═══════════════════════════════════════════════════════════════
// MIDSTACK — drag&drop reorder pentru cele 5 banere HUD
// Safe: mută doar noduri DOM, nu atinge logica/state/intervals
// ═══════════════════════════════════════════════════════════════
function initMidStack() {
  const STRIP_IDS = ['aria-strip', 'dsl-strip', 'mtf-strip', 'adaptive-strip', 'at-strip', 'pt-strip', 'nova-strip'];
  const LS_KEY = 'zt_midstack_order';

  // ── 1. Gasim primul strip în DOM ca referință de inserție ──
  const firstStrip = document.getElementById(STRIP_IDS[0]);
  if (!firstStrip) return; // safety

  // ── 2. Cream #midStack dacă nu există ──
  let ms = document.getElementById('midStack');
  if (!ms) {
    ms = document.createElement('div');
    ms.id = 'midStack';
    firstStrip.parentNode.insertBefore(ms, firstStrip);
  }

  // ── 3. Mutăm cele 5 strip-uri în #midStack (ordinea din LS sau default) ──
  let savedOrder = null;
  try { savedOrder = JSON.parse(localStorage.getItem(LS_KEY)); } catch (_) { }
  // Acceptă ordinea salvată dacă conține cel puțin toate ID-urile curente
  const savedValid = Array.isArray(savedOrder) && STRIP_IDS.every(id => savedOrder.includes(id));
  const order = savedValid
    ? STRIP_IDS.map(id => savedOrder.includes(id) ? id : id) // păstrează ordinea salvată
      .concat(savedOrder.filter(id => STRIP_IDS.includes(id))) // reconstruit în ordinea saved
    : [...STRIP_IDS];
  // Reconstruit corect: ordinea din saved, dar doar cu ID-urile valide
  const finalOrder = savedValid
    ? savedOrder.filter(id => STRIP_IDS.includes(id))
      .concat(STRIP_IDS.filter(id => !savedOrder.includes(id)))
    : [...STRIP_IDS];

  finalOrder.forEach(id => {
    const el = document.getElementById(id);
    if (el) ms.appendChild(el);
  });

  // ── 4. Buton toggle reorder mode ──
  let toggleBtn = document.getElementById('midStack-toggle');
  if (!toggleBtn) {
    toggleBtn = document.createElement('div');
    toggleBtn.id = 'midStack-toggle';
    toggleBtn.title = 'Reorder panels';
    toggleBtn.innerHTML = '⠿';
    document.body.appendChild(toggleBtn);
  }

  let reorderMode = false;

  function enterReorder() {
    reorderMode = true;
    ms.classList.add('reorder-mode');
    ms.querySelectorAll('[data-panel]').forEach(el => { el.draggable = true; });
    toggleBtn.classList.add('active');   // apare butonul
    toggleBtn.innerHTML = '✕';
    if (navigator.vibrate) navigator.vibrate(40);
  }

  function exitReorder() {
    reorderMode = false;
    ms.classList.remove('reorder-mode');
    ms.querySelectorAll('[data-panel]').forEach(el => { el.draggable = false; });
    toggleBtn.classList.remove('active'); // dispare butonul
    toggleBtn.innerHTML = '⠿';
    // Salvăm ordinea
    const newOrder = [...ms.querySelectorAll('[data-panel]')].map(el => el.id);
    try { localStorage.setItem(LS_KEY, JSON.stringify(newOrder)); } catch (_) { }
  }

  toggleBtn.addEventListener('click', () => reorderMode ? exitReorder() : enterReorder());

  // ── 5. Long-press 700ms pe mobil (cu anti-scroll threshold 10px) ──
  let _lpTimer = null, _lpStartX = 0, _lpStartY = 0, _lpCancelled = false;

  ms.addEventListener('touchstart', e => {
    if (reorderMode) return;
    const t = e.touches[0];
    _lpStartX = t.clientX; _lpStartY = t.clientY; _lpCancelled = false;
    _lpTimer = setTimeout(() => { if (!_lpCancelled) enterReorder(); }, 700);
  }, { passive: true });

  ms.addEventListener('touchmove', e => {
    if (_lpTimer) {
      const t = e.touches[0];
      const dx = Math.abs(t.clientX - _lpStartX);
      const dy = Math.abs(t.clientY - _lpStartY);
      if (dx > 10 || dy > 10) { clearTimeout(_lpTimer); _lpTimer = null; _lpCancelled = true; }
    }
  }, { passive: true });

  ms.addEventListener('touchend', () => { clearTimeout(_lpTimer); _lpTimer = null; });

  // ── 6. Drag&drop — Desktop (HTML5 DnD) ──
  let _dragEl = null;

  ms.addEventListener('dragstart', e => {
    if (!reorderMode) return;
    _dragEl = e.target.closest('[data-panel]');
    if (!_dragEl) return;
    _dragEl.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  ms.addEventListener('dragend', () => {
    if (_dragEl) { _dragEl.classList.remove('dragging'); _dragEl = null; }
    ms.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    if (reorderMode) {
      const newOrder = [...ms.querySelectorAll('[data-panel]')].map(el => el.id);
      try { localStorage.setItem(LS_KEY, JSON.stringify(newOrder)); } catch (_) { }
    }
  });

  ms.addEventListener('dragover', e => {
    if (!reorderMode || !_dragEl) return;
    e.preventDefault();
    const over = e.target.closest('[data-panel]');
    if (!over || over === _dragEl) return;
    ms.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    over.classList.add('drag-over');
    // Inserție live
    const rect = over.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (e.clientY < mid) ms.insertBefore(_dragEl, over);
    else ms.insertBefore(_dragEl, over.nextSibling);
  });

  ms.addEventListener('dragleave', e => {
    const over = e.target.closest('[data-panel]');
    if (over) over.classList.remove('drag-over');
  });

  ms.addEventListener('drop', e => { e.preventDefault(); });

  // ── 7. Touch drag&drop — Mobil ──
  let _tDragEl = null, _tClone = null, _tOffX = 0, _tOffY = 0;

  ms.addEventListener('touchstart', e => {
    if (!reorderMode) return;
    const strip = e.target.closest('[data-panel]');
    if (!strip) return;
    _tDragEl = strip;
    const touch = e.touches[0];
    const rect = strip.getBoundingClientRect();
    _tOffX = touch.clientX - rect.left;
    _tOffY = touch.clientY - rect.top;
    // Clone vizual
    _tClone = strip.cloneNode(true);
    _tClone.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;opacity:.6;pointer-events:none;z-index:9999;`;
    document.body.appendChild(_tClone);
    strip.style.opacity = '0.3';
  }, { passive: true });

  ms.addEventListener('touchmove', e => {
    if (!reorderMode || !_tDragEl || !_tClone) return;
    e.preventDefault();
    const touch = e.touches[0];
    _tClone.style.left = (touch.clientX - _tOffX) + 'px';
    _tClone.style.top = (touch.clientY - _tOffY) + 'px';
    // Determina over ce element suntem
    _tClone.style.display = 'none';
    const elBelow = document.elementFromPoint(touch.clientX, touch.clientY);
    _tClone.style.display = '';
    const over = elBelow?.closest('[data-panel]');
    ms.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    if (over && over !== _tDragEl) {
      over.classList.add('drag-over');
      const rect = over.getBoundingClientRect();
      if (touch.clientY < rect.top + rect.height / 2) ms.insertBefore(_tDragEl, over);
      else ms.insertBefore(_tDragEl, over.nextSibling);
    }
  }, { passive: false });

  const _tEnd = () => {
    if (_tDragEl) { _tDragEl.style.opacity = ''; _tDragEl = null; }
    if (_tClone) { _tClone.remove(); _tClone = null; }
    ms.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    if (reorderMode) {
      const newOrder = [...ms.querySelectorAll('[data-panel]')].map(el => el.id);
      try { localStorage.setItem(LS_KEY, JSON.stringify(newOrder)); } catch (_) { }
    }
  };

  ms.addEventListener('touchend', _tEnd, { passive: true });
  ms.addEventListener('touchcancel', _tEnd, { passive: true });
}

// startApp() must run only after full DOM is parsed, else initZeusGroups
// ── DESKTOP RESPONSIVE CHART RESIZE ──────────────────────────────
(function () {
  let _rzTimer = null;
  function _resizeCharts() {
    if (typeof mainChart === 'undefined' || !mainChart) return;
    const w = getChartW();
    const h = getChartH();
    try {
      mainChart.applyOptions({ width: w, height: h });
      if (typeof cvdChart !== 'undefined' && cvdChart) cvdChart.applyOptions({ width: w, height: window.innerWidth >= 1000 ? 80 : 60 });
      if (typeof volChart !== 'undefined' && volChart) volChart.applyOptions({ width: w, height: window.innerWidth >= 1000 ? 60 : 44 });
      if (typeof macdChart !== 'undefined' && macdChart) macdChart.applyOptions({ width: w });
      // v104: preserve rightOffset:12 on aux at every resize
      try { if (cvdChart) cvdChart.timeScale().applyOptions({ rightOffset: 12 }); } catch (_) { }
      try { if (volChart) volChart.timeScale().applyOptions({ rightOffset: 12 }); } catch (_) { }
      try { if (typeof _macdChart !== 'undefined' && _macdChart) _macdChart.timeScale().applyOptions({ rightOffset: 12 }); } catch (_) { }
    } catch (e) { }
  }
  window.addEventListener('resize', function () {
    clearTimeout(_rzTimer);
    _rzTimer = setTimeout(_resizeCharts, 120);
  });
  // Run once after boot to correct desktop chart size
  window.addEventListener('zeusReady', function () {
    setTimeout(_resizeCharts, 500);
  });
})();

// fails to move panels and they appear duplicated in original positions.
// [v119] GLOBAL ERROR BOUNDARY — arata bannerul vizual la orice eroare necapturata

// MidStack init
function initMidStack() {
  const STRIP_IDS = ['aria-strip', 'dsl-strip', 'mtf-strip', 'adaptive-strip', 'at-strip', 'pt-strip', 'nova-strip'];
  const LS_KEY = 'zt_midstack_order';

  // ── 1. Gasim primul strip în DOM ca referință de inserție ──
  const firstStrip = document.getElementById(STRIP_IDS[0]);
  if (!firstStrip) return; // safety

  // ── 2. Cream #midStack dacă nu există ──
  let ms = document.getElementById('midStack');
  if (!ms) {
    ms = document.createElement('div');
    ms.id = 'midStack';
    firstStrip.parentNode.insertBefore(ms, firstStrip);
  }

  // ── 3. Mutăm cele 5 strip-uri în #midStack (ordinea din LS sau default) ──
  let savedOrder = null;
  try { savedOrder = JSON.parse(localStorage.getItem(LS_KEY)); } catch (_) { }
  // Acceptă ordinea salvată dacă conține cel puțin toate ID-urile curente
  const savedValid = Array.isArray(savedOrder) && STRIP_IDS.every(id => savedOrder.includes(id));
  const order = savedValid
    ? STRIP_IDS.map(id => savedOrder.includes(id) ? id : id) // păstrează ordinea salvată
      .concat(savedOrder.filter(id => STRIP_IDS.includes(id))) // reconstruit în ordinea saved
    : [...STRIP_IDS];
  // Reconstruit corect: ordinea din saved, dar doar cu ID-urile valide
  const finalOrder = savedValid
    ? savedOrder.filter(id => STRIP_IDS.includes(id))
      .concat(STRIP_IDS.filter(id => !savedOrder.includes(id)))
    : [...STRIP_IDS];

  finalOrder.forEach(id => {
    const el = document.getElementById(id);
    if (el) ms.appendChild(el);
  });

  // ── 4. Buton toggle reorder mode ──
  let toggleBtn = document.getElementById('midStack-toggle');
  if (!toggleBtn) {
    toggleBtn = document.createElement('div');
    toggleBtn.id = 'midStack-toggle';
    toggleBtn.title = 'Reorder panels';
    toggleBtn.innerHTML = '⠿';
    document.body.appendChild(toggleBtn);
  }

  let reorderMode = false;

  function enterReorder() {
    reorderMode = true;
    ms.classList.add('reorder-mode');
    ms.querySelectorAll('[data-panel]').forEach(el => { el.draggable = true; });
    toggleBtn.classList.add('active');   // apare butonul
    toggleBtn.innerHTML = '✕';
    if (navigator.vibrate) navigator.vibrate(40);
  }

  function exitReorder() {
    reorderMode = false;
    ms.classList.remove('reorder-mode');
    ms.querySelectorAll('[data-panel]').forEach(el => { el.draggable = false; });
    toggleBtn.classList.remove('active'); // dispare butonul
    toggleBtn.innerHTML = '⠿';
    // Salvăm ordinea
    const newOrder = [...ms.querySelectorAll('[data-panel]')].map(el => el.id);
    try { localStorage.setItem(LS_KEY, JSON.stringify(newOrder)); } catch (_) { }
  }

  toggleBtn.addEventListener('click', () => reorderMode ? exitReorder() : enterReorder());

  // ── 5. Long-press 700ms pe mobil (cu anti-scroll threshold 10px) ──
  let _lpTimer = null, _lpStartX = 0, _lpStartY = 0, _lpCancelled = false;

  ms.addEventListener('touchstart', e => {
    if (reorderMode) return;
    const t = e.touches[0];
    _lpStartX = t.clientX; _lpStartY = t.clientY; _lpCancelled = false;
    _lpTimer = setTimeout(() => { if (!_lpCancelled) enterReorder(); }, 700);
  }, { passive: true });

  ms.addEventListener('touchmove', e => {
    if (_lpTimer) {
      const t = e.touches[0];
      const dx = Math.abs(t.clientX - _lpStartX);
      const dy = Math.abs(t.clientY - _lpStartY);
      if (dx > 10 || dy > 10) { clearTimeout(_lpTimer); _lpTimer = null; _lpCancelled = true; }
    }
  }, { passive: true });

  ms.addEventListener('touchend', () => { clearTimeout(_lpTimer); _lpTimer = null; });

  // ── 6. Drag&drop — Desktop (HTML5 DnD) ──
  let _dragEl = null;

  ms.addEventListener('dragstart', e => {
    if (!reorderMode) return;
    _dragEl = e.target.closest('[data-panel]');
    if (!_dragEl) return;
    _dragEl.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  ms.addEventListener('dragend', () => {
    if (_dragEl) { _dragEl.classList.remove('dragging'); _dragEl = null; }
    ms.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    if (reorderMode) {
      const newOrder = [...ms.querySelectorAll('[data-panel]')].map(el => el.id);
      try { localStorage.setItem(LS_KEY, JSON.stringify(newOrder)); } catch (_) { }
    }
  });

  ms.addEventListener('dragover', e => {
    if (!reorderMode || !_dragEl) return;
    e.preventDefault();
    const over = e.target.closest('[data-panel]');
    if (!over || over === _dragEl) return;
    ms.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    over.classList.add('drag-over');
    // Inserție live
    const rect = over.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (e.clientY < mid) ms.insertBefore(_dragEl, over);
    else ms.insertBefore(_dragEl, over.nextSibling);
  });

  ms.addEventListener('dragleave', e => {
    const over = e.target.closest('[data-panel]');
    if (over) over.classList.remove('drag-over');
  });

  ms.addEventListener('drop', e => { e.preventDefault(); });

  // ── 7. Touch drag&drop — Mobil ──
  let _tDragEl = null, _tClone = null, _tOffX = 0, _tOffY = 0;

  ms.addEventListener('touchstart', e => {
    if (!reorderMode) return;
    const strip = e.target.closest('[data-panel]');
    if (!strip) return;
    _tDragEl = strip;
    const touch = e.touches[0];
    const rect = strip.getBoundingClientRect();
    _tOffX = touch.clientX - rect.left;
    _tOffY = touch.clientY - rect.top;
    // Clone vizual
    _tClone = strip.cloneNode(true);
    _tClone.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;opacity:.6;pointer-events:none;z-index:9999;`;
    document.body.appendChild(_tClone);
    strip.style.opacity = '0.3';
  }, { passive: true });

  ms.addEventListener('touchmove', e => {
    if (!reorderMode || !_tDragEl || !_tClone) return;
    e.preventDefault();
    const touch = e.touches[0];
    _tClone.style.left = (touch.clientX - _tOffX) + 'px';
    _tClone.style.top = (touch.clientY - _tOffY) + 'px';
    // Determina over ce element suntem
    _tClone.style.display = 'none';
    const elBelow = document.elementFromPoint(touch.clientX, touch.clientY);
    _tClone.style.display = '';
    const over = elBelow?.closest('[data-panel]');
    ms.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    if (over && over !== _tDragEl) {
      over.classList.add('drag-over');
      const rect = over.getBoundingClientRect();
      if (touch.clientY < rect.top + rect.height / 2) ms.insertBefore(_tDragEl, over);
      else ms.insertBefore(_tDragEl, over.nextSibling);
    }
  }, { passive: false });

  const _tEnd = () => {
    if (_tDragEl) { _tDragEl.style.opacity = ''; _tDragEl = null; }
    if (_tClone) { _tClone.remove(); _tClone = null; }
    ms.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    if (reorderMode) {
      const newOrder = [...ms.querySelectorAll('[data-panel]')].map(el => el.id);
      try { localStorage.setItem(LS_KEY, JSON.stringify(newOrder)); } catch (_) { }
    }
  };

  ms.addEventListener('touchend', _tEnd, { passive: true });
  ms.addEventListener('touchcancel', _tEnd, { passive: true });
}

// startApp() must run only after full DOM is parsed, else initZeusGroups
// ── DESKTOP RESPONSIVE CHART RESIZE ──────────────────────────────
(function () {
  let _rzTimer = null;
  function _resizeCharts() {
    if (typeof mainChart === 'undefined' || !mainChart) return;
    const w = getChartW();
    const h = getChartH();
    try {
      mainChart.applyOptions({ width: w, height: h });
      if (typeof cvdChart !== 'undefined' && cvdChart) cvdChart.applyOptions({ width: w, height: window.innerWidth >= 1000 ? 80 : 60 });
      if (typeof volChart !== 'undefined' && volChart) volChart.applyOptions({ width: w, height: window.innerWidth >= 1000 ? 60 : 44 });
      if (typeof macdChart !== 'undefined' && macdChart) macdChart.applyOptions({ width: w });
      // v104: preserve rightOffset:12 on aux at every resize
      try { if (cvdChart) cvdChart.timeScale().applyOptions({ rightOffset: 12 }); } catch (_) { }
      try { if (volChart) volChart.timeScale().applyOptions({ rightOffset: 12 }); } catch (_) { }
      try { if (typeof _macdChart !== 'undefined' && _macdChart) _macdChart.timeScale().applyOptions({ rightOffset: 12 }); } catch (_) { }
    } catch (e) { }
  }
  window.addEventListener('resize', function () {
    clearTimeout(_rzTimer);
    _rzTimer = setTimeout(_resizeCharts, 120);
  });
  // Run once after boot to correct desktop chart size
  window.addEventListener('zeusReady', function () {
    setTimeout(_resizeCharts, 500);
  });
})();

// fails to move panels and they appear duplicated in original positions.
// [v119] GLOBAL ERROR BOUNDARY — arata bannerul vizual la orice eroare necapturata

// [PATCH4] Filtered global error handler — only show ENGINE ERROR banner for critical engine errors
// Stray TypeErrors, layout reflow noise, and third-party script errors are logged but do NOT trigger the scary banner
window.addEventListener("error", function (e) {
  console.error("[ZEUS][GlobalError]", e.message, e.filename, e.lineno);
  // Only show engine error banner for errors originating from core engine files
  var fn = (e.filename || '').toLowerCase();
  var isCoreEngine = fn.indexOf('/brain/') !== -1 || fn.indexOf('/core/') !== -1 || fn.indexOf('/trading/') !== -1 || fn.indexOf('/data/') !== -1;
  if (isCoreEngine && e.message && !/resizeobserver|script error/i.test(e.message)) {
    var banner = document.getElementById("engineErrorBanner");
    if (banner) banner.style.display = "block";
  }
});

// [v119] __ZEUS_INIT__ guard — previne dubla initializare (ex: hot-reload, multiple script tags)
if (window.__ZEUS_INIT__) {
  console.warn('[ZEUS] __ZEUS_INIT__ already set — boot blocked.');
} else {
  window.__ZEUS_INIT__ = true;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
  } else {
    startApp();
  }
}

