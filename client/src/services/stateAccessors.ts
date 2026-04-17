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
 *
 * ──────────────────────────────────────────────────────────────────────────
 * R14 TRIAGE (2026-04-17): classification of every accessor below.
 * Stale `TODO: migrate in 8D/Phase 9` labels were removed — those phases
 * closed without folding these into stores, so the notes were lying.
 * Current truthful classification:
 *
 * [HYBRID BY DESIGN] — returns a mutable reference. The legacy engine file
 *   reads AND writes via the same object (e.g. `brain.ts` does
 *   `BM.confluenceScore = X`). Cannot be swapped to a store read until the
 *   engine itself is rewritten to call store setters. Scheduled per-engine
 *   in the post-v2 "engine-to-store" track (see register § Open roadmap).
 *
 * [STORE CANDIDATE: <store>.<field>] — scalar read of a value that already
 *   lives in a canonical store. Safe to switch once a `syncFromLegacy`
 *   audit confirms the store is populated in lockstep with `window.S`.
 *   Deferred to a batched cut-over lot after R16 release.
 *
 * [BRIDGE — NO CANONICAL STORE] — value has no canonical home. Creating
 *   a store for it is a dedicated lot, not an R14 action.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { useATStore } from '../stores/atStore'

// ── Store-backed getters (read from Zustand, fallback to window.*) ──

/** AT enabled — store-backed (canonical since Phase 3). */
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

/** RSI by timeframe — [STORE CANDIDATE: marketStore.rsi] */
export function getRSI(tf: string): number | null {
  const w = window as any
  return w.S?.rsi?.[tf] ?? null
}

/** Long/Short ratio — [STORE CANDIDATE: marketStore.ls] */
export function getLS(): { l: number; s: number } | null {
  const w = window as any
  return w.S?.ls || null
}

/** Funding rate — [STORE CANDIDATE: marketStore.fr] */
export function getFR(): number | null {
  const w = window as any
  const fr = w.S?.fr
  return fr !== null && fr !== undefined ? fr : null
}

/** Open Interest + stale check — [STORE CANDIDATE: marketStore.oi/oiPrev]
 *  (oiTs has no store field yet — would need widening first.) */
export function getOI(): { oi: number | null; oiPrev: number | null; oiTs: number | null } {
  const w = window as any
  return { oi: w.S?.oi ?? null, oiPrev: w.S?.oiPrev ?? null, oiTs: w.S?.oiTs ?? null }
}

/** Funding rate countdown timestamp — [STORE CANDIDATE: marketStore.frCd] */
export function getFRCountdown(): number {
  return (window as any).S?.frCd || 0
}

/** Fear & Greed index — [BRIDGE — NO CANONICAL STORE]
 *  No store field; lives on `window.S.fg` populated by legacy fetch. */
export function getFG(): number {
  return (window as any).S?.fg || 50
}

/** ATR (Average True Range) — [STORE CANDIDATE: marketStore.atr] */
export function getATR(): number {
  return (window as any).S?.atr || 0
}

// ── Added in 8B-rest ──

/** Timezone — [STORE CANDIDATE: marketStore.tz or settingsStore.tz]
 *  Both stores happen to carry it; marketStore has it today, settings owns
 *  user preference. Pick settingsStore when engine cutover happens. */
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

/** Journal entries — [STORE CANDIDATE: journalStore or positionsStore.journal]
 *  positionsStore got `journal` in R9 (Phase 7 tail); journalStore also
 *  exists. Consolidation required before switching the reader. */
export function getJournal(): any[] {
  const w = window as any
  const j = w.TP?.journal
  return Array.isArray(j) ? [...j] : []
}

// ── Added in 8E-1 (QM state redirect) ──

/** Current price — [STORE CANDIDATE: marketStore.price] */
export function getPrice(): number {
  return (window as any).S?.price || 0
}

/** Current symbol — [STORE CANDIDATE: marketStore.symbol] */
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

/** Order book bids — [STORE CANDIDATE: marketStore.bids] */
export function getBids(): any[] {
  const b = (window as any).S?.bids
  return Array.isArray(b) ? [...b] : []
}

/** Order book asks — [STORE CANDIDATE: marketStore.asks] */
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

/** AT kill triggered — store-backed with legacy fallback. */
export function getATKillTriggered(): boolean {
  try { return useATStore.getState().killTriggered } catch (_) {}
  return !!(window as any).AT?.killTriggered
}

/** AT last trade timestamp — [STORE CANDIDATE: atStore.lastTradeTs] */
export function getATLastTradeTs(): number {
  return (window as any).AT?.lastTradeTs || 0
}

/** AT closed trades today — [STORE CANDIDATE: atStore.closedTradesToday] */
export function getATClosedToday(): number {
  return (window as any).AT?.closedTradesToday || 0
}

/** AT daily PnL — [STORE CANDIDATE: atStore.dailyPnL] */
export function getATDailyPnL(): number {
  return (window as any).AT?.dailyPnL || (window as any).AT?.realizedDailyPnL || 0
}

/** TC max positions — [STORE CANDIDATE: settingsStore.maxPos] */
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

/** DSL mode — [STORE CANDIDATE: dslStore.mode] */
export function getDSLMode(): string {
  return (window as any).DSL?.mode || 'atr'
}

// ── Added in 8C-2A2 (brain.ts market reads) ──

/** 24h volume — [STORE CANDIDATE: marketStore.vol24h — field missing]
 *  Store would need widening first. */
export function getVol24h(): number {
  return (window as any).S?.vol24h || 0
}

/** Magnet bias direction — [STORE CANDIDATE: marketStore.magnetBias] */
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

/** TC signal minimum — [STORE CANDIDATE: settingsStore.sigMin] */
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

export function getATMode(): string {
  return (window as any).AT?.mode || (window as any).AT?._serverMode || 'demo'
}

export function getDemoPositions(): any[] {
  return (window as any).TP?.demoPositions || []
}

export function getLivePositions(): any[] {
  return (window as any).TP?.livePositions || []
}

export function getDSLEnabled(): boolean {
  return !!(window as any).DSL?.enabled
}

export function getDSLPositions(): Record<string, any> {
  return (window as any).DSL?.positions || {}
}
