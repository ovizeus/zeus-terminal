import { create } from 'zustand'
import type { Position, Balance } from '../types'

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
}

export const usePositionsStore = create<PositionsStore>()((set) => ({
  demoPositions: [],
  livePositions: [],
  demoBalance: 10000,
  demoPnL: 0,
  demoWins: 0,
  demoLosses: 0,
  liveBalance: { totalBalance: 0, availableBalance: 0, unrealizedPnL: 0 },
  liveConnected: false,
  liveExchange: 'binance',

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
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[positionsStore] syncSnapshot source=${source} demo=${update.demoPositions?.length ?? '—'} live=${update.livePositions?.length ?? '—'} bal=${update.demoBalance ?? '—'}`)
      }
      return { ...s, ...update }
    })
  },
}))
