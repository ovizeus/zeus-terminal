import { describe, it, expect } from 'vitest'
import { mapServerRowToAresCard } from '../aresStoreSync'

// [SERVER-ARES P2 2026-06-07] Server-synced TP row (state.ts _mapServerPos
// shape, owner==='ARES') → ARES panel card. uPnL recomputed from markPrice.
describe('mapServerRowToAresCard', () => {
    const row = {
        _serverSeq: 1776859653300,
        id: 1776859653300,
        side: 'SHORT',
        sym: 'BTCUSDT',
        entry: 62000,
        margin: 78.6,
        size: 78.6,
        lev: 10,
        sl: 63100,
        tp: 60500,
        mode: 'live',
        openTs: 1780850000000,
        owner: 'ARES',
    }

    it('maps fields and recomputes uPnL from mark (SHORT in profit)', () => {
        const c = mapServerRowToAresCard(row, 61000)
        expect(c.id).toBe('1776859653300')
        expect(c.side).toBe('SHORT')
        expect(c.symbol).toBe('BTCUSDT')
        expect(c.live).toBe(true)
        expect(c.leverage).toBe(10)
        expect(c.size).toBeCloseTo(786, 5)                 // notional = margin × lev
        // SHORT: (mark−entry)·dir/entry·notional = (61000−62000)·(−1)/62000·786
        expect(c.pnl).toBeCloseTo((1000 / 62000) * 786, 4)
        expect(c.pnlPct).toBeCloseTo((c.pnl / 786) * 100, 6)
        expect(c.slPrice).toBe(63100)
        expect(c.tpPrice).toBe(60500)
        expect(c.closable).toBe(true)
    })

    it('LONG loses when mark below entry', () => {
        const c = mapServerRowToAresCard({ ...row, side: 'LONG' }, 61000)
        expect(c.pnl).toBeLessThan(0)
    })

    it('no mark price → uPnL 0 (mark falls back to entry), no NaN anywhere', () => {
        const c = mapServerRowToAresCard(row, 0)
        expect(c.pnl).toBe(0)
        expect(Number.isNaN(c.pnlPct)).toBe(false)
        expect(Number.isNaN(c.size)).toBe(false)
    })

    it('defensive defaults: missing lev → 1, missing sl/tp → 0', () => {
        const c = mapServerRowToAresCard({ side: 'LONG', entry: 100, size: 50, mode: 'demo' }, 110)
        expect(c.leverage).toBe(1)
        expect(c.slPrice).toBe(0)
        expect(c.tpPrice).toBe(0)
        expect(c.live).toBe(false)
        expect(c.size).toBe(50)
    })
})
