'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-chat-hist-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { db } = require('../../server/services/database');
const omegaRoutes = require('../../server/routes/omega');

// Reset rate-limit state between tests so each test starts with clean cooldown
beforeEach(() => {
    // Force-clear in-memory rate-limit Map by requiring the route module's helper
    try {
        const omegaModule = require('../../server/routes/omega');
        if (omegaModule._resetRateLimitForTest) omegaModule._resetRateLimitForTest();
    } catch (_) { /* not exposed yet */ }
});

function _makeApp(userId) {
    const app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: userId }; next(); });
    app.use('/api/omega', omegaRoutes);
    return app;
}

function _seedRow(userId, type, text, contextObj, mood = 'CALM') {
    const ts = Date.now();
    db.prepare(`INSERT INTO ml_voice_log (user_id, utterance_type, mood, text, context_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)`).run(
        userId, type, mood, text, contextObj == null ? null : JSON.stringify(contextObj), ts
    );
    return ts;
}

beforeEach(() => {
    db.prepare('DELETE FROM ml_voice_log').run();
});

describe('GET /api/omega/chat/history', () => {
    test('returns empty history for new user', async () => {
        const res = await request(_makeApp(99)).get('/api/omega/chat/history');
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.history).toEqual([]);
        expect(res.body.total).toBe(0);
    });

    test('returns chronological pairs (oldest first)', async () => {
        _seedRow(1, 'CHAT_REPLY', 'omega-reply-1', { question: 'q1' });
        await new Promise(r => setTimeout(r, 2));
        _seedRow(1, 'CHAT_REPLY', 'omega-reply-2', { question: 'q2' });
        const res = await request(_makeApp(1)).get('/api/omega/chat/history');
        expect(res.status).toBe(200);
        expect(res.body.history.length).toBe(4);
        expect(res.body.history[0]).toMatchObject({ role: 'you', text: 'q1' });
        expect(res.body.history[1]).toMatchObject({ role: 'omega', text: 'omega-reply-1' });
        expect(res.body.history[2]).toMatchObject({ role: 'you', text: 'q2' });
        expect(res.body.history[3]).toMatchObject({ role: 'omega', text: 'omega-reply-2' });
    });

    test('filters per user — does NOT leak across users', async () => {
        _seedRow(1, 'CHAT_REPLY', 'user-1-reply', { question: 'user-1-q' });
        _seedRow(2, 'CHAT_REPLY', 'user-2-reply', { question: 'user-2-q' });
        const res = await request(_makeApp(1)).get('/api/omega/chat/history');
        expect(res.body.history.length).toBe(2);
        expect(res.body.history[1].text).toBe('user-1-reply');
        const res2 = await request(_makeApp(2)).get('/api/omega/chat/history');
        expect(res2.body.history.length).toBe(2);
        expect(res2.body.history[1].text).toBe('user-2-reply');
    });

    test('limit clamping: limit=500 capped at 100 (50 DB rows)', async () => {
        for (let i = 0; i < 60; i++) {
            _seedRow(1, 'CHAT_REPLY', `r${i}`, { question: `q${i}` });
            await new Promise(r => setTimeout(r, 1));
        }
        const res = await request(_makeApp(1)).get('/api/omega/chat/history?limit=500');
        expect(res.body.history.length).toBe(100);
        expect(res.body.total).toBe(60);
    });

    test('row with NULL context_json renders user bubble as (?)', async () => {
        _seedRow(1, 'CHAT_REPLY', 'reply-no-ctx', null);
        const res = await request(_makeApp(1)).get('/api/omega/chat/history');
        expect(res.body.history[0]).toMatchObject({ role: 'you', text: '(?)' });
        expect(res.body.history[1]).toMatchObject({ role: 'omega', text: 'reply-no-ctx' });
    });

    test('row with missing question key renders user bubble as (?)', async () => {
        _seedRow(1, 'CHAT_REPLY', 'reply-bad-ctx', { llmFallback: true });
        const res = await request(_makeApp(1)).get('/api/omega/chat/history');
        expect(res.body.history[0].text).toBe('(?)');
    });

    test('row with malformed context_json JSON renders user bubble as (?)', async () => {
        const ts = Date.now();
        db.prepare(`INSERT INTO ml_voice_log (user_id, utterance_type, mood, text, context_json, created_at)
                    VALUES (1, 'CHAT_REPLY', 'CALM', 'reply-malformed', '{not valid json}', ?)`).run(ts);
        const res = await request(_makeApp(1)).get('/api/omega/chat/history');
        expect(res.body.history[0].text).toBe('(?)');
    });

    test('row with empty string question renders (?)', async () => {
        _seedRow(1, 'CHAT_REPLY', 'reply-empty-q', { question: '' });
        const res = await request(_makeApp(1)).get('/api/omega/chat/history');
        expect(res.body.history[0].text).toBe('(?)');
    });

    test('includes mood field on omega bubble', async () => {
        _seedRow(1, 'CHAT_REPLY', 'happy-reply', { question: 'q' }, 'EXCITED');
        const res = await request(_makeApp(1)).get('/api/omega/chat/history');
        expect(res.body.history[1].mood).toBe('EXCITED');
    });

    test('excludes non-CHAT_REPLY utterance types', async () => {
        _seedRow(1, 'THOUGHT', 'thinking aloud', null);
        _seedRow(1, 'GREETING', 'salut', null);
        _seedRow(1, 'CHAT_REPLY', 'real-chat', { question: 'q' });
        const res = await request(_makeApp(1)).get('/api/omega/chat/history');
        expect(res.body.history.length).toBe(2);
        expect(res.body.history[1].text).toBe('real-chat');
    });
});

describe('DELETE /api/omega/chat/history', () => {
    beforeEach(() => {
        // Ensure audit_log table exists
        db.prepare(`CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER, action TEXT, details TEXT, ip TEXT, created_at INTEGER
        )`).run();
        db.prepare('DELETE FROM audit_log').run();
    });

    test('deletes all CHAT_REPLY rows for this user, returns deletedCount', async () => {
        _seedRow(1, 'CHAT_REPLY', 'r1', { question: 'q1' });
        _seedRow(1, 'CHAT_REPLY', 'r2', { question: 'q2' });
        _seedRow(1, 'GREETING', 'salut', null);  // also gets cleared
        _seedRow(1, 'THOUGHT', 'thinking', null); // PRESERVED
        _seedRow(2, 'CHAT_REPLY', 'other-user', { question: 'q' }); // PRESERVED
        const res = await request(_makeApp(1)).delete('/api/omega/chat/history');
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.deletedCount).toBe(3); // 2 CHAT_REPLY + 1 GREETING

        const remaining = db.prepare(`SELECT user_id, utterance_type FROM ml_voice_log`).all();
        expect(remaining.length).toBe(2);
        expect(remaining.find(r => r.user_id === 1 && r.utterance_type === 'THOUGHT')).toBeDefined();
        expect(remaining.find(r => r.user_id === 2)).toBeDefined();
    });

    test('creates audit_log entry on DELETE', async () => {
        _seedRow(1, 'CHAT_REPLY', 'r1', { question: 'q1' });
        await request(_makeApp(1)).delete('/api/omega/chat/history');
        const entries = db.prepare(`SELECT * FROM audit_log WHERE action = 'OMEGA_CHAT_HISTORY_CLEARED'`).all();
        expect(entries.length).toBe(1);
        expect(entries[0].user_id).toBe(1);
        const details = JSON.parse(entries[0].details);
        expect(details.deletedCount).toBe(1);
    });

    test('rate limit: second DELETE within 15s returns 429', async () => {
        _seedRow(1, 'CHAT_REPLY', 'r1', { question: 'q1' });
        const r1 = await request(_makeApp(1)).delete('/api/omega/chat/history');
        expect(r1.status).toBe(200);
        const r2 = await request(_makeApp(1)).delete('/api/omega/chat/history');
        expect(r2.status).toBe(429);
        expect(r2.body.ok).toBe(false);
        expect(r2.body.error).toMatch(/rate limit/i);
    });

    test('rate limit is per-user (user 2 not blocked by user 1)', async () => {
        _seedRow(1, 'CHAT_REPLY', 'r1', { question: 'q' });
        _seedRow(2, 'CHAT_REPLY', 'r2', { question: 'q' });
        await request(_makeApp(1)).delete('/api/omega/chat/history');
        const r2 = await request(_makeApp(2)).delete('/api/omega/chat/history');
        expect(r2.status).toBe(200);
    });

    test('preserves THOUGHT and CRITICAL_ALERT — only clears chat-type utterances', async () => {
        _seedRow(1, 'THOUGHT', 't1', null);
        _seedRow(1, 'CRITICAL_ALERT', 'a1', null);
        _seedRow(1, 'CHAT_REPLY', 'c1', { question: 'q' });
        await request(_makeApp(1)).delete('/api/omega/chat/history');
        const remaining = db.prepare(`SELECT utterance_type FROM ml_voice_log WHERE user_id = 1`).all();
        expect(remaining.map(r => r.utterance_type).sort()).toEqual(['CRITICAL_ALERT', 'THOUGHT']);
    });

    test('returns 0 deletedCount when nothing to delete', async () => {
        const res = await request(_makeApp(99)).delete('/api/omega/chat/history');
        expect(res.status).toBe(200);
        expect(res.body.deletedCount).toBe(0);
    });
});
