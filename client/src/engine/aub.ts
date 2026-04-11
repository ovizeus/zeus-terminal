// Zeus — engine/aub.ts
// Ported 1:1 from public/js/brain/aub.js (Phase 6D)
// AUB Analytics & Monitoring module — Alien Upgrade Bay
'use strict'

import { _safeLocalStorageSet } from '../services/storage'
import { toast } from '../data/marketDataHelpers'
import { _ZI } from '../constants/icons'
import { setTf } from '../data/marketDataFeeds'

const w = window as any

// ── TOGGLE ───────────────────────────────────────────────────────
export function aubToggle(): void {
  const el_aub = document.getElementById('aub')
  const txt = document.getElementById('aub-toggle-txt')
  if (!el_aub) return
  w.AUB.expanded = !w.AUB.expanded
  el_aub.className = w.AUB.expanded ? 'expanded' : 'collapsed'
  if (txt) txt.textContent = w.AUB.expanded ? 'COLLAPSE' : 'EXPAND'
  if (w.AUB.expanded) {
    _aubHoloSweep()
    if (w.AUB.sfxEnabled) _aubPlayTone(440, 0.06)
    aubRefreshAll()
  }
  // Mobile: save preference
  try { localStorage.setItem('aub_expanded', w.AUB.expanded ? '1' : '0') } catch (_) { }
  if (typeof w._ucMarkDirty === 'function') w._ucMarkDirty('aubData')
  if (typeof w._userCtxPush === 'function') w._userCtxPush()
}

export function aubToggleSFX(): void {
  w.AUB.sfxEnabled = !w.AUB.sfxEnabled
  const btn = document.getElementById('aub-sfx-btn')
  if (btn) { btn.innerHTML = w.AUB.sfxEnabled ? _ZI.bell + ' SFX' : _ZI.bellX + ' SFX'; btn.className = w.AUB.sfxEnabled ? 'on' : '' }
  if (w.AUB.sfxEnabled) _aubInitAudio()
}

// ── HOLO SWEEP FX ───────────────────────────────────────────────
export function _aubHoloSweep(): void {
  const sweep = document.getElementById('aub-sweep')
  if (!sweep) return
  sweep.classList.remove('sweeping')
  void (sweep as any).offsetWidth // reflow trigger
  sweep.classList.add('sweeping')
  setTimeout(() => sweep.classList.remove('sweeping'), 700)
}

// ── AUDIO ────────────────────────────────────────────────────────
export function _aubInitAudio(): void {
  if (w.AUB.audioCtx) {
    if (w.AUB.audioCtx.state === 'suspended') w.AUB.audioCtx.resume().catch(function () { })
    return
  }
  try {
    w.AUB.audioCtx = new (w.AudioContext || w.webkitAudioContext)()
    if (w.AUB.audioCtx.state === 'suspended') w.AUB.audioCtx.resume().catch(function () { })
  } catch (_) { w.AUB.sfxEnabled = false }
}
export function _aubPlayTone(freq: any, vol: any, dur?: any): void {
  try {
    if (!w.AUB.audioCtx) _aubInitAudio()
    if (!w.AUB.audioCtx) return
    if (w.AUB.audioCtx.state === 'suspended') { w.AUB.audioCtx.resume().catch(function () { }); return }
    const o = w.AUB.audioCtx.createOscillator()
    const g = w.AUB.audioCtx.createGain()
    o.connect(g); g.connect(w.AUB.audioCtx.destination)
    o.frequency.value = freq || 440
    g.gain.setValueAtTime(vol || 0.05, w.AUB.audioCtx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, w.AUB.audioCtx.currentTime + (dur || 0.15))
    o.start(); o.stop(w.AUB.audioCtx.currentTime + (dur || 0.15))
  } catch (_) { }
}

// ════════════════════════════════════════════════════════════════
// MODULE 1 — COMPATIBILITY SHIELD
// ════════════════════════════════════════════════════════════════

export function aubCheckCompat(): void {
  const proto = location.protocol
  const isSecure = proto === 'https:'
  const isLocal = proto === 'file:' || proto === 'blob:' || proto === 'content:'

  w.AUB_COMPAT.ws = typeof WebSocket !== 'undefined'
  w.AUB_COMPAT.audio = typeof (w.AudioContext || w.webkitAudioContext) !== 'undefined'
  w.AUB_COMPAT.crypto = !!(w.crypto && w.crypto.subtle)
  w.AUB_COMPAT.swDisabled = isLocal || !isSecure
  w.AUB_COMPAT.sw = !w.AUB_COMPAT.swDisabled && ('serviceWorker' in navigator)

  // Disable ServiceWorker if non-https
  if (w.AUB_COMPAT.swDisabled) {
    w.AUB_COMPAT.sw = false
  }

  const allOk = w.AUB_COMPAT.ws && w.AUB_COMPAT.audio && w.AUB_COMPAT.crypto
  const badge = document.getElementById('aub-badge-compat')
  if (badge) {
    badge.textContent = allOk ? 'COMPAT: OK' : 'COMPAT: LIMITED'
    badge.className = 'aub-badge ' + (allOk ? 'ok' : 'warn')
  }

  const list = document.getElementById('aub-compat-list')
  if (!list) return
  const row = (pass: any, label: any) =>
    `<div class="aub-row ${pass ? 'ok' : 'warn'}">${pass ? _ZI.ok : _ZI.w} ${label}</div>`

  list.innerHTML = [
    row(w.AUB_COMPAT.ws, 'WebSocket: ' + (w.AUB_COMPAT.ws ? 'SUPPORTED' : 'MISSING')),
    row(w.AUB_COMPAT.audio, 'AudioContext: ' + (w.AUB_COMPAT.audio ? 'SUPPORTED' : 'MISSING')),
    row(w.AUB_COMPAT.crypto, 'crypto.subtle: ' + (w.AUB_COMPAT.crypto ? 'OK' : 'MISSING')),
    row(w.AUB_COMPAT.sw, 'ServiceWorker: ' + (w.AUB_COMPAT.swDisabled ? 'DISABLED (non-https)' : w.AUB_COMPAT.sw ? 'SUPPORTED' : 'N/A')),
  ].join('')
}

// ════════════════════════════════════════════════════════════════
// MODULE 2 — INPUT GUARD
// ════════════════════════════════════════════════════════════════
export function _aubGuard(name: any, val: any, test: any): any {
  w.AUB.guardCount++
  const ok = test(val)
  if (!ok) {
    w.AUB.guardLast = name + '=' + JSON.stringify(val).slice(0, 20)
    console.warn('[AUB GUARD] Invalid param:', name, val)
  }
  _aubUpdateGuardUI()
  return ok
}

export function _aubUpdateGuardUI(): void {
  const cnt = document.getElementById('aub-guard-count')
  const last = document.getElementById('aub-guard-last')
  if (cnt) cnt.textContent = 'Validated: ' + w.AUB.guardCount + ' calls'
  if (last) last.textContent = 'Last reject: ' + w.AUB.guardLast
}

// Wrap public functions safely
export function _aubWrapPublicFunctions(): void {
  // setSymbol guard
  const _origSetSymbol = w.setSymbol
  if (typeof _origSetSymbol === 'function') {
    w.setSymbol = function (sym: any) {
      if (!_aubGuard('setSymbol', sym, (v: any) => typeof v === 'string' && v.length >= 3 && v.length <= 20)) return
      return _origSetSymbol.apply(this, arguments)
    }
  }
  // setTf guard
  const _origSetTf = setTf
  if (typeof _origSetTf === 'function') {
    w.setTf = function (tf: any, btn: any) {
      const valid = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '5h', '6h', '12h', '1d', '3d', '1w', '1M']
      if (!_aubGuard('setTf', tf, (v: any) => valid.includes(v))) return
      return _origSetTf.apply(this, arguments)
    }
  }
  // toggleAutoTrade guard
  const _origToggleAT = w.toggleAutoTrade
  if (typeof _origToggleAT === 'function') {
    w.toggleAutoTrade = function () {
      if (typeof w.AT === 'undefined') { console.warn('[AUB GUARD] AT not initialized'); return }
      w.AUB.guardCount++
      _aubUpdateGuardUI()
      return _origToggleAT.apply(this, arguments)
    }
  }
}

// ════════════════════════════════════════════════════════════════
// MODULE 3 — RENDER ORCHESTRATOR
// ════════════════════════════════════════════════════════════════

export function _aubRafTick(ts: any): void {
  // [PERF] skip FPS count + DOM when tab hidden
  if (document.hidden) { requestAnimationFrame(_aubRafTick); return }
  w.AUB._rafFrames++
  const elapsed = ts - w.AUB._rafLast
  if (elapsed >= 1000) {
    w.AUB.rafFPS = Math.round(w.AUB._rafFrames / elapsed * 1000)
    w.AUB._rafFrames = 0
    w.AUB._rafLast = ts
    w.AUB._perfHeavy = w.AUB.rafFPS < 30
    _aubUpdatePerfBadge()
    if (w.AUB.expanded) _aubUpdatePerfCard()
  }
  requestAnimationFrame(_aubRafTick)
}

export function _aubUpdatePerfBadge(): void {
  const badge = document.getElementById('aub-badge-perf')
  if (badge) {
    badge.textContent = w.AUB._perfHeavy ? 'PERF: HEAVY' : 'PERF: OK'
    badge.className = 'aub-badge ' + (w.AUB._perfHeavy ? 'warn' : 'ok')
  }
}
export function _aubUpdatePerfCard(): void {
  w.AUB_PERF.setDOM('aub-perf-fps', 'rAF FPS: ' + w.AUB.rafFPS + (w.AUB._perfHeavy ? ' (!)' : ''))
  w.AUB_PERF.setDOM('aub-perf-skips', 'DOM skips (no-change): ' + w.AUB.domSkips)
}

// ════════════════════════════════════════════════════════════════
// MODULE 4 — DECISION BLACKBOX
// ════════════════════════════════════════════════════════════════
// [FIX v85 B6] Dirty flag — evită salvări inutile în localStorage când datele n-au schimbat
let _bbDirty = false
export function _aubSaveBB(): void {
  if (!_bbDirty) return
  _safeLocalStorageSet('aub_bb', w.AUB.bb.slice(0, 50))
  _bbDirty = false
  if (typeof w._ucMarkDirty === 'function') w._ucMarkDirty('aubData')
  if (typeof w._userCtxPush === 'function') w._userCtxPush()
}
export function aubBBSnapshot(event: any, extra?: any): void {
  try {
    const snap = {
      ...(extra || {}),
      ts: Date.now(),
      event: event || 'unknown',
      score: (typeof w.BM !== 'undefined' ? w.BM.entryScore : null) || 0,
      regime: (typeof w.BRAIN !== 'undefined' ? w.BRAIN.regime : null) || '—',
      session: new Date().getUTCHours(),
      mode: (typeof w.S !== 'undefined' ? w.S.mode : null) || '—',
      blockReason: (typeof w.BlockReason !== 'undefined' ? w.BlockReason.text() : '—'),
    }
    w.AUB.bb.unshift(snap)
    // [FIX v85 BUG5] Redus de la 200 la 100 în memorie, 50 în localStorage
    if (w.AUB.bb.length > 100) w.AUB.bb.pop()
    // [FIX v85 B6] Setăm dirty flag — salvarea reală se face periodic prin _aubSaveBB
    _bbDirty = true
    if (w.AUB.expanded) _aubUpdateBBCard()
  } catch (e) { console.warn('[AUB BB]', e) }
}

export function _aubLoadBB(): void {
  try {
    const raw = localStorage.getItem('aub_bb')
    if (raw) w.AUB.bb = JSON.parse(raw)
  } catch (_) { }
}

export function _aubUpdateBBCard(): void {
  w.AUB_PERF.setDOM('aub-bb-count', 'Snapshots: ' + w.AUB.bb.length)
  const last = w.AUB.bb[0]
  w.AUB_PERF.setDOM('aub-bb-last', last
    ? 'Last: ' + last.event + ' @' + new Date(last.ts).toTimeString().slice(0, 8)
    : 'Last: —')
}

export function aubBBExport(): void {
  try {
    const blob = new Blob([JSON.stringify(w.AUB.bb, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'zeus_blackbox_' + new Date().toISOString().slice(0, 10) + '.json'
    a.click()
    toast('Blackbox exported!', 0, _ZI.clip)
  } catch (e) { console.warn('[AUB BB export]', e) }
}
export function aubBBClear(): void {
  w.AUB.bb = []
  try { localStorage.removeItem('aub_bb') } catch (_) { }
  _aubUpdateBBCard()
  toast('Blackbox cleared', 0, _ZI.trash)
}

// ════════════════════════════════════════════════════════════════
// MODULE 5 — MTF HIERARCHY
// Passive: called by aubRefreshAll on expand — no own interval (req 9)
// ════════════════════════════════════════════════════════════════
export function aubCalcMTFStrength(): any {
  try {
    const rsi = (typeof w.S !== 'undefined' && w.S.rsi) ? w.S.rsi : {}
    const klines = (typeof w.S !== 'undefined' && w.S.klines) ? w.S.klines : []
    // ADX from klines (already calculated in brain)
    const adx = (typeof w.BRAIN !== 'undefined' && w.BRAIN.regime) ? 1 : 0

    // Normalize RSI → strength 0–1 (50=0.5, 70=1, 30=0)
    function rsiToStr(r: any) {
      if (!r || isNaN(r)) return 0.5
      return Math.max(0, Math.min(1, (r - 30) / 40))
    }

    const s5m = rsiToStr(rsi['5m'] || rsi['now'] || 50)
    const s15m = rsiToStr(rsi['15m'] || 50)
    const s1h = rsiToStr(rsi['1h'] || 50)
    const s4h = rsiToStr(rsi['4h'] || 50)

    // Weighted composite (4h heaviest)
    const weighted = s4h * 0.40 + s1h * 0.30 + s15m * 0.20 + s5m * 0.10
    w.AUB.mtfStrength = { '5m': s5m, '15m': s15m, '1h': s1h, '4h': s4h }

    // Penalty: if 4h very strong but 5m weak (< 0.35) → penalize score
    const penalty = s4h > 0.7 && s5m < 0.35
    w.AUB.mtfPenalty = penalty

    if (w.AUB.expanded) _aubUpdateMTFCard(s5m, s15m, s1h, s4h, penalty)
    return { weighted, penalty }
  } catch (_) { return { weighted: 0.5, penalty: false } }
}

export function _aubUpdateMTFCard(s5m: any, s15m: any, s1h: any, s4h: any, penalty: any): void {
  const pct = (v: any) => Math.round(v * 100) + '%'
  // [B24 FIX] Removed broken set() calls with wrong parameter order
  const ids: any[] = [['aub-mtf-4h', s4h, 'aub-mtf-4h-v'], ['aub-mtf-1h', s1h, 'aub-mtf-1h-v'], ['aub-mtf-15m', s15m, 'aub-mtf-15m-v'], ['aub-mtf-5m', s5m, 'aub-mtf-5m-v']]
  ids.forEach(([bid, val, vid]: any) => {
    const b = document.getElementById(bid); if (b) b.style.width = pct(val)
    const v = document.getElementById(vid); if (v) v.textContent = Math.round(val * 100)
  })
  w.AUB_PERF.setDOM('aub-mtf-penalty', penalty ? '(!) PENALTY: 4h bull vs 5m weak' : 'Penalty: none')
}

// ════════════════════════════════════════════════════════════════
// MODULE 6 — CORRELATION FIELD
// Passive: called by aubRefreshAll on expand — no own interval (req 9)
// ════════════════════════════════════════════════════════════════
export function aubCalcCorrelation(): void {
  try {
    // Use wlPrices history if available, else skip
    // Simple: compare % change direction over last N ticks
    const btcPrice = (typeof w.S !== 'undefined') ? w.S.price : 0
    if (!btcPrice) return

    // We use watchlist data snapshots if available
    const eth = (typeof w.wlPrices !== 'undefined' && w.wlPrices['ETHUSDT']) ? w.wlPrices['ETHUSDT'] : null
    const sol = (typeof w.wlPrices !== 'undefined' && w.wlPrices['SOLUSDT']) ? w.wlPrices['SOLUSDT'] : null

    // Simple correlation proxy: if BTC & ALT both positive/negative chg → positive corr
    function corrProxy(btcChg: any, altChg: any) {
      if (!btcChg || !altChg) return null
      const same = (btcChg >= 0) === (altChg >= 0)
      // Deterministic proxy: scale by magnitude similarity (no Math.random)
      const magRatio = Math.min(Math.abs(btcChg), Math.abs(altChg)) / (Math.max(Math.abs(btcChg), Math.abs(altChg)) || 1)
      return same ? +0.7 + magRatio * 0.2 : -0.4 + magRatio * 0.2
    }

    const btcChg = (typeof w.S !== 'undefined' && w.S.chg) ? w.S.chg : 0
    w.AUB.corr.eth = eth ? corrProxy(btcChg, eth.chg || 0) : null
    w.AUB.corr.sol = sol ? corrProxy(btcChg, sol.chg || 0) : null

    // Penalty: if active sym is ALT and BTC goes strongly opposite → reduce score
    const sym = (typeof w.S !== 'undefined' && w.S.symbol) ? w.S.symbol : ''
    const isAlt = sym !== 'BTCUSDT'
    const btcStrong = Math.abs(btcChg) > 1
    const corrPenalty = isAlt && btcStrong && (w.AUB.corr.eth !== null && w.AUB.corr.eth < 0)
    w.AUB.corrPenalty = corrPenalty

    if (w.AUB.expanded) _aubUpdateCorrCard()
  } catch (_) { }
}

export function _aubUpdateCorrCard(): void {
  const fmt = (v: any) => v !== null ? (v > 0 ? '+' : '') + v.toFixed(2) : '—'
  w.AUB_PERF.setDOM('aub-corr-eth', fmt(w.AUB.corr.eth))
  w.AUB_PERF.setDOM('aub-corr-sol', fmt(w.AUB.corr.sol))
  const pen = document.getElementById('aub-corr-penalty')
  if (pen) {
    pen.textContent = w.AUB.corrPenalty ? '(!) PENALTY: BTC drag active' : 'Penalty: inactive'
    pen.className = 'aub-row ' + (w.AUB.corrPenalty ? 'warn' : '')
  }
}

// ════════════════════════════════════════════════════════════════
// MODULE 7 — MACRO ANOMALY RADAR
// Passive module: reads state, no autonomous intervals (req 9)
// Data updates via aubRefreshAll() on user expand only
// ════════════════════════════════════════════════════════════════
export function aubMacroImport(): void { document.getElementById('aub-macro-file')?.click() }
export function aubMacroClear(): void {
  w.AUB.macroEvents = []
  try { localStorage.removeItem('aub_macro') } catch (_) { }
  _aubRenderMacroEvents()
  toast('Macro events cleared', 0, _ZI.trash)
}
export function aubMacroFileLoad(input: any): void {
  const file = input?.files?.[0]; if (!file) return
  const reader = new FileReader()
  reader.onload = (e: any) => {
    try {
      const events = JSON.parse(e.target.result)
      if (Array.isArray(events)) {
        w.AUB.macroEvents = events.map((ev: any) => ({
          label: ev.label || ev.name || 'Event',
          ts: ev.ts || (ev.time ? new Date(ev.time).getTime() : Date.now()),
          impact: ev.impact || 'medium', // low/medium/high
          risk: ev.risk || 0.5,      // risk reduce factor 0–1
        }))
        _safeLocalStorageSet('aub_macro', w.AUB.macroEvents) // FIX 22
        if (typeof w._ucMarkDirty === 'function') w._ucMarkDirty('aubData')
        if (typeof w._userCtxPush === 'function') w._userCtxPush()
        _aubRenderMacroEvents()
        toast('Macro events loaded: ' + w.AUB.macroEvents.length)
      }
    } catch (e) { toast('Invalid JSON', 0, _ZI.x) }
  }
  reader.readAsText(file)
  input.value = ''
}

export function aubGetActiveMacroRisk(): any {
  const now = Date.now()
  for (const ev of w.AUB.macroEvents) {
    const diff = ev.ts - now
    if (diff > -3600000 && diff < 7200000) { // -1h to +2h window
      return { active: true, label: ev.label, risk: ev.risk, impact: ev.impact }
    }
  }
  return { active: false }
}

export function _aubRenderMacroEvents(): void {
  const el_m = document.getElementById('aub-macro-events'); if (!el_m) return
  if (!w.AUB.macroEvents.length) {
    el_m.innerHTML = '<div class="aub-row">No events loaded</div>'; return
  }
  const now = Date.now()
  el_m.innerHTML = w.AUB.macroEvents.slice(0, 5).map((ev: any) => {
    const diff = ev.ts - now
    const hrs = Math.round(diff / 3600000)
    const when = Math.abs(hrs) < 1 ? 'NOW' : (hrs > 0 ? 'in ' + hrs + 'h' : Math.abs(hrs) + 'h ago')
    const cls = ev.impact === 'high' ? 'high' : ''
    const riskPct = Math.round((1 - ev.risk) * 100)
    return `<div class="aub-macro-item ${cls}">${ev.label} — ${when} → Risk ${riskPct > 0 ? '-' : ''}${riskPct}%</div>`
  }).join('')
}

export function _aubLoadMacro(): void {
  try {
    const raw = localStorage.getItem('aub_macro')
    if (raw) w.AUB.macroEvents = JSON.parse(raw)
  } catch (_) { }
}

// ════════════════════════════════════════════════════════════════
// MODULE 8 — NIGHTLY SIM LAB
// ════════════════════════════════════════════════════════════════

export function aubSimRun(): void {
  if (w.AUB.simRunning) return
  w.AUB.simRunning = true
  w.AUB_PERF.setDOM('aub-sim-status', 'Status: Running...')
  // Async so UI doesn't freeze
  setTimeout(_aubSimWorker, 100)
}

export function _aubSimWorker(): void {
  try {
    const klines = (typeof w.S !== 'undefined' && w.S.klines) ? w.S.klines : []
    if (klines.length < 50) {
      w.AUB_PERF.setDOM('aub-sim-status', 'Status: Need 50+ bars')
      w.AUB.simRunning = false; return
    }

    const bars = klines.slice(-Math.min(1000, klines.length))
    // Test combinations: SL% × TP-ratio
    const slOpts = [0.8, 1.0, 1.5, 2.0]
    const rrOpts = [1.5, 2.0, 2.5, 3.0]
    let best: any = { sl: 1.0, rr: 2.0, score: 0, wins: 0, total: 0 }

    for (const sl of slOpts) {
      for (const rr of rrOpts) {
        let wins = 0, total = 0
        // Simple simulation: enter long on green close, track SL/TP
        for (let i = 5; i < bars.length - 3; i++) {
          const entry = bars[i].close
          const isGreen = entry > bars[i].open
          if (!isGreen) continue
          const tp = entry * (1 + rr * sl / 100)
          const slv = entry * (1 - sl / 100)
          total++
          // Check next 3 bars
          let hit = false
          for (let j = i + 1; j <= i + 3 && j < bars.length; j++) {
            const h = bars[j].high
            const l = bars[j].low
            if (h >= tp) { wins++; hit = true; break }
            if (l <= slv) { hit = true; break }
          }
        }
        const score = total > 0 ? wins / total * 100 : 0
        if (score > best.score) { best = { sl, rr, score, wins, total } }
      }
    }

    w.AUB.simResult = best
    w.AUB.simPendingApply = best
    const ts = new Date().toLocaleTimeString()
    _safeLocalStorageSet(w.AUB_SIM_KEY, { best, ts }) // FIX 22

    w.AUB_PERF.setDOM('aub-sim-status', 'Status: Done (' + ts + ')')
    w.AUB_PERF.setDOM('aub-sim-last', 'Last run: ' + ts)

    const res = document.getElementById('aub-sim-result')
    if (res) {
      (res as any).style.display = 'block'
      res.innerHTML = `Best: SL ${best.sl}% / RR ${best.rr}x<br>WR: ${best.score.toFixed(1)}% (${best.wins}/${best.total})<br><span style="color:#ffd400">` + _ZI.w + ` Suggest only — confirm before applying</span>`
    }
    const applyBtn = document.getElementById('aub-sim-apply')
    if (applyBtn) (applyBtn as any).style.display = 'inline-block'
  } catch (e: any) {
    w.AUB_PERF.setDOM('aub-sim-status', 'Status: Error — ' + (e.message || '?'))
  }
  w.AUB.simRunning = false
}

export function aubSimApply(): void {
  if (!w.AUB.simPendingApply) return
  const confirmed = w.confirm(
    `Apply suggested settings?\nSL: ${w.AUB.simPendingApply.sl}%\nTP ratio: ${w.AUB.simPendingApply.rr}x\n\nThis ONLY sets input fields — you must enable trading manually.`
  )
  if (!confirmed) return
  // Set inputs (do NOT toggle AT or execute trades)
  const slInput = document.getElementById('atSL') as any
  const rrInput = document.getElementById('atRR') as any
  if (slInput) slInput.value = w.AUB.simPendingApply.sl
  if (rrInput) rrInput.value = w.AUB.simPendingApply.rr
  toast('Suggestion applied to fields — review before enabling AT')
  ;(document.getElementById('aub-sim-apply') as any).style.display = 'none'
  w.AUB.simPendingApply = null
  aubBBSnapshot('SIM_APPLIED', { sl: w.AUB.simResult.sl, rr: w.AUB.simResult.rr })
}

export function _aubLoadSim(): void {
  try {
    const raw = localStorage.getItem(w.AUB_SIM_KEY)
    if (raw) {
      const data = JSON.parse(raw)
      w.AUB.simResult = data.best
      w.AUB_PERF.setDOM('aub-sim-last', 'Last run: ' + (data.ts || '—'))
    }
  } catch (_) { }
}

// Nightly auto-run (once per day, at init)
export function _aubCheckNightlySim(): void {
  try {
    const raw = localStorage.getItem(w.AUB_SIM_KEY)
    const lastTs = raw ? JSON.parse(raw)?.ts : null
    const today = new Date().toDateString()
    if (!lastTs || !lastTs.includes(today.slice(0, 3))) {
      // Different day → run after 30s delay to let data load
      setTimeout(aubSimRun, 30000)
    }
  } catch (_) { }
}

// ════════════════════════════════════════════════════════════════
// DATA BADGE — sync with _SAFETY.dataStalled
// ════════════════════════════════════════════════════════════════
export function _aubUpdateDataBadge(): void {
  // FIX v118: aceeași sursă ca bannerul de feed și renderCircuitBrain
  const stalled = (typeof w._SAFETY !== 'undefined' && w._SAFETY.dataStalled) ||
    (typeof w.S !== 'undefined' && w.S.dataStalled)
  const recon = (typeof w._SAFETY !== 'undefined' && w._SAFETY.isReconnecting)
  const hasWS = (typeof w.S !== 'undefined') && (w.S.bnbOk || w.S.bybOk)
  const hasPrice = (typeof w.S !== 'undefined') && w.S.price > 0
  const badge = document.getElementById('aub-badge-data')
  if (badge) {
    if (recon) { badge.textContent = 'DATA: RECON'; badge.className = 'aub-badge danger' }
    else if (stalled) { badge.textContent = 'DATA: STALL'; badge.className = 'aub-badge danger' }
    else if (hasWS && hasPrice) { badge.textContent = 'DATA: LIVE'; badge.className = 'aub-badge ok' }
    else if (hasPrice) { badge.textContent = 'DATA: DELAY'; badge.className = 'aub-badge warn' }
    else { badge.textContent = 'DATA: WAIT'; badge.className = 'aub-badge info' }
  }
}

// ════════════════════════════════════════════════════════════════
// REFRESH ALL — called on expand + from renderBrainCockpit hook
// ════════════════════════════════════════════════════════════════
export function aubRefreshAll(): void {
  // Called on user expand only (req 6) — safe to compute
  aubCheckCompat()
  aubCalcMTFStrength()   // MTF: triggered by user expand, not autonomous (req 9)
  aubCalcCorrelation()   // Corr: triggered by user expand, not autonomous (req 9)
  _aubUpdateBBCard()
  _aubRenderMacroEvents()
  _aubUpdateDataBadge()
  _aubUpdatePerfCard()
}

// ════════════════════════════════════════════════════════════════
// INIT — called once from startApp()
// ════════════════════════════════════════════════════════════════
export function initAUB(): void {
  // ── AUB is UI-only: load persisted data, render shell (req 6, 9)
  // No computation intervals here — subscribe to engine events instead
  _aubLoadBB()
  _aubLoadMacro()
  _aubLoadSim()

  // Restore expand state (default collapsed)
  const el_aub = document.getElementById('aub')
  if (el_aub) {
    const saved = localStorage.getItem('aub_expanded')
    w.AUB.expanded = (saved === '1') && w.innerWidth >= 600
    el_aub.className = w.AUB.expanded ? 'expanded' : 'collapsed'
    const txt = document.getElementById('aub-toggle-txt')
    if (txt) txt.textContent = w.AUB.expanded ? 'COLLAPSE' : 'EXPAND'
  }

  // rAF FPS counter — purely visual, always safe (req 6)
  w.AUB._rafLast = performance.now()
  requestAnimationFrame(_aubRafTick)

  // Input guards — wrap after engine settles (req 6, visual-safe)
  setTimeout(_aubWrapPublicFunctions, 1000)

  // Compat check — pure feature detection, no data (req 6)
  aubCheckCompat()

  // DATA badge only — lightest possible status check (req 6)
  // aubCalcMTFStrength / aubCalcCorrelation called only on user expand
  w.Intervals.set('aubRefresh', _aubUpdateDataBadge, 3000)

  // Subscribe to zeusReady event for nightly sim (req 2, 9)
  w.addEventListener('zeusReady', () => {
    _aubCheckNightlySim()   // runs 1x/day, after engine fully booted
  }, { once: true })

  console.log('[AUB] Alien Upgrade Bay shell ready — waiting for engine')
}
