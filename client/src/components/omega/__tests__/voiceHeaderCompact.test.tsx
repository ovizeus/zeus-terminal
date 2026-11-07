// [2026-11-01] Cererea lui: "nu e fain acolo unde scrie the voice ca nu imi
// place ce e acolo cum putem face" — in captura, zona THE VOICE arata UN gand
// intreg si o fantoma: doar ora, stinsa, fara text sub ea.
//
// Masurat pe telefonul lui: zona are ~278px, din care antetul lua ~36 si bara
// de intervale inca ~44 pe un rand separat. Raman ~198px pentru ganduri, iar un
// gand ocupa ~100px — deci doi, al doilea taiat. Antetul pe UN singur rand da
// inapoi acei ~44px, cat trebuie pentru al doilea gand intreg.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TheVoice } from '../TheVoice'

const u = (id: number, text: string) => ({
  id, user_id: 1, utterance_type: 'THOUGHT', mood: 'CALM', text,
  template_id: null, context_json: null, created_at: Date.now() - id * 1000,
}) as any

describe('TheVoice — antetul sta pe un singur rand', () => {
  it('REGRESIE: butoanele de interval sunt IN antet, nu pe un rand al lor', () => {
    const { container } = render(<TheVoice utterances={[u(1, 'a')]} loading={false} />)
    const header = container.querySelector('.omega-voice-header')
    expect(header).toBeTruthy()
    const bar = container.querySelector('.omega-voice-history-bar')
    expect(bar).toBeTruthy()
    // Daca bara iese iar din antet, zona pierde ~44px si revine fantoma.
    expect(header!.contains(bar!)).toBe(true)
    expect(header!.classList.contains('omega-voice-header-compact')).toBe(true)
  })

  it('toate cele cinci intervale sunt acolo', () => {
    render(<TheVoice utterances={[u(1, 'a')]} loading={false} />)
    for (const label of ['LIVE', '1h', '6h', '24h', '7d']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
  })

  it('titlul nu mai poarta sagetile care mancau latime', () => {
    render(<TheVoice utterances={[u(1, 'a')]} loading={false} />)
    const title = screen.getByText('THE VOICE')
    expect(title.textContent).toBe('THE VOICE')
    expect(title.textContent).not.toContain('►')
  })

  it('numarul de ganduri ramane in antet — se ascunde din CSS, nu din DOM', () => {
    render(<TheVoice utterances={[u(1, 'a'), u(2, 'b')]} loading={false} />)
    expect(screen.getByText('2 thoughts')).toBeTruthy()
  })

  it('gandurile se randeaza in continuare, cu textul lor', () => {
    render(<TheVoice utterances={[u(1, 'skipping SHORT LINKUSDT on demo')]} loading={false} />)
    expect(screen.getByText(/skipping SHORT LINKUSDT/)).toBeTruthy()
  })
})
