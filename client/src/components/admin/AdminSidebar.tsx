import { useAdminStore, type AdminSection } from '../../stores/adminStore'

interface NavItem {
  id: AdminSection
  label: string
  icon: string
  group: 'overview' | 'people' | 'system' | 'config'
}

const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '◉', group: 'overview' },
  { id: 'users', label: 'Users', icon: '◐', group: 'people' },
  { id: 'audit', label: 'Audit Log', icon: '☰', group: 'people' },
  { id: 'roles', label: 'Roles & Permissions', icon: '◆', group: 'people' },
  { id: 'security', label: 'Security', icon: '⬡', group: 'system' },
  { id: 'monitoring', label: 'Monitoring', icon: '◈', group: 'system' },
  { id: 'billing', label: 'Billing / Plans', icon: '❖', group: 'config' },
  { id: 'support', label: 'Support / Ops', icon: '☍', group: 'config' },
  { id: 'settings', label: 'Settings / Flags', icon: '⚙', group: 'config' },
]

const GROUPS: Array<{ id: NavItem['group']; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'people', label: 'People' },
  { id: 'system', label: 'System' },
  { id: 'config', label: 'Configuration' },
]

export function AdminSidebar() {
  const currentSection = useAdminStore((s) => s.currentSection)
  const setSection = useAdminStore((s) => s.setSection)
  const users = useAdminStore((s) => s.users)
  const audit = useAdminStore((s) => s.audit)

  const pendingCount = users.filter((u) => !u.approved && u.role !== 'admin').length
  const counts: Partial<Record<AdminSection, number>> = {
    users: users.length || undefined,
    audit: audit.length || undefined,
    dashboard: pendingCount || undefined,
  }

  return (
    <nav className="zac-side">
      {GROUPS.map((g) => {
        const items = NAV.filter((n) => n.group === g.id)
        return (
          <div className="zac-nav-group" key={g.id}>
            <div className="zac-nav-label">{g.label}</div>
            {items.map((n) => {
              const active = currentSection === n.id
              const cnt = counts[n.id]
              return (
                <div
                  key={n.id}
                  className={`zac-nav-item ${active ? 'active' : ''}`}
                  onClick={() => setSection(n.id)}
                >
                  <span className="ico" aria-hidden>{n.icon}</span>
                  <span>{n.label}</span>
                  {cnt ? <span className="count">{cnt}</span> : null}
                </div>
              )
            })}
          </div>
        )
      })}
    </nav>
  )
}
