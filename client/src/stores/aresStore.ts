import { create } from 'zustand'
import { api } from '../services/api'
import type { AresStoreUI } from '../types/ares'
import { DEFAULT_ARES_UI } from '../types/ares'
import { _aresRender } from '../engine/aresUI'
import { ARES_MONITOR } from '../engine/aresMonitor'
import { debounce } from '../utils/debounce'

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

/** [SERVER-ARES P3 2026-06-07] Live server reasoning snapshot from
 *  GET /api/ares/state (serverAres.getPublicState). */
export interface AresServerSnapshot {
  lastDecision: {
    ts?: number
    shouldTrade?: boolean
    side?: string | null
    confidence?: number
    stateId?: string
    reasons?: string[]
  } | null
  engine: {
    winRate10?: number
    consecutiveLoss?: number
    consecutiveWin?: number
    totalTrades?: number
    totalWins?: number
    totalLosses?: number
  }
  trajectory: { delta?: number; daysPassed?: number }
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
  /** [SERVER-ARES 2026-06-07] True when the server engine owns ARES — wallet
   *  ops go through /api/ares/*, legacy snapshot pushes are suppressed. */
  serverSide: boolean
  /** [SERVER-ARES P3 2026-06-07] Live server reasoning snapshot — the server
   *  engine's lastDecision + engine stats + trajectory, refreshed by
   *  loadFromServer. Drives the ARES panel's thought stream / decision line /
   *  state badge / confidence / stats when serverSide (the client engine is
   *  locked, so its own state is frozen). null until first server load. */
  srv: AresServerSnapshot | null

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

// Module-scope debouncer — single shared instance across all callers.
// 300ms trailing window coalesces config-save storms (operator rapid
// edits, ares.changed WS bursts, reconnect cascades).
let _debouncedAresLoad: (() => void) | null = null

export const useAresStore = create<AresStoreState>()((set, getState) => {
  const loadImpl = async (): Promise<void> => {
    // [SERVER-ARES 2026-06-07] Server-authoritative path first: when the
    // server engine owns ARES (MF.SERVER_ARES), /api/ares/state is the truth
    // (wallet in ares_state DB, positions execute through serverAT). The
    // legacy /api/user/ares snapshot below stays as fallback for client-ARES
    // installs — POSTing to it returns 409 when the server owns (see
    // saveToServer guard).
    try {
      const st = await api.raw<{ ok: boolean; ares?: any }>('GET', '/api/ares/state')
      if (st && st.ok && st.ares && st.ares.enabled === true && st.ares.wallet) {
        const a = st.ares
        set({
          balance: +a.wallet.balance || 0,
          locked: +a.wallet.locked || 0,
          available: +a.wallet.available || 0,
          realizedPnL: +a.wallet.realizedPnL || 0,
          fundedTotal: +a.wallet.fundedTotal || 0,
          serverSide: true,
          loaded: true,
          // [SERVER-ARES P3] Capture the live reasoning snapshot so the panel
          // shows the SERVER engine's thinking instead of the frozen client.
          srv: {
            lastDecision: a.lastDecision || null,
            engine: a.engine || {},
            trajectory: a.trajectory || {},
          },
        })
        // [SERVER-ARES P3] Pump the UI now — the client ARES tick that normally
        // drives _aresRender only fires every 5min, far too slow for a live
        // thought stream. loadFromServer runs ~8s, so render here for ~8s-fresh
        // server reasoning in the panel.
        try { _aresRender() } catch (_) {}
        return
      }
    } catch (_) { /* endpoint absent on old servers — fall through to legacy */ }
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
  }

  if (!_debouncedAresLoad) {
    _debouncedAresLoad = debounce(() => { void loadImpl() }, 300)
  }

  return {
  ...DEFAULT_ARES,
  loaded: false,
  saving: false,
  serverSide: false,
  srv: null,
  ui: DEFAULT_ARES_UI,

  loadFromServer: async () => { _debouncedAresLoad!() },

  saveToServer: async () => {
    const s = getState()
    if (s.saving) return
    // [SERVER-ARES 2026-06-07] Server owns the wallet — pushing the client
    // snapshot would 409 (and pre-guard servers would CLOBBER server state).
    if (s.serverSide) return
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
    // [SERVER-ARES 2026-06-07] Server-authoritative wallet → API op + re-pull.
    if (getState().serverSide) {
      fetch('/api/ares/fund', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      }).then(() => getState().loadFromServer()).catch(() => {})
      return
    }
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
    if (getState().serverSide) {
      fetch('/api/ares/withdraw', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      }).then(() => getState().loadFromServer()).catch(() => {})
      return
    }
    try {
      if (w.ARES?.wallet?.withdraw) {
        w.ARES.wallet.withdraw(amount)
        setTimeout(() => { try { _aresRender(); getState().saveToServer() } catch (_) {} }, 200)
      }
    } catch (_) {}
  },

  closeArePosition: (posId, live, entry) => {
    const w = window as any
    // [SERVER-ARES P2 2026-06-07] Server-owned cards carry the serverAT seq as
    // id — close through the canonical server close path (same as Manual/AT
    // panels), NOT the dormant local engine.
    if (getState().serverSide) {
      api.raw('POST', '/api/at/close', { seq: Number(posId) }).catch(() => {})
      return
    }
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
    // [SERVER-ARES P2 2026-06-07] Close every server-owned ARES card via the
    // canonical server path.
    if (getState().serverSide) {
      const cards = getState().ui.positions || []
      cards.forEach((p) => { api.raw('POST', '/api/at/close', { seq: Number(p.id) }).catch(() => {}) })
      return
    }
    try {
      if (w.ARES?.positions?.closeAll) {
        w.ARES.positions.closeAll()
        setTimeout(() => { try { _aresRender() } catch (_) {} }, 100)
      }
    } catch (_) {}
  },
}})

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
