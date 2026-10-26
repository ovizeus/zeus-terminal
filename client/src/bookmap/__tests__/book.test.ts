import { describe, it, expect } from 'vitest'
import {
    bookIntensity, bookColor, BANDS, WINDOWS, fmtSpread, fmtWall,
    rowToY, colToX, bandLabel, windowLabel, sourceLabel, BOOK,
} from '../book'

describe('intensitatea e LOGARITMICA — raportul max/median masurat e 427x', () => {
    it('zero rameane zero', () => {
        expect(bookIntensity(0, 1e6)).toBe(0)
        expect(bookIntensity(-5, 1e6)).toBe(0)
    })

    it('maximul da 1', () => {
        expect(bookIntensity(1e6, 1e6)).toBeCloseTo(1, 3)
    })

    it('nivelul MEDIAN (1/427 din maxim) e CLAR vizibil — asta e tot rostul', () => {
        // Liniar ar da 0,0023, adica negru, adica harta ar minti ca nu e nimic
        // acolo — si 1/427 e cazul cel mai des, nu unul marginal.
        //
        // Pragul de 0,3 nu e arbitrar: la scara 1e3 medianul iese 0,175 (harta
        // stinsa), la 1e4 iese 0,347, la 1e5 iese 0,474 dar zgomotul de la
        // 1/5000 sare la 0,264 si harta pare uniform aglomerata. 1e4 e alegerea.
        const lin = 1 / 427
        const log = bookIntensity(1e6 / 427, 1e6)
        expect(log).toBeGreaterThan(lin * 100)
        expect(log).toBeGreaterThan(0.3)
        expect(log).toBeLessThan(0.45)
    })

    it('zgomotul (1/50.000 din maxim) rameane in FUNDAL, nu se aprinde', () => {
        // Partea cealalta a aceleiasi alegeri: o scara prea mare ar aprinde tot.
        expect(bookIntensity(1e6 / 50000, 1e6)).toBeLessThan(0.1)
    })

    it('monotona: mai mulţi dolari, intensitate mai mare', () => {
        let prev = -1
        for (const u of [1, 100, 1e4, 1e5, 5e5, 1e6]) {
            const v = bookIntensity(u, 1e6)
            expect(v).toBeGreaterThanOrEqual(prev)
            prev = v
        }
    })

    it('maxim zero sau absurd nu produce NaN', () => {
        for (const m of [0, -1, NaN, Infinity]) {
            const v = bookIntensity(1000, m as any)
            expect(Number.isFinite(v)).toBe(true)
            expect(v).toBeGreaterThanOrEqual(0)
            expect(v).toBeLessThanOrEqual(1)
        }
    })
})

describe('culorile — cyan = partea de CUMPARARE, chihlimbar = partea de VANZARE', () => {
    // Aceeasi semantica ca in LIQ MAP, dinadins: acolo cyan era short lichidat
    // (cumparare fortata) si chihlimbar long lichidat (vanzare fortata). Deci
    // in tot panoul cyan = forta de cumparare, chihlimbar = forta de vanzare.
    // NU rosu/verde: ochiul le citeste ca „sus/jos", nu ca „cerere/oferta".
    it('bid si ask sunt din familii DIFERITE, nu doua capete ale aceleiasi', () => {
        expect(bookColor('bid', 1)).not.toBe(bookColor('ask', 1))
        expect(BOOK.bid).not.toBe(BOOK.ask)
    })

    it('intensitate zero e transparenta, nu o culoare plina', () => {
        expect(bookColor('bid', 0)).toMatch(/rgba\([^)]*,\s*0(\.0+)?\)/)
    })

    it('intensitatea creste opacitatea, nu schimba nuanta', () => {
        const a = bookColor('bid', 0.2), b = bookColor('bid', 0.9)
        expect(a).not.toBe(b)
        const nums = (s: string) => s.match(/[\d.]+/g)!.slice(0, 3).join(',')
        expect(nums(a)).toBe(nums(b))
    })

    it('intensitatea in afara intervalului nu rupe culoarea', () => {
        for (const v of [-1, 2, NaN]) {
            expect(bookColor('ask', v as any)).toMatch(/^rgba\(/)
        }
    })
})

describe('ZOOM — presetari care au sens pe datele care EXISTA', () => {
    it('benzile merg de la foarte strans pana la AUTO', () => {
        expect(BANDS.length).toBeGreaterThanOrEqual(4)
        expect(BANDS[BANDS.length - 1].value).toBe('auto')
        for (const b of BANDS.slice(0, -1)) {
            expect(typeof b.value).toBe('number')
            expect(b.value as number).toBeLessThanOrEqual(0.2)
        }
    })

    it('NICIO banda nu depaseste ce exista in carte (masurat ±0,16%)', () => {
        // Binance REST limit=1000 acopera -0,155% .. +0,160%. O presetare de
        // ±1% ar desena o harta 84% goala si ar parea stricata.
        for (const b of BANDS) {
            if (typeof b.value === 'number') expect(b.value).toBeLessThanOrEqual(0.2)
        }
    })

    it('ferestrele de timp sunt in secunde si cresc', () => {
        expect(WINDOWS.length).toBeGreaterThanOrEqual(3)
        for (let i = 1; i < WINDOWS.length; i++) {
            expect(WINDOWS[i].value).toBeGreaterThan(WINDOWS[i - 1].value)
        }
        expect(WINDOWS[0].value).toBeGreaterThanOrEqual(60)
    })

    it('etichetele sunt in ENGLEZA si scurte', () => {
        const txt = BANDS.map(b => b.label).concat(WINDOWS.map(w => w.label)).join(' ').toLowerCase()
        for (const r of ['banda', 'bandă', 'minute', 'auto-matic', 'secunde']) expect(txt).not.toContain(r)
        for (const b of BANDS) expect(b.label.length).toBeLessThanOrEqual(6)
    })
})

describe('geometria — randurile se mapeaza CONSISTENT, altfel desenul danseaza', () => {
    it('randul 0 e JOS, ultimul e SUS (preturi mici jos)', () => {
        const h = 200, rows = 20
        expect(rowToY(0, rows, h)).toBeGreaterThan(rowToY(rows - 1, rows, h))
    })

    it('randul acopera exact o felie, fara gauri si fara suprapunere', () => {
        const h = 200, rows = 20
        const y0 = rowToY(0, rows, h), y1 = rowToY(1, rows, h)
        expect(Math.abs((y0 - y1) - h / rows)).toBeLessThan(0.001)
    })

    it('coloana 0 e la stanga, ultima la dreapta', () => {
        const w = 300, cols = 30
        expect(colToX(0, cols, w)).toBeLessThan(colToX(cols - 1, cols, w))
        expect(colToX(cols - 1, cols, w) + w / cols).toBeCloseTo(w, 3)
    })
})

describe('textele — spread, pereti, sursa', () => {
    it('spread-ul se scrie in dolari si in puncte de baza', () => {
        const t = fmtSpread(0.1, 80000)
        expect(t).toMatch(/0\.10/)
        expect(t).toMatch(/bp/)
    })

    it('spread lipsa NU devine 0 — ar fi o afirmaţie din date care lipsesc', () => {
        expect(fmtSpread(null, 80000)).toBe('—')
        expect(fmtSpread(0.1, null)).toMatch(/0\.10/)
    })

    it('peretele arata partea, pretul si distanţa in dolari', () => {
        const t = fmtWall({ side: 'BID', price: 79931, pct: -0.58, usd: 1.16e8,
            peakUsd: 2e8, firmness: 0.92, distUsd: -469 })
        expect(t).toMatch(/BID/)
        expect(t).toMatch(/79,931/)
        expect(t).toMatch(/-469/)
        expect(t).toMatch(/116\.0M|116M/)
    })

    it('fermitatea apare ca procent, fiindca un perete slab NU e perete', () => {
        const t = fmtWall({ side: 'ASK', price: 80500, pct: 0.2, usd: 5e6,
            peakUsd: 9e6, firmness: 0.31, distUsd: 178 })
        expect(t).toMatch(/31%/)
    })

    it('sursa spune CAT DE ADANC vedem, nu doar ca merge', () => {
        const t = sourceLabel({ deepLevels: 2000, deepFrames: 120, topFrames: 60 } as any)
        expect(t).toMatch(/2,000/)
        expect(t).toMatch(/levels/i)
    })

    it('fara cadre sursa spune ca ASTEAPTA, nu ca e stricata', () => {
        const t = sourceLabel({ deepLevels: null, deepFrames: 0, topFrames: 0 } as any)
        expect(t).toMatch(/waiting|no data/i)
        expect(t).not.toMatch(/error|broken/i)
    })

    it('etichetele de banda si fereastra se citesc', () => {
        expect(bandLabel('auto')).toMatch(/auto/i)
        expect(bandLabel(0.05)).toMatch(/0\.05/)
        expect(windowLabel(600)).toMatch(/10m/)
        expect(windowLabel(120)).toMatch(/2m/)
    })
})
