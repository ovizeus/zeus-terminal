import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ZiPanel } from '../ZiPanel'
import { ZiSection } from '../ZiSection'

describe('ZiPanel', () => {
  it('carries the .zi gate class, so removing it reverts the look', () => {
    const { container } = render(<ZiPanel title="Auto Trade" rail="pos">body</ZiPanel>)
    expect(container.querySelector('.zi')).toBeTruthy()
  })

  it('colours the state rail from the rail prop', () => {
    const { container, rerender } = render(<ZiPanel title="Auto Trade" rail="pos">body</ZiPanel>)
    const rail = () => container.querySelector<HTMLElement>('[data-zi-rail]')!
    expect(rail().style.background).toBe('var(--zi-pos)')
    rerender(<ZiPanel title="Auto Trade" rail="neutral">body</ZiPanel>)
    expect(rail().style.background).toBe('var(--zi-mut)')
  })

  it('renders the action slot only when given one', () => {
    const { container, rerender } = render(<ZiPanel title="Auto Trade" rail="pos">body</ZiPanel>)
    expect(container.querySelector('[data-zi-action]')).toBeNull()
    rerender(<ZiPanel title="Auto Trade" rail="pos" action={<button type="button">gear</button>}>body</ZiPanel>)
    expect(screen.getByRole('button', { name: 'gear' })).toBeTruthy()
  })
})

describe('ZiSection', () => {
  it('renders its title and children', () => {
    render(<ZiSection title="Positions"><div>row</div></ZiSection>)
    expect(screen.getByText('Positions')).toBeTruthy()
    expect(screen.getByText('row')).toBeTruthy()
  })

  it('renders an aside when given one', () => {
    render(<ZiSection title="Positions" aside="3"><div>row</div></ZiSection>)
    expect(screen.getByText('3')).toBeTruthy()
  })
})
