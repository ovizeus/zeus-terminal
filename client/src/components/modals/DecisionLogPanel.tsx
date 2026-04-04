/** Decision Log — 1:1 from #dlogPanel in index.html
 *  Content populated by JS. Shell only. */
interface Props { visible: boolean; onClose: () => void }

export function DecisionLogPanel({ visible, onClose }: Props) {
  if (!visible) return null
  return (
    <div id="dlogPanel" className="dlog-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dlog-panel">
        <div className="dlog-hdr">
          <span className="dlog-title">DECISION LOG</span>
          <div className="dlog-filters" id="dlogFilters"></div>
          <button className="dlog-close" onClick={onClose}>&times;</button>
        </div>
        <div className="dlog-stats" id="dlogStats"></div>
        <div className="dlog-list" id="dlogList"></div>
      </div>
    </div>
  )
}
