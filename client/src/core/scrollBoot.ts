// [2026-11-16] Aplicatia porneste MEREU de sus.
//
// Operatorul, cu poze: „la intrare e negru jos, pana dau scroll sus de tot".
// La intrare pagina nu era sus, ci la jumatatea ei (pe chart): browserul
// RESTAURA singur pozitia de scroll de la vizita anterioara — si, din 15 nov,
// actualizarea automata reincarca aplicatia singura. Restaurarea se face
// inainte ca restul paginii sa fie construit si desenat, deci zona de sub
// ce era gata ramanea neagra; urcand sus, pagina se redesena si negrul pleca.
//
// Acum: restaurarea automata e oprita, iar la pornire (si la revenirea dintr-o
// pagina tinuta in cache de browser) aplicatia se duce sus.
export function bootScrollTop(win: Window = window): void {
    try { if ('scrollRestoration' in win.history) win.history.scrollRestoration = 'manual' } catch { /* browser vechi */ }
    const top = () => { try { win.scrollTo(0, 0) } catch { /* fara scroll */ } }
    top()
    try { win.addEventListener('load', top, { once: true }) } catch { /* */ }
    try { win.addEventListener('pageshow', (e: any) => { if (e && e.persisted) top() }) } catch { /* */ }
}
