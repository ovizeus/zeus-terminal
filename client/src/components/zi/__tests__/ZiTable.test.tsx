import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ZiTable, ZiRow, POSITION_COLUMNS } from '../ZiTable'

describe('ZiTable', () => {
  it('renders one header cell per column', () => {
    render(<ZiTable columns={POSITION_COLUMNS}><ZiRow columns={POSITION_COLUMNS} cells={['BTCUSDT', 'LONG', '$200', '+1.0%']} /></ZiTable>)
    for (const c of POSITION_COLUMNS) expect(screen.getByText(c.label)).toBeTruthy()
  })

  it('gives the header and every row the SAME column template', () => {
    // This is what makes Auto Trade and Manual Trade siblings. If the two
    // panels ever hold their own templates again, they drift apart silently.
    const { container } = render(
      <ZiTable columns={POSITION_COLUMNS}>
        <ZiRow columns={POSITION_COLUMNS} cells={['BTCUSDT', 'LONG', '$200', '+1.0%']} />
      </ZiTable>,
    )
    const grids = Array.from(container.querySelectorAll<HTMLElement>('[data-zi-grid]'))
    expect(grids.length).toBe(2)
    expect(grids[0].style.gridTemplateColumns).toBe(grids[1].style.gridTemplateColumns)
  })

  it('puts tabular figures on row cells so a long symbol cannot shift the P&L column', () => {
    render(<ZiTable columns={POSITION_COLUMNS}><ZiRow columns={POSITION_COLUMNS} cells={['AVAXUSDT', 'SHORT', '$1,000', '-12.5%']} /></ZiTable>)
    expect(screen.getByText('-12.5%').style.fontVariantNumeric).toBe('tabular-nums')
  })

  it('applies a per-cell tone when one is given', () => {
    render(
      <ZiTable columns={POSITION_COLUMNS}>
        <ZiRow columns={POSITION_COLUMNS} cells={['BTCUSDT', 'LONG', '$200', '+1.0%']} tones={[undefined, 'pos', undefined, 'pos']} />
      </ZiTable>,
    )
    expect(screen.getByText('+1.0%').style.color).toBe('var(--zi-pos)')
  })
})
