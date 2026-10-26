import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// [LIQ-PANEL 2026-10-25] Panoul poate fi perfect si sa nu-l deschida nimeni.
// Azi mutatia care a deconectat aducatorul istoricului A SUPRAVIETUIT primei
// variante de teste — deci cablarea se verifica, nu se presupune.
//
// Citim doar CODUL: a treia oara azi cand un test de-al meu s-a agatat de
// propriul meu comentariu, am incetat sa repar instanta.
const code = (p: string) =>
  readFileSync(p, 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

const DOCK = code('/opt/zeus-terminal/client/src/components/layout/ZeusDock.tsx')
const SHELL = code('/opt/zeus-terminal/client/src/components/layout/PanelShell.tsx')
const APP = code('/opt/zeus-terminal/client/src/App.tsx')
const PANEL = code('/opt/zeus-terminal/client/src/components/dock/LiqMapPanel.tsx')

describe('pictograma exista si e langa OMEGA', () => {
  it('fisierele au fost citite (non-vacuitate)', () => {
    expect(DOCK.length).toBeGreaterThan(3000)
    expect(SHELL.length).toBeGreaterThan(3000)
  })

  it('exista o intrare de dock cu id liqmap', () => {
    expect(DOCK).toMatch(/id:\s*'liqmap'/)
  })

  it('e LANGA omega, nu aruncata la coada', () => {
    const o = DOCK.indexOf("id: 'omega'")
    const l = DOCK.indexOf("id: 'liqmap'")
    expect(o).toBeGreaterThan(-1)
    expect(l).toBeGreaterThan(o)
    // Nicio ALTA intrare de dock intre ele. Felia incepe DUPA `{` al lui
    // omega, deci numarul corect e 0 — prima varianta astepta 1 si pica pe o
    // cablare corecta. Aserţia gresita, nu codul.
    expect(DOCK.slice(o, l).match(/\{ id: '/g) || []).toHaveLength(0)
  })

  it('are glyph SVG, nu emoji', () => {
    const i = DOCK.indexOf("id: 'liqmap'")
    const body = DOCK.slice(i, i + 1400)
    expect(body).toMatch(/<(rect|line|circle|path)/)
    expect(body).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u)
  })
})

describe('panoul e chiar randat', () => {
  it('shell-ul il importa si il randeaza', () => {
    expect(SHELL).toMatch(/import \{ LiqMapPanel \}/)
    expect(SHELL).toMatch(/<LiqMapPanel \/>/)
  })

  it('are titlu, altfel bara de sus ramane goala', () => {
    expect(SHELL).toMatch(/'liqmap':\s*'[^']+'/)
  })

  it('ramura de randare e legata de acelasi id ca pictograma', () => {
    expect(SHELL).toMatch(/data-panel-id="liqmap"/)
    expect(SHELL).toMatch(/dockActive === 'liqmap'/)
  })

  it('stilurile sunt importate — altfel panoul apare nestilizat', () => {
    expect(APP).toMatch(/styles\/liqmap\.css/)
  })
})

describe('panoul chiar cere date si asculta live-ul', () => {
  it('cere istoricul prin ruta unica', () => {
    expect(PANEL).toMatch(/fetchPanel/)
  })

  it('se abonează la zeus:liq pentru tape', () => {
    expect(PANEL).toMatch(/addEventListener\('zeus:liq'/)
  })

  it('si se DEZABONEAZA la inchidere — altfel ramane o scurgere', () => {
    expect(PANEL).toMatch(/removeEventListener\('zeus:liq'/)
  })

  it('opreste si temporizatoarele', () => {
    const i = PANEL.indexOf('return () =>')
    expect(i).toBeGreaterThan(-1)
    expect(PANEL.slice(i, i + 320)).toMatch(/clearInterval/)
  })

  it('TOT UI-ul e in ENGLEZA — regula veche a operatorului, incalcata de mine ieri', () => {
    // „tot in engleza, scrie asta ca regula, fara romana". Regula exista din
    // 14 aprilie si am scris panoul in romana. Testul pazeste CLASA, nu
    // instanta: orice cuvant romanesc reintrodus in sirurile vizibile cade aici.
    const ro = /\b(lichid\w*|acoperire|a[sş]tept|goal[aă]|PRE[TŢ]|nicio|vechi|eveniment\w*|simbol\w*|pre[tţ]ul|din clipa)\b/i
    const visible = PANEL
      .replace(/\/\*[\s\S]*?\*\//g, '')          // comentarii bloc
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    const hits = visible.split('\n').filter(l => ro.test(l) && /['"`>]/.test(l))
    expect(hits).toEqual([])
  })

  it('titlul si simbolul se VAD in panou, nu doar in bara dock-ului', () => {
    expect(PANEL).toMatch(/LIQUIDATION MAP/)
    expect(PANEL).toMatch(/zlq-sym/)
  })

  it('banda de simboluri exista — o scara goala nu mai pare defectiune', () => {
    expect(PANEL).toMatch(/SymbolStrip/)
    expect(PANEL).toMatch(/setSymbol/)
  })

  it('are toate cele trei vederi', () => {
    expect(PANEL).toMatch(/'map'/)
    expect(PANEL).toMatch(/'heat'/)
    expect(PANEL).toMatch(/'live'/)
  })
})

// [2026-10-26] Operatorul citeste Zeus de pe TELEFON. Coloanele sunt in pixeli
// ficsi, deci incaperea nu e o chestiune de gust — e aritmetica, si se verifica.
//
// Calculat: pe 360px, tape-ul lasa 80px pentru simbol. Pe 320px (iPhone SE)
// lasa 40px, adica „BTCUS…". De aia exista regula pentru ecrane inguste.
describe('incape pe telefon — aritmetica, nu gust', () => {
  const fs = require('node:fs') as typeof import('node:fs')
  const CSS: string = fs.readFileSync('/opt/zeus-terminal/client/src/styles/liqmap.css', 'utf8')

  function track(css: string, cls: string) {
    const m = new RegExp('\\.' + cls + '\\s*\\{[^}]*grid-template-columns:\\s*([^;]+);[^}]*gap:\\s*(\\d+)px', 's').exec(css)
    if (!m) return null
    const px = (m[1].match(/(\d+)px/g) || []).map(x => parseInt(x, 10))
    const cols = m[1].trim().split(/\s+/).length
    return px.reduce((a, b) => a + b, 0) + parseInt(m[2], 10) * (cols - 1)
  }

  it('pe 360px, fiecare rand lasa loc real pentru continut', () => {
    for (const cls of ['zlq-row', 'zlq-tp']) {
      const t = track(CSS, cls)!
      expect(t).toBeTruthy()
      expect(336 - t).toBeGreaterThanOrEqual(60)   // 360 minus gutiera panoului
    }
  })

  it('exista o regula pentru ecrane INGUSTE, si chiar strange coloanele', () => {
    const i = CSS.indexOf('@media (max-width: 380px)')
    expect(i).toBeGreaterThan(-1)
    const narrow = CSS.slice(i)
    for (const cls of ['zlq-row', 'zlq-tp']) {
      const wide = track(CSS.slice(0, i), cls)!
      const tight = track(narrow, cls)!
      expect(tight).toBeLessThan(wide)            // chiar strange
      expect(296 - tight).toBeGreaterThanOrEqual(60)  // 320 minus gutiera
    }
  })

  it('simbolul NU e coloana care se strange cel mai tare — el spune CE s-a lichidat', () => {
    // Simbolul e `1fr`: ia ce ramane. Daca ar fi fost fix, s-ar fi taiat primul.
    const i = CSS.indexOf('@media (max-width: 380px)')
    const m = /\.zlq-tp\s*\{[^}]*grid-template-columns:\s*([^;]+);/s.exec(CSS.slice(i))!
    expect(m[1]).toMatch(/1fr/)
  })
})
