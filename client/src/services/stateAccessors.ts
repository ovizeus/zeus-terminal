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
 * ──────────────────────────────────────────────────────────────────────────
 * R14 TRIAGE (refreshed in ZT7, 2026-04-17) — honest post-v2 classification.
 *
 * The earlier triage flagged many accessors as `[STORE CANDIDATE: X]` with
 * a note that they were "safe to switch once a syncFromLegacy audit
 * confirms the store is populated in lockstep with window.S". That audit
 * was done in ZT7 and the answer is mostly "no": legacy engine writers
 * (autotrade.ts, brain.ts, dsl.ts, marketDataTrading.ts) write to window.S
 * / window.AT / window.DSL / window.TP directly; Zustand stores are
 * populated only via dedicated React-side hooks or event bridges. Flipping
 * getters wholesale would return stale values.
 *
 * Classification labels now used below:
 *
 * [STORE-BACKED] — the getter already reads the store first and falls back
 *   to window.* only when the store call fails. These are the flips that
 *   are verified to be populated in lockstep with the legacy writer.
 *   Today: enabled, mode, killTriggered, closedTradesToday, dailyPnL
 *   (all covered by useATBridge on 'zeus:atStateChanged').
 *
 * [STORE CANDIDATE — POPULATION DEBT] — a canonical store field exists but
 *   is NOT populated in lockstep with legacy writers, so the accessor
 *   cannot flip without risk of stale reads. Unblocking requires adding a
 *   write-side bridge or rewriting the legacy engine writer. Deferred to a
 *   dedicated "engine-to-store writer" lot, per-domain.
 *     · marketStore.* — only React components call `patch()`; engine
 *       writes go straight to `window.S`. No S-→-store bridge exists.
 *     · dslStore.mode — `useDslStore.getState().setMode()` is only called
 *       from tests; engine writes are `window.DSL.mode = 'atr'`.
 *     · atStore.lastTradeTs — field exists but useATBridge does not sync
 *       it (only the 10 fields listed at useATBridge.ts:22-33).
 *
 * [HYBRID BY DESIGN] — returns a mutable reference on purpose. The legacy
 *   engine reads AND writes via the same object (e.g. `BM.score = X`).
 *   Cannot be swapped to a store read until the engine itself is rewritten
 *   to call store setters. Tracked in the post-v2 "engine-to-store" track.
 *
 * [BRIDGE — NO CANONICAL STORE] — value has no store home at all. Creating
 *   one is a dedicated lot (new store + wire-up), not an accessor flip.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { useATStore } from '../stores/atStore'
import { useDslStore } from '../stores/dslStore'

// ── Store-backed getters (read from Zustand, fallback to window.*) ──

/** AT enabled — [STORE-BACKED] (canonical since Phase 3, bridged by useATBridge). */
export function getATEnabled(): boolean {
  try {
    return useATStore.getState().enabled
  } catch (_) {}
  return !!(window as any).AT?.enabled
}

// ── Bridge getters (read from window.*) — classified below ──

/** Signal data — [BRIDGE — NO CANONICAL STORE]
 *  Neither marketStore nor brainStore holds the bull/bear aggregation. */
export function getSignalData(): { bullCount: number; bearCount: number; signals: any[] } {
  const w = window as any
  const sd = w.S?.signalData
  return sd ? { bullCount: sd.bullCount || 0, bearCount: sd.bearCount || 0, signals: sd.signals ? [...sd.signals] : [] } : { bullCount: 0, bearCount: 0, signals: [] }
}

/** RSI by timeframe — [STORE CANDIDATE — POPULATION DEBT] marketStore.rsi */
export function getRSI(tf: string): number | null {
  const w = window as any
  return w.S?.rsi?.[tf] ?? null
}

/** Long/Short ratio — [STORE CANDIDATE — POPULATION DEBT] marketStore.ls */
export function getLS(): { l: number; s: number } | null {
  const w = window as any
  return w.S?.ls || null
}

/** Funding rate — [STORE CANDIDATE — POPULATION DEBT] marketStore.fr */
export function getFR(): number | null {
  const w = window as any
  const fr = w.S?.fr
  return fr !== null && fr !== undefined ? fr : null
}

/** Open Interest + stale check — [STORE CANDIDATE — POPULATION DEBT] marketStore.oi/oiPrev
 *  (oiTs has no store field yet — would need widening first.) */
export function getOI(): { oi: number | null; oiPrev: number | null; oiTs: number | null } {
  const w = window as any
  return { oi: w.S?.oi ?? null, oiPrev: w.S?.oiPrev ?? null, oiTs: w.S?.oiTs ?? null }
}

/** Funding rate countdown timestamp — [STORE CANDIDATE — POPULATION DEBT] marketStore.frCd */
export function getFRCountdown(): number {
  return (window as any).S?.frCd || 0
}

/** Fear & Greed index — [BRIDGE — NO CANONICAL STORE]
 *  No store field; lives on `window.S.fg` populated by legacy fetch. */
export function getFG(): number {
  return (window as any).S?.fg || 50
}

/** ATR (Average True Range) — [STORE CANDIDATE — POPULATION DEBT] marketStore.atr */
export function getATR(): number {
  return (window as any).S?.atr || 0
}

// ── Added in 8B-rest ──

/** Timezone — [STORE CANDIDATE — POPULATION DEBT] marketStore.tz / settingsStore.tz
 *  Both stores carry it but legacy tz writes go to `window.S.tz`; settings
 *  owns user preference. Pick settingsStore when engine cutover happens. */
export function getTimezone(): string {
  return (window as any).S?.tz || 'Europe/Bucharest'
}

/** Performance tracker data — [BRIDGE — NO CANONICAL STORE]
 *  No perfStore exists. `window.PERF` is the only source. Returns a shallow
 *  clone to prevent callers from mutating the bridge. */
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

/** Journal entries — [STORE CANDIDATE — POPULATION DEBT] journalStore / positionsStore.journal
 *  positionsStore got `journal` in R9 (Phase 7 tail); journalStore also
 *  exists. Consolidation required before switching the reader. */
export function getJournal(): any[] {
  const w = window as any
  const j = w.TP?.journal
  return Array.isArray(j) ? [...j] : []
}

// ── Added in 8E-1 (QM state redirect) ──

/** Current price — [STORE CANDIDATE — POPULATION DEBT] marketStore.price
 *  marketStore.setPrice is only called from TradingChart / useForecastEngine;
 *  engine writes via `window.S.price = …` don't propagate. */
export function getPrice(): number {
  return (window as any).S?.price || 0
}

/** Current symbol — [STORE CANDIDATE — POPULATION DEBT] marketStore.symbol */
export function getSymbol(): string {
  return (window as any).S?.symbol || 'BTCUSDT'
}

/** Kline bars — [BRIDGE — NO CANONICAL STORE]
 *  marketStore has price/OI but not the klines array. Returns a shallow
 *  copy since callers iterate but must not mutate. */
export function getKlines(): any[] {
  const kl = (window as any).S?.klines
  return Array.isArray(kl) ? [...kl] : []
}

/** Order book bids — [STORE CANDIDATE — POPULATION DEBT] marketStore.bids */
export function getBids(): any[] {
  const b = (window as any).S?.bids
  return Array.isArray(b) ? [...b] : []
}

/** Order book asks — [STORE CANDIDATE — POPULATION DEBT] marketStore.asks */
export function getAsks(): any[] {
  const a = (window as any).S?.asks
  return Array.isArray(a) ? [...a] : []
}

// ── Added in 8E-2 (Teacher simple files) ──

/** Teacher state — [HYBRID BY DESIGN]
 *  Returns MUTABLE REFERENCE intentionally for Teacher legacy flow.
 *  Teacher files read + write on the same object via `const T = getTeacher()`.
 *  Do NOT extend this mutable-reference pattern to other modules.
 *  teacherStore exists but does NOT yet cover all fields the engine writes;
 *  cutover is a dedicated lot (pre-requisite: audit teacher write sites). */
export function getTeacher(): any | null {
  return (window as any).TEACHER || null
}

// ── Added in 8C-2A1 (brain.ts safe lot) ──

/** AT kill triggered — [STORE-BACKED] (bridged by useATBridge). */
export function getATKillTriggered(): boolean {
  try { return useATStore.getState().killTriggered } catch (_) {}
  return !!(window as any).AT?.killTriggered
}

/** AT last trade timestamp — [STORE CANDIDATE — POPULATION DEBT]
 *  atStore has a `lastTradeTs` field but useATBridge (hooks/useATBridge.ts:22-33)
 *  does not sync it. Flipping now would read stale 0. Deferred until bridge
 *  is widened or autotrade.ts writes it via store setter directly. */
export function getATLastTradeTs(): number {
  return (window as any).AT?.lastTradeTs || 0
}

/** AT closed trades today — [STORE-BACKED] (bridged by useATBridge). */
export function getATClosedToday(): number {
  try { return useATStore.getState().closedTradesToday } catch (_) {}
  return (window as any).AT?.closedTradesToday || 0
}

/** AT daily PnL — [STORE-BACKED] (bridged by useATBridge → dailyPnL + realizedDailyPnL). */
export function getATDailyPnL(): number {
  try {
    const s = useATStore.getState()
    return s.dailyPnL || s.realizedDailyPnL || 0
  } catch (_) {}
  return (window as any).AT?.dailyPnL || (window as any).AT?.realizedDailyPnL || 0
}

/** TC max positions — [STORE CANDIDATE — POPULATION DEBT] settingsStore.maxPos
 *  TC config is written directly to `window.TC` by settings flow; settingsStore
 *  mirrors it only at hydrate time. Safer to keep legacy read until cutover. */
export function getTCMaxPos(): number {
  const w = window as any
  return (typeof w.TC !== 'undefined' && w.TC.maxPos) || 3
}

/** TC stop loss pct — [BRIDGE — NO CANONICAL STORE] */
export function getTCSL(): number {
  const w = window as any
  return (typeof w.TC !== 'undefined' && Number.isFinite(w.TC.slPct)) ? w.TC.slPct : 1.5
}

/** TC size per trade — [BRIDGE — NO CANONICAL STORE] */
export function getTCSize(): number {
  const w = window as any
  return (typeof w.TC !== 'undefined' && Number.isFinite(w.TC.size)) ? w.TC.size : 200
}

/** DSL mode — reads canonical useDslStore directly.
 *  [BATCH3-U] Previously read `window.DSL?.mode` via the Proxy; equivalent post-fix
 *  (Proxy get is now store-backed) but the direct read skips Proxy indirection
 *  on the hot path (AT uses this on every tick). */
export function getDSLMode(): string {
  const m = useDslStore.getState().mode
  if (m) return m
  return (window as any).DSL?.mode || 'atr'
}

// ── Added in 8C-2A2 (brain.ts market reads) ──

/** 24h volume — [BRIDGE — NO CANONICAL STORE]
 *  marketStore does not have a vol24h field. Would need store widening. */
export function getVol24h(): number {
  return (window as any).S?.vol24h || 0
}

/** Magnet bias direction — [STORE CANDIDATE — POPULATION DEBT] marketStore.magnetBias */
export function getMagnetBias(): string {
  return (window as any).S?.magnetBias || 'neut'
}

// ── Added in 8C-2B1 (brain.ts BM reads) ──

/** Brain Metrics (w.BM) — [HYBRID BY DESIGN]
 *  Returns MUTABLE REFERENCE intentionally.
 *  Used by brain.ts legacy read/write flow:
 *    const BM = getBrainMetrics()
 *    BM.confluenceScore = X  // write through ref
 *    const score = BM.confluenceScore  // read through ref
 *  Do NOT add null guards — BM is guaranteed by config.ts IIFE at import time.
 *  brainStore holds the canonical React-side copy, but legacy brain.ts still
 *  mutates BM directly; cutover blocked on full brain.ts rewrite. */
export function getBrainMetrics(): any {
  return (window as any).BM
}

/** Brain Object (w.BRAIN) — [HYBRID BY DESIGN]
 *  Returns MUTABLE REFERENCE intentionally.
 *  Used by brain.ts legacy read/write flow:
 *    const BR = getBrainObject()
 *    BR.state = 'ready'  // write through ref
 *    const s = BR.state   // read through ref
 *  Do NOT add null guards — BRAIN is guaranteed by config.ts IIFE at import time.
 *  Same rationale as BM: legacy engine owns write side. */
export function getBrainObject(): any {
  return (window as any).BRAIN
}

// ── Added in 8C-3A (dsl.ts) ──

/** DSL Object (w.DSL) — [HYBRID BY DESIGN]
 *  Returns MUTABLE REFERENCE intentionally.
 *  Used by dsl.ts legacy read/write flow. dslStore canonical for React
 *  consumers, but dsl.ts still mutates window.DSL in place. */
export function getDSLObject(): any {
  return (window as any).DSL
}

/** TC DSL activate pct — MANUAL DSL STANDARD (user-confirmed). */
export function getTCDslActivatePct(): number {
  const w = window as any
  return (typeof w.TC !== 'undefined' && Number.isFinite(w.TC.dslActivatePct)) ? w.TC.dslActivatePct : 0.50
}
/** TC DSL trail pct (pivot left = PL) — MANUAL DSL STANDARD. */
export function getTCDslTrailPct(): number {
  const w = window as any
  return (typeof w.TC !== 'undefined' && Number.isFinite(w.TC.dslTrailPct)) ? w.TC.dslTrailPct : 0.60
}
/** TC DSL trail sus pct (pivot right = PR) — MANUAL DSL STANDARD. */
export function getTCDslTrailSusPct(): number {
  const w = window as any
  return (typeof w.TC !== 'undefined' && Number.isFinite(w.TC.dslTrailSusPct)) ? w.TC.dslTrailSusPct : 0.50
}
/** TC DSL extend pct (impulse = IV, delta from PR) — MANUAL DSL STANDARD. */
export function getTCDslExtendPct(): number {
  const w = window as any
  return (typeof w.TC !== 'undefined' && Number.isFinite(w.TC.dslExtendPct)) ? w.TC.dslExtendPct : 0.25
}

// ── Added in 8C-3B (dsl.ts market + positions reads) ──

/** Magnet levels — [BRIDGE — NO CANONICAL STORE]
 *  marketStore has scalar magnetBias but not the above/below arrays. */
export function getMagnets(): { above: any[]; below: any[] } {
  const m = (window as any).S?.magnets
  return m ? { above: m.above || [], below: m.below || [] } : { above: [], below: [] }
}

// ── Added in 8C-4A2 (autotrade.ts AT cluster final) ──

/** AT Object (w.AT) — [HYBRID BY DESIGN]
 *  Returns MUTABLE REFERENCE intentionally.
 *  Used by autotrade.ts legacy read/write flow.
 *  Reads + writes go through same object: const AT = getATObject().
 *  atStore holds the canonical React-side copy (per Phase 3), but
 *  autotrade.ts still mutates AT in place. */
export function getATObject(): any {
  return (window as any).AT
}

/** TC signal minimum — [STORE CANDIDATE — POPULATION DEBT] settingsStore.sigMin
 *  Same caveat as getTCMaxPos: TC config is written directly to `window.TC`. */
export function getTCSignalMin(): number {
  return (window as any).TC?.sigMin || 3
}

/** TP Object (w.TP) — [HYBRID BY DESIGN]
 *  Returns MUTABLE REFERENCE intentionally.
 *  Used by autotrade.ts legacy read/write flow.
 *  Reads + writes go through same object: const TP = getTPObject().
 *  positionsStore canonical for React (per R9), but autotrade.ts still
 *  mutates TP in place and pushes slice() to positionsStore after each
 *  change. Full cutover requires autotrade.ts rewrite. */
export function getTPObject(): any {
  return (window as any).TP
}

/** AT mode — [STORE-BACKED] (bridged by useATBridge → mode). */
export function getATMode(): string {
  try {
    const m = useATStore.getState().mode
    if (m) return m
  } catch (_) {}
  return (window as any).AT?.mode || (window as any).AT?._serverMode || 'demo'
}

/** Demo positions — [STORE CANDIDATE — POPULATION DEBT] positionsStore.demoPositions
 *  autotrade.ts mutates `window.TP.demoPositions` in place and pushes a slice()
 *  to positionsStore after each change; reads from TP remain canonical until
 *  autotrade.ts is rewritten. */
export function getDemoPositions(): any[] {
  return (window as any).TP?.demoPositions || []
}

/** Live positions — [STORE CANDIDATE — POPULATION DEBT] positionsStore.livePositions
 *  Same pattern as getDemoPositions. */
export function getLivePositions(): any[] {
  return (window as any).TP?.livePositions || []
}

/** DSL enabled flag — [STORE CANDIDATE — POPULATION DEBT] dslStore.enabled
 *  Engine writes `window.DSL.enabled` directly; no bridge to dslStore. */
export function getDSLEnabled(): boolean {
  return !!(window as any).DSL?.enabled
}

/** DSL positions map — [BRIDGE — NO CANONICAL STORE]
 *  dslStore does not hold a per-position map. */
export function getDSLPositions(): Record<string, any> {
  return (window as any).DSL?.positions || {}
}
