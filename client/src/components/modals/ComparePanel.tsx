/** Strategy Comparison — 1:1 from index.html #comparePanel
 *  Content populated by bootstrapPanels.ts _showCompare() */
interface Props { visible: boolean; onClose: () => void }

export function ComparePanel({ visible, onClose }: Props) {
  return (
    <div id="comparePanel" className="dlog-overlay" style={{ display: visible ? 'flex' : 'none' }} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dlog-panel" style={{ maxWidth: '620px' }}>
        <div className="dlog-hdr">
          <span className="dlog-title">STRATEGY COMPARISON</span>
          <button className="dlog-close" onClick={onClose}>&times;</button>
        </div>
        <div id="compareContent" style={{ padding: '8px 0', maxHeight: '75vh', overflowY: 'auto' }}></div>
      </div>
    </div>
  )
}
