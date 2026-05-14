/**
 * Zeus Terminal — Unit Tests: _countOppositeModeOpenPositions (BUG-T3 FIX 2026-05-14)
 *
 * Pure helper that counts open positions in the OPPOSITE engine mode from
 * the current one. Used by:
 *   - Confirm dialog at mode switch (`switchGlobalMode`)
 *   - Banner persistent în ManualTradePanel sub mode header
 *
 * BUG-T3 root cause: UI hides opposite-mode positions silently. Users need
 * to see N count to know there are hidden-but-active positions on Binance.
 *
 * Counting rules:
 *   - Filter `closed === false/undefined` (open only)
 *   - For target=demo: count items in livePositions array
 *   - For target=live: count items in demoPositions array
 *     (filter `(p.mode || 'demo') !== 'live'` — exclude any cross-stored ones)
 *
 * TDD failing-first: helper not exported yet.
 */
import { describe, it, expect } from 'vitest'
import { _countOppositeModeOpenPositions } from '../marketDataTrading'

const livePos = (id: number, closed = false) => ({ seq: id, symbol: 'BTCUSDT', side: 'LONG', mode: 'live', closed })
const demoPos = (id: number, closed = false) => ({ seq: id, symbol: 'ETHUSDT', side: 'SHORT', mode: 'demo', closed })

describe('_countOppositeModeOpenPositions (BUG-T3 FIX)', () => {
    describe('current=live (counts demo)', () => {
        it('returns 0 when no demo positions exist', () => {
            expect(_countOppositeModeOpenPositions('live', [], [])).toBe(0)
        })

        it('counts 3 open demo positions', () => {
            const dps = [demoPos(1), demoPos(2), demoPos(3)]
            expect(_countOppositeModeOpenPositions('live', dps, [])).toBe(3)
        })

        it('excludes closed demo positions', () => {
            const dps = [demoPos(1), demoPos(2, true), demoPos(3)]
            expect(_countOppositeModeOpenPositions('live', dps, [])).toBe(2)
        })

        it('ignores livePositions array when counting opposite of live', () => {
            const dps = [demoPos(1)]
            const lps = [livePos(10), livePos(11)]
            expect(_countOppositeModeOpenPositions('live', dps, lps)).toBe(1)
        })

        it('treats missing mode field as demo (defensive)', () => {
            const dps = [{ seq: 1, symbol: 'X', side: 'LONG', closed: false } as any]
            expect(_countOppositeModeOpenPositions('live', dps, [])).toBe(1)
        })
    })

    describe('current=demo (counts live)', () => {
        it('returns 0 when no live positions exist', () => {
            expect(_countOppositeModeOpenPositions('demo', [], [])).toBe(0)
        })

        it('counts 2 open live positions', () => {
            const lps = [livePos(10), livePos(11)]
            expect(_countOppositeModeOpenPositions('demo', [], lps)).toBe(2)
        })

        it('excludes closed live positions', () => {
            const lps = [livePos(10), livePos(11, true)]
            expect(_countOppositeModeOpenPositions('demo', [], lps)).toBe(1)
        })

        it('ignores demoPositions array when counting opposite of demo', () => {
            const dps = [demoPos(1), demoPos(2)]
            const lps = [livePos(10)]
            expect(_countOppositeModeOpenPositions('demo', dps, lps)).toBe(1)
        })
    })

    describe('edge cases', () => {
        it('handles null/undefined arrays defensively', () => {
            expect(_countOppositeModeOpenPositions('live', null as any, null as any)).toBe(0)
            expect(_countOppositeModeOpenPositions('demo', undefined as any, undefined as any)).toBe(0)
        })

        it('handles non-array inputs defensively', () => {
            expect(_countOppositeModeOpenPositions('live', {} as any, {} as any)).toBe(0)
        })
    })
})
