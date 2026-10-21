// [2026-10-21 b296] Potrivirea fontului + contractul de laţime al cadrului.
import { describe, it, expect } from 'vitest'
import { fitFontSize, FRAME_COLS, MIN_FONT_PX, MAX_FONT_PX } from '../render/fit'
import { renderFrame } from '../render/frame'

const w = window as any

describe('fitFontSize', () => {
  // 101 caractere la 11,5px masoara ~700px (0,6026 em pe caracter + spaţiere).
  const PROBE = 700, PROBE_FONT = 11.5

  it('creste fontul cand panoul e mai lat decat cadrul', () => {
    expect(fitFontSize(900, PROBE, PROBE_FONT)).toBeGreaterThan(PROBE_FONT)
  })

  it('scade fontul cand panoul e mai ingust, in loc sa taie coloana din dreapta', () => {
    expect(fitFontSize(500, PROBE, PROBE_FONT)).toBeLessThan(PROBE_FONT)
  })

  it('pastreaza fontul cand panoul e exact pe masura', () => {
    expect(fitFontSize(PROBE, PROBE, PROBE_FONT)).toBe(PROBE_FONT)
  })

  it('respecta plafonul si pragul', () => {
    expect(fitFontSize(100000, PROBE, PROBE_FONT)).toBe(MAX_FONT_PX)
    expect(fitFontSize(10, PROBE, PROBE_FONT)).toBe(MIN_FONT_PX)
  })

  it('rotunjeste la 0,1px ca sa nu reflow-eze la fiecare pixel', () => {
    const a = fitFontSize(811, PROBE, PROBE_FONT)
    const b = fitFontSize(812, PROBE, PROBE_FONT)
    expect(a * 10).toBe(Math.round(a * 10))
    expect(Math.abs(a - b)).toBeLessThan(0.15)
  })

  it('cade pe valoarea de rezerva la intrari neplauzibile — NU pe 0 sau NaN', () => {
    // Un font 0 ar goli panoul; NaN l-ar lasa nestilizat.
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(fitFontSize(bad as number, PROBE, PROBE_FONT)).toBe(11.5)
      expect(fitFontSize(900, bad as number, PROBE_FONT)).toBe(11.5)
      expect(fitFontSize(900, PROBE, bad as number)).toBe(11.5)
    }
  })

  it('accepta o valoare de rezerva proprie', () => {
    expect(fitFontSize(0, PROBE, PROBE_FONT, 12.25)).toBe(12.25)
  })
})

describe('contractul de laţime al cadrului', () => {
  it('nicio linie randata nu depaseste FRAME_COLS', () => {
    // Daca testul asta cade, cineva a adaugat o linie mai lata: actualizeaza
    // FRAME_COLS in render/fit.ts, altfel potrivirea fontului calculeaza pe o
    // laţime care nu mai e adevarata si coloana din dreapta se taie din nou.
    w.S = { symbol: 'BTCUSDT', price: 83000, klines: [], _qmBuf: [] }
    const lines = renderFrame().split('\n').map(l => l.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' '))
    const widest = Math.max(...lines.map(l => [...l].length))
    expect(widest).toBeLessThanOrEqual(FRAME_COLS)
    // ...si nici mult mai ingusta, altfel am micsora textul degeaba.
    expect(widest).toBeGreaterThan(FRAME_COLS - 12)
  })
})
