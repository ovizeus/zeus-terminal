/**
 * [2026-11-22] Quant Monitor bloca aplicatia pe telefon: rescria TOT ecranul (~4.000 de bucati) la fiecare secunda.
 * Acum fiecare rand e un element propriu si se rescriu doar randurile schimbate.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { paintLines, _resetPaintForTest } from '../index'

describe('paintLines', () => {
  beforeEach(() => _resetPaintForTest())
  it('prima data scrie toate randurile, cate un element pe rand; randul gol pastreaza inaltimea', () => {
    const el = document.createElement('div')
    expect(paintLines(el, ['<span class="g">A</span>', '', 'C'])).toBe(3)
    expect(el.childElementCount).toBe(3)
    expect(el.children[1].innerHTML).toBe(' ')
  })
  it('apoi rescrie DOAR randurile schimbate — celelalte raman aceleasi noduri', () => {
    const el = document.createElement('div')
    paintLines(el, ['a', 'b', 'c'])
    const keep0 = el.children[0], keep2 = el.children[2]
    expect(paintLines(el, ['a', 'B', 'c'])).toBe(1)
    expect(el.children[0]).toBe(keep0)
    expect(el.children[2]).toBe(keep2)
    expect(el.children[1].innerHTML).toBe('B')
    expect(paintLines(el, ['a', 'B', 'c'])).toBe(0)
  })
  it('daca se schimba numarul de randuri, rescrie tot (corect, nu pe jumatate)', () => {
    const el = document.createElement('div')
    paintLines(el, ['a', 'b'])
    expect(paintLines(el, ['a', 'b', 'c'])).toBe(3)
    expect(el.childElementCount).toBe(3)
  })
})
