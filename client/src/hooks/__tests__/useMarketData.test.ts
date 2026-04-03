import { describe, it, expect } from 'vitest'
import { useMarketStore } from '../../stores/marketStore'

describe('market data integration', () => {
  it('setPrice updates market store correctly', () => {
    useMarketStore.setState(useMarketStore.getInitialState())
    useMarketStore.getState().setPrice(43500)
    expect(useMarketStore.getState().market.price).toBe(43500)

    useMarketStore.getState().setPrice(43600)
    expect(useMarketStore.getState().market.price).toBe(43600)
    expect(useMarketStore.getState().market.prevPrice).toBe(43500)
  })

  it('patch updates symbol and triggers state', () => {
    useMarketStore.setState(useMarketStore.getInitialState())
    useMarketStore.getState().patch({ symbol: 'ETHUSDT', chartTf: '15m' })
    expect(useMarketStore.getState().market.symbol).toBe('ETHUSDT')
    expect(useMarketStore.getState().market.chartTf).toBe('15m')
  })
})
