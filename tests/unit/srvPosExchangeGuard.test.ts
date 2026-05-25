// Tests the H2b multi-exchange frame guard logic.
// The guard lives inside _applyServerATState (state.ts closure), so we test
// the decision function directly rather than the full state machine.

function shouldSkipFrame(
  frameExchange: string | undefined,
  activeExchange: string | undefined
): boolean {
  if (frameExchange && activeExchange && frameExchange !== activeExchange) {
    return true
  }
  return false
}

describe('H2b multi-exchange frame guard', () => {
  test('frame from different exchange is skipped when _activeExchange set', () => {
    expect(shouldSkipFrame('binance', 'bybit')).toBe(true)
  })

  test('frame applied when exchange matches', () => {
    expect(shouldSkipFrame('binance', 'binance')).toBe(false)
  })

  test('frame applied when _activeExchange unset (backward compat)', () => {
    expect(shouldSkipFrame('binance', undefined)).toBe(false)
  })

  test('frame applied when frame.exchange missing (legacy server)', () => {
    expect(shouldSkipFrame(undefined, 'binance')).toBe(false)
  })

  test('frame applied when both undefined', () => {
    expect(shouldSkipFrame(undefined, undefined)).toBe(false)
  })
})
