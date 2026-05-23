# Omega Chat Persistence — Sub-Project A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Omega chat history end-to-end: UI restore on refresh + brain rehydration after PM2 reload + per-user nuclear wipe button. No schema migration.

**Architecture:** 2 new backend routes on existing `ml_voice_log` table, lazy in-memory rehydration in chatResponder, new Zustand store for cross-component sync, modify TalkWithMe to consume store, new Settings section with confirm-protected Clear button. Per-user isolation enforced via existing `_requireUser` middleware. Rate-limited DELETE (1/15s/user) with audit_log entry.

**Tech Stack:** Node.js + better-sqlite3 + jest/supertest (backend), React + Zustand + vitest (frontend), existing `voiceLogger` + `chatResponder` modules in `server/services/ml/_voice/`.

**Spec:** `docs/superpowers/specs/2026-05-19-omega-chat-persistence-design.md`

---

## File Structure

| File | Action | Lines |
|---|---|---|
| `server/routes/omega.js` | MODIFY — add GET + DELETE handlers | +90 |
| `server/services/ml/_voice/chatResponder.js` | MODIFY — `_loadConvoHistory(userId)` + lazy hook in `respond()` | +40 |
| `client/src/stores/omegaChatStore.ts` | CREATE — Zustand store + actions | +95 |
| `client/src/components/omega/TalkWithMe.tsx` | MODIFY — consume store, `useEffect` calls `store.loadHistory()` | +20 |
| `client/src/components/settings/OmegaMemorySection.tsx` | CREATE — Settings UI | +80 |
| `client/src/components/settings/SettingsModal.tsx` | MODIFY — add Omega tab | +10 |
| `client/src/app.css` | MODIFY — `.omega-chat-orphan` styling | +6 |
| `tests/unit/omegaRoutesChatHistory.test.js` | CREATE — supertest backend coverage | +200 |
| `tests/unit/ml/chatResponderLoadHistory.test.js` | CREATE — jest chatResponder coverage | +100 |
| `client/src/stores/__tests__/omegaChatStore.test.ts` | CREATE — vitest store coverage | +130 |

Total: ~771 lines (3 new files + 5 modified + 3 new test files).

---

## Task 1: Backend GET /api/omega/chat/history (TDD RED + GREEN)

**Files:**
- Modify: `server/routes/omega.js`
- Create: `tests/unit/omegaRoutesChatHistory.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/omegaRoutesChatHistory.test.js`:

```js
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

function _makeApp(userId) {
    const app = express();
    app.use(cookieParser());
    app.use(express.json());
    // Inject req.user to simulate auth middleware
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
        await new Promise(r => setTimeout(r, 2)); // ensure ts ordering
        _seedRow(1, 'CHAT_REPLY', 'omega-reply-2', { question: 'q2' });
        const res = await request(_makeApp(1)).get('/api/omega/chat/history');
        expect(res.status).toBe(200);
        expect(res.body.history.length).toBe(4); // 2 exchanges = 4 ChatRow
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
        // user 2 isolated
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
        expect(res.body.history.length).toBe(100); // 50 exchanges × 2
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
        expect(res.body.history.length).toBe(2); // only the CHAT_REPLY pair
        expect(res.body.history[1].text).toBe('real-chat');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/omegaRoutesChatHistory.test.js --forceExit`
Expected: FAIL — route `GET /api/omega/chat/history` not defined.

- [ ] **Step 3: Implement GET route in omega.js**

In `server/routes/omega.js`, add this AFTER the existing `POST /chat-stream` route handler:

```js
// ── GET /api/omega/chat/history?limit=N ─────────────────────────────────────
// [Sub-A 2026-05-19] Per-user chat history for TalkWithMe mount load + brain
// rehydration. Reads ml_voice_log rows of type CHAT_REPLY, expands each into
// [you, omega] ChatRow pair. Edge cases for missing user question render
// placeholder '(?)' instead of skipping rows.
router.get('/chat/history', (req, res) => {
    const userId = _requireUser(req, res);
    if (!userId) return;
    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;
    const dbRows = Math.ceil(limit / 2);
    try {
        const { db } = require('../services/database');
        const rows = db.prepare(`
            SELECT id, mood, text, context_json, created_at
            FROM ml_voice_log
            WHERE user_id = ? AND utterance_type = 'CHAT_REPLY'
            ORDER BY created_at DESC
            LIMIT ?
        `).all(userId, dbRows);
        const totalRow = db.prepare(`
            SELECT COUNT(*) as c FROM ml_voice_log
            WHERE user_id = ? AND utterance_type = 'CHAT_REPLY'
        `).get(userId);
        const total = totalRow ? totalRow.c : 0;

        // Expand rows into ChatRow pairs (you, omega). Reverse to chronological.
        const history = [];
        for (const row of rows.reverse()) {
            let questionText = '(?)';
            if (row.context_json) {
                try {
                    const ctx = JSON.parse(row.context_json);
                    if (ctx && typeof ctx.question === 'string' && ctx.question.length > 0) {
                        questionText = ctx.question;
                    }
                } catch (parseErr) {
                    // malformed JSON — keep placeholder, log defensively
                    logger.warn('OMEGA', `[chat/history] malformed context_json on row id=${row.id} uid=${userId}: ${parseErr.message}`);
                }
            }
            history.push({ role: 'you', text: questionText, ts: row.created_at - 1 });
            history.push({ role: 'omega', text: row.text, mood: row.mood, ts: row.created_at });
        }
        res.json({ ok: true, history, total });
    } catch (err) {
        logger.error('OMEGA', `[chat/history] error uid=${userId}: ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});
```

Verify `logger` is imported at top of file. If not, add: `const logger = require('../services/logger');`

- [ ] **Step 4: Run tests to verify pass**

Run: `cd /root/zeus-terminal && npx jest tests/unit/omegaRoutesChatHistory.test.js --forceExit`
Expected: PASS — 9/9 tests (GET section).

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/routes/omega.js tests/unit/omegaRoutesChatHistory.test.js
git commit -m "[Sub-A omega chat] GET /api/omega/chat/history per-user paginated read

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Backend DELETE /api/omega/chat/history (TDD RED + GREEN)

**Files:**
- Modify: `server/routes/omega.js`
- Modify: `tests/unit/omegaRoutesChatHistory.test.js` (append)

- [ ] **Step 1: Append failing tests**

Append at end of `tests/unit/omegaRoutesChatHistory.test.js`:

```js
describe('DELETE /api/omega/chat/history', () => {
    let auditLogSpy;

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/omegaRoutesChatHistory.test.js --forceExit`
Expected: FAIL — DELETE route not defined; rate limit not implemented.

- [ ] **Step 3: Implement DELETE route + rate limiter in omega.js**

Add BEFORE the GET route (so the rate-limit Map is declared at module scope):

```js
// [Sub-A 2026-05-19] In-memory rate limit for DELETE /chat/history.
// 1 clear per user per 15 seconds. Reset on process restart (acceptable —
// next restart unblocks anyway). Stored as Map<userId, lastClearedAtMs>.
const _CLEAR_RATE_LIMIT_MS = 15 * 1000;
const _lastClearByUser = new Map();

function _canClearNow(userId) {
    const now = Date.now();
    const last = _lastClearByUser.get(userId);
    if (last == null) return { allowed: true, remainingSec: 0 };
    const elapsed = now - last;
    if (elapsed >= _CLEAR_RATE_LIMIT_MS) return { allowed: true, remainingSec: 0 };
    return { allowed: false, remainingSec: Math.ceil((_CLEAR_RATE_LIMIT_MS - elapsed) / 1000) };
}

function _markCleared(userId) {
    _lastClearByUser.set(userId, Date.now());
}
```

Then add the DELETE route AFTER the GET handler:

```js
// ── DELETE /api/omega/chat/history ──────────────────────────────────────────
// [Sub-A 2026-05-19] Per-user nuclear wipe of chat-type utterances.
// Preserves THOUGHT (brain narration) and CRITICAL_ALERT (operator alerts).
// Rate limit: 1 per user per 15s. Creates audit_log entry on every call.
// Invalidates chatResponder in-memory _convoHistory for this user.
router.delete('/chat/history', (req, res) => {
    const userId = _requireUser(req, res);
    if (!userId) return;
    const gate = _canClearNow(userId);
    if (!gate.allowed) {
        return res.status(429).json({
            ok: false,
            error: `Rate limit: wait ${gate.remainingSec}s before next clear`,
            remainingSec: gate.remainingSec,
        });
    }
    try {
        const { db } = require('../services/database');
        const result = db.prepare(`
            DELETE FROM ml_voice_log
            WHERE user_id = ? AND utterance_type IN ('CHAT_REPLY', 'GREETING', 'FAREWELL', 'REACTION')
        `).run(userId);
        const deletedCount = result.changes || 0;

        // Audit log entry (best-effort, never block response)
        try {
            db.prepare(`
                INSERT INTO audit_log (user_id, action, details, ip, created_at)
                VALUES (?, 'OMEGA_CHAT_HISTORY_CLEARED', ?, ?, ?)
            `).run(userId, JSON.stringify({ deletedCount, ip: req.ip }), req.ip || null, Date.now());
        } catch (auditErr) {
            logger.warn('OMEGA', `[chat/history] audit_log write failed uid=${userId}: ${auditErr.message}`);
        }

        // Invalidate chatResponder cache for this user (best-effort)
        try {
            const chatResponder = require('../services/ml/_voice/chatResponder');
            if (typeof chatResponder._invalidateConvoHistory === 'function') {
                chatResponder._invalidateConvoHistory(userId);
            }
        } catch (invErr) { /* swallow — telemetry never blocks */ }

        _markCleared(userId);
        res.json({ ok: true, deletedCount });
    } catch (err) {
        logger.error('OMEGA', `[chat/history DELETE] error uid=${userId}: ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd /root/zeus-terminal && npx jest tests/unit/omegaRoutesChatHistory.test.js --forceExit`
Expected: PASS — 15/15 tests (9 GET + 6 DELETE).

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/routes/omega.js tests/unit/omegaRoutesChatHistory.test.js
git commit -m "[Sub-A omega chat] DELETE /api/omega/chat/history with rate-limit + audit

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: chatResponder lazy rehydration (TDD RED + GREEN)

**Files:**
- Modify: `server/services/ml/_voice/chatResponder.js`
- Create: `tests/unit/ml/chatResponderLoadHistory.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/ml/chatResponderLoadHistory.test.js`:

```js
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
        const [r1, r2, r3] = await Promise.all([
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
        expect(chatResponder._getConvoForTest(1)).toEqual([
            { role: 'user', content: 'q-user1' },
            { role: 'assistant', content: 'r-user1' },
        ]);
        expect(chatResponder._getConvoForTest(2)).toEqual([
            { role: 'user', content: 'q-user2' },
            { role: 'assistant', content: 'r-user2' },
        ]);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/chatResponderLoadHistory.test.js --forceExit`
Expected: FAIL — `_loadConvoHistory`, `_invalidateConvoHistory`, `_resetLoadedForTest`, `_getConvoForTest` undefined.

- [ ] **Step 3: Implement in chatResponder.js**

In `server/services/ml/_voice/chatResponder.js`, find the existing block:

```js
// [Day 30] In-memory conversation history per user — last N exchanges fed to
const _convoHistory = new Map(); // userId → Array<{role, content, ts}>
```

After this block, add:

```js
// [Sub-A 2026-05-19] Lazy DB rehydration for _convoHistory.
// Map<userId, Promise<void>> tracks load state — value is the in-flight or
// resolved Promise, used for dedup of concurrent calls. After resolution
// the Promise remains in the Map (signaling "already loaded for this user"),
// so subsequent calls return the cached Promise instantly without re-querying.
const _loadedForUser = new Map();

async function _loadConvoHistory(userId) {
    if (!userId) return;
    if (_loadedForUser.has(userId)) return _loadedForUser.get(userId);
    const p = (async () => {
        try {
            const { db } = require('../../database');
            const rows = db.prepare(`
                SELECT text, context_json
                FROM ml_voice_log
                WHERE user_id = ? AND utterance_type = 'CHAT_REPLY'
                ORDER BY created_at DESC
                LIMIT ?
            `).all(userId, CONVO_MAX_TURNS);
            // Reverse for chronological order, push into convo
            const arr = _convoHistory.get(userId) || [];
            for (const row of rows.reverse()) {
                let question = null;
                if (row.context_json) {
                    try {
                        const ctx = JSON.parse(row.context_json);
                        if (ctx && typeof ctx.question === 'string' && ctx.question.length > 0) {
                            question = ctx.question;
                        }
                    } catch (_) { /* skip malformed row entirely */ }
                }
                if (question == null) continue; // skip rows without recoverable user question
                arr.push({ role: 'user', content: question });
                arr.push({ role: 'assistant', content: row.text });
            }
            _convoHistory.set(userId, arr);
        } catch (err) {
            // DB unavailable — log + set empty array so next attempt may retry
            if (typeof logger !== 'undefined') {
                logger.warn('CHAT_RESP', `_loadConvoHistory uid=${userId} failed: ${err.message}`);
            }
            _convoHistory.set(userId, _convoHistory.get(userId) || []);
        }
    })();
    _loadedForUser.set(userId, p);
    return p;
}

function _invalidateConvoHistory(userId) {
    if (!userId) return;
    _convoHistory.delete(userId);
    _loadedForUser.delete(userId);
}
```

Then find the existing `respond` function entry point. Locate where it currently does setup. Add at the TOP of `respond` (after argument destructuring but before any other logic):

```js
async function respond({ userId, text }) {
    // [Sub-A 2026-05-19] Lazy DB rehydration on first chat per user post-restart
    await _loadConvoHistory(userId);

    // ... existing respond logic UNCHANGED below
```

If `respond` is the very top function, locate `_pushConvo(userId, 'user', text);` or similar near the start — the `_loadConvoHistory` call must come BEFORE any `_getConvo` or `_pushConvo` to ensure cache is populated.

Then update test helpers section near `module.exports`. Add:

```js
function _resetLoadedForTest(userId) {
    if (userId) _loadedForUser.delete(userId);
}
function _getConvoForTest(userId) {
    return (_convoHistory.get(userId) || []).slice();
}
```

Extend `module.exports`:

```js
module.exports = {
    respond,
    _loadConvoHistory,
    _invalidateConvoHistory,
    _resetConvoForTest,
    _resetLoadedForTest,
    _getConvoForTest,
    // ... existing exports preserved
};
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/chatResponderLoadHistory.test.js --forceExit`
Expected: PASS — 8/8 tests.

- [ ] **Step 5: Quick regression — existing chatResponder tests**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/chatResponder --forceExit`
Expected: All existing chatResponder tests still pass (lazy rehydration is additive).

- [ ] **Step 6: Commit**

```bash
cd /root/zeus-terminal && git add server/services/ml/_voice/chatResponder.js tests/unit/ml/chatResponderLoadHistory.test.js
git commit -m "[Sub-A omega chat] chatResponder lazy rehydration from ml_voice_log

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Zustand omegaChatStore (TDD RED + GREEN)

**Files:**
- Create: `client/src/stores/omegaChatStore.ts`
- Create: `client/src/stores/__tests__/omegaChatStore.test.ts`

- [ ] **Step 1: Write failing tests**

Create `client/src/stores/__tests__/omegaChatStore.test.ts`:

```ts
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { useOmegaChatStore } from '../omegaChatStore'

// Mock fetch globally
const _fetchMock = vi.fn()
;(globalThis as any).fetch = _fetchMock

beforeEach(() => {
    useOmegaChatStore.setState({
        history: [], loading: false, error: null, lastFetchTs: null, _loadInFlight: null,
    })
    _fetchMock.mockReset()
})

describe('omegaChatStore — initial state', () => {
    test('history is empty array, loading false, no error, no fetch ts', () => {
        const s = useOmegaChatStore.getState()
        expect(s.history).toEqual([])
        expect(s.loading).toBe(false)
        expect(s.error).toBe(null)
        expect(s.lastFetchTs).toBe(null)
    })
})

describe('omegaChatStore — loadHistory', () => {
    test('populates history on 200 response', async () => {
        _fetchMock.mockResolvedValueOnce({
            ok: true, status: 200,
            json: async () => ({ ok: true, history: [
                { role: 'you', text: 'salut', ts: 1000 },
                { role: 'omega', text: 'salut boss', mood: 'CALM', ts: 1001 },
            ], total: 1 }),
        })
        await useOmegaChatStore.getState().loadHistory()
        const s = useOmegaChatStore.getState()
        expect(s.history.length).toBe(2)
        expect(s.history[0].text).toBe('salut')
        expect(s.loading).toBe(false)
        expect(s.error).toBe(null)
        expect(s.lastFetchTs).toBeGreaterThan(0)
    })

    test('skips fetch if lastFetchTs is recent (< 60s)', async () => {
        useOmegaChatStore.setState({ lastFetchTs: Date.now() - 10_000 }) // 10s ago
        await useOmegaChatStore.getState().loadHistory()
        expect(_fetchMock).not.toHaveBeenCalled()
    })

    test('forces fetch if force=true even with recent lastFetchTs', async () => {
        useOmegaChatStore.setState({ lastFetchTs: Date.now() - 1000 })
        _fetchMock.mockResolvedValueOnce({
            ok: true, status: 200, json: async () => ({ ok: true, history: [], total: 0 }),
        })
        await useOmegaChatStore.getState().loadHistory(true)
        expect(_fetchMock).toHaveBeenCalledOnce()
    })

    test('concurrent loadHistory dedup via _loadInFlight Promise', async () => {
        let resolve: any
        _fetchMock.mockReturnValueOnce(new Promise((r) => { resolve = () => r({
            ok: true, status: 200, json: async () => ({ ok: true, history: [], total: 0 }),
        }) }))
        const p1 = useOmegaChatStore.getState().loadHistory()
        const p2 = useOmegaChatStore.getState().loadHistory()
        const p3 = useOmegaChatStore.getState().loadHistory()
        expect(_fetchMock).toHaveBeenCalledOnce()
        resolve!()
        await Promise.all([p1, p2, p3])
        expect(_fetchMock).toHaveBeenCalledOnce()
    })

    test('on error: stores error, loading=false, preserves existing history', async () => {
        useOmegaChatStore.setState({ history: [{ role: 'you', text: 'old', ts: 1 }] as any })
        _fetchMock.mockRejectedValueOnce(new Error('network down'))
        await useOmegaChatStore.getState().loadHistory(true)
        const s = useOmegaChatStore.getState()
        expect(s.error).toMatch(/network down/i)
        expect(s.loading).toBe(false)
        expect(s.history.length).toBe(1) // preserved
    })

    test('on non-OK 500 response: stores error, preserves history', async () => {
        _fetchMock.mockResolvedValueOnce({
            ok: false, status: 500, json: async () => ({ ok: false, error: 'db down' }),
        })
        await useOmegaChatStore.getState().loadHistory(true)
        const s = useOmegaChatStore.getState()
        expect(s.error).toMatch(/db down/)
    })
})

describe('omegaChatStore — pushChatRow', () => {
    test('appends a new ChatRow to history', () => {
        useOmegaChatStore.getState().pushChatRow({ role: 'you', text: 'hi', ts: 1 })
        const s = useOmegaChatStore.getState()
        expect(s.history).toEqual([{ role: 'you', text: 'hi', ts: 1 }])
    })

    test('does not mutate state in place (immutable update)', () => {
        const initial = useOmegaChatStore.getState().history
        useOmegaChatStore.getState().pushChatRow({ role: 'you', text: 'x', ts: 1 })
        expect(useOmegaChatStore.getState().history).not.toBe(initial)
    })
})

describe('omegaChatStore — clearLocal (DELETE flow)', () => {
    test('on 200: history empty, lastFetchTs updated, returns deletedCount', async () => {
        useOmegaChatStore.setState({ history: [{ role: 'you', text: 'x', ts: 1 }] as any })
        _fetchMock.mockResolvedValueOnce({
            ok: true, status: 200, json: async () => ({ ok: true, deletedCount: 5 }),
        })
        const result = await useOmegaChatStore.getState().clearLocal()
        expect(result.deletedCount).toBe(5)
        expect(useOmegaChatStore.getState().history).toEqual([])
    })

    test('on 429: history retained, error stored, deletedCount=0', async () => {
        useOmegaChatStore.setState({ history: [{ role: 'you', text: 'x', ts: 1 }] as any })
        _fetchMock.mockResolvedValueOnce({
            ok: false, status: 429, json: async () => ({ ok: false, error: 'Rate limit: wait 12s', remainingSec: 12 }),
        })
        const result = await useOmegaChatStore.getState().clearLocal()
        expect(result.deletedCount).toBe(0)
        expect(useOmegaChatStore.getState().history.length).toBe(1)
        expect(useOmegaChatStore.getState().error).toMatch(/rate limit/i)
    })

    test('on network error: history retained, error stored', async () => {
        useOmegaChatStore.setState({ history: [{ role: 'you', text: 'x', ts: 1 }] as any })
        _fetchMock.mockRejectedValueOnce(new Error('econnreset'))
        const result = await useOmegaChatStore.getState().clearLocal()
        expect(result.deletedCount).toBe(0)
        expect(useOmegaChatStore.getState().history.length).toBe(1)
        expect(useOmegaChatStore.getState().error).toMatch(/econnreset/i)
    })
})

describe('omegaChatStore — setError', () => {
    test('sets and clears error', () => {
        useOmegaChatStore.getState().setError('boom')
        expect(useOmegaChatStore.getState().error).toBe('boom')
        useOmegaChatStore.getState().setError(null)
        expect(useOmegaChatStore.getState().error).toBe(null)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal/client && npx vitest run src/stores/__tests__/omegaChatStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement store**

Create `client/src/stores/omegaChatStore.ts`:

```ts
/**
 * [Sub-A omega chat 2026-05-19] Zustand store for Omega chat history.
 * Shared state across TalkWithMe + Settings → automatic re-render sync
 * when Clear is invoked from one component, the other sees empty list.
 * Dedups concurrent loadHistory calls via _loadInFlight Promise field.
 */
import { create } from 'zustand'

export type Mood = 'CALM' | 'FOCUSED' | 'EXCITED' | 'NERVOUS' | 'ANGRY' | 'SAD' | 'BORED'

export interface ChatRow {
    role: 'you' | 'omega'
    text: string
    mood?: Mood
    ts: number
}

interface HistoryResponse {
    ok: boolean
    history?: ChatRow[]
    total?: number
    error?: string
}

interface DeleteResponse {
    ok: boolean
    deletedCount?: number
    error?: string
    remainingSec?: number
}

interface OmegaChatState {
    history: ChatRow[]
    loading: boolean
    error: string | null
    lastFetchTs: number | null
    _loadInFlight: Promise<void> | null
    loadHistory(force?: boolean): Promise<void>
    pushChatRow(row: ChatRow): void
    clearLocal(): Promise<{ deletedCount: number }>
    setError(err: string | null): void
}

const _CACHE_TTL_MS = 60_000 // dedup window for loadHistory

export const useOmegaChatStore = create<OmegaChatState>((set, get) => ({
    history: [],
    loading: false,
    error: null,
    lastFetchTs: null,
    _loadInFlight: null,

    loadHistory: async (force?: boolean) => {
        const { lastFetchTs, _loadInFlight } = get()
        if (_loadInFlight) return _loadInFlight
        if (!force && lastFetchTs != null && Date.now() - lastFetchTs < _CACHE_TTL_MS) return

        const p = (async () => {
            set({ loading: true, error: null })
            try {
                const res = await fetch('/api/omega/chat/history?limit=50', { credentials: 'include' })
                const data = (await res.json()) as HistoryResponse
                if (!res.ok || !data.ok) {
                    const errMsg = data.error || `HTTP ${res.status}`
                    set({ loading: false, error: errMsg, _loadInFlight: null })
                    return
                }
                set({
                    history: data.history || [],
                    loading: false,
                    error: null,
                    lastFetchTs: Date.now(),
                    _loadInFlight: null,
                })
            } catch (err: any) {
                set({
                    loading: false,
                    error: err && err.message ? err.message : String(err),
                    _loadInFlight: null,
                })
            }
        })()
        set({ _loadInFlight: p })
        return p
    },

    pushChatRow: (row: ChatRow) => {
        set((s) => ({ history: [...s.history, row] }))
    },

    clearLocal: async () => {
        try {
            const res = await fetch('/api/omega/chat/history', {
                method: 'DELETE',
                credentials: 'include',
            })
            const data = (await res.json()) as DeleteResponse
            if (!res.ok || !data.ok) {
                set({ error: data.error || `HTTP ${res.status}` })
                return { deletedCount: 0 }
            }
            set({
                history: [],
                lastFetchTs: Date.now(),
                error: null,
            })
            return { deletedCount: data.deletedCount || 0 }
        } catch (err: any) {
            set({ error: err && err.message ? err.message : String(err) })
            return { deletedCount: 0 }
        }
    },

    setError: (err: string | null) => set({ error: err }),
}))
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd /root/zeus-terminal/client && npx vitest run src/stores/__tests__/omegaChatStore.test.ts`
Expected: PASS — 13/13 tests.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add client/src/stores/omegaChatStore.ts client/src/stores/__tests__/omegaChatStore.test.ts
git commit -m "[Sub-A omega chat] Zustand omegaChatStore for cross-component sync

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: TalkWithMe consumes Zustand store

**Files:**
- Modify: `client/src/components/omega/TalkWithMe.tsx`

- [ ] **Step 1: Read current state to understand the change scope**

Run: `grep -n "useState\|history\|setHistory\|useEffect" /root/zeus-terminal/client/src/components/omega/TalkWithMe.tsx | head -20`

Look at lines ~29-50 where `history` state + initial empty array + useEffect are defined.

- [ ] **Step 2: Add store import + replace local history state with store**

At top of file (after existing imports), add:

```ts
import { useOmegaChatStore } from '../../stores/omegaChatStore'
```

Find the line:
```ts
const [history, setHistory] = useState<ChatRow[]>([])
```

Replace with:
```ts
// [Sub-A 2026-05-19] consume Zustand store instead of local state — enables
// cross-component sync with Settings Clear button + persistence on refresh
const history = useOmegaChatStore((s) => s.history)
const loadHistory = useOmegaChatStore((s) => s.loadHistory)
const pushChatRow = useOmegaChatStore((s) => s.pushChatRow)
```

Now replace every `setHistory(...)` call with the appropriate store method. Look for these patterns:

Pattern A — `setHistory((h) => [...h, newRow])` becomes `pushChatRow(newRow)`.
Pattern B — `setHistory([])` becomes (do nothing — store handles via clearLocal).

Find each `setHistory` call and update accordingly. If a pattern doesn't fit the two above, fall back to `useOmegaChatStore.setState({ history: ... })` for direct mutation.

- [ ] **Step 3: Add useEffect to load history on mount**

Find the existing `useEffect` block (around lines 38-44). Before or after it (preserve order if it depends on something), add:

```tsx
// [Sub-A 2026-05-19] Load chat history from DB on mount
useEffect(() => {
    void loadHistory()
}, [loadHistory])
```

- [ ] **Step 4: Run client build to catch type errors**

Run: `cd /root/zeus-terminal/client && npm run build 2>&1 | tail -5`
Expected: `✓ built` with no TypeScript errors. If errors, fix types (likely `ChatRow` shape difference between local and store — should match).

- [ ] **Step 5: Manual smoke (just module load)**

Run: `cd /root/zeus-terminal && node -e "console.log('client build artifact exists:', require('fs').existsSync('./public/app/assets/index-' + require('fs').readdirSync('./public/app/assets').find(f => f.startsWith('index-')).split('-')[1]));"`
Should print `client build artifact exists: true`.

- [ ] **Step 6: Commit**

```bash
cd /root/zeus-terminal && git add client/src/components/omega/TalkWithMe.tsx
git commit -m "[Sub-A omega chat] TalkWithMe consumes omegaChatStore + loadHistory on mount

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Settings OmegaMemorySection + Omega tab

**Files:**
- Create: `client/src/components/settings/OmegaMemorySection.tsx`
- Modify: `client/src/components/settings/SettingsModal.tsx`
- Modify: `client/src/app.css`

- [ ] **Step 1: Read SettingsModal tab structure**

Run: `grep -n "tab\|Tab\|setTab" /root/zeus-terminal/client/src/components/settings/SettingsModal.tsx | head -15`

Identify the `Tab` type (`'general' | 'trading' | 'account'`), the tabs button rendering, and the tab content conditional rendering.

- [ ] **Step 2: Create OmegaMemorySection component**

Create `client/src/components/settings/OmegaMemorySection.tsx`:

```tsx
/**
 * [Sub-A omega chat 2026-05-19] Settings section for Omega chat persistence
 * controls. Currently only "Clear chat history" button (nuclear wipe per-user
 * + audit log). Future Sub-B/C will add user profile + memory facts here.
 */
import { useState } from 'react'
import { useOmegaChatStore } from '../../stores/omegaChatStore'
import { toast } from '../../data/marketDataHelpers'

export function OmegaMemorySection() {
    const [confirming, setConfirming] = useState(false)
    const [clearing, setClearing] = useState(false)
    const clearLocal = useOmegaChatStore((s) => s.clearLocal)
    const error = useOmegaChatStore((s) => s.error)
    const historyCount = useOmegaChatStore((s) => s.history.length)

    const handleClear = async () => {
        setClearing(true)
        try {
            const { deletedCount } = await clearLocal()
            if (deletedCount > 0) {
                toast(`Cleared ${deletedCount} chat messages`, 3000)
            } else if (error) {
                toast(`Could not clear: ${error}`, 4000)
            } else {
                toast('Nothing to clear', 2000)
            }
        } finally {
            setClearing(false)
            setConfirming(false)
        }
    }

    return (
        <div className="zr-settings-subsection">
            <h4>Omega chat memory</h4>
            <p className="zr-settings-desc">
                Omega keeps a per-user conversation history persisted in the database.
                History survives browser refresh and server restart. The button below
                permanently deletes your conversation history (your messages and Omega's
                replies). Brain narration thoughts and critical alerts are preserved.
            </p>
            <p className="zr-settings-meta">
                Currently loaded in this session: <strong>{historyCount}</strong> messages
            </p>
            {!confirming ? (
                <button className="zr-btn zr-btn-danger" onClick={() => setConfirming(true)}>
                    Clear chat history
                </button>
            ) : (
                <div className="zr-confirm-block">
                    <p>Are you sure? This cannot be undone.</p>
                    <button className="zr-btn zr-btn-danger" onClick={handleClear} disabled={clearing}>
                        {clearing ? 'Clearing…' : 'Yes, clear it'}
                    </button>
                    <button className="zr-btn" onClick={() => setConfirming(false)} disabled={clearing}>
                        Cancel
                    </button>
                </div>
            )}
        </div>
    )
}
```

- [ ] **Step 3: Add Omega tab to SettingsModal**

Find the `Tab` type definition:
```ts
type Tab = 'general' | 'trading' | 'account'
```
Change to:
```ts
type Tab = 'general' | 'trading' | 'account' | 'omega'
```

Find the tabs array rendering (likely something like `const TABS = ['general', 'trading', 'account']` or inline). Add `'omega'` to the list. Display label = `'Omega'`.

Find the tab content conditional renders (`{tab === 'account' && (...)}` etc.) and add:

```tsx
{tab === 'omega' && (
    <div className="zr-settings-section">
        <OmegaMemorySection />
    </div>
)}
```

At top of file, add import:
```ts
import { OmegaMemorySection } from './OmegaMemorySection'
```

- [ ] **Step 4: Add CSS for orphan chat row + settings danger button**

In `client/src/app.css`, append at end:

```css
/* [Sub-A omega chat 2026-05-19] Orphan user bubble — rows from DB with
 * missing/malformed context_json.question. Visually softer than normal. */
.omega-chat-row.omega-chat-you .omega-chat-bubble.omega-chat-orphan,
.omega-chat-orphan {
    opacity: 0.6;
    font-style: italic;
}

/* [Sub-A omega chat] Settings Omega section danger button + confirm block */
.zr-btn-danger {
    background: rgba(255, 60, 60, 0.15);
    border-color: rgba(255, 60, 60, 0.5);
    color: #ff8080;
}
.zr-btn-danger:hover:not(:disabled) {
    background: rgba(255, 60, 60, 0.25);
}
.zr-confirm-block {
    border: 1px solid rgba(255, 60, 60, 0.4);
    background: rgba(255, 60, 60, 0.05);
    border-radius: 6px;
    padding: 10px;
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.zr-settings-subsection h4 {
    margin: 0 0 6px;
    font-family: 'Orbitron', sans-serif;
    font-size: 13px;
    letter-spacing: 0.06em;
}
.zr-settings-desc, .zr-settings-meta {
    font-size: 11px;
    color: var(--text-dim, #888);
    margin: 4px 0;
}
```

- [ ] **Step 5: Apply orphan styling in TalkWithMe**

In `TalkWithMe.tsx`, find the line where chat bubbles are rendered:

```tsx
<div className={`omega-chat-bubble`}>
```

Update to add orphan class when text === '(?)':

```tsx
<div className={`omega-chat-bubble${row.role === 'you' && row.text === '(?)' ? ' omega-chat-orphan' : ''}`}>
```

- [ ] **Step 6: Build client + verify**

Run: `cd /root/zeus-terminal/client && npm run build 2>&1 | tail -5`
Expected: `✓ built` no TS errors.

- [ ] **Step 7: Commit**

```bash
cd /root/zeus-terminal && git add client/src/components/settings/OmegaMemorySection.tsx client/src/components/settings/SettingsModal.tsx client/src/components/omega/TalkWithMe.tsx client/src/app.css
git commit -m "[Sub-A omega chat] Settings Omega tab + Clear button + orphan bubble styling

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Full regression + bump + deploy + smoke

**Files:** `server/version.js` (modify) + verification

- [ ] **Step 1: Full jest regression**

Run: `cd /root/zeus-terminal && npx jest --forceExit 2>&1 | tail -10`
Expected: 7180+ tests PASS (~7155 baseline + ~25 new from Tasks 1+2+3). Existing tests untouched.

- [ ] **Step 2: Full vitest regression**

Run: `cd /root/zeus-terminal/client && npx vitest run 2>&1 | tail -10`
Expected: all client tests pass (~13 new from Task 4 + existing).

- [ ] **Step 3: Build client**

Run: `cd /root/zeus-terminal/client && npm run build 2>&1 | tail -3`
Expected: `✓ built`, new bundle hash.

- [ ] **Step 4: Bump version**

Edit `server/version.js`. Change `version: '1.7.95'` → `version: '1.7.96'`, `build: 121` → `build: 122`. Prepend changelog entry:

```js
'b122 v1.7.96 — OMEGA CHAT PERSISTENCE Sub-A foundation 2026-05-19. Chat history now survives browser refresh + PM2 reload. GET /api/omega/chat/history per-user paginated read (limit 50 messages = 25 exchanges, cap 100). DELETE /api/omega/chat/history nuclear wipe per-user with rate limit 1/15s + audit_log entry. chatResponder._loadConvoHistory lazy rehydration on first chat post-restart, populates _convoHistory Map from DB (last 10 turns = 20 messages for LLM context). NEW client/src/stores/omegaChatStore.ts (Zustand) — shared history state between TalkWithMe + Settings, dedup concurrent fetches via _loadInFlight Promise, cache TTL 60s. TalkWithMe consumes store; Settings Omega tab adds OmegaMemorySection with Clear button + confirm dialog. Row expansion edge cases: NULL/missing/malformed context_json renders user bubble as "(?)" placeholder with orphan CSS styling (opacity 0.6 italic) — preserves chronology + visible marker, never skips rows. Per-user isolation enforced via _requireUser middleware. Phase 2 fusion math UNTOUCHED. ARCH-3 unaffected. ~25 new jest tests + 13 new vitest tests, full regression clean. Sub-Project A of 3 (foundation); Sub-B (user profile name + style) and Sub-C (long-term memory + auto fact extraction) follow as separate specs/plans. Spec: docs/superpowers/specs/2026-05-19-omega-chat-persistence-design.md.',
```

- [ ] **Step 5: Commit version bump**

```bash
cd /root/zeus-terminal && git add server/version.js
git commit -m "[Sub-A omega chat] bump v1.7.96 b122 — chat persistence foundation

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 6: Tag + PM2 reload**

```bash
cd /root/zeus-terminal && git tag post-v2/OMEGA-CHAT-SUB-A-122 HEAD
pm2 reload zeus
sleep 5
```

- [ ] **Step 7: Smoke test endpoint**

```bash
curl -s -b "zeus_token=<your-token>" http://127.0.0.1:3000/api/omega/chat/history?limit=10 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('=== Post-Sub-A smoke ===')
print('history items:', len(d.get('history', [])))
print('total exchanges:', d.get('total'))
if d.get('history'):
    print('first 2 entries:', json.dumps(d['history'][:2], indent=2))
"
```

Expected: returns history with chronological ChatRow array, total >= 0.

- [ ] **Step 8: Manual browser smoke** (operator visible verification)

1. Open Zeus → hard refresh (Ctrl+Shift+R) → bundle nou loaded
2. Open TalkWithMe → verify past chat history visible
3. Send new message → response → close TalkWithMe → reopen → both visible
4. Hard refresh entire page → TalkWithMe → history still there
5. PM2 reload (separate terminal: `pm2 reload zeus`) → refresh browser → history still there + new message picks up brain context from earlier conversation
6. Settings → Omega tab → see message count → click "Clear chat history" → confirm → toast "Cleared X messages" → TalkWithMe shows empty list
7. Try Clear again immediately → toast "Rate limit: wait Xs"

- [ ] **Step 9: Push branch + tag**

```bash
cd /root/zeus-terminal && git push origin omega/wave-1-foundation
git push origin post-v2/OMEGA-CHAT-SUB-A-122
```

---

# Self-Review Checklist

**1. Spec coverage:**
- ✅ GET /api/omega/chat/history per-user paginated → Task 1
- ✅ Row expansion edge cases (NULL/missing/malformed/empty `context_json.question`) → Task 1 (5 test cases + impl)
- ✅ DELETE /api/omega/chat/history with audit log + rate limit → Task 2
- ✅ Rate limit 1/15s per user → Task 2 (impl + test)
- ✅ Preserve THOUGHT and CRITICAL_ALERT on DELETE → Task 2 (impl uses utterance_type IN list; test verifies)
- ✅ chatResponder._loadConvoHistory lazy rehydration → Task 3
- ✅ _invalidateConvoHistory called from DELETE route → Task 2 (DELETE wires invalidation) + Task 3 (impl)
- ✅ Zustand omegaChatStore — actions loadHistory + pushChatRow + clearLocal + setError → Task 4
- ✅ Concurrent loadHistory dedup via _loadInFlight Promise → Task 4 (impl + test)
- ✅ Cache TTL 60s for loadHistory dedup → Task 4 (impl + test)
- ✅ TalkWithMe consumes store → Task 5
- ✅ Settings Omega tab + OmegaMemorySection with Clear button + confirm → Task 6
- ✅ Orphan bubble CSS styling for "(?)" placeholder → Task 6
- ✅ Bump + tag + deploy + smoke → Task 7

**2. Placeholders:** None — every step has concrete code, exact file paths, exact commands.

**3. Type consistency:**
- `ChatRow = { role: 'you' | 'omega', text: string, mood?: Mood, ts: number }` consistent in Tasks 1, 4, 5, 6
- `Mood` type union consistent (7 values from existing schema)
- `loadHistory(force?: boolean)` signature consistent Tasks 4, 5
- `clearLocal(): Promise<{deletedCount: number}>` consistent Tasks 4, 6
- `_loadConvoHistory(userId)` returns Promise<void>, idempotent — consistent Task 3
- `_invalidateConvoHistory(userId)` called from Task 2 DELETE flow, implemented in Task 3 — types match

**4. ARCH-3 preserved:** All DB queries filter `WHERE user_id = ?`. No cross-user state. _requireUser middleware on all routes. Zustand store is per-browser-session (not cross-user).

**5. Phase 2 fusion math UNTOUCHED:** No changes to brain decisions, AT, or trading logic. Pure read/write on `ml_voice_log` + Settings UI extension.

**6. Risk assessment:**
- **Low risk overall** — additive, no schema changes
- **Medium risk:** Task 5 TalkWithMe refactor from local state to Zustand. Risk: forgot to remove `setHistory` call somewhere. Mitigation: client build catches type mismatch; manual smoke verifies UI works.
- **Defensive on row edge cases** — 5 dedicated test cases for `context_json` parsing failures.
- **Rate limit reset on process restart is acceptable** — in-memory Map; next process unblocks naturally. NOT exploitable for spam because user must wait for restart anyway (no operator advantage).
