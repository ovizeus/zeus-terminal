'use strict';

// [Day 35 #3] Order book real-time — surface depth + walls from
// serverLiquidity (already polls /fapi/v1/depth every 60s; just expose).

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-orderbook-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';
process.env.MARKET_RADAR_ENABLED = '0';
delete process.env.GROQ_API_KEY;

const responder = require('../../../server/services/ml/_voice/chatResponder');
const marketRadar = require('../../../server/services/marketRadar');
const serverLiquidity = require('../../../server/services/serverLiquidity');

function seedRadar() {
    marketRadar._ingestSnapshotForTest([
        { symbol: 'BTCUSDT', price: 70000, priceChangePercent24h: 2.5, quoteVolume: 5e9 },
        { symbol: 'ETHUSDT', price: 3800, priceChangePercent24h: -1.2, quoteVolume: 3e9 },
    ]);
}

beforeEach(() => {
    seedRadar();
    serverLiquidity._resetDepthForTest();
});

afterEach(() => {
    marketRadar._resetSnapshotForTest();
    serverLiquidity._resetDepthForTest();
    responder._resetConvoForTest();
});

describe('Order book intent (Day 35 #3)', () => {
    test('"order book BTC" returns top bids + asks + spread', async () => {
        serverLiquidity._ingestDepthForTest('BTCUSDT',
            [['69990', '5'], ['69985', '10'], ['69980', '3']],
            [['70010', '4'], ['70015', '8'], ['70020', '2']]);
        const r = await responder.respond({ userId: 1, text: 'order book BTC' });
        expect(r.reply).toMatch(/BTC/i);
        expect(r.reply).toMatch(/bid|ask|spread/i);
        // Should mention top bid or ask
        expect(r.reply).toMatch(/69990|70010/);
    });

    test('"depth BTC" routes to order book intent', async () => {
        serverLiquidity._ingestDepthForTest('BTCUSDT', [['69990', '5']], [['70010', '4']]);
        const r = await responder.respond({ userId: 1, text: 'depth BTC' });
        expect(r.reply).toMatch(/bid|ask|spread/i);
    });

    test('RO "carte de ordine BTC" / "registru BTC" routes to order book', async () => {
        serverLiquidity._ingestDepthForTest('BTCUSDT', [['69990', '5']], [['70010', '4']]);
        const r = await responder.respond({ userId: 1, text: 'carte de ordine pe BTC' });
        expect(r.reply).toMatch(/bid|ask|spread|ofertă|cumpărare/i);
    });

    test('order book reply contains spread % when bids+asks present', async () => {
        serverLiquidity._ingestDepthForTest('BTCUSDT', [['69990', '5']], [['70010', '4']]);
        const r = await responder.respond({ userId: 1, text: 'order book BTC' });
        // (70010-69990)/70000 = 0.0286% spread
        expect(r.reply).toMatch(/spread|0\.02|0\.03/);
    });

    test('"liquidity walls BTC" exposes large levels', async () => {
        // Average is small, one big wall at 70000 stands out
        serverLiquidity._ingestDepthForTest('BTCUSDT',
            [['69990', '5'], ['69985', '4'], ['69980', '3']],
            [['70010', '50'], ['70015', '4'], ['70020', '3']]);  // 50 = wall
        const r = await responder.respond({ userId: 1, text: 'liquidity walls on BTC' });
        expect(r.reply).toMatch(/wall|70010|ask/i);
    });

    test('no depth data → honest "no data" reply', async () => {
        const r = await responder.respond({ userId: 1, text: 'order book BTC' });
        expect(r.reply).toMatch(/no depth|no data|nu am|radar|niciun ordin/i);
    });

    test('LLM context symbolDeep includes orderBook when present', () => {
        serverLiquidity._ingestDepthForTest('BTCUSDT',
            [['69990', '5']], [['70010', '4']]);
        const ctx = responder._buildLLMContextForTest({ userId: 1, text: 'cum vezi BTC' });
        expect(ctx.symbolDeep.orderBook).toBeDefined();
        expect(ctx.symbolDeep.orderBook.topBid).toBe(69990);
        expect(ctx.symbolDeep.orderBook.topAsk).toBe(70010);
    });

    test('symbolDeep.orderBook is null when no depth cached', () => {
        const ctx = responder._buildLLMContextForTest({ userId: 1, text: 'cum vezi BTC' });
        expect(ctx.symbolDeep.orderBook === null || ctx.symbolDeep.orderBook === undefined).toBe(true);
    });
});
