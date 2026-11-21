import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const SRC = path.join(__dirname, '..', '..')
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8')

// [2026-11-21] „Cand dau click pe unele, se face negru jos" (poza: taietura dreapta prin creier).
// public/css/main.css (incarcat DUPA app.css) are `html, body { height: 100%; overflow-x: hidden !important }`.
// Cu `overflow-x` pe <html>, overflow-ul lui <body> nu mai trece la fereastra: <body> devenea el
// insusi un cadru de derulare INALT CAT ECRANUL, iar pagina derula IN el. Tot codul (inchiderea
// panourilor, scroll-lock-ul, butonul ⇅, sonda LAYOUT_TAIL, scrollBoot) derula FEREASTRA —
// `window.scrollTo` nu facea nimic, iar sub cadrul lui <body> ramanea fundalul #0a0a0a.
// Masurat in Chrome cu ambele foi reale: inainte bodyH 752 / scrollY mereu 0; dupa bodyH 3680,
// documentul deruleaza, iar scroll-lock-ul pastreaza pozitia.
describe('documentul deruleaza, nu <body>', () => {
  it('<body> are inaltimea continutului, peste height:100% din main.css', () => {
    const css = read('app.css')
    // `html > body` (0,0,2) bate `html, body` (0,0,1) din main.css, desi main.css se incarca dupa
    expect(css).toMatch(/html > body \{[^}]*height: auto/)
  })
  it('main.css inca are regula veche (daca dispare, regula din app.css se poate scoate)', () => {
    const legacy = fs.readFileSync(path.join(SRC, '..', '..', 'public', 'css', 'main.css'), 'utf8')
    expect(legacy).toMatch(/html,\s*body\s*\{\s*height: 100%;/)
  })
})
