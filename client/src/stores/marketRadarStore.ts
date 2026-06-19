// Zeus Terminal — Market Radar Store (Phase 11.3)
// Client-side sink for WS type:'market.radar' frames emitted by
// server/services/marketRadar.js. Holds two capped FIFO queues — one per
// color — that STEP 4's marquee bands consume.
//
// Design:
//   - Two queues (green / red) capped at QUEUE_CAP each. Oldest entry is
//     dropped when a new push overflows the cap. Append-at-end, shift-front.
//   - `lastEventTs` tracks the most recent event's monotonic `ts` for the
//     "updated Xs ago" badge.
//   - Dedup is authoritative server-side (5-min window per symbol/category),
//     so the store does NOT dedup. It just records whatever the server
//     chose to emit. A paranoid client-side guard drops events whose `ts`
//     is older than what we already have by more than 10 min — protects
//     against a reconnect replay burst if server behavior ever changes.
//   - Actions are idempotent and side-effect free beyond state mutation.

import { create } from 'zustand'
import type { RadarEvent } from '../types'

export const QUEUE_CAP = 50
const STALE_GUARD_MS = 10 * 60 * 1000  // drop events more than 10 min in the past

export interface MarketRadarState {
  green: RadarEvent[]
  red: RadarEvent[]
  lastEventTs: number
  /** [B5] Exchange the radar universe currently comes from ('binance'|'bybit').
   *  Drives an honest UI title — never label Bybit data as "BINANCE". */
  source: string
  push: (ev: RadarEvent) => void
  /** [Phase 11.7] replace both queues with a server-sent warm-start snapshot */
  hydrate: (green: RadarEvent[], red: RadarEvent[], lastEventTs: number) => void
  clear: () => void
}

function _isRadarEvent(ev: unknown): ev is RadarEvent {
  if (!ev || typeof ev !== 'object') return false
  const e = ev as Record<string, unknown>
  if (typeof e.ts !== 'number' || !isFinite(e.ts)) return false
  if (typeof e.symbol !== 'string' || e.symbol.length === 0) return false
  if (e.color !== 'green' && e.color !== 'red') return false
  return true
}

function _enqueue(queue: RadarEvent[], ev: RadarEvent): RadarEvent[] {
  const next = queue.length >= QUEUE_CAP
    ? [...queue.slice(queue.length - QUEUE_CAP + 1), ev]
    : [...queue, ev]
  return next
}

export const useMarketRadarStore = create<MarketRadarState>((set, get) => ({
  green: [],
  red: [],
  lastEventTs: 0,
  source: 'binance',

  push: (ev) => {
    // Defensive coercion — the realtime service validates shape, but keep
    // the store resilient in case a future caller bypasses it.
    if (!ev || typeof ev !== 'object') return
    if (typeof ev.ts !== 'number' || !isFinite(ev.ts)) return
    if (typeof ev.symbol !== 'string' || ev.symbol.length === 0) return
    if (ev.color !== 'green' && ev.color !== 'red') return

    const { lastEventTs } = get()
    // Stale replay guard — reject events older than (lastEventTs - 10min).
    // Leaves room for slightly-out-of-order frames from the same poll.
    if (lastEventTs > 0 && ev.ts < lastEventTs - STALE_GUARD_MS) return

    // [B5] capture honest source tag from the event when present
    const _src = typeof (ev as { source?: unknown }).source === 'string'
      ? (ev as { source?: string }).source as string
      : undefined

    set((s) => {
      const _base = _src ? { source: _src } : {}
      if (ev.color === 'green') {
        return { ..._base, green: _enqueue(s.green, ev), lastEventTs: Math.max(s.lastEventTs, ev.ts) }
      }
      return { ..._base, red: _enqueue(s.red, ev), lastEventTs: Math.max(s.lastEventTs, ev.ts) }
    })
  },

  hydrate: (green, red, lastEventTs) => {
    // Server cache is authoritative on replay — we replace, not merge. Any
    // live event that raced the snapshot will re-arrive via `push` after
    // hydrate and be enqueued normally (stale guard prevents duplicates
    // older than 10 min).
    const g = (Array.isArray(green) ? green : []).filter(_isRadarEvent)
    const r = (Array.isArray(red) ? red : []).filter(_isRadarEvent)
    const gc = g.length > QUEUE_CAP ? g.slice(g.length - QUEUE_CAP) : g
    const rc = r.length > QUEUE_CAP ? r.slice(r.length - QUEUE_CAP) : r
    const ts = (typeof lastEventTs === 'number' && isFinite(lastEventTs) && lastEventTs > 0)
      ? lastEventTs
      : (gc.concat(rc).reduce((m, e) => Math.max(m, e.ts), 0))
    // [AUDIT-20260619 P3] carry the honest source on snapshot replay too (push
    // captures it, hydrate previously did not) so the radar title doesn't mislabel a
    // rehydrated Bybit universe as Binance after a reconnect, until the next push.
    const _newest = gc.concat(rc).reduce((a: RadarEvent | null, e) => (e.ts > (a?.ts || 0) ? e : a), null)
    const _src = _newest && typeof (_newest as { source?: unknown }).source === 'string'
      ? (_newest as { source?: string }).source as string
      : undefined
    set({ green: gc, red: rc, lastEventTs: ts, ...(_src ? { source: _src } : {}) })
  },

  clear: () => set({ green: [], red: [], lastEventTs: 0 }),
}))
