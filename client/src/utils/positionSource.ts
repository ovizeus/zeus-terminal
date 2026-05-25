export interface SrvPosFlags {
  master: boolean
  testnet: boolean
  real: boolean
}

export interface PriceUpdate {
  pnl: number
  liqPrice: number
  markPrice: number
}

export interface OrphanPosition {
  sym: string
  side: string
  size: number
  entry: number
  exchange: string
}

export function resolveEffectiveFlag(flags: SrvPosFlags | undefined, mode: string): boolean {
  if (!flags || !flags.master) return false
  if (mode === 'demo') return true
  if (mode === 'testnet' || mode === 'live') {
    return flags.testnet
  }
  if (mode === 'real') {
    return flags.real
  }
  return false
}

export function buildPriceUpdateMap(exchangePositions: any[]): Map<string, PriceUpdate> {
  const map = new Map<string, PriceUpdate>()
  if (!Array.isArray(exchangePositions)) return map
  for (const p of exchangePositions) {
    if (!p.symbol || !p.side) continue
    const key = `${p.symbol}/${p.side}`
    map.set(key, {
      pnl: p.unrealizedPnL || 0,
      liqPrice: p.liquidationPrice || 0,
      markPrice: p.markPrice || 0,
    })
  }
  return map
}

export function detectOrphans(
  serverPositions: any[],
  exchangePositions: any[],
  exchange: string = 'binance'
): OrphanPosition[] {
  if (!Array.isArray(exchangePositions) || exchangePositions.length === 0) return []
  const serverKeys = new Set<string>()
  if (Array.isArray(serverPositions)) {
    for (const sp of serverPositions) {
      const sym = sp.symbol || sp.sym || ''
      const side = sp.side || ''
      if (sym && side) serverKeys.add(`${sym}/${side}`)
    }
  }
  const orphans: OrphanPosition[] = []
  for (const ep of exchangePositions) {
    if (!ep.symbol || !ep.side) continue
    const key = `${ep.symbol}/${ep.side}`
    if (!serverKeys.has(key)) {
      orphans.push({
        sym: ep.symbol,
        side: ep.side,
        size: ep.positionAmt || ep.size || 0,
        entry: ep.entryPrice || 0,
        exchange,
      })
    }
  }
  return orphans
}
