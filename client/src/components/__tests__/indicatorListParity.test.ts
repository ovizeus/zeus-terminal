import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// [DUAL-LIST DRIFT 2026-10-08] Indicators live in TWO independent lists:
//   core/config.ts            INDICATORS — the registry (engine + legacy panel)
//   chart/ChartControls.tsx   IND_LIST   — the React panel's own list
// TERMINATOR was added to the registry only, so it was registered, bundled and
// drawing correctly, and still never appeared in the panel anyone uses. Nothing
// failed; it was invisible, and the operator found it before any test did.
// _mergePanelList now backstops that at runtime; this pins the source lists.

const SRC = path.join(__dirname, '..', '..')

// Line-based on purpose: the arrays contain '[' and ']' inside comments and
// descriptions, which defeats bracket matching (an earlier regex here silently
// over-captured a whole second array of alert conditions and reported 100
// indicators where there are 91).
function entries(file: string, decl: string): { id: string; ico: string }[] {
  const out: { id: string; ico: string }[] = []
  let inside = false
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!inside) { if (line.includes(decl)) inside = true; continue }
    if (/^\]/.test(line)) break
    const m = line.match(/\{\s*id:\s*'([a-z0-9_]+)'/)
    if (!m) continue
    const ico = line.match(/ico:\s*'([^']+)'/)
    out.push({ id: m[1], ico: ico ? ico[1] : '' })
  }
  return out
}

// Chart overlays live in the panel only, by design: they toggle through togOvr
// and are not indicators, so the registry does not know them.
const OVERLAYS = new Set(['liq', 'zs', 'sr', 'llv', 'ovi'])

describe('the two indicator lists stay in step', () => {
  const registry = entries(path.join(SRC, 'core', 'config.ts'), 'export const INDICATORS')
  const panel = entries(path.join(SRC, 'components', 'chart', 'ChartControls.tsx'), 'const IND_LIST')
  const rIds = registry.map((x) => x.id)
  const pIds = panel.map((x) => x.id)

  it('both lists parse to a sane size', () => {
    expect(rIds.length).toBeGreaterThan(80)
    expect(pIds.length).toBeGreaterThan(80)
  })

  it('TERMINATOR is in the panel list, not just the registry', () => {
    expect(rIds).toContain('terminator')
    expect(pIds).toContain('terminator')
  })

  it('every registered indicator is offered in the panel', () => {
    expect(rIds.filter((id) => !pIds.includes(id))).toEqual([])
  })

  it('the only panel-exclusive entries are the chart overlays', () => {
    expect(pIds.filter((id) => !rIds.includes(id) && !OVERLAYS.has(id))).toEqual([])
  })

  it('no id is listed twice in either list', () => {
    expect(new Set(rIds).size).toBe(rIds.length)
    expect(new Set(pIds).size).toBe(pIds.length)
  })

  // The list's own header asks for "a dedicated, distinct icon per indicator
  // (no recycled emoji)". 19 emoji are currently shared across ~41 entries, so
  // this cannot be asserted globally yet — it is logged in the Book as cleanup.
  // New indicators are held to the rule.
  it('TERMINATOR has an icon of its own', () => {
    const ico = panel.find((x) => x.id === 'terminator')!.ico
    expect(ico).toBeTruthy()
    expect(panel.filter((x) => x.ico === ico)).toHaveLength(1)
  })
})
