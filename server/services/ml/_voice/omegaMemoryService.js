'use strict';

/**
 * omegaMemoryService.js — Sub-C.1 Task 4 (extract path)
 *
 * LLM-driven fact extraction for Omega long-term memory.
 *
 * Extract flow (spec §6.1):
 *   1. Pre-run: mark last_attempt_at
 *   2. Pre-LLM redact (mode='input') on question + reply
 *   3. Class allowlist gate via classifyExtractableContent
 *   4. LLM call via llmClient.chat() — 320 maxTokens, 8s timeout
 *   5. Parse JSON array; throw PARSE_ERROR if not array
 *   6. Empty array → done
 *   7. Per-fact validation + UPSERT with cap-check + eviction
 *   8. Update ml_chat_memory_meta.last_modified_at
 *   9. Mark extraction_status='done'
 *
 * Failure classification (spec §6.6):
 *   - 429/5xx/timeout/ECONNRESET → failed_transient (max 5 attempts, backoff schedule)
 *   - PARSE_ERROR/SCHEMA_INVALID/400 → failed_permanent (no retry)
 *
 * Backoff: 5min → 30min → 2h → 12h → permanent (after attempts=5)
 *
 * Audit invariant: details JSON NEVER contains fact_key, fact_value, or matched_substring.
 */

const { redactPipeline } = require('./redactPipeline');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CLASS_HALFLIFE_DAYS = {
  identity: Infinity,
  style: 180,
  personal_context: 90,
  trading_strategy: 60,
  temporary: 7,
};

const CLASS_CAPS = {
  identity:         { cap: 4,   scope: 'user' },
  style:            { cap: 8,   scope: 'user' },
  personal_context: { cap: 25,  scope: 'user' },
  trading_strategy: { cap: 100, scope: 'user_env' },
  temporary:        { cap: 15,  scope: 'user' },
};

const BACKOFF_SCHEDULE_MS = [
  5  * 60 * 1000,        // attempt 1 → +5 min
  30 * 60 * 1000,        // attempt 2 → +30 min
  2  * 60 * 60 * 1000,   // attempt 3 → +2 h
  12 * 60 * 60 * 1000,   // attempt 4 → +12 h
];

const MAX_TRANSIENT_ATTEMPTS = 5;

const TOP_N_BUDGET = 12;
const CACHE_TTL_MS = 30 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Process-local cache
// ─────────────────────────────────────────────────────────────────────────────

const _cache = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// Extraction prompt
// ─────────────────────────────────────────────────────────────────────────────

// Reserved values that LLM keeps mis-extracting as user identity
// (these are the assistant's own self-references, not user facts).
// Used both in extraction prompt AND post-LLM validation.
const RESERVED_IDENTITY_VALUES = new Set([
  'omega', 'assistant', 'ai', 'bot', 'system', 'helper',
  'user', 'operator', 'boss', 'șef', 'șeful', 'sef', 'seful',
  'me', 'you', 'tu', 'eu', 'noi', 'we',
]);

const EXTRACTION_PROMPT_SYSTEM = `You extract personal facts about THE OPERATOR (the human user) from a conversation between the operator and Omega (an AI trading assistant).

INPUT FORMAT:
  Question: <text the OPERATOR sent>
  Reply: <text OMEGA the assistant sent back>

CRITICAL RULES:
- Extract facts ABOUT THE OPERATOR ONLY — not about Omega/yourself.
- The "Question" line = operator's own statements (extract from here).
- The "Reply" line = Omega's response (DO NOT extract Omega's self-references as operator facts).
- Examples of WRONG extractions to AVOID:
  • "Omega here, mood calm..." → DO NOT extract name=omega for the operator. That's Omega's own name.
  • "salut boss, omega aici" → DO NOT set role=boss or name=omega. Those describe the assistant addressing the operator.
  • "I am Omega, your assistant" → DO NOT extract any identity fact. That's self-description by Omega.
- Examples of CORRECT extractions:
  • Operator says "Eu sunt Ovi" → identity.name = "Ovi"
  • Operator says "sunt din România" → personal_context.location = "România"
  • Operator says "vorbesc româna" → identity.primary_language = "Romanian"
  • Operator says "folosesc timeframe 4h" → trading_strategy.timeframe = "4h"

If unsure whether a statement is from operator or Omega, prefer NOT to extract (false negatives are safer than false positives).

OUTPUT: JSON array [{class, key, value, importance}] or [] if nothing extractable.

ALLOWED CLASSES: identity, style, personal_context, trading_strategy, temporary

ALLOWED IDENTITY KEYS: name, primary_language, comm_style, role
  - name: operator's actual name (e.g., "Ovi", "Maria"). NEVER "omega", "assistant", "boss", "user".
  - primary_language: full language name (e.g., "Romanian", "English"). Not language codes.
  - comm_style: one of {direct, informal, formal, technical, friendly, terse}. Not random words.
  - role: operator's actual role in the world (e.g., "developer", "trader", "founder"). NEVER "boss"/"șeful" — that's how Omega addresses them, not their actual role.

ALLOWED STYLE KEYS: tone, format, emoji, length, depth, push_back, error_handling, jokes
ALLOWED PERSONAL_CONTEXT KEYS: location, timezone, language, comm_style, profession, schedule, family_context, hobbies
TRADING_STRATEGY and TEMPORARY: open vocabulary (any key allowed, validated server-side)

IMPORTANCE: 0.0-1.0 scale.
- identity: 0.9-1.0
- explicit preferences with "always"/"never": 0.7-0.9
- habitual mentions: 0.5-0.7
- one-off mentions: 0.3-0.5

DO NOT EXTRACT (treat as if not said):
- API keys, JWT tokens, passwords, parole, PIN codes, 2FA codes
- Credit card numbers, IBAN, SSN, ID numbers
- Wallet private keys, seed phrases, mnemonics
- Addresses paired with "private" or "secret" keywords
- Anything operator explicitly marked "secret" or "don't remember"

If conversation contains sensitive content, extract OTHER facts but skip sensitive ones.`;

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify an error for retry policy.
 * @param {Error|null} err
 * @returns {'failed_transient'|'failed_permanent'}
 */
function _classifyError(err) {
  if (!err) return 'failed_permanent';
  if (err.code === 'PARSE_ERROR' || err.code === 'SCHEMA_INVALID') return 'failed_permanent';
  if (err.status === 400) return 'failed_permanent';
  if (err.status === 429 || (err.status >= 500 && err.status < 600)) return 'failed_transient';
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') return 'failed_transient';
  if (err.name === 'TimeoutError') return 'failed_transient';
  return 'failed_transient'; // safer default
}

/**
 * Compute next retry timestamp given current attempt count.
 * @param {number} attempts — after increment (1-indexed)
 * @returns {number|null} epoch ms or null if permanent
 */
function _calcBackoff(attempts) {
  if (attempts >= MAX_TRANSIENT_ATTEMPTS) return null;
  return Date.now() + BACKOFF_SCHEDULE_MS[attempts - 1];
}

/**
 * Hybrid score for eviction priority: lower score = evict first.
 * @param {{ importance: number, last_seen_at: number, class: string }} fact
 * @param {number} now — epoch ms
 * @returns {number}
 */
function _hybridScore(fact, now) {
  const klass = fact.class;
  const halflife = CLASS_HALFLIFE_DAYS[klass];
  const ageDays = (now - fact.last_seen_at) / (24 * 60 * 60 * 1000);
  const decayTerm = halflife === Infinity ? 1.0 : Math.exp(-ageDays * Math.LN2 / halflife);
  return fact.importance * 0.6 + decayTerm * 0.4;
}

/**
 * Calculate when a fact will be ≥90% decayed (5× halflife from now).
 * @param {string} klass
 * @returns {number|null} epoch ms or null for Infinity halflife
 */
function _calcDecayAt(klass) {
  const halflife = CLASS_HALFLIFE_DAYS[klass];
  if (halflife === Infinity) return null;
  return Date.now() + 5 * halflife * 24 * 60 * 60 * 1000;
}

/**
 * Get last_modified_at from ml_chat_memory_meta for a user.
 * Returns 0 if no row or on error.
 * @param {number} userId
 * @returns {number}
 */
function _getMetaLastModified(userId) {
  const { db } = require('../../database');
  try {
    const row = db.prepare('SELECT last_modified_at FROM ml_chat_memory_meta WHERE user_id=?').get(userId);
    return row ? row.last_modified_at : 0;
  } catch (_err) {
    return 0;
  }
}

/**
 * Clear the process-local retrieve cache.
 * @param {number|undefined} userId — if provided, clears only this user; otherwise clears all
 */
function _clearCache(userId) {
  if (userId !== undefined) _cache.delete(userId);
  else _cache.clear();
}

/**
 * Write an audit_log entry. Details MUST NOT contain fact_key or fact_value.
 * @param {number} userId
 * @param {string} action
 * @param {object} details — safe details only (class, reason, msg_id)
 */
function _writeAudit(userId, action, details) {
  const { db } = require('../../database');
  const now = Date.now();
  db.prepare(
    'INSERT INTO audit_log (user_id, action, details, ip, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, action, JSON.stringify(details), 'server', now);
}

/**
 * Update ml_chat_memory_meta.last_modified_at for a user.
 * @param {number} userId
 */
function _updateMeta(userId) {
  const { db } = require('../../database');
  const now = Date.now();
  db.prepare(
    'INSERT INTO ml_chat_memory_meta (user_id, last_modified_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_modified_at=excluded.last_modified_at'
  ).run(userId, now);
}

/**
 * Evict the fact with the lowest hybrid score for (userId, klass[, env]).
 * Tombstones the fact and writes OMEGA_MEMORY_FACT_EVICTED audit.
 *
 * @param {number} userId
 * @param {string} klass
 * @param {string|null} env
 * @param {number} msgId — voice log id for audit
 */
function _evictBottomOne(userId, klass, env, msgId) {
  const { db } = require('../../database');
  const capInfo = CLASS_CAPS[klass];
  const now = Date.now();

  let facts;
  if (capInfo.scope === 'user_env') {
    facts = db.prepare(
      'SELECT * FROM ml_chat_memory WHERE user_id=? AND class=? AND env=? AND tombstone_at IS NULL'
    ).all(userId, klass, env ?? null);
  } else {
    facts = db.prepare(
      'SELECT * FROM ml_chat_memory WHERE user_id=? AND class=? AND tombstone_at IS NULL'
    ).all(userId, klass);
  }

  if (facts.length === 0) return;

  // Score all facts and sort ascending (lowest score = evict first)
  const scored = facts.map(f => ({ ...f, _score: _hybridScore(f, now) }));
  scored.sort((a, b) => a._score - b._score);

  const victim = scored[0];
  db.prepare(
    'UPDATE ml_chat_memory SET tombstone_at=?, forgotten_by=? WHERE id=?'
  ).run(now, 'eviction', victim.id);

  _writeAudit(userId, 'OMEGA_MEMORY_FACT_EVICTED', {
    class: klass,
    env: env ?? null,
    reason: 'cap_evict',
    msg_id: msgId,
  });
}

/**
 * UPSERT a single fact into ml_chat_memory.
 * - identity: slot-fixed (4 keys), always ON CONFLICT DO UPDATE, never evict
 * - others: check cap first, evict if at cap, then UPSERT
 *
 * Validates: class-key allowlist, key blacklist, value validation, post-LLM regex.
 *
 * @param {number} userId
 * @param {string|null} env
 * @param {number} voiceLogId
 * @param {{ class, key, value, importance }} fact
 * @param {number} now — epoch ms
 */
function _upsertFact(userId, env, voiceLogId, fact, now) {
  const { db } = require('../../database');
  const klass = fact.class;
  const key = fact.key;
  const value = String(fact.value ?? '');
  const importance = typeof fact.importance === 'number' ? fact.importance : 0.5;

  // Validate class-key allowlist
  if (!redactPipeline.isClassKeyAllowed(klass, key)) {
    _writeAudit(userId, 'OMEGA_MEMORY_FACT_REJECTED', {
      class: klass,
      reason: 'class_blocked',
      msg_id: voiceLogId,
    });
    return;
  }

  // [Sub-C.1 post-fix 2026-05-20] Reject identity facts whose value is a reserved
  // assistant self-reference. LLM repeatedly extracts "omega"/"șeful"/etc as the
  // operator's name/role from Omega's own reply text ("salut boss, omega aici").
  // Stopping it here prevents data garbage from polluting persona prompts.
  if (klass === 'identity' && (key === 'name' || key === 'role')) {
    const valLower = value.toLowerCase().trim();
    if (RESERVED_IDENTITY_VALUES.has(valLower)) {
      _writeAudit(userId, 'OMEGA_MEMORY_FACT_REJECTED', {
        class: klass,
        reason: 'reserved_self_reference',
        msg_id: voiceLogId,
      });
      return;
    }
  }

  // Validate key not blacklisted
  if (redactPipeline.isFactKeyBlacklisted(key)) {
    _writeAudit(userId, 'OMEGA_MEMORY_FACT_REJECTED', {
      class: klass,
      reason: 'key_blacklist',
      msg_id: voiceLogId,
    });
    return;
  }

  // Validate fact value
  const valResult = redactPipeline.validateFactValue(value, klass);
  if (!valResult.ok) {
    _writeAudit(userId, 'OMEGA_MEMORY_FACT_REJECTED', {
      class: klass,
      reason: valResult.reason,
      msg_id: voiceLogId,
    });
    return;
  }

  // Post-LLM regex on fact_value (mode='input')
  const redactResult = redactPipeline.redact(value, { mode: 'input' });
  if (redactResult.redactionCount > 0) {
    _writeAudit(userId, 'OMEGA_MEMORY_FACT_REJECTED', {
      class: klass,
      reason: 'post_regex',
      msg_id: voiceLogId,
    });
    return;
  }

  // Determine env scope for this class.
  // Identity is env-agnostic (spec §6.1): always env=NULL, UNIQUE key is (user_id, class, fact_key).
  // SQLite UNIQUE treats NULL as distinct so we CANNOT rely on ON CONFLICT for identity — use
  // SELECT-then-UPDATE-or-INSERT manually to enforce true env-agnostic cap-of-4 per user.
  const isIdentity = klass === 'identity';
  const factEnv = isIdentity ? null : (CLASS_CAPS[klass].scope === 'user_env' ? (env ?? null) : null);

  const decayAt = _calcDecayAt(klass);

  // Wrap cap-check + eviction + UPSERT in a single transaction.
  // better-sqlite3 transactions are synchronous and serialize writes at SQLite level,
  // eliminating PM2 cluster race windows:
  //   - Non-identity: both workers could pass cap check and both INSERT → cap overflow
  //   - Identity: both workers SELECT (not found) and both INSERT → duplicate rows
  //     (SQLite NULL-distinct UNIQUE does NOT protect identity rows)
  const upsertTx = db.transaction(() => {
    // Cap-check + eviction (non-identity only)
    if (!isIdentity) {
      const capInfo = CLASS_CAPS[klass];
      let liveCount;
      if (capInfo.scope === 'user_env') {
        liveCount = db.prepare(
          'SELECT COUNT(*) AS n FROM ml_chat_memory WHERE user_id=? AND class=? AND env=? AND tombstone_at IS NULL'
        ).get(userId, klass, env ?? null).n;
      } else {
        liveCount = db.prepare(
          'SELECT COUNT(*) AS n FROM ml_chat_memory WHERE user_id=? AND class=? AND tombstone_at IS NULL'
        ).get(userId, klass).n;
      }

      // Check if this key already exists (UPSERT won't increase count)
      const existingKey = db.prepare(
        'SELECT id FROM ml_chat_memory WHERE user_id=? AND class=? AND fact_key=? AND env IS ? AND tombstone_at IS NULL'
      ).get(userId, klass, key, factEnv);

      if (!existingKey && liveCount >= capInfo.cap) {
        _evictBottomOne(userId, klass, factEnv, voiceLogId);
      }
    }

    // SELECT existing row — identity: env-agnostic lookup, others: env-scoped
    let existing;
    if (isIdentity) {
      existing = db.prepare(
        "SELECT id, reaffirm_count FROM ml_chat_memory WHERE user_id=? AND class='identity' AND fact_key=? AND tombstone_at IS NULL"
      ).get(userId, key);
    } else {
      existing = db.prepare(
        'SELECT id, reaffirm_count FROM ml_chat_memory WHERE user_id=? AND class=? AND fact_key=? AND (env IS ?) AND tombstone_at IS NULL'
      ).get(userId, klass, key, factEnv);
    }

    if (existing) {
      // UPDATE path — same for both identity and non-identity
      db.prepare(`
        UPDATE ml_chat_memory
        SET fact_value=?, importance=MAX(importance, ?), last_source_chat_id=?,
            reaffirm_count=reaffirm_count+1,
            last_seen_at=?, decay_at=?, tombstone_at=NULL, forgotten_by=NULL, updated_at=?
        WHERE id=?
      `).run(value, importance, voiceLogId, now, decayAt, now, existing.id);

      _writeAudit(userId, 'OMEGA_MEMORY_FACT_UPDATED', {
        class: klass,
        reason: 'reaffirm',
        msg_id: voiceLogId,
      });
    } else {
      // INSERT path — identity always env=NULL, others use factEnv
      db.prepare(`
        INSERT INTO ml_chat_memory
          (user_id, env, class, fact_key, fact_value, importance,
           created_source_chat_id, last_source_chat_id, reaffirm_count,
           decay_at, last_seen_at, tombstone_at, forgotten_by,
           created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, NULL, ?, ?)
      `).run(
        userId, factEnv, klass, key, value, importance,
        voiceLogId, voiceLogId,
        decayAt, now,
        now, now
      );

      _writeAudit(userId, 'OMEGA_MEMORY_FACT_CREATED', {
        class: klass,
        reason: 'first_sight',
        msg_id: voiceLogId,
      });
    }
  });

  upsertTx();
}

// ─────────────────────────────────────────────────────────────────────────────
// Public forget
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Soft-delete (tombstone) a fact by id+userId.
 *
 * - Idempotent: second call returns { ok: true, alreadyTombstoned: true }
 * - Per-user isolated: cross-user attempt returns { ok: false, status: 404 }
 * - Audit OMEGA_MEMORY_FACT_FORGOTTEN with class/reason/msg_id only (NO key/value)
 *
 * @param {number} factId
 * @param {number} userId
 * @param {string} [source='user_ui']
 * @returns {Promise<{ ok: boolean, tombstoneUntil?: number, alreadyTombstoned?: boolean, status?: number }>}
 */
async function forget(factId, userId, source = 'user_ui') {
  const { db } = require('../../database');
  const now = Date.now();

  const fact = db.prepare('SELECT * FROM ml_chat_memory WHERE id=? AND user_id=?').get(factId, userId);
  if (!fact) {
    return { ok: false, status: 404 };
  }
  if (fact.tombstone_at !== null && fact.tombstone_at !== undefined) {
    return { ok: true, alreadyTombstoned: true };
  }

  db.prepare(
    'UPDATE ml_chat_memory SET tombstone_at=?, forgotten_by=?, updated_at=? WHERE id=?'
  ).run(now, source, now, factId);

  _updateMeta(userId);
  _clearCache(userId);

  _writeAudit(userId, 'OMEGA_MEMORY_FACT_FORGOTTEN', {
    class: fact.class,
    reason: source,
    msg_id: fact.last_source_chat_id,
  });

  return { ok: true, tombstoneUntil: now + 7 * 24 * 60 * 60 * 1000 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public compactWatermark
// ─────────────────────────────────────────────────────────────────────────────

const COMPACT_ENVS = ['DEMO', 'TESTNET', 'REAL'];

/**
 * Watermark-based compaction for a single user.
 *
 * For each non-identity class:
 *   For each env-scope (env=null for non-trading_strategy, or [DEMO/TESTNET/REAL] for trading_strategy):
 *     - If count >= floor(cap * 0.8): evict bottom ceil(count * 0.1) facts by hybrid score
 *
 * Identity is skipped (closed-enum slot-fixed).
 *
 * @param {number} userId
 * @returns {Promise<{ evictedCount: number }>}
 */
async function compactWatermark(userId) {
  const { db } = require('../../database');
  const now = Date.now();
  let evictedCount = 0;

  const nonIdentityClasses = Object.keys(CLASS_CAPS).filter(k => k !== 'identity');

  for (const klass of nonIdentityClasses) {
    const capInfo = CLASS_CAPS[klass];
    const envScopes = capInfo.scope === 'user_env' ? COMPACT_ENVS : [null];

    for (const env of envScopes) {
      let facts;
      if (env !== null) {
        facts = db.prepare(
          'SELECT * FROM ml_chat_memory WHERE user_id=? AND class=? AND env=? AND tombstone_at IS NULL'
        ).all(userId, klass, env);
      } else {
        facts = db.prepare(
          'SELECT * FROM ml_chat_memory WHERE user_id=? AND class=? AND tombstone_at IS NULL'
        ).all(userId, klass);
      }

      const count = facts.length;
      const threshold = Math.floor(capInfo.cap * 0.8);
      if (count < threshold) continue;

      const evictN = Math.ceil(count * 0.1);
      const scored = facts.map(f => ({ ...f, _score: _hybridScore(f, now) }));
      scored.sort((a, b) => a._score - b._score);

      const victims = scored.slice(0, evictN);
      for (const victim of victims) {
        db.prepare(
          'UPDATE ml_chat_memory SET tombstone_at=?, forgotten_by=?, updated_at=? WHERE id=?'
        ).run(now, 'eviction', now, victim.id);

        _writeAudit(userId, 'OMEGA_MEMORY_FACT_EVICTED', {
          class: klass,
          env: env ?? null,
          reason: 'cap_evict',
          msg_id: victim.last_source_chat_id,
        });

        evictedCount++;
      }
    }
  }

  if (evictedCount > 0) {
    _updateMeta(userId);
    _clearCache(userId);
  }

  return { evictedCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public hardDeleteOldTombstones
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hard-delete tombstoned facts older than 7 days.
 * System-level operation — audit written with user_id=NULL.
 *
 * @returns {Promise<{ hardDeletedCount: number }>}
 */
async function hardDeleteOldTombstones() {
  const { db } = require('../../database');
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const result = db.prepare(
    'DELETE FROM ml_chat_memory WHERE tombstone_at IS NOT NULL AND tombstone_at < ?'
  ).run(cutoff);

  if (result.changes > 0) {
    _writeAudit(null, 'OMEGA_MEMORY_HARD_DELETED', { count: result.changes });
  }

  return { hardDeletedCount: result.changes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public autoDecayExpired
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tombstone all facts where decay_at < now and not already tombstoned.
 * No per-fact audit (would be too noisy for cron operation).
 * Clears global cache since this runs across ALL users.
 *
 * @returns {Promise<{ autoDecayedCount: number }>}
 */
async function autoDecayExpired() {
  const { db } = require('../../database');
  const now = Date.now();

  const result = db.prepare(
    'UPDATE ml_chat_memory SET tombstone_at=?, forgotten_by=?, updated_at=? WHERE decay_at < ? AND tombstone_at IS NULL'
  ).run(now, 'auto_decay', now, now);

  if (result.changes > 0) {
    _clearCache();
  }

  return { autoDecayedCount: result.changes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public retrieve
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retrieve up to TOP_N_BUDGET facts for a user/env from memory.
 *
 * Returns:
 *   - ALL identity facts (closed enum, max 4 — always included)
 *   - Top-(TOP_N_BUDGET - identity_count) non-identity facts by hybrid score
 *
 * env filter: trading_strategy facts only match requested env or env=NULL.
 * Other classes are env-agnostic.
 *
 * Excludes tombstoned (tombstone_at IS NOT NULL) and expired (decay_at <= now) facts.
 *
 * Uses a 30s process-local cache. Cache is invalidated when:
 *   - TTL expires (now - loadedAt >= CACHE_TTL_MS), OR
 *   - ml_chat_memory_meta.last_modified_at > cache.loadedAt (another worker wrote)
 *
 * On any DB error, returns [] (graceful degrade — chat flow must not crash).
 *
 * @param {number} userId
 * @param {string|null} env
 * @returns {Promise<Array>}
 */
async function retrieve(userId, env) {
  const now = Date.now();

  try {
    const cached = _cache.get(userId);
    const metaLastModified = _getMetaLastModified(userId);

    // Cache fresh if: within TTL AND meta not updated since load
    if (
      cached &&
      (now - cached.loadedAt) < CACHE_TTL_MS &&
      cached.loadedAt >= metaLastModified
    ) {
      return cached.facts;
    }

    // Reload from DB
    const { db } = require('../../database');
    const allFacts = db.prepare(`
      SELECT * FROM ml_chat_memory
      WHERE user_id=? AND tombstone_at IS NULL
        AND (decay_at IS NULL OR decay_at > ?)
        AND (class != 'trading_strategy' OR env=? OR env IS NULL)
    `).all(userId, now, env);

    // Identity always included
    const identity = allFacts.filter(f => f.class === 'identity');
    const others = allFacts.filter(f => f.class !== 'identity');

    // JS-side hybrid scoring (better-sqlite3 lacks exp/ln)
    const scored = others.map(f => ({ fact: f, score: _hybridScore(f, now) }));
    scored.sort((a, b) => b.score - a.score);

    const remainingBudget = Math.max(0, TOP_N_BUDGET - identity.length);
    const topOthers = scored.slice(0, remainingBudget).map(s => s.fact);

    const result = [...identity, ...topOthers];
    _cache.set(userId, { facts: result, loadedAt: now });
    return result;
  } catch (_err) {
    // Graceful degrade — chat flow must not crash on memory failure
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public extract
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract facts from a (question, reply) pair and persist them.
 *
 * @param {object} params
 * @param {number} params.voiceLogId
 * @param {number} params.userId
 * @param {string|null} params.env
 * @param {string} params.question
 * @param {string} params.reply
 */
async function extract({ voiceLogId, userId, env, question, reply }) {
  const { db } = require('../../database');
  const llmClient = require('./llmClient');
  const now = Date.now();

  // Step 1: Mark last_attempt_at
  db.prepare(
    'UPDATE ml_voice_log SET last_attempt_at=? WHERE id=?'
  ).run(now, voiceLogId);

  try {
    // Step 2: Pre-LLM redact (mode='input', high-recall)
    const { redactedText: redactedQuestion } = redactPipeline.redact(question || '', { mode: 'input' });
    const { redactedText: redactedReply } = redactPipeline.redact(reply || '', { mode: 'input' });

    // Step 3: Class allowlist gate
    const combined = redactedQuestion + ' ' + redactedReply;
    const { hasContent } = redactPipeline.classifyExtractableContent(combined);
    if (!hasContent) {
      db.prepare(
        "UPDATE ml_voice_log SET extraction_status='done' WHERE id=?"
      ).run(voiceLogId);
      return;
    }

    // Step 4: LLM extraction call
    const llmResult = await llmClient.chat({
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT_SYSTEM },
        { role: 'user', content: `Question: ${redactedQuestion}\n\nReply: ${redactedReply}` },
      ],
      maxTokens: 320,
      timeoutMs: 8000,
    });

    let responseText;
    if (llmResult && llmResult.ok) {
      responseText = llmResult.text;
    } else if (llmResult && !llmResult.ok) {
      // llmClient returns {ok:false, error:...} for HTTP errors — convert to thrown error
      const err = new Error(llmResult.error || 'llm_failed');
      // Parse HTTP status from error string like 'http_429'
      const httpMatch = String(llmResult.error || '').match(/^http_(\d+)$/);
      if (httpMatch) {
        err.status = parseInt(httpMatch[1], 10);
      } else if (llmResult.error === 'timeout') {
        err.name = 'TimeoutError';
      }
      throw err;
    } else {
      const err = new Error('llm_no_response');
      throw err;
    }

    // Step 5: Parse JSON
    let facts;
    try {
      facts = JSON.parse(responseText);
    } catch (_) {
      const err = new Error('Failed to parse LLM JSON response');
      err.code = 'PARSE_ERROR';
      throw err;
    }

    if (!Array.isArray(facts)) {
      const err = new Error('LLM response is not a JSON array');
      err.code = 'PARSE_ERROR';
      throw err;
    }

    // Step 6: Empty array → done
    if (facts.length === 0) {
      db.prepare(
        "UPDATE ml_voice_log SET extraction_status='done' WHERE id=?"
      ).run(voiceLogId);
      return;
    }

    // Step 7: Upsert each fact
    const extractNow = Date.now();
    for (const fact of facts) {
      if (!fact || typeof fact !== 'object') continue;
      _upsertFact(userId, env, voiceLogId, fact, extractNow);
    }

    // Step 8: Update meta + invalidate same-worker cache
    _updateMeta(userId);
    _clearCache(userId);

    // Step 9: Mark done
    db.prepare(
      "UPDATE ml_voice_log SET extraction_status='done' WHERE id=?"
    ).run(voiceLogId);

  } catch (err) {
    // Failure path
    const classification = _classifyError(err);

    // Atomically increment attempts
    db.prepare(
      'UPDATE ml_voice_log SET attempts=attempts+1 WHERE id=?'
    ).run(voiceLogId);

    const logRow = db.prepare('SELECT attempts FROM ml_voice_log WHERE id=?').get(voiceLogId);
    const newAttempts = logRow ? logRow.attempts : 1;

    let status;
    let nextRetryAt;

    if (classification === 'failed_transient' && newAttempts < MAX_TRANSIENT_ATTEMPTS) {
      status = 'failed_transient';
      nextRetryAt = _calcBackoff(newAttempts);
    } else if (classification === 'failed_transient' && newAttempts >= MAX_TRANSIENT_ATTEMPTS) {
      status = 'failed_permanent';
      nextRetryAt = null;
    } else {
      // failed_permanent classification
      status = 'failed_permanent';
      nextRetryAt = null;
    }

    db.prepare(
      'UPDATE ml_voice_log SET extraction_status=?, next_retry_at=? WHERE id=?'
    ).run(status, nextRetryAt ?? null, voiceLogId);

    _writeAudit(userId, 'OMEGA_MEMORY_EXTRACTION_FAILED', {
      reason: err.message || 'unknown',
      classification,        // operational metadata: 'failed_transient' | 'failed_permanent'
      attempts: newAttempts, // operational metadata: retry counter
      msg_id: voiceLogId,
      // No fact_key, no fact_value, no matched_substring (privacy invariant preserved)
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  omegaMemoryService: { extract, retrieve, forget, compactWatermark, hardDeleteOldTombstones, autoDecayExpired },
  _internals: {
    _classifyError,
    _calcBackoff,
    _hybridScore,
    _calcDecayAt,
    _upsertFact,
    _evictBottomOne,
    _clearCache,
    _getMetaLastModified,
    CLASS_HALFLIFE_DAYS,
    CLASS_CAPS,
    MAX_TRANSIENT_ATTEMPTS,
    BACKOFF_SCHEDULE_MS,
    TOP_N_BUDGET,
    CACHE_TTL_MS,
  },
};
