// [2026-11-27] Roles & Permissions — reală (era machetă): membrii din baza, matricea serverului
// (adminRoles.ts = server/services/adminRoles.js, un test cere sa fie identice) si atribuirea rolurilor.
// Doar Super Admin ajunge aici; serverul refuza oricum orice alt apel. Staff fara 2FA nu intra in panou.
import { useState } from 'react'
import { useAdminStore } from '../../../stores/adminStore'
import { PERMISSIONS, ROLE_PERMS } from '../adminRoles'

const ROLES = [
  { id: 'superadmin', name: 'Super Admin', desc: 'You. Everything, including system settings, flags, password and 2FA resets.', color: '#ff4d4d' },
  { id: 'admin', name: 'Admin', desc: 'Manage users: approve, block, ban, delete. No system settings, no password or 2FA resets.', color: '#00d4ff' },
  { id: 'support', name: 'Support', desc: 'See users, audit, sessions and monitoring. Changes nothing.', color: '#b888ff' },
  { id: 'analyst', name: 'Analyst', desc: 'See users, audit and monitoring; export the audit log.', color: '#00ff88' },
]
const LABELS: Record<string, string> = {
  'users.view': 'View users', 'users.edit': 'Approve / edit users', 'users.block': 'Block / suspend', 'users.ban': 'Ban',
  'users.delete': 'Delete users', 'users.force_logout': 'Force logout', 'audit.view': 'View audit log', 'audit.export': 'Export audit',
  'security.sessions': 'View sessions', 'security.terminate': 'Terminate sessions', 'monitoring.view': 'View monitoring',
  'settings.edit': 'Edit settings', 'settings.flags': 'Toggle feature flags', 'billing.view': 'View billing',
  'billing.manage': 'Manage plans', 'emergency.lock': 'Emergency lock',
}
const permsOf = (id: string) => (id === 'superadmin' ? PERMISSIONS : ROLE_PERMS[id] || [])

export function RolesSection() {
  const users = useAdminStore((s) => s.users)
  const loadUsers = useAdminStore((s) => s.loadUsers)
  const [who, setWho] = useState('')
  const [role, setRole] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const count = (id: string) => users.filter((u) => (id === 'superadmin' ? u.role === 'admin' : u.role !== 'admin' && u.staffRole === id)).length
  const assignable = users.filter((u) => u.role !== 'admin' && u.status === 'active')
  const staff = users.filter((u) => u.role !== 'admin' && u.staffRole && ROLE_PERMS[u.staffRole])

  async function save() {
    if (!who) return
    setBusy(true); setMsg('')
    try {
      const r = await fetch('/auth/admin/staff-role', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Zeus-Request': '1' },
        body: JSON.stringify({ email: who, staffRole: role || null }),
      })
      const d = await r.json().catch(() => ({}))
      if (d && d.ok) { setMsg(role ? `${who} is now ${role}. They need two-factor authentication on to open the admin panel.` : `${who} has no staff role now.`); void loadUsers?.() }
      else setMsg((d && d.error) || 'Not saved — try again.')
    } catch { setMsg('Not saved — try again.') } finally { setBusy(false) }
  }

  return (
    <>
      <div className="zac-panel">
        <div className="zac-panel-header">
          <div className="zac-panel-title">Roles</div>
          <span className="zac-panel-sub">checked by the server on every admin action</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
          {ROLES.map((r) => (
            <div key={r.id} style={{ padding: 14, background: 'var(--ac-bg-2)', border: '1px solid var(--ac-border)', borderRadius: 6, borderLeft: `3px solid ${r.color}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: r.color }}>{r.name}</div>
              <div style={{ fontSize: 10, color: 'var(--ac-fg-dim)', marginTop: 6, minHeight: 30 }}>{r.desc}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 9, color: 'var(--ac-fg-mute)' }}>
                <span>Members: <b data-role-count={r.id} style={{ color: 'var(--ac-fg)' }}>{count(r.id)}</b></span>
                <span>Permissions: <b style={{ color: 'var(--ac-fg)' }}>{permsOf(r.id).length}</b></span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="zac-panel">
        <div className="zac-panel-header">
          <div className="zac-panel-title">Give a staff role</div>
          <span className="zac-panel-sub">staff must turn on two-factor authentication before the admin panel opens for them</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <select data-assign="user" className="zac-input" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Choose an account…</option>
            {assignable.map((u) => <option key={u.id} value={u.email}>{u.email}{u.staffRole ? ` (${u.staffRole})` : ''}</option>)}
          </select>
          <select data-assign="role" className="zac-input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">No role</option>
            <option value="admin">Admin</option>
            <option value="support">Support</option>
            <option value="analyst">Analyst</option>
          </select>
          <button className="zac-btn zac-btn-primary" disabled={busy || !who} onClick={save}>Save role</button>
        </div>
        {msg && <div role="status" style={{ fontSize: 11, color: 'var(--ac-fg-dim)', marginTop: 8 }}>{msg}</div>}
        {staff.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--ac-fg-dim)', marginTop: 10 }}>
            Staff now: {staff.map((u) => `${u.email} (${u.staffRole})`).join(', ')}
          </div>
        )}
      </div>

      <div className="zac-panel">
        <div className="zac-panel-header">
          <div className="zac-panel-title">Permissions</div>
          <span className="zac-panel-sub">the same table the server enforces</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="zac-table" style={{ minWidth: 600 }}>
            <thead>
              <tr>
                <th style={{ width: 200 }}>Permission</th>
                {ROLES.map((r) => <th key={r.id} style={{ textAlign: 'center', color: r.color }}>{r.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((p) => (
                <tr key={p}>
                  <td>
                    <div style={{ fontSize: 11, color: 'var(--ac-fg)' }}>{LABELS[p] || p}</div>
                    <div style={{ fontSize: 9, color: 'var(--ac-fg-mute)', fontFamily: 'monospace' }}>{p}</div>
                  </td>
                  {ROLES.map((r) => {
                    const has = permsOf(r.id).includes(p)
                    return (
                      <td key={r.id} style={{ textAlign: 'center' }}>
                        <span data-perm={`${r.id}:${p}`} style={{ color: has ? r.color : 'var(--ac-fg-mute)', fontSize: 14 }}>{has ? '●' : '○'}</span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
