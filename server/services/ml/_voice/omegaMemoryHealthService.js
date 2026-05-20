'use strict';

/**
 * omegaMemoryHealthService.js — Sub-C.1 Task 3
 *
 * Health observability for Omega long-term memory (separation of concerns,
 * Phone Q3 decision). Read-only: queries ml_voice_log aggregates, never mutates.
 *
 * 4-state status:
 *   - healthy:  low failure rate (<10%) AND pending <= 20
 *   - degraded: failure rate 10-50% OR pending > 20 OVERRIDE
 *   - down:     failure rate > 50%
 *   - idle:     no attempt in last 30min OR no attempts ever
 *
 * Pure function _calcStatus exposed via _internals for unit testability.
 * Single bundled aggregates SELECT for efficiency (one round-trip to SQLite).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Thresholds
// ─────────────────────────────────────────────────────────────────────────────

const IDLE_THRESHOLD_MS = 30 * 60 * 1000;       // 30 minutes
const PENDING_OVERRIDE_THRESHOLD = 20;
const RATE_DEGRADED = 0.1;
const RATE_DOWN = 0.5;

// ─────────────────────────────────────────────────────────────────────────────
// Pure function — no I/O
// ─────────────────────────────────────────────────────────────────────────────

/**
 * _calcStatus — pure function, deterministic, no DB access.
 *
 * @param {object} agg
 * @param {number|null} agg.last_attempt_at  — epoch ms or null
 * @param {number}      agg.failure_rate_last_hour  — 0.0–1.0
 * @param {number}      agg.pending_count
 * @param {number}      agg.total_attempts_last_hour
 * @param {number}      now  — epoch ms (injected for testability)
 * @returns {'healthy'|'degraded'|'down'|'idle'}
 */
function _calcStatus({ last_attempt_at, failure_rate_last_hour, pending_count, total_attempts_last_hour }, now) {
  if (!last_attempt_at || now - last_attempt_at > IDLE_THRESHOLD_MS) {
    return 'idle';
  }
  if (pending_count > PENDING_OVERRIDE_THRESHOLD) return 'degraded';
  if (failure_rate_last_hour > RATE_DOWN) return 'down';
  if (failure_rate_last_hour > RATE_DEGRADED) return 'degraded';
  return 'healthy';
}

// ─────────────────────────────────────────────────────────────────────────────
// DB layer — single bundled SELECT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * _queryAggregates — one round-trip to SQLite using subselects.
 *
 * @param {string|number} userId
 * @param {number}        now  — epoch ms
 * @returns {object} raw aggregate row + failure_rate_last_hour
 */
function _queryAggregates(userId, now) {
  const { db } = require('../../database');
  const oneHourAgo = now - 60 * 60 * 1000;
  const oneDayAgo  = now - 24 * 60 * 60 * 1000;

  const stmt = db.prepare(`
    SELECT
      (SELECT MAX(last_attempt_at) FROM ml_voice_log WHERE user_id=? AND extraction_status='done')                                              AS last_success_at,
      (SELECT MAX(last_attempt_at) FROM ml_voice_log WHERE user_id=?)                                                                            AS last_attempt_at,
      (SELECT COUNT(*) FROM ml_voice_log WHERE user_id=? AND extraction_status='pending')                                                        AS pending_count,
      (SELECT COUNT(*) FROM ml_voice_log WHERE user_id=? AND extraction_status='failed_transient' AND last_attempt_at >= ?)                      AS failed_transient_count_last_hour,
      (SELECT COUNT(*) FROM ml_voice_log WHERE user_id=? AND extraction_status='failed_permanent' AND last_attempt_at >= ?)                      AS failed_permanent_count_last_24h,
      (SELECT COUNT(*) FROM ml_voice_log WHERE user_id=? AND last_attempt_at >= ? AND extraction_status IS NOT NULL)                             AS total_attempts_last_hour
  `);

  const row = stmt.get(
    userId,          // last_success_at subselect
    userId,          // last_attempt_at subselect
    userId,          // pending_count subselect
    userId, oneHourAgo,  // failed_transient_count_last_hour subselect
    userId, oneDayAgo,   // failed_permanent_count_last_24h subselect
    userId, oneHourAgo   // total_attempts_last_hour subselect
  );

  const failure_rate_last_hour = row.total_attempts_last_hour > 0
    ? row.failed_transient_count_last_hour / row.total_attempts_last_hour
    : 0;

  return { ...row, failure_rate_last_hour };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

const omegaMemoryHealthService = {
  /**
   * getHealthStatus — returns health snapshot for a given user.
   *
   * @param {string|number} userId
   * @returns {{
   *   status: 'healthy'|'degraded'|'down'|'idle',
   *   last_success_at: number|null,
   *   last_attempt_at: number|null,
   *   failure_rate_last_hour: number,
   *   pending_count: number,
   *   failed_transient_count_last_hour: number,
   *   failed_permanent_count_last_24h: number,
   *   total_attempts_last_hour: number
   * }}
   */
  async getHealthStatus(userId) {
    const now = Date.now();
    const agg = _queryAggregates(userId, now);

    const status = _calcStatus({
      last_attempt_at:       agg.last_attempt_at,
      failure_rate_last_hour: agg.failure_rate_last_hour,
      pending_count:          agg.pending_count,
      total_attempts_last_hour: agg.total_attempts_last_hour
    }, now);

    return {
      status,
      last_success_at:               agg.last_success_at   ?? null,
      last_attempt_at:               agg.last_attempt_at   ?? null,
      failure_rate_last_hour:        agg.failure_rate_last_hour,
      pending_count:                 agg.pending_count,
      failed_transient_count_last_hour: agg.failed_transient_count_last_hour,
      failed_permanent_count_last_24h:  agg.failed_permanent_count_last_24h,
      total_attempts_last_hour:      agg.total_attempts_last_hour
    };
  }
};

module.exports = {
  omegaMemoryHealthService,
  _internals: { _calcStatus }
};
