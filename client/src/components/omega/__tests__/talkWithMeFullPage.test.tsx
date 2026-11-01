// [2026-11-01] "e nu mai merge chatul omega probeaza vezi de ce".
// Proba pe componenta REALA in modul fullPage, nu pe un dublu: se randeaza,
// are casuta si butonul, si chiar TRIMITE.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const sendChatStream = vi.fn()
vi.mock('../omegaApi', () => ({
  sendChatStream: (...a: any[]) => sendChatStream(...a),
  MOOD_COLOR: { CALM: '#0ff' },
}))

const loadHistory = vi.fn(async () => {})
let _history: any[] = []
vi.mock('../../../stores/omegaChatStore', () => {
  const store: any = (sel: any) => sel({ history: _history, loadHistory })
  store.getState = () => ({ history: _history, loadHistory })
  store.setState = (fn: any) => { _history = fn({ history: _history }).history }
  return { useOmegaChatStore: store }
})

import { TalkWithMe } from '../TalkWithMe'

describe('TalkWithMe fullPage — chatul trebuie sa mearga', () => {
  beforeEach(() => { _history = []; sendChatStream.mockReset() })

  it('se randeaza: casuta de scris si butonul de trimis exista', () => {
    render(<TalkWithMe voiceOn={false} onUtteranceLogged={() => {}} fullPage />)
    expect(screen.getByPlaceholderText(/ask omega anything/i)).toBeTruthy()
    expect(screen.getByLabelText('send to omega')).toBeTruthy()
  })

  it('nu mai are antetul de colapsare — Back-ul paginii e iesirea', () => {
    render(<TalkWithMe voiceOn={false} onUtteranceLogged={() => {}} fullPage />)
    expect(screen.queryByText(/TALK WITH ME/i)).toBeNull()
  })

  it('e marcat deschis, ca regula care ascunde conversatia sa nu se aplice', () => {
    const { container } = render(<TalkWithMe voiceOn={false} onUtteranceLogged={() => {}} fullPage />)
    const section = container.querySelector('section.omega-chat') as HTMLElement
    expect(section.classList.contains('omega-chat-expanded')).toBe(true)
    expect(section.classList.contains('omega-chat-full')).toBe(true)
  })

  it('REGRESIE: scrii si apesi Enter -> chiar trimite', async () => {
    sendChatStream.mockImplementation(async (_t: string, opts: any) => {
      opts?.onChunk?.('salut')
      opts?.onDone?.({ mood: 'CALM' })
    })
    const onLogged = vi.fn()
    render(<TalkWithMe voiceOn={false} onUtteranceLogged={onLogged} fullPage />)
    const box = screen.getByPlaceholderText(/ask omega anything/i)
    fireEvent.change(box, { target: { value: 'ce faci' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: false })
    await waitFor(() => expect(sendChatStream).toHaveBeenCalled())
    expect(sendChatStream.mock.calls[0][0]).toBe('ce faci')
  })

  it('REGRESIE: butonul de trimis functioneaza', async () => {
    sendChatStream.mockImplementation(async (_t: string, opts: any) => { opts?.onDone?.({ mood: 'CALM' }) })
    render(<TalkWithMe voiceOn={false} onUtteranceLogged={() => {}} fullPage />)
    const box = screen.getByPlaceholderText(/ask omega anything/i)
    fireEvent.change(box, { target: { value: 'buna' } })
    fireEvent.click(screen.getByLabelText('send to omega'))
    await waitFor(() => expect(sendChatStream).toHaveBeenCalled())
  })

  it('Escape nu mai colapseaza o pagina care ar ramane goala', () => {
    const { container } = render(<TalkWithMe voiceOn={false} onUtteranceLogged={() => {}} fullPage />)
    const box = screen.getByPlaceholderText(/ask omega anything/i)
    fireEvent.keyDown(box, { key: 'Escape' })
    const section = container.querySelector('section.omega-chat') as HTMLElement
    expect(section.classList.contains('omega-chat-expanded')).toBe(true)
  })
})
