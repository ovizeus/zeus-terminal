'use strict';

// [Day 32D] chatResponder.respondStream — yields chunks for both
// intent-based replies (single chunk) AND LLM fallback (token-by-token).
// Tests use the same FIXTURE helpers from Phase B/C.

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-stream-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';
process.env.MARKET_RADAR_ENABLED = '0';
delete process.env.GROQ_API_KEY;
delete process.env.XAI_API_KEY;

const responder = require('../../../server/services/ml/_voice/chatResponder');
const marketRadar = require('../../../server/services/marketRadar');

const FIXTURE = [
    { symbol: 'BTCUSDT', price: 70000, priceChangePercent24h: 2.5, quoteVolume: 5e9 },
    { symbol: 'ETHUSDT', price: 3800, priceChangePercent24h: -1.2, quoteVolume: 3e9 },
];

describe('chatResponder.respondStream', () => {
    beforeEach(() => {
        marketRadar._ingestSnapshotForTest(FIXTURE);
        responder._resetConvoForTest();
    });

    afterEach(() => {
        marketRadar._resetSnapshotForTest();
    });

    test('emits single chunk for intent-based reply (greeting)', async () => {
        const chunks = [];
        const result = await responder.respondStream({
            userId: 1, text: 'hi',
            onChunk: (c) => chunks.push(c),
        });
        expect(chunks.length).toBe(1);
        expect(chunks[0]).toBe(result.reply);
        expect(result.reply).toMatch(/yo boss|omega/i);
        expect(result.streamed).toBe(false);  // local intent, not streamed from LLM
    });

    test('emits single chunk for top-gainers intent', async () => {
        const chunks = [];
        await responder.respondStream({
            userId: 1, text: 'top gainers',
            onChunk: (c) => chunks.push(c),
        });
        expect(chunks.length).toBe(1);
        expect(chunks[0]).toMatch(/BTC|ETH/);
    });

    test('LLM fallback uses streaming when API key present', async () => {
        process.env.GROQ_API_KEY = 'test_key';
        jest.resetModules();
        const responder2 = require('../../../server/services/ml/_voice/chatResponder');
        const llmClient = require('../../../server/services/ml/_voice/llmClient');

        // Mock chatStream to yield 3 chunks
        const originalChatStream = llmClient.chatStream;
        llmClient.chatStream = async (params) => {
            params.onChunk('hello');
            params.onChunk(' boss,');
            params.onChunk(' wassup');
            return { ok: true, text: 'hello boss, wassup', model: 'groq/mock' };
        };

        try {
            const chunks = [];
            const result = await responder2.respondStream({
                userId: 1, text: 'tell me a joke unrelated to trading',
                onChunk: (c) => chunks.push(c),
            });
            expect(chunks).toEqual(['hello', ' boss,', ' wassup']);
            expect(result.reply).toBe('hello boss, wassup');
            expect(result.streamed).toBe(true);
        } finally {
            llmClient.chatStream = originalChatStream;
            delete process.env.GROQ_API_KEY;
        }
    });

    test('LLM stream error falls back to local help reply', async () => {
        process.env.GROQ_API_KEY = 'test_key';
        jest.resetModules();
        const responder2 = require('../../../server/services/ml/_voice/chatResponder');
        const llmClient = require('../../../server/services/ml/_voice/llmClient');

        const originalChatStream = llmClient.chatStream;
        llmClient.chatStream = async () => ({ ok: false, error: 'http_429' });

        try {
            const chunks = [];
            const result = await responder2.respondStream({
                userId: 1, text: 'unknown nonsense xyz',
                onChunk: (c) => chunks.push(c),
            });
            expect(chunks.length).toBe(1);
            expect(result.reply).toMatch(/positions|pnl|mood|bandit/i);
        } finally {
            llmClient.chatStream = originalChatStream;
            delete process.env.GROQ_API_KEY;
        }
    });
});
