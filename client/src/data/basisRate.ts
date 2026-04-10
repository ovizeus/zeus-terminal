// Zeus — Basis Rate / Premium Index fetcher
// Ported from ZeuS Quantitative Monitor HTML
const w = window as any

export async function fetchBasisRate(): Promise<void> {
  try {
    const r = await (await fetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT')).json()
    if (!w.S) return
    w.S.markPrice = +r.markPrice || 0
    w.S.indexPrice = +r.indexPrice || 0
    w.S.basisRate = w.S.indexPrice > 0 ? ((w.S.markPrice - w.S.indexPrice) / w.S.indexPrice * 100) : 0
  } catch (_) { /* silent */ }
}
