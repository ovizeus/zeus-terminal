import { useAdminStore } from '../../stores/adminStore'
import { fmtRelative } from './shared/components'

const SECTION_TITLES: Record<string, { title: string; sub: string }> = {
  home: { title: 'Admin Control Center', sub: 'Every section, one screen' },
  dashboard: { title: 'Dashboard', sub: 'Overview and system health' },
  users: { title: 'Users Management', sub: 'Accounts, roles, access control' },
  audit: { title: 'Audit Log', sub: 'Full activity trail' },
  roles: { title: 'Roles & Permissions', sub: 'Access matrix and role assignments' },
  security: { title: 'Security', sub: 'Sessions, suspicious activity, hardening' },
  monitoring: { title: 'Monitoring', sub: 'Server, modules, connectivity' },
  billing: { title: 'Billing & Plans', sub: 'Subscriptions and revenue' },
  support: { title: 'Support & Operations', sub: 'Ops workspace and account tools' },
  indicators: { title: 'Indicator Requests', sub: 'Built-to-order queue' },
  settings: { title: 'Settings & Feature Flags', sub: 'Global toggles and rollouts' },
}

export function AdminHeader({ onClose }: { onClose: () => void }) {
  const section = useAdminStore((s) => s.currentSection)
  const selectedUserId = useAdminStore((s) => s.selectedUserId)
  const setSelectedUser = useAdminStore((s) => s.setSelectedUser)
  const setSection = useAdminStore((s) => s.setSection)
  const lastRefresh = useAdminStore((s) => s.lastRefresh)
  const loadUsers = useAdminStore((s) => s.loadUsers)
  const loadAudit = useAdminStore((s) => s.loadAudit)
  const loadHealth = useAdminStore((s) => s.loadHealth)

  const meta = SECTION_TITLES[section] || SECTION_TITLES.home

  function refreshAll() {
    loadUsers()
    loadAudit(100)
    loadHealth()
  }

  // [ADMIN-BACK 2026-06-06] In-panel back navigation (phone): a user drawer
  // closes first, any sub-section returns to Dashboard, and only from
  // Dashboard does back leave the panel. "Back to App" always exits.
  // [2026-11-06] Back now returns to the launcher rather than the dashboard,
  // which is just one section among the rest again.
  const inSubPage = selectedUserId !== null || section !== 'home'
  function goBack() {
    if (selectedUserId !== null) { setSelectedUser(null); return }
    if (section !== 'home') { setSection('home'); return }
    onClose()
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
        {inSubPage && (
          <button className="zac-btn zac-btn-ghost" onClick={goBack} title="Back to Dashboard">← Back</button>
        )}
        <button className="zac-btn zac-btn-ghost" onClick={refreshAll}>↻ Refresh</button>
        <button className="zac-btn zac-btn-ghost" onClick={onClose}>⤴ Back to App</button>
      </div>
    </header>
  )
}
