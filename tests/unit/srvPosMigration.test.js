'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

describe('position_classifications migration', () => {
    let db;

    beforeEach(() => {
        const tmp = path.join(os.tmpdir(), `zeus-mig-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
        process.env.ZEUS_DB_PATH = tmp;
        jest.resetModules();
        const mod = require('../../server/services/database');
        db = mod.db;
    });

    afterEach(() => {
        try { db.close(); } catch (_) {}
        delete process.env.ZEUS_DB_PATH;
    });

    test('position_classifications table exists after migration', () => {
        const row = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='position_classifications'"
        ).get();
        expect(row).toBeTruthy();
        expect(row.name).toBe('position_classifications');
    });

    test('table has correct columns', () => {
        const cols = db.prepare("PRAGMA table_info('position_classifications')").all();
        const names = cols.map(c => c.name);
        expect(names).toContain('ts');
        expect(names).toContain('pos_seq');
        expect(names).toContain('symbol');
        expect(names).toContain('classified_as');
        expect(names).toContain('vector');
        expect(names).toContain('flag_state');
        expect(names).toContain('ws_frame_age_ms');
        expect(names).toContain('source');
    });

    test('classified_as CHECK constraint enforced', () => {
        expect(() => {
            db.prepare(
                `INSERT INTO position_classifications (ts, classified_as, flag_state) VALUES (?, 'INVALID', 'shadow')`
            ).run(Date.now());
        }).toThrow();
    });

    test('flag_state CHECK constraint enforced', () => {
        expect(() => {
            db.prepare(
                `INSERT INTO position_classifications (ts, classified_as, flag_state) VALUES (?, 'AT', 'INVALID')`
            ).run(Date.now());
        }).toThrow();
    });

    test('valid insert works', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO position_classifications (ts, pos_seq, symbol, side, classified_as, vector, flag_state, source)
             VALUES (?, 1, 'BTCUSDT', 'LONG', 'AT', 'v1', 'shadow', 'test')`
        ).run(ts);
        const row = db.prepare('SELECT * FROM position_classifications WHERE ts = ?').get(ts);
        expect(row.symbol).toBe('BTCUSDT');
        expect(row.classified_as).toBe('AT');
    });

    test('index exists on ts', () => {
        const idx = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_pos_class_ts'"
        ).get();
        expect(idx).toBeTruthy();
    });
});
