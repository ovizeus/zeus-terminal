// Zeus — Basis Rate / Premium Index fetcher
// [T4 Gateway] Reads from server cache proxy — NOT direct Binance
//
// [2026-11-14] Cerea mereu BTCUSDT, indiferent de moneda din chart, si rula
// doar cat era deschis Quant Monitor. Rata de finantare de pe radar („FUND")
// era deci fie zero (vezi marketDataWS), fie a BTC-ului pe alta moneda. Acum
// cere moneda din chart si arunca raspunsul daca moneda s-a schimbat intre
// timp — altfel rata unei monede ar ajunge pe chartul alteia.
const w = window as any

/** Functie pura: ce se scrie in stare dintr-un raspuns al serverului. */
export function basisFromResponse(d: any): { markPrice: number; indexPrice: number; basisRate: number; fr: number | null; frCd: number | null } | null {
  if (!d || typeof d !== 'object') return null
  const markPrice = Number(d.markPrice) > 0 ? Number(d.markPrice) : 0
  const indexPrice = Number(d.indexPrice) > 0 ? Number(d.indexPrice) : 0
  const rate = d.rate === null || d.rate === undefined ? NaN : Number(d.rate)
  const next = Number(d.nextFundingTime)
  return {
    markPrice, indexPrice,
    basisRate: indexPrice > 0 && markPrice > 0 ? ((markPrice - indexPrice) / indexPrice) * 100 : 0,
    fr: Number.isFinite(rate) ? rate : null,
    frCd: Number.isFinite(next) && next > 0 ? next : null,
  }
}

export async function fetchBasisRate(): Promise<void> {
  try {
    const sym = String((w.S && w.S.symbol) || 'BTCUSDT').toUpperCase()
    const r = await fetch('/api/market/funding?symbol=' + encodeURIComponent(sym), { credentials: 'include' })
    const j = await r.json()
    if (!w.S || !j.ok || !j.data) return
    // Moneda s-a schimbat cat a durat cererea: raspunsul nu mai e al ei.
    if (String(w.S.symbol || 'BTCUSDT').toUpperCase() !== sym) return
    const b = basisFromResponse(j.data)
    if (!b) return
    w.S.markPrice = b.markPrice
    w.S.indexPrice = b.indexPrice
    w.S.basisRate = b.basisRate
    if (b.fr !== null) w.S.fr = b.fr
    if (b.frCd !== null) w.S.frCd = b.frCd
    // [QM-FIX] Fallback price from funding markPrice when WS price is dead
    if (b.markPrice > 0 && (!w.S.price || w.S.price <= 0)) {
      w.S.price = b.markPrice
    }
  } catch (_) { /* silent */ }
}
