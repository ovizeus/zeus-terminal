// Zeus v122 — core/managers.js
// Intervals, WS, FetchLock, ingestPrice, Timeouts managers
'use strict';

// ═══════════════════════════════════════════════════════════════════
// ZEUS CORE MANAGERS — loaded in <head>, before ALL other scripts
// Using window.X to avoid TDZ entirely (const = TDZ, window = safe)
// ═══════════════════════════════════════════════════════════════════

// FIX: Initialize __wsGen to 0 immediately — undefined !== 0 would kill all WS connections
window.__wsGen = window.__wsGen || 0;

// ===== MODULE: INTERVALS =====
// ── 1. INTERVAL MANAGER ──────────────────────────────────────────
window.Intervals = window.Intervals || (function () {
  var _map = {};
  return {
    set: function (name, fn, ms) {
      if (typeof fn !== 'function') { console.warn('[Intervals] not ready or bad fn:', name); return null; }
      if (_map[name]) { clearInterval(_map[name]); delete _map[name]; }
      _map[name] = setInterval(fn, ms);
      return _map[name];
    },
    clear: function (name) {
      if (_map[name]) { clearInterval(_map[name]); delete _map[name]; }
    },
    clearGroup: function () {
      var names = Array.prototype.slice.call(arguments);
      names.forEach(function (n) { window.Intervals.clear(n); });
    },
    clearAll: function () {
      Object.keys(_map).forEach(function (n) { window.Intervals.clear(n); });
    },
    list: function () { return Object.keys(_map); }
  };
})();

// ===== MODULE: WS =====
// ── 2. WEBSOCKET MANAGER ─────────────────────────────────────────
window.WS = window.WS || (function () {
  var _map = {};
  return {
    open: function (name, url, handlers) {
      if (!handlers) handlers = {};
      if (window.__wsGen === undefined || window.__wsGen === null) window.__wsGen = 0;
      console.log(`[WS] open called: ${name}`, url, '| gen:', window.__wsGen);
      // FIX 10: cancel any pending reconnect timer for this connection before opening
      if (window.Timeouts) Timeouts.clear(name + 'Reconnect');
      window.WS.close(name); // also nulls all handlers on old socket
      var ws = new WebSocket(url);
      var gen = window.__wsGen;
      ws.onopen = function (e) {
        console.log(`[WS] onopen: ${name} | current gen ${window.__wsGen}, my gen ${gen}`, gen !== window.__wsGen ? '→ STALE, closing' : '→ OK');
        if (window.__wsGen !== gen) { ws.close(); return; }
        if (handlers.onopen) handlers.onopen(e);
      };
      ws.onmessage = function (e) { if (window.__wsGen !== gen) return; if (handlers.onmessage) handlers.onmessage(e); };
      ws.onerror = function (e) {
        console.error(`[WS] onerror: ${name}`, e);
        if (handlers.onerror) handlers.onerror(e);
      };
      ws.onclose = function (e) {
        console.log(`[WS] onclose: ${name} | code ${e.code}, reason "${e.reason || '—'}", wasClean ${e.wasClean}`);
        if (_map[name] === ws) delete _map[name];
        if (handlers.onclose) handlers.onclose(e);
      };
      _map[name] = ws;
      return ws;
    },
    close: function (name) {
      if (_map[name]) {
        // FIX 10: clear ALL handlers before closing to prevent stale event firing
        try {
          _map[name].onopen = null;
          _map[name].onmessage = null;
          _map[name].onerror = null;
          _map[name].onclose = null;
          _map[name].close();
        } catch (_) { }
        delete _map[name];
      }
    },
    closeSymbolFeeds: function () {
      // [PATCH4 W1] Close ALL symbol-bound feeds including orderflow
      ['bnb', 'byb', 'kline', 'of_agg'].forEach(function (n) { window.WS.close(n); });
    },
    closeAll: function () { Object.keys(_map).forEach(function (n) { window.WS.close(n); }); },
    get: function (name) { return _map[name]; },
    isOpen: function (name) { return _map[name] && _map[name].readyState === WebSocket.OPEN; }
  };
})();

// ── 3. FETCH LOCK ────────────────────────────────────────────────
window.FetchLock = window.FetchLock || (function () {
  var _locks = {};
  return {
    try: function (name) {
      if (_locks[name]) return false;
      _locks[name] = true;
      return true;
    },
    release: function (name) { delete _locks[name]; },
    guarded: async function (name, fn) {
      if (!this.try(name)) return;
      try { await fn(); } finally { this.release(name); }
    }
  };
})();

// ── 4. PRICE INGRESS ─────────────────────────────────────────────
window.ingestPrice = window.ingestPrice || function (raw, source) {
  var p = +raw;
  if (!Number.isFinite(p) || p <= 0) return false;
  if (typeof _isPriceSane === 'function' && !_isPriceSane(p)) return false;
  if (typeof S !== 'undefined') {
    S.prevPrice = S.price || p;
    S.price = p;
    if (S.symbol) allPrices[S.symbol] = p; // BUG1: track main symbol
  }
  if (typeof _resetWatchdog === 'function') _resetWatchdog();
  return true;
};

// ── 9. TIMEOUTS MANAGER ──────────────────────────────────────────
// Prevents reconnect storms and duplicate timeout chains
window.Timeouts = window.Timeouts || (function () {
  var _map = {};
  return {
    set: function (name, fn, ms) {
      // Cancel existing before setting new (dedup)
      if (_map[name]) { clearTimeout(_map[name]); }
      _map[name] = setTimeout(function () {
        delete _map[name];
        fn();
      }, ms);
      return _map[name];
    },
    clear: function (name) {
      if (_map[name]) { clearTimeout(_map[name]); delete _map[name]; }
    },
    clearAll: function () {
      Object.keys(_map).forEach(function (n) {
        clearTimeout(_map[n]);
      });
      // Clear all keys
      Object.keys(_map).forEach(function (n) { delete _map[n]; });
    },
    active: function () { return Object.keys(_map); }
  };
})();
