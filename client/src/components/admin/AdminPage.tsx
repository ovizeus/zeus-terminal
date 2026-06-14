import { useEffect } from 'react'
import { useAdminStore } from '../../stores/adminStore'
import { AdminSidebar } from './AdminSidebar'
import { AdminHeader } from './AdminHeader'
import { DashboardSection } from './sections/DashboardSection'
import { UsersSection } from './sections/UsersSection'
import { AuditSection } from './sections/AuditSection'
import { UserDetailDrawer } from './sections/UserDetailDrawer'
import { RolesSection, SecuritySection, BillingSection, MonitoringSection, SettingsSection } from './sections/stubs'
import { SupportSection } from './sections/SupportSection'
import './admin.css'

export function AdminPage({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const currentSection = useAdminStore((s) => s.currentSection)
  const selectedUserId = useAdminStore((s) => s.selectedUserId)
  const setSelectedUser = useAdminStore((s) => s.setSelectedUser)
  const loadUsers = useAdminStore((s) => s.loadUsers)

  const setSection = useAdminStore((s) => s.setSection)

  useEffect(() => {
    if (!visible) return
    // [ADMIN-BACK 2026-06-06] Fresh entry always lands on Dashboard — the
    // zustand store outlives the modal, so without this a re-open resumed on
    // whatever sub-page was last visited (phone UX complaint: had to refresh
    // the whole app to get the panel's first page back).
    setSection('dashboard')
    loadUsers()
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedUserId) setSelectedUser(null)
        else onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [visible, selectedUserId])

  if (!visible) return null

  return (
    <div className="zac" role="dialog" aria-label="Admin Control Center">
      <div className="zac-brand">
        <div className="zac-brand-logo">Z</div>
        <div>
          <div className="zac-brand-title">ZEUS</div>
          <div className="zac-brand-sub">ADMIN</div>
        </div>
      </div>

      <AdminHeader onClose={onClose} />
      <AdminSidebar />

      <main className="zac-main">
        {currentSection === 'dashboard' && <DashboardSection />}
        {currentSection === 'users' && <UsersSection />}
        {currentSection === 'audit' && <AuditSection />}
        {currentSection === 'roles' && <RolesSection />}
        {currentSection === 'security' && <SecuritySection />}
        {currentSection === 'monitoring' && <MonitoringSection />}
        {currentSection === 'billing' && <BillingSection />}
        {currentSection === 'support' && <SupportSection />}
        {currentSection === 'settings' && <SettingsSection />}
      </main>

      {selectedUserId !== null && (
        <UserDetailDrawer userId={selectedUserId} onClose={() => setSelectedUser(null)} />
      )}
    </div>
  )
}
