// QM — potrivirea dimensiunii fontului la laţimea panoului.
//
// [2026-10-21 b296] Cadrul Quant e ASCII cu laţime FIXA: cea mai lata linie
// randata are FRAME_COLS caractere. Panoul avea `fontSize: 11.5px` fix si
// `overflowX: hidden`, deci:
//   - pe un panou mai ingust decat ~740px, coloana din dreapta se TAIA in
//     liniste (pierdere de informaţie, nu doar de estetica);
//   - pe un panou lat, textul rămanea mic degeaba.
// Fontul fiind monospaţiat, scalarea pastreaza alinierea coloanelor exact.

/**
 * Cea mai lata linie pe care o produce `renderFrame()`, in caractere.
 * Masurata, nu presupusa — `fitContract.test.ts` cade daca randarea depaseste
 * valoarea asta, ca sa nu se desincronizeze in liniste cand cineva adauga o
 * linie mai lata.
 */
export const FRAME_COLS = 101

export const MIN_FONT_PX = 9.5
export const MAX_FONT_PX = 15

/**
 * Dimensiunea de font la care `FRAME_COLS` caractere incap in `availablePx`.
 *
 * `probeWidthPx` e laţimea MASURATA a unui sir de `FRAME_COLS` caractere
 * randat la `probeFontPx`. Raportul e liniar (monospaţiat + spaţierea literelor
 * exprimata in `em`), deci regula de trei e exacta.
 *
 * Fail-safe: orice intrare neplauzibila intoarce `fallback` in loc sa producea
 * NaN sau 0, fiindca un font 0 ar goli panoul.
 */
export function fitFontSize(
  availablePx: number,
  probeWidthPx: number,
  probeFontPx: number,
  fallback = 11.5,
  min = MIN_FONT_PX,
  max = MAX_FONT_PX,
): number {
  const raw = probeFontPx * (availablePx / probeWidthPx)
  // O singura verificare, pe REZULTAT, acopera toate intrarile proaste: 0,
  // negativ, NaN sau Infinity pe oricare din cele trei produc un `raw`
  // nefinit sau <= 0. Aveam si trei garzi separate pe intrari si le-am scos —
  // testul de mutatie a aratat ca niciuna nu schimba vreun rezultat.
  if (!Number.isFinite(raw) || raw <= 0) return fallback
  // Rotunjit la 0,1px: evita ca ResizeObserver sa reaplice stiluri la fiecare
  // pixel de redimensionare, ceea ce ar reflow-a un panou de 493 de linii.
  return Math.round(Math.max(min, Math.min(max, raw)) * 10) / 10
}
