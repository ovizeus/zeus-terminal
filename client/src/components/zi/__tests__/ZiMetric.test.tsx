import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ZiMetric } from '../ZiMetric'

describe('ZiMetric', () => {
  it('renders the label and the value', () => {
    render(<ZiMetric label="Exposure" value="$1,240.00" />)
    expect(screen.getByText('Exposure')).toBeTruthy()
    expect(screen.getByText('$1,240.00')).toBeTruthy()
  })

  it('sets tabular figures on the value, so a ticking price cannot shift the column', () => {
    // This is the single most load-bearing style in the whole redesign. If it
    // is ever lost, every number column in both panels starts jittering.
    render(<ZiMetric label="Balance" value="10,084.20" />)
    const el = screen.getByText('10,084.20')
    expect(el.style.fontVariantNumeric).toBe('tabular-nums')
  })

  it('colours the value by tone, and leaves it neutral by default', () => {
    const { rerender } = render(<ZiMetric label="Today" value="+$84.20" tone="pos" />)
    expect(screen.getByText('+$84.20').style.color).toBe('var(--zi-pos)')
    rerender(<ZiMetric label="Today" value="-$12.00" tone="neg" />)
    expect(screen.getByText('-$12.00').style.color).toBe('var(--zi-neg)')
    rerender(<ZiMetric label="Today" value="0.00" />)
    expect(screen.getByText('0.00').style.color).toBe('var(--zi-val)')
  })

  it('renders a secondary note next to the value when given one', () => {
    render(<ZiMetric label="Today" value="+$84.20" secondary="3W · 1L" />)
    expect(screen.getByText('3W · 1L')).toBeTruthy()
  })
})

// [VISUAL CHECK 2026-10-10] Rendering the primitives in a real browser showed a
// metric with no value as a label followed by NOTHING. On a money surface an
// empty cell reads as zero, which is the failure R-C-9 exists to prevent:
// never show a plausible-looking nothing, show an em dash.
//
// The tests could not catch this — they assert on values that exist. Only the
// screenshot did.
describe('a metric with no value says so', () => {
  it('renders an em dash for undefined, null and empty string', () => {
    for (const v of [undefined, null, '']) {
      const { container, unmount } = render(<ZiMetric label="Not loaded" value={v as never} />)
      expect(container.textContent).toContain('—')
      unmount()
    }
  })

  it('still renders a real zero as 0, not as an em dash', () => {
    // A measured zero is information. Only the ABSENCE of a value is a dash.
    render(<ZiMetric label="Open" value={0} />)
    expect(screen.getByText('0')).toBeTruthy()
  })
})
