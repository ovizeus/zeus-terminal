import { create } from 'zustand'
import type { ThemeId } from '../types'

interface UiStore {
  /** Current theme */
  theme: ThemeId
  /** Active panel (for mobile/dock navigation) */
  activePanel: string
  /** Whether settings modal is open */
  settingsOpen: boolean
  /** Whether app is connected to server */
  connected: boolean

  /** Set theme and persist to localStorage */
  setTheme: (theme: ThemeId) => void
  /** Set active panel */
  setActivePanel: (panel: string) => void
  /** Toggle settings modal */
  toggleSettings: () => void
  /** Set connection status */
  setConnected: (connected: boolean) => void
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
}))
