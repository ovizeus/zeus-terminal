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
