import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// [2026-11-21] Cerut de operator: imaginea marita si chartul pe tot ecranul intrau sub bara de sus
// a telefonului (semnal, ceas) — „mai uita-te daca mai gasesti asta pe undeva". Ecranele pe tot
// ecranul care pun CONTINUT sus trebuie sa tina cont de bara. (Fundalurile cu fereastra centrata nu.)
const src = (p: string) => readFileSync(resolve(__dirname, '..', '..', p), 'utf8')
const rule = (css: string, sel: string): string => {
  const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{]*\\{([^}]*)\\}', 'g')
  return [...css.matchAll(re)].map((m) => m[1]).join(' ')
}

describe('ecranele pe tot ecranul stau sub bara de sus a telefonului', () => {
  const app = src('app.css'), admin = src('components/admin/admin.css'), brain = src('brain/brainUI.ts')
  test.each([
    ['imaginea marita (jurnal creier)', brain, '.zb7-allm'],
    ['detaliile tranzactiei', brain, '.zb7-det'],
    ['chartul pe tot ecranul', app, '.fsm'],
    ['Admin Control Center', admin, '.zac'],
    ['sertarul din Admin', admin, '.zac-drawer'],
  ])('%s', (_n, css, sel) => {
    expect(rule(css, sel)).toMatch(/safe-area-inset-top/)
  })
})
