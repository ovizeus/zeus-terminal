// [2026-11-01] Cat din lista de ganduri se vede INTREG.
//
// De ce nu merge din CSS: inaltimea zonei e data de grila paginii, iar un gand
// are inaltimea lui, dupa cate randuri de text are. Cele doua nu se potrivesc
// niciodata exact, deci la capatul de jos ramane mereu o felie din urmatorul
// gand. Pe telefonul operatorului felia aia pica fix dupa randul de ora, deci
// se vedea o eticheta goala — "nu imi place ce e acolo".
//
// Degradeul pus la b355 a facut-o mai blanda, nu a facut-o sa dispara. Singurul
// fel in care dispare e sa stim unde se termina fiecare gand, si asta se stie
// doar dupa ce browserul le-a asezat. Functia asta e partea care se poate
// proba fara browser: date inaltimile masurate, de la ce gand incolo nu mai
// incape nimic intreg.

export interface Measured {
    /** offsetTop fata de containerul care deruleaza */
    top: number
    /** offsetHeight */
    height: number
}

/**
 * Indicele primului gand care NU incape intreg, sau -1 daca incap toate.
 *
 * Pastreaza intotdeauna cel putin unul: daca nici primul nu incape — zona e
 * mai scunda decat un singur gand — e mai bine sa se vada taiat decat sa ramana
 * un panou gol, fiindca gol inseamna "nu merge", iar taiat inseamna "deruleaza".
 */
export function firstClippedIndex(items: Measured[], viewportHeight: number): number {
    if (!Array.isArray(items) || items.length === 0) return -1
    // `Number(null) === 0` trece de isFinite, deci tipul se verifica inaintea
    // valorii: o inaltime care nu e numar inseamna "nu am masurat inca", si
    // atunci nu taiem nimic, nu taiem tot.
    if (typeof viewportHeight !== 'number' || !Number.isFinite(viewportHeight) || viewportHeight <= 0) return -1
    for (let i = 0; i < items.length; i++) {
        const it = items[i]
        if (!it || typeof it.top !== 'number' || typeof it.height !== 'number') return -1
        if (!Number.isFinite(it.top) || !Number.isFinite(it.height)) return -1
        if (it.top + it.height > viewportHeight + 0.5) {   // 0.5 = rotunjiri subpixel
            return i === 0 ? -1 : i                         // niciodata panou gol
        }
    }
    return -1
}

/**
 * Ce ramane dupa taiere trebuie sa UMPLE zona, altfel gaura de jos arata la fel
 * de rau ca felia pe care tocmai am scos-o — asta a si pathit la b357: un gand
 * si ~115px de negru sub el.
 *
 * Intoarce true cand continutul vizibil incape sigur, deci poate fi distribuit
 * pe toata inaltimea. NU se distribuie cand operatorul deruleaza: acolo
 * continutul depaseste zona, iar `justify-content` pe un flex care da pe afara
 * impinge primele randuri dincolo de marginea de sus, unde nu se mai poate
 * ajunge cu degetul.
 */
export function shouldSpread(items: Measured[], viewportHeight: number, scrollTop: number): boolean {
    if (typeof scrollTop === 'number' && Number.isFinite(scrollTop) && scrollTop > 1) return false
    if (!Array.isArray(items) || items.length === 0) return false
    if (typeof viewportHeight !== 'number' || !Number.isFinite(viewportHeight) || viewportHeight <= 0) return false
    const cut = firstClippedIndex(items, viewportHeight)
    if (cut > 0) return true                      // am taiat → ce a ramas incape
    if (cut === 0) return false                   // nu se intampla (guarda din firstClippedIndex)
    const last = items[items.length - 1]
    if (!last || !Number.isFinite(last.top) || !Number.isFinite(last.height)) return false
    return last.top + last.height <= viewportHeight + 0.5   // incape tot fara taiere
}
