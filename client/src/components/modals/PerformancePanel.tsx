/** Performance Dashboard — 1:1 from index.html #perfPanel
 *  Content populated by bootstrapPanels.ts _showPerformance() */
interface Props { visible: boolean; onClose: () => void }

export function PerformancePanel({ visible, onClose }: Props) {
  return (
    <div id="perfPanel" className="dlog-overlay" style={{ display: visible ? 'flex' : 'none' }} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dlog-panel" style={{ maxWidth: '580px' }}>
        <div className="dlog-hdr">
          <span className="dlog-title">PERFORMANCE</span>
          <div id="perfModeTabs" style={{ display: 'flex', gap: '4px', marginLeft: '8px' }}></div>
          <button className="dlog-close" onClick={onClose}>&times;</button>
        </div>
        <div id="perfContent" style={{ padding: '8px 0', maxHeight: '75vh', overflowY: 'auto' }}></div>
      </div>
    </div>
  )
}
