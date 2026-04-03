import { useDslStore } from '../../stores'
import type { Position } from '../../types'

export function DslWidget({ position }: { position: Position }) {
  const dslPositions = useDslStore((s) => s.dsl.positions)
  const dslEnabled = useDslStore((s) => s.dsl.enabled)

  const dslState = dslPositions[String(position.seq)]
  const progress = position.dslProgress

  // Use server-persisted dslProgress if client DSL state not available
  const active = dslState?.active ?? progress?.active ?? false
  const currentSL = dslState?.currentSL ?? progress?.currentSL ?? position.sl
  const impulseTriggered = dslState?.impulseTriggered ?? progress?.impulseTriggered ?? false

  if (!dslEnabled) return null

  return (
    <div className={`zr-dsl ${active ? 'zr-dsl--active' : ''}`}>
      <span className="zr-dsl__label">DSL</span>
      <span className={`zr-dsl__status ${active ? 'zr-dsl__status--on' : ''}`}>
        {active ? 'ACTIVE' : 'WAITING'}
      </span>
      {active && currentSL != null && currentSL > 0 && (
        <span className="zr-dsl__sl">SL: {currentSL.toFixed(2)}</span>
      )}
      {impulseTriggered && (
        <span className="zr-dsl__impulse">IMP</span>
      )}
    </div>
  )
}
