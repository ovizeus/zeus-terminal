/**
 * Alert rules — the decisions behind the alert switches.
 *
 * [2026-11-08] An audit found 16 of the 20 alert settings had NO reader at
 * all: checkboxes on screen wired to nothing. These are the rules that make
 * them mean something.
 *
 * They live here, pure, for one reason: a rule buried inside a websocket
 * handler is a rule nobody can check, and that is exactly how the originals
 * came to be connected to nothing. Everything here takes numbers and returns a
 * decision. The wiring supplies the data; this file decides.
 *
 * Two conventions throughout:
 *   - An UNSET flag means ON for the things the panel always showed ticked,
 *     and OFF for the two it showed unticked (hidden divergences, whale
 *     removals). "Never chosen" must not silently become "turned off".
 *   - Nothing here throws. These run on every tick of live market data, and an
 *     exception in a rule would take the feed down with it.
 */

/**
 * Volume per candle, in the quote asset's base units, used when the setting is
 * missing or unusable. The control on screen is labelled "Threshold (BTC per
 * candle)", so the rule is ABSOLUTE volume - not a multiple of the average.
 * My first version compared against the average; the label is what the user
 * sets, so the label wins. The average still goes into the alert TEXT, where
 * "3.2x the usual" is the part that tells him whether to care.
 */
export const DEFAULT_VOL_THRESHOLD = 500
/** Contracts/coins used when the whale minimum is missing or unusable. */
export const DEFAULT_WHALE_MIN = 100
/** Bars either side of a swing point. */
export const DEFAULT_SWING_WIDTH = 3

function _num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : null
}

/** True unless explicitly set to false. */
function _on(v: unknown): boolean { return v !== false }
/** False unless explicitly set to true. */
function _off(v: unknown): boolean { return v === true }

// ─────────────────────────────────────────────────────────────── volume spike

/**
 * How many times the average the LAST bar's volume is.
 *
 * The average deliberately excludes the last bar: including a spike in its own
 * average is how a tenfold spike reads as a modest 1.2x and never fires.
 * Returns null when there is not enough history, or when the earlier bars have
 * no volume at all to compare against.
 */
export function volumeSpikeRatio(volumes: Array<number | null | undefined>, lookback = 20): number | null {
  if (!Array.isArray(volumes) || volumes.length < 6) return null
  const vals: number[] = []
  for (const v of volumes) { const n = _num(v); if (n !== null && n >= 0) vals.push(n) }
  if (vals.length < 6) return null
  const last = vals[vals.length - 1]
  const prior = vals.slice(Math.max(0, vals.length - 1 - lookback), vals.length - 1)
  if (prior.length < 5) return null
  const avg = prior.reduce((a, b) => a + b, 0) / prior.length
  if (!(avg > 0)) return null
  return last / avg
}

/**
 * How far above its own average a bar must be before it is a SPIKE.
 *
 * [2026-11-08, found live] The first version fired on the absolute threshold
 * alone, because the control is labelled "Threshold (BTC per candle)". On
 * BTCUSDT 4h, where every candle is thousands, that fired constantly - and the
 * alert text said so out loud: "3,511 - 0.2x the usual". A fifth of normal
 * volume announced as a spike.
 *
 * The label is still honoured as a FLOOR, which is what a minimum size is for:
 * it keeps thin markets quiet. But a thing called a spike has to actually be
 * one, so it must also stand above its own recent average. Both conditions, or
 * the word on the alert is a lie.
 */
export const SPIKE_RATIO = 2

export function shouldVolAlert(
  volume: number | null | undefined,
  threshold?: number | null,
  ratio?: number | null,
): boolean {
  const v = _num(volume)
  if (v === null || v <= 0) return false
  let t = _num(threshold)
  if (t === null || t <= 0) t = DEFAULT_VOL_THRESHOLD
  if (v < t) return false
  const r = _num(ratio)
  // No average yet (a fresh symbol, too little history) means no claim either
  // way - and claiming "spike" is the louder, worse mistake.
  if (r === null) return false
  return r >= SPIKE_RATIO
}

// ───────────────────────────────────────────────────────────────── divergences

export interface Swings { highs: number[]; lows: number[] }

/** Indices that are the extreme over ±width bars. */
export function findSwings(highs: number[], lows: number[], width = DEFAULT_SWING_WIDTH): Swings {
  const out: Swings = { highs: [], lows: [] }
  if (!Array.isArray(highs) || !Array.isArray(lows)) return out
  const n = Math.min(highs.length, lows.length)
  const W = Math.max(1, Math.round(width))
  for (let i = W; i < n - W; i++) {
    let isH = Number.isFinite(highs[i]), isL = Number.isFinite(lows[i])
    for (let j = i - W; j <= i + W && (isH || isL); j++) {
      if (j === i) continue
      if (highs[j] > highs[i]) isH = false
      if (lows[j] < lows[i]) isL = false
    }
    if (isH) out.highs.push(i)
    if (isL) out.lows.push(i)
  }
  return out
}

export interface DivergenceHit {
  index: number
  prevIndex: number
  dir: 'bull' | 'bear'
  /** A hidden (continuation) divergence rather than a regular one. */
  hidden: boolean
}

/**
 * Compares consecutive same-type swings in price against a momentum series.
 *
 *   regular bear  — price higher high, momentum lower high  (rally is hollow)
 *   regular bull  — price lower low,  momentum higher low   (selling spent)
 *   hidden bear   — price lower high, momentum higher high  (continuation)
 *   hidden bull   — price higher low, momentum lower low
 */
export function findDivergences(
  highs: number[], lows: number[], mom: Array<number | null | undefined>,
  width = DEFAULT_SWING_WIDTH,
): DivergenceHit[] {
  const out: DivergenceHit[] = []
  if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(mom)) return out
  const n = Math.min(highs.length, lows.length, mom.length)
  if (n < 5) return out
  const sw = findSwings(highs.slice(0, n), lows.slice(0, n), width)
  const m = (i: number) => _num(mom[i])

  for (let k = 1; k < sw.highs.length; k++) {
    const i = sw.highs[k], p = sw.highs[k - 1]
    const mi = m(i), mp = m(p)
    if (mi === null || mp === null) continue
    if (highs[i] > highs[p] && mi < mp) out.push({ index: i, prevIndex: p, dir: 'bear', hidden: false })
    else if (highs[i] < highs[p] && mi > mp) out.push({ index: i, prevIndex: p, dir: 'bear', hidden: true })
  }
  for (let k = 1; k < sw.lows.length; k++) {
    const i = sw.lows[k], p = sw.lows[k - 1]
    const mi = m(i), mp = m(p)
    if (mi === null || mp === null) continue
    if (lows[i] < lows[p] && mi > mp) out.push({ index: i, prevIndex: p, dir: 'bull', hidden: false })
    else if (lows[i] > lows[p] && mi < mp) out.push({ index: i, prevIndex: p, dir: 'bull', hidden: true })
  }
  return out.sort((a, b) => a.index - b.index)
}

export interface DivFlags {
  divBull?: boolean; divBear?: boolean; divHidden?: boolean
}

export function keepDivergence(hit: DivergenceHit, flags: DivFlags = {}): boolean {
  if (!hit) return false
  if (hit.hidden && !_off(flags.divHidden)) return false
  if (hit.dir === 'bull' && !_on(flags.divBull)) return false
  if (hit.dir === 'bear' && !_on(flags.divBear)) return false
  return true
}

// ──────────────────────────────────────────────────────────────── RSI extremes

export interface RsiFlags { rsiOB?: boolean; rsiOS?: boolean }

/** 'ob' above 70, 'os' below 30, each behind its own switch. */
export function rsiExtremeKind(rsi: number | null | undefined, flags: RsiFlags = {}): 'ob' | 'os' | null {
  const r = _num(rsi)
  if (r === null) return null
  if (r > 70) return _on(flags.rsiOB) ? 'ob' : null
  if (r < 30) return _on(flags.rsiOS) ? 'os' : null
  return null
}

// ─────────────────────────────────────────────────────────────── pivot crosses

export interface LevelCross { level: number; dir: 'up' | 'down' }

/** Levels strictly between the two prices. Touching a level is not crossing it. */
export function crossedLevels(
  prev: number | null | undefined, cur: number | null | undefined,
  levels: Array<number | null | undefined>,
): LevelCross[] {
  const a = _num(prev), b = _num(cur)
  if (a === null || b === null || a === b || !Array.isArray(levels)) return []
  const lo = Math.min(a, b), hi = Math.max(a, b)
  const dir: 'up' | 'down' = b > a ? 'up' : 'down'
  const out: LevelCross[] = []
  for (const lv of levels) {
    const l = _num(lv)
    if (l === null) continue
    if (l > lo && l < hi) out.push({ level: l, dir })
  }
  return out.sort((x, y) => (dir === 'up' ? x.level - y.level : y.level - x.level))
}

// ─────────────────────────────────────────────────────────────── whale orders

export interface BookLevel { p: number; q: number }
export interface WhaleEvent {
  side: 'bid' | 'ask'
  kind: 'added' | 'removed'
  price: number
  qty: number
}

function _map(levels: Array<BookLevel> | null | undefined): Map<number, number> {
  const m = new Map<number, number>()
  if (!Array.isArray(levels)) return m
  for (const l of levels) {
    const p = _num(l?.p), q = _num(l?.q)
    if (p === null || q === null) continue
    m.set(p, q)
  }
  return m
}

/**
 * Whale-sized levels that appeared or vanished between two book snapshots.
 *
 * A level that merely changed size is not news unless it crossed the whale
 * threshold in doing so: a 400 that becomes 420 is noise, a 10 that becomes
 * 500 is a wall going up.
 */
export function whaleEvents(
  prevBids: BookLevel[] | null | undefined, curBids: BookLevel[] | null | undefined,
  prevAsks: BookLevel[] | null | undefined, curAsks: BookLevel[] | null | undefined,
  minQty?: number | null,
): WhaleEvent[] {
  let min = _num(minQty)
  if (min === null || min <= 0) min = DEFAULT_WHALE_MIN
  const out: WhaleEvent[] = []

  const scan = (side: 'bid' | 'ask', prev: BookLevel[] | null | undefined, cur: BookLevel[] | null | undefined) => {
    const a = _map(prev), b = _map(cur)
    for (const [p, q] of b) {
      const was = a.get(p)
      if (q >= (min as number) && !(was !== undefined && was >= (min as number))) {
        out.push({ side, kind: 'added', price: p, qty: q })
      }
    }
    for (const [p, q] of a) {
      if (q < (min as number)) continue
      const now = b.get(p)
      if (now === undefined || now < (min as number)) {
        out.push({ side, kind: 'removed', price: p, qty: q })
      }
    }
  }

  scan('bid', prevBids, curBids)
  scan('ask', prevAsks, curAsks)
  return out
}

export interface WhaleFlags {
  whaleBid?: boolean; whaleAsk?: boolean; whaleRem?: boolean
}

export function keepWhale(ev: WhaleEvent, flags: WhaleFlags = {}): boolean {
  if (!ev) return false
  if (ev.kind === 'removed' && !_off(flags.whaleRem)) return false
  if (ev.side === 'bid' && !_on(flags.whaleBid)) return false
  if (ev.side === 'ask' && !_on(flags.whaleAsk)) return false
  return true
}

// ──────────────────────────────────────────────────────────── momentum series

/** Exponential moving average. NaN until there are enough bars to mean it. */
export function emaSeries(values: Array<number | null | undefined>, period: number): number[] {
  const n = Array.isArray(values) ? values.length : 0
  const out = new Array<number>(n).fill(NaN)
  const P = Math.max(1, Math.round(period))
  if (n < P) return out
  const k = 2 / (P + 1)
  let sum = 0
  for (let i = 0; i < P; i++) {
    const v = _num(values[i])
    if (v === null) return out
    sum += v
  }
  let prev = sum / P
  out[P - 1] = prev
  for (let i = P; i < n; i++) {
    const v = _num(values[i])
    if (v === null) { out[i] = prev; continue }
    prev = v * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

/**
 * The MACD line (fast EMA minus slow EMA), as a series for divergence work.
 *
 * Written here rather than imported from the indicator engine on purpose: that
 * module reaches back into the data layer, and an import cycle between the two
 * would be a far worse problem than twelve lines of EMA.
 */
export function macdLine(closes: Array<number | null | undefined>, fast = 12, slow = 26): number[] {
  const f = emaSeries(closes, fast)
  const sl = emaSeries(closes, slow)
  return f.map((v, i) => (Number.isFinite(v) && Number.isFinite(sl[i]) ? v - sl[i] : NaN))
}

// ───────────────────────────────────────────────────────────────── cooldown

/**
 * Rate limit per key, mutating the map it is given.
 *
 * A clock that jumps backwards (a device waking up, a corrected system time)
 * must not lock an alert out until the clock catches up, so a timestamp in the
 * future is treated as stale.
 */
export function canFire(last: Record<string, number>, key: string, now: number, cooldownMs: number): boolean {
  if (!last || typeof key !== 'string') return false
  const t = _num(last[key])
  const n = _num(now)
  if (n === null) return false
  if (t !== null && t <= n && n - t < cooldownMs) return false
  last[key] = n
  return true
}
