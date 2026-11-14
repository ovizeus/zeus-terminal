import { describe, it, expect, vi, afterEach } from 'vitest'
import { basisFromResponse, fetchBasisRate } from '../basisRate'

// [2026-11-14] „FUND 0%" pe radar, la toata lumea: cadrul de pret de pe server
// nu poarta rata de finantare, iar aplicatia scria `msg.fr || 0` la fiecare tic.
// In plus, rata se cerea mereu pentru BTCUSDT, orice moneda ar fi fost in chart.
const w = window as any

describe('basisFromResponse', () => {
    it('rata, urmatoarea finantare si baza, din raspunsul serverului', () => {
        const b = basisFromResponse({ rate: 0.0000375, markPrice: 65206.9, indexPrice: 65261.43, nextFundingTime: 1794700800000 })!
        expect(b.fr).toBe(0.0000375)
        expect(b.frCd).toBe(1794700800000)
        expect(b.basisRate).toBeCloseTo(((65206.9 - 65261.43) / 65261.43) * 100, 9)
    })
    it('⛔ o rata lipsa ramane null — nu devine zero', () => {
        expect(basisFromResponse({ markPrice: 1, indexPrice: 1 })!.fr).toBeNull()
        expect(basisFromResponse({ rate: null, markPrice: 1, indexPrice: 1 })!.fr).toBeNull()
        expect(basisFromResponse({ rate: 'x', markPrice: 1, indexPrice: 1 })!.fr).toBeNull()
        expect(basisFromResponse({ rate: 0, markPrice: 1, indexPrice: 1 })!.fr).toBe(0)      // zero ADEVARAT ramane zero
        expect(basisFromResponse(null)).toBeNull()
    })
})

describe('fetchBasisRate', () => {
    afterEach(() => { vi.unstubAllGlobals(); delete w.S })
    const reply = (data: any) => vi.fn(async () => ({ json: async () => ({ ok: true, data }) }))

    it('cere moneda din chart, nu mereu BTC', async () => {
        w.S = { symbol: 'ETHUSDT', price: 1900 }
        const f = reply({ rate: 0.0001, markPrice: 1900, indexPrice: 1899, nextFundingTime: 5 })
        vi.stubGlobal('fetch', f)
        await fetchBasisRate()
        expect(String((f.mock.calls as unknown as unknown[][])[0][0])).toContain('symbol=ETHUSDT')
        expect(w.S.fr).toBe(0.0001)
        expect(w.S.frCd).toBe(5)
    })
    it('⛔ daca moneda s-a schimbat cat a durat cererea, raspunsul se arunca', async () => {
        w.S = { symbol: 'ETHUSDT', price: 1900, fr: 0.0007 }
        vi.stubGlobal('fetch', vi.fn(async () => { w.S.symbol = 'SOLUSDT'; return { json: async () => ({ ok: true, data: { rate: 0.0001, markPrice: 1900, indexPrice: 1899 } }) } }))
        await fetchBasisRate()
        expect(w.S.fr).toBe(0.0007)
        expect(w.S.markPrice).toBeUndefined()
    })
    it('⛔ un raspuns fara rata nu sterge rata pe care o aveam', async () => {
        w.S = { symbol: 'BTCUSDT', price: 65000, fr: 0.0002 }
        vi.stubGlobal('fetch', reply({ markPrice: 65000, indexPrice: 65010 }))
        await fetchBasisRate()
        expect(w.S.fr).toBe(0.0002)
    })
    it('o cerere picata nu arunca si nu atinge starea', async () => {
        w.S = { symbol: 'BTCUSDT', fr: 0.0002 }
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net') }))
        await expect(fetchBasisRate()).resolves.toBeUndefined()
        expect(w.S.fr).toBe(0.0002)
    })
})

describe('cadrul de pret nu mai pune rata pe zero', () => {
    it('sursa nu mai contine `msg.fr || 0`', () => {
        const src = require('fs').readFileSync(require('path').resolve(__dirname, '../marketDataWS.ts'), 'utf8') as string
        expect(src).not.toMatch(/S\.fr\s*=\s*msg\.fr\s*\|\|\s*0/)
        expect(src).toMatch(/Number\.isFinite\(\+msg\.fr\)\) w\.S\.fr = \+msg\.fr/)
    })
})
