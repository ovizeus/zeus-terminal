import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const SRC = path.join(__dirname, '..', '..')
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8')

// [2026-11-16] Ecranul de PIN ramanea auriu: public/css/main.css (incarcat de
// bridge/legacyLoader.ts DUPA app.css) are aceleasi clase .pin-lock-* in auriu si
// le suprascria. Regulile noi trebuie sa fie legate de #pinLockScreen.
describe('ecranul de PIN', () => {
  it('⛔ nicio regula .pin-lock-* nelegata de #pinLockScreen in app.css', () => {
    const css = read('app.css')
    const loose = css.split('\n').filter((l) => /^\s*\.pin-lock/.test(l))
    expect(loose).toEqual([])
  })
  it('stralucirea aurie veche e anulata (logo, titlu, buton)', () => {
    const css = read('app.css')
    expect(css).toMatch(/#pinLockScreen \.pin-lock-logo \{[^}]*filter: none/)
    expect(css).toMatch(/#pinLockScreen \.pin-lock-title \{[^}]*text-shadow: none/)
    expect(css).toMatch(/#pinLockScreen \.pin-lock-btn \{[^}]*box-shadow: none/)
    expect(css).not.toMatch(/#pinLockScreen[^{]*\{[^}]*Cinzel/)
  })
})

// [2026-11-16] Bara MTF sarea si impingea aplicatia: updateMTFAlignment rescria
// aceleasi badge-uri cu clasa `mtf-badge` (fara stil), peste renderBrainCockpit.
describe('bara MTF', () => {
  it('⛔ un singur scriitor de afisaj pentru badge-urile MTF', () => {
    const b = read('engine/brain.ts')
    expect(b).not.toContain("'mtf-badge '")
    const fn = b.slice(b.indexOf('export function updateMTFAlignment'), b.indexOf('// ── SWEEP / DISPLACEMENT DETECTOR'))
    expect(fn).toContain('BM.mtf[tf] = dir')     // valoarea pentru motor ramane
    expect(fn).not.toMatch(/className|textContent/)
  })
})
