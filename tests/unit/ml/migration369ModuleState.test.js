'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig369-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');

describe('Phase 2 migration 369_ml_module_state', () => {
    test('migration applied at boot', () => {
        const row = db.prepare("SELECT name FROM _migrations WHERE name = ?").get('369_ml_module_state');
        expect(row).toBeTruthy();
    });

    test('table has all required columns', () => {
        const cols = db.prepare("PRAGMA table_info(ml_module_state)").all();
        const names = cols.map(c => c.name).sort();
        expect(names).toEqual([
            'bandit_params_json', 'id', 'last_observed_ts', 'module_id',
            'resolved_env', 'symbol', 'trust_score', 'updated_at',
            'user_id', 'version'
        ]);
    });

    test('resolved_env CHECK enforced', () => {
        expect(() => {
            db.prepare(`INSERT INTO ml_module_state
                (user_id, resolved_env, symbol, module_id, version, last_observed_ts, trust_score, bandit_params_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(1, 'INVALID', 'BTCUSDT', 'm', 1, Date.now(), 0.5, '{}', Date.now());
        }).toThrow(/CHECK/);
    });

    test('composite UNIQUE on (user_id, resolved_env, symbol, module_id)', () => {
        const now = Date.now();
        db.prepare(`INSERT INTO ml_module_state
            (user_id, resolved_env, symbol, module_id, version, last_observed_ts, trust_score, bandit_params_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(1, 'DEMO', 'BTCUSDT', 'mod_a', 1, now, 0.5, '{}', now);
        expect(() => {
            db.prepare(`INSERT INTO ml_module_state
                (user_id, resolved_env, symbol, module_id, version, last_observed_ts, trust_score, bandit_params_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(1, 'DEMO', 'BTCUSDT', 'mod_a', 1, now, 0.5, '{}', now);
        }).toThrow(/UNIQUE/);
    });

    test('trust_score CHECK enforces [0,1] range', () => {
        expect(() => {
            db.prepare(`INSERT INTO ml_module_state
                (user_id, resolved_env, symbol, module_id, version, last_observed_ts, trust_score, bandit_params_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(1, 'DEMO', 'BTCUSDT', 'mod_bad_trust', 1, Date.now(), 1.5, '{}', Date.now());
        }).toThrow(/CHECK/);
    });

    test('version CHECK enforces positive integer', () => {
        expect(() => {
            db.prepare(`INSERT INTO ml_module_state
                (user_id, resolved_env, symbol, module_id, version, last_observed_ts, trust_score, bandit_params_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(1, 'DEMO', 'BTCUSDT', 'mod_bad_v', 0, Date.now(), 0.5, '{}', Date.now());
        }).toThrow(/CHECK/);
    });

    test('index idx_mlms_cell_module exists', () => {
        const idx = db.prepare(`
            SELECT name FROM sqlite_master
            WHERE type = 'index' AND tbl_name = 'ml_module_state'
              AND name = 'idx_mlms_cell_module'
        `).get();
        expect(idx).toBeTruthy();
    });
});
