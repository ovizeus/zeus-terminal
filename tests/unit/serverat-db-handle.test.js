'use strict';

// [2026-06-07 soak audit B1/B2] serverAT.js imports the database MODULE
// (`const db = require('./database')`) whose export shape is `{ db, ...fns }`
// — the raw better-sqlite3 handle is `db.db`. Two call sites used `db.prepare`
// directly and threw `db.prepare is not a function` at runtime:
//
//   B1 (P0, money-path): _enqueueEmergencyClose — the emergency_close_queue
//      retry net for failed market closes. Fired live 2026-06-07 09:23:40
//      (seq 1776859653259, 4/4 close retries failed, enqueue ALSO failed,
//      "manual intervention required"; recon saved it 79s later).
//   B2 (P1): recon idle orphan sweep account query — crashed every 2nd idle
//      recon cycle all night ("idle orphan sweep account query failed").
//
// Test 1 is a lint-style regression net for the whole class; test 2 exercises
// the fixed enqueue against an in-memory DB via a test hook.

const fs = require('fs');
const path = require('path');

describe('B1/B2 — serverAT uses the raw sqlite handle (db.db), never db.prepare', () => {
    test('source contains no bare db.prepare( call sites', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '../../server/services/serverAT.js'), 'utf8');
        const bare = src.match(/(?<!\.)\bdb\.prepare\(/g) || [];
        expect(bare).toHaveLength(0);
    });
});

describe('B1 — _enqueueEmergencyClose persists the retry row', () => {
    let at, mockDb;

    beforeAll(() => {
        jest.resetModules();
        const Database = require('better-sqlite3');
        mockDb = new Database(':memory:');
        mockDb.exec(`CREATE TABLE emergency_close_queue (
            id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, symbol TEXT NOT NULL,
            exchange TEXT NOT NULL, qty TEXT NOT NULL, decision_key TEXT NOT NULL UNIQUE,
            created_at INTEGER NOT NULL, resolved_at INTEGER, resolved_by TEXT)`);
        jest.doMock('../../server/services/database', () => {
            const actual = jest.requireActual('../../server/services/database');
            return { ...actual, db: mockDb };
        });
        at = require('../../server/services/serverAT');
    });

    test('inserts into emergency_close_queue and is idempotent on decision_key', () => {
        const f = at._entryGateTestHooks.enqueueEmergencyClose;
        expect(typeof f).toBe('function');

        const pos = {
            seq: 999001, symbol: 'SOLUSDT', exchange: 'binance', qty: 61.71,
            live: { executedQty: '61.71' },
        };
        expect(f(1, pos, 'DSL_PL')).toBe(true);
        const row = mockDb.prepare('SELECT * FROM emergency_close_queue WHERE user_id = 1').get();
        expect(row).toBeTruthy();
        expect(row.symbol).toBe('SOLUSDT');
        expect(row.qty).toBe('61.71');
        expect(row.decision_key).toBe('closefail_999001_DSL_PL');

        // re-entry for the same position must not duplicate (INSERT OR IGNORE)
        expect(f(1, pos, 'DSL_PL')).toBe(true);
        const n = mockDb.prepare('SELECT COUNT(*) c FROM emergency_close_queue').get().c;
        expect(n).toBe(1);
    });
});
