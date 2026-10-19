// ARACHNE — tesatoarea de linii.
//
// Cerut de operator cu doua poze de pe TradingView: diagonale rosii
// descendente, diagonale verzi ascendente, orizontale galbene, fiecare
// etichetata, plus ruperea si intrarea.
//
// Verificat ca nu e repetare: in Zeus nu exista linii de trend geometrice —
// cele patru potriviri pentru „slope" sunt despre panta unei medii, iar
// `calcSRTable` sunt multipli de ATR in jurul pretului, adica niveluri care se
// misca odata cu el si n-au fost atinse de nimic.
//
// Testele apasa pe locul unde un desenator de linii MINTE cel mai usor: o
// dreapta prin doua puncte oarecare arata ca o linie de trend. Daca pretul a
// trecut prin ea intre ancore, nu e linie — si asta trebuie dovedit.

import { describe, it, expect } from 'vitest'
import {
  findPivots, clusterLevels, buildTrendlines, lineValueAt, arachne, findRetest,
} from '../indicatorCalcArachne'

describe('pivoti', () => {
  it('gaseste maximul local si minimul local', () => {
    //            0  1  2  3  4  5  6
    const highs = [1, 2, 5, 2, 1, 2, 1]
    const lows = [1, 0, 1, 1, -3, 1, 1]
    const p = findPivots(highs, lows, 2)
    expect(p.find(x => x.kind === 'high' && x.index === 2)).toBeTruthy()
    expect(p.find(x => x.kind === 'low' && x.index === 4)).toBeTruthy()
  })

  it('NU face pivoti din barele de la capete — nu au dreapta confirmata', () => {
    // Un varf pe ultima bara s-ar putea muta la urmatorul tick; o linie trasa
    // pe el s-ar redesena intruna.
    const highs = [1, 2, 3, 4, 9]
    const lows = [1, 1, 1, 1, 1]
    const p = findPivots(highs, lows, 2)
    expect(p.some(x => x.index === 4)).toBe(false)
    expect(p.some(x => x.index === 0)).toBe(false)
  })

  it('un platou nu produce doi pivoti pentru acelasi varf', () => {
    const highs = [1, 2, 5, 5, 2, 1, 1]
    const lows = [1, 1, 1, 1, 1, 1, 1]
    const p = findPivots(highs, lows, 2).filter(x => x.kind === 'high')
    expect(p.length).toBe(0) // egalitatea invalideaza ambele: niciun maxim strict
  })

  it('serii goale nu arunca', () => {
    expect(findPivots([], [], 3)).toEqual([])
  })
})

describe('niveluri orizontale', () => {
  const P = (index: number, price: number, kind: 'high' | 'low' = 'high') => ({ index, price, kind })

  it('pivoti apropiati devin UN nivel, cu numarul de atingeri', () => {
    const lv = clusterLevels([P(10, 100), P(30, 100.4), P(50, 99.8)], 1)
    expect(lv).toHaveLength(1)
    expect(lv[0].touches).toBe(3)
    expect(lv[0].price).toBeCloseTo(100.07, 1)
    expect(lv[0].firstIndex).toBe(10)
    expect(lv[0].lastIndex).toBe(50)
  })

  it('UN singur varf NU e nivel — suportul inseamna ca pretul s-a intors acolo', () => {
    expect(clusterLevels([P(10, 100)], 1)).toEqual([])
  })

  it('pivoti departati rămân niveluri separate', () => {
    const lv = clusterLevels([P(1, 100), P(2, 100.2), P(3, 120), P(4, 120.1)], 1)
    expect(lv).toHaveLength(2)
  })

  it('toleranta zero sau negativa nu produce niveluri inventate', () => {
    expect(clusterLevels([P(1, 100), P(2, 100)], 0)).toEqual([])
    expect(clusterLevels([P(1, 100), P(2, 100)], -5)).toEqual([])
  })
})

describe('linii diagonale — regula care separa o linie de doua puncte unite', () => {
  // Rezistenta descendenta curata: maximele coboara pe o dreapta.
  function cleanDownLine() {
    const highs: number[] = [], lows: number[] = []
    for (let i = 0; i < 60; i++) {
      const lineAt = 100 - i * 0.5
      // varfuri care ating linia la 10, 30, 50; restul sub ea
      const touch = (i === 10 || i === 30 || i === 50)
      highs.push(touch ? lineAt : lineAt - 3 - (i % 5))
      lows.push(highs[i] - 2)
    }
    return { highs, lows }
  }

  it('gaseste linia descendenta prin varfurile care o ating', () => {
    const d = cleanDownLine()
    const piv = findPivots(d.highs, d.lows, 3)
    const tls = buildTrendlines(piv, d.highs, d.lows, 0.5)
    const res = tls.filter(t => t.kind === 'resistance')
    expect(res.length).toBeGreaterThan(0)
    expect(res[0].slope).toBeLessThan(0)
    expect(res[0].touches).toBeGreaterThanOrEqual(2)
  })

  it('REFUZA o dreapta prin care pretul a trecut intre ancore', () => {
    // Aceeasi forma, dar cu un varf care STRAPUNGE linia pe la mijloc.
    const d = cleanDownLine()
    d.highs[30] = 100 - 30 * 0.5 + 20   // mult peste linie
    d.lows[30] = d.highs[30] - 2
    const piv = findPivots(d.highs, d.lows, 3)
    const tls = buildTrendlines(piv, d.highs, d.lows, 0.5)
    // Nicio linie de rezistenta nu are voie sa treaca pe sub varful de la 30.
    for (const t of tls.filter(x => x.kind === 'resistance')) {
      if (t.fromIndex <= 30 && t.toIndex >= 30) {
        expect(lineValueAt(t, 30)).toBeGreaterThanOrEqual(d.highs[30] - 0.5)
      }
    }
  })

  it('prelungirea spre dreapta e chiar proiectia liniara', () => {
    const l = { slope: -0.5, intercept: 100 }
    expect(lineValueAt(l, 0)).toBe(100)
    expect(lineValueAt(l, 10)).toBe(95)
    expect(lineValueAt(l, 200)).toBe(0)
  })

  it('o pereche prea apropiata nu formeaza linie', () => {
    const d = cleanDownLine()
    const piv = findPivots(d.highs, d.lows, 3)
    const tls = buildTrendlines(piv, d.highs, d.lows, 0.5, { minSpan: 1000 })
    expect(tls).toEqual([])
  })

  it('toleranta zero nu produce linii', () => {
    const d = cleanDownLine()
    expect(buildTrendlines(findPivots(d.highs, d.lows, 3), d.highs, d.lows, 0)).toEqual([])
  })
})

describe('ARACHNE — instrumentul complet', () => {
  /**
   * Piata reala ca forma: maxime descendente (rezistenta diagonala), suport
   * orizontal atins de doua ori, apoi rupere decisiva in jos.
   *
   * Prima versiune a acestui fixture producea DOAR TREI pivoti, deci niciun
   * suport cu doua atingeri de rupt — si doua teste cadeau degeaba, aratand
   * spre cod cand problema era fixture-ul. Verificat acum empiric: da 5 pivoti,
   * un nivel SUP 2x rupt, doua linii descendente si doua semnale short.
   */
  function lowerHighsThenBreakdown() {
    const highs: number[] = [], lows: number[] = [], closes: number[] = []
    const seg = (from: number, to: number, bars: number, spread = 1.2) => {
      for (let i = 1; i <= bars; i++) {
        const c = from + (to - from) * (i / bars)
        highs.push(c + spread); lows.push(c - spread); closes.push(c)
      }
    }
    seg(88, 100, 14)     // urcare
    seg(100, 94, 8)      // cadere la suport
    seg(94, 98, 7)       // bounce 1
    seg(98, 94.2, 7)     // retestarea suportului
    seg(94.2, 97, 7)     // bounce 2 (maxim mai jos)
    seg(97, 94.1, 6)     // a treia atingere
    seg(94.1, 80, 14)    // rupere decisiva in jos
    return { highs, lows, closes }
  }

  it('o serie prea scurta nu produce linii inventate', () => {
    const r = arachne([1, 2, 3], [1, 2, 3], [1, 2, 3])
    expect(r.levels).toEqual([])
    expect(r.trendlines).toEqual([])
    expect(r.signals).toEqual([])
  })

  it('gaseste niveluri si le eticheteaza cu numarul de atingeri', () => {
    const d = lowerHighsThenBreakdown()
    const r = arachne(d.highs, d.lows, d.closes)
    expect(r.levels.length).toBeGreaterThan(0)
    for (const lv of r.levels) {
      expect(lv.touches).toBeGreaterThanOrEqual(2)
      expect(lv.label).toMatch(/^(RES|SUP) \d+x/)
    }
  })

  it('un nivel prin care pretul a inchis dincolo e marcat RUPT', () => {
    const d = lowerHighsThenBreakdown()
    const r = arachne(d.highs, d.lows, d.closes)
    expect(r.levels.some(l => l.broken)).toBe(true)
    expect(r.levels.filter(l => l.broken).every(l => /✕/.test(l.label))).toBe(true)
  })

  it('un SUPORT rupt da semnal SHORT din NIVEL — nu din alta parte', () => {
    // Testul anterior se multumea cu „exista macar un short", si un mutant care
    // inversa rolul nivelului l-a TRECUT, pentru ca semnalul venea de la linia
    // diagonala. Aici se cere explicit semnalul din NIVEL.
    const d = lowerHighsThenBreakdown()
    const r = arachne(d.highs, d.lows, d.closes)
    const fromLevel = r.signals.filter(s => s.from === 'level')
    expect(fromLevel.length).toBeGreaterThan(0)
    expect(fromLevel.every(s => s.dir === 'short')).toBe(true)
  })

  it('STOPUL sta dincolo de linia din care vine semnalul, nu doar fata de pret', () => {
    // Un mutant care punea stopul pe partea gresita a nivelului a trecut vechea
    // asertie (stop > pret), pentru ca la bara de rupere pretul e oricum sub el.
    const d = lowerHighsThenBreakdown()
    const r = arachne(d.highs, d.lows, d.closes)
    expect(r.signals.length).toBeGreaterThan(0)
    for (const s of r.signals) {
      if (s.dir === 'short') expect(s.stop).toBeGreaterThan(s.ref)
      else expect(s.stop).toBeLessThan(s.ref)
    }
  })

  it('ruperea in jos produce un semnal SHORT, nu LONG', () => {
    const d = lowerHighsThenBreakdown()
    const r = arachne(d.highs, d.lows, d.closes)
    const shorts = r.signals.filter(s => s.dir === 'short')
    expect(shorts.length).toBeGreaterThan(0)
    for (const s of shorts) {
      // Stopul unui short sta DEASUPRA intrarii — altfel nu e stop, e tinta.
      expect(s.stop).toBeGreaterThan(s.price)
    }
  })

  it('fiecare semnal are eticheta care spune ce e si de unde vine', () => {
    const d = lowerHighsThenBreakdown()
    const r = arachne(d.highs, d.lows, d.closes)
    for (const s of r.signals) {
      expect(s.label).toMatch(/(LONG ▲|SHORT ▼)/)
      expect(['level', 'trendline']).toContain(s.from)
    }
  })

  it('panoul raporteaza cel mai apropiat suport si cea mai apropiata rezistenta NERUPTE', () => {
    const d = lowerHighsThenBreakdown()
    const r = arachne(d.highs, d.lows, d.closes)
    const px = d.closes[d.closes.length - 1]
    if (r.panel.nearestResistance != null) expect(r.panel.nearestResistance).toBeGreaterThan(px - 1e-9)
    if (r.panel.nearestSupport != null) expect(r.panel.nearestSupport).toBeLessThan(px + 1e-9)
  })

  it('o piata perfect plata nu produce nici linii, nici semnale', () => {
    const flat = new Array(80).fill(100)
    const r = arachne(flat, flat, flat)
    expect(r.trendlines).toEqual([])
    expect(r.signals).toEqual([])
  })

  it('datele stricate nu arunca', () => {
    const d = lowerHighsThenBreakdown()
    d.highs[10] = NaN; d.lows[11] = NaN; d.closes[12] = NaN
    expect(() => arachne(d.highs, d.lows, d.closes)).not.toThrow()
  })
})

describe('retest — intrarea de dupa rupere', () => {
  // Calea asta a rămas NECOPERITA la prima incercare: prin `arachne` intreg
  // depinde de unde cad pivotii, si un mutant care scotea cerinta „pretul
  // TINE" a trecut toate testele. Scoasa ca functie proprie, se poate dovedi.

  // nivel 100; dupa rupere in jos pretul revine la el si inchide SUB → retest short
  // toleranta 1 → zona de atingere incepe la 99. Barele 0-2 stau clar sub ea.
  const H = [95, 96, 97, 101, 97]
  const L = [93, 94, 95, 98, 95]
  const C = [94, 95, 96, 99.2, 96]

  it('gaseste retestul care TINE', () => {
    // bara 3: high 101 atinge nivelul 100, dar inchide la 99,2 — sub el.
    expect(findRetest(100, false, 0, H, L, C, 1)).toBe(3)
  })

  it('o atingere care NU tine nu e retest', () => {
    // Aceeasi atingere, dar inchiderea trece peste nivel: ideea e anulata.
    const C2 = [94, 95, 96, 100.8, 96]
    expect(findRetest(100, false, 0, H, L, C2, 1)).toBe(-1)
  })

  it('oglinda pe long: atinge de sus si inchide peste', () => {
    const h = [105, 104, 103, 102, 103]
    const l = [104, 103, 102, 99.5, 102]
    const c = [104, 103, 102, 100.8, 102]
    expect(findRetest(100, true, 0, h, l, c, 1)).toBe(3)
  })

  it('nu se uita inainte de bara ceruta', () => {
    expect(findRetest(100, false, 4, H, L, C, 1)).toBe(-1)
  })

  it('toleranta zero sau date lipsa nu produc un retest inventat', () => {
    expect(findRetest(100, false, 0, H, L, C, 0)).toBe(-1)
    expect(findRetest(NaN, false, 0, H, L, C, 1)).toBe(-1)
    expect(findRetest(100, false, 0, [], [], [], 1)).toBe(-1)
  })
})

describe('prelungirea liniilor — gasit pe date vii, nu in teste', () => {
  // Pe 4h, o linie ancorata demult si prelungita pana la marginea chartului
  // proiecta 93.037 cand pretul era 81.967. O dreapta care nu mai inseamna
  // nimic, dar care arata exact ca o linie de trend.

  function cleanDownLine() {
    const highs: number[] = [], lows: number[] = []
    for (let i = 0; i < 60; i++) {
      const lineAt = 100 - i * 0.5
      const touch = (i === 10 || i === 30 || i === 50)
      highs.push(touch ? lineAt : lineAt - 3 - (i % 5))
      lows.push(highs[i] - 2)
    }
    return { highs, lows }
  }

  it('o linie se prelungeste cel mult cat a durat formarea ei', () => {
    const d = cleanDownLine()
    const tls = buildTrendlines(findPivots(d.highs, d.lows, 3), d.highs, d.lows, 0.5)
    expect(tls.length).toBeGreaterThan(0)
    for (const t of tls) {
      const span = t.toIndex - t.fromIndex
      expect(t.extendTo).toBe(t.toIndex + span)
      expect(t.extendTo).toBeGreaterThan(t.toIndex)
    }
  })

  it('proiectia rămâne in jurul pretului — consecinta limitarii prelungirii', () => {
    // Nu e un filtru separat: am avut unul si l-am scos, pentru ca niciun test
    // nu-l putea face sa conteze. Proprietatea o asigura chiar limita de
    // prelungire, si o fixez aici ca sa nu se piarda.
    // Serie care urca puternic la final: liniile vechi de suport ar proiecta
    // valori foarte departe de pretul curent daca nu ar fi filtrate.
    const H: number[] = [], L: number[] = [], C: number[] = []
    for (let i = 0; i < 60; i++) { const c = 100 + i * 0.1; H.push(c + 1); L.push(c - 1); C.push(c) }
    for (let i = 0; i < 40; i++) { const c = 106 + i * 6; H.push(c + 2); L.push(c - 2); C.push(c) }
    const r = arachne(H, L, C)
    const px = C[C.length - 1]
    let atr = 0
    for (let i = C.length - 14; i < C.length; i++) atr += H[i] - L[i]
    atr /= 14
    for (const t of r.trendlines) {
      const proj = lineValueAt(t, Math.min(C.length - 1, t.extendTo))
      expect(Math.abs(proj - px)).toBeLessThanOrEqual(atr * 12 + 1e-6)
    }
  })
})
