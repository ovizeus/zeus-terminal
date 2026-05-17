'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-decay-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

require('../../../server/services/database');
const trustScorer = require('../../../server/services/ml/_doctor/trustScorer');
const decay = require('../../../server/services/ml/_doctor/decayScheduler');

const _now = () => Date.now();
const _daysAgo = (d) => _now() - d * 86400_000;

describe('D-3.4 decayScheduler', () => {
    beforeEach(() => {
        trustScorer.resetForTest();
        decay.resetForTest();
    });

    describe('Constants', () => {
        test('TRUST_DECAY_PER_DAY = 0.02 (2% pull toward INITIAL each idle day)', () => {
            expect(decay.TRUST_DECAY_PER_DAY).toBe(0.02);
        });
        test('QUARANTINE_DECAY_DAYS = 7', () => {
            expect(decay.QUARANTINE_DECAY_DAYS).toBe(7);
        });
        test('TRUST_DECAY_TARGET = INITIAL_TRUST 0.50', () => {
            expect(decay.TRUST_DECAY_TARGET).toBe(0.50);
        });
    });

    describe('decayTrustForIdleModule', () => {
        test('no decay if module observed within last 24h', () => {
            const now = _now();
            // Build a high-trust module
            for (let i = 0; i < 30; i++) {
                trustScorer.updateTrust({
                    moduleId: 'mod_recent', recommendationCorrect: 1, ts: now + i
                });
            }
            const before = trustScorer.getTrustScore({ moduleId: 'mod_recent' }).trustScore;
            // Run decay scheduler with nowTs = same day
            decay.decayTrustForIdleModule({ moduleId: 'mod_recent', nowTs: now + 1000 });
            const after = trustScorer.getTrustScore({ moduleId: 'mod_recent' }).trustScore;
            expect(after).toBeCloseTo(before, 5);
        });

        test('pulls high trust toward 0.50 after long idle', () => {
            const lastUpdate = _daysAgo(30);
            // Build high trust at lastUpdate
            for (let i = 0; i < 30; i++) {
                trustScorer.updateTrust({
                    moduleId: 'mod_idle_high', recommendationCorrect: 1, ts: lastUpdate + i
                });
            }
            const before = trustScorer.getTrustScore({ moduleId: 'mod_idle_high' }).trustScore;
            expect(before).toBeGreaterThan(0.95);
            decay.decayTrustForIdleModule({ moduleId: 'mod_idle_high', nowTs: _now() });
            const after = trustScorer.getTrustScore({ moduleId: 'mod_idle_high' }).trustScore;
            // 30 days × 0.02 = 0.60 pull strength toward 0.50
            // Should drop noticeably from 0.95+ but not all the way
            expect(after).toBeLessThan(before);
            expect(after).toBeGreaterThan(0.50);
        });

        test('pulls low trust toward 0.50 after long idle', () => {
            const lastUpdate = _daysAgo(30);
            for (let i = 0; i < 30; i++) {
                trustScorer.updateTrust({
                    moduleId: 'mod_idle_low', recommendationCorrect: 0, ts: lastUpdate + i
                });
            }
            const before = trustScorer.getTrustScore({ moduleId: 'mod_idle_low' }).trustScore;
            expect(before).toBeLessThan(0.05);
            decay.decayTrustForIdleModule({ moduleId: 'mod_idle_low', nowTs: _now() });
            const after = trustScorer.getTrustScore({ moduleId: 'mod_idle_low' }).trustScore;
            expect(after).toBeGreaterThan(before);
            expect(after).toBeLessThan(0.50);
        });

        test('does not exceed TRUST_DECAY_TARGET 0.50', () => {
            const lastUpdate = _daysAgo(365);  // 1 year idle
            for (let i = 0; i < 30; i++) {
                trustScorer.updateTrust({
                    moduleId: 'mod_year_idle', recommendationCorrect: 0, ts: lastUpdate + i
                });
            }
            decay.decayTrustForIdleModule({ moduleId: 'mod_year_idle', nowTs: _now() });
            const after = trustScorer.getTrustScore({ moduleId: 'mod_year_idle' }).trustScore;
            // Cannot overshoot above 0.50 starting from below
            expect(after).toBeLessThanOrEqual(0.50);
            expect(after).toBeGreaterThan(0.45);
        });
    });

    describe('Quarantine penalty decay', () => {
        test('penalty starts at 1.0 when quarantined', () => {
            const r = decay.computeQuarantinePenalty({
                quarantinedAt: _now(), nowTs: _now()
            });
            expect(r.penalty).toBe(1.0);
        });

        test('penalty linearly decays over 7 days to 0', () => {
            const start = _now() - 7 * 86400_000;
            const r = decay.computeQuarantinePenalty({
                quarantinedAt: start, nowTs: _now()
            });
            expect(r.penalty).toBe(0);
        });

        test('penalty 0.5 at 3.5 days', () => {
            const start = _now() - 3.5 * 86400_000;
            const r = decay.computeQuarantinePenalty({
                quarantinedAt: start, nowTs: _now()
            });
            expect(r.penalty).toBeCloseTo(0.5, 2);
        });

        test('penalty 0 after 7 days even if much older', () => {
            const start = _now() - 30 * 86400_000;
            const r = decay.computeQuarantinePenalty({
                quarantinedAt: start, nowTs: _now()
            });
            expect(r.penalty).toBe(0);
        });
    });

    describe('runDecayPass (batch)', () => {
        test('processes all known trust scores', () => {
            const lastUpdate = _daysAgo(10);
            // Multiple idle modules at high/low trust
            for (let i = 0; i < 30; i++) {
                trustScorer.updateTrust({
                    moduleId: 'a_high', recommendationCorrect: 1, ts: lastUpdate + i
                });
                trustScorer.updateTrust({
                    moduleId: 'b_low', recommendationCorrect: 0, ts: lastUpdate + i
                });
            }
            const beforeA = trustScorer.getTrustScore({ moduleId: 'a_high' }).trustScore;
            const beforeB = trustScorer.getTrustScore({ moduleId: 'b_low' }).trustScore;
            const result = decay.runDecayPass({ nowTs: _now() });
            expect(result.modulesDecayed).toBeGreaterThanOrEqual(2);
            const afterA = trustScorer.getTrustScore({ moduleId: 'a_high' }).trustScore;
            const afterB = trustScorer.getTrustScore({ moduleId: 'b_low' }).trustScore;
            // A decayed toward 0.50 (down)
            expect(afterA).toBeLessThan(beforeA);
            // B decayed toward 0.50 (up)
            expect(afterB).toBeGreaterThan(beforeB);
        });

        test('skips modules updated within idle threshold', () => {
            const now = _now();
            trustScorer.updateTrust({
                moduleId: 'recent', recommendationCorrect: 1, ts: now
            });
            const before = trustScorer.getTrustScore({ moduleId: 'recent' }).trustScore;
            decay.runDecayPass({ nowTs: now + 1000 });
            const after = trustScorer.getTrustScore({ moduleId: 'recent' }).trustScore;
            expect(after).toBeCloseTo(before, 5);
        });
    });

    describe('Validation', () => {
        test('decayTrustForIdleModule rejects missing moduleId', () => {
            expect(() => decay.decayTrustForIdleModule({
                nowTs: _now()
            })).toThrow(/moduleId/);
        });
        test('computeQuarantinePenalty rejects missing quarantinedAt', () => {
            expect(() => decay.computeQuarantinePenalty({
                nowTs: _now()
            })).toThrow(/quarantinedAt/);
        });
        test('runDecayPass rejects missing nowTs', () => {
            expect(() => decay.runDecayPass({})).toThrow(/nowTs/);
        });
    });
});
