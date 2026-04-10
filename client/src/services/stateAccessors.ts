/**
 * State Accessor Layer — read-only getters for engine migration.
 *
 * Pattern: engines migrate from `w.S.price` to `getPrice()`.
 * Each getter reads from Zustand store if available, falls back to window.*.
 *
 * Rules:
 * - READ-ONLY: zero writes, zero setters, zero business logic
 * - SYNC only: no async, no hooks
 * - LEAF MODULE: imports only stores, nothing else
 * - Returns primitives or shallow copies (no mutable references)
 *
 * Created in Phase 8B-mini. Only getters consumed by migrated files exist here.
 */

// ── Store-backed getters (read from Zustand, fallback to window.*) ──

/** AT enabled — store-backed */
export function getATEnabled(): boolean {
  try {
    const { useATStore } = require('../stores/atStore')
    return useATStore.getState().enabled
  } catch (_) {}
  return !!(window as any).AT?.enabled
}

// ── Bridge-backed getters (read from window.S — TODO migrate to store) ──

/** Signal data — TEMP bridge getter
 *  TODO: migrate source to marketStore or brainStore in 8D */
export function getSignalData(): { bullCount: number; bearCount: number; signals: any[] } {
  const w = window as any
  const sd = w.S?.signalData
  return sd ? { bullCount: sd.bullCount || 0, bearCount: sd.bearCount || 0, signals: sd.signals ? [...sd.signals] : [] } : { bullCount: 0, bearCount: 0, signals: [] }
}

/** RSI by timeframe — TEMP bridge getter
 *  TODO: migrate source to brainStore in 8D */
export function getRSI(tf: string): number | null {
  const w = window as any
  return w.S?.rsi?.[tf] ?? null
}

/** Long/Short ratio — TEMP bridge getter
 *  TODO: migrate to marketStore in 8D */
export function getLS(): { l: number; s: number } | null {
  const w = window as any
  return w.S?.ls || null
}

/** Funding rate — TEMP bridge getter
 *  TODO: migrate to marketStore in 8D */
export function getFR(): number | null {
  const w = window as any
  const fr = w.S?.fr
  return fr !== null && fr !== undefined ? fr : null
}

/** Open Interest + stale check — TEMP bridge getter
 *  TODO: migrate to marketStore in 8D */
export function getOI(): { oi: number | null; oiPrev: number | null; oiTs: number | null } {
  const w = window as any
  return { oi: w.S?.oi ?? null, oiPrev: w.S?.oiPrev ?? null, oiTs: w.S?.oiTs ?? null }
}
