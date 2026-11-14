import { describe, it, expect } from 'vitest'
import { projectedVolume, volumeIntensityScore } from '../fusionMath'

// [2026-11-14] Cadranul VOL arata 0 o buna parte din timp: compara bara care
// abia se formeaza cu bare intregi. Acum bara curenta e adusa la lungimea ei.
const TF = 3600                      // bare de o ora, timp in secunde
const T0 = 1_800_000_000
// 21 de bare inchise cu volum 100, apoi bara curenta
const bars = (lastVol: number) => [...Array.from({ length: 21 }, (_, i) => ({ time: T0 + i * TF, volume: 100 })), { time: T0 + 21 * TF, volume: lastVol }]
const at = (fracOfBar: number) => (T0 + 21 * TF + fracOfBar * TF) * 1000

describe('projectedVolume', () => {
    it('⛔ la un sfert din bara, cu un sfert din volum, piata e NORMALA — nu zero', () => {
        const k = bars(25)
        expect(volumeIntensityScore(k, 20)).toBe(0)                 // socoteala veche: 0
        const p = projectedVolume(k, at(0.25), 20)!
        expect(p.ratio).toBeCloseTo(1, 6)
        expect(p.score).toBe(25)
        expect(p.projected).toBe(true)
    })
    it('acelasi ritm da acelasi rezultat oriunde in bara', () => {
        for (const f of [0.2, 0.5, 0.8, 1]) expect(projectedVolume(bars(100 * f), at(f), 20)!.ratio).toBeCloseTo(1, 6)
    })
    it('volum dublu fata de ritmul normal → 75; de 2,5 ori sau mai mult → 100', () => {
        expect(projectedVolume(bars(100), at(0.5), 20)!.score).toBe(75)
        expect(projectedVolume(bars(200), at(0.5), 20)!.score).toBe(100)
    })
    it('in primele 15% din bara nu proiecteaza: foloseste ultima bara inchisa', () => {
        // un singur ordin mare in primul minut nu are voie sa para de 20×
        const k = bars(40)
        const p = projectedVolume(k, at(0.02), 20)!
        expect(p.projected).toBe(false)
        expect(p.ratio).toBeCloseTo(1, 6)
    })
    it('dupa ce bara s-a terminat (date intarziate) nu mai imparte la nimic', () => {
        const p = projectedVolume(bars(150), at(1.4), 20)!
        expect(p.ratio).toBeCloseTo(1.5, 6)
        expect(p.projected).toBe(false)
    })
    it('lungimea barei se citeste din date, nu dintr-o setare', () => {
        const day = [...Array.from({ length: 21 }, (_, i) => ({ time: T0 + i * 86400, volume: 1000 })), { time: T0 + 21 * 86400, volume: 500 }]
        expect(projectedVolume(day, (T0 + 21 * 86400 + 43200) * 1000, 20)!.ratio).toBeCloseTo(1, 6)
    })
    it('fara date destule sau cu gunoi → null, nu o cifra', () => {
        expect(projectedVolume([], at(0.5), 20)).toBeNull()
        expect(projectedVolume(bars(50).slice(-2), at(0.5), 20)).toBeNull()
        expect(projectedVolume(null as any, at(0.5), 20)).toBeNull()
        const zero = bars(50).map((b) => ({ ...b, volume: 0 }))
        expect(projectedVolume(zero, at(0.5), 20)).toBeNull()
    })
    it('bara curenta fara volum citibil cade pe ultima bara INCHISA, nu pe zero', () => {
        const nan = bars(50); (nan[nan.length - 1] as any).volume = NaN
        const p = projectedVolume(nan, at(0.5), 20)!
        expect(p.projected).toBe(false)
        expect(p.ratio).toBeCloseTo(1, 6)
    })
})
