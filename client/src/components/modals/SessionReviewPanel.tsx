/** Session Review — 1:1 from index.html #sessionPanel
 *  Content populated by bootstrapPanels.ts _showSessionReview() */
interface Props { visible: boolean; onClose: () => void }

export function SessionReviewPanel({ visible, onClose }: Props) {
  return (
    <div id="sessionPanel" className="dlog-overlay" style={{ display: visible ? 'flex' : 'none' }} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dlog-panel" style={{ maxWidth: '520px' }}>
        <div className="dlog-hdr">
          <span className="dlog-title">SESSION REVIEW</span>
          <span id="sessionDate" style={{ color: '#444', fontSize: '9px', marginLeft: '8px' }}></span>
          <button className="dlog-close" onClick={onClose}>&times;</button>
        </div>
        <div id="sessionContent" style={{ padding: '16px', maxHeight: '75vh', overflowY: 'auto' }}></div>
      </div>
    </div>
  )
}
