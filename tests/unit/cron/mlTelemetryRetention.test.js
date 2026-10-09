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

// [WAL HIGH-WATER FIX 2026-10-08] Batch-deleting millions of rows writes a lot
// of WAL, and SQLite never shrinks that file on its own — it keeps the
// high-water mark. Found it at 4908 MB against a database whose pages only came
// to 2675 MB, i.e. ~5 GB of disk held for nothing, with the same page-cache
// pressure that caused the original freeze. The prune now truncates the WAL
// after it runs.
describe('WAL is truncated after a prune', () => {
    test('run() checkpoints with TRUNCATE when it deleted something', () => {
        const now = Date.now();
        const spec = retention.POLICY.find(s => s.table === 'ml_module_heartbeats');
        const stmt = db.prepare(`INSERT INTO ${spec.table} (${spec.column}) VALUES (?)`);
        for (let i = 0; i < 5; i++) stmt.run(now - (spec.days + 5) * DAY);
        const seen = [];
        const realPragma = db.pragma.bind(db);
        db.pragma = (p, o) => { seen.push(String(p)); return realPragma(p, o); };
        try {
            const res = retention.run({ now });
            expect(res.deleted.ml_module_heartbeats).toBe(5);
        } finally { db.pragma = realPragma; }
        expect(seen.some(p => /wal_checkpoint\(TRUNCATE\)/i.test(p))).toBe(true);
    });

    test('a run that deleted nothing does not checkpoint', () => {
        const seen = [];
        const realPragma = db.pragma.bind(db);
        db.pragma = (p, o) => { seen.push(String(p)); return realPragma(p, o); };
        try { retention.run({ now: Date.now() }); } finally { db.pragma = realPragma; }
        expect(seen.some(p => /wal_checkpoint/i.test(p))).toBe(false);
    });
});

// [2026-10-09 audit] The run logged only the TOTAL rows pruned, so there was no
// way to tell WHICH table lost them. Two policy tables (ml_dr_state,
// ml_reflection_runs) hold far less than their 30-day window implies and the
// logs cannot say why — an over-deleting policy entry would look identical to a
// quiet one. Per-table counts make the next run answer that by itself.
describe('the prune says what it pruned, per table', () => {
    test('the summary names each table that actually lost rows', () => {
        const logger = require('../../../server/services/logger');
        const spy = jest.spyOn(logger, 'info').mockImplementation(() => {});
        try {
            const now = Date.now();
            const spec = retention.POLICY[0];
            db.prepare(`DELETE FROM ${spec.table}`).run();
            const ins = db.prepare(`INSERT INTO ${spec.table} (${spec.column}) VALUES (?)`);
            for (let i = 0; i < 3; i++) ins.run(now - (spec.days + 10) * DAY);

            retention.run({ now });

            const said = spy.mock.calls.map((c) => String(c[1] || '')).join(' ');
            expect(said).toMatch(new RegExp(spec.table));
            expect(said).toMatch(/3/);
        } finally { spy.mockRestore(); }
    });
});
