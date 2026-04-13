/** Regime History — 1:1 from index.html #regimePanel
 *  Content populated by bootstrapPanels.ts _showRegimeHistory() */
interface Props { visible: boolean; onClose: () => void }

export function RegimeHistoryPanel({ visible, onClose }: Props) {
  return (
    <div id="regimePanel" className="dlog-overlay" style={{ display: visible ? 'flex' : 'none' }} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dlog-panel" style={{ maxWidth: '560px' }}>
        <div className="dlog-hdr">
          <span className="dlog-title">REGIME HISTORY</span>
          <button className="dlog-close" onClick={onClose}>&times;</button>
        </div>
        <div id="regimeContent" style={{ padding: '8px 0', maxHeight: '75vh', overflowY: 'auto' }}></div>
      </div>
    </div>
  )
}
