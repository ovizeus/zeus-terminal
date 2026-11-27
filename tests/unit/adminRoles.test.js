'use strict';
// [2026-11-27] Securitate etapa 2 — roluri reale de staff, verificate pe SERVER.
// `role = 'admin'` ramane Super Admin (toate verificarile vechi `role === 'admin'` raman ale lui);
// `staff_role` (admin/support/analyst) da DOAR permisiunile din matrice, si doar cu 2FA pornit.
const R = require('../../server/services/adminRoles');

const SUPER = { id: 1, role: 'admin', staff_role: null };
const staff = (sr) => ({ id: 9, role: 'user', staff_role: sr });

test('Super Admin poate tot, inclusiv o permisiune necunoscuta (nimic nu-l blocheaza)', () => {
    for (const p of R.PERMISSIONS) expect(R.can(SUPER, p)).toBe(true);
    expect(R.can(SUPER, null)).toBe(true);
});
test('un user obisnuit nu poate nimic', () => {
    expect(R.can({ id: 3, role: 'user' }, 'users.view')).toBe(false);
});
test('perm null = doar Super Admin (rutele de sistem: flags, inscrieri, bulk...)', () => {
    for (const sr of R.STAFF_ROLES) expect(R.can(staff(sr), null)).toBe(false);
});
test('matricea: support vede, NU sterge si NU baneaza; analyst exporta auditul', () => {
    expect(R.can(staff('support'), 'users.view')).toBe(true);
    expect(R.can(staff('support'), 'users.delete')).toBe(false);
    expect(R.can(staff('support'), 'users.ban')).toBe(false);
    expect(R.can(staff('analyst'), 'audit.export')).toBe(true);
    expect(R.can(staff('analyst'), 'users.edit')).toBe(false);
    expect(R.can(staff('admin'), 'users.delete')).toBe(true);
    expect(R.can(staff('admin'), 'settings.flags')).toBe(false);
});
test('un rol de staff necunoscut (scris gresit in baza) → nimic', () => {
    expect(R.can(staff('superadmin'), 'users.view')).toBe(false);
    expect(R.can(staff('ADMIN'), 'users.view')).toBe(false);
});
test('permissionsOf: lista pentru client (Super Admin = toate)', () => {
    expect(R.permissionsOf(SUPER)).toEqual(R.PERMISSIONS);
    expect(R.permissionsOf(staff('analyst'))).toEqual(['users.view', 'audit.view', 'audit.export', 'monitoring.view']);
    expect(R.permissionsOf({ id: 3, role: 'user' })).toEqual([]);
});
test('isStaff: are acces la panou (super sau staff valid)', () => {
    expect(R.isStaff(SUPER)).toBe(true);
    expect(R.isStaff(staff('support'))).toBe(true);
    expect(R.isStaff(staff('nope'))).toBe(false);
    expect(R.isStaff({ id: 3, role: 'user' })).toBe(false);
});
test('matricea serverului e IDENTICA cu cea din client (client/src/components/admin/adminRoles.ts)', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../client/src/components/admin/adminRoles.ts'), 'utf8');
    const m = src.match(/export const ROLE_PERMS[^=]*=\s*(\{[\s\S]*?\n\})/);
    expect(m).toBeTruthy();
    const client = Function('return (' + m[1] + ')')();
    expect(client).toEqual(R.ROLE_PERMS);
    const pm = src.match(/export const PERMISSIONS[^=]*=\s*(\[[\s\S]*?\])/);
    expect(Function('return (' + pm[1] + ')')()).toEqual(R.PERMISSIONS);
});
