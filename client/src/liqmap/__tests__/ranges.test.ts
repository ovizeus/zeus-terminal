// [RANGE 2026-10-31] „poti face pe timeframe de 24h, 7 zile ca la coinglass si
// 4 ore?". Harta de lichidari avea doar 7D / 30D / 90D.
//
// Intervalul calatoreste ca ZILE (zecimale) pana in SQL. Eticheta nu are voie
// sa fie `${days}D`, fiindca 4 ore ar scrie „0.16666666666666666D".
import { describe, it, expect } from 'vitest'
import { RANGES, rangeLabel } from '../ranges'

describe('RANGES: ce poate alege', () => {
    it('are cele trei cerute, plus cele vechi', () => {
        expect(RANGES.map((r) => r.label)).toEqual(['4H', '24H', '7D', '30D', '90D'])
    })

    it('4H chiar inseamna patru ore, nu o zi', () => {
        const r = RANGES.find((x) => x.label === '4H')!
        expect(r.days * 24).toBeCloseTo(4, 9)
    })

    it('24H e exact o zi', () => {
        expect(RANGES.find((x) => x.label === '24H')!.days).toBe(1)
    })

    it('sunt in ordine crescatoare — altfel butoanele mint cu pozitia lor', () => {
        const d = RANGES.map((r) => r.days)
        expect([...d].sort((a, b) => a - b)).toEqual(d)
    })

    it('fiecare interval e pozitiv: zero ar cadea pe implicitul serverului', () => {
        for (const r of RANGES) expect(r.days).toBeGreaterThan(0)
    })

    it('nu are duplicate — doua butoane identice sunt un bug tacut', () => {
        expect(new Set(RANGES.map((r) => r.days)).size).toBe(RANGES.length)
    })
})

describe('rangeLabel: spune intervalul pe intelesul omului', () => {
    it('sub o zi scrie ORE, nu o fractie de zi', () => {
        expect(rangeLabel(4 / 24)).toBe('4H')
        expect(rangeLabel(12 / 24)).toBe('12H')
    })

    it('o zi si peste scrie ZILE', () => {
        expect(rangeLabel(1)).toBe('24H')
        expect(rangeLabel(7)).toBe('7D')
        expect(rangeLabel(90)).toBe('90D')
    })

    it('⛔ nu scrie niciodata o fractie zecimala lipita de D', () => {
        for (const d of [4 / 24, 1 / 24, 0.5, 1, 1.5, 7, 30, 90]) {
            expect(rangeLabel(d)).not.toMatch(/\./)
        }
    })

    it('un interval fara sens nu inventeaza o eticheta', () => {
        for (const bad of [0, -1, NaN, null, undefined, 'x'] as any[]) {
            expect(rangeLabel(bad)).toBe('—')
        }
    })
})
