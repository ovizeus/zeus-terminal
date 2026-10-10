import type { ReactNode } from 'react'
import { toneColor, type ZiTone } from './tone'

// [CODE REVIEW 2026-10-10] The tone map used to live here AND in ZiTable, which
// left ZiTable importing a type from a metric component. It is one function in
// ./tone.ts now — see the note there for why the duplication mattered.
export type { ZiTone }

export interface ZiMetricProps {
  label: string
  value: ReactNode
  /** Colour is information, never decoration — see styles/institutional.css. */
  tone?: ZiTone
  /** A quieter note shown after the value, e.g. "3W · 1L". */
  secondary?: ReactNode
}

/**
 * One label/value row.
 *
 * `tabular-nums` lives here and in ZiRow and nowhere else, so the property
 * that stops a ticking price from shifting its column cannot be lost by
 * editing a panel later.
 */
/**
 * [2026-10-10] A value that is absent renders an em dash, never an empty cell.
 * Found by looking at the primitives in a real browser: a metric with no value
 * showed its label followed by nothing, and on a money surface a blank reads as
 * zero. A measured 0 is information and stays 0; only absence becomes a dash.
 */
const DASH = '\u2014'

export function ZiMetric({ label, value, tone = 'neutral', secondary }: ZiMetricProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'baseline', gap: 12 }}>
      <span className="zi-lbl">{label}</span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span
          className="zi-num"
          style={{ fontSize: 14, color: toneColor(tone), fontVariantNumeric: 'tabular-nums' }}
        >
          {value == null || value === '' ? DASH : value}
        </span>
        {secondary != null && (
          <span className="zi-num" style={{ fontSize: 12, color: 'var(--zi-mut)' }}>{secondary}</span>
        )}
      </span>
    </div>
  )
}
