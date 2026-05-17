'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-mig367-368-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');

describe('D-5.1 migrations 367 + 368', () => {
    describe('367_ml_module_quarantines', () => {
        test('migration applied at boot', () => {
            const row = db.prepare("SELECT name FROM _migrations WHERE name = ?")
                .get('367_ml_module_quarantines');
            expect(row).toBeTruthy();
        });

        test('table has all required columns', () => {
            const cols = db.prepare("PRAGMA table_info(ml_module_quarantines)").all();
            const names = cols.map(c => c.name).sort();
            expect(names).toEqual([
                'id', 'lift_reason', 'lifted_at', 'module_id',
                'operator_id', 'quarantine_action', 'quarantined_at',
                'reason', 'ts'
            ]);
        });

        test('quarantine_action CHECK enforced', () => {
            expect(() => {
                db.prepare(`
                    INSERT INTO ml_module_quarantines
                    (module_id, quarantine_action, reason, quarantined_at, ts)
                    VALUES (?, ?, ?, ?, ?)
                `).run('m_bad_a', 'invalid_action', 'r', Date.now(), Date.now());
            }).toThrow(/CHECK/);
        });

        test('clamp_influence value accepted', () => {
            db.prepare(`
                INSERT INTO ml_module_quarantines
                (module_id, quarantine_action, reason, quarantined_at, ts)
                VALUES (?, ?, ?, ?, ?)
            `).run('m_clamp', 'clamp_influence', 'low trust', Date.now(), Date.now());
            const row = db.prepare("SELECT quarantine_action FROM ml_module_quarantines WHERE module_id = ?").get('m_clamp');
            expect(row.quarantine_action).toBe('clamp_influence');
        });

        test('disable + shadow_only actions accepted', () => {
            const now = Date.now();
            db.prepare(`
                INSERT INTO ml_module_quarantines
                (module_id, quarantine_action, reason, quarantined_at, ts)
                VALUES (?, ?, ?, ?, ?)
            `).run('m_disable', 'disable', 'critical fail', now, now);
            db.prepare(`
                INSERT INTO ml_module_quarantines
                (module_id, quarantine_action, reason, quarantined_at, ts)
                VALUES (?, ?, ?, ?, ?)
            `).run('m_shadow', 'shadow_only', 'output suppressed', now, now);
        });

        test('lifted_at NULL = active', () => {
            const now = Date.now();
            db.prepare(`
                INSERT INTO ml_module_quarantines
                (module_id, quarantine_action, reason, quarantined_at, ts)
                VALUES (?, ?, ?, ?, ?)
            `).run('m_active', 'clamp_influence', 'test', now, now);
            const active = db.prepare(`
                SELECT * FROM ml_module_quarantines WHERE module_id = ? AND lifted_at IS NULL
            `).get('m_active');
            expect(active).toBeTruthy();
        });

        test('index idx_mlmq_module_active exists', () => {
            const idx = db.prepare(`
                SELECT name FROM sqlite_master
                WHERE type = 'index' AND tbl_name = 'ml_module_quarantines'
                  AND name = 'idx_mlmq_module_active'
            `).get();
            expect(idx).toBeTruthy();
        });
    });

    describe('368_ml_doctor_override_journal', () => {
        test('migration applied at boot', () => {
            const row = db.prepare("SELECT name FROM _migrations WHERE name = ?")
                .get('368_ml_doctor_override_journal');
            expect(row).toBeTruthy();
        });

        test('table has all required columns', () => {
            const cols = db.prepare("PRAGMA table_info(ml_doctor_override_journal)").all();
            const names = cols.map(c => c.name).sort();
            expect(names).toEqual([
                'decided_at', 'doctor_recommended_action', 'id',
                'module_id', 'operator_forced_action', 'operator_id',
                'operator_reason', 'outcome_verdict', 'ts'
            ]);
        });

        test('outcome_verdict NULL allowed initially', () => {
            const now = Date.now();
            db.prepare(`
                INSERT INTO ml_doctor_override_journal
                (module_id, doctor_recommended_action, operator_forced_action,
                 operator_reason, operator_id, decided_at, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run('m_null', 'quarantine', 'allow_continue', 'low risk', 1, now, now);
            const row = db.prepare("SELECT outcome_verdict FROM ml_doctor_override_journal WHERE module_id = ?").get('m_null');
            expect(row.outcome_verdict).toBeNull();
        });

        test('outcome_verdict accepts 4 enum values', () => {
            const now = Date.now();
            for (const v of ['doctor_was_right', 'operator_was_right', 'inconclusive', 'partial']) {
                db.prepare(`
                    INSERT INTO ml_doctor_override_journal
                    (module_id, doctor_recommended_action, operator_forced_action,
                     operator_reason, operator_id, outcome_verdict, decided_at, ts)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(`m_v_${v}`, 'q', 'a', 'r', 1, v, now, now);
            }
        });

        test('outcome_verdict CHECK rejects invalid value', () => {
            expect(() => {
                db.prepare(`
                    INSERT INTO ml_doctor_override_journal
                    (module_id, doctor_recommended_action, operator_forced_action,
                     operator_reason, operator_id, outcome_verdict, decided_at, ts)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run('m_v_bad', 'q', 'a', 'r', 1, 'whatever', Date.now(), Date.now());
            }).toThrow(/CHECK/);
        });

        test('index idx_mldoj_module_ts exists', () => {
            const idx = db.prepare(`
                SELECT name FROM sqlite_master
                WHERE type = 'index' AND tbl_name = 'ml_doctor_override_journal'
                  AND name = 'idx_mldoj_module_ts'
            `).get();
            expect(idx).toBeTruthy();
        });
    });
});
