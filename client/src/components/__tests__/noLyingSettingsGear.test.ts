import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// [LIQ SETTINGS MODAL REMOVED 2026-10-10] The LIQ CHART SETTINGS panel could not
// store anything and never could. Its four useState initialisers were hardcoded
// ('BTC', '$500', '24h', '$USD') so it did not even read back w.S.liqSettings
// when reopened in the same session; saveAndApply wrote that field and said
// "Liq settings applied"; and a search of the whole client and server found
// ZERO readers of liqSettings. Twenty-three controls, none of them connected.
//
// The operator's instruction was to take it out rather than wire it up, so the
// UI stops claiming a setting it cannot keep. The LIQ heatmap overlay itself is
// untouched — it toggles through togOvr and persists in `overlays`, which was
// fixed in b248. Only the gear and its panel are gone.
//
// This test pins the removal: a settings gear must not open a panel that cannot
// store anything.

const SRC = path.join(__dirname, '..', '..')

function indListSource(): string[] {
  const file = path.join(SRC, 'components', 'chart', 'ChartControls.tsx')
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const out: string[] = []
  let inside = false
  for (const line of lines) {
    if (!inside) { if (line.includes('const IND_LIST')) inside = true; continue }
    if (/^\]/.test(line)) break
    out.push(line)
  }
  return out
}

function walk(dir: string, hit: (p: string) => void): void {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) { walk(p, hit); continue }
    if (/\.tsx?$/.test(name)) hit(p)
  }
}

describe('no settings gear opens a panel that cannot store anything', () => {
  it('the LIQ Heatmap row offers no settings gear', () => {
    const liq = indListSource().filter((l) => /\{\s*id:\s*'liq'/.test(l))
    expect(liq).toHaveLength(1)
    expect(liq[0]).not.toContain('settingsModal')
  })

  it('the LIQ heatmap overlay itself is still there and still an overlay', () => {
    // Guard: removing the gear must not remove the feature.
    const liq = indListSource().filter((l) => /\{\s*id:\s*'liq'/.test(l))[0]
    expect(liq).toContain('isOverlay: true')
    expect(liq).toContain('LIQ Heatmap')
  })

  it('nothing imports the removed modal any more', () => {
    const offenders: string[] = []
    walk(SRC, (p) => {
      if (p.includes('__tests__')) return
      if (/LiqSettingsModal/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(SRC, p))
    })
    expect(offenders).toEqual([])
  })

  it('the modal file is gone from the tree', () => {
    expect(fs.existsSync(path.join(SRC, 'components', 'modals', 'LiqSettingsModal.tsx'))).toBe(false)
  })
})
