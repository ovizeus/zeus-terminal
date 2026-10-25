import { describe, it, expect } from 'vitest'
import { fmtUsd, fmtPct, intensity, cellColor, barColor, LIQ } from '../scale'

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
