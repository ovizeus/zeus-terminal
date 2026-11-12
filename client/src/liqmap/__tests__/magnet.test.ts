import { describe, it, expect } from 'vitest'
import { magnetState, magnetOnAxis } from '../magnet'

// [MAGNET 2026-11-12] Magnetul de pe HEATMAP si BOOK e cifra lui PREDICT, nu un
// al doilea calcul. Operatorul: „sa-l facem real, nu fake; cand n-are date sa
// scrie ca aduna date". Deci fiecare stare fara cifra are un text al ei, si
// nicio cale de aici nu inventeaza o tinta sau un procent.

const H = (over: any = {}) => ({ horizonMs: 3600000, calibrating: true, pct: null, resolved: 12, hits: 4, need: 30, ...over })
const ROW = (over: any = {}, sig: any = {}) => ({
    symbol: 'BTCUSDT', price: 71572, at: 1, windowMs: 1, eventsInWindow: 500, oldestEventTs: 1,
    context: { oiChangePct: null, oiValueUsd: null, crowdLongPct: null, at: null },
    horizons: [H(), H({ horizonMs: 4 * 3600000, resolved: 3 })], minSamples: 30, baseline: null,
    signal: {
        symbol: 'BTCUSDT', side: 'UP', strength: 62, reason: '', longBurnedUsd: 1, shortBurnedUsd: 2,
        imbalance: 0.3, events: 500, crowdLongPct: null, oiChangePct: null,
        target: { price: 72426, usd: 48_860_000, n: 40, pct: 1.19 }, ...sig,
    },
    ...over,
})

describe('magnetState', () => {
    it('before anything arrives it says it is collecting — never a number', () => {
        const m = magnetState([], 'BTCUSDT', 71572)
        expect(m.kind).toBe('collecting')
        expect(m.title).toBe('Collecting data for magnet')
        expect(m.target).toBeNull()
        expect(magnetState(null as any, 'BTCUSDT', 71572).kind).toBe('collecting')
    })

    it('a market PREDICT does not measure is named as such, with the ones it does', () => {
        const m = magnetState([ROW(), ROW({ symbol: 'ETHUSDT' })] as any, 'SOLUSDT', 81)
        expect(m.kind).toBe('untracked')
        expect(m.title).toBe('Magnet is measured for BTC and ETH only')
        expect(m.target).toBeNull()
    })

    it('NO EDGE stays no edge, with the reason given by the server', () => {
        const m = magnetState([ROW({}, { side: 'NONE', target: null, reason: 'both sides burned alike' })] as any, 'BTCUSDT', 71572)
        expect(m.kind).toBe('none')
        expect(m.title).toBe('No magnet right now')
        expect(m.detail).toBe('both sides burned alike')
        expect(m.target).toBeNull()
    })

    it('a direction without a mapped cluster gives a direction but no price', () => {
        const m = magnetState([ROW({}, { target: null })] as any, 'BTCUSDT', 71572)
        expect(m.kind).toBe('direction')
        expect(m.title).toBe('Magnet ↑ up')
        expect(m.detail).toBe('no price cluster mapped yet — collecting data')
        expect(m.target).toBeNull()
    })

    it('a live magnet carries direction, price, distance and the dollars behind it', () => {
        const m = magnetState([ROW()] as any, 'BTCUSDT', 71572)
        expect(m.kind).toBe('live')
        expect(m.side).toBe('UP')
        expect(m.title).toBe('Magnet ↑ 72,426')
        expect(m.target!.price).toBe(72426)
        // distanta se masoara fata de pretul de ACUM, nu se copiaza din server
        expect(m.target!.pct).toBeCloseTo((72426 / 71572 - 1) * 100, 6)
        expect(m.detail).toBe('+1.19% · +854 · $48.86M in 40 liquidations · strength 62')
    })

    it('a DOWN magnet reads down', () => {
        const m = magnetState([ROW({}, { side: 'DOWN', target: { price: 70979, usd: 34_990_000, n: 31, pct: -0.83 } })] as any, 'BTCUSDT', 71572)
        expect(m.title).toBe('Magnet ↓ 70,979')
        expect(m.detail.startsWith('-0.83% · −593 · ')).toBe(true)
    })

    it('the proof line is CALIBRATING until the server has measured enough', () => {
        const m = magnetState([ROW()] as any, 'BTCUSDT', 71572)
        expect(m.proof).toBe('1H CALIBRATING 12/30 · 4H CALIBRATING 3/30')
        expect(m.proven).toBe(false)
        expect(m.verdict).toBe('calibrating')
    })

    it('a measured horizon shows its rate against the base rate', () => {
        const row = ROW({ horizons: [H({ calibrating: false, pct: 30, controlPct: 9, lift: 3.3, resolved: 40 })] })
        const m = magnetState([row] as any, 'BTCUSDT', 71572)
        expect(m.proof).toBe('1H 30% vs 9% base  ×3.3')
        expect(m.proven).toBe(true)
        expect(m.verdict).toBe('proven')
    })

    it('a measured horizon with no edge is NOT called proven', () => {
        const row = ROW({ horizons: [H({ calibrating: false, pct: 86, controlPct: 86, lift: 1.0, resolved: 40 })] })
        const m = magnetState([row] as any, 'BTCUSDT', 71572)
        expect(m.proven).toBe(false)
        // masurat si fara avantaj: se spune asta, nu „inca nedovedit"
        expect(m.verdict).toBe('no-edge')
    })

    it('a broken target is treated as no target, not drawn at zero', () => {
        const m = magnetState([ROW({}, { target: { price: 0, usd: 1, n: 1, pct: 0 } })] as any, 'BTCUSDT', 71572)
        expect(m.kind).toBe('direction')
        expect(m.target).toBeNull()
    })
})

describe('magnetOnAxis — where the magnet falls on a drawn price range', () => {
    it('inside the range it gives the position', () => {
        expect(magnetOnAxis(1.19, -1.3, 4.8)).toEqual({ where: 'inside', pct: 1.19 })
    })
    it('outside it says which way, so an arrow can point off the map', () => {
        expect(magnetOnAxis(6, -1.3, 4.8)).toEqual({ where: 'above', pct: 6 })
        expect(magnetOnAxis(-3, -1.3, 4.8)).toEqual({ where: 'below', pct: -3 })
    })
    it('refuses garbage', () => {
        expect(magnetOnAxis(NaN, -1, 1)).toBeNull()
        expect(magnetOnAxis(1, 2, 1)).toBeNull()
    })
})
