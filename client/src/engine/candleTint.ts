// ═══════════════════════════════════════════════════════════════════════════
// Proprietarul culorii lumanarilor
//
// [CANDLE-TINT 2026-10-19] Gasit la auditul cerut de operator: OPT indicatori
// recoloreaza lumanarile si fiecare scrie necondiționat peste celalalt —
// METIS, APOLLO, MENTOR, KRONOS, MORPHEUS, HARMONIA, TERMINATOR si PULSAR.
// Niciunul nu are vreo garda. Castiga ultimul din dispecer, tacut.
//
// HARMONIA e cazul extrem: coloreaza FIECARE bara intr-un curcubeu, deci le
// masca pe toate celelalte complet. Operatorul ar fi vazut un indicator aprins
// care „nu-si face culorile" — exact plangerea pe care a mai avut-o o data,
// cand TERMINATOR parea ca nu bate culorile.
//
// Regula de acum: culoarea lumanarilor are UN proprietar. Ultimul indicator
// APRINS devine proprietar; ceilalti isi pastreaza liniile si marcajele, dar
// nu mai ating lumanarile. Cand proprietarul e stins, locul se elibereaza.
//
// Nu am ales o ordine de prioritate fixa pentru ca ar fi arbitrara: „ultimul
// aprins castiga" e singura regula pe care operatorul o poate prezice din ce
// a facut chiar el.
// ═══════════════════════════════════════════════════════════════════════════

/** Indicatorii care vor sa coloreze lumanarile. */
export const CANDLE_TINT_IDS = [
    'metis', 'apollo', 'mentor', 'kronos', 'morpheus', 'harmonia', 'terminator', 'pulsar',
] as const

export type CandleTintId = typeof CANDLE_TINT_IDS[number]

export function isCandleTinter(id: string): boolean {
    return (CANDLE_TINT_IDS as readonly string[]).includes(id)
}

/**
 * Are voie `requester` sa coloreze lumanarile acum?
 *
 * - fara proprietar          → da (si devine proprietar)
 * - el insusi e proprietarul → da
 * - alt proprietar, inca aprins → NU
 * - alt proprietar, dar stins   → da (locul s-a eliberat)
 */
export function canTintCandles(
    requester: string,
    currentOwner: string | null | undefined,
    activeInds: Record<string, any> | null | undefined,
): boolean {
    if (!requester) return false
    if (!currentOwner || currentOwner === requester) return true
    const active = activeInds || {}
    return !active[currentOwner]
}

/**
 * Cine detine culoarea dupa ce `id` a fost aprins sau stins.
 * Stingerea elibereaza locul doar daca chiar el il tinea.
 */
export function nextTintOwner(
    currentOwner: string | null | undefined,
    id: string,
    show: boolean,
): string | null {
    if (!isCandleTinter(id)) return currentOwner ?? null
    if (show) return id
    return currentOwner === id ? null : (currentOwner ?? null)
}

/**
 * Ceilalti indicatori de culoare aprinsi in acelasi timp cu proprietarul.
 * Folosit ca sa i se SPUNA operatorului cine a pierdut culoarea, in loc sa
 * ramana o surpriza tacuta.
 */
export function tintRivals(
    owner: string | null | undefined,
    activeInds: Record<string, any> | null | undefined,
): string[] {
    const active = activeInds || {}
    return (CANDLE_TINT_IDS as readonly string[])
        .filter(id => id !== owner && !!active[id])
}
