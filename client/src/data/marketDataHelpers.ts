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

// ===== TOAST =====
export function toast(msg: string, dur = 3000, icon?: any): void {
  let t: any = w.el('toast')
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);background:#1a2530;border:1px solid #f0c04044;color:#f0c040;padding:8px 16px;border-radius:4px;font-size:10px;z-index:9999;pointer-events:none;transition:.3s;max-width:80%;display:flex;align-items:center;gap:4px'; document.body.appendChild(t) }
  if (icon) { t.innerHTML = ''; const _s = document.createElement('span'); _s.innerHTML = icon; t.appendChild(_s); t.appendChild(document.createTextNode(' ' + msg)) }
  else { t.textContent = msg }
  t.style.opacity = '1'
  clearTimeout(t._t); t._t = setTimeout(() => t.style.opacity = '0', dur)
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
