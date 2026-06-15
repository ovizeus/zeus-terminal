import { describe, it, expect } from 'vitest'
import { resolveSrvPosActive } from '../positionSource'

// [PAPER-LOCKED ROOT FIX 2026-06-15] On boot/refresh, w._srvPosFlags defaults to
// {master:false} until the server AT-state sync loads the real flags. In that
// window liveApiSyncState resolved _srvPosActive=false → ran the LEGACY rebuild
// that DROPS autoTrade → positions rendered "PAPER LOCKED" (env also undefined →
// LOCKED) until the next full sync. Fix: treat "flags not yet loaded" as
// server-authoritative (price-only, non-destructive) so the rebuild never runs
// on uninitialized state.
describe('resolveSrvPosActive (boot-race guard for liveApiSyncState path)', () => {
  const flags = { master: true, testnet: true, real: false }

  it('returns TRUE (server-authoritative / price-only) when flags are NOT loaded yet — the boot-race window', () => {
    expect(resolveSrvPosActive({ master: false } as any, false, undefined)).toBe(true)
    expect(resolveSrvPosActive(undefined, false, 'TESTNET')).toBe(true)
  })

  it('uses the real flag once loaded — TESTNET with testnet flag on → true', () => {
    expect(resolveSrvPosActive(flags, true, 'TESTNET')).toBe(true)
  })

  it('once loaded, env undefined resolves to demo branch → true when master on', () => {
    expect(resolveSrvPosActive(flags, true, undefined)).toBe(true)
  })

  it('once loaded with master OFF → false (genuine legacy path)', () => {
    expect(resolveSrvPosActive({ master: false, testnet: false, real: false }, true, 'TESTNET')).toBe(false)
  })

  it('once loaded, REAL env honors the real flag', () => {
    expect(resolveSrvPosActive(flags, true, 'REAL')).toBe(false) // real:false
    expect(resolveSrvPosActive({ master: true, testnet: false, real: true }, true, 'REAL')).toBe(true)
  })
})
