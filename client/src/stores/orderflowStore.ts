import { create } from 'zustand'
import type { OrderFlowState } from '../types'

interface OrderFlowStore {
  flow: OrderFlowState
  patch: (partial: Partial<OrderFlowState>) => void
}

export const useOrderFlowStore = create<OrderFlowStore>()((set) => ({
  flow: {
    deltaPct: 0,
    deltaVel: 0,
    z: 0,
    flags: { instAct: false },
    abs: { active: false, side: '', peakDeltaPct: 0 },
    exhaust: { ts: 0, side: '', strength: 0 },
    trap: { active: false, dir: '', ts: 0, price: 0, absorbSide: '', exhaustZ: 0, priceMovePct: 0 },
    vacuum: { active: false, dir: '', movePct: 0, tps: 0, vol: 0 },
    dFlip: { active: false, dir: '', prevDeltaPct: 0, curDeltaPct: 0, z: 0, priceMovePct: 0 },
    ice: { active: false, side: '', tps: 0, vol: 0, priceMovePct: 0, sliceDeltaPct: 0, topShare: 0 },
    health: 'DEAD',
  },
  patch: (partial) => set((s) => ({ flow: { ...s.flow, ...partial } })),
}))
