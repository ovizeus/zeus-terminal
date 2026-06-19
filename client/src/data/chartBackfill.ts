// Zeus — data/chartBackfill.ts
// Lazy historical backfill on left-edge scroll. Pure helpers are exported for unit
// tests; the impure loadOlder/initBackfill/resetBackfill orchestration is added in a
// later task. Gated by w.__MF.CHART_BACKFILL_ENABLED.

export const MAX_BARS = 5000
export const EDGE_THRESHOLD = 12
export const FETCH_LIMIT = 1000

export interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }

export function _shouldTriggerBackfill(o: {
  from: number | null; klinesLen: number; inFlight: boolean; exhausted: boolean;
  enabled: boolean; maxBars: number; edgeThreshold: number
}): boolean {
  if (!o.enabled || o.inFlight || o.exhausted) return false
  if (o.klinesLen <= 0 || o.klinesLen >= o.maxBars) return false
  if (o.from == null) return false
  return o.from < o.edgeThreshold
}

// Concatenate older + current, dropping any older bar whose time is >= the current
// window's first bar time (boundary overlap), and guarantee strictly ascending unique
// times. Empty older → current unchanged.
export function _mergeOlderKlines(older: Bar[], current: Bar[]): Bar[] {
  if (!older || !older.length) return current
  if (!current || !current.length) return older
  const boundary = current[0].time
  const trimmed = older.filter(b => b.time < boundary)
  return trimmed.concat(current)
}

export function _computeRestoredRange(prev: { from: number; to: number } | null, prependedCount: number): { from: number; to: number } | null {
  if (!prev) return null
  return { from: prev.from + prependedCount, to: prev.to + prependedCount }
}

export function _nextEndTime(oldestBarTimeSec: number): number {
  return oldestBarTimeSec * 1000 - 1
}

// Trim the klines array to a bounded window. When backfill is enabled, use a sliding
// MAX_BARS (5000) window with a small buffer so we don't slice on every tick — and so
// backfilled history is not discarded by the next live append. When disabled, preserve
// the original pre-backfill behavior exactly (>1500 → keep last 1200).
export function _capKlines<T>(arr: T[], enabled: boolean): T[] {
  if (enabled) {
    if (arr.length > MAX_BARS + 200) return arr.slice(-MAX_BARS)
    return arr
  }
  if (arr.length > 1500) return arr.slice(-1200)
  return arr
}
