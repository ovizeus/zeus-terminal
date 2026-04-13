/** Missed Trades — 1:1 from index.html #missedPanel
 *  Content populated by bootstrapPanels.ts _showMissedTrades() */
interface Props { visible: boolean; onClose: () => void }

export function MissedTradesPanel({ visible, onClose }: Props) {
  return (
    <div id="missedPanel" className="dlog-overlay" style={{ display: visible ? 'flex' : 'none' }} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dlog-panel" style={{ maxWidth: '580px' }}>
        <div className="dlog-hdr">
          <span className="dlog-title">MISSED TRADES</span>
          <span style={{ color: '#444', fontSize: '9px', marginLeft: '8px' }}>Signals blocked by AT gates</span>
          <button className="dlog-close" onClick={onClose}>&times;</button>
        </div>
        <div id="missedContent" style={{ padding: '8px 0', maxHeight: '70vh', overflowY: 'auto' }}></div>
      </div>
    </div>
  )
}
