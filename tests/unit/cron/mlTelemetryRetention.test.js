'use strict';
// tests/unit/cron/mlTelemetryRetention.test.js
// [RETENTION GAP FIX 2026-10-07] The 2026-06-11 audit (b128 F1/F2) added
// retention for ml_influence_audit + brain_parity_log but MISSED six larger
// tables, which grew unbounded to 2.5M rows each and took the DB to 7.9 GB.
// Deletes are batched with a time budget on purpose: an unbounded DELETE over
// millions of rows is itself a main-thread freeze, which is the bug class we
// are fixing here.

const fs = require('fs');
const os = require('os');
const path = require('path');

let db, retention;
const DAY = 86400000;

beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mltelret-'));
    process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
    db = require('../../../server/services/database').db;
    retention = require('../../../server/cron/mlTelemetryRetention');
    // Minimal disposable shapes — the prune SQL only touches the time column.
    for (const spec of retention.POLICY) {
        db.exec(`DROP TABLE IF EXISTS ${spec.table};`);
        db.exec(`CREATE TABLE ${spec.table} (id INTEGER PRIMARY KEY, ${spec.column} INTEGER);`);
    }
});

afterEach(() => {
    for (const spec of retention.POLICY) db.exec(`DELETE FROM ${spec.table};`);
    retention._resetForTest();
});

function seed(spec, ageDays, n, now) {
    const stmt = db.prepare(`INSERT INTO ${spec.table} (${spec.column}) VALUES (?)`);
    for (let i = 0; i < n; i++) stmt.run(now - ageDays * DAY);
}
const count = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;

describe('mlTelemetryRetention', () => {
    test('every policy entry names a real retention window and time column', () => {
        expect(retention.POLICY.length).toBeGreaterThanOrEqual(6);
        for (const s of retention.POLICY) {
            expect(typeof s.table).toBe('string');
            expect(['ts', 'created_at', 'started_at']).toContain(s.column);
            expect(s.days).toBeGreaterThan(0);
        }
    });

    test('deletes rows older than the window and keeps newer ones', () => {
        const now = Date.now();
        const spec = retention.POLICY.find(s => s.table === 'ml_module_heartbeats');
        seed(spec, spec.days + 5, 10, now); // old
        seed(spec, 1, 4, now);              // fresh
        const res = retention.run({ now });
        expect(res.deleted.ml_module_heartbeats).toBe(10);
        expect(count('ml_module_heartbeats')).toBe(4);
    });

    test('rows exactly at the boundary are kept (strict older-than)', () => {
        const now = Date.now();
        const spec = retention.POLICY.find(s => s.table === 'ml_decision_light');
        db.prepare(`INSERT INTO ml_decision_light (${spec.column}) VALUES (?)`).run(now - spec.days * DAY);
        retention.run({ now });
        expect(count('ml_decision_light')).toBe(1);
    });

    test('never deletes more than batchSize × maxBatches in one run', () => {
        const now = Date.now();
        const spec = retention.POLICY.find(s => s.table === 'ml_pit_snapshots');
        seed(spec, spec.days + 1, 50, now);
        const res = retention.run({ now, batchSize: 10, maxBatchesPerTable: 2 });
        expect(res.deleted.ml_pit_snapshots).toBe(20);
        expect(count('ml_pit_snapshots')).toBe(30);
    });

    test('a missing table is skipped without throwing', () => {
        const now = Date.now();
        db.exec('DROP TABLE IF EXISTS ml_reflection_runs;');
        expect(() => retention.run({ now })).not.toThrow();
        const res = retention.run({ now });
        expect(res.errors).toContain('ml_reflection_runs');
        db.exec('CREATE TABLE ml_reflection_runs (id INTEGER PRIMARY KEY, started_at INTEGER);');
    });

    test('stops when the time budget is spent', () => {
        const now = Date.now();
        const spec = retention.POLICY.find(s => s.table === 'ml_decision_snapshots');
        seed(spec, spec.days + 1, 40, now);
        const res = retention.run({ now, batchSize: 1, maxBatchesPerTable: 1000, timeBudgetMs: 0 });
        expect(res.budgetExhausted).toBe(true);
        expect(count('ml_decision_snapshots')).toBeGreaterThan(0);
    });

    test('each table is pruned by ITS OWN window, not a shared one', () => {
        const now = Date.now();
        const hb = retention.POLICY.find(s => s.table === 'ml_module_heartbeats'); // 7d
        const voice = retention.POLICY.find(s => s.table === 'ml_voice_log');      // 90d
        expect(hb.days).toBeLessThan(voice.days);
        seed(hb, 30, 3, now);    // older than 7d  → gone
        seed(voice, 30, 3, now); // younger than 90d → kept
        retention.run({ now });
        expect(count('ml_module_heartbeats')).toBe(0);
        expect(count('ml_voice_log')).toBe(3);
    });
});
