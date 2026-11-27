'use strict';
/**
 * [2026-11-27] Securitate etapa 2 — roluri reale, verificate pe SERVER la fiecare actiune de admin.
 *
 *  - `users.role = 'admin'` = SUPER ADMIN (operatorul). Neschimbat: toate verificarile vechi
 *    `role === 'admin'` din restul aplicatiei (flags, ring5, doctor, byoi...) raman doar ale lui.
 *  - `users.staff_role` (migrarea 435) = 'admin' | 'support' | 'analyst' — DOAR permisiunile de mai jos,
 *    doar pe rutele /auth/admin/* legate explicit de o permisiune, si doar cu 2FA pornit (in _adminGuard).
 *    O ruta fara permisiune (perm null) ramane a Super Adminului: ce nu e legat explicit e REFUZAT.
 * Aceeasi matrice e in client/src/components/admin/adminRoles.ts (un test cere sa fie identice).
 */
const PERMISSIONS = [
    'users.view', 'users.edit', 'users.block', 'users.ban', 'users.delete', 'users.force_logout',
    'audit.view', 'audit.export', 'security.sessions', 'security.terminate', 'monitoring.view',
    'settings.edit', 'settings.flags', 'billing.view', 'billing.manage', 'emergency.lock',
];
const ROLE_PERMS = {
    admin: ['users.view', 'users.edit', 'users.block', 'users.ban', 'users.delete', 'users.force_logout', 'audit.view', 'audit.export', 'security.sessions', 'security.terminate', 'monitoring.view'],
    support: ['users.view', 'audit.view', 'security.sessions', 'monitoring.view'],
    analyst: ['users.view', 'audit.view', 'audit.export', 'monitoring.view'],
};
const STAFF_ROLES = Object.keys(ROLE_PERMS);

const isSuper = (u) => !!(u && u.role === 'admin');
const staffRoleOf = (u) => (u && Object.prototype.hasOwnProperty.call(ROLE_PERMS, u.staff_role) ? u.staff_role : null);

function can(u, perm) {
    if (isSuper(u)) return true;
    const sr = staffRoleOf(u);
    if (!sr || !perm) return false;
    return ROLE_PERMS[sr].includes(perm);
}
function permissionsOf(u) {
    if (isSuper(u)) return PERMISSIONS.slice();
    const sr = staffRoleOf(u);
    return sr ? ROLE_PERMS[sr].slice() : [];
}
function isStaff(u) { return isSuper(u) || !!staffRoleOf(u); }

module.exports = { PERMISSIONS, ROLE_PERMS, STAFF_ROLES, can, permissionsOf, isStaff, isSuper, staffRoleOf };
