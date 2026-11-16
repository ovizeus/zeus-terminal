import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// Spec 9.11 si 9.12: nimic din [DEMO-SIM] in productie; motorul nu importa creierul.
const SRC = path.join(__dirname, '..', '..')
function walk(d: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p, out) }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p)
  }
  return out
}

describe('regulile creierului v7', () => {
  const brain = walk(path.join(SRC, 'brain')).map((p) => fs.readFileSync(p, 'utf8')).join('\n')
  it('⛔ nimic din [DEMO-SIM]: fara simulator, istoric semanat, butoane demo', () => {
    for (const bad of ['demoTick', 'seedDemoHistory', 'demoSwitchMain', 'DEMO.REG', 'Math.random() < W[', 'data-r=', 'Break a gate']) expect(brain).not.toContain(bad)
  })
  it('⛔ niciun prag scris de mana (72) sau valoare inventata', () => {
    expect(brain).not.toMatch(/thr\s*[:=]\s*72\b/)
    expect(brain).not.toMatch(/THR\s*:\s*\d/)
  })
  it('⛔ motorul, scorul, ML-ul, ordinele si trading-ul nu importa creierul', () => {
    const dirs = ['engine', 'trading', 'core', 'data', 'services', 'quantmonitor', 'stores', 'hooks', 'utils']
    const offenders: string[] = []
    for (const d of dirs) {
      const full = path.join(SRC, d)
      if (!fs.existsSync(full)) continue
      for (const f of walk(full)) if (/from ['"][./]*brain\/|from ['"][./]*\.\.\/brain['"/]|__zeusBrainAxes/.test(fs.readFileSync(f, 'utf8'))) offenders.push(path.relative(SRC, f))
    }
    expect(offenders).toEqual([])
  })
  it('singurul cititor al copiei de axe e adaptorul creierului', () => {
    const readers = walk(SRC).filter((f) => fs.readFileSync(f, 'utf8').includes('__zeusBrainAxes')).map((f) => path.relative(SRC, f)).sort()
    expect(readers).toEqual(['brain/brainAdapter.ts', 'ui/marketCoreReactor.ts'])
  })
})
