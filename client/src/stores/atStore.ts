import { create } from 'zustand'
import type { ATState, ATConfig, ATLogEntry, SettingsPayload } from '../types'

/**
 * Default AT config — matches legacy TC defaults observed in state.ts / config.ts
 * boot path. Used as initial value before `hydrate()` or server fetch overlays.
 */
const DEFAULT_AT_CONFIG: ATConfig = {
  lev: 5,
  size: 150,
  slPct: 1.3,
  rr: 2,
  maxPos: 3,
  sigMin: 3,
  adxMin: 18,
  cooldownMs: 60000,
}

export interface ATUI {
  btnClass: string
  dotBg: string
  dotShadow: string
  btnText: string
  statusHtml: string
  statusAction: string | null
  modeLabelHtml: string
  modeLabelColor: string
  modeDisplayHtml: string
  modeDisplayColor: string
  modeDisplayBorder: string
  liveWarnVisible: boolean
  condConf: string
  condConfClass: string
  condSig: string
  condSigClass: string
  balanceText: string
  balanceColor: string
  winRateText: string
  winRateColor: string
  totalPnLText: string
  totalPnLColor: string
  dailyLossText: string
  dailyLossColor: string
  dailyLabel: string
  totalTradesText: string
  logHtml: string
  posCountText: string
  killBtnTriggered: boolean
  sentinelVisible: boolean
  sentinelHtml: string
  sentinelBg: string
  sentinelColor: string
  sentinelBorder: string
}

const DEFAULT_AT_UI: ATUI = {
  btnClass: 'at-main-btn off',
  dotBg: '#aa44ff',
  dotShadow: '0 0 6px #aa44ff',
  btnText: 'AUTO TRADE OFF',
  statusHtml: 'Configureaza mai jos',
  statusAction: null,
  modeLabelHtml: 'DEMO',
  modeLabelColor: '#aa44ff',
  modeDisplayHtml: 'DEMO MODE',
  modeDisplayColor: '#aa44ff',
  modeDisplayBorder: '#aa44ff44',
  liveWarnVisible: false,
  condConf: '\u2014',
  condConfClass: 'at-cond-val wait',
  condSig: '\u2014',
  condSigClass: 'at-cond-val wait',
  balanceText: '$10,000',
  balanceColor: 'var(--whi)',
  winRateText: '\u2014',
  winRateColor: 'var(--dim)',
  totalPnLText: '$0.00',
  totalPnLColor: 'var(--grn)',
  dailyLossText: '$0.00',
  dailyLossColor: 'var(--grn)',
  dailyLabel: 'DAILY P&L',
  totalTradesText: '0',
  logHtml: '<div class="at-log-row"><span class="at-log-time">--:--</span><span class="at-log-msg info">Auto Trade Engine pornit. Astept semnal...</span></div>',
  posCountText: '0 positions',
  killBtnTriggered: false,
  sentinelVisible: false,
  sentinelHtml: '',
  sentinelBg: '',
  sentinelColor: '',
  sentinelBorder: '',
}

type ATStore = ATState & {
  config: ATConfig
  ui: ATUI
  /** Merge partial AT state from server */
  patch: (partial: Partial<ATState>) => void
  /** Merge partial AT config (lev/size/slPct/rr/maxPos/sigMin/adxMin/cooldownMs) */
  patchConfig: (partial: Partial<ATConfig>) => void
  /** Merge partial AT UI display state */
  patchUI: (partial: Partial<ATUI>) => void
  /**
   * Hydrate AT config from a flat SettingsPayload.
   * Wire mapping: sl → slPct, others 1:1.
   * Fields NOT in flat wire (adxMin, cooldownMs) are left untouched
   * (they live in nested indSettings blob / engine defaults).
   * Undefined wire values leave the current config value intact.
   */
  hydrate: (settings: SettingsPayload) => void
  /** Append log entry */
  addLog: (entry: ATLogEntry) => void
}

export const useATStore = create<ATStore>()((set) => ({
  enabled: false,
  mode: 'demo',
  running: false,
  killTriggered: false,
  killReason: null,
  killLoss: 0,
  killLimit: 0,
  killBalRef: 0,
  killModeAtTrigger: null,
  killActiveAt: 0,
  interval: null,
  totalTrades: 0,
  wins: 0,
  losses: 0,
  totalPnL: 0,
  dailyPnL: 0,
  realizedDailyPnL: 0,
  closedTradesToday: 0,
  dailyStart: new Date().toDateString(),
  lastTradeSide: null,
  lastTradeTs: 0,
  cooldownMs: 120000,
  _cooldownBySymbol: {},
  _killTriggeredTs: 0,
  enabledAt: 0,
  _modeConfirmed: false,
  _enabledPerMode: {},
  _serverMode: '',
  _serverStats: null,
  _serverDemoStats: null,
  _serverLiveStats: null,
  log: [],

  config: { ...DEFAULT_AT_CONFIG },
  ui: { ...DEFAULT_AT_UI },

  patch: (partial) => set((s) => ({ ...s, ...partial })),
  patchConfig: (partial) => set((s) => {
    const next: ATConfig = { ...s.config }
    if (partial.lev !== undefined && Number.isFinite(partial.lev)) next.lev = partial.lev
    if (partial.size !== undefined && Number.isFinite(partial.size)) next.size = partial.size
    if (partial.slPct !== undefined && Number.isFinite(partial.slPct)) next.slPct = partial.slPct
    if (partial.rr !== undefined && Number.isFinite(partial.rr)) next.rr = partial.rr
    if (partial.maxPos !== undefined && Number.isFinite(partial.maxPos)) next.maxPos = partial.maxPos
    if (partial.sigMin !== undefined && Number.isFinite(partial.sigMin)) next.sigMin = partial.sigMin
    if (partial.adxMin !== undefined && Number.isFinite(partial.adxMin)) next.adxMin = partial.adxMin
    if (partial.cooldownMs !== undefined && Number.isFinite(partial.cooldownMs)) next.cooldownMs = partial.cooldownMs
    return { config: next }
  }),
  patchUI: (partial) => set((s) => ({ ui: { ...s.ui, ...partial } })),
  hydrate: (settings) => set((s) => {
    const next: ATConfig = { ...s.config }
    if (typeof settings.lev === 'number' && Number.isFinite(settings.lev)) next.lev = settings.lev
    if (typeof settings.size === 'number' && Number.isFinite(settings.size)) next.size = settings.size
    if (typeof settings.sl === 'number' && Number.isFinite(settings.sl)) next.slPct = settings.sl
    if (typeof settings.rr === 'number' && Number.isFinite(settings.rr)) next.rr = settings.rr
    if (typeof settings.maxPos === 'number' && Number.isFinite(settings.maxPos)) next.maxPos = settings.maxPos
    if (typeof settings.sigMin === 'number' && Number.isFinite(settings.sigMin)) next.sigMin = settings.sigMin
    return { config: next }
  }),
  addLog: (entry) => set((s) => ({ log: [...s.log.slice(-99), entry] })),
}))
