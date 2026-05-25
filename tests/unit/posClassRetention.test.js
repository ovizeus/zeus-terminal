'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const os = require('os');
const fs = require('fs');

let db, cron;

beforeEach(() => {
    const tmp = path.join(os.tmpdir(), `zeus-test-poscls-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    db = new Database(tmp);
    db.exec(`
        CREATE TABLE position_classifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts INTEGER NOT NULL,
            pos_seq INTEGER,
            symbol TEXT,
            side TEXT,
            classified_as TEXT NOT NULL,
            vector TEXT,
            old_said TEXT,
            new_said TEXT,
            flag_state TEXT NOT NULL,
            ws_frame_age_ms INTEGER,
            source TEXT
        );
        CREATE INDEX idx_pos_class_ts ON position_classifications(ts);
    `);
    jest.resetModules();
    jest.doMock('../../server/services/database', () => ({ db }));
    jest.doMock('../../server/services/logger', () => ({
        info: jest.fn(),
        warn: jest.fn(),
    }));
    cron = require('../../server/cron/posClassRetention');
    cron._resetForTest();
});

afterEach(() => {
    try { db.close(); } catch (_) {}
});

function insertRow(ts, symbol = 'BTCUSDT', classified = 'AT') {
    db.prepare(
        `INSERT INTO position_classifications (ts, symbol, classified_as, flag_state) VALUES (?, ?, ?, 'shadow')`
    ).run(ts, symbol, classified);
}

test('prunes rows older than 30 days', () => {
    const now = Date.now();
    const old = now - 31 * 86400000;
    insertRow(old, 'BTCUSDT');
    insertRow(now, 'ETHUSDT');
    const deleted = cron.run();
    expect(deleted).toBe(1);
    const remaining = db.prepare('SELECT COUNT(*) as cnt FROM position_classifications').get();
    expect(remaining.cnt).toBe(1);
});

test('keeps rows within 30 days', () => {
    const now = Date.now();
    insertRow(now - 29 * 86400000);
    insertRow(now - 1 * 86400000);
    insertRow(now);
    const deleted = cron.run();
    expect(deleted).toBe(0);
    const remaining = db.prepare('SELECT COUNT(*) as cnt FROM position_classifications').get();
    expect(remaining.cnt).toBe(3);
});

test('returns 0 on empty table', () => {
    const deleted = cron.run();
    expect(deleted).toBe(0);
});

test('schedule registers interval', () => {
    const spy = jest.spyOn(global, 'setInterval').mockReturnValue(123);
    cron.schedule();
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 60000);
    spy.mockRestore();
});
