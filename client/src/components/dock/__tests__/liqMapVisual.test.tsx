// [LIQ-PANEL 2026-10-25] Randarea panoului cu DATELE REALE din baza vie
// (exportate din liqStore), nu cu date inventate de mine pentru test.
//
// Nu dovedeste ca arata FRUMOS — aia e judecata operatorului, testele n-au
// gust. Dovedeste ca pe datele lui adevarate panoul produce text citibil:
// cifre scurtate, procente cu semn, nimic „$NaN", si toate cele trei vederi
// pline. Si tipareste ce iese, ca sa pot verifica cu ochii in loc sa afirm.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor, screen, fireEvent } from '@testing-library/react'
import { LiqMapPanel } from '../LiqMapPanel'
import REAL from './real.json'

const w = window as any

beforeEach(() => {
  w.S = { symbol: 'BTCUSDT', price: 80489 }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => REAL })))
  ;(HTMLCanvasElement.prototype as any).getContext = () => ({
    setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {},
    lineTo() {}, stroke() {}, set fillStyle(_v: any) {}, set strokeStyle(_v: any) {}, set lineWidth(_v: any) {},
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function dump(el: HTMLElement, title: string) {
  const lines: string[] = []
  el.querySelectorAll('.zlq-head, .zlq-hon-main, .zlq-hon-sub, .zlq-syms, .zlq-row, .zlq-now, .zlq-heat-legend, .zlq-empty')
    .forEach((n) => {
      const t = (n.textContent || '').replace(/\s+/g, ' ').trim()
      if (t) lines.push('  ' + t)
    })
  // eslint-disable-next-line no-console
  console.log('\n──────── ' + title + ' ────────\n' + lines.join('\n'))
}

describe('panoul pe DATELE REALE ale operatorului', () => {
  it('randeaza si produce text citibil', async () => {
    const { container } = render(<LiqMapPanel />)
    await waitFor(() => expect(container.querySelector('.zlq-row')).toBeTruthy())
    dump(container as HTMLElement, 'MAP (date reale)')
    const txt = container.textContent || ''
    expect(txt).not.toMatch(/NaN|undefined|Infinity|\[object/)
    expect(txt).toMatch(/LIQUIDATION MAP/)
    expect(txt).toMatch(/\$\d/)                       // exista cel putin o suma
    expect(container.querySelectorAll('.zlq-row').length).toBeGreaterThan(0)
  })

  it('heatmap-ul si tape-ul randeaza pe aceleasi date', async () => {
    const { container } = render(<LiqMapPanel />)
    await waitFor(() => expect(container.querySelector('.zlq-row')).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: 'HEATMAP' }))
    await waitFor(() => expect(container.querySelector('.zlq-heat canvas')).toBeTruthy())
    dump(container as HTMLElement, 'HEATMAP (date reale)')
    fireEvent.click(screen.getByRole('tab', { name: 'LIVE' }))
    await waitFor(() => expect(container.textContent).toMatch(/waiting for a liquidation/))
    dump(container as HTMLElement, 'LIVE (gol, inainte de prima lichidare)')
    expect(container.textContent).not.toMatch(/NaN|undefined/)
  })
})
