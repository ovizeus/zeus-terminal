// Zeus — engine/fusionMath.ts
// Pure, dependency-free math extracted from confluence.ts + autotrade.ts so the
// brain's confidence logic is unit-testable in isolation.
// NO imports, NO window/DOM access — keep it pure.

/**
 * Lever B — directional factor over LIVE feeds only.
 *
 * `dirs` is the list of per-feed directional votes (e.g. RSI, Supertrend,
 * LongShort, Funding, OpenInterest), each 'bull' | 'bear' | 'neut'.
 *
 * A 'neut' vote means that feed is dead/missing (no data). The old code divided
 * bull votes by the FULL list length, so a dead feed permanently dragged the
 * score down. We now count only live ('bull'|'bear') feeds in the denominator.
 *
 * Fail-closed: if fewer than `minLive` feeds are live, we cannot trust the
 * reading and return 0.5 (neutral) so downstream confidence stays low.
 */
export function dirFactorLive(dirs: string[], minLive = 3): number {
  const live = dirs.filter((d) => d === 'bull' || d === 'bear')
  if (live.length < minLive) return 0.5
  const bull = live.filter((d) => d === 'bull').length
  return bull / live.length
}

/**
 * Lever C — direction-aware, symmetric confluence confidence.
 *
 * `confluence` is a 0..100 bull-magnitude score (100 = strongly bullish,
 * 0 = strongly bearish, 50 = neutral). The old formula (conf-50)/50 clamped to
 * [0,1] only ever rewarded LONGs; a SHORT in a bearish market (low confluence)
 * got 0, so shorts could never build confidence from this axis.
 *
 * Now: a LONG is rewarded when confluence is above 50, a SHORT when it is below
 * 50; disagreement (or neutral direction) yields 0. Result clamped to [0,1].
 */
export function confNDirectional(confluence: number, dir: string): number {
  const signed =
    dir === 'long'
      ? (confluence - 50) / 50
      : dir === 'short'
        ? (50 - confluence) / 50
        : 0
  return Math.max(0, Math.min(1, signed))
}

export type EntryTier = 'LARGE' | 'MEDIUM' | 'SMALL' | 'NO_TRADE'

/**
 * Entry-tier classification — direction-aware on the confluence axis.
 *
 * The tier gate has two conditions per tier: a `confidence` bar (already
 * direction-aware, via confNDirectional inside the fusion) AND a `confluence`
 * bar. The bug: the confluence bar used the RAW bull-magnitude confluence
 * (`confluence >= 60/68/75`). Confluence is high for bullish setups and low for
 * bearish ones, so a SHORT — even a strong one (high confidence, confluence ≈0)
 * — could never clear the confluence bar. Result: AT stopped taking shorts.
 *
 * Fix: mirror the confluence for shorts (`dirConf = 100 - confluence`) so a
 * strongly bearish setup clears the SAME bars a strongly bullish LONG does.
 * For LONGs `dirConf === confluence`, so long behaviour is byte-for-byte
 * unchanged. Thresholds and the `regimeN` LARGE-gate are preserved exactly.
 *
 * @param dir        'long' | 'short' | 'neutral' (anything else → NO_TRADE)
 * @param confidence fused confidence 0..100
 * @param confluence raw bull-magnitude confluence 0..100
 * @param regimeN    regime strength 0..1 (LARGE requires ≥0.55)
 */
export function classifyEntryTier(
  dir: string,
  confidence: number,
  confluence: number,
  regimeN: number,
): EntryTier {
  if (dir !== 'long' && dir !== 'short') return 'NO_TRADE'
  const dirConf = dir === 'long' ? confluence : 100 - confluence
  if (confidence >= 82 && dirConf >= 75 && regimeN >= 0.55) return 'LARGE'
  if (confidence >= 72 && dirConf >= 68) return 'MEDIUM'
  if (confidence >= 62 && dirConf >= 60) return 'SMALL'
  return 'NO_TRADE'
}

/**
 * Convert a global long/short ACCOUNT RATIO (R = longs / shorts) into the
 * long%/short% split the LS widget + confluence vote expect (they read
 * `ls.l`/`ls.s` as percentages that sum to 100). Returns null for a
 * non-positive / non-finite ratio so the caller leaves the feed untouched
 * (fail-safe — no fake data).
 */
export function lsRatioToSplit(ratio: number): { l: number; s: number } | null {
  const R = +ratio
  if (!Number.isFinite(R) || R <= 0) return null
  const l = (R / (1 + R)) * 100
  return { l, s: 100 - l }
}

/**
 * Windowed open-interest change %, computed against the OLDEST sample still
 * inside `windowMs` (mirrors trackOIDelta's 5-minute look-back). The naive
 * (oi - oiPrev)/oiPrev display compared the last two 30s polls, but the server
 * refreshes OI only every 60s, so consecutive polls were near-identical → ~0%.
 *
 * `history` is the chronological ring buffer of { oi, ts }. Returns null when
 * there is no usable in-window sample (caller shows "—", never a fake 0).
 */
export function oiWindowDeltaPct(
  history: Array<{ oi: number; ts: number }>,
  oiNow: number,
  now: number,
  windowMs: number,
): number | null {
  if (!Array.isArray(history) || !Number.isFinite(+oiNow)) return null
  const cutoff = now - windowMs
  // history is chronological (push-appended) → first match is the oldest in window
  const base = history.find((h) => h && h.ts >= cutoff && Number.isFinite(+h.oi))
  if (!base || !(base.oi > 0)) return null
  return ((+oiNow - base.oi) / base.oi) * 100
}
