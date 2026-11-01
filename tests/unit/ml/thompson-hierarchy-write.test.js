'use strict';
// [ML POOLING WRITE 2026-11-01] The five-level cell hierarchy (SPEC-8) was built
// on both sides and connected on neither.
//
// Measured on the live DB before this fix:
//   - ml_bandit_posteriors held 88 rows, ALL of them level 4. Levels 0-3: empty.
//   - 742 observations total across those 88 cells (mean 8.4); exactly ONE cell
//     reached the promotion threshold of 30.
//   - walkHierarchy() therefore fell through all five candidates on essentially
//     every call and returned its hardcoded {alpha:1, beta:1} default — so
//     drawSample() was a Beta(1,1) draw, i.e. a uniform coin flip, not learning.
//
// Cause: recordObservation wrote `{ level: 4 }` only. An observation is evidence
// at every level of generality — a losing BREAKOUT on DEMO/ETHUSDT is also
// evidence about DEMO/ETHUSDT, about DEMO, and about the book as a whole. Writing
// only the narrowest cell means the pooling that exists to rescue a thin cell can
// never have anything to pool.
//
// INERT on the trading path today: ring5LearningService calls drawSample ONLY
// after influenceEligibility passes, and that gate has returned ineligible for
// every one of the 522,400 audited decisions. This fix changes what the sampler
// WOULD say, not what the engine does.
const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-hier-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const bp = require('../../../server/services/ml/_ring5/banditPosteriors');
const sampler = require('../../../server/services/ml/_ring5/thompsonSampler');
const es = require('../../../server/services/ml/_ring5/effectiveStatus');

const NOW = Date.now();
const CELL = { userId: 1, env: 'DEMO', symbol: 'ETHUSDT', regime: 'BREAKOUT' };

function clean() {
    db.prepare('DELETE FROM ml_bandit_posteriors').run();
    db.prepare('DELETE FROM ml_bandit_evidence').run();
    db.prepare('DELETE FROM ml_pooled_evidence').run();
    es.resetCacheForTest();
}

function observe(n, outcomeClass, over = CELL) {
    for (let i = 0; i < n; i++) {
        sampler.recordObservation({
            ...over, moduleId: 'm1',
            contribution: outcomeClass === 'positive' ? 0.5 : -0.5,
            confidence: 0.8, outcomeClass, ts: NOW + i,
        });
    }
}

describe('recordObservation writes the whole cell hierarchy', () => {
    beforeEach(clean);

    test('THE FIX: one observation lands on all five levels', () => {
        observe(1, 'positive');
        const levels = db.prepare('SELECT DISTINCT level FROM ml_bandit_posteriors ORDER BY level')
            .all().map(r => r.level);
        expect(levels).toEqual([0, 1, 2, 3, 4]);
    });

    test('each level is keyed by its own generality', () => {
        observe(1, 'positive');
        const rows = Object.fromEntries(
            db.prepare('SELECT level, cell_key FROM ml_bandit_posteriors').all().map(r => [r.level, r.cell_key]));
        expect(rows[4]).toBe('1:DEMO:ETHUSDT:BREAKOUT');
        expect(rows[3]).toBe('DEMO:ETHUSDT:BREAKOUT');
        expect(rows[2]).toBe('DEMO:ETHUSDT');
        expect(rows[1]).toBe('DEMO');
        expect(rows[0]).toBe('global');
    });

    test('the outcome class is the SAME at every level', () => {
        observe(4, 'negative');
        for (const lvl of [0, 1, 2, 3, 4]) {
            const key = bp.buildCellKey({ level: lvl, ...CELL });
            const p = bp.getPosterior({ level: lvl, cellKey: key });
            expect(p.observationCount).toBe(4);
            // 4 negatives on a Beta(1,1) prior → beta grows, alpha does not.
            expect(p.beta).toBe(5);
            expect(p.alpha).toBe(1);
        }
    });

    test('two thin SIBLING cells pool into one usable parent', () => {
        // Neither symbol-regime cell reaches 30 alone; together the env level does.
        observe(20, 'positive', { ...CELL, symbol: 'ETHUSDT' });
        observe(20, 'positive', { ...CELL, symbol: 'SOLUSDT' });
        expect(bp.getPosterior({ level: 4, cellKey: '1:DEMO:ETHUSDT:BREAKOUT' }).observationCount).toBe(20);
        expect(bp.getPosterior({ level: 1, cellKey: 'DEMO' }).observationCount).toBe(40);
        es.resetCacheForTest();
        // THE POINT: the thin L4 cell now resolves to a parent that has evidence,
        // instead of falling through to the Beta(1,1) coin flip.
        const r = bp.walkHierarchy(CELL);
        expect(r.level).toBe(1);
        expect(r.observationCount).toBe(40);
    });

    test('a different ENV never pools into this one', () => {
        observe(40, 'positive', { ...CELL, env: 'TESTNET' });
        expect(bp.getPosterior({ level: 1, cellKey: 'DEMO' })).toBeNull();
        expect(bp.getPosterior({ level: 1, cellKey: 'TESTNET' }).observationCount).toBe(40);
    });

    test('a different USER still pools at level 3 and below (env/symbol/regime are shared)', () => {
        observe(30, 'positive', { ...CELL, userId: 2 });
        expect(bp.getPosterior({ level: 4, cellKey: '1:DEMO:ETHUSDT:BREAKOUT' })).toBeNull();
        expect(bp.getPosterior({ level: 3, cellKey: 'DEMO:ETHUSDT:BREAKOUT' }).observationCount).toBe(30);
    });

    test('recordObservation still reports the L4 cell key to its caller', () => {
        const r = sampler.recordObservation({
            ...CELL, moduleId: 'm1', contribution: 0.5, confidence: 0.8,
            outcomeClass: 'positive', ts: NOW,
        });
        expect(r.recorded).toBe(true);
        expect(r.cellKey).toBe('1:DEMO:ETHUSDT:BREAKOUT');
    });
});
