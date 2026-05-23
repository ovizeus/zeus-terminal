import { memo } from 'react'
import { useAresStore } from '../../../stores/aresStore'
import { _ZI } from '../../../constants/icons'

/* [R28.2-G] Mortal wound / mission-failed line. Replaces imperative
 * `_setIconText(woundEl, _ZI.w / _ZI.skull, ' ...')` calls in _aresRender.
 * Icon SVG is a trusted constant from `_ZI`, rendered via
 * dangerouslySetInnerHTML on a wrapper span. Trailing text is a plain
 * React text node (no XSS surface).
 */
export const WoundLine = memo(function WoundLine() {
  const wound = useAresStore((s) => s.ui.wound)
  if (!wound.visible) return <div id="ares-wound-line" style={{ display: 'none' }} />
  const icon = wound.kind === 'mission_failed' ? _ZI.skull : _ZI.w
  const style = wound.color ? { display: 'block', color: wound.color } : { display: 'block' }
  return (
    <div id="ares-wound-line" style={style}>
      <span dangerouslySetInnerHTML={{ __html: icon }} />
      {wound.text}
    </div>
  )
})
