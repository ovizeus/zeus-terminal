import { describe, it, expect, beforeEach } from 'vitest'
import { recenterPriceOnSymbolChange, _resetRecenterForTest } from '../marketDataChart'

// [2026-11-15] „Sunt pe BTC, trec pe BNB si chartul ramane la 65k; trebuie sa
// trag in jos sa-l centrez." La o moneda noua scara de pret revine pe automat.
function fakeChart() {
    const calls: Array<[string, any]> = []
    return { calls, priceScale: (id: string) => ({ applyOptions: (o: any) => { calls.push([id, o]) } }) }
}

describe('recenterPriceOnSymbolChange', () => {
    beforeEach(() => _resetRecenterForTest())

    it('la o moneda noua pune scara din dreapta pe automat', () => {
        const c = fakeChart()
        expect(recenterPriceOnSymbolChange('BTCUSDT', c)).toBe(true)
        expect(recenterPriceOnSymbolChange('BNBUSDT', c)).toBe(true)
        expect(c.calls).toEqual([['right', { autoScale: true }], ['right', { autoScale: true }]])
    })
    it('⛔ aceeasi moneda (schimbare de interval, reincarcare de lumanari) NU atinge scara', () => {
        const c = fakeChart()
        recenterPriceOnSymbolChange('BTCUSDT', c)
        expect(recenterPriceOnSymbolChange('BTCUSDT', c)).toBe(false)
        expect(recenterPriceOnSymbolChange('BTCUSDT', c)).toBe(false)
        expect(c.calls.length).toBe(1)
    })
    it('intoarcerea pe o moneda vazuta mai devreme o centreaza din nou', () => {
        const c = fakeChart()
        recenterPriceOnSymbolChange('BTCUSDT', c)
        recenterPriceOnSymbolChange('BNBUSDT', c)
        expect(recenterPriceOnSymbolChange('BTCUSDT', c)).toBe(true)
        expect(c.calls.length).toBe(3)
    })
    it('fara chart sau cu un chart care arunca nu strica nimic', () => {
        expect(recenterPriceOnSymbolChange('ETHUSDT', null)).toBe(false)
        _resetRecenterForTest()
        const broken = { priceScale: () => { throw new Error('gone') } }
        expect(recenterPriceOnSymbolChange('ETHUSDT', broken)).toBe(false)
        expect(recenterPriceOnSymbolChange('', fakeChart())).toBe(false)
    })
})
