import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { BookSection } from '../sections/BookSection'

// Cerut de operator: „cand intru sa vad doar folderele si cand intru in folder
// sa vad continutul, asa le reperez mai repede". Deci intrarea NU mai randeaza
// START.md — e o placuta ca toate celelalte.

const TREE = {
  ok: true,
  updatedAt: '2026-10-24T20:00:00.000Z',
  start: '# START\n\nTEXTUL-DIN-START care nu trebuie sa apara pe grila',
  cats: [
    { id: '2-DECIZII-ALE-TALE', title: 'DECIZII ALE TALE', desc: 'ce nu pot continua singur', count: 5,
      items: [{ file: '01-r16.md', title: '⏸️ R16 — **DECIZIA OPERATORULUI**', date: '2026-10-19' }] },
    { id: '4-LIVRATE', title: 'LIVRATE', desc: 'livrat si dovedit', count: 43, items: [] },
  ],
}

function mockFetch() {
  return vi.fn((url: string) => {
    if (String(url).includes('/book/tree')) return Promise.resolve({ ok: true, json: () => Promise.resolve(TREE) })
    if (String(url).includes('/book/section')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, markdown: '## R16\n\ncorpul sectiunii' }) })
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, markdown: '# Cartea intreaga\n\nCRONOLOGIC' }) })
  }) as any
}

beforeEach(() => { global.fetch = mockFetch() })
afterEach(() => { vi.restoreAllMocks() })

describe('BookSection — intrarea e grila de foldere', () => {
  it('arata placutele, cu titlu si cu numarul de sectiuni', async () => {
    render(<BookSection />)
    await waitFor(() => expect(screen.getByText('DECIZII ALE TALE')).toBeTruthy())
    expect(screen.getByText('LIVRATE')).toBeTruthy()
    expect(screen.getByText('START')).toBeTruthy()
    expect(screen.getByText('5')).toBeTruthy()
    expect(screen.getByText('43')).toBeTruthy()
  })

  it('NU randeaza textul din START.md pe grila — asta a cerut el', async () => {
    render(<BookSection />)
    await waitFor(() => expect(screen.getByText('DECIZII ALE TALE')).toBeTruthy())
    expect(screen.queryByText(/TEXTUL-DIN-START/)).toBeNull()
  })

  it('placuta START deschide starea de acum', async () => {
    render(<BookSection />)
    await waitFor(() => expect(screen.getByText('START')).toBeTruthy())
    fireEvent.click(screen.getByText('START'))
    await waitFor(() => expect(screen.getByText(/TEXTUL-DIN-START/)).toBeTruthy())
  })

  it('un folder deschide continutul lui, nu cartea intreaga', async () => {
    render(<BookSection />)
    await waitFor(() => expect(screen.getByText('DECIZII ALE TALE')).toBeTruthy())
    fireEvent.click(screen.getByText('DECIZII ALE TALE'))
    await waitFor(() => expect(screen.getByText(/R16 — DECIZIA OPERATORULUI/)).toBeTruthy())
    // titlul se arata FARA marcaje
    expect(screen.queryByText(/\*\*/)).toBeNull()
  })

  it('din folder se poate reveni la grila', async () => {
    render(<BookSection />)
    await waitFor(() => expect(screen.getByText('LIVRATE')).toBeTruthy())
    fireEvent.click(screen.getByText('LIVRATE'))
    await waitFor(() => expect(screen.getByText('← 🗂️ Foldere')).toBeTruthy())
    fireEvent.click(screen.getByText('← 🗂️ Foldere'))
    await waitFor(() => expect(screen.getByText('DECIZII ALE TALE')).toBeTruthy())
  })

  it('fara foldere pe disc se arata cartea intreaga, nu o pagina goala', async () => {
    global.fetch = vi.fn((url: string) => {
      if (String(url).includes('/book/tree')) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, markdown: '# Cartea intreaga\n\nCRONOLOGIC' }) })
    }) as any
    render(<BookSection />)
    await waitFor(() => expect(screen.getByText(/CRONOLOGIC/)).toBeTruthy())
  })
})
