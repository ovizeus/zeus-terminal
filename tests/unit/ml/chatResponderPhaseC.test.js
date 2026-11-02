'use strict';

// [Day 32C] Phase C — LLM context enrichment + relaxed guardrail.
// Tests verify the structured context fed to the LLM contains operator state
// (positions, decisions, brain mood) + market state (top movers, BTC delta)
// + symbol deep block when mentioned. Also asserts the system prompt allows
// tactical reads (entries, SL/TP) per operator directive 2026-05-18.

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-phase-c-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';
process.env.MARKET_RADAR_ENABLED = '0';
delete process.env.GROQ_API_KEY;
delete process.env.XAI_API_KEY;

const { db } = require('../../../server/services/database');
const responder = require('../../../server/services/ml/_voice/chatResponder');
const marketRadar = require('../../../server/services/marketRadar');

const FIXTURE = [
    { symbol: 'BTCUSDT', price: 70000, priceChangePercent24h:  2.5,  quoteVolume: 5_000_000_000 },
    { symbol: 'ETHUSDT', price: 3800,  priceChangePercent24h: -1.2,  quoteVolume: 3_000_000_000 },
    { symbol: 'SOLUSDT', price: 200,   priceChangePercent24h: 12.0,  quoteVolume: 1_500_000_000 },
    { symbol: 'XRPUSDT', price: 2.5,   priceChangePercent24h: -8.5,  quoteVolume:   900_000_000 },
    { symbol: 'PEPEUSDT', price: 0.00002, priceChangePercent24h: 35.0, quoteVolume: 700_000_000 },
];

function seedAuditRow(symbol, regime, status, dir = 'LONG', conf = 70, ts) {
    if (!ts) ts = Date.now();
    db.prepare(`INSERT INTO ml_influence_audit
        (user_id, env, symbol, regime,
         phase2_dir, phase2_confidence, phase2_score,
         proposed_dir, proposed_confidence, proposed_score,
         gate_status, gate_reason, rationale_json, created_at)
        VALUES (1, 'DEMO', ?, ?, ?, ?, 5, ?, ?, 5, ?, 'test', '{}', ?)`)
       .run(symbol, regime, dir, conf, dir, conf, status, ts);
}

// [2026-11-02] Deciziile pe care le citeste acum contextul. Cele din
// `ml_influence_audit` ramaneau 100% `skipped / insufficient_observations` pe
// sistemul viu — 20.160 de randuri intr-o zi — fiindca poarta de influenta ML
// n-a trecut niciodata. `brain_decisions` are directia, increderea, tier-ul si
// ACTIUNEA, adica exact ce l-a oprit.
function seedDecision(symbol, regime, action, dir = 'LONG', conf = 70, tier = 'SMALL', ts) {
    if (!ts) ts = Date.now();
    db.prepare(`INSERT INTO brain_decisions
        (snap_id, user_id, symbol, ts, cycle, source_path,
         final_tier, final_conf, final_dir, final_action, data, resolved_env)
        VALUES (?, 1, ?, ?, 1, ?, ?, ?, ?, ?, ?, 'DEMO')`)
       .run('t' + ts + symbol + Math.random(), symbol, ts, action,
            tier, conf, dir, action, JSON.stringify({ regime }));
}

function clean() {
    db.prepare("DELETE FROM ml_influence_audit").run();
    db.prepare("DELETE FROM brain_decisions WHERE user_id = 1").run();
    marketRadar._ingestSnapshotForTest(FIXTURE);
}

describe('chatResponder Phase C — LLM context enrichment', () => {
    beforeEach(clean);
    afterEach(() => {
        marketRadar._resetSnapshotForTest();
        responder._resetConvoForTest();
    });

    test('buildLLMContext returns top movers from radar snapshot', () => {
        const ctx = responder._buildLLMContextForTest({ userId: 1, text: 'cum vezi piata' });
        expect(ctx.market).toBeDefined();
        expect(ctx.market.gainers).toBeDefined();
        expect(ctx.market.gainers.length).toBeGreaterThan(0);
        expect(ctx.market.gainers[0].symbol).toBe('PEPEUSDT');
        expect(ctx.market.losers[0].symbol).toBe('XRPUSDT');
    });

    test('buildLLMContext includes BTC + ETH macro deltas', () => {
        const ctx = responder._buildLLMContextForTest({ userId: 1, text: 'ce zici' });
        expect(ctx.market.btcDelta24h).toBe(2.5);
        expect(ctx.market.ethDelta24h).toBe(-1.2);
    });

    test('REGRESIE: deciziile vin din brain_decisions, cu ACTIUNEA care le-a oprit', () => {
        seedDecision('BTCUSDT', 'TREND', 'blocked_reflection', 'LONG', 75, 'MEDIUM');
        seedDecision('ETHUSDT', 'RANGE', 'no_trade', 'SHORT', 50, 'NO_TRADE');
        const ctx = responder._buildLLMContextForTest({ userId: 1, text: 'cum stam' });
        expect(ctx.recentDecisions.length).toBeGreaterThanOrEqual(2);
        const btc = ctx.recentDecisions.find(d => d.symbol === 'BTCUSDT');
        expect(btc).toBeDefined();
        expect(btc.action).toBe('blocked_reflection');  // ce l-a oprit — asta lipsea
        expect(btc.conf).toBe(75);
        expect(btc.tier).toBe('MEDIUM');
    });

    test('REGRESIE: randurile de audit ML NU mai ajung in decizii', () => {
        // Erau singura sursa si erau 100% `skipped`. Daca cineva le pune la loc,
        // operatorul primeste iar "10 decisions ... conf 0, status skipped".
        seedAuditRow('BTCUSDT', 'TREND', 'skipped', 'LONG', 0);
        seedAuditRow('ETHUSDT', 'RANGE', 'skipped', 'SHORT', 0);
        const ctx = responder._buildLLMContextForTest({ userId: 1, text: 'cum stam' });
        expect(ctx.recentDecisions).toHaveLength(0);
    });

    test('contextul poarta si de ce NU a intrat, contul si propriile ganduri', () => {
        const ctx = responder._buildLLMContextForTest({ userId: 1, text: 'cum stam' });
        expect(Array.isArray(ctx.blockedReasons)).toBe(true);
        expect(Array.isArray(ctx.recentCloses)).toBe(true);
        expect(Array.isArray(ctx.ownThoughts)).toBe(true);
        expect(ctx.account).not.toBeUndefined();
    });

    test('buildLLMContext includes deep block when symbol mentioned', () => {
        seedDecision('BTCUSDT', 'TREND', 'blocked_reflection', 'LONG', 75, 'MEDIUM');
        seedDecision('BTCUSDT', 'TREND', 'no_trade', 'LONG', 80, 'NO_TRADE');
        const ctx = responder._buildLLMContextForTest({ userId: 1, text: 'cum vezi BTC long sau short' });
        expect(ctx.symbolDeep).toBeDefined();
        expect(ctx.symbolDeep.symbol).toBe('BTCUSDT');
        expect(ctx.symbolDeep.price).toBe(70000);
        expect(ctx.symbolDeep.decisions.length).toBe(2);
        // Regimul vine acum din obiectul deciziei, nu dintr-o coloana de audit.
        expect(ctx.symbolDeep.regimeMix.TREND).toBe(2);
        expect(ctx.symbolDeep.decisions[0].status).toBe('no_trade');
    });

    test('buildLLMContext symbolDeep null when no symbol in text', () => {
        const ctx = responder._buildLLMContextForTest({ userId: 1, text: 'cum vezi piata' });
        expect(ctx.symbolDeep).toBeNull();
    });

    test('buildLLMContext includes brain mood', () => {
        seedAuditRow('BTCUSDT', 'TREND', 'accepted');
        seedAuditRow('BTCUSDT', 'TREND', 'accepted');
        const ctx = responder._buildLLMContextForTest({ userId: 1, text: 'ce zici' });
        expect(typeof ctx.brainMood).toBe('string');
        expect(['CALM', 'FOCUSED', 'EXCITED', 'NERVOUS', 'ANGRY', 'SAD', 'BORED']).toContain(ctx.brainMood);
    });

    test('buildSystemPrompt no longer contains "Never give financial advice" guardrail', () => {
        const prompt = responder._buildSystemPromptForTest({ userId: 1, text: 'cum vezi BTC' });
        expect(prompt).not.toMatch(/Never give financial advice/i);
        expect(prompt).not.toMatch(/no calls boss/i);
        expect(prompt).not.toMatch(/nu dau pont-uri/i);
    });

    test('buildSystemPrompt explicitly allows tactical reads (entry/SL/TP)', () => {
        const prompt = responder._buildSystemPromptForTest({ userId: 1, text: 'cum vezi BTC' });
        // Must include language permitting directional opinions + risk levels
        expect(prompt).toMatch(/SL\/TP|entry|tactical|directional|opinion|read/i);
    });

    test('buildSystemPrompt blocks market-manipulation hints (hard ethical floor)', () => {
        const prompt = responder._buildSystemPromptForTest({ userId: 1, text: 'cum vezi BTC' });
        // Must explicitly refuse spoofing / wash trading / pump signals
        expect(prompt).toMatch(/spoof|wash|manipul|pump|coordinated|insider/i);
    });

    test('buildSystemPrompt injects market context inline', () => {
        const prompt = responder._buildSystemPromptForTest({ userId: 1, text: 'cum vezi piata' });
        // Top gainers/losers / BTC delta should be in the prompt body
        expect(prompt).toMatch(/PEPE|gainers/i);
        expect(prompt).toMatch(/XRP|losers/i);
        expect(prompt).toMatch(/BTC/i);
    });

    test('buildSystemPrompt injects symbol-deep block when symbol mentioned', () => {
        seedAuditRow('SOLUSDT', 'TREND', 'accepted', 'LONG', 75);
        const prompt = responder._buildSystemPromptForTest({ userId: 1, text: 'cum vezi SOL' });
        expect(prompt).toMatch(/SOLUSDT|SOL/);
        expect(prompt).toMatch(/200|price/);
    });

    test('buildSystemPrompt is Romanian-aware when input is Romanian', () => {
        const prompt = responder._buildSystemPromptForTest({ userId: 1, text: 'cum vezi piata' });
        // Should contain instruction to reply in Romanian
        expect(prompt).toMatch(/român|romana|romanian|RO/i);
    });

    test('buildSystemPrompt is English-only when input is English', () => {
        const prompt = responder._buildSystemPromptForTest({ userId: 1, text: 'how is the market doing' });
        // Should contain English-only directive
        expect(prompt).toMatch(/english/i);
    });
});
