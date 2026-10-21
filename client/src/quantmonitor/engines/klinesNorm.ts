// [KLINES REMAP 2026-10-21] Conversia klines în formatul pe care îl citesc
// motoarele QM, făcută o singură dată per bară în loc de la fiecare tick.
//
// Ce era înainte: `runAllEngines` remapa TOT vectorul la fiecare 500 ms, deci
// ~1 000 de obiecte pe secundă, 3,6 milioane pe oră, pentru totdeauna. Garda
// nu se putea stinge niciodată: testa `klines[0].open !== undefined`, iar
// remap-ul **păstra** `open` — intenţionat, ca graficul Zeus să-şi găsească
// formatul. Deci condiţia rămânea adevărată şi munca se repeta pe aceleaşi date.
//
// Inversarea naivă a gărzii (pe `klines[0].o`) ar fi stricat date, şi ăsta e
// motivul pentru care funcţia se uită şi la coadă: `marketDataChart.ts`
// (liniile 142, 162, 193) ÎNLOCUIEŞTE lumânarea vie cu un obiect proaspăt în
// format Zeus — merge direct la `cSeries.update`, deci are open/high/low/close,
// nu o/h/l/c. Cu o gardă pusă doar pe elementul 0, bara în curs n-ar primi
// niciodată formatul QM şi motoarele ar citi `undefined` exact pe bara care
// contează cel mai mult.

export interface QmBar {
  o: number; h: number; l: number; c: number; v: number; t: number
  open?: number; high?: number; low?: number; close?: number; volume?: number; time?: number
}

// Păstrează originalele Zeus lângă cele QM — graficul le citeşte pe acelea.
// `?? k.o` acoperă o bară deja convertită, deci conversia e idempotentă.
export function toQmBar(k: any): QmBar {
  return {
    o: k.open ?? k.o, h: k.high ?? k.h, l: k.low ?? k.l,
    c: k.close ?? k.c, v: k.volume ?? k.v, t: k.time ?? k.t,
    open: k.open ?? k.o, high: k.high ?? k.h, low: k.low ?? k.l,
    close: k.close ?? k.c, volume: k.volume ?? k.v, time: k.time ?? k.t,
  }
}

function _needsConvert(k: any): boolean {
  return !!k && typeof k === 'object' && (k as any).o === undefined
}

/**
 * Converteşte în loc doar barele care nu au încă formatul QM şi întoarce câte
 * a atins. Zero înseamnă că n-a fost nimic de făcut — exact cazul care înainte
 * costa 1 000 de obiecte.
 *
 * Două situaţii, tratate separat ca să nu plătim un vector întreg pentru o bară:
 *  - vector proaspăt din `fetchKlines` (elementul 0 e în format Zeus) → tot;
 *  - lumânarea vie înlocuită sau bare împinse la coadă → doar coada, mergând
 *    înapoi cât timp barele n-au formatul QM.
 */
export function normalizeKlines(klines: any[]): number {
  if (!Array.isArray(klines) || klines.length === 0) return 0
  let converted = 0
  if (_needsConvert(klines[0])) {
    for (let i = 0; i < klines.length; i++) {
      if (!_needsConvert(klines[i])) continue
      klines[i] = toQmBar(klines[i]); converted++
    }
    return converted
  }
  for (let i = klines.length - 1; i >= 0; i--) {
    if (!_needsConvert(klines[i])) break
    klines[i] = toQmBar(klines[i]); converted++
  }
  return converted
}
