import { useAdminStore } from '../../stores/adminStore'
import { fmtRelative } from './shared/components'

const SECTION_TITLES: Record<string, { title: string; sub: string }> = {
  dashboard: { title: 'Admin Control Center', sub: 'Overview and system health' },
  users: { title: 'Users Management', sub: 'Accounts, roles, access control' },
  audit: { title: 'Audit Log', sub: 'Full activity trail' },
  roles: { title: 'Roles & Permissions', sub: 'Access matrix and role assignments' },
  security: { title: 'Security', sub: 'Sessions, suspicious activity, hardening' },
  monitoring: { title: 'Monitoring', sub: 'Server, modules, connectivity' },
  billing: { title: 'Billing & Plans', sub: 'Subscriptions and revenue' },
  support: { title: 'Support & Operations', sub: 'Ops workspace and account tools' },
  settings: { title: 'Settings & Feature Flags', sub: 'Global toggles and rollouts' },
}

export function AdminHeader({ onClose }: { onClose: () => void }) {
  const section = useAdminStore((s) => s.currentSection)
  const lastRefresh = useAdminStore((s) => s.lastRefresh)
  const loadUsers = useAdminStore((s) => s.loadUsers)
  const loadAudit = useAdminStore((s) => s.loadAudit)
  const loadHealth = useAdminStore((s) => s.loadHealth)

  const meta = SECTION_TITLES[section] || SECTION_TITLES.dashboard

  function refreshAll() {
    loadUsers()
    loadAudit(100)
    loadHealth()
  }

  return (
    <header className="zac-header">
      <div className="zac-header-title">
        <h1>{meta.title}</h1>
        <p>{meta.sub}</p>
      </div>
      <div className="zac-header-actions">
        {lastRefresh > 0 && (
          <span style={{ fontSize: 9, color: '#556172', letterSpacing: 1 }}>
            UPDATED {fmtRelative(new Date(lastRefresh).toISOString())}
          </span>
        )}
        <button className="zac-btn zac-btn-ghost" onClick={refreshAll}>↻ Refresh</button>
        <button className="zac-btn zac-btn-ghost" onClick={onClose}>← Back to App</button>
      </div>
    </header>
  )
}
