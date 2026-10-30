// [2026-10-27] „am 27 de pozitii pe demo deschise care tot dispar si apar".
//
// BUCLA, gasita cap-coada:
//   1. la pornire clientul isi RESTAUREAZA pozitiile demo din starea salvata
//      local, fiindca `w._serverATDemoEnabled` e inca `false` — raspunsul
//      serverului n-a ajuns;
//   2. apoi vine instantaneul AUTORITAR al serverului, care are ZERO pozitii
//      demo (serverul le inchisese pe toate), si le sterge → „dispar";
//   3. la urmatorul refresh se restaureaza din nou → „apar".
//
// Nici macar nu era nevoie ca motorul din browser sa deschida ceva nou.
//
// Leacul NU e un flip de steag pe calea banilor: e exact cursa pentru care
// fusese scris `serverATCache` la S8-P0-3, doar ca flagul de DEMO n-avea
// memorie intre sesiuni.
import { describe, it, expect, beforeEach } from 'vitest'
import { readCachedDemo, writeCachedDemo, readCached, writeCached } from '../serverATCache'

beforeEach(() => { try { localStorage.clear() } catch { /* */ } })

describe('memoria autoritatii pe demo, intre sesiuni', () => {
  it('fara nimic salvat, implicit e FALSE — nu blocam pe cineva pe client-AT', () => {
    expect(readCachedDemo()).toBe(false)
  })

  it('ce scriem se citeste inapoi la urmatoarea pornire', () => {
    writeCachedDemo(true)
    expect(readCachedDemo()).toBe(true)
    writeCachedDemo(false)
    expect(readCachedDemo()).toBe(false)
  })

  it('NU se amesteca cu flagul de productie — sunt doua chei distincte', () => {
    writeCached(true)
    expect(readCachedDemo()).toBe(false)
    writeCachedDemo(true)
    writeCached(false)
    expect(readCachedDemo()).toBe(true)
    expect(readCached()).toBe(false)
  })

  it('orice altceva decat „true" inseamna false — fail-safe', () => {
    try { localStorage.setItem('zeus._serverATDemoEnabled.v1', 'yes') } catch { /* */ }
    expect(readCachedDemo()).toBe(false)
    try { localStorage.setItem('zeus._serverATDemoEnabled.v1', '1') } catch { /* */ }
    expect(readCachedDemo()).toBe(false)
  })

  it('fara localStorage (mod privat) nu arunca si raspunde false', () => {
    const orig = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('blocked') } })
    try {
      expect(() => readCachedDemo()).not.toThrow()
      expect(readCachedDemo()).toBe(false)
      expect(() => writeCachedDemo(true)).not.toThrow()
    } finally {
      if (orig) Object.defineProperty(window, 'localStorage', orig)
    }
  })
})

describe('restaurarea locala se opreste cand serverul detine demo-ul', () => {
  // Testul citeste SURSA: restaurarea traieste intr-o functie de boot lunga,
  // iar ce conteaza e ca garda exista INAINTE de bucla de restaurare si ca
  // goleste lista — altfel pozitiile vechi ar rameane pana la primul
  // instantaneu, adica exact palpairea pe care o reparam.
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const SRC = fs.readFileSync(
    path.join(__dirname, '..', 'bootstrapStartApp.ts'), 'utf8')

  it('garda exista si citeste flagul de autoritate pe demo', () => {
    expect(SRC).toMatch(/w\._serverATDemoEnabled === true/)
  })

  it('garda e INAINTE de bucla care restaureaza', () => {
    const g = SRC.indexOf('w._serverATDemoEnabled === true')
    const loop = SRC.indexOf('_pend.forEach')
    expect(g).toBeGreaterThan(-1)
    expect(loop).toBeGreaterThan(-1)
    expect(g).toBeLessThan(loop)
  })

  it('goleste lista locala, nu doar sare peste restaurare', () => {
    const g = SRC.indexOf('w._serverATDemoEnabled === true')
    // fereastra largita dupa ce am adaugat salvarea imediata: `return` ajunsese
    // dincolo de primele 500 de caractere si testul cadea pe un cod CORECT.
    const body = SRC.slice(g, g + 900)
    expect(body).toMatch(/TP\.demoPositions = \[\]/)
    expect(body).toMatch(/return/)
  })

  it('SPUNE in consola ce a sarit — altfel pozitiile dispar fara explicatie', () => {
    const g = SRC.indexOf('w._serverATDemoEnabled === true')
    expect(SRC.slice(g, g + 500)).toMatch(/SKIPPED/)
  })

  it('cand serverul NU detine demo-ul, restaurarea rameane neatinsa', () => {
    // Garda e stricta pe `=== true`, deci `undefined` (client-AT pur) NU o
    // declanseaza — nu regresam utilizatorii care chiar ruleaza pe client.
    expect(SRC).toMatch(/_serverATDemoEnabled === true/)
    expect(SRC).not.toMatch(/_serverATDemoEnabled\s*\)\s*\{/)
  })
})

describe('flagul e SEMANAT din cache la boot, nu cu false orb', () => {
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const ST = fs.readFileSync(path.join(__dirname, '..', 'state.ts'), 'utf8')

  it('la boot se citeste cache-ul, nu se pune false', () => {
    expect(ST).toMatch(/_serverATDemoEnabled = _readServerATDemoCache\(\)/)
    expect(ST).not.toMatch(/_serverATDemoEnabled = false/)
  })

  it('la fiecare raspuns al serverului se SCRIE cache-ul', () => {
    const i = ST.indexOf("'serverATDemoEnabled' in state")
    expect(i).toBeGreaterThan(-1)
    expect(ST.slice(i, i + 300)).toMatch(/_writeServerATDemoCache\(/)
  })
})

describe('⛔ ORDINEA la boot — de ea depinde tot fixul', () => {
  // Preboot-ul (`/api/at/state` -> `_applyPreboot` -> `_applyServerATState`)
  // seteaza `w._serverATDemoEnabled` INAINTE ca late-restore sa ruleze. Daca
  // cineva muta vreodata unul din ele, garda ar citi un flag inca nesetat si
  // fantomele s-ar restaura din nou — adica exact bugul, revenit tacut.
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'bootstrapStartApp.ts'), 'utf8')
  const at = (needle: string) => {
    const i = SRC.indexOf(needle)
    expect(i).toBeGreaterThan(-1)
    return i
  }

  it('starea serverului se APLICA inainte de blocul de restaurare', () => {
    expect(at('_applyPreboot(_prebootData)'))
      .toBeLessThan(at('w.ZState._pendingPositions && Array.isArray'))
  })

  it('garda e inaintea buclei care restaureaza', () => {
    expect(at('w._serverATDemoEnabled === true')).toBeLessThan(at('_pend.forEach'))
  })

  it('preboot-ul chiar oglindeste flagul de demo (prin _applyServerATState)', () => {
    const ST = fs.readFileSync(path.join(__dirname, '..', 'state.ts'), 'utf8')
    // `_applyPreboot` e un alias pentru `_applyServerATState`
    expect(ST).toMatch(/_applyPreboot:\s*_applyServerATState/)
    const i = ST.indexOf("'serverATDemoEnabled' in state")
    expect(i).toBeGreaterThan(-1)
    expect(ST.slice(i, i + 200)).toMatch(/w\._serverATDemoEnabled = !!state\.serverATDemoEnabled/)
  })

  it('cererea de stare a serverului e asteptata, nu lansata si uitata', () => {
    // Daca n-ar fi `await`-uita inainte de restaurare, ordinea din fisier n-ar
    // insemna nimic.
    const i = at("fetch('/api/at/state'")
    expect(SRC.slice(Math.max(0, i - 200), i)).toMatch(/await Promise\.all/)
  })
})

describe('fantomele se sterg de pe telefon IMEDIAT, nu „la urmatoarea salvare"', () => {
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'bootstrapStartApp.ts'), 'utf8')

  it('dupa golirea listei se cere o salvare locala', () => {
    const g = SRC.indexOf('w._serverATDemoEnabled === true')
    const body = SRC.slice(g, g + 700)
    expect(body).toMatch(/TP\.demoPositions = \[\]/)
    expect(body).toMatch(/ZState\.saveLocal\(\)/)
    // salvarea vine DUPA golire, altfel ar scrie tot vechiul continut
    expect(body.indexOf('TP.demoPositions = []')).toBeLessThan(body.indexOf('saveLocal()'))
  })

  it('o salvare care arunca nu rupe boot-ul', () => {
    const g = SRC.indexOf('w._serverATDemoEnabled === true')
    const body = SRC.slice(g, g + 700)
    const i = body.indexOf('saveLocal()')
    expect(body.slice(Math.max(0, i - 160), i)).toMatch(/try \{/)
  })

  it('salvarea e ceruta DOAR pe ramura care sare restaurarea', () => {
    // Daca ar fi in afara garzii, am scrie peste starea buna a cuiva care
    // chiar ruleaza pe client.
    const g = SRC.indexOf('w._serverATDemoEnabled === true')
    const loop = SRC.indexOf('_pend.forEach')
    const save = SRC.indexOf('ZState.saveLocal()', g)
    expect(save).toBeGreaterThan(g)
    expect(save).toBeLessThan(loop)
  })
})
