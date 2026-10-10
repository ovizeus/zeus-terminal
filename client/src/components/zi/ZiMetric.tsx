import type { ReactNode } from 'react'

export type ZiTone = 'neutral' | 'pos' | 'neg' | 'warn'

const TONE_VAR: Record<ZiTone, string> = {
  neutral: 'var(--zi-val)',
  pos: 'var(--zi-pos)',
  neg: 'var(--zi-neg)',
  warn: 'var(--zi-warn)',
}

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
export function ZiMetric({ label, value, tone = 'neutral', secondary }: ZiMetricProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'baseline', gap: 12 }}>
      <span className="zi-lbl">{label}</span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span
          className="zi-num"
          style={{ fontSize: 14, color: TONE_VAR[tone], fontVariantNumeric: 'tabular-nums' }}
        >
          {value}
        </span>
        {secondary != null && (
          <span className="zi-num" style={{ fontSize: 12, color: 'var(--zi-mut)' }}>{secondary}</span>
        )}
      </span>
    </div>
  )
}
