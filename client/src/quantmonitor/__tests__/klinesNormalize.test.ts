import { describe, it, expect } from 'vitest'
import { normalizeKlines, toQmBar } from '../engines/klinesNorm'

// [KLINES REMAP 2026-10-21] Auditul b294 a masurat o risipa care rula la infinit:
// `runAllEngines` remapa TOT vectorul de klines la fiecare 500 ms, adica circa
// 1 000 de obiecte pe secunda, 3,6 milioane pe ora, pentru totdeauna.
// Cauza era o garda care nu se putea stinge niciodata: testa
// `klines[0].open !== undefined`, iar remap-ul PASTRA `open` (intentionat, ca
// graficul Zeus sa-si gaseasca formatul). Deci conditia rămanea adevarata la
// fiecare tick si munca se repeta pe aceleasi date.
//
// Dar inversarea naiva a gardii (pe `klines[0].o`) ar fi STRICAT date, si de
// aceea testul acopera explicit cazul: `marketDataChart.ts:142/162/193`
// INLOCUIESC lumanarea vie cu un obiect proaspat in format Zeus (merge direct la
// `cSeries.update`, deci are open/high/low/close, nu o/h/l/c). Daca ne-am uitat
// doar la elementul 0, ultima lumanare n-ar primi niciodata formatul QM si
// motoarele ar citi `undefined` pe cel mai important bar — cel in curs.
describe('toQmBar — conversia unui bar', () => {
  it('adauga formatul QM si PASTREAZA originalele pentru graficul Zeus', () => {
    const q = toQmBar({ open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, time: 99 })
    expect([q.o, q.h, q.l, q.c, q.v, q.t]).toEqual([1, 2, 0.5, 1.5, 10, 99])
    expect([q.open, q.high, q.low, q.close, q.volume, q.time]).toEqual([1, 2, 0.5, 1.5, 10, 99])
  })

  it('un bar deja in format QM rămane valid (idempotent)', () => {
    const once = toQmBar({ open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, time: 99 })
    const twice = toQmBar(once)
    expect([twice.o, twice.c, twice.t]).toEqual([1, 1.5, 99])
  })
})

describe('normalizeKlines — converteste DOAR ce are nevoie', () => {
  const zeus = (t: number) => ({ open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, time: t })

  it('vector proaspat in format Zeus → converteste tot, o singura data', () => {
    const arr = [zeus(1), zeus(2), zeus(3)]
    expect(normalizeKlines(arr)).toBe(3)
    expect(arr[0].o).toBe(1)
  })

  it('REGRESIE, miezul risipei: al doilea apel converteste ZERO bare', () => {
    const arr = [zeus(1), zeus(2), zeus(3)]
    normalizeKlines(arr)
    expect(normalizeKlines(arr)).toBe(0)
  })

  it('REGRESIE: 100 de apeluri pe acelasi vector = zero munca dupa primul', () => {
    const arr = Array.from({ length: 500 }, (_, i) => zeus(i))
    expect(normalizeKlines(arr)).toBe(500)
    let total = 0
    for (let i = 0; i < 100; i++) total += normalizeKlines(arr)
    expect(total).toBe(0)
  })

  it('REGRESIE CRITICA: lumanarea vie inlocuita in format Zeus E convertita', () => {
    const arr = [zeus(1), zeus(2), zeus(3)]
    normalizeKlines(arr)
    arr[arr.length - 1] = zeus(3) as any       // exact ce face marketDataChart.ts:142
    expect(normalizeKlines(arr)).toBe(1)        // doar ea, nu tot vectorul
    expect((arr[arr.length - 1] as any).c).toBe(1.5)
  })

  it('mai multe bare adaugate la coada sunt toate prinse', () => {
    const arr: any[] = [zeus(1), zeus(2)]
    normalizeKlines(arr)
    arr.push(zeus(3), zeus(4), zeus(5))
    expect(normalizeKlines(arr)).toBe(3)
    expect(arr[2].c).toBe(1.5)
    expect(arr[4].c).toBe(1.5)
  })

  it('vector gol sau lipsa → 0, fara excepţie', () => {
    expect(normalizeKlines([])).toBe(0)
    expect(normalizeKlines(undefined as any)).toBe(0)
    expect(normalizeKlines(null as any)).toBe(0)
  })

  it('o bara stricata nu arunca si nu blocheaza restul', () => {
    const arr: any[] = [zeus(1), null, zeus(3)]
    expect(() => normalizeKlines(arr)).not.toThrow()
  })
})
