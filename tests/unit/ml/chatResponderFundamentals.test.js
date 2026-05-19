'use strict';

// [Wave 9.5] Chat responder fundamentals intent — closes the loop on Wave 9
// CoinGecko data. When user asks "cum e BTC fundamental?" / "what's BTC
// market cap?" / "BTC dominance?" responder reads fundamentals.getFundamentalsCached
// and returns numeric reply. Multilang RO/EN/ES/FR/DE/PT.

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-fund-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const fundamentals = require('../../../server/services/fundamentals');
const responder = require('../../../server/services/ml/_voice/chatResponder');

function _mockResponse(data) {
    return { ok: true, json: async () => data };
}
const SAMPLE_GLOBAL = {
    data: {
        market_cap_percentage: { btc: 58.1, eth: 18.2, sol: 2.4 },
        total_market_cap: { usd: 2.45e12 },
    },
};
const SAMPLE_MARKETS = [
    { symbol: 'btc', id: 'bitcoin', market_cap_rank: 1, total_volume: 42e9, price_change_percentage_24h: -0.65 },
    { symbol: 'eth', id: 'ethereum', market_cap_rank: 2, total_volume: 18e9, price_change_percentage_24h: 0.82 },
    { symbol: 'sol', id: 'solana', market_cap_rank: 5, total_volume: 4e9, price_change_percentage_24h: 2.15 },
];

async function warmCache() {
    fundamentals._setFetchForTest(async (url) => {
        if (url.includes('/global')) return _mockResponse(SAMPLE_GLOBAL);
        if (url.includes('/coins/markets')) return _mockResponse(SAMPLE_MARKETS);
        throw new Error('unexpected');
    });
    await fundamentals.getFundamentals('BTCUSDT');
}

describe('chatResponder fundamentals intent', () => {
    beforeEach(async () => {
        fundamentals._resetForTest();
        await warmCache();
    });

    test('EN — "what is BTC market cap" returns rank + dominance + vol', async () => {
        const r = await responder.respond({ userId: 1, text: 'what is BTC market cap' });
        expect(r.reply).toMatch(/BTC/);
        expect(r.reply).toMatch(/#1|rank 1/i);
        expect(r.reply).toMatch(/58/);
        expect(r.reply).toMatch(/42/);
    });

    test('RO — "cum e BTC fundamental" returns Romanian reply', async () => {
        const r = await responder.respond({ userId: 1, text: 'cum e BTC fundamental' });
        expect(r.reply).toMatch(/BTC/);
        expect(r.reply).toMatch(/dominanță|domin/i);
        expect(r.reply).toMatch(/#1|rank 1/i);
    });

    test('RO — "ce dominanță are BTC" detected', async () => {
        const r = await responder.respond({ userId: 1, text: 'ce dominanță are BTC' });
        expect(r.reply).toMatch(/58/);
    });

    test('EN — "ETH dominance" returns ETH data', async () => {
        const r = await responder.respond({ userId: 1, text: 'ETH dominance' });
        expect(r.reply).toMatch(/ETH/);
        expect(r.reply).toMatch(/18|2|#2/);
    });

    test('RO — "rank cap" detected as fundamentals intent', async () => {
        const r = await responder.respond({ userId: 1, text: 'rank cap pe SOL?' });
        expect(r.reply).toMatch(/SOL/);
        expect(r.reply).toMatch(/#5|rank 5/i);
    });

    test('unknown symbol falls back gracefully', async () => {
        const r = await responder.respond({ userId: 1, text: 'what is XYZ market cap' });
        expect(r.reply).toBeDefined();
        // Should not crash — either say not found OR fall through to LLM/help
        expect(typeof r.reply).toBe('string');
    });

    test('cache empty (cold start) — graceful fallback', async () => {
        fundamentals._resetForTest();
        const r = await responder.respond({ userId: 1, text: 'BTC market cap' });
        expect(r.reply).toBeDefined();
        expect(typeof r.reply).toBe('string');
    });
});
