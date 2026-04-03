import { create } from 'zustand'
import type { DslState } from '../types'

interface DslStore {
  /** DSL state — mirrors window.DSL */
  dsl: DslState
  /** Merge partial DSL state */
  patch: (partial: Partial<DslState>) => void
}

export const useDslStore = create<DslStore>()((set) => ({
  dsl: {
    enabled: true,
    mode: null,
    magnetEnabled: false,
    magnetMode: 'soft',
    positions: {},
    checkInterval: null,
  },
  patch: (partial) => set((s) => ({ dsl: { ...s.dsl, ...partial } })),
}))
