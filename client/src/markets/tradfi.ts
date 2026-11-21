// [2026-11-21] MARKETS — piete traditionale (aur, petrol, indici, actiuni), doar informare.
// Datele vin DOAR de la serverul nostru (GET /api/market/tradfi), care le ia de la Gate in timp real.
// Un singur sondaj pentru toata aplicatia: caseta de pe ecranul principal + panoul il impart.
import { startPoll } from '../utils/poll'

export type TradfiGroup = 'metals' | 'energy' | 'indices' | 'forex' | 'stocks' | 'crypto'
export interface TradfiItem {
  sym: string; name: string; group: TradfiGroup; market: string
  price: number; chg24: number | null; high24: number | null; low24: number | null; vol24: number | null
  chg30: number | null; spark: number[]; corrBtc: number | null; open: boolean
}
export interface TradfiSnap {
  ok: boolean; asOf: number | null; source: string; stale: boolean; error: string | null
  sessions: Record<string, boolean>; items: TradfiItem[]
}

export const GROUPS: Array<{ id: 'all' | TradfiGroup; label: string }> = [
  { id: 'all', label: 'All' }, { id: 'metals', label: 'Metals' }, { id: 'energy', label: 'Energy' },
  { id: 'indices', label: 'Indices' }, { id: 'forex', label: 'FX & Bonds' }, { id: 'stocks', label: 'Stocks' },
  { id: 'crypto', label: 'Crypto-linked' },
]
/** Ce arata caseta de pe ecranul principal, in ordinea asta. */
export const HIGHLIGHTS = ['XAU', 'SPX500', 'NAS100', 'CL', 'XAG', 'NVDA', 'TSLA', 'EURUSD', 'MSTR', 'US30']

// ── formatare (PURE) ──
export function fmtPrice(p: number): string {
  if (!Number.isFinite(p)) return '—'
  const d = p >= 1000 ? 2 : p >= 10 ? 2 : p >= 1 ? 4 : 5
  return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}
export function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return (v > 0 ? '+' : '') + v.toFixed(2) + '%'
}
export function fmtCompact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return '—'
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K'
  return '$' + v.toFixed(0)
}
/** Cat de legat e de BTC (30 de zile). Pragurile uzuale pentru corelatie. */
export function corrInfo(r: number | null): { label: string; tone: 'strong' | 'moderate' | 'none' | 'inverse' | 'unknown'; text: string } {
  if (r == null || !Number.isFinite(r)) return { label: '—', tone: 'unknown', text: 'Not enough shared history yet (needs 15+ days).' }
  const v = r.toFixed(2)
  if (r >= 0.6) return { label: v, tone: 'strong', text: 'Moves strongly WITH Bitcoin over the last 30 days.' }
  if (r >= 0.3) return { label: v, tone: 'moderate', text: 'Moves somewhat with Bitcoin over the last 30 days.' }
  if (r <= -0.3) return { label: v, tone: 'inverse', text: 'Tends to move AGAINST Bitcoin over the last 30 days.' }
  return { label: v, tone: 'none', text: 'Little relation to Bitcoin over the last 30 days.' }
}
export type SortKey = 'default' | 'gainers' | 'losers' | 'corr' | 'volume'
/** Filtru + cautare + sortare (PURA). */
export function selectItems(items: TradfiItem[], group: 'all' | TradfiGroup, q: string, sort: SortKey): TradfiItem[] {
  const qq = q.trim().toLowerCase()
  let out = items.filter((i) => (group === 'all' || i.group === group) && (!qq || i.sym.toLowerCase().includes(qq) || i.name.toLowerCase().includes(qq)))
  const v = (x: number | null) => (x == null || !Number.isFinite(x) ? null : x)
  const by = (f: (i: TradfiItem) => number | null, desc: boolean) => (a: TradfiItem, b: TradfiItem) => {
    const x = v(f(a)), y = v(f(b))
    if (x == null && y == null) return 0
    if (x == null) return 1
    if (y == null) return -1
    return desc ? y - x : x - y
  }
  if (sort === 'gainers') out = [...out].sort(by((i) => i.chg24, true))
  else if (sort === 'losers') out = [...out].sort(by((i) => i.chg24, false))
  else if (sort === 'corr') out = [...out].sort(by((i) => i.corrBtc, true))
  else if (sort === 'volume') out = [...out].sort(by((i) => i.vol24, true))
  return out
}

// ── un singur sondaj, impartit ──
let _snap: TradfiSnap | null = null
let _err: string | null = null
const _subs = new Set<() => void>()
let _fast = 0
let _stop: (() => void) | null = null
let _curMs = 0

async function _pull(): Promise<void> {
  try {
    const r = await fetch('/api/market/tradfi', { credentials: 'same-origin' })
    if (!r.ok) { _err = r.status === 403 ? 'locked' : 'http_' + r.status; _subs.forEach((f) => f()); return }
    _snap = (await r.json()) as TradfiSnap
    _err = null
  } catch { _err = 'offline' }
  _subs.forEach((f) => f())
}
function _restart(): void {
  const ms = _fast > 0 ? 3000 : 6000
  if (_stop && ms === _curMs) return
  if (_stop) _stop()
  _stop = _subs.size ? startPoll(_pull, ms) : null
  _curMs = _stop ? ms : 0
}
/** Abonare. `fast` = panoul e deschis (3 s), altfel 6 s. Intoarce dezabonarea. */
export function subscribeTradfi(fn: () => void, fast = false): () => void {
  _subs.add(fn); if (fast) _fast++
  _restart()
  return () => {
    _subs.delete(fn); if (fast) _fast--
    if (!_subs.size && _stop) { _stop(); _stop = null; _curMs = 0 } else _restart()
  }
}
export function getTradfi(): { snap: TradfiSnap | null; err: string | null } { return { snap: _snap, err: _err } }
export function _resetTradfiForTest(): void { _snap = null; _err = null; _subs.clear(); _fast = 0; if (_stop) _stop(); _stop = null; _curMs = 0 }
