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
    'flex-direction:column', 'align-items:center', 'gap:6px',
    'max-width:min(88vw,380px)', 'width:max-content',
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
    const reduced = typeof matchMedia === 'function' && !!matchMedia('(prefers-reduced-motion: reduce)').matches

    // [2026-11-08] Assigned property by property, NOT through one cssText.
    // A single declaration the parser dislikes takes the whole block down with
    // it — jsdom dropped the lot and the element rendered unstyled, which is
    // also how the accent border was lost earlier today. One property, one
    // outcome.
    const st = box.style
    st.display = 'flex'
    st.alignItems = 'flex-start'
    st.gap = '7px'
    st.padding = '6px 11px 7px 9px'
    st.minWidth = 'min(78vw,190px)'
    st.maxWidth = '100%'
    st.background = th.bg
    st.border = '1px solid ' + th.border
    st.borderRadius = '3px'
    st.boxShadow = th.shadow
    st.color = th.text
    st.fontFamily = 'var(--ff)'
    st.fontSize = '10px'
    st.lineHeight = '1.45'
    st.letterSpacing = '0.25px'
    st.pointerEvents = 'none'
    st.opacity = '0'
    st.backdropFilter = 'blur(7px)'
    ;(st as unknown as Record<string, string>).webkitBackdropFilter = 'blur(7px)'

    // Set apart from the rest on purpose: `border` followed by `border-left`
    // is a shorthand fighting a longhand, and which one survives is up to the
    // parser. This must never be lost — it is the whole signal.
    st.borderLeftWidth = '2px'
    st.borderLeftStyle = 'solid'
    st.borderLeftColor = th.accent

    // "Sa apara ca din ceata si sa dispara la fel" — a blur that clears, not a
    // box that pops. Opacity alone reads as a flash; the blur is what makes it
    // arrive softly. Dropped for anyone who asked for reduced motion.
    if (reduced) {
      st.transition = 'opacity .22s ease'
    } else {
      st.filter = 'blur(7px)'
      st.transform = 'translateY(-5px) scale(0.985)'
      st.transition = 'opacity .34s cubic-bezier(.2,.6,.2,1), filter .34s cubic-bezier(.2,.6,.2,1), transform .34s cubic-bezier(.2,.6,.2,1)'
    }

    const col = document.createElement('div')
    col.style.cssText = 'flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px'

    const headline = String(opts.title || toastLabel(lvl) || '').trim()
    if (headline) {
      const head = document.createElement('div')
      head.style.cssText = 'display:flex;align-items:baseline;gap:10px;justify-content:space-between'

      const ttl = document.createElement('span')
      ttl.textContent = headline
      ttl.style.cssText = [
        'font-size:9px', 'font-weight:700', 'letter-spacing:1.2px',
        'text-transform:uppercase', 'color:' + th.accent,
        'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis',
      ].join(';')
      head.appendChild(ttl)

      const stamp = document.createElement('span')
      stamp.textContent = _toastClock()
      stamp.style.cssText = 'flex:0 0 auto;font-size:8px;letter-spacing:0.5px;color:#54707f;font-variant-numeric:tabular-nums'
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
      stamp.style.cssText = 'font-size:8px;letter-spacing:0.5px;color:#54707f;font-variant-numeric:tabular-nums'
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
    requestAnimationFrame(() => {
      box.style.opacity = '1'
      if (!reduced) { box.style.filter = 'blur(0px)'; box.style.transform = 'translateY(0) scale(1)' }
    })

    // dur <= 0 means "stay until something replaces it" — several callers
    // rely on that for blocking conditions, so it must keep working.
    if (ms > 0) {
      setTimeout(() => {
        // Leaves the way it came: back into the blur, a touch slower, so it
        // fades out of attention instead of being snatched away.
        box.style.opacity = '0'
        if (!reduced) {
          box.style.filter = 'blur(7px)'
          box.style.transform = 'translateY(-4px) scale(0.985)'
          box.style.transitionDuration = '.46s'
        }
        setTimeout(() => box.remove(), reduced ? 260 : 520)
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
