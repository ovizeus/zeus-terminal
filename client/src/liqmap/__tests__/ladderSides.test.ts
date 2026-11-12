import { describe, it, expect } from 'vitest'
import { ladderSides, type Rung } from '../scale'

// [LIQ-MAP 2026-11-12] Operatorul a cerut „ca la Coinglass": o dunga care
// ADUNA lichidarile de la pret in sus si de la pret in jos, cu totalul la
// capat, ca sa se vada dintr-o privire unde sunt mai multe. Datele raman cele
// masurate — aici se verifica doar adunarea.

const r = (pct: number, longUsd: number, shortUsd: number, n = 1, isPrice = false): Rung => ({
    pct, price: 100 * (1 + pct / 100), longUsd, shortUsd, n,
    empty: longUsd + shortUsd <= 0, isPrice,
})

// de sus in jos, ca scara desenata
const LADDER: Rung[] = [
    r(0.75, 0, 10, 1),
    r(0.5, 0, 0, 0),
    r(0.25, 5, 25, 3),
    r(0, 7, 0, 2, true),
    r(-0.25, 40, 0, 4),
    r(-0.5, 60, 20, 5),
]

describe('ladderSides — totals above and below the price', () => {
    it('sums each side separately and leaves the price rung out of both', () => {
        const s = ladderSides(LADDER)
        expect(s.above.usd).toBe(40)
        expect(s.above.n).toBe(4)
        expect(s.below.usd).toBe(120)
        expect(s.below.n).toBe(9)
        expect(s.atPrice).toBe(7)
    })

    it('reports the share of each side out of the two together', () => {
        const s = ladderSides(LADDER)
        expect(s.above.share).toBeCloseTo(0.25, 6)
        expect(s.below.share).toBeCloseTo(0.75, 6)
        expect(s.heavier).toBe('below')
    })

    it('marks the single biggest rung on each side', () => {
        const s = ladderSides(LADDER)
        expect(s.above.maxIdx).toBe(2)
        expect(s.below.maxIdx).toBe(5)
    })

    it('accumulates outward from the price, on one scale shared by both sides', () => {
        const s = ladderSides(LADDER)
        // scara comuna = partea mai grea (120)
        expect(s.scale).toBe(120)
        // deasupra: randul de langa pret porneste de la 0 (jos) si urca
        expect(s.rows[2]).toEqual({ top: 30 / 120, bottom: 0 })
        expect(s.rows[1]).toEqual({ top: 30 / 120, bottom: 30 / 120 })
        expect(s.rows[0]).toEqual({ top: 40 / 120, bottom: 30 / 120 })
        // dedesubt: porneste de la 0 (sus) si coboara
        expect(s.rows[4]).toEqual({ top: 0, bottom: 40 / 120 })
        expect(s.rows[5]).toEqual({ top: 40 / 120, bottom: 1 })
        // randul de pret nu are dunga
        expect(s.rows[3]).toBeNull()
    })

    it('the line of each side ends exactly at that side total', () => {
        const s = ladderSides(LADDER)
        expect(s.rows[0]!.top * s.scale).toBeCloseTo(s.above.usd, 6)
        expect(s.rows[5]!.bottom * s.scale).toBeCloseTo(s.below.usd, 6)
    })

    it('says "even" when the two sides are equal, and never divides by zero', () => {
        const even = ladderSides([r(0.25, 0, 10), r(0, 0, 0, 0, true), r(-0.25, 10, 0)])
        expect(even.heavier).toBe('even')
        const none = ladderSides([r(0.25, 0, 0, 0), r(0, 0, 0, 0, true), r(-0.25, 0, 0, 0)])
        expect(none.scale).toBe(0)
        expect(none.above.share).toBe(0)
        expect(none.above.maxIdx).toBe(-1)
        expect(none.rows[0]).toEqual({ top: 0, bottom: 0 })
        expect(ladderSides([] as Rung[]).rows).toEqual([])
        expect(ladderSides(null as any).above.usd).toBe(0)
    })

    it('ignores garbage amounts instead of poisoning the totals', () => {
        const s = ladderSides([
            { ...r(0.25, 0, 10), shortUsd: NaN as any },
            r(0, 0, 0, 0, true),
            { ...r(-0.25, 10, 0), longUsd: -5 },
        ])
        expect(s.above.usd).toBe(0)
        expect(s.below.usd).toBe(0)
    })
})
