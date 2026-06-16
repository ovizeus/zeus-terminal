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

export interface PythiaEntry { index: number; dir: 'long' | 'short'; entry: number; target: number; stop: number }

/**
 * PYTHIA — the oracle (invented for Zeus). Marks trend-aligned ENTRIES and projects
 * how far price should travel. Trigger: a fast/slow EMA cross (fast over slow = long,
 * under = short). Target & stop are projected from volatility — entry ± ATR×multiplier
 * — so each entry carries an objective "how far the market goes" projection. Pure +
 * per-bar so historical entries render across the chart; the engine layers the LIVE
 * server brain (BM.entryScore / entryReady) and crowd sentiment on top to confirm the
 * most-recent signal.
 */
export function pythia(highs: number[], lows: number[], closes: number[], fast = 21, slow = 50, atrLen = 14, tpMult = 2.5, slMult = 1.2): PythiaEntry[] {
  const n = closes.length
  const out: PythiaEntry[] = []
  const ef = ema(closes, fast), es = ema(closes, slow), a = atr(highs, lows, closes, atrLen)
  for (let i = 1; i < n; i++) {
    if (ef[i] == null || es[i] == null || ef[i - 1] == null || es[i - 1] == null || a[i] == null) continue
    const fNow = ef[i] as number, sNow = es[i] as number, fPrev = ef[i - 1] as number, sPrev = es[i - 1] as number
    const atrI = a[i] as number, px = closes[i]
    if (fNow > sNow && fPrev <= sPrev) out.push({ index: i, dir: 'long', entry: px, target: px + atrI * tpMult, stop: px - atrI * slMult })
    else if (fNow < sNow && fPrev >= sPrev) out.push({ index: i, dir: 'short', entry: px, target: px - atrI * tpMult, stop: px + atrI * slMult })
  }
  return out
}

export interface NemesisSignal { index: number; dir: 'top' | 'bottom'; strength: number; reasons: string[] }

/**
 * NEMESIS — exhaustion & reversal (invented for Zeus). Flags where a move is
 * "spent" and prone to reverse, by stacking confirmations at a TD-style setup
 * print: (1) `setupLen` consecutive closes beyond the close 4 bars ago (momentum
 * exhaustion), confirmed by a fresh local extreme; boosted by (2) a volume climax
 * (volume > climaxMult × its average) and (3) an RSI extreme (>70 top / <30 bottom).
 * strength 1–3 = how many confirmations align. A top marker warns of a possible
 * high; a bottom marker warns of a possible low.
 */
export function nemesis(highs: number[], lows: number[], closes: number[], volumes: number[], setupLen = 9, climaxMult = 2, rsiPeriod = 14, swing = 3): NemesisSignal[] {
  const n = closes.length
  const out: NemesisSignal[] = []
  if (n < 5) return out
  const rp = Math.max(2, Math.round(rsiPeriod))
  const rsi = new Array(n).fill(NaN)
  let ag = 0, al = 0
  for (let i = 1; i < n; i++) {
    const ch = closes[i] - closes[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0)
    if (i <= rp) { ag += g; al += l; if (i === rp) { ag /= rp; al /= rp; rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al) } }
    else { ag = (ag * (rp - 1) + g) / rp; al = (al * (rp - 1) + l) / rp; rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al) }
  }
  const volAvg = sma(volumes, rp)
  const sw = Math.max(1, Math.round(swing))
  let up = 0, down = 0
  for (let i = 0; i < n; i++) {
    if (i >= 4) {
      up = closes[i] > closes[i - 4] ? up + 1 : 0
      down = closes[i] < closes[i - 4] ? down + 1 : 0
    }
    const climax = volAvg[i] != null && volumes[i] > climaxMult * (volAvg[i] as number)
    if (up === Math.round(setupLen)) {
      let isHigh = true
      for (let j = Math.max(0, i - sw); j < i; j++) if (highs[j] > highs[i]) isHigh = false
      if (isHigh) {
        const reasons = ['TD' + Math.round(setupLen)]; let st = 1
        if (climax) { st++; reasons.push('climax') }
        if (!isNaN(rsi[i]) && rsi[i] > 70) { st++; reasons.push('RSI>70') }
        out.push({ index: i, dir: 'top', strength: st, reasons })
      }
    }
    if (down === Math.round(setupLen)) {
      let isLow = true
      for (let j = Math.max(0, i - sw); j < i; j++) if (lows[j] < lows[i]) isLow = false
      if (isLow) {
        const reasons = ['TD' + Math.round(setupLen)]; let st = 1
        if (climax) { st++; reasons.push('climax') }
        if (!isNaN(rsi[i]) && rsi[i] < 30) { st++; reasons.push('RSI<30') }
        out.push({ index: i, dir: 'bottom', strength: st, reasons })
      }
    }
  }
  return out
}

export interface MSPivot { index: number; value: number; type: 'H' | 'L'; trend: 'up' | 'down' }
export interface MSBreak { index: number; dir: 'up' | 'down'; level: number }
export interface MarketStructure { pivots: MSPivot[]; breaks: MSBreak[] }

/**
 * MOIRA — market structure (invented for Zeus). Reads the SKELETON of price:
 * detects swing pivots (a bar whose high/low is the extreme over ±lookback bars),
 * connects them into a zigzag, and labels the regime — Higher-High/Higher-Low =
 * bullish structure (up), Lower-High/Lower-Low = bearish (down). A Break of
 * Structure (BOS) fires when a close pierces the last confirmed swing high/low,
 * the smart-money signal that the prevailing structure just flipped.
 */
export function marketStructure(highs: number[], lows: number[], closes: number[], lookback = 5): MarketStructure {
  const L = Math.max(1, Math.round(lookback))
  const n = closes.length
  const raw: { index: number; value: number; type: 'H' | 'L' }[] = []
  for (let i = L; i < n - L; i++) {
    let isH = true, isL = true
    for (let j = i - L; j <= i + L; j++) {
      if (j === i) continue
      if (highs[j] > highs[i]) isH = false
      if (lows[j] < lows[i]) isL = false
    }
    if (isH) raw.push({ index: i, value: highs[i], type: 'H' })
    if (isL) raw.push({ index: i, value: lows[i], type: 'L' })
  }
  raw.sort((a, b) => a.index - b.index || (a.type === 'H' ? -1 : 1))
  const pivots: MSPivot[] = []
  let lastH = NaN, lastL = NaN
  for (const pv of raw) {
    let trend: 'up' | 'down'
    if (pv.type === 'H') { trend = isNaN(lastH) ? 'up' : (pv.value > lastH ? 'up' : 'down'); lastH = pv.value }
    else { trend = isNaN(lastL) ? 'down' : (pv.value > lastL ? 'up' : 'down'); lastL = pv.value }
    pivots.push({ index: pv.index, value: pv.value, type: pv.type, trend })
  }
  // Break of Structure: a pivot is "confirmed" L bars after it forms.
  const byConfirm = raw.map((pv) => ({ ...pv, confirm: pv.index + L })).sort((a, b) => a.confirm - b.confirm)
  const breaks: MSBreak[] = []
  let confH = NaN, confL = NaN, brokeH = false, brokeL = false, k = 0
  for (let i = 0; i < n; i++) {
    while (k < byConfirm.length && byConfirm[k].confirm <= i) {
      const pv = byConfirm[k]
      if (pv.type === 'H') { confH = pv.value; brokeH = false } else { confL = pv.value; brokeL = false }
      k++
    }
    if (!isNaN(confH) && !brokeH && closes[i] > confH) { breaks.push({ index: i, dir: 'up', level: confH }); brokeH = true }
    if (!isNaN(confL) && !brokeL && closes[i] < confL) { breaks.push({ index: i, dir: 'down', level: confL }); brokeL = true }
  }
  return { pivots, breaks }
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

export interface PlutusSignal { index: number; dir: 'accumulation' | 'distribution'; effort: number; closePos: number }

/**
 * PLUTUS — the smart-money footprint (invented for Zeus). A Wyckoff "effort vs
 * result" detector: it flags bars where EFFORT (climactic volume, > volMult × its
 * average) produced little RESULT — i.e. price made a fresh local extreme yet the
 * close was absorbed back the other way. A new local LOW closed strong (closePos
 * high) = demand absorbed supply → ACCUMULATION (institutions buying the dip). A
 * new local HIGH closed weak = supply absorbed demand → DISTRIBUTION (institutions
 * selling into strength). `effort` = volume / avg, `closePos` = where in the bar's
 * range the close landed (0 = at the low, 1 = at the high).
 */
export function plutus(highs: number[], lows: number[], closes: number[], volumes: number[], lookback = 20, volMult = 1.5): PlutusSignal[] {
  const L = Math.max(2, Math.round(lookback))
  const n = closes.length
  const out: PlutusSignal[] = []
  const volAvg = sma(volumes, L)
  for (let i = L - 1; i < n; i++) {
    if (volAvg[i] == null || (volAvg[i] as number) <= 0) continue
    const effort = volumes[i] / (volAvg[i] as number)
    if (effort < volMult) continue                      // need climactic effort
    const range = highs[i] - lows[i]
    if (range <= 0) continue
    const closePos = (closes[i] - lows[i]) / range      // 0 at low, 1 at high
    let lowest = true, highest = true
    for (let j = i - L + 1; j < i; j++) {
      if (lows[j] <= lows[i]) lowest = false
      if (highs[j] >= highs[i]) highest = false
    }
    if (lowest && closePos > 0.6) out.push({ index: i, dir: 'accumulation', effort, closePos })
    else if (highest && closePos < 0.4) out.push({ index: i, dir: 'distribution', effort, closePos })
  }
  return out
}

/**
 * HELIOS — the regime oracle (invented for Zeus). A rolling Hurst exponent (via
 * rescaled-range R/S analysis on log returns) that tells you which MODE the market
 * is in: H > 0.5 = persistent / trending (a move tends to continue → trust trend
 * tools, follow), H < 0.5 = anti-persistent / mean-reverting (a move tends to snap
 * back → fade extremes), H ≈ 0.5 = random walk (no edge). It is the meta-indicator:
 * it doesn't say which way, it says whether the OTHER indicators should be trusted
 * to continue or faded. Per-bar over the last `period` bars; warm-up = null.
 */
export function helios(closes: number[], period = 30): (number | null)[] {
  const p = Math.max(4, Math.round(period))
  const n = closes.length
  const out: (number | null)[] = new Array(n).fill(null)
  const rets: number[] = new Array(n).fill(0)
  for (let i = 1; i < n; i++) {
    const a = closes[i - 1], b = closes[i]
    rets[i] = (a > 0 && b > 0) ? Math.log(b / a) : 0
  }
  const logP = Math.log(p)
  for (let i = p; i < n; i++) {
    let m = 0
    for (let j = i - p + 1; j <= i; j++) m += rets[j]
    m /= p
    let cum = 0, mn = Infinity, mx = -Infinity, varSum = 0
    for (let j = i - p + 1; j <= i; j++) {
      const d = rets[j] - m
      cum += d
      if (cum < mn) mn = cum
      if (cum > mx) mx = cum
      varSum += d * d
    }
    const R = mx - mn
    const S = Math.sqrt(varSum / p)
    if (S <= 0) { out[i] = 0.5; continue }
    const rs = R / S
    out[i] = rs <= 0 ? 0.5 : Math.max(0, Math.min(1, Math.log(rs) / logP))
  }
  return out
}

export interface FairValueGap { index: number; dir: 'bull' | 'bear'; top: number; bottom: number; filled: boolean; fillIndex: number }

/**
 * HERMES — the messenger (invented for Zeus). Detects FAIR VALUE GAPS (3-candle
 * imbalances): when price moves so fast it leaves an untraded gap, the market tends
 * to return and "fill" it — a price magnet. A BULL gap forms when candle[i-2]'s high
 * is below candle[i]'s low (zone = [high_{i-2}, low_i]); a BEAR gap when candle[i-2]'s
 * low is above candle[i]'s high (zone = [high_i, low_{i-2}]). Tiny gaps below `minPct`
 * of price are ignored as noise. Each gap is tracked as filled once a later bar trades
 * back into the zone, with the bar index where that happened (fillIndex, −1 if open).
 */
export function hermes(highs: number[], lows: number[], closes: number[], minPct = 0.05): FairValueGap[] {
  const n = closes.length
  const out: FairValueGap[] = []
  for (let i = 2; i < n; i++) {
    let dir: 'bull' | 'bear' | null = null, top = 0, bottom = 0
    if (highs[i - 2] < lows[i]) { dir = 'bull'; top = lows[i]; bottom = highs[i - 2] }
    else if (lows[i - 2] > highs[i]) { dir = 'bear'; top = lows[i - 2]; bottom = highs[i] }
    if (!dir) continue
    const ref = closes[i] || 1
    if ((top - bottom) / ref * 100 < minPct) continue   // ignore noise-sized gaps
    let fillIndex = -1
    for (let j = i + 1; j < n; j++) {
      // gap "filled" once price trades back into the zone
      if (dir === 'bull' ? lows[j] <= top : highs[j] >= bottom) { fillIndex = j; break }
    }
    out.push({ index: i, dir, top, bottom, filled: fillIndex !== -1, fillIndex })
  }
  return out
}

export interface LiquidityPool { level: number; side: 'buy' | 'sell'; index: number; hits: number; swept: boolean; sweepIndex: number }

/**
 * CHARON — the ferryman of liquidity (invented for Zeus). Stops cluster where price
 * has repeatedly turned: equal/near-equal swing HIGHS hold buy-side liquidity (BSL,
 * stops resting above), equal/near-equal swing LOWS hold sell-side liquidity (SSL,
 * stops below). Price is magnetically drawn to "sweep" these pools before reversing.
 * CHARON finds swing pivots (extreme over ±lookback), clusters those within `tolPct`,
 * keeps clusters with ≥ `minHits` touches, and marks each pool's level — flagging it
 * SWEPT once a later bar trades beyond it (the stop-hunt). The unswept pools are the
 * live magnets.
 */
export function charon(highs: number[], lows: number[], closes: number[], lookback = 5, tolPct = 0.15, minHits = 2): LiquidityPool[] {
  const L = Math.max(1, Math.round(lookback))
  const n = closes.length
  const pivH: { index: number; level: number }[] = []
  const pivL: { index: number; level: number }[] = []
  for (let i = L; i < n - L; i++) {
    let isH = true, isL = true
    for (let j = i - L; j <= i + L; j++) {
      if (j === i) continue
      if (highs[j] > highs[i]) isH = false
      if (lows[j] < lows[i]) isL = false
    }
    if (isH) pivH.push({ index: i, level: highs[i] })
    if (isL) pivL.push({ index: i, level: lows[i] })
  }
  const cluster = (pivs: { index: number; level: number }[]) => {
    const groups: { anchor: number; items: { index: number; level: number }[] }[] = []
    for (const pv of pivs) {
      let g = groups.find((gr) => Math.abs(pv.level - gr.anchor) / (gr.anchor || 1) * 100 <= tolPct)
      if (!g) { g = { anchor: pv.level, items: [] }; groups.push(g) }
      g.items.push(pv)
    }
    return groups.filter((g) => g.items.length >= Math.max(2, Math.round(minHits)))
  }
  const out: LiquidityPool[] = []
  for (const g of cluster(pivH)) {
    const level = Math.max(...g.items.map((p) => p.level))
    const idx = Math.max(...g.items.map((p) => p.index))
    let sweepIndex = -1
    for (let j = idx + 1; j < n; j++) if (highs[j] > level) { sweepIndex = j; break }
    out.push({ level, side: 'buy', index: idx, hits: g.items.length, swept: sweepIndex !== -1, sweepIndex })
  }
  for (const g of cluster(pivL)) {
    const level = Math.min(...g.items.map((p) => p.level))
    const idx = Math.max(...g.items.map((p) => p.index))
    let sweepIndex = -1
    for (let j = idx + 1; j < n; j++) if (lows[j] < level) { sweepIndex = j; break }
    out.push({ level, side: 'sell', index: idx, hits: g.items.length, swept: sweepIndex !== -1, sweepIndex })
  }
  return out
}

export interface Atlas { momentum: (number | null)[]; accel: (number | null)[] }

/**
 * ATLAS — the engine of the move (invented for Zeus). Most momentum tools read the
 * SPEED of price; ATLAS reads its ACCELERATION (the second derivative). momentum =
 * smoothed rate-of-change; accel = the bar-to-bar change in that momentum. The four
 * regimes it exposes: momentum>0 & accel>0 = uptrend GAINING power; momentum>0 &
 * accel<0 = uptrend TIRING (early-warning the rally is running out of fuel even while
 * price still rises); the mirror two for downtrends. It catches exhaustion before the
 * turn shows up in price.
 */
export function atlas(closes: number[], rocLen = 10, smooth = 5): Atlas {
  const n = closes.length
  const mom = roc(closes, rocLen)                          // raw % momentum
  const finite = mom.map((v) => (v == null ? 0 : v))
  const sm = ema(finite, smooth)                           // smoothed momentum
  const momentum: (number | null)[] = new Array(n).fill(null)
  const accel: (number | null)[] = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    if (mom[i] == null || sm[i] == null) continue           // respect ROC warm-up
    momentum[i] = sm[i]
    if (i > 0 && sm[i - 1] != null && mom[i - 1] != null) accel[i] = (sm[i] as number) - (sm[i - 1] as number)
  }
  return { momentum, accel }
}

export interface Divergence { index: number; prevIndex: number; dir: 'bull' | 'bear' }

/** Internal Wilder RSI (shared by EOS). Aligned array; warm-up = NaN. */
function _rsi(closes: number[], period: number): number[] {
  const n = closes.length, rp = Math.max(2, Math.round(period))
  const rsi = new Array(n).fill(NaN)
  let ag = 0, al = 0
  for (let i = 1; i < n; i++) {
    const ch = closes[i] - closes[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0)
    if (i <= rp) { ag += g; al += l; if (i === rp) { ag /= rp; al /= rp; rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al) } }
    else { ag = (ag * (rp - 1) + g) / rp; al = (al * (rp - 1) + l) / rp; rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al) }
  }
  return rsi
}

/**
 * EOS — first light of the turn (invented for Zeus). A regular-divergence detector:
 * when price prints a higher swing HIGH but momentum (RSI) prints a LOWER high, the
 * rally is hollow → BEARISH divergence; when price prints a lower swing LOW but RSI
 * prints a HIGHER low, selling is exhausted → BULLISH divergence. It compares the two
 * most-recent same-type swing pivots (extreme over ±lookback). Catches reversals
 * before price confirms — the earliest actionable warning.
 */
export function eos(highs: number[], lows: number[], closes: number[], lookback = 5, rsiPeriod = 14): Divergence[] {
  const L = Math.max(1, Math.round(lookback))
  const n = closes.length
  const rsi = _rsi(closes, rsiPeriod)
  const out: Divergence[] = []
  let lastHigh = -1, lastLow = -1
  for (let i = L; i < n - L; i++) {
    let isH = true, isL = true
    for (let j = i - L; j <= i + L; j++) {
      if (j === i) continue
      if (highs[j] > highs[i]) isH = false
      if (lows[j] < lows[i]) isL = false
    }
    if (isH) {
      if (lastHigh >= 0 && !isNaN(rsi[i]) && !isNaN(rsi[lastHigh]) &&
          highs[i] > highs[lastHigh] && rsi[i] < rsi[lastHigh]) {
        out.push({ index: i, prevIndex: lastHigh, dir: 'bear' })
      }
      lastHigh = i
    }
    if (isL) {
      if (lastLow >= 0 && !isNaN(rsi[i]) && !isNaN(rsi[lastLow]) &&
          lows[i] < lows[lastLow] && rsi[i] > rsi[lastLow]) {
        out.push({ index: i, prevIndex: lastLow, dir: 'bull' })
      }
      lastLow = i
    }
  }
  return out
}

export interface Pantheon { score: (number | null)[] }

/**
 * PANTHEON — the council of gods (invented for Zeus). A maximum-confluence meter that
 * FUSES the Zeus arsenal into one −1..+1 "house view": KERAUNOS conviction (adaptive
 * trend + pressure), ATLAS momentum (speed), and the ATR-normalised slope of a 20-EMA
 * (raw direction). When the gods agree the score pins toward ±1 (high-conviction
 * trend); when they disagree it hovers near 0 (no edge). One number that summarises
 * everything the other overlays are saying.
 */
export function pantheon(highs: number[], lows: number[], closes: number[], volumes: number[]): Pantheon {
  const n = closes.length
  const score: (number | null)[] = new Array(n).fill(null)
  const kera = keraunos(highs, lows, closes, volumes).conviction
  const mom = atlas(closes).momentum
  const e = ema(closes, 20)
  const a = atr(highs, lows, closes, 14)
  for (let i = 0; i < n; i++) {
    if (kera[i] == null && mom[i] == null) continue
    const c1 = (kera[i] as number) || 0                                              // conviction −1..1
    const c2 = Math.max(-1, Math.min(1, ((mom[i] as number) || 0) / 5))              // momentum % scaled
    let c3 = 0
    if (i > 0 && e[i] != null && e[i - 1] != null && a[i] != null && (a[i] as number) > 0) {
      c3 = Math.max(-1, Math.min(1, ((e[i] as number) - (e[i - 1] as number)) / (a[i] as number)))
    }
    score[i] = Math.max(-1, Math.min(1, 0.45 * c1 + 0.35 * c2 + 0.20 * c3))
  }
  return { score }
}

export interface AegisEntry { index: number; dir: 'long' | 'short'; entry: number; stop: number; score: number }

/**
 * AEGIS — Zeus's shield (invented for Zeus). The apex, maximum-confluence ENTRY
 * trigger: it fires only when the PANTHEON score crosses a strong threshold AND the
 * HELIOS regime confirms a trending (persistent) market — i.e. confluence and regime
 * agree. Each signal carries an ATR-based protective stop. Counter-regime or weak-
 * confluence moves are filtered out, so AEGIS marks far fewer — but far higher-quality
 * — entries than any single tool. The engine layers the live server brain on the most
 * recent one for final confirmation.
 */
export function aegis(highs: number[], lows: number[], closes: number[], volumes: number[], thr = 0.4, atrMult = 1.5): AegisEntry[] {
  const n = closes.length
  const out: AegisEntry[] = []
  const sc = pantheon(highs, lows, closes, volumes).score
  const H = helios(closes, 30)
  const a = atr(highs, lows, closes, 14)
  for (let i = 1; i < n; i++) {
    if (sc[i] == null) continue
    const s = sc[i] as number, sp = sc[i - 1] == null ? 0 : (sc[i - 1] as number) // null prev ⇒ treat as below threshold (first strong bar = a cross)
    const trending = H[i] == null || (H[i] as number) >= 0.5   // regime gate (allow if not yet warmed)
    const px = closes[i]
    const atrI = a[i] != null ? (a[i] as number) : px * 0.01    // fallback during ATR warm-up
    if (trending && s >= thr && sp < thr) out.push({ index: i, dir: 'long', entry: px, stop: px - atrMult * atrI, score: s })
    else if (trending && s <= -thr && sp > -thr) out.push({ index: i, dir: 'short', entry: px, stop: px + atrMult * atrI, score: s })
  }
  return out
}

export interface Selene { wave: (number | null)[]; period: number }

/**
 * SELENE — the moon that moves the tides (invented for Zeus). A dominant-cycle
 * oscillator: it detrends price (price − SMA) to isolate the rhythmic component, then
 * finds the DOMINANT CYCLE length via autocorrelation (the lag in [minP, maxP] whose
 * detrended series best repeats). The `wave` is that detrended component normalised by
 * its rolling volatility — a clean oscillator around 0: near its trough = cycle low
 * (buy zone), near its peak = cycle high (sell zone). `period` is the measured cycle
 * length in bars, so you know the market's current rhythm.
 */
export function selene(closes: number[], detrendLen = 20, minP = 8, maxP = 60): Selene {
  const n = closes.length
  const wave: (number | null)[] = new Array(n).fill(null)
  const base = sma(closes, detrendLen)
  const detr = new Array(n).fill(NaN)
  for (let i = 0; i < n; i++) if (base[i] != null) detr[i] = closes[i] - (base[i] as number)
  // dominant cycle: autocorrelation peak over candidate lags
  const idx: number[] = []
  for (let i = 0; i < n; i++) if (!isNaN(detr[i])) idx.push(i)
  let period = 0, bestAc = -Infinity
  let denom = 0
  for (const i of idx) denom += detr[i] * detr[i]
  if (idx.length > minP + 2 && denom > 0) {
    for (let lag = Math.round(minP); lag <= Math.round(maxP); lag++) {
      let num = 0, cnt = 0
      for (const i of idx) { if (i - lag >= 0 && !isNaN(detr[i - lag])) { num += detr[i] * detr[i - lag]; cnt++ } }
      if (cnt <= 10) continue
      const ac = num / denom
      if (ac > bestAc) { bestAc = ac; period = lag }
    }
  }
  // normalise detrended price by its rolling volatility → unit oscillator
  const L = Math.max(2, Math.round(detrendLen))
  for (let i = 0; i < n; i++) {
    if (isNaN(detr[i])) continue
    let s = 0, c = 0
    for (let j = Math.max(0, i - L + 1); j <= i; j++) { if (!isNaN(detr[j])) { s += detr[j] * detr[j]; c++ } }
    const sd = c ? Math.sqrt(s / c) : 0
    wave[i] = sd > 0 ? Math.max(-3, Math.min(3, detr[i] / sd)) : 0
  }
  return { wave, period }
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
