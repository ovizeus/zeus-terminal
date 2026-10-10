import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// [2026-10-10] localStorage is user-scoped: state.ts rewrites a key to
// `key:uid` so two accounts on the same browser do not read each other's
// settings. The list of keys it does that for is hand-maintained, and 16 keys
// the app actually writes were never added — including zeus_chart_tf and
// zeus_ind_favorites, which is the chart timeframe and the starred
// indicators. On a shared device those cross over, and the scoping looks
// complete while quietly not being.

const SRC = path.join(__dirname, '..', '..')

function scoped(): { keys: Set<string>; prefixes: string[] } {
  const st = fs.readFileSync(path.join(SRC, 'core', 'state.ts'), 'utf8')
  const block = st.slice(st.indexOf('_USER_KEYS'), st.indexOf('function _isUserKey'))
  const keys = new Set([...block.matchAll(/'([a-zA-Z0-9_.:-]+)'\s*:\s*(?:1|true)/g)].map((m) => m[1]))
  const pre = [...block.matchAll(/_USER_PREFIXES\s*=\s*\[([^\]]*)\]/g)].map((m) => m[1]).join(',')
  return { keys, prefixes: [...pre.matchAll(/'([^']+)'/g)].map((m) => m[1]) }
}

function usedKeys(): Set<string> {
  const out = new Set<string>()
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.(ts|tsx)$/.test(e.name) || /__tests__|\.test\./.test(p)) continue
      const s = fs.readFileSync(p, 'utf8')
      for (const m of s.matchAll(/localStorage\.(?:get|set|remove)Item\(\s*'([^']+)'/g)) out.add(m[1])
    }
  }
  walk(SRC)
  return out
}

// Genuinely device-wide, not per-account: these SHOULD stay unscoped.
const DEVICE_WIDE = new Set(['zeus_app_version', 'zeus_dsl_parity_shadow'])

describe('every per-user localStorage key is actually scoped to the user', () => {
  it('no user key is left shared between accounts', () => {
    const { keys, prefixes } = scoped()
    const leaking = [...usedKeys()]
      .filter((k) => !DEVICE_WIDE.has(k))
      .filter((k) => !keys.has(k) && !prefixes.some((p) => k.startsWith(p)))
      .sort()
    expect(leaking).toEqual([])
  })

  it('the two that matter most are scoped', () => {
    const { keys } = scoped()
    expect(keys.has('zeus_chart_tf')).toBe(true)        // timeframe
    expect(keys.has('zeus_ind_favorites')).toBe(true)   // starred indicators
  })
})
