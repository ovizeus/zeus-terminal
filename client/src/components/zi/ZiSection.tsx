import type { ReactNode } from 'react'

/**
 * A titled block. One hairline above and space around it — no box, no card, no
 * coloured left border. Removing the boxes is what takes most of the noise out
 * of the old panels.
 */
export function ZiSection({
  title,
  aside,
  children,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <>
      <div className="zi-rule" />
      <div style={{ padding: '14px 16px 8px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span className="zi-lbl">{title}</span>
        {aside != null && <span className="zi-num zi-lbl" style={{ color: 'var(--zi-mut)' }}>{aside}</span>}
      </div>
      <div style={{ padding: '0 16px 16px' }}>{children}</div>
    </>
  )
}
