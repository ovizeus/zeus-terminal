// [2026-10-21 b296] Panoul Quant: lizibilitate si potrivire la laţime.
// Testele pin ţinta (fontul se adapteaza, nimic nu se pierde, regiunea e
// accesibila), NU valori de aspect pe care le-am putea schimba oricand.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { QuantMonitorPanel } from '../QuantMonitorPanel'
import { FRAME_COLS, MIN_FONT_PX, MAX_FONT_PX } from '../../../quantmonitor/render/fit'

vi.mock('../../../quantmonitor/index', () => ({
  init: () => Promise.resolve(),
  destroy: () => { },
}))

/** jsdom nu face layout: dam laţimi deterministe sondei si panoului. */
function stubLayout(panelPx: number, perCharAtProbe = 12) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const n = (this.textContent || '').length
    return { width: n * perCharAtProbe, height: 20, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: panelPx })
}

function screenEl(c: HTMLElement) { return c.querySelector('#qm-screen') as HTMLElement }

beforeEach(() => { (window as any).ResizeObserver = class { observe() { } disconnect() { } } })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('panoul Quant se potriveste la laţime', () => {
  it('mareste fontul pe un panou lat', () => {
    // Sonda: FRAME_COLS * 12px la font 20px -> 101 coloane cer 1212px la 20px.
    stubLayout(2000)
    const { container } = render(<QuantMonitorPanel />)
    const fs = parseFloat(screenEl(container).style.fontSize)
    expect(fs).toBeGreaterThan(11.5)
    expect(fs).toBeLessThanOrEqual(MAX_FONT_PX)
  })

  it('micsoreaza fontul pe un panou ingust, in loc sa taie coloana din dreapta', () => {
    stubLayout(400)
    const { container } = render(<QuantMonitorPanel />)
    const fs = parseFloat(screenEl(container).style.fontSize)
    expect(fs).toBeLessThan(11.5)
    expect(fs).toBeGreaterThanOrEqual(MIN_FONT_PX)
  })

  it('nu ajunge niciodata la font 0 sau NaN, care ar goli panoul', () => {
    stubLayout(0)
    const { container } = render(<QuantMonitorPanel />)
    const fs = parseFloat(screenEl(container).style.fontSize)
    expect(Number.isFinite(fs)).toBe(true)
    expect(fs).toBeGreaterThanOrEqual(MIN_FONT_PX)
  })

  it('merge si fara ResizeObserver', () => {
    delete (window as any).ResizeObserver
    stubLayout(1200)
    const { container } = render(<QuantMonitorPanel />)
    expect(Number.isFinite(parseFloat(screenEl(container).style.fontSize))).toBe(true)
  })

  it('masoara sonda in FRAME_COLS caractere, nu intr-un numar inventat', () => {
    const seen: number[] = []
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const n = (this.textContent || '').length
      if (n > 1) seen.push(n)
      return { width: n * 12, height: 20, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 1200 })
    render(<QuantMonitorPanel />)
    expect(seen).toContain(FRAME_COLS)
  })

  it('curata sonda din DOM la demontare', () => {
    stubLayout(1200)
    const before = document.body.querySelectorAll('span[aria-hidden="true"]').length
    const { unmount } = render(<QuantMonitorPanel />)
    unmount()
    expect(document.body.querySelectorAll('span[aria-hidden="true"]').length).toBe(before)
  })
})

describe('nimic din cadru nu se pierde, si se poate ajunge la el', () => {
  it('permite derulare orizontala in loc sa ascunda ce nu incape', () => {
    stubLayout(400)
    const { container } = render(<QuantMonitorPanel />)
    expect(screenEl(container).style.overflowX).toBe('auto')
  })

  it('e o regiune accesibila de la tastatura, cu nume', () => {
    stubLayout(1200)
    const { container } = render(<QuantMonitorPanel />)
    const el = screenEl(container)
    expect(el.getAttribute('role')).toBe('region')
    expect(el.getAttribute('tabindex')).toBe('0')
    expect(el.getAttribute('aria-label')).toBeTruthy()
  })
})
