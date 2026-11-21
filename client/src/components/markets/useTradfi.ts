import { useEffect, useState } from 'react'
import { subscribeTradfi, getTradfi, type TradfiSnap } from '../../markets/tradfi'

/** Datele MARKETS, impartite intre caseta si panou. `fast` = panoul e deschis. */
export function useTradfi(fast = false): { snap: TradfiSnap | null; err: string | null } {
  const [st, setSt] = useState(getTradfi)
  useEffect(() => subscribeTradfi(() => setSt({ ...getTradfi() }), fast), [fast])
  return st
}
