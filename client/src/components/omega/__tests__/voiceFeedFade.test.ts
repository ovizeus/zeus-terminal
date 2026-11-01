// [2026-11-01] Cererea lui: "scoate scrisurile alea deasupra care se vad".
//
// Lista de ganduri e o cutie cu scroll si margine dura, deci gandul care cadea
// pe marginea de jos era retezat la jumatate de cuvant — un rand de text taiat
// cu cutitul chiar deasupra casetei OMEGA CHAT.
//
// Nu pot proba cum ARATA — in jsdom nu exista layout si browser pe serverul viu
// nu am voie sa pun. Ce pot proba e proprietatea mecanica de care depinde si
// care e usor de pierdut la o curatenie: prefixul -webkit-, fara de care masca
// nu se aplica pe telefonul lui.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(__dirname, '../../../app.css'), 'utf8')

function ruleBody(selector: string): string {
  const i = css.indexOf(selector + ' {')
  expect(i, `regula ${selector} lipseste din app.css`).toBeGreaterThan(-1)
  return css.slice(i, css.indexOf('}', i))
}

describe('.omega-voice-feed — marginea de jos se stinge, nu reteaza', () => {
  const body = ruleBody('.omega-voice-feed')

  it('are masca de jos, SI cu prefixul -webkit-', () => {
    expect(body).toContain('-webkit-mask-image: linear-gradient(to bottom')
    expect(body).toMatch(/\n\s+mask-image: linear-gradient\(to bottom/)
  })

  it('masca si spatiul de jos se potrivesc, ca ultimul gand sa poata iesi din degrade', () => {
    const mask = body.match(/mask-image: linear-gradient\(to bottom, #000 calc\(100% - (\d+)px\)/)
    expect(mask).toBeTruthy()
    const pad = body.match(/padding-bottom: (\d+)px/)
    expect(pad).toBeTruthy()
    // Daca spatiul ar fi mai mic decat degradeul, ultimul gand ar ramane
    // sters pentru totdeauna chiar si dupa ce dai scroll pana la capat.
    expect(Number(pad![1])).toBeGreaterThanOrEqual(Number(mask![1]))
  })

  it('ramane o cutie cu scroll — masca nu inlocuieste scrollul', () => {
    expect(body).toContain('overflow-y: auto')
  })
})
