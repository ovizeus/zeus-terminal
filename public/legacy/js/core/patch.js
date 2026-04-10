// Zeus v122 — core/patch.js
// v122.3 Patch Layer — final patches
'use strict';

// ╔══════════════════════════════════════════════════════════════════╗
// ║  ZEUS PATCH LAYER — v122.3                                       ║
// ║  Steps 0–6 per Maintenance Rescue spec.                          ║
// ╚══════════════════════════════════════════════════════════════════╝

// ── STEP 0 — Patch registry ─────────────────────────────────────────
window.ZEUS = window.ZEUS || {};

ZEUS.patch = ZEUS.patch || {
  version: "v122.3",
  applied: {},
  log: function (msg) { try { console.debug("[PATCH]", msg); } catch (e) { } }
};

ZEUS.applyPatch = function (name, fn) {
  if (ZEUS.patch.applied[name]) return false;
  ZEUS.patch.applied[name] = true;
  try { fn(); ZEUS.patch.log("applied: " + name); }
  catch (e) { console.error("[PATCH FAIL]", name, e); }
  return true;
};

// ── STEP 3 — Hook registry ──────────────────────────────────────────
// Future patches: DO NOT wrap setSymbol / tick directly.
// Register here instead:
//   ZEUS.hooks.onTick.push(myFn);
//   ZEUS.hooks.onAfterSymbolChange.push(myFn);
ZEUS.hooks = ZEUS.hooks || {
  onTick: [],   // called from runQuantDetectors tick (≈1s)
  onBeforeSymbolChange: [],   // called before setSymbol executes
  onAfterSymbolChange: []    // called after  setSymbol executes
};

// ── STEP 5 — Centralized constants ─────────────────────────────────
// New modules read from ZEUS.cfg. Legacy constants are NOT replaced.
ZEUS.cfg = ZEUS.cfg || {
  of: { windowMs: 10000, maxTrades: 2500 },
  quant: { wallStrengthMin: 5, wallDistMaxPct: 0.015, throttleMs: 250 },
  hud: { throttleMs: 150 }
};

// ── STEP 3A — setSymbol wrapper (wraps once; all hooks fire through it) ──
ZEUS.applyPatch("wrap.setSymbol", function () {
  var orig = window.setSymbol;
  if (!orig) { console.warn("[PATCH] wrap.setSymbol: window.setSymbol not found"); return; }
  if (orig.__patched) return; // already wrapped by a previous patch run

  var _ssTimer = null;
  function wrappedSetSymbol() {
    // [PERF] 200ms debounce — rapid symbol switches only execute the last one
    var args = arguments, self = this;
    clearTimeout(_ssTimer);
    _ssTimer = setTimeout(function () {
      try { (ZEUS.hooks.onBeforeSymbolChange || []).forEach(function (fn) { fn(); }); } catch (e) { }
      orig.apply(self, args);
      try { (ZEUS.hooks.onAfterSymbolChange || []).forEach(function (fn) { fn(); }); } catch (e) { }
    }, 200);
  }
  wrappedSetSymbol.__patched = true;
  window.setSymbol = wrappedSetSymbol;
});

// ── STEP 3B — Tick wrapper ──────────────────────────────────────────
// P45's internal _tick() is not exported to window (IIFE scope).
// Best stable external hook: window.runQuantDetectors (runs on 1s interval
// from P15 _startQ). Modules register via ZEUS.hooks.onTick.push(fn).
//
// NOTE FOR FUTURE: expose P45 tick by adding inside the P45 IIFE:
//   window.P45_tick = _tick;
// Then replace "runQuantDetectors" below with "P45_tick" for a true
// 1Hz main-loop hook.
ZEUS.applyPatch("hook.tick", function () {
  var orig = window.runQuantDetectors;
  if (!orig) { console.warn("[PATCH] hook.tick: window.runQuantDetectors not found"); return; }
  if (orig.__patched) return;

  window.runQuantDetectors = function () {
    var r = orig.apply(this, arguments);
    try { ZEUS.hooks.onTick.forEach(function (fn) { fn(); }); } catch (e) { }
    return r;
  };
  window.runQuantDetectors.__patched = true;
});

// ── STEP 4 — Module registration template ──────────────────────────
// How to add a new feature module (copy-paste boilerplate):
//
//   ZEUS.applyPatch("module.myFeature", function(){
//     if (window.__MY_FEATURE__) return;
//     window.__MY_FEATURE__ = true;
//     (function(){
//       function _tick(){ /* read OF/BM/S — never write to core */ }
//       ZEUS.hooks.onTick.push(_tick);
//       ZEUS.hooks.onAfterSymbolChange.push(function(){ /* reset state */ });
//     })();
//   });

// ── STEP 6 — Patch changelog panel ─────────────────────────────────
// Replaces scattered "FIX 1/2/3" comments. Visible in ZLOG viewer.
ZEUS.applyPatch("panel.changelog", function () {
  var v = ZEUS.patch.version;
  var keys = Object.keys(ZEUS.patch.applied);
  var msg = "[PATCH LAYER] " + v + " | " + keys.length + " patch(es): " + keys.join(", ");
  // Push to ZLOG if available (initialized at line ~12318)
  try { if (typeof ZLOG !== 'undefined') ZLOG.push('INFO', msg); } catch (_) { }
  // Also surface in console for DevTools
  console.info("%c" + msg, "color:#39ff14;font-weight:bold;background:#0a0a0a;padding:2px 6px");
});

// ── Deferred re-run: ensures wrappers fire even if order shifts ─────
// (applyPatch idempotent guard prevents double-application)
(function _deferPatchLayer() {
  function _run() {
    // wrap.setSymbol removed — already applied by main patch layer (idempotent guard skips duplicate)
    ZEUS.applyPatch("hook.tick", function () {
      var orig = window.runQuantDetectors;
      if (!orig || orig.__patched) return;
      window.runQuantDetectors = function () {
        var r = orig.apply(this, arguments);
        try { ZEUS.hooks.onTick.forEach(function (fn) { fn(); }); } catch (e) { }
        return r;
      };
      window.runQuantDetectors.__patched = true;
    });
    ZEUS.applyPatch("panel.changelog", function () {
      var v = ZEUS.patch.version;
      var keys = Object.keys(ZEUS.patch.applied);
      var msg = "[PATCH LAYER] " + v + " | " + keys.length + " patch(es): " + keys.join(", ");
      try { if (typeof ZLOG !== 'undefined') ZLOG.push('INFO', msg); } catch (_) { }
      console.info("%c" + msg, "color:#39ff14;font-weight:bold;background:#0a0a0a;padding:2px 6px");
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(_run, 500); });
  } else {
    setTimeout(_run, 500);
  }
})();

// ── consoleBridge config (toggle via ZEUS.cfg.consoleBridge.enabled) ──
ZEUS.cfg.consoleBridge = ZEUS.cfg.consoleBridge || {
  enabled: true,    // set false to disable at runtime
  maxBuf: 200,     // max queued entries before oldest is dropped
  flushMs: 250,     // flush interval to ZLOG
  maxStrLen: 120,     // truncate each string/serialised object
  levels: {           // console method → ZLOG level label
    log: 'LOG',
    warn: 'WARN',
    error: 'ERROR',
    debug: 'DEBUG'
  }
};

ZEUS.applyPatch("consoleBridge", function () {
  var cfg = ZEUS.cfg.consoleBridge;

  // ── 1. Save originals FIRST (bind preserves call-site) ──────────
  var _orig = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console)
  };

  // ── 2. Pre-ZLOG drain buffer ─────────────────────────────────────
  // Entries land here before ZLOG is confirmed available,
  // then drain() is called on every flush tick.
  var _buf = [];   // [{zlvl, msg}]

  // ── 3. Helpers ───────────────────────────────────────────────────
  function _safeStr(v) {
    try {
      if (v === null) return 'null';
      if (v === undefined) return 'undefined';
      if (typeof v === 'string') return v.slice(0, cfg.maxStrLen);
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      // Object / Array — safe stringify with cycle guard
      var s;
      try { s = JSON.stringify(v); } catch (_) { s = Object.prototype.toString.call(v); }
      return (s || String(v)).slice(0, cfg.maxStrLen);
    } catch (e) {
      try { return String(v).slice(0, cfg.maxStrLen); } catch (_) { return '[?]'; }
    }
  }

  function _fmt(args) {
    try {
      return Array.prototype.slice.call(args)
        .map(_safeStr).join(' ')
        .slice(0, cfg.maxStrLen);
    } catch (e) { return '[fmt-err]'; }
  }

  function _queue(zlvl, msg) {
    if (_buf.length >= cfg.maxBuf) _buf.shift(); // drop oldest when full
    _buf.push({ zlvl: zlvl, msg: msg });
  }

  // ── 4. Flush buffer → ZLOG ──────────────────────────────────────
  // ZLOG is `const` (not window.ZLOG) but accessible here because
  // all <script> blocks in this file share the same global lexical env.
  // typeof check is the safe guard for any future restructuring.
  function _flush() {
    try {
      if (!_buf.length) return;
      if (typeof ZLOG === 'undefined') return;  // not ready yet — wait next tick
      // Drain entire buffer in this flush
      var batch = _buf.splice(0, _buf.length);
      for (var i = 0; i < batch.length; i++) {
        try { ZLOG.push(batch[i].zlvl, batch[i].msg); } catch (_) { }
      }
    } catch (e) { /* never throw from flush */ }
  }

  // ── 5. Wrap console methods ─────────────────────────────────────
  var _methods = ['log', 'warn', 'error', 'debug'];
  _methods.forEach(function (m) {
    // Guard: don't double-wrap if patch somehow re-runs
    if (console[m] && console[m]._bridged) return;

    var zlvl = cfg.levels[m] || m.toUpperCase();
    var orig = _orig[m];

    console[m] = function () {
      // Always call original first — no suppression, ever
      try { orig.apply(console, arguments); } catch (_) { }
      // Queue to buffer (honours enabled toggle at call time)
      try {
        if (cfg.enabled) _queue(zlvl, _fmt(arguments));
      } catch (_) { }
    };
    console[m]._bridged = true;
  });

  // ── 6. Start flush interval ─────────────────────────────────────
  // Uses native setInterval (not Intervals manager) to avoid circular
  // dependency with the app's own interval log messages.
  setInterval(_flush, cfg.flushMs);

  // ── 7. First flush — handles "ZLOG ready" scenario immediately ──
  // If ZLOG exists right now, drain bootstrap messages accumulated
  // during patch layer init (changelog, wrap.setSymbol etc.)
  setTimeout(_flush, 0);

  ZEUS.patch.log("consoleBridge v122.3 — bridge active, flushMs=" + cfg.flushMs + ", maxBuf=" + cfg.maxBuf);
});
// Note: debugQuantPrice is gated inside _runQuantDetectors (QUANT P15 IIFE scope).
// Activate via: ZEUS.cfg.debugQuantPrice = true  (auto-off after 10 ticks)
