import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// [2026-10-14] Pins the only thing standing between the operator and
// double-executed trades.
//
// SERVER_AT_DEMO and CLIENT_AT are BOTH true in production right now. The
// server-side mutex in migrationFlags.js does NOT cover that pair — it guards
// SERVER_AT && CLIENT_AT and SERVER_AT_DEMO && SERVER_AT, but not
// SERVER_AT_DEMO && CLIENT_AT. So nothing at the flag layer prevents the
// client engine and the server engine both trading demo for the same user.
//
// What actually prevents it is three stand-down guards in this file, and
// nothing pinned them. Someone tidying up "redundant" early returns would
// reintroduce double execution silently, and the flags would still look sane.
//
// Found while diagnosing why PRIMARY parity rows are never written: the very
// same guards are what make runAutoTradeCheck return before the parity emit.
// Whatever is decided about moving that emit, these guards must survive —
// which is exactly why they are written down here first.

const SRC = readFileSync(
  join(__dirname, '..', 'autotrade.ts'), 'utf8')

function bodyOf(fn: string): string {
  const i = SRC.indexOf(fn)
  expect(i).toBeGreaterThan(-1)
  // far enough to cover the guards without pulling in the next function
  return SRC.slice(i, i + 1800)
}

describe('the client stands down when the server owns execution', () => {
  it('migrationFlags does NOT cover this pair — so the code guards are load-bearing', () => {
    const flags = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'server', 'migrationFlags.js'), 'utf8')
    // If someone ever adds the mutex rule, this test should be revisited, not
    // deleted: the guards would then be defence in depth rather than the only
    // defence. Asserting the current reality keeps the comment above honest.
    expect(flags).not.toMatch(/SERVER_AT_DEMO\s*&&\s*f?\.?CLIENT_AT/)
  })

  it('placeAutoTrade refuses when the server AT is active', () => {
    const body = bodyOf('export function placeAutoTrade(')
    expect(body).toMatch(/if \(w\._serverATEnabled\)[^\n]*return/)
  })

  it('placeAutoTrade refuses when the server holds demo authority', () => {
    const body = bodyOf('export function placeAutoTrade(')
    expect(body).toMatch(/if \(_isServerDemoATActive\(\)\)[^\n]*return/)
  })

  it('both placeAutoTrade guards come BEFORE any order is placed', () => {
    const body = bodyOf('export function placeAutoTrade(')
    const guard = Math.max(
      body.indexOf('_serverATEnabled'),
      body.indexOf('_isServerDemoATActive'),
    )
    // the first thing that can reach an exchange or register a position
    const act = body.search(/placeOrder|registerManual|api\.raw|_execEntry|openPosition/)
    expect(guard).toBeGreaterThan(-1)
    if (act > -1) expect(guard).toBeLessThan(act)
  })

  it('scheduleAutoClose stands down too, so the client does not also manage exits', () => {
    const body = bodyOf('export function scheduleAutoClose(')
    expect(body).toMatch(/if \(w\._serverATEnabled\) return/)
    expect(body).toMatch(/if \(_isServerDemoATActive\(\)\) return/)
  })

  it('runAutoTradeCheck stands down before running the engine', () => {
    const body = bodyOf('export function runAutoTradeCheck(')
    expect(body).toMatch(/_serverATEnabled/)
    expect(body).toMatch(/_isServerDemoATActive/)
  })
})
