import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// [KILL-SERVER-OWNED 2026-06-08] When the server owns AT, the client kill
// recomputation must NOT run — it re-fired the overlay after every reset
// (operator hammered RESET 8×). checkKillThreshold() must early-return on
// serverOwnsAT() before touching any DOM/store/trigger path. Client-AT users
// (serverOwnsAT()=false) keep the original behavior.

const serverOwns = vi.fn()
vi.mock('../../engine/lockoutGate', () => ({ serverOwnsAT: () => serverOwns() }))

// getATKillTriggered is the NEXT guard after serverOwnsAT — spy it to prove the
// server-owned guard short-circuits BEFORE any further work.
const killTriggered = vi.fn(() => false)
vi.mock('../../services/stateAccessors', async (orig) => {
  const actual = await (orig as any)()
  return { ...actual, getATKillTriggered: () => killTriggered() }
})

import { checkKillThreshold } from '../autotrade'

describe('checkKillThreshold — server-owned guard', () => {
  beforeEach(() => { serverOwns.mockReset(); killTriggered.mockReset(); killTriggered.mockReturnValue(false) })
  afterEach(() => { vi.restoreAllMocks() })

  it('returns immediately when serverOwnsAT() is true (no further checks run)', () => {
    serverOwns.mockReturnValue(true)
    expect(() => checkKillThreshold()).not.toThrow()
    // Short-circuited BEFORE the getATKillTriggered guard → never consulted.
    expect(killTriggered).not.toHaveBeenCalled()
  })

  it('proceeds past the server-owned guard when serverOwnsAT() is false', () => {
    serverOwns.mockReturnValue(false)
    checkKillThreshold()
    // Falls through to the next guard (getATKillTriggered) → it WAS consulted.
    expect(killTriggered).toHaveBeenCalled()
  })
})
