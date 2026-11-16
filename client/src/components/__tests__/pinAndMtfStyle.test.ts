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

// [2026-11-16] Badge-ul de stare („TRADING") din antetul creierului sarea intre doua
// forme si rupea randul; bannerul PROTECT primea o clasa fara stil.
describe('antetul creierului', () => {
  it('⛔ badge-ul de stare are un singur scriitor de afisaj, cu clasa znc-state', () => {
    const b = read('engine/brain.ts')
    expect(b).not.toContain("'brain-state-badge '")
    const writers = b.split('\n').filter((l) => /el\('brainStateBadge'\)/.test(l))
    expect(writers.length).toBe(2)          // ledul „WAITING FOR FEED" + renderBrainCockpit, ambele znc-state
  })
  it('⛔ bannerul PROTECT primeste mereu clasa cu stil', () => {
    expect(read('engine/brain.ts')).not.toContain("'protect-banner'")
  })
  it('badge-ul are latime constanta', () => {
    expect(read('app.css')).toMatch(/\.znc-state \{[^}]*min-width: 11ch/)
  })
})

// [2026-11-16] Zona neagra jos: straturi grafice uriase in miscare permanenta.
describe('memoria grafica', () => {
  it('liniile de scanare ale cockpit-ului nu se mai misca', () => {
    expect(read('app.css')).toMatch(/#zeusBrain \.znc-scanlines \{ animation: none; transform: none/)
  })
  it('creierul v7: densitate plafonata si oprit cand nu e pe ecran', () => {
    const ui = read('brain/brainUI.ts')
    expect(ui).toContain('Math.min(2, window.devicePixelRatio || 1)')
    expect(ui).toContain('IntersectionObserver')
  })
})
