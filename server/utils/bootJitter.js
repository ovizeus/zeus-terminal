'use strict';

/**
 * Deterministic boot-time jitter helper.
 *
 * Given a subsystem key, returns a stable jitter in [0, maxMs). The same key
 * always returns the same value (per process), which gives:
 *   - predictable scheduling topology (visible in logs)
 *   - no random collision where multiple subsystems happen to roll low values
 *     in the same boot
 *
 * Use case: spread the initial poll fire of marketFeed / marketRadar /
 * various subsystems across a 0–25s window after boot, so PM2 reload
 * doesn't cause a synchronized burst that trips Binance anti-abuse.
 *
 * @param {string} subsystemKey — e.g. 'marketFeed', 'marketRadar.oi'
 * @param {number} [maxMs=25000] — upper exclusive bound
 * @returns {number} jitter ms in [0, maxMs)
 */
const crypto = require('crypto');

function bootJitter(subsystemKey, maxMs = 25_000) {
  const hash = crypto.createHash('sha256').update(String(subsystemKey)).digest();
  const num = hash.readUInt32BE(0);
  return num % maxMs;
}

module.exports = { bootJitter };
