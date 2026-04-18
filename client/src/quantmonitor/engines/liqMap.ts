// QM Liquidation Map — [BUG5.5] Real liquidation aggregation (rolling 24h)
// Replaces the prior synthetic bracket-MMR model (OI × weight × price) which
// produced multi-billion-dollar phantom clusters. Now reads from live feeds:
//   1. w.S.llvBuckets   — Binance + Bybit real liqs (populated by procLiq)
//   2. QM.liqAgg.okx    — OKX real liqs (populated by addLiq via WS)
// Each event is bucketed by %-from-current-price at 0.25% granularity so the
// render layer can offer fine resolution near price and aggregate farther out.
import { QM } from '../state'

const w = window as any

const WINDOW_MS = 24 * 3600 * 1000   // rolling 24-hour window
const MAX_PCT = 35                    // clip far-out noise (matches prior UI)
const MIN_PCT = 0.05                  // ignore micro-jitter at price

export function buildLiqEstimate(): void {
  const c = w.S; if (!c || !c.price) return
  const p = c.price
  const cutoff = Date.now() - WINDOW_MS

  c._qmLiqBuckets = {} as Record<number, { price: number; longVol: number; shortVol: number; lev: string[] }>

  const addBucket = (pct: number, bPrice: number, isLong: boolean, usd: number) => {
    if (!Number.isFinite(usd) || usd <= 0) return
    if (Math.abs(pct) < MIN_PCT || Math.abs(pct) > MAX_PCT) return
    const bk = Math.round(pct * 4) / 4
    if (!c._qmLiqBuckets[bk]) c._qmLiqBuckets[bk] = { price: bPrice, longVol: 0, shortVol: 0, lev: [] }
    if (isLong) c._qmLiqBuckets[bk].longVol += usd
    else c._qmLiqBuckets[bk].shortVol += usd
    c._qmLiqBuckets[bk].price = bPrice
  }

  // 1) Binance + Bybit — already per-price aggregated by procLiq in marketDataWS
  const llv = c.llvBuckets || {}
  for (const pkey in llv) {
    const b = llv[pkey]; if (!b || !b.price) continue
    if (b.ts && b.ts < cutoff) continue
    const pct = ((b.price - p) / p) * 100
    if (b.longUSD > 0) addBucket(pct, b.price, true, b.longUSD)
    if (b.shortUSD > 0) addBucket(pct, b.price, false, b.shortUSD)
  }

  // 2) OKX — per-event array (side: 'SELL' = long liquidated)
  const okxEvents = (QM.liqAgg.okx.btc || []) as any[]
  okxEvents.forEach(liq => {
    if (!liq || !liq.p || !liq.vol) return
    if (liq.time && liq.time < cutoff) return
    const isLong = liq.side === 'SELL' || !!liq.isLong
    const pct = ((+liq.p - p) / p) * 100
    addBucket(pct, +liq.p, isLong, +liq.vol)
  })
}

export async function fetchTopTraderPositionRatio(): Promise<void> {
  const c = w.S; if (!c) return
  try {
    const tp = await (await fetch('https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=5m&limit=1')).json()
    if (tp.length) { c._qmPosLongRatio = +tp[0].longAccount; c._qmPosShortRatio = +tp[0].shortAccount }
  } catch (_) { c._qmPosLongRatio = c.ls || 0.5; c._qmPosShortRatio = 1 - (c.ls || 0.5) }
}
