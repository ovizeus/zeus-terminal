// [2026-11-04] The soft-keyboard protection on the chat PAGE.
//
// b354 deleted the old protection (a `:has(.omega-chat-expanded)` mobile pin on
// the sticky bar) when the chat moved to its own page, and nothing replaced it.
// Worse, the effect that handles the keyboard was gated on `expanded`, which on
// a full page is false forever -- so the listener was never even attached.
//
// These tests are written against the REAL component, and each one fails on the
// code as it stood before this build.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'

vi.mock('../omegaApi', () => ({
  sendChatStream: vi.fn(),
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

// A visual viewport that behaves like the real one: listeners, and numbers
// we can move. The real API fires `resize` when the keyboard opens and
// `scroll` when iOS pans it.
function installViewport(height: number) {
  const listeners: Record<string, Array<() => void>> = {}
  const vv = {
    height,
    offsetTop: 0,
    addEventListener: (ev: string, fn: () => void) => {
      (listeners[ev] ||= []).push(fn)
    },
    removeEventListener: (ev: string, fn: () => void) => {
      listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn)
    },
  }
  ;(window as any).visualViewport = vv
  return {
    vv,
    listeners,
    fire(ev: string) {
      for (const fn of listeners[ev] || []) fn()
    },
    count(ev: string) {
      return (listeners[ev] || []).length
    },
  }
}

const ORIGINAL_INNER = window.innerHeight

function setInnerHeight(px: number) {
  Object.defineProperty(window, 'innerHeight', { value: px, configurable: true, writable: true })
}

/** Lets the effect's requestAnimationFrame run. */
async function flushFrame() {
  await act(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
  })
}

function renderChat() {
  const r = render(<TalkWithMe voiceOn={false} onUtteranceLogged={() => {}} fullPage />)
  const section = r.container.querySelector('section.omega-chat') as HTMLElement
  return { ...r, section }
}

describe('chat page — soft keyboard', () => {
  beforeEach(() => {
    _history = []
    setInnerHeight(844)
  })
  afterEach(() => {
    delete (window as any).visualViewport
    setInnerHeight(ORIGINAL_INNER)
    vi.restoreAllMocks()
  })

  it('REGRESIE: se leaga de viewport chiar daca `expanded` e false pe pagina', () => {
    const env = installViewport(844)
    renderChat()
    // Before this build the effect returned early on `!expanded`, so both
    // of these were zero on the chat page.
    expect(env.count('resize')).toBe(1)
    expect(env.count('scroll')).toBe(1)
  })

  it('cand tastatura urca, publica inaltimea acoperita pe secţiune', async () => {
    const env = installViewport(844)
    const { section } = renderChat()
    // The first measure runs in a frame, so before it the var is simply unset --
    // harmless, because the CSS declares `var(--omega-kb-inset, 0px)`.
    await flushFrame()
    expect(section.style.getPropertyValue('--omega-kb-inset')).toBe('0px')

    act(() => {
      env.vv.height = 508 // keyboard up
      env.fire('resize')
    })
    expect(section.style.getPropertyValue('--omega-kb-inset')).toBe('336px')
  })

  it('cand tastatura coboara, da spatiul inapoi', () => {
    const env = installViewport(508)
    const { section } = renderChat()
    act(() => { env.fire('resize') })
    expect(section.style.getPropertyValue('--omega-kb-inset')).toBe('336px')

    act(() => {
      env.vv.height = 844
      env.fire('resize')
    })
    expect(section.style.getPropertyValue('--omega-kb-inset')).toBe('0px')
  })

  it('raspunde si la `scroll` — iOS paneaza viewportul fara sa-l redimensioneze', () => {
    const env = installViewport(844)
    const { section } = renderChat()
    act(() => {
      env.vv.height = 508
      env.fire('scroll')
    })
    expect(section.style.getPropertyValue('--omega-kb-inset')).toBe('336px')
  })

  it('un viewport panat nu e confundat cu o tastatura', () => {
    const env = installViewport(844)
    const { section } = renderChat()
    act(() => {
      env.vv.height = 508
      env.vv.offsetTop = 336 // the whole difference is panning
      env.fire('resize')
    })
    expect(section.style.getPropertyValue('--omega-kb-inset')).toBe('0px')
  })

  it('isi desprinde ascultatorii si curata variabila la demontare', () => {
    const env = installViewport(844)
    const { section, unmount } = renderChat()
    act(() => {
      env.vv.height = 508
      env.fire('resize')
    })
    expect(section.style.getPropertyValue('--omega-kb-inset')).toBe('336px')
    unmount()
    expect(env.count('resize')).toBe(0)
    expect(env.count('scroll')).toBe(0)
    expect(section.style.getPropertyValue('--omega-kb-inset')).toBe('')
  })

  it('nu arunca intr-un browser fara visualViewport', () => {
    delete (window as any).visualViewport
    expect(() => renderChat()).not.toThrow()
  })
})
