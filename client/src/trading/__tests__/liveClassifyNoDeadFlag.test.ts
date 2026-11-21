import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// [2026-11-21] Clasificarea unei pozitii NOI de pe bursa (trading/liveApi.ts). Ramura „boot race" citea
// AT._atActive, pe care nu-l scria nimeni → cod mort, scos. Comportamentul corect ramane:
// fara dovada de la server, pozitia e „unknown" (in niciun panou) si e reclasificata sus abia
// cand serverul spune autoTrade === true (si pozitia are >= 3 s).
const src = readFileSync(resolve(__dirname, '..', 'liveApi.ts'), 'utf8')
const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

describe('clasificarea pozitiilor noi (liveApi)', () => {
  test('nu mai depinde de semnalul inexistent AT._atActive', () => {
    expect(code).not.toMatch(/_atActive/)
  })
  test('fara dovada: unknown, nu manual si nu AT', () => {
    expect(code).toMatch(/fresh\.autoTrade = _isServerAT \? true : null/)
    expect(code).toMatch(/fresh\.sourceMode = _isServerAT \? 'auto' : 'unknown'/)
  })
  test('reclasificarea sus cere semnal strict de la server si 3 s vechime', () => {
    expect(code).toMatch(/sp\.autoTrade !== true\) return false/)
    expect(code).toMatch(/_ageMs >= 3000/)
  })
})
