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
    // [Radar-Lens-Polish] FUND axis fix — extract lastFundingRate
    // from the same premiumIndex response so S.fr is populated even
    // when ALT_WS_FEEDS=true (which routes price updates via the
    // bookTicker stream and skips the markPrice path that normally
    // writes S.fr at marketDataWS.ts:58). NO new polling — this
    // fetch already runs every 5 s via quantmonitor/index.ts:116.
    // Real Binance funding is in [-0.0075 .. +0.0075] decimal range;
    // 0 is a legitimate value. Always overwrite with fresh value
    // from server response — keeps FUND axis honest regardless of
    // which WS lane is active.
    const _fr = +r.lastFundingRate
    if (Number.isFinite(_fr)) w.S.fr = _fr
  } catch (_) { /* silent */ }
}
