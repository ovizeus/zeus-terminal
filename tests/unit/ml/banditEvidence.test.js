'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-ev-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const be = require('../../../server/services/ml/_ring5/banditEvidence');

const _now = () => Date.now();

function clean() {
    db.prepare("DELETE FROM ml_bandit_evidence").run();
}

describe('banditEvidence (Phase 3)', () => {
    beforeEach(clean);

    describe('recordEvidence', () => {
        test('inserts row', () => {
            be.recordEvidence({
                cellKey: 'DEMO:BTCUSDT', moduleId: 'mod_a',
                contribution: 0.3, confidence: 0.7,
                outcomeClass: 'positive', ts: _now()
            });
            const n = db.prepare("SELECT COUNT(*) AS n FROM ml_bandit_evidence").get().n;
            expect(n).toBe(1);
        });
        test('rejects outcomeClass not in enum', () => {
            expect(() => be.recordEvidence({
                cellKey: 'x', moduleId: 'm', contribution: 0, confidence: 0.5,
                outcomeClass: 'maybe', ts: _now()
            })).toThrow(/outcomeClass/);
        });
        test('rejects confidence outside [0,1]', () => {
            expect(() => be.recordEvidence({
                cellKey: 'x', moduleId: 'm', contribution: 0, confidence: 1.5,
                outcomeClass: 'positive', ts: _now()
            })).toThrow(/confidence/);
        });
        test('rejects missing required field', () => {
            expect(() => be.recordEvidence({
                cellKey: 'x', moduleId: 'm', contribution: 0,
                outcomeClass: 'positive', ts: _now()
            })).toThrow(/confidence/);
        });
    });

    describe('countSince', () => {
        test('returns 0 for cell with no evidence', () => {
            expect(be.countSince({ cellKey: 'empty', sinceTs: 0 })).toBe(0);
        });
        test('counts only rows since cutoff ts', () => {
            const t = _now();
            be.recordEvidence({ cellKey: 'c1', moduleId: 'm', contribution: 0, confidence: 0.5, outcomeClass: 'positive', ts: t - 1000 });
            be.recordEvidence({ cellKey: 'c1', moduleId: 'm', contribution: 0, confidence: 0.5, outcomeClass: 'positive', ts: t + 1000 });
            be.recordEvidence({ cellKey: 'c1', moduleId: 'm', contribution: 0, confidence: 0.5, outcomeClass: 'positive', ts: t + 2000 });
            expect(be.countSince({ cellKey: 'c1', sinceTs: t })).toBe(2);
        });
    });

    describe('aggregateSince (windowed pooled stats)', () => {
        test('zero counts return uniform prior shape', () => {
            const r = be.aggregateSince({ cellKey: 'empty', sinceTs: 0 });
            expect(r).toEqual({ pooledAlpha: 1, pooledBeta: 1, sumContribution: 0, n: 0 });
        });
        test('aggregates positive + negative + neutral with prior', () => {
            const t = _now();
            for (let i = 0; i < 5; i++) be.recordEvidence({ cellKey: 'ag', moduleId: 'm', contribution: 0.2, confidence: 0.7, outcomeClass: 'positive', ts: t + i });
            for (let i = 0; i < 2; i++) be.recordEvidence({ cellKey: 'ag', moduleId: 'm', contribution: -0.1, confidence: 0.6, outcomeClass: 'negative', ts: t + 100 + i });
            be.recordEvidence({ cellKey: 'ag', moduleId: 'm', contribution: 0, confidence: 0.5, outcomeClass: 'neutral', ts: t + 200 });
            const r = be.aggregateSince({ cellKey: 'ag', sinceTs: 0 });
            expect(r.pooledAlpha).toBe(6);
            expect(r.pooledBeta).toBe(3);
            expect(r.n).toBe(8);
            expect(r.sumContribution).toBeCloseTo(5 * 0.2 + 2 * -0.1 + 0, 5);
        });
        test('respects sinceTs cutoff', () => {
            const t = _now();
            be.recordEvidence({ cellKey: 'cut', moduleId: 'm', contribution: 0.5, confidence: 0.5, outcomeClass: 'positive', ts: t - 5000 });
            be.recordEvidence({ cellKey: 'cut', moduleId: 'm', contribution: 0.5, confidence: 0.5, outcomeClass: 'positive', ts: t + 1000 });
            const r = be.aggregateSince({ cellKey: 'cut', sinceTs: t });
            expect(r.n).toBe(1);
            expect(r.pooledAlpha).toBe(2);
        });
    });
});
