import { create } from 'zustand'
import type { Position, Balance } from '../types'

interface PositionsStore {
  /** Demo positions — from TP.demoPositions */
  demoPositions: Position[]
  /** Live positions — from TP.livePositions */
  livePositions: Position[]

  /** Demo balance & PnL */
  demoBalance: number
  demoPnL: number
  demoWins: number
  demoLosses: number

  /** Live balance from exchange */
  liveBalance: Balance
  liveConnected: boolean
  liveExchange: string

  /** Set demo positions from server sync */
  setDemoPositions: (positions: Position[]) => void
  /** Set live positions from server sync */
  setLivePositions: (positions: Position[]) => void
  /** Update demo balance */
  setDemoBalance: (balance: number) => void
  /** Update live balance from exchange */
  setLiveBalance: (balance: Balance) => void
  /** Set live connection status */
  setLiveConnected: (connected: boolean) => void
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
}))
