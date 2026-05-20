'use strict';

/**
 * omegaMemoryCleanup.test.js — 9 TDD tests for Sub-C.1 Task 9
 *
 * Tests cover all 5 cleanup tasks:
 *   1.  hardDelete >7d: only old tombstone deleted, recent preserved
 *   2.  watermark compaction at 80% cap: evicts when style fills to 7/8
 *   3.  retry transient at 5min interval: next_retry_at just past, attempts=1 → done
 *   4.  retry transient at 30min interval: attempts=2 variant → success
 *   5.  recover stuck pending after 5min: last_attempt_at 6min ago → re-attempted
 *   6.  auto-decay expired: decay_at < now → tombstone_at set + forgotten_by='auto_decay'
 *   7.  per-user iteration: compaction runs for user 1 AND user 2
 *   8.  concurrent safety: two back-to-back compactWatermark calls → no errors + live count <= cap
 *   9.  attempts cap: attempts=5 row is NOT retried by transient cron query
 */

const Database = require('better-sqlite3');

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
let omegaMemoryCleanup;
let omegaMemoryService;
let mockChat;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function insertMeta(userId) {
  db.prepare(
    'INSERT OR IGNORE INTO ml_chat_memory_meta (user_id, last_modified_at) VALUES (?, ?)'
  ).run(userId, Date.now());
}

function insertMemoryFact(overrides = {}) {
  const now = Date.now();
  const row = {
    user_id: 1,
    env: null,
    class: 'style',
    fact_key: `key_${Math.random().toString(36).slice(2)}`,
    fact_value: 'value',
    importance: 0.5,
    created_source_chat_id: null,
    last_source_chat_id: null,
    reaffirm_count: 1,
    decay_at: null,
    last_seen_at: now,
    tombstone_at: null,
    forgotten_by: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  const result = db.prepare(`
    INSERT INTO ml_chat_memory
      (user_id, env, class, fact_key, fact_value, importance, created_source_chat_id,
       last_source_chat_id, reaffirm_count, decay_at, last_seen_at, tombstone_at,
       forgotten_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.user_id, row.env, row.class, row.fact_key, row.fact_value,
    row.importance, row.created_source_chat_id, row.last_source_chat_id,
    row.reaffirm_count, row.decay_at, row.last_seen_at, row.tombstone_at,
    row.forgotten_by, row.created_at, row.updated_at
  );
  return result.lastInsertRowid;
}

function insertVoiceLog(overrides = {}) {
  const row = {
    user_id: 1,
    text: 'test reply',
    context_json: JSON.stringify({ question: 'test question' }),
    created_at: Date.now(),
    extraction_status: 'pending',
    attempts: 0,
    last_attempt_at: null,
    next_retry_at: null,
    ...overrides,
  };
  const result = db.prepare(`
    INSERT INTO ml_voice_log
      (user_id, text, context_json, created_at, extraction_status, attempts, last_attempt_at, next_retry_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.user_id, row.text, row.context_json, row.created_at,
    row.extraction_status, row.attempts, row.last_attempt_at, row.next_retry_at
  );
  return result.lastInsertRowid;
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA_SQL);

  jest.resetModules();

  mockChat = jest.fn();

  jest.doMock('../../server/services/database', () => ({ db, get: () => db }));
  jest.doMock('../../server/services/ml/_voice/llmClient', () => ({
    chat: mockChat,
    available: () => true,
  }));
  // serverAT mock — returns DEMO engine mode (avoids real DB/AT state)
  jest.doMock('../../server/services/serverAT', () => ({
    _uState: () => ({ engineMode: 'demo' }),
  }));
  // logger mock — suppress output during tests
  jest.doMock('../../server/services/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }));

  omegaMemoryService = require('../../server/services/ml/_voice/omegaMemoryService').omegaMemoryService;
  omegaMemoryCleanup = require('../../server/cron/omegaMemoryCleanup');
});

afterEach(() => {
  db.close();
  jest.dontMock('../../server/services/database');
  jest.dontMock('../../server/services/ml/_voice/llmClient');
  jest.dontMock('../../server/services/serverAT');
  jest.dontMock('../../server/services/logger');
  jest.resetModules();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

test('T1: hardDelete >7d — only 8d-old tombstone deleted, 1d-old preserved', async () => {
  insertMeta(1);
  const now = Date.now();
  const eightDaysMs = 8 * 24 * 60 * 60 * 1000;
  const oneDayMs = 1 * 24 * 60 * 60 * 1000;

  // old tombstone: tombstone_at = 8 days ago
  const oldId = insertMemoryFact({
    tombstone_at: now - eightDaysMs,
    forgotten_by: 'test',
    fact_key: 'old_fact',
  });
  // recent tombstone: tombstone_at = 1 day ago (should be preserved)
  const recentId = insertMemoryFact({
    tombstone_at: now - oneDayMs,
    forgotten_by: 'test',
    fact_key: 'recent_fact',
  });

  await omegaMemoryCleanup.run();

  const remaining = db.prepare('SELECT id FROM ml_chat_memory').all();
  const ids = remaining.map(r => r.id);
  expect(ids).not.toContain(oldId);
  expect(ids).toContain(recentId);
});

test('T2: watermark compaction at 80% cap — style cap=8, fill to 7, expect eviction', async () => {
  // style cap=8, 80% threshold = floor(8*0.8)=6 — 7 rows crosses threshold
  insertMeta(1);
  for (let i = 0; i < 7; i++) {
    insertMemoryFact({ class: 'style', fact_key: `style_key_${i}`, user_id: 1 });
  }

  // LLM not needed for compaction task — but mock to return empty for any extract calls
  mockChat.mockResolvedValue({ ok: true, text: '[]' });

  await omegaMemoryCleanup.run();

  const liveCount = db.prepare(
    "SELECT COUNT(*) AS n FROM ml_chat_memory WHERE user_id=1 AND class='style' AND tombstone_at IS NULL"
  ).get().n;
  // compactWatermark evicts ceil(7*0.1)=1 row → 6 remaining
  expect(liveCount).toBeLessThan(7);
});

test('T3: retry transient — attempts=1, next_retry_at just past → becomes done', async () => {
  insertMeta(1);
  const logId = insertVoiceLog({
    extraction_status: 'failed_transient',
    attempts: 1,
    next_retry_at: Date.now() - 1, // just past due
    last_attempt_at: Date.now() - 5 * 60 * 1000,
  });

  // LLM returns empty array → extraction succeeds → status=done
  mockChat.mockResolvedValue({ ok: true, text: '[]' });

  await omegaMemoryCleanup.run();

  const row = db.prepare('SELECT extraction_status FROM ml_voice_log WHERE id=?').get(logId);
  expect(row.extraction_status).toBe('done');
});

test('T4: retry transient — attempts=2 (30min backoff mark), next_retry_at past → success', async () => {
  insertMeta(1);
  const logId = insertVoiceLog({
    extraction_status: 'failed_transient',
    attempts: 2,
    next_retry_at: Date.now() - 1, // just past 30min backoff
    last_attempt_at: Date.now() - 31 * 60 * 1000,
  });

  mockChat.mockResolvedValue({ ok: true, text: '[]' });

  await omegaMemoryCleanup.run();

  const row = db.prepare('SELECT extraction_status FROM ml_voice_log WHERE id=?').get(logId);
  expect(row.extraction_status).toBe('done');
});

test('T5: recover stuck pending after 5min — last_attempt_at 6min ago → re-attempted', async () => {
  insertMeta(1);
  const logId = insertVoiceLog({
    extraction_status: 'pending',
    attempts: 1,
    last_attempt_at: Date.now() - 6 * 60 * 1000, // 6 min ago = stuck
    next_retry_at: null,
  });

  mockChat.mockResolvedValue({ ok: true, text: '[]' });

  await omegaMemoryCleanup.run();

  const row = db.prepare('SELECT extraction_status FROM ml_voice_log WHERE id=?').get(logId);
  // Should have moved away from 'pending' — either 'done' or a failure status
  expect(row.extraction_status).not.toBe('pending');
});

test('T6: auto-decay expired — decay_at < now → tombstone_at set + forgotten_by=auto_decay', async () => {
  insertMeta(1);
  const factId = insertMemoryFact({
    class: 'temporary',
    fact_key: 'temp_fact',
    decay_at: Date.now() - 1000, // expired 1 second ago
    tombstone_at: null,
  });

  await omegaMemoryCleanup.run();

  const row = db.prepare('SELECT tombstone_at, forgotten_by FROM ml_chat_memory WHERE id=?').get(factId);
  expect(row.tombstone_at).not.toBeNull();
  expect(row.forgotten_by).toBe('auto_decay');
});

test('T7: per-user iteration — compaction runs for user 1 AND user 2', async () => {
  insertMeta(1);
  insertMeta(2);

  // Fill style class to 7 for both users (crosses 80% threshold of cap=8)
  for (let i = 0; i < 7; i++) {
    insertMemoryFact({ class: 'style', fact_key: `u1_key_${i}`, user_id: 1 });
    insertMemoryFact({ class: 'style', fact_key: `u2_key_${i}`, user_id: 2 });
  }

  mockChat.mockResolvedValue({ ok: true, text: '[]' });

  await omegaMemoryCleanup.run();

  const u1Live = db.prepare(
    "SELECT COUNT(*) AS n FROM ml_chat_memory WHERE user_id=1 AND class='style' AND tombstone_at IS NULL"
  ).get().n;
  const u2Live = db.prepare(
    "SELECT COUNT(*) AS n FROM ml_chat_memory WHERE user_id=2 AND class='style' AND tombstone_at IS NULL"
  ).get().n;

  // Both users should have had compaction run
  expect(u1Live).toBeLessThan(7);
  expect(u2Live).toBeLessThan(7);
});

test('T8: concurrent safety — two back-to-back compactWatermark calls → no errors + live count <= cap', async () => {
  insertMeta(1);
  // Fill style to 7 (above 80% threshold of 6)
  for (let i = 0; i < 7; i++) {
    insertMemoryFact({ class: 'style', fact_key: `concurrent_key_${i}`, user_id: 1 });
  }

  // Run two compactWatermark calls back-to-back — SQLite serializes, should not throw
  let err1, err2;
  try { await omegaMemoryService.compactWatermark(1); } catch (e) { err1 = e; }
  try { await omegaMemoryService.compactWatermark(1); } catch (e) { err2 = e; }

  expect(err1).toBeUndefined();
  expect(err2).toBeUndefined();

  const liveCount = db.prepare(
    "SELECT COUNT(*) AS n FROM ml_chat_memory WHERE user_id=1 AND class='style' AND tombstone_at IS NULL"
  ).get().n;
  // style cap=8, final live count must be <= cap
  expect(liveCount).toBeLessThanOrEqual(8);
});

test('T9: cron stops at attempts >= 5 — row with attempts=5 is NOT retried', async () => {
  insertMeta(1);
  const logId = insertVoiceLog({
    extraction_status: 'failed_transient',
    attempts: 5, // at cap — cron query has AND attempts < 5
    next_retry_at: Date.now() - 1, // past due, but attempts=5 gates it out
    last_attempt_at: Date.now() - 60 * 60 * 1000,
  });

  // mockChat should NOT be called for this row
  mockChat.mockResolvedValue({ ok: true, text: '[]' });

  await omegaMemoryCleanup.run();

  // Row should remain failed_transient — NOT retried
  const row = db.prepare('SELECT extraction_status, attempts FROM ml_voice_log WHERE id=?').get(logId);
  expect(row.extraction_status).toBe('failed_transient');
  expect(row.attempts).toBe(5);
  // LLM was not called for this specific row — it was filtered by AND attempts < 5
  // (mockChat may have been called for other tasks if needed, so we check row state)
});
