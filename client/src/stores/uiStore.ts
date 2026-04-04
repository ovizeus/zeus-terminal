import { create } from 'zustand'
import type { ThemeId } from '../types'

type ModalId = 'notifications' | 'cloud' | 'alerts' | 'charts' | 'liq' | 'llv' | 'supremus' | 'sr' | 'settings' | 'ovi' | 'welcome' | 'admin' | 'cmdpalette' | 'exposure' | 'decisionlog'

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
