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
  resolvedEnv: string

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

  /** Merge partial state */
  patch: (partial: Partial<UiStore>) => void
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

  // [R8] StatusBar defaults
  sbMode: 'DEMO',
  sbModeClass: 'zsb-demo',
  sbAtEnabled: false,
  sbWsReady: false,
  sbDataState: 'ok',
  sbKillActive: false,
  sbPosCount: 0,
  sbPnl: 0,

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
}))
