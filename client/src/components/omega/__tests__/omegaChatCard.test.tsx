// [OMEGA CHAT CARD 2026-11-01] Cererea lui: "chatul e jos nu vezi de unde sa-l
// inchizi... o caseta mare... si cand dai click pe ea se deschide omega chatul".
//
// Captura arata de ce: bara TALK WITH ME statea PESTE lista de ganduri, taind un
// gand la jumatate de propozitie, iar singurul mod de a o inchide era sa apesi pe
// antetul ei, lucru pe care nu-l scria nicaieri.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OmegaChatCard } from '../OmegaChatCard'
import { chatCardHint, chatCardAriaLabel } from '../chatCardText'

describe('chatCardHint', () => {
  it('counts messages, and gets the plural right', () => {
    expect(chatCardHint(50)).toBe('50 messages — tap to open')
    expect(chatCardHint(2)).toBe('2 messages — tap to open')
    expect(chatCardHint(1)).toBe('1 message — tap to open')
  })

  it('an empty history invites, it does not report a zero', () => {
    expect(chatCardHint(0)).toBe('tap to chat')
  })

  it('a non-number is NOT a zero count — Number(null) is 0 and passes isFinite', () => {
    expect(chatCardHint(null)).toBe('tap to chat')
    expect(chatCardHint(undefined)).toBe('tap to chat')
    expect(chatCardHint('50')).toBe('tap to chat')
    expect(chatCardHint(true)).toBe('tap to chat')
    expect(chatCardHint(NaN)).toBe('tap to chat')
    expect(chatCardHint(-3)).toBe('tap to chat')
  })

  it('the aria label carries the same sentence, so the tile is not just a picture', () => {
    expect(chatCardAriaLabel(50)).toBe('Open OMEGA chat — 50 messages — tap to open')
    expect(chatCardAriaLabel(0)).toBe('Open OMEGA chat — tap to chat')
  })
})

describe('<OmegaChatCard>', () => {
  it('shows the name, the emblem and the count', () => {
    const { container } = render(<OmegaChatCard count={50} onOpen={() => {}} />)
    expect(screen.getByText('OMEGA CHAT AI')).toBeTruthy()
    expect(screen.getByText('50 messages — tap to open')).toBeTruthy()
    const emblem = container.querySelector('.omega-chat-card-emblem') as HTMLElement
    expect(emblem).toBeTruthy()
    // The gold alpha-omega, the same file TheOrb uses — not an invented asset.
    expect(emblem.style.backgroundImage).toContain('omega/emblem.jpg')
  })

  it('REGRESSION: tapping it opens the chat', () => {
    const onOpen = vi.fn()
    render(<OmegaChatCard count={3} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('is a real button, so keyboard and screen readers reach it', () => {
    render(<OmegaChatCard count={0} onOpen={() => {}} />)
    const btn = screen.getByRole('button') as HTMLButtonElement
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.type).toBe('button') // not submit — it is not in a form, and never will be
    expect(btn.getAttribute('aria-label')).toBe('Open OMEGA chat — tap to chat')
  })
})
