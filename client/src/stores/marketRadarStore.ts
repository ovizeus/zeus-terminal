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
  push: (ev: RadarEvent) => void
  clear: () => void
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

    set((s) => {
      if (ev.color === 'green') {
        return { green: _enqueue(s.green, ev), lastEventTs: Math.max(s.lastEventTs, ev.ts) }
      }
      return { red: _enqueue(s.red, ev), lastEventTs: Math.max(s.lastEventTs, ev.ts) }
    })
  },

  clear: () => set({ green: [], red: [], lastEventTs: 0 }),
}))
