import { describe, it, expect } from 'vitest'
import { heatGrid, heatProfile, heatSides, priceTicks, timeTicks, scaleSteps } from '../heat'

// [HEATMAP 2026-11-12] Harta de caldura avea doar patrate: fara pret, fara ora,
// fara totaluri. Tot ce se adauga se CALCULEAZA din celulele masurate; aici se
// verifica socotelile, desenul se vede cu ochiul.

const HEAT = {
    cols: 10, bucket: 4, tMin: 1_000_000, tMax: 1_000_000 + 10 * 3_600_000, maxUsd: 90,
    cells: [
        { t: 0, pct: 0.5, longUsd: 0, shortUsd: 40, n: 2 },
        { t: 3, pct: 0.5, longUsd: 0, shortUsd: 20, n: 1 },
        { t: 4, pct: 0.25, longUsd: 5, shortUsd: 5, n: 2 },
        { t: 5, pct: 0, longUsd: 7, shortUsd: 0, n: 1 },
        { t: 6, pct: -0.25, longUsd: 30, shortUsd: 0, n: 3 },
        { t: 9, pct: -0.75, longUsd: 90, shortUsd: 0, n: 4 },
    ],
}

describe('heatGrid', () => {
    it('reads the row step from the server bucket and counts every row in between', () => {
        const g = heatGrid(HEAT)!
        expect(g.step).toBe(0.25)
        expect(g.lo).toBe(-0.75)
        expect(g.hi).toBe(0.5)
        expect(g.rows).toBe(6)          // -0.75 … 0.5 din 0,25 in 0,25
        expect(g.cols).toBe(10)
    })
    it('falls back to 0.25% without a bucket and refuses an empty grid', () => {
        expect(heatGrid({ ...HEAT, bucket: undefined })!.step).toBe(0.25)
        expect(heatGrid({ cells: [] })).toBeNull()
        expect(heatGrid(null)).toBeNull()
    })
    it('row 0 is the lowest price', () => {
        const g = heatGrid(HEAT)!
        expect(g.rowOf(-0.75)).toBe(0)
        expect(g.rowOf(0.5)).toBe(5)
        expect(g.rowOf(0)).toBe(3)
    })
})

describe('heatProfile — everything that happened at one price level', () => {
    it('adds the cells of a level across time, top row first', () => {
        const p = heatProfile(HEAT)
        expect(p.rows.map((r) => r.pct)).toEqual([0.5, 0.25, 0, -0.25, -0.5, -0.75])
        expect(p.rows[0]).toMatchObject({ longUsd: 0, shortUsd: 60, n: 3 })
        expect(p.rows[4]).toMatchObject({ longUsd: 0, shortUsd: 0, n: 0 })
        expect(p.maxRowUsd).toBe(90)
    })
    it('totals longs and shorts and says which was heavier', () => {
        const p = heatProfile(HEAT)
        expect(p.long.usd).toBe(132)
        expect(p.short.usd).toBe(65)
        expect(p.long.share).toBeCloseTo(132 / 197, 6)
        expect(p.short.share).toBeCloseTo(65 / 197, 6)
        expect(p.heavier).toBe('long')
        expect(p.long.n + p.short.n).toBeGreaterThan(0)
    })
    it('finds the level with the most longs and the one with the most shorts', () => {
        const p = heatProfile(HEAT)
        expect(p.long.peak).toEqual({ pct: -0.75, usd: 90 })
        expect(p.short.peak).toEqual({ pct: 0.5, usd: 60 })
    })
    it('an empty side has no peak and nothing divides by zero', () => {
        const p = heatProfile({ ...HEAT, cells: [{ t: 0, pct: 0.25, longUsd: 0, shortUsd: 0, n: 0 }] })
        expect(p.long.peak).toBeNull()
        expect(p.long.share).toBe(0)
        expect(p.heavier).toBe('even')
        expect(heatProfile(null).rows).toEqual([])
    })
    it('ignores garbage amounts', () => {
        const p = heatProfile({ ...HEAT, cells: [{ t: 0, pct: 0.25, longUsd: NaN, shortUsd: -4, n: 1 }] })
        expect(p.long.usd + p.short.usd).toBe(0)
    })
})

describe('heatSides — above and below the price, summed outward', () => {
    it('reuses the ladder sums: the price row belongs to neither side', () => {
        const s = heatSides(heatProfile(HEAT))
        expect(s.above.usd).toBe(70)
        expect(s.below.usd).toBe(120)
        expect(s.atPrice).toBe(7)
        expect(s.heavier).toBe('below')
        expect(s.rows.length).toBe(6)
        expect(s.rows[2]).toBeNull()
    })
})

describe('priceTicks', () => {
    it('gives round prices inside the drawn range, with their place on the axis', () => {
        const t = priceTicks(-1.3, 4.8, 71725, 5)
        expect(t.length).toBeGreaterThanOrEqual(3)
        expect(t.length).toBeLessThanOrEqual(8)
        for (const k of t) {
            expect(k.price % 500).toBe(0)
            expect(k.pct).toBeGreaterThanOrEqual(-1.3)
            expect(k.pct).toBeLessThanOrEqual(4.8)
            expect(k.pct).toBeCloseTo((k.price / 71725 - 1) * 100, 6)
        }
    })
    it('works on small prices too', () => {
        const t = priceTicks(-2, 2, 0.6123, 5)
        expect(t.length).toBeGreaterThanOrEqual(2)
        expect(new Set(t.map((k) => k.label)).size).toBe(t.length)
    })
    it('returns nothing on a meaningless range', () => {
        expect(priceTicks(1, 1, 100, 5)).toEqual([])
        expect(priceTicks(-1, 1, 0, 5)).toEqual([])
        expect(priceTicks(NaN, 1, 100, 5)).toEqual([])
    })
})

describe('timeTicks', () => {
    it('labels hours on a short window and ends on the right edge', () => {
        const t0 = Date.UTC(2026, 10, 11, 20, 0), t1 = Date.UTC(2026, 10, 12, 20, 0)
        const t = timeTicks(t0, t1, 5, 0)
        expect(t.length).toBe(5)
        expect(t[0].f).toBe(0)
        expect(t[t.length - 1].f).toBe(1)
        expect(t[0].label).toBe('20:00')
        expect(t[2].label).toBe('08:00')
        expect(t[t.length - 1].label).toBe('Now')
    })
    it('switches to dates on a window longer than two days', () => {
        const t0 = Date.UTC(2026, 10, 5, 20, 0), t1 = Date.UTC(2026, 10, 12, 20, 0)
        const t = timeTicks(t0, t1, 4, 0)
        expect(t[0].label).toBe('05/11')
        expect(t[t.length - 1].label).toBe('Now')
    })
    it('honours the viewer timezone offset', () => {
        const t0 = Date.UTC(2026, 10, 11, 20, 0), t1 = Date.UTC(2026, 10, 12, 20, 0)
        expect(timeTicks(t0, t1, 5, 120)[0].label).toBe('22:00')
    })
    it('returns nothing without a real span', () => {
        expect(timeTicks(0, 0, 5, 0)).toEqual([])
        expect(timeTicks(10, 5, 5, 0)).toEqual([])
    })
})

describe('scaleSteps — what a faint and a bright cell are worth', () => {
    it('runs from small to the peak, ascending, ending exactly on the peak', () => {
        const s = scaleSteps(386_000_000, 5)
        expect(s.length).toBe(5)
        expect(s[s.length - 1].usd).toBe(386_000_000)
        expect(s[s.length - 1].i).toBe(1)
        for (let k = 1; k < s.length; k++) {
            expect(s[k].usd).toBeGreaterThan(s[k - 1].usd)
            expect(s[k].i).toBeGreaterThan(s[k - 1].i)
        }
    })
    it('is empty without a peak', () => {
        expect(scaleSteps(0, 5)).toEqual([])
    })
})
