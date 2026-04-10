// Zeus — BTC Dominance + Stablecoin inflows fetcher (CoinGecko)
const w = window as any

export async function fetchBTCDominance(): Promise<void> {
  try {
    const r = await (await fetch('https://api.coingecko.com/api/v3/global')).json()
    if (!w.S) return
    w.S.btcDomPrev = w.S.btcDominance || 0
    w.S.btcDominance = +(r?.data?.market_cap_percentage?.btc || 0)
  } catch (_) { /* silent */ }
}

export async function fetchStablecoins(): Promise<void> {
  try {
    const r = await (await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=tether,usd-coin&order=market_cap_desc&per_page=2&page=1')).json()
    if (!w.S) return
    let total = 0, chg = 0
    r.forEach((coin: any) => { total += coin.market_cap || 0; chg += coin.market_cap_change_percentage_24h || 0 })
    w.S.stableMarketCap = total
    w.S.stableChange24h = chg / Math.max(1, r.length)
  } catch (_) { /* silent */ }
}
