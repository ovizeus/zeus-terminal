/**
 * Whale-order alerts — big walls appearing in or vanishing from the book.
 *
 * [2026-11-08] "Enable Whale Order Alerts", the minimum size, and the three
 * bid/ask/removed checkboxes were all wired to nothing. The book arrives twice
 * a second (depth20@500ms), so this layer is mostly about NOT shouting:
 *
 *   - the first snapshot after connecting is stored, never announced. Every
 *     whale-sized level in it is "new" only in the sense that we just arrived;
 *     without this guard, opening the app fires a burst of alerts about walls
 *     that have been sitting there for hours.
 *   - each price level has its own cooldown, so a wall that flickers at the
 *     same price does not alert repeatedly.
 *   - and one more gate across all of them, because two updates a second over
 *     twenty levels can out-shout anything.
 */

import { whaleEvents, keepWhale, canFire, type BookLevel, type WhaleEvent } from './alertRules'

/** Per price level. A wall that comes and goes at one price is one event. */
const LEVEL_COOLDOWN_MS = 60_000
/** Across everything, so a churning book cannot become a siren. */
const GLOBAL_COOLDOWN_MS = 5_000
/** Most alerts from a single book update. */
const MAX_PER_TICK = 2

export interface WhaleDeps {
  prevBids: BookLevel[] | null | undefined
  bids: BookLevel[] | null | undefined
  prevAsks: BookLevel[] | null | undefined
  asks: BookLevel[] | null | undefined
  alerts: Record<string, unknown>
  symbol?: string
  send: (title: string, body: string, tag?: string) => void
  last: Record<string, number>
  now?: number
  /** False until a book has been seen, so the first one is never announced. */
  seeded: boolean
}

function _fmt(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('en-US') : String(Math.round(n * 100) / 100)
}

/** Returns the events it announced — what the tests read, and what tells
 *  "nothing happened" apart from "it was switched off". */
export function checkWhaleAlerts(deps: WhaleDeps): WhaleEvent[] {
  const out: WhaleEvent[] = []
  try {
    const { alerts, send, last } = deps
    if (!deps.seeded) return out
    if (!alerts || alerts.enabled === false || alerts.whaleOrders === false) return out
    const now = Number.isFinite(deps.now as number) ? (deps.now as number) : Date.now()

    const events = whaleEvents(deps.prevBids, deps.bids, deps.prevAsks, deps.asks, alerts.whaleMinBtc as number)
      .filter((e) => keepWhale(e, alerts))
    if (!events.length) return out

    // Biggest first: if the tick is capped, the cap should drop the small ones.
    events.sort((a, b) => b.qty - a.qty)

    // The global gate is per UPDATE, not per alert. Checked inside the loop it
    // blocked the second event of the same tick, which made MAX_PER_TICK a lie
    // — a test caught that. One book update may speak up to MAX_PER_TICK
    // times; the next one waits.
    const fresh = events.filter((ev) =>
      canFire(last, `whale_${ev.side}_${ev.kind}_${Math.round(ev.price * 100)}`, now, LEVEL_COOLDOWN_MS))
    if (!fresh.length) return out
    if (!canFire(last, 'whale_any', now, GLOBAL_COOLDOWN_MS)) return out

    for (const ev of fresh) {
      if (out.length >= MAX_PER_TICK) break
      const where = ev.side === 'bid' ? 'BID' : 'ASK'
      const what = ev.kind === 'added' ? 'WALL' : 'WALL PULLED'
      const sym = deps.symbol ? deps.symbol + ' ' : ''
      send(`${where} ${what}`, `${sym}${_fmt(ev.qty)} @ ${_fmt(ev.price)}`, 'whale')
      out.push(ev)
    }
  } catch (e) {
    // Runs on every book update. A rule must never break the feed.
    console.warn('[whaleAlerts]', (e as Error)?.message)
  }
  return out
}

export const _WHALE_LIMITS = { LEVEL_COOLDOWN_MS, GLOBAL_COOLDOWN_MS, MAX_PER_TICK }
