// [2026-10-21 b295] MTF REAL — stiva multi-timeframe construita din klines
// adevarate, nu din tamponul de preturi la 500 ms.
//
// Bug-ul reparat: `_qmAriaMTF` se calcula din `S._qmBuf`, care primeste un
// pret la fiecare 500 ms (index.ts, startRenderLoop). Deci randurile etichetate
// 5m/15m/30m/1h/4h acopereau in realitate 4/10/20/30/60 SECUNDE, toate din
// acelasi minut, iar '1D' era hardcodat 0. Un operator care citea "4 din 6
// timeframe-uri sunt bull" vedea de fapt un singur trend de un minut numarat
// de cinci ori.
//
// In plus `_qmMtfAlignScore` si `_qmMtfAlignDetailed` n-aveau NICIUN scriitor
// (3 cititori in frame.ts, zero scrieri), deci scorul era mereu 0 si increderea
// ARIA ieşea constant 48%.
import { describe, it, expect } from 'vitest'
import {
  aggregateBars, emaTrend, computeMtfStack, computeAlignScore, mtfWatch,
  MTF_SPEC, type Bar,
} from '../engines/mtf'

const M5 = 300000

function bar(t: number, c: number, o = c, h = Math.max(o, c), l = Math.min(o, c), v = 1): Bar {
  return { o, h, l, c, v, t }
}

/** `n` bare de 5m aliniate la ceas, pornind de la un multiplu de 5m. */
function series(n: number, priceAt: (i: number) => number, step = M5, t0 = 1700000000000): Bar[] {
  const base = Math.floor(t0 / step) * step
  return Array.from({ length: n }, (_, i) => bar(base + i * step, priceAt(i)))
}

describe('aggregateBars — gruparea pe galeti aliniate la ceas', () => {
  it('nu schimba nimic la factor 1', () => {
    const b = series(5, i => 100 + i)
    expect(aggregateBars(b, 1, M5)).toEqual(b)
  })

  it('face 3 bare de 5m intr-una de 15m cu OHLCV corect', () => {
    // t0 trebuie sa fie o granita REALA de 15m, altfel cele 3 bare cad in
    // galeti diferite — exact ce verifica testul urmator.
    const t0 = Math.floor(1700000000000 / 900000) * 900000
    const b = [
      bar(t0, 110, 100, 115, 95, 2),
      bar(t0 + M5, 120, 110, 125, 105, 3),
      bar(t0 + 2 * M5, 118, 120, 130, 90, 5),
    ]
    const out = aggregateBars(b, 3, M5)
    expect(out).toHaveLength(1)
    expect(out[0].o).toBe(100)   // deschiderea primei
    expect(out[0].c).toBe(118)   // inchiderea ultimei
    expect(out[0].h).toBe(130)   // maximul tuturor
    expect(out[0].l).toBe(90)    // minimul tuturor
    expect(out[0].v).toBe(10)    // volumul insumat
    expect(out[0].t).toBe(t0)
  })

  it('aliniaza galetile la ceas, NU la prima bara primita', () => {
    // Pornim deliberat de la :05, nu de la :00. Granita de 15m e la :00/:15/:30,
    // deci :05 si :10 intra in galeata :00, iar :15 deschide una noua.
    const t0 = Math.floor(1700000000000 / 900000) * 900000  // granita de 15m
    const b = [
      bar(t0 + M5, 101),      // :05
      bar(t0 + 2 * M5, 102),  // :10
      bar(t0 + 3 * M5, 103),  // :15  -> galeata nouă
      bar(t0 + 4 * M5, 104),  // :20
    ]
    const out = aggregateBars(b, 3, M5)
    expect(out).toHaveLength(2)
    expect(out[0].t).toBe(t0)            // galeata :00, desi n-am primit bara :00
    expect(out[0].c).toBe(102)
    expect(out[1].t).toBe(t0 + 900000)   // galeata :15
    expect(out[1].c).toBe(104)
  })

  it('pastreaza ultima galeata chiar daca e incompleta (bara in formare)', () => {
    const b = series(4, i => 100 + i)  // 4 bare de 5m, aliniate la :00
    const out = aggregateBars(b, 3, M5)
    expect(out).toHaveLength(2)
    expect(out[1].c).toBe(103)  // bara de 15m in formare, dintr-o singura bara de 5m
  })

  it('nu arunca pe intrare goala sau factor invalid', () => {
    expect(aggregateBars([], 3, M5)).toEqual([])
    expect(aggregateBars(series(3, () => 100), 0, M5)).toEqual([])
  })
})

describe('emaTrend — semnul trendului pe un timeframe', () => {
  it('da bull pe o serie clar crescatoare', () => {
    expect(emaTrend(Array.from({ length: 40 }, (_, i) => 100 + i), 10, 30)).toBe(1)
  })

  it('da bear pe o serie clar descrescatoare', () => {
    expect(emaTrend(Array.from({ length: 40 }, (_, i) => 200 - i), 10, 30)).toBe(-1)
  })

  it('da 0 — NECUNOSCUT — cand nu sunt destule bare pentru media lenta', () => {
    // Asta e inima onestitatii: fara date, nu inventam un trend.
    expect(emaTrend(Array.from({ length: 29 }, (_, i) => 100 + i), 10, 30)).toBe(0)
    expect(emaTrend([], 10, 30)).toBe(0)
  })

  it('da 0 cand seria e perfect plata (mediile coincid)', () => {
    expect(emaTrend(Array.from({ length: 40 }, () => 100), 10, 30)).toBe(0)
  })
})

describe('computeMtfStack — cele 6 randuri, din surse reale', () => {
  it('acopera exact timeframe-urile pe care le afiseaza panoul', () => {
    expect(MTF_SPEC.map(s => s.tf)).toEqual(['5m', '15m', '30m', '1h', '4h', '1D'])
  })

  it('NU mai are 1D hardcodat 0 — il citeste din klines zilnice', () => {
    const d1 = Array.from({ length: 40 }, (_, i) =>
      bar(1700000000000 + i * 86400000, 100 + i))
    const stack = computeMtfStack({ d1 })
    expect(stack['1D']).toBe(1)
  })

  it('deriva 5m/15m/30m din acelasi fetch de 5m', () => {
    const m5 = series(400, i => 100 + i)
    const stack = computeMtfStack({ m5 })
    expect(stack['5m']).toBe(1)
    expect(stack['15m']).toBe(1)
    expect(stack['30m']).toBe(1)
  })

  it('deriva 1h si 4h din acelasi fetch de 1h', () => {
    const h1 = Array.from({ length: 300 }, (_, i) =>
      bar(1700000000000 + i * 3600000, 500 - i))
    const stack = computeMtfStack({ h1 })
    expect(stack['1h']).toBe(-1)
    expect(stack['4h']).toBe(-1)
  })

  it('da 0 pe randurile fara sursa, NU o valoare inventata', () => {
    const stack = computeMtfStack({})
    expect(Object.keys(stack)).toEqual(['5m', '15m', '30m', '1h', '4h', '1D'])
    expect(Object.values(stack)).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('cere destule bare agregate: 20 bare de 5m NU pot da un trend de 30m', () => {
    // 20 bare de 5m = 3 bare de 30m agregate; media lenta de 30m cere 20.
    const stack = computeMtfStack({ m5: series(20, i => 100 + i) })
    expect(stack['5m']).toBe(1)    // 20 >= slow 6
    expect(stack['30m']).toBe(0)   // 3 < slow 20 -> necunoscut, cinstit
  })

  it('timeframe-urile sunt ORIZONTURI DIFERITE, nu acelasi minut de 5 ori', () => {
    // Regresia exacta a bug-ului. Construim o serie de 5m in care trendul
    // SCURT e in sus dar cel LUNG e in jos: ultimele bare urca, dar panta
    // generala pe cateva zile coboara. O stiva adevarata trebuie sa dea
    // semne DIFERITE pe randuri diferite; cea veche (din tamponul de 500 ms)
    // dadea acelasi semn pe toate, pentru ca toate citeau acelasi minut.
    const n = 600
    // Declin lung (-0,5 pe bara de 5m, adica ~2 zile in jos) cu o revenire
    // scurta si ascuţita in ultimele 3 bare (+8 pe bara). Valorile sunt
    // verificate numeric, nu presupuse.
    const m5 = series(n, i => 1000 - i * 0.5 + (i > n - 3 ? (i - (n - 3)) * 8 : 0))
    const stack = computeMtfStack({ m5 })
    expect(stack['5m']).toBe(1)     // ultimele minute urca
    expect(stack['15m']).toBe(-1)   // un sfert de ora inca coboara
    expect(stack['30m']).toBe(-1)   // orizontul lung coboara
    expect(stack['5m']).not.toBe(stack['30m'])
  })
})

describe('computeAlignScore — scor 0..100, asa cum il randeaza panoul', () => {
  it('da 100 cand toate timeframe-urile cunoscute sunt de acord', () => {
    expect(computeAlignScore({ '5m': 1, '15m': 1, '30m': 1, '1h': 1, '4h': 1, '1D': 1 })).toBe(100)
    expect(computeAlignScore({ '5m': -1, '15m': -1, '30m': -1, '1h': -1, '4h': -1, '1D': -1 })).toBe(100)
  })

  it('da 0 cand sunt perfect dezbinate', () => {
    expect(computeAlignScore({ '5m': 1, '15m': 1, '30m': 1, '1h': -1, '4h': -1, '1D': -1 })).toBe(0)
  })

  it('ignora randurile necunoscute in loc sa le numere ca dezacord', () => {
    // 3 bull, 3 necunoscute -> aliniere deplina intre cele care au date.
    expect(computeAlignScore({ '5m': 1, '15m': 1, '30m': 1, '1h': 0, '4h': 0, '1D': 0 })).toBe(100)
  })

  it('da 0 — nu 100 — cand NU exista nicio sursa', () => {
    // Fail-honest: zero date nu e aliniere perfecta.
    expect(computeAlignScore({ '5m': 0, '15m': 0, '30m': 0, '1h': 0, '4h': 0, '1D': 0 })).toBe(0)
    expect(computeAlignScore({})).toBe(0)
  })

  it('da un scor intermediar pe majoritate', () => {
    // Scorul e acordul NET: |4 bull - 2 bear| / 6 = 33%.
    expect(computeAlignScore({ '5m': 1, '15m': 1, '30m': 1, '1h': 1, '4h': -1, '1D': -1 })).toBe(33)
    expect(computeAlignScore({ '5m': 1, '15m': 1, '30m': 1, '1h': 1, '4h': 1, '1D': -1 })).toBe(67)
  })

  it('ramane in 0..100 ca sa nu sparga bara de progres', () => {
    for (const s of [{}, { a: 1 }, { a: 1, b: -1, c: 1 }]) {
      const v = computeAlignScore(s as any)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })
})

describe('mtfWatch — verdictul, fail-closed', () => {
  it('cere 4 timeframe-uri de acord pentru un verdict', () => {
    expect(mtfWatch({ '5m': 1, '15m': 1, '30m': 1, '1h': 1, '4h': 0, '1D': 0 })).toBe('BULL')
    expect(mtfWatch({ '5m': -1, '15m': -1, '30m': -1, '1h': -1, '4h': 1, '1D': 1 })).toBe('BEAR')
  })

  it('sta pe WATCH la 3 de acord', () => {
    expect(mtfWatch({ '5m': 1, '15m': 1, '30m': 1, '1h': -1, '4h': -1, '1D': -1 })).toBe('WATCH')
  })

  it('sta pe WATCH cand nu are date — nu ghiceste o direcţie', () => {
    expect(mtfWatch({ '5m': 0, '15m': 0, '30m': 0, '1h': 0, '4h': 0, '1D': 0 })).toBe('WATCH')
    expect(mtfWatch({})).toBe('WATCH')
  })
})
