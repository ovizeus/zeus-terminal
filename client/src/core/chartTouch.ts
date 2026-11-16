// [2026-11-16] Gesturile pe telefon, ca la aplicatiile mari de trading.
//
// Operatorul: „daca pun multi indicatori nu mai merge scroll-ul, gesturile se duc
// in charturi". Toate charturile prindeau orice tragere, si sus-jos; cu multe
// panouri nu mai ramanea loc liber de unde sa derulezi pagina.
//
// Acum, pe orice chart:
//   • sus-jos cu un deget  → derulezi PAGINA (`vertTouchDrag: false`);
//   • stanga-dreapta       → muti chartul in timp (`horzTouchDrag: true`);
//   • doua degete          → zoom (neschimbat);
//   • tras pe AXA DE PRET  → muti/scalezi pretul. Biblioteca aplica aceeasi
//     setare si axei, deci pe durata unei atingeri pe axa o aprindem si apoi o
//     stingem la loc.
// Uneltele de desen isi suspenda singure gesturile (ui/drawToolArming.ts).

export const TOUCH_SCROLL = { horzTouchDrag: true, vertTouchDrag: false } as const

/** Pe chartul dat: tragerea verticala e a chartului doar cand degetul porneste pe axa de pret. */
export function installAxisVerticalDrag(chart: any, container: HTMLElement): () => void {
    let on = false
    const axisWidth = (): number => {
        try { return Number(chart.priceScale('right').width()) || 60 } catch { return 60 }
    }
    const start = (e: TouchEvent) => {
        if (!e.touches || e.touches.length !== 1) return
        const r = container.getBoundingClientRect()
        const x = e.touches[0].clientX - r.left
        if (x >= r.width - axisWidth()) {
            on = true
            try { chart.applyOptions({ handleScroll: { vertTouchDrag: true } }) } catch { /* chart scos */ }
        }
    }
    const end = () => {
        if (!on) return
        on = false
        try { chart.applyOptions({ handleScroll: { vertTouchDrag: false } }) } catch { /* chart scos */ }
    }
    container.addEventListener('touchstart', start, { capture: true, passive: true })
    window.addEventListener('touchend', end, { capture: true, passive: true })
    window.addEventListener('touchcancel', end, { capture: true, passive: true })
    return () => {
        container.removeEventListener('touchstart', start, { capture: true } as any)
        window.removeEventListener('touchend', end, { capture: true } as any)
        window.removeEventListener('touchcancel', end, { capture: true } as any)
    }
}
