'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-mig365-366-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');

describe('D-2.1 migrations 365 + 366', () => {
    describe('365_ml_module_heartbeats', () => {
        test('migration applied at boot', () => {
            const row = db.prepare("SELECT name FROM _migrations WHERE name = ?")
                .get('365_ml_module_heartbeats');
            expect(row).toBeTruthy();
        });

        test('table has all required columns', () => {
            const cols = db.prepare("PRAGMA table_info(ml_module_heartbeats)").all();
            const names = cols.map(c => c.name).sort();
            expect(names).toEqual([
                'id', 'invocation_count', 'latency_ms', 'module_id',
                'ran_ok', 'ts'
            ]);
        });

        test('ran_ok CHECK enforced (0|1)', () => {
            expect(() => {
                db.prepare(`
                    INSERT INTO ml_module_heartbeats
                    (module_id, ts, latency_ms, ran_ok, invocation_count)
                    VALUES (?, ?, ?, ?, ?)
                `).run('hb_bad', Date.now(), 1.0, 2, 1);
            }).toThrow(/CHECK/);
        });

        test('latency_ms must be non-negative', () => {
            expect(() => {
                db.prepare(`
                    INSERT INTO ml_module_heartbeats
                    (module_id, ts, latency_ms, ran_ok, invocation_count)
                    VALUES (?, ?, ?, ?, ?)
                `).run('hb_neg', Date.now(), -1.0, 1, 1);
            }).toThrow(/CHECK/);
        });

        test('index idx_mlmhb_module_ts exists', () => {
            const idx = db.prepare(`
                SELECT name FROM sqlite_master
                WHERE type = 'index' AND tbl_name = 'ml_module_heartbeats'
                  AND name = 'idx_mlmhb_module_ts'
            `).get();
            expect(idx).toBeTruthy();
        });
    });

    describe('366_ml_diagnostic_events', () => {
        test('migration applied at boot', () => {
            const row = db.prepare("SELECT name FROM _migrations WHERE name = ?")
                .get('366_ml_diagnostic_events');
            expect(row).toBeTruthy();
        });

        test('table has all required columns', () => {
            const cols = db.prepare("PRAGMA table_info(ml_diagnostic_events)").all();
            const names = cols.map(c => c.name).sort();
            expect(names).toEqual([
                'event_id', 'event_type', 'id', 'module_id',
                'payload_json', 'severity', 'ts', 'verdict'
            ]);
        });

        test('severity CHECK accepts all 5 enum values', () => {
            const now = Date.now();
            for (const sev of ['P0', 'P1', 'P2', 'P3', 'P0-FLOOD']) {
                db.prepare(`
                    INSERT INTO ml_diagnostic_events
                    (event_id, severity, module_id, event_type, payload_json, ts)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(`ev_${sev}`, sev, 'm', 't', '{}', now);
            }
        });

        test('severity CHECK rejects invalid value', () => {
            expect(() => {
                db.prepare(`
                    INSERT INTO ml_diagnostic_events
                    (event_id, severity, module_id, event_type, payload_json, ts)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run('ev_bad', 'PX', 'm', 't', '{}', Date.now());
            }).toThrow(/CHECK/);
        });

        test('verdict NULL allowed initially', () => {
            db.prepare(`
                INSERT INTO ml_diagnostic_events
                (event_id, severity, module_id, event_type, payload_json, ts)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run('ev_null_v', 'P2', 'm', 't', '{}', Date.now());
            const row = db.prepare(`SELECT verdict FROM ml_diagnostic_events WHERE event_id = ?`).get('ev_null_v');
            expect(row.verdict).toBeNull();
        });

        test('verdict accepts 4 enum values', () => {
            const now = Date.now();
            for (const v of ['real_incident', 'false_positive', 'inconclusive', 'partial']) {
                db.prepare(`
                    INSERT INTO ml_diagnostic_events
                    (event_id, severity, module_id, event_type, payload_json, verdict, ts)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(`ev_v_${v}`, 'P1', 'm', 't', '{}', v, now);
            }
        });

        test('verdict CHECK rejects invalid value', () => {
            expect(() => {
                db.prepare(`
                    INSERT INTO ml_diagnostic_events
                    (event_id, severity, module_id, event_type, payload_json, verdict, ts)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run('ev_bad_v', 'P1', 'm', 't', '{}', 'maybe', Date.now());
            }).toThrow(/CHECK/);
        });

        test('event_id UNIQUE enforced', () => {
            const now = Date.now();
            db.prepare(`
                INSERT INTO ml_diagnostic_events
                (event_id, severity, module_id, event_type, payload_json, ts)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run('ev_dup', 'P2', 'm', 't', '{}', now);
            expect(() => {
                db.prepare(`
                    INSERT INTO ml_diagnostic_events
                    (event_id, severity, module_id, event_type, payload_json, ts)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run('ev_dup', 'P2', 'm', 't', '{}', now);
            }).toThrow(/UNIQUE/);
        });

        test('index idx_mlde_severity_ts exists', () => {
            const idx = db.prepare(`
                SELECT name FROM sqlite_master
                WHERE type = 'index' AND tbl_name = 'ml_diagnostic_events'
                  AND name = 'idx_mlde_severity_ts'
            `).get();
            expect(idx).toBeTruthy();
        });

        test('index idx_mlde_module_verdict exists (FP-rate queries)', () => {
            const idx = db.prepare(`
                SELECT name FROM sqlite_master
                WHERE type = 'index' AND tbl_name = 'ml_diagnostic_events'
                  AND name = 'idx_mlde_module_verdict'
            `).get();
            expect(idx).toBeTruthy();
        });
    });
});
