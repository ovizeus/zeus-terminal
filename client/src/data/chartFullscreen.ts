// ═══════════════════════════════════════════════════════════════════════════
// Chart fullscreen — „ca TradingView", cerut de operator 2026-10-19.
//
// Aici stă DOAR aritmetica și contractul cu API-ul nativ. Partea care atinge
// chart-urile vii trăiește în marketDataFeeds.toggleFS(), ca să rămână un
// singur loc care știe cum se calculează înălțimea: `resolveChartHeight` e
// folosit și de toggleFS și de `_resizeCharts`, pentru că înainte al doilea
// dădea 400px fix și anula fullscreen-ul la orice redimensionare.
// ═══════════════════════════════════════════════════════════════════════════

/** Clasa care pune #csec peste tot ecranul paginii (app.css). */
export const FS_CLASS = 'fsm'

/**
 * Sub atâta nu coborâm chartul principal, oricât de multe panouri de
 * indicatori ar fi aprinse. Mai bine un chart mic și panouri vizibile decât
 * o înălțime negativă dată bibliotecii.
 */
export const FS_MIN_CHART_H = 160

function _finite(n: number): boolean {
    return typeof n === 'number' && Number.isFinite(n)
}

/**
 * Câți pixeli rămân chartului principal după ce tot restul din #csec
 * (toolbar, legendă, fiecare panou de indicator aprins, banda de tranzacții)
 * și-a luat partea. Suma e exact viewportul, deci nimic nu mai iese din
 * ecran ca să fie tăiat de `overflow: hidden`.
 */
export function computeFullscreenChartHeight(
    viewportH: number,
    occupiedH: number,
    minH: number = FS_MIN_CHART_H,
): number {
    if (!_finite(viewportH) || !_finite(occupiedH)) return minH
    return Math.max(minH, Math.floor(viewportH - occupiedH))
}

/**
 * Înălțimea reală a unui element. `getBoundingClientRect` e sursa în browser;
 * stilul inline e rezerva (panourile de indicatori au `height` inline), iar
 * `offsetHeight` închide lista.
 */
function _elementHeight(e: HTMLElement): number {
    try {
        const r = e.getBoundingClientRect()
        if (r && r.height > 0) return r.height
    } catch (_) { /* jsdom sau element detașat */ }
    const inline = parseFloat(e.style?.height || '')
    if (_finite(inline) && inline > 0) return inline
    return _finite(e.offsetHeight) ? e.offsetHeight : 0
}

function _isHidden(e: HTMLElement): boolean {
    if (e.style?.display === 'none') return true
    try {
        const cs = window.getComputedStyle(e)
        if (cs && cs.display === 'none') return true
    } catch (_) { /* fără window în unele medii de test */ }
    return false
}

/**
 * Cât din secțiune este ocupat de altceva decât chartul principal.
 *
 * Citește DOM-ul în loc să țină o listă de id-uri: un indicator adăugat mâine
 * intră automat în socoteală, fără nicio modificare aici. Lista hardcodată era
 * exact felul în care vechiul `toggleFS` ajungea să trateze doar `#cc` și să
 * uite celelalte ~40 de panouri.
 */
export function measureOccupiedHeight(section: HTMLElement, chartHostId = 'mc'): number {
    if (!section) return 0
    let total = 0
    const kids = section.children
    for (let i = 0; i < kids.length; i++) {
        const e = kids[i] as HTMLElement
        if (!e || e.id === chartHostId) continue
        if (_isHidden(e)) continue
        total += _elementHeight(e)
    }
    return total
}

/**
 * Înălțimea CUTIEI chartului, măsurată din DOM.
 *
 * [CHART-FS 2026-10-27] `#mc` e `flex: 1 1 auto; min-height: 0` în fullscreen,
 * deci browserul i-a calculat deja înălțimea corectă, ținând cont de toolbar,
 * legendă și de fiecare panou de indicator aprins. E o sursă mai bună decât
 * orice socoteală a mea, fiindcă nu poate rămâne în urmă față de DOM.
 */
export function measureHostHeight(host: HTMLElement | null): number {
    if (!host) return 0
    try {
        const r = host.getBoundingClientRect()
        if (r && r.height > 0) return Math.floor(r.height)
    } catch (_) { /* jsdom sau element detașat */ }
    return _finite(host.clientHeight) ? Math.floor(host.clientHeight) : 0
}

/**
 * Singura funcție care decide înălțimea chartului principal, în ambele stări.
 *
 * ⚠️ DE CE CUTIA BATE SOCOTEALA, cu bugul care a impus-o:
 *
 * [2026-10-27] Operatorul, cu patru capturi: „când îl măresc pe tot ecranul e
 * ok dar câteodată se strânge sus… pun un indicator şi câteodată se strânge
 * deasupra… daimon de ex îl activez şi se duce în sus, DAR NU LA TOŢI".
 *
 * Măsurat pe capturile lui: pânza rămâne la 340px (telefon) / 400px (PC) —
 * adică exact `getChartH()`, valoarea de NEfullscreen — în timp ce `#mc`
 * rămâne întins pe tot ecranul. De aici golul negru uriaş sub chart.
 *
 * CAUZA, găsită uitându-mă în bundle după un `ResizeObserver` care nu era al
 * meu: **chartul are DOI stăpâni pe aceeaşi proprietate.**
 *
 *   1. `TradingChart.tsx` ţine un ResizeObserver pe containerul lui şi face
 *      `chart.resize(width, height)` din `contentRect` — adică se potriveşte
 *      mereu după cutie. Corect.
 *   2. `applyChartLayout` şi `_resizeCharts` IMPUN o înălţime calculată
 *      separat: 340/400 în afara fullscreen-ului.
 *
 * Când al doilea scrie 340 peste o cutie de 900, chartul se strânge — iar
 * observatorul NU se trezeşte, fiindcă nu cutia s-a schimbat, ci pânza. Rămâne
 * strâns până când ceva schimbă chiar cutia.
 *
 * ⚠️ ŞI DE AICI VINE „DAR NU LA TOŢI": un indicator cu PANOU propriu schimbă
 * înălţimea cutiei ⇒ observatorul se trezeşte ⇒ chartul se repotriveşte singur
 * şi nu se vede nimic. Un indicator care e doar OVERLAY — DAIMON e un sprite
 * `position: absolute` pus în `#mc` — nu schimbă cutia, deci 340 rămâne.
 * Exact asta descria el. Şi apăsarea pe T&S schimbă cutia, de aceea repara.
 *
 * Reparaţia: cei doi stăpâni trebuie să spună ACELAŞI lucru. Înălţimea impusă
 * se ia tot din cutie, deci nu mai există conflict — oricine scrie ultimul,
 * scrie aceeaşi valoare.
 *
 * Deci reparaţia e pe CLASĂ, nu pe declanşator: în fullscreen înălţimea vine
 * din cutia MĂSURATĂ. Oricine ar strica-o, următoarea aşezare o pune la loc,
 * fiindcă adevărul e în DOM, nu într-o socoteală paralelă.
 *
 * Socoteala veche rămâne ca rezervă: dacă nu există cutie (teste, boot
 * timpuriu) sau dacă ea raportează ceva absurd de mic, nu o credem.
 */
export function resolveChartHeight(opts: {
    fullscreen: boolean
    viewportH: number
    occupiedH: number
    normalH: number
    hostH?: number | null
}): number {
    if (!opts.fullscreen) return opts.normalH
    const host = Number(opts.hostH)
    if (_finite(host) && host >= FS_MIN_CHART_H) return Math.floor(host)
    return computeFullscreenChartHeight(opts.viewportH, opts.occupiedH)
}

/** Suntem chiar în fullscreen nativ (nu doar cu clasa CSS pusă)? */
export function isNativeFullscreen(doc: Document = document): boolean {
    const d = doc as any
    return !!(d.fullscreenElement || d.webkitFullscreenElement || d.mozFullScreenElement || d.msFullscreenElement)
}

/**
 * Cere fullscreen nativ — asta e diferența dintre „panou mare" și „altă
 * aplicație": dispare și bara de browser.
 *
 * Întoarce `false` dacă API-ul lipsește sau browserul refuză. NU arunca:
 * clasa CSS acoperă oricum tot viewportul paginii, deci un refuz înseamnă
 * fullscreen mai puțin complet, nu buton rupt.
 */
export async function enterNativeFullscreen(el: HTMLElement): Promise<boolean> {
    if (!el) return false
    const anyEl = el as any
    const req = anyEl.requestFullscreen || anyEl.webkitRequestFullscreen
        || anyEl.mozRequestFullScreen || anyEl.msRequestFullscreen
    if (typeof req !== 'function') return false
    try {
        await req.call(el)
        return true
    } catch (_) {
        return false
    }
}

/** Iese din fullscreen nativ, dar numai dacă suntem în el. */
export async function exitNativeFullscreen(doc: Document = document): Promise<boolean> {
    if (!isNativeFullscreen(doc)) return false
    const d = doc as any
    const exit = d.exitFullscreen || d.webkitExitFullscreen || d.mozCancelFullScreen || d.msExitFullscreen
    if (typeof exit !== 'function') return false
    try {
        await exit.call(doc)
        return true
    } catch (_) {
        return false
    }
}
