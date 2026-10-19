// Cei cinci indicatori de flux — testele aritmeticii.
//
// Operatorul a cerut cinci indicatori „total diferiti" pe date reale. Masurat
// inainte de a proiecta: toti cei 91 existenti citesc exclusiv OHLCV, iar
// referintele la S.bids / S.asks / S.buckets / oiHistory in indicatorCalc.ts
// sunt ZERO. Deci acestia stau pe cartea de ordine, feed-ul de lichidari,
// open interest, sezonalitatea orara si premium-ul perp.
//
// Testele de aici apasa in special pe cazurile in care un indicator ar putea
// MINTI: date insuficiente raportate ca stare valida, o mediana inlocuita cu
// medie (un singur zid ascunde restul), o divergenta raportata cand nu exista.

import { describe, it, expect } from 'vitest'
import {
  hecate, thanatos, aion, hypnos, notos, HECATE_BANDS,
  flowPulseTargets, FLOW_PULSE_IDS, flowBucketTime, flowAnchorSeries,
} from '../indicatorCalcFlow'

// ═══════════════════════════ HECATE ═══════════════════════════

describe('HECATE — presiunea cartii de ordine', () => {
  const book = (bidQ: number, askQ: number) => ({
    bids: [{ p: 99.9, q: bidQ }, { p: 99.5, q: bidQ }, { p: 99, q: bidQ }, { p: 98, q: bidQ }],
    asks: [{ p: 100.1, q: askQ }, { p: 100.5, q: askQ }, { p: 101, q: askQ }, { p: 102, q: askQ }],
  })

  it('o carte simetrica da presiune zero si stare echilibrata', () => {
    const b = book(10, 10)
    const r = hecate(b.bids, b.asks)
    expect(Math.abs(r.pressure)).toBeLessThan(1)
    expect(r.state).toBe('BALANCED')
  })

  it('cumparare grea da presiune pozitiva, vanzare grea negativa', () => {
    const buy = hecate(book(100, 10).bids, book(100, 10).asks)
    const sell = hecate(book(10, 100).bids, book(10, 100).asks)
    expect(buy.pressure).toBeGreaterThan(50)
    expect(sell.pressure).toBeLessThan(-50)
    expect(buy.state).toBe('BID_WALL')
    expect(sell.state).toBe('ASK_WALL')
  })

  it('masoara pe benzi separate, nu un singur numar global', () => {
    // Grea pe cumparare DEPARTE, grea pe vanzare APROAPE: un singur numar ar
    // ascunde exact situatia care conteaza pentru pretul de acum.
    const bids = [{ p: 99.99, q: 1 }, { p: 99.6, q: 500 }]
    const asks = [{ p: 100.01, q: 50 }, { p: 100.4, q: 1 }]
    const r = hecate(bids, asks)
    expect(r.bands).toHaveLength(HECATE_BANDS.length)
    const near = r.bands[0], far = r.bands[r.bands.length - 1]
    expect(near.imbalance).toBeLessThan(0)   // aproape: vanzarea domina
    expect(far.imbalance).toBeGreaterThan(0) // departe: cumpararea domina
  })

  it('gaseste un zid si il raporteaza pe partea corecta', () => {
    const bids = [{ p: 99.9, q: 1 }, { p: 99.8, q: 1 }, { p: 99.7, q: 1 }, { p: 99.6, q: 1 }, { p: 99.5, q: 80 }]
    const asks = [{ p: 100.1, q: 1 }, { p: 100.2, q: 1 }, { p: 100.3, q: 1 }, { p: 100.4, q: 1 }]
    const r = hecate(bids, asks)
    expect(r.walls.length).toBeGreaterThan(0)
    expect(r.walls[0].side).toBe('bid')
    expect(r.walls[0].price).toBe(99.5)
    expect(r.walls[0].ratio).toBeGreaterThan(4)
  })

  it('foloseste MEDIANA, deci un zid uriaș nu se ascunde pe sine', () => {
    // Cu media, un nivel de 1000 ar ridica referinta atat de mult incat
    // raportul lui propriu ar cadea sub prag si zidul ar deveni invizibil.
    const bids = [{ p: 99.9, q: 1 }, { p: 99.8, q: 1 }, { p: 99.7, q: 1 }, { p: 99.6, q: 1000 }]
    const asks = [{ p: 100.1, q: 1 }, { p: 100.2, q: 1 }, { p: 100.3, q: 1 }, { p: 100.4, q: 1 }]
    const r = hecate(bids, asks)
    expect(r.walls.some(x => x.price === 99.6)).toBe(true)
  })

  it('o carte goala nu produce o stare inventata', () => {
    const r = hecate([], [])
    expect(r.mid).toBeNull()
    expect(r.pressure).toBe(0)
    expect(r.walls).toEqual([])
    expect(r.spreadBps).toBeNull()
  })

  it('calculeaza spread-ul in puncte de baza', () => {
    const r = hecate([{ p: 100, q: 1 }], [{ p: 100.1, q: 1 }])
    expect(r.spreadBps).toBeCloseTo(9.995, 2)
  })

  it('o carte nesortata da acelasi mijloc ca una sortata', () => {
    const a = hecate([{ p: 99, q: 1 }, { p: 99.9, q: 1 }], [{ p: 101, q: 1 }, { p: 100.1, q: 1 }])
    const b = hecate([{ p: 99.9, q: 1 }, { p: 99, q: 1 }], [{ p: 100.1, q: 1 }, { p: 101, q: 1 }])
    expect(a.mid).toBe(b.mid)
    expect(a.mid).toBe(100)
  })
})

// ═══════════════════════════ THANATOS ═══════════════════════════

describe('THANATOS — cascade de lichidari', () => {
  const buckets = (v: number, k = 20) => Array.from({ length: k }, () => ({ l: v, s: v }))

  it('piata liniștită = CALM', () => {
    const r = thanatos(buckets(1000), { l: 500, s: 500 }, { l: 2500, s: 2500 }, { l: 7500, s: 7500 })
    expect(r.state).toBe('CALM')
  })

  it('o rafala pe un minut peste rata celor 15 = CASCADA, pe partea dominanta', () => {
    // 15m = 15.000 → rata normala 1.000/min. Minutul curent: 60.000.
    const r = thanatos(buckets(1000), { l: 55000, s: 5000 }, { l: 55000, s: 5000 }, { l: 7500, s: 7500 })
    expect(r.acceleration).toBeGreaterThan(3)
    expect(r.state).toBe('CASCADE_LONGS')
    expect(r.dominance).toBeGreaterThan(50)
  })

  it('aceeasi rafala pe shorturi da cascada pe shorturi', () => {
    const r = thanatos(buckets(1000), { l: 5000, s: 55000 }, { l: 5000, s: 55000 }, { l: 7500, s: 7500 })
    expect(r.state).toBe('CASCADE_SHORTS')
    expect(r.dominance).toBeLessThan(-50)
  })

  it('o crestere moderata e ELEVATED, nu cascada — pragul nu e decorativ', () => {
    const r = thanatos(buckets(1000), { l: 1000, s: 1000 }, { l: 5000, s: 5000 }, { l: 15000, s: 15000 })
    // 2.000/min fata de o rata normala de 2.000/min → exact 1, deci CALM;
    // dublam minutul curent ca sa trecem pragul de 1,5 fara sa atingem 3.
    const r2 = thanatos(buckets(1000), { l: 2000, s: 2000 }, { l: 5000, s: 5000 }, { l: 15000, s: 15000 })
    expect(r.state).toBe('CALM')
    expect(r2.state).toBe('ELEVATED')
  })

  it('cu prea putine bucket-uri NU inventeaza o normalitate', () => {
    const r = thanatos([{ l: 1, s: 1 }, { l: 2, s: 2 }], { l: 10, s: 10 }, { l: 10, s: 10 }, { l: 10, s: 10 })
    expect(r.bucketsSeen).toBeLessThan(4)
    expect(r.intensity).toBe(1)
  })

  it('zero lichidari nu produce nici cascada, nici impartire la zero', () => {
    const r = thanatos(buckets(0), { l: 0, s: 0 }, { l: 0, s: 0 }, { l: 0, s: 0 })
    expect(r.state).toBe('CALM')
    expect(Number.isFinite(r.intensity)).toBe(true)
    expect(Number.isFinite(r.acceleration)).toBe(true)
    expect(r.dominance).toBe(0)
  })

  it('date lipsa sau stricate nu arunca', () => {
    expect(() => thanatos(undefined as any, undefined as any, undefined as any, undefined as any)).not.toThrow()
    const r = thanatos([{ l: NaN, s: NaN } as any], { l: NaN, s: 5 } as any, { l: 5, s: NaN } as any, { l: NaN, s: NaN } as any)
    expect(Number.isFinite(r.intensity)).toBe(true)
  })
})

// ═══════════════════════════ AION ═══════════════════════════

describe('AION — regimul de pozitionare', () => {
  it('OI sus + pret sus = longuri aglomerate', () => {
    const r = aion([100, 110], [50000, 51000], 0.0001)
    expect(r.regime).toBe('LONGS_CROWDED')
    expect(r.crowdedSide).toBe('long')
  })

  it('OI sus + pret jos = shorturi aglomerate', () => {
    const r = aion([100, 110], [51000, 50000], -0.0001)
    expect(r.regime).toBe('SHORTS_CROWDED')
    expect(r.crowdedSide).toBe('short')
  })

  it('OI jos + pret jos = longuri care ies', () => {
    expect(aion([110, 100], [51000, 50000], 0).regime).toBe('LONG_UNWIND')
  })

  it('OI jos + pret sus = shorturi care se acopera', () => {
    expect(aion([110, 100], [50000, 51000], 0).regime).toBe('SHORT_COVER')
  })

  it('niciun regim nu are parte aglomerata la ieșiri', () => {
    expect(aion([110, 100], [51000, 50000], 0.001).crowdedSide).toBeNull()
    expect(aion([110, 100], [50000, 51000], 0.001).crowdedSide).toBeNull()
  })

  it('zgomotul sub zona moarta e QUIET, nu un regim inventat', () => {
    const r = aion([100, 100.01], [50000, 50001], 0.0001)
    expect(r.regime).toBe('QUIET')
    expect(r.squeezeRisk).toBe(0)
  })

  it('riscul de squeeze creste doar cand partea aglomerata PLATESTE ca sa stea', () => {
    // Longuri aglomerate cu funding pozitiv: longurile plătesc → risc mai mare.
    const paying = aion([100, 115], [50000, 51000], 0.0005)
    // Aceeasi aglomerare, dar funding negativ: longurile sunt PLATITE → fara cost.
    const paid = aion([100, 115], [50000, 51000], -0.0005)
    expect(paying.squeezeRisk).toBeGreaterThan(paid.squeezeRisk)
  })

  it('raporteaza funding-ul in puncte de baza', () => {
    expect(aion([100, 110], [50000, 51000], 0.0001).fundingBps).toBeCloseTo(1, 5)
  })

  it('o serie prea scurta nu produce un regim', () => {
    expect(aion([100], [50000], 0.0001).regime).toBe('QUIET')
    expect(aion([], [], 0.0001).regime).toBe('QUIET')
  })

  it('OI zero sau negativ nu produce impartire la zero', () => {
    const r = aion([0, 10], [50000, 51000], 0.0001)
    expect(r.regime).toBe('QUIET')
    expect(Number.isFinite(r.oiChangePct)).toBe(true)
  })
})

// ═══════════════════════════ HYPNOS ═══════════════════════════

describe('HYPNOS — ceasul de volatilitate', () => {
  // Construieste bare orare: ora `h` din ziua `d`, cu interval `rangePct`.
  function bars(spec: Array<{ day: number; hour: number; rangePct: number }>) {
    const times: number[] = [], highs: number[] = [], lows: number[] = [], closes: number[] = []
    for (const s of spec) {
      const t = Date.UTC(2026, 0, 1 + s.day, s.hour, 0, 0) / 1000
      const c = 100
      times.push(t); closes.push(c)
      highs.push(c * (1 + s.rangePct / 200))
      lows.push(c * (1 - s.rangePct / 200))
    }
    return { times, highs, lows, closes }
  }

  it('compara ora cu EA INSASI, nu cu media zilei', () => {
    // Ora 3 e mereu liniștită (0,2%), ora 14 mereu agitata (2%).
    // O ora 3 la 0,6% e un salt de trei ori peste norma EI, desi rămâne
    // mult sub media zilei. O medie globala ar rata complet semnalul.
    const spec: Array<{ day: number; hour: number; rangePct: number }> = []
    for (let d = 0; d < 6; d++) { spec.push({ day: d, hour: 3, rangePct: 0.2 }); spec.push({ day: d, hour: 14, rangePct: 2 }) }
    spec.push({ day: 6, hour: 3, rangePct: 0.6 })
    const b = bars(spec)
    const r = hypnos(b.times, b.highs, b.lows, b.closes)
    expect(r.currentHour).toBe(3)
    expect(r.normalRangePct).toBeCloseTo(0.2, 2)
    expect(r.ratio).toBeGreaterThan(2.5)
    expect(r.state).toBe('STORM')
  })

  it('o ora normala pentru ea insasi e NORMAL', () => {
    // Istoric cu dispersie reala (0,6 .. 1,4, medie ~1,0), iar bara curenta
    // chiar pe medie. Un fixture prea strans ar face din orice abatere de 5%
    // un z-score peste 1 — si testul ar cere codului sa minta.
    const hist = [0.6, 1.4, 0.8, 1.2, 1.0, 0.9, 1.1]
    const spec = hist.map((rangePct, d) => ({ day: d, hour: 9, rangePct }))
    spec.push({ day: hist.length, hour: 9, rangePct: 1.0 })
    const b = bars(spec)
    const r = hypnos(b.times, b.highs, b.lows, b.closes)
    expect(r.normalRangePct).toBeCloseTo(1.0, 2)
    expect(Math.abs(r.zscore!)).toBeLessThan(0.75)
    expect(r.state).toBe('NORMAL')
  })

  it('o ora mereu identica care se tripleaza NU e NORMAL (z-score degenerat)', () => {
    // Cu dispersie zero, sd=0 facea z-score-ul 0 si starea NORMAL, desi
    // intervalul s-a triplat. Raportul preia decizia in cazul degenerat.
    const spec: Array<{ day: number; hour: number; rangePct: number }> = []
    for (let d = 0; d < 6; d++) spec.push({ day: d, hour: 2, rangePct: 0.4 })
    spec.push({ day: 6, hour: 2, rangePct: 1.2 })
    const b = bars(spec)
    const r = hypnos(b.times, b.highs, b.lows, b.closes)
    expect(r.ratio).toBeCloseTo(3, 2)
    expect(r.state).toBe('STORM')
  })

  it('o ora mult mai liniștită decat de obicei e DORMANT', () => {
    const spec: Array<{ day: number; hour: number; rangePct: number }> = []
    for (let d = 0; d < 8; d++) spec.push({ day: d, hour: 9, rangePct: 2 + (d % 2) * 0.2 })
    spec.push({ day: 9, hour: 9, rangePct: 0.3 })
    const b = bars(spec)
    const r = hypnos(b.times, b.highs, b.lows, b.closes)
    expect(r.zscore!).toBeLessThan(-1.5)
    expect(r.state).toBe('DORMANT')
  })

  it('fara suficiente mostre pe ora spune UNKNOWN in loc sa ghiceasca', () => {
    const b = bars([{ day: 0, hour: 5, rangePct: 1 }, { day: 1, hour: 7, rangePct: 1 }])
    const r = hypnos(b.times, b.highs, b.lows, b.closes)
    expect(r.state).toBe('UNKNOWN')
    expect(r.normalRangePct).toBeNull()
    expect(r.ratio).toBeNull()
  })

  it('profilul are 24 de intrari si numara mostrele', () => {
    const spec: Array<{ day: number; hour: number; rangePct: number }> = []
    for (let d = 0; d < 4; d++) spec.push({ day: d, hour: 11, rangePct: 1 })
    const b = bars(spec)
    const r = hypnos(b.times, b.highs, b.lows, b.closes)
    expect(r.profile).toHaveLength(24)
    expect(r.profile[11].samples).toBe(4)
    expect(r.profile[0].samples).toBe(0)
    expect(r.coverageHours).toBe(1)
  })

  it('accepta marcaje de timp in secunde SI in milisecunde', () => {
    const spec: Array<{ day: number; hour: number; rangePct: number }> = []
    for (let d = 0; d < 5; d++) spec.push({ day: d, hour: 8, rangePct: 1 })
    const b = bars(spec)
    const sec = hypnos(b.times, b.highs, b.lows, b.closes)
    const ms = hypnos(b.times.map(t => t * 1000), b.highs, b.lows, b.closes)
    expect(ms.currentHour).toBe(sec.currentHour)
    expect(ms.normalRangePct).toBeCloseTo(sec.normalRangePct!, 6)
  })

  it('date goale sau stricate nu arunca', () => {
    expect(hypnos([], [], [], []).state).toBe('UNKNOWN')
    expect(() => hypnos([NaN], [NaN], [NaN], [0])).not.toThrow()
  })
})

// ═══════════════════════════ NOTOS ═══════════════════════════

describe('NOTOS — premium-ul perpetual', () => {
  it('mark peste index cu funding pozitiv = perp scump, aliniat', () => {
    const r = notos(100.5, 100, 0.0002)
    expect(r.premiumBps).toBeCloseTo(50, 1)
    expect(r.aligned).toBe(true)
    expect(r.state).toBe('PERP_RICH')
    expect(r.squeezeFuel).toBe(0)
  })

  it('perp scump dar funding NEGATIV = divergenta, si combustibil de squeeze', () => {
    const r = notos(100.5, 100, -0.0002)
    expect(r.aligned).toBe(false)
    expect(r.state).toBe('DIVERGENT_RICH')
    expect(r.squeezeFuel).toBeGreaterThan(0)
  })

  it('perp ieftin cu funding pozitiv = divergenta pe partea cealalta', () => {
    const r = notos(99.5, 100, 0.0002)
    expect(r.state).toBe('DIVERGENT_CHEAP')
    expect(r.squeezeFuel).toBeGreaterThan(0)
  })

  it('o divergenta mai mare da mai mult combustibil — scara nu e decorativa', () => {
    const mic = notos(100.1, 100, -0.00005)
    const mare = notos(101, 100, -0.001)
    expect(mare.squeezeFuel).toBeGreaterThan(mic.squeezeFuel)
  })

  it('aproape de paritate e FAIR, fara divergenta inventata', () => {
    const r = notos(100.005, 100, 0.0002)
    expect(r.state).toBe('FAIR')
    expect(r.squeezeFuel).toBe(0)
  })

  it('date lipsa spun UNKNOWN in loc sa raporteze zero ca fapt', () => {
    expect(notos(0, 100, 0.0001).state).toBe('UNKNOWN')
    expect(notos(100, 0, 0.0001).state).toBe('UNKNOWN')
    expect(notos(NaN, 100, 0.0001).premiumBps).toBeNull()
  })

  it('pe datele reale de pe server acum: mark 81963,5 vs index 81992,37', () => {
    // Valori luate chiar din /api/market/funding in sesiunea asta.
    const r = notos(81963.5, 81992.36869565, 0.0001)
    expect(r.premiumBps).toBeLessThan(0)        // perpetualul e sub index
    expect(r.state).toBe('DIVERGENT_CHEAP')     // ieftin, dar funding pozitiv
    expect(r.squeezeFuel).toBeGreaterThan(0)
  })
})

// ═══════════════════════════ PULSUL ═══════════════════════════

describe('flowPulseTargets — de ce THANATOS nu afisa nimic', () => {
  // Raportat de operator. Nu era „asteapta date": panoul se redesena DOAR la
  // sosirea unei lichidari, iar pe feed-ul viu sunt ~7 evenimente in 7 minute
  // (Binance futures WS blocat, doar OKX livreaza). Intre evenimente
  // acceleratia e 0 si o histograma de zerouri nu deseneaza nimic, deci la
  // deschidere era exact un punct invizibil. Si e incorect pe fond: ferestrele
  // de 1m/5m/15m se scurg in timp, deci valoarea se schimba FARA evenimente
  // noi — un panou inghetat arata o valoare veche ca fiind actuala.

  it('intoarce doar panourile de flux aprinse', () => {
    expect(flowPulseTargets({ thanatos: true, hecate: false, rsi14: true })).toEqual(['thanatos'])
  })

  it('intoarce lista GOALA cand niciunul nu e aprins, ca ceasul sa se poata opri', () => {
    expect(flowPulseTargets({ rsi14: true, macd: true })).toEqual([])
    expect(flowPulseTargets({})).toEqual([])
  })

  it('nu arunca pe stare lipsa', () => {
    expect(flowPulseTargets(null)).toEqual([])
    expect(flowPulseTargets(undefined)).toEqual([])
  })

  it('ignora indicatorii care nu sunt de flux', () => {
    const t = flowPulseTargets({ ema: true, terminator: true, phoebe: true, aion: true })
    expect(t).toEqual(['aion'])
  })

  it('acopera toate cele cinci panouri de flux', () => {
    const all = flowPulseTargets({ hecate: true, thanatos: true, aion: true, hypnos: true, notos: true })
    expect(all).toHaveLength(5)
    expect([...all].sort()).toEqual([...FLOW_PULSE_IDS].sort())
  })
})

// ═══════════════════════════ ALINIEREA ═══════════════════════════

describe('alinierea panourilor de flux cu chartul', () => {
  // Raportat de operator cu doua capturi: panourile „se trag in spate".
  // `_syncSubChartsToMain` aliniaza prin setVisibleLogicalRange, adica prin
  // INDICI DE BARE, iar jurnalul era indexat pe secunde de ceas — deci un panou
  // cu 30 de puncte primea intervalul logic al unui chart cu sute de bare.
  // Cele doua axe nu aveau nimic in comun.

  const bars = (n: number) => Array.from({ length: n }, (_, i) => ({ time: 1000 + i * 300 }))

  it('o citire de acum se asaza in ULTIMA bara, nu la ceasul de perete', () => {
    expect(flowBucketTime(bars(5))).toBe(1000 + 4 * 300)
  })

  it('fara bare nu exista bucket — panoul nu isi inventeaza o axa paralela', () => {
    expect(flowBucketTime([])).toBeNull()
    expect(flowBucketTime(null)).toBeNull()
    expect(flowBucketTime(undefined)).toBeNull()
    expect(flowBucketTime([{ time: NaN }])).toBeNull()
  })

  it('ANCORA ARE EXACT O VALOARE PE FIECARE BARA — invariantul alinierii', () => {
    // Asta e ce lipsea. Daca numarul de puncte difera de al chartului,
    // intervalul logic inseamna altceva in panou si se trage in spate.
    const k = bars(250)
    const a = flowAnchorSeries(k, 0)
    expect(a).toHaveLength(k.length)
    expect(a[0].time).toBe(k[0].time)
    expect(a[a.length - 1].time).toBe(k[k.length - 1].time)
  })

  it('ancora pastreaza nivelul cerut (0 pentru zero, 1 pentru rata normala)', () => {
    expect(flowAnchorSeries(bars(3), 1).every(x => x.value === 1)).toBe(true)
    expect(flowAnchorSeries(bars(3), 0).every(x => x.value === 0)).toBe(true)
  })

  it('barele stricate nu rup ancora, dar nici nu se numara', () => {
    const k = [{ time: 100 }, { time: NaN }, { time: 300 }] as any
    const a = flowAnchorSeries(k, 0)
    expect(a.map(x => x.time)).toEqual([100, 300])
  })

  it('fara bare ancora e goala, nu arunca', () => {
    expect(flowAnchorSeries(null, 0)).toEqual([])
    expect(flowAnchorSeries(undefined, 0)).toEqual([])
    expect(flowAnchorSeries([], 0)).toEqual([])
  })
})
