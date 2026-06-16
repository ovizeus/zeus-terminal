// [2026-06-16] Pure indicator math for the batch of new chart overlays
// (SMA, Hull MA, Keltner Channels, Donchian Channels, Parabolic SAR). Kept pure +
// dependency-free so the formulas are unit-tested in isolation; the engine
// (indicators.ts) maps these outputs to lightweight-charts {time,value} series.
// Each returns arrays aligned 1:1 with the input length; warm-up slots are `null`.

/** Simple moving average. */
export function sma(values: number[], period: number): (number | null)[] {
  const p = Math.max(1, Math.round(period))
  const out: (number | null)[] = []
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= p) sum -= values[i - p]
    out.push(i >= p - 1 ? sum / p : null)
  }
  return out
}

/** Linearly-weighted moving average (recent bars weighted more). */
export function wma(values: number[], period: number): (number | null)[] {
  const p = Math.max(1, Math.round(period))
  const denom = (p * (p + 1)) / 2
  const out: (number | null)[] = []
  for (let i = 0; i < values.length; i++) {
    if (i < p - 1) { out.push(null); continue }
    let acc = 0
    for (let j = 0; j < p; j++) acc += values[i - (p - 1) + j] * (j + 1)
    out.push(acc / denom)
  }
  return out
}

/** Hull Moving Average: WMA(2*WMA(n/2) − WMA(n), sqrt(n)). Low-lag trend MA. */
export function hma(values: number[], period: number): (number | null)[] {
  const p = Math.max(2, Math.round(period))
  const half = wma(values, Math.round(p / 2))
  const full = wma(values, p)
  const raw: number[] = []
  const idx: number[] = []
  for (let i = 0; i < values.length; i++) {
    if (half[i] == null || full[i] == null) { raw.push(NaN); continue }
    raw.push(2 * (half[i] as number) - (full[i] as number))
  }
  // WMA over the raw series, but only where raw is finite.
  const sqrtP = Math.max(1, Math.round(Math.sqrt(p)))
  const out: (number | null)[] = new Array(values.length).fill(null)
  // Build a compacted finite series + remember original indices for alignment.
  const finite: number[] = []
  for (let i = 0; i < raw.length; i++) { if (!Number.isNaN(raw[i])) { finite.push(raw[i]); idx.push(i) } }
  const hw = wma(finite, sqrtP)
  for (let k = 0; k < hw.length; k++) { if (hw[k] != null) out[idx[k]] = hw[k] }
  return out
}

/** Exponential moving average (helper for Keltner). */
export function ema(values: number[], period: number): (number | null)[] {
  const p = Math.max(1, Math.round(period))
  const k = 2 / (p + 1)
  const out: (number | null)[] = []
  let prev = NaN
  for (let i = 0; i < values.length; i++) {
    if (i === 0) { prev = values[0]; out.push(i >= p - 1 ? prev : null); continue }
    prev = values[i] * k + prev * (1 - k)
    out.push(i >= p - 1 ? prev : null)
  }
  return out
}

/** Wilder ATR (helper for Keltner). Returns aligned array; warm-up = null. */
export function atr(highs: number[], lows: number[], closes: number[], period: number): (number | null)[] {
  const p = Math.max(1, Math.round(period))
  const n = closes.length
  const tr: number[] = []
  for (let i = 0; i < n; i++) {
    if (i === 0) { tr.push(highs[i] - lows[i]); continue }
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])))
  }
  const out: (number | null)[] = new Array(n).fill(null)
  let prev = NaN
  for (let i = 0; i < n; i++) {
    if (i < p - 1) continue
    if (i === p - 1) { let s = 0; for (let j = 0; j <= i; j++) s += tr[j]; prev = s / p; out[i] = prev; continue }
    prev = (prev * (p - 1) + tr[i]) / p
    out[i] = prev
  }
  return out
}

export interface Bands { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] }

/** Keltner Channels: middle = EMA(close, period); band = mult × ATR(period). */
export function keltner(highs: number[], lows: number[], closes: number[], period: number, mult: number): Bands {
  const mid = ema(closes, period)
  const a = atr(highs, lows, closes, period)
  const upper: (number | null)[] = [], lower: (number | null)[] = []
  for (let i = 0; i < closes.length; i++) {
    if (mid[i] == null || a[i] == null) { upper.push(null); lower.push(null); continue }
    upper.push((mid[i] as number) + mult * (a[i] as number))
    lower.push((mid[i] as number) - mult * (a[i] as number))
  }
  return { upper, middle: mid, lower }
}

/** Donchian Channels: upper = highest high over N, lower = lowest low over N, mid = avg. */
export function donchian(highs: number[], lows: number[], period: number): Bands {
  const p = Math.max(1, Math.round(period))
  const n = highs.length
  const upper: (number | null)[] = [], lower: (number | null)[] = [], middle: (number | null)[] = []
  for (let i = 0; i < n; i++) {
    if (i < p - 1) { upper.push(null); lower.push(null); middle.push(null); continue }
    let hi = -Infinity, lo = Infinity
    for (let j = i - p + 1; j <= i; j++) { if (highs[j] > hi) hi = highs[j]; if (lows[j] < lo) lo = lows[j] }
    upper.push(hi); lower.push(lo); middle.push((hi + lo) / 2)
  }
  return { upper, middle, lower }
}

export interface Aether {
  mid: (number | null)[]       // basis (SMA) midline
  upper: (number | null)[]     // active envelope (tight BB during squeeze, wide KC otherwise)
  lower: (number | null)[]
  squeeze: boolean[]           // true = volatility compressed → breakout charging
  momentum: (number | null)[]  // −1..1 likely breakout direction
}

/**
 * AETHER — the calm before the storm (invented for Zeus). A volatility-regime
 * overlay that catches the "squeeze": when Bollinger Bands contract INSIDE the
 * Keltner Channel, volatility is compressed and energy is building for a breakout.
 * During a squeeze the envelope drawn is the (tighter) Bollinger band — so the
 * band visibly TIGHTENS and is tinted gold ("charging"); otherwise it shows the
 * wider Keltner channel. A TTM-style momentum (close vs the mid of the Donchian
 * midpoint and the SMA, normalised by ATR) hints at the likely break direction.
 */
export function aether(highs: number[], lows: number[], closes: number[], period = 20, bbMult = 2, kcMult = 1.5): Aether {
  const p = Math.max(2, Math.round(period))
  const n = closes.length
  const mid: (number | null)[] = new Array(n).fill(null)
  const upper: (number | null)[] = new Array(n).fill(null)
  const lower: (number | null)[] = new Array(n).fill(null)
  const squeeze: boolean[] = new Array(n).fill(false)
  const momentum: (number | null)[] = new Array(n).fill(null)
  const basis = sma(closes, p)
  const a = atr(highs, lows, closes, p)
  for (let i = p - 1; i < n; i++) {
    const b = basis[i] as number
    let s = 0
    for (let j = i - p + 1; j <= i; j++) { const d = closes[j] - b; s += d * d }
    const sd = Math.sqrt(s / p)
    const bbU = b + bbMult * sd, bbL = b - bbMult * sd
    const atrI = (a[i] as number) || 0
    const kcU = b + kcMult * atrI, kcL = b - kcMult * atrI
    const sq = bbU < kcU && bbL > kcL
    squeeze[i] = sq
    mid[i] = b
    upper[i] = sq ? bbU : kcU
    lower[i] = sq ? bbL : kcL
    let hh = -Infinity, ll = Infinity
    for (let j = i - p + 1; j <= i; j++) { if (highs[j] > hh) hh = highs[j]; if (lows[j] < ll) ll = lows[j] }
    const ref = ((hh + ll) / 2 + b) / 2
    momentum[i] = atrI === 0 ? 0 : Math.max(-1, Math.min(1, (closes[i] - ref) / (atrI * 2)))
  }
  return { mid, upper, lower, squeeze, momentum }
}

export interface Keraunos {
  baseline: (number | null)[]   // adaptive (KAMA-style) trend line
  conviction: (number | null)[] // −1..1 blended market conviction
  upper: (number | null)[]      // baseline + mult×ATR (stretch band)
  lower: (number | null)[]
}

/**
 * KERAUNOS — Zeus's thunderbolt. An original composite overlay (invented for Zeus).
 * Reads the market in one line: an ADAPTIVE baseline that speeds up in trends and
 * slows in chop (Kaufman efficiency), tinted by a CONVICTION score that blends
 * trend-slope, intrabar buy/sell pressure and short momentum (all normalised by
 * volatility) and amplified by volume. Gray ≈ no edge (chop) → stay out; bright
 * green/red ≈ high-conviction trend. The ATR band shows when price is stretched.
 *
 * conviction = clamp( 0.5·slopeN + 0.3·pressure + 0.2·momN , −1, 1 ) · volAmp
 *   slopeN   = (baseline_i − baseline_{i-1}) / ATR_i           (trend direction & pace)
 *   pressure = (close − mid) / (high − low)                    (who won the bar; −1..1)
 *   momN     = (close_i − close_{i-3}) / (3·ATR_i)             (short momentum)
 *   volAmp   = clamp(volume_i / SMA(volume), 0.6, 1.4)         (conviction needs fuel)
 */
export function keraunos(highs: number[], lows: number[], closes: number[], volumes: number[], erPeriod = 10, atrPeriod = 14, bandMult = 1.6): Keraunos {
  const n = closes.length
  const baseline: (number | null)[] = new Array(n).fill(null)
  const conviction: (number | null)[] = new Array(n).fill(null)
  const upper: (number | null)[] = new Array(n).fill(null)
  const lower: (number | null)[] = new Array(n).fill(null)
  if (!n) return { baseline, conviction, upper, lower }
  const er = Math.max(2, Math.round(erPeriod))
  const a = atr(highs, lows, closes, atrPeriod)
  const volAvg = sma(volumes, Math.max(2, Math.round(erPeriod)))
  const fast = 2 / (2 + 1), slow = 2 / (30 + 1)
  let kama = closes[0]
  let seeded = false
  for (let i = 0; i < n; i++) {
    if (i < er) { kama = closes[i]; continue } // warm-up: track price
    // Kaufman efficiency ratio over the last `er` bars
    const change = Math.abs(closes[i] - closes[i - er])
    let vol = 0
    for (let j = i - er + 1; j <= i; j++) vol += Math.abs(closes[j] - closes[j - 1])
    const ratio = vol === 0 ? 0 : change / vol
    const sc = Math.pow(ratio * (fast - slow) + slow, 2)
    if (!seeded) { kama = closes[i - 1]; seeded = true }
    const prev = kama
    kama = prev + sc * (closes[i] - prev)
    baseline[i] = kama
    const atrI = (a[i] as number) || 1e-9
    const slopeN = Math.max(-1, Math.min(1, (kama - prev) / atrI))
    const range = highs[i] - lows[i]
    const mid = (highs[i] + lows[i]) / 2
    const pressure = range === 0 ? 0 : Math.max(-1, Math.min(1, (closes[i] - mid) / (range / 2)))
    const momN = i >= 3 ? Math.max(-1, Math.min(1, (closes[i] - closes[i - 3]) / (3 * atrI))) : 0
    let c = 0.5 * slopeN + 0.3 * pressure + 0.2 * momN
    const va = (volAvg[i] != null && (volAvg[i] as number) > 0) ? Math.max(0.6, Math.min(1.4, volumes[i] / (volAvg[i] as number))) : 1
    c = Math.max(-1, Math.min(1, c * va))
    conviction[i] = c
    upper[i] = kama + bandMult * (a[i] as number ?? 0)
    lower[i] = kama - bandMult * (a[i] as number ?? 0)
  }
  return { baseline, conviction, upper, lower }
}

/** Volume-Weighted Moving Average: Σ(close×vol) / Σ(vol) over period. */
export function vwma(closes: number[], volumes: number[], period: number): (number | null)[] {
  const p = Math.max(1, Math.round(period))
  const n = closes.length
  const out: (number | null)[] = new Array(n).fill(null)
  for (let i = p - 1; i < n; i++) {
    let pv = 0, v = 0
    for (let j = i - p + 1; j <= i; j++) { pv += closes[j] * volumes[j]; v += volumes[j] }
    out[i] = v === 0 ? null : pv / v
  }
  return out
}

export interface Aroon { up: (number | null)[]; down: (number | null)[] }

/** Aroon Up/Down (0–100): how recently the period high/low occurred. */
export function aroon(highs: number[], lows: number[], period: number): Aroon {
  const p = Math.max(1, Math.round(period))
  const n = highs.length
  const up: (number | null)[] = new Array(n).fill(null)
  const down: (number | null)[] = new Array(n).fill(null)
  for (let i = p; i < n; i++) {
    let hh = -Infinity, ll = Infinity, hIdx = i, lIdx = i
    for (let j = i - p; j <= i; j++) { // window of p+1 bars
      if (highs[j] >= hh) { hh = highs[j]; hIdx = j }
      if (lows[j] <= ll) { ll = lows[j]; lIdx = j }
    }
    up[i] = 100 * (p - (i - hIdx)) / p
    down[i] = 100 * (p - (i - lIdx)) / p
  }
  return { up, down }
}

function _emaFull(values: number[], period: number): number[] {
  const k = 2 / (Math.max(1, Math.round(period)) + 1)
  const out: number[] = []
  let prev = values.length ? values[0] : 0
  for (let i = 0; i < values.length; i++) { prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k); out.push(prev) }
  return out
}

/** TRIX: 1-bar % rate-of-change of a triple-smoothed EMA. Momentum oscillator. */
export function trix(closes: number[], period: number): (number | null)[] {
  const p = Math.max(1, Math.round(period))
  const n = closes.length
  const out: (number | null)[] = new Array(n).fill(null)
  if (!n) return out
  const e3 = _emaFull(_emaFull(_emaFull(closes, p), p), p)
  for (let i = 1; i < n; i++) { const prev = e3[i - 1]; out[i] = prev === 0 ? 0 : 100 * (e3[i] - prev) / prev }
  const warm = Math.min(n, 3 * (p - 1) + 1)
  for (let i = 0; i < warm; i++) out[i] = null
  return out
}

/** Ultimate Oscillator (0–100): weighted buying-pressure over 3 timeframes. */
export function ultimateOscillator(highs: number[], lows: number[], closes: number[], p1 = 7, p2 = 14, p3 = 28): (number | null)[] {
  const n = closes.length
  const out: (number | null)[] = new Array(n).fill(null)
  const bp: number[] = new Array(n).fill(0), tr: number[] = new Array(n).fill(0)
  for (let i = 1; i < n; i++) {
    const minLC = Math.min(lows[i], closes[i - 1]), maxHC = Math.max(highs[i], closes[i - 1])
    bp[i] = closes[i] - minLC; tr[i] = maxHC - minLC
  }
  const sum = (arr: number[], i: number, len: number) => { let s = 0; for (let j = i - len + 1; j <= i; j++) s += arr[j]; return s }
  for (let i = p3; i < n; i++) {
    const t1 = sum(tr, i, p1), t2 = sum(tr, i, p2), t3 = sum(tr, i, p3)
    const a1 = t1 === 0 ? 0 : sum(bp, i, p1) / t1
    const a2 = t2 === 0 ? 0 : sum(bp, i, p2) / t2
    const a3 = t3 === 0 ? 0 : sum(bp, i, p3) / t3
    out[i] = 100 * (4 * a1 + 2 * a2 + a3) / 7
  }
  return out
}

/** Choppiness Index (0–100): >61 ranging/choppy, <38 strong trend. */
export function choppiness(highs: number[], lows: number[], closes: number[], period = 14): (number | null)[] {
  const p = Math.max(2, Math.round(period))
  const n = closes.length
  const out: (number | null)[] = new Array(n).fill(null)
  const tr: number[] = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    tr[i] = i === 0 ? highs[i] - lows[i] : Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]))
  }
  const logP = Math.log10(p)
  for (let i = p - 1; i < n; i++) {
    let sumTR = 0, hh = -Infinity, ll = Infinity
    for (let j = i - p + 1; j <= i; j++) { sumTR += tr[j]; if (highs[j] > hh) hh = highs[j]; if (lows[j] < ll) ll = lows[j] }
    const range = hh - ll
    out[i] = range <= 0 ? 50 : 100 * Math.log10(sumTR / range) / logP
  }
  return out
}

export interface DMI { adx: (number | null)[]; plusDI: (number | null)[]; minusDI: (number | null)[] }

/** Wilder ADX with +DI/−DI. Trend-strength oscillator (0–100). */
export function adx(highs: number[], lows: number[], closes: number[], period: number): DMI {
  const p = Math.max(1, Math.round(period))
  const n = closes.length
  const plusDI: (number | null)[] = new Array(n).fill(null)
  const minusDI: (number | null)[] = new Array(n).fill(null)
  const adxArr: (number | null)[] = new Array(n).fill(null)
  if (n < 2) return { adx: adxArr, plusDI, minusDI }
  const tr: number[] = [], pDM: number[] = [], mDM: number[] = [] // index j ↔ bar j+1
  for (let i = 1; i < n; i++) {
    const up = highs[i] - highs[i - 1]
    const dn = lows[i - 1] - lows[i]
    pDM.push(up > dn && up > 0 ? up : 0)
    mDM.push(dn > up && dn > 0 ? dn : 0)
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])))
  }
  let sTR = 0, sP = 0, sM = 0
  const dx: number[] = [], dxBar: number[] = []
  for (let j = 0; j < tr.length; j++) {
    const bar = j + 1
    if (j < p - 1) { sTR += tr[j]; sP += pDM[j]; sM += mDM[j]; continue }
    if (j === p - 1) { sTR += tr[j]; sP += pDM[j]; sM += mDM[j] }
    else { sTR = sTR - sTR / p + tr[j]; sP = sP - sP / p + pDM[j]; sM = sM - sM / p + mDM[j] }
    const pdi = sTR === 0 ? 0 : 100 * sP / sTR
    const mdi = sTR === 0 ? 0 : 100 * sM / sTR
    plusDI[bar] = pdi; minusDI[bar] = mdi
    const sum = pdi + mdi
    dx.push(sum === 0 ? 0 : 100 * Math.abs(pdi - mdi) / sum); dxBar.push(bar)
  }
  let av = 0
  for (let i = 0; i < dx.length; i++) {
    if (i < p - 1) { av += dx[i]; continue }
    if (i === p - 1) { av += dx[i]; av /= p; adxArr[dxBar[i]] = av }
    else { av = (av * (p - 1) + dx[i]) / p; adxArr[dxBar[i]] = av }
  }
  return { adx: adxArr, plusDI, minusDI }
}

/** Williams %R: −100 × (highestHigh − close) / (highestHigh − lowestLow). Range −100..0. */
export function williamsR(highs: number[], lows: number[], closes: number[], period: number): (number | null)[] {
  const p = Math.max(1, Math.round(period))
  const n = closes.length
  const out: (number | null)[] = new Array(n).fill(null)
  for (let i = p - 1; i < n; i++) {
    let hh = -Infinity, ll = Infinity
    for (let j = i - p + 1; j <= i; j++) { if (highs[j] > hh) hh = highs[j]; if (lows[j] < ll) ll = lows[j] }
    out[i] = hh === ll ? -50 : -100 * (hh - closes[i]) / (hh - ll)
  }
  return out
}

/** Rate of Change: 100 × (value − value[period bars ago]) / value[period bars ago]. */
export function roc(values: number[], period: number): (number | null)[] {
  const p = Math.max(1, Math.round(period))
  const n = values.length
  const out: (number | null)[] = new Array(n).fill(null)
  for (let i = p; i < n; i++) { const prev = values[i - p]; out[i] = prev === 0 ? 0 : 100 * (values[i] - prev) / prev }
  return out
}

/** Chaikin Money Flow: Σ MoneyFlowVolume / Σ volume over period. Range ≈ −1..1. */
export function cmf(highs: number[], lows: number[], closes: number[], volumes: number[], period: number): (number | null)[] {
  const p = Math.max(1, Math.round(period))
  const n = closes.length
  const out: (number | null)[] = new Array(n).fill(null)
  const mfv: number[] = []
  for (let i = 0; i < n; i++) {
    const range = highs[i] - lows[i]
    const mult = range === 0 ? 0 : ((closes[i] - lows[i]) - (highs[i] - closes[i])) / range
    mfv.push(mult * volumes[i])
  }
  for (let i = p - 1; i < n; i++) {
    let fv = 0, v = 0
    for (let j = i - p + 1; j <= i; j++) { fv += mfv[j]; v += volumes[j] }
    out[i] = v === 0 ? 0 : fv / v
  }
  return out
}

/** Awesome Oscillator: SMA(medianPrice, fast) − SMA(medianPrice, slow), median = (H+L)/2. */
export function awesomeOscillator(highs: number[], lows: number[], fast = 5, slow = 34): (number | null)[] {
  const med = highs.map((h, i) => (h + lows[i]) / 2)
  const f = sma(med, fast), s = sma(med, slow)
  return med.map((_, i) => (f[i] == null || s[i] == null) ? null : (f[i] as number) - (s[i] as number))
}

/** Parabolic SAR (Wilder). Returns the SAR value per bar + isUp (trend) flag. */
export function parabolicSAR(highs: number[], lows: number[], step = 0.02, maxAf = 0.2): { sar: (number | null)[]; isUp: boolean[] } {
  const n = highs.length
  const sar: (number | null)[] = new Array(n).fill(null)
  const isUp: boolean[] = new Array(n).fill(true)
  if (n < 2) return { sar, isUp }
  let up = highs[1] >= highs[0]
  let af = step
  let ep = up ? highs[0] : lows[0]
  let sarVal = up ? lows[0] : highs[0]
  for (let i = 1; i < n; i++) {
    sarVal = sarVal + af * (ep - sarVal)
    if (up) {
      // SAR can't be above the prior two lows
      sarVal = Math.min(sarVal, lows[i - 1], i >= 2 ? lows[i - 2] : lows[i - 1])
      if (highs[i] > ep) { ep = highs[i]; af = Math.min(af + step, maxAf) }
      if (lows[i] < sarVal) { up = false; sarVal = ep; ep = lows[i]; af = step } // flip down
    } else {
      sarVal = Math.max(sarVal, highs[i - 1], i >= 2 ? highs[i - 2] : highs[i - 1])
      if (lows[i] < ep) { ep = lows[i]; af = Math.min(af + step, maxAf) }
      if (highs[i] > sarVal) { up = true; sarVal = ep; ep = highs[i]; af = step } // flip up
    }
    sar[i] = sarVal
    isUp[i] = up
  }
  return { sar, isUp }
}
