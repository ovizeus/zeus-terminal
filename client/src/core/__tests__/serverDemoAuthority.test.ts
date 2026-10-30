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
    const body = SRC.slice(g, g + 500)
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
