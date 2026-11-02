'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-resp-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const responder = require('../../../server/services/ml/_voice/chatResponder');

const _now = () => Date.now();

function seedAuditRow(symbol, regime, status, ts = _now()) {
    db.prepare(`INSERT INTO ml_influence_audit
        (user_id, env, symbol, regime,
         phase2_dir, phase2_confidence, phase2_score,
         proposed_dir, proposed_confidence, proposed_score,
         gate_status, gate_reason, rationale_json, created_at)
        VALUES (1, 'DEMO', ?, ?, 'LONG', 70, 5, 'LONG', 70, 5, ?, 'test', '{}', ?)`)
       .run(symbol, regime, status, ts);
}

function clean() {
    db.prepare("DELETE FROM ml_influence_audit").run();
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ml_bandit_posteriors'").get()) {
        db.prepare("DELETE FROM ml_bandit_posteriors").run();
    }
}

describe('chatResponder.respond', () => {
    beforeEach(clean);

    test('greeting intent EN', async () => {
        const r = await responder.respond({ userId: 1, text: 'hi' });
        expect(r.reply).toMatch(/yo boss|omega/i);
        expect(r.mood).toBeDefined();
    });

    test('greeting intent RO (Romanian markers detected → Romanian reply)', async () => {
        const r = await responder.respond({ userId: 1, text: 'salut ce faci' });
        expect(r.reply).toMatch(/salut|boss|omega/i);
        expect(r.reply).toMatch(/poziții|întreabă|starea/i);  // Romanian phrasing
    });

    test('help intent EN', async () => {
        const r = await responder.respond({ userId: 1, text: 'help' });
        expect(r.reply).toMatch(/positions|pnl|mood/i);
        expect(r.mood).toBe('CALM');
    });

    test('help intent RO (Romanian markers)', async () => {
        const r = await responder.respond({ userId: 1, text: 'ce poti sa faci' });
        expect(r.reply).toMatch(/poziții|alerte|decizii/i);
    });

    test('positions intent — empty when no positions', async () => {
        const r = await responder.respond({ userId: 9999, text: 'positions' });
        expect(r.reply).toMatch(/no positions|flat|serverAT not available/i);
    });

    test('pnl intent — no trades response', async () => {
        const r = await responder.respond({ userId: 9999, text: 'how is my pnl today' });
        expect(r.reply).toMatch(/no closed trades|couldn't/i);
    });

    test('mood intent — empty audit window', async () => {
        const r = await responder.respond({ userId: 1, text: 'how do you feel' });
        expect(r.reply).toMatch(/idle|just rebooted|feeling/i);
    });

    test('bandit intent — cold state', async () => {
        const r = await responder.respond({ userId: 1, text: 'how is the bandit' });
        expect(r.reply).toMatch(/bandit/i);
        expect(r.reply).toMatch(/cold|seed|INACTIVE/i);
    });

    test('decisions intent — empty audit window', async () => {
        const r = await responder.respond({ userId: 1, text: 'what decisions are you making' });
        expect(r.reply).toMatch(/no decisions|idle/i);
    });

    test('REGRESIE: deciziile se numara din brain_decisions, grupate dupa CE S-A INTAMPLAT', async () => {
        // Varianta veche citea `ml_influence_audit` si raporta perechi
        // simbol/regim. Pe sistemul viu erau 20.160 de randuri pe zi, toate
        // `skipped`, deci operatorul primea "10 decisions" despre zece
        // nimicuri. Ce vrea sa stie e ce le-a oprit.
        const { db } = require('../../../server/services/database');
        const now = Date.now();
        const ins = db.prepare(`INSERT INTO brain_decisions
            (snap_id, user_id, symbol, ts, cycle, source_path, final_tier, final_conf, final_dir, final_action, data, resolved_env)
            VALUES (?, 1, ?, ?, 1, ?, 'SMALL', 70, 'LONG', ?, '{}', 'DEMO')`);
        ins.run('d1' + now, 'BTCUSDT', now, 'blocked_gates', 'blocked_gates');
        ins.run('d2' + now, 'BTCUSDT', now, 'blocked_gates', 'blocked_gates');
        ins.run('d3' + now, 'ETHUSDT', now, 'no_trade', 'no_trade');
        const r = await responder.respond({ userId: 1, text: 'decisions' });
        db.prepare("DELETE FROM brain_decisions WHERE snap_id LIKE 'd%' || ?").run(String(now));
        expect(r.reply).toMatch(/3 decisions/);
        expect(r.reply).toMatch(/blocked_gates: 2/);
        expect(r.reply).toMatch(/no_trade: 1/);
    });

    test('Romanian unscripted question does NOT trigger wrong intent (azi bug fix)', async () => {
        // Previously "ce parere despre crypto azi" caught "azi" → pnl intent.
        // Now should fall through to LLM fallback / help.
        delete process.env.GROQ_API_KEY;
        const r = await responder.respond({ userId: 1, text: 'ce parere ai despre crypto azi' });
        expect(r.reply).not.toMatch(/no closed trades|wins\/losses|net /);
    });

    test('Romanian "deciziile tale" still triggers decisions intent', async () => {
        seedAuditRow('BTCUSDT', 'RANGE', 'skipped');
        const r = await responder.respond({ userId: 1, text: 'spune-mi deciziile tale' });
        expect(r.reply).toMatch(/decisions|BTCUSDT/);
    });

    test('doctor intent', async () => {
        const r = await responder.respond({ userId: 1, text: 'any alerts' });
        expect(r.reply).toMatch(/cognitive state|active P0|HEALTHY|COMPROMISED/i);
    });

    test('symbol-specific intent — no recent data', async () => {
        const r = await responder.respond({ userId: 1, text: 'how is btc' });
        expect(r.reply).toMatch(/BTCUSDT|asleep|no recent/i);
    });

    test('REGRESIE: raspunsul pe simbol vine din deciziile REALE, cu ce le-a oprit', async () => {
        // Varianta veche citea `ml_influence_audit` si producea exact replica pe
        // care a primit-o operatorul: "BTCUSDT last 5min: 10 decisions ...
        // conf 0, status skipped. avg conf 0." Zece decizii fara continut,
        // fiindca toate cele 522.400 de randuri ale tabelei sunt `skipped`.
        const { db } = require('../../../server/services/database');
        const now = Date.now();
        const ins = db.prepare(`INSERT INTO brain_decisions
            (snap_id, user_id, symbol, ts, cycle, source_path, final_tier, final_conf, final_dir, final_action, data, resolved_env)
            VALUES (?, 1, 'BTCUSDT', ?, 1, ?, ?, ?, 'SHORT', ?, ?, 'DEMO')`);
        // Timpi DISTINCTI: "latest" trebuie sa fie determinist, altfel testul
        // depinde de ordinea in care SQLite intoarce doua randuri identice.
        ins.run('s1' + now, now - 1000, 'no_trade', 'NO_TRADE', 42, 'no_trade', JSON.stringify({ regime: 'TREND' }));
        ins.run('s2' + now, now, 'blocked_reflection', 'MEDIUM', 81, 'blocked_reflection', JSON.stringify({ regime: 'TREND' }));
        const r = await responder.respond({ userId: 1, text: 'how is btc' });
        db.prepare("DELETE FROM brain_decisions WHERE snap_id LIKE 's%' || ?").run(String(now));
        expect(r.reply).toMatch(/BTCUSDT/);
        expect(r.reply).toMatch(/2 decisions/);
        expect(r.reply).toMatch(/TREND/);
        // Partea care lipsea cu totul inainte: ce s-a intamplat cu ele.
        expect(r.reply).toMatch(/blocked_reflection/);
        expect(r.reply).not.toMatch(/conf 0\b/);
    });

    test('fallback intent — unknown question', async () => {
        const r = await responder.respond({ userId: 1, text: 'asdf qwerty xyz123' });
        expect(r.reply).toMatch(/positions|pnl|mood|bandit/i);
    });

    test('rude language → calm response', async () => {
        const r = await responder.respond({ userId: 1, text: 'wtf is this' });
        expect(r.reply).toMatch(/easy boss|breathe/i);
        expect(r.mood).toBe('CALM');
    });

    test('empty text', async () => {
        const r = await responder.respond({ userId: 1, text: '' });
        expect(r.reply).toMatch(/speak/i);
    });

    test('missing userId throws', async () => {
        await expect(responder.respond({ text: 'hi' })).rejects.toThrow(/userId/);
    });

    test('conversation history tracked per user (multi-turn)', async () => {
        responder._resetConvoForTest(1);
        await responder.respond({ userId: 1, text: 'hi' });
        await responder.respond({ userId: 1, text: 'help' });
        // After 2 exchanges, history should have 4 entries (2×user+assistant).
        // Direct DB-less check: subsequent calls don't blow up + persistence
        // via the wrapper is observable through side effects (no API exposed).
        // We can verify _resetConvoForTest empties history without error.
        responder._resetConvoForTest(1);
        const r = await responder.respond({ userId: 1, text: 'hi' });
        expect(r.reply).toBeDefined();
    });

    test('unknown intent without GROQ_API_KEY → falls back to local help', async () => {
        // No API key set in env → groqClient.available()=false → local help.
        const prev = process.env.GROQ_API_KEY;
        delete process.env.GROQ_API_KEY;
        const r = await responder.respond({ userId: 1, text: 'tell me a philosophical joke about markets' });
        expect(r.reply).toMatch(/positions|pnl|mood|bandit/i);
        if (prev) process.env.GROQ_API_KEY = prev;
    });
});
