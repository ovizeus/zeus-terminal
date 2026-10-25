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

  it('are toate cele trei vederi', () => {
    expect(PANEL).toMatch(/'map'/)
    expect(PANEL).toMatch(/'heat'/)
    expect(PANEL).toMatch(/'live'/)
  })
})
