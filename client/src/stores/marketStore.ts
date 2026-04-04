import { create } from 'zustand'
import type { MarketState } from '../types'

interface WlPrice { price: number; chg: number }

interface MarketStore {
  /** Live market snapshot — mirrors window.S */
  market: MarketState
  /** Watchlist prices — keyed by symbol (e.g. BTCUSDT) */
  wlPrices: Record<string, WlPrice>

  /** Update partial market state */
  patch: (partial: Partial<MarketState>) => void

  /** Update price only (hot path) */
  setPrice: (price: number) => void

  /** Update a single watchlist price */
  setWlPrice: (sym: string, price: number, chg: number) => void
}

const defaultMarket: MarketState = {
  price: 0,
  prevPrice: 0,
  high: 0,
  low: 0,
  fr: null,
  frCd: null,
  oi: null,
  oiPrev: null,
  ls: null,
  atr: null,
  totalUSD: 0,
  longUSD: 0,
  shortUSD: 0,
  cnt: 0,
  longCnt: 0,
  shortCnt: 0,
  buckets: Array.from({ length: 20 }, () => ({ l: 0, s: 0 })),
  bIdx: 0,
  pairs: {},
  btcClusters: {},
  asks: [],
  bids: [],
  bnbOk: false,
  bybOk: false,
  w1m: { l: 0, s: 0, v: 0 },
  w5m: { l: 0, s: 0, v: 0 },
  w15m: { l: 0, s: 0, v: 0 },
  rsi: {},
  events: [],
  dtTf: '1H',
  soundOn: false,
  chartTf: '5m',
  symbol: 'BTCUSDT',
  tz: 'Europe/Bucharest',
  magnetBias: 'neut',
  cloudEmail: '',
  indicators: { ema: true, wma: true, st: true, vp: true },
  overlays: { liq: false, zs: false, sr: false, llv: false, oflow: false },
  llvSettings: {
    bucketPct: 0.3,
    maxBarWidthPct: 30,
    opacity: 0.7,
    minUsd: 0,
    longCol: '#00d4aa',
    shortCol: '#ff4466',
    showLabels: true,
    labelMode: 'compact',
  },
  alerts: {
    enabled: false,
    volSpike: true,
    volThreshold: 500,
    pivotCross: false,
    divergence: true,
    rsiAlerts: true,
    whaleOrders: true,
    whaleMinBtc: 100,
    liqAlerts: true,
    liqMinBtc: 1,
  },
  heatmapSettings: {
    lookback: 400,
    pivotWidth: 1,
    atrLen: 121,
    atrBandPct: 0.05,
    extendUnhit: 30,
    keepTouched: true,
    heatContrast: 0.3,
    minWeight: 0,
    longCol: '#01c4fe',
    shortCol: '#ffe400',
  },
  heatmapPockets: [],
  klines: [] as MarketState['klines'],
  liqMinUsd: 500,
  liqSym: 'BTC',
  wsK: null,
  scenario: { primary: null, alternate: null, failure: null, updated: 0 },
  liqMetrics: {
    bnb: { count: 0, usd: 0, lastTs: 0, msgCount: 0 },
    byb: { count: 0, usd: 0, lastTs: 0, msgCount: 0, connected: false, connectedAt: 0, reconnects: 0 },
  },
}

export const useMarketStore = create<MarketStore>()((set) => ({
  market: defaultMarket,
  wlPrices: {},

  patch: (partial) =>
    set((s) => ({ market: { ...s.market, ...partial } })),

  setPrice: (price) =>
    set((s) => ({ market: { ...s.market, prevPrice: s.market.price, price } })),

  setWlPrice: (sym, price, chg) =>
    set((s) => ({ wlPrices: { ...s.wlPrices, [sym]: { price, chg } } })),
}))
