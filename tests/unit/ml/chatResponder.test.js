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

    test('greeting intent', () => {
        const r = responder.respond({ userId: 1, text: 'hi' });
        expect(r.reply).toMatch(/yo boss|omega/i);
        expect(r.mood).toBeDefined();
    });

    test('help intent', () => {
        const r = responder.respond({ userId: 1, text: 'help' });
        expect(r.reply).toMatch(/positions|pnl|mood/i);
        expect(r.mood).toBe('CALM');
    });

    test('positions intent — empty when no positions', () => {
        const r = responder.respond({ userId: 9999, text: 'positions' });
        expect(r.reply).toMatch(/no positions|flat|serverAT not available/i);
    });

    test('pnl intent — no trades response', () => {
        const r = responder.respond({ userId: 9999, text: 'how is my pnl today' });
        expect(r.reply).toMatch(/no closed trades|couldn't/i);
    });

    test('mood intent — empty audit window', () => {
        const r = responder.respond({ userId: 1, text: 'how do you feel' });
        expect(r.reply).toMatch(/idle|just rebooted|feeling/i);
    });

    test('bandit intent — cold state', () => {
        const r = responder.respond({ userId: 1, text: 'how is the bandit' });
        expect(r.reply).toMatch(/bandit/i);
        expect(r.reply).toMatch(/cold|seed|INACTIVE/i);
    });

    test('decisions intent — empty audit window', () => {
        const r = responder.respond({ userId: 1, text: 'what decisions are you making' });
        expect(r.reply).toMatch(/no decisions|idle/i);
    });

    test('decisions intent — with audit data', () => {
        seedAuditRow('BTCUSDT', 'RANGE', 'skipped');
        seedAuditRow('BTCUSDT', 'RANGE', 'skipped');
        seedAuditRow('ETHUSDT', 'TREND', 'skipped');
        const r = responder.respond({ userId: 1, text: 'decisions' });
        expect(r.reply).toMatch(/3 decisions/);
        expect(r.reply).toMatch(/BTCUSDT|ETHUSDT/);
    });

    test('doctor intent', () => {
        const r = responder.respond({ userId: 1, text: 'any alerts' });
        expect(r.reply).toMatch(/cognitive state|active P0|HEALTHY|COMPROMISED/i);
    });

    test('symbol-specific intent — no recent data', () => {
        const r = responder.respond({ userId: 1, text: 'how is btc' });
        expect(r.reply).toMatch(/BTCUSDT|asleep|no recent/i);
    });

    test('symbol-specific intent — with audit data', () => {
        seedAuditRow('BTCUSDT', 'TREND', 'accepted');
        seedAuditRow('BTCUSDT', 'TREND', 'skipped');
        const r = responder.respond({ userId: 1, text: 'how is btc' });
        expect(r.reply).toMatch(/BTCUSDT/);
        expect(r.reply).toMatch(/2 decisions/);
        expect(r.reply).toMatch(/TREND/);
    });

    test('fallback intent — unknown question', () => {
        const r = responder.respond({ userId: 1, text: 'asdf qwerty xyz123' });
        expect(r.reply).toMatch(/positions|pnl|mood|bandit/i);
    });

    test('rude language → calm response', () => {
        const r = responder.respond({ userId: 1, text: 'wtf is this' });
        expect(r.reply).toMatch(/easy boss|breathe/i);
        expect(r.mood).toBe('CALM');
    });

    test('empty text', () => {
        const r = responder.respond({ userId: 1, text: '' });
        expect(r.reply).toMatch(/speak/i);
    });

    test('missing userId throws', () => {
        expect(() => responder.respond({ text: 'hi' })).toThrow(/userId/);
    });
});
