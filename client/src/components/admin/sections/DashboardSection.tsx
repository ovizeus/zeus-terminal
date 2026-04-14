import { useEffect } from 'react'
import { useAdminStore } from '../../../stores/adminStore'
import { KpiCard, HealthDot, fmtRelative, actionColor } from '../shared/components'

export function DashboardSection() {
  const users = useAdminStore((s) => s.users)
  const audit = useAdminStore((s) => s.audit)
  const health = useAdminStore((s) => s.health)
  const loadHealth = useAdminStore((s) => s.loadHealth)
  const loadAudit = useAdminStore((s) => s.loadAudit)
  const loadUsers = useAdminStore((s) => s.loadUsers)
  const setSection = useAdminStore((s) => s.setSection)

  useEffect(() => {
    if (users.length === 0) loadUsers()
    if (audit.length === 0) loadAudit(20)
    if (!health) loadHealth()
    const id = setInterval(() => { loadHealth() }, 30000)
    return () => clearInterval(id)
  }, [])

  const total = users.length
  const active = users.filter((u) => u.status === 'active' && u.approved).length
  const pending = users.filter((u) => !u.approved && u.role !== 'admin').length
  const blocked = users.filter((u) => u.status === 'blocked').length
  const banned = users.filter((u) => u.status === 'banned').length
  const withApi = users.filter((u) => u.exchange?.connected).length
  const liveEnabled = users.filter((u) => u.exchange?.mode === 'live').length
  const demoOnly = users.filter((u) => !u.exchange?.connected).length

  const last24h = audit.filter((e) => {
    if (!e.created_at) return false
    const t = new Date(e.created_at + (e.created_at.includes('Z') ? '' : 'Z')).getTime()
    return Date.now() - t < 86400000
  }).length
  const criticalCount = audit.filter((e) => {
    const a = e.action || ''
    return a.includes('BAN') || a.includes('DELETE') || a.includes('FAILED')
  }).length

  return (
    <>
      {/* ── KPI cards ── */}
      <div className="zac-kpi-grid">
        <KpiCard label="Total Users" value={total} tone="default" />
        <KpiCard label="Active" value={active} sub={`${total > 0 ? Math.round(active / total * 100) : 0}% of total`} tone="success" />
        <KpiCard label="Pending Approval" value={pending} tone={pending > 0 ? 'warn' : 'mute'} />
        <KpiCard label="Blocked" value={blocked} tone={blocked > 0 ? 'warn' : 'mute'} />
        <KpiCard label="Banned" value={banned} tone={banned > 0 ? 'danger' : 'mute'} />
        <KpiCard label="API Configured" value={withApi} sub={`${total > 0 ? Math.round(withApi / total * 100) : 0}% of users`} tone="default" />
        <KpiCard label="Live Trading" value={liveEnabled} tone={liveEnabled > 0 ? 'danger' : 'mute'} />
        <KpiCard label="Demo Only" value={demoOnly} tone="mute" />
        <KpiCard label="Events (24h)" value={last24h} tone="default" />
        <KpiCard label="Critical Events" value={criticalCount} tone={criticalCount > 0 ? 'warn' : 'mute'} />
      </div>

      {/* ── System health strip ── */}
      <div className="zac-panel">
        <div className="zac-panel-header">
          <div className="zac-panel-title">System Status</div>
          <button className="zac-btn zac-btn-sm zac-btn-ghost" onClick={loadHealth}>↻</button>
        </div>
        <div className="zac-health-strip">
          {health ? (
            <>
              <HealthCell label="Server" status={health.server} />
              <HealthCell label="WebSocket" status={health.websocket} />
              <HealthCell label="Database" status={health.database} />
              <HealthCell label="Exchange" status={health.exchange} />
              <HealthCell label="Sync" status={health.sync} />
              <HealthCell label="Audit" status={health.audit} />
            </>
          ) : (
            <div style={{ gridColumn: '1/-1', color: '#556172', fontSize: 11, padding: 12 }}>Loading system health...</div>
          )}
        </div>
        {health?.memory && (
          <div style={{ display: 'flex', gap: 24, marginTop: 12, fontSize: 10, color: '#8791a3' }}>
            <span>Uptime: <b style={{ color: '#d8dde5' }}>{formatUptime(health.uptime || 0)}</b></span>
            <span>Heap: <b style={{ color: '#d8dde5' }}>{(health.memory.heapUsed / 1024 / 1024).toFixed(0)} / {(health.memory.heapTotal / 1024 / 1024).toFixed(0)} MB</b></span>
            <span>RSS: <b style={{ color: '#d8dde5' }}>{(health.memory.rss / 1024 / 1024).toFixed(0)} MB</b></span>
          </div>
        )}
      </div>

      {/* ── Recent events ── */}
      <div className="zac-panel" style={{ padding: 0 }}>
        <div className="zac-panel-header" style={{ padding: '14px 18px', margin: 0, borderBottom: '1px solid var(--ac-border)' }}>
          <div className="zac-panel-title">Recent Events</div>
          <button className="zac-btn zac-btn-sm zac-btn-ghost" onClick={() => setSection('audit')}>View all →</button>
        </div>
        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {audit.length === 0 && (
            <div className="zac-empty" style={{ padding: 24 }}>No recent events</div>
          )}
          {audit.slice(0, 12).map((e, i) => (
            <div key={i} className="zac-event">
              <span className="t">{fmtRelative(e.created_at)}</span>
              <span className="a" style={{ color: actionColor(e.action) }}>{e.action}</span>
              <span className="d">{e.user_id ? `uid:${e.user_id} ` : ''}{safeParseDetails(e.details)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Quick actions ── */}
      <div className="zac-panel">
        <div className="zac-panel-header">
          <div className="zac-panel-title">Quick Actions</div>
        </div>
        <div className="zac-qa-grid">
          <div className="zac-qa" onClick={() => setSection('users')}>
            <span className="zac-qa-ico">◐</span>
            <span className="zac-qa-label">Users</span>
          </div>
          <div className="zac-qa" onClick={() => setSection('audit')}>
            <span className="zac-qa-ico">☰</span>
            <span className="zac-qa-label">Audit Log</span>
          </div>
          <div className="zac-qa" onClick={() => setSection('monitoring')}>
            <span className="zac-qa-ico">◈</span>
            <span className="zac-qa-label">Monitoring</span>
          </div>
          <div className="zac-qa" onClick={() => setSection('security')}>
            <span className="zac-qa-ico">⬡</span>
            <span className="zac-qa-label">Security</span>
          </div>
          <div className="zac-qa" onClick={() => { void loadUsers(); void loadAudit(100); void loadHealth() }}>
            <span className="zac-qa-ico">↻</span>
            <span className="zac-qa-label">Refresh All</span>
          </div>
        </div>
      </div>
    </>
  )
}

function HealthCell({ label, status }: { label: string; status: 'ok' | 'warn' | 'down' }) {
  const text = status === 'ok' ? 'OK' : status === 'warn' ? 'WARN' : 'DOWN'
  return (
    <div className="zac-health-cell">
      <span className="label">{label}</span>
      <span className="value"><HealthDot status={status} />{text}</span>
    </div>
  )
}

function formatUptime(sec: number) {
  if (sec < 60) return `${Math.floor(sec)}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`
}

function safeParseDetails(details?: string): string {
  if (!details) return ''
  try {
    const d = JSON.parse(details)
    return Object.keys(d).map((k) => `${k}=${typeof d[k] === 'object' ? JSON.stringify(d[k]) : d[k]}`).join(' · ')
  } catch { return details }
}
