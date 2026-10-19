// PULSAR — colaps, incarcare, puls.
//
// Cerut de operator: un indicator care schimba culorile PE CHARTUL MARE, cu
// compresie, zona de extindere, masuratori si linii.
//
// Ce NU e: ASTRAPE masoara deja incarcarea, dar ca oscilator intr-un panou —
// nu stie unde e cutia si nu proiecteaza nimic. KERAUNOS deseneaza plicul de
// squeeze, dar e un plic continuu, nu o cutie masurata cu tinte.
//
// Testele apasa pe locurile unde un instrument geometric poate MINTI: o cutie
// construita din bara care tocmai a spart-o, o tinta proiectata din nimic, o
// compresie declarata pe prag absolut in loc de propriul istoric.

import { describe, it, expect } from 'vitest'
import { pulsar, pulsarCandleColor } from '../indicatorCalcPulsar'

/** Serie: `n` bare cu interval `rangePct`, pornind de la `start`, cu drift. */
function series(spec: Array<{ bars: number; rangePct: number; drift?: number }>, start = 100) {
  const highs: number[] = [], lows: number[] = [], closes: number[] = [], vols: number[] = []
  let px = start
  for (const seg of spec) {
    for (let i = 0; i < seg.bars; i++) {
      const half = px * (seg.rangePct / 200)
      const c = px + (seg.drift ?? 0)
      highs.push(Math.max(px, c) + half)
      lows.push(Math.min(px, c) - half)
      closes.push(c)
      vols.push(1000)
      px = c
    }
  }
  return { highs, lows, closes, vols }
}

describe('PULSAR — compresia', () => {
  it('nu raporteaza nimic pe o serie prea scurta, in loc sa ghiceasca', () => {
    const s = series([{ bars: 5, rangePct: 1 }])
    const r = pulsar(s.highs, s.lows, s.closes, s.vols)
    expect(r.boxes).toEqual([])
    expect(r.panel.phase).toBe('NEUTRAL')
    expect(r.panel.charge).toBe(0)
  })

  it('gaseste compresia dupa o perioada agitata si ii construieste cutia', () => {
    const s = series([{ bars: 60, rangePct: 3 }, { bars: 30, rangePct: 0.3 }])
    const r = pulsar(s.highs, s.lows, s.closes, s.vols)
    expect(r.boxes.length).toBeGreaterThan(0)
    const box = r.boxes[r.boxes.length - 1]
    expect(box.bars).toBeGreaterThanOrEqual(3)
    expect(box.top).toBeGreaterThan(box.bottom)
    expect(box.heightPct).toBeGreaterThan(0)
  })

  it('compresia se judeca fata de PROPRIUL istoric, nu de un prag absolut', () => {
    // Prima versiune a testului asta a fost DECOR: punea doua simboluri cu
    // volatilitati diferite si trecea si cu un prag absolut, pentru ca metrica
    // de stramtime e deja raportata la ATR, deci scale-free. Mutantul cu prag
    // fix a trecut-o. Asta e fixture-ul care chiar discrimineaza.
    //
    // O piata in zigzag: raportul inaltime/ATR nu coboara NICIODATA sub 3,
    // deci un prag absolut de genul `t <= 3` nu ar gasi compresie niciodata.
    // Percentila gaseste linistea relativa, pentru ca o compara cu ce a facut
    // chiar piata asta.
    function zig(bars: number, amp: number, rng: number, start: number) {
      const H: number[] = [], L: number[] = [], C: number[] = []
      let px = start
      for (let i = 0; i < bars; i++) {
        const dir = Math.floor(i / 5) % 2 === 0 ? 1 : -1
        const c = px + dir * amp
        H.push(Math.max(px, c) + rng / 2); L.push(Math.min(px, c) - rng / 2); C.push(c); px = c
      }
      return { H, L, C }
    }
    const loud = zig(70, 2.0, 0.6, 100)
    const quiet = zig(30, 0.8, 0.6, loud.C[loud.C.length - 1])
    const H = [...loud.H, ...quiet.H], L = [...loud.L, ...quiet.L], C = [...loud.C, ...quiet.C]
    const r = pulsar(H, L, C, H.map(() => 1000))

    expect(r.boxes.length).toBeGreaterThan(0)
    // Dovada ca pragul absolut nu ar fi mers: stramtimea cutiei gasite e PESTE 3.
    expect(r.panel.tightness).not.toBeNull()
    expect(r.panel.tightness!).toBeGreaterThan(3)
  })

  it('incarcarea creste cu cat fereastra e mai stransa fata de istoric', () => {
    const s = series([{ bars: 60, rangePct: 3 }, { bars: 25, rangePct: 0.2 }])
    const r = pulsar(s.highs, s.lows, s.closes, s.vols)
    expect(r.panel.charge).toBeGreaterThan(60)
  })

  it('dupa destule bare stranse faza devine CHARGED, nu doar COMPRESSION', () => {
    const s = series([{ bars: 60, rangePct: 3 }, { bars: 25, rangePct: 0.2 }])
    const r = pulsar(s.highs, s.lows, s.closes, s.vols, { chargedBars: 5 })
    expect(r.panel.phase).toBe('CHARGED')
  })
})

describe('PULSAR — iesirea si miscarea masurata', () => {
  // Compresie lunga, apoi o bara mare care inchide peste cutie.
  function coilThenBreak(dir: 'up' | 'down') {
    const s = series([{ bars: 60, rangePct: 3 }, { bars: 25, rangePct: 0.2 }])
    const last = s.closes[s.closes.length - 1]
    const jump = last * 0.04 * (dir === 'up' ? 1 : -1)
    const c = last + jump
    s.highs.push(Math.max(last, c) + Math.abs(jump) * 0.1)
    s.lows.push(Math.min(last, c) - Math.abs(jump) * 0.1)
    s.closes.push(c)
    s.vols.push(5000)
    return s
  }

  it('o bara care sparge cutia in sus da RELEASE_UP si o tinta DEASUPRA intrarii', () => {
    const s = coilThenBreak('up')
    const r = pulsar(s.highs, s.lows, s.closes, s.vols)
    expect(r.panel.phase).toBe('RELEASE_UP')
    expect(r.release).not.toBeNull()
    expect(r.release!.dir).toBe('up')
    expect(r.release!.target1).toBeGreaterThan(r.release!.entry)
    expect(r.release!.target2).toBeGreaterThan(r.release!.target1)
    // Invalidarea e marginea OPUSA: sub ea ideea e gresita.
    expect(r.release!.invalid).toBeLessThan(r.release!.trigger)
  })

  it('in jos, oglinda exacta', () => {
    const s = coilThenBreak('down')
    const r = pulsar(s.highs, s.lows, s.closes, s.vols)
    expect(r.panel.phase).toBe('RELEASE_DOWN')
    expect(r.release!.target1).toBeLessThan(r.release!.entry)
    expect(r.release!.target2).toBeLessThan(r.release!.target1)
    expect(r.release!.invalid).toBeGreaterThan(r.release!.trigger)
  })

  it('TINTA E CHIAR INALTIMEA CUTIEI — miscarea masurata, nu un numar inventat', () => {
    const s = coilThenBreak('up')
    const r = pulsar(s.highs, s.lows, s.closes, s.vols)
    const rel = r.release!
    expect(rel.target1 - rel.entry).toBeCloseTo(rel.boxHeight, 6)
    expect(rel.target2 - rel.entry).toBeCloseTo(rel.boxHeight * 1.618, 6)
  })

  it('cutia se ia de DINAINTE de bara care sparge, nu din fereastra curenta', () => {
    // Daca cutia s-ar recalcula incluzand bara de iesire, marginea s-ar muta
    // odata cu pretul si nicio iesire nu s-ar detecta vreodata.
    const s = coilThenBreak('up')
    const r = pulsar(s.highs, s.lows, s.closes, s.vols)
    const rel = r.release!
    // Marginea sparta trebuie sa fie sub maximul barei care a spart-o.
    expect(rel.trigger).toBeLessThan(s.highs[s.highs.length - 1])
    expect(rel.entry).toBeGreaterThan(rel.trigger)
  })

  it('o bara MICA peste margine nu e iesire — expansiunea e ceruta explicit', () => {
    // Prima versiune a fost DECOR: bara „mica" nici nu depasea marginea cutiei,
    // deci testul trecea si cand cerinta de expansiune era scoasa de tot.
    // Aici bara CHIAR inchide peste marginea de sus, dar cu interval minuscul.
    const s = series([{ bars: 60, rangePct: 3 }, { bars: 25, rangePct: 0.2 }])
    const w = 20
    let top = -Infinity
    for (let j = s.highs.length - w; j < s.highs.length; j++) top = Math.max(top, s.highs[j])

    // Intervalul barei se ia din ATR-ul real al seriei, nu ghicit: jumatate de
    // ATR e clar „mica" fata de un prag de 3 ATR si clar peste unul de 0,2.
    let trSum = 0
    for (let j = s.highs.length - 14; j < s.highs.length; j++) trSum += s.highs[j] - s.lows[j]
    const atrApprox = trSum / 14

    const mk = (expandMult: number) => {
      const H = [...s.highs], L = [...s.lows], C = [...s.closes], V = [...s.vols]
      const c = top + atrApprox * 0.05  // inchide PESTE marginea cutiei
      H.push(c + atrApprox * 0.25)      // dar bara e doar o jumatate de ATR
      L.push(c - atrApprox * 0.25)
      C.push(c); V.push(1000)
      return pulsar(H, L, C, V, { expandMult })
    }

    // Cu cerinta de expansiune in picioare: nu e iesire.
    expect(mk(3).panel.phase).not.toBe('RELEASE_UP')
    // Fara cerinta (prag minim), ACEEASI bara devine iesire — deci pragul chiar
    // face treaba, nu e decor.
    expect(mk(0.2).panel.phase).toBe('RELEASE_UP')
  })

  it('cat s-a facut din miscarea masurata se raporteaza, nu se presupune', () => {
    const s = coilThenBreak('up')
    const r = pulsar(s.highs, s.lows, s.closes, s.vols)
    expect(r.panel.reachedPct).not.toBeNull()
    expect(r.panel.reachedPct!).toBeGreaterThanOrEqual(0)
    expect(r.panel.targetPct).not.toBeNull()
  })
})

describe('PULSAR — culorile lumanarilor', () => {
  it('NEUTRAL nu primeste culoare: chartul rămâne cum il stie operatorul', () => {
    expect(pulsarCandleColor('NEUTRAL', 50, true)).toBeNull()
    expect(pulsarCandleColor(null, 50, true)).toBeNull()
  })

  it('compresia se adanceste cu incarcarea — nu e o singura culoare plata', () => {
    const slab = pulsarCandleColor('COMPRESSION', 10, true)!
    const tare = pulsarCandleColor('COMPRESSION', 95, true)!
    expect(slab.color).not.toBe(tare.color)
  })

  it('iesirea in sus si in jos sunt distincte, si distincte de expansiune', () => {
    const up = pulsarCandleColor('RELEASE_UP', 90, true)!
    const dn = pulsarCandleColor('RELEASE_DOWN', 90, false)!
    const expUp = pulsarCandleColor('EXPANSION_UP', 50, true)!
    expect(up.color).not.toBe(dn.color)
    expect(up.color).not.toBe(expUp.color)
    // Bara de iesire are contur alb: e evenimentul, trebuie sa sara in ochi.
    expect(up.borderColor).toBe('#ffffff')
    expect(dn.borderColor).toBe('#ffffff')
  })

  it('fiecare faza care coloreaza da toate cele trei culori', () => {
    for (const p of ['COMPRESSION', 'CHARGED', 'RELEASE_UP', 'RELEASE_DOWN', 'EXPANSION_UP', 'EXPANSION_DOWN', 'EXHAUSTED'] as const) {
      const c = pulsarCandleColor(p, 50, true)
      expect(c).not.toBeNull()
      expect(c!.color).toMatch(/^(#|rgb)/)
      expect(c!.wickColor).toMatch(/^(#|rgb)/)
      expect(c!.borderColor).toMatch(/^(#|rgb)/)
    }
  })
})

describe('PULSAR — date stricate', () => {
  it('nu arunca pe serii goale sau cu NaN', () => {
    expect(() => pulsar([], [], [], [])).not.toThrow()
    const s = series([{ bars: 40, rangePct: 2 }])
    s.highs[10] = NaN; s.lows[11] = NaN; s.closes[12] = NaN
    expect(() => pulsar(s.highs, s.lows, s.closes, s.vols)).not.toThrow()
  })

  it('o serie perfect plata nu produce o iesire din nimic', () => {
    const flat = { highs: new Array(80).fill(100), lows: new Array(80).fill(100), closes: new Array(80).fill(100), vols: new Array(80).fill(1) }
    const r = pulsar(flat.highs, flat.lows, flat.closes, flat.vols)
    expect(r.release).toBeNull()
  })
})

describe('PULSAR — o iesire care a esuat nu mai arata tinte', () => {
  // Gasit pe date vii, nu in teste: pe 4h exista o iesire UP de la 86064 cu
  // invalidarea la 82724, iar pretul era la ~81900 — demult sub ea. Fara
  // steagul de invalidare chartul ar fi desenat tinte pentru un scenariu care
  // a esuat deja. Exact genul de minciuna pe care o vanez prin codul vechi.

  function coilBreakThenFail(bars: number) {
    const H: number[] = [], L: number[] = [], C: number[] = []
    let px = 100
    // zgomot, apoi compresie
    for (let i = 0; i < 60; i++) { const c = px + (i % 2 ? 1.5 : -1.5); H.push(Math.max(px, c) + 1.5); L.push(Math.min(px, c) - 1.5); C.push(c); px = c }
    for (let i = 0; i < 25; i++) { const c = px + (i % 2 ? 0.05 : -0.05); H.push(Math.max(px, c) + 0.1); L.push(Math.min(px, c) - 0.1); C.push(c); px = c }
    // iesire in sus
    const brk = px * 1.04
    H.push(brk * 1.002); L.push(px * 0.999); C.push(brk); px = brk
    // apoi se prabuseste sub cutie
    for (let i = 0; i < bars; i++) { const c = px * 0.985; H.push(px); L.push(c * 0.998); C.push(c); px = c }
    return { H, L, C, V: H.map(() => 1000) }
  }

  it('marcheaza invalidarea cand pretul rupe marginea opusa dupa iesire', () => {
    const d = coilBreakThenFail(12)
    const r = pulsar(d.H, d.L, d.C, d.V)
    expect(r.release).not.toBeNull()
    expect(r.release!.invalidated).toBe(true)
  })

  it('si NU mai raporteaza tinta pentru ea — altfel chartul ar minti', () => {
    const d = coilBreakThenFail(12)
    const r = pulsar(d.H, d.L, d.C, d.V)
    expect(r.panel.targetPct).toBeNull()
    expect(r.panel.reachedPct).toBeNull()
  })

  it('o iesire proaspata, inca valida, NU e marcata invalidata', () => {
    const d = coilBreakThenFail(0)
    const r = pulsar(d.H, d.L, d.C, d.V)
    expect(r.release).not.toBeNull()
    expect(r.release!.invalidated).toBe(false)
    expect(r.panel.targetPct).not.toBeNull()
  })
})
