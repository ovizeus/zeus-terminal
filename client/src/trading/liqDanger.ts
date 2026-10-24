/* ───────────────────────────────────────────────────────────────
   Zeus Terminal — pericolul de lichiditate | 2026-10-24
   Partea pură a lui LiqDanger.

   Ce măsoară: pe chart există „magneţi" de lichiditate — niveluri unde stau
   grămadă stopuri şi lichidări. Preţul e atras spre ele. Dacă intri când preţul e
   LIPIT de un asemenea nivel, şansa să fii măturat (preţul atinge zona, ia
   stopurile, se întoarce) e mare. Deci pericolul creşte cu APROPIEREA.

   Ce era greşit: `MAGNETS.nearPct` e DISTANŢA până la cel mai apropiat magnet, în
   procente (`((price - m.price) / price) * 100`, arianova.ts:1470). Clientul o
   folosea direct ca pericol — sens invers — şi o mai împărţea o dată la 100, deşi
   era deja procent. Măsurat pe rândurile reale de paritate: mediana LiqDanger pe
   client **0,00**, în timp ce 99,7% din rânduri au preţul la sub 0,5% de un magnet,
   adică exact cazul periculos. Penalizarea `confF *= (1 - liqDangerN * 0.55)` nu se
   aplica practic niciodată.

   De ce NU copiem pur şi simplu serverul: serverul calculează corect apropierea,
   dar măsurat are **mediana 100%** şi media 81,8% — ar tăia ~45% din încredere la
   FIECARE decizie. Asta nu e un semnal care discriminează, e o taxă constantă.
   Pragul rămâne deci PARAMETRU, ca să poată fi calibrat pe date înainte să atingă
   vreo decizie.
   ─────────────────────────────────────────────────────────────── */

/** Când nu există măsurătoare. Acelaşi neutru pe care îl folosea codul de până acum. */
export const LIQ_NEUTRAL_DEFAULT = 0.2

/** Pragul „aproape", în procente. Serverul foloseşte 0.005 ca fracţie = 0,5%. */
export const LIQ_PROXIMITY_PCT = 0.5

/**
 * Pericolul de lichiditate, 0..1, din distanţa până la cel mai apropiat magnet.
 *
 * @param nearPctDistance distanţa în PROCENTE (ce ţine `MAGNETS.nearPct`)
 * @param proximityPct    pragul „aproape", tot în procente
 * @returns 1 = preţul e pe zonă (pericol maxim), 0 = la sau dincolo de prag
 */
export function liquidityDanger(
  nearPctDistance: number | null | undefined,
  proximityPct: number = LIQ_PROXIMITY_PCT,
): number {
  if (!Number.isFinite(proximityPct as number) || (proximityPct as number) <= 0) return LIQ_NEUTRAL_DEFAULT
  if (nearPctDistance === null || nearPctDistance === undefined) return LIQ_NEUTRAL_DEFAULT
  const d = Number(nearPctDistance)
  if (!Number.isFinite(d)) return LIQ_NEUTRAL_DEFAULT
  // O distanţă negativă nu are sens fizic; o tratăm ca „pe zonă".
  if (d <= 0) return 1
  if (d >= proximityPct) return 0
  return 1 - d / proximityPct
}
