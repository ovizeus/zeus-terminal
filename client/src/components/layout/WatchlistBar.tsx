import { useMarketStore } from '../../stores'

const WATCHLIST_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'ZECUSDT',
] as const

function shortName(sym: string): string {
  return sym.replace('USDT', '')
}

export default function WatchlistBar() {
  const symbol = useMarketStore((s) => s.market.symbol)
  const patch = useMarketStore((s) => s.patch)

  return (
    <div className="wl-bar" id="wlBar">
      {WATCHLIST_SYMBOLS.map((sym) => (
        <div
          key={sym}
          className={sym === symbol ? 'wl-item act' : 'wl-item'}
          onClick={() => patch({ symbol: sym })}
        >
          <div className="wl-sym">{shortName(sym)}</div>
          <div className="wl-price">&mdash;</div>
          <div className="wl-chg">&mdash;</div>
        </div>
      ))}
    </div>
  )
}
