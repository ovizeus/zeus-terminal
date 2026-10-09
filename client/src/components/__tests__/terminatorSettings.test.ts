import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// [2026-10-09] The operator reported TERMINATOR has no settings while every
// other indicator does. The panel entry already carries hasGenericSettings, and
// updateTerminator already READS w.IND_SETTINGS.terminator for its period and
// multiplier — but the key was never declared in IND_SETTINGS, so the gear hit
// `if (!cfg) { toast('No settings for ...') }` and the indicator ran on
// hardcoded fallbacks (10 / 3) that nothing could change.

const SRC = path.join(__dirname, '..', '..')

describe('TERMINATOR is configurable like every other indicator', () => {
  const state = fs.readFileSync(path.join(SRC, 'core', 'state.ts'), 'utf8')
  const block = state.slice(state.indexOf('export const IND_SETTINGS'), state.indexOf('w.IND_SETTINGS = IND_SETTINGS'))

  it('declares a terminator entry in IND_SETTINGS', () => {
    expect(block).toMatch(/\bterminator:\s*\{/)
  })

  it('exposes the two parameters the renderer actually reads', () => {
    const m = block.match(/\bterminator:\s*\{([^}]*)\}/)
    expect(m).toBeTruthy()
    const keys = [...m![1].matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g)].map((x) => x[1])
    expect(keys).toContain('period')
    expect(keys).toContain('mult')
  })

  it('every declared key has a human label in the settings modal', () => {
    const ind = fs.readFileSync(path.join(SRC, 'engine', 'indicators.ts'), 'utf8')
    const labels = ind.slice(ind.indexOf('const labels: Record<string, string>'))
    const m = block.match(/\bterminator:\s*\{([^}]*)\}/)
    const keys = [...m![1].matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g)].map((x) => x[1])
    for (const k of keys) expect(labels).toMatch(new RegExp(`\\b${k}:\\s*'`))
  })
})
