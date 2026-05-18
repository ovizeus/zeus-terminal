'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r3b-ood-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const { db } = require('../../server/services/database');
const ood = require('../../server/services/ml/R3B_safety/oodDetector');

describe('oodDetector', () => {
    beforeEach(() => db.prepare("DELETE FROM ml_r3b_ood_histogram").run());

    test('cold start returns isOOD=false with low score', () => {
        const r = ood.score({ rsi: 50, adx: 25, confidence: 70 });
        expect(r.isOOD).toBe(false);
        expect(r.coldStart).toBe(true);
    });

    test('after observing 100 in-distribution samples, similar input scores low', () => {
        for (let i = 0; i < 100; i++) {
            ood.observe({
                rsi: 50 + (Math.random() - 0.5) * 10,
                adx: 25 + (Math.random() - 0.5) * 5,
                confidence: 70 + (Math.random() - 0.5) * 5,
            });
        }
        const r = ood.score({ rsi: 52, adx: 24, confidence: 69 });
        expect(r.isOOD).toBe(false);
        expect(r.score).toBeLessThan(0.5);
    });

    test('outlier scores high after baseline learned', () => {
        for (let i = 0; i < 100; i++) {
            ood.observe({ rsi: 50, adx: 25, confidence: 70 });
        }
        const r = ood.score({ rsi: 95, adx: 80, confidence: 95 });
        expect(r.isOOD).toBe(true);
        expect(r.score).toBeGreaterThan(0.7);
    });

    test('novel feature flagged when never observed', () => {
        ood.observe({ rsi: 50, adx: 25, confidence: 70 });
        const r = ood.score({ rsi: 50, adx: 25, confidence: 70, freshFeature: 0.99 });
        expect(r.novelFeatures).toContain('freshFeature');
    });
});
