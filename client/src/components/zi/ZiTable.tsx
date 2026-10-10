import type { ReactNode } from 'react'
import type { ZiTone } from './ZiMetric'

export interface ZiColumn {
  label: string
  /** CSS grid track, e.g. '1fr' or '62px'. */
  width: string
  align?: 'left' | 'right'
}

/**
 * The one position/journal column template, shared by Auto Trade and Manual
 * Trade. Defined once so the two panels cannot drift apart — which is the whole
 * point of "auto trade should read like manual trade".
 */
export const POSITION_COLUMNS: ZiColumn[] = [
  { label: 'Symbol', width: '1fr' },
  { label: 'Side', width: '42px' },
  { label: 'Size', width: '62px', align: 'right' },
  { label: 'P&L', width: '72px', align: 'right' },
]

export const JOURNAL_COLUMNS: ZiColumn[] = [
  { label: 'Time', width: '46px' },
  { label: 'Symbol', width: '1fr' },
  { label: 'P&L', width: '56px', align: 'right' },
]

const TONE_VAR: Record<ZiTone, string> = {
  neutral: 'var(--zi-val)',
  pos: 'var(--zi-pos)',
  neg: 'var(--zi-neg)',
  warn: 'var(--zi-warn)',
}

function template(columns: ZiColumn[]): string {
  return columns.map((c) => c.width).join(' ')
}

export function ZiTable({ columns, children }: { columns: ZiColumn[]; children?: ReactNode }) {
  return (
    <div>
      <div
        data-zi-grid=""
        style={{ display: 'grid', gridTemplateColumns: template(columns), gap: 8, paddingBottom: 7 }}
      >
        {columns.map((c) => (
          <span key={c.label} className="zi-lbl" style={{ textAlign: c.align ?? 'left' }}>{c.label}</span>
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
  columns: ZiColumn[]
  cells: ReactNode[]
  tones?: (ZiTone | undefined)[]
}) {
  return (
    <div
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
      {cells.map((cell, i) => (
        <span
          key={i}
          className="zi-num"
          style={{
            fontSize: 12,
            color: TONE_VAR[tones?.[i] ?? 'neutral'],
            textAlign: columns[i]?.align ?? 'left',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {cell}
        </span>
      ))}
    </div>
  )
}
