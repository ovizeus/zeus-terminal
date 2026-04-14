import { useEffect, useState } from 'react'
import { Placeholder, fmtRelative, actionColor } from '../shared/components'
import { useAdminStore } from '../../../stores/adminStore'

// ═══════════════════════════════════════════════════════════════════════════
// ROLES & PERMISSIONS
// ═══════════════════════════════════════════════════════════════════════════

interface RoleDef {
  id: string
  name: string
  desc: string
  color: string
}

const ROLES: RoleDef[] = [
  { id: 'superadmin', name: 'Super Admin', desc: 'Full access, system control, emergency tools', color: '#ff4d4d' },
  { id: 'admin', name: 'Admin', desc: 'Users, audit, operations', color: '#00d4ff' },
  { id: 'support', name: 'Support', desc: 'Read-only user ops, account repair', color: '#b888ff' },
  { id: 'analyst', name: 'Analyst', desc: 'View audit, monitoring, export', color: '#00ff88' },
]

const PERMISSIONS: Array<{ key: string; label: string; group: string }> = [
  { key: 'users.view', label: 'View users', group: 'Users' },
  { key: 'users.edit', label: 'Edit users', group: 'Users' },
  { key: 'users.block', label: 'Block users', group: 'Users' },
  { key: 'users.ban', label: 'Ban users', group: 'Users' },
  { key: 'users.delete', label: 'Delete users', group: 'Users' },
  { key: 'users.force_logout', label: 'Force logout', group: 'Users' },
  { key: 'audit.view', label: 'View audit log', group: 'Audit' },
  { key: 'audit.export', label: 'Export audit', group: 'Audit' },
  { key: 'security.sessions', label: 'View sessions', group: 'Security' },
  { key: 'security.terminate', label: 'Terminate sessions', group: 'Security' },
  { key: 'monitoring.view', label: 'View monitoring', group: 'Monitoring' },
  { key: 'settings.edit', label: 'Edit settings', group: 'System' },
  { key: 'settings.flags', label: 'Toggle feature flags', group: 'System' },
  { key: 'billing.view', label: 'View billing', group: 'Billing' },
  { key: 'billing.manage', label: 'Manage plans', group: 'Billing' },
  { key: 'emergency.lock', label: 'Emergency lock', group: 'Emergency' },
]

// Default matrix reflects intended Faza C design; checkbox toggles are disabled
// until backend roles table is provisioned.
const DEFAULT_MATRIX: Record<string, string[]> = {
  superadmin: PERMISSIONS.map((p) => p.key),
  admin: ['users.view', 'users.edit', 'users.block', 'users.ban', 'users.delete', 'users.force_logout', 'audit.view', 'audit.export', 'security.sessions', 'security.terminate', 'monitoring.view'],
  support: ['users.view', 'audit.view', 'security.sessions', 'monitoring.view'],
  analyst: ['users.view', 'audit.view', 'audit.export', 'monitoring.view'],
}

export function RolesSection() {
  const users = useAdminStore((s) => s.users)
  const adminCount = users.filter((u) => u.role === 'admin').length
  const userCount = users.filter((u) => u.role !== 'admin').length
  const memberCounts: Record<string, number> = { superadmin: 0, admin: adminCount, support: 0, analyst: 0 }

  return (
    <>
      <div className="zac-panel">
        <div className="zac-panel-header">
          <div className="zac-panel-title">Roles</div>
          <span className="zac-panel-sub">{users.length} total users · {adminCount} admin · {userCount} user</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
          {ROLES.map((r) => (
            <div key={r.id} style={{ padding: 14, background: 'var(--ac-bg-2)', border: '1px solid var(--ac-border)', borderRadius: 6, borderLeft: `3px solid ${r.color}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: r.color }}>{r.name}</div>
              <div style={{ fontSize: 10, color: 'var(--ac-fg-dim)', marginTop: 6, minHeight: 30 }}>{r.desc}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 9, color: 'var(--ac-fg-mute)' }}>
                <span>Members: <b style={{ color: 'var(--ac-fg)' }}>{memberCounts[r.id] ?? 0}</b></span>
                <span>Permissions: <b style={{ color: 'var(--ac-fg)' }}>{DEFAULT_MATRIX[r.id]?.length ?? 0}</b></span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="zac-panel">
        <div className="zac-panel-header">
          <div className="zac-panel-title">Permissions Matrix</div>
          <span className="zac-panel-sub">default mapping — read-only until backend binding</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="zac-table" style={{ minWidth: 700 }}>
            <thead>
              <tr>
                <th style={{ width: 220 }}>Permission</th>
                {ROLES.map((r) => (
                  <th key={r.id} style={{ textAlign: 'center', color: r.color }}>{r.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((p) => (
                <tr key={p.key}>
                  <td>
                    <div style={{ fontSize: 10, color: 'var(--ac-fg-mute)', letterSpacing: 1 }}>{p.group.toUpperCase()}</div>
                    <div style={{ fontSize: 11, color: 'var(--ac-fg)' }}>{p.label}</div>
                    <div style={{ fontSize: 9, color: 'var(--ac-fg-mute)', fontFamily: 'monospace' }}>{p.key}</div>
                  </td>
                  {ROLES.map((r) => {
                    const has = DEFAULT_MATRIX[r.id]?.includes(p.key)
                    return (
                      <td key={r.id} style={{ textAlign: 'center' }}>
                        <span style={{ color: has ? r.color : 'var(--ac-fg-mute)', fontSize: 14 }}>{has ? '●' : '○'}</span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 14, padding: 10, background: 'var(--ac-gold-dim)', border: '1px solid #f0c04044', borderRadius: 4, fontSize: 10, color: 'var(--ac-gold)' }}>
          <strong>NOTE:</strong> current backend recognises only <code>admin</code> / <code>user</code>. Granular roles require a roles table migration, planned for Faza C.
        </div>
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY — sessions, admin actions, failed logins
// ═══════════════════════════════════════════════════════════════════════════

interface Session {
  userId: number
  email: string
  role: string
  status: string
  lastActive: string
  idleMs: number
}

export function SecuritySection() {
  const audit = useAdminStore((s) => s.audit)
  const [sessions, setSessions] = useState<Session[]>([])
  const [sLoading, setSLoading] = useState(false)
  const [sError, setSError] = useState('')

  useEffect(() => {
    setSLoading(true)
    fetch('/auth/admin/sessions', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => { if (d.ok) setSessions(d.sessions || []); else setSError(d.error || 'Load error'); setSLoading(false) })
      .catch((e) => { setSError(e.message || 'Network error'); setSLoading(false) })
  }, [])

  const logins = audit.filter((e) => (e.action || '').includes('LOGIN') && !(e.action || '').includes('FAILED')).slice(0, 15)
  const failed = audit.filter((e) => (e.action || '').includes('FAILED')).slice(0, 15)
  const admins = audit.filter((e) => (e.action || '').startsWith('ADMIN_')).slice(0, 20)
  const passwords = audit.filter((e) => (e.action || '').includes('PASSWORD')).slice(0, 10)

  return (
    <>
      <div className="zac-kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
        <SmallKpi label="Active sessions" value={sessions.length} tone="default" />
        <SmallKpi label="Admin actions (shown)" value={admins.length} tone="default" />
        <SmallKpi label="Failed attempts" value={failed.length} tone={failed.length > 0 ? 'warn' : 'mute'} />
        <SmallKpi label="Password events" value={passwords.length} tone="default" />
      </div>

      <div className="zac-panel" style={{ padding: 0 }}>
        <div className="zac-panel-header" style={{ padding: '14px 18px', margin: 0 }}>
          <div className="zac-panel-title">Active Sessions</div>
          <span className="zac-panel-sub">in-memory tracking · resets on server restart</span>
        </div>
        {sLoading && <div style={{ padding: 14, fontSize: 11, color: 'var(--ac-fg-mute)' }}>Loading…</div>}
        {sError && <div style={{ padding: 14, fontSize: 11, color: 'var(--ac-danger)' }}>{sError}</div>}
        {!sLoading && !sError && sessions.length === 0 && <div style={{ padding: 14, fontSize: 11, color: 'var(--ac-fg-mute)' }}>No active sessions</div>}
        {!sLoading && !sError && sessions.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="zac-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th style={{ width: 90 }}>ID</th>
                  <th style={{ width: 100 }}>Role</th>
                  <th style={{ width: 140 }}>Last Active</th>
                  <th style={{ width: 100 }}>Idle</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.userId}>
                    <td>{s.email}</td>
                    <td style={{ color: 'var(--ac-fg-mute)' }}>#{s.userId}</td>
                    <td><span className={s.role === 'admin' ? 'zac-b zac-b-admin' : 'zac-b zac-b-demo'}>{s.role.toUpperCase()}</span></td>
                    <td style={{ fontSize: 10, color: 'var(--ac-fg-dim)' }}>{fmtRelative(s.lastActive)}</td>
                    <td style={{ fontSize: 10, color: s.idleMs > 1800000 ? 'var(--ac-gold)' : 'var(--ac-fg-dim)' }}>{formatIdle(s.idleMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TwoColumn>
        <EventsPanel title="Recent Admin Actions" events={admins} />
        <EventsPanel title="Login Activity" events={logins} />
      </TwoColumn>
      <TwoColumn>
        <EventsPanel title="Failed Attempts" events={failed} tone="warn" />
        <EventsPanel title="Password Events" events={passwords} />
      </TwoColumn>
    </>
  )
}

function SmallKpi({ label, value, tone }: { label: string; value: number; tone?: 'default' | 'warn' | 'mute' }) {
  return (
    <div className="zac-kpi" data-tone={tone} style={{ padding: '10px 12px' }}>
      <div className="zac-kpi-label" style={{ fontSize: 8, marginBottom: 4 }}>{label}</div>
      <div className="zac-kpi-value" style={{ fontSize: 20 }}>{value}</div>
    </div>
  )
}

function TwoColumn({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>{children}</div>
}

function EventsPanel({ title, events, tone }: { title: string; events: any[]; tone?: 'warn' }) {
  return (
    <div className="zac-panel" style={{ padding: 0 }}>
      <div className="zac-panel-header" style={{ padding: '12px 14px', margin: 0 }}>
        <div className="zac-panel-title" style={{ color: tone === 'warn' ? 'var(--ac-gold)' : undefined }}>{title}</div>
      </div>
      <div style={{ maxHeight: 280, overflowY: 'auto' }}>
        {events.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--ac-fg-mute)', padding: '10px 14px' }}>No events</div>
        ) : events.map((e, i) => (
          <div key={i} style={{ padding: '6px 14px', borderBottom: '1px solid #0f1725', fontSize: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ color: actionColor(e.action), fontWeight: 700, letterSpacing: 1 }}>{e.action}</span>
              <span style={{ color: 'var(--ac-fg-mute)' }}>{fmtRelative(e.created_at)}</span>
            </div>
            <div style={{ color: 'var(--ac-fg-dim)', wordBreak: 'break-all' }}>
              {e.user_id ? `uid:${e.user_id} ` : ''}{(e.details || '').slice(0, 120)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatIdle(ms: number) {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

// ═══════════════════════════════════════════════════════════════════════════
// BILLING — plans scaffolded
// ═══════════════════════════════════════════════════════════════════════════

interface PlanDef {
  id: string
  name: string
  price: string
  color: string
  features: string[]
}

const PLANS: PlanDef[] = [
  { id: 'trial', name: 'Trial', price: 'Free', color: '#8791a3', features: ['Demo mode', '7 days', 'Community support'] },
  { id: 'starter', name: 'Starter', price: '$29/mo', color: '#00d4ff', features: ['Live trading', 'DSL engine', 'Standard support'] },
  { id: 'pro', name: 'Pro', price: '$99/mo', color: '#b888ff', features: ['AT engine', 'ARES + DSL Brain', 'Priority support'] },
  { id: 'enterprise', name: 'Enterprise', price: 'Custom', color: '#f0c040', features: ['Multi-account', 'Dedicated infra', 'SLA'] },
]

export function BillingSection() {
  return (
    <>
      <div className="zac-panel">
        <div className="zac-panel-header">
          <div className="zac-panel-title">Plans Overview</div>
          <span className="zac-panel-sub">scaffolded — users have no plan field yet</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          {PLANS.map((p) => (
            <div key={p.id} style={{ padding: 14, background: 'var(--ac-bg-2)', border: '1px solid var(--ac-border)', borderRadius: 6, borderTop: `3px solid ${p.color}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: p.color }}>{p.name}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ac-fg)' }}>{p.price}</div>
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', fontSize: 10, color: 'var(--ac-fg-dim)' }}>
                {p.features.map((f) => <li key={f} style={{ padding: '2px 0' }}>· {f}</li>)}
              </ul>
              <div style={{ marginTop: 10, fontSize: 9, color: 'var(--ac-fg-mute)' }}>Members: <b style={{ color: 'var(--ac-fg)' }}>—</b></div>
            </div>
          ))}
        </div>
      </div>
      <div className="zac-panel">
        <div className="zac-panel-header"><div className="zac-panel-title">Invoices & Renewals</div></div>
        <Placeholder title="Billing backend" note="Plans, invoices, renewals, refunds and failed-billing tracking require a billing provider and a plans table. UI is scaffolded." />
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// SUPPORT — workspace scaffold
// ═══════════════════════════════════════════════════════════════════════════

export function SupportSection() {
  const users = useAdminStore((s) => s.users)
  const setSection = useAdminStore((s) => s.setSection)

  return (
    <>
      <div className="zac-panel">
        <div className="zac-panel-header"><div className="zac-panel-title">Quick Support Tools</div></div>
        <div className="zac-qa-grid">
          <div className="zac-qa" onClick={() => setSection('users')}>
            <span className="zac-qa-ico">◐</span>
            <span className="zac-qa-label">Find User</span>
          </div>
          <div className="zac-qa" onClick={() => setSection('audit')}>
            <span className="zac-qa-ico">☰</span>
            <span className="zac-qa-label">Audit Trail</span>
          </div>
          <div className="zac-qa" onClick={() => setSection('security')}>
            <span className="zac-qa-ico">⬡</span>
            <span className="zac-qa-label">Sessions</span>
          </div>
        </div>
      </div>
      <div className="zac-panel">
        <div className="zac-panel-header"><div className="zac-panel-title">User Directory ({users.length})</div></div>
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          {users.slice(0, 25).map((u) => (
            <div key={u.id} style={{ padding: '6px 10px', fontSize: 11, borderBottom: '1px solid #0f1725', display: 'flex', justifyContent: 'space-between' }}>
              <span>{u.email}</span>
              <span style={{ color: 'var(--ac-fg-mute)', fontSize: 9 }}>#{u.id} · {u.status}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="zac-panel">
        <div className="zac-panel-header"><div className="zac-panel-title">Support Cases</div></div>
        <Placeholder title="Support cases, resync tools, repair actions" note="Case tracker + one-click resync/repair flows arrive in Faza C. The user list and audit search above cover routine triage today." />
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MONITORING
// ═══════════════════════════════════════════════════════════════════════════

export function MonitoringSection() {
  const health = useAdminStore((s) => s.health)
  const loadHealth = useAdminStore((s) => s.loadHealth)
  useEffect(() => { if (!health) loadHealth() }, [])

  return (
    <>
      <div className="zac-panel">
        <div className="zac-panel-header">
          <div className="zac-panel-title">System Health</div>
          <button className="zac-btn zac-btn-sm zac-btn-ghost" onClick={loadHealth}>↻</button>
        </div>
        {health ? (
          <>
            <div className="zac-health-strip">
              <HC label="Server" s={health.server} />
              <HC label="WebSocket" s={health.websocket} />
              <HC label="Database" s={health.database} />
              <HC label="Exchange" s={health.exchange} />
              <HC label="Sync" s={health.sync} />
              <HC label="Audit" s={health.audit} />
            </div>
            {health.memory && (
              <div style={{ marginTop: 12, padding: 10, background: 'var(--ac-bg-2)', borderRadius: 4, fontSize: 10, color: 'var(--ac-fg-dim)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                  <div>Uptime: <b style={{ color: 'var(--ac-fg)' }}>{formatUptime(health.uptime || 0)}</b></div>
                  <div>Heap: <b style={{ color: 'var(--ac-fg)' }}>{(health.memory.heapUsed / 1024 / 1024).toFixed(1)} / {(health.memory.heapTotal / 1024 / 1024).toFixed(1)} MB</b></div>
                  <div>RSS: <b style={{ color: 'var(--ac-fg)' }}>{(health.memory.rss / 1024 / 1024).toFixed(1)} MB</b></div>
                  <div>Last check: <b style={{ color: 'var(--ac-fg)' }}>{fmtRelative(health.checkedAt)}</b></div>
                </div>
              </div>
            )}
          </>
        ) : <div style={{ fontSize: 11, color: 'var(--ac-fg-mute)' }}>No health data yet.</div>}
      </div>
      <div className="zac-panel">
        <div className="zac-panel-header"><div className="zac-panel-title">Module Status</div></div>
        <Placeholder title="AT / DSL / ARES / Sync / Watchlist / Market Feed" note="Per-module health, queue depth, reconnect counts. Server exposes these in logs today; structured endpoint planned for Faza C." />
      </div>
    </>
  )
}

function HC({ label, s }: { label: string; s: 'ok' | 'warn' | 'down' }) {
  return (
    <div className="zac-health-cell">
      <span className="label">{label}</span>
      <span className="value"><span className={`zac-dot zac-dot-${s}`} />{s === 'ok' ? 'OK' : s === 'warn' ? 'WARN' : 'DOWN'}</span>
    </div>
  )
}

function formatUptime(sec: number) {
  if (sec < 60) return `${Math.floor(sec)}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS — feature flags scaffolded
// ═══════════════════════════════════════════════════════════════════════════

export function SettingsSection() {
  return (
    <>
      <div className="zac-panel">
        <div className="zac-panel-header"><div className="zac-panel-title">Feature Flags</div></div>
        <Placeholder title="Global toggles" note="Maintenance mode, registration on/off, invite-only, rollout gates. Toggle surface ready — storage and evaluation engine in Faza C." />
      </div>
      <div className="zac-panel">
        <div className="zac-panel-header"><div className="zac-panel-title">Safety Toggles</div></div>
        <Placeholder title="Emergency switches" note="Global trading lock, emergency admin broadcast, global force-logout. Destructive toggles — scoped to Faza C with strict confirm flows." />
      </div>
    </>
  )
}
