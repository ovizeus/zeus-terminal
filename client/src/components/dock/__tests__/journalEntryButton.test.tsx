/**
 * [2026-10-20 b293] Intrarea in jurnal era un `zi-lbl` de 9px, subliniat,
 * lipit in dreapta jos — o ţinta de apasat cat o scama, mai ales cu degetul
 * mare pe telefon. Operatorul a cerut explicit „gen buton apas si intru".
 *
 * Testul fixeaza ţinta, nu aspectul: ce conteaza e sa RAMANA un buton de
 * apasat, cu text lizibil si inaltime reala. Culorile pot fi schimbate
 * oricand fara sa pice nimic aici.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AutoTradePanel } from '../AutoTradePanel'
import { useATStore } from '../../../stores'

vi.mock('../../../trading/autotrade', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal()
  return { ...actual, resetKillSwitch: vi.fn() }
})

beforeEach(() => {
  useATStore.getState().reset()
})

function journalLink(container: HTMLElement): HTMLAnchorElement {
  const a = container.querySelector('a[href="/journal.html"]')
  expect(a).toBeTruthy()
  return a as HTMLAnchorElement
}

describe('intrarea in jurnalul full', () => {
  it('exista si duce la jurnal', () => {
    const { container } = render(<AutoTradePanel />)
    expect(journalLink(container)).toBeTruthy()
    expect(screen.getByLabelText(/full trade journal/i)).toBeTruthy()
  })

  it('ASTA E CEREREA: e o ţinta de apasat, nu o eticheta de 9px', () => {
    const { container } = render(<AutoTradePanel />)
    const a = journalLink(container)
    expect(parseInt(a.style.height, 10)).toBeGreaterThanOrEqual(36)
    expect(parseInt(a.style.fontSize, 10)).toBeGreaterThanOrEqual(12)
    expect(a.style.width).toBe('100%')
    expect(a.style.border).toBeTruthy()
    expect(a.style.cursor).toBe('pointer')
  })

  it('nu mai foloseste clasa `zi-lbl` de 9px si nu mai e subliniat', () => {
    const { container } = render(<AutoTradePanel />)
    const a = journalLink(container)
    expect(a.classList.contains('zi-lbl')).toBe(false)
    expect(a.style.textDecoration).not.toBe('underline')
  })

  it('textul ramane lizibil, nu doar o sageata', () => {
    const { container } = render(<AutoTradePanel />)
    expect(journalLink(container).textContent).toMatch(/full journal/i)
  })
})
