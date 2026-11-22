'use strict';
// [2026-11-22] Rotatia backup-urilor: 3 copii ZILNICE; copiile manuale (zeus-pre-*.db) nu intra in numaratoare.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../server/services/database.js'), 'utf8');

test('se pastreaza 3 copii zilnice', () => {
    expect(src).toMatch(/const MAX_BACKUPS = 3;/);
});
test('numaratoarea ia doar copiile zilnice zeus-AAAA-LL-ZZ.db', () => {
    const m = src.match(/const DAILY_BACKUP_RE = (\/.+\/);/);
    expect(m).toBeTruthy();
    const re = eval(m[1]);
    expect(re.test('zeus-2026-11-22.db')).toBe(true);
    expect(re.test('zeus-pre-okxfix-20261114.db')).toBe(false);
    expect(re.test('zeus-2026-11-22.db-shm')).toBe(false);
    expect(src).toMatch(/readdirSync\(BACKUP_DIR\)\.filter\(f => DAILY_BACKUP_RE\.test\(f\)\)/);
});
