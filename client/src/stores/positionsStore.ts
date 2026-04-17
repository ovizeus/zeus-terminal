import { create } from 'zustand'
import type { Position, Balance, PositionsSnapshot } from '../types'

interface PositionsStore {
  demoPositions: Position[]
  livePositions: Position[]
  demoBalance: number
  demoPnL: number
  demoWins: number
  demoLosses: number
  liveBalance: Balance
  liveConnected: boolean
  liveExchange: string

  manualPnl: number
  manualPnlClass: string
  manualWr: string
  manualTrades: number
  setManualStats: (pnl: number, pnlClass: string, wr: string, trades: number) => void

  /**
   * [R9] Reactive pending + journal arrays that replace the imperative engine
   * DOM writers (`renderPendingOrders`, `renderTradeJournal`). The engine
   * still owns the source data via `w.TP.*`; mirror helpers in
   * `marketDataPositions.ts` / `storage.ts` push a freshly-sliced copy into
   * the store instead of `el.innerHTML = ...`.
   */
  pendingOrders: any[]
  manualLivePending: any[]
  journal: any[]
  setPendingOrders: (orders: any[]) => void
  setManualLivePending: (orders: any[]) => void
  setJournal: (journal: any[]) => void

  /**
   * [MIGRATION-F5 commit 2] Last authoritative positions snapshot timestamp
   * (ms since epoch). Used for monotonic dedup on WS broadcasts — a snapshot
   * with `updated_at <= lastSnapshotTs` is dropped silently. 0 = no snapshot
   * applied yet (boot state). Not read by any runtime call-site at C2; the
   * C4 subscriber will be the first consumer.
   */
  lastSnapshotTs: number

  setDemoPositions: (positions: Position[]) => void
  setLivePositions: (positions: Position[]) => void
  setDemoBalance: (balance: number) => void
  setLiveBalance: (balance: Balance) => void
  setLiveConnected: (connected: boolean) => void
  patch: (partial: Partial<PositionsStore>) => void

  /** Atomic snapshot sync — sets positions + balance in a single store update.
   *  Source: 'server' (authoritative) or 'bridge' (engine event, fast local sync).
   *  Rule: at boot/refresh/reload, server is final truth.
   *  Bridge events are fast local sync only. */
  syncSnapshot: (snapshot: {
    demoPositions?: any[]
    livePositions?: any[]
    demoBalance?: number
    liveBalance?: number
    source: 'server' | 'bridge'
  }) => void

  /**
   * [MIGRATION-F5 commit 2] Full-snapshot reconciliation — replaces
   * `demoPositions` + `livePositions` with the contents of a `PositionsSnapshot`.
   *
   * Semantics:
   * - Monotonic dedup on `snapshot.updated_at`: if
   *   `snapshot.updated_at <= lastSnapshotTs` the call is a no-op and
   *   returns `false`. Otherwise `lastSnapshotTs` is advanced to
   *   `snapshot.updated_at` and `true` is returned.
   * - Positions are split by `p.mode === 'live'` vs anything else; closed
   *   positions are filtered out defensively (server contract says
   *   "open-positions array at the emit moment" — we do not trust it blindly).
   * - `demoBalance` / `liveBalance` are deliberately NOT touched —
   *   `PositionsSnapshot` does not carry balance fields. Balance stays
   *   owned by the existing `syncSnapshot` / `setDemoBalance` path.
   * - No side effects beyond store state. No WS, no subscriber flip.
   *
   * Returns `true` if the snapshot was applied, `false` if dropped as stale.
   */
  replaceAll: (snapshot: PositionsSnapshot) => boolean

  /**
   * [MIGRATION-F5 commit 2] MVP alias for `replaceAll`.
   *
   * In the Phase 5 MVP design every WS `positions.changed` broadcast carries
   * a **full** snapshot (not a true delta), so `applyDelta === replaceAll`.
   * The name is kept separate so the C4 subscriber can call the semantic
   * action and a future phase can upgrade this to a real delta pipeline
   * without touching any call-site that already uses `applyDelta`.
   *
   * Returns the same `true`/`false` as `replaceAll`.
   */
  applyDelta: (snapshot: PositionsSnapshot) => boolean
}

export const usePositionsStore = create<PositionsStore>()((set, get) => ({
  demoPositions: [],
  livePositions: [],
  demoBalance: 10000,
  demoPnL: 0,
  demoWins: 0,
  demoLosses: 0,
  liveBalance: { totalBalance: 0, availableBalance: 0, unrealizedPnL: 0 },
  liveConnected: false,
  liveExchange: 'binance',
  lastSnapshotTs: 0,
  manualPnl: 0,
  manualPnlClass: 'neut',
  manualWr: '0%',
  manualTrades: 0,
  setManualStats: (pnl, pnlClass, wr, trades) => set({ manualPnl: pnl, manualPnlClass: pnlClass, manualWr: wr, manualTrades: trades }),

  // [R9] Reactive pending + journal arrays
  pendingOrders: [],
  manualLivePending: [],
  journal: [],
  setPendingOrders: (orders) => set({ pendingOrders: orders }),
  setManualLivePending: (orders) => set({ manualLivePending: orders }),
  setJournal: (journal) => set({ journal }),

  setDemoPositions: (positions) => set({ demoPositions: positions }),
  setLivePositions: (positions) => set({ livePositions: positions }),
  setDemoBalance: (balance) => set({ demoBalance: balance }),
  setLiveBalance: (balance) => set({ liveBalance: balance }),
  setLiveConnected: (connected) => set({ liveConnected: connected }),
  patch: (partial) => set((s) => ({ ...s, ...partial })),

  syncSnapshot: ({ demoPositions, livePositions, demoBalance, liveBalance, source }) => {
    set((s) => {
      const update: Partial<PositionsStore> = {}
      // Filter: demo positions must have mode !== 'live', live must have mode === 'live'
      if (demoPositions !== undefined) {
        update.demoPositions = demoPositions.filter((p: any) => (p.mode || 'demo') !== 'live' && !p.closed)
      }
      if (livePositions !== undefined) {
        update.livePositions = livePositions.filter((p: any) => (p.mode || 'demo') === 'live' && !p.closed)
      }
      if (demoBalance !== undefined && Number.isFinite(demoBalance)) {
        update.demoBalance = demoBalance
      }
      if (liveBalance !== undefined && Number.isFinite(liveBalance)) {
        update.liveBalance = { ...s.liveBalance, totalBalance: liveBalance }
      }
      if (import.meta.env.DEV) {
        console.log(`[positionsStore] syncSnapshot source=${source} demo=${update.demoPositions?.length ?? '—'} live=${update.livePositions?.length ?? '—'} bal=${update.demoBalance ?? '—'}`)
      }
      return { ...s, ...update }
    })
  },

  replaceAll: (snapshot) => {
    const prevTs = get().lastSnapshotTs
    const nextTs = Number(snapshot?.updated_at)
    if (!Number.isFinite(nextTs) || nextTs <= prevTs) return false

    const all = Array.isArray(snapshot?.positions) ? snapshot.positions : []
    const nextDemo: Position[] = []
    const nextLive: Position[] = []
    for (const p of all) {
      if (!p || (p as Position & { closed?: boolean }).closed) continue
      if ((p.mode || 'demo') === 'live') nextLive.push(p)
      else nextDemo.push(p)
    }

    set({
      demoPositions: nextDemo,
      livePositions: nextLive,
      lastSnapshotTs: nextTs,
    })
    return true
  },

  applyDelta: (snapshot) => get().replaceAll(snapshot),
}))
