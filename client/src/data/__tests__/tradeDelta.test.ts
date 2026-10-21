import { describe, it, expect } from 'vitest'
import { signedQty } from '../tradeDelta'

// [CVD REAL 2026-10-21] `_qmCumDelta` se afiseaza in Quant ca **CVD** si avea
// ZERO scriitori, deci randarea arata mereu +0.000. Tentatia era sa-l alimentez
// din adancimea cartii (obBV - obAV), fiindca aia devenise disponibila in b301 —
// dar ar fi fost greşit: CVD inseamna delta din tranzactii EXECUTATE, nu
// dezechilibrul cartii. Ar fi scris „CVD" peste un numar care nu e CVD, adica
// exact falsa onestitate pe care auditul o vana.
//
// Sursa corecta exista si e vie: `_onMsg` (orderflow.ts:419) primeste fiecare
// aggTrade si il pune in `RAW_FLOW.buf` cu `isBuyerMaker`. Lipsea doar
// acumulatorul. Semnul vine din rolul agresorului:
//   isBuyerMaker = true  -> cumparatorul e MAKER, deci agresorul e VANZATORUL
//                           -> volum de vanzare -> delta NEGATIVA
//   isBuyerMaker = false -> agresorul e cumparatorul -> delta POZITIVA
// Daca semnul ar fi invers, CVD-ul ar arata exact pe dos in fiecare trend, deci
// merita fixat intr-un test, nu lasat la memorie.
describe('signedQty — semnul unei tranzactii pentru CVD', () => {
  it('agresor CUMPARATOR (isBuyerMaker=false) → pozitiv', () => {
    expect(signedQty({ q: 2.5, isBuyerMaker: false })).toBe(2.5)
  })

  it('agresor VANZATOR (isBuyerMaker=true) → negativ', () => {
    expect(signedQty({ q: 2.5, isBuyerMaker: true })).toBe(-2.5)
  })

  it('accepta cantitatea ca sir, cum vine de la bursa', () => {
    expect(signedQty({ q: '1.25' as any, isBuyerMaker: false })).toBe(1.25)
    expect(signedQty({ q: '1.25' as any, isBuyerMaker: true })).toBe(-1.25)
  })

  it('tranzactie stricata → 0, ca sa nu otraveasca totalul cu NaN', () => {
    expect(signedQty(null as any)).toBe(0)
    expect(signedQty({} as any)).toBe(0)
    expect(signedQty({ q: NaN, isBuyerMaker: false })).toBe(0)
    expect(signedQty({ q: Infinity, isBuyerMaker: false })).toBe(0)
    expect(signedQty({ q: 'aiurea' as any, isBuyerMaker: false })).toBe(0)
  })

  it('cantitate negativa e respinsa (semnul vine din rol, nu din cantitate)', () => {
    expect(signedQty({ q: -3, isBuyerMaker: false })).toBe(0)
  })

  it('o serie se acumuleaza corect si poate schimba semnul', () => {
    const trades = [
      { q: 5, isBuyerMaker: false },   // +5
      { q: 2, isBuyerMaker: true },    // -2
      { q: 1, isBuyerMaker: true },    // -1
    ]
    expect(trades.reduce((a, t) => a + signedQty(t), 0)).toBe(2)
    const bearish = [{ q: 1, isBuyerMaker: false }, { q: 9, isBuyerMaker: true }]
    expect(bearish.reduce((a, t) => a + signedQty(t), 0)).toBe(-8)
  })
})
