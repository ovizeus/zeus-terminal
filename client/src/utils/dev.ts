/**
 * Zeus Terminal — Development tools, ZLOG logging, Hub settings, safeAsync
 * (ported from public/js/utils/dev.js)
 */

import { getBrainMetrics } from '../services/stateAccessors'
import { fmtNow } from '../data/marketDataHelpers'
const w = window as Record<string, any> // kept for w.S (writes), w.USER_SETTINGS (writes), w.el, w.toast, fn calls

export const DEV: Record<string, any> = {
  enabled: false,
  log: [] as any[],
  maxLog: 50,
  replayInterval: null as any,
  replayIndex: 0,
  replayKlines: [] as any[],
  _errorModules: {} as Record<string, boolean>,
}
w.DEV = DEV

// ── Logging ──────────────────────────────────────────────────────
export function devLog(msg: string, type?: string): void {
  try {
    type = type || 'info'
    const time = fmtNow(true)
    DEV.log.unshift({ time, msg, type })
    if (DEV.log.length > DEV.maxLog) DEV.log.pop()
    _devRenderLog()
    // Mirror to Notification Center for warnings/errors
    if ((type === 'error' || type === 'warning') && typeof w.ncAdd === 'function') {
      w.ncAdd('warning', 'dev', '[DEV] ' + msg)
    }
  } catch (_e) { /* silent */ }
}
w.devLog = devLog

function _devRenderLog(): void {
  try {
    const logEl = document.getElementById('dev-log')
    if (!logEl) return
    if (!DEV.log.length) {
      logEl.innerHTML = '<div class="dev-log-empty">No events yet.</div>'
      return
    }
    logEl.innerHTML = DEV.log.slice(0, 20).map(function (e: any) {
      const col = e.type === 'error' ? '#ff8866' :
        e.type === 'success' ? '#66ff99' :
          e.type === 'warning' ? '#f0c040' : '#9ab'
      return '<div class="dev-log-entry">'
        + '<span class="dev-log-time">' + e.time + '</span>'
        + '<span class="dev-log-msg" style="color:' + col + '">' + e.msg + '</span>'
        + '</div>'
    }).join('')
    // Update timestamp
    const upd = document.getElementById('dev-upd')
    if (upd) upd.textContent = 'last: ' + DEV.log[0].time
  } catch (_e) { /* silent */ }
}

export function devClearLog(): void {
  try {
    DEV.log = []
    _devRenderLog()
  } catch (_e) { /* silent */ }
}
w.devClearLog = devClearLog

export function devExportLog(): void {
  try {
    if (!DEV.log.length) { if (typeof w.toast === 'function') w.toast('No log to export'); return }
    const csv = 'Time,Message,Type\n' + DEV.log.map(function (e: any) {
      return '"' + e.time + '","' + e.msg.replace(/"/g, '\'') + '","' + e.type + '"'
    }).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'dev_log_' + new Date().toISOString().slice(0, 10) + '.csv'
    a.click()
    devLog('Log exported to CSV', 'success')
  } catch (e: any) {
    devLog('Export failed: ' + e.message, 'error')
  }
}
w.devExportLog = devExportLog

// ╔══════════════════════════════════════════════════════════════════╗
// ║  ZLOG — Central Logging Buffer v90                               ║
// ╚══════════════════════════════════════════════════════════════════╝
export const ZLOG = (function () {
  const MAX = 400
  const _buf: any[] = []   // [{ts, t, lvl, msg, meta}]
  // Dedup state: skip if same lvl+msg within 2s
  let _lastMsg = '', _lastLvl = '', _lastTs = 0

  function _ts(): string {
    try {
      return new Date().toLocaleTimeString('ro-RO', {
        timeZone: (typeof w.S !== 'undefined' && w.S?.tz) ? w.S.tz : 'Europe/Bucharest',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      })
    } catch (_e) { return new Date().toLocaleTimeString() }
  }

  function push(lvl: string, msg: string, meta?: any): void {
    try {
      lvl = lvl || 'INFO'
      msg = String(msg || '')
      // Dedup: identical lvl+msg within 2s → skip
      const now = Date.now()
      if (lvl === _lastLvl && msg === _lastMsg && (now - _lastTs) < 2000) return
      _lastLvl = lvl; _lastMsg = msg; _lastTs = now
      // Push entry
      _buf.unshift({ ts: _ts(), t: now, lvl, msg, meta: meta || null })
      if (_buf.length > MAX) _buf.length = MAX
      // Update UI counter if rendered
      _updateCounter()
    } catch (_e) { /* silent — never throw from logger */ }
  }

  function _updateCounter(): void {
    try {
      const elc = document.getElementById('zlog-counter')
      if (elc) elc.textContent = 'ZLOG: ' + _buf.length + ' / ' + MAX
    } catch (_e) { /* */ }
  }

  function _toCSV(): string {
    const header = 'Time,Level,Message,Meta\n'
    const rows = _buf.map(function (e: any) {
      const meta = e.meta ? JSON.stringify(e.meta).replace(/"/g, "'") : ''
      return '"' + e.ts + '","' + e.lvl + '","' + e.msg.replace(/"/g, "'") + '","' + meta + '"'
    })
    return header + rows.join('\n')
  }

  function _toJSON(): string {
    return JSON.stringify(_buf, null, 2)
  }

  function exportCSV(): void {
    try {
      const blob = new Blob([_toCSV()], { type: 'text/csv' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'zlog_' + new Date().toISOString().slice(0, 10) + '.csv'
      a.click()
    } catch (e: any) { console.warn('[ZLOG] exportCSV error:', e.message) }
  }

  function exportJSON(): void {
    try {
      const blob = new Blob([_toJSON()], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'zlog_' + new Date().toISOString().slice(0, 10) + '.json'
      a.click()
    } catch (e: any) { console.warn('[ZLOG] exportJSON error:', e.message) }
  }

  function copyCSV(): void {
    try {
      if (!_buf.length) { if (typeof w.toast === 'function') w.toast('ZLOG empty'); return }
      const text = _toCSV()
      // [v119-p14] clipboard fallback: writeText → execCommand → prompt
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          if (typeof w.toast === 'function') w.toast('ZLOG CSV copied (' + _buf.length + ' entries)')
        }).catch(function () { _clipboardFallback(text, 'ZLOG CSV') })
      } else { _clipboardFallback(text, 'ZLOG CSV') }
    } catch (e: any) { console.warn('[ZLOG] copyCSV error:', e.message) }
  }

  function copyJSON(): void {
    try {
      if (!_buf.length) { if (typeof w.toast === 'function') w.toast('ZLOG empty'); return }
      const text = _toJSON()
      // [v119-p14] clipboard fallback
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          if (typeof w.toast === 'function') w.toast('ZLOG JSON copied (' + _buf.length + ' entries)')
        }).catch(function () { _clipboardFallback(text, 'ZLOG JSON') })
      } else { _clipboardFallback(text, 'ZLOG JSON') }
    } catch (e: any) { console.warn('[ZLOG] copyJSON error:', e.message) }
  }

  function clear(): void {
    try {
      _buf.length = 0
      _lastMsg = ''; _lastLvl = ''; _lastTs = 0
      _updateCounter()
      if (typeof w.toast === 'function') w.toast('ZLOG cleared')
    } catch (_e) { /* */ }
  }

  function stats(): any {
    const counts: Record<string, number> = {}
    _buf.forEach(function (e: any) { counts[e.lvl] = (counts[e.lvl] || 0) + 1 })
    return { total: _buf.length, max: MAX, byLevel: counts }
  }

  // Patch atLog + devLog non-invasively (called once at boot)
  function install(): void {
    try {
      if (typeof w.atLog === 'function' && !w.atLog._zlPatched) {
        const _orig = w.atLog
        w.atLog = function (type: any, msg: any) {
          ZLOG.push('AT', msg, { type: type })
          return _orig(type, msg)
        }
        w.atLog._zlPatched = true
      }
    } catch (e: any) { console.warn('[ZLOG] atLog patch error:', e.message) }

    try {
      if (typeof w.devLog === 'function' && !w.devLog._zlPatched) {
        const _origDev = w.devLog
        w.devLog = function (msg: any, type: any) {
          ZLOG.push('DEV', msg, { type: type })
          return _origDev(msg, type)
        }
        w.devLog._zlPatched = true
      }
    } catch (e: any) { console.warn('[ZLOG] devLog patch error:', e.message) }
  }

  // [v119-p14] _clipboardFallback — execCommand → prompt → console.dir
  function _clipboardFallback(text: string, label: string): void {
    try {
      // Incercare 1: execCommand (legacy, merge in majority de browsere mobile)
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;'
      document.body.appendChild(ta)
      ta.focus(); ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      if (ok) {
        if (typeof w.toast === 'function') w.toast((label || 'Text') + ' copied (fallback)')
        return
      }
    } catch (_e) { /* */ }
    try {
      // Incercare 2: prompt — merge aproape universal, user poate copia manual
      window.prompt('Copy ' + (label || 'text') + ' (Ctrl+C / Cmd+C):', text.substring(0, 2000))
    } catch (_e2) {
      // Incercare 3: console.dir ca ultima instanta
      console.dir({ label: label, data: text.substring(0, 5000) })
      if (typeof w.toast === 'function') w.toast((label || 'Text') + ': vezi Console (F12)')
    }
  }

  return { push, exportCSV, exportJSON, copyCSV, copyJSON, clear, stats, install }
})()
w.ZLOG = ZLOG

// ── safeAsync(fn, name, opts) — wraps async functions with catch+ZLOG ──
export function safeAsync(fn: (...args: any[]) => Promise<any>, name?: string, opts?: any): (...args: any[]) => Promise<any> {
  opts = opts || {}
  return async function (this: any, ...args: any[]) {
    try {
      return await fn.apply(this, args)
    } catch (e: any) {
      const msg = '[ERR][' + (name || '?') + '] ' + (e && e.message ? e.message : String(e))
      const stack = (e && e.stack) ? e.stack.split('\n').slice(0, 3).join(' | ') : ''
      // Log to ZLOG always
      ZLOG.push('ERROR', msg, { name: name, stack: stack })
      // Log to devLog if available (dev mode)
      if (typeof w.devLog === 'function') w.devLog(msg, 'error')
      // Log to atLog only if not silent (avoids UI spam for fetchers)
      if (!opts.silent && typeof w.atLog === 'function') w.atLog('warn', msg)
      // Always console
      console.warn('[safeAsync]', msg, stack)
      // Return null safe — callers must handle null
      return null
    }
  }
}
w.safeAsync = safeAsync

// ── Gate check helper ─────────────────────────────────────────────
export function _devModuleOk(name: string): boolean {
  if (DEV._errorModules[name]) {
    devLog(name + ' module disabled due to previous error', 'warning')
    return false
  }
  return true
}
w._devModuleOk = _devModuleOk

export function _devModuleError(name: string, err: any): void {
  DEV._errorModules[name] = true
  devLog('Module "' + name + '" disabled due to error: ' + (err && err.message ? err.message : err), 'error')
}
w._devModuleError = _devModuleError

// ── Event Injectors ───────────────────────────────────────────────
export function devInjectSignal(dir: string): void {
  if (!_devModuleOk('injectSignal')) return
  try {
    const score = 85
    const type = dir === 'LONG' ? 'DEV BULL SIGNAL' : 'DEV BEAR SIGNAL'
    if (typeof w.srRecord === 'function') {
      w.srRecord('dev', type, dir, score)
    } else {
      devLog('srRecord not available', 'warning')
    }
    devLog('Injected ' + dir + ' signal (score ' + score + ')', 'success')
    if (typeof w.updateDeepDive === 'function') w.updateDeepDive()
  } catch (e) { _devModuleError('injectSignal', e) }
}
w.devInjectSignal = devInjectSignal

export function devInjectLiquidation(side: string): void {
  if (!_devModuleOk('injectLiq')) return
  try {
    const usd = Math.floor(Math.random() * 5000000) + 500000
    const price = (w.S && w.S.price) ? w.S.price : 50000
    const qty = usd / price
    const sym = (w.S && w.S.symbol) ? w.S.symbol : 'BTCUSDT'
    const ev = { sym: sym.replace('USDT', ''), isLong: side === 'LONG', usd: usd, price: price, qty: qty, ts: Date.now() }
    if (w.S && w.S.events) {
      w.S.events.unshift(ev)
      if (w.S.events.length > 100) w.S.events.pop()
      if (typeof w.updLiqStats === 'function') w.updLiqStats()
      if (typeof w.renderFeed === 'function') w.renderFeed()
    } else {
      devLog('S.events not available', 'warning')
    }
    if (typeof w.checkLiqAlert === 'function') {
      w.checkLiqAlert(usd, qty, side, sym.replace('USDT', ''))
    }
    const fmtFn = typeof w.fmt === 'function' ? w.fmt : function (n: number) { return n.toFixed(0) }
    const fPFn = typeof w.fP === 'function' ? w.fP : function (n: number) { return n.toFixed(1) }
    devLog('Injected ' + side + ' liquidation $' + fmtFn(usd) + ' @ $' + fPFn(price), 'success')
  } catch (e) { _devModuleError('injectLiq', e) }
}
w.devInjectLiquidation = devInjectLiquidation

export function devInjectWhale(): void {
  if (!_devModuleOk('injectWhale')) return
  try {
    if (typeof w.injectFakeWhale === 'function') {
      w.injectFakeWhale()
      devLog('Injected fake whale event', 'success')
    } else {
      devLog('injectFakeWhale not available', 'warning')
    }
  } catch (e) { _devModuleError('injectWhale', e) }
}
w.devInjectWhale = devInjectWhale

export function devFeedDisconnect(): void {
  if (!_devModuleOk('feedDisconnect')) return
  try {
    if (typeof w._enterRecoveryMode === 'function') {
      w._enterRecoveryMode('DEV')
      devLog('Simulated feed disconnect (recovery mode)', 'warning')
    } else {
      devLog('_enterRecoveryMode not available', 'warning')
    }
  } catch (e) { _devModuleError('feedDisconnect', e) }
}
w.devFeedDisconnect = devFeedDisconnect

export function devFeedRecover(): void {
  if (!_devModuleOk('feedRecover')) return
  try {
    if (typeof w._exitRecoveryMode === 'function') {
      w._exitRecoveryMode()
      devLog('Simulated feed reconnect', 'success')
    } else {
      devLog('_exitRecoveryMode not available', 'warning')
    }
  } catch (e) { _devModuleError('feedRecover', e) }
}
w.devFeedRecover = devFeedRecover

export function devTriggerKillSwitch(): void {
  if (!_devModuleOk('killSwitch')) return
  try {
    if (typeof w.triggerKillSwitch === 'function') {
      w.triggerKillSwitch('manual')
      devLog('Triggered kill switch (manual)', 'warning')
    } else {
      devLog('triggerKillSwitch not available', 'warning')
    }
  } catch (e) { _devModuleError('killSwitch', e) }
}
w.devTriggerKillSwitch = devTriggerKillSwitch

export function devResetProtect(): void {
  if (!_devModuleOk('resetProtect')) return
  try {
    if (typeof w.resetProtectMode === 'function') {
      w.resetProtectMode()
      devLog('Protect mode reset', 'success')
    } else {
      devLog('resetProtectMode not available', 'warning')
    }
  } catch (e) { _devModuleError('resetProtect', e) }
}
w.devResetProtect = devResetProtect

// ── Replay Mode (log-only viewer — does NOT touch WebSocket or live data) ──
export function devReplayStart(): void {
  if (!_devModuleOk('replay')) return
  try {
    if (DEV.replayInterval) { devLog('Replay already running', 'warning'); return }
    if (!w.S || !w.S.klines || w.S.klines.length < 10) {
      devLog('Not enough klines for replay (need >=10)', 'error'); return
    }
    DEV.replayKlines = w.S.klines.slice()
    DEV.replayIndex = 0
    const speedEl = document.getElementById('dev-replay-speed') as HTMLInputElement | null
    const speed = speedEl ? (parseFloat(speedEl.value) || 1) : 1
    const ms = Math.max(100, Math.round(1000 / speed))
    devLog('Replay started: ' + DEV.replayKlines.length + ' bars at ' + speed + 'x', 'info')
    const statusEl = document.getElementById('dev-replay-status')
    DEV.replayInterval = setInterval(function () {
      try {
        if (DEV.replayIndex >= DEV.replayKlines.length) { devReplayStop(); devLog('Replay finished', 'success'); return }
        const bar = DEV.replayKlines[DEV.replayIndex]
        const fPFn = typeof w.fP === 'function' ? w.fP : function (n: number) { return n.toFixed(1) }
        devLog('Bar ' + (DEV.replayIndex + 1) + '/' + DEV.replayKlines.length
          + ' O=' + fPFn(bar.open) + ' H=' + fPFn(bar.high)
          + ' L=' + fPFn(bar.low) + ' C=' + fPFn(bar.close), 'info')
        DEV.replayIndex++
        if (statusEl) statusEl.textContent = 'Playing ' + DEV.replayIndex + '/' + DEV.replayKlines.length
      } catch (e) { devReplayStop(); _devModuleError('replay', e) }
    }, ms)
  } catch (e) { _devModuleError('replay', e) }
}
w.devReplayStart = devReplayStart

export function devReplayStop(): void {
  try {
    if (DEV.replayInterval) {
      clearInterval(DEV.replayInterval)
      DEV.replayInterval = null
      const statusEl = document.getElementById('dev-replay-status')
      if (statusEl) statusEl.textContent = 'Stopped'
    }
  } catch (_e) { /* silent */ }
}
w.devReplayStop = devReplayStop

// ── Toggle Developer panel visibility ────────────────────────────
export function hubToggleDev(enabled: any): void {
  try {
    DEV.enabled = !!enabled

    // Persist to localStorage so next boot restores correctly
    try { localStorage.setItem('zeus_dev_enabled', enabled ? 'true' : 'false') } catch (_e) { /* */ }

    const panel = document.getElementById('dev-sec')
    if (!panel) {
      devLog('dev-sec element not found in DOM', 'error')
      return
    }

    if (enabled) {
      panel.style.display = 'block'
      // Move into #zeus-groups if not already there — fallback for any boot order issue
      const mi = document.getElementById('zeus-groups')
      if (mi && panel.closest('#zeus-groups') === null) {
        mi.appendChild(panel)
        console.log('[DEV] dev-sec moved into #zeus-groups dynamically')
      }
      // Full ensure + scroll
      _devEnsureVisible()
      devLog('Developer Mode activated', 'success')
    } else {
      panel.style.display = 'none'
    }

    // Sync both checkboxes
    const cb1 = document.getElementById('hubDevEnabled') as HTMLInputElement | null
    const cb2 = document.getElementById('hubDevEnabled2') as HTMLInputElement | null
    if (cb1) cb1.checked = !!enabled
    if (cb2) cb2.checked = !!enabled

  } catch (e) {
    console.warn('[DEV] hubToggleDev error:', e)
  }
}
w.hubToggleDev = hubToggleDev

// ── _devEnsureVisible — same pattern as _srEnsureVisible ─────────
export function _devEnsureVisible(): void {
  try {
    const devSec = document.getElementById('dev-sec')
    if (!devSec) return // panel not in DOM yet — nothing to do

    const mi = document.getElementById('zeus-groups')
    if (!mi) return

    // Only proceed if DEV is enabled
    if (!DEV.enabled) return

    // Remove any residual classes/styles left by initZeusGroups recovery paths
    devSec.classList.remove('zg-pending-move')
    devSec.style.removeProperty('visibility')
    devSec.style.removeProperty('max-height')
    devSec.style.removeProperty('overflow')
    // Explicit display:block — do NOT use removeProperty here;
    // the element starts with inline display:none so removeProperty would hide it
    devSec.style.display = 'block'

    // Check if already in MI
    const alreadyInMI = devSec.closest('#zeus-groups') !== null

    if (!alreadyInMI) {
      // Not in MI — insert after deepdive-sec (natural anchor), fallback to append
      const anchor = mi.querySelector('#deepdive-sec')
      if (anchor && anchor.nextSibling) {
        mi.insertBefore(devSec, anchor.nextSibling)
      } else if (anchor) {
        mi.appendChild(devSec)
      } else {
        // deepdive-sec not in MI either — append at end
        mi.appendChild(devSec)
      }
      console.log('[DEV] Fallback: dev-sec fortat in zeus-groups')
    } else {
      // Already in MI — verify it is after deepdive-sec
      const anchor2 = mi.querySelector('#deepdive-sec')
      if (anchor2) {
        const nodes = Array.from(mi.children)
        const anchorIdx = nodes.indexOf(anchor2)
        const devIdx = nodes.indexOf(devSec)
        if (devIdx <= anchorIdx) {
          // Out of order — reposition after anchor
          if (anchor2.nextSibling) {
            mi.insertBefore(devSec, anchor2.nextSibling)
          } else {
            mi.appendChild(devSec)
          }
          console.log('[DEV] Fallback: dev-sec repositionat dupa deepdive-sec')
        }
      }
    }

    // Render log so panel shows content immediately
    _devRenderLog()

    // Fix C — scroll panel into view with a brief blink so user sees it instantly
    try {
      devSec.scrollIntoView({ behavior: 'smooth', block: 'start' })
      devSec.style.outline = '1px solid #aa88ff'
      setTimeout(function () {
        try { devSec.style.removeProperty('outline') } catch (_e) { /* */ }
      }, 900)
    } catch (_e) { /* */ }

  } catch (e: any) {
    console.warn('[DEV] Fallback _devEnsureVisible error:', e.message)
  }
}
w._devEnsureVisible = _devEnsureVisible

// ════════════════════════════════════════════════════════════════
// UI SCALE — CSS variable + localStorage persistence
// ════════════════════════════════════════════════════════════════
export function setUiScale(val: any): void {
  let v = parseFloat(val)
  if (isNaN(v) || v < 0.5 || v > 3) v = 1
  document.documentElement.style.setProperty('--ui-scale', String(v))
  try { localStorage.setItem('zeus_ui_scale', String(v)) } catch (_e) { /* */ }
  if (typeof w._ucMarkDirty === 'function') w._ucMarkDirty('uiScale')
  if (typeof w._userCtxPush === 'function') w._userCtxPush()
  const sel = document.getElementById('hubUiScale') as HTMLSelectElement | null
  if (sel) sel.value = String(v)
}
w.setUiScale = setUiScale

// Restore on script load
;(function () {
  try {
    const saved = parseFloat(localStorage.getItem('zeus_ui_scale') || '')
    if (!isNaN(saved) && saved >= 0.5 && saved <= 3) {
      document.documentElement.style.setProperty('--ui-scale', String(saved))
    }
  } catch (_e) { /* */ }
})()

// ════════════════════════════════════════════════════════════════
// SETTINGS HUB
// ════════════════════════════════════════════════════════════════

export function hubPopulate(): void {
  try {
    // ── General ─────────────────────────────────────────────────
    const ceEl = document.getElementById('hubCloudEmail') as HTMLInputElement | null
    if (ceEl) ceEl.value = '' // [FIX v85 BUG1] Nu afisam emailul din S (nu se stocheaza in clar)

    const notEl = document.getElementById('hubNotifyEnabled') as HTMLInputElement | null
    if (notEl) notEl.checked = (w.S && w.S.alerts) ? (w.S.alerts.enabled !== false) : true

    const devCb = document.getElementById('hubDevEnabled') as HTMLInputElement | null
    if (devCb) devCb.checked = DEV.enabled
    const devCb2 = document.getElementById('hubDevEnabled2') as HTMLInputElement | null
    if (devCb2) devCb2.checked = DEV.enabled

    // ── Theme ────────────────────────────────────────────────────
    const _ts = document.getElementById('themeSelect') as HTMLSelectElement | null
    if (_ts) _ts.value = w.zeusGetTheme ? w.zeusGetTheme() : 'native'

    // ── UI Scale ────────────────────────────────────────────────
    const scaleSel = document.getElementById('hubUiScale') as HTMLSelectElement | null
    if (scaleSel) {
      const sv = localStorage.getItem('zeus_ui_scale')
      scaleSel.value = (sv && !isNaN(parseFloat(sv))) ? String(parseFloat(sv)) : '1'
    }

    const _setV = function (id: string, val: any) {
      const elv = document.getElementById(id) as HTMLInputElement | null
      if (elv) elv.value = val
    }

    // ── Alerts ───────────────────────────────────────────────────
    const al = (w.S && w.S.alerts) ? w.S.alerts : {} as any
    const _setC = function (id: string, val: any) {
      const elc = document.getElementById(id) as HTMLInputElement | null
      if (elc) elc.checked = val !== false
    }
    _setC('hubAlertMaster', al.enabled)
    _setC('hubAlertVol', al.volSpike)
    _setC('hubAlertWhale', al.whaleOrders)
    _setC('hubAlertLiq', al.liqAlerts)
    _setC('hubAlertDiv', al.divergence)
    _setC('hubAlertRsi', al.rsiAlerts)
    _setV('hubWhaleMin', al.whaleMinBtc !== undefined ? al.whaleMinBtc : 100)
    _setV('hubLiqMin', al.liqMinBtc !== undefined ? al.liqMinBtc : 1)

    // ── Auto Trade (populate AT panel toggles) ──────────────────
    const at = (typeof w.USER_SETTINGS !== 'undefined' && w.USER_SETTINGS.autoTrade)
      ? w.USER_SETTINGS.autoTrade : {}
    const atSeEl = document.getElementById('atSmartExit') as HTMLInputElement | null
    if (atSeEl) atSeEl.checked = at.smartExitEnabled === true
    const atAdaptEl = document.getElementById('atAdaptEnabled') as HTMLInputElement | null
    const BM = getBrainMetrics()
    if (atAdaptEl) atAdaptEl.checked = BM?.adapt && BM.adapt.enabled === true
    const atAdaptLiveEl = document.getElementById('atAdaptLive') as HTMLInputElement | null
    if (atAdaptLiveEl) atAdaptLiveEl.checked = BM?.adapt && BM.adapt.allowLiveAdjust === true

    // ── Telegram ──────────────────────────────────────────────────
    if (typeof w.hubTgPopulate === 'function') w.hubTgPopulate()

  } catch (e) {
    console.warn('[Hub] hubPopulate error:', e)
  }
}
w.hubPopulate = hubPopulate

export function hubSaveAll(): void {
  try {
    // ── General ─────────────────────────────────────────────────
    const notEl = document.getElementById('hubNotifyEnabled') as HTMLInputElement | null
    if (notEl && w.S && w.S.alerts) w.S.alerts.enabled = notEl.checked

    // ── Alerts ───────────────────────────────────────────────────
    if (w.S) {
      if (!w.S.alerts) w.S.alerts = {}
      const _getC = function (id: string, def: boolean) {
        const elc = document.getElementById(id) as HTMLInputElement | null
        return elc ? elc.checked : def
      }
      w.S.alerts.enabled = _getC('hubAlertMaster', true)
      w.S.alerts.volSpike = _getC('hubAlertVol', true)
      w.S.alerts.whaleOrders = _getC('hubAlertWhale', true)
      w.S.alerts.liqAlerts = _getC('hubAlertLiq', true)
      w.S.alerts.divergence = _getC('hubAlertDiv', true)
      w.S.alerts.rsiAlerts = _getC('hubAlertRsi', true)
      w.S.alerts.whaleMinBtc = parseFloat((document.getElementById('hubWhaleMin') as HTMLInputElement)?.value) || 100
      w.S.alerts.liqMinBtc = parseFloat((document.getElementById('hubLiqMin') as HTMLInputElement)?.value) || 1
    }

    // ── Persist ───────────────────────────────────────────────────
    if (typeof w._usSave === 'function') {
      try { w._usSave() } catch (_e) { /* */ }
    }

    // ── Telegram (push to server) ─────────────────────────────────
    const tgToken = document.getElementById('hubTgBotToken') as HTMLInputElement | null
    const tgChat = document.getElementById('hubTgChatId') as HTMLInputElement | null
    if (tgToken && tgChat && tgToken.value.trim() && tgChat.value.trim()) {
      hubTgSave()
    }

    if (typeof w.toast === 'function') w.toast('All settings saved', 0, w._ZI?.ok)
    devLog('Settings saved via Hub', 'info')

  } catch (e) {
    console.warn('[Hub] hubSaveAll error:', e)
    if (typeof w.toast === 'function') w.toast('Save error — check console')
  }
}
w.hubSaveAll = hubSaveAll

export function hubLoadAll(): void {
  try {
    if (typeof w.loadUserSettings === 'function') w.loadUserSettings()
    hubPopulate()
    if (typeof w.toast === 'function') w.toast('Settings loaded', 0, w._ZI?.fold)
  } catch (e) {
    console.warn('[Hub] hubLoadAll error:', e)
  }
}
w.hubLoadAll = hubLoadAll

// ── Telegram Settings ─────────────────────────────────────────────
export function hubTgSave(): void {
  const tokenEl = document.getElementById('hubTgBotToken') as HTMLInputElement | null
  const chatEl = document.getElementById('hubTgChatId') as HTMLInputElement | null
  const statusEl = document.getElementById('hubTgStatus')
  const token = tokenEl ? tokenEl.value.trim() : ''
  const chatId = chatEl ? chatEl.value.trim() : ''
  if (!token || !chatId) {
    if (statusEl) statusEl.innerHTML = '<span style="color:#ff6655">' + w._ZI?.w + ' Completeaza ambele campuri</span>'
    return
  }
  // Token saved server-side only (encrypted) — never store in localStorage
  // Push to server runtime config
  fetch('/api/user/telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ botToken: token, chatId: chatId })
  }).then(function (r) { return r.json() }).then(function (d: any) {
    if (d.ok) {
      if (statusEl) statusEl.innerHTML = '<span style="color:#00d97a">' + w._ZI?.ok + ' Salvat + trimis la server</span>'
      if (typeof w.toast === 'function') w.toast('Telegram saved', 0, w._ZI?.ok)
    } else {
      if (statusEl) statusEl.innerHTML = '<span style="color:#ff6655">' + w._ZI?.w + ' Server: ' + (d.error || 'error') + '</span>'
    }
  }).catch(function (e: any) {
    if (statusEl) statusEl.innerHTML = '<span style="color:#ff6655">' + w._ZI?.w + ' ' + e.message + '</span>'
  })
}
w.hubTgSave = hubTgSave

export function hubTgTest(): void {
  const statusEl = document.getElementById('hubTgStatus')
  // Save first to ensure server has the latest creds
  hubTgSave()
  setTimeout(function () {
    if (statusEl) statusEl.innerHTML = '<span style="color:#4fc3f7">' + w._ZI?.mail + ' Sending test...</span>'
    fetch('/api/user/telegram/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }).then(function (r) { return r.json() }).then(function (d: any) {
      if (d.ok) {
        if (statusEl) statusEl.innerHTML = '<span style="color:#00d97a">' + w._ZI?.ok + ' Test trimis — verifica Telegram!</span>'
      } else {
        if (statusEl) statusEl.innerHTML = '<span style="color:#ff6655">' + w._ZI?.w + ' Mesajul nu s-a trimis — verifica token/chat ID</span>'
      }
    }).catch(function (e: any) {
      if (statusEl) statusEl.innerHTML = '<span style="color:#ff6655">' + w._ZI?.w + ' ' + e.message + '</span>'
    })
  }, 500)
}
w.hubTgTest = hubTgTest

export function hubTgPopulate(): void {
  const tokenEl = document.getElementById('hubTgBotToken') as HTMLInputElement | null
  const chatEl = document.getElementById('hubTgChatId') as HTMLInputElement | null
  // Fetch server-side config (token stored encrypted server-side, never in browser)
  fetch('/api/user/telegram').then(function (r) { return r.json() }).then(function (d: any) {
    if (d.configured) {
      if (chatEl) chatEl.value = d.chatId || ''
      if (tokenEl) tokenEl.placeholder = '(saved on server)'
    }
    const statusElInner = document.getElementById('hubTgStatus')
    if (statusElInner && d.configured) statusElInner.innerHTML = '<span style="color:#4fc3f7">' + w._ZI?.inf + ' Telegram configurat (chat: ' + d.chatId + ')</span>'
  }).catch(function () { /* */ })
}
w.hubTgPopulate = hubTgPopulate

export function hubResetDefaults(): void {
  try {
    if (!confirm('Reset all settings to defaults?')) return
    if (w.S) {
      w.S.chartTf = '5m'
      w.S.tz = 'Europe/Bucharest'
      if (!w.S.activeInds) w.S.activeInds = {}
      w.S.activeInds = {
        ema: true, wma: true, st: true, vp: true,
        macd: false, bb: false, stoch: false, obv: false,
        atr: false, vwap: false, ichimoku: false, fib: false,
        pivot: false, rsi14: false, mfi: false, cci: false
      }
      w.S.alerts = {
        enabled: true, volSpike: true, whaleOrders: true, liqAlerts: true,
        divergence: true, rsiAlerts: true, whaleMinBtc: 100, liqMinBtc: 1
      }
      w.S.rsiPeriod = 14; w.S.macdFast = 12; w.S.macdSlow = 26; w.S.macdSig = 9
    }
    if (typeof w.USER_SETTINGS !== 'undefined') {
      w.USER_SETTINGS.autoTrade = {
        lev: 5, sl: 1.5, rr: 2, size: 200, maxPos: 4,
        killPct: 5, confMin: 65, sigMin: 3, multiSym: true
      }
    }
    hubPopulate()
    hubSaveAll()
    if (typeof w.toast === 'function') w.toast('Defaults restored')
  } catch (e) {
    console.warn('[Hub] hubResetDefaults error:', e)
  }
}
w.hubResetDefaults = hubResetDefaults

// ── Hub helpers ───────────────────────────────────────────────────
export function hubSetTf(_tf: string, btn: HTMLElement | null): void {
  try {
    document.querySelectorAll('#hubTfGroup .qb').forEach(function (b) { b.classList.remove('act') })
    if (btn) btn.classList.add('act')
  } catch (_e) { /* */ }
}
w.hubSetTf = hubSetTf

export function hubSetTZ(_tz: string, btn: HTMLElement | null): void {
  try {
    document.querySelectorAll('#hubTzGroup .qb').forEach(function (b) { b.classList.remove('act') })
    if (btn) btn.classList.add('act')
  } catch (_e) { /* */ }
}
w.hubSetTZ = hubSetTZ

export function hubApplyChartColors(): void {
  try {
    const bull = (document.getElementById('hubCcBull') as HTMLInputElement)?.value || '#00d97a'
    const bear = (document.getElementById('hubCcBear') as HTMLInputElement)?.value || '#ff3355'
    if (typeof w.cSeries !== 'undefined' && w.cSeries) {
      w.cSeries.applyOptions({
        upColor: bull, downColor: bear,
        borderUpColor: bull, borderDownColor: bear,
        wickUpColor: bull, wickDownColor: bear
      })
    }
  } catch (e) { console.warn('[Hub] hubApplyChartColors error:', e) }
}
w.hubApplyChartColors = hubApplyChartColors

export function hubCloudSave(): void {
  try {
    const email = (document.getElementById('hubCloudEmail') as HTMLInputElement)?.value || ''
    if (!email) { if (typeof w.toast === 'function') w.toast('Enter an email address'); return }
    // [FIX v85 BUG1] Nu salvam emailul in S.cloudEmail
    const mainEmailEl = w.el('cloudEmail'); if (mainEmailEl) mainEmailEl.value = email
    if (typeof w.cloudSave === 'function') { w.cloudSave() }
    else if (typeof w.toast === 'function') w.toast('cloudSave not available')
  } catch (e) { console.warn('[Hub] hubCloudSave error:', e) }
}
w.hubCloudSave = hubCloudSave

export function hubCloudLoad(): void {
  try {
    const email = (document.getElementById('hubCloudEmail') as HTMLInputElement)?.value || ''
    if (!email) { if (typeof w.toast === 'function') w.toast('Enter an email address'); return }
    // [FIX v85 BUG1] Nu salvam emailul in S.cloudEmail
    const mainEmailEl = w.el('cloudEmail'); if (mainEmailEl) mainEmailEl.value = email
    if (typeof w.cloudLoad === 'function') { w.cloudLoad() }
    else if (typeof w.toast === 'function') w.toast('cloudLoad not available')
  } catch (e) { console.warn('[Hub] hubCloudLoad error:', e) }
}
w.hubCloudLoad = hubCloudLoad

export function hubCloudClear(): void {
  try {
    const emailEl = document.getElementById('hubCloudEmail') as HTMLInputElement | null
    if (emailEl) emailEl.value = ''
    // [FIX v85 BUG1] Nu resetam S.cloudEmail (nu mai e folosit)
    if (typeof w.cloudClear === 'function') { w.cloudClear() }
  } catch (e) { console.warn('[Hub] hubCloudClear error:', e) }
}
w.hubCloudClear = hubCloudClear
