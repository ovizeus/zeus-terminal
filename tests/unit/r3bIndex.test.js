'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r3b-idx-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const r3b = require('../../server/services/ml/R3B_safety');

describe('R3B_safety index', () => {
    test('evaluate returns { cp, ood } shape', () => {
        const r = r3b.evaluate({
            regime: 'TREND', confidence: 70, predicted: 0.8,
            features: { rsi: 60, adx: 30 },
        });
        expect(r.cp).toBeDefined();
        expect(r.cp.lower).toBeLessThanOrEqual(0.8);
        expect(r.cp.upper).toBeGreaterThanOrEqual(0.8);
        expect(r.ood).toBeDefined();
        expect(typeof r.ood.score).toBe('number');
    });

    test('observeOutcome dispatches to both CP + OOD', () => {
        r3b.observeOutcome({
            regime: 'RANGE', confidence: 50, predicted: 0.5, actual: 0.55,
            features: { rsi: 50, adx: 20 },
        });
    });
});
