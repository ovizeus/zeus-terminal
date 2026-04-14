import { create } from 'zustand'
import type { ATState, ATLogEntry } from '../types'

type ATStore = ATState & {
  /** Merge partial AT state from server */
  patch: (partial: Partial<ATState>) => void
  /** Append log entry */
  addLog: (entry: ATLogEntry) => void
}

export const useATStore = create<ATStore>()((set) => ({
  enabled: false,
  mode: 'demo',
  running: false,
  killTriggered: false,
  killReason: null,
  killLoss: 0,
  killLimit: 0,
  killBalRef: 0,
  killModeAtTrigger: null,
  killActiveAt: 0,
  interval: null,
  totalTrades: 0,
  wins: 0,
  losses: 0,
  totalPnL: 0,
  dailyPnL: 0,
  realizedDailyPnL: 0,
  closedTradesToday: 0,
  dailyStart: new Date().toDateString(),
  lastTradeSide: null,
  lastTradeTs: 0,
  cooldownMs: 120000,
  _cooldownBySymbol: {},
  _killTriggeredTs: 0,
  enabledAt: 0,
  _modeConfirmed: false,
  _enabledPerMode: {},
  _serverMode: '',
  _serverStats: null,
  _serverDemoStats: null,
  _serverLiveStats: null,
  log: [],

  patch: (partial) => set((s) => ({ ...s, ...partial })),
  addLog: (entry) => set((s) => ({ log: [...s.log.slice(-99), entry] })),
}))
