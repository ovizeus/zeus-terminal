import { memo } from 'react'
import { useAresStore } from '../../../stores/aresStore'

/** Cognitive clarity bar — fill width + pct text. */
export const CognitiveBar = memo(function CognitiveBar() {
  const clarity = useAresStore((s) => s.ui.cognitive.clarity)
  return (
    <div id="ares-cog-bar">
      <span id="ares-cog-label">CLARITATE COGNITIVĂ</span>
      <div id="ares-cog-track">
        <div id="ares-cog-fill" style={{ width: clarity + '%' }} />
      </div>
      <span id="ares-cog-pct">{clarity}%</span>
    </div>
  )
})
