// Zeus — Cross-exchange Funding Rate fetcher (Bybit + OKX)
const w = window as any

export async function fetchCrossExchangeFR(): Promise<void> {
  // Bybit
  try {
    const r = await (await fetch('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT')).json()
    if (w.S) w.S.frBybit = +(r?.result?.list?.[0]?.fundingRate || 0)
  } catch (_) { /* silent */ }

  // OKX
  try {
    const r = await (await fetch('https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP')).json()
    if (w.S) w.S.frOkx = +(r?.data?.[0]?.fundingRate || 0)
  } catch (_) { /* silent */ }
}
