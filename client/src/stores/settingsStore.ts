import { create } from 'zustand'

// ── DEFAULT SETTINGS — merge template for missing keys ──
const DEFAULT_SETTINGS: Record<string, any> = {
  // AT
  confMin: 65, sigMin: 3, size: 200, riskPct: 1, maxDay: 5, maxPos: 3,
  sl: 1.5, rr: 2, killPct: 5, lossStreak: 3, maxAddon: 2, lev: 5,
  adaptEnabled: false, adaptLive: false, smartExitEnabled: false,
  // UI
  theme: 'native', uiScale: 100, soundEnabled: true,
  // Chart
  chartTf: '5m', chartType: 'candle', candleColors: null, heatmapSettings: null, timezoneOffset: null,
  // Indicators
  indSettings: null,
  // Liq / LLV / Supremus / S-R
  liqSettings: null, llvSettings: null, zsSettings: null, srSettings: null,
  // Alerts
  alertSettings: null,
}

interface SettingsStoreState {
  settings: Record<string, any>
  loaded: boolean
  saving: boolean

  /** Load from server, merge with defaults, write to store */
  loadFromServer: () => Promise<void>
  /** Save current settings to server (explicit, not auto) */
  saveToServer: () => Promise<void>
  /** Update one or more settings locally (does NOT auto-save) */
  patch: (partial: Record<string, any>) => void
  /** Get a setting value with default fallback */
  get: (key: string) => any
}

export const useSettingsStore = create<SettingsStoreState>()((set, getState) => ({
  settings: { ...DEFAULT_SETTINGS },
  loaded: false,
  saving: false,

  loadFromServer: async () => {
    try {
      const res = await fetch('/api/user/settings', { credentials: 'same-origin' })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const data = await res.json()
      const serverSettings = (data.ok && data.settings) ? data.settings : {}
      // Merge: defaults ← server (server wins, defaults fill gaps)
      const merged = { ...DEFAULT_SETTINGS, ...serverSettings }
      set({ settings: merged, loaded: true })
      // Write to localStorage as cache
      try { localStorage.setItem('zeus_user_settings_cache', JSON.stringify(merged)) } catch (_) {}
      // Bridge invers: populate window.TC + window.USER_SETTINGS for engines
      _syncToWindow(merged)
    } catch (_) {
      // Fallback: load from localStorage cache if server unreachable
      try {
        const cached = JSON.parse(localStorage.getItem('zeus_user_settings_cache') || '{}')
        const merged = { ...DEFAULT_SETTINGS, ...cached }
        set({ settings: merged, loaded: true })
        _syncToWindow(merged)
      } catch (__) {
        set({ settings: { ...DEFAULT_SETTINGS }, loaded: true })
      }
    }
  },

  saveToServer: async () => {
    const { settings, saving } = getState()
    if (saving) return
    set({ saving: true })
    try {
      await fetch('/api/user/settings', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      // Update localStorage cache
      try { localStorage.setItem('zeus_user_settings_cache', JSON.stringify(settings)) } catch (_) {}
      // Bridge invers
      _syncToWindow(settings)
    } catch (_) {
      console.warn('[settings] save to server failed')
    } finally {
      set({ saving: false })
    }
  },

  patch: (partial) => set((s) => {
    const updated = { ...s.settings, ...partial }
    // Bridge invers on each patch (engines need fresh values)
    _syncToWindow(updated)
    return { settings: updated }
  }),

  get: (key: string) => {
    return getState().settings[key] ?? DEFAULT_SETTINGS[key]
  },
}))

/** Bridge invers: sync settings into window.TC and window.USER_SETTINGS for engines */
function _syncToWindow(s: Record<string, any>) {
  const w = window as any
  if (typeof w.TC !== 'undefined') {
    if (s.confMin != null) w.TC.confMin = Number(s.confMin)
    if (s.sigMin != null) w.TC.sigMin = Number(s.sigMin)
    if (s.size != null) w.TC.size = Number(s.size)
    if (s.riskPct != null) w.TC.riskPct = Number(s.riskPct)
    if (s.maxPos != null) w.TC.maxPos = Number(s.maxPos)
    if (s.sl != null) w.TC.slPct = Number(s.sl)
    if (s.rr != null) w.TC.rr = Number(s.rr)
    if (s.killPct != null) w.TC.killPct = Number(s.killPct)
    if (s.lossStreak != null) w.TC.lossStreak = Number(s.lossStreak)
    if (s.maxAddon != null) w.TC.maxAddon = Number(s.maxAddon)
    if (s.lev != null) w.TC.lev = Number(s.lev)
  }
}
