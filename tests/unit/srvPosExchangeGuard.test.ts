import { shouldSkipFrameForExchange } from '../../client/src/utils/exchangeGuard'

describe('H2b multi-exchange frame guard (real module)', () => {
  test('skip: frame from different exchange when _activeExchange set', () => {
    expect(shouldSkipFrameForExchange('binance', 'bybit')).toBe(true)
  })

  test('apply: exchange matches', () => {
    expect(shouldSkipFrameForExchange('binance', 'binance')).toBe(false)
  })

  test('apply: _activeExchange unset (backward compat)', () => {
    expect(shouldSkipFrameForExchange('binance', undefined)).toBe(false)
  })

  test('apply: frame.exchange missing (legacy server)', () => {
    expect(shouldSkipFrameForExchange(undefined, 'binance')).toBe(false)
  })

  test('apply: both undefined', () => {
    expect(shouldSkipFrameForExchange(undefined, undefined)).toBe(false)
  })
})
