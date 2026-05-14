/**
 * Zeus Terminal — Unit Tests: _resolveClosePrice (BUG-CLOSE-AT FIX 2026-05-14)
 *
 * Pure helper extracted din closeAutoPos. Returns the best-available price
 * pentru a closing a position, with explicit fallback chain.
 *
 * BUG: prior `closeAutoPos` silently returned (no toast, no log, no request)
 * when `getSymPrice(pos)` returned null. For symbols not in market feed
 * (e.g. ZECUSDT — only BTC/ETH/SOL/BNB subscribed), Close button appeared
 * broken — operator clicked, nothing happened.
 *
 * Fix: use pure helper with fallback chain:
 *   1. Live market price (w.allPrices[sym] / w.wlPrices[sym] / getSymPrice)
 *   2. pos.live.avgPrice (Binance fill price stored on position)
 *   3. pos.entry (original entry price — last resort approximation)
 *   4. 0 → caller shows error toast
 *
 * Coverage:
 *   - Live price available → returns live price
 *   - No live price but pos.live.avgPrice → returns that
 *   - No live price, no live.avgPrice, has pos.entry → returns entry
 *   - All sources empty/zero → returns 0
 *   - Defensive: pos undefined/null → returns 0
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../data/marketDataPositions', () => ({
    getSymPrice: vi.fn(),
}))

import { _resolveClosePrice } from '../autotrade'
import { getSymPrice } from '../../data/marketDataPositions'

describe('_resolveClosePrice (BUG-CLOSE-AT FIX — fallback chain)', () => {
    beforeEach(() => {
        ;(getSymPrice as any).mockReset()
        ;(window as any).allPrices = {}
        ;(window as any).wlPrices = {}
    })

    it('returns live price when getSymPrice returns valid number', () => {
        ;(getSymPrice as any).mockReturnValue(545.0)
        const pos = { sym: 'ZECUSDT', entry: 545.05, live: { avgPrice: 545.05 } }
        expect(_resolveClosePrice(pos)).toBe(545.0)
    })

    it('falls back to pos.live.avgPrice when getSymPrice returns null', () => {
        ;(getSymPrice as any).mockReturnValue(null)
        const pos = { sym: 'ZECUSDT', entry: 545.05, live: { avgPrice: 545.05 } }
        expect(_resolveClosePrice(pos)).toBe(545.05)
    })

    it('falls back to pos.entry when no live price and no avgPrice', () => {
        ;(getSymPrice as any).mockReturnValue(null)
        const pos = { sym: 'ZECUSDT', entry: 545.05 }
        expect(_resolveClosePrice(pos)).toBe(545.05)
    })

    it('returns 0 when all sources are empty or invalid', () => {
        ;(getSymPrice as any).mockReturnValue(null)
        const pos = { sym: 'NEWSYMBOL' }
        expect(_resolveClosePrice(pos)).toBe(0)
    })

    it('returns 0 when pos is null', () => {
        expect(_resolveClosePrice(null as any)).toBe(0)
    })

    it('returns 0 when pos is undefined', () => {
        expect(_resolveClosePrice(undefined as any)).toBe(0)
    })

    it('treats negative live price as invalid, falls back', () => {
        ;(getSymPrice as any).mockReturnValue(-5)
        const pos = { sym: 'ZECUSDT', entry: 545.05 }
        expect(_resolveClosePrice(pos)).toBe(545.05)
    })

    it('treats NaN live price as invalid, falls back', () => {
        ;(getSymPrice as any).mockReturnValue(NaN)
        const pos = { sym: 'ZECUSDT', entry: 545.05 }
        expect(_resolveClosePrice(pos)).toBe(545.05)
    })

    it('replicates exact ZECUSDT incident scenario', () => {
        // Real: ZECUSDT not in feed → getSymPrice returns null
        ;(getSymPrice as any).mockReturnValue(null)
        const pos = {
            sym: 'ZECUSDT', side: 'SHORT', entry: 545.05,
            live: { status: 'LIVE', avgPrice: 545.05, executedQty: 18.343 },
        }
        // Pre-fix: silent return; post-fix: returns 545.05 (avgPrice) → close proceeds
        expect(_resolveClosePrice(pos)).toBe(545.05)
        expect(_resolveClosePrice(pos)).toBeGreaterThan(0)
    })
})
