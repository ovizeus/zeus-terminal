import { describe, it, expect } from 'vitest'
import { deriveCandle, bigLevels, kfmt, sumFmt, type FpCandle } from '../indicatorCalcIchnos'

const C = (lv: Array<[number, number, number]>, t = 0): FpCandle => ({ t, o: 0, h: 0, l: 0, c: 0, lv })

describe('ICHNOS — o lumanare', () => {
    it('Σ, Δ si POC', () => {
        const d = deriveCandle(C([[110, 10, 30], [100, 50, 60], [90, 5, 2]]), 10)
        expect(d.total).toBe(157)
        expect(d.delta).toBe(27)
        expect(d.poc).toBe(100)
    })
    it('⛔ dezechilibrul e DIAGONAL: cumparatorii de la p contra vanzatorilor de DEDESUBT', () => {
        // la 110: ask 90 vs bid de la 100 = 20 → 4,5× → cumparatori; pe orizontala (bid 80) n-ar fi fost
        const d = deriveCandle(C([[110, 80, 90], [100, 20, 25], [90, 15, 10]]), 10, { ratio: 3 })
        expect([...d.buyImb]).toEqual([110])
        // la 90: bid 15 vs ask de la 100 = 25 → nu; la 100: bid 20 vs ask 110 = 90 → nu
        expect([...d.sellImb]).toEqual([])
    })
    it('un nivel fara volum nu face dezechilibru (3 $ contra 0 nu e semnal)', () => {
        const d = deriveCandle(C([[110, 0, 3], [100, 0, 0], [90, 5000, 5000]]), 10)
        expect(d.buyImb.has(110)).toBe(false)
    })
    it('stivuite: 3 niveluri alaturate de aceeasi parte devin o zona', () => {
        const lv: Array<[number, number, number]> = [[140, 1, 1], [130, 1, 100], [120, 1, 100], [110, 1, 100], [100, 30, 1], [90, 1, 1]]
        const d = deriveCandle(C(lv, 5), 10, { ratio: 3, stackMin: 3 })
        expect(d.stacked).toEqual([{ side: 'buy', low: 110, high: 140, fromT: 5 }])
    })
    it('doua niveluri nu sunt stiva', () => {
        const d = deriveCandle(C([[120, 1, 100], [110, 1, 100], [100, 30, 1], [90, 1, 1]]), 10, { stackMin: 3 })
        expect(d.stacked).toEqual([])
    })
})

describe('ICHNOS — ordine mari si afisaj', () => {
    it('nivelurile cu volum de 4× mediana, cele mai mari', () => {
        const cs = [C(Array.from({ length: 12 }, (_, i) => [100 + i, 5, 5] as [number, number, number]), 1), C([[200, 300, 200], [150, 5, 5]], 2)]
        const b = bigLevels(cs, 4, 3)
        expect(b).toEqual([{ price: 200, vol: 500, t: 2 }])
    })
    it('mii de dolari intregi, Σ cu separator', () => {
        expect(kfmt(179400)).toBe('179')
        expect(kfmt(2400)).toBe('2')
        expect(kfmt(400)).toBe('.4')
        expect(kfmt(0)).toBe('0')
        expect(sumFmt(1806000)).toBe('1,806')
    })
})
