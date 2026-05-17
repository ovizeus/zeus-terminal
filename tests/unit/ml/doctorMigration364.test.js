'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-mig364-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');

describe('D-1 migration 364_ml_module_registry', () => {
    test('migration applied at boot', () => {
        const row = db.prepare("SELECT name FROM _migrations WHERE name = ?")
            .get('364_ml_module_registry');
        expect(row).toBeTruthy();
    });

    test('table has all required columns', () => {
        const cols = db.prepare("PRAGMA table_info(ml_module_registry)").all();
        const names = cols.map(c => c.name).sort();
        expect(names).toEqual([
            'contract_json', 'criticality', 'id', 'module_id',
            'registered_at', 'role_tag', 'runtime_mode'
        ]);
    });

    test('role_tag CHECK enforced', () => {
        expect(() => {
            db.prepare(`
                INSERT INTO ml_module_registry
                (module_id, role_tag, criticality, runtime_mode, contract_json, registered_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run('test_bad', 'invalid_tag', 'high', 'live', '{}', Date.now());
        }).toThrow(/CHECK/);
    });

    test('criticality CHECK enforced', () => {
        expect(() => {
            db.prepare(`
                INSERT INTO ml_module_registry
                (module_id, role_tag, criticality, runtime_mode, contract_json, registered_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run('test_bad_crit', 'hot_path_critical', 'invalid_crit', 'live', '{}', Date.now());
        }).toThrow(/CHECK/);
    });

    test('runtime_mode CHECK enforced', () => {
        expect(() => {
            db.prepare(`
                INSERT INTO ml_module_registry
                (module_id, role_tag, criticality, runtime_mode, contract_json, registered_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run('test_bad_rm', 'hot_path_critical', 'high', 'invalid_rm', '{}', Date.now());
        }).toThrow(/CHECK/);
    });

    test('module_id UNIQUE enforced', () => {
        const now = Date.now();
        db.prepare(`
            INSERT INTO ml_module_registry
            (module_id, role_tag, criticality, runtime_mode, contract_json, registered_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run('test_dup', 'hot_path_critical', 'high', 'live', '{}', now);
        expect(() => {
            db.prepare(`
                INSERT INTO ml_module_registry
                (module_id, role_tag, criticality, runtime_mode, contract_json, registered_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run('test_dup', 'hot_path_critical', 'high', 'live', '{}', now);
        }).toThrow(/UNIQUE/);
    });

    test('index idx_mlmr_role_runtime exists', () => {
        const idx = db.prepare(`
            SELECT name FROM sqlite_master
            WHERE type = 'index' AND tbl_name = 'ml_module_registry'
              AND name = 'idx_mlmr_role_runtime'
        `).get();
        expect(idx).toBeTruthy();
    });
});
