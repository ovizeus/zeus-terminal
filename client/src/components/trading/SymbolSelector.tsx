import { useState, useEffect } from 'react'
import { useMarketStore } from '../../stores'
import { api } from '../../services/api'

interface SymbolInfo {
  symbol: string
  exchange: string
}

export function SymbolSelector() {
  const currentSymbol = useMarketStore((s) => s.market.symbol)
  const patch = useMarketStore((s) => s.patch)
  const [symbols, setSymbols] = useState<SymbolInfo[]>([])

  useEffect(() => {
    api.post<SymbolInfo[]>('/api/sd/symbols').then((res) => {
      if (res.ok && res.data) {
        setSymbols(res.data)
      }
    })
  }, [])

  // Fallback if server doesn't return symbols yet
  const defaultSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT']
  const symbolList = symbols.length > 0
    ? symbols.map((s) => s.symbol)
    : defaultSymbols

  return (
    <select
      className="zr-symbol-select"
      value={currentSymbol}
      onChange={(e) => patch({ symbol: e.target.value })}
    >
      {symbolList.map((sym) => (
        <option key={sym} value={sym}>{sym}</option>
      ))}
    </select>
  )
}
