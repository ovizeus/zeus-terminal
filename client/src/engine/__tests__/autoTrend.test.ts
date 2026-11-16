import { describe, it, expect } from 'vitest'
import { autoTrendlines, lineAt } from '../indicatorCalcAutoTrend'

// O piata care urca in trepte: fund major la 10, apoi minime tot mai sus.
function uptrend(): { highs: number[]; lows: number[] } {
    const lows: number[] = []
    for (let i = 0; i < 160; i++) {
        const base = 100 + 0.0025 * i * i          // urca tot mai abrupt, ca in capturi
        const wave = 6 * Math.sin(i / 6)
        lows.push(base + wave + (i === 10 ? -15 : 0))
    }
    const highs = lows.map((l) => l + 3)
    return { highs, lows }
}

describe('AUTOTRENDLINE', () => {
    it('trage un evantai de linii de suport din fundul major, nerupte dupa al doilea pivot', () => {
        const { highs, lows } = uptrend()
        const r = autoTrendlines(highs, lows, { majorWidth: 8, minorWidth: 3 })
        const sup = r.lines.filter((l) => l.kind === 'support')
        expect(sup.length).toBeGreaterThan(0)
        for (const l of sup) {
            for (let i = l.toIndex + 1; i < lows.length; i++) expect(lows[i]).toBeGreaterThanOrEqual(lineAt(l, i) - 2)
            expect(l.slope).toBeGreaterThan(0)
        }
        // evantai: din aceeasi ancora, pante diferite
        const byAnchor = new Map<number, number[]>()
        for (const l of sup) byAnchor.set(l.fromIndex, [...(byAnchor.get(l.fromIndex) || []), l.slope])
        const fan = byAnchor.get(10)                       // din fundul major (i=10)
        expect(fan && fan.length).toBeGreaterThanOrEqual(2)
        expect(new Set(fan!.map((s) => s.toFixed(4))).size).toBe(fan!.length)
    })
    it('⛔ o linie prin care pretul a trecut nu se deseneaza', () => {
        const { highs, lows } = uptrend()
        lows[150] = 50; highs[150] = 53                      // prabusire recenta sub toate
        const r = autoTrendlines(highs, lows)
        expect(r.lines.filter((l) => l.kind === 'support' && l.fromIndex < 150)).toEqual([])
    })
    it('rezistenta in piata care coboara: linii rosii cu panta negativa, neatinse', () => {
        const { highs, lows } = uptrend()
        const H = highs.map((h) => 400 - h), L = lows.map((l) => 400 - l)
        const r = autoTrendlines(L, H)                    // inversat: varfurile devin H
        const res = r.lines.filter((l) => l.kind === 'resistance')
        expect(res.length).toBeGreaterThan(0)
        for (const l of res) expect(l.slope).toBeLessThan(0)
    })
    it('prea putine bare → nimic, fara exceptii', () => {
        expect(autoTrendlines([1, 2, 3], [0, 1, 2])).toEqual({ lines: [], anchors: [] })
        expect(autoTrendlines([], [])).toEqual({ lines: [], anchors: [] })
    })
})
