import { memo } from 'react'
import { useAresStore } from '../../../stores/aresStore'
import { _ZI } from '../../../constants/icons'

/* [R28.2-G] Decision engine status line. Replaces imperative
 * `_setIconText(decEl, _ZI.ok / _ZI.pause, ' DECISION / BLOCKED: ...')`
 * calls in _aresRender.
 */
export const DecisionLine = memo(function DecisionLine() {
  const dec = useAresStore((s) => s.ui.decision)
  if (!dec.visible) {
    return (
      <div id="ares-decision-line" style={{ display: 'none', fontSize: 12, padding: '2px 8px', fontFamily: 'monospace' }} />
    )
  }
  const icon = dec.shouldTrade ? _ZI.ok : _ZI.pause
  const prefix = dec.shouldTrade
    ? ' DECISION: ' + (dec.side || '') + ' \u2014 '
    : ' BLOCKED: '
  const body = dec.reasons.join(' \u00b7 ')
  return (
    <div
      id="ares-decision-line"
      style={{
        display: 'block', fontSize: 12, padding: '2px 8px', fontFamily: 'monospace',
        color: dec.color || undefined,
      }}
    >
      <span dangerouslySetInnerHTML={{ __html: icon }} />
      {prefix + body}
    </div>
  )
})
