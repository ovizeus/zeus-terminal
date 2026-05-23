'use strict';

// [Day 32B] Phase B intents — market-aware chat replies backed by the
// marketRadar snapshot exposed in Phase A.

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-phase-b-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';
process.env.MARKET_RADAR_ENABLED = '0';
delete process.env.GROQ_API_KEY;  // force local intents, no LLM fallback noise

const responder = require('../../../server/services/ml/_voice/chatResponder');
const marketRadar = require('../../../server/services/marketRadar');

const FIXTURE = [
    { symbol: 'BTCUSDT', price: 70000, priceChangePercent24h:  2.5,  quoteVolume: 5_000_000_000 },
    { symbol: 'ETHUSDT', price: 3800,  priceChangePercent24h: -1.2,  quoteVolume: 3_000_000_000 },
    { symbol: 'SOLUSDT', price: 200,   priceChangePercent24h: 12.0,  quoteVolume: 1_500_000_000 },
    { symbol: 'XRPUSDT', price: 2.5,   priceChangePercent24h: -8.5,  quoteVolume:   900_000_000 },
    { symbol: 'PEPEUSDT', price: 0.00002, priceChangePercent24h: 35.0, quoteVolume: 700_000_000 },
    { symbol: 'LUNAUSDT', price: 0.5,  priceChangePercent24h: -22.0, quoteVolume:  600_000_000 },
];

describe('chatResponder Phase B intents', () => {
    beforeEach(() => {
        marketRadar._ingestSnapshotForTest(FIXTURE);
    });

    afterEach(() => {
        marketRadar._resetSnapshotForTest();
        responder._resetConvoForTest();
    });

    // ── Top gainers ────────────────────────────────────────────────
    test('EN "top gainers" → lists biggest 24h winners', async () => {
        const r = await responder.respond({ userId: 1, text: 'top gainers' });
        expect(r.reply).toMatch(/PEPE/i);
        expect(r.reply).toMatch(/SOL/i);
        expect(r.reply).toMatch(/\+35|35%/);  // PEPE +35%
    });

    test('RO "care a urcat cel mai mult" → top gainers', async () => {
        const r = await responder.respond({ userId: 1, text: 'care a urcat cel mai mult' });
        expect(r.reply).toMatch(/PEPE/i);
        expect(r.reply).toMatch(/35/);
    });

    test('RO "cei mai urcati" → top gainers', async () => {
        const r = await responder.respond({ userId: 1, text: 'cei mai urcati azi' });
        expect(r.reply).toMatch(/PEPE/i);
    });

    // ── Top losers ─────────────────────────────────────────────────
    test('EN "top losers" → lists biggest 24h losers', async () => {
        const r = await responder.respond({ userId: 1, text: 'top losers' });
        expect(r.reply).toMatch(/LUNA/i);
        expect(r.reply).toMatch(/-22|22%/);
    });

    test('RO "care a scazut cel mai mult" → top losers', async () => {
        const r = await responder.respond({ userId: 1, text: 'care a scazut cel mai mult' });
        expect(r.reply).toMatch(/LUNA/i);
        expect(r.reply).toMatch(/22/);
    });

    test('RO "cei mai scazuti" → top losers', async () => {
        const r = await responder.respond({ userId: 1, text: 'cei mai scazuti azi' });
        expect(r.reply).toMatch(/LUNA/i);
    });

    // ── Top volume ─────────────────────────────────────────────────
    test('EN "top volume" → lists biggest 24h volume', async () => {
        const r = await responder.respond({ userId: 1, text: 'top volume' });
        expect(r.reply).toMatch(/BTC/i);
        expect(r.reply).toMatch(/ETH/i);
    });

    test('RO "cel mai mare volum" → top volume', async () => {
        const r = await responder.respond({ userId: 1, text: 'care e cel mai mare volum' });
        expect(r.reply).toMatch(/BTC/i);
    });

    // ── Market overview ────────────────────────────────────────────
    test('EN "how is the market" → market overview', async () => {
        const r = await responder.respond({ userId: 1, text: 'how is the market' });
        // Overview should mention gainers + losers + BTC delta
        expect(r.reply.length).toBeGreaterThan(40);
        expect(r.reply).toMatch(/BTC|gainers?|losers?|market|piață/i);
    });

    test('RO "cum vezi piata" → market overview', async () => {
        const r = await responder.respond({ userId: 1, text: 'cum vezi piata azi' });
        expect(r.reply.length).toBeGreaterThan(40);
        expect(r.reply).toMatch(/BTC|piață|piata|urcat|scazut|sc[aă]zut/i);
    });

    test('RO "ce face piata" → market overview', async () => {
        const r = await responder.respond({ userId: 1, text: 'ce face piata' });
        expect(r.reply).toMatch(/BTC|piață|piata/i);
    });

    // ── Symbol-specific enriched with market data ──────────────────
    test('symbol query enriches reply with price + 24h%', async () => {
        const r = await responder.respond({ userId: 1, text: 'how is sol' });
        // Should include price ($200) and/or 24h change (+12.00%)
        expect(r.reply).toMatch(/SOLUSDT|SOL/);
        // Either price or 24h% must appear (radar snapshot enrichment)
        expect(r.reply).toMatch(/\$200|12(\.0)?%|12\.0/);
    });

    test('symbol query handles missing radar snapshot gracefully', async () => {
        marketRadar._resetSnapshotForTest();
        const r = await responder.respond({ userId: 1, text: 'how is btc' });
        // Should still return without throwing, falling back to old behavior
        expect(r.reply).toBeDefined();
        expect(typeof r.reply).toBe('string');
    });

    // ── Warming up state ───────────────────────────────────────────
    test('top-gainers when radar empty returns warming message', async () => {
        marketRadar._resetSnapshotForTest();
        const r = await responder.respond({ userId: 1, text: 'top gainers' });
        expect(r.reply).toMatch(/warming|radar|nu am date|asleep/i);
    });

    // ── Sanity: existing intents still match ───────────────────────
    test('existing greeting still works', async () => {
        const r = await responder.respond({ userId: 1, text: 'hi' });
        expect(r.reply).toMatch(/yo boss|omega/i);
    });

    test('existing positions intent still works', async () => {
        const r = await responder.respond({ userId: 9999, text: 'positions' });
        expect(r.reply).toBeDefined();
    });
});
