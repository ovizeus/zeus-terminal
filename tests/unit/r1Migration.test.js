'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r1-mig-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const { db } = require('../../server/services/database');

describe('migration 376_ml_r1_violations', () => {
    test('table ml_r1_violations exists with required columns', () => {
        const cols = db.prepare("PRAGMA table_info(ml_r1_violations)").all().map(r => r.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'principle_id', 'principle_name',
            'symbol', 'side', 'severity', 'decision_payload_json',
            'enforcement_mode', 'ts',
        ]));
    });

    test('index on user_id+ts present', () => {
        const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ml_r1_violations'").all();
        expect(idx.some(r => r.name.includes('user'))).toBe(true);
    });
});
