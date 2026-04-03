import { describe, it, expect, beforeEach } from 'vitest'
import { useMarketStore } from '../marketStore'

describe('marketStore', () => {
  beforeEach(() => {
    useMarketStore.setState(useMarketStore.getInitialState())
  })

  it('has correct defaults', () => {
    const { market } = useMarketStore.getState()
    expect(market.price).toBe(0)
    expect(market.symbol).toBe('BTCUSDT')
    expect(market.chartTf).toBe('5m')
    expect(market.bnbOk).toBe(false)
    expect(market.buckets).toHaveLength(20)
  })

  it('setPrice updates price and prevPrice', () => {
    useMarketStore.getState().setPrice(43500)
    expect(useMarketStore.getState().market.price).toBe(43500)
    expect(useMarketStore.getState().market.prevPrice).toBe(0)

    useMarketStore.getState().setPrice(43600)
    expect(useMarketStore.getState().market.price).toBe(43600)
    expect(useMarketStore.getState().market.prevPrice).toBe(43500)
  })

  it('patch merges partial state', () => {
    useMarketStore.getState().patch({ symbol: 'ETHUSDT', bnbOk: true })
    const { market } = useMarketStore.getState()
    expect(market.symbol).toBe('ETHUSDT')
    expect(market.bnbOk).toBe(true)
    expect(market.price).toBe(0) // unchanged
  })
})
