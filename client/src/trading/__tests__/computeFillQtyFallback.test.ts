/**
 * Zeus Terminal — Unit Tests: _computeFillQtyFallback (BUG-T2d FIX 2026-05-14)
 *
 * Pure helper: derive position quantity from Binance MARKET order response,
 * with safe fallback when `executedQty` is absent/zero (status=NEW, async fill).
 *
 * BUG-T2d: prior code at autotrade.ts:1159 used fallback `adaptFinalSize /
 * fillPrice` — MISSING leverage multiplier. For lev=10, fallback produced
 * 1/10 of the correct quantity. SL/TP orders placed on Binance with that
 * fallback covered only 10% of the actual position → 90% unprotected.
 *
 * Confirmed on testnet 2026-05-14:
 *   Position: ZECUSDT SHORT qty=18.343, lev=10
 *   SL on Binance: qty=1.834 (exactly /10 wrong)
 *
 * Correct formula MUST match the MAIN order quantity sent to Binance
 * (line 1134): `(adaptFinalSize * lev) / fillPrice`.
 *
 * Coverage:
 *   - Happy path: executedQty truthy string → parsed value
 *   - Fallback NEW status: executedQty="0.000" → CORRECT calc with leverage
 *   - Fallback empty/null/undefined → same correct calc
 *   - Edge: leverage 1 → fallback equals notional/price
 *
 * TDD failing-first: helper not exported yet.
 */
import { describe, it, expect } from 'vitest'
import { _computeFillQtyFallback } from '../autotrade'

describe('_computeFillQtyFallback (BUG-T2d FIX — leverage missing in fallback)', () => {
    describe('happy path — executedQty present', () => {
        it('parses truthy executedQty string directly', () => {
            // Binance returned actual fill quantity
            expect(_computeFillQtyFallback('18.343', 100, 10, 545.05)).toBeCloseTo(18.343, 6)
        })

        it('parses fractional executedQty correctly', () => {
            expect(_computeFillQtyFallback('0.012', 1000, 10, 80000)).toBeCloseTo(0.012, 6)
        })
    })

    describe('fallback — Binance NEW status (executedQty=0)', () => {
        it('uses (size * lev) / fillPrice when executedQty="0.000"', () => {
            // adaptFinalSize=100, lev=10, fillPrice=545 → main qty = 1000/545 ≈ 1.835
            // BUG: prior code returned 100/545 ≈ 0.183 (10× too small)
            const result = _computeFillQtyFallback('0.000', 100, 10, 545)
            expect(result).toBeCloseTo((100 * 10) / 545, 6)
            // Sanity: must NOT equal the buggy formula
            expect(result).not.toBeCloseTo(100 / 545, 6)
        })

        it('uses leverage multiplier when executedQty empty string', () => {
            expect(_computeFillQtyFallback('', 200, 5, 50000)).toBeCloseTo((200 * 5) / 50000, 6)
        })

        it('uses leverage multiplier when executedQty null', () => {
            expect(_computeFillQtyFallback(null as any, 200, 5, 50000)).toBeCloseTo((200 * 5) / 50000, 6)
        })

        it('uses leverage multiplier when executedQty undefined', () => {
            expect(_computeFillQtyFallback(undefined as any, 200, 5, 50000)).toBeCloseTo((200 * 5) / 50000, 6)
        })
    })

    describe('edge cases', () => {
        it('with leverage=1, fallback equals notional/price (no multiplier impact)', () => {
            expect(_computeFillQtyFallback('0.000', 100, 1, 100)).toBeCloseTo(1.0, 6)
        })

        it('replicates the exact ZECUSDT incident scenario', () => {
            // Real testnet incident 2026-05-14: SHORT ZECUSDT entry $545.05, lev=10, size $1000
            // Main qty placed on Binance: 18.343 → SL fallback should produce SAME, not /10
            const adaptFinalSize = 1000
            const lev = 10
            const fillPrice = 545.05
            const expectedMainQty = (adaptFinalSize * lev) / fillPrice // ≈ 18.343
            const result = _computeFillQtyFallback('0.000', adaptFinalSize, lev, fillPrice)
            expect(result).toBeCloseTo(expectedMainQty, 3)
            // BUG verification: must NOT match the wrong 10× smaller value
            expect(result).not.toBeCloseTo(1.834, 3)
        })
    })
})
