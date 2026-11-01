// [2026-11-01] "tot acolo e" — dupa ce antetul compact a dat inapoi ~31px,
// felia din gandul urmator tot ramanea. Nu se putea altfel: inaltimea zonei
// vine din grila paginii, un gand are inaltimea data de randurile lui de text,
// si nu se potrivesc exact niciodata. Asta e partea care decide unde se taie.
import { describe, it, expect } from 'vitest'
import { firstClippedIndex } from '../voiceClip'

const rows = (...hs: number[]) => {
  let top = 0
  return hs.map(h => { const r = { top, height: h }; top += h; return r })
}

describe('firstClippedIndex', () => {
  it('toate incap → nu se taie nimic', () => {
    expect(firstClippedIndex(rows(100, 100), 250)).toBe(-1)
    expect(firstClippedIndex(rows(100, 100), 200)).toBe(-1) // exact
  })

  it('REGRESIE: al treilea gand intra doar pe o felie → se taie de la el', () => {
    // Cazul lui: ~229px de zona, ganduri de ~100px.
    expect(firstClippedIndex(rows(100, 100, 100), 229)).toBe(2)
  })

  it('taie de la primul care depaseste, nu de la ultimul', () => {
    expect(firstClippedIndex(rows(60, 60, 60, 60), 150)).toBe(2)
  })

  it('NU lasa niciodata panoul gol — daca nici primul nu incape, se arata taiat', () => {
    // Gol inseamna "nu merge". Taiat inseamna "deruleaza".
    expect(firstClippedIndex(rows(300), 100)).toBe(-1)
    expect(firstClippedIndex(rows(300, 300), 100)).toBe(-1)
  })

  it('inaltimi nemasurate inca → nu taie nimic, nu taie tot', () => {
    expect(firstClippedIndex(rows(100, 100), 0)).toBe(-1)
    expect(firstClippedIndex(rows(100, 100), NaN)).toBe(-1)
    // Number(null) === 0 si trece de isFinite — tipul se verifica inaintea valorii.
    expect(firstClippedIndex(rows(100, 100), null as any)).toBe(-1)
    expect(firstClippedIndex([{ top: 0, height: null as any }], 200)).toBe(-1)
    expect(firstClippedIndex([{ top: null as any, height: 10 }], 200)).toBe(-1)
  })

  it('lista goala sau alterata → -1', () => {
    expect(firstClippedIndex([], 200)).toBe(-1)
    expect(firstClippedIndex(null as any, 200)).toBe(-1)
  })

  it('rotunjirile subpixel nu taie un gand care de fapt incape', () => {
    expect(firstClippedIndex(rows(100, 100.4), 200)).toBe(-1)
    expect(firstClippedIndex(rows(100, 101), 200)).toBe(1)
  })
})

// [2026-11-01] "tot se vede si e urat acolo" — taierea de la b357 a scos felia
// dar a lasat o gaura de ~115px sub singurul gand ramas. Ce ramane trebuie sa
// umple zona.
import { shouldSpread } from '../voiceClip'

describe('shouldSpread', () => {
  const rows2 = (...hs: number[]) => {
    let top = 0
    return hs.map(h => { const r = { top, height: h }; top += h; return r })
  }

  it('REGRESIE: dupa taiere, ce a ramas se intinde — fara gaura neagra', () => {
    expect(shouldSpread(rows2(100, 100, 100), 229, 0)).toBe(true)
  })

  it('cand incap toate fara taiere, tot se intinde', () => {
    expect(shouldSpread(rows2(80, 80), 229, 0)).toBe(true)
  })

  it('NU se intinde cand deruleaza — altfel primele randuri ies peste marginea de sus', () => {
    expect(shouldSpread(rows2(100, 100, 100), 229, 120)).toBe(false)
  })

  it('NU se intinde cand nici primul gand nu incape', () => {
    // firstClippedIndex intoarce -1 ca sa nu lase panoul gol, iar continutul
    // depaseste — a intinde aici ar impinge textul afara.
    expect(shouldSpread(rows2(300), 100, 0)).toBe(false)
    expect(shouldSpread(rows2(300, 300), 100, 0)).toBe(false)
  })

  it('date lipsa → nu se intinde', () => {
    expect(shouldSpread([], 229, 0)).toBe(false)
    expect(shouldSpread(rows2(100), 0, 0)).toBe(false)
    expect(shouldSpread(rows2(100), null as any, 0)).toBe(false)
  })
})
