'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r7-mig-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const { db } = require('../../server/services/database');

describe('migration 377_ml_inter_ring_trace', () => {
    test('table ml_inter_ring_trace exists with required columns', () => {
        const cols = db.prepare("PRAGMA table_info(ml_inter_ring_trace)").all().map(r => r.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'caller_module', 'callee_module', 'method',
            'input_summary', 'output_summary', 'duration_ms', 'ok', 'ts',
        ]));
    });

    test('index on ts present for recent-N queries', () => {
        const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ml_inter_ring_trace'").all();
        expect(idx.some(r => r.name.includes('ts'))).toBe(true);
    });
});
