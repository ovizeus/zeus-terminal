'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-bandit-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');

describe('Phase 3 bandit migrations 370/371/372', () => {
    describe('370_ml_bandit_posteriors', () => {
        test('migration applied', () => {
            const row = db.prepare("SELECT name FROM _migrations WHERE name=?")
                .get('370_ml_bandit_posteriors');
            expect(row).toBeTruthy();
        });
        test('columns', () => {
            const cols = db.prepare("PRAGMA table_info(ml_bandit_posteriors)").all();
            const names = cols.map(c => c.name).sort();
            expect(names).toEqual([
                'alpha', 'beta', 'cell_key', 'id', 'level', 'observation_count',
                'updated_at'
            ]);
        });
        test('level CHECK enforces L0-L4', () => {
            expect(() => {
                db.prepare(`INSERT INTO ml_bandit_posteriors
                    (level, cell_key, alpha, beta, observation_count, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)`).run(5, 'x', 1, 1, 0, Date.now());
            }).toThrow(/CHECK/);
        });
        test('UNIQUE(level, cell_key)', () => {
            const now = Date.now();
            db.prepare(`INSERT INTO ml_bandit_posteriors
                (level, cell_key, alpha, beta, observation_count, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)`).run(2, 'BTCUSDT:DEMO', 1, 1, 0, now);
            expect(() => {
                db.prepare(`INSERT INTO ml_bandit_posteriors
                    (level, cell_key, alpha, beta, observation_count, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)`).run(2, 'BTCUSDT:DEMO', 1, 1, 0, now);
            }).toThrow(/UNIQUE/);
        });
        test('alpha/beta CHECK > 0', () => {
            expect(() => {
                db.prepare(`INSERT INTO ml_bandit_posteriors
                    (level, cell_key, alpha, beta, observation_count, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)`).run(0, 'global', 0, 1, 0, Date.now());
            }).toThrow(/CHECK/);
        });
    });

    describe('371_ml_pooled_evidence', () => {
        test('migration applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?")
                .get('371_ml_pooled_evidence')).toBeTruthy();
        });
        test('columns', () => {
            const cols = db.prepare("PRAGMA table_info(ml_pooled_evidence)").all();
            const names = cols.map(c => c.name).sort();
            expect(names).toEqual([
                'cell_key', 'id', 'last_refresh_ts', 'pooled_alpha', 'pooled_beta',
                'staleness_observations_count', 'sum_contribution', 'updated_at'
            ]);
        });
        test('UNIQUE cell_key', () => {
            const now = Date.now();
            db.prepare(`INSERT INTO ml_pooled_evidence
                (cell_key, last_refresh_ts, pooled_alpha, pooled_beta,
                 sum_contribution, staleness_observations_count, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`).run('BTCUSDT:DEMO', now, 1, 1, 0, 0, now);
            expect(() => {
                db.prepare(`INSERT INTO ml_pooled_evidence
                    (cell_key, last_refresh_ts, pooled_alpha, pooled_beta,
                     sum_contribution, staleness_observations_count, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`).run('BTCUSDT:DEMO', now, 1, 1, 0, 0, now);
            }).toThrow(/UNIQUE/);
        });
    });

    describe('372_ml_bandit_evidence', () => {
        test('migration applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?")
                .get('372_ml_bandit_evidence')).toBeTruthy();
        });
        test('columns', () => {
            const cols = db.prepare("PRAGMA table_info(ml_bandit_evidence)").all();
            const names = cols.map(c => c.name).sort();
            expect(names).toEqual([
                'cell_key', 'confidence', 'contribution', 'created_at',
                'id', 'module_id', 'outcome_class', 'ts'
            ]);
        });
        test('outcome_class CHECK enforced', () => {
            expect(() => {
                db.prepare(`INSERT INTO ml_bandit_evidence
                    (cell_key, module_id, contribution, confidence, outcome_class, ts, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
                    'BTCUSDT:DEMO', 'm', 0.1, 0.5, 'invalid', Date.now(), Date.now());
            }).toThrow(/CHECK/);
        });
        test('index idx_mlbe_cell_ts exists', () => {
            const idx = db.prepare(`
                SELECT name FROM sqlite_master
                WHERE type='index' AND tbl_name='ml_bandit_evidence'
                  AND name='idx_mlbe_cell_ts'
            `).get();
            expect(idx).toBeTruthy();
        });
    });
});
