import { describe, it, expect } from 'vitest'
import {
    sideLabel, hitLabel, horizonLabel, strengthBar, targetLabel,
    historyLabel, crowdLabel, oiLabel, liftLabel, type Horizon,
} from '../predict'

const H = (o: Partial<Horizon> = {}): Horizon => ({
    horizonMs: 3600000, calibrating: true, pct: null, resolved: 0, hits: 0, need: 30, ...o,
})

describe('procentul NU poate apărea înainte de a fi măsurat', () => {
    it('în calibrare scrie CALIBRATING şi câte cazuri lipsesc', () => {
        expect(hitLabel(H({ resolved: 12, need: 30 }))).toBe('CALIBRATING 12/30')
    })

    it('ÎN CALIBRARE NU apare NICIUN procent, nici dacă serverul trimite unul', () => {
        // Garda care contează: dacă vreodată serverul trimite pct deşi se
        // calibrează, clientul tot nu are voie să-l arate.
        const txt = hitLabel(H({ calibrating: true, resolved: 3, hits: 3, pct: 100 as any }))
        expect(txt).not.toMatch(/%/)
        expect(txt).toBe('CALIBRATING 3/30')
    })

    it('peste prag apare rata OBSERVATĂ', () => {
        expect(hitLabel(H({ calibrating: false, pct: 70, resolved: 40, hits: 28 }))).toBe('70% hit rate')
    })

    it('fără orizont scrie NO DATA, nu 0%', () => {
        expect(hitLabel(null)).toBe('NO DATA')
        expect(hitLabel(undefined)).not.toMatch(/0%/)
    })
})

describe('direcţia — NONE nu e o direcţie slabă', () => {
    it('UP şi DOWN se citesc ca magnet', () => {
        expect(sideLabel('UP')).toMatch(/UP/)
        expect(sideLabel('DOWN')).toMatch(/DOWN/)
    })

    it('NONE devine NO EDGE, nu „weak up"', () => {
        expect(sideLabel('NONE')).toBe('NO EDGE')
        expect(sideLabel('')).toBe('NO EDGE')
        expect(sideLabel('NONE')).not.toMatch(/UP|DOWN/)
    })
})

describe('ţinta — fără palier nu se inventează o cifră', () => {
    it('palierul real se scrie cu distanţa în dolari şi în procente', () => {
        const t = targetLabel({ price: 79750, usd: 1.2e8, n: 170, pct: -0.94 }, 80500)
        expect(t).toMatch(/79,750/)
        expect(t).toMatch(/−750/)
        expect(t).toMatch(/-0\.94%/)
    })

    it('fără palier scrie limpede că nu există, nu „0"', () => {
        expect(targetLabel(null, 80000)).toBe('no mapped cluster')
        expect(targetLabel({ price: 0, usd: 0, n: 0, pct: 0 }, 80000)).toBe('no mapped cluster')
    })

    it('ţintă deasupra preţului primeşte semn plus', () => {
        expect(targetLabel({ price: 80500, usd: 4e7, n: 71, pct: 0.62 }, 80000)).toMatch(/\+500/)
    })
})

describe('istoricul se spune, nu se sugerează', () => {
    const now = 1793000000000
    it('fără evenimente spune că nu are istoric', () => {
        expect(historyLabel(null, now)).toBe('no history yet')
    })

    it('13 ore se scriu ca ore, nu ca zile', () => {
        expect(historyLabel(now - 13 * 3600000, now)).toBe('13h of history')
    })

    it('sub o oră se scrie în minute — altfel 20 de minute ar arăta ca „0h"', () => {
        expect(historyLabel(now - 20 * 60000, now)).toBe('20m of history')
    })

    it('peste două zile se scrie în zile', () => {
        expect(historyLabel(now - 5 * 86400000, now)).toBe('5d of history')
    })
})

describe('context şi putere', () => {
    it('bara de putere are lăţime fixă — coloanele nu dansează', () => {
        expect(strengthBar(0).length).toBe(10)
        expect(strengthBar(100).length).toBe(10)
        expect(strengthBar(50).length).toBe(10)
        expect(strengthBar(100)).toBe('█'.repeat(10))
        expect(strengthBar(0)).toBe('░'.repeat(10))
    })

    it('puterea în afara intervalului nu rupe bara', () => {
        expect(strengthBar(-50).length).toBe(10)
        expect(strengthBar(999).length).toBe(10)
    })

    it('mulţimea se scrie ca înclinare pe ambele părţi', () => {
        expect(crowdLabel(69)).toBe('69% long / 31% short')
        expect(crowdLabel(null)).toBe('crowd unknown')
    })

    it('OI păstrează SEMNUL — el spune dacă levierul se reface', () => {
        expect(oiLabel(1.4)).toMatch(/\+1\.40%/)
        expect(oiLabel(-1.2)).toMatch(/-1\.20%/)
        expect(oiLabel(null)).toBe('OI unknown')
    })

    it('orizonturile se scriu scurt', () => {
        expect(horizonLabel(3600000)).toBe('1H')
        expect(horizonLabel(4 * 3600000)).toBe('4H')
        expect(horizonLabel(24 * 3600000)).toBe('24H')
        expect(horizonLabel(0)).toBe('—')
    })
})

describe('R-P-10 — niciun cuvânt românesc în textul vizibil', () => {
    it('toate etichetele produse sunt în engleză', () => {
        const toate = [
            sideLabel('UP'), sideLabel('DOWN'), sideLabel('NONE'),
            hitLabel(H({ resolved: 1 })), hitLabel(H({ calibrating: false, pct: 70 })), hitLabel(null),
            targetLabel(null, 1), historyLabel(null), historyLabel(Date.now() - 7200000),
            crowdLabel(null), crowdLabel(50), oiLabel(null), oiLabel(1),
            horizonLabel(3600000), horizonLabel(0),
        ].join(' | ').toLowerCase()
        const romanesti = [
            'lichid', 'pretul', 'preţul', 'magnet ↑ sus', 'calibrare', 'fara', 'fără',
            'niciun', 'date', 'ore', 'zile', 'minute', 'tinta', 'ţinta', 'putere',
        ]
        for (const r of romanesti) expect(toate).not.toContain(r)
    })
})

describe('RAPORTUL fata de oglinda — fara el procentul nu se poate citi', () => {
    // Masurat pe 125h de bare reale: o ţinta la -0,58% pe BTC e atinsa
    // neconditionat in 9% din cazuri pe 1h, dar in 86% pe 24h. Deci „86%" poate
    // fi strălucit sau nul, si doar raportul spune care.
    it('arata rata, rata de baza si raportul', () => {
        const t = liftLabel(H({ calibrating: false, pct: 30, controlPct: 9, lift: 3.33 } as any))
        expect(t).toMatch(/30%/)
        expect(t).toMatch(/9%/)
        expect(t).toMatch(/3\.3/)
    })

    it('raport 1 se citeste ca NICIUN avantaj, nu ca o laudă', () => {
        const t = liftLabel(H({ calibrating: false, pct: 86, controlPct: 86, lift: 1 } as any))
        expect(t).toMatch(/86%/)
        expect(t).toMatch(/no edge|×1\.0/i)
    })

    it('IN CALIBRARE nu apare nici raportul', () => {
        const t = liftLabel(H({ calibrating: true, resolved: 7, pct: 30, controlPct: 9, lift: 3.3 } as any))
        expect(t).toBe('CALIBRATING 7/30')
        expect(t).not.toMatch(/%\s*vs|×/)
    })

    it('fara oglinda masurata arata doar rata, si spune ca nu are reper', () => {
        const t = liftLabel(H({ calibrating: false, pct: 55, controlPct: null, lift: null } as any))
        expect(t).toMatch(/55%/)
        expect(t).toMatch(/no baseline|unbenchmarked/i)
    })

    it('eticheta e in ENGLEZA', () => {
        const all = [
            liftLabel(H({ calibrating: false, pct: 30, controlPct: 9, lift: 3.33 } as any)),
            liftLabel(H({ calibrating: false, pct: 86, controlPct: 86, lift: 1 } as any)),
            liftLabel(H({ calibrating: true, resolved: 2 } as any)),
            liftLabel(H({ calibrating: false, pct: 55, controlPct: null, lift: null } as any)),
        ].join(' ').toLowerCase()
        for (const r of ['rata', 'oglinda', 'raport', 'fara', 'fără', 'avantaj', 'calibrare'])
            expect(all).not.toContain(r)
    })
})

describe('CAND vine verdictul — pe ecran, nu doar in discuţie', () => {
    it('in calibrare arata si estimarea', () => {
        const t = liftLabel(H({ resolved: 10, need: 30, perDay: 10, etaDays: 2 } as any))
        expect(t).toMatch(/CALIBRATING 10\/30/)
        expect(t).toMatch(/~2d/)
    })

    it('estimarea in luni se scrie limpede, nu ca 70 de zile', () => {
        const t = liftLabel(H({ resolved: 1, need: 30, perDay: 0.4, etaDays: 72.5 } as any))
        expect(t).toMatch(/~2\.4mo|~2mo|~3mo/)
    })

    it('fara ritm masurat NU se promite un termen', () => {
        const t = liftLabel(H({ resolved: 0, need: 30, perDay: null, etaDays: null } as any))
        expect(t).toBe('CALIBRATING 0/30')
        expect(t).not.toMatch(/~/)
    })

    it('peste prag nu apare nicio estimare', () => {
        const t = liftLabel(H({ calibrating: false, pct: 30, controlPct: 9, lift: 3.3, etaDays: null } as any))
        expect(t).not.toMatch(/~/)
    })
})
