import { useEffect, useMemo, useState } from 'react'
import { useAdminStore, type AdminUser } from '../../../stores/adminStore'
import { StatusBadge, ApiBadge, LoadingSkeleton, EmptyState, ConfirmDialog, fmtDate } from '../shared/components'

export function UsersSection() {
  const users = useAdminStore((s) => s.users)
  const usersLoading = useAdminStore((s) => s.usersLoading)
  const usersError = useAdminStore((s) => s.usersError)
  const search = useAdminStore((s) => s.search)
  const setSearch = useAdminStore((s) => s.setSearch)
  const filters = useAdminStore((s) => s.userFilters)
  const setFilters = useAdminStore((s) => s.setUserFilters)
  const loadUsers = useAdminStore((s) => s.loadUsers)
  const doAction = useAdminStore((s) => s.doAction)
  const setSelectedUser = useAdminStore((s) => s.setSelectedUser)

  const [confirm, setConfirm] = useState<null | { title: string; message: string; confirmText: string; tone: 'default' | 'danger' | 'gold'; requireType?: string; onConfirm: () => Promise<void> }>(null)
  const [banMenuFor, setBanMenuFor] = useState<string | null>(null)
  const [toast, setToast] = useState<string>('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [tempPasswordShow, setTempPasswordShow] = useState<{ email: string; pw: string } | null>(null)

  useEffect(() => { if (users.length === 0 && !usersLoading) loadUsers() }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    let out = users.slice()
    if (q) out = out.filter((u) => u.email.toLowerCase().includes(q) || String(u.id).includes(q))
    if (filters.status !== 'all') {
      out = out.filter((u) => {
        if (filters.status === 'pending') return !u.approved && u.role !== 'admin'
        if (filters.status === 'suspended') return u.status === 'blocked' // mapped via reason (placeholder)
        return u.status === filters.status
      })
    }
    if (filters.role !== 'all') out = out.filter((u) => u.role === filters.role)
    if (filters.api === 'ready') out = out.filter((u) => u.exchange?.connected)
    if (filters.api === 'none') out = out.filter((u) => !u.exchange?.connected)
    if (filters.mode !== 'all') {
      out = out.filter((u) => {
        if (filters.mode === 'demo') return !u.exchange?.connected
        return u.exchange?.mode === filters.mode
      })
    }
    if (filters.sort === 'newest') out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    if (filters.sort === 'oldest') out.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
    if (filters.sort === 'email') out.sort((a, b) => a.email.localeCompare(b.email))
    if (filters.sort === 'status') out.sort((a, b) => (a.status || '').localeCompare(b.status || ''))
    return out
  }, [users, search, filters])

  async function runAction(endpoint: string, body: object, msg: string) {
    const res = await doAction(endpoint, body)
    if (!res.ok) setToast('✕ ' + (res.error || 'Action failed'))
    else setToast('✓ ' + msg)
    setTimeout(() => setToast(''), 3000)
  }

  function toggleSel(id: number) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function toggleAllSel() {
    const ids = filtered.filter((u) => u.role !== 'admin').map((u) => u.id)
    setSelected((s) => s.size === ids.length ? new Set() : new Set(ids))
  }

  async function runBulk(action: 'force-logout' | 'approve' | 'block' | 'unblock', label: string) {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    try {
      const r = await fetch('/auth/admin/bulk', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ids }),
      })
      const d = await r.json()
      if (d.ok) { setToast(`✓ ${label}: ${d.results.ok} ok, ${d.results.skipped} skipped`); setSelected(new Set()); loadUsers() }
      else setToast('✕ ' + (d.error || 'Bulk failed'))
    } catch (e: any) { setToast('✕ ' + (e.message || 'Network error')) }
    setTimeout(() => setToast(''), 3500)
  }

  async function resetPassword(email: string) {
    try {
      const r = await fetch('/auth/admin/reset-password', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const d = await r.json()
      if (d.ok && d.tempPassword) { setTempPasswordShow({ email, pw: d.tempPassword }); loadUsers() }
      else { setToast('✕ ' + (d.error || 'Reset failed')); setTimeout(() => setToast(''), 3000) }
    } catch (e: any) { setToast('✕ ' + (e.message || 'Network error')); setTimeout(() => setToast(''), 3000) }
  }

  return (
    <>
      {/* Filters bar */}
      <div className="zac-filters">
        <input
          className="zac-input"
          placeholder="Search email or id…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="zac-select" value={filters.status} onChange={(e) => setFilters({ status: e.target.value as any })}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="pending">Pending</option>
          <option value="blocked">Blocked</option>
          <option value="banned">Banned</option>
        </select>
        <select className="zac-select" value={filters.role} onChange={(e) => setFilters({ role: e.target.value as any })}>
          <option value="all">All roles</option>
          <option value="admin">Admin</option>
          <option value="user">User</option>
        </select>
        <select className="zac-select" value={filters.api} onChange={(e) => setFilters({ api: e.target.value as any })}>
          <option value="all">API any</option>
          <option value="ready">API configured</option>
          <option value="none">No API</option>
        </select>
        <select className="zac-select" value={filters.mode} onChange={(e) => setFilters({ mode: e.target.value as any })}>
          <option value="all">All modes</option>
          <option value="live">Live</option>
          <option value="testnet">Testnet</option>
          <option value="demo">Demo only</option>
        </select>
        <select className="zac-select" value={filters.sort} onChange={(e) => setFilters({ sort: e.target.value as any })}>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="email">Email A-Z</option>
          <option value="status">Status</option>
        </select>
        <button className="zac-btn zac-btn-ghost" onClick={loadUsers}>↻</button>
      </div>

      {/* Table */}
      <div className="zac-panel" style={{ padding: 0 }}>
        <div className="zac-panel-header" style={{ padding: '14px 18px', margin: 0 }}>
          <div className="zac-panel-title">Users ({filtered.length}{filtered.length !== users.length ? ` of ${users.length}` : ''})</div>
          {selected.size > 0 ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--ac-gold)', letterSpacing: 1 }}>{selected.size} selected</span>
              <button className="zac-btn zac-btn-sm" onClick={() => runBulk('approve', 'Approve')}>Approve</button>
              <button className="zac-btn zac-btn-gold zac-btn-sm" onClick={() => runBulk('block', 'Block')}>Block</button>
              <button className="zac-btn zac-btn-sm" onClick={() => runBulk('unblock', 'Unblock')}>Unblock</button>
              <button className="zac-btn zac-btn-sm" onClick={() => runBulk('force-logout', 'Force logout')}>⏻ Logout</button>
              <button className="zac-btn zac-btn-ghost zac-btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          ) : (
            <span style={{ fontSize: 9, color: 'var(--ac-fg-mute)' }}>select rows for bulk actions</span>
          )}
        </div>
        {usersLoading && <div style={{ padding: 18 }}><LoadingSkeleton rows={6} /></div>}
        {usersError && <div style={{ padding: 18, color: 'var(--ac-danger)' }}>Error: {usersError}</div>}
        {!usersLoading && !usersError && filtered.length === 0 && <EmptyState message="No users match these filters" />}
        {!usersLoading && !usersError && filtered.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="zac-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    <input type="checkbox"
                      checked={filtered.filter((u) => u.role !== 'admin').length > 0 && selected.size === filtered.filter((u) => u.role !== 'admin').length}
                      onChange={toggleAllSel}
                      title="Select all (non-admin)"
                    />
                  </th>
                  <th>Email</th>
                  <th>ID</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>API / Mode</th>
                  <th>Registered</th>
                  <th style={{ width: 220, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <UserRow
                    key={u.id}
                    u={u}
                    selected={selected.has(u.id)}
                    onToggleSelect={() => toggleSel(u.id)}
                    onOpen={() => setSelectedUser(u.id)}
                    onBlock={() => { setConfirm({ title: 'Block user', message: `Block ${u.email}?\n\nThey won't be able to login until unblocked.`, confirmText: 'Block', tone: 'gold', onConfirm: async () => { setConfirm(null); await runAction('block', { email: u.email, block: true }, `Blocked ${u.email}`) } }) }}
                    onUnblock={() => runAction('block', { email: u.email, block: false }, `Unblocked ${u.email}`)}
                    onUnban={() => runAction('block', { email: u.email, block: false }, `Unbanned ${u.email}`)}
                    onBanPicker={() => setBanMenuFor(banMenuFor === u.email ? null : u.email)}
                    banPickerOpen={banMenuFor === u.email}
                    onPickBan={(dur) => { setBanMenuFor(null); if (dur === 'permanent') { setConfirm({ title: 'Permanent ban', message: `Ban ${u.email} PERMANENTLY?\n\nThis is a strong action. User can be unbanned later but the audit will remain.`, confirmText: 'Ban permanently', tone: 'danger', requireType: u.email, onConfirm: async () => { setConfirm(null); await runAction('ban', { email: u.email, duration: 'permanent' }, `Banned ${u.email} permanently`) } }) } else { void runAction('ban', { email: u.email, duration: dur }, `Banned ${u.email} (${dur})`) } }}
                    onApprove={() => runAction('approve', { email: u.email }, `Approved ${u.email}`)}
                    onReject={() => { setConfirm({ title: 'Reject user', message: `Reject pending user ${u.email}?\n\nTheir account will be deleted.`, confirmText: 'Reject', tone: 'danger', onConfirm: async () => { setConfirm(null); await runAction('reject', { email: u.email }, `Rejected ${u.email}`) } }) }}
                    onDelete={() => { setConfirm({ title: 'Delete user', message: `Delete ${u.email}?\n\nThis permanently removes the account and exchange keys. Irreversible.`, confirmText: 'Delete permanently', tone: 'danger', requireType: u.email, onConfirm: async () => { setConfirm(null); await runAction('delete', { email: u.email }, `Deleted ${u.email}`) } }) }}
                    onForceLogout={() => { setConfirm({ title: 'Force logout', message: `Force logout ${u.email}?\n\nAll their active sessions will be invalidated.`, confirmText: 'Force logout', tone: 'gold', onConfirm: async () => { setConfirm(null); await runAction('force-logout', { email: u.email }, `Forced logout ${u.email}`) } }) }}
                    onSuspend={() => { setConfirm({ title: 'Suspend user', message: `Suspend ${u.email}?\n\nSimilar to block but flagged as temporary operational suspension.`, confirmText: 'Suspend', tone: 'gold', onConfirm: async () => { setConfirm(null); await runAction('suspend', { email: u.email, reason: 'admin_suspend' }, `Suspended ${u.email}`) } }) }}
                    onResetPassword={() => { setConfirm({ title: 'Reset password', message: `Generate a temporary password for ${u.email}?\n\nA random password will be set and all sessions invalidated. The temp password is shown once — communicate it via a secure channel.`, confirmText: 'Reset password', tone: 'gold', onConfirm: async () => { setConfirm(null); await resetPassword(u.email) } }) }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirm dialog */}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmText={confirm.confirmText}
          tone={confirm.tone}
          requireType={confirm.requireType}
          onConfirm={() => { void confirm.onConfirm() }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Temp password display */}
      {tempPasswordShow && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 9900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#0d1520', border: '1px solid var(--ac-gold)', borderRadius: 8, padding: 24, maxWidth: 460, boxShadow: '0 12px 40px rgba(0,0,0,.7)' }}>
            <div style={{ color: 'var(--ac-gold)', fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>Temporary password generated</div>
            <div style={{ fontSize: 11, color: 'var(--ac-fg-dim)', marginBottom: 6 }}>For <b style={{ color: 'var(--ac-fg)' }}>{tempPasswordShow.email}</b>:</div>
            <div style={{ fontFamily: 'monospace', fontSize: 18, background: '#000', color: 'var(--ac-gold)', padding: '12px 14px', borderRadius: 4, border: '1px dashed #d4af37', userSelect: 'all' }}>{tempPasswordShow.pw}</div>
            <div style={{ fontSize: 10, color: 'var(--ac-fg-mute)', margin: '10px 0 16px' }}>
              Shown <b style={{ color: 'var(--ac-danger)' }}>once</b>. All sessions for this user have been invalidated. Share via a secure channel.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="zac-btn zac-btn-sm" onClick={() => { navigator.clipboard?.writeText(tempPasswordShow.pw); setToast('✓ Copied'); setTimeout(() => setToast(''), 2000) }}>Copy</button>
              <button className="zac-btn zac-btn-primary zac-btn-sm" onClick={() => setTempPasswordShow(null)}>I have saved it</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: toast.startsWith('✓') ? '#003a20' : '#3a0020',
          border: '1px solid ' + (toast.startsWith('✓') ? '#00ff88' : '#ff4d4d'),
          color: toast.startsWith('✓') ? '#00ff88' : '#ff8888',
          padding: '10px 16px', borderRadius: 6, fontSize: 11,
          letterSpacing: 1, zIndex: 9800, boxShadow: '0 4px 16px rgba(0,0,0,.5)'
        }}>{toast}</div>
      )}
    </>
  )
}

function UserRow({
  u, selected, onToggleSelect, onOpen, onBlock, onUnblock, onBanPicker, banPickerOpen, onPickBan, onUnban,
  onApprove, onReject, onDelete, onForceLogout, onSuspend, onResetPassword,
}: {
  u: AdminUser
  selected: boolean
  onToggleSelect: () => void
  onOpen: () => void
  onBlock: () => void
  onUnblock: () => void
  onBanPicker: () => void
  banPickerOpen: boolean
  onPickBan: (dur: string) => void
  onUnban: () => void
  onApprove: () => void
  onReject: () => void
  onDelete: () => void
  onForceLogout: () => void
  onSuspend: () => void
  onResetPassword: () => void
}) {
  const isAdmin = u.role === 'admin'
  const isBlocked = u.status === 'blocked'
  const isBanned = u.status === 'banned'
  const isPending = !u.approved && !isAdmin

  return (
    <tr onClick={onOpen}>
      <td onClick={(e) => e.stopPropagation()}>
        {!isAdmin && (
          <input type="checkbox" checked={selected} onChange={onToggleSelect} />
        )}
      </td>
      <td>
        <span style={{ fontWeight: 600 }}>{u.email}</span>
      </td>
      <td style={{ color: 'var(--ac-fg-mute)', fontSize: 10 }}>#{u.id}</td>
      <td><StatusBadge u={u} /></td>
      <td>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {isAdmin && <span className="zac-b zac-b-admin">ADMIN</span>}
          {!isAdmin && isBanned && <span className="zac-b zac-b-banned">BANNED</span>}
          {!isAdmin && !isBanned && isBlocked && <span className="zac-b zac-b-blocked">BLOCKED</span>}
          {!isAdmin && !isBanned && !isBlocked && isPending && <span className="zac-b zac-b-pending">PENDING</span>}
          {!isAdmin && !isBanned && !isBlocked && !isPending && <span className="zac-b zac-b-active">ACTIVE</span>}
        </div>
      </td>
      <td><ApiBadge u={u} /></td>
      <td style={{ fontSize: 10, color: 'var(--ac-fg-dim)' }}>{fmtDate(u.createdAt)}</td>
      <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
        <div style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {isPending && (
            <>
              <button className="zac-btn zac-btn-primary zac-btn-sm" onClick={onApprove}>Approve</button>
              <button className="zac-btn zac-btn-danger zac-btn-sm" onClick={onReject}>Reject</button>
            </>
          )}
          {!isAdmin && !isPending && (
            <>
              <button className="zac-btn zac-btn-sm" onClick={onOpen}>View</button>
              {isBanned ? (
                <button className="zac-btn zac-btn-primary zac-btn-sm" onClick={onUnban}>Unban</button>
              ) : (
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <button className="zac-btn zac-btn-danger zac-btn-sm" onClick={onBanPicker}>Ban ▾</button>
                  {banPickerOpen && (
                    <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: '#0d1520', border: '1px solid #223146', borderRadius: 6, padding: 4, zIndex: 20, minWidth: 120, boxShadow: '0 6px 20px rgba(0,0,0,.6)' }}>
                      {[
                        { dur: '1h', label: '1 hour' },
                        { dur: '24h', label: '24 hours' },
                        { dur: '7d', label: '7 days' },
                        { dur: '30d', label: '30 days' },
                      ].map((opt) => (
                        <div key={opt.dur} onClick={() => onPickBan(opt.dur)} style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 10, borderRadius: 4, color: '#ff8844' }} onMouseOver={(e) => (e.currentTarget.style.background = '#1a2a3a')} onMouseOut={(e) => (e.currentTarget.style.background = '')}>{opt.label}</div>
                      ))}
                      <div style={{ borderTop: '1px solid #223146', margin: '2px 0' }} />
                      <div onClick={() => onPickBan('permanent')} style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 10, color: '#ff4444', fontWeight: 700, borderRadius: 4 }} onMouseOver={(e) => (e.currentTarget.style.background = '#1a2a3a')} onMouseOut={(e) => (e.currentTarget.style.background = '')}>Permanent</div>
                    </div>
                  )}
                </div>
              )}
              {isBlocked ? (
                <button className="zac-btn zac-btn-primary zac-btn-sm" onClick={onUnblock}>Unblock</button>
              ) : !isBanned ? (
                <button className="zac-btn zac-btn-gold zac-btn-sm" onClick={onBlock}>Block</button>
              ) : null}
              {!isBanned && !isBlocked && <button className="zac-btn zac-btn-gold zac-btn-sm" onClick={onSuspend} title="Temporary operational suspend">Suspend</button>}
              <button className="zac-btn zac-btn-sm" onClick={onForceLogout} title="Invalidate all sessions">⏻</button>
              <button className="zac-btn zac-btn-sm" onClick={onResetPassword} title="Reset password — generates temp password">⟲</button>
              <button className="zac-btn zac-btn-danger zac-btn-sm" onClick={onDelete} title="Delete account">✕</button>
            </>
          )}
        </div>
      </td>
    </tr>
  )
}
