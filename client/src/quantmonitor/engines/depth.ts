// [DEPTH BRIDGE 2026-10-21] Agregarea volumului din cartea de ordine.
//
// De ce există: `S.obBV` / `S.obAV` erau citite în 11 locuri (index.ts:66,
// intel.ts de 6 ori, flow.ts:88, frame.ts prin `_qmObBV`/`_qmObAV`) şi scrise
// în zero. Datele erau acolo tot timpul — `S.bids` / `S.asks` se populează din
// fluxul depth20 (marketDataWS.ts:176-177) — lipsea doar însumarea. Aceeaşi
// punte neterminată ca cele 28 reparate în b294, cu două motoare moarte în capăt:
// CVD Divergence nu putea semnala niciodată (istoricul de delta era `0 - 0` la
// fiecare tick, iar pe o serie constantă de zerouri nici `dUp` nici `dDn` nu pot
// deveni true) şi scorul SMF rămânea blocat pe NEUT (`0 > 0` e fals în ambele
// sensuri).
//
// Două surse de carte, cu forme diferite: fluxul direct scrie obiecte `{p, q}`,
// proxy-ul scrie `msg.bids`, a cărui formă nu e garantată. Acceptăm ambele —
// altfel puntea ar merge pe o cale şi ar tăcea pe cealaltă, adică exact felul
// de bug pe care îl reparăm.

type Level = { p?: number | string; q?: number | string } | [number | string, number | string]

// Cantitatea unui nivel, din oricare din cele două forme. Întoarce 0 pentru
// orice nivel pe care nu-l putem citi, ca un rând stricat să nu otrăvească
// totalul cu NaN — un total NaN ar face toate cele 11 citiri să cadă pe `|| 0`,
// adică exact tăcerea de dinainte, dar mai greu de găsit.
function _qty(level: Level): number {
  if (!level || typeof level !== 'object') return 0
  const raw = Array.isArray(level) ? level[1] : (level as any).q
  const n = Number(raw)
  // Negativ şi Infinity sunt respinse, nu doar NaN: o carte de ordine nu are
  // volum negativ, iar un Infinity scăpat în total ar îngheţa orice raport
  // calculat din el (obBV/tot ar da NaN în intel.ts).
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function sumDepthVolume(levels: Level[]): number {
  if (!Array.isArray(levels)) return 0
  let total = 0
  for (const l of levels) total += _qty(l)
  return total
}
