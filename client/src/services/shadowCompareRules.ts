/**
 * Zeus Terminal — Shadow-compare divergence rules (extracted from
 * core/state.ts::_shadowCompare for testability).
 *
 * [SHADOW-FP 2026-06-07] When the server-positions flag is ON, the compare
 * set is built from RAW exchange positions with `autoTrade` hardcoded null —
 * the exchange cannot carry Zeus attribution. Comparing attribution against
 * those rows flagged every server-side AT position as a permanent v1
 * divergence (observed live: `BTCUSDT/SHORT/live` once per minute after the
 * position was correctly re-tagged autoTrade=true). Existence/side/mode key
 * matching in _shadowCompare still detects real server↔exchange drift.
 */

export interface ShadowCompareRow {
    autoTrade?: boolean | null
    _classifySource?: string
}

/** True when the legacy-vs-shadow autoTrade mismatch is a REAL divergence. */
export function shouldFlagAttributionDivergence(p: ShadowCompareRow, sp: ShadowCompareRow): boolean {
    // Exchange-sourced rows carry no attribution — skip, never a divergence.
    if (p._classifySource === 'exchange_raw') return false
    return !!p.autoTrade !== !!sp.autoTrade
}
