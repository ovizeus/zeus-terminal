import { useAdminStore, type AdminSection } from '../../stores/adminStore'
// [2026-11-06] NAV and GROUPS moved to ./adminNav so the launcher and this
// sidebar render from ONE list. Two copies drift the first time a section
// is added, which is exactly what happened to the dock.
import { NAV, GROUPS } from './adminNav'

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
      {/* [2026-11-06] Back to the launcher, from anywhere. */}
      <div
        className={`zac-nav-item ${currentSection === 'home' ? 'active' : ''}`}
        onClick={() => setSection('home')}
      >
        <span className="ico" aria-hidden>⊞</span>
        <span>All sections</span>
      </div>
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
                  {n.wip ? <span title="Scaffold — not functional yet" style={{ marginLeft: 'auto', fontSize: 8, fontWeight: 700, letterSpacing: 1, color: 'var(--ac-gold)', border: '1px solid #f0c04055', borderRadius: 3, padding: '1px 4px' }}>WIP</span> : null}
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
