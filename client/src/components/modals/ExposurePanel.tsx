/** Exposure Dashboard (Alt+E) — 1:1 from #exposurePanel in index.html
 *  Content populated by JS. Shell only. */
interface Props { visible: boolean; onClose: () => void }

export function ExposurePanel({ visible, onClose }: Props) {
  if (!visible) return null
  return (
    <div id="exposurePanel" className="dlog-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dlog-panel" style={{ maxWidth: '520px' }}>
        <div className="dlog-hdr">
          <span className="dlog-title">EXPOSURE DASHBOARD</span>
          <span style={{ color: '#444', fontSize: '9px', marginLeft: '8px' }}>Alt+E</span>
          <button className="dlog-close" onClick={onClose}>&times;</button>
        </div>
        <div id="exposureContent" style={{ padding: '16px', fontSize: '11px', color: '#888', lineHeight: 1.8 }}></div>
      </div>
    </div>
  )
}
