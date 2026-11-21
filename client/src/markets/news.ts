// [2026-11-21] MARKET NEWS — datele vin DOAR de la serverul nostru (GET /api/news): stiri grupate, reactia
// MASURATA dupa publicare, calendarul economic, rezumatul AI si preferinta de alerte. Un singur sondaj
// pentru caseta + panou; alertele sosesc prin WebSocket (news.alert) si respecta alegerea utilizatorului.
import { startPoll } from '../utils/poll'
import { wsService } from '../services/ws'
import { QM } from '../quantmonitor/state'
import { sendAlert } from '../data/marketDataWS'

export type NewsCat = 'crypto' | 'macro' | 'markets' | 'stocks' | 'commodities'
export interface NewsMove { px: string; m15: number | null; m60: number | null; since: number | null }
export interface NewsItem {
  id: string; ts: number; title: string; url: string; cat: NewsCat; official: boolean; tags: string[]
  sources: string[]; links: Array<{ source: string; url: string }>; moves: NewsMove[]; impact: number
}
export interface CalEvent {
  id: string; title: string; country: string; ts: number; impact: string; forecast: string; previous: string; actual: string; moves: NewsMove[]
}
export type AlertPref = 'off' | 'app' | 'app_tg'
export interface NewsSnap {
  ok: boolean; asOf: number; items: NewsItem[]; top: NewsItem[]; calendar: CalEvent[]
  brief: { text: string; at: number } | null; briefStatus: string; calendarNote: string | null
  sources: { total: number; ok: number }; prefs: { alerts: AlertPref }
}

export const NEWS_FILTERS: Array<{ id: 'all' | NewsCat; label: string }> = [
  { id: 'all', label: 'All' }, { id: 'crypto', label: 'Crypto' }, { id: 'macro', label: 'Macro' },
  { id: 'markets', label: 'Markets' }, { id: 'stocks', label: 'Stocks' }, { id: 'commodities', label: 'Commodities' },
]

// ── formatare (PURE) ──
export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return 'now'
  const m = Math.round(s / 60)
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h'
  return Math.floor(h / 24) + 'd'
}
export function countdown(ts: number, now = Date.now()): string {
  const d = ts - now
  if (d <= 0) return 'released'
  const m = Math.floor(d / 60000), h = Math.floor(m / 60), dd = Math.floor(h / 24)
  if (dd > 0) return `in ${dd}d ${h % 24}h`
  if (h > 0) return `in ${h}h ${m % 60}m`
  return `in ${m}m`
}
/** Cea mai buna masura disponibila: 1h, altfel 15m, altfel „de la publicare". PURA. */
export function bestMove(m: NewsMove): { v: number | null; label: string } {
  if (m.m60 != null) return { v: m.m60, label: '1h' }
  if (m.m15 != null) return { v: m.m15, label: '15m' }
  if (m.since != null) return { v: m.since, label: 'since' }
  return { v: null, label: '' }
}
export function filterNews(items: NewsItem[], cat: 'all' | NewsCat | `coin:${string}`, q: string): NewsItem[] {
  const qq = q.trim().toLowerCase()
  const coin = typeof cat === 'string' && cat.startsWith('coin:') ? cat.slice(5) : null
  return items.filter((i) => (cat === 'all' || (coin ? i.tags.includes(coin) : i.cat === cat)) && (!qq || i.title.toLowerCase().includes(qq) || i.tags.some((t) => t.toLowerCase().includes(qq))))
}
/** Calendarul din Quant Monitor (era hardcodat cu date din 2025, expirat) — acum evenimentele High reale. PURA. */
export function toMacroEvents(cal: CalEvent[]): Array<{ name: string; date: Date }> {
  return cal.filter((e) => e.impact === 'High').map((e) => ({ name: `${e.country} ${e.title}`.slice(0, 28), date: new Date(e.ts) }))
}

/** [2026-11-21] Cate stiri NOI de la ultima deschidere a panoului (pentru caseta). PURA. */
export function countNew(items: NewsItem[], seenTs: number): number {
  return seenTs > 0 ? items.filter((i) => i.ts > seenTs).length : 0
}
const SEEN_KEY = 'zmn-seen-ts'
export function getSeenTs(): number { try { return Number(localStorage.getItem(SEEN_KEY)) || 0 } catch { return 0 } }
export function markSeen(now = Date.now()): void { try { localStorage.setItem(SEEN_KEY, String(now)) } catch { /* privat */ } }
/** Moneda din grafic → eticheta de stiri (BTCUSDT → BTC). PURA. */
export function chartCoinTag(symbol: unknown): string | null {
  const b = String(symbol || '').toUpperCase().replace(/USDT$|USDC$|USD$/, '')
  return /^[A-Z0-9]{2,12}$/.test(b) ? b : null
}

// ── un singur sondaj ──
let _snap: NewsSnap | null = null
let _err: string | null = null
const _subs = new Set<() => void>()
let _fast = 0, _stop: (() => void) | null = null, _curMs = 0, _wsOff: (() => void) | null = null

async function _pull(): Promise<void> {
  try {
    const r = await fetch('/api/news', { credentials: 'same-origin' })
    if (!r.ok) { _err = r.status === 403 ? 'locked' : 'http_' + r.status }
    else {
      _snap = (await r.json()) as NewsSnap; _err = null
      try { const ev = toMacroEvents(_snap.calendar || []); if (ev.length) (QM as any).macroEvents = ev } catch { /* monitorul optional */ }
    }
  } catch { _err = 'offline' }
  _subs.forEach((f) => f())
}
function _onAlert(msg: any): void {
  if (!msg || msg.type !== 'news.alert' || !msg.data) return
  const pref = _snap?.prefs?.alerts || 'app'
  if (pref === 'off') return
  try { sendAlert(String(msg.data.title || 'Market news'), String(msg.data.body || ''), 'news') } catch { /* */ }
}
function _restart(): void {
  const ms = _fast > 0 ? 30_000 : 60_000
  if (_stop && ms === _curMs) return
  if (_stop) _stop()
  _stop = _subs.size ? startPoll(_pull, ms) : null
  _curMs = _stop ? ms : 0
  if (_subs.size && !_wsOff) { try { _wsOff = wsService.subscribe(_onAlert as any) } catch { _wsOff = null } }
}
export function subscribeNews(fn: () => void, fast = false): () => void {
  _subs.add(fn); if (fast) _fast++
  _restart()
  return () => {
    _subs.delete(fn); if (fast) _fast--
    if (!_subs.size) { if (_stop) _stop(); _stop = null; _curMs = 0; if (_wsOff) { try { _wsOff() } catch { /* */ } _wsOff = null } } else _restart()
  }
}
export function getNews(): { snap: NewsSnap | null; err: string | null } { return { snap: _snap, err: _err } }
export async function setAlertPref(alerts: AlertPref): Promise<boolean> {
  try {
    const r = await fetch('/api/news/prefs', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Zeus-Request': '1' }, body: JSON.stringify({ alerts }) })
    if (!r.ok) return false
    if (_snap) _snap = { ..._snap, prefs: { alerts } }
    _subs.forEach((f) => f())
    return true
  } catch { return false }
}
export function _resetNewsForTest(): void { _snap = null; _err = null; _subs.clear(); _fast = 0; if (_stop) _stop(); _stop = null; _curMs = 0; _wsOff = null }
export const _onAlertForTest = _onAlert
