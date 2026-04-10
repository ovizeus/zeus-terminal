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

// ── Added in 8B-rest ──

/** Timezone — TEMP bridge getter
 *  TODO: migrate to settingsStore in 8D */
export function getTimezone(): string {
  return (window as any).S?.tz || 'Europe/Bucharest'
}

/** Performance tracker data — TEMP bridge getter (read-only snapshot)
 *  Returns shallow copy of PERF object. Writes remain on window.PERF.
 *  TODO: migrate to dedicated perfStore in 8D */
export function getPerf(): Record<string, any> {
  const w = window as any
  if (!w.PERF) return {}
  const snap: Record<string, any> = {}
  for (const k of Object.keys(w.PERF)) {
    const p = w.PERF[k]
    snap[k] = { wins: p.wins || 0, losses: p.losses || 0, weight: p.weight || 1, pnlSum: p.pnlSum || 0, feeSum: p.feeSum || 0, winPnl: p.winPnl || 0, lossPnl: p.lossPnl || 0 }
  }
  return snap
}

/** Journal entries — TEMP bridge getter (read-only copy)
 *  TODO: migrate to journalStore in 8D */
export function getJournal(): any[] {
  const w = window as any
  const j = w.TP?.journal
  return Array.isArray(j) ? [...j] : []
}

// ── Added in 8E-1 (QM state redirect) ──

/** Current price — TEMP bridge getter
 *  TODO: migrate to marketStore in 8D */
export function getPrice(): number {
  return (window as any).S?.price || 0
}

/** Current symbol — TEMP bridge getter
 *  TODO: migrate to marketStore in 8D */
export function getSymbol(): string {
  return (window as any).S?.symbol || 'BTCUSDT'
}

/** Kline bars — TEMP bridge getter (read-only copy)
 *  TODO: migrate to marketStore in 8D */
export function getKlines(): any[] {
  const kl = (window as any).S?.klines
  return Array.isArray(kl) ? [...kl] : []
}

/** Order book bids — TEMP bridge getter (read-only copy)
 *  TODO: migrate to marketStore in 8D */
export function getBids(): any[] {
  const b = (window as any).S?.bids
  return Array.isArray(b) ? [...b] : []
}

/** Order book asks — TEMP bridge getter (read-only copy)
 *  TODO: migrate to marketStore in 8D */
export function getAsks(): any[] {
  const a = (window as any).S?.asks
  return Array.isArray(a) ? [...a] : []
}

// ── Added in 8E-2 (Teacher simple files) ──

/** Teacher state — TEMP bridge getter
 *  Returns MUTABLE REFERENCE intentionally for Teacher legacy flow.
 *  Teacher files read + write on the same object via `const T = getTeacher()`.
 *  Do NOT extend this mutable-reference pattern to other modules.
 *  TODO: replace with teacherStore in 8D/9 */
export function getTeacher(): any | null {
  return (window as any).TEACHER || null
}

// ── Added in 8C-2A1 (brain.ts safe lot) ──

/** AT kill triggered — store-backed
 *  TODO: migrate fully to atStore in 8D */
export function getATKillTriggered(): boolean {
  try { const { useATStore } = require('../stores/atStore'); return useATStore.getState().killTriggered } catch (_) {}
  return !!(window as any).AT?.killTriggered
}

/** AT last trade timestamp — TEMP bridge
 *  TODO: migrate to atStore in 8D */
export function getATLastTradeTs(): number {
  return (window as any).AT?.lastTradeTs || 0
}

/** AT closed trades today — TEMP bridge
 *  TODO: migrate to atStore in 8D */
export function getATClosedToday(): number {
  return (window as any).AT?.closedTradesToday || 0
}

/** AT daily PnL — TEMP bridge
 *  TODO: migrate to atStore in 8D */
export function getATDailyPnL(): number {
  return (window as any).AT?.dailyPnL || (window as any).AT?.realizedDailyPnL || 0
}

/** TC max positions — TEMP bridge
 *  TODO: migrate to settingsStore in 8D */
export function getTCMaxPos(): number {
  const w = window as any
  return (typeof w.TC !== 'undefined' && w.TC.maxPos) || 3
}

/** TC stop loss pct — TEMP bridge */
export function getTCSL(): number {
  const w = window as any
  return (typeof w.TC !== 'undefined' && Number.isFinite(w.TC.slPct)) ? w.TC.slPct : 1.5
}

/** TC size per trade — TEMP bridge */
export function getTCSize(): number {
  const w = window as any
  return (typeof w.TC !== 'undefined' && Number.isFinite(w.TC.size)) ? w.TC.size : 200
}

/** DSL mode — TEMP bridge
 *  TODO: migrate to dslStore in 8D */
export function getDSLMode(): string {
  return (window as any).DSL?.mode || 'atr'
}

// ── Added in 8C-2A2 (brain.ts market reads) ──

/** 24h volume — TEMP bridge getter
 *  TODO: migrate to marketStore in 8D */
export function getVol24h(): number {
  return (window as any).S?.vol24h || 0
}

/** Magnet bias direction — TEMP bridge getter
 *  TODO: migrate to brainStore in 8D */
export function getMagnetBias(): string {
  return (window as any).S?.magnetBias || 'neut'
}

// ── Added in 8C-2B1 (brain.ts BM reads) ──

/** Brain Metrics (w.BM) — TEMP bridge getter
 *  Returns MUTABLE REFERENCE intentionally.
 *  Used by brain.ts legacy read/write flow:
 *    const BM = getBrainMetrics()
 *    BM.confluenceScore = X  // write through ref
 *    const score = BM.confluenceScore  // read through ref
 *  Do NOT add null guards — BM is guaranteed by config.ts IIFE at import time.
 *  TODO: remove in Phase 9, replace with brainStore */
export function getBrainMetrics(): any {
  return (window as any).BM
}

/** Brain Object (w.BRAIN) — TEMP bridge getter
 *  Returns MUTABLE REFERENCE intentionally.
 *  Used by brain.ts legacy read/write flow:
 *    const BR = getBrainObject()
 *    BR.state = 'ready'  // write through ref
 *    const s = BR.state   // read through ref
 *  Do NOT add null guards — BRAIN is guaranteed by config.ts IIFE at import time.
 *  TODO: remove in Phase 9, replace with brainStore */
export function getBrainObject(): any {
  return (window as any).BRAIN
}

// ── Added in 8C-3A (dsl.ts) ──

/** DSL Object (w.DSL) — TEMP bridge getter
 *  Returns MUTABLE REFERENCE intentionally.
 *  Used by dsl.ts legacy read/write flow.
 *  TODO: remove in Phase 9 */
export function getDSLObject(): any {
  return (window as any).DSL
}

/** TC DSL activate pct — TEMP bridge */
export function getTCDslActivatePct(): number {
  const w = window as any
  return (typeof w.TC !== 'undefined' && Number.isFinite(w.TC.dslActivatePct)) ? w.TC.dslActivatePct : 0.50
}
/** TC DSL trail pct (pivot left) — TEMP bridge */
export function getTCDslTrailPct(): number {
  const w = window as any
  return (typeof w.TC !== 'undefined' && Number.isFinite(w.TC.dslTrailPct)) ? w.TC.dslTrailPct : 0.70
}
/** TC DSL trail sus pct (pivot right) — TEMP bridge */
export function getTCDslTrailSusPct(): number {
  const w = window as any
  return (typeof w.TC !== 'undefined' && Number.isFinite(w.TC.dslTrailSusPct)) ? w.TC.dslTrailSusPct : 1.00
}
/** TC DSL extend pct (impulse) — TEMP bridge */
export function getTCDslExtendPct(): number {
  const w = window as any
  return (typeof w.TC !== 'undefined' && Number.isFinite(w.TC.dslExtendPct)) ? w.TC.dslExtendPct : 1.30
}

// ── Added in 8C-3B (dsl.ts market + positions reads) ──

/** Magnet levels — TEMP bridge getter
 *  TODO: remove in 8D/9 */
export function getMagnets(): { above: any[]; below: any[] } {
  const m = (window as any).S?.magnets
  return m ? { above: m.above || [], below: m.below || [] } : { above: [], below: [] }
}

// ── Added in 8C-4A2 (autotrade.ts AT cluster final) ──

/** AT Object (w.AT) — TEMP bridge getter
 *  Returns MUTABLE REFERENCE intentionally.
 *  Used by autotrade.ts legacy read/write flow.
 *  Reads + writes go through same object: const AT = getATObject()
 *  TODO: remove in Phase 9, replace with atStore/atService */
export function getATObject(): any {
  return (window as any).AT
}

/** TC signal minimum — TEMP bridge
 *  TODO: migrate to settingsStore in 8D */
export function getTCSignalMin(): number {
  return (window as any).TC?.sigMin || 3
}
