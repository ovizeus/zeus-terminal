import { memo } from 'react'
import { useAresStore } from '../../../stores/aresStore'

/** Strip-bar badge: emoji + label, color/glow from ARES core state. */
export const StripBadge = memo(function StripBadge() {
  const core = useAresStore((s) => s.ui.core)
  const { emoji, label, color, glow } = core
  return (
    <span
      id="ares-strip-badge"
      style={{
        color,
        borderColor: color + '88',
        textShadow: `0 0 10px ${glow}`,
        boxShadow: `0 0 8px ${glow}`,
      }}
    >
      {emoji ? emoji + ' ' : ''}
      {label}
    </span>
  )
})
