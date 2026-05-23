import { useEffect, useState } from 'react'
import { ModalOverlay, ModalHeader } from './ModalOverlay'
import { NOTIFICATION_CENTER } from '../../core/config'

const w = window as any

interface Props { visible: boolean; onClose: () => void }

export function NotificationsModal({ visible, onClose }: Props) {
  const [filter, setFilter] = useState('all')
  const [tick, setTick] = useState(0)

  const items: any[] = (NOTIFICATION_CENTER?.items as any[]) || []
  const totalCount = items.length
  const unreadCount = items.filter((i) => !i.read).length
  void tick

  useEffect(() => {
    const panel = document.getElementById('mnotifications')
    if (!panel) return
    if (visible) {
      panel.classList.add('open')
      if (typeof w._ncRenderList === 'function') w._ncRenderList()
      setTick((t) => t + 1)
    } else {
      panel.classList.remove('open')
    }
  }, [visible])

  const applyFilter = (f: string) => {
    setFilter(f)
    if (typeof w.ncFilter === 'function') w.ncFilter(f === 'all' ? 'all' : f)
    else if (NOTIFICATION_CENTER) {
      NOTIFICATION_CENTER._filter = f === 'all' ? 'all' : f
      if (typeof w._ncRenderList === 'function') w._ncRenderList()
    }
  }

  const handleMarkAllRead = () => {
    if (!unreadCount) return
    if (typeof w.ncMarkAllRead === 'function') w.ncMarkAllRead()
    setTick((t) => t + 1)
  }

  const handleClearAll = () => {
    if (!totalCount) return
    if (typeof w.ncClear === 'function') w.ncClear()
    setTick((t) => t + 1)
  }

  const markAllStyle: React.CSSProperties = {
    opacity: unreadCount ? 1 : 0.45,
    cursor: unreadCount ? 'pointer' : 'not-allowed',
  }
  const clearAllStyle: React.CSSProperties = {
    opacity: totalCount ? 1 : 0.45,
    cursor: totalCount ? 'pointer' : 'not-allowed',
  }

  return (
    <ModalOverlay id="mnotifications" visible={visible} onClose={onClose}>
      <ModalHeader title="NOTIFICATION CENTER" onClose={onClose} />

      <div style={{ padding: '12px 16px' }}>
        {/* Tabs */}
        <div className="nc-tabs">
          <button className={`nc-tab${filter==='all'?' act':''}`} onClick={() => applyFilter('all')}>ALL</button>
          <button className={`nc-tab${filter==='critical'?' act':''}`} onClick={() => applyFilter('critical')}>
            <span style={{ display:'inline-block',width:6,height:6,borderRadius:'50%',background:'#ff3355',boxShadow:'0 0 4px #ff335566',marginRight:4,verticalAlign:'middle' }} /> CRITICAL
          </button>
          <button className={`nc-tab${filter==='warning'?' act':''}`} onClick={() => applyFilter('warning')}>
            <span style={{ display:'inline-block',width:6,height:6,borderRadius:'50%',background:'#f0c040',boxShadow:'0 0 4px #f0c04066',marginRight:4,verticalAlign:'middle' }} /> WARN
          </button>
          <button className={`nc-tab${filter==='info'?' act':''}`} onClick={() => applyFilter('info')}>
            <span style={{ display:'inline-block',width:6,height:6,borderRadius:'50%',background:'#4488ff',boxShadow:'0 0 4px #4488ff66',marginRight:4,verticalAlign:'middle' }} /> INFO
          </button>
        </div>

        {/* Actions */}
        <div className="nc-actions" style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button
            className={`sbtn2${unreadCount ? ' act' : ''}`}
            disabled={!unreadCount}
            style={markAllStyle}
            onClick={handleMarkAllRead}
          >
            Mark all read{unreadCount ? ` (${unreadCount})` : ''}
          </button>
          <button
            className="sbtn2"
            disabled={!totalCount}
            style={clearAllStyle}
            onClick={handleClearAll}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ marginRight: 4, verticalAlign: 'middle' }}>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" /><path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
            Clear all{totalCount ? ` (${totalCount})` : ''}
          </button>
        </div>

        {/* Notification list (JS-populated) */}
        <div className="nc-list" id="nc-list" />
      </div>
    </ModalOverlay>
  )
}
