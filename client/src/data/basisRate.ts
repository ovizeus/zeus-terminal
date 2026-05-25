// Zeus — Basis Rate / Premium Index fetcher
// [T4 Gateway] Reads from server cache proxy — NOT direct Binance
const w = window as any

export async function fetchBasisRate(): Promise<void> {
  try {
    const r = await fetch('/api/market/funding?symbol=BTCUSDT', { credentials: 'include' })
    const j = await r.json()
    if (!w.S || !j.ok || !j.data) return
    const d = j.data
    w.S.markPrice = d.markPrice || 0
    w.S.indexPrice = d.indexPrice || 0
    w.S.basisRate = w.S.indexPrice > 0 ? ((w.S.markPrice - w.S.indexPrice) / w.S.indexPrice * 100) : 0
    const _fr = d.rate
    if (Number.isFinite(_fr)) w.S.fr = _fr
  } catch (_) { /* silent */ }
}
