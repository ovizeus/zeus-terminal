// QM Liquidation Map — Estimated liq levels from OI + leverage brackets — 1:1 from HTML
const w = window as any

export function buildLiqEstimate(): void {
  const c = w.S; if (!c || !c.price) return
  const p = c.price
  const oi = c.oi || 1000
  const longR = c._qmPosLongRatio || c.ls || 0.5
  const shortR = c._qmPosShortRatio || (1 - (c.ls || 0.5))
  const totalLong = oi * longR
  const totalShort = oi * shortR

  // Real BTCUSDT leverage brackets (Binance)
  const brackets = [
    { lev: 125, w: 0.004, mmr: 0.004 }, { lev: 100, w: 0.008, mmr: 0.005 },
    { lev: 75, w: 0.012, mmr: 0.005 }, { lev: 50, w: 0.025, mmr: 0.01 },
    { lev: 20, w: 0.055, mmr: 0.025 }, { lev: 10, w: 0.12, mmr: 0.05 },
    { lev: 5, w: 0.20, mmr: 0.05 }, { lev: 4, w: 0.18, mmr: 0.10 },
    { lev: 3, w: 0.15, mmr: 0.125 }, { lev: 2, w: 0.12, mmr: 0.15 },
    { lev: 1, w: 0.126, mmr: 0.25 },
  ]
  const wSum = brackets.reduce((s, b) => s + b.w, 0)
  brackets.forEach(b => b.w /= wSum)

  c._qmLiqBuckets = {} as Record<number, { price: number; longVol: number; shortVol: number; lev: string[] }>

  brackets.forEach(({ lev, w: weight, mmr }) => {
    const longLiqPrice = p * (1 - (1 / lev) + mmr)
    const shortLiqPrice = p * (1 + (1 / lev) - mmr)
    const longVol = totalLong * weight * p
    const shortVol = totalShort * weight * p

    const bucket = (pct: number, price: number, isLong: boolean, vol: number) => {
      const b = Math.round(pct * 2) / 2
      if (!c._qmLiqBuckets[b]) c._qmLiqBuckets[b] = { price, longVol: 0, shortVol: 0, lev: [] }
      if (isLong) c._qmLiqBuckets[b].longVol += vol; else c._qmLiqBuckets[b].shortVol += vol
      if (!c._qmLiqBuckets[b].lev.includes(lev + 'x')) c._qmLiqBuckets[b].lev.push(lev + 'x')
      c._qmLiqBuckets[b].price = price
    }

    const longPct = ((longLiqPrice - p) / p * 100)
    const shortPct = ((shortLiqPrice - p) / p * 100)
    if (longPct > -35 && longPct < 0) bucket(longPct, longLiqPrice, true, longVol)
    if (shortPct < 35 && shortPct > 0) bucket(shortPct, shortLiqPrice, false, shortVol)
  })
}

export async function fetchTopTraderPositionRatio(): Promise<void> {
  const c = w.S; if (!c) return
  try {
    const tp = await (await fetch('https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=5m&limit=1')).json()
    if (tp.length) { c._qmPosLongRatio = +tp[0].longAccount; c._qmPosShortRatio = +tp[0].shortAccount }
  } catch (_) { c._qmPosLongRatio = c.ls || 0.5; c._qmPosShortRatio = 1 - (c.ls || 0.5) }
}
