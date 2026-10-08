import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// [DUAL-LIST DRIFT 2026-10-08] Indicators live in TWO independent lists:
//   core/config.ts        INDICATORS  — the registry the legacy panel renders
//   chart/ChartControls   IND_LIST    — the React panel's own hardcoded list
// TERMINATOR was added to the registry only, so it existed everywhere in the
// engine — registered, bundled, rendering — but simply never appeared in the
// panel the operator actually uses. Nothing failed; it was just invisible.
// This pins the two lists together so the next addition cannot go half-done.

const SRC = path.join(__dirname, '..', '..')

function ids(src: string, marker: RegExp): string[] {
  const s = fs.readFileSync(src, 'utf8')
  const m = s.match(marker)
  if (!m) throw new Error('list not found in ' + src)
  return Array.from(m[1].matchAll(/\{\s*id:\s*'([a-z0-9_]+)'/g)).map((x) => x[1])
}

// Alert-condition ids share the registry but are not indicators — they have no
// toggle and must not appear in the panel.
const ALERT_CONDITIONS = new Set([
  'rsi_ob', 'rsi_os', 'macd_cross', 'macd_under', 'ema_cross',
  'st_bull', 'st_bear', 'vol_spike', 'confluence_bull',
])

describe('the two indicator lists stay in step', () => {
  const registry = ids(path.join(SRC, 'core', 'config.ts'), /const INDICATORS[^=]*=\s*\[([\s\S]*?)\n\]/)
  const panel = ids(path.join(SRC, 'components', 'chart', 'ChartControls.tsx'), /const IND_LIST[^=]*=\s*\[([\s\S]*?)\n\]/)

  it('both lists are found and non-trivial', () => {
    expect(registry.length).toBeGreaterThan(50)
    expect(panel.length).toBeGreaterThan(50)
  })

  it('TERMINATOR is in the panel list, not just the registry', () => {
    expect(registry).toContain('terminator')
    expect(panel).toContain('terminator')
  })

  it('every registry indicator is offered in the panel', () => {
    const missing = registry.filter((id) => !ALERT_CONDITIONS.has(id) && !panel.includes(id))
    expect(missing).toEqual([])
  })

  // Chart OVERLAYS (liq/zs/sr/llv/ovi) live in the panel only, by design: they
  // toggle through togOvr and are not indicators, so they are absent from the
  // registry on purpose.
  it('the only panel-exclusive entries are the chart overlays', () => {
    const OVERLAYS = new Set(['liq', 'zs', 'sr', 'llv', 'ovi'])
    const extra = panel.filter((id) => !registry.includes(id) && !OVERLAYS.has(id))
    expect(extra).toEqual([])
  })
})
