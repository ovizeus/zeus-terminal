// Zeus v122 — data/orderflow.js
// Orderflow Modules P1-P15 + Patch Layer v122.3
'use strict';

/* ============================================================
   ARES ML UI (READ-ONLY) — SAFE VERSION
   Citește FUSION_CACHE (scris de runAutoTradeCheck la fiecare tick).
   Fallback: computeFusionDecision() DOAR dacă FUSION_CACHE nu există.
   Nu scrie în engine/trade/sizing/DSL. Nu dublează intervale.
   ============================================================ */
(function () {
  try {
    if (window.__ARES_ML_UI_V1__) return;
    window.__ARES_ML_UI_V1__ = 1;

    // CSS once
    if (!document.getElementById('ares-ml-ui-css-v1')) {
      const st = document.createElement('style');
      st.id = 'ares-ml-ui-css-v1';
      st.textContent = `
        #ares-ml-span{
          font-size:11px; font-family:monospace; letter-spacing:1px;
          margin-left:6px; padding:1px 6px; border-radius:999px;
          border:1px solid rgba(0,229,255,0.35);
          color:#00E5FF; background:rgba(0,229,255,0.08);
          box-shadow:0 0 10px rgba(0,229,255,0.12);
          user-select:none; white-space:nowrap;
        }
        #ares-ml-span[data-hot="1"]{
          border-color:rgba(255,176,0,0.55);
          color:#FFB000; background:rgba(255,176,0,0.10);
          box-shadow:0 0 12px rgba(255,176,0,0.18);
        }
        #ares-ml-span[data-cold="1"]{
          border-color:rgba(193,18,31,0.45);
          color:#C1121F; background:rgba(193,18,31,0.10);
          box-shadow:0 0 12px rgba(193,18,31,0.16);
        }
        #ares-ml-dot{
          position:absolute; top:6px; right:8px;
          width:8px; height:8px; border-radius:50%;
          pointer-events:none;
          background:rgba(75,93,115,0.85);
          box-shadow:0 0 calc(10px + (var(--mlGlow,0)*18px)) rgba(0,229,255,0.35);
          opacity:calc(0.55 + (var(--mlGlow,0)*0.40));
          animation:aresMlPulse 1.8s ease-in-out infinite;
        }
        @keyframes aresMlPulse{
          0%{transform:scale(0.85);opacity:0.55;}
          50%{transform:scale(1.15);opacity:1;}
          100%{transform:scale(0.85);opacity:0.55;}
        }
      `;
      document.head.appendChild(st);
    }

    function ensureBadge() {
      const confEl = document.getElementById('ares-strip-conf');
      if (!confEl) return null;
      let badge = document.getElementById('ares-ml-span');
      if (!badge) {
        badge = document.createElement('span');
        badge.id = 'ares-ml-span';
        badge.textContent = 'ML: IDLE';
        badge.setAttribute('data-hot', '0');
        badge.setAttribute('data-cold', '0');
        const imm = document.getElementById('ares-imm-span');
        if (imm && imm.parentNode) imm.parentNode.insertBefore(badge, imm.nextSibling);
        else if (confEl.parentNode) confEl.parentNode.appendChild(badge);
      }
      return badge;
    }

    function ensureDot() {
      const bv = document.getElementById('brainViz') || document.getElementById('ares-brainViz');
      if (!bv) return null;
      if (window.getComputedStyle(bv).position === 'static') bv.style.position = 'relative';
      let dot = document.getElementById('ares-ml-dot');
      if (!dot) {
        dot = document.createElement('div');
        dot.id = 'ares-ml-dot';
        bv.appendChild(dot);
      }
      return dot;
    }

    // Citește FUSION_CACHE (preferat) — scris de runAutoTradeCheck la fiecare tick AT.
    // Fallback pe computeFusionDecision() DOAR dacă cache-ul nu există încă.
    function computeMLSnapshot() {
      const snap = { mode: 'IDLE', dir: 'NEUTRAL', conf: 0, score: 0 };
      try {
        // Prioritate 1: FUSION_CACHE (arhitectura corectă — zero calcul nou)
        const c = window.FUSION_CACHE;
        if (c && typeof c === 'object' && Date.now() - (c.ts || 0) < 90000) {
          snap.mode = 'FUSION';
          snap.conf = Number.isFinite(+c.confidence) ? +c.confidence : 0;
          snap.score = Number.isFinite(+c.score) ? +c.score : 0;
          const d = String(c.dir || '').toLowerCase();
          snap.dir = d.includes('long') ? 'LONG' : d.includes('short') ? 'SHORT' : 'NEUTRAL';
          return snap;
        }
        // Fallback: computeFusionDecision() dacă FUSION_CACHE nu e încă populat
        if (typeof window.computeFusionDecision === 'function') {
          const r = window.computeFusionDecision();
          if (r) {
            snap.mode = 'FUSION';
            snap.conf = Number.isFinite(+r.confidence) ? +r.confidence : 0;
            snap.score = Number.isFinite(+r.score) ? +r.score : 0;
            const d = String(r.dir || r.decision || '').toLowerCase();
            snap.dir = d.includes('long') ? 'LONG' : d.includes('short') ? 'SHORT' : 'NEUTRAL';
          }
        }
      } catch (_) { }
      return snap;
    }

    function render() {
      const badge = ensureBadge();
      const dot = ensureDot();
      if (!badge && !dot) return;

      const s = computeMLSnapshot();
      const pct = Math.max(0, Math.min(100, Math.round(s.conf || 0)));

      if (badge) {
        badge.textContent = `ML:${s.mode} ${s.dir} ${pct}%`;
        badge.setAttribute('data-hot', pct >= 70 ? '1' : '0');
        badge.setAttribute('data-cold', pct <= 25 ? '1' : '0');
      }
      if (dot) {
        dot.style.setProperty('--mlGlow', String(Math.max(0, Math.min(1, pct / 100))));
        if (s.dir === 'LONG') dot.style.background = 'rgba(0,229,255,0.90)';
        else if (s.dir === 'SHORT') dot.style.background = 'rgba(193,18,31,0.88)';
        else dot.style.background = 'rgba(75,93,115,0.85)';
      }
    }

    // Schedule: fără duplicate, ZT_safeInterval dacă există
    const tick = function () { try { render(); } catch (_) { } };
    setTimeout(tick, 600);

    if (typeof window.ZT_safeInterval === 'function') {
      var _wrappedTick = window.ZT_safeInterval('aresMLUI', tick, 2000);
      if (!window.__ARES_ML_UI_TMR__) {
        window.__ARES_ML_UI_TMR__ = Intervals.set('ares_ml_ui', _wrappedTick, 2000);
      }
    } else {
      if (!window.__ARES_ML_UI_TMR__) {
        window.__ARES_ML_UI_TMR__ = Intervals.set('ares_ml_ui', tick, 2000);
      }
    }

  } catch (e) {
    console.warn('[ARES ML UI] failed:', e && e.message);
  }
})();

(function () {
  if (window.__ZT_ERR_TEL__) return;
  window.__ZT_ERR_TEL__ = true;

  // ── B2: global dedup cache ────────────────────────────────────
  window.__ZT_ERR_DEDUP__ = window.__ZT_ERR_DEDUP__ || new Map();
  const _DEDUP_TTL = 10000;
  const _ROLLUP_TTL = 30000;

  // ── B3: severity classifier ───────────────────────────────────
  function _classifySeverity(msg, stack) {
    const s = String(msg || '') + '|' + String(stack || '');
    if (/placeAutoTrade|exec[^u]|sizing|DSL/i.test(s)) return 'FATAL';
    if (/WebSocket|\bws\b|reconnect|fetch/i.test(s)) return 'ERROR';
    return 'WARN';
  }

  // ── Module hint ───────────────────────────────────────────────
  function _moduleHint(msg, stack) {
    const s = String(msg || '') + '|' + String(stack || '');
    if (/\bares\b/i.test(s)) return 'ARES';
    if (/WebSocket|\bws\b/i.test(s)) return 'WS';
    if (/autoTrade|\bAT\b/i.test(s)) return 'AT';
    if (/\bui\b|DOM|element|render/i.test(s)) return 'UI';
    return 'UNKNOWN';
  }

  // ── B4: Diagnostic snapshot (black-box, small) ────────────────
  window.buildDiagSnapshot = function () {
    try {
      const S0 = window.S || {};
      const AT0 = window.AT || {};
      const wve = window.WVE_STATE || {};
      const fc = window.FUSION_CACHE || {};

      // [v122 DIAG] Fallback helpers — read real fields, never crash
      function _diagGetSymbol() {
        try {
          if (S0.symbol) return S0.symbol;
          if (window.currentSymbol) return window.currentSymbol;
          if (window.symbol) return window.symbol;
        } catch (e) { }
        return null;
      }
      function _diagGetTF() {
        try {
          // S schema uses chartTf, not tf
          if (S0.chartTf) return S0.chartTf;
          if (S0.tf) return S0.tf;
          if (window.currentTF) return window.currentTF;
        } catch (e) { }
        return null;
      }
      function _diagGetPrice() {
        try {
          if (typeof S0.price === 'number' && S0.price > 0) return S0.price;
          const sym = S0.symbol ? S0.symbol.toUpperCase() : null;
          const ap = window.allPrices || window.allP || window.PRICES;
          if (ap && sym && typeof ap[sym] === 'number' && ap[sym] > 0) return ap[sym];
          if (typeof S0.prevPrice === 'number' && S0.prevPrice > 0) return S0.prevPrice;
          if (Array.isArray(S0.klines) && S0.klines.length) {
            const k = S0.klines[S0.klines.length - 1];
            if (k && typeof k.close === 'number' && k.close > 0) return k.close;
          }
        } catch (e) { }
        return null;
      }
      function _diagWsStatus() {
        try {
          // WS is a manager object, not a raw WebSocket — check S feed flags
          if (S0.bnbOk || S0.bybOk) return 'connected';
          if (window.__wsGen !== undefined && window.__wsGen > 0) return 'active';
          if (window.WS && WS.status) return WS.status;
          if (window.wsStatus) return window.wsStatus;
        } catch (e) { }
        return 'unknown';
      }

      let wsStatus = _diagWsStatus();
      let lastDecision = null;
      try {
        if (fc && fc.ts && (Date.now() - fc.ts) < 90000)
          lastDecision = { source: 'FUSION', dir: fc.dir || null, conf: fc.confidence || null, score: fc.score || null };
        else if (wve.lastDecision)
          lastDecision = { source: 'WVE', decision: wve.lastDecision, conf: wve.lastConf, valid: wve.lastValid };
      } catch (_) { }

      const snap = {
        ts: Date.now(),
        symbol: _diagGetSymbol(),
        tf: _diagGetTF(),
        mode: S0.mode || 'manual',
        AT_on: !!(AT0.enabled),
        price: _diagGetPrice(),
        wsStatus,
        lastDecision,
      };
      // [v122 DIAG] one-line debug — remove after confirming snapshot reads correct state
      try { console.log('[DIAG SNAPSHOT]', { symbol: snap.symbol, tf: snap.tf, price: snap.price, ws: snap.wsStatus }); } catch (_) { }
      return snap;
    } catch (e) { return { ts: Date.now(), snapError: String(e && e.message || e) }; }
  };

  // ── Core telemetry push with dedup + rate-limit ───────────────
  function _ztLogError(msg, stack, moduleHint, severity, extraMeta) {
    try {
      const stackTop = stack ? String(stack).split('\n').slice(0, 3).join(' | ').substring(0, 300) : '';
      const dedupKey = String(msg || '').substring(0, 120) + '|' + stackTop.substring(0, 80) + '|' + (moduleHint || '');
      const now = Date.now();
      const cached = window.__ZT_ERR_DEDUP__.get(dedupKey);

      if (cached) {
        cached.count++;
        cached.lastTs = now;
        if ((now - cached.firstTs) < _ROLLUP_TTL) return; // suppress within 30s
        // Write rolled-up entry every 30s
        cached.firstTs = now;
        try {
          if (typeof ZLOG !== 'undefined') ZLOG.push(severity || 'WARN',
            '[ROLLUP\xd7' + cached.count + '] ' + String(msg || '').substring(0, 180),
            {
              moduleHint, stackTop: stackTop.substring(0, 180), count: cached.count,
              snap: window.buildDiagSnapshot()
            });
        } catch (_) { }
        return;
      }

      // First occurrence — register
      window.__ZT_ERR_DEDUP__.set(dedupKey, { firstTs: now, lastTs: now, count: 1 });
      // Prune old entries
      if (window.__ZT_ERR_DEDUP__.size > 120) {
        for (const [k, v] of window.__ZT_ERR_DEDUP__) {
          if (now - v.lastTs > _DEDUP_TTL * 4) window.__ZT_ERR_DEDUP__.delete(k);
          if (window.__ZT_ERR_DEDUP__.size <= 70) break;
        }
      }

      const snap = window.buildDiagSnapshot();
      try {
        if (typeof ZLOG !== 'undefined') ZLOG.push(severity || 'WARN',
          String(msg || '').substring(0, 240),
          { type: severity, moduleHint, stackTop: stackTop.substring(0, 200), snap, ...(extraMeta || {}) });
      } catch (_) { }

      // B6: minimal console — only ERROR/FATAL, 1 short line
      if (severity === 'ERROR' || severity === 'FATAL')
        console.warn('[ZT:' + severity + '][' + moduleHint + ']', String(msg || '').substring(0, 90));

      // B3: automatic reactions (null-safe)
      if (severity === 'ERROR') {
        try {
          if (typeof window._reconnectWS === 'function') window._reconnectWS();
          else if (typeof window.reconnectWS === 'function') window.reconnectWS();
        } catch (_) { }
      }
      if (severity === 'FATAL') {
        try {
          const AT0 = window.AT || {};
          if (AT0.enabled) {
            if (typeof AT0.disable === 'function') AT0.disable('ZT_TEL_FATAL');
            else AT0.enabled = false;
            try { if (typeof ZLOG !== 'undefined') ZLOG.push('FATAL', 'AT_SUSPENDED_DUE_TO_FATAL — ' + String(msg || '').substring(0, 100), { moduleHint, snap }); } catch (_) { }
            try { if (typeof atLog === 'function') atLog('warn', '[FATAL] AT SUSPENDED — FATAL error in ' + moduleHint); } catch (_) { }
          }
        } catch (_) { }
      }
    } catch (_) { /* telemetry must never throw */ }
  }

  // ── B1: additive error listeners (run alongside existing handlers) ──
  window.addEventListener('error', function (e) {
    try {
      const msg = (e && e.error && e.error.message) || (e && e.message) || 'UnknownError';
      const stack = (e && e.error && e.error.stack) || '';
      _ztLogError(msg, stack, _moduleHint(msg, stack), _classifySeverity(msg, stack),
        { src: e.filename || null, line: e.lineno || null });
    } catch (_) { }
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    try {
      const reason = e && e.reason;
      const msg = (reason instanceof Error) ? reason.message : String(reason || 'UnhandledRejection');
      const stack = (reason instanceof Error) ? (reason.stack || '') : '';
      _ztLogError('[PROMISE] ' + msg, stack, _moduleHint(msg, stack), _classifySeverity(msg, stack), {});
    } catch (_) { }
  });

  // [v119-p14] Clipboard fallback local (independent de ZLOG — poate fi absent)
  function _ztClipboardFallback(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) { if (typeof toast === 'function') toast('\uD83E\uDE7A Diag Pack copied (fallback)'); return; }
    } catch (_) { }
    try {
      window.prompt('Copy Diag Pack (Ctrl+C / Cmd+C):', text.substring(0, 2000));
    } catch (_) {
      console.dir({ diagPack: text.substring(0, 5000) });
      if (typeof toast === 'function') toast('Diag Pack: vezi Console (F12)');
    }
  }

  // ── B5: inject "Copy Diagnostic Pack" button into existing ZLOG section ──
  function _injectDiagButton() {
    try {
      if (window.__ZT_DIAG_BTN__) return;
      // Find the flex row that contains ZLOG copy buttons (inside #set-dev)
      const anchor = document.querySelector('#set-dev button[onclick*="ZLOG.copyJSON"]');
      const row = anchor && anchor.closest('div');
      if (!row || row.querySelector('[data-zt-diag]')) return;
      const btn = document.createElement('button');
      btn.className = 'hub-sbtn';
      btn.setAttribute('data-zt-diag', '1');
      btn.style.cssText = 'border-color:rgba(0,229,255,0.35);color:var(--cyan)';
      btn.textContent = '\uD83E\uDE7A Copy Diag Pack';
      btn.onclick = function () {
        try {
          const pack = {
            ts: new Date().toISOString(),
            snap: window.buildDiagSnapshot ? window.buildDiagSnapshot() : null,
            wveState: window.WVE_STATE || null,
            recentErrors: Array.from((window.__ZT_ERR_DEDUP__ || new Map()).entries())
              .slice(-20).map(function (kv) { return { key: kv[0].substring(0, 100), count: kv[1].count, lastTs: kv[1].lastTs }; }),
            note: 'Use ZLOG Copy JSON button for full log buffer',
          };
          const text = JSON.stringify(pack, null, 2);
          // [v119-p14] același fallback chain ca ZLOG: writeText → execCommand → prompt
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
              .then(function () { if (typeof toast === 'function') toast('\uD83E\uDE7A Diag Pack copied'); })
              .catch(function () { _ztClipboardFallback(text); });
          } else { _ztClipboardFallback(text); }
        } catch (ex) { console.warn('[ZT_DIAG]', ex && ex.message); }
      };
      row.appendChild(btn);
      window.__ZT_DIAG_BTN__ = true;
    } catch (_) { }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _injectDiagButton);
  else setTimeout(_injectDiagButton, 900);

})();

// ===== MODULE: ORDERFLOW (P1–P14) =====
// ╔══════════════════════════════════════════════════════════════════╗
// ║  ZEUS ORDERFLOW MODULE v121 — RAW_FLOW + aggTrade WS            ║
// ║  Watch-only. Nu modifica trading engine.                         ║
// ╚══════════════════════════════════════════════════════════════════╝
(function () {
  if (window.__ZEUS_OF_V121__) return;
  window.__ZEUS_OF_V121__ = true;

  // ── State ─────────────────────────────────────────────────────────
  window.RAW_FLOW = {
    sym: null,
    buf: [],
    windowMs: 10000,   // 10s rolling window
    maxTrades: 2500,
    dropped: 0
  };

  let _ofWS = null;

  // ── Prune: > windowMs old OR > maxTrades ─────────────────────────
  function _prune() {
    const RF = window.RAW_FLOW;
    const cut = Date.now() - RF.windowMs;
    // Drop stale from front (buf is chronological — oldest at [0])
    let i = 0;
    while (i < RF.buf.length && RF.buf[i].ts < cut) i++;
    if (i > 0) RF.buf.splice(0, i);
    // Hard cap
    while (RF.buf.length > RF.maxTrades) {
      RF.buf.shift();
      RF.dropped++;
    }
  }

  // ── WS message handler ───────────────────────────────────────────
  function _onMsg(e) {
    try {
      const d = JSON.parse(e.data);
      // Binance aggTrade fields: T=tradeTime, p=price, q=qty, m=isBuyerMaker
      window.RAW_FLOW.buf.push({
        ts: d.T,
        p: +d.p,
        q: +d.q,
        isBuyerMaker: !!d.m
      });
      _prune();
    } catch (_) { /* never throw in WS handler */ }
  }

  // ── Disconnect existing OF stream ────────────────────────────────
  function _disconnect() {
    try {
      if (window.WS) {
        window.WS.close('of_agg');
      } else if (_ofWS) {
        _ofWS.onmessage = null;
        _ofWS.close();
      }
    } catch (_) { }
    _ofWS = null;
  }

  // ── Connect aggTrade WS for symbol ───────────────────────────────
  function _connect(sym) {
    const RF = window.RAW_FLOW;
    _disconnect();
    RF.sym = sym;
    RF.buf = [];
    RF.dropped = 0;

    const url = 'wss://fstream.binance.com/ws/' + sym.toLowerCase() + '@aggTrade';

    if (window.WS) {
      // Use Zeus WS manager — gets __wsGen guard automatically
      _ofWS = window.WS.open('of_agg', url, {
        onopen: function () {
          try { if (typeof ZLOG !== 'undefined') ZLOG.push('INFO', '[OF v121] aggTrade connected: ' + sym); } catch (_) { }
        },
        onmessage: _onMsg,
        onclose: function () {
          try { if (typeof ZLOG !== 'undefined') ZLOG.push('INFO', '[OF v121] aggTrade closed: ' + sym); } catch (_) { }
        },
        onerror: function () {
          try { if (typeof ZLOG !== 'undefined') ZLOG.push('WARN', '[OF v121] aggTrade error: ' + sym); } catch (_) { }
        }
      });
    } else {
      // Fallback: raw WebSocket if WS manager not ready
      const _ofGen = window.__wsGen; // [FIX H7] capture generation for stale guard
      const ws = new WebSocket(url);
      ws.onmessage = function (e) {
        if (window.__wsGen !== _ofGen) { try { ws.close(); } catch (_) { } return; } // [FIX H7] stale gen guard
        _onMsg(e);
      };
      ws.onopen = function () {
        try { if (typeof ZLOG !== 'undefined') ZLOG.push('INFO', '[OF v121] aggTrade connected (raw): ' + sym); } catch (_) { }
      };
      ws.onclose = function () {  // FIX4: handler lipsa
        try { if (typeof ZLOG !== 'undefined') ZLOG.push('INFO', '[OF v121] aggTrade closed (raw): ' + sym); } catch (_) { }
      };
      ws.onerror = function () {  // FIX4: handler lipsa
        try { if (typeof ZLOG !== 'undefined') ZLOG.push('WARN', '[OF v121] aggTrade error (raw): ' + sym); } catch (_) { }
      };
      _ofWS = ws;
    }
  }

  // ── Hook setSymbol — close + restart on symbol change ───────────
  // Wraps whatever version exists at module-load time (including AUB wrap)
  const _prevSetSymbol = window.setSymbol;
  window.setSymbol = function (sym) {
    if (typeof _prevSetSymbol === 'function') _prevSetSymbol(sym);
    try { _connect(sym); } catch (_) { }
  };

  // ── Initial connect ───────────────────────────────────────────────
  // Delay 1200ms so startApp() completes and S.symbol is populated
  function _init() {
    try {
      const sym = (window.S && window.S.symbol) ? window.S.symbol : 'BTCUSDT';
      _connect(sym);
    } catch (e) {
      try { if (typeof ZLOG !== 'undefined') ZLOG.push('WARN', '[OF v121] init error: ' + (e && e.message)); } catch (_) { }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(_init, 1200); });
  } else {
    setTimeout(_init, 1200);
  }

})();

// ╔══════════════════════════════════════════════════════════════════╗
// ║  ZEUS ORDERFLOW MODULE v121 — PAS 2: Delta + Z-score            ║
// ║  Runs every 1s. Watch-only. No UI, no engine modification.       ║
// ╚══════════════════════════════════════════════════════════════════╝
(function () {
  if (window.__ZEUS_OF_P2__) return;
  window.__ZEUS_OF_P2__ = true;

  // ── Delta Series: max 300 points ──────────────────────────────────
  const OF_SERIES = {
    delta: [],        // raw delta values for z-score computation
    MAX: 300
  };

  let _prevDelta = 0;   // for velocity (delta change per second)
  let _lastTs = 0;

  // ── Math helpers ──────────────────────────────────────────────────
  function _mean(arr) {
    if (!arr.length) return 0;
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  }

  function _std(arr, mean) {
    if (arr.length < 2) return 0;
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += (arr[i] - mean) * (arr[i] - mean);
    return Math.sqrt(s / arr.length);
  }

  // ── Core tick ─────────────────────────────────────────────────────
  function _tick() {
    try {
      const RF = window.RAW_FLOW;
      if (!RF || !RF.buf) return;

      const now = Date.now();
      const cutoff = now - RF.windowMs;  // last 10s window

      // Aggregate buy/sell volume from rolling window
      let buyVol = 0;
      let sellVol = 0;
      const buf = RF.buf;

      for (let i = 0; i < buf.length; i++) {
        const t = buf[i];
        if (t.ts < cutoff) continue;           // skip stale (shouldn't exist after prune)
        if (t.isBuyerMaker) {
          sellVol += t.q;                       // buyer is maker → aggressive sell
        } else {
          buyVol += t.q;                       // seller is maker → aggressive buy
        }
      }

      const totalVol = buyVol + sellVol;
      const delta = buyVol - sellVol;       // positive = buy pressure
      const deltaAbs = Math.abs(delta);
      const deltaPct = totalVol > 0 ? (delta / totalVol) * 100 : 0;

      // Velocity: delta change since last tick (per second, already 1s interval)
      const dtSec = _lastTs > 0 ? Math.max(0.001, (now - _lastTs) / 1000) : 1;
      const deltaVel = (delta - _prevDelta) / dtSec;
      _prevDelta = delta;
      _lastTs = now;

      // Push to delta series
      OF_SERIES.delta.push(delta);
      if (OF_SERIES.delta.length > OF_SERIES.MAX) OF_SERIES.delta.shift();

      const samples = OF_SERIES.delta.length;

      // [P2.1] Burn-in: no z-score until >= 20 samples
      let mean = 0, std = 1e-9, z = 0, instAct = false;
      if (samples >= 20) {
        mean = _mean(OF_SERIES.delta);
        std = Math.max(_std(OF_SERIES.delta, mean), 1e-9); // [P2.1] epsilon guard — no Infinity on flat series
        z = (delta - mean) / std;
        instAct = Math.abs(z) >= 2.5;
      }

      // ── Publish to window.OF (price fields injected below by PAS 3) ──
      // [P0-B3] Merge into existing OF object instead of replacing, to preserve
      // .abs, .exhaust, .trap, .sweep, .cascade set by PAS 4/5
      const _prevInstAct = window.OF && window.OF.flags && window.OF.flags.instAct;
      if (!window.OF) window.OF = {};
      Object.assign(window.OF, {
        sym: RF.sym || (window.S && window.S.symbol) || null,
        ts: now,
        buyVol,
        sellVol,
        delta,
        deltaAbs,
        deltaPct,
        deltaVel,
        z,
        mean,
        std,
        quality: { samples, burned: samples >= 20 },
        flags: { instAct }
      });

      // [P2.1] Edge-trigger: log only on false→true transition
      if (instAct && !_prevInstAct && typeof ZLOG !== 'undefined') {
        ZLOG.push(
          'AT',
          '[OF v121] instAct z=' + z.toFixed(2) +
          ' delta=' + delta.toFixed(4) +
          ' deltaPct=' + deltaPct.toFixed(1) + '%' +
          ' sym=' + (window.OF.sym || '?'),
          { z, delta, deltaAbs, deltaPct, deltaVel, mean, std, samples }
        );
      }

    } catch (e) {
      try {
        if (typeof ZLOG !== 'undefined')
          ZLOG.push('WARN', '[OF v121 P2] tick error: ' + (e && e.message));
      } catch (_) { }
    }
  }

  // ── Start 1s interval ─────────────────────────────────────────────
  let _intervalId = null;

  function _start() {
    if (_intervalId) return;
    _intervalId = Intervals.set('of_p2_delta', _tick, 1000);
    try {
      if (typeof ZLOG !== 'undefined')
        ZLOG.push('INFO', '[OF v121 P2] delta engine started (1s interval, z-window=' + OF_SERIES.MAX + 'pts)');
    } catch (_) { }
  }

  // ── Reset on symbol change — hook into window.setSymbol ──────────
  // PAS 1 already wrapped setSymbol; we chain on top of that
  const _prevSetSymbol2 = window.setSymbol;
  window.setSymbol = function (sym) {
    if (typeof _prevSetSymbol2 === 'function') _prevSetSymbol2(sym);
    try {
      // Clear delta series and velocity state on symbol change
      OF_SERIES.delta.length = 0;
      _prevDelta = 0;
      _lastTs = 0;
      // Safe reset: empty skeleton instead of null to avoid null-reference window
      window.OF = { sym: sym, ts: 0, buyVol: 0, sellVol: 0, delta: 0, deltaAbs: 0, deltaPct: 0, deltaVel: 0, z: 0, mean: 0, std: 0, quality: { samples: 0, burned: false }, flags: { instAct: false } };
    } catch (_) { }
  };

  // ── Init: wait for RAW_FLOW to be live (give PAS 1 a head start) ─
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(_start, 1500); });
  } else {
    setTimeout(_start, 1500);
  }

})();


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ZEUS ORDERFLOW MODULE v121 — PAS 3: Price Buffer               ║
// ║  10s rolling price window + priceChangePct_5s() helper.         ║
// ╚══════════════════════════════════════════════════════════════════╝
(function () {
  if (window.__ZEUS_OF_P3__) return;
  window.__ZEUS_OF_P3__ = true;

  // ── Config ──────────────────────────────────────────────────────
  window.OF_PRICE_BUF = [];
  window.OF_PRICE_WINDOW_MS = 10000;   // 10s rolling window
  window.OF_PRICE_MAX = 50;      // safety cap

  // ── Prune helper ────────────────────────────────────────────────
  function _prunePriceBuf() {
    const cut = Date.now() - window.OF_PRICE_WINDOW_MS;
    const buf = window.OF_PRICE_BUF_ref();
    let i = 0;
    while (i < buf.length && buf[i].ts < cut) i++;
    if (i > 0) buf.splice(0, i);
    while (buf.length > window.OF_PRICE_MAX) buf.shift();
  }

  // Internal ref function (avoids closure stale pointer on symbol reset)
  window.OF_PRICE_BUF_ref = function () { return window.OF_PRICE_BUF; };

  // ── priceChangePct_5s ────────────────────────────────────────────
  // Returns (cur - old) / old * 100 using the oldest point <= now-5000ms.
  // Returns null if not enough history yet.
  window.priceChangePct_5s = function () {
    try {
      const buf = window.OF_PRICE_BUF;
      if (!buf || buf.length < 2) return null;
      const now = Date.now();
      const target = now - 5000;
      const cur = buf[buf.length - 1].price;
      // Find oldest entry at or before target (walk from front)
      let old = null;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i].ts <= target) { old = buf[i].price; }
        else break;
      }
      if (old === null || old === 0) return null;
      return (cur - old) / old * 100;
    } catch (_) { return null; }
  };

  // ── Tick: push current price, prune, enrich window.OF ───────────
  function _priceTick() {
    try {
      const price = window.S && window.S.price;
      if (Number.isFinite(price) && price > 0) {
        const now = Date.now();
        window.OF_PRICE_BUF.push({ ts: now, price });
        // Prune old
        const cut = now - window.OF_PRICE_WINDOW_MS;
        let i = 0;
        while (i < window.OF_PRICE_BUF.length && window.OF_PRICE_BUF[i].ts < cut) i++;
        if (i > 0) window.OF_PRICE_BUF.splice(0, i);
        while (window.OF_PRICE_BUF.length > window.OF_PRICE_MAX) window.OF_PRICE_BUF.shift();
      }

      // Enrich window.OF.quality with price telemetry (read-only, non-exec)
      if (window.OF) {
        const buf = window.OF_PRICE_BUF;
        const priceSamples = buf.length;
        const lastPriceTs = priceSamples > 0 ? buf[buf.length - 1].ts : null;
        const priceAgeMs = lastPriceTs ? (Date.now() - lastPriceTs) : null;
        const pChg5s = window.priceChangePct_5s();
        window.OF.quality = Object.assign(window.OF.quality || {}, {
          priceSamples,
          priceAgeMs,
          priceChangePct5s: pChg5s   // null until 5s history exists
        });
      }
    } catch (e) {
      try {
        if (typeof ZLOG !== 'undefined')
          ZLOG.push('WARN', '[OF v121 P3] priceTick error: ' + (e && e.message));
      } catch (_) { }
    }
  }

  // ── Symbol change: reset price buffer ───────────────────────────
  const _prevSetSymbol3 = window.setSymbol;
  window.setSymbol = function (sym) {
    if (typeof _prevSetSymbol3 === 'function') _prevSetSymbol3(sym);
    try { window.OF_PRICE_BUF = []; } catch (_) { }
  };

  // ── Attach to PAS 2 interval by sharing the same 1s clock ───────
  // PAS 2 interval starts at 1500ms; we piggyback at 1100ms to run after OF is set
  function _start() {
    Intervals.set('of_p3_price', _priceTick, 1000);
    try {
      if (typeof ZLOG !== 'undefined')
        ZLOG.push('INFO', '[OF v121 P3] price buffer started (window=10s, max=50pts)');
    } catch (_) { }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(_start, 1100); });
  } else {
    setTimeout(_start, 1100);
  }

})();


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ZEUS ORDERFLOW v121 — PAS 4: ABSORB + PAS 5: EXHAUST           ║
// ║  Watch-only. No exec, no DSL, no UI.                             ║
// ╚══════════════════════════════════════════════════════════════════╝
(function () {
  if (window.__ZEUS_OF_P45__) return;
  window.__ZEUS_OF_P45__ = true;

  const T_DELTA_PCT = 0.35;   // abs(deltaPct) to activate absorb
  const T_PRICE_STILL = 0.06;   // abs(priceChangePct5s) must be below this
  const T_EXPIRE_TICKS = 3;      // ticks without condition before absorb expires
  const T_EXPIRE_MS = 15000;  // hard max absorb duration
  const T_EXHAUST_PCT = 0.40;   // deltaPct < 40% of peak → exhaust

  let _staleTicks = 0;

  window.OF = window.OF || {};
  window.OF.abs = { active: false };
  window.OF.exhaust = null;

  function _log(lvl, msg, meta) {
    try { if (typeof ZLOG !== 'undefined') ZLOG.push(lvl, msg, meta); } catch (_) { }
  }

  // ── PAS 4: ABSORB ─────────────────────────────────────────────────
  function _tickAbsorb() {
    const OF = window.OF;
    if (!OF || !OF.quality || !OF.quality.burned) return;

    const deltaPct = OF.deltaPct || 0;
    const z = OF.z || 0;
    const price = (window.S && window.S.price) || 0;
    const pChg5s = (typeof window.priceChangePct_5s === 'function') ? window.priceChangePct_5s() : null;
    const now = Date.now();

    const condMet = Math.abs(deltaPct) > T_DELTA_PCT
      && pChg5s !== null
      && Math.abs(pChg5s) < T_PRICE_STILL;

    if (!OF.abs || !OF.abs.active) {  // [v122 FIX#2] guard: OF.abs can be undefined at boot/reconnect
      if (OF.abs && OF.abs._cooldownUntil && now < OF.abs._cooldownUntil) return; // [v122] post-exhaust cooldown
      if (condMet) {
        _staleTicks = 0;
        OF.abs = {
          active: true,
          side: deltaPct > 0 ? 'BUY' : 'SELL',
          startTs: now, startPrice: price,
          peakDeltaPct: deltaPct, lastTs: now
        };
        _log('AT', '[OF] ABSORB ' + OF.abs.side +
          ' sym=' + (OF.sym || '?') + ' price=' + price.toFixed(2) +
          ' dPct=' + deltaPct.toFixed(2) + '% z=' + z.toFixed(2) +
          ' pChg5s=' + (pChg5s !== null ? pChg5s.toFixed(3) + '%' : 'null'),
          { deltaPct, z, pChg5s, price });
      }
    } else {
      const elapsed = now - OF.abs.startTs;
      if (condMet) {
        _staleTicks = 0;
        OF.abs.lastTs = now;
        if (Math.abs(deltaPct) > Math.abs(OF.abs.peakDeltaPct)) OF.abs.peakDeltaPct = deltaPct;
      } else {
        _staleTicks++;
      }
      if (_staleTicks >= T_EXPIRE_TICKS || elapsed >= T_EXPIRE_MS) {
        OF.abs = { active: false };
        _staleTicks = 0;
      }
    }
  }

  // ── PAS 5: EXHAUST ────────────────────────────────────────────────
  function _tickExhaust() {
    const OF = window.OF;
    if (!OF || !OF.abs || !OF.abs.active) return;
    if ((Date.now() - (OF.abs.startTs || 0)) < 3000) return; // [v122] absorb must be ≥3s old before exhaust can fire

    const deltaPct = OF.deltaPct || 0;
    const peak = OF.abs.peakDeltaPct || 0;
    const z = OF.z || 0;
    const price = (window.S && window.S.price) || 0;
    const pChg5s = (typeof window.priceChangePct_5s === 'function') ? window.priceChangePct_5s() : null;

    const condFade = peak !== 0 && Math.abs(deltaPct) < Math.abs(peak) * T_EXHAUST_PCT;
    const absDir = peak > 0 ? 1 : -1;
    const velFlip = (OF.deltaVel || 0) * absDir < -0.01;

    if (condFade || velFlip) {
      const strength = Math.min(1, Math.abs(peak) * 2);
      const _absSide = OF.abs.side;
      OF.exhaust = { ts: Date.now(), side: _absSide, strength, condFade, velFlip };
      _log('AT', '[OF] EXHAUST ' + _absSide +
        ' sym=' + (OF.sym || '?') + ' price=' + price.toFixed(2) +
        ' dPct=' + deltaPct.toFixed(2) + '% peak=' + peak.toFixed(2) + '%' +
        ' z=' + z.toFixed(2) + ' str=' + strength.toFixed(2) +
        ' pChg5s=' + (pChg5s !== null ? pChg5s.toFixed(3) + '%' : 'null'),
        { deltaPct, peak, z, strength, condFade, velFlip, pChg5s, price });
      OF.abs = { active: false, _cooldownUntil: Date.now() + 5000 }; _staleTicks = 0; // [v122] 5s cooldown after exhaust
    }
  }

  function _tick() {
    try { _tickAbsorb(); } catch (e) { _log('WARN', '[OF P4] ' + e.message); }
    try { _tickExhaust(); } catch (e) { _log('WARN', '[OF P5] ' + e.message); }
    try { if (typeof _tickVacuum === 'function') _tickVacuum(); } catch (e) { _log('WARN', '[OF VAC] ' + e.message); }
    try { if (typeof _tickDeltaFlip === 'function') _tickDeltaFlip(); } catch (e) { _log('WARN', '[OF DFLIP] ' + e.message); }
    try { if (typeof _tickIceberg === 'function') _tickIceberg(); } catch (e) { _log('WARN', '[OF ICE] ' + e.message); }
    // [P11] New high-fidelity ABSORB + EXHAUST — registered externally
    try { if (typeof window._tickAbsorbP11 === 'function') window._tickAbsorbP11(); } catch (e) { _log('WARN', '[OF P11-ABS] ' + e.message); }
    try { if (typeof window._tickExhaustP11 === 'function') window._tickExhaustP11(); } catch (e) { _log('WARN', '[OF P11-EXH] ' + e.message); }
    // [P12] Liquidity Sweep + Stop Cascade — registered externally
    try { if (typeof window._tickSweepP12 === 'function') window._tickSweepP12(); } catch (e) { _log('WARN', '[OF P12-SWP] ' + e.message); }
    try { if (typeof window._tickCascadeP12 === 'function') window._tickCascadeP12(); } catch (e) { _log('WARN', '[OF P12-CAS] ' + e.message); }
    // [P13] Liquidity Magnet — registered externally
    try { if (typeof window._tickMagnetP13 === 'function') window._tickMagnetP13(); } catch (e) { _log('WARN', '[OF P13-MAG] ' + e.message); }
    // [P14] Liquidity Void — registered externally
    try { if (typeof window._tickVoidP14 === 'function') window._tickVoidP14(); } catch (e) { _log('WARN', '[OF P14-VOI] ' + e.message); }
  }

  // ── Symbol change reset ───────────────────────────────────────────
  const _prevSS45 = window.setSymbol;
  window.setSymbol = function (sym) {
    if (typeof _prevSS45 === 'function') _prevSS45(sym);
    try {
      if (window.OF) { window.OF.abs = { active: false }; window.OF.exhaust = null; }
      _staleTicks = 0;
    } catch (_) { }
  };

  function _start() {
    Intervals.set('of_p4_absorb', _tick, 1000);
    _log('INFO', '[OF v121 P4+P5] absorb/exhaust engine started (dPct>' + T_DELTA_PCT + '% pStill<' + T_PRICE_STILL + '%)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(_start, 1200); });
  } else {
    setTimeout(_start, 1200);
  }
})();


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ZEUS ORDERFLOW v121 — VACUUM DETECTOR                          ║
// ║  Fast price move + thin flow = liquidity vacuum. Watch-only.    ║
// ╚══════════════════════════════════════════════════════════════════╝
(function () {
  if (window.__ZEUS_OF_VACUUM__) return;
  window.__ZEUS_OF_VACUUM__ = true;

  // ── Constants ────────────────────────────────────────────────────
  const VAC_WIN_MS = 2000;   // window for move + flow measurement
  const VAC_MIN_MOVE_PCT = 0.06;   // abs price move % in VAC_WIN_MS
  const VAC_MAX_TPS = 6;      // max trades/sec (thin flow)
  const VAC_MAX_VOL = 40;     // max volume sum (thin flow)
  const VAC_MIN_SAMPLES = 20;     // burn-in gate
  const VAC_COOLDOWN_MS = 3000;   // min ms between vacuum activations

  // ── Init OF.vacuum ───────────────────────────────────────────────
  window.OF = window.OF || {};
  window.OF.vacuum = { active: false, dir: null, ts: 0, movePct: 0, tps: 0, vol: 0, reason: '', cooldownUntil: 0 };

  let _prevActive = false;

  // ── Helpers ──────────────────────────────────────────────────────
  function _getPriceNow() {
    try {
      const buf = window.OF_PRICE_BUF;
      if (buf && buf.length) return buf[buf.length - 1].price;
    } catch (_) { }
    const sp = window.S && window.S.price;
    return (Number.isFinite(sp) && sp > 0) ? sp : null;
  }

  function _priceMovePct(ms) {
    try {
      const buf = window.OF_PRICE_BUF;
      if (!buf || buf.length < 2) return null;
      const now = Date.now();
      const target = now - ms;
      let oldest = null;
      // Find newest entry that is still <= target
      for (let i = 0; i < buf.length; i++) {
        if (buf[i].ts <= target) oldest = buf[i].price;
        else break;
      }
      if (oldest === null || oldest === 0) return null;
      const cur = buf[buf.length - 1].price;
      return (cur - oldest) / oldest * 100;
    } catch (_) { return null; }
  }

  function _stats2s() {
    // Single pass over RAW_FLOW.buf — only iterate trades in last VAC_WIN_MS
    let nTrades = 0, vol = 0;
    try {
      const buf = window.RAW_FLOW && window.RAW_FLOW.buf;
      if (!buf) return { tps: 0, vol: 0 };
      const cut = Date.now() - VAC_WIN_MS;
      for (let i = buf.length - 1; i >= 0; i--) {
        if (buf[i].ts < cut) break;  // buf is chronological; oldest first → stop early
        nTrades++;
        vol += buf[i].q;
      }
    } catch (_) { }
    return { tps: nTrades / (VAC_WIN_MS / 1000), vol };
  }

  // ── Tick (called by P4+5 combined _tick) ─────────────────────────
  window._tickVacuum = function () {
    const OF = window.OF || {};
    const now = Date.now();
    const vac = OF.vacuum || {};

    // Burn-in gate
    if (!OF.quality || OF.quality.samples < VAC_MIN_SAMPLES) {
      if (vac.active) { vac.active = false; }
      return;
    }

    // Cooldown gate
    if (now < vac.cooldownUntil) {
      if (vac.active) vac.active = false;
      return;
    }

    const movePct = _priceMovePct(VAC_WIN_MS);
    if (movePct === null) { vac.active = false; return; }

    const { tps, vol } = _stats2s();

    const condMet = Math.abs(movePct) >= VAC_MIN_MOVE_PCT
      && tps <= VAC_MAX_TPS
      && vol <= VAC_MAX_VOL;

    if (condMet) {
      const dir = movePct > 0 ? 'UP' : 'DOWN';
      OF.vacuum = {
        active: true,
        dir,
        ts: now,
        movePct,
        tps,
        vol,
        reason: 'thinFlow',
        cooldownUntil: now + VAC_COOLDOWN_MS
      };
      // Edge-log: only on rising edge
      if (!_prevActive) {
        try {
          if (typeof ZLOG !== 'undefined')
            ZLOG.push('AT',
              '[OF] VACUUM dir=' + dir +
              ' movePct=' + movePct.toFixed(3) + '%' +
              ' tps=' + tps.toFixed(1) +
              ' vol=' + vol.toFixed(2) +
              ' sym=' + (OF.sym || '?'),
              { dir, movePct, tps, vol }
            );
        } catch (_) { }
      }
      _prevActive = true;
    } else {
      if (OF.vacuum) OF.vacuum.active = false;  // [v122 FIX] guard: OF.vacuum can be undefined during reset/boot race
      _prevActive = false;
    }
  };

  // ── Symbol change reset ───────────────────────────────────────────
  const _prevSSVac = window.setSymbol;
  window.setSymbol = function (sym) {
    if (typeof _prevSSVac === 'function') _prevSSVac(sym);
    try {
      if (window.OF) window.OF.vacuum = { active: false, dir: null, ts: 0, movePct: 0, tps: 0, vol: 0, reason: '', cooldownUntil: 0 };
      _prevActive = false;
    } catch (_) { }
  };

  try {
    if (typeof ZLOG !== 'undefined')
      ZLOG.push('INFO', '[OF VACUUM] detector registered (win=2s move>0.06% tps<6 vol<40)');
  } catch (_) { }
})();

// ╔══════════════════════════════════════════════════════════════════╗
// ║  ZEUS ORDERFLOW v121 — DELTA FLIP DETECTOR                      ║
// ║  Pressure reversal + price response = shift signal. Watch-only. ║
// ╚══════════════════════════════════════════════════════════════════╝
(function () {
  if (window.__ZEUS_OF_DFLIP__) return;
  window.__ZEUS_OF_DFLIP__ = true;

  // ── Constants ────────────────────────────────────────────────────
  const DF_WIN_MS = 3000;   // slice window
  const DF_MIN_DELTA_PCT = 0.25;   // prior pressure threshold
  const DF_FLIP_TO = 0.10;   // new side minimum magnitude
  const DF_MIN_Z = 1.5;    // z-strength gate (0 = disabled)
  const DF_MIN_PRICE_MOVE_PCT = 0.02;   // price response minimum
  const DF_COOLDOWN_MS = 4000;   // anti-spam cooldown
  const DF_REQUIRE_BURNED = true;   // gate on burn-in

  // ── Init ─────────────────────────────────────────────────────────
  window.OF = window.OF || {};
  window.OF.dFlip = {
    active: false, dir: null, ts: 0,
    prevDeltaPct: 0, curDeltaPct: 0, z: 0,
    priceMovePct: 0, reason: '', cooldownUntil: 0
  };

  let _prevSliceDeltaPct = 0;
  let _prevActive = false;

  // ── Helpers ──────────────────────────────────────────────────────

  // Single-pass slice deltaPct for trades with ts >= cut
  function _deltaPctAt(cut) {
    try {
      const buf = window.RAW_FLOW && window.RAW_FLOW.buf;
      if (!buf || !buf.length) return null;
      let buyVol = 0, sellVol = 0;
      for (let i = buf.length - 1; i >= 0; i--) {
        if (buf[i].ts < cut) break;  // chronological — stop early
        if (buf[i].isBuyerMaker) sellVol += buf[i].q;
        else buyVol += buf[i].q;
      }
      const total = buyVol + sellVol;
      if (total < 1e-9) return null;  // no trades in window
      return (buyVol - sellVol) / total;  // range [-1, +1]  (×100 = pct)
    } catch (_) { return null; }
  }

  // Price move % over last ms — mirrors priceChangePct_5s style
  function _priceMovePct(ms) {
    try {
      const buf = window.OF_PRICE_BUF;
      if (!buf || buf.length < 2) return null;
      const now = Date.now();
      const target = now - ms;
      let oldest = null;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i].ts <= target) oldest = buf[i].price;
        else break;
      }
      if (oldest === null || oldest === 0) return null;
      const cur = buf[buf.length - 1].price;
      return (cur - oldest) / oldest * 100;
    } catch (_) { return null; }
  }

  // ── Tick ──────────────────────────────────────────────────────────
  window._tickDeltaFlip = function () {
    const OF = window.OF || {};
    const now = Date.now();
    const df = OF.dFlip;

    // Burn-in gate
    if (DF_REQUIRE_BURNED && (!OF.quality || OF.quality.samples < 20)) {
      if (df) df.active = false;
      return;
    }

    // Cooldown gate
    if (df && now < df.cooldownUntil) {
      df.active = false;
      return;
    }

    // Compute current slice deltaPct and price move
    const curSlice = _deltaPctAt(now - DF_WIN_MS);  // [-1..+1]
    if (curSlice === null) { if (df) df.active = false; _prevSliceDeltaPct = 0; return; }
    const curPct = curSlice * 100;                 // convert to pct for readability
    const priceMove = _priceMovePct(DF_WIN_MS);       // can be null
    const z = OF.z || 0;

    // Flip detection
    const prevPct = _prevSliceDeltaPct;
    let flipDir = null;

    // A) Was strongly bullish → now bearish
    if (prevPct >= DF_MIN_DELTA_PCT * 100 && curPct <= -(DF_FLIP_TO * 100)) flipDir = 'BEAR';
    // B) Was strongly bearish → now bullish
    if (prevPct <= -(DF_MIN_DELTA_PCT * 100) && curPct >= (DF_FLIP_TO * 100)) flipDir = 'BULL';

    let condMet = flipDir !== null;

    // Price response confirm
    if (condMet && priceMove !== null) {
      if (flipDir === 'BEAR' && priceMove > -DF_MIN_PRICE_MOVE_PCT) condMet = false;
      if (flipDir === 'BULL' && priceMove < DF_MIN_PRICE_MOVE_PCT) condMet = false;
    } else if (condMet && priceMove === null) {
      condMet = false;  // need price history
    }

    // Z strength confirm
    if (condMet && DF_MIN_Z > 0 && Math.abs(z) < DF_MIN_Z) condMet = false;

    if (condMet) {
      OF.dFlip = {
        active: true,
        dir: flipDir,
        ts: now,
        prevDeltaPct: prevPct,
        curDeltaPct: curPct,
        z,
        priceMovePct: priceMove,
        reason: 'sliceFlip+price',
        cooldownUntil: now + DF_COOLDOWN_MS
      };
      // Edge-log on rising edge only
      if (!_prevActive) {
        try {
          if (typeof ZLOG !== 'undefined')
            ZLOG.push('AT',
              '[OF] DFLIP dir=' + flipDir +
              ' prevDPct=' + prevPct.toFixed(2) + '%' +
              ' curDPct=' + curPct.toFixed(2) + '%' +
              ' z=' + z.toFixed(2) +
              ' pMove=' + (priceMove !== null ? priceMove.toFixed(3) + '%' : 'null') +
              ' sym=' + (OF.sym || '?'),
              { dir: flipDir, prevPct, curPct, z, priceMove }
            );
        } catch (_) { }
      }
      _prevActive = true;
    } else {
      if (df) df.active = false;
      _prevActive = false;
    }

    // Update prev slice for next tick
    _prevSliceDeltaPct = curPct;
  };

  // ── Symbol change reset ───────────────────────────────────────────
  const _prevSSDFlip = window.setSymbol;
  window.setSymbol = function (sym) {
    if (typeof _prevSSDFlip === 'function') _prevSSDFlip(sym);
    try {
      _prevSliceDeltaPct = 0;
      _prevActive = false;
      if (window.OF) window.OF.dFlip = {
        active: false, dir: null, ts: 0,
        prevDeltaPct: 0, curDeltaPct: 0, z: 0,
        priceMovePct: 0, reason: '', cooldownUntil: 0
      };
    } catch (_) { }
  };

  try {
    if (typeof ZLOG !== 'undefined')
      ZLOG.push('INFO', '[OF DFLIP] detector registered (win=3s prevPct>0.25 flipTo>0.10 z>' + DF_MIN_Z + ')');
  } catch (_) { }
})();

// ╔══════════════════════════════════════════════════════════════════╗
// ║  ZEUS ORDERFLOW v121 — ICEBERG DETECTOR                         ║
// ║  Repeated-size prints + price stuck = hidden order signature.   ║
// ║  Watch-only. No exec/DSL/WVE. No new WS.                        ║
// ╚══════════════════════════════════════════════════════════════════╝
(function () {
  if (window.__ZEUS_OF_ICE__) return;
  window.__ZEUS_OF_ICE__ = true;

  // ── Constants ────────────────────────────────────────────────────
  const ICE_WIN_MS = 2000;   // analysis window
  const ICE_MIN_TRADES = 30;     // minimum prints in window
  const ICE_TOP_SHARE = 0.22;   // top bin must cover ≥22% of trades
  const ICE_TOP2_SHARE = 0.34;   // top-2 bins combined ≥34%
  const ICE_MAX_PMOVE_PCT = 0.015;  // abs price move % — must be stuck
  const ICE_MIN_DPCT = 0.20;   // directional pressure threshold
  const ICE_COOLDOWN_MS = 5000;   // anti-spam

  // ── Init ─────────────────────────────────────────────────────────
  window.OF = window.OF || {};
  const _ICE_DEFAULT = () => ({
    active: false, side: null, ts: 0, tps: 0, vol: 0,
    priceMovePct: 0, sliceDeltaPct: 0,
    topBin: 0, topShare: 0, top2Share: 0,
    reason: '', cooldownUntil: 0
  });
  window.OF.ice = _ICE_DEFAULT();

  let _prevActive = false;

  // ── _sliceStats: single pass from tail, break at cutTs ───────────
  function _sliceStats(cutTs) {
    const buf = window.RAW_FLOW && window.RAW_FLOW.buf;
    if (!buf || !buf.length) return null;
    let n = 0, vol = 0, buyVol = 0, sellVol = 0;
    const hist = new Map();
    for (let i = buf.length - 1; i >= 0; i--) {
      const t = buf[i];
      if (t.ts < cutTs) break;
      n++;
      vol += t.q;
      if (t.isBuyerMaker) sellVol += t.q;
      else buyVol += t.q;
      // Log-bin quantization: round log10(q) to nearest 0.05 step
      const qBin = t.q > 0
        ? (Math.round(Math.log10(t.q) / 0.05) * 0.05).toFixed(2)
        : '0.00';
      hist.set(qBin, (hist.get(qBin) || 0) + 1);
    }
    return { n, vol, buyVol, sellVol, hist };
  }

  // ── _priceMovePct: signed move over last ms ───────────────────────
  function _priceMovePct(ms) {
    try {
      const buf = window.OF_PRICE_BUF;
      if (!buf || buf.length < 2) return null;
      const target = Date.now() - ms;
      let oldest = null;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i].ts <= target) oldest = buf[i].price;
        else break;
      }
      if (oldest === null || oldest === 0) return null;
      const cur = buf[buf.length - 1].price;
      return (cur - oldest) / oldest * 100;
    } catch (_) { return null; }
  }

  // ── Tick ─────────────────────────────────────────────────────────
  window._tickIceberg = function () {
    const OF = window.OF || {};
    const now = Date.now();
    const ice = OF.ice;

    // Burn-in gate
    if (!OF.quality || OF.quality.samples < 20) {
      if (ice) ice.active = false;
      return;
    }

    // Cooldown gate
    if (ice && now < ice.cooldownUntil) {
      ice.active = false;
      return;
    }

    // Slice stats
    const stats = _sliceStats(now - ICE_WIN_MS);
    if (!stats || stats.n < ICE_MIN_TRADES) {
      if (ice) ice.active = false;
      _prevActive = false;
      return;
    }

    // Price move
    const pMoveRaw = _priceMovePct(ICE_WIN_MS);
    if (pMoveRaw === null) { if (ice) ice.active = false; return; }
    const pMove = Math.abs(pMoveRaw);

    // Directional pressure
    const eps = 1e-9;
    const dPct = (stats.buyVol - stats.sellVol) / Math.max(stats.buyVol + stats.sellVol, eps);

    // Gate: price stuck + directional pressure
    if (pMove > ICE_MAX_PMOVE_PCT || Math.abs(dPct) < ICE_MIN_DPCT) {
      if (ice) ice.active = false;
      _prevActive = false;
      return;
    }

    // Histogram dominance — find top-1 and top-2 bin counts
    let top1 = 0, top2 = 0;
    for (const cnt of stats.hist.values()) {
      if (cnt >= top1) { top2 = top1; top1 = cnt; }
      else if (cnt > top2) { top2 = cnt; }
    }
    let topBinKey = 0;
    for (const [k, v] of stats.hist.entries()) { if (v === top1) { topBinKey = +k; break; } }

    const topShare = top1 / stats.n;
    const top2Share = (top1 + top2) / stats.n;

    if (topShare < ICE_TOP_SHARE && top2Share < ICE_TOP2_SHARE) {
      if (ice) ice.active = false;
      _prevActive = false;
      return;
    }

    // All conditions met
    const side = dPct > 0 ? 'BUY' : 'SELL';
    const tps = stats.n / (ICE_WIN_MS / 1000);

    OF.ice = {
      active: true,
      side,
      ts: now,
      tps,
      vol: stats.vol,
      priceMovePct: pMove,
      sliceDeltaPct: dPct,
      topBin: topBinKey,
      topShare,
      top2Share,
      reason: 'sizeCluster+stuck',
      cooldownUntil: now + ICE_COOLDOWN_MS
    };

    // Rising-edge log only
    if (!_prevActive) {
      try {
        if (typeof ZLOG !== 'undefined')
          ZLOG.push('AT',
            '[OF] ICEBERG side=' + side +
            ' tps=' + tps.toFixed(1) +
            ' top=' + (topShare * 100).toFixed(1) + '%' +
            ' top2=' + (top2Share * 100).toFixed(1) + '%' +
            ' dPct=' + (dPct * 100).toFixed(2) + '%' +
            ' pMove=' + pMove.toFixed(3) + '%' +
            ' winMs=' + ICE_WIN_MS,
            { side, tps, topShare, top2Share, dPct, pMove }
          );
      } catch (_) { }
    }
    _prevActive = true;
    return;

  };

  // ── Symbol change reset ───────────────────────────────────────────
  const _prevSSIce = window.setSymbol;
  window.setSymbol = function (sym) {
    if (typeof _prevSSIce === 'function') _prevSSIce(sym);
    try {
      _prevActive = false;
      if (window.OF) window.OF.ice = _ICE_DEFAULT();
    } catch (_) { }
  };

  try {
    if (typeof ZLOG !== 'undefined')
      ZLOG.push('INFO', '[OF ICE] detector registered (win=2s minTrades=' + ICE_MIN_TRADES + ' topShare>' + ICE_TOP_SHARE + ')');
  } catch (_) { }
})();

// ===== MODULE: HUD =====
// ╔══════════════════════════════════════════════════════════════════╗
// ║  ZEUS ORDERFLOW v121 — PREMIUM DEBUG HUD v2                     ║
// ║  top-right, neon chips, compact/expand, localStorage persist.   ║
// ║  Read-only. No WS. No exec/DSL/WVE.                             ║
// ╚══════════════════════════════════════════════════════════════════╝
(function () {
  if (window.__ZEUS_OF_HUD__) return;
  window.__ZEUS_OF_HUD__ = true;

  // Observer registry — P10–P14 push their MutationObserver here when created.
  // _buildDom() disconnects + clears all of them once DOM ownership transfers to _render().
  window.__OF_HUD_OBS = window.__OF_HUD_OBS || [];

  // ── Inject CSS ────────────────────────────────────────────────────
  (function _css() {
    const s = document.createElement('style');
    s.textContent = `
#of-hud{position:relative;width:100%;
  border-radius:0;padding:10px 12px;
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  background:transparent;
  border:none;
  box-shadow:none;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;
  pointer-events:auto;color:#ccc;cursor:pointer;transition:opacity .2s;
  transform:translateZ(0);backface-visibility:hidden;
  overflow:hidden;contain:layout style;}
#of-hud *{transform:translateZ(0);}
#of-hud.hidden{display:none}
#of-hud .hdr{display:none;}
#of-hud .row{display:flex;gap:6px;flex-wrap:nowrap;align-items:center;
  margin:2px 0;min-height:26px;overflow:hidden;}
#of-hud .lbl{font-size:12px;color:#556;letter-spacing:1px;
  min-width:44px;max-width:44px;flex-shrink:0;}
#of-hud .chip{padding:2px 6px;border-radius:999px;border:1px solid rgba(255,255,255,0.10);
  background:rgba(255,255,255,0.05);font-size:10px;white-space:nowrap;
  font-variant-numeric:tabular-nums;flex-shrink:0;}
#of-hud .ok{color:#00ffa0;border-color:rgba(0,255,160,0.35);box-shadow:0 0 8px rgba(0,255,160,0.15);}
#of-hud .thin{color:#ffc800;border-color:rgba(255,200,0,0.35);box-shadow:0 0 8px rgba(255,200,0,0.15);}
#of-hud .dead{color:#ff3c50;border-color:rgba(255,60,80,0.40);box-shadow:0 0 8px rgba(255,60,80,0.15);}
#of-hud .active{color:#00b4ff;border-color:rgba(0,180,255,0.35);box-shadow:0 0 8px rgba(0,180,255,0.15);}
#of-hud .muted{color:#445;border-color:rgba(255,255,255,0.06);}
#of-hud .expand-hint{font-size:12px;color:#334;text-align:center;margin-top:4px;}
#of-hud .sim{color:#cc88ff;border-color:rgba(180,100,255,0.35);box-shadow:0 0 6px rgba(180,100,255,0.18);}
#of-hud .dbg-on{color:#ff9900;border-color:rgba(255,153,0,0.4);box-shadow:0 0 6px rgba(255,153,0,0.18);}
#of-hud .idle{color:#445;border-color:rgba(255,255,255,0.06);background:rgba(0,0,0,0.2);}
#of-hud .reg-squeeze{color:#ffc800;} #of-hud .reg-trend{color:#00ffa0;} #of-hud .reg-chop{color:#44aaff;}
#of-hud .detail{margin-top:5px;padding-top:5px;border-top:1px solid rgba(255,255,255,0.06);}

/* ── MAGNET / VOID compact chips ───────────────────────────────────── */
@keyframes ofHudBreath {
  0%,100% { opacity:0.65; }
  50%      { opacity:1.0;  }
}
/* Reserved-width row — height always held, zero layout shift */
#of-hud .mv-row {
  display:flex;gap:6px;align-items:center;
  min-height:26px;margin:2px 0;
  overflow:hidden;contain:layout style;
}
/* Slot: always occupies its reserved width, invisible when inactive */
#of-hud .mv-slot {
  /* reserve width via min-width so toggling active never reflowes siblings */
  flex:0 0 auto;
  opacity:0;
  pointer-events:none;
  transition:opacity 0.25s ease;
  /* inherit .chip base: padding, border-radius, font-size, white-space */
}
#of-hud .mv-slot.is-active {
  opacity:1;
  pointer-events:auto;
  animation:ofHudBreath 1.6s ease-in-out infinite;
}
/* MAGNET — warm amber */
#of-hud .mv-magnet {
  min-width:152px;
  color:#ffaa44;
  border-color:rgba(255,170,68,0.45);
  box-shadow:0 0 8px rgba(255,170,68,0.18);
}
/* VOID — cold violet */
#of-hud .mv-void {
  min-width:128px;
  color:#cc44ff;
  border-color:rgba(200,64,255,0.45);
  box-shadow:0 0 8px rgba(200,64,255,0.18);
}
/* ── QUANT detector rows (P15) ─────────────────────────────────── */
#of-hud .q-wall-bid  { color:#00ffa0; border-color:rgba(0,255,160,0.35); }
#of-hud .q-wall-ask  { color:#ff3c50; border-color:rgba(255,60,80,0.40); }
#of-hud .q-wall-idle { color:#445;   border-color:rgba(255,255,255,0.06); }
#of-hud .q-stop-up   { color:#ffaa44; border-color:rgba(255,170,68,0.40); }
#of-hud .q-stop-dn   { color:#ff3c50; border-color:rgba(255,60,80,0.40); }
#of-hud .q-smf-buy   { color:#00ffa0; border-color:rgba(0,255,160,0.35); }
#of-hud .q-smf-sell  { color:#ff3c50; border-color:rgba(255,60,80,0.40); }
#of-hud .q-smf-div   { color:#cc88ff; border-color:rgba(180,100,255,0.35);
                        font-weight:700; }
/* One-shot IDLE→ACTIVE pulse — auto-removed after 250ms via JS */
@keyframes ofHudQuantPulse {
  0%   { box-shadow:0 0 0   rgba(255,255,255,0); }
  40%  { box-shadow:0 0 14px rgba(255,255,255,0.55); }
  100% { box-shadow:0 0 0   rgba(255,255,255,0); }
}
#of-hud .q-pulse { animation:ofHudQuantPulse 0.25s ease-out forwards; }
    `;
    document.head.appendChild(s);
  })();

  // ── Snapshot (console accessible) ────────────────────────────────
  window.OF_DEBUG_SNAPSHOT = function () {
    const OF = window.OF || {}, RF = window.RAW_FLOW || {}, now = Date.now();
    let tps5 = 0;
    if (RF.buf) {
      const c5 = now - 5000;
      for (let i = RF.buf.length - 1; i >= 0; i--) { if (RF.buf[i].ts >= c5) tps5++; else break; }
      tps5 /= 5;
    }
    const alive = window.WS && typeof window.WS.isOpen === 'function'
      ? window.WS.isOpen('of_agg')
      : (RF.buf && RF.buf.length && (now - RF.buf[RF.buf.length - 1].ts) < 5000);
    const health = !alive ? 'DEAD' : tps5 >= 10 ? 'OK' : 'THIN';
    const q = OF.quality || {}, ab = OF.abs || {}, ex = OF.exhaust || {};
    const tr = OF.trap || {}, vc = OF.vacuum || {}, ic = OF.ice || {}, df = OF.dFlip || {};
    const dbg = typeof _isDbgOn === 'function' ? _isDbgOn() : false;
    // Debug-softened active checks (display only — never touches core detectors)
    const vacDbgActive = dbg && vc.movePct != null && (Math.abs(vc.movePct) >= 0.03 || (vc.tps <= 10 && vc.vol <= 80));
    const iceDbgActive = dbg && ic.topShare != null && (ic.topShare >= 0.45 || ic.top2Share >= 0.65);
    const flipDbgActive = dbg && df.curDeltaPct != null && df.prevDeltaPct != null && Math.abs(df.curDeltaPct - df.prevDeltaPct) >= 15;
    return {
      health: { status: health, tps: +tps5.toFixed(1), samples: q.samples || 0, dropped: RF.dropped || 0 },
      regime: typeof _getRegime === 'function' ? _getRegime() : '—',
      debug: dbg,
      debugSecsLeft: dbg ? Math.max(0, Math.ceil((_state.debugUntil - now) / 1000)) : 0,
      trap: {
        active: !!tr.active, confirmed: !!tr.confirmed, fail: !!tr.fail, pending: !!tr.pendingConfirm,
        dir: tr.dir || null, movePct: tr.priceMovePct ?? null, reason: tr.reason || null,
        lastSeen: typeof _lastSeen !== 'undefined' ? _lastSeen.trap : 0
      },
      vacuum: {
        active: !!vc.active, simActive: vacDbgActive && !vc.active, dir: vc.dir || null,
        movePct: vc.movePct ?? null, tps: vc.tps ?? null, vol: vc.vol ?? null,
        lastSeen: typeof _lastSeen !== 'undefined' ? _lastSeen.vacuum : 0
      },
      ice: {
        active: !!ic.active, simActive: iceDbgActive && !ic.active, side: ic.side || null,
        topShare: ic.topShare ?? null, top2Share: ic.top2Share ?? null,
        lastSeen: typeof _lastSeen !== 'undefined' ? _lastSeen.ice : 0
      },
      dFlip: {
        active: !!df.active, simActive: flipDbgActive && !df.active, dir: df.dir || null,
        prevDPct: df.prevDeltaPct ?? null, curDPct: df.curDeltaPct ?? null, z: df.z ?? null,
        lastSeen: typeof _lastSeen !== 'undefined' ? _lastSeen.flip : 0
      },
      absExh: {
        absActive: !!ab.active, absSide: ab.side || null, exhTs: ex.ts || null, exhSide: ex.side || null,
        lastSeen: typeof _lastSeen !== 'undefined' ? _lastSeen.abs : 0
      },
    };
  };

  // ── State ─────────────────────────────────────────────────────────
  const LS_KEY = 'of_hud_v2';
  let _state = { visible: false, expanded: false, debug: false, debugUntil: 0 };  // default OFF — user opens with OF button
  try { const s = JSON.parse(localStorage.getItem(LS_KEY)); if (s) _state = Object.assign({ visible: true, expanded: false, debug: false, debugUntil: 0 }, s); } catch (_) { }

  let _hudEl = null, _interval = null;

  // ── lastSeen per-module (updated when active) ─────────────────────
  const _lastSeen = { trap: 0, vacuum: 0, ice: 0, flip: 0, abs: 0 };
  function _secsAgo(ts) { if (!ts) return '—'; const s = Math.floor((Date.now() - ts) / 1000); return s + 's ago'; }
  function _isDbgOn() { return !!(_state.debug && Date.now() < _state.debugUntil); }

  // ── Regime read (safe) ────────────────────────────────────────────
  function _getRegime() {
    try {
      const S0 = window.S || {}, BM0 = window.BM || {};
      const r = (S0.regime && (S0.regime.name || S0.regime))
        || (BM0.regime && (BM0.regime.name || BM0.regime))
        || (window.REGIME && (window.REGIME.name || window.REGIME));
      return r ? String(r).toUpperCase() : '—';
    } catch (_) { return '—'; }
  }
  function _regimeCls(r) {
    if (!r || r === '—') return '';
    if (/SQUEEZE/.test(r)) return 'reg-squeeze';
    if (/TREND/.test(r)) return 'reg-trend';
    if (/CHOP|RANGE/.test(r)) return 'reg-chop';
    return '';
  }

  // ── Helpers ───────────────────────────────────────────────────────
  const _chip = (txt, cls) => `<span class="chip ${cls || ''}">${txt}</span>`;
  const _n = (v, dec = 2) => v != null && isFinite(+v) ? (+v).toFixed(dec) : '—';
  const _hcls = h => h === 'OK' ? 'ok' : h === 'THIN' ? 'thin' : 'dead';
  function _fmtV(v) {
    if (v == null || !isFinite(+v)) return '—';
    v = +v;
    return v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(0);
  }
  function _fmtP(v) {
    if (v == null || !isFinite(+v)) return '—';
    v = +v;
    return v >= 1000 ? v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : v.toFixed(2);
  }

  // ── Static DOM helpers ─────────────────────────────────────────────
  let _dom = null;

  function _mk(tag, cls, parent) {
    const el = document.createElement(tag || 'span');
    if (cls) el.className = cls;
    if (parent) parent.appendChild(el);
    return el;
  }
  // Set chip text + class — only write if changed (avoids repaint on stable ticks)
  function _sc(el, txt, cls) {
    const nc = 'chip ' + (cls || 'muted');
    if (el.className !== nc) el.className = nc;
    if (el.textContent !== String(txt)) el.textContent = String(txt);
  }
  // Show/hide + update a chip slot
  function _sw(el, txt, cls, vis) {
    const show = vis !== false && txt != null && txt !== '';
    const nd = show ? '' : 'none';
    if (el.style.display !== nd) el.style.display = nd;
    if (show) _sc(el, txt, cls);
  }
  // Build a standard detail row: lbl + N pre-built chip slots + ts span
  function _drow(label, n, parent) {
    const r = _mk('div', 'row', parent);
    _mk('span', 'lbl', r).textContent = label;
    const chips = [];
    for (let i = 0; i < n; i++) {
      const c = _mk('span', 'chip idle', r);
      c.style.display = 'none';
      chips.push(c);
    }
    const ts = _mk('span', '', r);
    ts.style.cssText = 'margin-left:auto;font-size:12px;color:#334;flex-shrink:0';
    return { chips, ts };
  }
  // Timestamp helper (local — avoids closure dependency)
  function _ago(ts, now) {
    if (!ts) return '—';
    return Math.floor((now - ts) / 1000) + 's ago';
  }

  // ── Build static DOM shell (called ONCE on first render) ───────────
  function _buildDom() {
    _dom = {};
    // Clear without innerHTML= on the panel itself
    while (_hudEl.firstChild) _hudEl.removeChild(_hudEl.firstChild);

    // ── Header (static — never rebuilt) ────────────────────────────
    const hdr = _mk('div', 'hdr', _hudEl);
    hdr.id = 'of-hud-grip';
    _mk('span', 'grip', hdr).textContent = '⋮⋮';
    _mk('span', 'hdr-title', hdr).textContent = 'FLOW';
    const closeBtn = _mk('span', 'hdr-close', hdr);
    closeBtn.textContent = '✕';
    closeBtn.onclick = function (e) { e.stopPropagation(); window.ofHudToggle && window.ofHudToggle(); };

    // ── Compact row (always visible) ────────────────────────────────
    const cr = _mk('div', 'row', _hudEl);
    _dom.healthChip = _mk('span', 'chip ok', cr);
    _dom.tpsChip = _mk('span', 'chip thin', cr);
    _dom.smpChip = _mk('span', 'chip thin', cr);
    _dom.dbgChip = _mk('span', 'chip dbg-on', cr);
    _dom.dbgChip.style.display = 'none';
    // Active signals sub-span — only this gets innerHTML, not the panel
    _dom.signals = _mk('span', '', cr);
    _dom._sigCache = '';
    // FLOW chip — same compact row; P10 MutationObserver also finds it here
    _dom.flowChip = _mk('span', 'chip mm-flow-chip mm-flow-neut', cr);
    _dom.flowChip.textContent = 'FLOW NEUT';

    // ── MAGNET / VOID compact sub-row ─────────────────────────────────
    // Slots are ALWAYS in the DOM with reserved min-width — opacity:0 when
    // inactive, opacity:1 + breathing when active. Zero layout shift.
    const mvRow = _mk('div', 'mv-row', _hudEl);
    _dom.magnetChip = _mk('span', 'chip mv-slot mv-magnet', mvRow);
    _dom.magnetChip.textContent = 'MAGNET —';   // placeholder keeps min-width
    _dom.voidChip = _mk('span', 'chip mv-slot mv-void', mvRow);
    _dom.voidChip.textContent = 'VOID —';     // placeholder keeps min-width

    // ── Detail section (toggled by _onClick via display, not DOM rebuild) ──
    const det = _mk('div', 'detail', _hudEl);
    det.id = 'of-hud-detail';
    det.style.display = _state.expanded ? '' : 'none';
    _dom.det = det;

    // REG row (custom layout)
    {
      const r = _mk('div', 'row', det);
      _mk('span', 'lbl', r).textContent = 'REG';
      _dom.regTxt = _mk('span', '', r);
      _dom.regTxt.style.cssText = 'font-size:10px;font-weight:700;';
      _dom.engChip = _mk('span', 'chip muted', r);
      const dbgW = _mk('span', '', r);
      dbgW.style.marginLeft = 'auto';
      _dom.dbgToggle = _mk('span', 'chip muted', dbgW);
      _dom.dbgToggle.style.cssText += ';font-size:12px;color:#334;cursor:pointer';
      _dom.dbgToggle.onclick = function () { window.ofHudDebugToggle && window.ofHudDebugToggle(); };
    }

    // TRAP  — state ● | dir | CONF | PEND | FAIL | movePct
    _dom.trapRow = _drow('TRAP', 6, det);
    // VAC   — state ● | dir | movePct | tps | vol
    _dom.vacRow = _drow('VAC', 5, det);
    // ICE   — state ● | side | topShare | top2Share
    _dom.iceRow = _drow('ICE', 4, det);
    // FLIP  — state ● | dir | prevDPct | curDPct | z
    _dom.flipRow = _drow('FLIP', 5, det);

    // ABS/EXH row (custom — two modules in one row)
    {
      const r = _mk('div', 'row', det);
      _mk('span', 'lbl', r).textContent = 'ABS';
      _dom.absState = _mk('span', 'chip idle', r);
      _dom.absSide = _mk('span', 'chip active', r); _dom.absSide.style.display = 'none';
      _mk('span', 'lbl', r).textContent = 'EXH';
      _dom.exhState = _mk('span', 'chip idle', r);
      _dom.exhTs_ = _mk('span', 'chip muted', r); _dom.exhTs_.style.display = 'none';
      const absTs = _mk('span', '', r);
      absTs.style.cssText = 'margin-left:auto;font-size:12px;color:#334;flex-shrink:0';
      _dom.absTs = absTs;
    }

    // P10: MMTRAP row  — state | level? | bias | ts
    {
      const r = _mk('div', 'row mm-trap-row', det);
      _mk('span', 'lbl', r).textContent = 'MMTRAP';
      _dom.mmtrapState = _mk('span', 'chip idle', r);
      _dom.mmtrapLevel = _mk('span', 'chip muted', r); _dom.mmtrapLevel.style.display = 'none';
      _dom.mmtrapBias = _mk('span', 'chip muted', r);
      const ts = _mk('span', '', r);
      ts.style.cssText = 'margin-left:auto;font-size:12px;color:#334;flex-shrink:0';
      _dom.mmtrapTs = ts;
    }
    // P11: ABSORB row — state | vol | δ% | mv% | ts
    {
      const r = _mk('div', 'row p11-abs-row', det);
      _mk('span', 'lbl', r).textContent = 'ABSORB';
      _dom.absorbState = _mk('span', 'chip idle', r);
      _dom.absorbVol = _mk('span', 'chip idle', r); _dom.absorbVol.style.display = 'none';
      _dom.absorbDelta = _mk('span', 'chip idle', r); _dom.absorbDelta.style.display = 'none';
      _dom.absorbMove = _mk('span', 'chip idle', r); _dom.absorbMove.style.display = 'none';
      const ts = _mk('span', '', r);
      ts.style.cssText = 'margin-left:auto;font-size:12px;color:#334;flex-shrink:0';
      _dom.absorbTs = ts;
    }
    // P11: EXHAUST row — state | mv% | peak→now t/s | ts
    {
      const r = _mk('div', 'row p11-exh-row', det);
      _mk('span', 'lbl', r).textContent = 'EXHAUST';
      _dom.exhRowState = _mk('span', 'chip idle', r);
      _dom.exhRowMove = _mk('span', 'chip muted', r); _dom.exhRowMove.style.display = 'none';
      _dom.exhRowTps = _mk('span', 'chip muted', r); _dom.exhRowTps.style.display = 'none';
      const ts = _mk('span', '', r);
      ts.style.cssText = 'margin-left:auto;font-size:12px;color:#334;flex-shrink:0';
      _dom.exhRowTs = ts;
    }
    // P12: SWEEP row — state | move% | vol | tps | ts
    {
      const r = _mk('div', 'row p12-swp-row', det);
      _mk('span', 'lbl', r).textContent = 'SWEEP';
      _dom.sweepState = _mk('span', 'chip idle', r);
      _dom.sweepMove = _mk('span', 'chip idle', r); _dom.sweepMove.style.display = 'none';
      _dom.sweepVol = _mk('span', 'chip idle', r); _dom.sweepVol.style.display = 'none';
      _dom.sweepTps = _mk('span', 'chip idle', r); _dom.sweepTps.style.display = 'none';
      const ts = _mk('span', '', r);
      ts.style.cssText = 'margin-left:auto;font-size:12px;color:#334;flex-shrink:0';
      _dom.sweepTs = ts;
    }
    // P12: CASCADE row — state | tps | vol | move | ts
    {
      const r = _mk('div', 'row p12-cas-row', det);
      _mk('span', 'lbl', r).textContent = 'CASCADE';
      _dom.casState = _mk('span', 'chip idle', r);
      _dom.casTps = _mk('span', 'chip idle', r); _dom.casTps.style.display = 'none';
      _dom.casVol = _mk('span', 'chip idle', r); _dom.casVol.style.display = 'none';
      _dom.casMove = _mk('span', 'chip idle', r); _dom.casMove.style.display = 'none';
      const ts = _mk('span', '', r);
      ts.style.cssText = 'margin-left:auto;font-size:12px;color:#334;flex-shrink:0';
      _dom.casTs = ts;
    }
    // P13: MAGNET row — state | target | dist% | str× | conf% | ts
    {
      const r = _mk('div', 'row p13-mag-row', det);
      _mk('span', 'lbl', r).textContent = 'MAGNET';
      _dom.magState = _mk('span', 'chip idle', r);
      _dom.magTarget = _mk('span', 'chip muted', r); _dom.magTarget.style.display = 'none';
      _dom.magDist = _mk('span', 'chip muted', r); _dom.magDist.style.display = 'none';
      _dom.magStr = _mk('span', 'chip muted', r); _dom.magStr.style.display = 'none';
      _dom.magConf = _mk('span', 'chip p13-conf', r); _dom.magConf.style.display = 'none';
      const ts = _mk('span', '', r);
      ts.style.cssText = 'margin-left:auto;font-size:12px;color:#334;flex-shrink:0';
      _dom.magTs = ts;
    }
    // P14: VOID row — state | score | trades | vol | move | ts
    {
      const r = _mk('div', 'row p14-voi-row', det);
      _mk('span', 'lbl', r).textContent = 'VOID';
      _dom.voidState = _mk('span', 'chip idle', r);
      _dom.voidScore = _mk('span', 'chip idle', r); _dom.voidScore.style.display = 'none';
      _dom.voidTrades = _mk('span', 'chip idle', r); _dom.voidTrades.style.display = 'none';
      _dom.voidVol = _mk('span', 'chip idle', r); _dom.voidVol.style.display = 'none';
      _dom.voidMove = _mk('span', 'chip idle', r); _dom.voidMove.style.display = 'none';
      const ts = _mk('span', '', r);
      ts.style.cssText = 'margin-left:auto;font-size:12px;color:#334;flex-shrink:0';
      _dom.voidTs = ts;
    }

    // ── P15 QUANT rows (Wall / StopRun / SMF) ─────────────────────
    // WALL — side | price | str | dist%
    {
      const r = _mk('div', 'row p15-wall-row', det);
      _mk('span', 'lbl', r).textContent = 'WALL';
      _dom.wallState = _mk('span', 'chip idle', r);
      _dom.wallStr = _mk('span', 'chip idle', r); _dom.wallStr.style.display = 'none';
      _dom.wallDist = _mk('span', 'chip idle', r); _dom.wallDist.style.display = 'none';
      const wts = _mk('span', '', r);
      wts.style.cssText = 'margin-left:auto;font-size:12px;color:#334;flex-shrink:0';
      _dom.wallTs = wts;
    }
    // STOP — dir | lvl | cls score
    {
      const r = _mk('div', 'row p15-stop-row', det);
      _mk('span', 'lbl', r).textContent = 'STOP';
      _dom.stopState = _mk('span', 'chip idle', r);
      _dom.stopLvl = _mk('span', 'chip idle', r); _dom.stopLvl.style.display = 'none';
      _dom.stopCls = _mk('span', 'chip idle', r); _dom.stopCls.style.display = 'none';
      const sts = _mk('span', '', r);
      sts.style.cssText = 'margin-left:auto;font-size:12px;color:#334;flex-shrink:0';
      _dom.stopTs = sts;
    }
    // SMF — bias | acc | ltr | DIV flag
    {
      const r = _mk('div', 'row p15-smf-row', det);
      _mk('span', 'lbl', r).textContent = 'SMF';
      _dom.smfState = _mk('span', 'chip idle', r);
      _dom.smfAcc = _mk('span', 'chip idle', r); _dom.smfAcc.style.display = 'none';
      _dom.smfLtr = _mk('span', 'chip idle', r); _dom.smfLtr.style.display = 'none';
      _dom.smfDiv = _mk('span', 'chip idle', r); _dom.smfDiv.style.display = 'none';
      const smts = _mk('span', '', r);
      smts.style.cssText = 'margin-left:auto;font-size:12px;color:#334;flex-shrink:0';
      _dom.smfTs = smts;
    }

    // ── Expand hint ────────────────────────────────────────────────
    _dom.expandHint = _mk('div', 'expand-hint', _hudEl);

    // Signal to P10–P14 MutationObserver _inject() functions that all rows
    // are now owned by _render() via _dom.*. Injectors must not touch them.
    window.__OF_HUD_BUILT__ = true;
    // Disconnect any observers that registered before DOM was built.
    // (P10–P14 stubs currently no-op, but the teardown is kept for safety
    //  in case any observer is re-enabled in the future.)
    (window.__OF_HUD_OBS || []).forEach(function (o) { try { o.disconnect(); } catch (_) { } });
    window.__OF_HUD_OBS = [];
  }

  // ── Render — NO innerHTML on _hudEl. textContent / className only. ─────
  // P10-P14 MutationObservers are disabled — all rows live in _buildDom() static DOM.
  // Throttle: 200ms minimum between renders (5 FPS max) to prevent repaint storms.
  let _lastRenderTs = 0;
  function _render() {
    if (!_hudEl || !_state.visible) return;
    const _now = Date.now();
    if (_now - _lastRenderTs < 200) return;
    _lastRenderTs = _now;

    if (!_dom) _buildDom();

    // Expand/collapse: toggle detail visibility without rebuilding DOM
    const detD = _state.expanded ? '' : 'none';
    if (_dom.det.style.display !== detD) _dom.det.style.display = detD;

    const d = window.OF_DEBUG_SNAPSHOT ? window.OF_DEBUG_SNAPSHOT() : null;
    if (!d) return;
    const now = Date.now();

    // Update lastSeen
    if (d.trap && d.trap.active) _lastSeen.trap = now;
    if (d.vacuum && d.vacuum.active) _lastSeen.vacuum = now;
    if (d.ice && d.ice.active) _lastSeen.ice = now;
    if (d.dFlip && d.dFlip.active) _lastSeen.flip = now;
    if (d.absExh && d.absExh.absActive) _lastSeen.abs = now;

    // ── Compact row ──────────────────────────────────────────────────
    _sc(_dom.healthChip, d.health.status, _hcls(d.health.status));
    _sc(_dom.tpsChip, d.health.tps + ' t/s', d.health.tps >= 10 ? 'ok' : 'thin');
    _sc(_dom.smpChip, 'smp ' + d.health.samples, d.health.samples >= 20 ? 'ok' : 'thin');

    if (d.debug) {
      if (_dom.dbgChip.style.display !== '') _dom.dbgChip.style.display = '';
      _sc(_dom.dbgChip, 'DBG ' + d.debugSecsLeft + 's', 'dbg-on');
    } else {
      if (_dom.dbgChip.style.display !== 'none') _dom.dbgChip.style.display = 'none';
    }

    // Active signals — write only when state actually changes
    const sigs = [
      d.trap.active ? _chip('TRAP ' + (d.trap.dir || ''), 'active') : '',
      d.vacuum.active ? _chip('VAC ' + (d.vacuum.dir || ''), 'active') : (d.vacuum.simActive ? _chip('VAC~', 'sim') : ''),
      d.ice.active ? _chip('ICE ' + (d.ice.side || ''), 'active') : (d.ice.simActive ? _chip('ICE~', 'sim') : ''),
      d.dFlip.active ? _chip('FLIP ' + (d.dFlip.dir || ''), 'active') : (d.dFlip.simActive ? _chip('FLIP~', 'sim') : ''),
      d.absExh.absActive ? _chip('ABS ' + (d.absExh.absSide || ''), 'active') : '',
    ].filter(Boolean).join('') || _chip('idle', 'idle');
    if (_dom._sigCache !== sigs) { _dom.signals.innerHTML = sigs; _dom._sigCache = sigs; }

    // FLOW chip
    {
      const fl = d.flow || {};
      const bias = typeof fl.bias === 'number' ? fl.bias : 0;
      const bPct = typeof fl.buyPct === 'number' ? fl.buyPct : 50;
      let ftxt, fcls;
      if (bias > 0.08) { ftxt = 'FLOW BUY ' + bPct.toFixed(0) + '%'; fcls = 'chip mm-flow-chip mm-flow-buy'; }
      else if (bias < -0.08) { ftxt = 'FLOW SELL ' + (100 - bPct).toFixed(0) + '%'; fcls = 'chip mm-flow-chip mm-flow-sell'; }
      else { ftxt = 'FLOW NEUT'; fcls = 'chip mm-flow-chip mm-flow-neut'; }
      if (_dom.flowChip.className !== fcls) _dom.flowChip.className = fcls;
      if (_dom.flowChip.textContent !== ftxt) _dom.flowChip.textContent = ftxt;
    }

    // ── MAGNET compact chip ─────────────────────────────────────────
    // Reads from d.magnet (P13 state) — values already computed upstream.
    // Only shows when mg.active. No new calculations here.
    {
      const mg = d.magnet || {};
      const el = _dom.magnetChip;
      if (mg.active) {
        const tgt = mg.target != null ? _fmtP(mg.target) : '—';
        const dist = mg.distance != null ? _n(mg.distance, 2) + '%' : '—';
        const str = mg.strength != null ? _n(mg.strength, 2) : '—';
        const conf = mg.conf != null ? mg.conf + '%' : '—';
        const txt = 'MAGNET t=' + tgt + ' d=' + dist + ' s=' + str + ' c=' + conf;
        // textContent only — no innerHTML, no node creation
        if (el.textContent !== txt) el.textContent = txt;
        if (!el.classList.contains('is-active')) el.classList.add('is-active');
      } else {
        if (el.classList.contains('is-active')) el.classList.remove('is-active');
        // Keep placeholder text so min-width is always exercised
        if (el.textContent !== 'MAGNET —') el.textContent = 'MAGNET —';
      }
    }

    // ── VOID compact chip ───────────────────────────────────────────
    // Reads from d['void'] (P14 state). vd.trades = n4s, vd.vol = vol4s.
    {
      const vd = d['void'] || {};
      const el = _dom.voidChip;
      if (vd.active) {
        const score = vd.voidScore != null ? _n(vd.voidScore, 2) : '—';
        const n4s = vd.trades != null ? String(vd.trades) : '—';
        const vol4s = vd.vol != null ? _fmtV(vd.vol) : '—';
        const txt = 'VOID s=' + score + ' n=' + n4s + ' v=' + vol4s;
        if (el.textContent !== txt) el.textContent = txt;
        if (!el.classList.contains('is-active')) el.classList.add('is-active');
      } else {
        if (el.classList.contains('is-active')) el.classList.remove('is-active');
        if (el.textContent !== 'VOID —') el.textContent = 'VOID —';
      }
    }

    // Expand hint
    const hint = _state.expanded ? '▲ tap to collapse' : '▼ tap to expand';
    if (_dom.expandHint.textContent !== hint) _dom.expandHint.textContent = hint;

    // ── Detail rows — only update content when visible ────────────────
    if (!_state.expanded) return;

    // REG
    {
      const regCls = typeof _regimeCls === 'function' ? _regimeCls(d.regime) : '';
      if (_dom.regTxt.className !== regCls) _dom.regTxt.className = regCls;
      if (_dom.regTxt.textContent !== (d.regime || '—')) _dom.regTxt.textContent = d.regime || '—';
      _sc(_dom.engChip, 'eng ' + ((window.CORE_STATE && window.CORE_STATE.engineStatus) || '—'), 'muted');
      _sc(_dom.dbgToggle, d.debug ? 'DBG ON' : 'DBG', d.debug ? 'dbg-on' : 'muted');
    }

    // TRAP
    {
      const t = d.trap || {}, c = _dom.trapRow.chips;
      _sc(c[0], t.active ? '●' : '○', t.active ? 'active' : 'idle'); c[0].style.display = '';
      _sw(c[1], t.dir || '', t.active ? 'active' : 'idle', !!(t.active && t.dir));
      _sw(c[2], 'CONF', 'ok', !!t.confirmed);
      _sw(c[3], 'PEND', 'thin', !!t.pending);
      _sw(c[4], 'FAIL', 'dead', !!t.fail);
      _sc(c[5], t.movePct != null ? _n(t.movePct, 3) + '%' : '—', 'muted'); c[5].style.display = '';
      _dom.trapRow.ts.textContent = _ago(_lastSeen.trap, now);
    }

    // VAC
    {
      const v = d.vacuum || {}, on = v.active || v.simActive;
      const c = _dom.vacRow.chips;
      _sc(c[0], on ? (v.simActive && !v.active ? 'SIM' : '●') : '○', on ? (v.simActive ? 'sim' : 'active') : 'idle'); c[0].style.display = '';
      _sw(c[1], v.dir || '', v.simActive ? 'sim' : 'active', !!(v.dir));
      _sc(c[2], _n(v.movePct, 3) + '%', on ? 'muted' : 'idle'); c[2].style.display = '';
      _sc(c[3], _n(v.tps, 1) + ' t/s', on ? 'muted' : 'idle'); c[3].style.display = '';
      _sc(c[4], 'vol ' + _n(v.vol, 1), on ? 'muted' : 'idle'); c[4].style.display = '';
      _dom.vacRow.ts.textContent = _ago(_lastSeen.vacuum, now);
    }

    // ICE
    {
      const i = d.ice || {}, on = i.active || i.simActive;
      const c = _dom.iceRow.chips;
      _sc(c[0], on ? (i.simActive && !i.active ? 'SIM' : '●') : '○', on ? (i.simActive ? 'sim' : 'active') : 'idle'); c[0].style.display = '';
      _sw(c[1], i.side || '', i.simActive ? 'sim' : 'active', !!(i.side));
      _sc(c[2], 'top ' + _n(i.topShare, 2), on ? 'muted' : 'idle'); c[2].style.display = '';
      _sc(c[3], 't2 ' + _n(i.top2Share, 2), on ? 'muted' : 'idle'); c[3].style.display = '';
      _dom.iceRow.ts.textContent = _ago(_lastSeen.ice, now);
    }

    // FLIP
    {
      const f = d.dFlip || {}, on = f.active || f.simActive;
      const c = _dom.flipRow.chips;
      _sc(c[0], on ? (f.simActive && !f.active ? 'SIM' : '●') : '○', on ? (f.simActive ? 'sim' : 'active') : 'idle'); c[0].style.display = '';
      _sw(c[1], f.dir || '', f.simActive ? 'sim' : 'active', !!(f.dir));
      _sc(c[2], 'prv ' + _n(f.prevDPct, 2) + '%', on ? 'muted' : 'idle'); c[2].style.display = '';
      _sc(c[3], 'cur ' + _n(f.curDPct, 2) + '%', on ? 'muted' : 'idle'); c[3].style.display = '';
      _sc(c[4], 'z ' + _n(f.z, 2), on ? 'muted' : 'idle'); c[4].style.display = '';
      _dom.flipRow.ts.textContent = _ago(_lastSeen.flip, now);
    }

    // ABS / EXH
    {
      const ae = d.absExh || {};
      _sc(_dom.absState, ae.absActive ? '●' : '○', ae.absActive ? 'active' : 'idle');
      _sw(_dom.absSide, ae.absSide || '', 'active', !!(ae.absSide));
      _sc(_dom.exhState, ae.exhSide || '—', ae.exhSide ? 'active' : 'idle');
      _sw(_dom.exhTs_, ae.exhTs ? new Date(ae.exhTs).toLocaleTimeString() : '', 'muted', !!(ae.exhTs));
      _dom.absTs.textContent = _ago(_lastSeen.abs, now);
    }

    // MMTRAP (P10)
    {
      const mm = d.mmTrap || {};
      const da = mm.dir === 1 ? '▲' : mm.dir === -1 ? '▼' : '';
      let ms, mc;
      if (mm.fired) { ms = 'FIRE' + da; mc = 'mm-fire'; }
      else if (mm.armed) { ms = 'ARMED' + da; mc = 'mm-armed'; }
      else { ms = 'IDLE'; mc = 'idle'; }
      _sc(_dom.mmtrapState, ms, mc);
      _sw(_dom.mmtrapLevel, mm.level ? 'lvl ' + Number(mm.level).toFixed(2) : '', 'muted', !!(mm.level));
      const bn = typeof mm.biasNow === 'number' ? mm.biasNow : 0;
      _sc(_dom.mmtrapBias, (bn >= 0 ? '+' : '') + (bn * 100).toFixed(1) + '%', 'muted');
      _dom.mmtrapTs.textContent = _ago(mm.ts || 0, now);
    }

    // ABSORB (P11)
    {
      const ab = d.absorb || {};
      const da = ab.dir === 1 ? '▲' : ab.dir === -1 ? '▼' : '';
      _sc(_dom.absorbState, ab.active ? 'ABSORB' + da : 'IDLE', ab.active ? (ab.dir === 1 ? 'p11-abs-buy' : 'p11-abs-sell') : 'idle');
      _sw(_dom.absorbVol, ab.vol != null ? 'vol ' + _fmtV(ab.vol) : '', ab.active ? 'muted' : 'idle', ab.active);
      _sw(_dom.absorbDelta, ab.deltaPct != null ? 'δ ' + _n(ab.deltaPct * 100, 1) + '%' : '', ab.active ? 'muted' : 'idle', ab.active);
      _sw(_dom.absorbMove, ab.priceMove != null ? 'mv ' + _n(ab.priceMove, 3) + '%' : '', ab.active ? 'muted' : 'idle', ab.active);
      _dom.absorbTs.textContent = _ago(ab.ts || 0, now);
    }

    // EXHAUST (P11)
    {
      const ex = d.exh || {};
      const da = ex.dir === 1 ? '▲' : ex.dir === -1 ? '▼' : '';
      let es, ec;
      if (ex.active) { es = 'EXH' + da; ec = ex.dir === 1 ? 'p11-exh-up' : 'p11-exh-dn'; }
      else if (ex.phase === 'armed') { es = 'ARMING' + da; ec = 'p11-armed'; }
      else { es = 'IDLE'; ec = 'idle'; }
      _sc(_dom.exhRowState, es, ec);
      const anyEx = ex.active || ex.phase === 'armed';
      _sw(_dom.exhRowMove, ex.impulseMove != null ? 'mv ' + _n(ex.impulseMove, 3) + '%' : '', 'muted', anyEx);
      _sw(_dom.exhRowTps, (ex.tpsPeak != null && ex.tpsNow != null) ? _n(ex.tpsPeak, 1) + '→' + _n(ex.tpsNow, 1) + ' t/s' : '', 'muted', anyEx);
      _dom.exhRowTs.textContent = _ago(ex.ts || ex.armTs || 0, now);
    }

    // SWEEP (P12)
    {
      const sw = d.sweep || {};
      const da = sw.dir === 1 ? '▲' : sw.dir === -1 ? '▼' : '';
      _sc(_dom.sweepState, sw.active ? 'SWEEP' + da : 'IDLE', sw.active ? (sw.dir === 1 ? 'p12-swp-up' : 'p12-swp-dn') : 'idle');
      _sw(_dom.sweepMove, sw.movePct != null ? _n(sw.movePct, 3) + '%' : '', sw.active ? 'muted' : 'idle', sw.active);
      _sw(_dom.sweepVol, sw.vol != null ? 'vol ' + _fmtV(sw.vol) : '', sw.active ? 'muted' : 'idle', sw.active);
      _sw(_dom.sweepTps, sw.tps != null ? _n(sw.tps, 1) + ' t/s' : '', sw.active ? 'muted' : 'idle', sw.active);
      _dom.sweepTs.textContent = _ago(sw.ts || 0, now);
    }

    // CASCADE (P12)
    {
      const cas = d.cascade || {};
      const da = cas.dir === 1 ? '▲' : cas.dir === -1 ? '▼' : '';
      let cs2, cc;
      if (cas.active) { cs2 = 'CASCADE' + da; cc = cas.dir === 1 ? 'p12-cas-up' : 'p12-cas-dn'; }
      else if (cas.phase === 'armed') { cs2 = 'ARMING' + da; cc = 'p12-cas-arm'; }
      else { cs2 = 'IDLE'; cc = 'idle'; }
      _sc(_dom.casState, cs2, cc);
      const anyCas = cas.active || cas.phase === 'armed';
      _sw(_dom.casTps, cas.tps != null ? _n(cas.tps, 1) + ' t/s' : '', anyCas ? 'muted' : 'idle', anyCas);
      _sw(_dom.casVol, cas.vol != null ? 'vol ' + _fmtV(cas.vol) : '', anyCas ? 'muted' : 'idle', anyCas);
      _sw(_dom.casMove, cas.move != null ? _n(cas.move, 3) + '%' : '', anyCas ? 'muted' : 'idle', anyCas);
      _dom.casTs.textContent = _ago(cas.ts || cas.armTs || 0, now);
    }

    // MAGNET (P13)
    {
      const mg = d.magnet || {};
      const da = mg.dir === 1 ? '▲' : mg.dir === -1 ? '▼' : '';
      _sc(_dom.magState, mg.active ? 'MAGNET' + da : 'IDLE', mg.active ? (mg.dir === 1 ? 'p13-mag-up' : 'p13-mag-dn') : 'idle');
      _sw(_dom.magTarget, mg.target != null ? '→ ' + _fmtP(mg.target) : '', 'muted', mg.active);
      _sw(_dom.magDist, mg.distance != null ? _n(mg.distance, 3) + '%' : '', 'muted', mg.active);
      _sw(_dom.magStr, mg.strength != null ? 'str×' + _n(mg.strength, 2) : '', 'muted', mg.active);
      _sw(_dom.magConf, mg.conf != null ? 'conf ' + mg.conf + '%' : '', 'p13-conf', mg.active);
      _dom.magTs.textContent = _ago(mg.ts || 0, now);
    }

    // VOID (P14)
    {
      const vd = d['void'] || {};
      const da = vd.dir === 1 ? '▲' : vd.dir === -1 ? '▼' : '?';
      _sc(_dom.voidState, vd.active ? 'VOID ' + da : 'IDLE',
        vd.active ? (vd.dir === 1 ? 'p14-voi-up' : vd.dir === -1 ? 'p14-voi-dn' : 'p14-voi-un') : 'idle');
      _sw(_dom.voidScore, vd.voidScore != null ? 'score ' + _n(vd.voidScore, 2) : '', vd.active ? 'p14-score' : 'idle', vd.active);
      _sw(_dom.voidTrades, vd.trades != null ? vd.trades + ' tr' : '', vd.active ? 'muted' : 'idle', vd.active);
      _sw(_dom.voidVol, vd.vol != null ? 'vol ' + _fmtV(vd.vol) : '', vd.active ? 'muted' : 'idle', vd.active);
      _sw(_dom.voidMove, vd.move != null ? _n(vd.move, 3) + '%' : '', vd.active ? 'muted' : 'idle', vd.active);
      _dom.voidTs.textContent = _ago(vd.ts || 0, now);
    }

    // ── P15 QUANT — read from window.OF.quant (written by P15 module) ──
    // Entire block wrapped in try/catch — any throw is silenced, never reaches window.onerror.
    try {
      const QT = (window.OF && window.OF.quant) || {};

      // Pulse helper — fires once on IDLE→ACTIVE, auto-removes class after 250ms
      // _dom._qPrev stores last active state per chip key to detect transitions
      if (!_dom._qPrev) _dom._qPrev = { wall: false, stop: false, smf: false };
      function _qPulse(el, isActive, key) {
        if (isActive && !_dom._qPrev[key]) {
          el.classList.add('q-pulse');
          setTimeout(function () { if (el) el.classList.remove('q-pulse'); }, 260);
        }
        _dom._qPrev[key] = isActive;
      }

      // WALL
      {
        const w = QT.wall || {};
        const active = !!w.wallSide && !w.stale;
        const sideCls = w.wallSide === 'BID' ? 'q-wall-bid' : w.wallSide === 'ASK' ? 'q-wall-ask' : 'q-wall-idle';
        const stateT = w.wallSide
          ? 'WALL ' + w.wallSide + (w.wallPrice != null ? ' ' + _fmtP(w.wallPrice) : '')
          : 'IDLE';
        _sc(_dom.wallState, stateT, active ? sideCls : 'q-wall-idle');
        _sw(_dom.wallStr, w.wallStrength != null ? 'str ' + _n(w.wallStrength, 2) : '', active ? sideCls : 'idle', active);
        _sw(_dom.wallDist, w.wallPct != null ? 'd ' + _n(w.wallPct, 2) + '%' : '', 'muted', active);
        _dom.wallTs.textContent = w.ts ? _ago(w.ts, now) : (w.reason ? '[' + w.reason + ']' : '—');
        _qPulse(_dom.wallState, active, 'wall');
      }

      // STOP RUN
      {
        const sr = QT.stopRun || {};
        const cls = sr.cls || 0;
        const hasUp = (sr.probUp || 0) >= 0.4;
        const hasDn = (sr.probDn || 0) >= 0.4;
        const active = hasUp || hasDn;
        let stT, stCls;
        if (hasUp && (!hasDn || sr.probUp >= sr.probDn)) {
          stT = 'STOP ▲' + Math.round((sr.probUp || 0) * 100) + '%';
          stCls = 'q-stop-up';
        } else if (hasDn) {
          stT = 'STOP ▼' + Math.round((sr.probDn || 0) * 100) + '%';
          stCls = 'q-stop-dn';
        } else {
          stT = 'IDLE'; stCls = 'idle';
        }
        _sc(_dom.stopState, stT, stCls);
        const lvl = hasUp ? sr.lvlUp : hasDn ? sr.lvlDn : null;
        _sw(_dom.stopLvl, lvl != null ? 'lvl ' + _fmtP(lvl) : '', 'muted', active);
        _sw(_dom.stopCls, active ? 'cls ' + _n(cls, 2) : '', 'muted', active);
        _dom.stopTs.textContent = sr.ts ? _ago(sr.ts, now) : (sr.reason ? '[' + sr.reason + ']' : '—');
        _qPulse(_dom.stopState, active, 'stop');
      }

      // SMF
      {
        const sf = QT.smf || {};
        const bias = sf.footprintBias || 'NEUT';
        const active = bias !== 'NEUT';
        const bCls = bias === 'BUY' ? 'q-smf-buy' : bias === 'SELL' ? 'q-smf-sell' : 'idle';
        _sc(_dom.smfState, bias, active ? bCls : 'idle');
        _sw(_dom.smfAcc, sf.accumScore != null ? 'acc ' + _n(sf.accumScore, 2) : '', 'muted', active);
        _sw(_dom.smfLtr, sf.ltr != null ? 'ltr ' + _n(sf.ltr, 2) : '', 'muted', active);
        _sw(_dom.smfDiv, sf.divergence ? 'ΔDIV' : '', 'q-smf-div', !!sf.divergence);
        _dom.smfTs.textContent = sf.ts ? _ago(sf.ts, now) : (sf.reason ? '[' + sf.reason + ']' : '—');
        _qPulse(_dom.smfState, active, 'smf');
      }
    } catch (_qErr) { /* QUANT render: silenced — never reaches window.onerror */ }
  }

  // ── Toggle expand on HUD click ────────────────────────────────────
  function _onClick(e) {
    if (e.target.classList.contains('hdr-close')) return;
    _state.expanded = !_state.expanded;
    try { localStorage.setItem(LS_KEY, JSON.stringify(_state)); } catch (_) { }
    if (typeof _ucMarkDirty === 'function') _ucMarkDirty('ofHud');
    if (typeof _userCtxPush === 'function') _userCtxPush();
    _render();
  }

  // ── Position persistence ──────────────────────────────────────────
  const POS_KEY = 'of_hud_pos_v1';

  function _loadPos() {
    try {
      const p = JSON.parse(localStorage.getItem(POS_KEY));
      if (p && Number.isFinite(p.top) && Number.isFinite(p.left)) return p;
    } catch (_) { }
    return null;
  }

  function _applyPos(el, p) {
    el.style.top = p.top + 'px';
    el.style.left = p.left + 'px';
    el.style.right = 'auto';   // critical: cancel right:120px
  }

  // ── DBG toggle ───────────────────────────────────────────────────
  window.ofHudDebugToggle = function () {
    _state.debug = !_state.debug;
    _state.debugUntil = _state.debug ? Date.now() + 60000 : 0;
    try { localStorage.setItem(LS_KEY, JSON.stringify(_state)); } catch (_) { }
    if (typeof _ucMarkDirty === 'function') _ucMarkDirty('ofHud');
    if (typeof _userCtxPush === 'function') _userCtxPush();
    _render();
    console.log('[HUD] DBG mode', _state.debug ? 'ON (60s)' : 'OFF');
  };

  // ── Anchor drag (X-axis in top bar) ──────────────────────────────
  const ANCH_POS_KEY = 'of_hud_anchor_x_v1';
  let _anchDragTimer = null, _anchDragging = false, _anchStartX = 0, _anchOrigLeft = 0;

  function _initAnchorDrag(anchor) {
    // Restore saved X
    try {
      const ax = parseInt(localStorage.getItem(ANCH_POS_KEY));
      if (Number.isFinite(ax)) { anchor.style.left = ax + 'px'; anchor.style.right = 'auto'; }
    } catch (_) { }

    anchor.addEventListener('pointerdown', function (e) {
      const rect = anchor.getBoundingClientRect();
      _anchStartX = e.clientX;
      _anchOrigLeft = rect.left;
      _anchDragTimer = setTimeout(function () {
        _anchDragTimer = null;
        _anchDragging = true;
        anchor.style.cursor = 'grabbing';
        anchor.style.right = 'auto';
        anchor.style.opacity = '0.75';
      }, 300);
    });

    document.addEventListener('pointermove', function (e) {
      if (!_anchDragging) return;
      const anc = document.getElementById('of-hud-anchor');
      if (!anc) return;
      const newLeft = Math.max(4, Math.min(window.innerWidth - 40, _anchOrigLeft + (e.clientX - _anchStartX)));
      anc.style.left = newLeft + 'px';
    });

    document.addEventListener('pointerup', function (e) {
      if (_anchDragTimer) { clearTimeout(_anchDragTimer); _anchDragTimer = null; }
      if (!_anchDragging) return;
      _anchDragging = false;
      const anc = document.getElementById('of-hud-anchor');
      if (!anc) return;
      anc.style.cursor = 'pointer';
      anc.style.opacity = '1';
      try { localStorage.setItem(ANCH_POS_KEY, String(parseInt(anc.style.left))); } catch (_) { }
      if (typeof _ucMarkDirty === 'function') _ucMarkDirty('ofHud');
      if (typeof _userCtxPush === 'function') _userCtxPush();
    });
  }

  window.ofHudResetPos = function () {
    try { localStorage.removeItem(POS_KEY); } catch (_) { }
    if (!_hudEl) return;
    _hudEl.style.removeProperty('top');
    _hudEl.style.removeProperty('left');
    _hudEl.style.removeProperty('right');
    _hudEl.style.cssText = _hudEl.style.cssText; // flush
    // Restore CSS defaults
    _hudEl.style.top = '96px';
    _hudEl.style.right = '120px';
    _hudEl.style.left = '';
    console.log('[HUD] position reset to default');
  };

  // ── Drag ──────────────────────────────────────────────────────────
  const SNAP_MARGIN = 32;   // px from edge to snap
  const DRAG_DELAY = 250;  // ms long-press threshold

  let _drag = { active: false, startX: 0, startY: 0, origTop: 0, origLeft: 0 };
  let _dragTimer = null;

  const SNAP_CORNERS = [
    { top: 10, getLeft: (w) => 10 },
    { top: 10, getLeft: (w) => window.innerWidth - w - 10 },
    { top: (h) => window.innerHeight - h - 10, getLeft: (w) => 10 },
    { top: (h) => window.innerHeight - h - 10, getLeft: (w) => window.innerWidth - w - 10 },
  ];

  function _nearSnap(top, left) {
    const r = _hudEl.getBoundingClientRect();
    for (const c of SNAP_CORNERS) {
      const cTop = typeof c.top === 'function' ? c.top(r.height) : c.top;
      const cLeft = typeof c.getLeft === 'function' ? c.getLeft(r.width) : c.getLeft;
      if (Math.abs(top - cTop) < SNAP_MARGIN && Math.abs(left - cLeft) < SNAP_MARGIN)
        return { top: cTop, left: cLeft };
    }
    return null;
  }

  function _onDragMove(e) {
    if (!_drag.active) return;
    const cx = e.clientX ?? (e.touches && e.touches[0].clientX) ?? 0;
    const cy = e.clientY ?? (e.touches && e.touches[0].clientY) ?? 0;
    const r = _hudEl.getBoundingClientRect();
    const M = 8;
    let newTop = _drag.origTop + (cy - _drag.startY);
    let newLeft = _drag.origLeft + (cx - _drag.startX);
    // Clamp to viewport
    newTop = Math.max(M, Math.min(window.innerHeight - r.height - M, newTop));
    newLeft = Math.max(M, Math.min(window.innerWidth - r.width - M, newLeft));
    // Snap glow
    const snap = _nearSnap(newTop, newLeft);
    _hudEl.classList.toggle('snap-glow', !!snap);
    _applyPos(_hudEl, snap || { top: newTop, left: newLeft });
  }

  function _onDragEnd(e) {
    if (_dragTimer) { clearTimeout(_dragTimer); _dragTimer = null; }
    if (!_drag.active) return;
    _drag.active = false;
    _hudEl.classList.remove('dragging', 'snap-glow');
    document.removeEventListener('pointermove', _onDragMove);
    document.removeEventListener('pointerup', _onDragEnd);
    const r = _hudEl.getBoundingClientRect();
    const pos = { top: r.top, left: r.left };
    try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (_) { }
    if (typeof _ucMarkDirty === 'function') _ucMarkDirty('ofHud');
    if (typeof _userCtxPush === 'function') _userCtxPush();
    console.log('[HUD] pos saved', pos);
  }

  function _onPointerDown(e) {
    if (e.target.closest('.hdr-close')) return;   // don't drag on close btn
    const r = _hudEl.getBoundingClientRect();
    const sTop = r.top;
    const sLeft = r.left;
    const sx = e.clientX;
    const sy = e.clientY;
    _dragTimer = setTimeout(function () {
      _dragTimer = null;
      _drag = { active: true, startX: sx, startY: sy, origTop: sTop, origLeft: sLeft };
      _hudEl.classList.add('dragging');
      _hudEl.style.right = 'auto';
      document.addEventListener('pointermove', _onDragMove);
      document.addEventListener('pointerup', _onDragEnd);
    }, DRAG_DELAY);
  }

  function _onPointerUp(e) {
    if (_dragTimer) { clearTimeout(_dragTimer); _dragTimer = null; }
    // if not dragging => normal click => expand/collapse
    if (!_drag.active) _onClick(e);
  }

  // ── Create DOM ────────────────────────────────────────────────────
  function _create() {
    if (_hudEl) return;
    _hudEl = document.createElement('div');
    _hudEl.id = 'of-hud';
    _hudEl.addEventListener('pointerdown', _onPointerDown);
    _hudEl.addEventListener('pointerup', _onPointerUp);
    var mount = document.getElementById('flow-panel-body') || document.body;
    mount.appendChild(_hudEl);
  }

  // ── Public toggle (kept for backward compat — now just expand/collapse) ─
  window.ofHudToggle = function () {
    _state.visible = !_state.visible;
    try { localStorage.setItem(LS_KEY, JSON.stringify(_state)); } catch (_) { }
    if (typeof _ucMarkDirty === 'function') _ucMarkDirty('ofHud');
    if (typeof _userCtxPush === 'function') _userCtxPush();
    if (!_hudEl) _create();
    _hudEl.classList.toggle('hidden', !_state.visible);
    if (_state.visible) {
      if (!_interval) _interval = Intervals.set('of_hud', _render, 1000);
      _render();
    } else {
      Intervals.clear('of_hud'); _interval = null;
    }
  };

  // ── FLOW panel expand/collapse (called from panel header onclick) ──
  window.flowPanelToggle = function () {
    var panel = document.getElementById('flow-panel');
    if (!panel) return;
    var isCollapsed = panel.classList.contains('collapsed');
    panel.classList.toggle('collapsed', !isCollapsed);
    panel.classList.toggle('expanded', isCollapsed);
    var chev = document.getElementById('flow-panel-chev');
    if (chev) chev.textContent = isCollapsed ? '▲' : '▼';
    // Ensure HUD is running when expanded
    if (isCollapsed) {
      _state.visible = true;
      try { localStorage.setItem(LS_KEY, JSON.stringify(_state)); } catch (_) { }
      if (typeof _ucMarkDirty === 'function') _ucMarkDirty('ofHud');
      if (typeof _userCtxPush === 'function') _userCtxPush();
      if (!_hudEl) _create();
      _hudEl.classList.remove('hidden');
      if (!_interval) _interval = Intervals.set('of_hud', _render, 1000);
      _render();
    }
  };

  // ── Init ──────────────────────────────────────────────────────────
  function _init() {
    _create();
    // Always start visible — panel is inline, not a popup
    _state.visible = true;
    _hudEl.classList.remove('hidden');
    _interval = Intervals.set('of_hud', _render, 1000);
    _render();
    try { if (typeof ZLOG !== 'undefined') ZLOG.push('INFO', '[OF HUD v2] ready — FLOW panel mounted'); } catch (_) { }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init);
  else _init();
})();

// ╔══════════════════════════════════════════════════════════════════╗
// ║  ZEUS ORDERFLOW v121 — PAS 6: Health Badge UI                   ║
// ║  OF:OK / OF:THIN / OF:DEAD — watch-only, informational only.    ║
// ╚══════════════════════════════════════════════════════════════════╝
(function () {
  if (window.__ZEUS_OF_P6__) return;
  window.__ZEUS_OF_P6__ = true;

  const RATE_OK = 10;   // trades/sec threshold for OK
  const UPDATE_MS = 2000; // badge refresh interval

  let _lastBufLen = 0;
  let _lastCheckTs = Date.now();

  function _wsAlive() {
    try {
      // Primary: check WS manager slot
      if (window.WS && typeof window.WS.isOpen === 'function') return window.WS.isOpen('of_agg');
      // Fallback: check RAW_FLOW had recent data
      const RF = window.RAW_FLOW;
      if (!RF || !RF.buf || !RF.buf.length) return false;
      return (Date.now() - RF.buf[RF.buf.length - 1].ts) < 5000;
    } catch (_) { return false; }
  }

  function _tradesPerSec() {
    try {
      const RF = window.RAW_FLOW;
      if (!RF || !RF.buf) return 0;
      const now = Date.now();
      const dt = Math.max(0.001, (now - _lastCheckTs) / 1000);
      const cur = RF.buf.length;
      // Trades added since last check divided by elapsed seconds
      // Use window size as denominator when buf is at steady state
      const windowSec = RF.windowMs / 1000;  // 10s
      // Count trades in last 5s for a tighter rate estimate
      const cut5 = now - 5000;
      let cnt = 0;
      for (let i = RF.buf.length - 1; i >= 0; i--) {
        if (RF.buf[i].ts >= cut5) cnt++;
        else break;
      }
      return cnt / 5;  // per-second rate over last 5s
    } catch (_) { return 0; }
  }

  function _updateBadge() {
    try {
      if (document.hidden) return; // [PERF] skip DOM badge when tab hidden
      // Gate: respect S.overlays.oflow
      const el = document.getElementById('of-health-badge');
      if (!el) return;

      const oflowEnabled = window.S && window.S.overlays && window.S.overlays.oflow;
      if (!oflowEnabled) {
        el.style.display = 'none';
        return;
      }

      el.style.display = '';
      const alive = _wsAlive();
      const tps = _tradesPerSec();

      let cls, label;
      if (!alive) {
        cls = 'dead';
        label = 'FLOW:DEAD';
      } else if (tps < RATE_OK) {
        cls = 'thin';
        label = 'FLOW:THIN';
      } else {
        cls = 'ok';
        label = 'FLOW:OK';
      }

      el.className = 'of-badge ' + cls;
      el.textContent = label;
      el.title = 'Orderflow: WS=' + (alive ? 'connected' : 'disconnected') +
        ' | ' + tps.toFixed(1) + ' trades/s';

      _lastCheckTs = Date.now();
    } catch (e) { /* badge must never throw */ }
  }

  // ── Expose toggle helper (for settings panel or console) ─────────
  window.toggleOFlowBadge = function () {
    if (!window.S || !window.S.overlays) return;
    window.S.overlays.oflow = !window.S.overlays.oflow;
    _updateBadge();
  };

  // ── Start update loop ─────────────────────────────────────────────
  function _start() {
    // Enable badge by default — user can toggle via S.overlays.oflow
    if (window.S && window.S.overlays) window.S.overlays.oflow = true;
    Intervals.set('of_p6_badge', _updateBadge, UPDATE_MS);
    _updateBadge();  // immediate first render
    try { if (typeof ZLOG !== 'undefined') ZLOG.push('INFO', '[OF v121 P6] health badge active (refresh=' + UPDATE_MS + 'ms)'); } catch (_) { }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(_start, 1300); });
  } else {
    setTimeout(_start, 1300);
  }
})();


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ZEUS ORDERFLOW v121 — PAS 7: TRAP DETECTOR                     ║
// ║  absorb → exhaust → reversal = TRAP. Watch-only. No exec.       ║
// ╚══════════════════════════════════════════════════════════════════╝
(function () {
  if (window.__ZEUS_OF_P7__) return;
  window.__ZEUS_OF_P7__ = true;

  const T_REVERSAL_MS = 10000;  // reversal must happen within 10s of exhaust
  const T_TRAP_TTL_MS = 10000;  // trap auto-resets after 10s

  // [CF] Continuation Failure filter constants
  const CF_CONFIRM_MS = 3000;   // window to see follow-through
  const CF_FOLLOW_PCT = 0.02;   // min move % to confirm
  const CF_REVERT_PCT = 0.015;  // revert % → fake trap
  const TRAP_COOLDOWN_MS = 5000;   // cooldown after rejected trap
  const T_Z_MIN = 2.0;    // abs(z) minimum at exhaust time
  const T_PRICE_MOVE = 0.03;   // min price move % to confirm reversal

  // State machine: idle → absorb_seen → exhaust_seen → trapped
  let _state = 'idle';
  let _exhaustTs = null;    // when exhaust was detected
  let _exhaustSide = null;    // absorb side at exhaust time ('BUY'|'SELL')
  let _exhaustPrice = null;    // price at exhaust
  let _exhaustZ = null;

  window.OF = window.OF || {};
  window.OF.trap = { active: false };

  function _log(msg, meta) {
    try { if (typeof ZLOG !== 'undefined') ZLOG.push('AT', msg, meta); } catch (_) { }
  }

  function _reset(reason) {
    _state = 'idle';
    _exhaustTs = null;
    _exhaustSide = null;
    _exhaustPrice = null;
    _exhaustZ = null;
    if (window.OF) window.OF.trap = {
      active: false, pendingConfirm: false, confirmUntilTs: 0,
      followOk: false, fail: false, confirmed: false, cooldownUntil: 0, _cdLoggedEnd: false
    };;
  }

  function _tick() {
    const OF = window.OF;
    if (!OF || !OF.quality || !OF.quality.burned) return;

    // [CF] Cooldown END edge-log (once only)
    if (OF.trap && OF.trap.cooldownUntil && now >= OF.trap.cooldownUntil && !OF.trap._cdLoggedEnd) {
      OF.trap._cdLoggedEnd = true;
      _log('[OF] TRAP COOLDOWN END', { sym: OF.sym });
    }

    const abs = OF.abs || {};
    const exhaust = OF.exhaust || null;
    const z = OF.z || 0;
    const now = Date.now();
    const price = (window.S && window.S.price) || 0;

    // ── Expire active trap ────────────────────────────────────────
    if (OF.trap && OF.trap.active && (now - OF.trap.ts) >= T_TRAP_TTL_MS) {
      _reset('ttl_expired');
      return;
    }

    // ── State machine ─────────────────────────────────────────────
    switch (_state) {

      case 'idle':
        // Wait for active absorb
        if (abs.active) _state = 'absorb_seen';
        break;

      case 'absorb_seen':
        if (!abs.active) {
          // Absorb died without exhaust → back to idle
          _reset('absorb_died_no_exhaust');
          break;
        }
        // Watch for exhaust
        if (exhaust && exhaust.ts && (now - exhaust.ts) < 3000) {
          // Exhaust just fired — check z condition
          if (Math.abs(z) >= T_Z_MIN) {
            _state = 'exhaust_seen';
            _exhaustTs = exhaust.ts;
            _exhaustSide = exhaust.side;   // 'BUY' or 'SELL'
            _exhaustPrice = price;
            _exhaustZ = z;
          }
          // If z too low → ignore this exhaust, stay in absorb_seen
        }
        break;

      case 'exhaust_seen':
        // Window expired without reversal → reset
        if ((now - _exhaustTs) > T_REVERSAL_MS) {
          _reset('reversal_window_expired');
          break;
        }
        // [CF] Cooldown guard — skip if recent trap was rejected
        if (OF.trap && OF.trap.cooldownUntil && now < OF.trap.cooldownUntil) break;

        // Check for reversal: price moves OPPOSITE to absorb side
        if (_exhaustPrice && price > 0) {
          const pChg = (price - _exhaustPrice) / _exhaustPrice * 100;
          // absorb BUY → institution was absorbing sells → expect SHORT trap (price drops)
          // absorb SELL → institution was absorbing buys  → expect LONG  trap (price rises)
          const isReversal =
            (_exhaustSide === 'BUY' && pChg <= -T_PRICE_MOVE) ||
            (_exhaustSide === 'SELL' && pChg >= T_PRICE_MOVE);

          if (isReversal) {
            // TRAP confirmed
            const dir = _exhaustSide === 'BUY' ? 'SHORT' : 'LONG';
            OF.trap = {
              active: true,
              dir,
              ts: now,
              price,
              reason: 'absorb→exhaust→reversal',
              absorbSide: _exhaustSide,
              exhaustZ: _exhaustZ,
              priceMovePct: pChg,
              // [CF] Continuation Failure fields
              pendingConfirm: true,
              confirmUntilTs: now + CF_CONFIRM_MS,
              followOk: false,
              fail: false,
              confirmed: false,
            };
            _log('[OF] TRAP SET dir=' + dir +
              ' price=' + price.toFixed(2) +
              ' z=' + (_exhaustZ || 0).toFixed(2) +
              ' dPct=' + (OF.deltaPct || 0).toFixed(2) + '%' +
              ' reason=absorb→exhaust→reversal',
              { dir, price, z: _exhaustZ, deltaPct: OF.deltaPct, pChg }
            );
            _state = 'trapped';
          }
        }
        break;

      case 'trapped':
        // [CF] Continuation Failure: confirm or reject trap
        if (OF.trap && OF.trap.pendingConfirm) {
          const curPrice = (window.S && window.S.price) || price;
          const trapPrice = (OF.trap.price > 0) ? OF.trap.price : curPrice;  // [CF] locked at trap-set time
          const movePct = trapPrice > 0 ? (curPrice - trapPrice) / trapPrice * 100 : 0;
          const dir = OF.trap.dir;
          let followOk = false, fail = false;

          if (dir === 'LONG') {
            if (movePct >= CF_FOLLOW_PCT) followOk = true;
            if (movePct <= -CF_REVERT_PCT) fail = true;
          } else {  // SHORT
            if (movePct <= -CF_FOLLOW_PCT) followOk = true;
            if (movePct >= CF_REVERT_PCT) fail = true;
          }

          if (followOk) {
            OF.trap.followOk = true;
            OF.trap.pendingConfirm = false;
            OF.trap.confirmed = true;
            _log('[OF] TRAP CONFIRMED dir=' + dir +
              ' movePct=' + movePct.toFixed(3) + '%',
              { dir, movePct, trapPrice, curPrice });
          } else if (fail) {
            OF.trap.fail = true;
            OF.trap.pendingConfirm = false;
            OF.trap.active = false;
            OF.trap.reason += '|contFail';
            OF.trap.cooldownUntil = now + TRAP_COOLDOWN_MS;
            _log('[OF] TRAP REJECTED dir=' + dir + ' kind=contFail' +
              ' movePct=' + movePct.toFixed(3) + '%',
              { dir, kind: 'contFail', movePct, trapPrice, curPrice });
            _log('[OF] TRAP COOLDOWN START ms=' + TRAP_COOLDOWN_MS + ' until=' + OF.trap.cooldownUntil,
              { cooldownUntil: OF.trap.cooldownUntil });
            OF.trap._cdLoggedEnd = false;
            _state = 'idle';
          } else if (now > OF.trap.confirmUntilTs) {
            OF.trap.active = false;
            OF.trap.pendingConfirm = false;
            OF.trap.reason += '|noFollow';
            OF.trap.cooldownUntil = now + TRAP_COOLDOWN_MS;
            _log('[OF] TRAP REJECTED dir=' + dir + ' kind=noFollow' +
              ' movePct=' + movePct.toFixed(3) + '%',
              { dir, kind: 'noFollow', movePct, trapPrice, curPrice });
            _log('[OF] TRAP COOLDOWN START ms=' + TRAP_COOLDOWN_MS + ' until=' + OF.trap.cooldownUntil,
              { cooldownUntil: OF.trap.cooldownUntil });
            OF.trap._cdLoggedEnd = false;
            _state = 'idle';
          }
        }
        break;
    }
  }

  // ── Symbol change reset ───────────────────────────────────────────
  const _prevSS7 = window.setSymbol;
  window.setSymbol = function (sym) {
    if (typeof _prevSS7 === 'function') _prevSS7(sym);
    try { _reset('symbol_change'); } catch (_) { }
  };

  function _start() {
    Intervals.set('of_p7_trap', _tick, 1000);
    try { if (typeof ZLOG !== 'undefined') ZLOG.push('INFO', '[OF v121 P7] trap detector started'); } catch (_) { }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(_start, 1400); });
  } else {
    setTimeout(_start, 1400);
  }
})();


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ZEUS ORDERFLOW v121 — PAS 8: Engine State Label                ║
// ║  Maps OF state → CORE_STATE.engineStatus. UI only. No exec.     ║
// ╚══════════════════════════════════════════════════════════════════╝
(function () {
  if (window.__ZEUS_OF_P8__) return;
  window.__ZEUS_OF_P8__ = true;

  // Map: OF state → engineStatus string
  function _resolveStatus() {
    try {
      const OF = window.OF;
      if (!OF || !OF.quality || !OF.quality.burned) return null; // burn-in — don't overwrite
      if (OF.trap && OF.trap.active) return 'TRAP_MODE';
      if (OF.abs && OF.abs.active) return 'HUNT';
      return 'NORMAL';
    } catch (_) { return null; }
  }

  function _tick() {
    try {
      const status = _resolveStatus();
      if (status === null) return;  // not ready — leave existing value

      // Write to CORE_STATE (single source of truth)
      if (window.CORE_STATE) window.CORE_STATE.engineStatus = status;

      if (document.hidden) return; // [PERF] skip DOM write when tab hidden
      // Update UI label if present (non-blocking)
      const el = document.getElementById('engineStatusLbl');
      if (el) el.textContent = status;
    } catch (_) { }
  }

  // Symbol change → back to NORMAL immediately
  const _prevSS8 = window.setSymbol;
  window.setSymbol = function (sym) {
    if (typeof _prevSS8 === 'function') _prevSS8(sym);
    try {
      if (window.CORE_STATE) window.CORE_STATE.engineStatus = 'NORMAL';
    } catch (_) { }
  };

  function _start() {
    Intervals.set('of_p8_state', _tick, 1000);
    try { if (typeof ZLOG !== 'undefined') ZLOG.push('INFO', '[OF v121 P8] engine state label active'); } catch (_) { }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(_start, 1500); });
  } else {
    setTimeout(_start, 1500);
  }
})();


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ZEUS ORDERFLOW v121 — PAS 9: Decision Packet integration        ║
// ║  Adds dp.of to buildDiagSnapshot. Watch-only telemetry.          ║
// ╚══════════════════════════════════════════════════════════════════╝
(function () {
  if (window.__ZEUS_OF_P9__) return;
  window.__ZEUS_OF_P9__ = true;

  let _dpReadyLogged = false;   // edge-trigger: log once when OF becomes ready

  // ── Build dp.of snapshot (safe, never throws) ─────────────────────
  function _buildOFSnap() {
    try {
      const OF = window.OF || {};
      const RF = window.RAW_FLOW || {};
      const cs = window.CORE_STATE || {};

      // Not burned yet → minimal stub
      if (!OF.quality || !OF.quality.burned) return { ready: false };

      // Health: derive from badge logic (same thresholds as P6)
      let health = 'DEAD';
      try {
        const alive = window.WS && typeof window.WS.isOpen === 'function'
          ? window.WS.isOpen('of_agg')
          : (RF.buf && RF.buf.length && (Date.now() - RF.buf[RF.buf.length - 1].ts) < 5000);
        if (alive) {
          // tps over last 5s
          const now = Date.now(); const cut5 = now - 5000; let cnt = 0;
          if (RF.buf) for (let i = RF.buf.length - 1; i >= 0; i--) { if (RF.buf[i].ts >= cut5) cnt++; else break; }
          const tps5s = cnt / 5;
          health = tps5s >= 10 ? 'OK' : 'THIN';
        }
      } catch (_) { }

      const abs = OF.abs || {};
      const exhaust = OF.exhaust || {};
      const trap = OF.trap || {};
      const q = OF.quality || {};

      // Edge-trigger log when first ready
      if (!_dpReadyLogged) {
        _dpReadyLogged = true;
        try {
          if (typeof ZLOG !== 'undefined') ZLOG.push('INFO',
            '[OF v121 P9] dp.of ready — samples=' + q.samples + ' health=' + health);
        } catch (_) { }
      }

      return {
        ready: true,
        health,
        deltaPct: OF.deltaPct ?? null,
        deltaVel: OF.deltaVel ?? null,
        z: OF.z ?? null,
        instAct: !!(OF.flags && OF.flags.instAct),
        absActive: !!abs.active,
        absSide: abs.side || null,
        absPeakDeltaPct: abs.peakDeltaPct ?? null,
        exhaust: !!(exhaust && exhaust.ts),
        exhaustSide: exhaust.side || null,
        exhaustStrength: exhaust.strength ?? null,
        trapActive: !!trap.active,
        trapDir: trap.dir || null,
        trapReason: trap.reason || null,
        trapPriceMovePct: trap.priceMovePct ?? null,
        engineStatus: cs.engineStatus || null,
        vacuum: (function (v) { return { active: !!v.active, dir: v.dir || null, movePct: v.movePct ?? null, tps: v.tps ?? null, vol: v.vol ?? null, ts: v.ts || null }; })(OF.vacuum || {}),
        dFlip: (function (d) { return { active: !!d.active, dir: d.dir || null, prevDeltaPct: d.prevDeltaPct ?? null, curDeltaPct: d.curDeltaPct ?? null, z: d.z ?? null, priceMovePct: d.priceMovePct ?? null, ts: d.ts || null }; })(OF.dFlip || {}),
        ice: (function (i) { return { active: !!i.active, side: i.side || null, tps: i.tps ?? null, vol: i.vol ?? null, priceMovePct: i.priceMovePct ?? null, sliceDeltaPct: i.sliceDeltaPct ?? null, topShare: i.topShare ?? null, top2Share: i.top2Share ?? null, ts: i.ts || null }; })(OF.ice || {}),
        quality: {
          samples: q.samples ?? null,
          burned: q.burned ?? false,
          dropped: RF.dropped ?? 0,
          priceAgeMs: q.priceAgeMs ?? null,
          priceChangePct5s: q.priceChangePct5s ?? null,
        }
      };
    } catch (e) {
      return { ready: false, snapError: String(e && e.message || e) };
    }
  }

  // ── Wrap buildDiagSnapshot to inject dp.of ────────────────────────
  // Wait until buildDiagSnapshot exists (it's defined inside a IIFE above)
  function _patchSnap() {
    const _orig = window.buildDiagSnapshot;
    if (typeof _orig !== 'function') return false;
    window.buildDiagSnapshot = function () {
      const snap = _orig();
      try { snap.of = _buildOFSnap(); } catch (_) { }
      return snap;
    };
    try { if (typeof ZLOG !== 'undefined') ZLOG.push('INFO', '[OF v121 P9] buildDiagSnapshot patched with dp.of'); } catch (_) { }
    return true;
  }

  function _start() {
    if (!_patchSnap()) {
      // Retry up to 5s if buildDiagSnapshot not yet defined
      let retries = 0;
      const t = setInterval(function () {
        if (_patchSnap() || ++retries >= 10) clearInterval(t);
      }, 500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(_start, 1600); });
  } else {
    setTimeout(_start, 1600);
  }
})();

// ╔══════════════════════════════════════════════════════════════════╗
// ║  ZEUS ORDERFLOW v121 — PAS 10: FLOW BIAS + MM TRAP DETECTOR     ║
// ║  A) Rolling buy/sell flow bias (8s window) → HUD chip           ║
// ║  B) Fake breakout + reversal detector → ARMED / FIRE states     ║
// ║  Watch-only. No exec. No new data sources. Single interval.     ║
// ╚══════════════════════════════════════════════════════════════════╝
(function () {
  if (window.__ZEUS_OF_MMTRAP__) return;
  window.__ZEUS_OF_MMTRAP__ = true;

  // ── Config ──────────────────────────────────────────────────────────
  const FLOW_WIN_MS = 8000;   // A: rolling window for bias computation
  const BREAK_PCT = 0.0004; // B: 0.04% — price must exceed hi30/lo30 by this to arm
  const RECLAIM_PCT = 0.0002; // B: 0.02% — price must cross back through level by this to fire
  const ARM_TTL_MS = 6000;   // B: armed state auto-resets after 6s
  const FIRE_TTL_MS = 2000;   // B: FIRE display duration
  const COOLDOWN_MS = 8000;   // B: cooldown after FIRE or TTL expiry
  const PRICE_WIN_MS = 30000;  // B: hi30/lo30 computation window
  const MIN_MOVE_PCT = 0.05;   // B: abs(priceMovePct_2s) >= 0.05% to arm
  const BIAS_NO_CONFIRM = 0.05;   // B: flow.bias within ±0.05 = "not confirming"
  const BIAS_FLIP_THRESH = 0.10;   // B: bias must flip beyond ±0.10 to fire

  // ── State init ──────────────────────────────────────────────────────
  window.OF = window.OF || {};

  window.OF.flow = {
    buyVol: 0, sellVol: 0,
    bias: 0, buyPct: 50, sellPct: 50, ts: 0
  };

  window.OF.trapMM = {
    armed: false, dir: 0, level: null,
    armTs: 0, armPrice: null, armBias: 0,
    fired: false, fireTs: 0, reason: '',
    cooldownUntil: 0
  };

  // ═══════════════════════════════════════════════════════════════════
  // A) FLOW BIAS — single pass from tail, break on ts < cut
  // ═══════════════════════════════════════════════════════════════════
  function _computeFlowBias() {
    try {
      const buf = window.RAW_FLOW && window.RAW_FLOW.buf;
      if (!buf || !buf.length) return;
      const cut = Date.now() - FLOW_WIN_MS;
      let buyVol = 0, sellVol = 0;
      for (let i = buf.length - 1; i >= 0; i--) {
        const t = buf[i];
        if (t.ts < cut) break;                      // early exit — sorted by time
        if (t.isBuyerMaker) sellVol += t.q;         // buyer is maker → aggressive sell
        else buyVol += t.q;          // seller is maker → aggressive buy
      }
      const denom = buyVol + sellVol;
      const bias = denom > 0 ? (buyVol - sellVol) / denom : 0;
      const buyPct = denom > 0 ? 100 * buyVol / denom : 50;
      window.OF.flow = {
        buyVol, sellVol,
        bias,
        buyPct,
        sellPct: 100 - buyPct,
        ts: Date.now()
      };
    } catch (_) { }
  }

  // ═══════════════════════════════════════════════════════════════════
  // B) MM TRAP helpers
  // ═══════════════════════════════════════════════════════════════════

  // hi30 / lo30: single pass from tail over 30s price buffer
  function _getHiLo30() {
    try {
      const buf = window.OF_PRICE_BUF;
      if (!buf || buf.length < 2) return null;
      const cut = Date.now() - PRICE_WIN_MS;
      let hi = -Infinity, lo = Infinity, found = false;
      for (let i = buf.length - 1; i >= 0; i--) {
        const pt = buf[i];
        if (pt.ts < cut) break;
        if (pt.price > hi) hi = pt.price;
        if (pt.price < lo) lo = pt.price;
        found = true;
      }
      return (found && isFinite(hi) && isFinite(lo)) ? { hi, lo } : null;
    } catch (_) { return null; }
  }

  // Price move % over last 2s — returns % value (e.g. 0.07 = 0.07%) or null
  function _priceMove2s() {
    try {
      const buf = window.OF_PRICE_BUF;
      if (!buf || buf.length < 2) return null;
      const cur = buf[buf.length - 1].price;
      const target = Date.now() - 2000;
      // Walk backward to find oldest entry within 2s window
      for (let i = buf.length - 2; i >= 0; i--) {
        if (buf[i].ts <= target) {
          const old = buf[i].price;
          return (old > 0) ? (cur - old) / old * 100 : null;
        }
      }
      return null;
    } catch (_) { return null; }
  }

  // ═══════════════════════════════════════════════════════════════════
  // B) MM TRAP state machine
  // ═══════════════════════════════════════════════════════════════════
  function _tickMMTrap() {
    try {
      const OF = window.OF;
      if (!OF || !OF.quality || !OF.quality.burned) return;

      const now = Date.now();
      const tmm = OF.trapMM;
      const flow = OF.flow || {};
      const price = window.S && Number.isFinite(window.S.price) ? window.S.price : null;
      if (!price) return;

      // ── Cooldown gate ─────────────────────────────────────────────
      if (now < (tmm.cooldownUntil || 0)) {
        tmm.armed = false;
        tmm.fired = false;
        return;
      }

      // ── Clear FIRE after display TTL ──────────────────────────────
      if (tmm.fired && (now - tmm.fireTs) > FIRE_TTL_MS) {
        tmm.fired = false;
        tmm.armed = false;
        tmm.cooldownUntil = now + COOLDOWN_MS;
        return;
      }

      // ── ARMED: check FIRE conditions ──────────────────────────────
      if (tmm.armed) {
        // TTL expired → reset + cooldown
        if ((now - tmm.armTs) > ARM_TTL_MS) {
          tmm.armed = false;
          tmm.fired = false;
          tmm.cooldownUntil = now + COOLDOWN_MS;
          return;
        }

        // Price must reclaim back through the broken level
        const reclaims = tmm.dir === 1
          ? price <= tmm.level * (1 - RECLAIM_PCT)   // UP trap: price falls back below hi30
          : price >= tmm.level * (1 + RECLAIM_PCT);  // DOWN trap: price rises back above lo30

        if (reclaims) {
          // Confirmation: delta flip (BULL/BEAR) OR flow bias flips opposite
          const df = OF.dFlip || {};
          const deltaFlipped =
            df.active && df.dir &&
            ((tmm.dir === 1 && df.dir === 'BEAR') ||   // UP trap fired → bearish delta flip
              (tmm.dir === -1 && df.dir === 'BULL'));     // DOWN trap fired → bullish delta flip

          const biasNow = flow.bias || 0;
          const biasFlipped =
            (tmm.dir === 1 && biasNow <= -BIAS_FLIP_THRESH) ||  // flow turned seller
            (tmm.dir === -1 && biasNow >= BIAS_FLIP_THRESH);    // flow turned buyer

          if (deltaFlipped || biasFlipped) {
            tmm.fired = true;
            tmm.fireTs = now;
            tmm.reason = deltaFlipped ? 'delta_flip' : 'bias_flip';
            try {
              if (typeof ZLOG !== 'undefined')
                ZLOG.push('AT',
                  '[OF MMTRAP] FIRE dir=' + (tmm.dir === 1 ? 'UP' : 'DOWN') +
                  ' level=' + tmm.level.toFixed(2) +
                  ' reason=' + tmm.reason +
                  ' biasNow=' + biasNow.toFixed(3),
                  { dir: tmm.dir, level: tmm.level, reason: tmm.reason, biasNow }
                );
            } catch (_) { }
          }
        }
        return;  // stay in armed state regardless — only exit via fire/TTL/cooldown
      }

      // ── IDLE: check ARM conditions ────────────────────────────────
      const hl = _getHiLo30();
      if (!hl) return;

      const move2s = _priceMove2s();
      if (move2s === null || Math.abs(move2s) < MIN_MOVE_PCT) return;

      const bias = flow.bias || 0;
      const breaksUp = price > hl.hi * (1 + BREAK_PCT);
      const breaksDn = price < hl.lo * (1 - BREAK_PCT);

      // ARM: break without flow confirmation
      if (breaksUp && bias <= BIAS_NO_CONFIRM) {
        // Price broke above hi30 but buyers not aggressively in — suspect
        tmm.armed = true;
        tmm.dir = 1;
        tmm.level = hl.hi;
        tmm.armTs = now;
        tmm.armPrice = price;
        tmm.armBias = bias;
        tmm.fired = false;
        tmm.reason = 'break_without_flow';
        try {
          if (typeof ZLOG !== 'undefined')
            ZLOG.push('AT',
              '[OF MMTRAP] ARMED UP level=' + hl.hi.toFixed(2) +
              ' price=' + price.toFixed(2) +
              ' bias=' + bias.toFixed(3),
              { dir: 1, level: hl.hi, price, bias }
            );
        } catch (_) { }

      } else if (breaksDn && bias >= -BIAS_NO_CONFIRM) {
        // Price broke below lo30 but sellers not aggressively in — suspect
        tmm.armed = true;
        tmm.dir = -1;
        tmm.level = hl.lo;
        tmm.armTs = now;
        tmm.armPrice = price;
        tmm.armBias = bias;
        tmm.fired = false;
        tmm.reason = 'break_without_flow';
        try {
          if (typeof ZLOG !== 'undefined')
            ZLOG.push('AT',
              '[OF MMTRAP] ARMED DOWN level=' + hl.lo.toFixed(2) +
              ' price=' + price.toFixed(2) +
              ' bias=' + bias.toFixed(3),
              { dir: -1, level: hl.lo, price, bias }
            );
        } catch (_) { }
      }
    } catch (_) { }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Single tick — both A and B in one interval (per spec)
  // ═══════════════════════════════════════════════════════════════════
  function _tick() {
    _computeFlowBias();
    _tickMMTrap();
  }

  // ── Symbol change reset ──────────────────────────────────────────
  const _prevSSMM = window.setSymbol;
  window.setSymbol = function (sym) {
    if (typeof _prevSSMM === 'function') _prevSSMM(sym);
    try {
      if (window.OF) {
        window.OF.flow = { buyVol: 0, sellVol: 0, bias: 0, buyPct: 50, sellPct: 50, ts: 0 };
        window.OF.trapMM = {
          armed: false, dir: 0, level: null,
          armTs: 0, armPrice: null, armBias: 0,
          fired: false, fireTs: 0, reason: '', cooldownUntil: 0
        };
      }
    } catch (_) { }
  };

  // ═══════════════════════════════════════════════════════════════════
  // Patch OF_DEBUG_SNAPSHOT to expose flow + mmTrap (for P9 dp.of)
  // ═══════════════════════════════════════════════════════════════════
  function _patchSnapshot() {
    const _orig = window.OF_DEBUG_SNAPSHOT;
    if (typeof _orig !== 'function') return false;
    window.OF_DEBUG_SNAPSHOT = function () {
      const snap = _orig();
      try {
        const fl = (window.OF && window.OF.flow) || {};
        const tm = (window.OF && window.OF.trapMM) || {};
        snap.flow = {
          buyPct: fl.buyPct != null ? fl.buyPct : 50,
          sellPct: fl.sellPct != null ? fl.sellPct : 50,
          bias: fl.bias != null ? fl.bias : 0,
          ts: fl.ts || 0
        };
        snap.mmTrap = {
          armed: !!tm.armed,
          fired: !!tm.fired,
          dir: tm.dir || 0,
          level: tm.level || null,
          armBias: tm.armBias != null ? tm.armBias : null,
          biasNow: fl.bias != null ? fl.bias : 0,
          reason: tm.reason || '',
          ts: tm.fired ? tm.fireTs : (tm.armed ? tm.armTs : 0)
        };
      } catch (_) { }
      return snap;
    };
    try { if (typeof ZLOG !== 'undefined') ZLOG.push('INFO', '[OF MMTRAP] OF_DEBUG_SNAPSHOT patched'); } catch (_) { }
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════
  // HUD injection via MutationObserver — no exec, DOM-only
  // Injects:
  //   • FLOW chip into compact row (always visible)
  //   • MMTRAP row into expanded .detail section
  // ═══════════════════════════════════════════════════════════════════
  (function _patchHUD() {

    // ── CSS for new chips ──────────────────────────────────────────
    (function _injectCSS() {
      const s = document.createElement('style');
      s.id = 'of-mmtrap-css';
      s.textContent = [
        /* Flow bias chips — fixed width prevents layout jitter */
        '#of-hud .mm-flow-buy  { color:#00ffa0; border-color:rgba(0,255,160,0.42); box-shadow:0 0 8px rgba(0,255,160,0.22); }',
        '#of-hud .mm-flow-sell { color:#ff4466; border-color:rgba(255,68,102,0.42); box-shadow:0 0 8px rgba(255,68,102,0.22); }',
        '#of-hud .mm-flow-neut { color:#445; border-color:rgba(255,255,255,0.07); }',
        '#of-hud .mm-flow-chip {',
        '  display:inline-flex; align-items:center; justify-content:center;',
        '  min-width:120px; max-width:120px; width:120px;',
        '  text-align:center; white-space:nowrap;',
        '  font-variant-numeric:tabular-nums;',
        '  transition:background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease;',
        '}',
        /* MM Trap state chips */
        '#of-hud .mm-armed { color:#ffc800; border-color:rgba(255,200,0,0.45);',
        '  box-shadow:0 0 10px rgba(255,200,0,0.28);',
        '  animation:mm-pulse 1s ease-in-out infinite; }',
        '#of-hud .mm-fire  { color:#ff4466; border-color:rgba(255,68,102,0.55);',
        '  box-shadow:0 0 14px rgba(255,68,102,0.4);',
        '  animation:mm-flash 0.45s ease-in-out infinite; }',
        '@keyframes mm-pulse { 0%,100%{opacity:1} 50%{opacity:0.55} }',
        '@keyframes mm-flash { 0%,100%{opacity:1;box-shadow:0 0 14px rgba(255,68,102,0.4)}',
        '                       50%{opacity:0.7;box-shadow:0 0 26px rgba(255,68,102,0.75)} }',
      ].join('\n');
      document.head.appendChild(s);
    })();

    // ── Inject into HUD DOM after each render ─────────────────────
    function _inject(hudEl) {
      try {
        if (window.__OF_HUD_BUILT__) return;  // _render() owns these rows — do not overwrite
        const d = window.OF_DEBUG_SNAPSHOT ? window.OF_DEBUG_SNAPSHOT() : null;
        if (!d) return;

        // ── (A) FLOW chip in compact row ─────────────────────────
        const compactRow = hudEl.querySelector('.row');
        if (compactRow) {
          // Remove stale chip first (safe even if absent)
          const old = compactRow.querySelector('.mm-flow-chip');
          if (old) old.remove();

          const fl = d.flow || {};
          const bias = typeof fl.bias === 'number' ? fl.bias : 0;
          const bPct = typeof fl.buyPct === 'number' ? fl.buyPct : 50;
          const sPct = (100 - bPct);

          let txt, cls;
          if (bias > 0.08) {
            txt = 'FLOW BUY ' + bPct.toFixed(0) + '%';
            cls = 'chip mm-flow-chip mm-flow-buy';
          } else if (bias < -0.08) {
            txt = 'FLOW SELL ' + sPct.toFixed(0) + '%';
            cls = 'chip mm-flow-chip mm-flow-sell';
          } else {
            txt = 'FLOW NEUT';
            cls = 'chip mm-flow-chip mm-flow-neut';
          }

          const chip = document.createElement('span');
          chip.className = cls;
          chip.textContent = txt;
          compactRow.appendChild(chip);
        }

        // ── (B) MMTRAP row in expanded .detail section ───────────
        const detail = hudEl.querySelector('.detail');
        if (!detail) return;   // collapsed — skip

        let mmRow = detail.querySelector('.mm-trap-row');
        if (!mmRow) {
          mmRow = document.createElement('div');
          mmRow.className = 'row mm-trap-row';
          detail.appendChild(mmRow);   // inside detail → won't re-trigger HUD observer
        }

        // Build row content
        const mm = d.mmTrap || {};
        const dirArrow = mm.dir === 1 ? ' ▲' : mm.dir === -1 ? ' ▼' : '';
        const biasNow = typeof mm.biasNow === 'number' ? mm.biasNow : 0;
        const bNowTxt = (biasNow >= 0 ? '+' : '') + (biasNow * 100).toFixed(1) + '%';
        const lastTs = mm.ts || 0;
        const secsAgo = lastTs
          ? (Math.floor((Date.now() - lastTs) / 1000) + 's ago')
          : '—';

        let stateChip;
        if (mm.fired) {
          stateChip = '<span class="chip mm-fire">' + _ZI.spider + ' FIRE' + dirArrow + '</span>';
        } else if (mm.armed) {
          stateChip = '<span class="chip mm-armed">' + _ZI.bolt + ' ARMED' + dirArrow + '</span>';
        } else {
          stateChip = '<span class="chip idle">IDLE</span>';
        }

        const levelChip = mm.level
          ? '<span class="chip muted">lvl ' + Number(mm.level).toFixed(2) + '</span>'
          : '';
        const biasChip = '<span class="chip muted">bias ' + bNowTxt + '</span>';

        mmRow.innerHTML =
          '<span class="lbl">MMTRAP</span>' +
          stateChip +
          levelChip +
          biasChip +
          '<span style="margin-left:auto;font-size:12px;color:#334">' + secsAgo + '</span>';

      } catch (_) { }
    }

    // ── MutationObserver disabled: rows managed by _buildDom() + _render() ──
    // P10 rows (.mm-trap-row, .mm-flow-chip) are created in _buildDom() and
    // updated via _sc()/_sw() in _render(). Observer was corrupting _dom refs.
    // If re-enabled: push the obs instance to window.__OF_HUD_OBS before .observe().
    //   e.g. const obs = new MutationObserver(...); window.__OF_HUD_OBS.push(obs);
    function _startObserver() { /* no-op — observer owned by _buildDom() teardown */ }

    function _waitForHUD() {
      /* no-op — observer disabled */
    }

  })();   // end _patchHUD IIFE

  // ═══════════════════════════════════════════════════════════════════
  // Start — single interval, delayed startup
  // ═══════════════════════════════════════════════════════════════════
  function _start() {
    Intervals.set('of_p10_flow', _tick, 1000);

    // Patch OF_DEBUG_SNAPSHOT with retry (it may not exist yet)
    if (!_patchSnapshot()) {
      let _retries = 0;
      const _t = setInterval(function () {
        if (_patchSnapshot() || ++_retries >= 20) clearInterval(_t);
      }, 500);
    }

    try {
      if (typeof ZLOG !== 'undefined')
        ZLOG.push('INFO',
          '[OF v121 P10] FLOW BIAS + MMTRAP started' +
          ' (flowWin=' + FLOW_WIN_MS + 'ms' +
          ' breakPct=' + (BREAK_PCT * 100).toFixed(2) + '%' +
          ' armTTL=' + ARM_TTL_MS + 'ms)');
    } catch (_) { }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(_start, 1800); });
  } else {
    setTimeout(_start, 1800);
  }

})();

// ╔══════════════════════════════════════════════════════════════════╗
// ║  ZEUS ORDERFLOW v121 — PAS 11: ABSORB + EXHAUST DETECTORS v2    ║
// ║  A) Absorb:  high vol + price stuck + strong delta imbalance     ║
// ║  B) Exhaust: impulse burst → flow collapse within 3s            ║
// ║  Watch-only. No exec. Writes OF.absorb / OF.exh. No new timer.  ║
// ╚══════════════════════════════════════════════════════════════════╝
(function () {
  if (window.__ZEUS_OF_ABS_EXH__) return;
  window.__ZEUS_OF_ABS_EXH__ = true;

  // ── Config ──────────────────────────────────────────────────────────
  // A) ABSORB
  const ABS_SCAN_MS = 2000;   // rolling window for vol + delta
  const ABS_REF_MS = 10000;  // reference window for avg vol baseline
  const ABS_VOL_MULT = 1.8;    // totalVol2s must be >= 1.8 × avgVol2s_ref
  const ABS_PRICE_MAX = 0.03;   // abs(priceMove2s) must be <= this %
  const ABS_DELTA_MIN = 0.35;   // abs(deltaPct) must be >= this (0..1 scale)
  const ABS_DISPLAY_MS = 2000;   // active display TTL
  const ABS_COOLDOWN_MS = 6000;   // cooldown after expiry

  // B) EXHAUST
  const EXH_SCAN_MS = 3000;   // impulse price move window
  const EXH_MOVE_MIN = 0.08;   // abs(priceMove3s) >= this % for impulse
  const EXH_TPS_IMPULSE = 40;     // tps in 3s window must be >= this
  const EXH_ARM_TTL_MS = 3000;   // armed state TTL: exhaustion must arrive within 3s
  const EXH_TPS_COLLAPSE = 8;      // tps < this to confirm exhaustion
  const EXH_BIAS_FLIP = 0.20;   // bias must flip by >= this from impulse bias
  const EXH_DISPLAY_MS = 2000;
  const EXH_COOLDOWN_MS = 8000;

  // ── State init (use OF.absorb / OF.exh — distinct from OF.abs / OF.exhaust) ──
  window.OF = window.OF || {};

  const _absDefault = () => ({
    active: false, dir: 0,
    vol: 0, deltaPct: 0, priceMove: 0,
    ts: 0, cooldownUntil: 0
  });

  const _exhDefault = () => ({
    active: false, dir: 0,
    phase: 'idle',          // 'idle' | 'armed'
    impulseMove: 0,
    impulseBias: 0,
    tpsPeak: 0, tpsNow: 0,
    armTs: 0, ts: 0,
    cooldownUntil: 0
  });

  window.OF.absorb = _absDefault();
  window.OF.exh = _exhDefault();

  // ═══════════════════════════════════════════════════════════════════
  // Shared helpers — single-pass from tail, break early
  // ═══════════════════════════════════════════════════════════════════

  // Price move % over last `ms` milliseconds (from OF_PRICE_BUF)
  function _priceMoveMs(ms) {
    try {
      const buf = window.OF_PRICE_BUF;
      if (!buf || buf.length < 2) return null;
      const cur = buf[buf.length - 1].price;
      const target = Date.now() - ms;
      for (let i = buf.length - 2; i >= 0; i--) {
        if (buf[i].ts <= target) {
          const old = buf[i].price;
          return (old > 0) ? (cur - old) / old * 100 : null;
        }
      }
      return null;
    } catch (_) { return null; }
  }

  // Single-pass RAW_FLOW stats: returns { buyVol, sellVol, totalVol, n, vol10s }
  // Splits at cutFast (2s or 3s) and cutRef (10s) in one forward pass
  function _flowStats(cutFastMs, cutRefMs) {
    try {
      const buf = window.RAW_FLOW && window.RAW_FLOW.buf;
      if (!buf || !buf.length) return null;
      const now = Date.now();
      const cutFast = now - cutFastMs;
      const cutRef = now - cutRefMs;
      let buyVol = 0, sellVol = 0, n = 0, volRef = 0;
      for (let i = buf.length - 1; i >= 0; i--) {
        const t = buf[i];
        if (t.ts < cutRef) break;          // beyond reference window → stop
        volRef += t.q;                      // accumulate reference vol (10s)
        if (t.ts >= cutFast) {             // within fast window (2s/3s)
          n++;
          if (t.isBuyerMaker) sellVol += t.q;
          else buyVol += t.q;
        }
      }
      const totalVol = buyVol + sellVol;
      const denom = totalVol > 0 ? totalVol : 1e-9;
      const deltaPct = (buyVol - sellVol) / denom;  // −1..+1
      const tps = n / (cutFastMs / 1000);       // trades per second
      // Average per-fast-window vol from ref window
      const avgVol = volRef / (cutRefMs / cutFastMs);
      return { buyVol, sellVol, totalVol, deltaPct, tps, avgVol, n };
    } catch (_) { return null; }
  }

  // ═══════════════════════════════════════════════════════════════════
  // A) ABSORB DETECTOR
  // Registered as window._tickAbsorbP11 → called from P45 _tick()
  // ═══════════════════════════════════════════════════════════════════
  window._tickAbsorbP11 = function () {
    try {
      const OF = window.OF;
      if (!OF || !OF.quality || !OF.quality.burned) return;

      const now = Date.now();
      const ab = OF.absorb;

      // Cooldown gate
      if (now < (ab.cooldownUntil || 0)) { ab.active = false; return; }

      // Clear active after display TTL
      if (ab.active && (now - ab.ts) > ABS_DISPLAY_MS) {
        const nextCD = _absDefault();
        nextCD.cooldownUntil = now + ABS_COOLDOWN_MS;
        window.OF.absorb = nextCD;
        return;
      }

      // Already active → hold until TTL clears above
      if (ab.active) return;

      // Compute stats (single pass: 2s fast window, 10s reference)
      const st = _flowStats(ABS_SCAN_MS, ABS_REF_MS);
      if (!st) return;

      const move2s = _priceMoveMs(ABS_SCAN_MS);
      if (move2s === null) return;

      // Condition checks
      const volSurge = st.totalVol >= ABS_VOL_MULT * st.avgVol;
      const priceFlat = Math.abs(move2s) <= ABS_PRICE_MAX;
      const strongDelta = Math.abs(st.deltaPct) >= ABS_DELTA_MIN;

      if (volSurge && priceFlat && strongDelta) {
        const dir = st.deltaPct > 0 ? 1 : -1;
        window.OF.absorb = {
          active: true,
          dir,
          vol: st.totalVol,
          deltaPct: st.deltaPct,
          priceMove: move2s,
          ts: now,
          cooldownUntil: 0
        };
        try {
          if (typeof ZLOG !== 'undefined')
            ZLOG.push('AT',
              '[OF P11] ABSORB dir=' + (dir > 0 ? '▲BUY' : '▼SELL') +
              ' vol=' + st.totalVol.toFixed(1) +
              ' avgVol=' + st.avgVol.toFixed(1) +
              ' dPct=' + (st.deltaPct * 100).toFixed(1) + '%' +
              ' move2s=' + move2s.toFixed(3) + '%',
              { dir, vol: st.totalVol, deltaPct: st.deltaPct, move2s }
            );
        } catch (_) { }
      }
    } catch (_) { }
  };

  // ═══════════════════════════════════════════════════════════════════
  // B) EXHAUST DETECTOR (2-phase: impulse → collapse)
  // Registered as window._tickExhaustP11 → called from P45 _tick()
  // ═══════════════════════════════════════════════════════════════════
  window._tickExhaustP11 = function () {
    try {
      const OF = window.OF;
      if (!OF || !OF.quality || !OF.quality.burned) return;

      const now = Date.now();
      const ex = OF.exh;
      const fl = OF.flow || {};     // from P10 flow bias

      // Cooldown gate
      if (now < (ex.cooldownUntil || 0)) { ex.active = false; return; }

      // Clear active after display TTL
      if (ex.active && (now - ex.ts) > EXH_DISPLAY_MS) {
        const nextCD = _exhDefault();
        nextCD.cooldownUntil = now + EXH_COOLDOWN_MS;
        window.OF.exh = nextCD;
        return;
      }

      // Already firing — hold until TTL clears
      if (ex.active) return;

      // ARMED → watch for collapse
      if (ex.phase === 'armed') {
        // TTL check — arm window expired
        if ((now - ex.armTs) > EXH_ARM_TTL_MS) {
          const reset = _exhDefault();
          reset.cooldownUntil = now + EXH_COOLDOWN_MS;
          window.OF.exh = reset;
          return;
        }

        // Measure current tps (3s window, same as impulse)
        const st = _flowStats(EXH_SCAN_MS, ABS_REF_MS);
        if (!st) return;
        const biasNow = typeof fl.bias === 'number' ? fl.bias : 0;

        // Exhaustion conditions: tps collapsed AND bias flipped
        const tpsCollapsed = st.tps < EXH_TPS_COLLAPSE;
        const biasFlipped =
          (ex.dir === 1 && biasNow < (ex.impulseBias - EXH_BIAS_FLIP)) ||
          (ex.dir === -1 && biasNow > (ex.impulseBias + EXH_BIAS_FLIP));

        if (tpsCollapsed && biasFlipped) {
          window.OF.exh = {
            active: true,
            dir: ex.dir,
            phase: 'fired',
            impulseMove: ex.impulseMove,
            impulseBias: ex.impulseBias,
            tpsPeak: ex.tpsPeak,
            tpsNow: st.tps,
            armTs: ex.armTs,
            ts: now,
            cooldownUntil: 0
          };
          try {
            if (typeof ZLOG !== 'undefined')
              ZLOG.push('AT',
                '[OF P11] EXHAUST dir=' + (ex.dir > 0 ? '▲→collapse' : '▼→collapse') +
                ' impMove=' + ex.impulseMove.toFixed(3) + '%' +
                ' tpsPeak=' + ex.tpsPeak.toFixed(1) +
                ' tpsNow=' + st.tps.toFixed(1) +
                ' biasFlip=' + biasNow.toFixed(3),
                { dir: ex.dir, impulseMove: ex.impulseMove, tpsPeak: ex.tpsPeak, tpsNow: st.tps, biasNow }
              );
          } catch (_) { }
        }
        return;
      }

      // IDLE → check for impulse
      const st = _flowStats(EXH_SCAN_MS, ABS_REF_MS);
      if (!st) return;
      const move3s = _priceMoveMs(EXH_SCAN_MS);
      if (move3s === null) return;

      const impulse = Math.abs(move3s) >= EXH_MOVE_MIN && st.tps >= EXH_TPS_IMPULSE;
      if (impulse) {
        const dir = move3s > 0 ? 1 : -1;
        const biasNow = typeof fl.bias === 'number' ? fl.bias : 0;
        window.OF.exh = {
          active: false,
          dir,
          phase: 'armed',
          impulseMove: move3s,
          impulseBias: biasNow,
          tpsPeak: st.tps,
          tpsNow: st.tps,
          armTs: now,
          ts: 0,
          cooldownUntil: 0
        };
        try {
          if (typeof ZLOG !== 'undefined')
            ZLOG.push('AT',
              '[OF P11] EXH ARMED dir=' + (dir > 0 ? '▲' : '▼') +
              ' move3s=' + move3s.toFixed(3) + '%' +
              ' tps=' + st.tps.toFixed(1) +
              ' bias=' + biasNow.toFixed(3),
              { dir, move3s, tps: st.tps, biasNow }
            );
        } catch (_) { }
      }
    } catch (_) { }
  };

  // ═══════════════════════════════════════════════════════════════════
  // Patch OF_DEBUG_SNAPSHOT to expose absorb + exh
  // ═══════════════════════════════════════════════════════════════════
  function _patchSnapshot() {
    const _orig = window.OF_DEBUG_SNAPSHOT;
    if (typeof _orig !== 'function') return false;
    window.OF_DEBUG_SNAPSHOT = function () {
      const snap = _orig();
      try {
        const ab = (window.OF && window.OF.absorb) || {};
        const ex = (window.OF && window.OF.exh) || {};
        snap.absorb = {
          active: !!ab.active,
          dir: ab.dir || 0,
          vol: ab.vol != null ? ab.vol : null,
          deltaPct: ab.deltaPct != null ? ab.deltaPct : null,
          priceMove: ab.priceMove != null ? ab.priceMove : null,
          ts: ab.ts || 0
        };
        snap.exh = {
          active: !!ex.active,
          phase: ex.phase || 'idle',
          dir: ex.dir || 0,
          impulseMove: ex.impulseMove != null ? ex.impulseMove : null,
          impulseBias: ex.impulseBias != null ? ex.impulseBias : null,
          tpsPeak: ex.tpsPeak != null ? ex.tpsPeak : null,
          tpsNow: ex.tpsNow != null ? ex.tpsNow : null,
          ts: ex.ts || 0
        };
      } catch (_) { }
      return snap;
    };
    try { if (typeof ZLOG !== 'undefined') ZLOG.push('INFO', '[OF P11] OF_DEBUG_SNAPSHOT patched with absorb+exh'); } catch (_) { }
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════
  // HUD injection — own MutationObserver instance, own DOM ids
  // Appends ABSORB + EXHAUST rows into .detail, never touches P10 rows
  // ═══════════════════════════════════════════════════════════════════
  (function _patchHUD_P11() {

    // ── CSS ──────────────────────────────────────────────────────────
    (function () {
      const s = document.createElement('style');
      s.id = 'of-abseh-css';
      s.textContent = [
        '#of-hud .p11-abs-buy  { color:#00ffa0; border-color:rgba(0,255,160,0.45);',
        '  box-shadow:0 0 10px rgba(0,255,160,0.25); animation:p11-pulse-g 1s ease-in-out infinite; }',
        '#of-hud .p11-abs-sell { color:#ff4466; border-color:rgba(255,68,102,0.45);',
        '  box-shadow:0 0 10px rgba(255,68,102,0.25); animation:p11-pulse-r 1s ease-in-out infinite; }',
        '#of-hud .p11-exh-up   { color:#00ffa0; border-color:rgba(0,255,160,0.42);',
        '  box-shadow:0 0 10px rgba(0,255,160,0.22); animation:p11-pulse-g 0.8s ease-in-out infinite; }',
        '#of-hud .p11-exh-dn   { color:#ff4466; border-color:rgba(255,68,102,0.42);',
        '  box-shadow:0 0 10px rgba(255,68,102,0.22); animation:p11-pulse-r 0.8s ease-in-out infinite; }',
        '#of-hud .p11-armed    { color:#ffc800; border-color:rgba(255,200,0,0.38); }',
        '@keyframes p11-pulse-g { 0%,100%{opacity:1} 50%{opacity:0.5} }',
        '@keyframes p11-pulse-r { 0%,100%{opacity:1} 50%{opacity:0.5} }',
      ].join('\n');
      document.head.appendChild(s);
    })();

    // Helper: format seconds-ago label
    function _secsAgo(ts) { if (!ts) return '—'; return Math.floor((Date.now() - ts) / 1000) + 's ago'; }
    function _n(v, d) { return (v != null && isFinite(+v)) ? (+v).toFixed(d || 2) : '—'; }
    const _chip = (t, c) => '<span class="chip ' + (c || 'muted') + '">' + t + '</span>';

    // ── _inject: append/update rows inside .detail ────────────────────
    function _inject(hudEl) {
      try {
        if (window.__OF_HUD_BUILT__) return;  // _render() owns these rows — do not overwrite
        const d = window.OF_DEBUG_SNAPSHOT ? window.OF_DEBUG_SNAPSHOT() : null;
        if (!d) return;

        const detail = hudEl.querySelector('.detail');
        if (!detail) return;   // collapsed — nothing to do

        // ── ABSORB row ──────────────────────────────────────────────
        let absRow = detail.querySelector('.p11-abs-row');
        if (!absRow) {
          absRow = document.createElement('div');
          absRow.className = 'row p11-abs-row';
          detail.appendChild(absRow);
        }
        {
          const ab = d.absorb || {};
          const dirArrow = ab.dir === 1 ? ' ▲' : ab.dir === -1 ? ' ▼' : '';
          let stateChip;
          if (ab.active) {
            const cls = ab.dir === 1 ? 'p11-abs-buy' : 'p11-abs-sell';
            stateChip = _chip('ABSORB' + dirArrow, cls);
          } else {
            stateChip = _chip('IDLE', 'idle');
          }
          const volChip = ab.vol != null ? _chip('vol ' + _n(ab.vol, 1), ab.active ? 'muted' : 'idle') : '';
          const dPctChip = ab.deltaPct != null ? _chip('δ ' + _n(ab.deltaPct * 100, 1) + '%', ab.active ? 'muted' : 'idle') : '';
          const pmovChip = ab.priceMove != null ? _chip('mv ' + _n(ab.priceMove, 3) + '%', ab.active ? 'muted' : 'idle') : '';
          absRow.innerHTML =
            '<span class="lbl">ABSORB</span>' +
            stateChip + volChip + dPctChip + pmovChip +
            '<span style="margin-left:auto;font-size:12px;color:#334">' + _secsAgo(ab.ts) + '</span>';
        }

        // ── EXHAUST row ─────────────────────────────────────────────
        let exhRow = detail.querySelector('.p11-exh-row');
        if (!exhRow) {
          exhRow = document.createElement('div');
          exhRow.className = 'row p11-exh-row';
          detail.appendChild(exhRow);
        }
        {
          const ex = d.exh || {};
          const dirArrow = ex.dir === 1 ? ' ▲' : ex.dir === -1 ? ' ▼' : '';
          let stateChip;
          if (ex.active) {
            const cls = ex.dir === 1 ? 'p11-exh-up' : 'p11-exh-dn';
            stateChip = _chip('EXH' + dirArrow, cls);
          } else if (ex.phase === 'armed') {
            stateChip = _chip('ARMING' + dirArrow, 'p11-armed');
          } else {
            stateChip = _chip('IDLE', 'idle');
          }
          const mvChip = ex.impulseMove != null ? _chip('mv ' + _n(ex.impulseMove, 3) + '%', 'muted') : '';
          const tpsChip = (ex.tpsPeak != null && ex.tpsNow != null)
            ? _chip(_n(ex.tpsPeak, 1) + '→' + _n(ex.tpsNow, 1) + ' t/s', 'muted')
            : '';
          exhRow.innerHTML =
            '<span class="lbl">EXHAUST</span>' +
            stateChip + mvChip + tpsChip +
            '<span style="margin-left:auto;font-size:12px;color:#334">' + _secsAgo(ex.ts) + '</span>';
        }

      } catch (_) { }
    }

    // ── Own MutationObserver instance — distinct from P10's ───────────
    // ── MutationObserver disabled: P11 rows managed by _buildDom() + _render() ──
    // If re-enabled: const obs = new MutationObserver(...); window.__OF_HUD_OBS.push(obs);
    function _startObserver() { /* no-op — observer owned by _buildDom() teardown */ }
    function _waitForHUD() { /* no-op */ }

  })();   // end _patchHUD_P11

  // ═══════════════════════════════════════════════════════════════════
  // Symbol change reset
  // ═══════════════════════════════════════════════════════════════════
  const _prevSSP11 = window.setSymbol;
  window.setSymbol = function (sym) {
    if (typeof _prevSSP11 === 'function') _prevSSP11(sym);
    try {
      if (window.OF) {
        window.OF.absorb = _absDefault();
        window.OF.exh = _exhDefault();
      }
    } catch (_) { }
  };

  // ═══════════════════════════════════════════════════════════════════
  // Init — NO new interval (functions are called from P45's _tick)
  // Only patch OF_DEBUG_SNAPSHOT and log startup
  // ═══════════════════════════════════════════════════════════════════
  function _start() {
    // Patch snapshot with retry
    if (!_patchSnapshot()) {
      let _r = 0;
      const _t = setInterval(function () {
        if (_patchSnapshot() || ++_r >= 20) clearInterval(_t);
      }, 500);
    }
    try {
      if (typeof ZLOG !== 'undefined')
        ZLOG.push('INFO',
          '[OF v121 P11] ABSORB+EXHAUST v2 ready' +
          ' (absVolMult=' + ABS_VOL_MULT + 'x' +
          ' absΔmin=' + ABS_DELTA_MIN +
          ' exhTpsImpulse=' + EXH_TPS_IMPULSE +
          ' exhCollapse<' + EXH_TPS_COLLAPSE + ')');
    } catch (_) { }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(_start, 1900); });
  } else {
    setTimeout(_start, 1900);
  }

})();

// ╔══════════════════════════════════════════════════════════════════╗
// ║  ZEUS ORDERFLOW v121 — PAS 12: LIQUIDITY SWEEP + STOP CASCADE   ║
// ║  A) Sweep:   aggressive price move + vol surge + high tps        ║
// ║  B) Cascade: sweep → continuation + bigger vol/tps spike        ║
// ║  Watch-only. No exec. No new interval. Guard __ZEUS_OF_SWEEP_CASCADE__ ║
// ╚══════════════════════════════════════════════════════════════════╝
(function () {
  if (window.__ZEUS_OF_SWEEP_CASCADE__) return;
  window.__ZEUS_OF_SWEEP_CASCADE__ = true;

  // ── Config ──────────────────────────────────────────────────────────

  // A) SWEEP
  const SWP_WIN_MS = 3000;   // price + flow measurement window
  const SWP_REF_MS = 10000;  // reference window for avgVol baseline
  const SWP_MOVE_MIN = 0.12;   // abs(move3s) ≥ 0.12% to trigger
  const SWP_VOL_MULT = 2.0;    // totalVol3s ≥ 2.0 × avgVol3s
  const SWP_TPS_MIN = 35;     // tps3s ≥ 35
  const SWP_DISPLAY_MS = 2000;   // active display TTL
  const SWP_COOLDOWN_MS = 6000;   // cooldown after expiry

  // B) CASCADE — Phase 1 (ARM)
  const CAS_ARM_MOVE_MIN = 0.08;   // abs(move2s) ≥ 0.08% to arm
  const CAS_ARM_TPS_MIN = 45;     // tps ≥ 45 to arm
  const CAS_ARM_WIN_MS = 2000;   // move measurement window for arm
  const CAS_SWEEP_MAX_AGE = 3000;   // sweep must be ≤ 3s old to arm
  const CAS_ARM_TTL_MS = 4000;   // arm expires after 4s if no fire

  // B) CASCADE — Phase 2 (FIRE)
  const CAS_FIRE_TPS_MIN = 50;     // tps ≥ 50
  const CAS_FIRE_VOL_MULT = 2.2;    // vol ≥ 2.2 × avgVol3s
  const CAS_DISPLAY_MS = 2000;
  const CAS_COOLDOWN_MS = 10000;

  // ── State defaults ──────────────────────────────────────────────────
  const _swpDefault = () => ({
    active: false, dir: 0,
    movePct: 0, vol: 0, tps: 0,
    ts: 0, cooldownUntil: 0
  });

  // cascade also tracks arm phase internally
  const _casDefault = () => ({
    active: false, dir: 0,
    phase: 'idle',          // 'idle' | 'armed' | 'fired'
    vol: 0, tps: 0, move: 0,
    armTs: 0, ts: 0, cooldownUntil: 0
  });

  window.OF = window.OF || {};
  window.OF.sweep = _swpDefault();
  window.OF.cascade = _casDefault();

  // ═══════════════════════════════════════════════════════════════════
  // Shared helpers
  // ═══════════════════════════════════════════════════════════════════

  // Single-pass RAW_FLOW: stats for [cutFastMs] window + reference avgVol
  // Returns { buyVol, sellVol, totalVol, deltaPct, tps, avgVol, n }
  function _flowStats12(cutFastMs) {
    try {
      const buf = window.RAW_FLOW && window.RAW_FLOW.buf;
      if (!buf || !buf.length) return null;
      const now = Date.now();
      const cutFast = now - cutFastMs;
      const cutRef = now - SWP_REF_MS;
      let buyVol = 0, sellVol = 0, n = 0, volRef = 0;
      for (let i = buf.length - 1; i >= 0; i--) {
        const t = buf[i];
        if (t.ts < cutRef) break;
        volRef += t.q;
        if (t.ts >= cutFast) {
          n++;
          if (t.isBuyerMaker) sellVol += t.q;
          else buyVol += t.q;
        }
      }
      const totalVol = buyVol + sellVol;
      const denom = totalVol > 0 ? totalVol : 1e-9;
      const deltaPct = (buyVol - sellVol) / denom;
      const tps = n / (cutFastMs / 1000);
      // avg vol per fast-window-sized slice over reference period
      const avgVol = volRef / (SWP_REF_MS / cutFastMs);
      return { buyVol, sellVol, totalVol, deltaPct, tps, avgVol, n };
    } catch (_) { return null; }
  }

  // Price move % over last `ms` from OF_PRICE_BUF — single pass from tail
  function _priceMove12(ms) {
    try {
      const buf = window.OF_PRICE_BUF;
      if (!buf || buf.length < 2) return null;
      const cur = buf[buf.length - 1].price;
      const target = Date.now() - ms;
      for (let i = buf.length - 2; i >= 0; i--) {
        if (buf[i].ts <= target) {
          const old = buf[i].price;
          return (old > 0) ? (cur - old) / old * 100 : null;
        }
      }
      return null;
    } catch (_) { return null; }
  }

  // ═══════════════════════════════════════════════════════════════════
  // A) LIQUIDITY SWEEP DETECTOR
  // ═══════════════════════════════════════════════════════════════════
  window._tickSweepP12 = function () {
    try {
      const OF = window.OF;
      if (!OF || !OF.quality || !OF.quality.burned) return;

      const now = Date.now();
      const sw = OF.sweep;

      // Cooldown gate
      if (now < (sw.cooldownUntil || 0)) { sw.active = false; return; }

      // Display TTL expiry → cooldown
      if (sw.active && (now - sw.ts) > SWP_DISPLAY_MS) {
        const next = _swpDefault();
        next.cooldownUntil = now + SWP_COOLDOWN_MS;
        window.OF.sweep = next;
        return;
      }

      // Hold during active display
      if (sw.active) return;

      // Compute stats — 3s fast window, 10s reference
      const st = _flowStats12(SWP_WIN_MS);
      if (!st) return;
      const move3s = _priceMove12(SWP_WIN_MS);
      if (move3s === null) return;

      const condMove = Math.abs(move3s) >= SWP_MOVE_MIN;
      const condVol = st.totalVol >= SWP_VOL_MULT * st.avgVol;
      const condTps = st.tps >= SWP_TPS_MIN;

      if (condMove && condVol && condTps) {
        const dir = move3s > 0 ? 1 : -1;
        window.OF.sweep = {
          active: true,
          dir,
          movePct: move3s,
          vol: st.totalVol,
          tps: st.tps,
          ts: now,
          cooldownUntil: 0
        };
        try {
          if (typeof ZLOG !== 'undefined')
            ZLOG.push('AT',
              '[OF P12] SWEEP ' + (dir > 0 ? '▲UP' : '▼DOWN') +
              ' move=' + move3s.toFixed(3) + '%' +
              ' vol=' + st.totalVol.toFixed(0) +
              ' avgVol=' + st.avgVol.toFixed(0) +
              ' tps=' + st.tps.toFixed(1),
              { dir, move3s, vol: st.totalVol, tps: st.tps }
            );
        } catch (_) { }
      }
    } catch (_) { }
  };

  // ═══════════════════════════════════════════════════════════════════
  // B) STOP CASCADE DETECTOR (2-phase: arm → fire)
  // ═══════════════════════════════════════════════════════════════════
  window._tickCascadeP12 = function () {
    try {
      const OF = window.OF;
      if (!OF || !OF.quality || !OF.quality.burned) return;

      const now = Date.now();
      const cas = OF.cascade;
      const sw = OF.sweep || {};

      // Cooldown gate
      if (now < (cas.cooldownUntil || 0)) { cas.active = false; return; }

      // Display TTL expiry → cooldown
      if (cas.active && (now - cas.ts) > CAS_DISPLAY_MS) {
        const next = _casDefault();
        next.cooldownUntil = now + CAS_COOLDOWN_MS;
        window.OF.cascade = next;
        return;
      }

      // Hold during active display
      if (cas.active) return;

      // ── Phase 2: FIRE (if armed) ────────────────────────────────
      if (cas.phase === 'armed') {
        // Arm TTL check
        if ((now - cas.armTs) > CAS_ARM_TTL_MS) {
          const reset = _casDefault();
          reset.cooldownUntil = now + CAS_COOLDOWN_MS;
          window.OF.cascade = reset;
          return;
        }

        const st3 = _flowStats12(SWP_WIN_MS);  // 3s window, same as sweep
        if (!st3) return;
        const mv3 = _priceMove12(SWP_WIN_MS);
        if (mv3 === null) return;

        // Continuation in same direction?
        const sameDir = (cas.dir === 1 && mv3 > 0) || (cas.dir === -1 && mv3 < 0);
        const condTps = st3.tps >= CAS_FIRE_TPS_MIN;
        const condVol = st3.totalVol >= CAS_FIRE_VOL_MULT * st3.avgVol;

        if (sameDir && condTps && condVol) {
          window.OF.cascade = {
            active: true,
            dir: cas.dir,
            phase: 'fired',
            vol: st3.totalVol,
            tps: st3.tps,
            move: mv3,
            armTs: cas.armTs,
            ts: now,
            cooldownUntil: 0
          };
          try {
            if (typeof ZLOG !== 'undefined')
              ZLOG.push('AT',
                '[OF P12] CASCADE ' + (cas.dir > 0 ? '▲UP' : '▼DOWN') +
                ' vol=' + st3.totalVol.toFixed(0) +
                ' tps=' + st3.tps.toFixed(1) +
                ' move=' + mv3.toFixed(3) + '%',
                { dir: cas.dir, vol: st3.totalVol, tps: st3.tps, move: mv3 }
              );
          } catch (_) { }
        }
        return;
      }

      // ── Phase 1: ARM (if idle and recent sweep exists) ──────────
      if (cas.phase === 'idle') {
        // Need a fresh sweep
        const sweepAge = sw.ts ? (now - sw.ts) : Infinity;
        if (!sw.active && sweepAge > CAS_SWEEP_MAX_AGE) return;

        const st2 = _flowStats12(CAS_ARM_WIN_MS);  // 2s window
        if (!st2) return;
        const mv2 = _priceMove12(CAS_ARM_WIN_MS);
        if (mv2 === null) return;

        const condMove = Math.abs(mv2) >= CAS_ARM_MOVE_MIN;
        const condTps = st2.tps >= CAS_ARM_TPS_MIN;
        // ARM direction must match the sweep that spawned it
        const sweepDir = sw.dir || (mv2 > 0 ? 1 : -1);
        const sameDir = (sweepDir === 1 && mv2 > 0) || (sweepDir === -1 && mv2 < 0);

        if (condMove && condTps && sameDir) {
          window.OF.cascade = {
            active: false,
            dir: sweepDir,
            phase: 'armed',
            vol: st2.totalVol,
            tps: st2.tps,
            move: mv2,
            armTs: now,
            ts: 0,
            cooldownUntil: 0
          };
          try {
            if (typeof ZLOG !== 'undefined')
              ZLOG.push('AT',
                '[OF P12] CASCADE ARMED dir=' + (sweepDir > 0 ? '▲' : '▼') +
                ' move2s=' + mv2.toFixed(3) + '%' +
                ' tps=' + st2.tps.toFixed(1),
                { dir: sweepDir, move: mv2, tps: st2.tps }
              );
          } catch (_) { }
        }
      }
    } catch (_) { }
  };

  // ═══════════════════════════════════════════════════════════════════
  // Extend OF_DEBUG_SNAPSHOT with snap.sweep + snap.cascade
  // ═══════════════════════════════════════════════════════════════════
  function _patchSnapshot() {
    const _orig = window.OF_DEBUG_SNAPSHOT;
    if (typeof _orig !== 'function') return false;
    window.OF_DEBUG_SNAPSHOT = function () {
      const snap = _orig();
      try {
        const sw = (window.OF && window.OF.sweep) || {};
        const cas = (window.OF && window.OF.cascade) || {};
        snap.sweep = {
          active: !!sw.active,
          dir: sw.dir || 0,
          movePct: sw.movePct != null ? sw.movePct : null,
          vol: sw.vol != null ? sw.vol : null,
          tps: sw.tps != null ? sw.tps : null,
          ts: sw.ts || 0
        };
        snap.cascade = {
          active: !!cas.active,
          phase: cas.phase || 'idle',
          dir: cas.dir || 0,
          vol: cas.vol != null ? cas.vol : null,
          tps: cas.tps != null ? cas.tps : null,
          move: cas.move != null ? cas.move : null,
          ts: cas.ts || 0
        };
      } catch (_) { }
      return snap;
    };
    try { if (typeof ZLOG !== 'undefined') ZLOG.push('INFO', '[OF P12] OF_DEBUG_SNAPSHOT patched with sweep+cascade'); } catch (_) { }
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════
  // HUD injection — own MutationObserver, delay 60ms (after P10@30ms, P11@50ms)
  // Appends SWEEP + CASCADE rows at bottom of .detail — never touches earlier rows
  // ═══════════════════════════════════════════════════════════════════
  (function _patchHUD_P12() {

    // ── CSS ──────────────────────────────────────────────────────────
    (function () {
      const s = document.createElement('style');
      s.id = 'of-sweep-cascade-css';
      s.textContent = [
        // SWEEP chips
        '#of-hud .p12-swp-up   { color:#00ffa0; border-color:rgba(0,255,160,0.55);',
        '  box-shadow:0 0 12px rgba(0,255,160,0.30); animation:p12-pulse-g 0.9s ease-in-out infinite; }',
        '#of-hud .p12-swp-dn   { color:#ff4466; border-color:rgba(255,68,102,0.55);',
        '  box-shadow:0 0 12px rgba(255,68,102,0.30); animation:p12-pulse-r 0.9s ease-in-out infinite; }',
        // CASCADE chips
        '#of-hud .p12-cas-arm  { color:#ffc800; border-color:rgba(255,200,0,0.45);',
        '  box-shadow:0 0 8px rgba(255,200,0,0.25); }',
        '#of-hud .p12-cas-up   { color:#00ffa0; border-color:rgba(0,255,160,0.60);',
        '  box-shadow:0 0 16px rgba(0,255,160,0.45); animation:p12-flash-g 0.4s ease-in-out infinite; }',
        '#of-hud .p12-cas-dn   { color:#ff4466; border-color:rgba(255,68,102,0.60);',
        '  box-shadow:0 0 16px rgba(255,68,102,0.45); animation:p12-flash-r 0.4s ease-in-out infinite; }',
        '@keyframes p12-pulse-g { 0%,100%{opacity:1} 50%{opacity:0.50} }',
        '@keyframes p12-pulse-r { 0%,100%{opacity:1} 50%{opacity:0.50} }',
        '@keyframes p12-flash-g { 0%,100%{opacity:1;box-shadow:0 0 16px rgba(0,255,160,0.45)}',
        '                          50%{opacity:0.65;box-shadow:0 0 30px rgba(0,255,160,0.80)} }',
        '@keyframes p12-flash-r { 0%,100%{opacity:1;box-shadow:0 0 16px rgba(255,68,102,0.45)}',
        '                          50%{opacity:0.65;box-shadow:0 0 30px rgba(255,68,102,0.80)} }',
      ].join('\n');
      document.head.appendChild(s);
    })();

    // ── Helpers ───────────────────────────────────────────────────────
    const _chip = (t, c) => '<span class="chip ' + (c || 'muted') + '">' + t + '</span>';
    function _secsAgo(ts) { if (!ts) return '—'; return Math.floor((Date.now() - ts) / 1000) + 's ago'; }
    function _n(v, d) { return (v != null && isFinite(+v)) ? (+v).toFixed(d || 2) : '—'; }
    function _fmt(v) { // compact volume formatter
      if (v == null || !isFinite(+v)) return '—';
      v = +v;
      return v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(0);
    }

    // ── _inject: upsert SWEEP + CASCADE rows inside .detail ──────────
    function _inject(hudEl) {
      try {
        if (window.__OF_HUD_BUILT__) return;  // _render() owns these rows — do not overwrite
        const d = window.OF_DEBUG_SNAPSHOT ? window.OF_DEBUG_SNAPSHOT() : null;
        if (!d) return;

        const detail = hudEl.querySelector('.detail');
        if (!detail) return;   // collapsed — nothing to do

        // ── SWEEP row ───────────────────────────────────────────────
        let swpRow = detail.querySelector('.p12-swp-row');
        if (!swpRow) {
          swpRow = document.createElement('div');
          swpRow.className = 'row p12-swp-row';
          detail.appendChild(swpRow);
        }
        {
          const sw = d.sweep || {};
          const dirArrow = sw.dir === 1 ? ' ▲' : sw.dir === -1 ? ' ▼' : '';
          let stateChip;
          if (sw.active) {
            const cls = sw.dir === 1 ? 'p12-swp-up' : 'p12-swp-dn';
            stateChip = _chip('SWEEP' + dirArrow, cls);
          } else {
            stateChip = _chip('IDLE', 'idle');
          }
          const mvChip = sw.movePct != null ? _chip(_n(sw.movePct, 3) + '%', sw.active ? 'muted' : 'idle') : '';
          const volChip = sw.vol != null ? _chip('vol ' + _fmt(sw.vol), sw.active ? 'muted' : 'idle') : '';
          const tpsChip = sw.tps != null ? _chip(_n(sw.tps, 1) + ' t/s', sw.active ? 'muted' : 'idle') : '';
          swpRow.innerHTML =
            '<span class="lbl">SWEEP</span>' +
            stateChip + mvChip + volChip + tpsChip +
            '<span style="margin-left:auto;font-size:12px;color:#334">' + _secsAgo(sw.ts) + '</span>';
        }

        // ── CASCADE row ─────────────────────────────────────────────
        let casRow = detail.querySelector('.p12-cas-row');
        if (!casRow) {
          casRow = document.createElement('div');
          casRow.className = 'row p12-cas-row';
          detail.appendChild(casRow);
        }
        {
          const cas = d.cascade || {};
          const dirArrow = cas.dir === 1 ? ' ▲' : cas.dir === -1 ? ' ▼' : '';
          let stateChip;
          if (cas.active) {
            const cls = cas.dir === 1 ? 'p12-cas-up' : 'p12-cas-dn';
            stateChip = _chip('CASCADE' + dirArrow, cls);
          } else if (cas.phase === 'armed') {
            stateChip = _chip('ARMING' + dirArrow, 'p12-cas-arm');
          } else {
            stateChip = _chip('IDLE', 'idle');
          }
          const tpsChip = cas.tps != null ? _chip(_n(cas.tps, 1) + ' t/s', (cas.active || cas.phase === 'armed') ? 'muted' : 'idle') : '';
          const volChip = cas.vol != null ? _chip('vol ' + _fmt(cas.vol), (cas.active || cas.phase === 'armed') ? 'muted' : 'idle') : '';
          const mvChip = cas.move != null ? _chip(_n(cas.move, 3) + '%', (cas.active || cas.phase === 'armed') ? 'muted' : 'idle') : '';
          casRow.innerHTML =
            '<span class="lbl">CASCADE</span>' +
            stateChip + tpsChip + volChip + mvChip +
            '<span style="margin-left:auto;font-size:12px;color:#334">' + _secsAgo(cas.ts) + '</span>';
        }

      } catch (_) { }
    }

    // ── MutationObserver disabled: P12 rows managed by _buildDom() + _render() ──
    // If re-enabled: const obs = new MutationObserver(...); window.__OF_HUD_OBS.push(obs);
    function _startObserver() { /* no-op — observer owned by _buildDom() teardown */ }
    function _waitForHUD() { /* no-op */ }

  })();   // end _patchHUD_P12

  // ═══════════════════════════════════════════════════════════════════
  // Symbol change reset — chain setSymbol
  // ═══════════════════════════════════════════════════════════════════
  const _prevSSP12 = window.setSymbol;
  window.setSymbol = function (sym) {
    if (typeof _prevSSP12 === 'function') _prevSSP12(sym);
    try {
      if (window.OF) {
        window.OF.sweep = _swpDefault();
        window.OF.cascade = _casDefault();
      }
    } catch (_) { }
  };

  // ═══════════════════════════════════════════════════════════════════
  // Init — no new interval (tick registered in P45_tick via window refs)
  // ═══════════════════════════════════════════════════════════════════
  function _start() {
    if (!_patchSnapshot()) {
      let _r = 0;
      const _t = setInterval(function () {
        if (_patchSnapshot() || ++_r >= 20) clearInterval(_t);
      }, 500);
    }
    try {
      if (typeof ZLOG !== 'undefined')
        ZLOG.push('INFO',
          '[OF v121 P12] SWEEP+CASCADE ready' +
          ' (swpMove≥' + SWP_MOVE_MIN + '%' +
          ' swpVol×' + SWP_VOL_MULT +
          ' swpTps≥' + SWP_TPS_MIN +
          ' casFire≥' + CAS_FIRE_TPS_MIN + ' t/s)');
    } catch (_) { }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(_start, 2000); });
  } else {
    setTimeout(_start, 2000);
  }

})();

// ╔══════════════════════════════════════════════════════════════════╗
// ║  ZEUS ORDERFLOW v121 — PAS 13: LIQUIDITY MAGNET DETECTOR        ║
// ║  Reads S.llvBuckets (live liq clusters from WS feed).           ║
// ║  Detects when price is statistically drawn to a nearby cluster. ║
// ║  Watch-only. No exec. No new interval. Guard __ZEUS_OF_MAGNET__ ║
// ╚══════════════════════════════════════════════════════════════════╝
(function () {
  if (window.__ZEUS_OF_MAGNET__) return;
  window.__ZEUS_OF_MAGNET__ = true;

  // ── Config ──────────────────────────────────────────────────────────
  const MAG_DIST_MAX_PCT = 0.35;   // cluster must be within 0.35% of current price
  const MAG_STR_MIN = 1.6;    // clusterUSD must be ≥ 1.6 × avgClusterUSD
  const MAG_MIN_USD = 50000;  // ignore clusters below this USD (noise filter)
  const MAG_BUCKET_WINDOW = 50;     // max buckets to scan (single pass, sorted by proximity)
  const MAG_DISPLAY_MS = 4000;   // active display TTL
  const MAG_COOLDOWN_MS = 8000;   // cooldown after expiry
  const MAG_TW_MS = 7 * 24 * 3600 * 1000; // match LLV default 7d time window

  // ── State default ────────────────────────────────────────────────────
  const _magDefault = () => ({
    active: false,
    dir: 0,          // +1 = up, -1 = down
    targetPrice: null,
    distancePct: null,
    strength: null,
    conf: null,
    ts: 0,
    cooldownUntil: 0
  });

  window.OF = window.OF || {};
  window.OF.magnet = _magDefault();

  // ═══════════════════════════════════════════════════════════════════
  // Cluster scan — single pass over S.llvBuckets
  // Returns { nearestUp, nearestDown, avgUSD } where each nearest entry:
  //   { price, totalUSD, distPct }
  // ═══════════════════════════════════════════════════════════════════
  function _scanClusters(curPrice) {
    try {
      const buckets = window.S && window.S.llvBuckets;
      if (!buckets) return null;

      const now = Date.now();
      const cutoff = now - MAG_TW_MS;

      // Single pass — accumulate totals and find nearest above/below
      let totalUSD = 0;
      let count = 0;
      let nearUp = null;   // { price, totalUSD, distPct }
      let nearDn = null;

      const vals = Object.values(buckets);
      for (let i = 0; i < vals.length; i++) {
        const b = vals[i];
        if (!b || b.ts < cutoff) continue;
        const bUSD = (b.longUSD || 0) + (b.shortUSD || 0);
        if (bUSD < MAG_MIN_USD) continue;

        totalUSD += bUSD;
        count++;

        const bp = b.price;
        if (!bp || !isFinite(bp)) continue;
        const distPct = (bp - curPrice) / curPrice * 100;  // signed

        if (distPct > 0) {
          // cluster is above price
          if (!nearUp || distPct < nearUp.distPct) {
            nearUp = { price: bp, totalUSD: bUSD, distPct };
          }
        } else if (distPct < 0) {
          // cluster is below price
          if (!nearDn || distPct > nearDn.distPct) {
            nearDn = { price: bp, totalUSD: bUSD, distPct: Math.abs(distPct) };
          }
        }
      }

      if (!count) return null;
      const avgUSD = totalUSD / count;
      return { nearUp, nearDn, avgUSD };
    } catch (_) { return null; }
  }

  // ═══════════════════════════════════════════════════════════════════
  // MAGNET DETECTOR — registered as window._tickMagnetP13
  // Called from P45 _tick() via typeof guard
  // ═══════════════════════════════════════════════════════════════════
  window._tickMagnetP13 = function () {
    try {
      const OF = window.OF;
      if (!OF || !OF.quality || !OF.quality.burned) return;

      const now = Date.now();
      const mg = OF.magnet;

      // ── Cooldown gate ────────────────────────────────────────────
      if (now < (mg.cooldownUntil || 0)) { mg.active = false; return; }

      // ── Display TTL expiry → cooldown ────────────────────────────
      if (mg.active && (now - mg.ts) > MAG_DISPLAY_MS) {
        const next = _magDefault();
        next.cooldownUntil = now + MAG_COOLDOWN_MS;
        window.OF.magnet = next;
        return;
      }

      // Hold during active display
      if (mg.active) return;

      // ── Need live price ──────────────────────────────────────────
      const curPrice = window.S && Number.isFinite(window.S.price) ? window.S.price : null;
      if (!curPrice) return;

      // ── Scan clusters ────────────────────────────────────────────
      const scan = _scanClusters(curPrice);
      if (!scan) return;

      const { nearUp, nearDn, avgUSD } = scan;

      // Pick the candidate: must exist, within distance cap
      // Prefer the closer one; if same distance, pick stronger
      const candidates = [];
      if (nearUp && nearUp.distPct <= MAG_DIST_MAX_PCT) {
        candidates.push({ dir: 1, entry: nearUp });
      }
      if (nearDn && nearDn.distPct <= MAG_DIST_MAX_PCT) {
        candidates.push({ dir: -1, entry: nearDn });
      }
      if (!candidates.length) return;

      // Sort: closer first, then stronger on tie
      candidates.sort(function (a, b) {
        const da = a.entry.distPct, db = b.entry.distPct;
        if (Math.abs(da - db) > 0.001) return da - db;
        return b.entry.totalUSD - a.entry.totalUSD;
      });

      const best = candidates[0];
      const cl = best.entry;

      // ── Strength check ───────────────────────────────────────────
      const strength = avgUSD > 0 ? cl.totalUSD / avgUSD : 0;
      if (strength < MAG_STR_MIN) return;

      // ── Confidence: inversely proportional to distance ───────────
      // conf = clamp(0,100, strength × (1 / distPct))
      // distPct clamped to ≥ 0.001 to avoid division explosion
      const distSafe = Math.max(cl.distPct, 0.001);
      const conf = Math.min(100, Math.round(strength * (1 / distSafe)));

      // ── Fire ─────────────────────────────────────────────────────
      window.OF.magnet = {
        active: true,
        dir: best.dir,
        targetPrice: cl.price,
        distancePct: cl.distPct,
        strength,
        conf,
        ts: now,
        cooldownUntil: 0
      };

      try {
        if (typeof ZLOG !== 'undefined')
          ZLOG.push('AT',
            '[OF P13] MAGNET ' + (best.dir > 0 ? '▲UP' : '▼DOWN') +
            ' target=' + cl.price.toFixed(2) +
            ' dist=' + cl.distPct.toFixed(3) + '%' +
            ' str=' + strength.toFixed(2) +
            ' conf=' + conf + '%' +
            ' clUSD=' + (cl.totalUSD / 1e6).toFixed(2) + 'M' +
            ' avgUSD=' + (avgUSD / 1e6).toFixed(2) + 'M',
            { dir: best.dir, target: cl.price, distPct: cl.distPct, strength, conf }
          );
      } catch (_) { }

    } catch (_) { }
  };

  // ═══════════════════════════════════════════════════════════════════
  // Extend OF_DEBUG_SNAPSHOT with snap.magnet
  // ═══════════════════════════════════════════════════════════════════
  function _patchSnapshot() {
    const _orig = window.OF_DEBUG_SNAPSHOT;
    if (typeof _orig !== 'function') return false;
    window.OF_DEBUG_SNAPSHOT = function () {
      const snap = _orig();
      try {
        const mg = (window.OF && window.OF.magnet) || {};
        snap.magnet = {
          active: !!mg.active,
          dir: mg.dir || 0,
          target: mg.targetPrice != null ? mg.targetPrice : null,
          distance: mg.distancePct != null ? mg.distancePct : null,
          strength: mg.strength != null ? mg.strength : null,
          conf: mg.conf != null ? mg.conf : null,
          ts: mg.ts || 0
        };
      } catch (_) { }
      return snap;
    };
    try { if (typeof ZLOG !== 'undefined') ZLOG.push('INFO', '[OF P13] OF_DEBUG_SNAPSHOT patched with magnet'); } catch (_) { }
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════
  // HUD injection — own MutationObserver, delay 70ms
  // (after P10@30ms → P11@50ms → P12@60ms → P13@70ms)
  // Appends MAGNET row at bottom of .detail — never touches earlier rows
  // ═══════════════════════════════════════════════════════════════════
  (function _patchHUD_P13() {

    // ── CSS ──────────────────────────────────────────────────────────
    (function () {
      const s = document.createElement('style');
      s.id = 'of-magnet-css';
      s.textContent = [
        '#of-hud .p13-mag-up { color:#00ffa0; border-color:rgba(0,255,160,0.55);',
        '  box-shadow:0 0 12px rgba(0,255,160,0.32); animation:p13-pull-g 1.2s ease-in-out infinite; }',
        '#of-hud .p13-mag-dn { color:#ff4466; border-color:rgba(255,68,102,0.55);',
        '  box-shadow:0 0 12px rgba(255,68,102,0.32); animation:p13-pull-r 1.2s ease-in-out infinite; }',
        '#of-hud .p13-conf   { color:#cc88ff; border-color:rgba(200,136,255,0.35);',
        '  box-shadow:0 0 6px rgba(200,136,255,0.18); }',
        '@keyframes p13-pull-g {',
        '  0%{opacity:0.6;box-shadow:0 0 6px rgba(0,255,160,0.15)}',
        '  50%{opacity:1;box-shadow:0 0 18px rgba(0,255,160,0.55)}',
        '  100%{opacity:0.6;box-shadow:0 0 6px rgba(0,255,160,0.15)} }',
        '@keyframes p13-pull-r {',
        '  0%{opacity:0.6;box-shadow:0 0 6px rgba(255,68,102,0.15)}',
        '  50%{opacity:1;box-shadow:0 0 18px rgba(255,68,102,0.55)}',
        '  100%{opacity:0.6;box-shadow:0 0 6px rgba(255,68,102,0.15)} }',
      ].join('\n');
      document.head.appendChild(s);
    })();

    // ── Helpers ───────────────────────────────────────────────────────
    const _chip = (t, c) => '<span class="chip ' + (c || 'muted') + '">' + t + '</span>';
    const _n = (v, d) => (v != null && isFinite(+v)) ? (+v).toFixed(d || 2) : '—';
    function _secsAgo(ts) { if (!ts) return '—'; return Math.floor((Date.now() - ts) / 1000) + 's ago'; }
    function _fmtPrice(v) {
      if (v == null || !isFinite(+v)) return '—';
      v = +v;
      return v >= 1000 ? v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : v.toFixed(2);
    }

    // ── _inject: upsert MAGNET row inside .detail ─────────────────────
    function _inject(hudEl) {
      try {
        if (window.__OF_HUD_BUILT__) return;  // _render() owns these rows — do not overwrite
        const d = window.OF_DEBUG_SNAPSHOT ? window.OF_DEBUG_SNAPSHOT() : null;
        if (!d) return;

        const detail = hudEl.querySelector('.detail');
        if (!detail) return;   // collapsed

        let mgRow = detail.querySelector('.p13-mag-row');
        if (!mgRow) {
          mgRow = document.createElement('div');
          mgRow.className = 'row p13-mag-row';
          detail.appendChild(mgRow);
        }

        const mg = d.magnet || {};
        const dirArrow = mg.dir === 1 ? ' ▲' : mg.dir === -1 ? ' ▼' : '';

        let stateChip;
        if (mg.active) {
          const cls = mg.dir === 1 ? 'p13-mag-up' : 'p13-mag-dn';
          stateChip = _chip('MAGNET' + dirArrow, cls);
        } else {
          stateChip = _chip('IDLE', 'idle');
        }

        const tgtChip = mg.target != null ? _chip('→ ' + _fmtPrice(mg.target), mg.active ? 'muted' : 'idle') : '';
        const distChip = mg.distance != null ? _chip(_n(mg.distance, 3) + '%', mg.active ? 'muted' : 'idle') : '';
        const confChip = mg.conf != null ? _chip('conf ' + mg.conf + '%', mg.active ? 'p13-conf' : 'idle') : '';
        const strChip = mg.strength != null ? _chip('str×' + _n(mg.strength, 2), mg.active ? 'muted' : 'idle') : '';

        mgRow.innerHTML =
          '<span class="lbl">MAGNET</span>' +
          stateChip + tgtChip + distChip + strChip + confChip +
          '<span style="margin-left:auto;font-size:12px;color:#334">' + _secsAgo(mg.ts) + '</span>';

      } catch (_) { }
    }

    // ── MutationObserver disabled: P13 rows managed by _buildDom() + _render() ──
    // If re-enabled: const obs = new MutationObserver(...); window.__OF_HUD_OBS.push(obs);
    function _startObserver() { /* no-op — observer owned by _buildDom() teardown */ }
    function _waitForHUD() { /* no-op */ }

  })();   // end _patchHUD_P13

  // ═══════════════════════════════════════════════════════════════════
  // Symbol change reset — chain setSymbol
  // ═══════════════════════════════════════════════════════════════════
  const _prevSSP13 = window.setSymbol;
  window.setSymbol = function (sym) {
    if (typeof _prevSSP13 === 'function') _prevSSP13(sym);
    try {
      if (window.OF) window.OF.magnet = _magDefault();
    } catch (_) { }
  };

  // ═══════════════════════════════════════════════════════════════════
  // Init — no new interval (registered on window, called from P45)
  // ═══════════════════════════════════════════════════════════════════
  function _start() {
    if (!_patchSnapshot()) {
      let _r = 0;
      const _t = setInterval(function () {
        if (_patchSnapshot() || ++_r >= 20) clearInterval(_t);
      }, 500);
    }
    try {
      if (typeof ZLOG !== 'undefined')
        ZLOG.push('INFO',
          '[OF v121 P13] LIQUIDITY MAGNET ready' +
          ' (dist≤' + MAG_DIST_MAX_PCT + '%' +
          ' str≥' + MAG_STR_MIN +
          ' minUSD=$' + (MAG_MIN_USD / 1000).toFixed(0) + 'k' +
          ' ttl=' + MAG_DISPLAY_MS + 'ms)');
    } catch (_) { }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(_start, 2100); });
  } else {
    setTimeout(_start, 2100);
  }

})();

// ╔══════════════════════════════════════════════════════════════════╗
// ║  ZEUS ORDERFLOW v121 — PAS 14: LIQUIDITY VOID DETECTOR          ║
// ║  Low vol + low trade count → potential acceleration corridor.   ║
// ║  Watch-only. No exec. No new interval. Guard __ZEUS_OF_VOID__   ║
// ╚══════════════════════════════════════════════════════════════════╝
(function () {
  if (window.__ZEUS_OF_VOID__) return;
  window.__ZEUS_OF_VOID__ = true;

  // ── Config ──────────────────────────────────────────────────────────
  const VOI_FAST_MS = 4000;   // measurement window (4s)
  const VOI_REF_MS = 20000;  // reference window for avgVol baseline (20s)
  const VOI_SCORE_MIN = 0.65;   // voidScore ≥ 0.65 to trigger
  const VOI_TRADES_MAX = 25;     // tradeCount4s ≤ 25
  const VOI_DIR_MS = 3000;   // price move window for direction hint
  const VOI_DISPLAY_MS = 3000;   // active display TTL
  const VOI_COOLDOWN_MS = 8000;   // cooldown after expiry

  // ── State default ────────────────────────────────────────────────────
  const _voiDefault = () => ({
    active: false,
    dir: 0,       // +1=UP, -1=DOWN, 0=?
    voidScore: 0,
    vol4s: 0,
    trades: 0,
    movePct: null,
    ts: 0,
    cooldownUntil: 0
  });

  window.OF = window.OF || {};
  window.OF.void = _voiDefault();

  // ═══════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════

  // Single pass from tail: fast vol + trade count (cutFast),
  // ref vol accumulation (cutRef), early break at cutRef.
  function _flowStatsVoid() {
    try {
      const buf = window.RAW_FLOW && window.RAW_FLOW.buf;
      if (!buf || !buf.length) return null;
      const now = Date.now();
      const cutFast = now - VOI_FAST_MS;
      const cutRef = now - VOI_REF_MS;
      let vol4s = 0, n4s = 0, volRef = 0;
      for (let i = buf.length - 1; i >= 0; i--) {
        const t = buf[i];
        if (t.ts < cutRef) break;         // beyond reference window — stop
        volRef += t.q;                    // accumulate full reference vol
        if (t.ts >= cutFast) {            // within fast window
          vol4s += t.q;
          n4s++;
        }
      }
      // avgVol4s = volRef scaled to same window length as fast window
      const avgVol4s = volRef / (VOI_REF_MS / VOI_FAST_MS);
      return { vol4s, n4s, avgVol4s };
    } catch (_) { return null; }
  }

  // Price move % over last `ms` from OF_PRICE_BUF — single pass from tail
  function _priceMove(ms) {
    try {
      const buf = window.OF_PRICE_BUF;
      if (!buf || buf.length < 2) return null;
      const cur = buf[buf.length - 1].price;
      const target = Date.now() - ms;
      for (let i = buf.length - 2; i >= 0; i--) {
        if (buf[i].ts <= target) {
          const old = buf[i].price;
          return (old > 0) ? (cur - old) / old * 100 : null;
        }
      }
      return null;
    } catch (_) { return null; }
  }

  // ═══════════════════════════════════════════════════════════════════
  // VOID DETECTOR — registered as window._tickVoidP14
  // Called from P45 _tick() via typeof guard — no new interval
  // ═══════════════════════════════════════════════════════════════════
  window._tickVoidP14 = function () {
    try {
      const OF = window.OF;
      if (!OF || !OF.quality || !OF.quality.burned) return;

      const now = Date.now();
      const vd = OF.void;

      // Cooldown gate
      if (now < (vd.cooldownUntil || 0)) { vd.active = false; return; }

      // Display TTL expiry → cooldown
      if (vd.active && (now - vd.ts) > VOI_DISPLAY_MS) {
        const next = _voiDefault();
        next.cooldownUntil = now + VOI_COOLDOWN_MS;
        window.OF.void = next;
        return;
      }

      // Hold during active display
      if (vd.active) return;

      // Compute flow stats (single pass — fast + ref in one sweep)
      const st = _flowStatsVoid();
      if (!st) return;

      // voidScore = 1 − (vol4s / max(avgVol4s, 1))
      // Clamped to [0, 1]: negative means unusually busy, not a void
      const voidScore = Math.max(0, Math.min(1, 1 - (st.vol4s / Math.max(st.avgVol4s, 1))));

      if (voidScore < VOI_SCORE_MIN) return;
      if (st.n4s > VOI_TRADES_MAX) return;

      // Direction hint from recent price move
      const movePct = _priceMove(VOI_DIR_MS);
      const dir = (movePct === null) ? 0
        : (movePct > 0.005) ? 1
          : (movePct < -0.005) ? -1
            : 0;

      window.OF.void = {
        active: true,
        dir,
        voidScore,
        vol4s: st.vol4s,
        trades: st.n4s,
        movePct: movePct !== null ? movePct : 0,
        ts: now,
        cooldownUntil: 0
      };

      try {
        if (typeof ZLOG !== 'undefined')
          ZLOG.push('AT',
            '[OF P14] VOID ' +
            (dir === 1 ? '▲UP' : dir === -1 ? '▼DOWN' : '?') +
            ' score=' + voidScore.toFixed(3) +
            ' vol4s=' + st.vol4s.toFixed(0) +
            ' avgVol=' + st.avgVol4s.toFixed(0) +
            ' trades=' + st.n4s +
            ' move=' + (movePct !== null ? movePct.toFixed(3) + '%' : 'null'),
            { dir, voidScore, vol4s: st.vol4s, trades: st.n4s, movePct }
          );
      } catch (_) { }

    } catch (_) { }
  };

  // ═══════════════════════════════════════════════════════════════════
  // Extend OF_DEBUG_SNAPSHOT with snap.void
  // ═══════════════════════════════════════════════════════════════════
  function _patchSnapshot() {
    const _orig = window.OF_DEBUG_SNAPSHOT;
    if (typeof _orig !== 'function') return false;
    window.OF_DEBUG_SNAPSHOT = function () {
      const snap = _orig();
      try {
        const vd = (window.OF && window.OF.void) || {};
        snap['void'] = {
          active: !!vd.active,
          dir: vd.dir || 0,
          voidScore: vd.voidScore != null ? vd.voidScore : null,
          vol: vd.vol4s != null ? vd.vol4s : null,
          trades: vd.trades != null ? vd.trades : null,
          move: vd.movePct != null ? vd.movePct : null,
          ts: vd.ts || 0
        };
      } catch (_) { }
      return snap;
    };
    try { if (typeof ZLOG !== 'undefined') ZLOG.push('INFO', '[OF P14] OF_DEBUG_SNAPSHOT patched with void'); } catch (_) { }
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════
  // HUD injection — own MutationObserver, delay 80ms
  // Chain: P10@30 → P11@50 → P12@60 → P13@70 → P14@80ms
  // Appends VOID row at bottom of .detail — never touches earlier rows
  // ═══════════════════════════════════════════════════════════════════
  (function _patchHUD_P14() {

    // ── CSS ──────────────────────────────────────────────────────────
    (function () {
      const s = document.createElement('style');
      s.id = 'of-void-css';
      s.textContent = [
        // VOID ▲ — neon cyan
        '#of-hud .p14-voi-up { color:#00e5ff; border-color:rgba(0,229,255,0.50);',
        '  box-shadow:0 0 12px rgba(0,229,255,0.30);',
        '  animation:p14-void-c 1.0s ease-in-out infinite; }',
        // VOID ▼ — neon purple
        '#of-hud .p14-voi-dn { color:#cc44ff; border-color:rgba(204,68,255,0.50);',
        '  box-shadow:0 0 12px rgba(204,68,255,0.30);',
        '  animation:p14-void-p 1.0s ease-in-out infinite; }',
        // VOID ? — neutral dim
        '#of-hud .p14-voi-un { color:#44aacc; border-color:rgba(68,170,204,0.35); }',
        // score chip
        '#of-hud .p14-score  { color:#00e5ff; border-color:rgba(0,229,255,0.30); }',
        // keyframes
        '@keyframes p14-void-c {',
        '  0%,100%{opacity:0.55;box-shadow:0 0 6px rgba(0,229,255,0.15)}',
        '  50%{opacity:1;box-shadow:0 0 20px rgba(0,229,255,0.60)} }',
        '@keyframes p14-void-p {',
        '  0%,100%{opacity:0.55;box-shadow:0 0 6px rgba(204,68,255,0.15)}',
        '  50%{opacity:1;box-shadow:0 0 20px rgba(204,68,255,0.60)} }',
      ].join('\n');
      document.head.appendChild(s);
    })();

    // ── Helpers ───────────────────────────────────────────────────────
    const _chip = (t, c) => '<span class="chip ' + (c || 'muted') + '">' + t + '</span>';
    const _n = (v, d) => (v != null && isFinite(+v)) ? (+v).toFixed(d == null ? 2 : d) : '—';
    function _secsAgo(ts) { if (!ts) return '—'; return Math.floor((Date.now() - ts) / 1000) + 's ago'; }
    function _fmtVol(v) {
      if (v == null || !isFinite(+v)) return '—';
      v = +v;
      return v >= 1e6 ? (v / 1e6).toFixed(2) + 'M'
        : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K'
          : v.toFixed(0);
    }

    // ── _inject: upsert VOID row inside .detail ───────────────────────
    function _inject(hudEl) {
      try {
        if (window.__OF_HUD_BUILT__) return;  // _render() owns these rows — do not overwrite
        const d = window.OF_DEBUG_SNAPSHOT ? window.OF_DEBUG_SNAPSHOT() : null;
        if (!d) return;

        const detail = hudEl.querySelector('.detail');
        if (!detail) return;   // collapsed

        let vRow = detail.querySelector('.p14-voi-row');
        if (!vRow) {
          vRow = document.createElement('div');
          vRow.className = 'row p14-voi-row';
          detail.appendChild(vRow);
        }

        const vd = d['void'] || {};
        const dirArrow = vd.dir === 1 ? ' ▲' : vd.dir === -1 ? ' ▼' : ' ?';

        let stateChip;
        if (vd.active) {
          const cls = vd.dir === 1 ? 'p14-voi-up'
            : vd.dir === -1 ? 'p14-voi-dn'
              : 'p14-voi-un';
          stateChip = _chip('VOID' + dirArrow, cls);
        } else {
          stateChip = _chip('IDLE', 'idle');
        }

        const scoreChip = vd.voidScore != null
          ? _chip('score ' + _n(vd.voidScore, 2), vd.active ? 'p14-score' : 'idle') : '';
        const tradeChip = vd.trades != null
          ? _chip(vd.trades + ' tr', vd.active ? 'muted' : 'idle') : '';
        const volChip = vd.vol != null
          ? _chip('vol ' + _fmtVol(vd.vol), vd.active ? 'muted' : 'idle') : '';
        const moveChip = vd.move != null
          ? _chip(_n(vd.move, 3) + '%', vd.active ? 'muted' : 'idle') : '';

        vRow.innerHTML =
          '<span class="lbl">VOID</span>' +
          stateChip + scoreChip + tradeChip + volChip + moveChip +
          '<span style="margin-left:auto;font-size:12px;color:#334">' + _secsAgo(vd.ts) + '</span>';

      } catch (_) { }
    }

    // ── MutationObserver disabled: P14 rows managed by _buildDom() + _render() ──
    // If re-enabled: const obs = new MutationObserver(...); window.__OF_HUD_OBS.push(obs);
    function _startObserver() { /* no-op — observer owned by _buildDom() teardown */ }
    function _waitForHUD() { /* no-op */ }

  })();   // end _patchHUD_P14

  // ═══════════════════════════════════════════════════════════════════
  // Symbol change reset — chain setSymbol
  // ═══════════════════════════════════════════════════════════════════
  const _prevSSP14 = window.setSymbol;
  window.setSymbol = function (sym) {
    if (typeof _prevSSP14 === 'function') _prevSSP14(sym);
    try { if (window.OF) window.OF.void = _voiDefault(); } catch (_) { }
  };

  // ═══════════════════════════════════════════════════════════════════
  // Init — no new interval; patch snapshot with retry
  // ═══════════════════════════════════════════════════════════════════
  function _start() {
    if (!_patchSnapshot()) {
      let _r = 0;
      const _t = setInterval(function () {
        if (_patchSnapshot() || ++_r >= 20) clearInterval(_t);
      }, 500);
    }
    try {
      if (typeof ZLOG !== 'undefined')
        ZLOG.push('INFO',
          '[OF v121 P14] LIQUIDITY VOID ready' +
          ' (win=' + VOI_FAST_MS + 'ms' +
          ' score≥' + VOI_SCORE_MIN +
          ' trades≤' + VOI_TRADES_MAX +
          ' ttl=' + VOI_DISPLAY_MS + 'ms)');
    } catch (_) { }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(_start, 2200); });
  } else {
    setTimeout(_start, 2200);
  }

})();

// ===== MODULE: QUANT (P15) =====
// ╔══════════════════════════════════════════════════════════════════╗
// ║  ZEUS ORDERFLOW v122 — QUANT DETECTORS P15                      ║
// ║  Read-only. Writes only to window.OF.quant = {wall,stopRun,smf} ║
// ║  No exec, no DOM, no WS. Throttled 200ms.                       ║
// ╚══════════════════════════════════════════════════════════════════╝
(function () {
  if (window.__ZEUS_OF_QUANT__) return;
  window.__ZEUS_OF_QUANT__ = true;

  // ── Internal state ────────────────────────────────────────────────
  const _qState = {
    wall: { lastPrice: null, stableCount: 0, lastReason: null, lastReasonTs: 0 },
    stopRun: { prevPrice: null, prevTs: null, lastReason: null, lastReasonTs: 0 },
    smf: { lastReason: null, lastReasonTs: 0 },
  };

  // ── Throttled console.debug — max once per 5s per detector ───────
  // Only fires when reason changes or on first run
  const _DBG_THROTTLE = 5000;
  function _dbg(key, reason, extra) {
    const st = _qState[key];
    const now = Date.now();
    if (reason === st.lastReason && (now - st.lastReasonTs) < _DBG_THROTTLE) return;
    st.lastReason = reason;
    st.lastReasonTs = now;
    console.debug('[QUANT/' + key.toUpperCase() + '] reason=' + reason, extra || '');
  }

  // ── Utility ───────────────────────────────────────────────────────
  function _clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function _median(sorted) {
    const m = sorted.length;
    if (!m) return 0;
    return m % 2 === 1 ? sorted[(m - 1) >> 1] : (sorted[(m - 2) >> 1] + sorted[m >> 1]) / 2;
  }
  // Null result template (safe return when inputs are missing)
  const _nullWall = (reason, now) => ({ wallSide: null, wallPrice: null, wallStrength: 0, wallPct: null, stale: true, reason, ts: now });
  const _nullStop = (reason, now) => ({ probUp: 0, probDn: 0, lvlUp: null, lvlDn: null, cls: 0, reason, ts: now });
  const _nullSmf = (reason, now) => ({ footprintBias: 'NEUT', accumScore: 0, largeTradeRatio: 0, divergence: false, ltr: 0, reason, ts: now });

  // ── Price source helpers (Wall + StopRun only — SMF uses RAW_FLOW) ─
  function _quantSymKey(sym) {
    try { return (sym || '').toUpperCase().trim(); } catch (e) { return ''; }
  }
  function _getQuantPx() {
    var s = (window.S || {});
    var sym = _quantSymKey(s.symbol);
    var ap = (window.allPrices || window.allP || window.PRICES || null);
    var p1 = (typeof s.price === 'number' && s.price > 0) ? s.price : 0;
    var p2 = 0;
    if (ap && sym && typeof ap[sym] === 'number' && ap[sym] > 0) p2 = ap[sym];
    var p3 = (typeof s.prevPrice === 'number' && s.prevPrice > 0) ? s.prevPrice : 0;
    var p4 = 0;
    try {
      if (Array.isArray(s.klines) && s.klines.length) {
        var last = s.klines[s.klines.length - 1];
        if (last && typeof last.close === 'number' && last.close > 0) p4 = last.close;
      }
    } catch (e) { }
    return p1 || p2 || p3 || p4 || 0;
  }

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  1) LIQUIDITY WALL DETECTOR                                  ║
  // ╚══════════════════════════════════════════════════════════════╝
  function _detectWall(now) {
    try {
      const S = window.S || {};

      // ── Input validation + reason ─────────────────────────────
      // S.bids / S.asks are set by depth20 WS message handler (confirmed)
      const bids = (S.bids && S.bids.length) ? S.bids : null;
      const asks = (S.asks && S.asks.length) ? S.asks : null;
      const px = _getQuantPx();  // [v122] single helper — see _getQuantPx above
      const mid = px > 0 ? px : 0;

      if (!mid) { _dbg('wall', 'no_price'); return _nullWall('no_price', now); }
      if (!bids) { _dbg('wall', 'no_orderbook', { bidsLen: (S.bids || []).length, asksLen: (S.asks || []).length }); return _nullWall('no_orderbook', now); }
      if (!asks) { _dbg('wall', 'no_orderbook', { bidsLen: (S.bids || []).length, asksLen: (S.asks || []).length }); return _nullWall('no_orderbook', now); }

      const N = 30;    // top levels to inspect
      const STRENGTH_MIN = 5;     // >=5× median to qualify (was 6 — loosened one notch)
      const DIST_MAX_PCT = 1.5;   // ignore walls > 1.5% from mid

      function _findWall(levels, isBid) {
        const top = levels.slice(0, Math.min(N, levels.length));
        if (top.length < 5) return null;
        const sorted = top.map(l => l.q).sort((a, b) => a - b);
        const med = _median(sorted);
        if (!med) return null;

        let best = null, bestRaw = 0;
        for (const l of top) {
          const raw = l.q / med;
          const dist = Math.abs(l.p - mid) / mid * 100;
          if (raw >= STRENGTH_MIN && raw > bestRaw && dist <= DIST_MAX_PCT) {
            bestRaw = raw; best = l;
          }
        }
        if (!best) return null;
        return {
          side: isBid ? 'BID' : 'ASK',
          price: best.p,
          wallStrength: _clamp01(Math.log(bestRaw) / Math.log(20)),
          distPct: Math.abs(best.p - mid) / mid * 100,
        };
      }

      const bWall = _findWall(bids, true);
      const aWall = _findWall(asks, false);
      let chosen = null;
      if (bWall && aWall) chosen = bWall.wallStrength >= aWall.wallStrength ? bWall : aWall;
      else chosen = bWall || aWall;

      if (!chosen) {
        _qState.wall.lastPrice = null;
        _qState.wall.stableCount = 0;
        _dbg('wall', 'no_wall_found', { bidLevels: bids.length, askLevels: asks.length });
        return _nullWall('no_wall_found', now);
      }

      // Stability: price must stay within ±$3 for 3+ consecutive ticks
      const TICK = 3.0;
      const prev = _qState.wall.lastPrice;
      const held = prev !== null && Math.abs(chosen.price - prev) <= TICK;
      _qState.wall.stableCount = held ? _qState.wall.stableCount + 1 : 1;
      _qState.wall.lastPrice = chosen.price;

      const stable = _qState.wall.stableCount >= 3;
      _dbg('wall', stable ? 'ok' : 'stabilizing', { side: chosen.side, price: chosen.price, cnt: _qState.wall.stableCount });

      return {
        wallSide: chosen.side,
        wallPrice: +chosen.price.toFixed(1),
        wallStrength: +chosen.wallStrength.toFixed(3),
        wallPct: +chosen.distPct.toFixed(3),
        stale: !stable,
        reason: stable ? 'ok' : 'stabilizing',
        ts: now,
      };
    } catch (e) {
      _dbg('wall', 'error:' + (e && e.message));
      return _nullWall('error', now);
    }
  }

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  2) STOP RUN PREDICTOR                                       ║
  // ╚══════════════════════════════════════════════════════════════╝
  function _detectStopRun(now) {
    try {
      const S = window.S || {};
      const OF = window.OF || {};
      const px = _getQuantPx();  // [v122] single helper — see _getQuantPx above
      const price = px > 0 ? px : 0;
      const klines = S.klines || [];

      if (!price) { _dbg('stopRun', 'no_price'); return _nullStop('no_price', now); }
      if (klines.length < 10) { _dbg('stopRun', 'no_klines', { n: klines.length }); return _nullStop('no_klines', now); }

      // Swing H/L: last ~48 candles (~4h on 5m)
      const recent = klines.slice(-48);
      let hiPrice = price, loPrice = price;
      for (const k of recent) {
        if (k.high > hiPrice) hiPrice = k.high;
        if (k.low < loPrice) loPrice = k.low;
      }
      const distUp = (hiPrice - price) / price * 100;
      const distDn = (price - loPrice) / price * 100;

      // Price velocity
      let impulse = 0;
      const prev = _qState.stopRun.prevPrice;
      const prevT = _qState.stopRun.prevTs;
      if (prev && prevT && (now - prevT) < 10000) {
        impulse = _clamp01(Math.abs((price - prev) / prev * 100) / 0.18);
      }
      _qState.stopRun.prevPrice = price;
      _qState.stopRun.prevTs = now;

      // Flow bias
      const flow = OF.flow || {};
      const bias = typeof flow.bias === 'number' ? flow.bias : 0;
      const flowB = _clamp01(bias);
      const flowR = _clamp01(-bias);

      const NEAR = 0.35;
      const nearUp = distUp < NEAR;
      const nearDn = distDn < NEAR;

      if (!nearUp && !nearDn) {
        _dbg('stopRun', 'ok', { distUp: distUp.toFixed(3), distDn: distDn.toFixed(3) });
        return { probUp: 0, probDn: 0, lvlUp: +hiPrice.toFixed(1), lvlDn: +loPrice.toFixed(1), cls: 0, reason: 'ok', ts: now };
      }

      // Bonus signals (read-only)
      const trap = OF.trap || {};
      const vac = OF.vacuum || {};
      const wall = (OF.quant && OF.quant.wall) || {};
      const trapUpBonus = (trap.active && trap.dir === 'SHORT') ? 0.12 : 0;
      const trapDnBonus = (trap.active && trap.dir === 'LONG') ? 0.12 : 0;
      const vacBonus = vac.active ? 0.08 : 0;
      const wallAskB = (wall.wallSide === 'ASK' && wall.wallStrength > 0.55 && !wall.stale) ? 0.08 : 0;
      const wallBidB = (wall.wallSide === 'BID' && wall.wallStrength > 0.55 && !wall.stale) ? 0.08 : 0;

      const probUp = nearUp ? _clamp01(0.35 + 0.25 * impulse + 0.18 * flowB + trapUpBonus + vacBonus + wallAskB) : 0;
      const probDn = nearDn ? _clamp01(0.35 + 0.25 * impulse + 0.18 * flowR + trapDnBonus + vacBonus + wallBidB) : 0;

      _dbg('stopRun', 'ok', { nearUp, nearDn, probUp: probUp.toFixed(2), probDn: probDn.toFixed(2) });
      return {
        probUp: +probUp.toFixed(2),
        probDn: +probDn.toFixed(2),
        lvlUp: +hiPrice.toFixed(1),
        lvlDn: +loPrice.toFixed(1),
        cls: +Math.max(probUp, probDn).toFixed(2),
        reason: 'ok',
        ts: now,
      };
    } catch (e) {
      _dbg('stopRun', 'error:' + (e && e.message));
      return _nullStop('error', now);
    }
  }

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  3) SMART MONEY FOOTPRINT                                    ║
  // ╚══════════════════════════════════════════════════════════════╝
  function _detectSMF(now) {
    try {
      const RF = window.RAW_FLOW || {};
      const buf = RF.buf || [];

      if (!buf.length) { _dbg('smf', 'no_buf'); return _nullSmf('no_buf', now); }

      const WIN = 60000;
      const cut = now - WIN;

      // Efficient backward scan — stops as soon as we've found the window start
      let start = buf.length;
      while (start > 0 && buf[start - 1].ts >= cut) start--;
      const trades = buf.slice(start);

      const MIN_TRADES = 10;
      if (trades.length < MIN_TRADES) {
        _dbg('smf', 'buf_warmup', { n: trades.length, need: MIN_TRADES });
        return _nullSmf('buf_warmup', now);
      }

      const sizes = trades.map(t => t.q).sort((a, b) => a - b);
      const p95 = sizes[Math.floor(sizes.length * 0.95)] || sizes[sizes.length - 1];

      let buyVol = 0, sellVol = 0, largeCnt = 0;
      for (const t of trades) {
        if (!t.isBuyerMaker) buyVol += t.q;
        else sellVol += t.q;
        if (t.q >= p95) largeCnt++;
      }

      const totalTrades = trades.length;
      const largeTradeRatio = largeCnt / totalTrades;
      const totalVol = buyVol + sellVol;
      const netFlow = totalVol > 0 ? (buyVol - sellVol) / totalVol : 0;
      const priceDrift = trades.length >= 2
        ? (trades[trades.length - 1].p - trades[0].p) / trades[0].p
        : 0;

      const divergence = (netFlow > 0.15 && priceDrift < -0.00005) || (netFlow < -0.15 && priceDrift > 0.00005);

      let footprintBias = 'NEUT';
      if (netFlow > 0.15) footprintBias = 'BUY';
      else if (netFlow < -0.15) footprintBias = 'SELL';

      const accumScore = _clamp01(0.5 * Math.abs(netFlow) + 0.5 * largeTradeRatio);

      _dbg('smf', 'ok', { n: totalTrades, bias: footprintBias, netFlow: netFlow.toFixed(2), divergence });
      return {
        footprintBias,
        accumScore: +accumScore.toFixed(2),
        largeTradeRatio: +largeTradeRatio.toFixed(2),
        divergence,
        ltr: +largeTradeRatio.toFixed(2),
        reason: 'ok',
        ts: now,
      };
    } catch (e) {
      _dbg('smf', 'error:' + (e && e.message));
      return _nullSmf('error', now);
    }
  }

  // ── Master runner — throttled 200ms ──────────────────────────────
  let _lastQuantTs = 0;
  function _runQuantDetectors() {
    try {
      const now = Date.now();
      if (now - _lastQuantTs < 200) return;
      _lastQuantTs = now;
      // ── optional price debug (gated, default off) ──────────────────
      if (window.ZEUS && ZEUS.cfg && ZEUS.cfg.debugQuantPrice) {
        ZEUS.cfg._dqCount = (ZEUS.cfg._dqCount || 0) + 1;
        if (ZEUS.cfg._dqCount <= 10) {
          var _ds = window.S || {}, _dsym = _quantSymKey(_ds.symbol);
          var _dap = (window.allPrices || window.allP || window.PRICES || null);
          console.log('[QUANT price-debug ' + ZEUS.cfg._dqCount + '/10]',
            'sym=', _dsym, 'S.price=', _ds.price, 'S.prevPrice=', _ds.prevPrice,
            'allPrices[sym]=', (_dap && _dsym) ? _dap[_dsym] : undefined,
            'klineClose=', (Array.isArray(_ds.klines) && _ds.klines.length) ? _ds.klines[_ds.klines.length - 1].close : undefined,
            'px=', _getQuantPx()
          );
        } else { ZEUS.cfg.debugQuantPrice = false; ZEUS.cfg._dqCount = 0; }
      }
      const OF = window.OF = window.OF || {};
      OF.quant = OF.quant || {};
      const _px = _getQuantPx(); // [v122] single price check — avoids no_price spam during feed warmup
      OF.quant.wall = _px > 0 ? _detectWall(now) : _nullWall('no_feed', now);
      OF.quant.stopRun = _px > 0 ? _detectStopRun(now) : _nullStop('no_feed', now);
      OF.quant.smf = _detectSMF(now); // SMF uses RAW_FLOW — runs regardless of price
    } catch (_) { }
  }

  window.runQuantDetectors = _runQuantDetectors;

  // ── Extend OF_DEBUG_SNAPSHOT with quant data ─────────────────────
  ; (function _patchSnapshot() {
    const _orig = window.OF_DEBUG_SNAPSHOT;
    if (typeof _orig !== 'function') { setTimeout(_patchSnapshot, 500); return; }
    window.OF_DEBUG_SNAPSHOT = function () {
      try {
        const snap = _orig();
        if (!snap) return snap;
        const Q = (window.OF && window.OF.quant) || {};
        snap.quant = { wall: Q.wall || null, stopRun: Q.stopRun || null, smf: Q.smf || null };
        return snap;
      } catch (e) {
        try { return _orig(); } catch (_) { return null; }
      }
    };
    try { if (typeof ZLOG !== 'undefined') ZLOG.push('INFO', '[OF P15] OF_DEBUG_SNAPSHOT patched with quant'); } catch (_) { }
  })();


  // ── Hook setSymbol — reset stability state on symbol change ──────
  const _prevSetSymbolQ = window.setSymbol;
  window.setSymbol = function (sym) {
    if (typeof _prevSetSymbolQ === 'function') _prevSetSymbolQ(sym);
    _qState.wall.lastPrice = null;
    _qState.wall.stableCount = 0;
    _qState.wall.lastReason = null;
    _qState.stopRun.prevPrice = null;   // correct field name (no underscore)
    _qState.stopRun.prevTs = null;
    _qState.stopRun.lastReason = null;
    _qState.smf.lastReason = null;
    if (window.OF) window.OF.quant = {};
  };

  // ── Start — give P1–P14 a 3s head-start ──────────────────────────
  function _startQ() {
    Intervals.set('of_p15_quant', _runQuantDetectors, 1000);
    _runQuantDetectors();
    try { if (typeof ZLOG !== 'undefined') ZLOG.push('INFO', '[OF P15] QUANT detectors started (Wall/StopRun/SMF)'); } catch (_) { }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(_startQ, 3000); });
  } else {
    setTimeout(_startQ, 3000);
  }

})();
