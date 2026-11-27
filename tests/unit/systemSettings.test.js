'use strict';
// [2026-11-27] Setari de sistem (comutatorul de inscrieri din admin), pastrate in baza.
const path = require('path');
const fs = require('fs');
const os = require('os');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sysset-'));
process.env.ZEUS_DB_PATH = path.join(DIR, 'test.db');
const db = require('../../server/services/database');
afterAll(() => { try { db.db.close(); } catch (_) {} fs.rmSync(DIR, { recursive: true, force: true }); });

test('lipsa = null; scris → citit; suprascris', () => {
    expect(db.getSystemSetting('registration_open')).toBeNull();
    db.setSystemSetting('registration_open', '0');
    expect(db.getSystemSetting('registration_open')).toBe('0');
    db.setSystemSetting('registration_open', '1');
    expect(db.getSystemSetting('registration_open')).toBe('1');
});
