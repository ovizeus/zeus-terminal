/** Weighted volume bucket */
export interface WeightedVolume {
  l: number
  s: number
  v: number
}

/** Liquidation bucket */
export interface LiqBucket {
  l: number
  s: number
}

/** Liquidation source metrics */
export interface LiqSourceMetrics {
  count: number
  usd: number
  lastTs: number
  msgCount: number
  connected?: boolean
  connectedAt?: number
  reconnects?: number
}

/** LLV overlay settings */
export interface LlvSettings {
  bucketPct: number
  maxBarWidthPct: number
  opacity: number
  minUsd: number
  longCol: string
  shortCol: string
  showLabels: boolean
  labelMode: string
}

/** Alert configuration */
export interface AlertSettings {
  enabled: boolean
  volSpike: boolean
  volThreshold: number
  pivotCross: boolean
  divergence: boolean
  rsiAlerts: boolean
  whaleOrders: boolean
  whaleMinBtc: number
  liqAlerts: boolean
  liqMinBtc: number
}

/** Heatmap settings */
export interface HeatmapSettings {
  lookback: number
  pivotWidth: number
  atrLen: number
  atrBandPct: number
  extendUnhit: number
  keepTouched: boolean
  heatContrast: number
  minWeight: number
  longCol: string
  shortCol: string
}

/** Scenario engine state */
export interface ScenarioState {
  primary: string | null
  alternate: string | null
  failure: string | null
  updated: number
}

/** Indicator toggles */
export interface IndicatorToggles {
  ema: boolean
  wma: boolean
  st: boolean
  vp: boolean
}

/** Overlay toggles */
export interface OverlayToggles {
  liq: boolean
  zs: boolean
  sr: boolean
  llv: boolean
  oflow: boolean
  ovi: boolean
}

/**
 * Market state — mirrors window.S from state.js:1294
 * This is the live market snapshot for the active symbol
 */
export interface MarketState {
  // Price
  price: number
  prevPrice: number
  high: number
  low: number

  // Funding & OI
  fr: number | null
  frCd: number | null
  oi: number | null
  oiPrev: number | null
  ls: number | null
  atr: number | null

  // Liquidation aggregates
  totalUSD: number
  longUSD: number
  shortUSD: number
  cnt: number
  longCnt: number
  shortCnt: number
  buckets: LiqBucket[]
  bIdx: number

  // Multi-symbol
  pairs: Record<string, unknown>
  btcClusters: Record<string, unknown>

  // Orderbook
  asks: number[][]
  bids: number[][]

  // Feed status
  bnbOk: boolean
  bybOk: boolean

  // Weighted volumes
  w1m: WeightedVolume
  w5m: WeightedVolume
  w15m: WeightedVolume

  // Indicators
  rsi: Record<string, number>
  events: unknown[]

  // Config
  dtTf: string
  soundOn: boolean
  chartTf: string
  symbol: string
  tz: string
  magnetBias: string
  cloudEmail: string

  // Feature settings
  indicators: IndicatorToggles
  overlays: OverlayToggles
  llvSettings: LlvSettings
  alerts: AlertSettings
  heatmapSettings: HeatmapSettings
  heatmapPockets: unknown[]

  // Data
  klines: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>
  liqMinUsd: number
  liqSym: string
  wsK: unknown | null

  // Scenario engine
  scenario: ScenarioState

  // Liq metrics per source
  liqMetrics: {
    bnb: LiqSourceMetrics
    byb: LiqSourceMetrics
  }
}
