import { describe, it, expect } from 'vitest'
import { fmtUsd, fmtPct, intensity, cellColor, barColor, LIQ,
    spanStep, spanLabel, SPAN_MIN_PCT,
} from '../scale'

// [LIQ-PANEL 2026-10-25] Partea pura a panoului: cum se transforma dolari in
// culoare si in text citibil. E testabila, deci se testeaza — restul (canvas,
// layout) se vede cu ochiul.
//
// Operatorul a cerut explicit „sa se citeasca usor, sa se inteleaga". Pe
// telefon, asta inseamna: cifre scurte care NU mint prin rotunjire, si o scara
// de intensitate care arata diferenta dintre o lichidare de 10 mii si una de
// 10 milioane. Liniara nu arata nimic — un singur eveniment urias ar face tot
// restul negru.

describe('cifrele se citesc dintr-o privire', () => {
  it('scurteaza fara sa minta', () => {
    expect(fmtUsd(0)).toBe('—')
    expect(fmtUsd(942)).toBe('$942')
    expect(fmtUsd(12_400)).toBe('$12.4K')
    expect(fmtUsd(2_560_000)).toBe('$2.56M')
    expect(fmtUsd(1_234_000_000)).toBe('$1.23B')
  })

  it('nu produce „$0K" si nu arata zero pentru ceva ce exista', () => {
    // O lichidare de 300 $ trebuie sa se vada ca 300 $, nu ca „$0K".
    expect(fmtUsd(300)).toBe('$300')
    expect(fmtUsd(1)).toBe('$1')
    expect(fmtUsd(999)).toBe('$999')
  })

  it('valori imposibile nu dau NaN pe ecran', () => {
    for (const v of [NaN, Infinity, -5, null as any, undefined as any, 'x' as any]) {
      expect(fmtUsd(v)).toBe('—')
    }
  })

  it('procentele poarta semnul, fiindca directia e jumatate din informatie', () => {
    expect(fmtPct(2.5)).toBe('+2.50%')
    expect(fmtPct(-1.25)).toBe('-1.25%')
    expect(fmtPct(0)).toBe('0.00%')
    expect(fmtPct(NaN as any)).toBe('—')
  })
})

describe('intensitatea — LOGARITMICA, altfel nu se vede nimic', () => {
  it('zero ramane zero', () => {
    expect(intensity(0, 1_000_000)).toBe(0)
  })

  it('maximul ajunge la 1', () => {
    expect(intensity(1_000_000, 1_000_000)).toBeCloseTo(1, 5)
  })

  it('o valoare mica ramane VIZIBILA langa un maxim urias', () => {
    // Liniar, 10 mii fata de 10 milioane ar da 0,001 — adica negru.
    const i = intensity(10_000, 10_000_000)
    expect(i).toBeGreaterThan(0.3)
    expect(i).toBeLessThan(1)
  })

  it('e monotona: mai multi dolari, mai multa culoare', () => {
    const a = intensity(1_000, 1_000_000)
    const b = intensity(100_000, 1_000_000)
    expect(b).toBeGreaterThan(a)
  })

  it('nu iese din interval si nu arunca pe date stricate', () => {
    for (const [v, m] of [[NaN, 10], [10, 0], [-5, 10], [10, NaN], [Infinity, 10]] as any[]) {
      const i = intensity(v, m)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThanOrEqual(1)
    }
  })
})

describe('culorile — doua familii opuse, fiindca sunt doua lucruri opuse', () => {
  it('long lichidat si short lichidat NU au aceeasi culoare', () => {
    expect(barColor(true)).not.toBe(barColor(false))
    expect(LIQ.long).not.toBe(LIQ.short)
  })

  it('celula intoarce o culoare valida, oricat de mica e intensitatea', () => {
    for (const i of [0, 0.01, 0.5, 1]) {
      expect(cellColor(true, i)).toMatch(/^rgba?\(/)
      expect(cellColor(false, i)).toMatch(/^rgba?\(/)
    }
  })

  it('intensitate zero = transparent, ca grila goala sa NU para plina', () => {
    expect(cellColor(true, 0)).toMatch(/,\s*0\)$/)
  })

  it('date stricate nu produc „rgba(NaN...)" pe ecran', () => {
    for (const i of [NaN, Infinity, -1, 99] as any[]) {
      expect(cellColor(true, i)).not.toMatch(/NaN|Infinity/)
    }
  })
})

import { buildLadder } from '../scale'

// [2026-10-25] Prima varianta randa doar nivelurile cu date: cinci randuri,
// una sub alta. Se citea ca o LISTA, nu ca o harta — si pierdea exact ce
// conteaza: cat de departe sta fiecare gramada de pret, si cat GOL e intre ele.
// Un nivel fara lichidari nu e absenta unei date, e o informatie.
describe('scara continua — ce face dintr-o lista o HARTA', () => {
  const B = [
    { pct: 0.5, price: 80804, longUsd: 0, shortUsd: 23137, n: 2 },
    { pct: -0.25, price: 80194, longUsd: 12767053, shortUsd: 0, n: 9 },
    { pct: -0.75, price: 79930, longUsd: 33092, shortUsd: 0, n: 1 },
  ]

  it('umple GOLURILE dintre niveluri', () => {
    const l = buildLadder(B, 80489)
    const pcts = l.map(r => r.pct)
    expect(pcts).toContain(0.25)    // n-a avut date, dar exista ca treapta
    expect(pcts).toContain(-0.5)
    expect(l.length).toBeGreaterThan(B.length)
  })

  it('treptele goale sunt MARCATE, nu inventate cu zero mascat', () => {
    const gap = buildLadder(B, 80489).find(r => r.pct === 0.25)!
    expect(gap.empty).toBe(true)
    expect(gap.longUsd).toBe(0)
    expect(gap.shortUsd).toBe(0)
  })

  it('merge de SUS in JOS — cum se citeste o scara de preturi', () => {
    const l = buildLadder(B, 80489)
    for (let i = 1; i < l.length; i++) expect(l[i].pct).toBeLessThan(l[i - 1].pct)
  })

  it('pretul curent are treapta lui, ancorata la mijloc', () => {
    const now = buildLadder(B, 80489).filter(r => r.isPrice)
    expect(now).toHaveLength(1)
  })

  it('se opreste langa ultima gramada, nu la un +-10% fix', () => {
    // Altfel, pe o piata linistita ai 80 de randuri goale si 5 pline.
    const l = buildLadder(B, 80489)
    expect(Math.max(...l.map(r => r.pct))).toBeLessThan(2)
    expect(Math.min(...l.map(r => r.pct))).toBeGreaterThan(-2)
  })

  it('preturile treptelor goale sunt calculate din pret, nu lasate zero', () => {
    const gap = buildLadder(B, 80489).find(r => r.pct === 0.25)!
    expect(gap.price).toBeGreaterThan(80000)
  })

  it('nu explodeaza pe date absurde', () => {
    for (const [b, p] of [[[], 80000], [B, 0], [B, NaN], [null, 80000], [B, -5]] as any[]) {
      expect(() => buildLadder(b, p)).not.toThrow()
      expect(Array.isArray(buildLadder(b, p))).toBe(true)
    }
  })

  it('nu produce mii de trepte dintr-un interval urias', () => {
    const wide = [{ pct: 34, price: 1, longUsd: 1, shortUsd: 0, n: 1 }, { pct: -34, price: 1, longUsd: 1, shortUsd: 0, n: 1 }]
    expect(buildLadder(wide, 80000).length).toBeLessThanOrEqual(400)
  })
})

import { fmtSpan } from '../scale'

// [2026-10-26] Axa se intinde pe datele care EXISTA. Dar atunci eticheta
// trebuie sa spuna CE interval s-a desenat — altfel cineva citeste 12 ore
// crezand ca vede 90 de zile, si aia nu mai e o harta goala, e una care minte.
describe('intervalul desenat se spune, nu se presupune', () => {
  it('minute sub o ora si jumatate', () => {
    expect(fmtSpan(0, 45 * 60000)).toBe('45m')
  })
  it('ore — zecimala doar cand chiar schimba citirea', () => {
    // Sub 10 ore zecimala conteaza (2,5h vs 3h e o diferenta reala de citit);
    // peste, nu — „12h" e mai curat decat „11.9h". Prima varianta a testului
    // astepta 11.9h si codul avea DREPTATE.
    expect(fmtSpan(0, 2.5 * 3600000)).toBe('2.5h')
    expect(fmtSpan(0, 11.9 * 3600000)).toBe('12h')
    expect(fmtSpan(0, 30 * 3600000)).toBe('30h')
  })
  it('zile peste doua zile', () => {
    expect(fmtSpan(0, 90 * 24 * 3600000)).toBe('90d')
  })
  it('un interval imposibil nu scrie nimic, nu scrie NaN', () => {
    for (const [a, b] of [[5, 5], [10, 5], [NaN, 10], [0, NaN]] as any[]) {
      expect(fmtSpan(a, b)).toBe('')
    }
  })
})

// ── ZOOM pe axa de PRET 2026-10-31 ──────────────────────────────────────────
// „si fa zoom daa poti pe chart stii ce zic". Fereastra e SIMETRICA fata de
// pret, fiindca asta e intregul inteles al axei: cat de departe de pretul de
// ACUM a ars fiecare gramada. Deci un tap nu alege un centru — alege o
// ADANCIME. Centrul rămâne preţul.
describe('spanStep: fiecare tap intra mai adanc', () => {
    it('porneste din acoperirea MASURATA, nu dintr-o cifra inventata', () => {
        // acoperire +6% / -2% => porneste de la 6, impartit
        expect(spanStep(null, { upPct: 6, downPct: -2 })).toBeCloseTo(6 / 2.5, 6)
    })

    it('ia partea cea mai DEPARTE a acoperirii, nu media', () => {
        expect(spanStep(null, { upPct: 1, downPct: -9 })).toBeCloseTo(9 / 2.5, 6)
    })

    it('un tap urmator taie din fereastra curenta', () => {
        expect(spanStep(2, { upPct: 6, downPct: -2 })).toBeCloseTo(2 / 2.5, 6)
    })

    it('se opreste la prag, nu la zero', () => {
        let s: number | null = 6
        for (let i = 0; i < 30; i++) s = spanStep(s, { upPct: 6, downPct: -2 })
        expect(s).toBe(SPAN_MIN_PCT)
    })

    it('fara acoperire valida porneste de la o fereastra implicita utila', () => {
        for (const bad of [null, undefined, {}, { upPct: 0, downPct: 0 }] as any[]) {
            const s = spanStep(null, bad)
            expect(Number.isFinite(s)).toBe(true)
            expect(s).toBeGreaterThan(0)
        }
    })

    it('acoperirea lipsa cade pe fereastra implicita, nu pe cea minima', () => {
        const s = spanStep(null, { upPct: null, downPct: null } as any)
        expect(s).toBeGreaterThan(SPAN_MIN_PCT)
    })

    it('⛔ partea de JOS conteaza chiar daca sus nu s-a lichidat nimic', () => {
        // `downPct` e MEREU negativ. Fara `Math.abs`, un `Math.max` l-ar
        // arunca si fereastra ar porni din implicit, nu din ce exista.
        expect(spanStep(null, { upPct: 0, downPct: -4 })).toBeCloseTo(4 / 2.5, 6)
    })
})

describe('spanLabel: spune fereastra, si spune si cand nu e zoom', () => {
    it('fara zoom o spune pe litere', () => {
        expect(spanLabel(null)).toBe('FULL')
    })

    it('cu zoom arata fereastra', () => {
        expect(spanLabel(0.5)).toBe('±0.5%')
        expect(spanLabel(2.4)).toBe('±2.4%')
    })

    it('la fereastra minima nu se rotunjeste la zero', () => {
        expect(spanLabel(SPAN_MIN_PCT)).not.toMatch(/±0%/)
    })

    it('o fereastra fara sens nu primeste eticheta inventata', () => {
        for (const bad of [0, -1, NaN, 'x'] as any[]) expect(spanLabel(bad)).toBe('FULL')
    })
})

// ── buildLadder la zoom 2026-10-31 ──────────────────────────────────────────
// ⛔ GASIT RANDAND: serverul trimitea 44 de niveluri la un zoom de ±0,128% si
// in DOM ajungeau 5. Scara avea pasul FIX la 0,25%, deci toate cele 44 cadeau
// pe ~5 chei — si `byPct.set` le SUPRASCRIA, adica 39 de galeti dispareau in
// liniste. Zoom-ul parea sa functioneze (butonul scria ±0,128%) si arunca exact
// rezolutia pe care o castigase.
describe('buildLadder respecta treapta serverului', () => {
    function fine(stepPct: number, n: number) {
        return Array.from({ length: n }, (_, i) => ({
            pct: Number(((i - Math.floor(n / 2)) * stepPct).toFixed(6)),
            price: 80000 * (1 + ((i - Math.floor(n / 2)) * stepPct) / 100),
            longUsd: 1000 * (i + 1), shortUsd: 0, n: i + 1,
        }))
    }

    it('cu treapta fina, fiecare nivel ajunge pe randul lui', () => {
        const b = fine(0.005, 21)
        const rungs = buildLadder(b, 80000, 0.005)
        const cuDate = rungs.filter((r) => !r.empty)
        expect(cuDate.length).toBe(b.filter((x) => x.longUsd + x.shortUsd > 0).length)
    })

    it('⛔ cu pasul vechi fix, aceleasi date se strang si se PIERD', () => {
        const b = fine(0.005, 21)
        const gresit = buildLadder(b, 80000, 0.25).filter((r) => !r.empty)
        const bun = buildLadder(b, 80000, 0.005).filter((r) => !r.empty)
        expect(gresit.length).toBeLessThan(bun.length)
    })

    it('⛔ daca doua galeti cad pe acelasi rand, dolarii se ADUNA, nu se pierd', () => {
        // Doua galeti la 0,01% distanta, pe o scara cu pasul 0,25%: cad amandoua
        // pe rindul 0. Suma trebuie sa fie 3.000, nu 1.000 sau 2.000.
        const b = [
            { pct: 0.00, price: 80000, longUsd: 1000, shortUsd: 0, n: 1 },
            { pct: 0.01, price: 80008, longUsd: 2000, shortUsd: 0, n: 2 },
        ]
        const r = buildLadder(b, 80000, 0.25).find((x) => Math.abs(x.pct) < 1e-9)!
        expect(r.longUsd).toBe(3000)
        expect(r.n).toBe(3)
    })

    it('o treapta invalida cade pe cea implicita, nu imparte la zero', () => {
        const b = fine(0.25, 5)
        for (const bad of [0, -1, NaN, null, undefined] as any[]) {
            const r = buildLadder(b, 80000, bad)
            expect(r.length).toBeGreaterThan(0)
        }
    })
})
