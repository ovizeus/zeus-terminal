import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ComingSoonCard } from '../ComingSoonCard'

describe('ComingSoonCard', () => {
  it('renders label and plain COMING SOON — no launch date (operator 2026-06-06)', () => {
    render(<ComingSoonCard label="OKX" />)
    expect(screen.getByText(/OKX/i)).toBeDefined()
    expect(screen.getByText(/COMING SOON/i)).toBeDefined()
    expect(screen.queryByText(/Phase|20\d\d/i)).toBeNull()
  })

  it('still renders phase text when explicitly provided (optional prop)', () => {
    render(<ComingSoonCard label="OKX" phase="Phase 3 — Jun 2026" />)
    expect(screen.getByText(/Phase 3/i)).toBeDefined()
  })

  it('is non-clickable (cursor: not-allowed)', () => {
    const { container } = render(<ComingSoonCard label="MEXC" phase="Phase 5" />)
    const card = container.firstChild as HTMLElement
    expect(card.style.cursor).toBe('not-allowed')
  })

  it('renders amber accent border', () => {
    const { container } = render(<ComingSoonCard label="HTX" phase="Phase 5" />)
    const card = container.firstChild as HTMLElement
    expect(card.style.border).toContain('251, 191, 36')
  })
})
