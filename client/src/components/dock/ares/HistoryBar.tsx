import { memo } from 'react'
import { useAresStore } from '../../../stores/aresStore'

/* [R28.2-G] History dots bar. Replaces imperative
 * `histBar.innerHTML = tradeHistory.map(...).join('')` in _aresRender.
 */
export const HistoryBar = memo(function HistoryBar() {
  const history = useAresStore((s) => s.ui.history)
  return (
    <div id="ares-history-bar">
      {history.map((h, i) => (
        <div
          key={i}
          className="ares-hist-dot"
          style={{
            background: h.win ? '#0080ff66' : '#ff446666',
            border: '1px solid ' + (h.win ? '#00d9ff' : '#ff4466'),
            boxShadow: '0 0 4px ' + (h.win ? '#00d9ff44' : '#ff446644'),
          }}
        />
      ))}
    </div>
  )
})
