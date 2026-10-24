/* ───────────────────────────────────────────────────────────────
   Zeus Terminal — armarea uneltelor de desen | 2026-10-24
   Partea pură a desenului pe chart.

   De ce există: „dungile nu se pun". Erau DOUĂ surse de adevăr pentru întrebarea
   „ce unealtă e armată" — `drawTool`, starea React din ChartControls, de care
   atârnă aspectul butonului şi aritmetica de toggle, şi `_activeTool` din
   drawingTools.ts, de care atârnă dacă un clic pe chart desenează cu adevărat.

   După fiecare linie plasată, `_handleChartAction` cheamă `_deactivate()`, deci
   modulul se dezarmează singur — şi nimeni nu spunea React-ului. De acolo tot
   simptomul: butonul rămânea aprins, clicul următor pe chart cădea pe ramura de
   selectare şi nu desena nimic, iar re-armarea cerea DOUĂ apăsări, pentru că
   prima trimitea `null` (React credea că stinge ce era deja aprins).

   Aşa că modulul devine singura sursă de adevăr, iar React o oglindeşte prin
   `zeus:drawToolChanged` — exact tiparul deja folosit de `zeus:atStateChanged`,
   `zeus:dslStateChanged` şi fraţii lor.

   Pur dinadins: drawingTools.ts e un IIFE care cere un chart viu, deci nimic din
   asta nu s-ar putea testa altfel. Acelaşi motiv ca la drawingScope.ts.
   ─────────────────────────────────────────────────────────────── */

export type DrawTool = 'hline' | 'tline' | 'eraser' | null

/** Numele pe care circulă schimbarea de armare, dinspre modul spre React. */
export const DRAW_TOOL_EVENT = 'zeus:drawToolChanged'

export interface TPoint { time: number; price: number }

/**
 * Singura aritmetică de armare din aplicaţie.
 *
 * `armed` TREBUIE să fie ce ştie modulul, niciodată ce ţine minte React: diferenţa
 * dintre cele două e chiar bugul. React nu mai calculează nimic — trimite unealta
 * apăsată şi află rezultatul din eveniment.
 */
export function resolveToolToggle(armed: DrawTool, clicked: DrawTool): DrawTool {
  if (clicked === null) return null
  return armed === clicked ? null : clicked
}

/**
 * Cele două puncte ale unei trendline, pregătite pentru `setData`.
 *
 * `null` înseamnă „nu se poate desena asta", şi apelantul trebuie să spună de ce
 * în loc să producă ceva invizibil.
 *
 * Cazul care conta: ambele clicuri pe ACEEAŞI lumânare. `_timeAtX` rotunjeşte la
 * index de lumânare, deci pe un chart depărtat două clicuri la câţiva pixeli dau
 * acelaşi timp. Cu doi timpi identici, lightweight-charts validează ordinea doar
 * în build-ul de development (`checkItemsAreOrdered`, `allowDuplicates=false`);
 * în producţie verificarea e eliminată, deci nu aruncă nimic — punctele se
 * colapsează într-unul singur şi linia are lungime zero. Adică fix „am desenat
 * şi nu s-a pus".
 *
 * Garda asta exista deja în `_updateTLineSeries` (calea de drag) şi lipsea din
 * `_addTLine` (calea de creare) — reparată într-un loc din două, exact tiparul pe
 * care l-am mai prins la filtrul dry-run.
 */
export function tlineSeriesData(p1: TPoint | null | undefined, p2: TPoint | null | undefined):
  Array<{ time: number; value: number }> | null {
  if (!p1 || !p2) return null
  const t1 = Number(p1.time), t2 = Number(p2.time)
  const v1 = Number(p1.price), v2 = Number(p2.price)
  if (![t1, t2, v1, v2].every((n) => Number.isFinite(n))) return null
  if (t1 === t2) return null
  return t1 < t2
    ? [{ time: t1, value: v1 }, { time: t2, value: v2 }]
    : [{ time: t2, value: v2 }, { time: t1, value: v1 }]
}

/**
 * Dacă stratul de mânere trebuie (re)creat.
 *
 * `_handleContainer` era memorat o dată şi niciodată revalidat. Panoul de chart se
 * re-montează (fullscreen, schimbare de layout), nodul iese din document dar rămâne
 * în variabilă, şi de atunci mânerele, butonul de ştergere şi cel de setări se
 * adăugau într-un nod detaşat: linia se vedea, dar nu puteai nici să o muţi, nici
 * să o ştergi.
 */
export function needsHandleContainer(node: { isConnected?: boolean } | null | undefined): boolean {
  return !node || node.isConnected !== true
}

/** Modulul anunţă ce unealtă e armată ACUM. Nu aruncă niciodată. */
export function emitDrawTool(tool: DrawTool): void {
  try {
    window.dispatchEvent(new CustomEvent(DRAW_TOOL_EVENT, { detail: { tool } }))
  } catch (_) { /* un ecou, nu o funcţie: nu are voie să doboare desenul */ }
}

/** React oglindeşte armarea. Întoarce funcţia de dezabonare. */
export function subscribeDrawTool(cb: (tool: DrawTool) => void): () => void {
  const handler = (e: any) => {
    const t = e && e.detail ? e.detail.tool : null
    cb((t === 'hline' || t === 'tline' || t === 'eraser') ? t : null)
  }
  window.addEventListener(DRAW_TOOL_EVENT, handler)
  return () => window.removeEventListener(DRAW_TOOL_EVENT, handler)
}
