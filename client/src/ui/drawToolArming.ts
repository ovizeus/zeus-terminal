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

/**
 * Opţiunile cu care chartul NU se mai mută cât timp desenezi pe el.
 *
 * De ce era nevoie: `marketDataChart.ts` ţine `pressedMouseMove`, `horzTouchDrag`
 * şi `vertTouchDrag` pe `true`, iar drawingTools nu suspenda nimic. Deci când tragi
 * cu o unealtă armată, lightweight-charts panoramează chartul sub tine — pe mouse
 * nu se desenează nimic, iar pe atingere punctul 2 se calculează pe scala DEJA
 * mutată, deci linia aterizează altundeva decât ai tras. Asta e exact ce suspendă
 * TradingView cât timp o unealtă de desen e activă.
 *
 * Zoom-ul rămâne aprins: numai panoramarea prin tragere se bate cu desenul.
 *
 * Calculat din opţiunile CURENTE, nu hardcodat, ca restaurarea să nu reaprindă
 * ceva ce operatorul avea stins şi să nu dubleze valorile din marketDataChart.ts.
 */
export function suspendedChartOptions(cur: any): {
  handleScroll: { mouseWheel: boolean; pressedMouseMove: boolean; horzTouchDrag: boolean; vertTouchDrag: boolean };
  handleScale: { mouseWheel: boolean; pinch: boolean; axisPressedMouseMove: boolean };
} {
  // Implicitele bibliotecii sunt „totul aprins", deci lipsa înseamnă aprins.
  var flag = function (group: any, key: string): boolean {
    if (group === false) return false
    if (group === true || group == null) return true
    return group[key] !== false
  }
  var scroll = cur ? cur.handleScroll : undefined
  var scale = cur ? cur.handleScale : undefined
  return {
    handleScroll: {
      mouseWheel: flag(scroll, 'mouseWheel'),
      pressedMouseMove: false,
      horzTouchDrag: false,
      vertTouchDrag: false,
    },
    handleScale: {
      mouseWheel: flag(scale, 'mouseWheel'),
      pinch: flag(scale, 'pinch'),
      axisPressedMouseMove: false,
    },
  }
}

export interface Pt { x: number; y: number }

/**
 * Tragere sau atingere, cu acelaşi prag ca pe calea de atingere (8px pe suma
 * deplasărilor), ca gestul să se simtă identic pe mouse şi pe ecran.
 *
 * Sub prag TREBUIE să rămână atingere: altfel un simplu clic ar porni fluxul de
 * tragere şi ar pune punctul 2 peste punctul 1, adică exact linia de lungime zero
 * pe care am interzis-o. Fluxul clic-clic nu are voie să fie rupt de desenul prin
 * tragere.
 */
export function dragGesture(from: Pt | null | undefined, to: Pt | null | undefined, minPx = 8):
  'drag' | 'tap' | null {
  if (!from || !to) return null
  var dx = Number(to.x) - Number(from.x)
  var dy = Number(to.y) - Number(from.y)
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null
  return (Math.abs(dx) + Math.abs(dy)) > minPx ? 'drag' : 'tap'
}

/**
 * Dacă o atingere trebuie tratată ca intenţie de desen.
 *
 * Calea de atingere avea un filtru de „tap rapid": peste 300 ms sau peste 10 px,
 * gestul era aruncat COMPLET şi fără nicio reacţie. Filtrul avea sens cât timp
 * chartul se panorama la tragere — trebuia să deosebească o atingere de o
 * panoramare. Dar pe telefon o atingere ATENTĂ pe un nivel de preţ trece des de
 * 300 ms, deci operatorul apăsa şi nu se întâmpla nimic, fără nici măcar un mesaj.
 *
 * De la b307 panoramarea e suspendată cât timp o unealtă e armată, deci distincţia
 * nu mai e necesară: pe un chart care nu se mai mişcă, o apăsare lungă nu poate fi
 * altceva decât intenţia de a desena. Fără unealtă armată, pragurile rămân exact
 * cum erau, fiindcă acolo chartul chiar se panoramează.
 */
export function tapAccepted(armed: DrawTool, elapsedMs: number, movedPx: number,
                            maxMs = 300, maxPx = 10): boolean {
  if (armed) return true
  var ms = Number(elapsedMs), px = Number(movedPx)
  if (!Number.isFinite(ms) || !Number.isFinite(px)) return false
  return ms <= maxMs && px <= maxPx
}

/**
 * De ce nu se poate desena ACUM, spus pe nume.
 *
 * `bridgeReady` vine din `isChartReady()` al punţii, nu din „obiectul e truthy".
 * Diferenţa e cauza care a supravieţuit trei runde: `unregisterChart()` pune pe
 * globale un `_noopStub`, care e un `Proxy` peste o funcţie, deci **truthy**.
 * Verificarea `if (!_series())` din `_activate` trecea, `createPriceLine` întorcea
 * `undefined`, linia se adăuga în listă fără nimic desenat, şi nu apărea nicio
 * eroare. Exact „apăs şi nu face nimic".
 */
export type DrawBlock = 'module-not-loaded' | 'chart-not-ready' | null

export function drawBlockReason(hasActivate: boolean, bridgeReady: boolean): DrawBlock {
  if (!hasActivate) return 'module-not-loaded'
  if (!bridgeReady) return 'chart-not-ready'
  return null
}

/** Mesaje pentru om, nu coduri. Cine le vede trebuie sa stie ce sa FACA. */
export const DRAW_BLOCK_MESSAGE: Record<string, string> = {
  'module-not-loaded': 'Drawing tools did not load — reload the page (pull down to refresh)',
  'chart-not-ready': 'Chart is not ready yet — wait for the candles, then try again',
}
