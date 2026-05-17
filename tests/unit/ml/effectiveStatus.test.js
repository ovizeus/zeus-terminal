'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-es-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const bp = require('../../../server/services/ml/_ring5/banditPosteriors');
const es = require('../../../server/services/ml/_ring5/effectiveStatus');

const _now = () => Date.now();

function clean() {
    db.prepare("DELETE FROM ml_bandit_posteriors").run();
    es.resetCacheForTest();
}

describe('effectiveStatus (Phase 3 — ARCH-2 LRU cache + hierarchy)', () => {
    beforeEach(clean);

    describe('constants', () => {
        test('LRU_MAX = 1000', () => { expect(es.LRU_MAX).toBe(1000); });
        test('TTL_MS = 60000', () => { expect(es.TTL_MS).toBe(60_000); });
    });

    describe('resolve (hot path)', () => {
        test('returns L0 default on cold start', () => {
            const r = es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: _now() });
            expect(r.level).toBe(0);
            expect(r.alpha).toBe(1);
            expect(r.beta).toBe(1);
            expect(r.cacheHit).toBe(false);
        });
        test('returns owned L4 when threshold reached', () => {
            for (let i = 0; i < 30; i++) {
                bp.updatePosterior({ level: 4, cellKey: '1:DEMO:BTCUSDT:trending', outcomeClass: 'positive', ts: _now() });
            }
            const r = es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: _now() });
            expect(r.level).toBe(4);
            expect(r.alpha).toBe(31);
        });
        test('second call within TTL = cache hit', () => {
            const now = _now();
            es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now });
            const second = es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now + 1000 });
            expect(second.cacheHit).toBe(true);
        });
        test('call past TTL → cache miss', () => {
            const now = _now();
            es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now });
            const second = es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now + 65_000 });
            expect(second.cacheHit).toBe(false);
        });
    });

    describe('invalidate', () => {
        test('clears cache entry for specific cell key', () => {
            const now = _now();
            es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now });
            es.invalidate({ cellKey: '1:DEMO:BTCUSDT:trending' });
            const second = es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now + 1000 });
            expect(second.cacheHit).toBe(false);
        });
        test('invalidateAll clears entire cache', () => {
            const now = _now();
            es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now });
            es.resolve({ userId: 2, env: 'DEMO', symbol: 'ETHUSDT', regime: 'ranging', nowTs: now });
            es.invalidateAll();
            const a = es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now + 1000 });
            const b = es.resolve({ userId: 2, env: 'DEMO', symbol: 'ETHUSDT', regime: 'ranging', nowTs: now + 1000 });
            expect(a.cacheHit).toBe(false);
            expect(b.cacheHit).toBe(false);
        });
    });

    describe('cache stats', () => {
        test('hit/miss counters', () => {
            const now = _now();
            es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now });
            es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now + 1000 });
            es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now + 2000 });
            const stats = es.getStats();
            expect(stats.hits).toBe(2);
            expect(stats.misses).toBe(1);
            expect(stats.entries).toBeGreaterThan(0);
        });
    });
});
