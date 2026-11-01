// [2026-11-01] Textul casetei THE VOICE.
//
// Caseta inlocuieste blocul care statea pe pagina principala intr-o cutie de
// inaltime fixa, hranita cu un gand la ~30 de secunde. Nicio asezare nu impaca
// o cutie mare cu continut rar: degradeul ascundea golul, taierea il muta, iar
// intinderea l-a despicat in doua. Acum zona nu mai are inaltime fixa — e o
// caseta cat continutul ei, iar lista traieste pe pagina ei.
//
// Sirurile sunt in engleza (R-P-10); doar comentariile si cartea sunt romana.

const MAX_PREVIEW = 72

/** Cate ganduri sunt — scris pentru om, nu pentru masina. */
export function voiceCardCount(count: unknown): string {
    // `Number(null) === 0` trece de isFinite, deci tipul inainte de valoare.
    const n = typeof count === 'number' && Number.isFinite(count) ? Math.floor(count) : 0
    if (n <= 0) return 'no thoughts yet'
    if (n === 1) return '1 thought'
    return `${n} thoughts`
}

/** Ultimul gand, scurtat ca sa incapa pe un rand. Gol daca nu avem niciunul. */
export function voiceCardPreview(text: unknown): string {
    if (typeof text !== 'string') return ''
    const t = text.replace(/\s+/g, ' ').trim()
    if (t.length === 0) return ''
    if (t.length <= MAX_PREVIEW) return t
    // Taie pe cuvant, nu la mijlocul unuia.
    const cut = t.slice(0, MAX_PREVIEW)
    const sp = cut.lastIndexOf(' ')
    return (sp > MAX_PREVIEW * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + '…'
}

/** Eticheta pentru cititoarele de ecran — caseta nu e doar o imagine. */
export function voiceCardAriaLabel(count: unknown): string {
    return `Open THE VOICE — ${voiceCardCount(count)}`
}
