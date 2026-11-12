import { describe, it, expect } from 'vitest'
import { cobCumulative } from '../book'

// [BOOK 2026-11-12] Aceeasi dunga ca pe MAP, pe profilul din dreapta: aduna
// ordinele in asteptare de la spread in afara — vanzari in sus, cumparari in
// jos — cu totalul la capat. Randul 0 e JOS.

const COB = [
    { row: 0, bidUsd: 30, askUsd: 0 },
    { row: 1, bidUsd: 50, askUsd: 0 },
    { row: 2, bidUsd: 20, askUsd: 0 },
    { row: 3, bidUsd: 0, askUsd: 10 },
    { row: 4, bidUsd: 0, askUsd: 0 },
    { row: 5, bidUsd: 0, askUsd: 40 },
]

describe('cobCumulative — resting orders summed outward from the spread', () => {
    it('totals each side and says which is heavier', () => {
        const c = cobCumulative(COB)
        expect(c.ask.usd).toBe(50)
        expect(c.bid.usd).toBe(100)
        expect(c.ask.share).toBeCloseTo(1 / 3, 6)
        expect(c.bid.share).toBeCloseTo(2 / 3, 6)
        expect(c.heavier).toBe('bid')
        expect(c.scale).toBe(100)
    })

    it('asks accumulate upward, bids downward, both on the shared scale', () => {
        const c = cobCumulative(COB)
        expect(c.ask.steps).toEqual([{ row: 3, from: 0, to: 0.1 }, { row: 5, from: 0.1, to: 0.5 }])
        expect(c.bid.steps).toEqual([
            { row: 2, from: 0, to: 0.2 }, { row: 1, from: 0.2, to: 0.7 }, { row: 0, from: 0.7, to: 1 },
        ])
    })

    it('each line ends at its own total', () => {
        const c = cobCumulative(COB)
        expect(c.ask.steps[c.ask.steps.length - 1].to * c.scale).toBeCloseTo(c.ask.usd, 6)
        expect(c.bid.steps[c.bid.steps.length - 1].to * c.scale).toBeCloseTo(c.bid.usd, 6)
    })

    it('does not depend on the order the rows arrive in', () => {
        expect(cobCumulative([...COB].reverse())).toEqual(cobCumulative(COB))
    })

    it('handles a row that holds both sides, empty input and garbage', () => {
        const both = cobCumulative([{ row: 0, bidUsd: 5, askUsd: 5 }])
        expect(both.heavier).toBe('even')
        expect(both.ask.steps).toEqual([{ row: 0, from: 0, to: 1 }])
        expect(both.bid.steps).toEqual([{ row: 0, from: 0, to: 1 }])
        const none = cobCumulative([])
        expect(none.scale).toBe(0)
        expect(none.ask.steps).toEqual([])
        expect(cobCumulative(null as any).bid.usd).toBe(0)
        const bad = cobCumulative([{ row: 0, bidUsd: NaN as any, askUsd: -3 }])
        expect(bad.ask.usd + bad.bid.usd).toBe(0)
    })
})
