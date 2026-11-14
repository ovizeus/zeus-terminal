import { describe, it, expect, beforeEach } from 'vitest'
import {
    pulseOf, liqPulseScore, baselinePerWindow, longSharePct, fmtUsdShort,
    recordLiq, recentLiqs, baselineOf, refreshBaseline, _resetLiqPulseForTest,
    PULSE_WINDOW_MS,
} from '../liqPulse'

// [2026-11-14] Cadranul LIQ: lichidarile monedei din chart, pe 5 minute, fata
// de media ei — nu toate monedele pe un minut fata de un prag fix de 1 milion $.
const NOW = 1_800_000_000_000
const ev = (symbol: string, usd: number, isLong: boolean, agoMs: number) => ({ symbol, usd, isLong, ts: NOW - agoMs })

describe('pulseOf', () => {
    const E = [
        ev('BTCUSDT', 100, true, 10_000), ev('BTCUSDT', 300, false, 60_000), ev('BTCUSDT', 50, true, 299_000),
        ev('BTCUSDT', 999, true, 301_000),        // in afara ferestrei de 5 minute
        ev('ETHUSDT', 777, true, 5_000),          // alta moneda
    ]
    it('aduna doar moneda ceruta, doar in fereastra', () => {
        expect(pulseOf(E, 'BTCUSDT', NOW, PULSE_WINDOW_MS)).toEqual({ usd: 450, longUsd: 150, shortUsd: 300, n: 3 })
        expect(pulseOf(E, 'ETHUSDT', NOW, PULSE_WINDOW_MS).usd).toBe(777)
        expect(pulseOf(E, 'SOLUSDT', NOW, PULSE_WINDOW_MS)).toEqual({ usd: 0, longUsd: 0, shortUsd: 0, n: 0 })
    })
    it('ignora gunoiul si evenimentele „din viitor"', () => {
        const bad = [{ symbol: 'BTCUSDT', usd: NaN, isLong: true, ts: NOW }, { symbol: 'BTCUSDT', usd: -5, isLong: true, ts: NOW },
            { symbol: 'BTCUSDT', usd: 10, isLong: true, ts: NOW + 60_000 }, null as any]
        expect(pulseOf(bad, 'BTCUSDT', NOW, PULSE_WINDOW_MS).n).toBe(0)
        expect(pulseOf(null as any, 'BTCUSDT', NOW, PULSE_WINDOW_MS).n).toBe(0)
    })
})

describe('liqPulseScore — fata de media monedei', () => {
    it('media → 25, dublul → 50, de patru ori → 100', () => {
        expect(liqPulseScore(1000, 1000)).toBe(25)
        expect(liqPulseScore(2000, 1000)).toBe(50)
        expect(liqPulseScore(4000, 1000)).toBe(100)
        expect(liqPulseScore(40_000, 1000)).toBe(100)
        expect(liqPulseScore(0, 1000)).toBe(0)
    })
    it('aceeasi suma inseamna altceva pe monede diferite', () => {
        // 500K in 5 minute: liniste pe o moneda mare, furtuna pe una mica
        expect(liqPulseScore(500_000, 2_000_000)).toBe(6)
        expect(liqPulseScore(500_000, 50_000)).toBe(100)
    })
    it('⛔ fara medie cunoscuta nu inventeaza o scara', () => {
        for (const b of [null, undefined, 0, -1, NaN]) expect(liqPulseScore(500_000, b as any)).toBeNull()
    })
})

describe('baselinePerWindow', () => {
    it('totalul pe 24 de ore, impartit la ferestre de 5 minute', () => {
        // 288 de ferestre intr-o zi
        expect(baselinePerWindow(288_000, NOW - 86_400_000, NOW, PULSE_WINDOW_MS)).toBeCloseTo(1000, 6)
    })
    it('daca istoricul e mai scurt de o zi, imparte la cat exista', () => {
        expect(baselinePerWindow(12_000, NOW - 3_600_000, NOW, PULSE_WINDOW_MS)).toBeCloseTo(1000, 6)
    })
    it('un istoric mai vechi de o zi nu lungeste fereastra (serverul da doar 24h)', () => {
        expect(baselinePerWindow(288_000, NOW - 5 * 86_400_000, NOW, PULSE_WINDOW_MS)).toBeCloseTo(1000, 6)
    })
    it('⛔ sub o ora de istoric nu exista medie', () => {
        expect(baselinePerWindow(5000, NOW - 20 * 60_000, NOW, PULSE_WINDOW_MS)).toBeNull()
        expect(baselinePerWindow(0, NOW - 86_400_000, NOW, PULSE_WINDOW_MS)).toBeNull()
        expect(baselinePerWindow(5000, 0, NOW, PULSE_WINDOW_MS)).toBeNull()
    })
})

describe('cine e lichidat si formatarea', () => {
    it('procentul de longuri, sau null cand nu s-a lichidat nimic', () => {
        expect(longSharePct({ usd: 400, longUsd: 300, shortUsd: 100, n: 4 })).toBe(75)
        expect(longSharePct({ usd: 0, longUsd: 0, shortUsd: 0, n: 0 })).toBeNull()
    })
    it('sume scurte, citibile', () => {
        expect(fmtUsdShort(420_300)).toBe('$420K')
        expect(fmtUsdShort(1_250_000)).toBe('$1.25M')
        expect(fmtUsdShort(18_400_000)).toBe('$18.4M')
        expect(fmtUsdShort(2_140_000_000)).toBe('$2.14B')
        expect(fmtUsdShort(830)).toBe('$830')
        expect(fmtUsdShort(0)).toBe('$0')
        expect(fmtUsdShort(NaN)).toBe('$0')
    })
})

describe('starea: inelul de evenimente si media', () => {
    beforeEach(() => _resetLiqPulseForTest())

    it('pastreaza ce vine de pe flux si arunca ce e prea vechi', () => {
        recordLiq({ symbol: 'btcusdt', usd: 100, isLong: true, ts: NOW - 1000 })
        recordLiq({ symbol: 'BTCUSDT', usd: 200, isLong: false, ts: NOW - 25 * 60_000 })
        recordLiq({ symbol: '', usd: 100, isLong: true, ts: NOW })
        recordLiq({ symbol: 'BTCUSDT', usd: 'x', isLong: true, ts: NOW })
        const kept = recentLiqs(NOW)
        expect(kept).toEqual([{ symbol: 'BTCUSDT', usd: 100, isLong: true, ts: NOW - 1000 }])
    })
    it('nu creste la nesfarsit', () => {
        for (let i = 0; i < 9000; i++) recordLiq({ symbol: 'BTCUSDT', usd: 1, isLong: true, ts: NOW })
        expect(recentLiqs(NOW).length).toBeLessThanOrEqual(6000)
    })
    it('media se ia de pe server o singura data pe interval, si nu pica daca serverul refuza', async () => {
        let calls = 0
        const ok = (async (url: string) => { calls++; expect(url).toContain('symbol=BTCUSDT'); expect(url).toContain('days=1')
            return { ok: true, json: async () => ({ stats: { totalUsd: 288_000, since: Date.now() - 86_400_000 } }) } }) as any
        expect(baselineOf('BTCUSDT')).toBeNull()
        refreshBaseline('BTCUSDT', 65000, NOW, ok)
        refreshBaseline('BTCUSDT', 65000, NOW, ok)            // inca in zbor: nu cere a doua oara
        await new Promise((r) => setTimeout(r, 5))
        expect(calls).toBe(1)
        expect(baselineOf('BTCUSDT')).toBeCloseTo(1000, 0)
        refreshBaseline('BTCUSDT', 65000, Date.now(), ok)     // proaspata: nu cere iar
        expect(calls).toBe(1)

        const bad = (async () => { throw new Error('net') }) as any
        refreshBaseline('ETHUSDT', 1900, NOW, bad)
        await new Promise((r) => setTimeout(r, 5))
        expect(baselineOf('ETHUSDT')).toBeNull()
        refreshBaseline('', 65000, NOW, ok); refreshBaseline('SOLUSDT', 0, NOW, ok)
        expect(calls).toBe(1)
    })
})
