import type { ReactNode } from 'react'
import { toneColor, type ZiTone } from './tone'

export interface ZiColumn {
  label: string
  /** CSS grid track, e.g. '1fr' or '62px'. */
  width: string
  align?: 'left' | 'right'
  /**
   * false = this column holds a control or free text, so it gets neither the
   * monospace face nor tabular figures. Default true.
   *
   * [AMENDMENT A2-1] Needed because Manual Trade's rows carry a `✕ CLOSE`
   * button and an SL/TP editor, and a button forced into a tabular-figures
   * monospace cell is wrong.
   */
  numeric?: boolean
}

/**
 * A cell is either a value, or a value with its own tone.
 *
 * The tone travels WITH the value on purpose. The first shape of this API took
 * a parallel `tones` array, which meant one inserted column could move the P&L
 * colour onto the Size cell — on a live position that is a misread, and no test
 * can catch it because the alignment is a caller-side fact. The parallel array
 * is still accepted so nothing already written breaks, but per-cell is the
 * shape to use.
 */
export type ZiCell = ReactNode | { value: ReactNode; tone?: ZiTone }

function splitCell(cell: ZiCell): { value: ReactNode; tone?: ZiTone } {
  if (cell !== null && typeof cell === 'object' && 'value' in (cell as object)) {
    return cell as { value: ReactNode; tone?: ZiTone }
  }
  return { value: cell as ReactNode }
}

/**
 * The one position column template, shared by every positions table. Frozen and
 * typed readonly: it is the single guarantee this module exists to provide, and
 * a call site that could `push` into it would silently change every panel at
 * once.
 */
export const POSITION_COLUMNS: readonly ZiColumn[] = Object.freeze([
  { label: 'Symbol', width: '1fr' },
  { label: 'Side', width: '42px' },
  { label: 'Size', width: '62px', align: 'right' },
  { label: 'P&L', width: '72px', align: 'right' },
] as ZiColumn[])

/** No header label: an action column should add no visual noise. */
export const ACTION_COLUMN: ZiColumn = Object.freeze({
  label: '',
  width: 'auto',
  align: 'right',
  numeric: false,
} as ZiColumn)

/**
 * The positions template plus a trailing action cell, for the rows that carry a
 * close button. The four data columns stay byte-identical to POSITION_COLUMNS —
 * if they ever diverge, the trade panels start drifting apart again.
 */
export const POSITION_COLUMNS_WITH_ACTION: readonly ZiColumn[] = Object.freeze([
  ...POSITION_COLUMNS,
  ACTION_COLUMN,
])

export const JOURNAL_COLUMNS: readonly ZiColumn[] = Object.freeze([
  { label: 'Time', width: '46px' },
  { label: 'Symbol', width: '1fr' },
  { label: 'P&L', width: '56px', align: 'right' },
] as ZiColumn[])

function template(columns: readonly ZiColumn[]): string {
  return columns.map((c) => c.width).join(' ')
}

/**
 * Not gated behind an env check on purpose. The condition only fires on a
 * programming error — a row whose cells do not match its columns — which would
 * otherwise push a cell into implicit grid row 2 and produce a positions table
 * that looks plausible and is wrong, with nothing reported anywhere.
 */
function warnOnMismatch(columns: readonly ZiColumn[], cells: readonly ZiCell[]): void {
  if (cells.length !== columns.length) {
    console.warn(
      `[zi] ZiRow got ${cells.length} cells for ${columns.length} columns — the row will misalign. ` +
      `Columns: ${columns.map((c) => c.label || '(action)').join(', ')}`,
    )
  }
}

export function ZiTable({
  columns,
  children,
}: {
  columns: readonly ZiColumn[]
  children?: ReactNode
}) {
  return (
    <div role="table">
      <div
        role="row"
        data-zi-grid=""
        style={{ display: 'grid', gridTemplateColumns: template(columns), gap: 8, paddingBottom: 7 }}
      >
        {columns.map((c, i) => (
          <span key={i} role="columnheader" className="zi-lbl" style={{ textAlign: c.align ?? 'left' }}>
            {c.label}
          </span>
        ))}
      </div>
      {children}
    </div>
  )
}

export function ZiRow({
  columns,
  cells,
  tones,
}: {
  columns: readonly ZiColumn[]
  cells: readonly ZiCell[]
  /** Legacy parallel form. Prefer a per-cell tone — see ZiCell. */
  tones?: readonly (ZiTone | undefined)[]
}) {
  warnOnMismatch(columns, cells)
  return (
    <div
      role="row"
      data-zi-grid=""
      style={{
        display: 'grid',
        gridTemplateColumns: template(columns),
        gap: 8,
        padding: '7px 0',
        borderTop: '1px solid var(--zi-hair)',
        alignItems: 'baseline',
      }}
    >
      {cells.map((cell, i) => {
        const { value, tone } = splitCell(cell)
        const column = columns[i]
        const isNumeric = column?.numeric !== false
        return (
          <span
            key={i}
            role="cell"
            className={isNumeric ? 'zi-num' : undefined}
            style={{
              fontSize: 12,
              color: toneColor(tone ?? tones?.[i] ?? 'neutral'),
              textAlign: column?.align ?? 'left',
              ...(isNumeric ? { fontVariantNumeric: 'tabular-nums' as const } : {}),
            }}
          >
            {value}
          </span>
        )
      })}
    </div>
  )
}
