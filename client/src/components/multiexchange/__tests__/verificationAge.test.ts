import { describe, it, expect } from 'vitest'
import { verificationAge, staleNotice, STALE_AFTER_DAYS } from '../verificationAge'

const NOW = Date.parse('2026-11-07T03:00:00Z')
const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString()

describe('how old the last successful check is', () => {
  it('reads today, yesterday and a count', () => {
    expect(verificationAge(daysAgo(0), NOW).label).toBe('today')
    expect(verificationAge(daysAgo(1), NOW).label).toBe('yesterday')
    expect(verificationAge(daysAgo(9), NOW).label).toBe('9 days ago')
  })

  it('a daily check that succeeded today or yesterday is fine', () => {
    expect(verificationAge(daysAgo(0), NOW).stale).toBe(false)
    expect(verificationAge(daysAgo(1), NOW).stale).toBe(false)
  })

  it('goes stale once a run has been missed', () => {
    expect(verificationAge(daysAgo(STALE_AFTER_DAYS), NOW).stale).toBe(true)
  })

  it('catches the real case: four months of silent failure', () => {
    // the account on the live box: status said "verified", the date was July
    const a = verificationAge('2026-07-13 15:33:00', NOW)
    expect(a.stale).toBe(true)
    expect(a.days).toBeGreaterThan(100)
    expect(staleNotice(a)).toMatch(/may have expired/)
  })

  it('says nothing alarming when it is current', () => {
    expect(staleNotice(verificationAge(daysAgo(0), NOW))).toBeNull()
  })
})

describe('what it refuses to invent', () => {
  it('never verified is not stale — a new key has no date yet', () => {
    for (const v of [null, undefined, '']) {
      const a = verificationAge(v, NOW)
      expect(a.label).toBe('never')
      expect(a.stale).toBe(false)
      expect(a.days).toBeNull()
    }
  })

  it('an unreadable date says unknown rather than guessing', () => {
    const a = verificationAge('not a date', NOW)
    expect(a.label).toBe('unknown')
    expect(a.stale).toBe(false)
  })

  it('a future date is a clock problem, not an expired key', () => {
    const a = verificationAge(daysAgo(-5), NOW)
    expect(a.stale).toBe(false)
    expect(a.label).toBe('just now')
  })

  it('accepts a numeric timestamp as well as a string', () => {
    expect(verificationAge(NOW - 3 * 86400000, NOW).days).toBe(3)
  })
})
