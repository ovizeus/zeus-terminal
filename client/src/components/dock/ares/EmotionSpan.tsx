import { memo } from 'react'
import { useAresStore } from '../../../stores/aresStore'

/** Emotion suffix next to the badge. */
export const EmotionSpan = memo(function EmotionSpan() {
  const emotion = useAresStore((s) => s.ui.emotion)
  return <span id="ares-emotion-span">{emotion ? ' — ' + emotion : ''}</span>
})
