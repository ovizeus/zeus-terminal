// [2026-11-27] Roluri reale — aceeasi matrice ca server/services/adminRoles.js (un test cere sa fie identice).
// Serverul decide; clientul doar ascunde ce nu e permis, ca staff-ul sa nu vada butoane care dau 403.
export const PERMISSIONS = [
  'users.view', 'users.edit', 'users.block', 'users.ban', 'users.delete', 'users.force_logout',
  'audit.view', 'audit.export', 'security.sessions', 'security.terminate', 'monitoring.view',
  'settings.edit', 'settings.flags', 'billing.view', 'billing.manage', 'emergency.lock',
]

export const ROLE_PERMS: Record<string, string[]> = {
  admin: ['users.view', 'users.edit', 'users.block', 'users.ban', 'users.delete', 'users.force_logout', 'audit.view', 'audit.export', 'security.sessions', 'security.terminate', 'monitoring.view'],
  support: ['users.view', 'audit.view', 'security.sessions', 'monitoring.view'],
  analyst: ['users.view', 'audit.view', 'audit.export', 'monitoring.view'],
}
