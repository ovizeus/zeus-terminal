import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  ZiTable,
  ZiRow,
  POSITION_COLUMNS,
  POSITION_COLUMNS_WITH_ACTION,
  ACTION_COLUMN,
} from '../ZiTable'

// [AMENDMENT A2-1 2026-10-10] Task 1 shipped ZiRow rendering every cell as a
// numeric cell: `zi-num` plus tabular-nums. That was fine while nothing used it.
//
// Then reading the real code before Task 2 showed that Manual Trade does NOT
// render its rows inline. It delegates to PositionRows.tsx, whose four row
// components hold ELEVEN money-path call sites — closeLivePos three times,
// savePosSLTP four, cancelPendingOrder two, modifyPendingPrice two. The `✕ CLOSE`
// buttons carry minHeight 52, a deliberate mobile touch target.
//
// So the rows must keep their buttons, and they will use ZiRow internally with
// the action passed as an extra cell. A button forced into a monospace,
// tabular-figures cell is wrong, so a column can now declare itself
// non-numeric. Numbers keep tabular figures; controls do not.
//
// The four data columns stay byte-identical between the plain and the
// actionable template, because that shared template is the whole reason the two
// trade panels cannot drift apart.

describe('a row can hold a control, not just numbers', () => {
  it('does NOT put numeric styling on a non-numeric column', () => {
    render(
      <ZiTable columns={POSITION_COLUMNS_WITH_ACTION}>
        <ZiRow
          columns={POSITION_COLUMNS_WITH_ACTION}
          cells={['BTCUSDT', 'LONG', '$200', '+1.0%', <button type="button" key="c">Close</button>]}
        />
      </ZiTable>,
    )
    const btn = screen.getByRole('button', { name: 'Close' })
    const cell = btn.parentElement as HTMLElement
    expect(cell.style.fontVariantNumeric).toBe('')
    expect(cell.className).not.toContain('zi-num')
  })

  it('STILL puts tabular figures on the numeric columns — the regression guard', () => {
    render(
      <ZiTable columns={POSITION_COLUMNS_WITH_ACTION}>
        <ZiRow
          columns={POSITION_COLUMNS_WITH_ACTION}
          cells={['BTCUSDT', 'LONG', '$200', '+1.0%', <button type="button" key="c">Close</button>]}
        />
      </ZiTable>,
    )
    expect(screen.getByText('+1.0%').style.fontVariantNumeric).toBe('tabular-nums')
  })

  it('renders a real button, so the close action keeps working', () => {
    let clicked = false
    render(
      <ZiTable columns={POSITION_COLUMNS_WITH_ACTION}>
        <ZiRow
          columns={POSITION_COLUMNS_WITH_ACTION}
          cells={['BTCUSDT', 'LONG', '$200', '+1.0%', <button type="button" key="c" onClick={() => { clicked = true }}>Close</button>]}
        />
      </ZiTable>,
    )
    const btn = screen.getByRole('button', { name: 'Close' })
    expect(btn.tagName).toBe('BUTTON')
    btn.click()
    expect(clicked).toBe(true)
  })

  it('keeps the four data columns IDENTICAL to the plain template', () => {
    // If these ever diverge, Auto Trade and Manual Trade start drifting apart
    // again, which is the thing the shared template exists to prevent.
    expect(POSITION_COLUMNS_WITH_ACTION.slice(0, 4)).toEqual(POSITION_COLUMNS)
    expect(POSITION_COLUMNS_WITH_ACTION).toHaveLength(POSITION_COLUMNS.length + 1)
    expect(POSITION_COLUMNS_WITH_ACTION[4]).toBe(ACTION_COLUMN)
  })

  it('gives the action column no header label, so it adds no visual noise', () => {
    render(
      <ZiTable columns={POSITION_COLUMNS_WITH_ACTION}>
        <ZiRow columns={POSITION_COLUMNS_WITH_ACTION} cells={['BTCUSDT', 'LONG', '$200', '+1.0%', null]} />
      </ZiTable>,
    )
    expect(ACTION_COLUMN.label).toBe('')
  })

  it('treats a column with no numeric flag as numeric, so existing call sites are unchanged', () => {
    render(
      <ZiTable columns={POSITION_COLUMNS}>
        <ZiRow columns={POSITION_COLUMNS} cells={['BTCUSDT', 'LONG', '$200', '+1.0%']} />
      </ZiTable>,
    )
    expect(screen.getByText('BTCUSDT').style.fontVariantNumeric).toBe('tabular-nums')
  })
})

// [CODE REVIEW 2026-10-10] The quality review of Task 1 raised two shapes that
// are free to fix now and breaking-or-threefold-expensive once three panels
// lean on them. Both are money-path misread risks rather than style issues.

describe('a cell carries its own tone, so a colour cannot land on the wrong column', () => {
  it('colours the cell that declares the tone', () => {
    // The old shape was a parallel `tones` array: cells=[sym,side,size,pnl] with
    // tones=[undefined,'pos',undefined,'pos']. One inserted column and the P&L
    // colour silently moves to the Size cell — on a live position, that is a
    // misread with no failing test possible, because the alignment is a
    // caller-side fact. Keeping value and tone adjacent removes the class.
    render(
      <ZiTable columns={POSITION_COLUMNS}>
        <ZiRow
          columns={POSITION_COLUMNS}
          cells={['BTCUSDT', { value: 'LONG', tone: 'pos' }, '$200', { value: '-0.4%', tone: 'neg' }]}
        />
      </ZiTable>,
    )
    expect(screen.getByText('LONG').style.color).toBe('var(--zi-pos)')
    expect(screen.getByText('-0.4%').style.color).toBe('var(--zi-neg)')
    expect(screen.getByText('BTCUSDT').style.color).toBe('var(--zi-val)')
  })

  it('still accepts the plain parallel tones array, so nothing already written breaks', () => {
    render(
      <ZiTable columns={POSITION_COLUMNS}>
        <ZiRow
          columns={POSITION_COLUMNS}
          cells={['BTCUSDT', 'LONG', '$200', '+1.0%']}
          tones={[undefined, 'pos', undefined, 'pos']}
        />
      </ZiTable>,
    )
    expect(screen.getByText('+1.0%').style.color).toBe('var(--zi-pos)')
  })
})

describe('a mismatched row is reported instead of silently misaligning', () => {
  it('warns when there are more cells than columns', () => {
    // Five cells against four columns puts the fifth into implicit grid row 2,
    // column 1: a positions table that looks plausible and is wrong, with no
    // error anywhere. This is exactly the mistake a panel rewrite makes — add a
    // cell, forget the column.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(
      <ZiTable columns={POSITION_COLUMNS}>
        <ZiRow columns={POSITION_COLUMNS} cells={['BTCUSDT', 'LONG', '$200', '+1.0%', 'extra']} />
      </ZiTable>,
    )
    expect(warn).toHaveBeenCalled()
    expect(String(warn.mock.calls[0][0])).toMatch(/5 cells.*4 column/i)
    warn.mockRestore()
  })

  it('warns when there are fewer cells than columns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(
      <ZiTable columns={POSITION_COLUMNS}>
        <ZiRow columns={POSITION_COLUMNS} cells={['BTCUSDT', 'LONG']} />
      </ZiTable>,
    )
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('stays silent when the row matches its columns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(
      <ZiTable columns={POSITION_COLUMNS}>
        <ZiRow columns={POSITION_COLUMNS} cells={['BTCUSDT', 'LONG', '$200', '+1.0%']} />
      </ZiTable>,
    )
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('the table is announced as a table', () => {
  it('exposes table, row, columnheader and cell roles', () => {
    // Without these a screen reader reads "AVAXUSDT SHORT $1,000 -12.5%" with no
    // column names. AuditSection.tsx already uses a real <table>, so semantic
    // tabular data is the convention in this repo.
    render(
      <ZiTable columns={POSITION_COLUMNS}>
        <ZiRow columns={POSITION_COLUMNS} cells={['BTCUSDT', 'LONG', '$200', '+1.0%']} />
      </ZiTable>,
    )
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getAllByRole('row').length).toBe(2)
    expect(screen.getAllByRole('columnheader').length).toBe(POSITION_COLUMNS.length)
    expect(screen.getAllByRole('cell').length).toBe(POSITION_COLUMNS.length)
  })
})
