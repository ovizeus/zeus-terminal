import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// [2026-10-10] localStorage is user-scoped: state.ts rewrites a key to
// `key:uid` so two accounts on the same browser do not read each other's
// settings. The list of keys it does that for is hand-maintained, and 16 keys
// the app actually writes were never added — including zeus_chart_tf and
// zeus_ind_favorites, which is the chart timeframe and the starred
// indicators. On a shared device those cross over, and the scoping looks
// complete while quietly not being.

const SRC = path.join(__dirname, '..', '..')

function scoped(): { keys: Set<string>; prefixes: string[] } {
  const st = fs.readFileSync(path.join(SRC, 'core', 'state.ts'), 'utf8')
  const block = st.slice(st.indexOf('_USER_KEYS'), st.indexOf('function _isUserKey'))
  const keys = new Set([...block.matchAll(/'([a-zA-Z0-9_.:-]+)'\s*:\s*(?:1|true)/g)].map((m) => m[1]))
  const pre = [...block.matchAll(/_USER_PREFIXES\s*=\s*\[([^\]]*)\]/g)].map((m) => m[1]).join(',')
  return { keys, prefixes: [...pre.matchAll(/'([^']+)'/g)].map((m) => m[1]) }
}

function usedKeys(): Set<string> {
  const out = new Set<string>()
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.(ts|tsx)$/.test(e.name) || /__tests__|\.test\./.test(p)) continue
      const s = fs.readFileSync(p, 'utf8')
      for (const m of s.matchAll(/localStorage\.(?:get|set|remove)Item\(\s*'([^']+)'/g)) out.add(m[1])
      // [2026-10-27] Gaura prin care mi-a scapat `zeus._serverATDemoEnabled.v1`:
      // scanarea vedea DOAR chei scrise literal in apel. Cheile tinute intr-o
      // constanta de modul — tiparul folosit de serverATCache — erau invizibile,
      // deci puteau rameane nescopate fara ca nimic sa spuna ceva.
      for (const m of s.matchAll(/const\s+[A-Z0-9_]*KEY[A-Z0-9_]*\s*=\s*'([^']+)'/g)) {
        if (/\.(get|set|remove)Item\(/.test(s)) out.add(m[1])
      }
    }
  }
  walk(SRC)
  return out
}

// Genuinely device-wide, not per-account: these SHOULD stay unscoped.
const DEVICE_WIDE = new Set([
  'zeus_app_version', 'zeus_dsl_parity_shadow',
  // [2026-10-27] Alegerea tabului-lider e despre DISPOZITIV, nu despre cont:
  // doua taburi ale aceluiasi browser aleg un lider indiferent cine e logat.
  'zeus_tab_leader',
])

// ⚠️ DATORIE CUNOSCUTA — scade, nu creste niciodata.
//
// [2026-10-27] Scanarea vedea DOAR chei scrise literal in apelul `.getItem(...)`.
// Cheile tinute intr-o constanta de modul erau INVIZIBILE, deci puteau rameane
// nescopate fara ca nimic sa spuna ceva. Am largit scanarea si au iesit sapte,
// toate PREEXISTENTE. Doua sunt de securitate si merita privite separat, nu
// schimbate in treacat in mijlocul altei lucrari:
//
//   zeus_pin_unlocked        — pe un dispozitiv comun, un cont deblocat cu PIN
//                              poate lasa deblocat si contul celuilalt
//   zeus_biometric_enabled   — la fel, preferinta de biometrie e per CONT
//   zeus._serverATEnabled.v1 — garda de autoritate AT; scoparea ei pierde
//                              cache-ul o data, adica o repornire fara plasa
//   zeus_security_nudge_snooze_ts, zeus_doctor_audio_ping, zt:qmLiq:v1
//
// Lista asta e RAPORTATA operatorului. Orice cheie NOUA nescopata cade, deci
// gaura nu se mai poate largi cat timp decide ce face cu cele vechi.
const KNOWN_UNSCOPED_PREEXISTING = new Set([
  'zeus._serverATEnabled.v1',
  'zeus_biometric_enabled',
  'zeus_pin_unlocked',
  'zeus_security_nudge_snooze_ts',
  'zeus_doctor_audio_ping',
  'zt:qmLiq:v1',
])

describe('every per-user localStorage key is actually scoped to the user', () => {
  it('no user key is left shared between accounts', () => {
    const { keys, prefixes } = scoped()
    const leaking = [...usedKeys()]
      .filter((k) => !DEVICE_WIDE.has(k))
      .filter((k) => !keys.has(k) && !KNOWN_UNSCOPED_PREEXISTING.has(k) && !prefixes.some((p) => k.startsWith(p)))
      .sort()
    expect(leaking).toEqual([])
  })

  it('the two that matter most are scoped', () => {
    const { keys } = scoped()
    expect(keys.has('zeus_chart_tf')).toBe(true)        // timeframe
    expect(keys.has('zeus_ind_favorites')).toBe(true)   // starred indicators
  })
})

describe('datoria de chei nescopate NU are voie sa creasca', () => {
  it('fiecare cheie din lista de datorie chiar exista inca in cod', () => {
    // Altfel lista devine un cimitir care ascunde ca problema s-a rezolvat.
    const used = usedKeys()
    for (const k of KNOWN_UNSCOPED_PREEXISTING) {
      expect(used.has(k)).toBe(true)
    }
  })

  it('cheile de SECURITATE sunt numite explicit, ca sa nu se piarda in lista', () => {
    expect(KNOWN_UNSCOPED_PREEXISTING.has('zeus_pin_unlocked')).toBe(true)
    expect(KNOWN_UNSCOPED_PREEXISTING.has('zeus_biometric_enabled')).toBe(true)
  })

  it('cheia noua de autoritate pe demo E scopata — nu intra in datorie', () => {
    const { keys } = scoped()
    expect(keys.has('zeus._serverATDemoEnabled.v1')).toBe(true)
    expect(KNOWN_UNSCOPED_PREEXISTING.has('zeus._serverATDemoEnabled.v1')).toBe(false)
  })
})
