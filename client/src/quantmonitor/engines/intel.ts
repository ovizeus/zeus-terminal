// QM Intel Engine — 1:1 from HTML: whales, pressure, spread, absorption, ATR, MFI, VWAP, vol percentile, regime, cascade, OFD, bollinger, S/R, MTF, fear/greed, divergence, tape speed
const w = window as any

export function detectWhales(): void {
  const c = w.S; if (!c || !c.bids || !c.asks) return
  const threshold = 3 // 3 BTC
  const now = Date.now()
  c._qmWhales = (c._qmWhales || []).filter((ww: any) => now - ww.time < 300000)
  ;[...c.bids, ...c.asks].forEach((o: any) => {
    if (o.q >= threshold) {
      const exists = c._qmWhales.some((ww: any) => Math.abs(ww.p - o.p) < 1 && Math.abs(ww.q - o.q) < 0.1)
      if (!exists) {
        const side = c.bids.includes(o) ? 'BID' : 'ASK'
        c._qmWhales.push({ p: o.p, q: o.q, side, time: now })
      }
    }
  })
}

export function trackPressure(): void {
  const c = w.S; if (!c) return
  const tot = (c.obBV || 0) + (c.obAV || 0)
  if (tot <= 0) return
  const ratio = c.obBV / tot
  c._qmPressureHist = c._qmPressureHist || []
  c._qmPressureHist.push({ time: Date.now(), ratio })
  const fiveMin = Date.now() - 300000
  c._qmPressureHist = c._qmPressureHist.filter((p: any) => p.time > fiveMin)
}

export function getPressureTrend(): { avg: number; trend: number; rising: boolean } {
  const h = w.S?._qmPressureHist || []
  if (h.length < 5) return { avg: 0.5, trend: 0, rising: false }
  const avg = h.reduce((s: number, p: any) => s + p.ratio, 0) / h.length
  const recent = h.slice(-5).reduce((s: number, p: any) => s + p.ratio, 0) / 5
  const old = h.slice(0, 5).reduce((s: number, p: any) => s + p.ratio, 0) / Math.min(5, h.length)
  return { avg, trend: recent - old, rising: recent > old }
}

export function trackSpread(): void {
  const c = w.S; if (!c) return
  c._qmSpreadHist = c._qmSpreadHist || []
  c._qmSpreadHist.push(c.spread || 0)
  if (c._qmSpreadHist.length > 200) c._qmSpreadHist.shift()
  if (c._qmSpreadHist.length >= 20) {
    c._qmSpreadAvg = c._qmSpreadHist.slice(-50).reduce((s: number, v: number) => s + v, 0) / Math.min(50, c._qmSpreadHist.length)
    c._qmSpreadAlert = (c.spread || 0) > c._qmSpreadAvg * 2.5
  }
}

export function detectAbsorption(): void {
  const c = w.S; if (!c || !c._qmPressureHist || c._qmPressureHist.length < 10 || !c.price) return
  const buf = c._qmBuf || []; if (buf.length < 10) return
  const recentPrices = buf.slice(-20)
  const priceRange = Math.max(...recentPrices) - Math.min(...recentPrices)
  const pctMove = priceRange / c.price * 100
  const totVol = (c.obBV || 0) + (c.obAV || 0)
  const isAbsorbing = pctMove < 0.05 && totVol > 0
  if (isAbsorbing) {
    const bias = c.obBV > c.obAV ? 'BID' : 'ASK'
    c._qmAbsorption = { detected: true, side: bias, strength: Math.min(100, (totVol > 0 && pctMove > 0 ? totVol / pctMove : 0) * 10) }
  } else {
    c._qmAbsorption = { detected: false, side: '', strength: 0 }
  }
}

export function calcVWAP(): void {
  const c = w.S; if (!c) return
  const kl = c.klines; if (!kl || kl.length < 5) return
  let cumTPV = 0, cumVol = 0
  kl.forEach((candle: any) => { const tp = (candle.h + candle.l + candle.c) / 3; const vol = candle.v || 0; cumTPV += tp * vol; cumVol += vol })
  c._qmVwap = cumVol > 0 ? cumTPV / cumVol : c.price
}

export function calcVolPercentile(): void {
  const c = w.S; if (!c) return
  const kl = c.klines; if (!kl || kl.length < 10) return
  const vols = kl.map((k: any) => k.v || 0)
  const currentVol = vols[vols.length - 1]
  const sorted = [...vols].sort((a: number, b: number) => a - b)
  const idx = sorted.findIndex((v: number) => v >= currentVol)
  c._qmVolPercentile = idx >= 0 ? (idx / sorted.length * 100) : 50
}

export function calcRegime(): void {
  const c = w.S; if (!c) return
  const kl = c.klines; if (!kl || kl.length < 20) return
  let plusDM = 0, minusDM = 0, trSum = 0
  for (let i = kl.length - 14; i < kl.length; i++) {
    const h = kl[i].h, l = kl[i].l
    const ph = kl[i - 1].h, pl = kl[i - 1].l, pc = kl[i - 1].c
    const upMove = h - ph, dnMove = pl - l
    if (upMove > dnMove && upMove > 0) plusDM += upMove
    if (dnMove > upMove && dnMove > 0) minusDM += dnMove
    trSum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))
  }
  const atr14 = trSum / 14
  const plusDI = atr14 > 0 ? (plusDM / atr14 * 100) : 0
  const minusDI = atr14 > 0 ? (minusDM / atr14 * 100) : 0
  const diSum = plusDI + minusDI
  const dx = diSum > 0 ? Math.abs(plusDI - minusDI) / diSum * 100 : 0
  c._qmAdx = dx
  const atrPct = c.price > 0 ? atr14 / c.price * 100 : 0
  if (dx > 35 && atrPct > 0.08) c._qmRegime = 'TRENDING'
  else if (atrPct > 0.15) c._qmRegime = 'VOLATILE'
  else if (dx < 20) c._qmRegime = 'RANGING'
  else c._qmRegime = 'TRANSITION'
}

export function calcCascadeRisk(): void {
  const c = w.S; if (!c || !c.price || !c._qmLiqBuckets) return
  let nearVol = 0, totalVol = 0
  Object.keys(c._qmLiqBuckets).forEach((pct: string) => {
    const b = c._qmLiqBuckets[+pct]; if (!b) return
    const vol = b.longVol + b.shortVol; totalVol += vol
    if (Math.abs(+pct) <= 3) nearVol += vol
  })
  c._qmCascadeRisk = totalVol > 0 ? (nearVol / totalVol * 100) : 0
  let nearLong = 0, nearShort = 0
  Object.keys(c._qmLiqBuckets).forEach((pct: string) => {
    const b = c._qmLiqBuckets[+pct]; if (!b) return
    if (+pct >= -3 && +pct < 0) nearLong += b.longVol
    if (+pct <= 3 && +pct > 0) nearShort += b.shortVol
  })
  c._qmCascadeZone = nearLong > nearShort ? 'LONG' : 'SHORT'
}

export function calcOrderFlowDelta(): void {
  const c = w.S; if (!c) return
  const kl = c.klines; if (!kl || kl.length < 5) return
  let buyVol = 0, sellVol = 0
  const recent = kl.slice(-10)
  recent.forEach((candle: any) => {
    const vol = candle.v || 0
    if (candle.c > candle.o) buyVol += vol; else sellVol += vol
  })
  const total = buyVol + sellVol
  c._qmOrderFlowDelta = total > 0 ? ((buyVol - sellVol) / total * 100) : 0
  c._qmOfdHist = c._qmOfdHist || []
  c._qmOfdHist.push(c._qmOrderFlowDelta)
  if (c._qmOfdHist.length > 30) c._qmOfdHist.shift()
}

export function calcBollinger(): void {
  const c = w.S; if (!c) return
  const buf = c._qmBuf || []; if (buf.length < 20) return
  const ww = buf.slice(-20)
  const avg = ww.reduce((a: number, v: number) => a + v, 0) / 20
  let variance = 0
  ww.forEach((v: number) => { variance += (v - avg) * (v - avg) })
  const stdDev = Math.sqrt(variance / 20)
  c._qmBbUpper = avg + 2 * stdDev
  c._qmBbLower = avg - 2 * stdDev
  c._qmBbMiddle = avg
  c._qmBbWidth = c.price > 0 ? ((c._qmBbUpper - c._qmBbLower) / c.price * 100) : 0
  c._qmBbWidthHist = c._qmBbWidthHist || []
  c._qmBbWidthHist.push(c._qmBbWidth)
  if (c._qmBbWidthHist.length > 60) c._qmBbWidthHist.shift()
  if (c._qmBbWidthHist.length >= 10) {
    const avgBW = c._qmBbWidthHist.reduce((a: number, v: number) => a + v, 0) / c._qmBbWidthHist.length
    c._qmBbSqueeze = c._qmBbWidth < avgBW * 0.6
    c._qmBbSqueezeStr = avgBW > 0 ? (1 - c._qmBbWidth / avgBW) * 100 : 0
  }
  const range = c._qmBbUpper - c._qmBbLower
  c._qmBbPos = range > 0 ? ((c.price - c._qmBbLower) / range * 100) : 50
}

export function calcSupportResistance(): void {
  const c = w.S; if (!c) return
  const kl = c.klines; if (!kl || kl.length < 15) return
  const pivots: any[] = []
  for (let i = 2; i < kl.length - 2; i++) {
    const h = kl[i].h, l = kl[i].l
    if (h > kl[i - 1].h && h > kl[i - 2].h && h > kl[i + 1].h && h > kl[i + 2].h) pivots.push({ type: 'R', price: h, idx: i })
    if (l < kl[i - 1].l && l < kl[i - 2].l && l < kl[i + 1].l && l < kl[i + 2].l) pivots.push({ type: 'S', price: l, idx: i })
  }
  const levels: any[] = []
  const threshold = c.price * 0.001
  pivots.forEach((p: any) => {
    const existing = levels.find((l: any) => Math.abs(l.price - p.price) < threshold)
    if (existing) { existing.touches++; existing.price = (existing.price + p.price) / 2 }
    else levels.push({ type: p.type, price: p.price, touches: 1 })
  })
  c._qmSrLevels = levels.sort((a: any, b: any) => b.touches - a.touches).slice(0, 6)
  const sLevels = c._qmSrLevels.filter((l: any) => l.price < c.price).sort((a: any, b: any) => b.price - a.price)
  const rLevels = c._qmSrLevels.filter((l: any) => l.price > c.price).sort((a: any, b: any) => a.price - b.price)
  c._qmNearestSupport = sLevels[0] || null
  c._qmNearestResist = rLevels[0] || null
}

export function calcFearGreed(): void {
  const c = w.S; if (!c) return
  let score = 50
  score += ((c.rsi || 50) - 50) / 2
  score += ((c._qmMfi || 50) - 50) / 4
  score += Math.max(-15, Math.min(15, (c.fr || 0) * 10000))
  score += ((c.ls || 0.5) - 0.5) * 20
  const tot = (c.obBV || 0) + (c.obAV || 0)
  if (tot > 0) score += ((c.obBV - c.obAV) / tot) * 15
  const atrPct = c.price > 0 ? ((c.atr || 0) / c.price * 100) : 0
  if (atrPct > 0.15) score -= 10
  score += (c._qmOrderFlowDelta || 0) / 10
  c._qmFearGreed = Math.max(0, Math.min(100, score))
}

export function detectDivergence(): void {
  const c = w.S; if (!c) return
  const buf = c._qmBuf || []; if (buf.length < 40) { c._qmDivergence = 'NONE'; return }
  const pOld = buf[buf.length - 20], pNew = buf[buf.length - 1]
  const pTrend = pNew > pOld ? 1 : -1
  const calcRsi = (arr: number[]) => { let g = 0, l = 0; for (let i = 1; i < arr.length; i++) { const d = arr[i] - arr[i - 1]; d > 0 ? g += d : l -= d }; const ag = g / (arr.length - 1), al = l / (arr.length - 1); return al === 0 ? 100 : 100 - (100 / (1 + ag / al)) }
  const rsiOld = calcRsi(buf.slice(-40, -20))
  const rsiNew = calcRsi(buf.slice(-20))
  const rsiTrend = rsiNew > rsiOld ? 1 : -1
  if (pTrend === 1 && rsiTrend === -1) c._qmDivergence = 'BEARISH'
  else if (pTrend === -1 && rsiTrend === 1) c._qmDivergence = 'BULLISH'
  else c._qmDivergence = 'NONE'
}

export function calcTapeSpeed(): void {
  const c = w.S; if (!c) return
  c._qmTickHist = c._qmTickHist || []
  c._qmTickHist.push({ time: Date.now(), ticks: c.ticks || 0 })
  if (c._qmTickHist.length > 60) c._qmTickHist.shift()
  if (c._qmTickHist.length >= 2) {
    const oldest = c._qmTickHist[0], newest = c._qmTickHist[c._qmTickHist.length - 1]
    const dt = (newest.time - oldest.time) / 1000
    const dTicks = newest.ticks - oldest.ticks
    c._qmTicksPerSec = dt > 0 ? (dTicks / dt) : 0
  } else c._qmTicksPerSec = 0
  c._qmTapeSpeed = c._qmTicksPerSec > 8 ? 'FAST' : c._qmTicksPerSec > 3 ? 'NORMAL' : 'SLOW'
}

export function calcMFI(): void {
  const c = w.S; if (!c) return
  const kl = c.klines; if (!kl || kl.length < 15) return
  let posFlow = 0, negFlow = 0
  for (let i = kl.length - 14; i < kl.length; i++) {
    const tp = (kl[i].h + kl[i].l + kl[i].c) / 3
    const prevTp = i > 0 ? (kl[i - 1].h + kl[i - 1].l + kl[i - 1].c) / 3 : tp
    const mf = tp * (kl[i].v || 1)
    if (tp > prevTp) posFlow += mf; else negFlow += mf
  }
  c._qmMfi = negFlow === 0 ? 100 : 100 - (100 / (1 + posFlow / negFlow))
}

// Run all intel functions
export function runIntel(): void {
  detectWhales(); trackPressure(); trackSpread(); detectAbsorption()
  calcVWAP(); calcVolPercentile(); calcRegime(); calcCascadeRisk()
  calcOrderFlowDelta(); calcBollinger(); calcSupportResistance()
  calcFearGreed(); detectDivergence(); calcTapeSpeed(); calcMFI()
}
