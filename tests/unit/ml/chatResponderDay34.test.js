'use strict';

// [Day 34] 6 wishes shipped: structure (advanced TA), predictivity (Ring5
// surface), sentiment, manipulation/pump detection, long-term forecast,
// multi-language detect (ES/FR/DE/PT in addition to RO/EN).

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-d34-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';
process.env.MARKET_RADAR_ENABLED = '0';
delete process.env.GROQ_API_KEY;

const { db } = require('../../../server/services/database');
const responder = require('../../../server/services/ml/_voice/chatResponder');
const marketRadar = require('../../../server/services/marketRadar');
const serverState = require('../../../server/services/serverState');
const serverStructure = require('../../../server/services/serverStructure');

const ORIG_SNAP = serverState.getSnapshotForSymbol;
const ORIG_STRUCT = serverStructure.getStructure;

function seedUser(uid) {
    try {
        db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)`)
          .run(uid, `u${uid}@test.local`, 'x');
    } catch (_) {}
}

function stub(sym, snap, struct) {
    serverState.getSnapshotForSymbol = (s) => (s && s.toUpperCase() === sym) ? snap : null;
    serverStructure.getStructure = (s, bars) => (s && s.toUpperCase() === sym) ? struct : { trend: 'none', structureScore: 0.5 };
}
function restore() {
    serverState.getSnapshotForSymbol = ORIG_SNAP;
    serverStructure.getStructure = ORIG_STRUCT;
}

function seedPosterior(level, cellKey, alpha, beta, obs) {
    db.prepare(`INSERT OR REPLACE INTO ml_bandit_posteriors (level, cell_key, alpha, beta, observation_count, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)`)
       .run(level, cellKey, alpha, beta, obs, Date.now());
}

beforeEach(() => {
    seedUser(1);
    db.prepare("DELETE FROM ml_bandit_posteriors").run();
    db.prepare("DELETE FROM trader_profile_preferences").run();
    marketRadar._ingestSnapshotForTest([
        { symbol: 'BTCUSDT', price: 70000, priceChangePercent24h: 2.5, quoteVolume: 5e9 },
        { symbol: 'ETHUSDT', price: 3800, priceChangePercent24h: -1.2, quoteVolume: 3e9 },
        { symbol: 'SOLUSDT', price: 200, priceChangePercent24h: 12.0, quoteVolume: 1.5e9 },
        { symbol: 'PEPEUSDT', price: 0.00002, priceChangePercent24h: 35.0, quoteVolume: 700e6 },
        { symbol: 'XRPUSDT', price: 2.5, priceChangePercent24h: -8.5, quoteVolume: 900e6 },
    ]);
});

afterEach(() => {
    marketRadar._resetSnapshotForTest();
    restore();
    responder._resetConvoForTest();
});

// ── #1 Advanced TA: structure ────────────────────────────────────────
describe('#1 Advanced TA — structure surfaced in chat', () => {
    test('"structură BTC" returns trend + score', async () => {
        stub('BTCUSDT',
            { symbol: 'BTCUSDT', price: 70000, rsi: { '5m': 60 }, adx: 25, atr: 400, indicators: { macdDir: 'BULL' }, mtfIndicators: {} },
            { trend: 'up', lastBOS: { price: 69500 }, lastCHoCH: null, structureScore: 0.75 });
        const r = await responder.respond({ userId: 1, text: 'cum arată structura pe BTC' });
        expect(r.reply).toMatch(/BTC|structur/i);
        expect(r.reply).toMatch(/up|uptrend|bull/i);
    });

    test('"structure on SOL" returns trend in English', async () => {
        stub('SOLUSDT',
            { symbol: 'SOLUSDT', price: 200, rsi: {}, indicators: {}, mtfIndicators: {} },
            { trend: 'down', lastBOS: null, lastCHoCH: { price: 195 }, structureScore: 0.25 });
        const r = await responder.respond({ userId: 1, text: 'structure on SOL' });
        expect(r.reply).toMatch(/SOL|structure/i);
        expect(r.reply).toMatch(/down|bear/i);
    });

    test('symbolDeep block in LLM context includes structure', () => {
        stub('BTCUSDT',
            { symbol: 'BTCUSDT', price: 70000, rsi: {}, indicators: {}, mtfIndicators: {} },
            { trend: 'up', structureScore: 0.8 });
        const ctx = responder._buildLLMContextForTest({ userId: 1, text: 'cum vezi BTC' });
        expect(ctx.symbolDeep.structure).toBeDefined();
        expect(ctx.symbolDeep.structure.trend).toBe('up');
    });
});

// ── #2 Predictivity / Ring5 surface ──────────────────────────────────
describe('#2 AI predictivity — Ring5 forward bias surfaced', () => {
    test('"ce zice AI-ul pentru BTC" surfaces Ring5 cell bias when warm', async () => {
        seedPosterior(4, '1|DEMO|BTCUSDT|TREND', 15, 6, 20);  // 70% empirical
        const r = await responder.respond({ userId: 1, text: 'ce zice ai-ul pentru BTC' });
        expect(r.reply).toMatch(/BTC/i);
        // Should mention either Ring5/bandit OR win rate signal
        expect(r.reply).toMatch(/Ring5|bandit|cell|70|edge|bias/i);
    });

    test('"ai prediction BTC" — cold cell returns honest no-edge', async () => {
        // No posteriors → cold
        const r = await responder.respond({ userId: 1, text: 'ai prediction for BTC' });
        expect(r.reply).toMatch(/BTC/i);
        expect(r.reply).toMatch(/cold|no edge|nu am|insufficient|insufficient data|cold start/i);
    });
});

// ── #5 Sentiment ─────────────────────────────────────────────────────
describe('#5 Market sentiment synthesis', () => {
    test('"sentiment" gives risk-on/off + breadth + funding signal', async () => {
        const r = await responder.respond({ userId: 1, text: 'cum e sentimentul azi' });
        // Breadth-based call with our fixture (2 green, 2 red, 1 huge gain) — mixed
        expect(r.reply).toMatch(/sentiment|breadth|risk|mix|bull|bear|mixt/i);
        // BTC delta mentioned
        expect(r.reply).toMatch(/BTC|\+2\.5|2\.5%/);
    });

    test('"market sentiment" English variant', async () => {
        const r = await responder.respond({ userId: 1, text: 'market sentiment right now' });
        expect(r.reply).toMatch(/sentiment|breadth|risk|mix|bull|bear/i);
    });
});

// ── #6 Manipulation / pump detection ─────────────────────────────────
describe('#6 Manipulation / pump detection', () => {
    test('"pump" surfaces top-gainer outliers (>20%)', async () => {
        const r = await responder.respond({ userId: 1, text: 'vreo schemă de pump' });
        // PEPE is +35% in our fixture — should be flagged as outlier
        expect(r.reply).toMatch(/PEPE|outlier|pump|\+35|35%/i);
    });

    test('"manipulation check" English returns honest scope', async () => {
        const r = await responder.respond({ userId: 1, text: 'check for manipulation' });
        // Should at least respond; full spoofing detection needs order book (deferred)
        expect(r.reply).toBeDefined();
        expect(r.reply.length).toBeGreaterThan(20);
    });

    test('"pump" with no outliers returns "clean"', async () => {
        // Replace fixture with no >20% movers
        marketRadar._resetSnapshotForTest();
        marketRadar._ingestSnapshotForTest([
            { symbol: 'BTCUSDT', price: 70000, priceChangePercent24h: 2.5, quoteVolume: 5e9 },
            { symbol: 'ETHUSDT', price: 3800, priceChangePercent24h: -1.2, quoteVolume: 3e9 },
        ]);
        const r = await responder.respond({ userId: 1, text: 'pump suspect azi' });
        expect(r.reply).toMatch(/curat|clean|nimic|no.+outlier|no.+pump/i);
    });
});

// ── #9 Long-term forecast ────────────────────────────────────────────
describe('#9 Long-term forecast (regime-based)', () => {
    test('"long-term forecast BTC" gives hedged read', async () => {
        stub('BTCUSDT',
            { symbol: 'BTCUSDT', price: 70000, rsi: { '1h': 60, '4h': 55, '1d': 50 }, adx: 25, atr: 400,
              indicators: { macdDir: 'BULL', stDir: 'BULL' }, mtfIndicators: { '4h': { stDir: 'BULL', macdDir: 'BULL', rsi: 60 } } },
            { trend: 'up', structureScore: 0.7 });
        const r = await responder.respond({ userId: 1, text: 'long-term forecast BTC' });
        // Must NOT make absolute predictions; should mention hedging or regime context
        expect(r.reply).toMatch(/BTC|trend|regime|context|bias/i);
        // Honest hedge — no "going to $200k"
        expect(r.reply).not.toMatch(/will reach \$|\$[0-9]+k by/i);
    });

    test('"prognoză termen lung pe ETH" Romanian variant', async () => {
        stub('ETHUSDT',
            { symbol: 'ETHUSDT', price: 3800, rsi: {}, indicators: {}, mtfIndicators: {} },
            { trend: 'down', structureScore: 0.3 });
        const r = await responder.respond({ userId: 1, text: 'prognoză termen lung pe ETH' });
        expect(r.reply).toMatch(/ETH/i);
        expect(r.reply).toMatch(/bias|trend|context|regime|structur/i);
    });
});

// ── #10 Multi-language detection ─────────────────────────────────────
describe('#10 Multi-language detection', () => {
    test('Spanish input detected — system prompt directs ES reply', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: '¿cómo ves el mercado hoy?' });
        expect(p).toMatch(/spanish|español|reply.+ES|ES\b/i);
    });

    test('French input detected — system prompt directs FR reply', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'comment tu vois le marché aujourd\'hui?' });
        expect(p).toMatch(/french|français|reply.+FR|FR\b/i);
    });

    test('German input detected — system prompt directs DE reply', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'wie siehst du den markt heute?' });
        expect(p).toMatch(/german|deutsch|reply.+DE|DE\b/i);
    });

    test('Portuguese input detected — system prompt directs PT reply', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'como você vê o mercado hoje?' });
        expect(p).toMatch(/portuguese|português|reply.+PT|PT\b/i);
    });

    test('regression: Romanian still detected', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'cum vezi piața azi?' });
        expect(p).toMatch(/român|romana|romanian|RO\b/i);
    });

    test('regression: English default when no marker matches', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'how is the market doing today?' });
        expect(p).toMatch(/english/i);
    });
});
