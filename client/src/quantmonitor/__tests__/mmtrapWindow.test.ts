import { describe, it, expect } from 'vitest'
import { mmtrapWindow } from '../engines/flow'

// [MMTRAP MINE 2026-10-21] Auditul b294 a gasit o mina inactiva in `calcFLOW`:
//   const winSlice = win.slice(0, -3); if (winSlice.length < 1) return
// Acel `return` iesea din TOATA functia, nu din blocul MMTRAP. Azi nu se declanşa
// — garda `buf.length >= 30` facea ca `winSlice` sa aiba mereu 27 de elemente —
// dar daca cineva cobora pragul de 30, ar fi tăiat in liniste tot ce vine dupa:
// EXHAUST, VOID, STOP si SMF. Patru motoare stinse de o decizie care arata
// nevinovata, fara nicio eroare.
//
// Mina nu se putea testa cat timp statea inglobata: pragul e o constanta in cod,
// deci din afara nu puteai ajunge la granita. Fereastra e acum o functie pura cu
// parametri, deci granita e verificabila direct — si refuzul ei nu mai poate
// opri functia, doar blocul lui.
describe('mmtrapWindow — granita care ascundea mina', () => {
  const buf = (n: number) => Array.from({ length: n }, (_, i) => 100 + i)

  it('tampon normal → intoarce maximul si minimul ferestrei', () => {
    const w = mmtrapWindow(buf(30))
    expect(w).toBeTruthy()
    expect(w!.hi).toBe(126)   // 100..129, fara ultimele 3 → max 126
    expect(w!.lo).toBe(100)
  })

  it('exact la granita (tailDrop = lungime) → null, NU aruncare si NU oprire', () => {
    expect(mmtrapWindow([1, 2, 3], 3, 3)).toBeNull()
  })

  it('sub granita → null', () => {
    expect(mmtrapWindow([1, 2], 3, 3)).toBeNull()
    expect(mmtrapWindow([], 30, 3)).toBeNull()
  })

  it('tampon lipsa → null, fara excepţie', () => {
    expect(mmtrapWindow(undefined as any)).toBeNull()
    expect(mmtrapWindow(null as any)).toBeNull()
  })

  it('cu un singur element rămas dupa taiere, ferestra e valida', () => {
    const w = mmtrapWindow([5, 9, 9, 9], 4, 3)
    expect(w).toEqual({ hi: 5, lo: 5 })
  })

  it('REGRESIE: un prag coborat NU mai poate opri functia — fereastra doar refuza', () => {
    // exact scenariul minei: lookback mic, deci winSlice gol
    for (const n of [0, 1, 2, 3]) {
      expect(() => mmtrapWindow(buf(n), 3, 3)).not.toThrow()
      expect(mmtrapWindow(buf(n), 3, 3)).toBeNull()
    }
  })

  it('ignora valorile nefinite in loc sa intoarca NaN', () => {
    const w = mmtrapWindow([10, NaN, 20, 0, 0, 0], 6, 3)
    expect(w).toBeTruthy()
    expect(Number.isFinite(w!.hi)).toBe(true)
    expect(Number.isFinite(w!.lo)).toBe(true)
    expect(w!.hi).toBe(20)
    expect(w!.lo).toBe(10)
  })
})
