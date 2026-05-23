'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-ts-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const bp = require('../../../server/services/ml/_ring5/banditPosteriors');
const ts_mod = require('../../../server/services/ml/_ring5/thompsonSampler');
const es = require('../../../server/services/ml/_ring5/effectiveStatus');

const _now = () => Date.now();

function clean() {
    db.prepare("DELETE FROM ml_bandit_posteriors").run();
    db.prepare("DELETE FROM ml_bandit_evidence").run();
    db.prepare("DELETE FROM ml_pooled_evidence").run();
    es.resetCacheForTest();
}

describe('thompsonSampler (Phase 3 public API)', () => {
    beforeEach(clean);

    describe('drawSample', () => {
        test('returns sample in [0, 1] from L0 default', () => {
            const r = ts_mod.drawSample({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: _now() });
            expect(r.sample).toBeGreaterThanOrEqual(0);
            expect(r.sample).toBeLessThanOrEqual(1);
            expect(r.level).toBe(0);
        });
        test('with mostly positive observations, mean draw skews high', () => {
            for (let i = 0; i < 30; i++) {
                bp.updatePosterior({ level: 4, cellKey: '1:DEMO:BTCUSDT:trending', outcomeClass: 'positive', ts: _now() });
            }
            es.resetCacheForTest();
            const samples = [];
            for (let i = 0; i < 100; i++) {
                samples.push(ts_mod.drawSample({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: _now() }).sample);
            }
            const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
            expect(mean).toBeGreaterThan(0.85);
        });
    });

    describe('recordObservation', () => {
        test('writes evidence + updates L4 posterior + invalidates cache', () => {
            ts_mod.recordObservation({
                userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending',
                moduleId: 'm', contribution: 0.5, confidence: 0.7,
                outcomeClass: 'positive', ts: _now()
            });
            const post = bp.getPosterior({ level: 4, cellKey: '1:DEMO:BTCUSDT:trending' });
            expect(post.alpha).toBe(2);
            expect(post.observationCount).toBe(1);
            const evRows = db.prepare("SELECT * FROM ml_bandit_evidence").all();
            expect(evRows.length).toBe(1);
        });
        test('cache invalidated after recordObservation', () => {
            const now = _now();
            ts_mod.drawSample({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now });
            ts_mod.recordObservation({
                userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending',
                moduleId: 'm', contribution: 0.3, confidence: 0.6,
                outcomeClass: 'positive', ts: now
            });
            const second = ts_mod.drawSample({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now + 1 });
            expect(second.cacheHit).toBe(false);
        });
    });
});
