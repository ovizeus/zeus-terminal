'use strict';

// [2026-06-23] OMEGA grounding fix — the LLM-fallback system prompt must carry the ABSOLUTE
// current price (not only the 24h % delta), or the model invents a price from stale training
// data (operator saw "BTC is 34k"). It must also state WHO created it (the operator, in Zeus
// Terminal) so it never answers "a team of developers" / "I don't know my creator".

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-ground-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';
process.env.MARKET_RADAR_ENABLED = '0';
delete process.env.GROQ_API_KEY;

const responder = require('../../../server/services/ml/_voice/chatResponder');
const marketRadar = require('../../../server/services/marketRadar');

beforeEach(() => {
    marketRadar._ingestSnapshotForTest([
        { symbol: 'BTCUSDT', price: 62954.8, priceChangePercent24h: -1.63, quoteVolume: 5e9 },
        { symbol: 'ETHUSDT', price: 1668.2, priceChangePercent24h: -3.69, quoteVolume: 3e9 },
        { symbol: 'SOLUSDT', price: 69.75, priceChangePercent24h: -2.95, quoteVolume: 1e9 },
    ]);
});
afterEach(() => { marketRadar._resetSnapshotForTest(); });

describe('chatResponder grounding — absolute prices + creator identity', () => {
    test('system prompt carries the ABSOLUTE BTC price, not only the 24h delta', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'cat e pretul btc' });
        // the real price must appear so the LLM never hallucinates (e.g. $34k)
        expect(p).toMatch(/62[,.]?9|62954|\$62/);
        // and the delta is still there
        expect(p).toMatch(/-1\.63/);
    });

    test('system prompt carries the ABSOLUTE ETH price too', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'cum vezi eth' });
        expect(p).toMatch(/1[,.]?668|\$1,?6/);
    });

    test('system prompt states the creator (the operator / Zeus Terminal)', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'cine te-a creat' });
        expect(p).toMatch(/created by the operator|built by the operator|the operator (built|created)/i);
        // explicit anti-hallucination on the identity question
        expect(p.toLowerCase()).toContain('zeus terminal');
    });
});
