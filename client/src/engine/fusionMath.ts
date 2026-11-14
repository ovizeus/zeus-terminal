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

/**
 * [2026-06-13] Open→close % change of the latest candle in a klines array.
 * Drives the per-timeframe PRICE CHANGE in the ZEUS TRADER — AI METRICS table:
 * the 1H/4H/12H/1D/1W tabs fetch klines at that interval and this returns how
 * far price moved within the current period of that timeframe.
 *
 * `bars` is the Binance-shape array: [openTime, open, high, low, close, ...].
 * Returns null on empty / malformed / zero-open input (caller shows "—").
 */
export function klineTfChangePct(bars: any[]): number | null {
  if (!Array.isArray(bars) || bars.length === 0) return null
  const last = bars[bars.length - 1]
  if (!Array.isArray(last) || last.length < 5) return null
  const open = parseFloat(last[1])
  const close = parseFloat(last[4])
  if (!Number.isFinite(open) || !Number.isFinite(close) || open === 0) return null
  return ((close - open) / open) * 100
}

/**
 * [2026-06-13] Real liquidation intensity 0-100 from the recent-events ring
 * (w.S.events: {usd, ts}). Sums USD liquidated within `windowMs` and scales it
 * against `capUsd` (cap → 100). Replaces the old OFI-sell proxy so the LIQ gauge
 * reflects ACTUAL liquidations from the Bybit/OKX feed.
 */
export function liqIntensityScore(events: Array<{ usd: number; ts: number }>, now: number, windowMs: number, capUsd: number): number {
  if (!Array.isArray(events) || events.length === 0 || !(capUsd > 0)) return 0
  const cutoff = now - windowMs
  let sum = 0
  for (const e of events) {
    if (e && e.ts >= cutoff && Number.isFinite(+e.usd)) sum += +e.usd
  }
  if (sum <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((sum / capUsd) * 100)))
}

/**
 * [2026-06-13] Real-time volume intensity 0-100: latest bar volume vs the trailing
 * average of the previous `lookback` bars (the rate at which volume is entering the
 * market). ratio 1 (normal) → 25, 1.5 → 50, 2 → 75, ≥2.5 → 100. Drives the VOL gauge.
 */
export function volumeIntensityScore(klines: Array<{ volume: number }>, lookback: number): number {
  if (!Array.isArray(klines) || klines.length < 2) return 0
  const last = klines[klines.length - 1]
  const lastVol = last && Number.isFinite(+last.volume) ? +last.volume : NaN
  if (!Number.isFinite(lastVol)) return 0
  const n = Math.max(1, Math.min(lookback, klines.length - 1))
  let sum = 0, cnt = 0
  for (let i = klines.length - 1 - n; i < klines.length - 1; i++) {
    const v = klines[i] && Number.isFinite(+klines[i].volume) ? +klines[i].volume : NaN
    if (Number.isFinite(v)) { sum += v; cnt++ }
  }
  const avg = cnt > 0 ? sum / cnt : 0
  if (!(avg > 0)) return 0
  const ratio = lastVol / avg
  return Math.max(0, Math.min(100, Math.round((ratio - 0.5) * 50)))
}

/**
 * [2026-11-14] Volumul barei CURENTE fata de media barelor inchise, cu bara
 * curenta adusa la lungimea ei intreaga.
 *
 * `volumeIntensityScore` compara bara care abia se formeaza cu bare intregi: la
 * inceputul fiecarei bare volumul e aproape zero, deci cadranul arata 0 pana
 * cand bara strangea jumatate dintr-una obisnuita — pe un chart de 4 ore, doua
 * ore din patru. Operatorul vedea „VOL 0" si nu era lipsa de date, era socoteala.
 *
 * Aici: daca din bara a trecut o fractiune `f`, volumul ei se imparte la `f`.
 * In primele 15% din bara proiectia ar amplifica zgomotul (un singur ordin
 * mare ar parea de 20×), asa ca acolo se foloseste ultima bara INCHISA.
 *
 * Intoarce `ratio` (de cate ori media) si `score` 0..100 pe aceeasi scara ca
 * inainte: ×1 → 25, ×1,5 → 50, ×2 → 75, ≥×2,5 → 100. `null` fara date.
 */
export function projectedVolume(
  klines: Array<{ time: number; volume: number }>, nowMs: number, lookback: number,
): { ratio: number; score: number; projected: boolean } | null {
  if (!Array.isArray(klines) || klines.length < 3) return null
  const n = klines.length
  const last = klines[n - 1], prev = klines[n - 2]
  const vol = (k: any) => (k && Number.isFinite(+k.volume) && +k.volume >= 0 ? +k.volume : NaN)
  const lb = Math.max(1, Math.min(lookback, n - 1))
  let sum = 0, cnt = 0
  for (let i = n - 1 - lb; i < n - 1; i++) { const v = vol(klines[i]); if (Number.isFinite(v)) { sum += v; cnt++ } }
  const avg = cnt > 0 ? sum / cnt : 0
  if (!(avg > 0)) return null
  const tfSec = Number(last.time) - Number(prev.time)
  const frac = tfSec > 0 ? (nowMs / 1000 - Number(last.time)) / tfSec : NaN
  const lastVol = vol(last)
  let ratio: number, projected = false
  if (Number.isFinite(frac) && frac >= 0.15 && Number.isFinite(lastVol)) {
    ratio = (lastVol / Math.min(1, frac)) / avg
    projected = frac < 1
  } else {
    const pv = vol(prev)
    if (!Number.isFinite(pv)) return null
    ratio = pv / avg
  }
  if (!Number.isFinite(ratio)) return null
  return { ratio, score: Math.max(0, Math.min(100, Math.round((ratio - 0.5) * 50))), projected }
}
