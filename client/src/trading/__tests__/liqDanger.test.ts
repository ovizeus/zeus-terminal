// [2026-10-24] LiqDanger pe client era INTORS si, in plus, INERT.
//
// `MAGNETS.nearPct` e DISTANTA pana la cel mai apropiat magnet de lichiditate, in
// PROCENTE: `((price - m.price) / price) * 100` (arianova.ts:1470). Mic = aproape =
// periculos. Clientul il folosea direct ca pericol — deci sens invers — si il mai
// imparţea o data la 100, desi era deja procent.
//
// Masurat pe randurile reale de paritate: mediana LiqDanger pe client = 0,00 si media
// 0,00, in timp ce 99,7% din randuri au pretul la sub 0,5% de un magnet (adica tocmai
// cazul periculos). Deci penalizarea `confF *= (1 - liqDangerN * 0.55)` nu se aplica
// practic niciodata.
//
// Serverul masoara corect — APROPIEREA, `(1 - dist/prag) * putere` — dar el are
// mediana 100%, adica ar taia ~45% din incredere la FIECARE decizie. Aia nu e un
// semnal care discrimineaza, e o taxa constanta. Deci nu copiem serverul: calculam
// corect SI pastram pragul ca parametru, ca sa poata fi calibrat pe date.
import { describe, it, expect } from 'vitest'
import { liquidityDanger, LIQ_NEUTRAL_DEFAULT } from '../liqDanger'

describe('liquidityDanger — APROPIEREA e pericolul, nu distanta', () => {
  it('lipit de magnet = pericol maxim', () => {
    expect(liquidityDanger(0)).toBe(1)
  })

  it('exact la prag = fara pericol', () => {
    expect(liquidityDanger(0.5, 0.5)).toBe(0)
  })

  it('dincolo de prag = fara pericol', () => {
    expect(liquidityDanger(3, 0.5)).toBe(0)
    expect(liquidityDanger(50, 0.5)).toBe(0)
  })

  it('la jumatatea pragului = jumatate de pericol', () => {
    expect(liquidityDanger(0.25, 0.5)).toBeCloseTo(0.5, 6)
  })

  it('scade monoton cu distanta', () => {
    const a = liquidityDanger(0.1, 0.5)
    const b = liquidityDanger(0.2, 0.5)
    const c = liquidityDanger(0.4, 0.5)
    expect(a).toBeGreaterThan(b)
    expect(b).toBeGreaterThan(c)
  })

  // Exact inversiunea, pusa in test ca sa nu se mai poata intoarce pe furis.
  it('la un pret LIPIT de magnet da penalizare MARE, nu zero ca formula veche', () => {
    const nearPct = 0.1                       // 0,1% distanta = foarte aproape
    const vechi = Math.min(1, Math.max(0, nearPct / 100))   // formula de pana acum
    const nou = liquidityDanger(nearPct, 0.5)
    expect(vechi).toBeLessThan(0.01)          // vechea: practic zero penalizare
    expect(nou).toBeGreaterThan(0.75)         // noua: pericol mare, cum si este
  })

  it('o distanta negativa nu are sens, deci e tratata ca „pe zona"', () => {
    expect(liquidityDanger(-2, 0.5)).toBe(1)
  })

  it('fara masuratoare cade pe neutru, nu pe zero si nu pe unu', () => {
    expect(liquidityDanger(null)).toBe(LIQ_NEUTRAL_DEFAULT)
    expect(liquidityDanger(undefined)).toBe(LIQ_NEUTRAL_DEFAULT)
    expect(liquidityDanger(NaN)).toBe(LIQ_NEUTRAL_DEFAULT)
    expect(LIQ_NEUTRAL_DEFAULT).toBe(0.2)     // acelasi neutru ca pana acum
  })

  it('un prag nevalid nu arunca si nu da valori aiurea', () => {
    expect(liquidityDanger(0.2, 0)).toBe(LIQ_NEUTRAL_DEFAULT)
    expect(liquidityDanger(0.2, -1)).toBe(LIQ_NEUTRAL_DEFAULT)
  })

  it('rezultatul sta mereu in 0..1', () => {
    for (const d of [0, 0.01, 0.2, 0.5, 1, 7, 1000]) {
      const v = liquidityDanger(d, 0.5)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})
