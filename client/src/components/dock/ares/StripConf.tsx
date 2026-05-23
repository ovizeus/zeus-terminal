import { memo } from 'react'
import { useAresStore } from '../../../stores/aresStore'

/** Confidence + clarity text line. Keeps id='ares-strip-conf' as DOM anchor
 * for orderflow.ts which injects #ares-ml-span next to it. */
export const StripConf = memo(function StripConf() {
  const conf = useAresStore((s) => s.ui.confidence)
  const clarity = useAresStore((s) => s.ui.cognitive.clarity)
  return (
    <span id="ares-strip-conf" style={{ fontSize: 11, color: '#00d9ff66' }}>
      CONF {conf}%  ·  CLARITY {clarity}%
    </span>
  )
})
