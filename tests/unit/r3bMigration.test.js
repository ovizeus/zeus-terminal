'use strict';

// [Wave 4] R3B migration — calibration buffer + OOD histogram tables.

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r3b-mig-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const { db } = require('../../server/services/database');

describe('migration 375_ml_r3b_calibration_buffer', () => {
    test('table ml_r3b_calibration exists with required columns', () => {
        const cols = db.prepare("PRAGMA table_info(ml_r3b_calibration)").all().map(r => r.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'regime', 'confidence_bucket', 'residual', 'outcome', 'ts'
        ]));
    });

    test('table ml_r3b_ood_histogram exists with required columns', () => {
        const cols = db.prepare("PRAGMA table_info(ml_r3b_ood_histogram)").all().map(r => r.name);
        expect(cols).toEqual(expect.arrayContaining([
            'feature_name', 'bin_id', 'count', 'updated_at'
        ]));
    });

    test('index on regime+ts for calibration buffer', () => {
        const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ml_r3b_calibration'").all();
        expect(idx.some(r => r.name.includes('regime'))).toBe(true);
    });
});
