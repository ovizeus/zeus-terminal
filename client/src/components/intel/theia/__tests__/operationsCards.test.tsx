import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActivityCard } from '../ActivityCard'
import { BrainVisionCard } from '../BrainVisionCard'
import { BrainDashboardCard } from '../BrainDashboardCard'
import { TheiaPage } from '../../TheiaPage'
import { useBrainStore } from '../../../../stores/brainStore'

// [2026-10-10] Brain Vision and Brain Dashboard were never React components:
// bootstrapBrainDash.ts polled and wrote innerHTML into two fixed DOM ids. Their
// data already came from these stores, so they become real cards here.
//
// The rule they inherit from THEIA: real data only. A value that is genuinely
// unavailable renders as an em dash, never as an invented number.

beforeEach(() => {
  delete (window as any).S
  useBrainStore.setState({ thoughts: [], brainState: '' } as never)
})

describe('the three cards that moved out of Auto Trade', () => {
  it('BrainVisionCard renders from an empty store without throwing', () => {
    expect(() => render(<BrainVisionCard />)).not.toThrow()
  })

  it('BrainVisionCard shows an em dash rather than a fabricated value', () => {
    const { container } = render(<BrainVisionCard />)
    expect(container.textContent).toContain('—')
    expect(container.textContent).not.toContain('$0')
  })

  it('BrainDashboardCard renders from an empty store without throwing', () => {
    expect(() => render(<BrainDashboardCard />)).not.toThrow()
  })

  it('BrainDashboardCard shows an em dash before any data arrives', () => {
    const { container } = render(<BrainDashboardCard />)
    expect(container.textContent).toContain('—')
  })

  it('ActivityCard renders its title with no entries', () => {
    render(<ActivityCard />)
    expect(screen.getByText(/activity/i)).toBeTruthy()
  })

  it('BrainVisionCard reflects a real store value when there is one', () => {
    useBrainStore.setState({ brainState: 'scanning', thoughts: [{ time: Date.now(), type: 'ok', msg: 'range holding' }] } as never)
    const { container } = render(<BrainVisionCard />)
    expect(container.textContent?.toLowerCase()).toContain('scanning')
    expect(container.textContent).toContain('range holding')
  })

  it('THEIA renders all three lanes', () => {
    const { container } = render(<TheiaPage />)
    const text = container.textContent || ''
    expect(text).toContain('State')
    expect(text).toContain('Operations')
    expect(text).toContain('Record')
    expect(container.querySelector('.theia-page.zi')).toBeTruthy()
  })
})
