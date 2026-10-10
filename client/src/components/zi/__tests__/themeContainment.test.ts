import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// [2026-10-10] The theme is scoped to three surfaces on purpose. The operator
// asked for those three only, and the rest of the application still uses the
// app.css tokens and Share Tech Mono everywhere. If a --zi-* token starts
// appearing in a fourth place the theme has leaked, and the app looks
// half-converted — which is worse than either state on its own.
//
// Extending the theme to another panel should be a deliberate act: add the path
// here, in the same commit as the work. It must never happen by accident.

const SRC = path.join(__dirname, '..', '..', '..')

const ALLOWED = [
  'components/zi/',
  'components/dock/AutoTradePanel.tsx',
  'components/dock/AutoTradeConfigDrawer.tsx',
  'components/dock/ManualTradePanel.tsx',
  'components/dock/PositionRows.tsx',
  'components/intel/TheiaPage.tsx',
  'components/intel/theia/',
  'styles/institutional.css',
]

function walk(dir: string, hit: (p: string) => void): void {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules') continue
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) { walk(p, hit); continue }
    if (/\.(tsx?|css)$/.test(name)) hit(p)
  }
}

describe('the institutional theme stays inside its three surfaces', () => {
  it('no file outside the agreed list references a --zi-* token or class', () => {
    const offenders: string[] = []
    walk(SRC, (p) => {
      const rel = path.relative(SRC, p).split(path.sep).join('/')
      if (rel.includes('__tests__')) return
      if (ALLOWED.some((a) => rel.startsWith(a))) return
      const text = fs.readFileSync(p, 'utf8')
      if (/--zi-|\bzi-(lbl|num|rule|kill)\b/.test(text)) offenders.push(rel)
    })
    expect(offenders).toEqual([])
  })

  it('the theme never reaches :root, html or body', () => {
    // The gate rule. If this breaks, the whole application restyles at once.
    const css = fs.readFileSync(path.join(SRC, 'styles', 'institutional.css'), 'utf8')
    const selectors = css.match(/^[^\s/*][^{]*\{/gm) ?? []
    for (const sel of selectors) {
      expect(sel).not.toMatch(/(^|[\s,])(:root|html|body)\s*[,{]/)
    }
  })

  it('every selector in the stylesheet is gated behind .zi or a theme attribute', () => {
    const css = fs.readFileSync(path.join(SRC, 'styles', 'institutional.css'), 'utf8')
    const selectors = (css.match(/^[^\s/*@}][^{]*\{/gm) ?? [])
      .map((s) => s.replace(/\{$/, '').trim())
      .filter((s) => s.length > 0)
    expect(selectors.length).toBeGreaterThan(3)
    for (const sel of selectors) {
      expect(sel).toMatch(/\.zi\b/)
    }
  })

  it('the guard itself is not vacuous — it finds the files that DO use the theme', () => {
    // A walker that silently matched nothing would make every assertion above
    // pass for the wrong reason. This pins that it is actually reading files.
    let users = 0
    walk(SRC, (p) => {
      const rel = path.relative(SRC, p).split(path.sep).join('/')
      if (rel.includes('__tests__')) return
      if (/--zi-|\bzi-(lbl|num|rule|kill)\b/.test(fs.readFileSync(p, 'utf8'))) users++
    })
    expect(users).toBeGreaterThanOrEqual(5)
  })
})
