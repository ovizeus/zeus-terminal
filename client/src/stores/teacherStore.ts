import { create } from 'zustand'
import type { TeacherState } from '../types'

interface TeacherStore {
  teacher: TeacherState
  patch: (partial: Partial<TeacherState>) => void
}

export const useTeacherStore = create<TeacherStore>()((set) => ({
  teacher: {
    score: 0,
    label: 'WEAK',
    status: 'IDLE',
    capital: 0,
    sessions: 0,
    trades: 0,
    fails: 0,
    currentReplay: {
      tf: '',
      profile: '',
      regime: '',
      bars: 0,
      lastDecision: { action: '', reasons: [], confidence: 0 },
    },
    activity: [],
    tradeHistory: [],
    stats: {
      totalTrades: 0, winRate: 0, pnl: 0, profitFactor: 0,
      expectancy: 0, avgWin: 0, avgLoss: 0, best: 0, worst: 0,
    },
  },
  patch: (partial) => set((s) => ({ teacher: { ...s.teacher, ...partial } })),
}))
