/** Admin Modal — 1:1 from #madmin in index.html lines 4813-4864 */
import { useState } from 'react'
import { ModalOverlay, ModalHeader } from './ModalOverlay'

interface Props { visible: boolean; onClose: () => void }

export function AdminModal({ visible, onClose }: Props) {
  const [tab, setTab] = useState<'users' | 'audit'>('users')

  return (
    <ModalOverlay id="madmin" visible={visible} onClose={onClose} maxWidth="620px">
      <ModalHeader title="ADMIN — GESTIONARE USERI" onClose={onClose} />

      <div className="mbody" style={{ padding: 0, maxHeight: '70vh', overflowY: 'auto', display: 'block' }}>
        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid #1a2a3a', position: 'sticky', top: 0, background: '#080e14', zIndex: 3 }}>
          <button id="adminTabUsers" onClick={() => setTab('users')} style={{
            flex: 1, padding: '10px 0', background: 'none', border: 'none',
            borderBottom: tab === 'users' ? '2px solid #00afff' : '2px solid transparent',
            color: tab === 'users' ? '#00afff' : '#556',
            fontSize: 11, fontWeight: 700, cursor: 'pointer', letterSpacing: 1
          }}>USERI</button>
          <button id="adminTabAudit" onClick={() => setTab('audit')} style={{
            flex: 1, padding: '10px 0', background: 'none', border: 'none',
            borderBottom: tab === 'audit' ? '2px solid #00afff' : '2px solid transparent',
            color: tab === 'audit' ? '#00afff' : '#556',
            fontSize: 11, fontWeight: 700, cursor: 'pointer', letterSpacing: 1
          }}>AUDIT LOG</button>
        </div>

        {/* TAB: USERS */}
        <div id="adminPanelUsers" style={{ display: tab === 'users' ? undefined : 'none' }}>
          {/* Search bar */}
          <div style={{ padding: '12px 16px 8px', position: 'sticky', top: 36, background: '#080e14', zIndex: 2, borderBottom: '1px solid #1a2a3a' }}>
            <input id="adminSearch" type="text" placeholder="Caută user..." style={{
              width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #1a2a3a',
              background: '#0a1018', color: '#ccc', fontSize: 12, outline: 'none', boxSizing: 'border-box'
            }} />
            <div id="adminCounters" style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 10, color: '#556' }}></div>
          </div>
          {/* Pending approvals */}
          <div id="adminPendingSection" style={{ display: 'none', padding: '12px 16px 0' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#f0c040', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
              Cereri noi de aprobare
            </div>
            <div id="adminPendingList"></div>
          </div>
          {/* Existing users */}
          <div style={{ padding: '12px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#00afff', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
              Useri existenți
            </div>
            <div id="adminUsersList" style={{ fontSize: 12 }}>Se încarcă...</div>
          </div>
        </div>

        {/* TAB: AUDIT LOG */}
        <div id="adminPanelAudit" style={{ display: tab === 'audit' ? undefined : 'none', padding: '12px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#f0c040', textTransform: 'uppercase', letterSpacing: 1 }}>
              Ultimele acțiuni
            </div>
            <button style={{
              background: '#00afff22', color: '#00afff', border: '1px solid #00afff44',
              borderRadius: 4, padding: '3px 10px', fontSize: 10, cursor: 'pointer'
            }}>REFRESH</button>
          </div>
          <div id="adminAuditList" style={{ fontSize: 11, color: '#556' }}>Se încarcă...</div>
        </div>
      </div>
    </ModalOverlay>
  )
}
