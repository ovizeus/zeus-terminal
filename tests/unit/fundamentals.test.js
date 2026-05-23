'use strict';

// [Wave 9 / Canonical PDF #8] Fundamentals service — CoinGecko-backed market
// context (market_cap_rank, dominance, vol_24h, price_change_24h) cached 5min
// in ml_fundamentals_cache. Used additively in serverBrain context payload
// (fusion math UNTOUCHED per ARCH-4 constraint #4).

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fund-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const fundamentals = require('../../server/services/fundamentals');

function _mockResponse(data) {
    return { ok: true, json: async () => data };
}

const SAMPLE_GLOBAL = {
    data: {
        market_cap_percentage: { btc: 51.3, eth: 17.8 },
        total_market_cap: { usd: 2.45e12 },
    },
};

const SAMPLE_MARKETS = [
    { symbol: 'btc', id: 'bitcoin', market_cap_rank: 1, total_volume: 28e9, price_change_percentage_24h: 1.45 },
    { symbol: 'eth', id: 'ethereum', market_cap_rank: 2, total_volume: 12e9, price_change_percentage_24h: -0.82 },
    { symbol: 'sol', id: 'solana', market_cap_rank: 5, total_volume: 3.1e9, price_change_percentage_24h: 2.15 },
];

beforeEach(() => {
    fundamentals._resetForTest();
});

describe('fundamentals.getFundamentals', () => {
    test('returns shape with required fields for known symbol', async () => {
        let calls = 0;
        fundamentals._setFetchForTest(async (url) => {
            calls++;
            if (url.includes('/global')) return _mockResponse(SAMPLE_GLOBAL);
            if (url.includes('/coins/markets')) return _mockResponse(SAMPLE_MARKETS);
            throw new Error(`unexpected url: ${url}`);
        });
        const f = await fundamentals.getFundamentals('BTCUSDT');
        expect(f).toBeDefined();
        expect(f.market_cap_rank).toBe(1);
        expect(f.dominance_pct).toBeCloseTo(51.3, 1);
        expect(f.vol_24h_usd).toBe(28e9);
        expect(f.price_change_24h_pct).toBeCloseTo(1.45, 2);
        expect(typeof f.fetched_at).toBe('number');
        expect(f.fetched_at).toBeGreaterThan(0);
    });

    test('cache hit within TTL — second call does not refetch', async () => {
        let calls = 0;
        fundamentals._setFetchForTest(async (url) => {
            calls++;
            if (url.includes('/global')) return _mockResponse(SAMPLE_GLOBAL);
            if (url.includes('/coins/markets')) return _mockResponse(SAMPLE_MARKETS);
            throw new Error(`unexpected url: ${url}`);
        });
        await fundamentals.getFundamentals('BTCUSDT');
        const callsAfterFirst = calls;
        await fundamentals.getFundamentals('BTCUSDT');
        expect(calls).toBe(callsAfterFirst);
    });

    test('returns null for unknown symbol', async () => {
        fundamentals._setFetchForTest(async (url) => {
            if (url.includes('/global')) return _mockResponse(SAMPLE_GLOBAL);
            if (url.includes('/coins/markets')) return _mockResponse(SAMPLE_MARKETS);
            throw new Error('boom');
        });
        const f = await fundamentals.getFundamentals('XYZUSDT');
        expect(f).toBeNull();
    });

    test('graceful fallback to null when API fails on fresh fetch', async () => {
        fundamentals._setFetchForTest(async () => {
            throw new Error('network down');
        });
        const f = await fundamentals.getFundamentals('BTCUSDT');
        expect(f).toBeNull();
    });

    test('returns stale cache when API fails after first successful fetch', async () => {
        let mode = 'ok';
        fundamentals._setFetchForTest(async (url) => {
            if (mode === 'fail') throw new Error('network down');
            if (url.includes('/global')) return _mockResponse(SAMPLE_GLOBAL);
            if (url.includes('/coins/markets')) return _mockResponse(SAMPLE_MARKETS);
            throw new Error('unexpected');
        });
        // Warm cache
        const f1 = await fundamentals.getFundamentals('BTCUSDT');
        expect(f1.market_cap_rank).toBe(1);
        // Force TTL miss + API fail
        fundamentals._expireCacheForTest();
        mode = 'fail';
        const f2 = await fundamentals.getFundamentals('BTCUSDT');
        expect(f2).toBeDefined();
        expect(f2.market_cap_rank).toBe(1);
        expect(f2.stale).toBe(true);
    });

    test('symbol-to-coingecko-id mapping covers majors', async () => {
        fundamentals._setFetchForTest(async (url) => {
            if (url.includes('/global')) return _mockResponse(SAMPLE_GLOBAL);
            if (url.includes('/coins/markets')) return _mockResponse(SAMPLE_MARKETS);
            throw new Error('unexpected');
        });
        const eth = await fundamentals.getFundamentals('ETHUSDT');
        expect(eth.market_cap_rank).toBe(2);
        const sol = await fundamentals.getFundamentals('SOLUSDT');
        expect(sol.market_cap_rank).toBe(5);
    });
});

describe('fundamentals.getFundamentalsCached (sync hot-path)', () => {
    test('returns null when cache empty', () => {
        const f = fundamentals.getFundamentalsCached('BTCUSDT');
        expect(f).toBeNull();
    });

    test('returns shape after async warm', async () => {
        fundamentals._setFetchForTest(async (url) => {
            if (url.includes('/global')) return _mockResponse(SAMPLE_GLOBAL);
            if (url.includes('/coins/markets')) return _mockResponse(SAMPLE_MARKETS);
            throw new Error('unexpected');
        });
        await fundamentals.getFundamentals('BTCUSDT');
        const f = fundamentals.getFundamentalsCached('BTCUSDT');
        expect(f).toBeDefined();
        expect(f.market_cap_rank).toBe(1);
        expect(f.dominance_pct).toBeCloseTo(51.3, 1);
    });

    test('returns null when cache too stale (>30min)', async () => {
        fundamentals._setFetchForTest(async (url) => {
            if (url.includes('/global')) return _mockResponse(SAMPLE_GLOBAL);
            if (url.includes('/coins/markets')) return _mockResponse(SAMPLE_MARKETS);
            throw new Error('unexpected');
        });
        await fundamentals.getFundamentals('BTCUSDT');
        fundamentals._setCacheAgeForTest(40 * 60 * 1000);  // 40min old
        const f = fundamentals.getFundamentalsCached('BTCUSDT');
        expect(f).toBeNull();
    });

    test('never throws on DB error or unknown', () => {
        expect(() => fundamentals.getFundamentalsCached('NOPENOPE')).not.toThrow();
        expect(() => fundamentals.getFundamentalsCached(null)).not.toThrow();
        expect(() => fundamentals.getFundamentalsCached(undefined)).not.toThrow();
    });
});
