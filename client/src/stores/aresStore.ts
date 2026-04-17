import { create } from 'zustand'
import { api } from '../services/api'
import type { AresStoreUI } from '../types/ares'
import { DEFAULT_ARES_UI } from '../types/ares'
import { _aresRender } from '../engine/aresUI'
import { ARES_MONITOR } from '../engine/aresMonitor'

const DEFAULT_ARES = {
  balance: 0,
  locked: 0,
  available: 0,
  realizedPnL: 0,
  fundedTotal: 0,
  stageName: 'SEED',
  stageProgress: 0,
  positions: [] as any[],
}

interface AresStoreState {
  balance: number
  locked: number
  available: number
  realizedPnL: number
  fundedTotal: number
  stageName: string
  stageProgress: number
  positions: any[]
  loaded: boolean
  saving: boolean

  /** [R28.2] UI slice — mirrors aresUI.ts DOM render output. */
  ui: AresStoreUI

  loadFromServer: () => Promise<void>
  saveToServer: () => Promise<void>
  patch: (partial: Partial<AresStoreState>) => void

  /** [R28.2] Merge a partial UI update produced by the engine sync adapter. */
  patchUi: (partial: Partial<AresStoreUI>) => void

  /** [R28.2] Strip-bar open/closed toggle (replaces imperative #ares-strip style mutations). */
  setStripOpen: (open: boolean) => void

  /** [R28.2-I] Engine-action wrappers — components call these instead of window.ARES. */
  fundWallet: (amount: number) => void
  withdrawWallet: (amount: number) => void
  closeArePosition: (posId: string, live: boolean, entry: number) => void
  closeAllArePositions: () => void
}

export const useAresStore = create<AresStoreState>()((set, getState) => ({
  ...DEFAULT_ARES,
  loaded: false,
  saving: false,
  ui: DEFAULT_ARES_UI,

  loadFromServer: async () => {
    try {
      const data = await api.raw<{ ok: boolean; ares?: Record<string, unknown> }>('GET', '/api/user/ares')
      const server = (data.ok && data.ares) ? data.ares : {}
      const merged = { ...DEFAULT_ARES, ...server }
      set({ ...merged, loaded: true })
      _syncToEngine(merged)
    } catch (_) {
      _readFromEngine(set)
      set({ loaded: true })
    }
  },

  saveToServer: async () => {
    const s = getState()
    if (s.saving) return
    set({ saving: true })
    try {
      const payload = {
        balance: s.balance, locked: s.locked, available: s.available,
        realizedPnL: s.realizedPnL, fundedTotal: s.fundedTotal,
        stageName: s.stageName, stageProgress: s.stageProgress,
      }
      await fetch('/api/user/ares', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ares: payload }),
      })
    } catch (_) {
      console.warn('[aresStore] save to server failed')
    } finally {
      set({ saving: false })
    }
  },

  patch: (partial) => set((s) => ({ ...s, ...partial })),

  patchUi: (partial) => set((s) => ({ ui: { ...s.ui, ...partial } })),

  setStripOpen: (open) => set((s) => ({ ui: { ...s.ui, stripOpen: open } })),

  fundWallet: (amount) => {
    const w = window as any
    if (!Number.isFinite(amount) || amount <= 0) return
    try {
      if (w.ARES?.wallet?.fund) {
        w.ARES.wallet.fund(amount)
        setTimeout(() => { try { _aresRender(); getState().saveToServer() } catch (_) {} }, 200)
      }
    } catch (_) {}
  },

  withdrawWallet: (amount) => {
    const w = window as any
    if (!Number.isFinite(amount) || amount <= 0) return
    try {
      if (w.ARES?.wallet?.withdraw) {
        w.ARES.wallet.withdraw(amount)
        setTimeout(() => { try { _aresRender(); getState().saveToServer() } catch (_) {} }, 200)
      }
    } catch (_) {}
  },

  closeArePosition: (posId, live, entry) => {
    const w = window as any
    try {
      if (live) {
        const engine = w.ARES?.positions?.getOpen?.()?.find((p: any) => String(p.id) === posId)
        if (engine) {
          const mark = Number(engine.markPrice) || entry || 0
          ARES_MONITOR.closeLivePosition(engine, mark, 'manual')
          setTimeout(() => { try { _aresRender() } catch (_) {} }, 500)
        }
      } else if (w.ARES?.positions?.closePosition) {
        w.ARES.positions.closePosition(posId)
        try { _aresRender() } catch (_) {}
      }
    } catch (_) {}
  },

  closeAllArePositions: () => {
    const w = window as any
    try {
      if (w.ARES?.positions?.closeAll) {
        w.ARES.positions.closeAll()
        setTimeout(() => { try { _aresRender() } catch (_) {} }, 100)
      }
    } catch (_) {}
  },
}))

/** Read ARES state from engine (localStorage/window.ARES) */
function _readFromEngine(set: any) {
  const w = window as any
  try {
    const wallet = w.ARES?.wallet || w.ARES_WALLET
    const positions = w.ARES?.positions || w.ARES_POSITIONS
    if (wallet) {
      set({
        balance: wallet.balance || 0,
        locked: wallet.locked || 0,
        available: (wallet.balance || 0) - (wallet.locked || 0),
        realizedPnL: wallet.realizedPnL || 0,
        fundedTotal: wallet.fundedTotal || 0,
      })
    }
    if (positions && typeof positions.getAll === 'function') {
      set({ positions: positions.getAll() || [] })
    }
    const state = w.ARES?.getState?.()
    if (state) {
      set({ stageName: state.stage || 'SEED', stageProgress: state.progress || 0 })
    }
  } catch (_) {}
}

/** Bridge invers: sync store values to engine localStorage cache */
function _syncToEngine(data: any) {
  try {
    const raw = localStorage.getItem('ARES_MISSION_STATE_V1_vw2')
    const existing = raw ? JSON.parse(raw) : {}
    const merged = { ...existing, ...data }
    localStorage.setItem('ARES_MISSION_STATE_V1_vw2', JSON.stringify(merged))
  } catch (_) {}
}
