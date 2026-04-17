import { memo } from 'react'
import { useAresStore } from '../../../stores/aresStore'

/** Stage Progress column (SEED / ASCENT / SOVEREIGN). */
export const StageCol = memo(function StageCol() {
  const stage = useAresStore((s) => s.ui.stage)
  return (
    <div id="ares-stage-col">
      <div className="ares-meta-title">STAGE PROGRESS</div>
      <div className="ares-stage-name" id="ares-stage-name">{stage.name}</div>
      <div className="ares-prog-bar" id="ares-prog-bar">{stage.bar || '██░░░░░░░░ 0%'}</div>
      <div className="ares-prog-next" id="ares-prog-next">{stage.next || 'Next: 1,000'}</div>
    </div>
  )
})
