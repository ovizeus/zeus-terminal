import { describe, it, expect } from 'vitest'
import { shouldFlagAttributionDivergence } from '../shadowCompareRules'

describe('shouldFlagAttributionDivergence', () => {
    // [SHADOW-FP 2026-06-07] With the server flag ON, _shadowCompare builds its
    // compare set from raw exchange positions with autoTrade hardcoded null —
    // the exchange cannot carry Zeus attribution. Comparing attribution there
    // flagged every server-side AT position as a permanent v1 divergence
    // (observed live: BTCUSDT/SHORT/live 1/min after the position was
    // correctly re-tagged autoTrade=true).
    it('skips exchange_raw rows — exchange cannot carry attribution', () => {
        expect(shouldFlagAttributionDivergence(
            { autoTrade: null, _classifySource: 'exchange_raw' },
            { autoTrade: true },
        )).toBe(false)
    })

    it('still flags a real mismatch on TP-sourced rows (flag OFF path)', () => {
        expect(shouldFlagAttributionDivergence(
            { autoTrade: false, _classifySource: 'sync_merge' },
            { autoTrade: true },
        )).toBe(true)
        expect(shouldFlagAttributionDivergence(
            { autoTrade: undefined, _classifySource: 'ws_push' },
            { autoTrade: true },
        )).toBe(true)
    })

    it('no divergence when both sides agree', () => {
        expect(shouldFlagAttributionDivergence(
            { autoTrade: true, _classifySource: 'ws_push' },
            { autoTrade: true },
        )).toBe(false)
        expect(shouldFlagAttributionDivergence(
            { autoTrade: false, _classifySource: 'boot_resume' },
            { autoTrade: false },
        )).toBe(false)
    })

    it('treats falsy variants consistently (null/undefined/false → false)', () => {
        expect(shouldFlagAttributionDivergence(
            { autoTrade: null, _classifySource: 'sync_merge' },
            { autoTrade: false },
        )).toBe(false)
    })
})
