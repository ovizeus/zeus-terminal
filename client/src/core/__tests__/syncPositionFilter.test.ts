// [SYNC ZOMBIE 2026-11-01] See syncPositionFilter.ts for the measurement that
// produced these cases: 13 positions in the operator's sync snapshot, 4 open in
// the engine, the 9 extras closed server-side and all SHORTs.
import { describe, it, expect } from 'vitest'
import { shouldSerializeDemoPosition } from '../syncPositionFilter'

const srv = (over: any = {}) => ({ id: 1791754240943, sym: 'BTCUSDT', side: 'SHORT', autoTrade: true, _serverSeq: 1791754240943, ...over })
const cli = (over: any = {}) => ({ id: 177, sym: 'BTCUSDT', side: 'LONG', autoTrade: true, _serverSeq: null, ...over })

describe('shouldSerializeDemoPosition', () => {
  it('REGRESSION: a server-registered demo AT position is NOT synced, even with _serverATEnabled false', () => {
    // This is the live case. _serverATEnabled is false for every demo user.
    expect(shouldSerializeDemoPosition(srv(), false)).toBe(false)
    expect(shouldSerializeDemoPosition(srv(), undefined)).toBe(false)
  })

  it('a client-only AT position IS synced — client-AT users must not regress', () => {
    expect(shouldSerializeDemoPosition(cli(), false)).toBe(true)
    expect(shouldSerializeDemoPosition(cli({ _serverSeq: undefined }), false)).toBe(true)
  })

  it('a manual client position is synced', () => {
    expect(shouldSerializeDemoPosition(cli({ autoTrade: false, sourceMode: 'manual' }), false)).toBe(true)
  })

  it('under full server authority no AT row is synced', () => {
    expect(shouldSerializeDemoPosition(cli(), true)).toBe(false)
    // ...but a manual one still is.
    expect(shouldSerializeDemoPosition(cli({ autoTrade: false }), true)).toBe(true)
  })

  it('a closed position is never synced', () => {
    expect(shouldSerializeDemoPosition(cli({ closed: true }), false)).toBe(false)
    expect(shouldSerializeDemoPosition(srv({ closed: true }), false)).toBe(false)
  })

  it('a zero or empty _serverSeq is not a seq — such a row stays client-owned', () => {
    expect(shouldSerializeDemoPosition(cli({ _serverSeq: 0 }), false)).toBe(true)
    expect(shouldSerializeDemoPosition(cli({ _serverSeq: '' }), false)).toBe(true)
  })

  it('garbage in, false out', () => {
    expect(shouldSerializeDemoPosition(null, false)).toBe(false)
    expect(shouldSerializeDemoPosition(undefined, false)).toBe(false)
    expect(shouldSerializeDemoPosition('x' as any, false)).toBe(false)
  })
})
