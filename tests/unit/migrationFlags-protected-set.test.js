'use strict';

// [AUDIT-20260619 P1-1] migrationFlags.set() enforced only the mutex, NOT the
// protected REAL-money blocklist. /auth/admin/flags guarded it; the second admin
// route POST /api/migration/flags (server.js) called MF.set() directly with NO
// guard, so an admin (or the historical SEC-12 localhost bypass) could flip
// _SRV_POS_REAL_ENABLED via that route. The DRY fix puts the guard inside set()
// so EVERY caller is covered, throwing BEFORE any disk/DB I/O.
//
// SAFETY: the guard throws before save()/configRollback/coherence run, so these
// rejection assertions NEVER mutate the live flags file or DB. We do NOT exercise
// the value=false (emergency-off) path here because that would call the real
// save()+rollback against the live system; that path is unchanged by this fix.
// As belt-and-suspenders we snapshot/restore the flags file anyway.

const path = require('path');
const fs = require('fs');
const FLAGS_FILE = path.join(__dirname, '..', '..', 'data', 'migration_flags.json');

let _snapshot = null;
beforeAll(() => { try { _snapshot = fs.readFileSync(FLAGS_FILE, 'utf8'); } catch (_) { _snapshot = null; } });
afterAll(() => { if (_snapshot != null) { try { fs.writeFileSync(FLAGS_FILE, _snapshot); } catch (_) {} } });

const MF = require('../../server/migrationFlags');

describe('migrationFlags.set() — protected REAL flags refuse turning ON (fail-closed)', () => {
  test('set(_SRV_POS_REAL_ENABLED, true) THROWS and flag stays false (no write)', () => {
    expect(() => MF.set('_SRV_POS_REAL_ENABLED', true)).toThrow(/protected/i);
    expect(MF.getAll()._SRV_POS_REAL_ENABLED).toBe(false);
  });

  test('set(_USERDATA_STREAM_REAL_ENABLED, true) THROWS', () => {
    expect(() => MF.set('_USERDATA_STREAM_REAL_ENABLED', true)).toThrow(/protected/i);
    expect(MF.getAll()._USERDATA_STREAM_REAL_ENABLED).toBe(false);
  });

  test('the thrown error carries code MF_PROTECTED_FLAG (route layer maps to 403)', () => {
    try { MF.set('_SRV_POS_REAL_ENABLED', true); throw new Error('should have thrown'); }
    catch (e) { expect(e.code).toBe('MF_PROTECTED_FLAG'); }
  });

  test('PROTECTED_FLAGS is exported for route-layer reuse (single source of truth)', () => {
    expect(MF.PROTECTED_FLAGS instanceof Set).toBe(true);
    expect(MF.PROTECTED_FLAGS.has('_SRV_POS_REAL_ENABLED')).toBe(true);
    expect(MF.PROTECTED_FLAGS.has('_USERDATA_STREAM_REAL_ENABLED')).toBe(true);
  });
});
