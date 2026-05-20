'use strict';

/**
 * omegaMemoryCleanup.js — Sub-C.1 Task 9
 *
 * Daily cron (02:00 UTC) — 5 tasks per run:
 *   1. hardDeleteOldTombstones()   — drop tombstones older than 7d
 *   2. Retry failed_transient      — WHERE next_retry_at < now AND attempts < 5 LIMIT 50
 *   3. Recover stuck pending       — WHERE last_attempt_at < now-5min LIMIT 50
 *   4. autoDecayExpired()          — tombstone facts with decay_at < now
 *   5. Per-user compactWatermark() — iterate distinct live user_ids
 *
 * Pattern: setInterval-based day-tracked cron (mirrors existing OPS-3/5/7 crons
 * in server/services/database.js). No external cron library — intentional.
 *
 * Boot wiring: call schedule() from server.js after server.listen().
 */

const logger = require('../services/logger');
const { omegaMemoryService } = require('../services/ml/_voice/omegaMemoryService');

// ─── Internal state ───────────────────────────────────────────────────────────

let _lastRunDate = ''; // YYYY-MM-DD — prevents double-run on same UTC day
const TARGET_HOUR_UTC = 2; // 02:00 UTC

// ─── Main run() ───────────────────────────────────────────────────────────────

async function run() {
  const startedAt = Date.now();
  logger.info && logger.info('OMEGA', '[memory-cleanup] starting daily cron');

  // ── Task 1: Hard-delete tombstones >7d ──────────────────────────────────────
  try {
    const hardDel = await omegaMemoryService.hardDeleteOldTombstones();
    logger.info && logger.info('OMEGA', `[memory-cleanup] hard-deleted ${hardDel.hardDeletedCount}`);
  } catch (err) {
    logger.error && logger.error('OMEGA', `[memory-cleanup] hardDelete failed: ${err.message}`);
  }

  // ── Task 2: Retry failed_transient per backoff ───────────────────────────────
  try {
    const { db } = require('../services/database');
    const transientCandidates = db.prepare(`
      SELECT id, user_id, text, context_json
      FROM ml_voice_log
      WHERE extraction_status='failed_transient'
        AND next_retry_at < ?
        AND attempts < 5
      LIMIT 50
    `).all(Date.now());
    let transientRetried = 0;
    for (const row of transientCandidates) {
      try {
        const ctx = JSON.parse(row.context_json || '{}');
        const env = (() => {
          try {
            const serverAT = require('../services/serverAT');
            return (serverAT._uState(row.user_id).engineMode || 'demo').toUpperCase();
          } catch (_) { return 'DEMO'; }
        })();
        await omegaMemoryService.extract({
          voiceLogId: row.id,
          userId: row.user_id,
          env,
          question: ctx.question || '',
          reply: row.text || '',
        });
        transientRetried++;
      } catch (err) {
        logger.warn && logger.warn('OMEGA', `[memory-cleanup] transient retry threw: id=${row.id} err=${err.message}`);
      }
    }
    logger.info && logger.info('OMEGA', `[memory-cleanup] transient retried ${transientRetried}`);
  } catch (err) {
    logger.error && logger.error('OMEGA', `[memory-cleanup] transient task failed: ${err.message}`);
  }

  // ── Task 3: Recover stuck pending (>5min) ────────────────────────────────────
  try {
    const { db } = require('../services/database');
    const stuckCandidates = db.prepare(`
      SELECT id, user_id, text, context_json
      FROM ml_voice_log
      WHERE extraction_status='pending'
        AND last_attempt_at < ?
      LIMIT 50
    `).all(Date.now() - 5 * 60 * 1000);
    let stuckRetried = 0;
    for (const row of stuckCandidates) {
      try {
        const ctx = JSON.parse(row.context_json || '{}');
        const env = (() => {
          try {
            const serverAT = require('../services/serverAT');
            return (serverAT._uState(row.user_id).engineMode || 'demo').toUpperCase();
          } catch (_) { return 'DEMO'; }
        })();
        await omegaMemoryService.extract({
          voiceLogId: row.id,
          userId: row.user_id,
          env,
          question: ctx.question || '',
          reply: row.text || '',
        });
        stuckRetried++;
      } catch (err) {
        logger.warn && logger.warn('OMEGA', `[memory-cleanup] stuck retry threw: id=${row.id} err=${err.message}`);
      }
    }
    logger.info && logger.info('OMEGA', `[memory-cleanup] stuck pending recovered ${stuckRetried}`);
  } catch (err) {
    logger.error && logger.error('OMEGA', `[memory-cleanup] stuck task failed: ${err.message}`);
  }

  // ── Task 4: Auto-decay expired ───────────────────────────────────────────────
  try {
    const autoDecayed = await omegaMemoryService.autoDecayExpired();
    logger.info && logger.info('OMEGA', `[memory-cleanup] auto-decayed ${autoDecayed.autoDecayedCount}`);
  } catch (err) {
    logger.error && logger.error('OMEGA', `[memory-cleanup] autoDecay failed: ${err.message}`);
  }

  // ── Task 5: Watermark compaction per user ────────────────────────────────────
  try {
    const { db } = require('../services/database');
    const users = db.prepare('SELECT DISTINCT user_id FROM ml_chat_memory WHERE tombstone_at IS NULL').all();
    let totalCompacted = 0;
    for (const u of users) {
      try {
        const result = await omegaMemoryService.compactWatermark(u.user_id);
        totalCompacted += result.evictedCount;
      } catch (err) {
        logger.warn && logger.warn('OMEGA', `[memory-cleanup] compact threw for uid=${u.user_id}: ${err.message}`);
      }
    }
    logger.info && logger.info('OMEGA', `[memory-cleanup] watermark compacted ${totalCompacted}`);
  } catch (err) {
    logger.error && logger.error('OMEGA', `[memory-cleanup] compact task failed: ${err.message}`);
  }

  logger.info && logger.info('OMEGA', `[memory-cleanup] done durationMs=${Date.now() - startedAt}`);
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

/**
 * _maybeRun — checks if current UTC hour is TARGET_HOUR_UTC and we haven't
 * already run today. Mirrors OPS-3/5/7 day-tracking pattern.
 */
function _maybeRun() {
  const now = new Date();
  if (now.getUTCHours() !== TARGET_HOUR_UTC) return;
  const today = now.toISOString().slice(0, 10);
  if (_lastRunDate === today) return;
  _lastRunDate = today;
  run().catch(err => {
    logger.error && logger.error('OMEGA', `[memory-cleanup] run() uncaught: ${err.message}`);
  });
}

/**
 * schedule — registers the hourly setInterval that fires _maybeRun().
 * Call once at server boot (server.js after server.listen()).
 */
function schedule() {
  // Small post-boot delay to avoid I/O contention at startup
  setTimeout(_maybeRun, 5 * 60 * 1000); // 5min post-boot check
  setInterval(_maybeRun, 3600000);       // hourly day-tracked check
  logger.info && logger.info('OMEGA', '[memory-cleanup] daily cron scheduled (02:00 UTC, hourly check)');
}

module.exports = { run, schedule };
