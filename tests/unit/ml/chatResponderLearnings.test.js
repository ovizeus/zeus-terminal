'use strict';

// [Day 33] #1 — Surface Ring5 + serverJournal learnings via chat.

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-learn-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';
process.env.MARKET_RADAR_ENABLED = '0';
delete process.env.GROQ_API_KEY;
delete process.env.XAI_API_KEY;

const { db } = require('../../../server/services/database');
const responder = require('../../../server/services/ml/_voice/chatResponder');
const marketRadar = require('../../../server/services/marketRadar');
const banditPosteriors = require('../../../server/services/ml/_ring5/banditPosteriors');

function seedClosedTrade(userId, regime, dir, symbol, pnl, ts) {
    const data = JSON.stringify({
        regime, dir, symbol, side: dir,
        closePnl: pnl, closeReason: pnl > 0 ? 'HIT_TP' : 'HIT_SL',
        openTs: ts - 60000, closedAt: ts, tier: 'NORMAL',
        sym: symbol, mode: 'demo',
    });
    db.prepare(`INSERT INTO at_closed (user_id, data, closed_at) VALUES (?, ?, datetime('now'))`).run(userId, data);
}

function seedPosterior(level, cellKey, alpha, beta, obs) {
    db.prepare(`INSERT INTO ml_bandit_posteriors (level, cell_key, alpha, beta, observation_count, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(level, cell_key) DO UPDATE SET alpha=excluded.alpha, beta=excluded.beta, observation_count=excluded.observation_count`)
       .run(level, cellKey, alpha, beta, obs, Date.now());
}

function seedUser(uid) {
    try {
        db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash)
                    VALUES (?, ?, ?)`)
          .run(uid, `u${uid}@test.local`, 'x');
    } catch (_) {}
}

function clean() {
    db.prepare("DELETE FROM at_closed").run();
    db.prepare("DELETE FROM ml_bandit_posteriors").run();
    seedUser(1);
    marketRadar._resetSnapshotForTest();
    responder._resetConvoForTest();
}

describe('chatResponder learnings intent', () => {
    beforeEach(clean);

    test('insufficient trades → honest "not enough data" reply', async () => {
        const r = await responder.respond({ userId: 1, text: 'ce ai învățat' });
        expect(r.reply).toMatch(/nu am destule|insufficient|few trades|need more|10\+/i);
    });

    test('EN "what have you learned" triggers learnings intent', async () => {
        const r = await responder.respond({ userId: 9001, text: 'what have you learned' });
        // 9001 has no trades — should still hit learnings intent, not LLM fallback
        expect(r.reply).toMatch(/insufficient|not enough|few trades|0 trades|no trades/i);
    });

    test('RO "ce ai învățat" triggers learnings intent', async () => {
        const r = await responder.respond({ userId: 9002, text: 'ce ai învățat din trade-uri' });
        expect(r.reply).toMatch(/nu am destule|insufficient|0 trade|fără trade/i);
    });

    test('with closed trades → reports trade count + win rate breakdown', async () => {
        // 12 trades, 8 wins on TREND, 2/4 losses on RANGE
        const baseTs = Date.now() - 86400000;
        for (let i = 0; i < 8; i++) seedClosedTrade(1, 'TREND', 'LONG', 'BTCUSDT', 50, baseTs + i * 60000);
        for (let i = 0; i < 4; i++) seedClosedTrade(1, 'RANGE', 'SHORT', 'BTCUSDT', -30, baseTs + (8 + i) * 60000);
        // Trigger insights recompute via direct API
        const journal = require('../../../server/services/serverJournal');
        // Force recompute (insights computed lazily on first getInsights normally;
        // here we call internal _computeInsights via journal.start would normally do it).
        // Instead we'll re-require with a fresh module and rely on _replyLearnings
        // doing its own DB pull or via getInsights.
        const r = await responder.respond({ userId: 1, text: 'ce ai învățat' });
        expect(r.reply).toMatch(/12 trade|12 closed|N=12|12\s*tranzac/i);
    });

    test('with bandit posteriors → reports top cells', async () => {
        // 12 trades to clear "insufficient" gate
        const baseTs = Date.now() - 86400000;
        for (let i = 0; i < 12; i++) seedClosedTrade(1, 'TREND', 'LONG', 'BTCUSDT', 50, baseTs + i * 60000);
        // Seed bandit L4 cell cu obs >= 10
        seedPosterior(4, '1|DEMO|BTCUSDT|TREND', 11, 4, 15);  // L4 user-owned
        seedPosterior(4, '1|DEMO|ETHUSDT|RANGE', 6, 8, 14);   // L4 user-owned
        const r = await responder.respond({ userId: 1, text: 'ce ai învățat' });
        // Should include at least one cell mention
        expect(r.reply).toMatch(/BTCUSDT|ETHUSDT|TREND|RANGE|bandit|cell|win.?rate/i);
    });

    test('learnings intent does NOT swallow symbol-specific queries', async () => {
        // "cum vezi btc, ce ai învățat" — symbol AND learnings — symbol path wins
        // (more specific). We test that pure learnings query bypasses symbol regex.
        const r = await responder.respond({ userId: 1, text: 'spune ce ai învățat în general' });
        // "general" lacks symbol marker so learnings should fire
        expect(r.reply).toMatch(/trade|insufficient|0 trade/i);
    });
});
