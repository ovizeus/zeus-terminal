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

  const mi = document.getElementById('zeus-groups');
  // All content goes into #zeus-groups directly (no sub-group wrappers)
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
    banner.innerHTML = '\u26A0\uFE0F Some panels could not load correctly. <strong>Click here to retry.<\/strong>';
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

  // ── LAYOUT: MODE BAR → panels inline → CHART → DOCK → BRAIN ──
  mv('zeus-mode-bar', mi);  // 1. Global Execution Mode Bar — top of content
  if (typeof initModeBar === 'function') initModeBar(); // populate mode bar
  mv('aub', mi);             // Alien Upgrade Bay
  mv('sr-strip', mi);        // Signal Registry strip
  mv('csec', mi);            // Chart section
  mv('zeus-dock', mi);       // Icon Dock — sub chart
  if (typeof initPageView === 'function') initPageView();
  if (typeof initZeusDock === 'function') initZeusDock();
  mv('aria-strip', mi);      // ARIA HUD strip
  mv('teacher-strip', mi);   // THE TEACHER
  mv('pnl-lab-strip', mi);   // PnL Lab strip
  mv('dsl-strip', mi);       // DSL banner strip
  mv('at-strip', mi);        // AT banner strip
  mv('pt-strip', mi);        // Paper Trading banner strip
  mv('nova-strip', mi);      // NOVA HUD strip
  mv('mtf-strip', mi);       // MTF Structural Model
  mv('adaptive-strip', mi);  // Adaptive strip
  mv('actfeed-strip', mi);   // Activity feed strip
  mv('zeusBrain', mi);       // Brain / cockpit
  mv('brainExt', mi);        // Brain extension panel
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
    // Safety: reveal if no dock restore pending (feed-gate handles dock case)
    if (!sessionStorage.getItem('zeusDock')) var _sp=document.getElementById('_dockSplash');if(_sp)_sp.remove();
  }, 500);

  // Absolute safety: if feed never comes, reveal after 5s
  setTimeout(function() { var _sp=document.getElementById('_dockSplash');if(_sp)_sp.remove(); }, 5000);

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
        atLog('warn', '[WARN] Extras started without confirmed feed (timeout)');
      } else {
        atLog('info', '[OK] Feed confirmed — starting DSL + scanner extras');
      }
      _startExtras();
      // UI context restore — AFTER DOM ready + charts init + WS established
      // Only restores display state (sound, AT log). Live data always wins.
      if (typeof _ctxLoad === 'function') _ctxLoad();
      // Cross-device sync — pull user preferences from server (per-user, JWT-auth)
      if (typeof _userCtxPull === 'function') _userCtxPull();
      // Retry any pending sendBeacon payloads that failed on previous session close
      if (typeof _ucRetryPendingBeacon === 'function') _ucRetryPendingBeacon();
      // Restore page view if was open before refresh (seamless — no home flash)
      try {
        var _sd = sessionStorage.getItem('zeusDock');
        if (_sd && typeof openPageView === 'function') openPageView(_sd);
      } catch(_e) {}
      // Reveal page (hidden by <head> script when restoring dock)
      var _sp=document.getElementById('_dockSplash');if(_sp)_sp.remove();
      // Restore page view if was open before refresh
      try {
        var _sd = sessionStorage.getItem('zeusDock');
        if (_sd && typeof openPageView === 'function') openPageView(_sd);
      } catch(_e) {}
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

  atLog('info', '[INIT] Extras module online');

  // ── Periodic live position sync (exchange truth every 30s) ──
  Intervals.set('livePosSync', function () {
    if (typeof TP !== 'undefined' && TP.liveConnected && typeof liveApiSyncState === 'function') {
      liveApiSyncState();
    }
  }, 30000);

  // ── Resume AutoTrade if it was enabled before reload ──
  if (typeof AT !== 'undefined' && AT.enabled && !AT.killTriggered) {
    // AT.enabled was restored from localStorage — kick-start the scan interval + UI
    console.log('[startApp] AT was enabled before reload — resuming');
    // Update UI to reflect ON state
    const _btn = el('atMainBtn'); if (_btn) _btn.className = 'at-main-btn on';
    const _dot = el('atBtnDot'); if (_dot) { _dot.style.background = '#00ff88'; _dot.style.boxShadow = '0 0 10px #00ff88'; }
    const _txt = el('atBtnTxt'); if (_txt) _txt.textContent = 'AUTO TRADE ON';
    const _st = el('atStatus'); if (_st) _st.innerHTML = _ZI.dGrn + ' Active — scanning every 30s';
    if (!AT.interval) AT.interval = Intervals.set('atCheck', runAutoTradeCheck, 30000);
    setTimeout(runAutoTradeCheck, 3000); // first check after brief settle
    if (typeof atUpdateBanner === 'function') atUpdateBanner();
    if (typeof ptUpdateBanner === 'function') ptUpdateBanner();
    atLog('info', '[RESUME] AutoTrade resumed from saved state');
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

  // [HEALTH] MI: #zeus-groups exists and has at least one .sec child
  checks.mi = _check('zeus-groups', '.sec');
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
    console.warn('[HEALTH] One or more modules failed to mount:', checks);
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
    banner.innerHTML = _ZI.w + ` Incomplete interface — modules [${failed}] failed to load. Refresh the page.`;
    banner.style.display = 'block';
  } else {
    // Hide banner if all good
    const banner = document.getElementById('zg-health-banner');
    if (banner) banner.style.display = 'none';
    console.log('[HEALTH] All modules mounted OK');
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

// startApp — MAIN ENTRY POINT
async function startApp() {
  window._zeusBootTs = Date.now(); // timestamp for pull-overwrite guard
  // ─── GLOBAL BOOT GUARD (req 1, 7) ──────────────────────────
  if (window.ZEUS_STARTED) {
    console.warn('[ZEUS] startApp() called twice — ignoring duplicate boot');
    return;
  }
  window.ZEUS_STARTED = true;
  window.ZEUS_BOOTED = false;  // set true after full init

  // [B17b] PREBOOT: fetch AT state BEFORE localStorage restore
  // If serverAT is authoritative, _serverATEnabled is set BEFORE restore runs,
  // so restore() skips stale demo financial fields from localStorage
  try {
    var _prebootRes = await fetch('/api/at/state', { credentials: 'same-origin' });
    if (_prebootRes.ok) {
      var _prebootData = await _prebootRes.json();
      if (_prebootData && typeof ZState !== 'undefined' && typeof ZState._applyPreboot === 'function') {
        ZState._applyPreboot(_prebootData);
        console.log('[startApp] Preboot AT state applied — _serverATEnabled:', !!window._serverATEnabled);
      }
    }
  } catch (_) { console.log('[startApp] Preboot AT fetch skipped (offline or no auth)'); }

  // ── IMMEDIATE STATE RESTORE (before any code can save empty TP) ──
  const _earlyRestored = ZState.restore();
  if (_earlyRestored) {
    console.log('[startApp] State restored immediately at boot — positions in TP before Phase 1');
  }
  // ── BUILD MANIFEST (single source of truth) ──────────────────
  window.BUILD = window.BUILD || {
    name: 'ZeuS',
    version: 'v1.2.1',
    features: ['ServerAT', 'DSL', 'Brain', 'ARES', 'Reconciliation', 'ZLOG'],
    ts: Date.now(),
  };
  console.log('[startApp] boot sequence starting | __wsGen=', window.__wsGen);

  // PIN lock check — block UI immediately if PIN is set
  _pinCheckLock();

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
  // initMidStack() removed — all strips now in hidden-panels, accessed via dock page view
  initAdaptiveStrip();    // [Etapa 5] mută conținut adaptive-sec → adaptive-strip-panel
  initMTFStrip();         // MTF Structural Model — restaurează stare panou + interval gating
  loadUserSettings();     // [US] restore persisted user preferences (TF, TZ, indicators, AT params)
  _srLoad();              // [SR] restore signal registry from localStorage
  _ncLoad();              // [NC] restore notification center from localStorage
  // Health checks run after a short delay to let the 500ms safety timer settle
  setTimeout(runHealthChecks, 700);
  setTimeout(() => { _srUpdateStats(); _srRenderList(); srStripUpdateBar(); }, 800); // [SR] render initial
  setTimeout(_ncUpdateBadge, 900);  // [NC] update badge after load
  // [UPDATE CHECK] Check for app updates after boot
  setTimeout(_checkAppUpdate, 2000);
  initAUB();              // Alien Upgrade Bay — UI shell only, no intervals
  initARIANOVA();         // ARIA + NOVA HUD strips — init after groups moved
  initPMPanel();          // [v107] Post-Mortem panel — insertat după sr-strip
  initARES();
  // UI-3: relocate FLOW panel between ARES and POST-MORTEM
  (function _relocateFlow() {
    const flow = document.getElementById('flow-panel');
    const pm = document.getElementById('pm-strip');
    if (flow && pm && pm.parentNode) {
      pm.parentNode.insertBefore(flow, pm);
    }
  })();
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
  // Resume live pending order sync polling if any orders were restored
  if (typeof _resumeLivePendingSyncIfNeeded === 'function') _resumeLivePendingSyncIfNeeded();
  // Initialize order type toggle state
  if (typeof onDemoOrdTypeChange === 'function') setTimeout(onDemoOrdTypeChange, 200);
  // Render pending orders from restored state
  if (typeof renderPendingOrders === 'function') setTimeout(renderPendingOrders, 400);
  registerServiceWorker();
  setPWAVersion();
  setupPWAReloadBtn();

  // Brain visual init (rAF + neurons) — purely visual, no data
  _initBrainCockpit();    // was IIFE, now gated function (req 4)

  // [P1] Sync DOM input values → TradingConfig at boot
  if (typeof syncDOMtoTC === 'function') syncDOMtoTC();

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
  // Interval 5m for RegimeWatch — more frequent detection than recalcAdaptive
  Intervals.set('regimeWatch', function () { _pmCheckRegimeTransition(); if (typeof ARES !== 'undefined') ARES.tick(); }, 5 * 60 * 1000);

  // ═══════════════════════════════════════════════════════
  // PHASE 3 — STATE: restore saved state, THEN open WS
  // WS connect here so __wsGen is already at its final value
  // ═══════════════════════════════════════════════════════
  setTimeout(() => {
    // Restore already ran at boot (top of startApp). Refresh UI now that DOM is ready.
    if (_earlyRestored) {
      atLog('info', '[RESTORE] State restaurat din localStorage. Pozitii rambarcate.');
      setTimeout(() => { updateATStats(); updateDemoBalance(); renderDemoPositions(); renderATPositions(); }, 200);
    }

    // Server sync pull — merge newer state from server (PC <-> Phone)
    console.log('[sync] Starting pullFromServer...');
    var _isPulling = true; // [FIX H10] guard: prevent save during pull
    ZState.pullFromServer().then(function (serverSnap) {
      console.log('[sync] pullFromServer returned:', serverSnap ? 'data (ts=' + serverSnap.ts + ', pos=' + (serverSnap.positions || []).length + ')' : 'null');
      if (!serverSnap || !serverSnap.ts) {
        // [P4 FIX] New account or empty server state — confirm default mode so AT toggle isn't blocked
        if (typeof AT !== 'undefined' && !AT._modeConfirmed) {
          AT._modeConfirmed = true;
          console.log('[sync] P4 — no server state, confirming default mode:', AT.mode || 'demo');
        }
        ZState.markSyncReady(); return;
      }
      var localSnap = ZState.load();
      var localTs = (localSnap && localSnap.ts) ? localSnap.ts : 0;
      var localPositions = (typeof TP !== 'undefined' && Array.isArray(TP.demoPositions)) ? TP.demoPositions.length : 0;
      var serverPositions = (serverSnap.positions || []).length;
      console.log('[sync] serverTs:', serverSnap.ts, 'localTs:', localTs, 'localPos:', localPositions, 'serverPos:', serverPositions);

      // [B16] Merge positions using shared helpers — skip if serverAT active [B5]
      if (serverSnap.positions && serverSnap.positions.length && typeof TP !== 'undefined' && !window._serverATEnabled && window._zeusMerge) {
        TP.demoPositions = TP.demoPositions || [];
        var closedSet = window._zeusMerge.buildClosedSet(serverSnap.closedIds);
        window._zeusMerge.mergePositionsInto(TP.demoPositions, serverSnap.positions, closedSet, 'boot');
      }

      // Gate balance/AT overwrite on timestamp — only apply if server is newer OR local has no positions
      // [S2B2-T2] Freshness guard: skip overwrite if local has unsaved newer edits
      var _bootLocalEditTs = (localSnap && localSnap.lastEditTs) ? localSnap.lastEditTs : 0;
      var _bootServerEditTs = serverSnap.lastEditTs || serverSnap.ts || 0;
      var _bootLocalDirty = (typeof ZState !== 'undefined' && ZState.isDirty && ZState.isDirty());
      var _bootFresh = !(_bootLocalDirty && _bootLocalEditTs > _bootServerEditTs);
      if (_bootFresh && (serverSnap.ts > localTs || (localPositions === 0 && serverPositions > 0))) {
        console.log('[sync] Applying server state (reason:', serverSnap.ts > localTs ? 'newer' : 'local empty, server has positions', ')');
        // [B2] runMode REMOVED, assistArmed synced exclusively via user-context (_usApply)
        // No more dual-source from ZState snapshot
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
          } else if (!window._serverATEnabled) {
            // [B17] Only apply balance from sync file when serverAT is NOT active
            // When serverAT is active, demoBalance comes exclusively from _applyServerATState
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
      }
      // [B1v2] AT.enabled + mode — ALWAYS apply from server truth (outside freshness gate)
      // Root cause: on same-device refresh, localTs > serverTs so the gate above never opens.
      // AT.enabled and AT.mode must be authoritative from server regardless of timestamp.
      if (serverSnap.at && typeof AT !== 'undefined') {
        if (typeof serverSnap.at.enabled === 'boolean') AT.enabled = serverSnap.at.enabled;
        if (serverSnap.at.mode) {
          AT.mode = serverSnap.at.mode;
          AT._modeConfirmed = true; // [B2] server snapshot confirms mode — unblock toggle
        }
        if (AT.enabled) console.log('[sync] B1v2 — AT.enabled restored from server (mode: ' + AT.mode + ')');
      }
      // [B3] Post-sync AT resume — start interval + update UI if server restored AT.enabled
      if (typeof AT !== 'undefined' && AT.enabled && !AT.killTriggered && !AT.interval) {
        var _b3btn = document.getElementById('atMainBtn'); if (_b3btn) _b3btn.className = 'at-main-btn on';
        var _b3dot = document.getElementById('atBtnDot'); if (_b3dot) { _b3dot.style.background = '#00ff88'; _b3dot.style.boxShadow = '0 0 10px #00ff88'; }
        var _b3txt = document.getElementById('atBtnTxt'); if (_b3txt) _b3txt.textContent = 'AUTO TRADE ON';
        var _b3st = document.getElementById('atStatus'); if (_b3st) _b3st.innerHTML = _ZI.dGrn + ' Active — scanning every 30s';
        AT.interval = Intervals.set('atCheck', runAutoTradeCheck, 30000);
        setTimeout(runAutoTradeCheck, 3000);
        if (typeof atUpdateBanner === 'function') atUpdateBanner();
        console.log('[sync] B3 — AT resumed from server state');
      }
      // Always render + save after sync merge (positions may have been added)
      setTimeout(function () {
        if (typeof updateDemoBalance === 'function') updateDemoBalance();
        if (typeof renderDemoPositions === 'function') renderDemoPositions();
        if (typeof renderATPositions === 'function') renderATPositions();
        if (typeof syncBrainFromState === 'function') syncBrainFromState();
      }, 300);
      ZState.saveLocal();
      console.log('[sync] Applied — bal: $' + (TP.demoBalance || 0).toFixed(2) + ', pos: ' + (TP.demoPositions || []).length);
      _isPulling = false; // [FIX H10] release guard
      ZState.markSyncReady();
    }).catch(function () {
      _isPulling = false;
      // [P4 FIX] Network error — confirm default mode so AT isn't permanently blocked
      if (typeof AT !== 'undefined' && !AT._modeConfirmed) {
        AT._modeConfirmed = true;
        console.log('[sync] P4 — pull failed, confirming default mode:', AT.mode || 'demo');
      }
      ZState.markSyncReady();
    });
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
    }).catch(function (err) { console.warn('[sync] Journal pull failed:', err && err.message || err); });

    Intervals.set('stateSave', function () { ZState.saveLocal(); }, 30000);
    // Periodic PULL from server — picks up positions opened on other devices
    Intervals.set('syncPull', function () { if (typeof ZState.pullAndMerge === 'function') ZState.pullAndMerge(); if (typeof _userCtxPull === 'function') _userCtxPull(); }, 10000);

    // Connect WebSockets AFTER all state restore — ensures __wsGen is stable
    console.log('[startApp] phase 3: connecting WebSockets | __wsGen=', window.__wsGen);
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
    const AT_INPUT_IDS = ['atLev', 'atSL', 'atRR', 'atSize', 'atMaxPos', 'atKillPct', 'atConfMin', 'atSigMin', 'atMultiSym', 'atRiskPct', 'atMaxDay', 'atLossStreak', 'atMaxAddon'];
    if (AT_INPUT_IDS.includes(t.id)) {
      // [P1] Sync DOM → TradingConfig
      if (typeof syncDOMtoTC === 'function') syncDOMtoTC();
      // [FIX v85.1 F2] Sync BM.confMin la schimbare UI — sursă unică de adevăr
      if (t.id === 'atConfMin' && typeof BM !== 'undefined') {
        BM.confMin = parseFloat(t.value) || 65;
      }
      // [KILL FIX] Push killPct change to server immediately
      if (t.id === 'atKillPct') {
        var _newKillPct = parseFloat(t.value);
        if (Number.isFinite(_newKillPct) && _newKillPct >= 1 && _newKillPct <= 50) {
          var _curBal = +(typeof AT !== 'undefined' && AT.mode === 'live' ? (typeof TP !== 'undefined' ? TP.liveBalance : 0) : (typeof TP !== 'undefined' ? TP.demoBalance : 0)) || 0;
          fetch('/api/at/kill/pct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ pct: _newKillPct, balanceRef: _curBal }) }).catch(function () { });
        }
      }
      // [P4] Push TC to server (debounced)
      if (typeof _tcPushDebounced === 'function') _tcPushDebounced();
      _usScheduleSave();
    }
    // [P1] Also sync DSL inputs
    if (t.id && (t.id.startsWith('dsl') || t.id === 'atLev')) {
      if (typeof syncDOMtoTC === 'function') syncDOMtoTC();
    }
  });
  document.addEventListener('input', function (e) {
    const t = e.target;
    const AT_INPUT_IDS = ['atSL', 'atRR', 'atSize', 'atMaxPos', 'atKillPct', 'atConfMin', 'atSigMin', 'atRiskPct', 'atMaxDay', 'atLossStreak', 'atMaxAddon'];
    if (AT_INPUT_IDS.includes(t.id)) {
      // [P1] Sync DOM → TradingConfig
      if (typeof syncDOMtoTC === 'function') syncDOMtoTC();
      // [FIX v85.1 F2] Sync BM.confMin la input live
      if (t.id === 'atConfMin' && typeof BM !== 'undefined') {
        BM.confMin = parseFloat(t.value) || 65;
      }
      // [KILL FIX] Push killPct change to server immediately
      if (t.id === 'atKillPct') {
        var _newKillPct2 = parseFloat(t.value);
        if (Number.isFinite(_newKillPct2) && _newKillPct2 >= 1 && _newKillPct2 <= 50) {
          var _curBal2 = +(typeof AT !== 'undefined' && AT.mode === 'live' ? (typeof TP !== 'undefined' ? TP.liveBalance : 0) : (typeof TP !== 'undefined' ? TP.demoBalance : 0)) || 0;
          fetch('/api/at/kill/pct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ pct: _newKillPct2, balanceRef: _curBal2 }) }).catch(function () { });
        }
      }
      // [P4] Push TC to server (debounced)
      if (typeof _tcPushDebounced === 'function') _tcPushDebounced();
      _usScheduleSave();
    }
  });

  // [US] Salvare periodică (fallback — capturează orice schimbare neinterceptată)
  Intervals.set('userSettingsSave', _usSave, 300000);  // la 5 minute

  // [P4] Periodic TC push to server (every 60s fallback + initial push at boot)
  if (typeof pushTCtoServer === 'function') {
    setTimeout(pushTCtoServer, 5000);  // 5s after boot
    Intervals.set('tcServerSync', pushTCtoServer, 60000);
  }

  // [MULTI-SYM] Load available symbols and build selector
  setTimeout(function () {
    fetch('/api/sd/symbols', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.configured || data.configured.length <= 1) return;
        var section = document.getElementById('atSymbolSection');
        var grid = document.getElementById('atSymbolGrid');
        if (!section || !grid) return;
        section.style.display = '';
        window._atSelectedSymbols = null; // null = all
        // Hide old MSCAN picker when server symbols are active (avoid duplicate UI)
        var mscanRow = document.getElementById('atMscanRow');
        if (mscanRow) mscanRow.style.display = 'none';
        var shortNames = { BTCUSDT: 'BTC', ETHUSDT: 'ETH', SOLUSDT: 'SOL', BNBUSDT: 'BNB', XRPUSDT: 'XRP', DOGEUSDT: 'DOGE', ADAUSDT: 'ADA', AVAXUSDT: 'AVAX' };
        data.configured.forEach(function (sym) {
          var label = document.createElement('label');
          label.className = 'mchk';
          label.style.cssText = 'padding:3px 8px;font-size:10px;letter-spacing:1px;border:1px solid #aa44ff44;border-radius:4px;cursor:pointer';
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = true;
          cb.dataset.sym = sym;
          cb.onchange = function () {
            var checked = [];
            grid.querySelectorAll('input[type=checkbox]').forEach(function (c) { if (c.checked) checked.push(c.dataset.sym); });
            window._atSelectedSymbols = checked.length === data.configured.length ? null : checked;
            if (typeof _tcPushDebounced === 'function') _tcPushDebounced();
          };
          label.appendChild(cb);
          label.appendChild(document.createTextNode(' ' + (shortNames[sym] || sym.replace('USDT', ''))));
          grid.appendChild(label);
        });
      })
      .catch(function () { /* silent */ });
  }, 3000);

  // [v122 ANALYTICS] Periodic PERF save + PnL Lab condensed update
  Intervals.set('perfSave', function () {
    if (typeof savePerfToStorage === 'function') savePerfToStorage();
    _updatePnlLabCondensed();
  }, 60000);
  setTimeout(_updatePnlLabCondensed, 3000);

  setTimeout(runBrainUpdate, 2500);
  Intervals.set('brain', runBrainUpdate, 5000);
  Intervals.set('dslBanner', dslUpdateBanner, 2000);
  Intervals.set('atBanner', atUpdateBanner, 2000);
  Intervals.set('ptBanner', ptUpdateBanner, 2000); // update PT strip banner

  // [AT-UNIFY] Start polling server AT state (WS push is primary, poll is fallback)
  if (typeof ZState !== 'undefined' && ZState.startATPolling) ZState.startATPolling();

  Intervals.set('brainExt', updateBrainExtension, 5000);

  setTimeout(renderDHF, 1200);
  Intervals.set('dhf', renderDHF, 60000);
  setTimeout(renderPerfTracker, 2000);
  setTimeout(() => { updateQuantumClock(); updateBrainExtension(); }, 3000);
  setTimeout(() => {
    brainThink('info', _ZI.brain + ' Zeus Brain initializat. Astept date live...');
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
    try { devLog('Developer Mode ready. Enable from Settings Hub → DEVELOPER tab.', 'info'); } catch (_) { }
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
    if (document.hidden && typeof _usFlush === 'function') _usFlush(); // flush settings before backgrounding
    if (document.visibilityState === 'visible') {
      fetchOI(); fetchLS(); fetchAllRSI();
      // Restart RAF chains that were paused
      if (typeof ZANIM !== 'undefined' && !ZANIM.running) startZAnim();
      // Re-sync live positions from exchange on tab resume
      if (typeof TP !== 'undefined' && TP.liveConnected && typeof liveApiSyncState === 'function') {
        liveApiSyncState();
      }
      // Pull latest state from server when app comes back to foreground
      // Cross-device pull on tab resume
      if (typeof _userCtxPull === 'function') _userCtxPull();
      // [S2B2-T1] Skip visibility pull if pullAndMerge is already in progress (prevents parallel merges)
      if (typeof ZState !== 'undefined' && ZState.pullFromServer && !(ZState.isMerging && ZState.isMerging())) {
        ZState.pullFromServer().then(function (serverSnap) {
          if (!serverSnap || !serverSnap.ts) return;
          var localSnap = ZState.load();
          var localTs = (localSnap && localSnap.ts) ? localSnap.ts : 0;

          // [B16] Merge positions using shared helpers — skip if serverAT active [B5]
          if (serverSnap.positions && serverSnap.positions.length && typeof TP !== 'undefined' && !window._serverATEnabled && window._zeusMerge) {
            TP.demoPositions = TP.demoPositions || [];
            var closedSet = window._zeusMerge.buildClosedSet(serverSnap.closedIds);
            window._zeusMerge.mergePositionsInto(TP.demoPositions, serverSnap.positions, closedSet, 'visibility');
          }

          // Gate balance/AT overwrite on timestamp
          // [S2B2-T1] Freshness guard: skip if local has pending dirty mutations newer than server
          var _serverEditTs = serverSnap.lastEditTs || serverSnap.ts || 0;
          var _localDirty = (typeof ZState !== 'undefined' && ZState.isDirty && ZState.isDirty());
          if (serverSnap.ts > localTs && !(_localDirty && (serverSnap.lastEditTs || 0) < (localSnap && localSnap.lastEditTs || 0))) {
            console.log('[sync] Visibility resume — server has newer state, applying balance/AT');
            // [B2] runMode REMOVED, assistArmed synced exclusively via user-context (_usApply)
            // No more dual-source from ZState snapshot
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
              } else if (!window._serverATEnabled) {
                // [B17] Skip sync file balance when serverAT active
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
            }
          }
          // Always render + save after sync merge
          ZState.saveLocal();
          setTimeout(function () {
            if (typeof updateDemoBalance === 'function') updateDemoBalance();
            if (typeof renderDemoPositions === 'function') renderDemoPositions();
            if (typeof renderATPositions === 'function') renderATPositions();
            if (typeof syncBrainFromState === 'function') syncBrainFromState();
          }, 200);
        }).catch(function (e) { console.warn('[sync] visibility pull failed:', e); });
      }
    } else {
      // Pause RAF chains— saves CPU in background tab
      if (typeof ZANIM !== 'undefined') ZANIM.running = false;
      // Save state + push to server immediately when app goes to background
      if (typeof ZState !== 'undefined') { ZState.saveLocal(); ZState.syncNow(); }
      // Persist UI context (sound, AT log) on background/close
      if (typeof _ctxSave === 'function') _ctxSave();
      // Cross-device push on background — ensures latest prefs reach server
      if (typeof _userCtxPush === 'function') _userCtxPush();
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
            // When tab enters background → BlockReason immediately, skip watchdog
            if (typeof BlockReason !== 'undefined')
              BlockReason.set('TAB_HIDDEN', 'Tab in background — AT paused', 'sentinel');
            if (typeof ZLOG !== 'undefined')
              ZLOG.push('WARN', '[SENTINEL] Tab hidden → AT paused (tabHidden=true)');
          } else {
            // Tab returned to foreground — set grace period for fresh data
            if (typeof _SAFETY !== 'undefined') { _SAFETY.tabHidden = false; _SAFETY.tabRestoreTs = Date.now(); }
            // BlockReason.clear() not called directly — runAutoTradeCheck will reset it
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
            txt = _ZI.bellX + ' TAB HIDDEN — AT PAUSED';
            bg = 'rgba(180,100,0,0.18)'; col = '#FFB000';
          } else if (stalled) {
            txt = _ZI.w + ' DATA STALLED — AT PAUSED';
            bg = 'rgba(255,0,51,0.15)'; col = '#ff3355';
          } else if (dataAge !== null && dataAge > 8) {
            txt = _ZI.clock + ' DATA LAG ' + dataAge + 's';
            bg = 'rgba(180,100,0,0.12)'; col = '#f0c040';
          } else if (dataAge !== null) {
            txt = _ZI.ok + ' FEED OK ' + dataAge + 's';
            bg = 'rgba(0,200,100,0.10)'; col = '#00cc66';
          } else {
            txt = '— SENTINEL —';
            bg = 'rgba(60,80,100,0.10)'; col = '#445566';
          }
          bar.style.display = 'block';
          bar.style.background = bg;
          bar.style.color = col;
          bar.style.border = '1px solid ' + col + '44';
          bar.innerHTML = txt;
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
    atLog('info', '[BOOT] Zeus Terminal booted — PHASE 5 active');
    _renderBuildInfo(); // populate BUILD INFO panel once BUILD is guaranteed set
    _pinUpdateUI(); // refresh PIN status in settings
  }, 15000);

  // Welcome modal — show early (2.5s), once per page load
  setTimeout(() => {
    _showWelcomeModal();
  }, 2500);

  // [SR] FALLBACK — garantăm că sr-sec ajunge în MI și e vizibil
  // Rulează la 3s după boot (după ce initZeusGroups a terminat sigur)
  setTimeout(_srEnsureVisible, 3000);

  // [DEV] FALLBACK — garantăm că dev-sec ajunge în MI și e vizibil dacă DEV.enabled
  // Rulează la 3.5s (după _srEnsureVisible, după ce toate mv() s-au stabilizat)
  setTimeout(_devEnsureVisible, 3500);

  setTimeout(() => { atLog('info', '[AT] Zeus Auto Trade Engine initializat. Configureaza si porneste mai sus.'); }, 6000);
}

// ── PIN Lock — App Security (Server-Side Per-User) ──────────────────────
// PIN hash is stored in DB per-user. Frontend only calls API endpoints.
// No localStorage dependency for PIN — works across devices/browsers/PWA.

// Check if current user has PIN set (async, calls server)
var _pinSetCache = null; // cached after first check to avoid repeated calls during boot
async function _pinIsSet() {
  if (_pinSetCache !== null) return _pinSetCache;
  try {
    var r = await fetch('/auth/pin/status', { credentials: 'same-origin' });
    if (!r.ok) return false;
    var d = await r.json();
    _pinSetCache = !!d.pinSet;
    return _pinSetCache;
  } catch (_) { return false; }
}

// Show lock screen on load (called very early, before startApp finishes)
async function _pinCheckLock() {
  var isSet = await _pinIsSet();
  if (!isSet) return;
  // Already unlocked this session
  if (sessionStorage.getItem('zeus_pin_unlocked')) return;
  var ls = document.getElementById('pinLockScreen');
  if (ls) {
    ls.style.display = 'flex';
    // Focus PIN input when visible
    setTimeout(function () {
      var inp = document.getElementById('pinLockInput');
      if (inp) inp.focus();
    }, 100);
    // Enter key to unlock
    var inp = document.getElementById('pinLockInput');
    if (inp) {
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') pinUnlock();
      });
    }
  }
}

// Unlock attempt — calls server to verify PIN
async function pinUnlock() {
  var inp = document.getElementById('pinLockInput');
  var msg = document.getElementById('pinLockMsg');
  if (!inp) return;
  var val = inp.value.trim();
  if (!val) { if (msg) msg.textContent = 'Introdu PIN-ul'; return; }
  try {
    var r = await fetch('/auth/pin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zeus-Request': '1' },
      credentials: 'same-origin',
      body: JSON.stringify({ pin: val })
    });
    var d = await r.json();
    if (d.ok === true) {
      sessionStorage.setItem('zeus_pin_unlocked', '1');
      var ls = document.getElementById('pinLockScreen');
      if (ls) {
        ls.style.transition = 'opacity .3s';
        ls.style.opacity = '0';
        setTimeout(function () {
          ls.style.display = 'none';
          // Show welcome modal after unlock
          if (typeof _showWelcomeModal === 'function') _showWelcomeModal();
        }, 300);
      }
    } else if (d.error === 'pin_not_set') {
      if (msg) msg.textContent = 'PIN nu este configurat pentru contul tău';
      sessionStorage.setItem('zeus_pin_unlocked', '1');
      var ls2 = document.getElementById('pinLockScreen');
      if (ls2) { ls2.style.display = 'none'; }
    } else if (d.error === 'session_invalid') {
      if (msg) msg.textContent = 'Sesiune expirată — re-autentifică-te';
    } else if (d.error === 'invalid_pin' || !d.ok) {
      if (msg) msg.textContent = 'PIN incorect!';
      inp.value = '';
      inp.focus();
      var field = inp;
      field.classList.add('pin-lock-shake');
      setTimeout(function () { field.classList.remove('pin-lock-shake'); }, 500);
    }
  } catch (err) {
    if (msg) msg.textContent = 'Eroare de rețea — verifică conexiunea';
  }
}

// Settings: Activate/Change PIN — calls server
async function pinActivate() {
  var inp = document.getElementById('pinInput');
  var conf = document.getElementById('pinConfirm');
  var msg = document.getElementById('pin-msg');
  if (!inp || !conf) return;
  var val = inp.value.trim();
  var val2 = conf.value.trim();
  if (!val || val.length < 4) {
    if (msg) { msg.style.color = '#ff4455'; msg.textContent = 'PIN-ul trebuie să aibă minim 4 caractere'; }
    return;
  }
  if (val !== val2) {
    if (msg) { msg.style.color = '#ff4455'; msg.textContent = 'PIN-urile nu coincid'; }
    return;
  }
  try {
    var r = await fetch('/auth/pin/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zeus-Request': '1' },
      credentials: 'same-origin',
      body: JSON.stringify({ pin: val })
    });
    var d = await r.json();
    if (d.ok) {
      inp.value = '';
      conf.value = '';
      _pinSetCache = true;
      if (msg) { msg.style.color = '#00ff88'; msg.innerHTML = _ZI.ok + ' PIN activat! La următoarea deschidere vei fi întrebat.'; }
      _pinUpdateUI();
      // Mark this session as unlocked (don't lock yourself out mid-use)
      sessionStorage.setItem('zeus_pin_unlocked', '1');
    } else if (d.error === 'session_invalid') {
      if (msg) { msg.style.color = '#ff4455'; msg.textContent = 'Sesiune expirată — re-autentifică-te'; }
    } else {
      if (msg) { msg.style.color = '#ff4455'; msg.textContent = d.error || 'Eroare la setarea PIN-ului'; }
    }
  } catch (err) {
    if (msg) { msg.style.color = '#ff4455'; msg.textContent = 'Eroare de rețea'; }
  }
}

// Settings: Remove PIN — calls server
async function pinRemove() {
  try {
    var r = await fetch('/auth/pin/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zeus-Request': '1' },
      credentials: 'same-origin'
    });
    var d = await r.json();
    if (d.ok) {
      _pinSetCache = false;
      sessionStorage.removeItem('zeus_pin_unlocked');
      // Clean up legacy localStorage PIN if present
      try { localStorage.removeItem('zeus_pin_hash'); } catch (_) { }
      var msg = document.getElementById('pin-msg');
      if (msg) { msg.style.color = '#00afff'; msg.textContent = 'PIN dezactivat.'; }
      _pinUpdateUI();
    }
  } catch (_) { }
}

// Update PIN UI state in settings
async function _pinUpdateUI() {
  var isSet = await _pinIsSet();
  var status = document.getElementById('pinStatus');
  var actBtn = document.getElementById('pinActivateBtn');
  var remBtn = document.getElementById('pinRemoveBtn');
  if (status) {
    status.innerHTML = isSet ? 'ACTIVAT ' + _ZI.ok : 'DEZACTIVAT';
    status.style.color = isSet ? '#00ff88' : '#556';
  }
  if (actBtn) actBtn.innerHTML = isSet ? _ZI.rfsh + ' SCHIMBĂ PIN' : _ZI.lock + ' ACTIVEAZĂ PIN';
  if (remBtn) remBtn.style.display = isSet ? '' : 'none';
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

// ── _showWelcomeModal() — post-login welcome dashboard ──
// Shows REAL values only, scoped to the active mode (DEMO or LIVE).
var _wlcShown = false; // in-memory guard — once per page load
function _showWelcomeModal() {
  try {
    // Only show once per page load
    if (_wlcShown) return;
    // Don't show welcome if PIN lock is active (will be called again after unlock)
    if (_pinIsSet() && !sessionStorage.getItem('zeus_pin_unlocked')) return;
    _wlcShown = true;

    var m = document.getElementById('mwelcome');
    if (!m) return;

    // Show modal FIRST (safe HTML defaults visible), then populate real values
    m.style.display = 'flex';

    // ── Determine active mode ──
    var isLive = (typeof AT !== 'undefined' && AT.mode === 'live');
    var _wlcEnv = window._resolvedEnv || (isLive ? 'REAL' : 'DEMO');
    var modeLabel = _wlcEnv === 'TESTNET' ? 'TESTNET' : (isLive ? 'LIVE' : 'DEMO');

    // Greeting
    var greetEl = document.getElementById('wlcGreeting');
    if (greetEl) greetEl.textContent = 'Welcome back, Commander';

    // Mode badge
    var badgeEl = document.getElementById('wlcModeBadge');
    if (badgeEl) {
      badgeEl.textContent = modeLabel;
      var _wlcCls = _wlcEnv === 'TESTNET' ? 'wlc-testnet' : (isLive ? 'wlc-live' : 'wlc-demo');
      badgeEl.className = 'wlc-mode-badge ' + _wlcCls;
    }

    // Version
    var verEl = document.getElementById('wlcVersion');
    var b = window.BUILD || {};
    if (verEl) verEl.textContent = 'ZEUS TERMINAL ' + (b.version || '').toUpperCase();

    // ── Balance (mode-scoped) ──
    var balEl = document.getElementById('wlcBalance');
    if (balEl) {
      var bal = 0;
      if (typeof TP !== 'undefined') {
        bal = isLive ? (TP.liveBalance || 0) : (TP.demoBalance || 0);
      }
      balEl.textContent = '$' + bal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }

    // ── Daily stats from journal (mode-filtered) ──
    var todayTrades = 0, todayWins = 0, todayPnl = 0;
    if (typeof TP !== 'undefined' && Array.isArray(TP.journal)) {
      var tz = (typeof S !== 'undefined' && S.tz) || 'Europe/Bucharest';
      var todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
      var closed = TP.journal.filter(function (t) {
        if (t.journalEvent !== 'CLOSE' || !Number.isFinite(t.pnl)) return false;
        if ((t.mode || 'demo') !== (isLive ? 'live' : 'demo')) return false;
        var ts = t.closedAt || t.time || 0;
        if (!ts) return false;
        var dk = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ts));
        return dk === todayStr;
      });
      todayTrades = closed.length;
      closed.forEach(function (t) {
        todayPnl += (t.pnl || 0);
        if (t.pnl >= 0) todayWins++;
      });
    }

    // Daily PnL
    var pnlEl = document.getElementById('wlcDailyPnl');
    if (pnlEl) {
      if (todayTrades > 0) {
        pnlEl.textContent = (todayPnl >= 0 ? '+' : '') + '$' + todayPnl.toFixed(0);
        pnlEl.className = 'wlc-value ' + (todayPnl > 0 ? 'wlc-pos' : todayPnl < 0 ? 'wlc-neg' : '');
      } else {
        pnlEl.textContent = 'no trades yet';
        pnlEl.className = 'wlc-value';
      }
    }

    // Trades today
    var trEl = document.getElementById('wlcTrades');
    if (trEl) trEl.textContent = todayTrades;

    // Win rate
    var wrEl = document.getElementById('wlcWinRate');
    if (wrEl) {
      if (todayTrades > 0) {
        var wr = Math.round(todayWins / todayTrades * 100);
        wrEl.textContent = wr + '%';
        wrEl.className = 'wlc-value ' + (wr >= 50 ? 'wlc-pos' : 'wlc-neg');
      } else {
        wrEl.textContent = 'N/A';
        wrEl.className = 'wlc-value';
      }
    }

    // ── Open positions (mode-scoped) ──
    var posEl = document.getElementById('wlcPositions');
    if (posEl) {
      var openCount = 0;
      if (typeof TP !== 'undefined') {
        var arr = isLive ? (TP.livePositions || []) : (TP.demoPositions || []);
        openCount = arr.filter(function (p) { return !p.closed; }).length;
      }
      posEl.textContent = openCount;
      posEl.className = 'wlc-value' + (openCount > 0 ? ' wlc-gold' : '');
    }

    // AutoTrade status
    var atEl = document.getElementById('wlcAT');
    if (atEl) {
      if (typeof AT !== 'undefined') {
        atEl.textContent = AT.enabled ? 'ON' : 'OFF';
        atEl.className = 'wlc-value ' + (AT.enabled ? 'wlc-on' : 'wlc-off');
      } else {
        atEl.textContent = 'OFF';
        atEl.className = 'wlc-value wlc-off';
      }
    }

    // Brain mode
    var brEl = document.getElementById('wlcBrain');
    if (brEl) {
      if (typeof BM !== 'undefined') {
        var brMode = (BM.mode || 'assist').toUpperCase();
        brEl.textContent = brMode;
        brEl.className = 'wlc-value wlc-gold';
      } else {
        brEl.textContent = 'N/A';
        brEl.className = 'wlc-value';
      }
    }

    // Close on backdrop click
    m.addEventListener('click', function (e) {
      if (e.target === m) closeM('mwelcome');
    });

    // Close with Escape key
    var _wlcEsc = function (e) {
      if (e.key === 'Escape') { closeM('mwelcome'); document.removeEventListener('keydown', _wlcEsc); }
    };
    document.addEventListener('keydown', _wlcEsc);

  } catch (e) { console.warn('[WLC]', e); }
}

// Window aliases for Android WebView compatibility
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
  // [PIN Lock] — exposed for onclick in settings + lock screen
  window.pinActivate = pinActivate;
  window.pinRemove = pinRemove;
  window.pinUnlock = pinUnlock;
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
  if (!window.confirm('MASTER RESET\nȘterge TOATE datele și repornește Zeus Terminal?\n\n• Poziții demo ✓\n• AT stats ✓\n• DSL state ✓\n• PERF tracker ✓\n• DHF win rates ✓\n• localStorage ✓')) return;

  // localStorage
  try { localStorage.clear(); } catch (e) { }

  // [V1.5] Legacy API_KEY/API_SECRET removed — credentials are server-side only

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

  toast('Master Reset complet — reîncărcare...');
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
// initMidStack() removed — all strips now in hidden-panels, accessed via dock page view

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
      if (typeof cvdChart !== 'undefined' && cvdChart) cvdChart.applyOptions({ width: w, height: 60 });
      if (typeof macdChart !== 'undefined' && macdChart) macdChart.applyOptions({ width: w });
      // v104: preserve rightOffset:12 on aux at every resize
      try { if (cvdChart) cvdChart.timeScale().applyOptions({ rightOffset: 12 }); } catch (_) { }
      // volChart removed — volume overlay on mainChart
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

// ─── App Update Checker (auto-detect + install banner) ─────────
var _updateCheckInterval = null;
function _checkAppUpdate() {
  // Save current version on first run
  if (!localStorage.getItem('zeus_app_version')) {
    fetch('/api/version')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && data.version) {
          localStorage.setItem('zeus_app_version', data.version);
          console.log('[UPDATE] First run — saved version:', data.version);
        }
      }).catch(function () { });
  }
  // Start periodic check every 45s
  if (_updateCheckInterval) clearInterval(_updateCheckInterval);
  _updateCheckInterval = setInterval(_pollForUpdate, 45000);
  // Also check once now (after 5s delay to let auth settle)
  setTimeout(_pollForUpdate, 5000);
}

function _pollForUpdate() {
  fetch('/api/version')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !data.version) return;
      var current = localStorage.getItem('zeus_app_version');
      console.log('[UPDATE] Server:', data.version, '| Local:', current);
      if (!current) {
        // First time — save and skip (no banner on first ever visit)
        localStorage.setItem('zeus_app_version', data.version);
        return;
      }
      if (current === data.version) return;
      // New version detected — stop polling and show install banner
      if (_updateCheckInterval) { clearInterval(_updateCheckInterval); _updateCheckInterval = null; }
      _showUpdateBanner(data);
    })
    .catch(function (e) { console.log('[UPDATE] Poll failed:', e.message); });
}

function _showUpdateBanner(data) {
  // Don't show duplicate banners
  if (document.getElementById('zeus-update-banner')) return;
  var overlay = document.createElement('div');
  overlay.id = 'zeus-update-banner';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);z-index:999999;display:flex;align-items:center;justify-content:center;animation:fadeIn .3s ease';
  var box = document.createElement('div');
  box.style.cssText = 'background:linear-gradient(135deg,#0a1628,#132040);border:1px solid #1e3a5f;border-radius:16px;padding:28px 32px;max-width:360px;width:90vw;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,.7)';
  var icon = document.createElement('div');
  icon.style.cssText = 'font-size:48px;margin-bottom:12px';
  icon.textContent = '\u26A1';
  var title = document.createElement('div');
  title.style.cssText = 'color:#fff;font-size:18px;font-weight:700;margin-bottom:8px';
  title.textContent = 'Update ' + data.version;
  var desc = document.createElement('div');
  desc.style.cssText = 'color:#8899bb;font-size:13px;margin-bottom:20px;line-height:1.4';
  desc.textContent = data.changelog || 'New version available';
  var btn = document.createElement('button');
  btn.style.cssText = 'background:linear-gradient(135deg,#1565c0,#0d47a1);color:#fff;border:none;border-radius:10px;padding:14px 40px;font-size:15px;font-weight:700;cursor:pointer;width:100%;letter-spacing:.5px;text-transform:uppercase';
  btn.textContent = '\uD83D\uDD04 INSTALL';
  btn.onclick = function () {
    btn.textContent = 'Updating...';
    btn.style.opacity = '0.6';
    localStorage.setItem('zeus_app_version', data.version);
    setTimeout(function () { location.reload(true); }, 500);
  };
  var skip = document.createElement('div');
  skip.style.cssText = 'color:#556;font-size:11px;margin-top:12px;cursor:pointer';
  skip.textContent = 'Later';
  skip.onclick = function () {
    overlay.remove();
    // Resume checking in 5 min
    _updateCheckInterval = setInterval(_pollForUpdate, 300000);
  };
  box.appendChild(icon);
  box.appendChild(title);
  box.appendChild(desc);
  box.appendChild(btn);
  box.appendChild(skip);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  if (typeof ncAdd === 'function') {
    ncAdd('info', 'system', '\uD83C\uDD95 Update ' + data.version + (data.changelog ? ' — ' + data.changelog : ''));
  }
}

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

// ═══════════════════════════════════════════════════════════════
// Global Status Bar — updates every 2s, reads existing state only
// ═══════════════════════════════════════════════════════════════
(function _initStatusBar() {
  function _updateStatusBar() {
    try {
      // Mode
      var modeEl = document.getElementById('zsbMode');
      if (modeEl && typeof AT !== 'undefined') {
        var mode = AT._serverMode || AT.mode || 'demo';
        var _sbEnv = window._resolvedEnv || (mode === 'demo' ? 'DEMO' : 'REAL');
        modeEl.textContent = _sbEnv === 'TESTNET' ? 'TESTNET' : mode.toUpperCase();
        modeEl.className = 'zsb-item zsb-mode ' + (_sbEnv === 'TESTNET' ? 'zsb-testnet' : (mode === 'live' ? 'zsb-live' : 'zsb-demo'));
      }
      // AT state
      var atEl = document.getElementById('zsbAT');
      if (atEl && typeof AT !== 'undefined') {
        var on = !!AT.enabled;
        atEl.innerHTML = '<span class="zsb-dot ' + (on ? 'zsb-on' : 'zsb-off') + '"></span>AT ' + (on ? 'ON' : 'OFF');
      }
      // WS connection
      var wsEl = document.getElementById('zsbWS');
      if (wsEl) {
        var wsOk = !!(window._zeusWS && window._zeusWS.readyState === 1);
        wsEl.innerHTML = '<span class="zsb-dot ' + (wsOk ? 'zsb-on' : 'zsb-warn') + '"></span>' + (wsOk ? 'WS' : 'WS...');
      }
      // Data freshness
      var dataEl = document.getElementById('zsbData');
      if (dataEl && typeof _SAFETY !== 'undefined') {
        var stale = !!_SAFETY.dataStalled;
        var degraded = _SAFETY.degradedFeeds && _SAFETY.degradedFeeds.size > 0;
        var cls = stale ? 'zsb-warn' : (degraded ? 'zsb-stale' : 'zsb-on');
        var txt = stale ? 'STALE' : (degraded ? 'DEGRADED' : 'DATA');
        dataEl.innerHTML = '<span class="zsb-dot ' + cls + '"></span>' + txt;
      }
      // Kill switch
      var killEl = document.getElementById('zsbKill');
      var killSep = document.getElementById('zsbKillSep');
      if (killEl && typeof AT !== 'undefined') {
        var killActive = !!AT.killTriggered;
        killEl.style.display = killActive ? '' : 'none';
        if (killSep) killSep.style.display = killActive ? '' : 'none';
        if (killActive) killEl.innerHTML = '<span class="zsb-dot zsb-warn"></span>KILL ACTIVE';
      }
      // Positions count
      var posEl = document.getElementById('zsbPos');
      if (posEl && typeof TP !== 'undefined') {
        var demoCount = (TP.demoPositions || []).filter(function(p){ return !p.closed; }).length;
        var liveCount = (TP.livePositions || []).filter(function(p){ return !p.closed; }).length;
        var total = demoCount + liveCount;
        posEl.textContent = total + ' pos';
        posEl.style.color = total > 0 ? '#00d4ff' : '#555';
      }
      // Daily PnL
      var pnlEl = document.getElementById('zsbPnl');
      if (pnlEl && typeof AT !== 'undefined') {
        var pnl = AT.totalPnL || AT.realizedDailyPnL || 0;
        pnlEl.textContent = '$' + pnl.toFixed(2);
        pnlEl.style.color = pnl > 0 ? '#00ff88' : (pnl < 0 ? '#ff4444' : '#555');
      }
      // [MODE BAR] Piggyback on status bar update cycle (no separate polling)
      if (typeof updateModeBar === 'function') updateModeBar();
    } catch (_) { /* status bar is non-critical */ }
  }
  // Update every 2s, start after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setInterval(_updateStatusBar, 2000); _updateStatusBar(); });
  } else {
    setInterval(_updateStatusBar, 2000); _updateStatusBar();
  }
})();

// ═══════════════════════════════════════════════════════════════
// Decision Log Panel — renders DLog data visually
// ═══════════════════════════════════════════════════════════════
var _dlogOpen = false;
var _dlogFilter = 'all';
var _DLOG_CATS = ['all','at_block','at_entry','at_gate','confluence','regime','fusion','signal','sizing','kill_switch','dsl_move','dsl_close','predator'];

function _toggleDecisionPanel() {
  _dlogOpen = !_dlogOpen;
  var panel = document.getElementById('dlogPanel');
  if (!panel) return;
  panel.style.display = _dlogOpen ? 'flex' : 'none';
  if (_dlogOpen) _renderDlog();
}

function _renderDlog() {
  if (typeof DLog === 'undefined') return;
  // Filters
  var filtersEl = document.getElementById('dlogFilters');
  if (filtersEl && !filtersEl.dataset.init) {
    filtersEl.dataset.init = '1';
    _DLOG_CATS.forEach(function(cat) {
      var btn = document.createElement('button');
      btn.className = 'dlog-fbtn' + (cat === 'at_block' ? ' dlog-block' : (cat === 'at_entry' ? ' dlog-entry' : '')) + (cat === _dlogFilter ? ' active' : '');
      btn.textContent = cat === 'all' ? 'ALL' : cat.replace(/_/g, ' ').toUpperCase();
      btn.onclick = function() { _dlogFilter = cat; _renderDlogEntries(); _updateDlogFilterUI(); };
      filtersEl.appendChild(btn);
    });
  }
  _updateDlogFilterUI();
  // Stats
  var statsEl = document.getElementById('dlogStats');
  if (statsEl) {
    var st = DLog.stats();
    var parts = ['Total: <span>' + st.total + '</span>'];
    for (var c in st.categories) {
      parts.push(c + ': <span>' + st.categories[c] + '</span>');
    }
    statsEl.innerHTML = parts.join(' | ');
  }
  _renderDlogEntries();
}

function _updateDlogFilterUI() {
  var filtersEl = document.getElementById('dlogFilters');
  if (!filtersEl) return;
  var btns = filtersEl.querySelectorAll('.dlog-fbtn');
  btns.forEach(function(btn, i) {
    var cat = _DLOG_CATS[i];
    if (cat === _dlogFilter) btn.classList.add('active');
    else btn.classList.remove('active');
  });
}

function _renderDlogEntries() {
  if (typeof DLog === 'undefined') return;
  var listEl = document.getElementById('dlogList');
  if (!listEl) return;
  var entries = _dlogFilter === 'all' ? DLog.entries(200) : DLog.byCategory(_dlogFilter, 200);
  if (entries.length === 0) {
    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#333;font-size:11px">No decisions logged yet. Enable AutoTrade to start capturing decisions.</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var ts = new Date(e.ts).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
    var catClass = 'dlog-cat-' + (e.cat || 'unknown');
    var detail = _dlogFormatDetail(e.cat, e.d);
    html += '<div class="dlog-entry-row">' +
      '<span class="dlog-ts">' + ts + '</span>' +
      '<span class="dlog-cat ' + catClass + '">' + (e.cat || '?').toUpperCase() + '</span>' +
      detail + '</div>';
  }
  listEl.innerHTML = html;
}

function _dlogFormatDetail(cat, d) {
  if (!d) return '';
  try {
    if (cat === 'at_block') {
      return '<span class="dlog-detail"><b>' + (d.sym || '?') + '</b> — ' +
        (Array.isArray(d.reasons) ? d.reasons.join(', ') : (d.reason || '?')) +
        (d.score != null ? ' | score=' + d.score : '') +
        (d.regime ? ' | regime=' + d.regime : '') + '</span>';
    }
    if (cat === 'at_entry') {
      return '<span class="dlog-detail"><b>' + (d.sym || d.symbol || '?') + ' ' + (d.side || '') + '</b>' +
        (d.tier ? ' tier=' + d.tier : '') +
        (d.conf != null ? ' conf=' + d.conf + '%' : '') +
        (d.size ? ' $' + d.size : '') + '</span>';
    }
    if (cat === 'at_gate') {
      return '<span class="dlog-detail"><b>' + (d.sym || '?') + '</b> gates: ' +
        (d.allOk ? '<b style="color:#00ff88">PASS</b>' : '<b style="color:#ff4444">FAIL</b>') +
        (Array.isArray(d.reasons) && d.reasons.length ? ' [' + d.reasons.join(', ') + ']' : '') + '</span>';
    }
    if (cat === 'confluence') {
      return '<span class="dlog-detail">score=<b>' + (d.score || '?') + '</b>' +
        (d.regime ? ' regime=' + d.regime : '') +
        (d.isBull != null ? (d.isBull ? ' BULL' : ' BEAR') : '') + '</span>';
    }
    if (cat === 'regime') {
      return '<span class="dlog-detail"><b>' + (d.regime || '?') + '</b> conf=' + (d.confidence || '?') + '%' +
        (d.trendBias ? ' bias=' + d.trendBias : '') +
        (d.volatilityState ? ' vol=' + d.volatilityState : '') + '</span>';
    }
    if (cat === 'fusion') {
      return '<span class="dlog-detail"><b>' + (d.decision || '?') + '</b> ' + (d.dir || '') +
        ' conf=' + (d.confidence || '?') + '%' +
        (d.score != null ? ' score=' + d.score : '') + '</span>';
    }
    if (cat === 'kill_switch') {
      return '<span class="dlog-detail"><b style="color:#ff0000">KILL SWITCH</b> ' + (d.action || d.reason || '') + '</span>';
    }
    // Generic fallback
    var keys = Object.keys(d).slice(0, 6);
    var parts = keys.map(function(k) { return k + '=' + (typeof d[k] === 'object' ? JSON.stringify(d[k]) : d[k]); });
    return '<span class="dlog-detail">' + parts.join(' | ') + '</span>';
  } catch (_) { return '<span class="dlog-detail">' + JSON.stringify(d).substring(0, 120) + '</span>'; }
}

// ═══════════════════════════════════════════════════════════════
// Activity Feed Strip — live event stream from DLog
// ═══════════════════════════════════════════════════════════════
var _actfeedOpen = false;
var _actfeedLastSeq = 0;

function _actfeedToggle() {
  _actfeedOpen = !_actfeedOpen;
  var panel = document.getElementById('actfeed-panel');
  if (panel) panel.style.display = _actfeedOpen ? '' : 'none';
  if (_actfeedOpen) _actfeedRender();
}

var _ACTFEED_ICONS = {
  at_entry: '📥', at_block: '🚫', at_gate: '🚧', confluence: '🔗',
  regime: '🌐', fusion: '⚡', kill_switch: '🛑', sizing: '📏',
  dsl_move: '🎯', dsl_close: '📤', predator: '🐾', signal: '📡'
};

function _actfeedRender() {
  if (typeof DLog === 'undefined') return;
  var listEl = document.getElementById('actfeedList');
  if (!listEl) return;
  // Show important categories only (not every confluence tick)
  var important = ['at_entry','at_block','at_gate','regime','kill_switch','dsl_move','dsl_close','fusion'];
  var all = DLog.entries(500);
  var filtered = all.filter(function(e) { return important.indexOf(e.cat) !== -1; }).slice(0, 50);
  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="actfeed-empty">No activity yet — events will appear here as the system operates.</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < filtered.length; i++) {
    var e = filtered[i];
    var ts = new Date(e.ts).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
    var icon = _ACTFEED_ICONS[e.cat] || '•';
    var msg = _actfeedMsg(e.cat, e.d);
    html += '<div class="actfeed-row"><span class="actfeed-ts">' + ts + '</span><span class="actfeed-icon">' + icon + '</span><span class="actfeed-msg">' + msg + '</span></div>';
  }
  listEl.innerHTML = html;
}

function _actfeedMsg(cat, d) {
  if (!d) return cat;
  try {
    if (cat === 'at_entry') return '<b>' + (d.side || '') + ' ' + (d.sym || d.symbol || '?') + '</b> — entry ' + (d.tier || '') + (d.conf ? ' conf=' + d.conf + '%' : '');
    if (cat === 'at_block') return '<b>' + (d.sym || '?') + '</b> blocked — ' + (Array.isArray(d.reasons) ? d.reasons.join(', ') : (d.reason || '?'));
    if (cat === 'at_gate') return '<b>' + (d.sym || '?') + '</b> gates ' + (d.allOk ? '<b style="color:#00ff88">PASS</b>' : '<b style="color:#ff4444">FAIL</b>');
    if (cat === 'regime') return 'Regime: <b>' + (d.regime || '?') + '</b> conf=' + (d.confidence || '?') + '%';
    if (cat === 'kill_switch') return '<b style="color:#ff0000">KILL SWITCH</b> ' + (d.action || d.reason || 'activated');
    if (cat === 'fusion') return '<b>' + (d.decision || '?') + '</b> ' + (d.dir || '') + ' conf=' + (d.confidence || '?') + '%';
    if (cat === 'dsl_move') return 'DSL ' + (d.sym || d.symbol || '?') + ' SL moved';
    if (cat === 'dsl_close') return 'DSL exit ' + (d.sym || d.symbol || '?') + ' — ' + (d.reason || d.exitType || '?');
    return cat + ': ' + JSON.stringify(d).substring(0, 80);
  } catch (_) { return cat; }
}

// Badge update — count recent events (last 5 min)
// [B7] Only runs when activity page view is open (avoids wasted cycles in hidden-panels)
(function _actfeedBadgeLoop() {
  function _updateBadge() {
    try {
      if (typeof DLog === 'undefined') return;
      if (typeof _pvState !== 'undefined' && _pvState.open && _pvState.dockId === 'activity') {
        var important = ['at_entry','at_block','at_gate','regime','kill_switch','dsl_move','dsl_close','fusion'];
        var cutoff = Date.now() - 300000; // 5 min
        var all = DLog.entries(200);
        var recent = all.filter(function(e) { return e.ts > cutoff && important.indexOf(e.cat) !== -1; });
        var el = document.getElementById('actfeedBadge');
        if (el) el.textContent = recent.length + ' events (5m)';
        if (_actfeedOpen) _actfeedRender();
      }
    } catch (_) {}
  }
  setInterval(_updateBadge, 3000);
})();



// ═══════════════════════════════════════════════════════════════
// Exposure Dashboard Panel (Alt+E)
// ═══════════════════════════════════════════════════════════════
var _exposureOpen = false;

function _toggleExposurePanel() {
  _exposureOpen = !_exposureOpen;
  var panel = document.getElementById('exposurePanel');
  if (!panel) return;
  panel.style.display = _exposureOpen ? 'flex' : 'none';
  if (_exposureOpen) _fetchExposure();
}

function _fetchExposure() {
  var content = document.getElementById('exposureContent');
  if (!content) return;
  content.innerHTML = '<div style="text-align:center;color:#333">Loading...</div>';
  fetch('/api/exposure', { credentials: 'same-origin' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.ok) { content.innerHTML = '<div style="color:#ff4444">Error: ' + escHtml(data.error || 'unknown') + '</div>'; return; }
      var pnlClass = data.unrealizedPnl > 0 ? 'positive' : (data.unrealizedPnl < 0 ? 'negative' : '');
      var marginClass = data.marginUsagePct > 80 ? 'negative' : (data.marginUsagePct > 50 ? 'warn' : '');
      var concClass = data.maxConcentrationPct > 70 ? 'warn' : '';
      var html = '';
      html += '<div class="expo-row"><span class="expo-label">Mode</span><span class="expo-val" style="color:' + (data.mode === 'live' ? '#ff4444' : '#00d4ff') + '">' + data.mode.toUpperCase() + '</span></div>';
      html += '<div class="expo-row"><span class="expo-label">Balance</span><span class="expo-val">$' + data.balance.toFixed(2) + '</span></div>';
      html += '<div class="expo-row"><span class="expo-label">Total Margin Used</span><span class="expo-val">$' + data.totalMargin.toFixed(2) + '</span></div>';
      html += '<div class="expo-row"><span class="expo-label">Margin Usage</span><span class="expo-val ' + marginClass + '">' + data.marginUsagePct.toFixed(1) + '%</span></div>';
      html += '<div class="expo-bar"><div class="expo-bar-fill" style="width:' + Math.min(100, data.marginUsagePct) + '%"></div></div>';
      html += '<div class="expo-row"><span class="expo-label">Unrealized PnL</span><span class="expo-val ' + pnlClass + '">$' + data.unrealizedPnl.toFixed(2) + '</span></div>';
      html += '<div class="expo-row"><span class="expo-label">Open Positions</span><span class="expo-val">' + data.positionCount.total + ' (' + data.positionCount.demo + 'D / ' + data.positionCount.live + 'L)</span></div>';
      html += '<div class="expo-row"><span class="expo-label">Max Concentration</span><span class="expo-val ' + concClass + '">' + data.maxConcentrationPct.toFixed(1) + '%</span></div>';
      html += '<div class="expo-row"><span class="expo-label">Kill Switch</span><span class="expo-val" style="color:' + (data.killActive ? '#ff4444' : '#00ff88') + '">' + (data.killActive ? 'ACTIVE' : 'OK') + '</span></div>';
      if (data.bySymbol && data.bySymbol.length > 0) {
        html += '<div class="expo-sym"><div class="expo-sym-hdr">PER-SYMBOL EXPOSURE</div>';
        data.bySymbol.forEach(function(s) {
          html += '<div class="expo-sym-row"><span>' + s.symbol.replace('USDT','') + ' <span style="color:#555">(' + s.sides.join('/') + ')</span></span><span>$' + s.margin.toFixed(0) + ' <span style="color:#555">' + s.concentrationPct.toFixed(0) + '%</span></span></div>';
          html += '<div class="expo-bar"><div class="expo-bar-fill" style="width:' + Math.min(100, s.concentrationPct) + '%"></div></div>';
        });
        html += '</div>';
      }
      content.innerHTML = html;
    })
    .catch(function(err) {
      content.innerHTML = '<div style="color:#ff4444">Failed to load: ' + escHtml(err.message) + '</div>';
    });
}

// ═══════════════════════════════════════════════════════════════
// Exposure Inline Toggle (chart toolbar button)
// ═══════════════════════════════════════════════════════════════
var _expoInlineOpen = false;

function _toggleExpoInline() {
  _expoInlineOpen = !_expoInlineOpen;
  var panel = document.getElementById('expoInlinePanel');
  var btn = document.getElementById('expoToggleBtn');
  if (!panel) return;
  panel.style.display = _expoInlineOpen ? '' : 'none';
  if (btn) btn.classList.toggle('active', _expoInlineOpen);
  if (_expoInlineOpen) _fetchExpoInline();
}

function _fetchExpoInline() {
  var content = document.getElementById('expoInlineContent');
  if (!content) return;
  content.innerHTML = '<span style="color:#333">Loading...</span>';
  fetch('/api/exposure', { credentials: 'same-origin' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.ok) { content.innerHTML = '<span style="color:#ff4444">' + escHtml(data.error || 'Error') + '</span>'; return; }
      var html = '<div style="display:flex;flex-wrap:wrap;gap:8px 16px">';
      html += '<div class="expo-row" style="border:0;padding:0"><span class="expo-label">Mode</span> <span class="expo-val" style="color:' + (data.mode === 'live' ? '#ff4444' : '#00d4ff') + '">' + data.mode.toUpperCase() + '</span></div>';
      html += '<div class="expo-row" style="border:0;padding:0"><span class="expo-label">Bal</span> <span class="expo-val">$' + data.balance.toFixed(0) + '</span></div>';
      html += '<div class="expo-row" style="border:0;padding:0"><span class="expo-label">Margin</span> <span class="expo-val">$' + data.totalMargin.toFixed(0) + ' (' + data.marginUsagePct.toFixed(0) + '%)</span></div>';
      var pnlColor = data.unrealizedPnl > 0 ? '#00ff88' : (data.unrealizedPnl < 0 ? '#ff4444' : '#555');
      html += '<div class="expo-row" style="border:0;padding:0"><span class="expo-label">uPnL</span> <span class="expo-val" style="color:' + pnlColor + '">$' + data.unrealizedPnl.toFixed(2) + '</span></div>';
      html += '<div class="expo-row" style="border:0;padding:0"><span class="expo-label">Pos</span> <span class="expo-val">' + data.positionCount.total + '</span></div>';
      if (data.maxConcentrationPct > 0) html += '<div class="expo-row" style="border:0;padding:0"><span class="expo-label">Conc</span> <span class="expo-val" style="color:' + (data.maxConcentrationPct > 70 ? '#ff8800' : '#bbb') + '">' + data.maxConcentrationPct.toFixed(0) + '%</span></div>';
      if (data.killActive) html += '<div class="expo-row" style="border:0;padding:0"><span class="expo-label">Kill</span> <span class="expo-val" style="color:#ff4444">ACTIVE</span></div>';
      html += '</div>';
      if (data.bySymbol && data.bySymbol.length > 0) {
        html += '<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:2px 12px">';
        data.bySymbol.forEach(function(s) {
          html += '<span style="color:#666">' + s.symbol.replace('USDT','') + ' <span style="color:#999">$' + s.margin.toFixed(0) + '</span> <span style="color:#444">' + s.concentrationPct.toFixed(0) + '%</span></span>';
        });
        html += '</div>';
      }
      content.innerHTML = html;
    })
    .catch(function(err) {
      content.innerHTML = '<span style="color:#ff4444">' + escHtml(err.message) + '</span>';
    });
}

// ═══════════════════════════════════════════════════════════════
// Command Palette (Ctrl+K / Search button)
// ═══════════════════════════════════════════════════════════════
var _cmdOpen = false;
var _cmdIdx = 0;

var _CMD_ACTIONS = [
  // ── Symbols (Top 20) ──
  { cat: 'symbol', label: 'BTC — Bitcoin', icon: '₿', action: function() { if(typeof setSymbol==='function') setSymbol('BTCUSDT'); }, keys: 'btc bitcoin' },
  { cat: 'symbol', label: 'ETH — Ethereum', icon: 'Ξ', action: function() { if(typeof setSymbol==='function') setSymbol('ETHUSDT'); }, keys: 'eth ethereum' },
  { cat: 'symbol', label: 'SOL — Solana', icon: '◎', action: function() { if(typeof setSymbol==='function') setSymbol('SOLUSDT'); }, keys: 'sol solana' },
  { cat: 'symbol', label: 'BNB — Binance', icon: '◆', action: function() { if(typeof setSymbol==='function') setSymbol('BNBUSDT'); }, keys: 'bnb binance' },
  { cat: 'symbol', label: 'XRP — Ripple', icon: '✕', action: function() { if(typeof setSymbol==='function') setSymbol('XRPUSDT'); }, keys: 'xrp ripple' },
  { cat: 'symbol', label: 'DOGE — Dogecoin', icon: 'D', action: function() { if(typeof setSymbol==='function') setSymbol('DOGEUSDT'); }, keys: 'doge dogecoin' },
  { cat: 'symbol', label: 'ADA — Cardano', icon: 'A', action: function() { if(typeof setSymbol==='function') setSymbol('ADAUSDT'); }, keys: 'ada cardano' },
  { cat: 'symbol', label: 'AVAX — Avalanche', icon: 'A', action: function() { if(typeof setSymbol==='function') setSymbol('AVAXUSDT'); }, keys: 'avax avalanche' },
  { cat: 'symbol', label: 'LINK — Chainlink', icon: 'L', action: function() { if(typeof setSymbol==='function') setSymbol('LINKUSDT'); }, keys: 'link chainlink' },
  { cat: 'symbol', label: 'DOT — Polkadot', icon: 'D', action: function() { if(typeof setSymbol==='function') setSymbol('DOTUSDT'); }, keys: 'dot polkadot' },
  { cat: 'symbol', label: 'UNI — Uniswap', icon: 'U', action: function() { if(typeof setSymbol==='function') setSymbol('UNIUSDT'); }, keys: 'uni uniswap' },
  { cat: 'symbol', label: 'MATIC — Polygon', icon: 'M', action: function() { if(typeof setSymbol==='function') setSymbol('MATICUSDT'); }, keys: 'matic polygon' },
  { cat: 'symbol', label: 'ARB — Arbitrum', icon: 'A', action: function() { if(typeof setSymbol==='function') setSymbol('ARBUSDT'); }, keys: 'arb arbitrum' },
  { cat: 'symbol', label: 'OP — Optimism', icon: 'O', action: function() { if(typeof setSymbol==='function') setSymbol('OPUSDT'); }, keys: 'op optimism' },
  { cat: 'symbol', label: 'ATOM — Cosmos', icon: 'A', action: function() { if(typeof setSymbol==='function') setSymbol('ATOMUSDT'); }, keys: 'atom cosmos' },
  { cat: 'symbol', label: 'FIL — Filecoin', icon: 'F', action: function() { if(typeof setSymbol==='function') setSymbol('FILUSDT'); }, keys: 'fil filecoin' },
  { cat: 'symbol', label: 'APT — Aptos', icon: 'A', action: function() { if(typeof setSymbol==='function') setSymbol('APTUSDT'); }, keys: 'apt aptos' },
  { cat: 'symbol', label: 'NEAR — Near Protocol', icon: 'N', action: function() { if(typeof setSymbol==='function') setSymbol('NEARUSDT'); }, keys: 'near protocol' },
  { cat: 'symbol', label: 'LTC — Litecoin', icon: 'L', action: function() { if(typeof setSymbol==='function') setSymbol('LTCUSDT'); }, keys: 'ltc litecoin' },
  { cat: 'symbol', label: 'PEPE', icon: 'P', action: function() { if(typeof setSymbol==='function') setSymbol('PEPEUSDT'); }, keys: 'pepe meme' },
  // ── Navigation ──
  { cat: 'nav', label: 'Open Journal', icon: '📖', action: function() { window.open('/journal.html','_blank'); }, keys: 'journal trades history closed' },
  { cat: 'nav', label: 'Open Settings', icon: '⚙', action: function() { if(typeof openM==='function'){ openM('msettings'); if(typeof hubPopulate==='function') hubPopulate(); } }, keys: 'settings config preferences options' },
  { cat: 'nav', label: 'Open Decision Log', icon: '📋', action: function() { if(typeof _toggleDecisionPanel==='function') _toggleDecisionPanel(); }, keys: 'decisions dlog brain why blocked' },
  { cat: 'nav', label: 'View Missed Trades', icon: '🚫', action: function() { _showMissedTrades(); }, keys: 'missed trades blocked opportunities lost' },
  { cat: 'nav', label: 'Session Review (Today)', icon: '📑', action: function() { _showSessionReview(); }, keys: 'session review summary today daily report eod end' },
  { cat: 'nav', label: 'Regime History', icon: '🌐', action: function() { _showRegimeHistory(); }, keys: 'regime history timeline trend range squeeze chaos market' },
  { cat: 'nav', label: 'Performance Dashboard', icon: '🏆', action: function() { _showPerformance(); }, keys: 'performance stats equity drawdown win rate calendar streak' },
  { cat: 'nav', label: 'Strategy Comparison', icon: '⚖', action: function() { _showCompare(); }, keys: 'compare strategy demo live month regime symbol versus' },
  { cat: 'nav', label: 'Open Exposure Dashboard', icon: '📊', action: function() { if(typeof _toggleExpoInline==='function') _toggleExpoInline(); }, keys: 'exposure risk margin positions' },
  { cat: 'nav', label: 'Open Notifications', icon: '🔔', action: function() { if(typeof openM==='function'){ openM('mnotifications'); if(typeof _ncRenderList==='function') _ncRenderList(); } }, keys: 'notifications alerts messages' },
  { cat: 'nav', label: 'Open Cloud Sync', icon: '☁', action: function() { if(typeof openM==='function') openM('mcloud'); }, keys: 'cloud sync backup save load' },
  { cat: 'nav', label: 'Open Chart Settings', icon: '🎨', action: function() { if(typeof openM==='function') openM('mcharts'); }, keys: 'chart colors theme visual' },
  { cat: 'nav', label: 'Open Telegram Settings', icon: '✈', action: function() { if(typeof openM==='function'){ openM('msettings'); setTimeout(function(){ if(typeof swtab==='function') swtab('msettings','set-telegram'); },100); } }, keys: 'telegram bot notifications' },
  { cat: 'nav', label: 'Open Exchange API', icon: '🔑', action: function() { if(typeof openM==='function'){ openM('msettings'); setTimeout(function(){ if(typeof swtab==='function') swtab('msettings','set-exchange'); if(typeof zeusExchangeLoad==='function') zeusExchangeLoad(); },100); } }, keys: 'api keys binance exchange credentials' },
  { cat: 'nav', label: 'Open Account & Security', icon: '🔒', action: function() { if(typeof openM==='function'){ openM('msettings'); setTimeout(function(){ if(typeof swtab==='function') swtab('msettings','set-account'); },100); } }, keys: 'account password security pin email' },
  // ── Actions ──
  { cat: 'action', label: 'Toggle AutoTrade ON/OFF', icon: '⚡', action: function() { if(typeof toggleAutoTrade==='function') toggleAutoTrade(); }, keys: 'at autotrade toggle start stop on off' },
  { cat: 'action', label: 'Toggle Fullscreen Chart', icon: '⛶', action: function() { if(typeof toggleFS==='function') toggleFS(); }, keys: 'fullscreen expand chart big' },
  { cat: 'action', label: 'Reset Kill Switch', icon: '🛑', action: function() { if(typeof resetKillSwitch==='function') resetKillSwitch(); }, keys: 'kill switch reset unblock resume' },
  { cat: 'action', label: 'Switch to DEMO mode', icon: '🎮', action: function() { if(typeof switchGlobalMode==='function') switchGlobalMode('demo'); }, keys: 'demo mode simulate paper' },
  { cat: 'action', label: 'Switch to LIVE mode', icon: '🔴', action: function() { if(typeof switchGlobalMode==='function') switchGlobalMode('live'); }, keys: 'live mode real trading money' },
  { cat: 'action', label: 'Export Journal CSV', icon: '📥', action: function() { if(typeof exportJournalCSV==='function') exportJournalCSV(); }, keys: 'export csv download journal' },
  { cat: 'action', label: 'Add Demo Funds', icon: '💰', action: function() { if(typeof addDemoFunds==='function') addDemoFunds(); }, keys: 'demo funds balance add money reset' },
  // ── Overlays ──
  { cat: 'overlay', label: 'Toggle Liquidity Overlay', icon: 'L', action: function() { if(typeof toggleOverlay==='function') toggleOverlay('liq'); }, keys: 'liquidity liq heatmap' },
  { cat: 'overlay', label: 'Toggle Support/Resistance', icon: 'S', action: function() { if(typeof toggleOverlay==='function') toggleOverlay('sr'); }, keys: 'support resistance sr levels' },
  { cat: 'overlay', label: 'Toggle VWAP', icon: 'V', action: function() { if(typeof toggleOverlay==='function') toggleOverlay('vwap'); }, keys: 'vwap volume weighted' },
  { cat: 'overlay', label: 'Toggle Time & Sales', icon: 'T', action: function() { if(typeof toggleOverlay==='function') toggleOverlay('ts'); }, keys: 'time sales tape' },
  { cat: 'overlay', label: 'Toggle H-Lines', icon: 'H', action: function() { if(typeof toggleOverlay==='function') toggleOverlay('hline'); }, keys: 'horizontal lines hline drawing' },
  // ── Panels / Strips ──
  { cat: 'panel', label: 'Toggle DSL Panel', icon: '🎯', action: function() { if(typeof dslStripToggle==='function') dslStripToggle(); }, keys: 'dsl dynamic stop loss panel' },
  { cat: 'panel', label: 'Toggle AT Panel', icon: '🤖', action: function() { if(typeof atStripToggle==='function') atStripToggle(); }, keys: 'at autotrade panel strip' },
  { cat: 'panel', label: 'Toggle Paper Trading', icon: '📝', action: function() { if(typeof ptStripToggle==='function') ptStripToggle(); }, keys: 'paper trading manual demo panel' },
  { cat: 'panel', label: 'Toggle Activity Feed', icon: '📡', action: function() { if(typeof _actfeedToggle==='function') _actfeedToggle(); }, keys: 'activity feed events stream' },
  { cat: 'panel', label: 'Open Indicator Panel', icon: '📐', action: function() { if(typeof openIndPanel==='function') openIndPanel(); }, keys: 'indicators add rsi macd adx bollinger' },
  // ── Timeframes ──
  { cat: 'tf', label: '1m — 1 Minute', icon: '⏱', action: function() { if(typeof ztfPick==='function') ztfPick('1m'); }, keys: '1m 1min minute scalp' },
  { cat: 'tf', label: '3m — 3 Minutes', icon: '⏱', action: function() { if(typeof ztfPick==='function') ztfPick('3m'); }, keys: '3m 3min' },
  { cat: 'tf', label: '5m — 5 Minutes', icon: '⏱', action: function() { if(typeof ztfPick==='function') ztfPick('5m'); }, keys: '5m 5min' },
  { cat: 'tf', label: '15m — 15 Minutes', icon: '⏱', action: function() { if(typeof ztfPick==='function') ztfPick('15m'); }, keys: '15m 15min' },
  { cat: 'tf', label: '1h — 1 Hour', icon: '⏱', action: function() { if(typeof ztfPick==='function') ztfPick('1h'); }, keys: '1h 1hour hour' },
  { cat: 'tf', label: '4h — 4 Hours', icon: '⏱', action: function() { if(typeof ztfPick==='function') ztfPick('4h'); }, keys: '4h 4hour swing' },
  { cat: 'tf', label: '1d — Daily', icon: '⏱', action: function() { if(typeof ztfPick==='function') ztfPick('1d'); }, keys: '1d daily day' },
  { cat: 'tf', label: '1w — Weekly', icon: '⏱', action: function() { if(typeof ztfPick==='function') ztfPick('1w'); }, keys: '1w weekly week' },
  // ── Info ──
  { cat: 'info', label: 'Show Keyboard Shortcuts', icon: '⌨', action: function() { document.dispatchEvent(new KeyboardEvent('keydown',{key:'?'})); }, keys: 'hotkeys keyboard shortcuts help' },
];

function _toggleCmdPalette() {
  _cmdOpen = !_cmdOpen;
  var el = document.getElementById('cmdPalette');
  if (!el) return;
  el.style.display = _cmdOpen ? 'flex' : 'none';
  if (_cmdOpen) {
    var input = document.getElementById('cmdInput');
    if (input) {
      input.value = '';
      // Delayed focus for mobile (iOS/Android block instant focus)
      setTimeout(function() { input.focus(); }, 50);
      setTimeout(function() { input.focus(); }, 200);
    }
    _cmdIdx = 0;
    _cmdRender('');
  }
}

function _cmdRender(query) {
  var results = document.getElementById('cmdResults');
  if (!results) return;
  var q = (query || '').toLowerCase().trim();
  var filtered = q ? _CMD_ACTIONS.filter(function(a) {
    return a.label.toLowerCase().indexOf(q) !== -1 || a.keys.indexOf(q) !== -1;
  }) : _CMD_ACTIONS;
  if (filtered.length === 0) {
    results.innerHTML = '<div class="cmd-empty">No results for "' + q + '"</div>';
    return;
  }
  _cmdIdx = Math.max(0, Math.min(_cmdIdx, filtered.length - 1));
  results.innerHTML = filtered.map(function(a, i) {
    return '<div class="cmd-item' + (i === _cmdIdx ? ' active' : '') + '" data-cmd-idx="' + i + '">' +
      '<span class="cmd-item-icon">' + a.icon + '</span>' +
      '<span class="cmd-item-label">' + a.label + '</span>' +
      '<span class="cmd-item-hint">' + a.cat + '</span>' +
      '</div>';
  }).join('');
  // Store filtered for delegated handler
  results._cmdFiltered = filtered;
  // Scroll active into view
  var active = results.querySelector('.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function _cmdHighlight() {
  var q = (document.getElementById('cmdInput') || {}).value || '';
  _cmdRender(q);
}

function _cmdExec(idx) {
  var results = document.getElementById('cmdResults');
  var filtered = results && results._cmdFiltered ? results._cmdFiltered : [];
  if (filtered[idx]) {
    _toggleCmdPalette();
    filtered[idx].action();
  }
}

// Keyboard handling for command palette
document.addEventListener('keydown', function(e) {
  // Ctrl+K / Cmd+K opens palette
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    _toggleCmdPalette();
    return;
  }
  if (!_cmdOpen) return;
  // ESC closes
  if (e.key === 'Escape') { _toggleCmdPalette(); return; }
  // Arrow navigation
  if (e.key === 'ArrowDown') { e.preventDefault(); _cmdIdx++; _cmdHighlight(); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); _cmdIdx = Math.max(0, _cmdIdx - 1); _cmdHighlight(); return; }
  // Enter executes
  if (e.key === 'Enter') {
    e.preventDefault();
    _cmdExec(_cmdIdx);
    return;
  }
});

// Input handler
document.addEventListener('input', function(e) {
  if (e.target && e.target.id === 'cmdInput') {
    _cmdIdx = 0;
    _cmdRender(e.target.value);
  }
});

// Delegated click handler for command palette (works on mobile + desktop)
document.addEventListener('click', function(e) {
  if (!_cmdOpen) return;
  // Click on overlay background closes
  if (e.target && e.target.id === 'cmdPalette') { _toggleCmdPalette(); return; }
  // Click on cmd-item or child of cmd-item executes
  var item = e.target.closest ? e.target.closest('.cmd-item') : null;
  if (item && item.dataset.cmdIdx != null) {
    var idx = parseInt(item.dataset.cmdIdx, 10);
    var results = document.getElementById('cmdResults');
    var filtered = results && results._cmdFiltered ? results._cmdFiltered : [];
    if (filtered[idx]) {
      _toggleCmdPalette();
      filtered[idx].action();
    }
  }
});

// ═══════════════════════════════════════════════════════════════
// Missed Trades Viewer
// ═══════════════════════════════════════════════════════════════
function _showMissedTrades() {
  var panel = document.getElementById('missedPanel');
  if (!panel) return;
  panel.style.display = 'flex';
  var content = document.getElementById('missedContent');
  if (!content) return;
  content.innerHTML = '<div style="text-align:center;color:#333;padding:16px">Loading...</div>';
  fetch('/api/missed-trades?limit=100', { credentials: 'same-origin' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.ok || !data.trades || data.trades.length === 0) {
        content.innerHTML = '<div style="text-align:center;color:#333;padding:20px;font-size:11px">No missed trades recorded yet. Signals blocked by AT gates will appear here.</div>';
        return;
      }
      // Aggregate reasons
      var reasons = {};
      data.trades.forEach(function(t) { reasons[t.reason] = (reasons[t.reason] || 0) + 1; });
      var statsHtml = '<div style="padding:8px 16px;font-size:9px;color:#555;border-bottom:1px solid #0f0f1a;display:flex;gap:10px;flex-wrap:wrap">';
      statsHtml += '<span>Total: <b style="color:#888">' + data.trades.length + '</b></span>';
      for (var r in reasons) {
        var color = r === 'KILL_SWITCH' ? '#ff4444' : (r === 'AT_DISABLED' ? '#aa44ff' : '#ff8800');
        statsHtml += '<span>' + r.replace(/_/g,' ') + ': <b style="color:' + color + '">' + reasons[r] + '</b></span>';
      }
      statsHtml += '</div>';

      var rowsHtml = data.trades.map(function(t) {
        var sideColor = t.side === 'LONG' ? '#00ff88' : '#ff4444';
        var reasonColor = t.reason === 'KILL_SWITCH' ? '#ff4444' : (t.reason === 'AT_DISABLED' ? '#aa44ff' : '#ff8800');
        var ts = new Date(t.created_at).toLocaleString('en-GB', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
        return '<div class="dlog-entry-row">' +
          '<span class="dlog-ts">' + ts + '</span>' +
          '<span style="color:' + sideColor + ';font-weight:700;font-size:9px;margin-right:4px">' + t.side + '</span>' +
          '<span style="color:#ccc;margin-right:6px">' + (t.symbol || '').replace('USDT','') + '</span>' +
          '<span style="color:' + reasonColor + ';font-size:9px;font-weight:600">' + t.reason.replace(/_/g,' ') + '</span>' +
          '<span style="color:#555;margin-left:auto;font-size:9px">$' + (t.price || 0).toFixed(0) + ' | ' + (t.tier || '?') + ' | conf=' + (t.confidence || 0) + '%</span>' +
          '</div>';
      }).join('');

      content.innerHTML = statsHtml + rowsHtml;
    })
    .catch(function(err) {
      content.innerHTML = '<div style="color:#ff4444;padding:16px">' + escHtml(err.message) + '</div>';
    });
}

// ═══════════════════════════════════════════════════════════════
// Session Review
// ═══════════════════════════════════════════════════════════════
function _showSessionReview() {
  var panel = document.getElementById('sessionPanel');
  if (!panel) return;
  panel.style.display = 'flex';
  var content = document.getElementById('sessionContent');
  var dateEl = document.getElementById('sessionDate');
  if (!content) return;
  content.innerHTML = '<div style="text-align:center;color:#333;padding:20px">Loading session data...</div>';
  fetch('/api/session-review', { credentials: 'same-origin' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.ok) { content.innerHTML = '<div style="color:#ff4444">' + escHtml(data.error || 'Error') + '</div>'; return; }
      if (dateEl) dateEl.textContent = data.date;
      var s = data.summary;
      var html = '';

      // Hero PnL
      var pnlClass = s.totalPnl > 0 ? 'positive' : (s.totalPnl < 0 ? 'negative' : 'zero');
      html += '<div class="sr-hero">';
      html += '<div class="sr-pnl ' + pnlClass + '">$' + s.totalPnl.toFixed(2) + '</div>';
      html += '<div class="sr-sub">' + s.totalTrades + ' trades | ' + s.wins + 'W / ' + s.losses + 'L | WR: ' + s.winRate + '%</div>';
      if (data.missedCount > 0) html += '<div class="sr-sub" style="color:#ff8800">' + data.missedCount + ' missed opportunities</div>';
      html += '</div>';

      // Stats grid
      html += '<div class="sr-grid">';
      html += '<div class="sr-card"><div class="sr-card-label">Avg PnL</div><div class="sr-card-val" style="color:' + (s.avgPnl >= 0 ? '#00ff88' : '#ff4444') + '">$' + s.avgPnl.toFixed(2) + '</div></div>';
      html += '<div class="sr-card"><div class="sr-card-label">Avg Hold</div><div class="sr-card-val">' + s.avgHoldMin + 'min</div></div>';
      if (s.bestTrade) html += '<div class="sr-card"><div class="sr-card-label">Best Trade</div><div class="sr-card-val" style="color:#00ff88">' + (s.bestTrade.symbol||'').replace('USDT','') + ' $' + (s.bestTrade.pnl||0).toFixed(2) + '</div></div>';
      if (s.worstTrade) html += '<div class="sr-card"><div class="sr-card-label">Worst Trade</div><div class="sr-card-val" style="color:#ff4444">' + (s.worstTrade.symbol||'').replace('USDT','') + ' $' + (s.worstTrade.pnl||0).toFixed(2) + '</div></div>';
      if (s.avgCapturedPct !== null) html += '<div class="sr-card"><div class="sr-card-label">Avg Captured</div><div class="sr-card-val">' + s.avgCapturedPct + '%</div></div>';
      if (s.avgMAE !== null) html += '<div class="sr-card"><div class="sr-card-label">Avg MAE</div><div class="sr-card-val" style="color:#ff8800">' + s.avgMAE + '%</div></div>';
      html += '</div>';

      // Per-symbol breakdown
      if (data.symbols && Object.keys(data.symbols).length > 0) {
        html += '<div class="sr-section"><div class="sr-section-title">PER SYMBOL</div>';
        var maxSymPnl = Math.max.apply(null, Object.values(data.symbols).map(function(v){return Math.abs(v.pnl);})) || 1;
        for (var sym in data.symbols) {
          var sv = data.symbols[sym];
          var pct = Math.abs(sv.pnl) / maxSymPnl * 100;
          var color = sv.pnl >= 0 ? '#00ff88' : '#ff4444';
          html += '<div class="sr-bar-row"><span class="sr-bar-label">' + sym.replace('USDT','') + '</span><div class="sr-bar-track"><div class="sr-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div><span class="sr-bar-val" style="color:' + color + '">$' + sv.pnl.toFixed(2) + ' (' + sv.count + ')</span></div>';
        }
        html += '</div>';
      }

      // Per-regime breakdown
      if (data.regimes && Object.keys(data.regimes).length > 0) {
        html += '<div class="sr-section"><div class="sr-section-title">PER REGIME</div>';
        var maxRegPnl = Math.max.apply(null, Object.values(data.regimes).map(function(v){return Math.abs(v.pnl);})) || 1;
        for (var reg in data.regimes) {
          var rv = data.regimes[reg];
          var rpct = Math.abs(rv.pnl) / maxRegPnl * 100;
          var rcolor = rv.pnl >= 0 ? '#00ff88' : '#ff4444';
          html += '<div class="sr-bar-row"><span class="sr-bar-label">' + reg + '</span><div class="sr-bar-track"><div class="sr-bar-fill" style="width:' + rpct + '%;background:' + rcolor + '"></div></div><span class="sr-bar-val" style="color:' + rcolor + '">$' + rv.pnl.toFixed(2) + ' (' + rv.count + ')</span></div>';
        }
        html += '</div>';
      }

      // Exit reasons
      if (data.exitReasons && Object.keys(data.exitReasons).length > 0) {
        html += '<div class="sr-section"><div class="sr-section-title">EXIT REASONS</div>';
        html += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
        for (var er in data.exitReasons) {
          html += '<span style="font-size:9px;padding:2px 6px;background:#111;border:1px solid #222;border-radius:2px;color:#888">' + er.replace(/_/g,' ') + ' <b style="color:#ccc">' + data.exitReasons[er] + '</b></span>';
        }
        html += '</div></div>';
      }

      // No trades state
      if (s.totalTrades === 0) {
        html = '<div style="text-align:center;padding:30px;color:#333;font-size:12px">No trades closed today yet.<br><span style="font-size:10px;color:#222">Session review will populate as trades close.</span></div>';
      }

      content.innerHTML = html;
    })
    .catch(function(err) {
      content.innerHTML = '<div style="color:#ff4444;padding:16px">' + escHtml(err.message) + '</div>';
    });
}

// ═══════════════════════════════════════════════════════════════
// Regime History Timeline
// ═══════════════════════════════════════════════════════════════
function _showRegimeHistory() {
  var panel = document.getElementById('regimePanel');
  if (!panel) return;
  panel.style.display = 'flex';
  var content = document.getElementById('regimeContent');
  if (!content) return;
  content.innerHTML = '<div style="text-align:center;color:#333;padding:20px">Loading...</div>';
  fetch('/api/regime-history?limit=200', { credentials: 'same-origin' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.ok || !data.history || data.history.length === 0) {
        content.innerHTML = '<div style="text-align:center;color:#333;padding:20px;font-size:11px">No regime changes recorded yet. Brain will log regime transitions as they happen.</div>';
        return;
      }

      // Stats: count per regime
      var counts = {};
      data.history.forEach(function(h) {
        counts[h.regime] = (counts[h.regime] || 0) + 1;
      });
      var statsHtml = '<div class="rh-stats">';
      statsHtml += '<span>Total changes: <b style="color:#888">' + data.history.length + '</b></span>';
      for (var reg in counts) {
        statsHtml += '<span><span class="rh-regime rh-regime-' + reg + '">' + reg + '</span> ' + counts[reg] + '</span>';
      }
      statsHtml += '</div>';

      // Rows
      var rowsHtml = data.history.map(function(h) {
        var ts = h.created_at ? new Date(h.created_at + 'Z').toLocaleString('en-GB', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '?';
        var prevClass = h.prev_regime ? 'rh-regime-' + h.prev_regime : '';
        return '<div class="rh-row">' +
          '<span class="rh-ts">' + ts + '</span>' +
          '<span class="rh-sym">' + (h.symbol || '').replace('USDT','') + '</span>' +
          (h.prev_regime ? '<span class="rh-regime ' + prevClass + '">' + h.prev_regime + '</span>' : '') +
          '<span class="rh-arrow">&rarr;</span>' +
          '<span class="rh-regime rh-regime-' + h.regime + '">' + h.regime + '</span>' +
          '<span class="rh-conf">' + (h.confidence || 0) + '%</span>' +
          '<span class="rh-price">$' + (h.price || 0).toFixed(h.price >= 100 ? 0 : 2) + '</span>' +
          '</div>';
      }).join('');

      content.innerHTML = statsHtml + rowsHtml;
    })
    .catch(function(err) {
      content.innerHTML = '<div style="color:#ff4444;padding:16px">' + escHtml(err.message) + '</div>';
    });
}

// ═══════════════════════════════════════════════════════════════
// Performance Dashboard Pro
// ═══════════════════════════════════════════════════════════════
var _perfMode = '';

function _showPerformance(mode) {
  var panel = document.getElementById('perfPanel');
  if (!panel) return;
  panel.style.display = 'flex';
  _perfMode = mode || '';

  // Render mode tabs
  var tabs = document.getElementById('perfModeTabs');
  if (tabs && !tabs.dataset.init) {
    tabs.dataset.init = '1';
    ['all','demo','live'].forEach(function(m) {
      var btn = document.createElement('button');
      btn.className = 'perf-tab' + (m === '' || m === 'all' ? ' active' : '');
      btn.textContent = m === 'all' ? 'ALL' : m.toUpperCase();
      btn.onclick = function() {
        tabs.querySelectorAll('.perf-tab').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        _showPerformance(m === 'all' ? '' : m);
      };
      tabs.appendChild(btn);
    });
  }

  var content = document.getElementById('perfContent');
  if (!content) return;
  content.innerHTML = '<div style="text-align:center;color:#333;padding:20px">Loading...</div>';
  var url = '/api/performance' + (_perfMode ? '?mode=' + _perfMode : '');
  fetch(url, { credentials: 'same-origin' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.ok) { content.innerHTML = '<div style="color:#ff4444;padding:16px">' + escHtml(data.error || 'Error') + '</div>'; return; }
      if (data.empty) { content.innerHTML = '<div style="text-align:center;color:#333;padding:30px;font-size:11px">No trades yet. Performance data will appear as trades close.</div>'; return; }
      var html = '';

      // Hero stats
      var pnlColor = data.totalPnl > 0 ? '#00ff88' : (data.totalPnl < 0 ? '#ff4444' : '#555');
      html += '<div class="perf-hero">';
      html += '<div class="perf-stat"><div class="perf-stat-val" style="color:' + pnlColor + '">$' + data.totalPnl.toFixed(2) + '</div><div class="perf-stat-lbl">TOTAL PNL</div></div>';
      html += '<div class="perf-stat"><div class="perf-stat-val">' + data.totalTrades + '</div><div class="perf-stat-lbl">TRADES</div></div>';
      html += '<div class="perf-stat"><div class="perf-stat-val" style="color:#ff4444">-$' + data.maxDrawdown.toFixed(2) + '</div><div class="perf-stat-lbl">MAX DD</div></div>';
      html += '<div class="perf-stat"><div class="perf-stat-val" style="color:#00ff88">' + data.bestWinStreak + '</div><div class="perf-stat-lbl">WIN STREAK</div></div>';
      html += '<div class="perf-stat"><div class="perf-stat-val" style="color:#ff4444">' + data.worstLossStreak + '</div><div class="perf-stat-lbl">LOSS STREAK</div></div>';
      html += '</div>';

      // Equity curve (bar chart)
      if (data.equity && data.equity.length > 0) {
        var eqMin = Math.min.apply(null, data.equity.map(function(e){return e.pnl;}));
        var eqMax = Math.max.apply(null, data.equity.map(function(e){return e.pnl;}));
        var eqRange = Math.max(Math.abs(eqMin), Math.abs(eqMax)) || 1;
        html += '<div class="perf-eq"><div class="perf-eq-title">EQUITY CURVE</div><div class="perf-eq-bar">';
        var step = Math.max(1, Math.floor(data.equity.length / 80));
        for (var ei = 0; ei < data.equity.length; ei += step) {
          var e = data.equity[ei];
          var h = Math.abs(e.pnl) / eqRange * 36;
          var c = e.pnl >= 0 ? '#00ff88' : '#ff4444';
          html += '<div class="perf-eq-col" style="height:' + Math.max(1, h) + 'px;background:' + c + '" title="$' + e.pnl.toFixed(2) + '"></div>';
        }
        html += '</div></div>';
      }

      // Calendar heatmap
      if (data.calendar && Object.keys(data.calendar).length > 0) {
        var days = Object.keys(data.calendar).sort();
        var calMax = Math.max.apply(null, Object.values(data.calendar).map(function(d){return Math.abs(d.pnl);})) || 1;
        html += '<div class="perf-cal"><div class="perf-eq-title">P&L CALENDAR</div><div class="perf-cal-grid">';
        days.forEach(function(day) {
          var d = data.calendar[day];
          var intensity = Math.min(1, Math.abs(d.pnl) / calMax);
          var bg = d.pnl >= 0 ? 'rgba(0,255,136,' + (0.15 + intensity * 0.7) + ')' : 'rgba(255,68,68,' + (0.15 + intensity * 0.7) + ')';
          html += '<div class="perf-cal-day" style="background:' + bg + '" title="' + day + ': $' + d.pnl.toFixed(2) + ' (' + d.count + ' trades)">' + day.slice(8) + '</div>';
        });
        html += '</div></div>';
      }

      // PnL distribution
      if (data.buckets) {
        var bMax = Math.max.apply(null, Object.values(data.buckets)) || 1;
        html += '<div class="perf-bucket"><div class="perf-eq-title">PNL DISTRIBUTION</div>';
        var bKeys = Object.keys(data.buckets);
        bKeys.forEach(function(k) {
          var v = data.buckets[k];
          var pct = v / bMax * 100;
          var isNeg = k.indexOf('-') !== -1 || k.indexOf('<') !== -1;
          var c = isNeg ? '#ff4444' : '#00ff88';
          html += '<div class="perf-bucket-row"><span class="perf-bucket-lbl">$' + k + '</span><div class="perf-bucket-bar"><div class="perf-bucket-fill" style="width:' + pct + '%;background:' + c + '"></div></div><span class="perf-bucket-val">' + v + '</span></div>';
        });
        html += '</div>';
      }

      // Per-symbol table
      if (data.bySymbol && Object.keys(data.bySymbol).length > 0) {
        html += '<div style="padding:8px 16px;border-bottom:1px solid #0f0f1a"><div class="perf-eq-title">PER SYMBOL</div>';
        for (var sym in data.bySymbol) {
          var sv = data.bySymbol[sym];
          var sColor = sv.pnl >= 0 ? '#00ff88' : '#ff4444';
          html += '<div class="sr-bar-row"><span class="sr-bar-label">' + sym.replace('USDT','') + '</span><span style="color:' + sColor + ';font-size:10px;width:60px">$' + sv.pnl.toFixed(2) + '</span><span style="color:#888;font-size:9px">WR ' + sv.winRate + '% (' + sv.wins + 'W/' + sv.losses + 'L)</span></div>';
        }
        html += '</div>';
      }

      // Per-regime table
      if (data.byRegime && Object.keys(data.byRegime).length > 0) {
        html += '<div style="padding:8px 16px"><div class="perf-eq-title">PER REGIME</div>';
        for (var reg in data.byRegime) {
          var rv = data.byRegime[reg];
          var rColor = rv.pnl >= 0 ? '#00ff88' : '#ff4444';
          html += '<div class="sr-bar-row"><span class="sr-bar-label">' + reg + '</span><span style="color:' + rColor + ';font-size:10px;width:60px">$' + rv.pnl.toFixed(2) + '</span><span style="color:#888;font-size:9px">WR ' + rv.winRate + '% (' + rv.wins + 'W/' + rv.losses + 'L)</span></div>';
        }
        html += '</div>';
      }

      content.innerHTML = html;
    })
    .catch(function(err) {
      content.innerHTML = '<div style="color:#ff4444;padding:16px">' + escHtml(err.message) + '</div>';
    });
}

// ═══════════════════════════════════════════════════════════════
// Strategy Comparison
// ═══════════════════════════════════════════════════════════════
function _showCompare() {
  var panel = document.getElementById('comparePanel');
  if (!panel) return;
  panel.style.display = 'flex';
  var content = document.getElementById('compareContent');
  if (!content) return;
  content.innerHTML = '<div style="text-align:center;color:#333;padding:20px">Loading...</div>';
  fetch('/api/compare', { credentials: 'same-origin' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.ok) { content.innerHTML = '<div style="color:#ff4444;padding:16px">' + escHtml(data.error || 'Error') + '</div>'; return; }
      var html = '';

      // Demo vs Live
      html += _cmpSection('DEMO vs LIVE', ['Metric', 'DEMO', 'LIVE'], data.demoVsLive.demo, data.demoVsLive.live);

      // This month vs last month
      html += _cmpSection(data.thisVsLast.thisLabel + ' vs ' + data.thisVsLast.lastLabel, ['Metric', 'THIS MONTH', 'LAST MONTH'], data.thisVsLast.thisMonth, data.thisVsLast.lastMonth);

      // Per regime
      var regKeys = Object.keys(data.byRegime);
      if (regKeys.length >= 2) {
        html += '<div class="cmp-section"><div class="cmp-title">PER REGIME</div><table class="cmp-table"><tr><th>Metric</th>';
        regKeys.forEach(function(r) { html += '<th>' + r + '</th>'; });
        html += '</tr>';
        var metrics = [
          { key: 'trades', label: 'Trades' }, { key: 'winRate', label: 'Win Rate %' },
          { key: 'totalPnl', label: 'Total PnL' }, { key: 'avgPnl', label: 'Avg PnL' },
          { key: 'maxDD', label: 'Max DD' }, { key: 'avgCaptured', label: 'Avg Captured %' },
        ];
        metrics.forEach(function(m) {
          html += '<tr><td>' + m.label + '</td>';
          regKeys.forEach(function(r) {
            var v = data.byRegime[r][m.key];
            var cls = m.key === 'totalPnl' || m.key === 'avgPnl' ? (v > 0 ? 'cmp-pos' : (v < 0 ? 'cmp-neg' : '')) : '';
            html += '<td class="' + cls + '">' + _cmpFmt(m.key, v) + '</td>';
          });
          html += '</tr>';
        });
        html += '</table></div>';
      }

      // Per symbol (top 5)
      var symKeys = Object.keys(data.bySymbol).sort(function(a,b) { return data.bySymbol[b].trades - data.bySymbol[a].trades; }).slice(0, 5);
      if (symKeys.length >= 2) {
        html += '<div class="cmp-section"><div class="cmp-title">TOP SYMBOLS</div><table class="cmp-table"><tr><th>Metric</th>';
        symKeys.forEach(function(s) { html += '<th>' + s.replace('USDT','') + '</th>'; });
        html += '</tr>';
        [{ key:'trades',label:'Trades' },{ key:'winRate',label:'Win Rate %' },{ key:'totalPnl',label:'PnL' },{ key:'avgPnl',label:'Avg PnL' }].forEach(function(m) {
          html += '<tr><td>' + m.label + '</td>';
          symKeys.forEach(function(s) {
            var v = data.bySymbol[s][m.key];
            var cls = m.key === 'totalPnl' || m.key === 'avgPnl' ? (v > 0 ? 'cmp-pos' : (v < 0 ? 'cmp-neg' : '')) : '';
            html += '<td class="' + cls + '">' + _cmpFmt(m.key, v) + '</td>';
          });
          html += '</tr>';
        });
        html += '</table></div>';
      }

      if (!data.demoVsLive.demo.trades && !data.demoVsLive.live.trades) {
        html = '<div style="text-align:center;color:#333;padding:30px;font-size:11px">No trades yet to compare.</div>';
      }

      content.innerHTML = html;
    })
    .catch(function(err) {
      content.innerHTML = '<div style="color:#ff4444;padding:16px">' + escHtml(err.message) + '</div>';
    });
}

function _cmpSection(title, headers, setA, setB) {
  var metrics = [
    { key: 'trades', label: 'Trades' }, { key: 'wins', label: 'Wins' }, { key: 'losses', label: 'Losses' },
    { key: 'winRate', label: 'Win Rate %' }, { key: 'totalPnl', label: 'Total PnL' },
    { key: 'avgPnl', label: 'Avg PnL' }, { key: 'avgHoldMin', label: 'Avg Hold (min)' },
    { key: 'maxDD', label: 'Max Drawdown' }, { key: 'bestTrade', label: 'Best Trade' },
    { key: 'worstTrade', label: 'Worst Trade' }, { key: 'avgCaptured', label: 'Avg Captured %' },
  ];
  var html = '<div class="cmp-section"><div class="cmp-title">' + title + '</div>';
  html += '<table class="cmp-table"><tr>';
  headers.forEach(function(h) { html += '<th>' + h + '</th>'; });
  html += '</tr>';
  metrics.forEach(function(m) {
    var a = setA[m.key]; var b = setB[m.key];
    var clsA = m.key === 'totalPnl' || m.key === 'avgPnl' || m.key === 'bestTrade' ? (a > 0 ? 'cmp-pos' : (a < 0 ? 'cmp-neg' : '')) : '';
    var clsB = m.key === 'totalPnl' || m.key === 'avgPnl' || m.key === 'bestTrade' ? (b > 0 ? 'cmp-pos' : (b < 0 ? 'cmp-neg' : '')) : '';
    // Highlight better value
    if (m.key === 'winRate' || m.key === 'totalPnl' || m.key === 'avgPnl') {
      if (a > b) clsA += ' cmp-hi'; else if (b > a) clsB += ' cmp-hi';
    }
    html += '<tr><td>' + m.label + '</td><td class="' + clsA + '">' + _cmpFmt(m.key, a) + '</td><td class="' + clsB + '">' + _cmpFmt(m.key, b) + '</td></tr>';
  });
  html += '</table></div>';
  return html;
}

function _cmpFmt(key, val) {
  if (val === null || val === undefined) return '—';
  if (key === 'totalPnl' || key === 'avgPnl' || key === 'maxDD' || key === 'bestTrade' || key === 'worstTrade') return '$' + val.toFixed(2);
  if (key === 'winRate' || key === 'avgCaptured') return val + '%';
  if (key === 'avgHoldMin') return val + 'm';
  return '' + val;
}

// ══════════════════════════════════════════════════════════════════
// BRAIN VISION (V2) — Polls /api/trading/brain/vision every 30s
// ══════════════════════════════════════════════════════════════════
(function () {
  var _bvTimer = null;
  var _bvData = null;

  function _bvColor(dir) {
    if (dir === 'bull' || dir === 'up' || dir === 'LONG' || dir === 'bullish') return '#00ff88';
    if (dir === 'bear' || dir === 'down' || dir === 'SHORT' || dir === 'bearish') return '#ff4466';
    return 'rgba(255,255,255,0.35)';
  }
  function _bvArrow(dir) {
    if (dir === 'bull' || dir === 'up' || dir === 'LONG') return '\u2191';
    if (dir === 'bear' || dir === 'down' || dir === 'SHORT') return '\u2193';
    return '\u2194';
  }
  function _bvDot(dir) {
    var c = _bvColor(dir);
    return '<span style="color:' + c + '">\u25CF</span>';
  }
  function _bvVal(v, suffix) {
    if (v === null || v === undefined) return '<span style="color:var(--dim)">\u2014</span>';
    return v + (suffix || '');
  }
  function _bvDelta(v) {
    if (!v && v !== 0) return '\u2014';
    var sign = v >= 0 ? '+' : '';
    var color = v > 0 ? '#00ff88' : v < 0 ? '#ff4466' : 'rgba(255,255,255,0.35)';
    return '<span style="color:' + color + '">' + sign + (v >= 1000 || v <= -1000 ? (v / 1000).toFixed(1) + 'K' : v) + '</span>';
  }

  function _bvRender() {
    var body = document.getElementById('brainVisionBody');
    var cycleEl = document.getElementById('brainVisionCycle');
    if (!body || !_bvData) return;

    if (cycleEl) cycleEl.textContent = 'C' + (_bvData.cycle || 0);

    var syms = _bvData.symbols;
    if (!syms || Object.keys(syms).length === 0) {
      body.innerHTML = '<div style="color:var(--dim);padding:4px 0">Waiting for data...</div>';
      return;
    }

    var html = '';
    for (var sym in syms) {
      var d = syms[sym];
      var short = sym.replace('USDT', '');

      // ── Header: symbol + regime ──
      html += '<div style="border-top:1px solid rgba(120,80,220,0.1);padding:5px 0 2px;margin-top:3px">';
      html += '<span style="color:#aa88ff;font-weight:bold;font-size:9px;letter-spacing:1px">' + short + '</span>';
      html += ' <span style="color:var(--dim);font-size:7px">$' + (d.price || 0).toLocaleString() + '</span>';
      html += ' <span style="background:rgba(120,80,220,0.15);color:#cc88ff;font-size:7px;padding:1px 4px;border-radius:2px;letter-spacing:1px">' + (d.regime || '?') + '</span>';
      html += '</div>';

      // ── MTF Alignment ──
      var mtfHtml = '';
      var tfOrder = ['4h', '1h', '15m', '5m'];
      for (var i = 0; i < tfOrder.length; i++) {
        var tf = tfOrder[i];
        var m = d.mtf[tf];
        if (!m) continue;
        mtfHtml += '<span style="margin-right:5px">' + tf + ':' + _bvDot(m.st) + '</span>';
      }
      if (mtfHtml) {
        html += '<div style="padding:1px 0;color:rgba(255,255,255,0.5)"><span style="color:var(--dim);width:65px;display:inline-block;font-weight:600">MTF</span>' + mtfHtml + '</div>';
      }

      // ── Structure ──
      var structColor = _bvColor(d.structure.trend);
      var structLabel = d.structure.trend || 'none';
      if (d.structure.choch) structLabel = 'CHoCH ' + _bvArrow(d.structure.choch);
      else if (d.structure.bos) structLabel = 'BOS ' + _bvArrow(d.structure.bos);
      html += '<div style="padding:1px 0"><span style="color:var(--dim);width:65px;display:inline-block;font-weight:600">STRUCT</span>';
      html += '<span style="color:' + structColor + '">' + structLabel + '</span>';
      html += ' <span style="color:var(--dim)">(' + d.structure.score + '%)</span></div>';

      // ── Order Flow ──
      html += '<div style="padding:1px 0"><span style="color:var(--dim);width:65px;display:inline-block;font-weight:600">FLOW</span>';
      html += 'CVD:' + _bvDelta(d.flow.delta5m);
      if (d.flow.poc) html += ' <span style="color:var(--dim)">POC:$' + d.flow.poc.toLocaleString() + '</span>';
      if (d.flow.absorption > 30) html += ' <span style="color:#ffaa00">ABS:' + d.flow.absorption + '%</span>';
      html += '</div>';

      // ── Sentiment ──
      var sentColor = d.sentiment.score > 15 ? '#00ff88' : d.sentiment.score < -15 ? '#ff4466' : 'rgba(255,255,255,0.35)';
      html += '<div style="padding:1px 0"><span style="color:var(--dim);width:65px;display:inline-block;font-weight:600">SENT</span>';
      html += '<span style="color:' + sentColor + '">' + (d.sentiment.score > 0 ? '+' : '') + d.sentiment.score + '</span>';
      html += ' <span style="color:var(--dim)">crowd:' + (d.sentiment.crowd || '?') + ' fund:' + (d.sentiment.funding || '?') + '</span></div>';

      // ── Liquidity ──
      html += '<div style="padding:1px 0"><span style="color:var(--dim);width:65px;display:inline-block;font-weight:600">LIQ</span>';
      if (d.liquidity.above) html += '<span style="color:#ff4466">\u2191$' + d.liquidity.above.toLocaleString() + '</span> ';
      if (d.liquidity.below) html += '<span style="color:#00ff88">\u2193$' + d.liquidity.below.toLocaleString() + '</span> ';
      html += '<span style="color:var(--dim)">' + d.liquidity.zones + 'z</span>';
      if (d.liquidity.grabRisk > 30) html += ' <span style="color:#ffaa00">GRAB:' + d.liquidity.grabRisk + '%</span>';
      if (d.liquidity.antic && d.liquidity.antic !== 'neutral') html += ' <span style="color:#ffaa00">' + d.liquidity.antic + '</span>';
      html += '</div>';

      // ── Regime Params ──
      html += '<div style="padding:1px 0"><span style="color:var(--dim);width:65px;display:inline-block;font-weight:600">PARAMS</span>';
      html += '<span style="color:rgba(255,255,255,0.45)">conf\u2265' + d.regimeParams.confMin + ' SL\u00D7' + d.regimeParams.slMult + ' RR\u2265' + d.regimeParams.rrMin + ' DSL:' + d.regimeParams.dsl + ' size:' + (d.regimeParams.sizeScale * 100) + '%</span></div>';

      // ── KNN ──
      if (d.knn) {
        var knnColor = d.knn.winRate >= 60 ? '#00ff88' : d.knn.winRate <= 40 ? '#ff4466' : '#ffaa00';
        html += '<div style="padding:1px 0"><span style="color:var(--dim);width:65px;display:inline-block;font-weight:600">KNN</span>';
        html += '<span style="color:' + knnColor + '">' + d.knn.winRate + '% WIN</span>';
        html += ' <span style="color:var(--dim)">dir:' + (d.knn.dir || '?') + ' sim:' + (d.knn.similarity || '?') + '% ' + d.knn.patterns + ' patterns</span></div>';
      }

      // ── Journal ──
      if (d.journal) {
        var jColor = d.journal.winRate >= 50 ? '#00ff88' : '#ff4466';
        html += '<div style="padding:1px 0"><span style="color:var(--dim);width:65px;display:inline-block;font-weight:600">LEARN</span>';
        html += '<span style="color:' + jColor + '">WR:' + d.journal.winRate + '%</span>';
        html += ' <span style="color:var(--dim)">' + d.journal.trades + ' trades</span>';
        if (d.journal.bestRegime) html += ' <span style="color:#00ff88">best:' + d.journal.bestRegime + '</span>';
        if (d.journal.worstRegime) html += ' <span style="color:#ff4466">avoid:' + d.journal.worstRegime + '</span>';
        html += '</div>';
      }

      // ── Volatility Engine [V3] ──
      if (d.volatility && d.volatility.score > 10) {
        var vol = d.volatility;
        var volCol = vol.level === 'EXTREME' ? '#ff2244' : vol.level === 'HIGH' ? '#ff6644' : vol.level === 'ELEVATED' ? '#ffaa00' : '#668899';
        html += '<div style="padding:1px 0"><span style="color:' + volCol + ';width:65px;display:inline-block;font-weight:600">VOL</span>';
        html += '<span style="color:' + volCol + '">' + vol.level + '</span>';
        html += ' <span style="color:var(--dim)">ATR:P' + (vol.atrPct || 50) + ' SL\u00D7' + (vol.slMult || 1) + '</span>';
        if (vol.signals && vol.signals.length > 0) html += ' <span style="color:var(--dim)">' + vol.signals.slice(0, 2).join(', ') + '</span>';
        html += '</div>';
      }

      // ── Regime Transition ──
      if (d.regimeTransition && d.regimeTransition.transitioning) {
        var rt = d.regimeTransition;
        html += '<div style="padding:1px 0"><span style="color:#ffaa00;width:65px;display:inline-block;font-weight:600">⚡ SHIFT</span>';
        html += '<span style="color:#ffaa00">' + rt.from + ' → ' + rt.to + '</span>';
        html += ' <span style="color:var(--dim)">' + (rt.warning || '') + '</span></div>';
      }

      // ── Volatility Forecast ──
      if (d.volatilityForecast && d.volatilityForecast.score > 15) {
        var vf = d.volatilityForecast;
        var vfCol = vf.level === 'high' ? '#ff3355' : '#ffaa00';
        html += '<div style="padding:1px 0"><span style="color:' + vfCol + ';width:65px;display:inline-block;font-weight:600">⚡ VOL</span>';
        html += '<span style="color:' + vfCol + '">' + vf.level.toUpperCase() + ' (' + vf.score + ')</span>';
        if (vf.signals) html += ' <span style="color:var(--dim)">' + vf.signals.join(', ') + '</span>';
        if (vf.recommendation) html += ' <span style="color:#ffaa00">' + vf.recommendation + '</span>';
        html += '</div>';
      }
    }

    // ══ V3 Intelligence Summary ══
    var v3 = _bvData.v3;
    if (v3) {
      html += '<div style="border-top:1px solid rgba(120,80,220,0.2);margin-top:5px;padding-top:5px">';
      html += '<span style="color:#44aaff;font-size:9px;letter-spacing:1.5px;font-weight:600">BRAIN V3 INTELLIGENCE</span>';

      // Session
      if (v3.session && v3.session.current) {
        var sess = v3.session;
        var sessCol = sess.modifier >= 1.05 ? '#00ff88' : sess.modifier <= 0.90 ? '#ff4466' : 'rgba(255,255,255,0.45)';
        html += '<div style="padding:1px 0"><span style="color:var(--dim);width:65px;display:inline-block;font-weight:600">SESS</span>';
        html += '<span style="color:#aa88ff">' + sess.current.name + '</span>';
        html += ' <span style="color:' + sessCol + '">\u00D7' + sess.modifier + '</span>';
        if (sess.current.overlap) html += ' <span style="color:#ffaa00">OVERLAP</span>';
        html += '</div>';
      }

      // Drawdown
      if (v3.drawdown) {
        var dd = v3.drawdown;
        var ddCol = dd.tier === 'GREEN' ? '#00ff88' : dd.tier === 'CAUTION' ? '#ffaa00' : dd.tier === 'WARNING' ? '#ff8844' : dd.tier === 'DANGER' ? '#ff3355' : dd.tier === 'LOCKOUT' ? '#ff0033' : '#668899';
        html += '<div style="padding:1px 0"><span style="color:var(--dim);width:65px;display:inline-block;font-weight:600">DD</span>';
        html += '<span style="color:' + ddCol + '">' + dd.tier + '</span>';
        html += ' <span style="color:var(--dim)">-' + dd.drawdownPct + '% max:-' + dd.maxDrawdown + '%</span>';
        if (dd.sizeScale < 100) html += ' <span style="color:#ffaa00">size:' + dd.sizeScale + '%</span>';
        if (dd.consecutiveLosses >= 2) html += ' <span style="color:#ff4466">streak:-' + dd.consecutiveLosses + '</span>';
        html += '</div>';
      }

      // Sizing/Edge
      if (v3.sizing && v3.sizing.sufficient) {
        var sz = v3.sizing;
        var szCol = sz.winRate >= 55 ? '#00ff88' : sz.winRate < 45 ? '#ff4466' : '#ffaa00';
        html += '<div style="padding:1px 0"><span style="color:var(--dim);width:65px;display:inline-block;font-weight:600">EDGE</span>';
        html += '<span style="color:' + szCol + '">WR:' + sz.winRate + '%</span>';
        html += ' <span style="color:var(--dim)">Kelly:' + sz.quarterKelly + '% W:$' + sz.avgWin + ' L:$' + sz.avgLoss + ' n=' + sz.sampleSize + '</span>';
        html += '</div>';
      }

      // Correlation
      if (v3.correlation && v3.correlation.warning) {
        html += '<div style="padding:1px 0"><span style="color:#ff4466;width:65px;display:inline-block;font-weight:600">\u26A0 CORR</span>';
        html += '<span style="color:#ff8844">' + v3.correlation.warning + '</span></div>';
      }

      // Scaling
      if (v3.scaling && Object.keys(v3.scaling).length > 0) {
        html += '<div style="padding:1px 0"><span style="color:var(--dim);width:65px;display:inline-block;font-weight:600">SCALE</span>';
        for (var sk in v3.scaling) {
          var si = v3.scaling[sk];
          html += '<span style="color:#aa88ff">' + sk.replace('USDT', '') + ':L' + si.scaleCount + '/' + si.maxScales + '</span> ';
        }
        html += '</div>';
      }

      html += '</div>';
    }

    body.innerHTML = html;
  }

  function _bvPoll() {
    fetch('/api/brain/vision', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && data.symbols) {
          _bvData = data;
          _bvRender();
        }
      })
      .catch(function () { /* silent */ });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var wrap = document.getElementById('brainVisionWrap');
    if (!wrap) return;
    // Poll every 30s, first poll after 3s
    setTimeout(_bvPoll, 3000);
    _bvTimer = setInterval(_bvPoll, 30000);
  });
})();

// ══════════════════════════════════════════════════════════════════
// BRAIN DASHBOARD (Reflection Engine) — Polls /api/brain/dashboard every 30s
// ══════════════════════════════════════════════════════════════════
(function () {
  var _bdData = null;
  var _bdTimer = null;

  function _bdRender() {
    var body = document.getElementById('brainDashBody');
    var scoreEl = document.getElementById('brainDashScore');
    if (!body || !_bdData) return;

    var html = '';

    // ── A) Live Thinking ──
    var thoughts = _bdData.thoughts || [];
    if (thoughts.length > 0) {
      html += '<div style="color:#3ab4dc;margin-bottom:3px;font-size:11px;letter-spacing:1px;font-weight:600">LIVE THINKING</div>';
      var recent = thoughts.slice(-8);
      for (var i = recent.length - 1; i >= 0; i--) {
        var t = recent[i];
        var sev = t.severity || 'info';
        var col = sev === 'critical' ? '#ff3355' : sev === 'warning' ? '#ffaa00' : '#668899';
        var icon = sev === 'critical' ? '\u25CF' : sev === 'warning' ? '\u25B2' : '\u25CB';
        var ago = Math.round((Date.now() - t.ts) / 60000);
        html += '<div style="color:' + col + ';padding:1px 0;border-bottom:1px solid rgba(50,70,90,0.2)">' +
          icon + ' <span style="color:#557788">' + ago + 'm</span> ' + _esc(t.text) + '</div>';
      }
    } else {
      html += '<div style="color:#334455;font-style:italic">Waiting for trades to reflect on...</div>';
    }

    // ── B) Self-Score ──
    var ss = _bdData.selfScore;
    if (ss) {
      html += '<div style="color:#3ab4dc;margin:6px 0 3px;font-size:11px;letter-spacing:1px;font-weight:600">SELF-SCORE</div>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:2px">';
      html += _bdCard('Accuracy', ss.accuracyToday != null ? ss.accuracyToday + '%' : '—', ss.accuracyToday >= 60 ? '#22cc66' : ss.accuracyToday != null ? '#ff6644' : '#445566');
      html += _bdCard('Streak', ss.streak + 'W', ss.streak >= 3 ? '#22cc66' : '#778899');
      html += _bdCard('Best', ss.bestStreak + 'W', '#aa88ff');
      html += _bdCard('Decisions', ss.decisionsToday || 0, '#778899');
      html += _bdCard('Avoided', ss.avoidedLosses || 0, '#22cc66');
      html += _bdCard('Regret', ss.regretTrades || 0, ss.regretTrades > 3 ? '#ff6644' : '#778899');
      html += '</div>';
      if (scoreEl) scoreEl.textContent = ss.accuracyToday != null ? 'Accuracy: ' + ss.accuracyToday + '%' : '';
    }

    // ── C) Learned Rules ──
    var rules = _bdData.learnedRules || [];
    if (rules.length > 0) {
      html += '<div style="color:#3ab4dc;margin:6px 0 3px;font-size:11px;letter-spacing:1px;font-weight:600">LEARNED RULES (' + rules.length + ')</div>';
      for (var r = 0; r < Math.min(rules.length, 8); r++) {
        var rule = rules[r];
        html += '<div style="color:#aabbcc;padding:1px 0">' +
          '<span style="color:#ffaa00">#' + rule.id + '</span> ' + _esc(rule.rule) +
          (rule.blockEntry ? ' <span style="color:#ff3355">[BLOCK]</span>' : '') +
          ' <span style="color:#556677">hits:' + (rule.hitCount || 0) + '</span></div>';
      }
    }

    // ── D) DSL Recommendations ──
    var dsl = _bdData.dslRecommendations || [];
    if (dsl.length > 0) {
      html += '<div style="color:#3ab4dc;margin:6px 0 3px;font-size:11px;letter-spacing:1px;font-weight:600">DSL RECOMMENDATIONS</div>';
      for (var d = 0; d < dsl.length; d++) {
        var rec = dsl[d];
        html += '<div style="color:#ffbb44;padding:1px 0">' +
          '<span style="color:#778899">' + (rec.regime || '') + '</span> ' +
          rec.param + ': <span style="color:#ff6644">' + rec.current + '</span> → ' +
          '<span style="color:#22cc66">' + rec.recommended + '</span>' +
          ' <span style="color:#556677">' + _esc(rec.reason || '') + '</span></div>';
      }
    }

    // ── E) Calibration ──
    var cal = _bdData.calibration || {};
    var calKeys = Object.keys(cal);
    if (calKeys.length > 0) {
      html += '<div style="color:#3ab4dc;margin:6px 0 3px;font-size:11px;letter-spacing:1px;font-weight:600">CONFIDENCE CALIBRATION</div>';
      html += '<div style="display:flex;gap:4px;flex-wrap:wrap">';
      for (var c = 0; c < calKeys.length; c++) {
        var k = calKeys[c];
        var cv = cal[k];
        var gapCol = cv.gap > 5 ? '#22cc66' : cv.gap < -10 ? '#ff3355' : '#778899';
        html += '<div style="background:rgba(30,40,60,0.5);padding:2px 4px;border-radius:2px">' +
          '<span style="color:#556677">' + k + '</span> ' +
          '<span style="color:' + gapCol + '">' + (cv.gap > 0 ? '+' : '') + cv.gap + '%</span>' +
          ' <span style="color:#445566">(' + cv.samples + ')</span></div>';
      }
      html += '</div>';
    }

    // ── F) Anti-Patterns ──
    var ap = _bdData.antiPatterns || [];
    if (ap.length > 0) {
      html += '<div style="color:#3ab4dc;margin:6px 0 3px;font-size:11px;letter-spacing:1px;font-weight:600">ANTI-PATTERNS (' + ap.length + ')</div>';
      for (var a = 0; a < Math.min(ap.length, 6); a++) {
        var pat = ap[a];
        html += '<div style="color:#ff8866;padding:1px 0">' +
          _esc(pat.pattern) + ' <span style="color:#556677">×' + pat.occurrences + '</span>' +
          ' <span style="color:#ff3355">' + Math.round((pat.lossRate || 0) * 100) + '% loss</span></div>';
      }
    }

    // ── G) Session Reviews ──
    var reviews = _bdData.sessionReviews || [];
    if (reviews.length > 0) {
      var rev = reviews[reviews.length - 1];
      html += '<div style="color:#3ab4dc;margin:6px 0 3px;font-size:11px;letter-spacing:1px;font-weight:600">SESSION REVIEW</div>';
      var wrCol = rev.winRate >= 60 ? '#22cc66' : rev.winRate < 40 ? '#ff3355' : '#ffaa00';
      html += '<div style="color:#aabbcc">' + rev.trades + ' trades | ' +
        '<span style="color:#22cc66">' + rev.wins + 'W</span> / <span style="color:#ff3355">' + rev.losses + 'L</span> | ' +
        'WR: <span style="color:' + wrCol + '">' + rev.winRate + '%</span> | ' +
        'PnL: <span style="color:' + (rev.totalPnl >= 0 ? '#22cc66' : '#ff3355') + '">$' + (rev.totalPnl || 0).toFixed(2) + '</span></div>';
      if (rev.conclusions && rev.conclusions.length > 0) {
        for (var ci = 0; ci < rev.conclusions.length; ci++) {
          html += '<div style="color:#8899aa;padding:1px 0">\u25B8 ' + _esc(rev.conclusions[ci]) + '</div>';
        }
      }
    }

    body.innerHTML = html;
  }

  function _bdCard(label, value, color) {
    return '<div style="background:rgba(20,30,50,0.5);padding:2px 4px;border-radius:2px;text-align:center">' +
      '<div style="color:#445566;font-size:10px">' + label + '</div>' +
      '<div style="color:' + (color || '#aabbcc') + ';font-size:13px;font-weight:bold">' + value + '</div></div>';
  }

  function _esc(s) { return (s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function _bdPoll() {
    fetch('/api/brain/dashboard', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data) {
          _bdData = data;
          _bdRender();
        }
      })
      .catch(function () { /* silent */ });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var wrap = document.getElementById('brainDashWrap');
    if (!wrap) return;
    setTimeout(_bdPoll, 5000);
    _bdTimer = setInterval(_bdPoll, 30000);
  });
})();
