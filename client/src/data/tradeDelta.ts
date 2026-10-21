// [CVD REAL 2026-10-21] Semnul unei tranzacţii executate, pentru delta cumulată.
//
// `_qmCumDelta` se afişează în Quant ca **CVD** şi avea zero scriitori, deci
// randarea arăta mereu `+0.000`. Tentaţia era să-l alimentez din adâncimea
// cărţii (`obBV - obAV`), devenită disponibilă în b301 — dar ar fi fost greşit:
// CVD înseamnă delta din tranzacţii **executate**, nu dezechilibrul cărţii de
// ordine. Ar fi scris „CVD" peste un număr care nu e CVD.
//
// Sursa corectă exista şi e vie: `_onMsg` (orderflow.ts:419) primeşte fiecare
// aggTrade şi îl pune în `RAW_FLOW.buf`. Lipsea doar acumulatorul — iar suma
// buffer-ului nu e o alternativă, fiindcă `_prune` îl taie la 10 secunde, deci
// ar fi dat o deltă pe fereastră, nu cumulată.
//
// Semnul vine din rolul agresorului, nu din cantitate:
//   isBuyerMaker = true  → cumpărătorul e MAKER, deci agresorul e VÂNZĂTORUL
//                          → volum de vânzare → deltă NEGATIVĂ
//   isBuyerMaker = false → agresorul e cumpărătorul → deltă POZITIVĂ
// Inversat, CVD-ul ar arăta exact pe dos în fiecare trend, de aceea e fixat în
// test şi nu lăsat la memorie.

export interface RawTrade { q: number | string; isBuyerMaker?: boolean }

export function signedQty(t: RawTrade): number {
  if (!t || typeof t !== 'object') return 0
  const q = Number((t as any).q)
  // Respinge şi negativ şi Infinity, nu doar NaN: cantitatea nu poate fi
  // negativă (semnul e dat de rol), iar un Infinity ar îngheţa totalul pe veci
  // — şi atunci afişajul ar arăta tot un singur număr, la fel de inutil ca 0,
  // dar mai greu de recunoscut ca defect.
  if (!Number.isFinite(q) || q <= 0) return 0
  return (t as any).isBuyerMaker ? -q : q
}
