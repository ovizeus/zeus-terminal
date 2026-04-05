/**
 * Zeus Terminal — Patch Layer (ported from public/js/core/patch.js)
 * v122.3 Patch Layer — final patches
 */

const w = window as any

// ── STEP 0 — Patch registry ─────────────────────────────────────────
w.ZEUS = w.ZEUS || {}

w.ZEUS.patch = w.ZEUS.patch || {
  version: "v122.3",
  applied: {} as Record<string, boolean>,
  log: function (msg: any) { try { console.debug("[PATCH]", msg) } catch (_e) { /* */ } }
}

w.ZEUS.applyPatch = function (name: string, fn: () => void) {
  if (w.ZEUS.patch.applied[name]) return false
  w.ZEUS.patch.applied[name] = true
  try { fn(); w.ZEUS.patch.log("applied: " + name) }
  catch (e) { console.error("[PATCH FAIL]", name, e) }
  return true
}

// ── STEP 3 — Hook registry ──────────────────────────────────────────
w.ZEUS.hooks = w.ZEUS.hooks || {
  onTick: [] as any[],
  onBeforeSymbolChange: [] as any[],
  onAfterSymbolChange: [] as any[]
}

// ── STEP 5 — Centralized constants ─────────────────────────────────
w.ZEUS.cfg = w.ZEUS.cfg || {
  of: { windowMs: 10000, maxTrades: 2500 },
  quant: { wallStrengthMin: 5, wallDistMaxPct: 0.015, throttleMs: 250 },
  hud: { throttleMs: 150 }
}

// ── STEP 3A — setSymbol wrapper ──
w.ZEUS.applyPatch("wrap.setSymbol", function () {
  const orig = w.setSymbol
  if (!orig) { console.warn("[PATCH] wrap.setSymbol: window.setSymbol not found"); return }
  if (orig.__patched) return

  let _ssTimer: any = null
  function wrappedSetSymbol(this: any) {
    const args = arguments, self = this
    clearTimeout(_ssTimer)
    _ssTimer = setTimeout(function () {
      try { (w.ZEUS.hooks.onBeforeSymbolChange || []).forEach(function (fn: any) { fn() }) } catch (_e) { /* */ }
      orig.apply(self, args)
      try { (w.ZEUS.hooks.onAfterSymbolChange || []).forEach(function (fn: any) { fn() }) } catch (_e) { /* */ }
    }, 200)
  }
  ;(wrappedSetSymbol as any).__patched = true
  w.setSymbol = wrappedSetSymbol
})

// ── STEP 3B — Tick wrapper ──────────────────────────────────────────
w.ZEUS.applyPatch("hook.tick", function () {
  const orig = w.runQuantDetectors
  if (!orig) { console.warn("[PATCH] hook.tick: window.runQuantDetectors not found"); return }
  if (orig.__patched) return

  w.runQuantDetectors = function () {
    const r = orig.apply(this, arguments)
    try { w.ZEUS.hooks.onTick.forEach(function (fn: any) { fn() }) } catch (_e) { /* */ }
    return r
  }
  w.runQuantDetectors.__patched = true
})

// ── STEP 6 — Patch changelog panel ─────────────────────────────────
w.ZEUS.applyPatch("panel.changelog", function () {
  const v = w.ZEUS.patch.version
  const keys = Object.keys(w.ZEUS.patch.applied)
  const msg = "[PATCH LAYER] " + v + " | " + keys.length + " patch(es): " + keys.join(", ")
  try { if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('INFO', msg) } catch (_) { /* */ }
  console.info("%c" + msg, "color:#39ff14;font-weight:bold;background:#0a0a0a;padding:2px 6px")
})

// ── Deferred re-run ─────
;(function _deferPatchLayer() {
  function _run() {
    w.ZEUS.applyPatch("hook.tick", function () {
      const orig = w.runQuantDetectors
      if (!orig || orig.__patched) return
      w.runQuantDetectors = function () {
        const r = orig.apply(this, arguments)
        try { w.ZEUS.hooks.onTick.forEach(function (fn: any) { fn() }) } catch (_e) { /* */ }
        return r
      }
      w.runQuantDetectors.__patched = true
    })
    w.ZEUS.applyPatch("panel.changelog", function () {
      const v = w.ZEUS.patch.version
      const keys = Object.keys(w.ZEUS.patch.applied)
      const msg = "[PATCH LAYER] " + v + " | " + keys.length + " patch(es): " + keys.join(", ")
      try { if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('INFO', msg) } catch (_) { /* */ }
      console.info("%c" + msg, "color:#39ff14;font-weight:bold;background:#0a0a0a;padding:2px 6px")
    })
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(_run, 500) })
  } else {
    setTimeout(_run, 500)
  }
})()

// ── consoleBridge config ──
w.ZEUS.cfg.consoleBridge = w.ZEUS.cfg.consoleBridge || {
  enabled: true,
  maxBuf: 200,
  flushMs: 250,
  maxStrLen: 120,
  levels: {
    log: 'LOG',
    warn: 'WARN',
    error: 'ERROR',
    debug: 'DEBUG'
  }
}

w.ZEUS.applyPatch("consoleBridge", function () {
  const cfg = w.ZEUS.cfg.consoleBridge

  // ── 1. Save originals FIRST ──────────
  const _orig: Record<string, any> = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console)
  }

  // ── 2. Pre-ZLOG drain buffer ─────────────────────────────────────
  const _buf: any[] = []

  // ── 3. Helpers ───────────────────────────────────────────────────
  function _safeStr(v: any) {
    try {
      if (v === null) return 'null'
      if (v === undefined) return 'undefined'
      if (typeof v === 'string') return v.slice(0, cfg.maxStrLen)
      if (typeof v === 'number' || typeof v === 'boolean') return String(v)
      let s
      try { s = JSON.stringify(v) } catch (_) { s = Object.prototype.toString.call(v) }
      return (s || String(v)).slice(0, cfg.maxStrLen)
    } catch (_e) {
      try { return String(v).slice(0, cfg.maxStrLen) } catch (_) { return '[?]' }
    }
  }

  function _fmt(args: any) {
    try {
      return Array.prototype.slice.call(args)
        .map(_safeStr).join(' ')
        .slice(0, cfg.maxStrLen)
    } catch (_e) { return '[fmt-err]' }
  }

  function _queue(zlvl: string, msg: string) {
    if (_buf.length >= cfg.maxBuf) _buf.shift()
    _buf.push({ zlvl: zlvl, msg: msg })
  }

  // ── 4. Flush buffer → ZLOG ──────────────────────────────────────
  function _flush() {
    try {
      if (!_buf.length) return
      if (typeof w.ZLOG === 'undefined') return
      const batch = _buf.splice(0, _buf.length)
      for (let i = 0; i < batch.length; i++) {
        try { w.ZLOG.push(batch[i].zlvl, batch[i].msg) } catch (_) { /* */ }
      }
    } catch (_e) { /* never throw from flush */ }
  }

  // ── 5. Wrap console methods ─────────────────────────────────────
  const _methods = ['log', 'warn', 'error', 'debug'] as const
  _methods.forEach(function (m) {
    if ((console as any)[m] && (console as any)[m]._bridged) return

    const zlvl = cfg.levels[m] || m.toUpperCase()
    const orig = _orig[m]

    ;(console as any)[m] = function () {
      try { orig.apply(console, arguments) } catch (_) { /* */ }
      try {
        if (cfg.enabled) _queue(zlvl, _fmt(arguments))
      } catch (_) { /* */ }
    }
    ;(console as any)[m]._bridged = true
  })

  // ── 6. Start flush interval ─────────────────────────────────────
  setInterval(_flush, cfg.flushMs)

  // ── 7. First flush ──
  setTimeout(_flush, 0)

  w.ZEUS.patch.log("consoleBridge v122.3 — bridge active, flushMs=" + cfg.flushMs + ", maxBuf=" + cfg.maxBuf)
})

// Export nothing meaningful — side-effect module
export {}
