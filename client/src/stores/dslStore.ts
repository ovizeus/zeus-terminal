import { create } from 'zustand'

interface DslStoreState {
  enabled: boolean
  positions: Record<string, any> // keyed by posId
  checkIntervalActive: boolean

  /** Atomic snapshot sync from engine — reads complete window.DSL state */
  syncFromEngine: () => void
  /** Set enabled state (used by toggle flow) */
  setEnabled: (enabled: boolean) => void
  /** Merge partial state */
  patch: (partial: Partial<DslStoreState>) => void
}

export const useDslStore = create<DslStoreState>()((set) => ({
  enabled: true,
  positions: {},
  checkIntervalActive: false,

  syncFromEngine: () => {
    const w = window as any
    if (!w.DSL) return
    // Single atomic set() — complete snapshot from window.DSL
    const posSnapshot: Record<string, any> = {}
    if (w.DSL.positions) {
      for (const posId of Object.keys(w.DSL.positions)) {
        const p = w.DSL.positions[posId]
        posSnapshot[posId] = { ...p } // shallow copy, keyed by posId
      }
    }
    set({
      enabled: !!w.DSL.enabled,
      positions: posSnapshot,
      checkIntervalActive: !!w.DSL.checkInterval,
    })
  },

  setEnabled: (enabled) => set({ enabled }),
  patch: (partial) => set((s) => ({ ...s, ...partial })),
}))
