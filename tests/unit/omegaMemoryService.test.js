'use strict';

/**
 * omegaMemoryService.test.js — 10 TDD tests for Sub-C.1 Task 4
 *
 * Tests cover the extract() path:
 *   1.  Happy path: 3 facts upserted + 3 audit CREATED
 *   2.  Post-LLM regex reject: 1 fact passes, 1 rejected (private key value)
 *   3.  Malformed JSON: failed_permanent, attempts=1, no retry
 *   4.  Empty extraction: done, 0 facts
 *   5.  LLM 429: failed_transient, next_retry_at ≈ now+5min, attempts=1
 *   6.  LLM timeout: failed_transient
 *   7.  Network ECONNRESET: failed_transient
 *   8.  LLM 400: failed_permanent, no retry
 *   9.  Schema not array: failed_permanent
 *   10. Backoff schedule progression: 5min/30min/2h/12h/null via _internals._calcBackoff
 *   11. (bonus) Max attempts: attempts=4 + LLM 429 → attempts=5, failed_permanent
 */

const Database = require('better-sqlite3');

const TEST_USER = 1;

const SCHEMA_SQL = `
  CREATE TABLE ml_voice_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    text TEXT,
    context_json TEXT,
    created_at INTEGER NOT NULL,
    extraction_status TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at INTEGER,
    next_retry_at INTEGER
  );
  CREATE TABLE ml_chat_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    env TEXT,
    class TEXT NOT NULL CHECK(class IN ('identity','personal_context','trading_strategy','temporary','style')),
    fact_key TEXT NOT NULL,
    fact_value TEXT NOT NULL,
    importance REAL NOT NULL DEFAULT 0.5,
    created_source_chat_id INTEGER,
    last_source_chat_id INTEGER,
    reaffirm_count INTEGER NOT NULL DEFAULT 1,
    decay_at INTEGER,
    last_seen_at INTEGER NOT NULL,
    tombstone_at INTEGER,
    forgotten_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(user_id, class, fact_key, env)
  );
  CREATE TABLE ml_chat_memory_meta (
    user_id INTEGER PRIMARY KEY,
    last_modified_at INTEGER NOT NULL
  );
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT,
    details TEXT,
    ip TEXT,
    created_at INTEGER
  );
`;

let db;
let omegaMemoryService;
let _internals;
let mockChatLLM;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA_SQL);

  jest.resetModules();

  // Insert meta row so UPDATE doesn't silently fail
  db.prepare('INSERT INTO ml_chat_memory_meta (user_id, last_modified_at) VALUES (?, ?)').run(TEST_USER, Date.now());

  mockChatLLM = jest.fn();

  jest.doMock('../../server/services/database', () => ({ db, get: () => db }));
  jest.doMock('../../server/services/ml/_voice/llmClient', () => ({
    chat: mockChatLLM,
    available: () => true,
  }));

  const mod = require('../../server/services/ml/_voice/omegaMemoryService');
  omegaMemoryService = mod.omegaMemoryService;
  _internals = mod._internals;
});

afterEach(() => {
  db.close();
  jest.dontMock('../../server/services/database');
  jest.dontMock('../../server/services/ml/_voice/llmClient');
  jest.resetModules();
});

// Helper: insert a voice log entry
function insertLog(overrides = {}) {
  const row = {
    user_id: TEST_USER,
    text: 'test',
    created_at: Date.now(),
    extraction_status: 'pending',
    attempts: 0,
    last_attempt_at: null,
    next_retry_at: null,
    ...overrides,
  };
  const stmt = db.prepare(
    'INSERT INTO ml_voice_log (user_id, text, created_at, extraction_status, attempts, last_attempt_at, next_retry_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const result = stmt.run(row.user_id, row.text, row.created_at, row.extraction_status, row.attempts, row.last_attempt_at, row.next_retry_at);
  return result.lastInsertRowid;
}

// ─────────────────────────────────────────────────────────────────────────────

test('T1: happy path — LLM returns 3 valid facts, all upserted + 3 CREATED audits', async () => {
  const voiceLogId = insertLog();

  mockChatLLM.mockResolvedValueOnce({
    ok: true,
    text: JSON.stringify([
      { class: 'identity', key: 'name', value: 'Alice', importance: 0.95 },
      { class: 'personal_context', key: 'location', value: 'Bucharest', importance: 0.7 },
      { class: 'style', key: 'tone', value: 'casual', importance: 0.6 },
    ]),
  });

  await omegaMemoryService.extract({
    voiceLogId,
    userId: TEST_USER,
    env: 'production',
    question: 'What is your name?',
    reply: 'My name is Alice, I live in Bucharest.',
  });

  const facts = db.prepare('SELECT * FROM ml_chat_memory WHERE user_id = ?').all(TEST_USER);
  expect(facts).toHaveLength(3);

  const audits = db.prepare("SELECT * FROM audit_log WHERE user_id = ? AND action = 'OMEGA_MEMORY_FACT_CREATED'").all(TEST_USER);
  expect(audits).toHaveLength(3);

  // Verify audit details never contain fact_key or fact_value
  for (const audit of audits) {
    const details = JSON.parse(audit.details);
    expect(details).not.toHaveProperty('fact_key');
    expect(details).not.toHaveProperty('fact_value');
    expect(details).toHaveProperty('class');
    expect(details).toHaveProperty('msg_id');
  }

  const log = db.prepare('SELECT * FROM ml_voice_log WHERE id = ?').get(voiceLogId);
  expect(log.extraction_status).toBe('done');
});

test('T2: post-LLM regex reject — fact with hex private key value is rejected, clean fact upserted', async () => {
  const voiceLogId = insertLog();

  // A 64-char hex (private key) near 'private' keyword — should be redacted/rejected post-LLM
  const hexPrivKey = 'a'.repeat(64);

  mockChatLLM.mockResolvedValueOnce({
    ok: true,
    text: JSON.stringify([
      { class: 'personal_context', key: 'location', value: 'Paris', importance: 0.7 },
      { class: 'personal_context', key: 'hobbies', value: `my private key is ${hexPrivKey}`, importance: 0.3 },
    ]),
  });

  await omegaMemoryService.extract({
    voiceLogId,
    userId: TEST_USER,
    env: 'production',
    question: 'Where are you from?',
    reply: 'I am from Paris.',
  });

  const facts = db.prepare('SELECT * FROM ml_chat_memory WHERE user_id = ?').all(TEST_USER);
  expect(facts).toHaveLength(1);
  expect(facts[0].fact_key).toBe('location');

  const rejected = db.prepare("SELECT * FROM audit_log WHERE user_id = ? AND action = 'OMEGA_MEMORY_FACT_REJECTED'").all(TEST_USER);
  expect(rejected).toHaveLength(1);
  const details = JSON.parse(rejected[0].details);
  expect(details).toHaveProperty('reason');
  expect(details).not.toHaveProperty('fact_key');
  expect(details).not.toHaveProperty('fact_value');
});

test('T3: malformed JSON — failed_permanent, attempts=1, no next_retry_at', async () => {
  const voiceLogId = insertLog();

  mockChatLLM.mockResolvedValueOnce({
    ok: true,
    text: 'not json at all $$$$',
  });

  await omegaMemoryService.extract({
    voiceLogId,
    userId: TEST_USER,
    env: 'production',
    question: 'Hello?',
    reply: 'Hi there!',
  });

  const log = db.prepare('SELECT * FROM ml_voice_log WHERE id = ?').get(voiceLogId);
  expect(log.extraction_status).toBe('failed_permanent');
  expect(log.attempts).toBe(1);
  expect(log.next_retry_at).toBeNull();

  const failAudits = db.prepare("SELECT * FROM audit_log WHERE action = 'OMEGA_MEMORY_EXTRACTION_FAILED'").all();
  expect(failAudits).toHaveLength(1);
  const details = JSON.parse(failAudits[0].details);
  expect(details).not.toHaveProperty('fact_key');
  expect(details).not.toHaveProperty('fact_value');
});

test('T4: empty extraction — LLM returns [] → done, 0 facts', async () => {
  const voiceLogId = insertLog();

  mockChatLLM.mockResolvedValueOnce({
    ok: true,
    text: '[]',
  });

  await omegaMemoryService.extract({
    voiceLogId,
    userId: TEST_USER,
    env: 'production',
    question: 'Just passing by.',
    reply: 'OK.',
  });

  const facts = db.prepare('SELECT * FROM ml_chat_memory WHERE user_id = ?').all(TEST_USER);
  expect(facts).toHaveLength(0);

  const log = db.prepare('SELECT * FROM ml_voice_log WHERE id = ?').get(voiceLogId);
  expect(log.extraction_status).toBe('done');
});

test('T5: LLM 429 — failed_transient, next_retry_at ≈ now+5min, attempts=1', async () => {
  const voiceLogId = insertLog();

  const err = new Error('Rate limit');
  err.status = 429;
  mockChatLLM.mockRejectedValueOnce(err);

  const before = Date.now();
  await omegaMemoryService.extract({
    voiceLogId,
    userId: TEST_USER,
    env: 'production',
    question: 'Question',
    reply: 'Reply',
  });
  const after = Date.now();

  const log = db.prepare('SELECT * FROM ml_voice_log WHERE id = ?').get(voiceLogId);
  expect(log.extraction_status).toBe('failed_transient');
  expect(log.attempts).toBe(1);
  expect(log.next_retry_at).not.toBeNull();

  const expectedRetry = before + 5 * 60 * 1000;
  expect(log.next_retry_at).toBeGreaterThanOrEqual(expectedRetry - 1000);
  expect(log.next_retry_at).toBeLessThanOrEqual(after + 5 * 60 * 1000 + 1000);
});

test('T6: LLM timeout (TimeoutError) → failed_transient', async () => {
  const voiceLogId = insertLog();

  const err = new Error('Request timed out');
  err.name = 'TimeoutError';
  mockChatLLM.mockRejectedValueOnce(err);

  await omegaMemoryService.extract({
    voiceLogId,
    userId: TEST_USER,
    env: 'production',
    question: 'Question',
    reply: 'Reply',
  });

  const log = db.prepare('SELECT * FROM ml_voice_log WHERE id = ?').get(voiceLogId);
  expect(log.extraction_status).toBe('failed_transient');
});

test('T7: ECONNRESET → failed_transient', async () => {
  const voiceLogId = insertLog();

  const err = new Error('Connection reset');
  err.code = 'ECONNRESET';
  mockChatLLM.mockRejectedValueOnce(err);

  await omegaMemoryService.extract({
    voiceLogId,
    userId: TEST_USER,
    env: 'production',
    question: 'Question',
    reply: 'Reply',
  });

  const log = db.prepare('SELECT * FROM ml_voice_log WHERE id = ?').get(voiceLogId);
  expect(log.extraction_status).toBe('failed_transient');
});

test('T8: LLM 400 bad request → failed_permanent, no retry', async () => {
  const voiceLogId = insertLog();

  const err = new Error('Bad request');
  err.status = 400;
  mockChatLLM.mockRejectedValueOnce(err);

  await omegaMemoryService.extract({
    voiceLogId,
    userId: TEST_USER,
    env: 'production',
    question: 'Question',
    reply: 'Reply',
  });

  const log = db.prepare('SELECT * FROM ml_voice_log WHERE id = ?').get(voiceLogId);
  expect(log.extraction_status).toBe('failed_permanent');
  expect(log.next_retry_at).toBeNull();
});

test('T9: LLM returns non-array object → failed_permanent (schema invalid)', async () => {
  const voiceLogId = insertLog();

  mockChatLLM.mockResolvedValueOnce({
    ok: true,
    text: '{"not": "an array"}',
  });

  await omegaMemoryService.extract({
    voiceLogId,
    userId: TEST_USER,
    env: 'production',
    question: 'Question',
    reply: 'Reply',
  });

  const log = db.prepare('SELECT * FROM ml_voice_log WHERE id = ?').get(voiceLogId);
  expect(log.extraction_status).toBe('failed_permanent');
  expect(log.next_retry_at).toBeNull();
});

test('T10: backoff schedule — _calcBackoff returns 5min/30min/2h/12h for attempts 1-4, null for 5', () => {
  const base = Date.now();
  const origDateNow = Date.now;
  Date.now = jest.fn(() => base);

  // Re-require after mocking Date.now to get fresh _internals with mocked time
  jest.resetModules();
  jest.doMock('../../server/services/database', () => ({ db, get: () => db }));
  jest.doMock('../../server/services/ml/_voice/llmClient', () => ({
    chat: jest.fn(),
    available: () => true,
  }));
  const freshMod = require('../../server/services/ml/_voice/omegaMemoryService');
  const fresh = freshMod._internals;

  expect(fresh._calcBackoff(1) - base).toBeCloseTo(5 * 60 * 1000, -3);
  expect(fresh._calcBackoff(2) - base).toBeCloseTo(30 * 60 * 1000, -3);
  expect(fresh._calcBackoff(3) - base).toBeCloseTo(2 * 60 * 60 * 1000, -3);
  expect(fresh._calcBackoff(4) - base).toBeCloseTo(12 * 60 * 60 * 1000, -3);
  expect(fresh._calcBackoff(5)).toBeNull();

  Date.now = origDateNow;
});

test('T12: identity UPSERT is env-agnostic (cap-of-4 per user, not per user×env)', async () => {
  // Mock LLM to return same identity fact name='Alice'
  mockChatLLM.mockResolvedValue({ ok: true, text: JSON.stringify([
    { class: 'identity', key: 'name', value: 'Alice', importance: 1.0 },
  ])});

  // First extraction with env='DEMO'
  const v1 = db.prepare(
    'INSERT INTO ml_voice_log (user_id, text, context_json, created_at, extraction_status) VALUES (?, ?, ?, ?, ?)'
  ).run(TEST_USER, 'r', '{}', Date.now(), 'pending').lastInsertRowid;
  await omegaMemoryService.extract({ voiceLogId: v1, userId: TEST_USER, env: 'DEMO', question: 'q', reply: 'r' });

  // Second extraction with env='REAL' — same identity key 'name'
  const v2 = db.prepare(
    'INSERT INTO ml_voice_log (user_id, text, context_json, created_at, extraction_status) VALUES (?, ?, ?, ?, ?)'
  ).run(TEST_USER, 'r', '{}', Date.now(), 'pending').lastInsertRowid;
  await omegaMemoryService.extract({ voiceLogId: v2, userId: TEST_USER, env: 'REAL', question: 'q', reply: 'r' });

  // Should be 1 identity row, not 2 — identity is env-agnostic
  const identityCount = db.prepare(
    "SELECT COUNT(*) as c FROM ml_chat_memory WHERE user_id=? AND class='identity' AND fact_key='name' AND tombstone_at IS NULL"
  ).get(TEST_USER).c;
  expect(identityCount).toBe(1);

  // The single row must have env=NULL
  const identityRow = db.prepare(
    "SELECT env, reaffirm_count FROM ml_chat_memory WHERE user_id=? AND class='identity' AND fact_key='name' AND tombstone_at IS NULL"
  ).get(TEST_USER);
  expect(identityRow.env).toBeNull();

  // Second extraction should have reaffirmed (incremented reaffirm_count)
  expect(identityRow.reaffirm_count).toBe(2);
});

test('T13: eviction audit includes msg_id from triggering extraction', async () => {
  // Fill personal_context to cap=25
  const now = Date.now();
  for (let i = 0; i < 25; i++) {
    db.prepare(
      `INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at)
       VALUES (?, NULL, 'personal_context', ?, ?, ?, ?, ?, ?, ?)`
    ).run(TEST_USER, `key${i}`, `v${i}`, 0.3, now - i * 86400000, now, now, now + 365 * 86400000);
  }

  // Trigger extraction that should evict one
  mockChatLLM.mockResolvedValueOnce({ ok: true, text: JSON.stringify([
    { class: 'personal_context', key: 'profession', value: 'developer', importance: 0.8 },
  ])});

  const triggerVoiceLogId = db.prepare(
    'INSERT INTO ml_voice_log (user_id, text, context_json, created_at, extraction_status) VALUES (?, ?, ?, ?, ?)'
  ).run(TEST_USER, 'r', '{}', now, 'pending').lastInsertRowid;

  await omegaMemoryService.extract({ voiceLogId: triggerVoiceLogId, userId: TEST_USER, env: 'DEMO', question: 'q', reply: 'r' });

  // Find eviction audit
  const evictAudit = db.prepare("SELECT details FROM audit_log WHERE action='OMEGA_MEMORY_FACT_EVICTED'").get();
  expect(evictAudit).toBeDefined();
  const details = JSON.parse(evictAudit.details);
  expect(details.msg_id).toBe(triggerVoiceLogId);
  expect(details.reason).toBe('cap_evict');
});

test('T14: concurrent _upsertFact calls near cap-1 do not exceed cap (transaction safety)', () => {
  // Pre-seed 24 personal_context facts (cap=25, so one slot remains)
  const now = Date.now();
  for (let i = 0; i < 24; i++) {
    db.prepare(
      `INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at)
       VALUES (?, NULL, 'personal_context', ?, ?, ?, ?, ?, ?, ?)`
    ).run(TEST_USER, `existing${i}`, `v${i}`, 0.5, now, now, now, now + 365 * 86400000);
  }

  // Two _upsertFact calls — better-sqlite3 is synchronous, both serialize via transaction.
  // Final live count must be exactly cap (25), not 26.
  // Use valid personal_context keys (allowlist: location, timezone, language, comm_style, profession, schedule, family_context, hobbies)
  _internals._upsertFact(TEST_USER, 'DEMO', 999, { class: 'personal_context', key: 'profession', value: 'engineer', importance: 0.7 }, now);
  _internals._upsertFact(TEST_USER, 'DEMO', 1000, { class: 'personal_context', key: 'hobbies', value: 'cycling', importance: 0.8 }, now);

  const liveCount = db.prepare(
    "SELECT COUNT(*) AS c FROM ml_chat_memory WHERE user_id=? AND class='personal_context' AND tombstone_at IS NULL"
  ).get(TEST_USER).c;
  expect(liveCount).toBe(25); // Exactly cap, not 26

  // Eviction must have occurred (one fact tombstoned)
  const evictedCount = db.prepare(
    "SELECT COUNT(*) AS c FROM ml_chat_memory WHERE user_id=? AND class='personal_context' AND forgotten_by='eviction'"
  ).get(TEST_USER).c;
  expect(evictedCount).toBeGreaterThan(0);
});

test('T11 (bonus): attempts=4 + LLM 429 → attempts=5, failed_permanent (max attempts exhausted)', async () => {
  const voiceLogId = insertLog({ attempts: 4, extraction_status: 'failed_transient' });

  const err = new Error('Rate limit');
  err.status = 429;
  mockChatLLM.mockRejectedValueOnce(err);

  await omegaMemoryService.extract({
    voiceLogId,
    userId: TEST_USER,
    env: 'production',
    question: 'Question',
    reply: 'Reply',
  });

  const log = db.prepare('SELECT * FROM ml_voice_log WHERE id = ?').get(voiceLogId);
  expect(log.attempts).toBe(5);
  expect(log.extraction_status).toBe('failed_permanent');
  expect(log.next_retry_at).toBeNull();
});
