'use strict';

// [Day 33 #2] Personalized strategies — operator-stated preferences
// persisted and injected into LLM system prompt.

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-profile-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';
process.env.MARKET_RADAR_ENABLED = '0';
delete process.env.GROQ_API_KEY;

const { db } = require('../../../server/services/database');
const responder = require('../../../server/services/ml/_voice/chatResponder');
const marketRadar = require('../../../server/services/marketRadar');

function seedUser(uid) {
    try {
        db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)`)
          .run(uid, `u${uid}@test.local`, 'x');
    } catch (_) {}
}

function clean() {
    db.prepare("DELETE FROM trader_profile_preferences").run();
    seedUser(1);
    marketRadar._ingestSnapshotForTest([
        { symbol: 'BTCUSDT', price: 70000, priceChangePercent24h: 2.5, quoteVolume: 5e9 },
    ]);
    responder._resetConvoForTest();
}

describe('chatResponder trader profile', () => {
    beforeEach(clean);
    afterEach(() => marketRadar._resetSnapshotForTest());

    test('EN "remember that I prefer tight SL" persists preference + confirms', async () => {
        const r = await responder.respond({ userId: 1, text: 'remember that I prefer tight SL 1-2%' });
        expect(r.reply).toMatch(/got it|remembered|noted|reținut/i);
        // Persisted in DB
        const row = db.prepare("SELECT preference FROM trader_profile_preferences WHERE user_id = ?").get(1);
        expect(row).toBeDefined();
        expect(row.preference).toMatch(/tight SL/i);
    });

    test('RO "reține că prefer size mic" persists + confirms', async () => {
        const r = await responder.respond({ userId: 1, text: 'reține că prefer size mic, max 5% din balance' });
        expect(r.reply).toMatch(/reținut|am notat|salvat|got it/i);
        const rows = db.prepare("SELECT preference FROM trader_profile_preferences WHERE user_id = ?").all(1);
        expect(rows.length).toBeGreaterThan(0);
    });

    test('multiple preferences accumulate', async () => {
        await responder.respond({ userId: 1, text: 'remember that I prefer tight SL' });
        await responder.respond({ userId: 1, text: 'remember that I avoid alts under $500M cap' });
        const rows = db.prepare("SELECT preference FROM trader_profile_preferences WHERE user_id = ?").all(1);
        expect(rows.length).toBe(2);
    });

    test('"what do you remember about me" lists stored preferences', async () => {
        db.prepare("INSERT INTO trader_profile_preferences (user_id, preference) VALUES (1, ?)")
          .run('prefer tight SL 1-2%');
        db.prepare("INSERT INTO trader_profile_preferences (user_id, preference) VALUES (1, ?)")
          .run('avoid alts under $500M cap');
        const r = await responder.respond({ userId: 1, text: 'what do you remember about me' });
        expect(r.reply).toMatch(/tight SL/i);
        expect(r.reply).toMatch(/alts under/i);
    });

    test('RO "ce știi despre mine" lists stored preferences', async () => {
        db.prepare("INSERT INTO trader_profile_preferences (user_id, preference) VALUES (1, ?)")
          .run('prefer size mic');
        const r = await responder.respond({ userId: 1, text: 'ce știi despre mine' });
        expect(r.reply).toMatch(/size mic/i);
    });

    test('empty profile → honest "nothing yet" reply', async () => {
        const r = await responder.respond({ userId: 1, text: 'what do you remember about me' });
        expect(r.reply).toMatch(/nothing|no preferences|nimic|niciuna|nu am salvat/i);
    });

    test('LLM context includes trader profile when present', () => {
        db.prepare("INSERT INTO trader_profile_preferences (user_id, preference) VALUES (1, ?)")
          .run('prefer tight SL 1-2%');
        db.prepare("INSERT INTO trader_profile_preferences (user_id, preference) VALUES (1, ?)")
          .run('avoid alts under $500M cap');
        const ctx = responder._buildLLMContextForTest({ userId: 1, text: 'cum vezi BTC' });
        expect(ctx.traderProfile).toBeDefined();
        expect(Array.isArray(ctx.traderProfile)).toBe(true);
        expect(ctx.traderProfile.length).toBe(2);
    });

    test('system prompt includes trader profile preferences', () => {
        db.prepare("INSERT INTO trader_profile_preferences (user_id, preference) VALUES (1, ?)")
          .run('prefer tight SL 1-2%');
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'cum vezi BTC' });
        expect(p).toMatch(/tight SL|operator prefers|preferin[țt]/i);
    });

    test('"forget preference X" removes matching entry', async () => {
        db.prepare("INSERT INTO trader_profile_preferences (user_id, preference) VALUES (1, ?)")
          .run('prefer tight SL');
        const r = await responder.respond({ userId: 1, text: 'forget that I prefer tight SL' });
        expect(r.reply).toMatch(/forgotten|removed|șters|uitat/i);
        const rows = db.prepare("SELECT preference FROM trader_profile_preferences WHERE user_id = ?").all(1);
        expect(rows.length).toBe(0);
    });
});
