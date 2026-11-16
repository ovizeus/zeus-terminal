// [2026-11-15] Datele de 24h ale Quantitative Monitor.
//
// Panoul citea HIGH / LOW / VOL / schimbarea din `S.high24h`, `S.low24h`,
// `S.vol24h`, `S.chg24hPct` — campuri pe care NU le scria nimeni in toata
// aplicatia, deci aratau mereu 0 (raportat de operator cu poza). Aici se iau din
// /api/market/ticker24hr (proxy-ul serverului, cache 30 s). Cand moneda din chart
// e in lista de urmarire, cererea e IDENTICA cu a listei, deci loveste acelasi
// cache pe server si nu adauga trafic spre bursa.
const w = window as any

export type Ticker24 = { high: number; low: number; vol: number; quoteVol: number; chgPct: number; last: number }

/** Functie pura: un rand din raspunsul Binance /ticker/24hr → valorile panoului. */
export function parseTicker24(t: any): Ticker24 | null {
    if (!t || typeof t !== 'object') return null
    const n = (v: any) => { const x = parseFloat(v); return Number.isFinite(x) ? x : NaN }
    const high = n(t.highPrice), low = n(t.lowPrice), last = n(t.lastPrice)
    if (!(high > 0) || !(low > 0) || high < low) return null
    const vol = n(t.volume), quoteVol = n(t.quoteVolume), chgPct = n(t.priceChangePercent)
    return {
        high, low,
        vol: vol >= 0 ? vol : 0,
        quoteVol: quoteVol >= 0 ? quoteVol : 0,
        chgPct: Number.isFinite(chgPct) ? chgPct : 0,
        last: last > 0 ? last : 0,
    }
}

/** Cererea: lista de urmarire daca o contine (cache comun), altfel doar moneda. */
export function tickerQuery(sym: string, watchlist: unknown): string[] {
    const s = String(sym || '').toUpperCase()
    const wl = Array.isArray(watchlist) ? watchlist.map((x) => String(x).toUpperCase()) : []
    return s && wl.includes(s) ? wl : (s ? [s] : [])
}

export async function fetchTicker24(): Promise<void> {
    try {
        const S = w.S; if (!S) return
        const sym = String(S.symbol || 'BTCUSDT').toUpperCase()
        const q = tickerQuery(sym, w.WL_SYMS)
        if (!q.length) return
        const r = await fetch('/api/market/ticker24hr?symbols=' + encodeURIComponent(JSON.stringify(q)), { signal: AbortSignal.timeout(8000) })
        if (!r.ok) return
        const arr = await r.json()
        if (!Array.isArray(arr)) return
        // Moneda s-a schimbat cat a durat cererea: raspunsul nu mai e al ei.
        if (String(S.symbol || 'BTCUSDT').toUpperCase() !== sym) return
        const t = parseTicker24(arr.find((x: any) => x && String(x.symbol).toUpperCase() === sym))
        if (!t) return
        S.high24h = t.high; S.low24h = t.low; S.vol24h = t.vol; S.quoteVol24h = t.quoteVol
        S.chg24hPct = t.chgPct; S.last24h = t.last; S.ticker24Sym = sym
    } catch (_) { /* fara retea: la urmatorul ciclu */ }
}
