// [2026-11-01] "tot e si se vede acolo hai sal scoatem sau sa schimbam cu
// altceva" — THE VOICE a plecat de pe pagina principala intr-o caseta geamana
// cu cea de chat. Cauza, scrisa ca sa nu se mai incerce reglaje: zona avea
// ~290px fixati din grila si primea un gand la ~30 de secunde, deci cutia era
// mereu mai mare decat continutul.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OmegaVoiceCard } from '../OmegaVoiceCard'
import { voiceCardCount, voiceCardPreview, voiceCardAriaLabel } from '../voiceCardText'

describe('voiceCardCount', () => {
  it('numara ganduri, cu pluralul corect', () => {
    expect(voiceCardCount(80)).toBe('80 thoughts')
    expect(voiceCardCount(2)).toBe('2 thoughts')
    expect(voiceCardCount(1)).toBe('1 thought')
  })
  it('gol inseamna invitatie, nu un zero raportat', () => {
    expect(voiceCardCount(0)).toBe('no thoughts yet')
  })
  it('ce nu e numar NU e zero — Number(null) e 0 si trece de isFinite', () => {
    for (const v of [null, undefined, '80', true, NaN, -4]) {
      expect(voiceCardCount(v as any)).toBe('no thoughts yet')
    }
  })
})

describe('voiceCardPreview', () => {
  it('textul scurt trece intreg', () => {
    expect(voiceCardPreview('watching BTCUSDT')).toBe('watching BTCUSDT')
  })
  it('taie pe cuvant, nu la mijlocul unuia', () => {
    const long = 'skipping SHORT LINKUSDT on demo because the book already has a LONG BTCUSDT position open'
    // Pozitia de taiere bruta pica IN mijlocul unui cuvant — altfel testul nu
    // poate distinge o taiere pe cuvant de una oarba. Prima versiune a acestui
    // test nu o distingea: mutatia "taie la 72 oricum" a supravietuit.
    expect(long[72]).not.toBe(' ')
    const out = voiceCardPreview(long)
    const body = out.slice(0, -1)
    expect(out.endsWith('…')).toBe(true)
    expect(long.startsWith(body)).toBe(true)              // nu inventeaza litere
    expect(body.length).toBeLessThanOrEqual(72)
    // Ce apara de fapt: imediat dupa textul pastrat urmeaza un SPATIU in
    // original, adica s-a taiat intre cuvinte.
    expect(long[body.length]).toBe(' ')
  })
  it('spatiile multiple se string intr-unul', () => {
    expect(voiceCardPreview('  a\n\n  b  ')).toBe('a b')
  })
  it('ce nu e text da sir gol', () => {
    for (const v of [null, undefined, 42, {}, '']) expect(voiceCardPreview(v as any)).toBe('')
  })
})

describe('<OmegaVoiceCard>', () => {
  it('arata titlul, numarul si ultimul gand', () => {
    render(<OmegaVoiceCard count={80} lastText="watching BTCUSDT — weak signal" lastTime="21:48" onOpen={() => {}} />)
    expect(screen.getByText('THE VOICE')).toBeTruthy()
    expect(screen.getByText(/80 thoughts/)).toBeTruthy()
    expect(screen.getByText(/21:48 watching BTCUSDT/)).toBeTruthy()
  })

  it('fara ganduri arata doar invitatia, fara separatorul orfan', () => {
    render(<OmegaVoiceCard count={0} lastText={null} lastTime={null} onOpen={() => {}} />)
    const hint = screen.getByText('no thoughts yet')
    expect(hint.textContent).toBe('no thoughts yet')   // niciun " · " agatat de nimic
  })

  it('REGRESIE: tap pe caseta deschide fluxul', () => {
    const onOpen = vi.fn()
    render(<OmegaVoiceCard count={5} lastText="x" lastTime="10:00" onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('e buton adevarat, cu eticheta pentru cititoarele de ecran', () => {
    render(<OmegaVoiceCard count={80} lastText={null} lastTime={null} onOpen={() => {}} />)
    const b = screen.getByRole('button') as HTMLButtonElement
    expect(b.tagName).toBe('BUTTON')
    expect(b.type).toBe('button')
    expect(b.getAttribute('aria-label')).toBe(voiceCardAriaLabel(80))
  })
})
