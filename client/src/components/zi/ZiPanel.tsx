import type { ReactNode } from 'react'

export type ZiRail = 'pos' | 'neutral' | 'neg'

const RAIL_VAR: Record<ZiRail, string> = {
  pos: 'var(--zi-pos)',
  neutral: 'var(--zi-mut)',
  neg: 'var(--zi-neg)',
}

/**
 * The panel frame. The 2px rail is the only colour in the title area: one pixel
 * of state instead of a coloured header.
 *
 * The `.zi` class here is the gate for the whole theme — see
 * styles/institutional.css.
 */
export function ZiPanel({
  title,
  rail,
  action,
  children,
}: {
  title: string
  rail: ZiRail
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="zi" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'stretch', height: 44, flexShrink: 0 }}>
        <div data-zi-rail="" style={{ width: 2, background: RAIL_VAR[rail] }} />
        <div style={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
          <span style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--zi-val)' }}>
            {title}
          </span>
          {action != null && <span data-zi-action="">{action}</span>}
        </div>
      </div>
      <div className="zi-rule" />
      {children}
    </div>
  )
}
