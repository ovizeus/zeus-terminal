import { create } from 'zustand'
import type { DslPositionState } from '../types'

/**
 * DSL canonical store.
 *
 * Phase 6 C2: typed mutators added (additive only). `syncFromEngine` is
 * still active in parallel — engine inversion happens in C3.
 *
 * Note: `_attachedIds` from `DslState` is intentionally NOT mirrored here.
 * It is a runtime-only Set used by the legacy engine and is non-serializable
 * / non-persistable. The canonical store must never become a hydration
 * source for it.
 *
 * Note (Phase 6 C3 audit): `checkIntervalActive` is a store-internal
 * derived boolean (`!!DSL.checkInterval`). It is intentionally NOT exposed
 * on the `window.DSL` Proxy canonical surface because there are zero
 * external readers — all consumers (engine + DSLZonePanel) read the
 * underlying interval handle as `DSL.checkInterval`, served by the
 * Proxy via runtime pass-through to the backing object. Keeping this
 * field store-only avoids a duplicate canonical surface.
 */
interface DslStoreState {
  enabled: boolean
  mode: string | null
  magnetEnabled: boolean
  magnetMode: string
  positions: Record<string, DslPositionState>
  checkIntervalActive: boolean

  /** Atomic snapshot sync from engine — reads complete window.DSL state */
  syncFromEngine: () => void

  /** Set top-level enabled flag */
  setEnabled: (enabled: boolean) => void
  /** Set DSL mode (null clears) */
  setMode: (mode: string | null) => void
  /** Set magnet enabled + optional mode in one call */
  setMagnet: (enabled: boolean, mode?: string) => void
  /** Mark whether the engine's check interval is currently armed */
  setCheckIntervalActive: (active: boolean) => void

  /** Insert or merge a single position (shallow merge into existing) */
  upsertPosition: (posId: string, partial: Partial<DslPositionState>) => void
  /** Remove a single position */
  removePosition: (posId: string) => void
  /** Atomic replacement of the whole positions map */
  replacePositions: (positions: Record<string, DslPositionState>) => void
  /** Drop all positions */
  clearPositions: () => void

  /** Merge partial state */
  patch: (partial: Partial<DslStoreState>) => void
}

export const useDslStore = create<DslStoreState>()((set) => ({
  enabled: true,
  mode: null,
  magnetEnabled: false,
  magnetMode: 'soft',
  positions: {},
  checkIntervalActive: false,

  syncFromEngine: () => {
    const w = window as any
    if (!w.DSL) return
    const posSnapshot: Record<string, DslPositionState> = {}
    if (w.DSL.positions) {
      for (const posId of Object.keys(w.DSL.positions)) {
        const p = w.DSL.positions[posId]
        posSnapshot[posId] = { ...p }
      }
    }
    set({
      enabled: !!w.DSL.enabled,
      mode: w.DSL.mode ?? null,
      magnetEnabled: !!w.DSL.magnetEnabled,
      magnetMode: w.DSL.magnetMode ?? 'soft',
      positions: posSnapshot,
      checkIntervalActive: !!w.DSL.checkInterval,
    })
  },

  setEnabled: (enabled) => set({ enabled }),
  setMode: (mode) => set({ mode }),
  setMagnet: (enabled, mode) =>
    set((s) => ({
      magnetEnabled: enabled,
      magnetMode: mode ?? s.magnetMode,
    })),
  setCheckIntervalActive: (active) => set({ checkIntervalActive: active }),

  upsertPosition: (posId, partial) =>
    set((s) => ({
      positions: {
        ...s.positions,
        [posId]: { ...(s.positions[posId] ?? {}), ...partial } as DslPositionState,
      },
    })),
  removePosition: (posId) =>
    set((s) => {
      if (!(posId in s.positions)) return {}
      const next = { ...s.positions }
      delete next[posId]
      return { positions: next }
    }),
  replacePositions: (positions) => set({ positions }),
  clearPositions: () => set({ positions: {} }),

  patch: (partial) => set((s) => ({ ...s, ...partial })),
}))
