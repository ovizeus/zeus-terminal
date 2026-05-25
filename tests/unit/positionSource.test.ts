import {
  resolveEffectiveFlag,
  buildPriceUpdateMap,
  detectOrphans,
} from '../../client/src/utils/positionSource'

describe('resolveEffectiveFlag', () => {
  test('returns false when flags undefined', () => {
    expect(resolveEffectiveFlag(undefined, 'demo')).toBe(false)
  })

  test('returns false when master=false regardless of mode', () => {
    expect(resolveEffectiveFlag({ master: false, testnet: true, real: true }, 'demo')).toBe(false)
    expect(resolveEffectiveFlag({ master: false, testnet: true, real: true }, 'testnet')).toBe(false)
    expect(resolveEffectiveFlag({ master: false, testnet: true, real: true }, 'real')).toBe(false)
  })

  test('demo mode: true when master=true (no sub-flag needed)', () => {
    expect(resolveEffectiveFlag({ master: true, testnet: false, real: false }, 'demo')).toBe(true)
  })

  test('testnet/live mode: requires master + testnet sub-flag', () => {
    expect(resolveEffectiveFlag({ master: true, testnet: false, real: false }, 'testnet')).toBe(false)
    expect(resolveEffectiveFlag({ master: true, testnet: true, real: false }, 'testnet')).toBe(true)
    expect(resolveEffectiveFlag({ master: true, testnet: true, real: false }, 'live')).toBe(true)
  })

  test('real mode: requires master + real sub-flag', () => {
    expect(resolveEffectiveFlag({ master: true, testnet: true, real: false }, 'real')).toBe(false)
    expect(resolveEffectiveFlag({ master: true, testnet: false, real: true }, 'real')).toBe(true)
  })

  test('unknown mode: returns false (defensive)', () => {
    expect(resolveEffectiveFlag({ master: true, testnet: true, real: true }, 'unknown')).toBe(false)
  })
})

describe('buildPriceUpdateMap', () => {
  test('builds map keyed by symbol/side', () => {
    const positions = [
      { symbol: 'BTCUSDT', side: 'LONG', unrealizedPnL: 150, liquidationPrice: 58000, markPrice: 69500 },
      { symbol: 'ETHUSDT', side: 'SHORT', unrealizedPnL: -20, liquidationPrice: 4200, markPrice: 3800 },
    ]
    const map = buildPriceUpdateMap(positions)
    expect(map.size).toBe(2)
    expect(map.get('BTCUSDT/LONG')).toEqual({ pnl: 150, liqPrice: 58000, markPrice: 69500 })
    expect(map.get('ETHUSDT/SHORT')).toEqual({ pnl: -20, liqPrice: 4200, markPrice: 3800 })
  })

  test('skips entries with missing symbol or side', () => {
    const positions = [
      { symbol: 'BTCUSDT', unrealizedPnL: 100 },
      { side: 'LONG', unrealizedPnL: 50 },
      { symbol: 'ETHUSDT', side: 'LONG', unrealizedPnL: 30, liquidationPrice: 0, markPrice: 0 },
    ]
    const map = buildPriceUpdateMap(positions)
    expect(map.size).toBe(1)
    expect(map.has('ETHUSDT/LONG')).toBe(true)
  })

  test('returns empty map for non-array input', () => {
    expect(buildPriceUpdateMap(null as any).size).toBe(0)
    expect(buildPriceUpdateMap(undefined as any).size).toBe(0)
  })

  test('defaults missing fields to 0', () => {
    const positions = [{ symbol: 'BTCUSDT', side: 'LONG' }]
    const map = buildPriceUpdateMap(positions)
    expect(map.get('BTCUSDT/LONG')).toEqual({ pnl: 0, liqPrice: 0, markPrice: 0 })
  })
})

describe('detectOrphans', () => {
  test('detects exchange-only positions as orphans', () => {
    const server = [{ symbol: 'BTCUSDT', side: 'LONG' }]
    const exchange = [
      { symbol: 'BTCUSDT', side: 'LONG', positionAmt: 0.1, entryPrice: 68000 },
      { symbol: 'ETHUSDT', side: 'SHORT', positionAmt: 5, entryPrice: 3900 },
    ]
    const orphans = detectOrphans(server, exchange)
    expect(orphans.length).toBe(1)
    expect(orphans[0].sym).toBe('ETHUSDT')
    expect(orphans[0].side).toBe('SHORT')
    expect(orphans[0].size).toBe(5)
    expect(orphans[0].exchange).toBe('binance')
  })

  test('empty server + populated exchange = all orphans', () => {
    const exchange = [
      { symbol: 'BTCUSDT', side: 'LONG', positionAmt: 0.5, entryPrice: 70000 },
      { symbol: 'ETHUSDT', side: 'LONG', positionAmt: 10, entryPrice: 3500 },
    ]
    const orphans = detectOrphans([], exchange)
    expect(orphans.length).toBe(2)
  })

  test('server has all exchange positions = no orphans', () => {
    const server = [
      { symbol: 'BTCUSDT', side: 'LONG' },
      { symbol: 'ETHUSDT', side: 'SHORT' },
    ]
    const exchange = [
      { symbol: 'BTCUSDT', side: 'LONG', positionAmt: 1 },
      { symbol: 'ETHUSDT', side: 'SHORT', positionAmt: 2 },
    ]
    expect(detectOrphans(server, exchange).length).toBe(0)
  })

  test('server has more than exchange = no orphans (reverse is fine)', () => {
    const server = [
      { symbol: 'BTCUSDT', side: 'LONG' },
      { symbol: 'ETHUSDT', side: 'SHORT' },
      { symbol: 'SOLUSDT', side: 'LONG' },
    ]
    const exchange = [{ symbol: 'BTCUSDT', side: 'LONG', positionAmt: 1 }]
    expect(detectOrphans(server, exchange).length).toBe(0)
  })

  test('empty exchange = no orphans', () => {
    expect(detectOrphans([{ symbol: 'BTC', side: 'LONG' }], []).length).toBe(0)
  })

  test('uses sym field fallback for server positions', () => {
    const server = [{ sym: 'BTCUSDT', side: 'LONG' }]
    const exchange = [{ symbol: 'BTCUSDT', side: 'LONG', positionAmt: 1 }]
    expect(detectOrphans(server, exchange).length).toBe(0)
  })

  test('custom exchange parameter', () => {
    const orphans = detectOrphans([], [{ symbol: 'BTCUSDT', side: 'LONG', positionAmt: 1, entryPrice: 70000 }], 'bybit')
    expect(orphans[0].exchange).toBe('bybit')
  })
})
