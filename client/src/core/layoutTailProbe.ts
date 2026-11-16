// [2026-11-16] „Dai jos si se duce in iad pana se face aplicatia neagra."
// Pagina e uneori mult mai lunga decat continutul ei: sub bara de jos a aplicatiei
// (`.bot`) ramane o coada goala, neagra. Din cod nu se vede ce o lungeste (se
// intampla pe telefonul operatorului), deci o MASURAM acolo: o data pe sesiune,
// cand coada e mai mare de jumatate de ecran, trimitem serverului elementele care
// coboara cel mai jos sub continut (prin /api/client-error, deja existent).
// Nu schimba nimic in pagina; doar raporteaza.

/** Capatul continutului real: marginea de jos a barei `.bot` (sau a lui <main>). */
export function contentBottom(): number {
    const y = window.scrollY || 0
    const bot = document.querySelector('.bot') || document.querySelector('main.zr-panels')
    if (bot) {
        const r = bot.getBoundingClientRect()
        if (r.height > 0 || r.bottom > 0) return r.bottom + y
    }
    const se = document.scrollingElement || document.documentElement
    return se.scrollHeight
}

export function describeEl(el: Element): string {
    const h = el as HTMLElement
    const id = h.id ? '#' + h.id : ''
    const cls = typeof h.className === 'string' && h.className.trim() ? '.' + h.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
    return h.tagName.toLowerCase() + id + cls
}

/** Elementele care coboara sub `limit` (coordonate de document), cele mai adanci intai. */
export function tailOffenders(limit: number, max = 10): Array<{ el: string; bottom: number; height: number; pos: string; parent: string }> {
    const y = window.scrollY || 0
    const out: Array<{ el: string; bottom: number; height: number; pos: string; parent: string }> = []
    const all = document.body.getElementsByTagName('*')
    for (let i = 0; i < all.length; i++) {
        const el = all[i]
        const r = el.getBoundingClientRect()
        const bottom = r.bottom + y
        if (bottom <= limit + 4 || (r.width === 0 && r.height === 0)) continue
        const cs = getComputedStyle(el)
        if (cs.position === 'fixed') continue
        out.push({ el: describeEl(el), bottom: Math.round(bottom), height: Math.round(r.height), pos: cs.position, parent: el.parentElement ? describeEl(el.parentElement) : '' })
    }
    return out.sort((a, b) => b.bottom - a.bottom).slice(0, max)
}

let _sent = false
export function reportLayoutTail(): void {
    if (_sent) return
    try {
        const se = document.scrollingElement || document.documentElement
        const end = contentBottom()
        const tail = se.scrollHeight - end
        if (tail < window.innerHeight * 0.5) return
        _sent = true
        const off = tailOffenders(end)
        const body = {
            reason: 'LAYOUT_TAIL ' + Math.round(tail) + 'px under content',
            kind: 'layout',
            url: location.pathname,
            stack: JSON.stringify({ scrollHeight: se.scrollHeight, contentBottom: Math.round(end), innerHeight: window.innerHeight, offenders: off }).slice(0, 7000),
        }
        fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Zeus-Request': '1' }, body: JSON.stringify(body), credentials: 'same-origin', keepalive: true }).catch(() => { /* best-effort */ })
    } catch { /* diagnostic */ }
}
