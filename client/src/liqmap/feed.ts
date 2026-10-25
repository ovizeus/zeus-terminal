// ══════════════════════════════════════════════════════════════════
// Harta de lichidări — de unde vin datele
// ══════════════════════════════════════════════════════════════════
//
// [LIQ-PANEL 2026-10-25] Două surse, cu roluri diferite:
//
//   ISTORIC  — `/api/market/liq-panel`, o singură cerere pentru toate cele trei
//              vederi. Trei cereri separate ar însemna trei „acum" diferite în
//              acelaşi ecran, iar cifre care nu se potrivesc între ele sunt mai
//              rele decât cifre lipsă.
//   LIVE     — evenimentul `zeus:liq`, care există deja în Zeus şi prin care
//              trec toate bursele, inclusiv Gate. Nu deschid o a doua cale.
//
// Tape-ul live NU se adună peste istoric: istoricul îl acoperă deja până la
// `asOf`. Regresia de azi a venit exact din presupunerea inversă.

export type LiqEvent = {
    exchange: string; symbol?: string; side: string; isLong?: boolean
    p: number; vol: number; time: number
}

export type PanelData = {
    map: { buckets: any[]; events: number; coverage: { upPct: number; downPct: number }; since: number; asOf: number } | null
    heat: { cells: any[]; cols: number; events: number; maxUsd: number; tMin: number; tMax: number } | null
    stats: { events: number; totalUsd: number; since: number; exchanges: any[]; days: number } | null
    // Unde CHIAR sunt date. Fara asta, un simbol fara lichidari arata ca o
    // defectiune — iar operatorul a cerut explicit „sa se vada".
    top: { symbol: string; n: number; usd: number }[]
    error?: string
}

export const EMPTY: PanelData = { map: null, heat: null, stats: null, top: [] }

/** O cerere, toate vederile. Niciodată nu aruncă — un panou gol e onest. */
export async function fetchPanel(symbol: string, ref: number, days: number, cols: number): Promise<PanelData> {
    try {
        if (!symbol || !Number.isFinite(ref) || ref <= 0) return EMPTY
        const r = await fetch(`/api/market/liq-panel?symbol=${encodeURIComponent(symbol)}&ref=${ref}&days=${days}&cols=${cols}`)
        if (!r || !r.ok) return EMPTY
        const j = await r.json()
        if (!j || typeof j !== 'object') return EMPTY
        return { map: j.map || null, heat: j.heat || null, stats: j.stats || null, top: Array.isArray(j.top) ? j.top : [], error: j.error }
    } catch (_) {
        return EMPTY
    }
}

/**
 * Normalizează un eveniment live. Întoarce null pentru orice nu se poate
 * desena corect — un blip pe o poziţie greşită e mai rău decât niciun blip.
 */
export function normalizeLive(detail: any): LiqEvent | null {
    try {
        if (!detail || typeof detail !== 'object') return null
        const p = Number(detail.p)
        const vol = Number(detail.vol)
        if (!Number.isFinite(p) || p <= 0) return null
        if (!Number.isFinite(vol) || vol <= 0) return null
        const side = detail.side === 'BUY' ? 'BUY' : detail.side === 'SELL' ? 'SELL' : null
        if (!side) return null
        let time = Number(detail.time)
        if (!Number.isFinite(time) || time <= 0) time = Date.now()
        return {
            exchange: String(detail.exchange || 'unknown'),
            symbol: typeof detail.symbol === 'string' ? detail.symbol : undefined,
            side, isLong: side === 'SELL', p, vol, time,
        }
    } catch (_) {
        return null
    }
}

/**
 * Tape-ul: cele mai noi N evenimente, cel mai nou primul.
 * Mărginit, fiindcă un panou lăsat deschis o noapte nu are voie să crească
 * la nesfârşit — asta e clasa de scurgere pe care Quant a plătit-o deja.
 */
export function pushTape(tape: LiqEvent[], e: LiqEvent | null, max = 60): LiqEvent[] {
    if (!e) return tape
    const next = [e, ...tape]
    return next.length > max ? next.slice(0, max) : next
}
