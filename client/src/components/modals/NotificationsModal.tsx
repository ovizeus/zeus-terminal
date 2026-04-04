import { ModalOverlay, ModalHeader } from './ModalOverlay'

interface Props { visible: boolean; onClose: () => void }

export function NotificationsModal({ visible, onClose }: Props) {
  return (
    <ModalOverlay id="mnotifications" visible={visible} onClose={onClose}>
      <ModalHeader title="NOTIFICATION CENTER" onClose={onClose} />

      <div style={{ padding: '12px 16px' }}>
        {/* Tabs */}
        <div className="nc-tabs" style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button className="sbtn2 act">ALL</button>
          <button className="sbtn2">
            <span style={{
              display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
              background: '#ff3355', marginRight: 4, verticalAlign: 'middle'
            }} />
            CRITICAL
          </button>
          <button className="sbtn2">
            <span style={{
              display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
              background: '#f0c040', marginRight: 4, verticalAlign: 'middle'
            }} />
            WARN
          </button>
          <button className="sbtn2">
            <span style={{
              display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
              background: '#4a90d9', marginRight: 4, verticalAlign: 'middle'
            }} />
            INFO
          </button>
        </div>

        {/* Actions */}
        <div className="nc-actions" style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button className="sbtn2 pri">Mark all read</button>
          <button className="sbtn2 sec">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ marginRight: 4, verticalAlign: 'middle' }}>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" /><path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
            Clear all
          </button>
        </div>

        {/* Notification list (JS-populated) */}
        <div className="nc-list" />
      </div>
    </ModalOverlay>
  )
}
