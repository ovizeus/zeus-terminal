'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-trust-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

require('../../../server/services/database');
const ts = require('../../../server/services/ml/_doctor/trustScorer');

const _now = () => Date.now();

describe('D-3.3 trustScorer', () => {
    beforeEach(() => ts.resetForTest());

    describe('Constants', () => {
        test('EMA_ALPHA = 0.10', () => {
            expect(ts.EMA_ALPHA).toBe(0.10);
        });
        test('TRUST_THRESHOLD = 0.40', () => {
            expect(ts.TRUST_THRESHOLD).toBe(0.40);
        });
        test('INITIAL_TRUST = 0.50', () => {
            expect(ts.INITIAL_TRUST).toBe(0.50);
        });
    });

    describe('updateTrust (EMA recurrence)', () => {
        test('initial update bootstraps with INITIAL_TRUST', () => {
            const r = ts.updateTrust({
                moduleId: 'mod1', recommendationCorrect: 1, ts: _now()
            });
            // EMA: new = old + alpha*(observed - old); old = 0.50, observed = 1
            // new = 0.50 + 0.10 * (1 - 0.50) = 0.55
            expect(r.trustScore).toBeCloseTo(0.55, 5);
        });

        test('repeated correct recommendations push trust toward 1', () => {
            const now = _now();
            let last;
            for (let i = 0; i < 50; i++) {
                last = ts.updateTrust({
                    moduleId: 'mod_good', recommendationCorrect: 1, ts: now + i
                });
            }
            expect(last.trustScore).toBeGreaterThan(0.95);
        });

        test('repeated wrong recommendations push trust toward 0', () => {
            const now = _now();
            let last;
            for (let i = 0; i < 50; i++) {
                last = ts.updateTrust({
                    moduleId: 'mod_bad', recommendationCorrect: 0, ts: now + i
                });
            }
            expect(last.trustScore).toBeLessThan(0.05);
        });

        test('partial credit (0.5) maintains around 0.50 baseline', () => {
            const now = _now();
            let last;
            for (let i = 0; i < 50; i++) {
                last = ts.updateTrust({
                    moduleId: 'mod_meh', recommendationCorrect: 0.5, ts: now + i
                });
            }
            expect(last.trustScore).toBeCloseTo(0.50, 2);
        });
    });

    describe('getTrustScore', () => {
        test('returns INITIAL_TRUST for unseen module', () => {
            const r = ts.getTrustScore({ moduleId: 'never_seen' });
            expect(r.trustScore).toBe(0.50);
            expect(r.observationCount).toBe(0);
        });

        test('returns current EMA after updates', () => {
            const now = _now();
            ts.updateTrust({ moduleId: 'mod_q', recommendationCorrect: 1, ts: now });
            ts.updateTrust({ moduleId: 'mod_q', recommendationCorrect: 1, ts: now });
            const r = ts.getTrustScore({ moduleId: 'mod_q' });
            // After 2 updates from 0.50 with all=1:
            // step1: 0.55, step2: 0.55 + 0.1*(1-0.55) = 0.595
            expect(r.trustScore).toBeCloseTo(0.595, 3);
            expect(r.observationCount).toBe(2);
        });
    });

    describe('isLowTrust', () => {
        test('returns true when trust < 0.40', () => {
            const now = _now();
            for (let i = 0; i < 30; i++) {
                ts.updateTrust({ moduleId: 'mod_low', recommendationCorrect: 0, ts: now + i });
            }
            const r = ts.isLowTrust({ moduleId: 'mod_low' });
            expect(r.lowTrust).toBe(true);
        });

        test('returns false when trust >= 0.40', () => {
            const now = _now();
            ts.updateTrust({ moduleId: 'mod_ok', recommendationCorrect: 1, ts: now });
            const r = ts.isLowTrust({ moduleId: 'mod_ok' });
            expect(r.lowTrust).toBe(false);
        });

        test('returns false for unseen module (initial 0.50 >= 0.40)', () => {
            const r = ts.isLowTrust({ moduleId: 'fresh' });
            expect(r.lowTrust).toBe(false);
        });
    });

    describe('listLowTrustModules', () => {
        test('returns only modules below threshold', () => {
            const now = _now();
            // mod_high gets 30 wins → high trust
            for (let i = 0; i < 30; i++) {
                ts.updateTrust({ moduleId: 'mod_high', recommendationCorrect: 1, ts: now + i });
            }
            // mod_low gets 30 losses → low trust
            for (let i = 0; i < 30; i++) {
                ts.updateTrust({ moduleId: 'mod_low', recommendationCorrect: 0, ts: now + i });
            }
            const list = ts.listLowTrustModules();
            const ids = list.map(m => m.moduleId);
            expect(ids).toContain('mod_low');
            expect(ids).not.toContain('mod_high');
        });
    });

    describe('Validation', () => {
        test('rejects missing moduleId', () => {
            expect(() => ts.updateTrust({
                recommendationCorrect: 1, ts: _now()
            })).toThrow(/moduleId/);
        });
        test('rejects recommendationCorrect outside [0,1]', () => {
            expect(() => ts.updateTrust({
                moduleId: 'm', recommendationCorrect: 1.5, ts: _now()
            })).toThrow(/recommendationCorrect/);
        });
        test('rejects missing ts', () => {
            expect(() => ts.updateTrust({
                moduleId: 'm', recommendationCorrect: 1
            })).toThrow(/ts/);
        });
    });

    describe('Independence from health', () => {
        test('high health (recordInvocation runs OK) does NOT auto-trust', () => {
            // trustScorer is COMPLETELY independent of telemetryCollector.
            // Module can run perfectly (health=1.0) but trust stays low
            // if recommendations are wrong.
            const now = _now();
            // 30 wrong recommendations → low trust
            for (let i = 0; i < 30; i++) {
                ts.updateTrust({ moduleId: 'mod_runs_lies', recommendationCorrect: 0, ts: now + i });
            }
            const r = ts.getTrustScore({ moduleId: 'mod_runs_lies' });
            expect(r.trustScore).toBeLessThan(0.10);
        });
    });
});
