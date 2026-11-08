// Zeus — data/marketDataHelpers.ts
// Ported 1:1 from public/js/data/marketData.js lines 1-109 (Chunk A)
//
// ONLY functions that don't exist elsewhere in the TS codebase:
//   - fmtTime/fmtTimeSec/fmtDate/fmtFull: DYNAMIC timezone (S.tz) — supersedes
//     the STATIC versions from format.ts which use hardcoded _TZ
//   - fmtNow: new, not in format.ts
//   - toast: new, not ported elsewhere
//   - _calcATRSeries: new, only existed in marketData.js
//   - calcRSI: scalar RSI, different from calcRSIArr in math.ts
//
// NOT included (already ported):
//   - _escHtml → identical to escHtml in utils/dom.ts (Phase 1)

import { _TZ } from '../utils/format'
import { toastTheme, toastLabel, inferLevel, TOAST_MAX_STACK, type ToastLevel } from '../ui/toastTheme'

const w = window as any

// ═══ DYNAMIC TIME HELPERS — use S.tz (changeable from UI) ═══════
// These REPLACE the static versions from format.ts on window.*
// Old JS and other TS modules consume via window.fmtTime() etc.
export function fmtTime(ts: any): string {
  if (!ts) return '\u2014'
  const ms = ts > 1e10 ? ts : ts * 1000
  return new Intl.DateTimeFormat('ro-RO', { timeZone: (typeof w.S !== 'undefined' && w.S?.tz) || _TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms))
}
export function fmtTimeSec(ts: any): string {
  if (!ts) return '\u2014'
  const ms = ts > 1e10 ? ts : ts * 1000
  return new Intl.DateTimeFormat('ro-RO', { timeZone: (typeof w.S !== 'undefined' && w.S?.tz) || _TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(ms))
}
export function fmtDate(ts: any): string {
  if (!ts) return '\u2014'
  const ms = ts > 1e10 ? ts : ts * 1000
  return new Intl.DateTimeFormat('ro-RO', { timeZone: (typeof w.S !== 'undefined' && w.S?.tz) || _TZ, day: '2-digit', month: 'short', year: '2-digit' }).format(new Date(ms))
}
export function fmtFull(ts: any): string {
  if (!ts) return '\u2014'
  const ms = ts > 1e10 ? ts : ts * 1000
  return new Intl.DateTimeFormat('ro-RO', { timeZone: (typeof w.S !== 'undefined' && w.S?.tz) || _TZ, day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms))
}
export function fmtNow(sec?: any): string {
  return sec ? fmtTimeSec(Date.now()) : fmtTime(Date.now())
}

// ===== ON-SCREEN MESSAGES =====
/**
 * [2026-11-08] Rebuilt. Every message in the app used one hardcoded style —
 * amber text on a slate box, 10px — so a routine "saved" and a failed order
 * looked the same, and all of it read like a warning nobody had to act on.
 * That is how a person learns to ignore the one that matters.
 *
 * Now: a quiet dark panel, NEUTRAL text, and the meaning carried by a thin
 * accent edge and a dot. Amber means an actual warning again.
 *
 * Two behaviours changed with the look:
 *   - up to TOAST_MAX_STACK messages show at once. There was ONE element,
 *     reused, so a liquidation alert silently erased a whale alert that
 *     arrived a moment earlier — and the new alert rules fire more often.
 *   - the level is inferred from the words when the caller does not say,
 *     narrowly: 189 call sites pass none, and guessing loud would turn
 *     everything into a warning again, which is the thing being fixed.
 *
 * The signature is unchanged, so none of those 189 calls had to be touched.
 */
export interface ToastOpts { dur?: number; icon?: any; level?: ToastLevel; title?: string }

/** HH:MM:SS in the user's own timezone, which is the one on their clock. */
function _toastClock(): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: (typeof w !== 'undefined' && (w as any)?.S?.tz) || undefined,
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(new Date())
  } catch { return '' }
}

function _toastHost(): HTMLElement {
  let host = document.getElementById('zeus-toasts')
  if (host) return host
  host = document.createElement('div')
  host.id = 'zeus-toasts'
  // Top, under the header. The offset is the app's OWN header-height variable
  // (--zt-content-top, 120px desktop / 80px phone), not a number guessed from
  // a screenshot — so it stays correct when the header changes.
  host.style.cssText = [
    'position:fixed', 'left:50%',
    'top:calc(var(--zt-content-top, 120px) + env(safe-area-inset-top, 0px) + 8px)',
    'transform:translateX(-50%)',
    'z-index:9999', 'pointer-events:none', 'display:flex',
    'flex-direction:column', 'align-items:center', 'gap:8px',
    'max-width:min(92vw,460px)', 'width:max-content',
  ].join(';')
  document.body.appendChild(host)
  return host
}

export function toast(msg: string, dur: number | ToastOpts = 3000, icon?: any, level?: ToastLevel): void {
  try {
    const opts: ToastOpts = (dur && typeof dur === 'object') ? dur : { dur: dur as number, icon, level }
    const ms = Number.isFinite(opts.dur as number) ? (opts.dur as number) : 3000
    const lvl = opts.level || inferLevel(msg)
    const th = toastTheme(lvl)
    const host = _toastHost()

    // Oldest first out, so the newest is always the one nearest the thumb.
    while (host.childElementCount >= TOAST_MAX_STACK && host.firstElementChild) {
      host.firstElementChild.remove()
    }

    const box = document.createElement('div')
    box.className = 'zeus-toast'
    box.setAttribute('role', lvl === 'error' ? 'alert' : 'status')
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    box.style.cssText = [
      'display:flex', 'align-items:flex-start', 'gap:9px',
      'padding:8px 13px 9px 11px',
      'min-width:min(86vw,260px)',
      'background:' + th.bg,
      'border:1px solid ' + th.border,
      'border-radius:3px',
      'box-shadow:' + th.shadow,
      'color:' + th.text,
      'font-family:var(--ff)', 'font-size:11px', 'line-height:1.5',
      'letter-spacing:0.3px',
      'backdrop-filter:blur(7px)', '-webkit-backdrop-filter:blur(7px)',
      'pointer-events:none', 'max-width:100%',
      'opacity:0',
      reduced ? 'transition:opacity .14s ease' : 'transform:translateY(6px);transition:opacity .16s ease,transform .16s ease',
    ].join(';')

    // Set apart from the cssText above on purpose: `border` followed by
    // `border-left` inside one cssText is a shorthand fighting a longhand, and
    // which one survives is up to the parser. This one must never be lost —
    // it is the whole signal.
    box.style.borderLeftWidth = '3px'
    box.style.borderLeftStyle = 'solid'
    box.style.borderLeftColor = th.accent

    // The body is a column: a heading line, then the detail. The alerts
    // already carry a title and a body separately — they used to be glued
    // into one sentence, which is what made an alert read like any other
    // line of text.
    const col = document.createElement('div')
    col.style.cssText = 'flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px'

    const headline = String(opts.title || toastLabel(lvl) || '').trim()
    if (headline) {
      const head = document.createElement('div')
      head.style.cssText = 'display:flex;align-items:baseline;gap:10px;justify-content:space-between'

      const ttl = document.createElement('span')
      ttl.textContent = headline
      ttl.style.cssText = [
        'font-size:10px', 'font-weight:700', 'letter-spacing:1.3px',
        'text-transform:uppercase', 'color:' + th.accent,
        'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis',
      ].join(';')
      head.appendChild(ttl)

      const stamp = document.createElement('span')
      stamp.textContent = _toastClock()
      stamp.style.cssText = 'flex:0 0 auto;font-size:9px;letter-spacing:0.6px;color:#5c7a90;font-variant-numeric:tabular-nums'
      head.appendChild(stamp)
      col.appendChild(head)
    }

    const detail = document.createElement('div')
    detail.textContent = String(msg == null ? '' : msg)
    detail.style.cssText = 'min-width:0;overflow-wrap:anywhere'
    col.appendChild(detail)

    // With no headline there is no row to hang the clock on, so it joins the
    // single line instead of being dropped.
    if (!headline) {
      const stamp = document.createElement('span')
      stamp.textContent = ' · ' + _toastClock()
      stamp.style.cssText = 'font-size:9px;letter-spacing:0.6px;color:#5c7a90;font-variant-numeric:tabular-nums'
      detail.appendChild(stamp)
    }

    if (opts.icon) {
      const mark = document.createElement('span')
      mark.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;align-self:flex-start;margin-top:1px;color:' + th.accent
      mark.innerHTML = opts.icon
      box.appendChild(mark)
    }
    box.appendChild(col)

    host.appendChild(box)
    // Next frame, so the entrance actually animates instead of snapping.
    requestAnimationFrame(() => { box.style.opacity = '1'; box.style.transform = 'translateY(0)' })

    // dur <= 0 means "stay until something replaces it" — several callers
    // rely on that for blocking conditions, so it must keep working.
    if (ms > 0) {
      setTimeout(() => {
        box.style.opacity = '0'
        if (!reduced) box.style.transform = 'translateY(6px)'
        setTimeout(() => box.remove(), 220)
      }, ms)
    }
  } catch (e) {
    // A message must never be the thing that breaks the screen it appears on.
    console.warn('[toast]', (e as Error)?.message, msg)
  }
}

// ===== ATR UNIFIED (Wilder) — single source of truth v88 =====
export function _calcATRSeries(klines: any, period?: any, method?: any): any {
  try {
    period = (period && period > 0) ? Math.round(period) : 14
    method = method || 'wilder'
    const n = klines ? klines.length : 0
    const series = new Array(n).fill(null)
    if (n < period + 2) return { series, last: null }
    const tr = new Array(n).fill(0)
    for (let i = 1; i < n; i++) {
      const h = klines[i].high, l = klines[i].low, pc = klines[i - 1].close
      tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))
    }
    if (method === 'sma') {
      for (let i = period; i < n; i++) {
        let s = 0; for (let j = i - period + 1; j <= i; j++) s += tr[j]
        series[i] = s / period
      }
    } else {
      let seedSum = 0
      for (let j = 1; j <= period; j++) seedSum += tr[j]
      series[period] = seedSum / period
      for (let j = period + 1; j < n; j++) series[j] = (series[j - 1] * (period - 1) + tr[j]) / period
    }
    let last = null
    for (let i = n - 1; i >= 0; i--) { if (series[i] !== null) { last = series[i]; break } }
    return { series, last }
  } catch (e: any) {
    console.warn('[_calcATRSeries] error:', e.message)
    return { series: [], last: null }
  }
}

// ===== RSI (scalar) =====
// Different from calcRSIArr in math.ts (which returns per-bar array)
export function calcRSI(prices: number[], p = 14): number | null {
  if (prices.length < p + 1) return null
  let g = 0, l = 0
  for (let i = 1; i <= p; i++) { const d = prices[i] - prices[i - 1]; if (d > 0) g += d; else l += Math.abs(d) }
  let ag = g / p, al = l / p
  for (let i = p + 1; i < prices.length; i++) { const d = prices[i] - prices[i - 1]; if (d > 0) { ag = (ag * (p - 1) + d) / p; al = al * (p - 1) / p } else { ag = ag * (p - 1) / p; al = (al * (p - 1) + Math.abs(d)) / p } }
  if (ag === 0 && al === 0) return 50
  return al === 0 ? 100 : 100 - (100 / (1 + (ag / al)))
}
