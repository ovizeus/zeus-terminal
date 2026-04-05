/**
 * Zeus Terminal — Number & date formatting (ported from public/js/utils/formatters.js)
 * Exposes: fmt, fP, fmtTime, fmtTimeSec, fmtDate, fmtFull, _TZ
 */

/** Format large numbers: 1.5B, 2.3M, 4.1K, 123 */
export function fmt(n: number): string {
  if (!Number.isFinite(+n)) return '—'
  n = +n
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toFixed(0)
}

/** Format price with dynamic decimals based on magnitude */
export function fP(n: number): string {
  if (!Number.isFinite(+n)) return '—'
  n = +n
  if (n >= 10000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (n >= 100) return n.toFixed(2)
  if (n >= 1) return n.toFixed(4)
  if (n >= 0.01) return n.toFixed(5)
  return n.toPrecision(4)
}

export const _TZ = 'Europe/Bucharest'

const _dtfTime = new Intl.DateTimeFormat('ro-RO', { timeZone: _TZ, hour: '2-digit', minute: '2-digit', hour12: false })
const _dtfTimeSec = new Intl.DateTimeFormat('ro-RO', { timeZone: _TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
const _dtfDate = new Intl.DateTimeFormat('ro-RO', { timeZone: _TZ, day: '2-digit', month: 'short', year: '2-digit' })
const _dtfFull = new Intl.DateTimeFormat('ro-RO', { timeZone: _TZ, day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

export function fmtTime(ts: number): string { return _dtfTime.format(new Date(ts * 1000)) }
export function fmtTimeSec(ts: number): string { return _dtfTimeSec.format(new Date(ts * 1000)) }
export function fmtDate(ts: number): string { return _dtfDate.format(new Date(ts * 1000)) }
export function fmtFull(ts: number): string { return _dtfFull.format(new Date(ts * 1000)) }
