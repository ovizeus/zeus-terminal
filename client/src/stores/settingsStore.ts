import { create } from 'zustand'
import type { TradingConfig, UserSettings } from '../types'

interface SettingsStore {
  /** Trading config — mirrors window.TC */
  tc: TradingConfig
  /** User settings — mirrors window.USER_SETTINGS */
  userSettings: UserSettings

  /** Update trading config */
  setTC: (tc: Partial<TradingConfig>) => void
  /** Update user settings */
  setUserSettings: (settings: Partial<UserSettings>) => void
}

export const useSettingsStore = create<SettingsStore>()((set) => ({
  tc: {
    lev: 5,
    size: 200,
    slPct: 1.5,
    rr: 2,
    riskPct: 1,
    maxPos: 3,
    cooldownMs: 60000,
    minADX: 18,
    hourStart: 0,
    hourEnd: 23,
    sigMin: 3,
    confMin: 65,
    dslActivatePct: 40,
    dslTrailPct: 0.8,
    dslTrailSusPct: 1.0,
    dslExtendPct: 20,
  },
  userSettings: {
    _version: 1,
    chart: {
      tf: '5m',
      tz: 'Europe/Bucharest',
      heatmap: null,
      colors: {
        bull: '#00d97a',
        bear: '#ff3355',
        bullW: '#00d97a',
        bearW: '#ff3355',
        priceText: '#7a9ab8',
        priceBg: '#0a0f16',
      },
    },
    indicators: null,
    alerts: null,
    profile: 'fast',
    bmMode: null,
    assistArmed: false,
    autoTrade: {
      lev: 5,
      sl: 1.5,
      rr: 2,
      size: 200,
      maxPos: 4,
      killPct: 5,
      confMin: 65,
      sigMin: 3,
      multiSym: true,
      smartExitEnabled: false,
    },
  },

  setTC: (partial) => set((s) => ({ tc: { ...s.tc, ...partial } })),
  setUserSettings: (partial) =>
    set((s) => ({ userSettings: { ...s.userSettings, ...partial } })),
}))
