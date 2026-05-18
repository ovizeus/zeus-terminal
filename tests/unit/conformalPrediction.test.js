'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r3b-cp-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const { db } = require('../../server/services/database');
const cp = require('../../server/services/ml/R3B_safety/conformalPrediction');

function seedResidual(regime, conf, residual, outcome) {
    db.prepare(`INSERT INTO ml_r3b_calibration (regime, confidence_bucket, residual, outcome, ts) VALUES (?, ?, ?, ?, ?)`)
       .run(regime, conf, residual, outcome, Date.now());
}

describe('conformalPrediction', () => {
    beforeEach(() => db.prepare("DELETE FROM ml_r3b_calibration").run());

    test('cold start (< 30 samples) returns wide default interval', () => {
        const r = cp.predictInterval({ regime: 'TREND', confidence: 75, predicted: 0.8 });
        expect(r.coldStart).toBe(true);
        expect(r.upper - r.lower).toBeGreaterThan(0.3);
    });

    test('with 100 calibration samples returns tight interval', () => {
        for (let i = 0; i < 100; i++) {
            seedResidual('TREND', 7, (Math.random() - 0.5) * 0.04, Math.random());
        }
        const r = cp.predictInterval({ regime: 'TREND', confidence: 75, predicted: 0.8 });
        expect(r.coldStart).toBe(false);
        expect(r.upper - r.lower).toBeLessThan(0.1);
        expect(r.lower).toBeLessThan(0.8);
        expect(r.upper).toBeGreaterThan(0.8);
    });

    test('recordOutcome appends to calibration buffer', () => {
        cp.recordOutcome({ regime: 'RANGE', confidence: 60, predicted: 0.5, actual: 0.52 });
        const rows = db.prepare("SELECT * FROM ml_r3b_calibration").all();
        expect(rows.length).toBe(1);
        expect(rows[0].regime).toBe('RANGE');
        expect(Math.abs(rows[0].residual - 0.02)).toBeLessThan(0.001);
    });

    test('buffer caps at MAX_PER_BUCKET (200) per regime', () => {
        for (let i = 0; i < 250; i++) {
            cp.recordOutcome({ regime: 'TREND', confidence: 70, predicted: 0.5, actual: 0.5 });
        }
        const count = db.prepare("SELECT COUNT(*) AS n FROM ml_r3b_calibration WHERE regime='TREND'").get().n;
        expect(count).toBeLessThanOrEqual(200);
    });

    test('different regimes have isolated buffers', () => {
        for (let i = 0; i < 50; i++) seedResidual('TREND', 7, 0.01, 0.5);
        for (let i = 0; i < 50; i++) seedResidual('RANGE', 5, 0.05, 0.5);
        const trendInterval = cp.predictInterval({ regime: 'TREND', confidence: 70, predicted: 0.8 });
        const rangeInterval = cp.predictInterval({ regime: 'RANGE', confidence: 50, predicted: 0.8 });
        expect(rangeInterval.upper - rangeInterval.lower).toBeGreaterThan(trendInterval.upper - trendInterval.lower);
    });
});
