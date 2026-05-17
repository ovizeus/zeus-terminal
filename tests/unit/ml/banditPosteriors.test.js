'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-post-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const bp = require('../../../server/services/ml/_ring5/banditPosteriors');

const _now = () => Date.now();

function clean() {
    db.prepare("DELETE FROM ml_bandit_posteriors").run();
}

describe('banditPosteriors (Phase 3)', () => {
    beforeEach(clean);

    describe('LEVELS constants', () => {
        test('LEVELS exposes 5 levels L0..L4', () => {
            expect(bp.LEVELS).toEqual([0, 1, 2, 3, 4]);
        });
        test('buildCellKey produces expected format per level', () => {
            expect(bp.buildCellKey({ level: 0 })).toBe('global');
            expect(bp.buildCellKey({ level: 1, env: 'DEMO' })).toBe('DEMO');
            expect(bp.buildCellKey({ level: 2, env: 'DEMO', symbol: 'BTCUSDT' })).toBe('DEMO:BTCUSDT');
            expect(bp.buildCellKey({ level: 3, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending' })).toBe('DEMO:BTCUSDT:trending');
            expect(bp.buildCellKey({ level: 4, userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending' })).toBe('1:DEMO:BTCUSDT:trending');
        });
    });

    describe('getPosterior', () => {
        test('returns null for unseen (level, cell_key)', () => {
            expect(bp.getPosterior({ level: 2, cellKey: 'unseen' })).toBeNull();
        });
        test('returns hydrated posterior when present', () => {
            db.prepare(`INSERT INTO ml_bandit_posteriors
                (level, cell_key, alpha, beta, observation_count, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)`).run(2, 'DEMO:BTCUSDT', 5, 3, 8, _now());
            const r = bp.getPosterior({ level: 2, cellKey: 'DEMO:BTCUSDT' });
            expect(r).toEqual(expect.objectContaining({
                level: 2, cellKey: 'DEMO:BTCUSDT', alpha: 5, beta: 3, observationCount: 8
            }));
        });
    });

    describe('updatePosterior (Bayesian Beta update)', () => {
        test('inserts new row with positive obs (α=2, β=1)', () => {
            bp.updatePosterior({ level: 2, cellKey: 'DEMO:BTCUSDT', outcomeClass: 'positive', ts: _now() });
            const r = bp.getPosterior({ level: 2, cellKey: 'DEMO:BTCUSDT' });
            expect(r.alpha).toBe(2);
            expect(r.beta).toBe(1);
            expect(r.observationCount).toBe(1);
        });
        test('inserts new row with negative obs (α=1, β=2)', () => {
            bp.updatePosterior({ level: 2, cellKey: 'DEMO:ETHUSDT', outcomeClass: 'negative', ts: _now() });
            const r = bp.getPosterior({ level: 2, cellKey: 'DEMO:ETHUSDT' });
            expect(r.alpha).toBe(1);
            expect(r.beta).toBe(2);
            expect(r.observationCount).toBe(1);
        });
        test('neutral does not move α/β', () => {
            bp.updatePosterior({ level: 2, cellKey: 'DEMO:LTCUSDT', outcomeClass: 'neutral', ts: _now() });
            const r = bp.getPosterior({ level: 2, cellKey: 'DEMO:LTCUSDT' });
            expect(r.alpha).toBe(1);
            expect(r.beta).toBe(1);
            expect(r.observationCount).toBe(1);
        });
        test('repeated positive pushes alpha', () => {
            for (let i = 0; i < 10; i++) {
                bp.updatePosterior({ level: 2, cellKey: 'DEMO:SOLUSDT', outcomeClass: 'positive', ts: _now() });
            }
            const r = bp.getPosterior({ level: 2, cellKey: 'DEMO:SOLUSDT' });
            expect(r.alpha).toBe(11);
            expect(r.observationCount).toBe(10);
        });
        test('rejects invalid level', () => {
            expect(() => bp.updatePosterior({
                level: 5, cellKey: 'x', outcomeClass: 'positive', ts: _now()
            })).toThrow(/level/);
        });
        test('rejects invalid outcomeClass', () => {
            expect(() => bp.updatePosterior({
                level: 2, cellKey: 'x', outcomeClass: 'maybe', ts: _now()
            })).toThrow(/outcomeClass/);
        });
    });

    describe('isCellOwned (30-trade promotion gate per SPEC-8)', () => {
        test('returns false at 29 obs', () => {
            for (let i = 0; i < 29; i++) {
                bp.updatePosterior({ level: 4, cellKey: '1:DEMO:BTCUSDT:trending', outcomeClass: 'positive', ts: _now() });
            }
            expect(bp.isCellOwned({ level: 4, cellKey: '1:DEMO:BTCUSDT:trending' })).toBe(false);
        });
        test('returns true at threshold = 30', () => {
            for (let i = 0; i < 30; i++) {
                bp.updatePosterior({ level: 4, cellKey: '1:DEMO:BTCUSDT:ranging', outcomeClass: 'positive', ts: _now() });
            }
            expect(bp.isCellOwned({ level: 4, cellKey: '1:DEMO:BTCUSDT:ranging' })).toBe(true);
        });
        test('returns false for unseen cell', () => {
            expect(bp.isCellOwned({ level: 4, cellKey: 'never' })).toBe(false);
        });
    });

    describe('walkHierarchy (per SPEC-8 inheritance ladder)', () => {
        test('returns owned L4 when present', () => {
            for (let i = 0; i < 30; i++) {
                bp.updatePosterior({ level: 4, cellKey: '1:DEMO:BTCUSDT:trending', outcomeClass: 'positive', ts: _now() });
            }
            const r = bp.walkHierarchy({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending' });
            expect(r.level).toBe(4);
            expect(r.alpha).toBe(31);
        });
        test('falls back to L3 when L4 not yet owned', () => {
            for (let i = 0; i < 30; i++) {
                bp.updatePosterior({ level: 3, cellKey: 'DEMO:BTCUSDT:trending', outcomeClass: 'positive', ts: _now() });
            }
            const r = bp.walkHierarchy({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending' });
            expect(r.level).toBe(3);
            expect(r.alpha).toBe(31);
        });
        test('falls back to L0 global default when nothing seeded', () => {
            const r = bp.walkHierarchy({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending' });
            expect(r.level).toBe(0);
            expect(r.alpha).toBe(1);
            expect(r.beta).toBe(1);
            expect(r.observationCount).toBe(0);
        });
    });
});
