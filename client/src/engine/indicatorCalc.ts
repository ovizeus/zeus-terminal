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

export interface DolosSwing { index: number; value: number; type: 'H' | 'L' }
// Fractal pivots: bar i is a swing High if its high is the strict max over [i-L, i+L]
// (symmetric, edges excluded), a swing Low if its low is the strict min. Sorted by index.
export function _dolosSwings(highs: number[], lows: number[], L: number): DolosSwing[] {
  const out: DolosSwing[] = []
  const n = highs.length
  for (let i = L; i < n - L; i++) {
    let isH = true, isL = true
    for (let j = i - L; j <= i + L; j++) {
      if (j === i) continue
      if (highs[j] > highs[i]) isH = false
      if (lows[j] < lows[i]) isL = false
    }
    if (isH) out.push({ index: i, value: highs[i], type: 'H' })
    if (isL) out.push({ index: i, value: lows[i], type: 'L' })
  }
  return out.sort((a, b) => a.index - b.index)
}

export interface DolosZone { index: number; top: number; bottom: number }
export interface DolosPoint { index: number; level: number }
export interface Dolos {
  bias: 'bear' | 'bull' | null
  bos: DolosPoint | null
  sweep: DolosPoint | null
  mss: DolosPoint | null
  ob: DolosZone | null
  bb: DolosZone | null
  target: { level: number } | null
}

// DOLOS — Smart-Money-Concepts "liquidity trap". Returns the most-recent setup: a swing high (bear)
// or low (bull) gets swept (wick past + close back), then structure shifts (MSS) the other way; the
// order block is the last opposite candle before the shift, the breaker is the prior swing zone, the
// target is the opposing liquidity. Pure & deterministic; all-null when no clean setup exists.
export function dolos(highs: number[], lows: number[], opens: number[], closes: number[], lookback = 5): Dolos {
  const NULL: Dolos = { bias: null, bos: null, sweep: null, mss: null, ob: null, bb: null, target: null }
  const n = closes.length
  const Lk = Math.max(2, Math.round(lookback))
  if (n < Lk * 2 + 5) return NULL
  const sw = _dolosSwings(highs, lows, Lk)
  const swH = sw.filter((s) => s.type === 'H'), swL = sw.filter((s) => s.type === 'L')
  if (swH.length < 1 || swL.length < 1) return NULL

  // ── BEAR: a swing high swept (wick above + close back below), then MSS down ──
  for (let hi = swH.length - 1; hi >= 0; hi--) {
    const Hp = swH[hi]
    let sweep: DolosPoint | null = null
    for (let i = Hp.index + 1; i < n; i++) { if (highs[i] > Hp.value && closes[i] < Hp.value) { sweep = { index: i, level: Hp.value }; break } }
    if (!sweep) continue
    const priorLow = [...swL].reverse().find((s) => s.index < sweep!.index)
    if (!priorLow) continue
    let mss: DolosPoint | null = null
    for (let i = sweep.index + 1; i < n; i++) { if (closes[i] < priorLow.value) { mss = { index: i, level: priorLow.value }; break } }
    if (!mss) continue
    let ob: DolosZone | null = null
    for (let i = mss.index; i >= Math.max(0, sweep.index - 2); i--) { if (closes[i] > opens[i]) { ob = { index: i, top: Math.max(highs[i], closes[i]), bottom: Math.min(opens[i], lows[i]) }; break } }
    const prevH = [...swH].reverse().find((s) => s.index < Hp.index)
    const bb: DolosZone | null = prevH ? { index: prevH.index, top: prevH.value, bottom: Math.min(...lows.slice(Math.max(0, prevH.index - Lk), prevH.index + 1)) } : null
    const tgt = [...swL].reverse().find((s) => s.value < mss!.level) || swL[0]
    return { bias: 'bear', bos: { index: Hp.index, level: Hp.value }, sweep, mss, ob, bb, target: tgt ? { level: tgt.value } : null }
  }

  // ── BULL: a swing low swept (wick below + close back above), then MSS up ──
  for (let li = swL.length - 1; li >= 0; li--) {
    const Lp = swL[li]
    let sweep: DolosPoint | null = null
    for (let i = Lp.index + 1; i < n; i++) { if (lows[i] < Lp.value && closes[i] > Lp.value) { sweep = { index: i, level: Lp.value }; break } }
    if (!sweep) continue
    const priorHigh = [...swH].reverse().find((s) => s.index < sweep!.index)
    if (!priorHigh) continue
    let mss: DolosPoint | null = null
    for (let i = sweep.index + 1; i < n; i++) { if (closes[i] > priorHigh.value) { mss = { index: i, level: priorHigh.value }; break } }
    if (!mss) continue
    let ob: DolosZone | null = null
    for (let i = mss.index; i >= Math.max(0, sweep.index - 2); i--) { if (closes[i] < opens[i]) { ob = { index: i, top: Math.max(opens[i], highs[i]), bottom: Math.min(lows[i], closes[i]) }; break } }
    const prevL = [...swL].reverse().find((s) => s.index < Lp.index)
    const bb: DolosZone | null = prevL ? { index: prevL.index, top: Math.max(...highs.slice(Math.max(0, prevL.index - Lk), prevL.index + 1)), bottom: prevL.value } : null
    const tgt = [...swH].reverse().find((s) => s.value > mss!.level) || swH[swH.length - 1]
    return { bias: 'bull', bos: { index: Lp.index, level: Lp.value }, sweep, mss, ob, bb, target: tgt ? { level: tgt.value } : null }
  }

  return NULL
}

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

export interface KratosTrade {
  entryIndex: number; dir: 'long' | 'short'; entry: number; sl: number; tp: number
  exitIndex: number; exitPrice: number; exitReason: 'tp' | 'sl' | 'flip' | 'open'; pnlPct: number
}

/**
 * KRATOS — the all-in-one trade commander (invented for Zeus). A complete signal
 * SYSTEM, not just an indicator: it opens a position when the PANTHEON max-confluence
 * score crosses ±thr in a HELIOS-confirmed trending regime, sets an ATR stop and a
 * risk-reward target (tp = entry ± atrMult·rr·ATR, sl = entry ∓ atrMult·ATR), then
 * manages the trade bar-by-bar — closing on TP, SL, or a confluence FLIP — recording
 * the exit and realised P&L. Only one position at a time. The last element may be an
 * OPEN trade (exitReason 'open'), which the live HUD turns into a real-time trade
 * ticket (entry / TP / SL / running P&L). The engine confirms the open trade with the
 * server brain.
 */
export function kratos(highs: number[], lows: number[], closes: number[], volumes: number[], thr = 0.35, atrMult = 1.5, rr = 2): KratosTrade[] {
  const n = closes.length
  const out: KratosTrade[] = []
  const sc = pantheon(highs, lows, closes, volumes).score
  const H = helios(closes, 30)
  const a = atr(highs, lows, closes, 14)
  const pnl = (dir: 'long' | 'short', entry: number, exit: number) => (dir === 'long' ? (exit - entry) : (entry - exit)) / entry * 100
  let open: KratosTrade | null = null
  for (let i = 1; i < n; i++) {
    if (sc[i] == null) continue
    const s = sc[i] as number, sp = sc[i - 1] == null ? 0 : (sc[i - 1] as number)
    const trending = H[i] == null || (H[i] as number) >= 0.5
    const px = closes[i]
    const atrI = a[i] != null ? (a[i] as number) : px * 0.01
    // ── manage an open position ──
    if (open) {
      if (open.dir === 'long') {
        if (lows[i] <= open.sl) { open.exitIndex = i; open.exitPrice = open.sl; open.exitReason = 'sl'; open.pnlPct = pnl('long', open.entry, open.sl); out.push(open); open = null }
        else if (highs[i] >= open.tp) { open.exitIndex = i; open.exitPrice = open.tp; open.exitReason = 'tp'; open.pnlPct = pnl('long', open.entry, open.tp); out.push(open); open = null }
        else if (s <= -thr && sp > -thr) { open.exitIndex = i; open.exitPrice = px; open.exitReason = 'flip'; open.pnlPct = pnl('long', open.entry, px); out.push(open); open = null }
      } else {
        if (highs[i] >= open.sl) { open.exitIndex = i; open.exitPrice = open.sl; open.exitReason = 'sl'; open.pnlPct = pnl('short', open.entry, open.sl); out.push(open); open = null }
        else if (lows[i] <= open.tp) { open.exitIndex = i; open.exitPrice = open.tp; open.exitReason = 'tp'; open.pnlPct = pnl('short', open.entry, open.tp); out.push(open); open = null }
        else if (s >= thr && sp < thr) { open.exitIndex = i; open.exitPrice = px; open.exitReason = 'flip'; open.pnlPct = pnl('short', open.entry, px); out.push(open); open = null }
      }
    }
    // ── open a new position (fresh confluence cross in a trending regime) ──
    if (!open && trending) {
      if (s >= thr && sp < thr) open = { entryIndex: i, dir: 'long', entry: px, sl: px - atrMult * atrI, tp: px + atrMult * rr * atrI, exitIndex: -1, exitPrice: 0, exitReason: 'open', pnlPct: 0 }
      else if (s <= -thr && sp > -thr) open = { entryIndex: i, dir: 'short', entry: px, sl: px + atrMult * atrI, tp: px - atrMult * rr * atrI, exitIndex: -1, exitPrice: 0, exitReason: 'open', pnlPct: 0 }
    }
  }
  if (open) { const last = n - 1; open.exitIndex = last; open.exitPrice = closes[last]; open.exitReason = 'open'; open.pnlPct = pnl(open.dir, open.entry, closes[last]); out.push(open) }
  return out
}

export interface Cone { steps: number; center: number[]; up1: number[]; lo1: number[]; up2: number[]; lo2: number[] }

/**
 * PROMETHEUS — foresight (invented for Zeus). A forward VOLATILITY CONE: from the last
 * price it projects the probable price envelope `horizon` bars into the future, the
 * band widening with √time like a diffusion process (σ_k = ATR·√k). The ±1σ band is
 * the likely range, ±2σ the outer bound; the cone centre drifts along the current
 * trend (recent per-bar slope) when `useDrift`. It answers "where is price likely to
 * be, and how wide is the uncertainty?" — a statistical forecast, not a signal.
 * Returns arrays of length horizon+1; index 0 = now (the last close).
 */
export function prometheus(highs: number[], lows: number[], closes: number[], atrLen = 14, horizon = 12, useDrift = true): Cone {
  const n = closes.length
  const center: number[] = [], up1: number[] = [], lo1: number[] = [], up2: number[] = [], lo2: number[] = []
  if (!n) return { steps: 0, center, up1, lo1, up2, lo2 }
  const last = closes[n - 1]
  const a = atr(highs, lows, closes, atrLen)
  const atrV = (a[n - 1] != null ? (a[n - 1] as number) : last * 0.01) || last * 0.01
  const drift = useDrift ? (closes[n - 1] - closes[Math.max(0, n - 1 - atrLen)]) / atrLen : 0
  for (let k = 0; k <= Math.round(horizon); k++) {
    const c = last + drift * k, w = atrV * Math.sqrt(k)
    center.push(c); up1.push(c + w); lo1.push(c - w); up2.push(c + 2 * w); lo2.push(c - 2 * w)
  }
  return { steps: Math.round(horizon), center, up1, lo1, up2, lo2 }
}

export interface Analog { matchIndex: number; similarity: number; projection: number[] }

/**
 * MNEMOSYNE — memory (invented for Zeus). Analog / nearest-neighbour forecasting: it
 * z-normalises the last `queryLen` bars into a shape, scans ALL prior history for the
 * window whose shape is closest (smallest squared distance), then projects what
 * happened AFTER that historical match — rebased onto the current price via relative
 * returns — as a "if history rhymes, here's the path" forecast for the next `horizon`
 * bars. `similarity` (0..1) grades how good the analog is. Returns projection of length
 * horizon+1 (index 0 = now); matchIndex = −1 / empty projection if no usable analog.
 */
export function mnemosyne(closes: number[], queryLen = 20, horizon = 12, minGap = 5): Analog {
  const n = closes.length
  const Q = Math.max(4, Math.round(queryLen)), H = Math.max(1, Math.round(horizon))
  if (n < Q + H + Q) return { matchIndex: -1, similarity: 0, projection: [] }
  const znorm = (arr: number[]) => {
    let m = 0; for (const v of arr) m += v; m /= arr.length
    let s = 0; for (const v of arr) s += (v - m) * (v - m); s = Math.sqrt(s / arr.length) || 1
    return arr.map((v) => (v - m) / s)
  }
  const query = znorm(closes.slice(n - Q))
  let best = Infinity, matchIndex = -1
  // candidate window END index e; needs H bars of continuation after e, and must not
  // overlap the query region (e < n - Q - minGap).
  for (let e = Q - 1; e <= n - 1 - H; e++) {
    if (e >= n - Q - Math.max(0, Math.round(minGap))) break
    const win = znorm(closes.slice(e - Q + 1, e + 1))
    let dist = 0
    for (let j = 0; j < Q; j++) { const d = query[j] - win[j]; dist += d * d }
    if (dist < best) { best = dist; matchIndex = e }
  }
  if (matchIndex < 0) return { matchIndex: -1, similarity: 0, projection: [] }
  const last = closes[n - 1], anchor = closes[matchIndex]
  const projection: number[] = [last]
  for (let k = 1; k <= H; k++) projection.push(anchor > 0 ? last * (closes[matchIndex + k] / anchor) : last)
  const similarity = 1 / (1 + best / Q)   // 0..1, 1 = identical shape
  return { matchIndex, similarity, projection }
}

export interface Themis { z: (number | null)[]; equilibrium: (number | null)[] }

/**
 * THEMIS — equilibrium & balance (invented for Zeus). Fits a least-squares LINEAR
 * REGRESSION over the last `period` bars (the market's "fair value" line) and measures
 * how far the current price is stretched from it, in standard deviations of the
 * residual (a z-score). |z| ≈ 0 → price sits on fair value; |z| ≥ 2 → a stretched
 * rubber band, statistically prone to snap back toward equilibrium. Unlike Bollinger
 * (flat SMA basis) the basis here is the sloped regression, so it stays centred in a
 * trend and only flags genuine over-extension. Returns the z oscillator + the
 * equilibrium price line.
 */
export function themis(closes: number[], period = 50): Themis {
  const n = closes.length, p = Math.max(4, Math.round(period))
  const z: (number | null)[] = new Array(n).fill(null)
  const equilibrium: (number | null)[] = new Array(n).fill(null)
  for (let i = p - 1; i < n; i++) {
    // regress y=close on x=0..p-1 over the window ending at i
    let sx = 0, sy = 0, sxx = 0, sxy = 0
    for (let t = 0; t < p; t++) { const y = closes[i - p + 1 + t]; sx += t; sy += y; sxx += t * t; sxy += t * y }
    const denom = p * sxx - sx * sx
    const slope = denom === 0 ? 0 : (p * sxy - sx * sy) / denom
    const intercept = (sy - slope * sx) / p
    // residual stdev over the window
    let ss = 0
    for (let t = 0; t < p; t++) { const fit = intercept + slope * t; const r = closes[i - p + 1 + t] - fit; ss += r * r }
    const sd = Math.sqrt(ss / p) || 1e-9
    const eqEnd = intercept + slope * (p - 1)  // regression value at the latest bar
    equilibrium[i] = eqEnd
    z[i] = (closes[i] - eqEnd) / sd
  }
  return { z, equilibrium }
}

/**
 * EREBUS — primordial chaos (invented for Zeus). A market-COMPLEXITY meter via
 * PERMUTATION ENTROPY (Bandt–Pompe): it looks at the ordinal SHAPE of every length-`dim`
 * run of bars (which of the values is smallest/largest), counts how varied those shapes
 * are over the window, and returns Shannon entropy normalised to 0..1. Near 0 = highly
 * ordered / predictable (a clean directional move → trade it); near 1 = maximally
 * disordered / random (noise → stand aside). It measures unpredictability itself —
 * orthogonal to HELIOS (which measures trend persistence).
 */
export function erebus(closes: number[], period = 60, dim = 3): (number | null)[] {
  const n = closes.length
  const m = Math.max(2, Math.min(5, Math.round(dim)))
  const win = Math.max(m + 2, Math.round(period))
  let fact = 1; for (let f = 2; f <= m; f++) fact *= f
  const out: (number | null)[] = new Array(n).fill(null)
  const patternKey = (start: number) => {
    const idx = Array.from({ length: m }, (_, t) => t)
    idx.sort((a, b) => (closes[start + a] - closes[start + b]) || (a - b)) // stable for ties
    return idx.join(',')
  }
  for (let i = win - 1; i < n; i++) {
    const counts: Record<string, number> = {}
    let total = 0
    for (let j = i - win + 1; j <= i - m + 1; j++) { const key = patternKey(j); counts[key] = (counts[key] || 0) + 1; total++ }
    if (total <= 0) continue
    let H = 0
    for (const key in counts) { const pr = counts[key] / total; H -= pr * Math.log(pr) }
    out[i] = Math.max(0, Math.min(1, H / Math.log(fact)))
  }
  return out
}

/**
 * ANEMOI — the winds (invented for Zeus). A pure VOLUME-ANOMALY detector: the z-score
 * of each bar's volume versus its rolling mean/stdev over `period`. z ≈ 0 is normal
 * flow; z ≥ 2 is a climactic "gust" (a surge of interest that often precedes or marks
 * a move); z ≤ −1 is "dead air" (apathy). Distinct from OBV/CMF/MFI, which read flow
 * DIRECTION — ANEMOI reads how ABNORMAL the participation is, regardless of direction.
 */
export function anemoi(volumes: number[], period = 20): (number | null)[] {
  const n = volumes.length, p = Math.max(2, Math.round(period))
  const out: (number | null)[] = new Array(n).fill(null)
  for (let i = p - 1; i < n; i++) {
    let m = 0; for (let j = i - p + 1; j <= i; j++) m += volumes[j]; m /= p
    let s = 0; for (let j = i - p + 1; j <= i; j++) { const d = volumes[j] - m; s += d * d }
    const sd = Math.sqrt(s / p)
    out[i] = sd <= 0 ? 0 : (volumes[i] - m) / sd
  }
  return out
}

export interface Cerberus { fast: (number | null)[]; mid: (number | null)[]; slow: (number | null)[]; align: (number | null)[] }

/**
 * CERBERUS — the three-headed guardian (invented for Zeus). MULTI-TIMEFRAME trend
 * alignment: each "head" reports the trend (+1 up / −1 down / 0 flat) on a different
 * horizon — fast = SMA(baseLen), mid = SMA(baseLen·mult2), slow = SMA(baseLen·mult3) —
 * the longer averages standing in for higher timeframes. `align` sums the heads (−3..+3):
 * +3 / −3 = all three agree (a strong aligned trend, trade with it); near 0 = the heads
 * disagree (conflicting timeframes → chop, stand aside). The single-TF arsenal had no
 * cross-horizon agreement read; this is it.
 */
export function cerberus(closes: number[], baseLen = 20, mult2 = 4, mult3 = 12): Cerberus {
  const n = closes.length
  const L = Math.max(2, Math.round(baseLen))
  const s1 = sma(closes, L), s2 = sma(closes, L * Math.max(2, Math.round(mult2))), s3 = sma(closes, L * Math.max(3, Math.round(mult3)))
  const fast: (number | null)[] = new Array(n).fill(null)
  const mid: (number | null)[] = new Array(n).fill(null)
  const slow: (number | null)[] = new Array(n).fill(null)
  const align: (number | null)[] = new Array(n).fill(null)
  const sgn = (c: number, b: number | null) => (b == null ? null : (c > b ? 1 : c < b ? -1 : 0))
  for (let i = 0; i < n; i++) {
    fast[i] = sgn(closes[i], s1[i]); mid[i] = sgn(closes[i], s2[i]); slow[i] = sgn(closes[i], s3[i])
    if (fast[i] != null && mid[i] != null && slow[i] != null) align[i] = (fast[i] as number) + (mid[i] as number) + (slow[i] as number)
  }
  return { fast, mid, slow, align }
}

export interface Fisher { fisher: (number | null)[]; trigger: (number | null)[] }

/**
 * PROTEUS — the shape-shifter (invented for Zeus, built on Ehlers' Fisher Transform).
 * Normalises the median price to its `period` range, then applies the Fisher transform
 * 0.5·ln((1+x)/(1−x)), which Gaussianises the distribution so tops/bottoms become SHARP,
 * unambiguous spikes instead of the rounded turns of a bounded oscillator. `fisher`
 * crossing its 1-bar `trigger` flags a fast reversal; extreme spikes mark exhaustion.
 */
export function proteus(highs: number[], lows: number[], period = 10): Fisher {
  const n = highs.length, p = Math.max(2, Math.round(period))
  const fisher: (number | null)[] = new Array(n).fill(null)
  const trigger: (number | null)[] = new Array(n).fill(null)
  const mp = highs.map((h, i) => (h + lows[i]) / 2)
  let value = 0, fish = 0
  for (let i = p - 1; i < n; i++) {
    let minL = Infinity, maxH = -Infinity
    for (let j = i - p + 1; j <= i; j++) { if (lows[j] < minL) minL = lows[j]; if (highs[j] > maxH) maxH = highs[j] }
    const range = maxH - minL || 1e-9
    value = 0.33 * 2 * ((mp[i] - minL) / range - 0.5) + 0.67 * value
    value = Math.max(-0.999, Math.min(0.999, value))
    const prevFish = fish
    fish = 0.5 * Math.log((1 + value) / (1 - value)) + 0.5 * fish
    fisher[i] = fish
    trigger[i] = prevFish   // fisher of the previous bar
  }
  return { fisher, trigger }
}

/**
 * TYPHON — the monstrous storm (invented for Zeus). A VOLATILITY-REGIME meter: the
 * percentile rank (0..100) of the current ATR within its own trailing `period`
 * distribution. Low (→0) = volatility is compressed vs its norm — calm, coiled, a
 * breakout tends to follow; high (→100) = an expansion/climax, moves are unusually
 * large and often near exhaustion. It measures the SIZE of motion — orthogonal to
 * HELIOS (trend persistence) and EREBUS (disorder).
 */
export function typhon(highs: number[], lows: number[], closes: number[], atrLen = 14, period = 100): (number | null)[] {
  const n = closes.length
  const a = atr(highs, lows, closes, atrLen)
  const win = Math.max(5, Math.round(period))
  const out: (number | null)[] = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    if (a[i] == null) continue
    let cnt = 0, tot = 0
    for (let j = Math.max(0, i - win + 1); j <= i; j++) {
      if (a[j] == null) continue
      tot++
      if ((a[j] as number) <= (a[i] as number)) cnt++
    }
    if (tot >= 5) out[i] = 100 * cnt / tot
  }
  return out
}

/**
 * STYX — the underworld river (invented for Zeus). A pure RISK / drawdown meter: how
 * far price has sunk below its running peak over the last `period` bars, in percent
 * (≤ 0). 0 = at a fresh high (no pain); deeply negative = price is "underwater", a
 * sign of capitulation that often precedes a mean-reversion bounce. The arsenal had no
 * risk-from-peak lens — STYX is the underwater curve.
 */
export function styx(closes: number[], period = 100): (number | null)[] {
  const n = closes.length, p = Math.max(2, Math.round(period))
  const out: (number | null)[] = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    let mx = -Infinity
    for (let j = Math.max(0, i - p + 1); j <= i; j++) if (closes[j] > mx) mx = closes[j]
    out[i] = mx > 0 ? Math.min(0, (closes[i] - mx) / mx * 100) : 0
  }
  return out
}

/**
 * GERAS — old age (invented for Zeus). Measures the AGE of the current trend: the
 * number of consecutive bars price has stayed on one side of its EMA(`period`),
 * signed (+ for above / up-trend, − for below / down-trend). A young trend (small
 * magnitude) has room to run; an old, stretched trend (large magnitude) is prone to
 * exhaustion. It resets to ±1 the bar the trend flips. No other tool reads the
 * temporal maturity of a move.
 */
export function geras(closes: number[], period = 20): (number | null)[] {
  const n = closes.length
  const e = ema(closes, period)
  const out: (number | null)[] = new Array(n).fill(null)
  let dir = 0, age = 0
  for (let i = 0; i < n; i++) {
    if (e[i] == null) continue
    const s = closes[i] > (e[i] as number) ? 1 : closes[i] < (e[i] as number) ? -1 : 0
    if (s !== 0 && s === dir) age += 1
    else if (s !== 0) { dir = s; age = 1 }
    out[i] = dir * age
  }
  return out
}

export interface Channel { startIndex: number; mid: number[]; upper: number[]; lower: number[] }

/**
 * OURANOS — the encompassing sky (invented for Zeus). An auto LINEAR-REGRESSION
 * CHANNEL drawn on the main chart: it least-squares fits the last `period` closes into
 * a sloped midline, then offsets parallel rails at ±`mult`·(residual stdev). Price
 * rides between the rails — a tag of the upper rail = over-extended within the trend,
 * the lower rail = trend support. The whole channel re-fits every bar, so it tilts to
 * follow the prevailing trend. Returns the per-bar line values over the fitted window.
 */
export function ouranos(closes: number[], period = 100, mult = 2): Channel {
  const n = closes.length, p = Math.max(4, Math.round(period))
  if (n < p) return { startIndex: -1, mid: [], upper: [], lower: [] }
  const start = n - p
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (let t = 0; t < p; t++) { const y = closes[start + t]; sx += t; sy += y; sxx += t * t; sxy += t * y }
  const denom = p * sxx - sx * sx
  const slope = denom === 0 ? 0 : (p * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / p
  let ss = 0
  for (let t = 0; t < p; t++) { const r = closes[start + t] - (intercept + slope * t); ss += r * r }
  const sd = Math.sqrt(ss / p)
  const mid: number[] = [], upper: number[] = [], lower: number[] = []
  for (let t = 0; t < p; t++) { const m = intercept + slope * t; mid.push(m); upper.push(m + mult * sd); lower.push(m - mult * sd) }
  return { startIndex: start, mid, upper, lower }
}

export interface OrderBlock { index: number; dir: 'bull' | 'bear'; top: number; bottom: number; mitigated: boolean; mitIndex: number }

/**
 * HADES — lord of the depths (invented for Zeus). Detects ORDER BLOCKS: the last
 * opposite-colour candle right before a strong impulse move (body > `impulse`·ATR) is
 * the institutional "origin" of that move. A bullish OB (the last down-candle before
 * an up-impulse) is a demand zone price tends to revisit from above; a bearish OB (last
 * up-candle before a down-impulse) is a supply zone. Each block's [low, high] range is
 * tracked as `top`/`bottom` and flagged `mitigated` once price trades back into it.
 * Distinct from HERMES (fair-value gaps) and CHARON (resting liquidity).
 */
export function hades(opens: number[], highs: number[], lows: number[], closes: number[], atrLen = 14, impulse = 1.2, lookback = 5): OrderBlock[] {
  const n = closes.length
  const a = atr(highs, lows, closes, atrLen)
  const out: OrderBlock[] = []
  const seen = new Set<string>()
  const L = Math.max(1, Math.round(lookback))
  for (let i = 1; i < n; i++) {
    if (a[i] == null) continue
    const body = closes[i] - opens[i], thr = impulse * (a[i] as number)
    let ob: { j: number; dir: 'bull' | 'bear' } | null = null
    if (body > thr) {
      for (let j = i - 1; j >= Math.max(0, i - L); j--) if (closes[j] < opens[j]) { ob = { j, dir: 'bull' }; break }
    } else if (-body > thr) {
      for (let j = i - 1; j >= Math.max(0, i - L); j--) if (closes[j] > opens[j]) { ob = { j, dir: 'bear' }; break }
    }
    if (!ob) continue
    const key = ob.dir + ':' + ob.j
    if (seen.has(key)) continue
    seen.add(key)
    const top = highs[ob.j], bottom = lows[ob.j]
    let mitIndex = -1
    for (let m = i + 1; m < n; m++) {
      if (ob.dir === 'bull' ? lows[m] <= top : highs[m] >= bottom) { mitIndex = m; break }
    }
    out.push({ index: ob.j, dir: ob.dir, top, bottom, mitigated: mitIndex !== -1, mitIndex })
  }
  out.sort((x, y) => x.index - y.index)
  return out
}

export interface Athena { line: (number | null)[]; velocity: (number | null)[] }

/**
 * ATHENA — strategic wisdom (invented for Zeus). A KALMAN-style g-h (alpha-beta) filter
 * with a constant-velocity state model: it recursively estimates the "true" price level
 * AND its velocity (slope) from noisy observations — the steady-state optimal estimator,
 * not a window average, so it has far less lag than an MA of comparable smoothness.
 * `alpha` sets responsiveness; beta is derived for critical damping (β = α²/(2−α)). The
 * `line` is the filtered price, `velocity` its per-bar slope (use the sign/size to read
 * trend direction and strength, and to project forward).
 */
export function athena(closes: number[], alpha = 0.2): Athena {
  const n = closes.length
  const line: (number | null)[] = new Array(n).fill(null)
  const velocity: (number | null)[] = new Array(n).fill(null)
  if (!n) return { line, velocity }
  const a = Math.max(0.02, Math.min(0.95, alpha))
  const b = (a * a) / (2 - a)
  let x = closes[0], v = 0
  for (let i = 0; i < n; i++) {
    const xpred = x + v, resid = closes[i] - xpred
    x = xpred + a * resid
    v = v + b * resid
    line[i] = x; velocity[i] = v
  }
  return { line, velocity }
}

export interface Echo { fitStart: number; fit: number[]; projection: number[] }

/**
 * ECHO — the resonant memory (invented for Zeus). SPECTRAL forecasting via the discrete
 * Fourier transform: it linearly detrends the last `window` closes, decomposes the
 * residual into frequency components, keeps the `harmonics` strongest, reconstructs the
 * signal from them, and EXTENDS that harmonic sum (plus the trend) `horizon` bars into
 * the future — projecting the market's dominant rhythm forward. Distinct from MNEMOSYNE
 * (analog matching) and SELENE (single autocorrelation lag): ECHO is true multi-harmonic
 * Fourier synthesis. Returns the in-window fit and the forward projection (index 0 = now).
 */
export function echo(closes: number[], window = 128, harmonics = 3, horizon = 10): Echo {
  const n = closes.length
  const N = Math.min(Math.max(16, Math.round(window)), n)
  if (n < 16 || N < 16) return { fitStart: -1, fit: [], projection: [] }
  const start = n - N
  // linear detrend
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (let t = 0; t < N; t++) { const y = closes[start + t]; sx += t; sy += y; sxx += t * t; sxy += t * y }
  const denom = N * sxx - sx * sx
  const slope = denom === 0 ? 0 : (N * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / N
  const resid: number[] = []
  for (let t = 0; t < N; t++) resid.push(closes[start + t] - (intercept + slope * t))
  // DFT magnitudes for k = 1..N/2
  const maxK = Math.floor(N / 2)
  const comp: { k: number; re: number; im: number; amp: number }[] = []
  for (let k = 1; k <= maxK; k++) {
    let re = 0, im = 0
    for (let t = 0; t < N; t++) { const w = 2 * Math.PI * k * t / N; re += resid[t] * Math.cos(w); im += resid[t] * Math.sin(w) }
    comp.push({ k, re, im, amp: re * re + im * im })
  }
  comp.sort((p, q) => q.amp - p.amp)
  const top = comp.slice(0, Math.max(1, Math.round(harmonics)))
  const recon = (x: number) => {
    let s = intercept + slope * x
    for (const c of top) { const w = 2 * Math.PI * c.k * x / N; s += (2 / N) * (c.re * Math.cos(w) + c.im * Math.sin(w)) }
    return s
  }
  const fit: number[] = []
  for (let t = 0; t < N; t++) fit.push(recon(t))
  const projection: number[] = []
  for (let j = 0; j <= Math.max(1, Math.round(horizon)); j++) projection.push(recon(N - 1 + j))
  return { fitStart: start, fit, projection }
}

export interface Kairos { phase: (number | null)[]; period: (number | null)[] }

/**
 * KAIROS — the opportune moment (invented for Zeus, built on Ehlers' Hilbert transform).
 * Removes the DC/trend (price − SMA), then applies a Hilbert FIR to get the quadrature
 * component; the instantaneous PHASE = atan2(Q, I) tells you exactly where in the
 * dominant cycle price is RIGHT NOW (−180°=trough … 0°=mid-up … +90°=peak), and the
 * rate of phase rotation gives the instantaneous PERIOD. It's a real-time cycle clock —
 * distinct from SELENE (autocorrelation period) and ECHO (Fourier spectrum).
 */
export function kairos(closes: number[], smoothLen = 40): Kairos {
  const n = closes.length
  const base = sma(closes, smoothLen)
  const detr = new Array(n).fill(NaN)
  for (let i = 0; i < n; i++) if (base[i] != null) detr[i] = closes[i] - (base[i] as number)
  const phase: (number | null)[] = new Array(n).fill(null)
  const period: (number | null)[] = new Array(n).fill(null)
  let prev: number | null = null
  for (let i = 6; i < n; i++) {
    let ok = true
    for (let d = 0; d <= 6; d++) if (isNaN(detr[i - d])) ok = false
    if (!ok) { prev = null; continue }
    const I = detr[i - 3]
    const Q = 0.0962 * detr[i] + 0.5769 * detr[i - 2] - 0.5769 * detr[i - 4] - 0.0962 * detr[i - 6]
    const ph = Math.atan2(Q, I) * 180 / Math.PI    // −180..180
    phase[i] = ph
    if (prev != null) {
      let d = ((ph - prev + 540) % 360) - 180        // shortest signed arc
      const adv = Math.abs(d)
      if (adv > 0.5) period[i] = Math.max(6, Math.min(80, 360 / adv))
    }
    prev = ph
  }
  return { phase, period }
}

export interface Fan { p10: number[]; p50: number[]; p90: number[] }

/**
 * TYCHE — fortune & chance (invented for Zeus). A MONTE-CARLO probability fan: it
 * bootstrap-resamples the last `lookback` log-returns to simulate `sims` future price
 * paths `horizon` bars ahead, then reports the 10th / 50th / 90th percentile envelope at
 * each step. Because it samples the EMPIRICAL return distribution it captures the
 * asset's real skew and fat tails — unlike PROMETHEUS's Gaussian √t cone. Seeded PRNG
 * → deterministic (stable across renders). Arrays length horizon+1 (index 0 = now).
 */
export function tyche(closes: number[], lookback = 100, horizon = 12, sims = 200, seed = 12345): Fan {
  const n = closes.length
  const last = n ? closes[n - 1] : 0
  const H = Math.max(1, Math.round(horizon))
  const start = Math.max(1, n - Math.max(5, Math.round(lookback)))
  const rets: number[] = []
  for (let i = start; i < n; i++) { const a = closes[i - 1], b = closes[i]; if (a > 0 && b > 0) rets.push(Math.log(b / a)) }
  const mkFlat = () => new Array(H + 1).fill(last)
  if (rets.length < 2) return { p10: mkFlat(), p50: mkFlat(), p90: mkFlat() }
  let s = (seed >>> 0) || 1
  const rand = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296 }
  const M = Math.max(20, Math.round(sims))
  const stepVals: number[][] = Array.from({ length: H + 1 }, () => [])
  for (let m = 0; m < M; m++) {
    let p = last
    stepVals[0].push(p)
    for (let k = 1; k <= H; k++) { p *= Math.exp(rets[Math.floor(rand() * rets.length)]); stepVals[k].push(p) }
  }
  const q = (arr: number[], pct: number) => { const a = [...arr].sort((x, y) => x - y); return a[Math.max(0, Math.min(a.length - 1, Math.floor(pct * (a.length - 1))))] }
  const p10: number[] = [], p50: number[] = [], p90: number[] = []
  for (let k = 0; k <= H; k++) { p10.push(q(stepVals[k], 0.1)); p50.push(q(stepVals[k], 0.5)); p90.push(q(stepVals[k], 0.9)) }
  return { p10, p50, p90 }
}

export interface Nyx { flow: (number | null)[]; phase: ('accum' | 'dist' | 'neutral')[] }

/**
 * NYX — night that sees all (invented for Zeus). An ultra-composite SMART-MONEY FLOW
 * score (−1..+1) that fuses four reads into one colour-filled area: (1) money-flow
 * multiplier × volume, EMA-smoothed (where in range bars close — accumulation vs
 * distribution); (2) signed-volume delta (long vs short pressure); (3) price vs its EMA
 * (trend bias). Strongly positive = accumulation / long intent (green fill above 0),
 * strongly negative = distribution / short intent (red fill below 0). `phase` labels
 * each bar accum / dist / neutral.
 */
export function nyx(_opens: number[], highs: number[], lows: number[], closes: number[], volumes: number[], period = 20): Nyx {
  const n = closes.length
  const e = ema(closes, period)
  const mfv: number[] = new Array(n).fill(0), dvol: number[] = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    const range = highs[i] - lows[i]
    const mfm = range > 0 ? ((closes[i] - lows[i]) - (highs[i] - closes[i])) / range : 0
    mfv[i] = mfm * volumes[i]
    const dir = i > 0 ? (closes[i] > closes[i - 1] ? 1 : closes[i] < closes[i - 1] ? -1 : 0) : 0
    dvol[i] = dir * volumes[i]
  }
  const mfvE = ema(mfv, period), volE = ema(volumes, period), dvolE = ema(dvol, period)
  const flow: (number | null)[] = new Array(n).fill(null)
  const phase: ('accum' | 'dist' | 'neutral')[] = new Array(n).fill('neutral')
  for (let i = 0; i < n; i++) {
    if (e[i] == null || volE[i] == null || (volE[i] as number) <= 0) continue
    const ad = Math.max(-1, Math.min(1, (mfvE[i] as number) / (volE[i] as number)))
    const delta = Math.max(-1, Math.min(1, (dvolE[i] as number) / (volE[i] as number)))
    const trend = closes[i] > (e[i] as number) ? 1 : closes[i] < (e[i] as number) ? -1 : 0
    const f = Math.max(-1, Math.min(1, 0.5 * ad + 0.25 * delta + 0.25 * trend))
    flow[i] = f
    phase[i] = f > 0.1 ? 'accum' : f < -0.1 ? 'dist' : 'neutral'
  }
  return { flow, phase }
}

export interface SmcEvent { index: number; kind: 'BOS' | 'CHoCH'; dir: 'up' | 'down'; level: number }
export interface Olympus { events: SmcEvent[]; fvgs: FairValueGap[]; bias: ('long' | 'short' | 'neutral')[] }

/**
 * OLYMPUS — seat of the gods (invented for Zeus). An ultra-composite SMART-MONEY
 * CONCEPTS engine that reads market STRUCTURE in one pass: it tracks confirmed swing
 * pivots, then classifies each break of a prior swing as a BOS (Break of Structure —
 * a continuation in the prevailing trend) or a CHoCH (Change of Character — the FIRST
 * break against the trend, i.e. a reversal). It maintains the running `bias`
 * (long/short/neutral) and also returns fair-value-gap zones. MOIRA gave only BOS;
 * OLYMPUS adds the CHoCH distinction + live bias + FVG in a single structure map.
 */
export function olympus(_opens: number[], highs: number[], lows: number[], closes: number[], swing = 5, fvgMinPct = 0.03): Olympus {
  const n = closes.length, L = Math.max(1, Math.round(swing))
  const piv: { confirm: number; type: 'H' | 'L'; value: number }[] = []
  for (let i = L; i < n - L; i++) {
    let isH = true, isL = true
    for (let j = i - L; j <= i + L; j++) { if (j === i) continue; if (highs[j] > highs[i]) isH = false; if (lows[j] < lows[i]) isL = false }
    if (isH) piv.push({ confirm: i + L, type: 'H', value: highs[i] })
    if (isL) piv.push({ confirm: i + L, type: 'L', value: lows[i] })
  }
  piv.sort((a, b) => a.confirm - b.confirm)
  const events: SmcEvent[] = []
  const bias: ('long' | 'short' | 'neutral')[] = new Array(n).fill('neutral')
  let k = 0, lastH = NaN, lastL = NaN, trend: 'long' | 'short' | 'neutral' = 'neutral', brokeH = false, brokeL = false
  for (let i = 0; i < n; i++) {
    while (k < piv.length && piv[k].confirm <= i) { const pv = piv[k]; if (pv.type === 'H') { lastH = pv.value; brokeH = false } else { lastL = pv.value; brokeL = false } k++ }
    if (!isNaN(lastH) && !brokeH && closes[i] > lastH) { events.push({ index: i, kind: trend === 'short' ? 'CHoCH' : 'BOS', dir: 'up', level: lastH }); trend = 'long'; brokeH = true }
    if (!isNaN(lastL) && !brokeL && closes[i] < lastL) { events.push({ index: i, kind: trend === 'long' ? 'CHoCH' : 'BOS', dir: 'down', level: lastL }); trend = 'short'; brokeL = true }
    bias[i] = trend
  }
  // fair-value gaps (3-candle imbalances)
  const fvgs: FairValueGap[] = []
  for (let i = 2; i < n; i++) {
    let dir: 'bull' | 'bear' | null = null, top = 0, bottom = 0
    if (highs[i - 2] < lows[i]) { dir = 'bull'; top = lows[i]; bottom = highs[i - 2] }
    else if (lows[i - 2] > highs[i]) { dir = 'bear'; top = lows[i - 2]; bottom = highs[i] }
    if (!dir) continue
    const ref = closes[i] || 1
    if ((top - bottom) / ref * 100 < fvgMinPct) continue
    let fill = -1
    for (let j = i + 1; j < n; j++) { if (dir === 'bull' ? lows[j] <= top : highs[j] >= bottom) { fill = j; break } }
    fvgs.push({ index: i, dir, top, bottom, filled: fill !== -1, fillIndex: fill })
  }
  return { events, fvgs, bias }
}

export interface Gaia { score: (number | null)[] }

/**
 * GAIA — the bedrock (invented for Zeus). A composite REGIME score (−1..+1) painted as
 * a colour tape under price: it fuses trend (close vs EMA, ATR-normalised), momentum
 * (rate-of-change) and volume flow (money-flow multiplier × volume, EMA-smoothed) into
 * one number per bar. Strong positive = bullish regime (bright green), strong negative
 * = bearish (red), near zero = no-edge chop (grey). One glance gives the market's
 * underlying state, reading several dimensions at once.
 */
export function gaia(highs: number[], lows: number[], closes: number[], volumes: number[], period = 50): Gaia {
  const n = closes.length
  const e = ema(closes, period), a = atr(highs, lows, closes, 14), rc = roc(closes, 10)
  const mfv: number[] = new Array(n).fill(0)
  for (let i = 0; i < n; i++) { const r = highs[i] - lows[i]; const mfm = r > 0 ? ((closes[i] - lows[i]) - (highs[i] - closes[i])) / r : 0; mfv[i] = mfm * volumes[i] }
  const mfvE = ema(mfv, 20), volE = ema(volumes, 20)
  const score: (number | null)[] = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    if (e[i] == null || a[i] == null) continue
    const atrI = (a[i] as number) || 1e-9
    const trendN = Math.max(-1, Math.min(1, (closes[i] - (e[i] as number)) / (2 * atrI)))
    const momN = rc[i] == null ? 0 : Math.max(-1, Math.min(1, (rc[i] as number) / 5))
    const flow = (volE[i] != null && (volE[i] as number) > 0) ? Math.max(-1, Math.min(1, (mfvE[i] as number) / (volE[i] as number))) : 0
    score[i] = Math.max(-1, Math.min(1, 0.4 * trendN + 0.3 * momN + 0.3 * flow))
  }
  return { score }
}

export interface Ananke { mid: (number | null)[]; upper: (number | null)[]; lower: (number | null)[]; conf: (number | null)[] }

/**
 * ANANKE — necessity / inevitability (invented for Zeus). A confluence CHANNEL around a
 * low-lag Hull-MA equilibrium: band WIDTH encodes volatility (±mult·ATR), the midline
 * SLOPE encodes trend, and the `conf` score (−1..+1, from the HMA slope and price's
 * position inside the band) encodes how strongly the move is confirmed — used to colour
 * the channel. One overlay that simultaneously shows trend, volatility and confluence.
 */
export function ananke(highs: number[], lows: number[], closes: number[], period = 20, mult = 2): Ananke {
  const n = closes.length
  const m = hma(closes, period), a = atr(highs, lows, closes, 14)
  const mid: (number | null)[] = new Array(n).fill(null)
  const upper: (number | null)[] = new Array(n).fill(null)
  const lower: (number | null)[] = new Array(n).fill(null)
  const conf: (number | null)[] = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    if (m[i] == null || a[i] == null) continue
    const atrI = (a[i] as number) || 1e-9
    mid[i] = m[i]; upper[i] = (m[i] as number) + mult * atrI; lower[i] = (m[i] as number) - mult * atrI
    let slopeN = 0
    if (i > 0 && m[i - 1] != null) slopeN = Math.max(-1, Math.min(1, ((m[i] as number) - (m[i - 1] as number)) / atrI))
    const posN = Math.max(-1, Math.min(1, (closes[i] - (m[i] as number)) / (2 * atrI)))
    conf[i] = Math.max(-1, Math.min(1, 0.6 * slopeN + 0.4 * posN))
  }
  return { mid, upper, lower, conf }
}

export interface Psyche { emotion: (number | null)[] }

/**
 * PSYCHE — the mind of the crowd (invented for Zeus). A market-EMOTION score (−1..+1,
 * fear↔greed) that fuses three psychological proxies: RSI bias (greed when overbought),
 * momentum (greed when accelerating up), and stretch from the mean (mania when far
 * above, despair when far below). The engine maps it to a vivid 7-colour emotional
 * spectrum — euphoria / greed / optimism / calm / anxiety / fear / panic — so you read
 * the crowd's state at a glance. Nothing else in the suite measures sentiment directly.
 */
export function psyche(_highs: number[], _lows: number[], closes: number[], _volumes: number[], period = 20): Psyche {
  const n = closes.length, p = Math.max(2, Math.round(period))
  const rsi = _rsi(closes, 14), rc = roc(closes, 10), base = sma(closes, p)
  const emotion: (number | null)[] = new Array(n).fill(null)
  for (let i = p - 1; i < n; i++) {
    if (base[i] == null) continue
    const m = base[i] as number
    let ss = 0; for (let j = i - p + 1; j <= i; j++) { const d = closes[j] - m; ss += d * d }
    const sd = Math.sqrt(ss / p) || 1e-9
    const z = (closes[i] - m) / sd
    const rsiBias = isNaN(rsi[i]) ? 0 : (rsi[i] - 50) / 50
    const mom = rc[i] == null ? 0 : Math.max(-1, Math.min(1, (rc[i] as number) / 5))
    const stretch = Math.max(-1, Math.min(1, z / 3))
    emotion[i] = Math.max(-1, Math.min(1, 0.35 * rsiBias + 0.3 * mom + 0.35 * stretch))
  }
  return { emotion }
}

export interface PsychExtreme { index: number; kind: 'euphoria' | 'capitulation'; intensity: number }

/**
 * HUBRIS — the pride before the fall (invented for Zeus). A contrarian PSYCHOLOGY
 * extreme detector: a EUPHORIA top prints when the crowd is maximally greedy — RSI above
 * `rsiHi`, price stretched > `zThr` standard deviations above its mean (often on a
 * volume climax) — a greed peak prone to reverse. A CAPITULATION bottom prints at the
 * mirror fear extreme (RSI < `rsiLo`, z < −zThr, panic volume). `intensity` grades how
 * extreme. The timeless edge: buy capitulation, fade euphoria.
 */
export function hubris(_highs: number[], _lows: number[], closes: number[], volumes: number[], rsiPeriod = 14, meanPeriod = 20, zThr = 1.8, rsiHi = 72, rsiLo = 28): PsychExtreme[] {
  const n = closes.length, p = Math.max(2, Math.round(meanPeriod))
  const rsi = _rsi(closes, rsiPeriod), base = sma(closes, p), volAvg = sma(volumes, p)
  const out: PsychExtreme[] = []
  for (let i = p - 1; i < n; i++) {
    if (base[i] == null || isNaN(rsi[i])) continue
    const m = base[i] as number
    let ss = 0; for (let j = i - p + 1; j <= i; j++) { const d = closes[j] - m; ss += d * d }
    const sd = Math.sqrt(ss / p) || 1e-9
    const z = (closes[i] - m) / sd
    const volSpike = volAvg[i] != null && (volAvg[i] as number) > 0 ? volumes[i] / (volAvg[i] as number) : 1
    if (rsi[i] > rsiHi && z > zThr) out.push({ index: i, kind: 'euphoria', intensity: Math.abs(z) + (rsi[i] - 50) / 50 + Math.max(0, volSpike - 1) })
    else if (rsi[i] < rsiLo && z < -zThr) out.push({ index: i, kind: 'capitulation', intensity: Math.abs(z) + (50 - rsi[i]) / 50 + Math.max(0, volSpike - 1) })
  }
  return out
}

export interface Okeanos { center: (number | null)[]; atr: (number | null)[]; bull: boolean[]; signals: { index: number; dir: 'buy' | 'sell' }[] }

/**
 * OKEANOS — the world-encircling river (invented for Zeus, modelled on the "Forex Lines"
 * MT4 system from the reference). A central EMA equilibrium with a fanned multi-band
 * envelope (drawn ±i·spacing·ATR in the engine), a trend read (`bull` = price above the
 * centre), and reversal `signals` when price stretches beyond the outer ±bandMult·ATR
 * band (overbought → sell dot, oversold → buy dot). The pure layer exposes the centre,
 * ATR, trend and signals; the engine renders the dotted red/blue fan + green centre +
 * solid outer rails + yellow signal dots.
 */
export function okeanos(highs: number[], lows: number[], closes: number[], period = 20, atrLen = 14, bandMult = 3.5): Okeanos {
  const n = closes.length
  const center = ema(closes, period), a = atr(highs, lows, closes, atrLen)
  const bull: boolean[] = new Array(n).fill(false)
  const signals: { index: number; dir: 'buy' | 'sell' }[] = []
  for (let i = 0; i < n; i++) {
    if (center[i] == null) continue
    bull[i] = closes[i] > (center[i] as number)
    if (a[i] != null) {
      const c = center[i] as number, band = bandMult * (a[i] as number)
      if (closes[i] > c + band) signals.push({ index: i, dir: 'sell' })
      else if (closes[i] < c - band) signals.push({ index: i, dir: 'buy' })
    }
  }
  return { center, atr: a, bull, signals }
}

export interface Aurora { score: (number | null)[]; flips: { index: number; dir: 'up' | 'down' }[] }

/**
 * AURORA — the dawn glow (invented for Zeus, modelled on the glowing "AO cloud" from the
 * reference). A normalised momentum-cloud score (−1..+1): a MACD-like fast/slow EMA
 * spread plus price position, both scaled by ATR. The engine paints it as a vivid glow
 * behind price — green-teal when positive, red-magenta when negative, brightness scaling
 * with strength — and drops a signal arrow at each sign `flip` (regime change).
 */
export function aurora(highs: number[], lows: number[], closes: number[], _volumes: number[], period = 20): Aurora {
  const n = closes.length
  const ef = ema(closes, Math.max(2, Math.round(period / 2))), es = ema(closes, period), a = atr(highs, lows, closes, 14)
  const score: (number | null)[] = new Array(n).fill(null)
  const flips: { index: number; dir: 'up' | 'down' }[] = []
  let prevSign = 0
  for (let i = 0; i < n; i++) {
    if (ef[i] == null || es[i] == null || a[i] == null) continue
    const atrI = (a[i] as number) || 1e-9
    const macdN = Math.max(-1, Math.min(1, ((ef[i] as number) - (es[i] as number)) / atrI))
    const posN = Math.max(-1, Math.min(1, (closes[i] - (es[i] as number)) / (2 * atrI)))
    const s = Math.max(-1, Math.min(1, 0.6 * macdN + 0.4 * posN))
    score[i] = s
    const sign = s > 0.05 ? 1 : s < -0.05 ? -1 : 0
    if (sign !== 0 && prevSign !== 0 && sign !== prevSign) flips.push({ index: i, dir: sign > 0 ? 'up' : 'down' })
    if (sign !== 0) prevSign = sign
  }
  return { score, flips }
}

export interface ArgusCell { indicator: string; tf: number; bull: boolean; valid: boolean }
export interface Argus { indicators: string[]; tfs: number[]; cells: ArgusCell[]; pctUp: number; trend: 'UP' | 'DOWN'; strength: 'STRONG' | 'WEAK' }

/** Aggregate base OHLCV into G-bar buckets (higher timeframe). G≤1 returns the input. */
function _aggOHLC(h: number[], l: number[], c: number[], G: number) {
  if (G <= 1) return { h, l, c }
  const H: number[] = [], L: number[] = [], C: number[] = []
  for (let i = 0; i < c.length; i += G) {
    let hi = -Infinity, lo = Infinity
    const end = Math.min(i + G, c.length)
    for (let j = i; j < end; j++) { if (h[j] > hi) hi = h[j]; if (l[j] < lo) lo = l[j] }
    H.push(hi); L.push(lo); C.push(c[end - 1])
  }
  return { h: H, l: L, c: C }
}

/**
 * ARGUS — the hundred-eyed all-seer (invented for Zeus, modelled on the "iPanel" MTF
 * dashboard reference). It aggregates the base series into several higher timeframes
 * (the `tfs` bucket multipliers) and, on each, reads six indicators — EMA-fast, EMA-slow,
 * RSI, Stochastic, MACD and CCI — as bull/bear. The result is a multi-timeframe ×
 * multi-indicator signal MATRIX, plus an aggregate `pctUp`, overall `trend` and
 * `strength`. The engine renders it as a green-▲ / red-▼ grid HUD on the chart.
 */
export function argus(_opens: number[], highs: number[], lows: number[], closes: number[], _volumes: number[], tfs = [1, 2, 4, 8, 16, 32]): Argus {
  const indicators = ['EMA8', 'EMA21', 'RSI', 'STOCH', 'MACD', 'CCI']
  const cells: ArgusCell[] = []
  let up = 0, validCount = 0
  const lastFinite = (arr: (number | null)[]): number | null => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i] as number; return null }
  for (const G of tfs) {
    const a = _aggOHLC(highs, lows, closes, G)
    const c = a.c, h = a.h, l = a.l, n = c.length
    const push = (indicator: string, bull: boolean | null) => {
      const valid = bull !== null
      cells.push({ indicator, tf: G, bull: !!bull, valid })
      if (valid) { validCount++; if (bull) up++ }
    }
    // EMA fast / slow: price above the EMA = bull
    const e8 = lastFinite(ema(c, 8)), e21 = lastFinite(ema(c, 21)), px = c[n - 1]
    push('EMA8', e8 == null ? null : px > e8)
    push('EMA21', e21 == null ? null : px > e21)
    // RSI > 50
    const rsiArr = _rsi(c, 14), rsiLast = rsiArr.length ? rsiArr[rsiArr.length - 1] : NaN
    push('RSI', isNaN(rsiLast) ? null : rsiLast > 50)
    // Stochastic %K > 50
    let stoch: boolean | null = null
    if (n >= 14) { let hi = -Infinity, lo = Infinity; for (let j = n - 14; j < n; j++) { if (h[j] > hi) hi = h[j]; if (l[j] < lo) lo = l[j] } stoch = hi > lo ? ((px - lo) / (hi - lo) * 100) > 50 : null }
    push('STOCH', stoch)
    // MACD line > signal
    const macdArr: (number | null)[] = []
    const e12 = ema(c, 12), e26 = ema(c, 26)
    for (let i = 0; i < n; i++) macdArr.push(e12[i] != null && e26[i] != null ? (e12[i] as number) - (e26[i] as number) : null)
    const macdVals = macdArr.filter((x) => x != null) as number[]
    const sig = lastFinite(ema(macdVals, 9)), macdLast = lastFinite(macdArr)
    push('MACD', sig == null || macdLast == null ? null : macdLast > sig)
    // CCI > 0
    let cci: boolean | null = null
    if (n >= 20) {
      const tp = c.map((x, i) => (h[i] + l[i] + x) / 3)
      let m = 0; for (let j = n - 20; j < n; j++) m += tp[j]; m /= 20
      let md = 0; for (let j = n - 20; j < n; j++) md += Math.abs(tp[j] - m); md /= 20
      cci = md > 0 ? ((tp[n - 1] - m) / (0.015 * md)) > 0 : null
    }
    push('CCI', cci)
  }
  const pctUp = validCount ? Math.round(100 * up / validCount) : 50
  const trend: 'UP' | 'DOWN' = pctUp >= 50 ? 'UP' : 'DOWN'
  const strength: 'STRONG' | 'WEAK' = (pctUp >= 70 || pctUp <= 30) ? 'STRONG' : 'WEAK'
  return { indicators, tfs, cells, pctUp, trend, strength }
}

export interface OrionSig { index: number; dir: 'buy' | 'sell' }
export interface Orion { fast: (number | null)[]; slow: (number | null)[]; signals: OrionSig[]; buyPct: number; sellPct: number }

/**
 * ORION — the hunter (invented for Zeus, modelled on the "Trade Hunter" MT4 reference).
 * Three parts: (1) a fast & slow EMA whose gap the engine fills blue (fast above slow =
 * bullish) or red (bearish) — the "MA Filling" cloud; (2) buy ▲ / sell ▼ arrows at swing
 * pivots; (3) Buy/Sell POWER — over the last `powerLen` bars the share of up-movement vs
 * down-movement, shown as Buy %/Sell % in a HUD.
 */
export function orion(highs: number[], lows: number[], closes: number[], _volumes: number[], fast = 10, slow = 30, swing = 3, powerLen = 20): Orion {
  const n = closes.length
  const ef = ema(closes, fast), es = ema(closes, slow)
  const L = Math.max(1, Math.round(swing))
  const signals: OrionSig[] = []
  for (let i = L; i < n - L; i++) {
    let isH = true, isL = true
    for (let j = i - L; j <= i + L; j++) { if (j === i) continue; if (highs[j] > highs[i]) isH = false; if (lows[j] < lows[i]) isL = false }
    if (isH) signals.push({ index: i, dir: 'sell' })
    if (isL) signals.push({ index: i, dir: 'buy' })
  }
  let up = 0, dn = 0
  const pl = Math.max(2, Math.round(powerLen))
  for (let i = Math.max(1, n - pl); i < n; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) up += d; else dn += -d }
  const tot = up + dn
  const buyPct = tot > 0 ? Math.round(1000 * up / tot) / 10 : 50
  const sellPct = Math.round((100 - buyPct) * 10) / 10
  return { fast: ef, slow: es, signals, buyPct, sellPct }
}

export interface PhoenixSig { index: number; dir: 'L' | 'S' }
export interface Phoenix { ma: (number | null)[]; signals: PhoenixSig[]; strength: number }

/**
 * PHOENIX — reborn in fire (invented for Zeus, modelled on the "Impossible" TradingView
 * reference — the one that RECOLOURS the candles). The engine paints candles yellow (up)
 * / red (down) while active. Math layer: a smoothed Hull-MA baseline, L (long) markers at
 * swing lows and S (sell) markers at swing highs, and a 0–100 `strength` = the directional
 * consistency of the last `strengthLen` bars relative to the MA (how one-sided the move is).
 */
export function phoenix(highs: number[], lows: number[], closes: number[], smoothLen = 20, swing = 4, strengthLen = 14): Phoenix {
  const n = closes.length
  const ma = hma(closes, smoothLen)
  const L = Math.max(1, Math.round(swing))
  const signals: PhoenixSig[] = []
  for (let i = L; i < n - L; i++) {
    let isH = true, isL = true
    for (let j = i - L; j <= i + L; j++) { if (j === i) continue; if (highs[j] > highs[i]) isH = false; if (lows[j] < lows[i]) isL = false }
    if (isH) signals.push({ index: i, dir: 'S' })
    if (isL) signals.push({ index: i, dir: 'L' })
  }
  const sl = Math.max(2, Math.round(strengthLen))
  let above = 0, below = 0, cnt = 0
  for (let i = Math.max(0, n - sl); i < n; i++) { if (ma[i] == null) continue; cnt++; if (closes[i] > (ma[i] as number)) above++; else below++ }
  const strength = cnt > 0 ? Math.round(100 * Math.abs(above - below) / cnt) : 0
  return { ma, signals, strength }
}

export interface NepheleSwing { index: number; type: 'high' | 'low' }
export interface Nephele { upMid: (number | null)[]; loMid: (number | null)[]; atr: (number | null)[]; swings: NepheleSwing[] }

/**
 * NEPHELE — the cloud nymph (invented for Zeus, modelled on the dual glowing
 * swing-structure band reference). Two smoothed glow bands: an UPPER magenta band
 * (EMA of highs) marking the resistance / swing-high structure, and a LOWER green band
 * (EMA of lows) marking the support / swing-low structure — each drawn by the engine as
 * a bright centre line plus faint ±ATR glow rails. Confirmed swing pivots get a diamond
 * + "Swing High" (magenta) / "Swing Low" (green) label, showing where structure shifts.
 */
export function nephele(highs: number[], lows: number[], closes: number[], period = 20, swing = 5): Nephele {
  const n = closes.length, L = Math.max(1, Math.round(swing))
  const upMid = ema(highs, period), loMid = ema(lows, period), a = atr(highs, lows, closes, 14)
  const swings: NepheleSwing[] = []
  for (let i = L; i < n - L; i++) {
    let isH = true, isL = true
    for (let j = i - L; j <= i + L; j++) { if (j === i) continue; if (highs[j] > highs[i]) isH = false; if (lows[j] < lows[i]) isL = false }
    if (isH) swings.push({ index: i, type: 'high' })
    if (isL) swings.push({ index: i, type: 'low' })
  }
  return { upMid, loMid, atr: a, swings }
}

export interface MorphSig { index: number; dir: 'buy' | 'sell' }
export interface MorphLevel { price: number; type: 'res' | 'sup' }
export interface Morpheus { ma: (number | null)[]; trendUp: boolean[]; signals: MorphSig[]; levels: MorphLevel[]; bullPrints: number; bearPrints: number }

/**
 * MORPHEUS — the shaper of forms (invented for Zeus, modelled on the "RT-Main" 4-colour
 * candle painter). It classifies each bar by TREND (close vs an EMA baseline) × candle
 * DIRECTION into four states the engine paints onto the candles: green (uptrend + up),
 * blue (uptrend + pullback), red (downtrend + down), yellow (downtrend + bounce). Trend
 * flips emit buy ▲ / sell ▼ "prints" (counted as Bull/Bear Prints), and recent swing
 * highs/lows become dashed resistance (red) / support (green) levels.
 */
export function morpheus(highs: number[], lows: number[], closes: number[], maPeriod = 50, swing = 8): Morpheus {
  const n = closes.length
  const ma = ema(closes, maPeriod)
  const trendUp: boolean[] = new Array(n).fill(false)
  const signals: MorphSig[] = []
  let prev: boolean | null = null
  for (let i = 0; i < n; i++) {
    if (ma[i] == null) continue
    const up = closes[i] >= (ma[i] as number)
    trendUp[i] = up
    if (prev !== null && up !== prev) signals.push({ index: i, dir: up ? 'buy' : 'sell' })
    prev = up
  }
  const bullPrints = signals.filter((s) => s.dir === 'buy').length
  const bearPrints = signals.length - bullPrints
  // recent swing highs/lows → dashed levels (keep the last few)
  const L = Math.max(1, Math.round(swing))
  const levels: MorphLevel[] = []
  for (let i = L; i < n - L; i++) {
    let isH = true, isL = true
    for (let j = i - L; j <= i + L; j++) { if (j === i) continue; if (highs[j] > highs[i]) isH = false; if (lows[j] < lows[i]) isL = false }
    if (isH) levels.push({ price: highs[i], type: 'res' })
    if (isL) levels.push({ price: lows[i], type: 'sup' })
  }
  return { ma, trendUp, signals, levels, bullPrints, bearPrints }
}

export interface HarmoniaPivot { index: number; price: number }
export interface Harmonia {
  colors: string[]
  shortHighs: HarmoniaPivot[]; shortLows: HarmoniaPivot[]
  intHighs: HarmoniaPivot[]; intLows: HarmoniaPivot[]
  centerline: number
}

/** HSL (h in [0,360), s/l in [0,1]) → "#rrggbb". Pure, no DOM. */
function _hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = ((h % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0, g = 0, b = 0
  if (hp < 1) { r = c; g = x } else if (hp < 2) { r = x; g = c }
  else if (hp < 3) { g = c; b = x } else if (hp < 4) { g = x; b = c }
  else if (hp < 5) { r = x; b = c } else { r = c; b = x }
  const m = l - c / 2
  const to = (v: number): string => {
    const n = Math.round((v + m) * 255)
    const cl = n < 0 ? 0 : n > 255 ? 255 : n
    return cl.toString(16).padStart(2, '0')
  }
  return '#' + to(r) + to(g) + to(b)
}

/**
 * MAGNES heatmap colour ramp. t in [0,1]: 0 → blue (cold/low volume),
 * 1 → red (hot/high volume), through cyan→green→yellow→orange. Pure.
 * hue = 240*(1-t): t=0 → 240° blue, t=1 → 0° red.
 */
export function magnesHeat(t: number): string {
  const tc = Math.max(0, Math.min(1, t))
  return _hslToHex(240 * (1 - tc), 0.9, 0.55)
}

export interface MagnesBucket { priceMid: number; vol: number }
export interface Magnes {
  buckets: MagnesBucket[]
  poc: number
  maxVol: number
  hi: number
  lo: number
  loIdx: number
}

/**
 * MAGNES — invented for Zeus. A volume-by-price profile ("liquidity magnet"):
 * over the last `lookback` bars, sum each bar's volume into `rows` price buckets
 * (bucket chosen by the bar CLOSE, mirroring updateVP). `poc` is the index of the
 * highest-volume bucket (the magnet); `maxVol` its volume. `loIdx` is the index in
 * `closes` where the window starts (closes.length - usedBars) — used as profile anchor.
 * Pure — no DOM, no chart access.
 */
export function magnes(
  highs: number[], lows: number[], closes: number[], volumes: number[],
  rows = 50, lookback = 240
): Magnes {
  const n = closes.length
  const usedBars = Math.min(lookback, n)
  const loIdx = n - usedBars
  if (usedBars <= 0 || rows <= 0) {
    return { buckets: [], poc: -1, maxVol: 0, hi: -Infinity, lo: Infinity, loIdx }
  }
  let hi = -Infinity, lo = Infinity
  for (let i = loIdx; i < n; i++) {
    if (highs[i] > hi) hi = highs[i]
    if (lows[i] < lo) lo = lows[i]
  }
  if (!(hi > lo)) {
    return { buckets: [], poc: -1, maxVol: 0, hi, lo, loIdx }
  }
  const step = (hi - lo) / rows
  const vols = new Array(rows).fill(0)
  let total = 0
  for (let i = loIdx; i < n; i++) {
    const v = volumes[i] || 0
    const idx = Math.min(rows - 1, Math.max(0, Math.floor((closes[i] - lo) / step)))
    vols[idx] += v
    total += v
  }
  if (total <= 0) {
    return { buckets: [], poc: -1, maxVol: 0, hi, lo, loIdx }
  }
  let poc = 0, maxVol = -Infinity
  const buckets: MagnesBucket[] = new Array(rows)
  for (let r = 0; r < rows; r++) {
    buckets[r] = { priceMid: lo + (r + 0.5) * step, vol: vols[r] }
    if (vols[r] > maxVol) { maxVol = vols[r]; poc = r }
  }
  return { buckets, poc, maxVol, hi, lo, loIdx }
}

/**
 * HARMONIA — invented for Zeus. A full-spectrum rainbow candle painter that flows hue
 * across the series (every bar a vivid, distinct colour) plus dual-degree swing pivots:
 * short-term highs/lows (tight lookback) and intermediate highs/lows (wider lookback),
 * each detected as a strict pivot over [i-L, i+L]. `centerline` is the mean close for a
 * faint reference line. Pure — no DOM, no chart access.
 */
export function harmonia(highs: number[], lows: number[], closes: number[], shortLB = 2, intLB = 5, maPeriod = 20): Harmonia {
  const n = closes.length
  const colors: string[] = new Array(n)
  // [COLOUR LOGIC 2026-06-18] Hue is driven by the TREND / long-vs-short state, NOT the bar
  // index (the old `(i*hueStep)%360` was a meaningless moving rainbow). Same vivid palette
  // (_hslToHex at s=0.85 l=0.55) so the colours on the chart are unchanged — only their
  // MEANING is added. Deviation of close from its EMA, self-normalised by recent volatility
  // (ema of |dev|) and squashed with tanh into t∈[0,1]: 0 = strongly bearish/SHORT, 0.5 =
  // neutral, 1 = strongly bullish/LONG. hue = t*240 → SHORT=red, neutral=green, LONG=blue.
  const maP = Math.max(2, Math.round(maPeriod))
  const ma = ema(closes, maP)
  const absDev: number[] = new Array(n)
  for (let i = 0; i < n; i++) { const m = ma[i]; absDev[i] = (m == null || !Number.isFinite(closes[i])) ? 0 : Math.abs(closes[i] - (m as number)) }
  const scale = ema(absDev, maP)
  for (let i = 0; i < n; i++) {
    const m = ma[i]
    if (m == null || !Number.isFinite(closes[i])) { colors[i] = _hslToHex(120, 0.85, 0.55); continue } // warmup → neutral green
    const sc = (scale[i] != null && (scale[i] as number) > 1e-9) ? (scale[i] as number) : Math.max(1e-9, Math.abs(m as number) * 1e-4)
    const t = 0.5 + 0.5 * Math.tanh((closes[i] - (m as number)) / (2 * sc)) // [0,1]; 0.5 = neutral
    colors[i] = _hslToHex(t * 240, 0.85, 0.55)
  }
  const pivots = (L: number): { highs: HarmoniaPivot[]; lows: HarmoniaPivot[] } => {
    const lb = Math.max(1, Math.round(L))
    const hh: HarmoniaPivot[] = [], ll: HarmoniaPivot[] = []
    for (let i = lb; i < n - lb; i++) {
      let isH = true, isL = true
      for (let j = i - lb; j <= i + lb; j++) {
        if (j === i) continue
        if (highs[j] >= highs[i]) isH = false
        if (lows[j] <= lows[i]) isL = false
      }
      if (isH) hh.push({ index: i, price: highs[i] })
      if (isL) ll.push({ index: i, price: lows[i] })
    }
    return { highs: hh, lows: ll }
  }
  const sp = pivots(shortLB), ip = pivots(intLB)
  let sum = 0, cnt = 0
  for (let i = 0; i < n; i++) { if (Number.isFinite(closes[i])) { sum += closes[i]; cnt++ } }
  const centerline = cnt ? sum / cnt : 0
  return { colors, shortHighs: sp.highs, shortLows: sp.lows, intHighs: ip.highs, intLows: ip.lows, centerline }
}

export interface DaimonMark { index: number; kind: 'long' | 'short' | 'exit' }
export interface DaimonView { mood: string; speech: string; position: 'long' | 'short' | 'flat'; justEntered: boolean; markers: DaimonMark[] }

/**
 * DAIMON — the guiding spirit (invented for Zeus). The little chart wizard's BRAIN: it
 * reuses the KRATOS trade engine for its positions (entries → ★ marks, exits → 🔒) and
 * reads volume anomaly (ANEMOI) + confluence (PANTHEON) for its idle moods. Returns the
 * current mood + speech-bubble line, whether a position is open (and which side), if it
 * JUST entered this bar, and the full marker list. The engine animates the sprite from
 * this: walking & talking when flat, hopping onto the candle and shouting when in a trade.
 */
export function daimon(highs: number[], lows: number[], closes: number[], volumes: number[]): DaimonView {
  const n = closes.length
  const trades = kratos(highs, lows, closes, volumes)
  const markers: DaimonMark[] = []
  for (const t of trades) {
    markers.push({ index: t.entryIndex, kind: t.dir })
    if (t.exitReason !== 'open') markers.push({ index: t.exitIndex, kind: 'exit' })
  }
  const open = trades.length && trades[trades.length - 1].exitReason === 'open' ? trades[trades.length - 1] : null
  const position: 'long' | 'short' | 'flat' = open ? open.dir : 'flat'
  const justEntered = !!open && open.entryIndex === n - 1
  const volZ = anemoi(volumes, 20)[n - 1]
  const vz = volZ == null ? 0 : (volZ as number)
  const sc = pantheon(highs, lows, closes, volumes).score[n - 1]
  const score = sc == null ? 0 : sc
  const rsiL = _rsi(closes, 14)[n - 1]
  const rsiV = isNaN(rsiL) ? 50 : rsiL
  const rc = roc(closes, 10)[n - 1]
  const rcV = rc == null ? 0 : (rc as number)
  let mood: string, speech: string
  if (position === 'short') { mood = 'short'; speech = justEntered ? 'heeey, short here! 🔻🪄' : 'riding short… 🔻' }
  else if (position === 'long') { mood = 'long'; speech = justEntered ? 'heeey, long here! 🚀🪄' : 'riding long… 🚀' }
  else if (vz > 2.5) { mood = 'bigvol'; speech = 'ooo BIG volume! 👀' }
  else if (score > 0.7) { mood = 'euphoria'; speech = 'to the moon?! 🚀🌙' }
  else if (score < -0.7) { mood = 'panic'; speech = 'scared money out! 😱' }
  else if (rcV > 3) { mood = 'pump'; speech = 'this is pumping! 🤑' }
  else if (rcV < -3) { mood = 'dump'; speech = 'dumping hard! 📉' }
  else if (rsiV > 72) { mood = 'overbought'; speech = 'overbought… 🥵' }
  else if (rsiV < 28) { mood = 'oversold'; speech = 'oversold… 🥶' }
  else if (vz > 1.5) { mood = 'excited'; speech = 'volume waking up… 👀' }
  else if (score > 0.4) { mood = 'bull'; speech = 'looks bullish… 🤔' }
  else if (score < -0.4) { mood = 'bear'; speech = 'bearish vibes… 😟' }
  else {
    mood = 'idle'
    const lines = ['im waiting… 😴', 'reading the chart… 🔮', 'hmm, patience… 🧐', 'nothing yet… ☕', 'so quiet here… 🥱', 'scanning… 🔍']
    speech = lines[n % lines.length]
  }
  return { mood, speech, position, justEntered, markers }
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

// [2026-06-18] HYPERION — TSI-style dual-line momentum oscillator (Zeus original).
// Double-smoothed True Strength Index: a fast momentum line + an EMA signal line,
// oscillating around 0 in roughly the -100..100 range. Drives the green-top/red-bottom
// intensifying glow sub-pane in the engine.
export interface Hyperion { fast: (number | null)[]; signal: (number | null)[] }
export function hyperion(closes: number[], longP = 25, shortP = 13, signalP = 9): Hyperion {
  const n = closes.length
  const lP = Math.max(1, Math.round(longP))
  const sP = Math.max(1, Math.round(shortP))
  const sigP = Math.max(1, Math.round(signalP))
  // momentum + absolute momentum (m[0]=0)
  const m: number[] = new Array(n)
  const am: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const d = i === 0 ? 0 : closes[i] - closes[i - 1]
    m[i] = d
    am[i] = Math.abs(d)
  }
  // doubleSmooth(x) = ema(ema(x, longP), shortP)
  const doubleSmooth = (x: number[]): (number | null)[] => {
    const e1 = ema(x, lP)
    const e1f = e1.map((v) => (v == null ? 0 : v))
    return ema(e1f, sP)
  }
  const dsM = doubleSmooth(m)
  const dsAM = doubleSmooth(am)
  const fast: (number | null)[] = new Array(n).fill(null)
  // warm-up: only emit once both EMAs are warm (i >= longP-1 + shortP-1)
  const warm = (lP - 1) + (sP - 1)
  const fastFinite: number[] = []
  for (let i = 0; i < n; i++) {
    if (i < warm || dsM[i] == null || dsAM[i] == null) continue
    const denom = dsAM[i] as number
    const v = denom === 0 ? 0 : (100 * (dsM[i] as number)) / denom
    fast[i] = v
    fastFinite.push(v)
  }
  // signal = ema(fast, signalP) — computed over the finite (warmed) fast values,
  // re-aligned back to the original indices that carried a fast value.
  const signal: (number | null)[] = new Array(n).fill(null)
  if (fastFinite.length) {
    const sigFinite = ema(fastFinite, sigP)
    let k = 0
    for (let i = 0; i < n; i++) {
      if (fast[i] == null) continue
      const sv = sigFinite[k]
      if (sv != null) signal[i] = sv
      k++
    }
  }
  return { fast, signal }
}

// [2026-06-18] KRONOS — MACD-style dual-line crossover oscillator (Zeus original).
// macd = ema(closes, fastP) - ema(closes, slowP); signal = ema(macd, signalP).
// Output arrays aligned 1:1 to closes.length; null during warmup.
export interface Kronos { macd: (number | null)[]; signal: (number | null)[] }
export function kronos(closes: number[], fastP = 12, slowP = 26, signalP = 9): Kronos {
  const n = closes.length
  const fP = Math.max(1, Math.round(fastP))
  const sP = Math.max(1, Math.round(slowP))
  const sigP = Math.max(1, Math.round(signalP))
  const emaFast = ema(closes, fP)
  const emaSlow = ema(closes, sP)
  const macd: (number | null)[] = new Array(n).fill(null)
  const macdFinite: number[] = []
  for (let i = 0; i < n; i++) {
    if (emaFast[i] == null || emaSlow[i] == null) continue
    const v = (emaFast[i] as number) - (emaSlow[i] as number)
    macd[i] = v
    macdFinite.push(v)
  }
  // signal = ema(macd, signalP) over the non-null macd values, re-aligned back to the
  // original indices that carried a macd value.
  const signal: (number | null)[] = new Array(n).fill(null)
  if (macdFinite.length) {
    const sigFinite = ema(macdFinite, sigP)
    let k = 0
    for (let i = 0; i < n; i++) {
      if (macd[i] == null) continue
      const sv = sigFinite[k]
      if (sv != null) signal[i] = sv
      k++
    }
  }
  return { macd, signal }
}

// ═══════════════════════════════════════════════════════════════
// BOREAS — SuperTrend trend-follower (main-chart overlay).
// Returns the trend line value, the active direction per bar, and the
// list of flip bars (where direction changed). Aligned to closes.length.
// ═══════════════════════════════════════════════════════════════
export interface Boreas {
  trend: (number | null)[]
  dir: ('up' | 'down' | null)[]
  flips: { index: number; dir: 'up' | 'down' }[]
}
export function boreas(highs: number[], lows: number[], closes: number[], atrPeriod = 10, mult = 3): Boreas {
  const n = closes.length
  const p = Math.max(1, Math.round(atrPeriod))
  const m = Number(mult) || 3
  const trend: (number | null)[] = new Array(n).fill(null)
  const dir: ('up' | 'down' | null)[] = new Array(n).fill(null)
  const flips: { index: number; dir: 'up' | 'down' }[] = []
  if (n === 0) return { trend, dir, flips }

  // True Range
  const tr: number[] = new Array(n).fill(0)
  tr[0] = highs[0] - lows[0]
  for (let i = 1; i < n; i++) {
    const hl = highs[i] - lows[i]
    const hc = Math.abs(highs[i] - closes[i - 1])
    const lc = Math.abs(lows[i] - closes[i - 1])
    tr[i] = Math.max(hl, hc, lc)
  }
  // ATR — Wilder smoothing seeded with the SMA of the first `p` TR values.
  const atr: (number | null)[] = new Array(n).fill(null)
  if (n >= p) {
    let sum = 0
    for (let i = 0; i < p; i++) sum += tr[i]
    atr[p - 1] = sum / p
    for (let i = p; i < n; i++) {
      atr[i] = ((atr[i - 1] as number) * (p - 1) + tr[i]) / p
    }
  }

  const finalUpper: (number | null)[] = new Array(n).fill(null)
  const finalLower: (number | null)[] = new Array(n).fill(null)
  let prevDir: 'up' | 'down' = 'up'

  for (let i = 0; i < n; i++) {
    const a = atr[i]
    if (a == null) continue
    const hl2 = (highs[i] + lows[i]) / 2
    const upperBand = hl2 + m * a
    const lowerBand = hl2 - m * a

    const pfu = finalUpper[i - 1]
    const pfl = finalLower[i - 1]
    // First valid bar: no carry, bands seed directly.
    if (pfu == null || pfl == null) {
      finalUpper[i] = upperBand
      finalLower[i] = lowerBand
      prevDir = 'up'
      dir[i] = 'up'
      trend[i] = finalLower[i]
      continue
    }
    finalUpper[i] = (upperBand < pfu || closes[i - 1] > pfu) ? upperBand : pfu
    finalLower[i] = (lowerBand > pfl || closes[i - 1] < pfl) ? lowerBand : pfl

    // Direction rule (standard SuperTrend): flip up when close pierces above
    // the prior final upper band; flip down when it pierces below the prior
    // final lower band; otherwise carry the previous direction.
    let d: 'up' | 'down' = prevDir
    if (prevDir === 'down' && closes[i] > pfu) d = 'up'
    else if (prevDir === 'up' && closes[i] < pfl) d = 'down'

    if (d !== prevDir) flips.push({ index: i, dir: d })
    dir[i] = d
    trend[i] = d === 'up' ? finalLower[i] : finalUpper[i]
    prevDir = d
  }

  return { trend, dir, flips }
}

/**
 * MENTOR (FX Market Code / MarCo): a 50-period SMA trend filter that recolours
 * candles into 4 states (bright/dark green above the MA, bright/dark red below),
 * plus an OsMA momentum histogram (MACD − signal) with its own 4-state colour.
 *
 * State codes are NUMBERS (never strings): 2 = bright green, 1 = dark green,
 * -2 = bright red, -1 = dark red, null during warm-up. The engine maps these to
 * hex colours; keeping them numeric avoids string/number comparison pitfalls.
 */
export interface MentorResult {
  ma: (number | null)[]
  candleState: (number | null)[]
  osma: (number | null)[]
  osmaState: (number | null)[]
}

export function mentor(
  closes: number[],
  maPeriod = 50,
  fast = 12,
  slow = 26,
  sigP = 9
): MentorResult {
  const n = closes.length
  const ma = sma(closes, maPeriod)

  // ── Part A: candle state vs the 50MA ─────────────────────────────────────
  const candleState: (number | null)[] = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    const m = ma[i]
    if (m == null) continue
    const up = closes[i] > m
    const dist = Math.abs(closes[i] - m)
    const pm = i > 0 ? ma[i - 1] : null
    if (pm == null) {
      // First valid bar (no prior distance) → bright state by direction.
      candleState[i] = up ? 2 : -2
      continue
    }
    const prevDist = Math.abs(closes[i - 1] - pm)
    const away = dist >= prevDist
    candleState[i] = up ? (away ? 2 : 1) : (away ? -2 : -1)
  }

  // ── Part B: OsMA = MACD − signal ─────────────────────────────────────────
  const macdLine = ema(closes, fast)
  const slowLine = ema(closes, slow)
  const macd: number[] = []
  const macdIdx: number[] = []
  const macdAll: (number | null)[] = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    if (macdLine[i] == null || slowLine[i] == null) continue
    const v = (macdLine[i] as number) - (slowLine[i] as number)
    macdAll[i] = v
    macd.push(v)
    macdIdx.push(i)
  }
  // Signal = EMA of the compacted MACD series; realign to original indices.
  const sig = ema(macd, sigP)
  const signalAll: (number | null)[] = new Array(n).fill(null)
  for (let k = 0; k < sig.length; k++) {
    if (sig[k] != null) signalAll[macdIdx[k]] = sig[k]
  }

  const osma: (number | null)[] = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    if (macdAll[i] == null || signalAll[i] == null) continue
    osma[i] = (macdAll[i] as number) - (signalAll[i] as number)
  }

  const osmaState: (number | null)[] = new Array(n).fill(null)
  let prevOsma: number | null = null
  for (let i = 0; i < n; i++) {
    const v = osma[i]
    if (v == null) continue
    if (prevOsma == null) {
      osmaState[i] = v >= 0 ? 2 : -2
    } else if (v >= 0) {
      osmaState[i] = v > prevOsma ? 2 : 1
    } else {
      osmaState[i] = v < prevOsma ? -2 : -1
    }
    prevOsma = v
  }

  return { ma, candleState, osma, osmaState }
}

// ═══════════════════════════════════════════════════════════════
// EUNOMIA — RSX-NRP recreation (Zeus original). A Jurik/RSX-style
// VERY-smooth RSI: take Wilder RSI(closes, period), then double-smooth
// it with two EMA passes (smooth) → a glassy 0..100 oscillator. We also
// expose the per-bar slope (rising) and a tri-state momentum strip used
// for the centre signal band (1 = green/bullish, 0 = yellow/neutral,
// -1 = red/bearish). strip is NUMERIC tri-state — never compared to strings.
// All arrays aligned 1:1 to closes.length; null during warmup.
// ═══════════════════════════════════════════════════════════════
export interface Eunomia {
  rsx: (number | null)[]
  rising: (boolean | null)[]
  strip: (number | null)[]
}
export function eunomia(closes: number[], period = 14, smooth = 7): Eunomia {
  const n = closes.length
  const p = Math.max(2, Math.round(period))
  const sm = Math.max(1, Math.round(smooth))
  const rsx: (number | null)[] = new Array(n).fill(null)
  const rising: (boolean | null)[] = new Array(n).fill(null)
  const strip: (number | null)[] = new Array(n).fill(null)
  if (n === 0) return { rsx, rising, strip }

  // Wilder RSI → NaN during warmup. Computed inline so that a no-movement
  // window (avg gain == avg loss == 0) resolves to a neutral 50 rather than the
  // 100 artifact of the divide-by-zero convention — a flat tape is chop, not a rally.
  const rawRsi: number[] = new Array(n).fill(NaN)
  {
    let ag = 0, al = 0
    for (let i = 1; i < n; i++) {
      const ch = closes[i] - closes[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0)
      if (i <= p) {
        ag += g; al += l
        if (i === p) { ag /= p; al /= p; rawRsi[i] = (ag === 0 && al === 0) ? 50 : (al === 0 ? 100 : 100 - 100 / (1 + ag / al)) }
      } else {
        ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p
        rawRsi[i] = (ag === 0 && al === 0) ? 50 : (al === 0 ? 100 : 100 - 100 / (1 + ag / al))
      }
    }
  }
  const finite: number[] = []
  const idx: number[] = []
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(rawRsi[i])) { finite.push(rawRsi[i]); idx.push(i) }
  }
  if (finite.length) {
    const e1 = ema(finite, sm)
    const e1f = e1.map((v) => (v == null ? 0 : v))
    const e2 = ema(e1f, sm)
    for (let k = 0; k < e2.length; k++) {
      const v = e2[k]
      if (v == null) continue
      rsx[idx[k]] = Math.max(0, Math.min(100, v)) // clamp [0,100]
    }
  }

  for (let i = 0; i < n; i++) {
    const v = rsx[i]
    if (v == null) continue
    const prev = rsx[i - 1]
    // rising: spec definition (>= prev). null when no prior value.
    const ris = prev == null ? null : v >= (prev as number)
    rising[i] = ris
    // Slope with an epsilon dead-band so a genuinely FLAT curve sits in the
    // neutral zone (chop → yellow), while saturated extremes still colour by zone.
    const EPS = 0.05
    const MID = 0.5 // dead-band around the 50 mid-line → chop stays yellow
    const slope = prev == null ? 0 : v - (prev as number)
    const climbing = slope > EPS
    const falling = slope < -EPS
    // tri-state momentum: green bullish / red bearish / yellow neutral.
    // Upper zone + not falling = bullish (green); lower zone + not rising = bearish
    // (red); the mid dead-band, or a stall against the trend, stays neutral (yellow).
    if (v > 50 + MID && !falling) strip[i] = 1
    else if (v < 50 - MID && !climbing) strip[i] = -1
    else strip[i] = 0
  }
  return { rsx, rising, strip }
}

export interface Metis {
  rsi: (number | null)[]
  green: (number | null)[]
  red: (number | null)[]
  yellow: (number | null)[]
  upper: (number | null)[]
  lower: (number | null)[]
  candleState: (number | null)[]
  signal: (number | null)[]
}

/**
 * METIS — Traders Dynamic Index (TDI-RSI [loxx] look). Zeus original.
 * Wilder RSI on a 0–100 scale, smoothed into the green RSI-price line,
 * red trade-signal line and yellow market-base line; volatility bands are
 * SMA(baseP) ± 1.6185·stdev(baseP). candleState/signal are numeric only.
 */
export function metis(
  closes: number[],
  rsiPeriod = 13,
  priceP = 2,
  signalP = 7,
  baseP = 34
): Metis {
  const n = closes.length
  const rp = Math.max(1, Math.round(rsiPeriod))
  // --- Wilder RSI (inline; no exported helper) ---
  const rsi: (number | null)[] = new Array(n).fill(null)
  if (n > rp) {
    let avgGain = 0
    let avgLoss = 0
    for (let i = 1; i <= rp; i++) {
      const ch = closes[i] - closes[i - 1]
      if (ch >= 0) avgGain += ch
      else avgLoss += -ch
    }
    avgGain /= rp
    avgLoss /= rp
    const rsiAt = (g: number, l: number): number => {
      if (g === 0 && l === 0) return 50 // flat tape — no div-by-zero
      if (l === 0) return 100
      const rs = g / l
      return 100 - 100 / (1 + rs)
    }
    rsi[rp] = rsiAt(avgGain, avgLoss)
    for (let i = rp + 1; i < n; i++) {
      const ch = closes[i] - closes[i - 1]
      const gain = ch >= 0 ? ch : 0
      const loss = ch < 0 ? -ch : 0
      avgGain = (avgGain * (rp - 1) + gain) / rp
      avgLoss = (avgLoss * (rp - 1) + loss) / rp
      rsi[i] = rsiAt(avgGain, avgLoss)
    }
  }

  // Smoothings reuse sma over the (sparse) rsi series. Treat null as a gap:
  // build a finite-only series with index mapping so warmup nulls don't poison.
  const rsiNums: number[] = []
  const idxMap: number[] = []
  for (let i = 0; i < n; i++) {
    if (rsi[i] != null) { rsiNums.push(rsi[i] as number); idxMap.push(i) }
  }
  const remap = (compact: (number | null)[]): (number | null)[] => {
    const out: (number | null)[] = new Array(n).fill(null)
    for (let k = 0; k < compact.length; k++) {
      if (compact[k] != null) out[idxMap[k]] = compact[k]
    }
    return out
  }

  const green = remap(sma(rsiNums, Math.max(1, Math.round(priceP))))
  const red = remap(sma(rsiNums, Math.max(1, Math.round(signalP))))
  const bp = Math.max(1, Math.round(baseP))
  const mid = sma(rsiNums, bp)
  // rolling stdev of rsi over baseP
  const sdCompact: (number | null)[] = new Array(rsiNums.length).fill(null)
  for (let k = 0; k < rsiNums.length; k++) {
    if (k < bp - 1 || mid[k] == null) continue
    let acc = 0
    const m = mid[k] as number
    for (let j = k - bp + 1; j <= k; j++) {
      const d = rsiNums[j] - m
      acc += d * d
    }
    sdCompact[k] = Math.sqrt(acc / bp)
  }
  const yellow = remap(mid)
  const upperCompact: (number | null)[] = mid.map((m, k) =>
    m == null || sdCompact[k] == null ? null : (m as number) + 1.6185 * (sdCompact[k] as number)
  )
  const lowerCompact: (number | null)[] = mid.map((m, k) =>
    m == null || sdCompact[k] == null ? null : (m as number) - 1.6185 * (sdCompact[k] as number)
  )
  const upper = remap(upperCompact)
  const lower = remap(lowerCompact)

  // candleState: 2 brightGreen / 1 lightGreen / -2 brightRed / -1 lightRed
  const candleState: (number | null)[] = new Array(n).fill(null)
  const signal: (number | null)[] = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    const g = green[i]
    const r = red[i]
    const y = yellow[i]
    if (g == null || r == null || y == null) continue
    const gn = g as number
    const rn = r as number
    const yn = y as number
    // green vs red splits bullish/bearish; ties (e.g. saturated extremes where
    // both pin at 0/100) resolve to the green family so a strong uptrend never
    // reads red. Strict gn<rn is the only path into the red family.
    candleState[i] = gn >= rn ? (gn >= yn ? 2 : 1) : gn < yn ? -2 : -1
    // crossover signals (numeric only)
    const pg = green[i - 1]
    const pr = red[i - 1]
    if (pg != null && pr != null) {
      const pgn = pg as number
      const prn = pr as number
      if (pgn <= prn && gn > rn && rn < 50) signal[i] = 1 // long, lower zone
      else if (pgn >= prn && gn < rn && rn > 50) signal[i] = -1 // short, upper zone
      else signal[i] = 0
    }
  }

  return { rsi, green, red, yellow, upper, lower, candleState, signal }
}

/**
 * APOLLO heat ramp — gradient bar colouring by signal strength. t in [0,1]:
 * 0 → red hue (oversold/weak), 1 → green hue 120 (overbought/strong-bull),
 * passing through orange/yellow at the midpoint. Pure.
 */
export function apolloHeat(t: number): string {
  return _hslToHex(Math.max(0, Math.min(1, t)) * 120, 0.85, 0.5)
}

export interface Apollo {
  rsi: (number | null)[]
  rising: (boolean | null)[]
  fib236: (number | null)[]
  fib382: (number | null)[]
  fib618: (number | null)[]
  fib786: (number | null)[]
  mid: (number | null)[]
  signal: (number | null)[]
}

/**
 * APOLLO — Variety RSI with a Fibonacci Auto-Channel (recreation of
 * "Variety RSI w/ Fibonacci Auto Channel [Loxx]"). Wilder RSI drives a fan of
 * four Fibonacci channel lines computed from the RSI's own rolling range over
 * `lookback` bars (hh=max, ll=min, range=hh-ll). The channel levels sit at
 * 23.6/38.2/61.8/78.6% of the range; `mid` (50%) is the signal line. A BUY (1)
 * fires when RSI crosses up through `mid` in the lower zone, a SELL (-1) when it
 * crosses down through `mid` in the upper zone. All states numeric (never
 * string-compared). Arrays aligned 1:1 with `closes`; warm-up = null.
 */
export function apollo(closes: number[], rsiPeriod = 14, lookback = 50): Apollo {
  const n = closes.length
  const lb = Math.max(2, Math.round(lookback))
  const rp = Math.max(2, Math.round(rsiPeriod))
  // Wilder RSI inline: a no-movement window (avg gain == avg loss == 0) resolves
  // to a neutral 50 rather than the div0 edge; warm-up slots stay null.
  const rsi: (number | null)[] = new Array(n).fill(null)
  let ag = 0, al = 0
  for (let i = 1; i < n; i++) {
    const ch = closes[i] - closes[i - 1]
    const g = ch > 0 ? ch : 0
    const l = ch < 0 ? -ch : 0
    if (i <= rp) {
      ag += g; al += l
      if (i === rp) {
        ag /= rp; al /= rp
        rsi[i] = (ag === 0 && al === 0) ? 50 : (al === 0 ? 100 : 100 - 100 / (1 + ag / al))
      }
    } else {
      ag = (ag * (rp - 1) + g) / rp
      al = (al * (rp - 1) + l) / rp
      rsi[i] = (ag === 0 && al === 0) ? 50 : (al === 0 ? 100 : 100 - 100 / (1 + ag / al))
    }
  }

  const rising: (boolean | null)[] = new Array(n).fill(null)
  const fib236: (number | null)[] = new Array(n).fill(null)
  const fib382: (number | null)[] = new Array(n).fill(null)
  const fib618: (number | null)[] = new Array(n).fill(null)
  const fib786: (number | null)[] = new Array(n).fill(null)
  const mid: (number | null)[] = new Array(n).fill(null)
  const signal: (number | null)[] = new Array(n).fill(null)

  let prevValid = -1 // index of previous non-null rsi (for rising + crossing)
  for (let i = 0; i < n; i++) {
    const v = rsi[i]
    if (v == null) continue

    // rolling range over the available defined rsi values within [i-lb+1, i]
    let hh = -Infinity, ll = Infinity
    for (let j = Math.max(0, i - lb + 1); j <= i; j++) {
      const rv = rsi[j]
      if (rv == null) continue
      if (rv > hh) hh = rv
      if (rv < ll) ll = rv
    }
    if (!Number.isFinite(hh) || !Number.isFinite(ll)) { prevValid = i; continue }
    const range = hh - ll
    const m = ll + range * 0.5
    fib236[i] = ll + range * 0.236
    fib382[i] = ll + range * 0.382
    fib618[i] = ll + range * 0.618
    fib786[i] = ll + range * 0.786
    mid[i] = m

    if (prevValid >= 0) {
      const pv = rsi[prevValid] as number
      rising[i] = v >= pv
      const pm = mid[prevValid]
      if (pm != null) {
        const pmn = pm as number
        // BUY: cross up through mid while in the lower zone (rsi < 50)
        if (pv <= pmn && v > m && v < 50) signal[i] = 1
        // SELL: cross down through mid while in the upper zone (rsi > 50)
        else if (pv >= pmn && v < m && v > 50) signal[i] = -1
        else signal[i] = 0
      } else {
        signal[i] = 0
      }
    }
    prevValid = i
  }

  return { rsi, rising, fib236, fib382, fib618, fib786, mid, signal }
}

// [2026-06-23] ASTRAPE ⚡ — Storm Charge & Ignition oscillator (Zeus original, backtest-calibrated).
// Treats the market like a storm building electric charge. A backtest over 25,704 real-kline
// samples (6 symbols × 3 TFs) found big moves EXPLODE out of compression — ATR below its 50-avg
// (strongest signal, −0.39σ before up-moves) with volume building (volRatio ~1.11); the breakout
// candle gives direction. So ASTRAPE measures the loading (compression + volume = "charge"), and
// flashes IGNITION when a coiled prior bar EXPANDS — green up / red down. States:
//   IGNITE_UP/DOWN ⚡  coiled→expansion breakout (the money signal)
//   ACCUM   🟡        compressed, charging (energy coiling, no direction yet)
//   DISTRIB 🟣        trend whose candle pressure opposes it (a trap forming)
//   UP / DOWN 🟢🔴    plain directional drift
//   COOL    🔵        discharged / chop — stand aside
export type AstrapeState = 'IGNITE_UP' | 'IGNITE_DOWN' | 'ACCUM' | 'DISTRIB' | 'UP' | 'DOWN' | 'COOL'
export interface Astrape { charge: (number | null)[]; state: (AstrapeState | null)[]; ignite: boolean[] }

export function astrape(
  highs: number[], lows: number[], closes: number[], volumes: number[],
  atrP = 14, atrAvgP = 50, volP = 20, rangeP = 20,
): Astrape {
  const n = closes.length
  const charge: (number | null)[] = new Array(n).fill(null)
  const state: (AstrapeState | null)[] = new Array(n).fill(null)
  const ignite: boolean[] = new Array(n).fill(false)
  if (n === 0) return { charge, state, ignite }

  // Backtest-calibrated constants. Compression dominates (W_COMP > W_VOL) per the data.
  // Compression score maps the REAL discriminating band from the backtest: normal atr/atrAvg
  // ≈ 1.05, pre-big-move ≈ 0.92 (a narrow but robust −0.39σ separation). So COMP_HI=1.05 (no
  // charge) → COMP_LO=0.85 (fully coiled). A flat COMP_REF=1.0 linear map would read ~0 on real
  // data; this band makes the score meaningful where moves actually originate.
  const COMP_HI = 1.05, COMP_LO = 0.85
  const COIL_THR = 0.45    // compScore at/above = clearly compressed (compress <= ~0.96)
  const VOL_SPAN = 1.4     // volRatio 1..(1+SPAN) -> 0..1
  const W_COMP = 0.72, W_VOL = 0.28
  const CHARGE_THR = 55    // loaded spring (compression + volume intensity)
  const EXP_THR = 1.6      // breakout candle: range >= EXP_THR × its 20-avg
  const MOM_TREND = 0.004  // ROC10 magnitude for a plain trend bar

  const at = atr(highs, lows, closes, atrP)
  const atFilled = at.map((x) => (x == null ? 0 : x))
  const atAvg = sma(atFilled, atrAvgP)
  const ranges = highs.map((h, i) => h - lows[i])
  const rangeAvg = sma(ranges, rangeP)
  const volAvg = sma(volumes, volP)
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

  const compScoreArr: (number | null)[] = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    const a = at[i], aAvg = atAvg[i], rAvg = rangeAvg[i], vAvg = volAvg[i]
    if (a == null || aAvg == null || aAvg <= 0 || rAvg == null || rAvg <= 0 || vAvg == null || vAvg <= 0) continue
    const compress = a / aAvg
    const volRatio = volumes[i] / vAvg
    const rangeExp = ranges[i] / rAvg
    const clp = ranges[i] > 0 ? (closes[i] - lows[i]) / ranges[i] : 0.5
    const bodyDir = 2 * clp - 1                                   // -1..1 close position in range
    const mom = i >= 10 && closes[i - 10] ? (closes[i] - closes[i - 10]) / closes[i - 10] : 0

    const compScore = clamp01((COMP_HI - compress) / (COMP_HI - COMP_LO))
    const volScore = clamp01((volRatio - 1) / VOL_SPAN)
    compScoreArr[i] = compScore
    const ch = 100 * clamp01(W_COMP * compScore + W_VOL * volScore)
    charge[i] = +ch.toFixed(1)

    const coiledPrev = compScoreArr[i - 1] != null && (compScoreArr[i - 1] as number) >= COIL_THR
    const expanding = rangeExp >= EXP_THR
    const diverge = Math.abs(mom) > MOM_TREND && Math.sign(bodyDir) === -Math.sign(mom) && Math.abs(bodyDir) > 0.3

    let st: AstrapeState
    if (coiledPrev && expanding) { st = bodyDir >= 0 ? 'IGNITE_UP' : 'IGNITE_DOWN'; ignite[i] = true }
    else if (compScore >= COIL_THR || ch >= CHARGE_THR) st = 'ACCUM'
    else if (diverge) st = 'DISTRIB'
    else if (Math.abs(mom) >= MOM_TREND) st = mom > 0 ? 'UP' : 'DOWN'
    else st = 'COOL'
    state[i] = st
  }
  return { charge, state, ignite }
}
