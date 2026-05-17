import { create } from 'zustand'
import type { ThemeId } from '../types'

type ModalId = 'notifications' | 'cloud' | 'alerts' | 'charts' | 'liq' | 'llv' | 'supremus' | 'sr' | 'settings' | 'ovi' | 'welcome' | 'admin' | 'adminPage' | 'cmdpalette' | 'exposure' | 'decisionlog' | 'missed' | 'session' | 'regime' | 'performance' | 'compare'

interface UiStore {
  /** Current theme */
  theme: ThemeId
  /** Active panel (for mobile/dock navigation) */
  activePanel: string
  /** Whether settings modal is open */
  settingsOpen: boolean
  /** Whether app is connected to server */
  connected: boolean
  /** Currently open modal (null = none) */
  activeModal: ModalId | null

  /** Set theme and persist to localStorage */
  setTheme: (theme: ThemeId) => void
  /** Set active panel */
  setActivePanel: (panel: string) => void
  /** Toggle settings modal */
  toggleSettings: () => void
  /** Set connection status */
  setConnected: (connected: boolean) => void
  /** Open a modal by ID */
  openModal: (id: ModalId) => void
  /** Close current modal */
  closeModal: () => void
  /** Server environment info */
  apiConfigured: boolean
  exchangeMode: string | null
  /** [Phase 3D] Aligned to executionEnv — null when blocked. No more legacy REAL fallback. */
  resolvedEnv: 'DEMO' | 'TESTNET' | 'REAL' | null
  /** Phase 2C canonical execution env from server _resolveExecutionEnv(). null when non-demo blocked. */
  executionEnv: 'DEMO' | 'TESTNET' | 'REAL' | null
  executionBlockedReason: 'NO_ACTIVE_API_CREDENTIALS' | 'INVALID_ACTIVE_API_CONFIGURATION' | null
  /** [Phase 12.A — Batch B] Canonical active exchange identity from server.
   *  Hydrated from at_update.data.activeExchange AND the new exchange.changed
   *  frame (typed in types/sync.ts). null = no connected exchange OR pre-login.
   *  Rendering of exchange labels in UI (Batch C+) reads strictly from this. */
  activeExchange: 'binance' | 'bybit' | null

  // [R8] StatusBar reactive fields (replaces imperative DOM writes from bootstrapError._updateStatusBar)
  /** Display mode label (e.g. DEMO, LIVE, TESTNET) — derives from AT._serverMode / AT.mode / _resolvedEnv */
  sbMode: string
  /** CSS class for mode pill (zsb-demo | zsb-testnet | zsb-live) */
  sbModeClass: string
  /** AutoTrade enabled? drives zsbAT label + dot */
  sbAtEnabled: boolean
  /** WebSocket ready? drives zsbWS label + dot */
  sbWsReady: boolean
  /** Data feed state — 'ok' | 'stale' | 'degraded' */
  sbDataState: 'ok' | 'stale' | 'degraded'
  /** Kill-switch active? drives zsbKill visibility + label */
  sbKillActive: boolean
  /** Total open position count across demo+live */
  sbPosCount: number
  /** Daily PnL ($) */
  sbPnl: number

  /** [batch3-W+] Live manual order in-flight (sets Manual PLACE button to "Placing…" + disabled).
   *  Set true when /api/order/place fires, false on then/catch. */
  isPlacingLive: boolean
  setIsPlacingLive: (placing: boolean) => void

  /** [BUG-T7 2026-05-17] Mirror of OPPOSITE-mode AT-active flag.
   *  When engineMode=demo this reflects server `state.atActiveLive`; when
   *  engineMode=live this reflects server `state.atActiveDemo`. Drives
   *  ModeBar opposite-mode badge so operator sees that the other engine
   *  mode still has AT running. */
  oppositeModeAtEnabled: boolean

  /** Merge partial state */
  patch: (partial: Partial<UiStore>) => void
  /** [Phase 3B] Reset all non-UI-preference state on logout. Preserves theme. */
  reset: () => void
}

function readTheme(): ThemeId {
  try {
    const t = localStorage.getItem('zeus_theme')
    if (t === 'native' || t === 'dark' || t === 'light') return t
  } catch {
    /* ignore */
  }
  return 'native'
}

export const useUiStore = create<UiStore>()((set) => ({
  theme: readTheme(),
  activePanel: 'chart',
  settingsOpen: false,
  connected: false,
  activeModal: null,
  apiConfigured: false,
  exchangeMode: null,
  resolvedEnv: 'DEMO',
  executionEnv: null,
  executionBlockedReason: null,
  activeExchange: null,

  // [R8] StatusBar defaults
  sbMode: 'DEMO',
  sbModeClass: 'zsb-demo',
  sbAtEnabled: false,
  sbWsReady: false,
  sbDataState: 'ok',
  sbKillActive: false,
  sbPosCount: 0,
  sbPnl: 0,

  isPlacingLive: false,
  setIsPlacingLive: (placing) => set({ isPlacingLive: !!placing }),
  oppositeModeAtEnabled: false,

  setTheme: (theme) => {
    try {
      localStorage.setItem('zeus_theme', theme)
    } catch {
      /* ignore */
    }
    if (theme === 'native') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
  },
  setActivePanel: (panel) => set({ activePanel: panel }),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  setConnected: (connected) => set({ connected }),
  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),
  patch: (partial) => set((s) => ({ ...s, ...partial })),
  // [Phase 3B] Logout reset — clears ownership/env/mode/UI-connection fields to defaults.
  // Theme is preserved intentionally (UX preference, not user-bound truth).
  reset: () => set({
    activePanel: 'chart',
    settingsOpen: false,
    connected: false,
    activeModal: null,
    apiConfigured: false,
    exchangeMode: null,
    resolvedEnv: 'DEMO',
    executionEnv: null,
    executionBlockedReason: null,
    activeExchange: null,
    sbMode: 'DEMO',
    sbModeClass: 'zsb-demo',
    sbAtEnabled: false,
    sbWsReady: false,
    sbDataState: 'ok',
    sbKillActive: false,
    sbPosCount: 0,
    sbPnl: 0,
    isPlacingLive: false,
    oppositeModeAtEnabled: false,
  }),
}))
