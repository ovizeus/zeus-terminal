/** Admin Modal — 1:1 from #madmin in index.html lines 4813-5107
 *  Wires zeusLoadAdmin + zeusLoadAuditLog data loading */
import { useState, useEffect, useCallback } from 'react'
import { ModalOverlay, ModalHeader } from './ModalOverlay'

interface Props { visible: boolean; onClose: () => void }

interface AdminUser {
  email: string
  role: string
  status: string
  approved: boolean
  createdAt?: string
  bannedUntil?: string
  exchange?: { connected: boolean; mode: string; lastVerified?: string }
}

interface AuditEntry {
  action?: string
  user_id?: string
  details?: string
  created_at?: string
}

function escHtml(s: string) {
  const d = document.createElement('div')
  d.appendChild(document.createTextNode(s))
  return d.innerHTML
}

function StatusBadge({ u }: { u: AdminUser }) {
  if (u.role === 'admin') return (
    <span className="adm-badge" style={{ background: '#00afff22', color: '#00afff', borderColor: '#00afff44' }}>
      <span className="z-dot z-dot--blu"></span> ADMIN
    </span>
  )
  if (u.status === 'banned') {
    let label = 'BANAT'
    if (u.bannedUntil && u.bannedUntil !== '9999-12-31T23:59:59Z') {
      const d = new Date(u.bannedUntil)
      label += ' → ' + d.toLocaleDateString('ro-RO') + ' ' + d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })
    } else if (u.bannedUntil === '9999-12-31T23:59:59Z') {
      label += ' PERMANENT'
    }
    return (
      <span className="adm-badge" style={{ background: '#ff220022', color: '#ff4444', borderColor: '#ff444444' }}>
        <span className="z-dot z-dot--red"></span> {label}
      </span>
    )
  }
  if (u.status === 'blocked') return (
    <span className="adm-badge" style={{ background: '#ff880022', color: '#ff8844', borderColor: '#ff884444' }}>
      <span className="z-dot z-dot--ylw"></span> BLOCAT
    </span>
  )
  if (!u.approved) return (
    <span className="adm-badge" style={{ background: '#f0c04022', color: '#f0c040', borderColor: '#f0c04044' }}>
      <span className="z-dot z-dot--ylw"></span> PENDING
    </span>
  )
  return (
    <span className="adm-badge" style={{ background: '#00ff8822', color: '#00ff88', borderColor: '#00ff8844' }}>
      <span className="z-dot z-dot--grn"></span> ACTIV
    </span>
  )
}

function ExBadge({ u }: { u: AdminUser }) {
  if (u.exchange && u.exchange.connected) {
    const c = u.exchange.mode === 'live' ? '#ff6655' : '#f0c040'
    const l = u.exchange.mode === 'live' ? 'LIVE' : 'TESTNET'
    return (
      <span className="adm-badge" style={{ fontSize: 8, background: c + '22', color: c, borderColor: c + '44' }}>
        <span className="z-dot" style={{ background: c, boxShadow: `0 0 4px ${c}66` }}></span> {l}
      </span>
    )
  }
  return (
    <span className="adm-badge" style={{ fontSize: 8, background: '#33333344', color: '#556', borderColor: '#333' }}>
      <svg className="z-i" viewBox="0 0 16 16"><path d="M8 1L2 4v4c0 4 3 7 6 8 3-1 6-4 6-8V4L8 1z" /></svg> NO API
    </span>
  )
}

export function AdminModal({ visible, onClose }: Props) {
  const [tab, setTab] = useState<'users' | 'audit'>('users')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState('')
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState('')
  const [search, setSearch] = useState('')
  const [banMenuOpen, setBanMenuOpen] = useState<string | null>(null)

  const loadUsers = useCallback(() => {
    setUsersLoading(true)
    setUsersError('')
    fetch('/auth/admin/users', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(data => {
        if (!data.ok) { setUsersError('Eroare'); setUsersLoading(false); return }
        setUsers(data.users || [])
        setUsersLoading(false)
      })
      .catch(() => { setUsersError('Eroare de conexiune'); setUsersLoading(false) })
  }, [])

  const loadAudit = useCallback(() => {
    setAuditLoading(true)
    setAuditError('')
    fetch('/auth/admin/audit?limit=50', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(data => {
        if (!data.ok || !data.entries || data.entries.length === 0) {
          setAuditEntries([])
          setAuditLoading(false)
          return
        }
        setAuditEntries(data.entries)
        setAuditLoading(false)
      })
      .catch(() => { setAuditError('Eroare de conexiune'); setAuditLoading(false) })
  }, [])

  const adminPost = useCallback((endpoint: string, body: object) => {
    fetch('/auth/admin/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin'
    }).then(r => r.json())
      .then(() => { loadUsers() })
      .catch(() => { loadUsers() })
  }, [loadUsers])

  // Load users on open
  useEffect(() => {
    if (visible) {
      loadUsers()
      setTab('users')
      setSearch('')
    }
  }, [visible, loadUsers])

  // Load audit when switching to audit tab
  useEffect(() => {
    if (visible && tab === 'audit') loadAudit()
  }, [visible, tab, loadAudit])

  const q = search.toLowerCase().trim()
  const pending = users.filter(u => !u.approved && u.role !== 'admin')
  const active = users.filter(u => u.approved || u.role === 'admin')
  const banned = active.filter(u => u.status === 'banned').length
  const blocked = active.filter(u => u.status === 'blocked').length
  const filteredPending = q ? pending.filter(u => u.email.toLowerCase().includes(q)) : pending
  const filteredActive = q ? active.filter(u => u.email.toLowerCase().includes(q)) : active

  function getActionColor(action?: string) {
    if (!action) return '#ccc'
    if (action.indexOf('BAN') !== -1) return '#ff4444'
    if (action.indexOf('DELETE') !== -1) return '#ff6644'
    if (action.indexOf('BLOCK') !== -1) return '#ff8844'
    if (action.indexOf('APPROVE') !== -1) return '#00ff88'
    if (action.indexOf('LOGIN') !== -1) return '#00afff'
    if (action.indexOf('PASSWORD') !== -1) return '#f0c040'
    if (action.indexOf('REGISTER') !== -1) return '#aa88ff'
    return '#ccc'
  }

  function parseDetails(details?: string) {
    if (!details) return ''
    try { const d = JSON.parse(details); return Object.keys(d).length ? JSON.stringify(d) : '' } catch { return details }
  }

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
            <input id="adminSearch" type="text" placeholder="Caută user..." value={search} onChange={e => setSearch(e.target.value)} style={{
              width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #1a2a3a',
              background: '#0a1018', color: '#ccc', fontSize: 12, outline: 'none', boxSizing: 'border-box'
            }} />
            <div id="adminCounters" style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 10, color: '#556' }}>
              {!usersLoading && !usersError && <>
                <span style={{ color: '#00afff' }}>Total: {users.length}</span>
                {pending.length > 0 && <span style={{ color: '#f0c040' }}><span className="z-dot z-dot--ylw"></span> Pending: {pending.length}</span>}
                {blocked > 0 && <span style={{ color: '#ff8844' }}><span className="z-dot z-dot--ylw"></span> Blocați: {blocked}</span>}
                {banned > 0 && <span style={{ color: '#ff4444' }}><span className="z-dot z-dot--red"></span> Banați: {banned}</span>}
              </>}
            </div>
          </div>

          {usersLoading && <div style={{ color: '#556', padding: '8px 16px' }}>Se încarcă...</div>}
          {usersError && <div style={{ color: '#ff4444', padding: '8px 16px' }}>{usersError}</div>}

          {/* Pending approvals */}
          {filteredPending.length > 0 && (
            <div id="adminPendingSection" style={{ padding: '12px 16px 0' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#f0c040', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                Cereri noi de aprobare
              </div>
              <div id="adminPendingList">
                {filteredPending.map(u => (
                  <div key={u.email} className="adm-card" data-email={u.email} style={{ padding: '10px 12px', background: '#0a1018', border: '1px solid #2a2a10', borderLeft: '3px solid #f0c040', borderRadius: 6, marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: '#eee', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</div>
                        <div style={{ fontSize: 9, color: '#556', marginTop: 2 }}>Înregistrat: {u.createdAt ? new Date(u.createdAt).toLocaleDateString('ro-RO') : '?'}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => adminPost('approve', { email: u.email })} className="adm-btn" style={{ background: '#00ff8822', color: '#00ff88', borderColor: '#00ff8844' }}>✓ APROBĂ</button>
                        <button onClick={() => { if (confirm(`Sigur respingi ${u.email}?`)) adminPost('reject', { email: u.email }) }} className="adm-btn" style={{ background: '#ff444422', color: '#ff4444', borderColor: '#ff444444' }}>✕ RESPINGE</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Existing users */}
          {!usersLoading && !usersError && (
            <div style={{ padding: '12px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#00afff', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                Useri existenți
              </div>
              <div id="adminUsersList" style={{ fontSize: 12 }}>
                {filteredActive.length === 0 ? (
                  <div style={{ color: '#445', fontSize: 11, textAlign: 'center', padding: 12 }}>Niciun user activ</div>
                ) : filteredActive.map(u => {
                  const isAdmin = u.role === 'admin'
                  const isBlocked = u.status === 'blocked'
                  const isBanned = u.status === 'banned'
                  return (
                    <div key={u.email} className="adm-card" data-email={u.email} style={{ padding: '10px 12px', background: '#0a1018', border: '1px solid #1a2a3a', borderRadius: 6, marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ color: '#eee', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220, display: 'inline-block' }}>{u.email}</span>
                            <StatusBadge u={u} />
                            <ExBadge u={u} />
                          </div>
                          <div style={{ fontSize: 9, color: '#445', marginTop: 3 }}>
                            Înregistrat: {u.createdAt ? new Date(u.createdAt).toLocaleDateString('ro-RO') : '?'}
                            {u.exchange && u.exchange.connected && u.exchange.lastVerified ? ' · API verificat: ' + new Date(u.exchange.lastVerified).toLocaleDateString('ro-RO') : ''}
                          </div>
                        </div>
                        {!isAdmin && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                            {/* Block toggle */}
                            {isBlocked ? (
                              <button onClick={() => adminPost('block', { email: u.email, block: false })} className="adm-btn" style={{ background: '#00ff8822', color: '#00ff88', borderColor: '#00ff8844' }}>DEBLOCHEAZĂ</button>
                            ) : !isBanned ? (
                              <button onClick={() => { if (confirm(`Blochezi ${u.email}?`)) adminPost('block', { email: u.email, block: true }) }} className="adm-btn" style={{ background: '#ff880022', color: '#ff8844', borderColor: '#ff884444' }}>BLOCK</button>
                            ) : null}
                            {/* Ban */}
                            {isBanned ? (
                              <button onClick={() => adminPost('block', { email: u.email, block: false })} className="adm-btn" style={{ background: '#00aaff22', color: '#00aaff', borderColor: '#00aaff44' }}>UNBAN</button>
                            ) : (
                              <div style={{ position: 'relative', display: 'inline-block' }}>
                                <button onClick={() => setBanMenuOpen(banMenuOpen === u.email ? null : u.email)} className="adm-btn" style={{ background: '#ff220022', color: '#ff4444', borderColor: '#ff444444' }}>BAN ▾</button>
                                {banMenuOpen === u.email && (
                                  <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: '#0d1520', border: '1px solid #1a2a3a', borderRadius: 6, padding: 4, zIndex: 10, minWidth: 100, boxShadow: '0 4px 12px rgba(0,0,0,.5)' }}>
                                    {[
                                      { dur: '1h', label: '1 oră', color: '#ff8844' },
                                      { dur: '24h', label: '24 ore', color: '#ff6644' },
                                      { dur: '7d', label: '7 zile', color: '#ff4444' },
                                      { dur: '30d', label: '30 zile', color: '#ff2222' },
                                    ].map(opt => (
                                      <div key={opt.dur} onClick={() => { setBanMenuOpen(null); adminPost('ban', { email: u.email, duration: opt.dur }) }}
                                        style={{ padding: '5px 10px', cursor: 'pointer', color: opt.color, fontSize: 10, borderRadius: 4, whiteSpace: 'nowrap' }}
                                        onMouseOver={e => (e.currentTarget.style.background = '#1a2a3a')}
                                        onMouseOut={e => (e.currentTarget.style.background = '')}
                                      >{opt.label}</div>
                                    ))}
                                    <div style={{ borderTop: '1px solid #1a2a3a', margin: '2px 0' }}></div>
                                    <div onClick={() => { setBanMenuOpen(null); if (confirm(`Ban PERMANENT pentru ${u.email}?`)) adminPost('ban', { email: u.email, duration: 'permanent' }) }}
                                      style={{ padding: '5px 10px', cursor: 'pointer', color: '#ff0000', fontSize: 10, fontWeight: 700, borderRadius: 4, whiteSpace: 'nowrap' }}
                                      onMouseOver={e => (e.currentTarget.style.background = '#1a2a3a')}
                                      onMouseOut={e => (e.currentTarget.style.background = '')}
                                    >PERMANENT</div>
                                  </div>
                                )}
                              </div>
                            )}
                            {/* Delete */}
                            <button onClick={() => { if (confirm(`Sigur ștergi ${u.email}?`)) adminPost('delete', { email: u.email }) }} className="adm-btn" style={{ background: '#44111122', color: '#883333', borderColor: '#44111144' }} title="Șterge contul">
                              <svg className="z-i" viewBox="0 0 16 16"><path d="M3 4h10M6 2h4v2M5 4v9h6V4m-4 2v5m2-5v5" /></svg>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* TAB: AUDIT LOG */}
        <div id="adminPanelAudit" style={{ display: tab === 'audit' ? undefined : 'none', padding: '12px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#f0c040', textTransform: 'uppercase', letterSpacing: 1 }}>
              Ultimele acțiuni
            </div>
            <button onClick={loadAudit} style={{
              background: '#00afff22', color: '#00afff', border: '1px solid #00afff44',
              borderRadius: 4, padding: '3px 10px', fontSize: 10, cursor: 'pointer'
            }}>REFRESH</button>
          </div>
          <div id="adminAuditList" style={{ fontSize: 11, color: '#556' }}>
            {auditLoading && <div style={{ color: '#556', padding: 8 }}>Se încarcă...</div>}
            {auditError && <div style={{ color: '#ff4444' }}>{auditError}</div>}
            {!auditLoading && !auditError && auditEntries.length === 0 && (
              <div style={{ color: '#445', textAlign: 'center', padding: 12 }}>Niciun eveniment</div>
            )}
            {!auditLoading && !auditError && auditEntries.map((e, i) => {
              const dt = e.created_at ? new Date(e.created_at + 'Z') : null
              const time = dt ? dt.toLocaleDateString('ro-RO') + ' ' + dt.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '?'
              const details = parseDetails(e.details)
              return (
                <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid #0d1520', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 120, color: '#445', fontSize: 10, flexShrink: 0 }}>{time}</div>
                  <div style={{ minWidth: 170, flexShrink: 0 }}><span style={{ color: getActionColor(e.action), fontWeight: 600, fontSize: 10 }}>{e.action || '?'}</span></div>
                  <div style={{ color: '#778', fontSize: 10, wordBreak: 'break-all' }}>{e.user_id ? `uid:${e.user_id} ` : ''}{details}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </ModalOverlay>
  )
}
