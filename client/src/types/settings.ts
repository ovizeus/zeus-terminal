/** Chart color settings */
export interface ChartColors {
  bull: string
  bear: string
  bullW: string
  bearW: string
  priceText: string
  priceBg: string
}

/** Chart settings */
export interface ChartSettings {
  tf: string
  tz: string
  heatmap: unknown | null
  colors: ChartColors
}

/** Auto-trade user settings */
export interface AutoTradeSettings {
  lev: number
  sl: number
  rr: number
  size: number
  maxPos: number
  killPct: number
  confMin: number
  sigMin: number
  multiSym: boolean
  smartExitEnabled: boolean
}

/**
 * User settings — mirrors window.USER_SETTINGS from config.js:1582
 */
export interface UserSettings {
  _version: number
  chart: ChartSettings
  indicators: Record<string, unknown> | null
  alerts: Record<string, unknown> | null
  profile: string
  bmMode: string | null
  assistArmed: boolean
  autoTrade: AutoTradeSettings
  manualLive?: Record<string, unknown>
  ptLevDemo?: number
  ptLevLive?: number
  ptMarginMode?: string
  _syncTs?: number
}

/** Theme ID */
export type ThemeId = 'native' | 'dark' | 'light'

/** Global mode — brain operating mode */
export type GlobalMode = 'assist' | 'auto' | 'manual'
