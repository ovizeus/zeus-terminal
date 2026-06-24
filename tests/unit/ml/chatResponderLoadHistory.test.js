'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-hist-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const { db } = require('../../../server/services/database');
const chatResponder = require('../../../server/services/ml/_voice/chatResponder');

beforeEach(() => {
    db.prepare('DELETE FROM ml_voice_log').run();
    chatResponder._resetConvoForTest(1);
    chatResponder._resetConvoForTest(2);
    chatResponder._resetLoadedForTest(1);
    chatResponder._resetLoadedForTest(2);
});

function _seedReply(userId, question, reply) {
    const ts = Date.now();
    db.prepare(`INSERT INTO ml_voice_log (user_id, utterance_type, mood, text, context_json, created_at)
                VALUES (?, 'CHAT_REPLY', 'CALM', ?, ?, ?)`).run(
        userId, reply, JSON.stringify({ question }), ts
    );
}

describe('chatResponder._loadConvoHistory', () => {
    test('populates _convoHistory from DB last 10 turns', async () => {
        for (let i = 1; i <= 5; i++) {
            _seedReply(1, `q${i}`, `r${i}`);
            await new Promise(r => setTimeout(r, 2));
        }
        await chatResponder._loadConvoHistory(1);
        const convo = chatResponder._getConvoForTest(1);
        expect(convo.length).toBe(10); // 5 user + 5 assistant
        expect(convo[0]).toMatchObject({ role: 'user', content: 'q1' });
        expect(convo[1]).toMatchObject({ role: 'assistant', content: 'r1' });
    });

    // [2026-06-23] Continuity across sessions/restarts: a conversation from hours ago must still
    // reach the LLM. Regression for the bug where rehydrated rows had no `ts` → _getConvo's TTL
    // filter dropped them (NaN compare) → Omega "forgot" everything on re-entry / after a reload.
    test('rehydrated turns carry a real ts and survive the TTL filter the LLM sees', async () => {
        const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
        db.prepare(`INSERT INTO ml_voice_log (user_id, utterance_type, mood, text, context_json, created_at)
                    VALUES (?, 'CHAT_REPLY', 'CALM', ?, ?, ?)`).run(
            1, 'reply-from-earlier', JSON.stringify({ question: 'something we discussed earlier' }), twoHoursAgo
        );
        await chatResponder._loadConvoHistory(1);
        const filtered = chatResponder._getConvoFilteredForTest(1); // the view the LLM receives
        expect(filtered.length).toBe(2);                 // BUG before fix: 0 (dropped by NaN TTL)
        expect(typeof filtered[0].ts).toBe('number');
        expect(filtered[0].ts).toBeGreaterThan(0);
        expect(filtered).toEqual(expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'something we discussed earlier' }),
            expect.objectContaining({ role: 'assistant', content: 'reply-from-earlier' }),
        ]));
    });

    test('idempotent: second call with same userId is no-op (returns cached Promise)', async () => {
        _seedReply(1, 'q1', 'r1');
        await chatResponder._loadConvoHistory(1);
        const convoAfter1 = chatResponder._getConvoForTest(1).length;
        _seedReply(1, 'q2', 'r2'); // add row after first load
        await chatResponder._loadConvoHistory(1); // should NOT re-query
        const convoAfter2 = chatResponder._getConvoForTest(1).length;
        expect(convoAfter2).toBe(convoAfter1); // unchanged — cache wins
    });

    test('concurrent calls dedup (single Promise awaited by both)', async () => {
        _seedReply(1, 'q1', 'r1');
        await Promise.all([
            chatResponder._loadConvoHistory(1),
            chatResponder._loadConvoHistory(1),
            chatResponder._loadConvoHistory(1),
        ]);
        const convo = chatResponder._getConvoForTest(1);
        expect(convo.length).toBe(2); // single load
    });

    test('per-user isolation', async () => {
        _seedReply(1, 'q-user1', 'r-user1');
        _seedReply(2, 'q-user2', 'r-user2');
        await Promise.all([
            chatResponder._loadConvoHistory(1),
            chatResponder._loadConvoHistory(2),
        ]);
        const c1 = chatResponder._getConvoForTest(1);
        expect(c1.length).toBe(2);
        expect(c1[0]).toMatchObject({ role: 'user', content: 'q-user1' });
        expect(c1[1]).toMatchObject({ role: 'assistant', content: 'r-user1' });
        const c2 = chatResponder._getConvoForTest(2);
        expect(c2.length).toBe(2);
        expect(c2[0]).toMatchObject({ role: 'user', content: 'q-user2' });
        expect(c2[1]).toMatchObject({ role: 'assistant', content: 'r-user2' });
    });

    test('caps load at CONVO_MAX_TURNS (10 turns = 20 messages)', async () => {
        for (let i = 1; i <= 15; i++) {
            _seedReply(1, `q${i}`, `r${i}`);
            await new Promise(r => setTimeout(r, 2));
        }
        await chatResponder._loadConvoHistory(1);
        const convo = chatResponder._getConvoForTest(1);
        expect(convo.length).toBe(20); // 10 turns × 2
        expect(convo[0].content).toBe('q6'); // oldest in window
    });

    test('empty user history → empty convo (no error)', async () => {
        await chatResponder._loadConvoHistory(99);
        expect(chatResponder._getConvoForTest(99)).toEqual([]);
    });

    test('malformed context_json: row skipped from load, no throw', async () => {
        const ts = Date.now();
        db.prepare(`INSERT INTO ml_voice_log (user_id, utterance_type, mood, text, context_json, created_at)
                    VALUES (1, 'CHAT_REPLY', 'CALM', 'reply-bad', '{bad json', ?)`).run(ts);
        _seedReply(1, 'q-good', 'r-good');
        await chatResponder._loadConvoHistory(1);
        const convo = chatResponder._getConvoForTest(1);
        // Only the good row included
        expect(convo.length).toBe(2);
        expect(convo[0].content).toBe('q-good');
    });
});

describe('chatResponder._invalidateConvoHistory', () => {
    test('clears in-memory cache for user, allowing next load to re-query', async () => {
        _seedReply(1, 'q1', 'r1');
        await chatResponder._loadConvoHistory(1);
        expect(chatResponder._getConvoForTest(1).length).toBe(2);
        chatResponder._invalidateConvoHistory(1);
        expect(chatResponder._getConvoForTest(1)).toEqual([]);
        // After invalidate, next loadConvoHistory should re-query (not return cached)
        await chatResponder._loadConvoHistory(1);
        expect(chatResponder._getConvoForTest(1).length).toBe(2);
    });
});
