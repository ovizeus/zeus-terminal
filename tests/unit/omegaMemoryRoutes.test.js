'use strict';

/**
 * omegaMemoryRoutes.test.js — Sub-C.1 Task 7
 *
 * 18 tests covering:
 *   GET  /api/omega/memory          (5 tests)
 *   DELETE /api/omega/memory/:id    (8 tests)
 *   GET  /api/omega/memory/health   (5 tests)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-mem-routes-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { db } = require('../../server/services/database');
const omegaRoutes = require('../../server/routes/omega');

// ─── App factory ─────────────────────────────────────────────────────────────

function _makeApp(userId) {
    const app = express();
    app.use(cookieParser());
    app.use(express.json());
    // Inject authenticated user (mirrors Sub-A pattern)
    app.use((req, res, next) => { req.user = { id: userId }; next(); });
    app.use('/api/omega', omegaRoutes);
    return app;
}

/** App with NO user injected (simulates unauthenticated request) */
function _makeUnauthedApp() {
    const app = express();
    app.use(cookieParser());
    app.use(express.json());
    // No req.user injection → _requireUser returns null → 401
    app.use('/api/omega', omegaRoutes);
    return app;
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

/**
 * Insert a live (non-tombstoned) ml_chat_memory row.
 * Returns the inserted row's id.
 */
function _seedFact(userId, {
    klass = 'identity',
    factKey = 'test_key',
    factValue = 'test_value',
    importance = 0.8,
    env = 'DEMO',
    tombstone = false,
    reaffirmCount = 0,
    createdSrcChatId = null,
    lastSrcChatId = null,
} = {}) {
    const now = Date.now();
    const result = db.prepare(`
        INSERT INTO ml_chat_memory
            (user_id, class, fact_key, fact_value, importance, reaffirm_count,
             created_source_chat_id, last_source_chat_id,
             created_at, last_seen_at, updated_at, env, tombstone_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        userId, klass, factKey, factValue, importance, reaffirmCount,
        createdSrcChatId, lastSrcChatId,
        now, now, now, env,
        tombstone ? now : null
    );
    return result.lastInsertRowid;
}

/** Ensure audit_log table exists and is clean before relevant tests */
function _setupAuditLog() {
    db.prepare(`CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER, action TEXT, details TEXT, ip TEXT, created_at INTEGER
    )`).run();
    db.prepare('DELETE FROM audit_log').run();
}

/** Ensure ml_chat_memory_meta table exists */
function _setupMeta() {
    db.prepare(`CREATE TABLE IF NOT EXISTS ml_chat_memory_meta (
        user_id INTEGER PRIMARY KEY,
        last_modified_at INTEGER NOT NULL DEFAULT 0
    )`).run();
}

// ─── Reset between tests ──────────────────────────────────────────────────────

beforeEach(() => {
    // Clear rate-limit state between tests
    try {
        const m = require('../../server/routes/omega');
        if (typeof m._resetDeleteMemoryRateLimitForTest === 'function') {
            m._resetDeleteMemoryRateLimitForTest();
        }
        if (typeof m._resetRateLimitForTest === 'function') {
            m._resetRateLimitForTest();
        }
    } catch (_) { /* not exposed yet */ }

    db.prepare('DELETE FROM ml_chat_memory').run();
    _setupAuditLog();
    _setupMeta();
    db.prepare('DELETE FROM ml_chat_memory_meta').run();
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/omega/memory — 5 tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/omega/memory', () => {
    test('1. returns 401 without JWT cookie (no req.user)', async () => {
        const res = await request(_makeUnauthedApp()).get('/api/omega/memory');
        expect(res.status).toBe(401);
    });

    test('2. returns only authenticated user\'s facts (no cross-user leak)', async () => {
        _seedFact(1, { klass: 'identity', factKey: 'name', factValue: 'Alice' });
        _seedFact(2, { klass: 'identity', factKey: 'name', factValue: 'Bob' });

        const res1 = await request(_makeApp(1)).get('/api/omega/memory');
        expect(res1.status).toBe(200);
        expect(res1.body.facts.length).toBe(1);
        expect(res1.body.facts[0].fact_value).toBe('Alice');

        const res2 = await request(_makeApp(2)).get('/api/omega/memory');
        expect(res2.status).toBe(200);
        expect(res2.body.facts.length).toBe(1);
        expect(res2.body.facts[0].fact_value).toBe('Bob');
    });

    test('3. returns facts grouped by class (groupedByClass structure)', async () => {
        _seedFact(1, { klass: 'identity', factKey: 'name', factValue: 'Alice' });
        _seedFact(1, { klass: 'style', factKey: 'tone', factValue: 'casual' });
        _seedFact(1, { klass: 'style', factKey: 'format', factValue: 'brief' });

        const res = await request(_makeApp(1)).get('/api/omega/memory');
        expect(res.status).toBe(200);

        const { groupedByClass } = res.body;
        expect(groupedByClass).toHaveProperty('identity');
        expect(groupedByClass).toHaveProperty('style');
        expect(groupedByClass.identity.length).toBe(1);
        expect(groupedByClass.style.length).toBe(2);
    });

    test('4. excludes tombstoned facts', async () => {
        _seedFact(1, { klass: 'identity', factKey: 'name', factValue: 'Alice', tombstone: false });
        _seedFact(1, { klass: 'identity', factKey: 'role', factValue: 'trader', tombstone: true });

        const res = await request(_makeApp(1)).get('/api/omega/memory');
        expect(res.status).toBe(200);
        expect(res.body.facts.length).toBe(1);
        expect(res.body.facts[0].fact_key).toBe('name');
    });

    test('5. includes Fix 3 cols: reaffirm_count, created_source_chat_id, last_source_chat_id', async () => {
        _seedFact(1, {
            klass: 'identity',
            factKey: 'name',
            factValue: 'Alice',
            reaffirmCount: 3,
            createdSrcChatId: 42,
            lastSrcChatId: 99,
        });

        const res = await request(_makeApp(1)).get('/api/omega/memory');
        expect(res.status).toBe(200);
        expect(res.body.facts.length).toBe(1);
        const fact = res.body.facts[0];
        expect(fact).toHaveProperty('reaffirm_count', 3);
        expect(fact).toHaveProperty('created_source_chat_id', 42);
        expect(fact).toHaveProperty('last_source_chat_id', 99);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE /api/omega/memory/:id — 8 tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('DELETE /api/omega/memory/:id', () => {
    test('6. returns 401 without JWT cookie (no req.user)', async () => {
        const res = await request(_makeUnauthedApp()).delete('/api/omega/memory/1');
        expect(res.status).toBe(401);
    });

    test('7. tombstones fact (NOT hard delete — row still exists with tombstone_at set)', async () => {
        const factId = _seedFact(1, { klass: 'identity', factKey: 'name', factValue: 'Alice' });

        const res = await request(_makeApp(1)).delete(`/api/omega/memory/${factId}`);
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);

        // Row must still exist
        const row = db.prepare('SELECT * FROM ml_chat_memory WHERE id=?').get(factId);
        expect(row).toBeDefined();
        expect(row.tombstone_at).not.toBeNull();
        expect(typeof row.tombstone_at).toBe('number');
        expect(row.tombstone_at).toBeGreaterThan(0);
    });

    test('8. cross-user fact returns 404', async () => {
        // Fact owned by user 2
        const factId = _seedFact(2, { klass: 'identity', factKey: 'name', factValue: 'Bob' });

        // User 1 tries to delete it
        const res = await request(_makeApp(1)).delete(`/api/omega/memory/${factId}`);
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('not_found');
    });

    test('9. idempotent — second call returns {ok: true, alreadyTombstoned: true}', async () => {
        const factId = _seedFact(1, { klass: 'style', factKey: 'tone', factValue: 'casual' });

        const r1 = await request(_makeApp(1)).delete(`/api/omega/memory/${factId}`);
        expect(r1.status).toBe(200);
        expect(r1.body.ok).toBe(true);

        const r2 = await request(_makeApp(1)).delete(`/api/omega/memory/${factId}`);
        expect(r2.status).toBe(200);
        expect(r2.body.ok).toBe(true);
        expect(r2.body.alreadyTombstoned).toBe(true);
    });

    test('10. updates ml_chat_memory_meta.last_modified_at', async () => {
        // Pre-condition: no meta row exists for user 1
        const factId = _seedFact(1, { klass: 'identity', factKey: 'name', factValue: 'Alice' });
        const before = Date.now();

        const res = await request(_makeApp(1)).delete(`/api/omega/memory/${factId}`);
        expect(res.status).toBe(200);

        const meta = db.prepare('SELECT last_modified_at FROM ml_chat_memory_meta WHERE user_id=1').get();
        expect(meta).toBeDefined();
        expect(meta.last_modified_at).toBeGreaterThanOrEqual(before);
    });

    test('11. creates audit_log entry without fact_key or fact_value', async () => {
        const factId = _seedFact(1, { klass: 'identity', factKey: 'name', factValue: 'SecretName' });

        await request(_makeApp(1)).delete(`/api/omega/memory/${factId}`);

        const entries = db.prepare(`
            SELECT * FROM audit_log WHERE action = 'OMEGA_MEMORY_FACT_FORGOTTEN' AND user_id = 1
        `).all();
        expect(entries.length).toBe(1);

        // Audit invariant: details must NOT contain fact_key or fact_value
        const details = JSON.parse(entries[0].details);
        expect(details).not.toHaveProperty('fact_key');
        expect(details).not.toHaveProperty('fact_value');
        // But should have class and reason
        expect(details).toHaveProperty('class');
    });

    test('12. rate limit: 6th request in 15s returns 429', async () => {
        // Seed 6 separate facts to allow 5 successful deletes
        const ids = [];
        for (let i = 0; i < 6; i++) {
            ids.push(_seedFact(1, { klass: 'style', factKey: `key_${i}`, factValue: `val_${i}` }));
        }

        // First 5 should succeed
        for (let i = 0; i < 5; i++) {
            const r = await request(_makeApp(1)).delete(`/api/omega/memory/${ids[i]}`);
            expect(r.status).toBe(200);
        }

        // 6th should be rate-limited
        const r6 = await request(_makeApp(1)).delete(`/api/omega/memory/${ids[5]}`);
        expect(r6.status).toBe(429);
        expect(r6.body.error).toBe('rate_limit');
    });

    test('13. invalid id (non-numeric) returns 400', async () => {
        const res = await request(_makeApp(1)).delete('/api/omega/memory/not-a-number');
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('invalid_id');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/omega/memory/health — 5 tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/omega/memory/health', () => {
    test('14. returns 401 without JWT cookie (no req.user)', async () => {
        const res = await request(_makeUnauthedApp()).get('/api/omega/memory/health');
        expect(res.status).toBe(401);
    });

    test('15. returns required JSON shape (all 8 fields)', async () => {
        const res = await request(_makeApp(1)).get('/api/omega/memory/health');
        expect(res.status).toBe(200);

        const REQUIRED_FIELDS = [
            'status',
            'last_success_at',
            'last_attempt_at',
            'failure_rate_last_hour',
            'pending_count',
            'failed_transient_count_last_hour',
            'failed_permanent_count_last_24h',
            'total_attempts_last_hour',
        ];
        for (const field of REQUIRED_FIELDS) {
            expect(res.body).toHaveProperty(field);
        }
    });

    test('16. returns "idle" status when no attempts ever', async () => {
        // Clean DB — no ml_voice_log rows for this user
        const res = await request(_makeApp(1)).get('/api/omega/memory/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('idle');
    });

    test('17. returns "healthy" when low failure rate and low pending', async () => {
        // Simulate: 1 successful extraction (done), done recently (within 30 min)
        const now = Date.now();
        db.prepare(`
            INSERT INTO ml_voice_log (user_id, utterance_type, mood, text, context_json, created_at, extraction_status, last_attempt_at)
            VALUES (?, 'CHAT_REPLY', 'CALM', 'q', '{}', ?, 'done', ?)
        `).run(1, now, now);

        const res = await request(_makeApp(1)).get('/api/omega/memory/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('healthy');
        expect(res.body.failure_rate_last_hour).toBe(0);
    });

    test('18. returns "down" when failure rate > 50%', async () => {
        // Simulate: 6 failed_transient + 1 done → rate = 6/7 > 0.5 → down
        const now = Date.now();
        for (let i = 0; i < 6; i++) {
            db.prepare(`
                INSERT INTO ml_voice_log (user_id, utterance_type, mood, text, context_json, created_at, extraction_status, last_attempt_at)
                VALUES (?, 'CHAT_REPLY', 'CALM', 'q', '{}', ?, 'failed_transient', ?)
            `).run(1, now - i * 100, now - i * 100);
        }
        // 1 success
        db.prepare(`
            INSERT INTO ml_voice_log (user_id, utterance_type, mood, text, context_json, created_at, extraction_status, last_attempt_at)
            VALUES (?, 'CHAT_REPLY', 'CALM', 'q', '{}', ?, 'done', ?)
        `).run(1, now, now);

        const res = await request(_makeApp(1)).get('/api/omega/memory/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('down');
        expect(res.body.failure_rate_last_hour).toBeGreaterThan(0.5);
    });
});
