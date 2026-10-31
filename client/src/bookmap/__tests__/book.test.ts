import { describe, it, expect } from 'vitest'
import {
    bookIntensity, bookColor, BANDS, WINDOWS, fmtSpread, fmtWall,
    rowToY, colToX, bandLabel, windowLabel, sourceLabel, BOOK,
    bubbleRadius, bubbleColor, bubbleCutoff, liqRing, liqSourceNote, cobRows,
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

describe('⛔ REFERINTA DE JOS — harta era uniform aprinsa, vazuta RANDAND', () => {
    // Masurasem max/median PE NIVEL (745x) si potrivisem scara pentru el. Dar o
    // celula aduna ~19 niveluri, deci pe CELULA raportul e 3,0x. Cu scara pentru
    // 745x, p10 -> 0,79, median -> 0,88, p90 -> 0,97: tot aprins.
    // Cu normalizare intre p05 si max: 0,25 / 0,50 / 0,70. Asta discrimineaza.
    const LO = 580_000, MAX = 3_870_000, MED = 1_300_000, P90 = 2_890_000

    it('cu referinta, medianul NU mai sare la 0,88', () => {
        const v = bookIntensity(MED, MAX, LO)
        expect(v).toBeGreaterThan(0.3)
        expect(v).toBeLessThan(0.8)
    })

    it('intervalul se desfasoara pe toata scara, nu se inghesuie sus', () => {
        const a = bookIntensity(LO * 1.2, MAX, LO)
        const b = bookIntensity(MED, MAX, LO)
        const c = bookIntensity(P90, MAX, LO)
        expect(a).toBeLessThan(b)
        expect(b).toBeLessThan(c)
        expect(c - a).toBeGreaterThan(0.4)
    })

    it('fara referinta se pastreaza comportamentul vechi — harta nu rameane neagra', () => {
        expect(bookIntensity(MED, MAX)).toBeGreaterThan(0.5)
        expect(bookIntensity(MED, MAX, 0)).toBeGreaterThan(0.5)
        expect(bookIntensity(MED, MAX, NaN as any)).toBeGreaterThan(0.5)
    })

    it('sub referinta e ZERO, nu o umbra', () => {
        expect(bookIntensity(LO * 0.5, MAX, LO)).toBe(0)
        expect(bookIntensity(LO, MAX, LO)).toBe(0)
    })

    it('maximul da mereu 1', () => {
        expect(bookIntensity(MAX, MAX, LO)).toBeCloseTo(1, 3)
    })

    it('referinta absurda (peste maxim) nu rupe scara', () => {
        for (const lo of [MAX * 2, -5, Infinity]) {
            const v = bookIntensity(MED, MAX, lo as any)
            expect(Number.isFinite(v)).toBe(true)
            expect(v).toBeGreaterThanOrEqual(0)
            expect(v).toBeLessThanOrEqual(1)
        }
    })
})

describe('BULELE — tranzactii executate, raza LOGARITMICA', () => {
    // Masurat pe 1000 de tranzactii reale: marimile merg de la 0,001 la 7,25
    // BTC, raport peste 7000x. Liniar, tot ce e normal ar fi invizibil langa
    // una singura uriasa.
    it('zero sau negativ nu deseneaza nimic', () => {
        expect(bubbleRadius(0, 1e6)).toBe(0)
        expect(bubbleRadius(-5, 1e6)).toBe(0)
        expect(bubbleRadius(100, 0)).toBe(0)
    })

    it('cea mai mare din fereastra ia raza maxima', () => {
        expect(bubbleRadius(1e6, 1e6, 14, 1.5)).toBeCloseTo(14, 2)
    })

    it('o tranzactie de 1/1000 din maxim rameane VIZIBILA', () => {
        const r = bubbleRadius(1000, 1e6, 14, 1.5)
        expect(r).toBeGreaterThan(2.5)
        expect(r).toBeLessThan(10)
    })

    it('raza creste monoton cu dolarii', () => {
        let prev = -1
        for (const u of [10, 1e3, 1e4, 1e5, 1e6]) {
            const r = bubbleRadius(u, 1e6)
            expect(r).toBeGreaterThanOrEqual(prev)
            prev = r
        }
    })

    it('culoarea spune cine a LOVIT, nu cine statea in carte', () => {
        expect(bubbleColor(true)).toContain(BOOK.ask)
        expect(bubbleColor(false)).toContain(BOOK.bid)
        expect(bubbleColor(true)).not.toBe(bubbleColor(false))
    })

    it('pragul taie praful, dar se adapteaza la piata', () => {
        expect(bubbleCutoff(1e6, 0.02)).toBe(20000)
        expect(bubbleCutoff(1e4, 0.02)).toBe(200)
        expect(bubbleCutoff(0)).toBe(Infinity)
    })
})

describe('LICHIDARILE — altfel decat tranzactiile, dinadins', () => {
    it('sunt INEL, nu disc — ca sa nu se piarda printre bule', () => {
        const r = liqRing(true)
        expect(r.width).toBeGreaterThan(0)
        expect(r.stroke).toContain(BOOK.ask)
        expect(liqRing(false).stroke).toContain(BOOK.bid)
    })

    it('panoul SPUNE de pe ce burse vin — carnetul e Binance, ele nu', () => {
        const t = liqSourceNote(12)
        expect(t).toMatch(/12 liquidations/)
        expect(t).toMatch(/Bybit/)
        expect(t).toMatch(/OKX/)
        expect(t).toMatch(/Binance does not deliver/)
    })

    it('fara lichidari spune ca nu-s, nu tace', () => {
        expect(liqSourceNote(0)).toMatch(/no liquidations/)
        expect(liqSourceNote(NaN)).toMatch(/no liquidations/)
    })

    it('singular corect la una singura', () => {
        expect(liqSourceNote(1)).toMatch(/1 liquidation —/)
    })
})

describe('COB — carnetul de ACUM, pe aceleasi randuri ca harta', () => {
    const cells = [
        { col: 0, row: 3, bidUsd: 100, askUsd: 0 },
        { col: 1, row: 3, bidUsd: 500, askUsd: 0 },
        { col: 1, row: 7, bidUsd: 0, askUsd: 900 },
        { col: 1, row: 7, bidUsd: 0, askUsd: 100 },
    ]

    it('ia DOAR ultima coloana — aia e „acum"', () => {
        const r = cobRows(cells, 2)
        expect(r.map((x) => x.row)).toEqual([3, 7])
        expect(r[0].bidUsd).toBe(500)
    })

    it('aduna celulele care cad pe acelasi rand', () => {
        expect(cobRows(cells, 2).find((x) => x.row === 7)!.askUsd).toBe(1000)
    })

    it('randurile vin in ordine, chiar cand sosesc AMESTECATE', () => {
        // Prima versiune folosea celule deja in ordine, deci mutatia care
        // scotea sortarea trecea: Map pastreaza ordinea de inserare.
        const amestecat = [
            { col: 1, row: 9, bidUsd: 0, askUsd: 10 },
            { col: 1, row: 2, bidUsd: 10, askUsd: 0 },
            { col: 1, row: 5, bidUsd: 5, askUsd: 0 },
            { col: 1, row: 1, bidUsd: 7, askUsd: 0 },
        ]
        const r = cobRows(amestecat, 2)
        expect(r.map((x) => x.row)).toEqual([1, 2, 5, 9])
    })

    it('fara celule da lista goala', () => {
        expect(cobRows([], 5)).toEqual([])
        expect(cobRows(null as any, 5)).toEqual([])
    })
})
