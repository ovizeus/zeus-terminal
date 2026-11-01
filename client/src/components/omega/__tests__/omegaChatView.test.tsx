// [OMEGA CHAT CARD 2026-11-01] Contract for the way into the chat, on the page
// itself — the card alone cannot prove it, because what he asked for is the
// NAVIGATION: tap the card, chat opens full, Back brings you back where you were.
//
// Before: <TalkWithMe> was rendered unconditionally inside a sticky container
// glued to the bottom of the main page, over the thought list.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

// Keep the page's network and audio out of this test — none of it is the subject.
vi.mock('../omegaApi', () => ({
  fetchVoice: vi.fn(async () => ({ ok: true, utterances: [] })),
  fetchMood: vi.fn(async () => ({ ok: true, mood: 'CALM', intensity: 0.3 })),
  fetchHealth: vi.fn(async () => ({ ok: true })),
  fetchR5aStats: vi.fn(async () => ({ ok: true })),
  sendChatStream: vi.fn(),
  MOOD_COLOR: {},
}))
// Mirror the REAL export surface of these modules. A mock that is missing a
// function the page calls at render time fails the test for a reason that has
// nothing to do with the subject — and a mock that does not behave like the
// system cannot defend the system.
vi.mock('../../../audio/omegaTts', () => ({
  speak: vi.fn(), stop: vi.fn(), isSpeaking: () => false,
  setSpeed: vi.fn(), setVolume: vi.fn(), getSpeed: () => 1, getVolume: () => 1,
}))
vi.mock('../../../audio/omegaAmbient', () => ({
  startAmbient: vi.fn(), stopAmbient: vi.fn(), pulseDecision: vi.fn(),
  pulseWarning: vi.fn(), setAmbientVolume: vi.fn(), isRunning: () => false,
}))
vi.mock('../TheOrb', () => ({ TheOrb: () => <div data-testid="orb" /> }))
vi.mock('../TheVoice', () => ({ TheVoice: () => <div data-testid="voice" /> }))
vi.mock('../R5AStats', () => ({ R5AStats: () => <div /> }))
vi.mock('../ReportCard', () => ({ ReportCard: () => <div /> }))
vi.mock('../DoctorPanel', () => ({ DoctorPanel: () => <div /> }))
vi.mock('../Ring5Panel', () => ({ Ring5Panel: () => <div /> }))
vi.mock('../../settings/MlConsentSection', () => ({ MlConsentSection: () => <div /> }))

// TalkWithMe is stubbed so the test can see WHICH mode it was asked for.
vi.mock('../TalkWithMe', () => ({
  TalkWithMe: ({ fullPage }: any) => (
    <div data-testid="talkwithme" data-fullpage={fullPage ? 'yes' : 'no'} />
  ),
}))

const _history = [{ role: 'you', text: 'a', ts: 1 }, { role: 'omega', text: 'b', ts: 2 }]
const loadHistory = vi.fn(async () => {})
vi.mock('../../../stores/omegaChatStore', () => ({
  useOmegaChatStore: (sel: any) => sel({ history: _history, loadHistory }),
}))
vi.mock('../../../stores', () => ({
  useATStore: (sel: any) => sel({ mode: 'demo', state: {} }),
  useUiStore: (sel: any) => sel({ activeExchange: 'binance', executionEnv: 'DEMO' }),
}))
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (sel: any) => sel({ user: { id: 1, role: 'user' } }),
}))

import { OmegaPage } from '../OmegaPage'

function card() { return screen.getByRole('button', { name: /Open OMEGA chat/i }) }

describe('OMEGA page — the chat is a place you go to, not a bar over the feed', () => {
  beforeEach(() => { loadHistory.mockClear() })

  it('REGRESSION: the main page does NOT render the chat — it renders the card', () => {
    render(<OmegaPage />)
    expect(screen.queryByTestId('talkwithme')).toBeNull()
    expect(card()).toBeTruthy()
    expect(screen.getByText('OMEGA CHAT AI')).toBeTruthy()
  })

  it('the card reads its count from the store, so it is right before the chat is ever opened', () => {
    render(<OmegaPage />)
    expect(screen.getByText('2 messages — tap to open')).toBeTruthy()
    // And the page loads the history itself — TalkWithMe used to do it on mount,
    // and it no longer mounts until the chat is opened.
    expect(loadHistory).toHaveBeenCalled()
  })

  it('REGRESSION: tapping the card opens the chat as a FULL page', () => {
    render(<OmegaPage />)
    fireEvent.click(card())
    const chat = screen.getByTestId('talkwithme')
    expect(chat.getAttribute('data-fullpage')).toBe('yes')
    expect(screen.getByText('OMEGA CHAT AI')).toBeTruthy() // page title
    // The main page is gone while chatting — nothing overlaps anything.
    expect(screen.queryByTestId('voice')).toBeNull()
  })

  it('REGRESSION: Back returns to OMEGA, and does NOT close the whole panel', () => {
    render(<OmegaPage />)
    fireEvent.click(card())
    expect(screen.getByTestId('talkwithme')).toBeTruthy()

    const ev = new CustomEvent('zeus:page-back', { cancelable: true })
    // The listener calls setView outside React's event system, so the re-render
    // has to be flushed before asserting on the DOM.
    act(() => { window.dispatchEvent(ev) })

    // The page swallowed the Back — the dock must not pop OMEGA off.
    expect(ev.defaultPrevented).toBe(true)
    expect(screen.queryByTestId('talkwithme')).toBeNull()
    expect(screen.getByTestId('voice')).toBeTruthy()
    expect(card()).toBeTruthy()
  })

  it('on the MAIN page Back is left alone, so it still closes OMEGA', () => {
    render(<OmegaPage />)
    const ev = new CustomEvent('zeus:page-back', { cancelable: true })
    act(() => { window.dispatchEvent(ev) })
    expect(ev.defaultPrevented).toBe(false)
  })
})
