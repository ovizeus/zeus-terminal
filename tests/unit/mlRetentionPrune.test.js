'use strict';
// tests/unit/mlRetentionPrune.test.js
// [AUDIT-F1/F2 2026-06-11] Retention for the two unbounded ML tables.
// Mirrors the existing bdPrune model (brain_decisions). created_at is ms.

const fs = require('fs');
const os = require('os');
const path = require('path');

let db;
beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mlretention-'));
    process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
    db = require('../../server/services/database').db;
    // Migrations create the real tables with many NOT NULL columns. The prune
    // SQL only touches created_at, so for an isolated test we drop+recreate
    // minimal shapes (disposable test DB) — keeps the test independent of the
    // full production schema while exercising the exact DELETE statements.
    db.exec('DROP TABLE IF EXISTS ml_influence_audit; DROP TABLE IF EXISTS brain_parity_log;');
    db.exec(`CREATE TABLE ml_influence_audit (id INTEGER PRIMARY KEY, user_id INTEGER, created_at INTEGER);`);
    db.exec(`CREATE TABLE brain_parity_log (id INTEGER PRIMARY KEY, user_id INTEGER, created_at INTEGER);`);
});

afterEach(() => {
    db.exec('DELETE FROM ml_influence_audit; DELETE FROM brain_parity_log;');
});

describe('ML retention prune', () => {
    const DAY = 86400000;

    test('mlAuditPrune deletes rows older than 30 days, keeps newer', () => {
        const dbapi = require('../../server/services/database');
        const now = Date.now();
        // real table has NOT NULL user_id — include it (value irrelevant to the prune)
        db.prepare('INSERT INTO ml_influence_audit (user_id, created_at) VALUES (1, ?)').run(now - 40 * DAY); // old
        db.prepare('INSERT INTO ml_influence_audit (user_id, created_at) VALUES (1, ?)').run(now - 5 * DAY);  // fresh
        const deleted = dbapi.mlAuditPrune(now);
        expect(deleted).toBe(1);
        expect(db.prepare('SELECT COUNT(*) c FROM ml_influence_audit').get().c).toBe(1);
    });

    test('parityPrune deletes rows older than 60 days, keeps newer', () => {
        const dbapi = require('../../server/services/database');
        const now = Date.now();
        db.prepare('INSERT INTO brain_parity_log (user_id, created_at) VALUES (1, ?)').run(now - 70 * DAY); // old
        db.prepare('INSERT INTO brain_parity_log (user_id, created_at) VALUES (1, ?)').run(now - 10 * DAY); // fresh
        const deleted = dbapi.parityPrune(now);
        expect(deleted).toBe(1);
        expect(db.prepare('SELECT COUNT(*) c FROM brain_parity_log').get().c).toBe(1);
    });

    test('prunes never throw on empty tables', () => {
        const dbapi = require('../../server/services/database');
        expect(() => dbapi.mlAuditPrune(Date.now())).not.toThrow();
        expect(() => dbapi.parityPrune(Date.now())).not.toThrow();
    });
});
