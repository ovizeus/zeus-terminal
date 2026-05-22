'use strict';

/**
 * orderLock — Symbol-level advisory lock for entry/close operations.
 *
 * Prevents concurrent entry/close orders for the same user+symbol pair.
 * acquire() returns true if lock was acquired, false if already held (timeout).
 * release() is idempotent.
 *
 * Implementation: in-process Map with expiry. Sufficient for single-process Zeus.
 * For multi-process, replace with DB-based advisory locks.
 */

const _locks = new Map(); // key → expiresAt (ms)

async function acquire(key, timeoutMs = 10_000) {
    const now = Date.now();
    const existing = _locks.get(key);
    if (existing && existing > now) {
        // Already held and not expired
        return false;
    }
    _locks.set(key, now + timeoutMs);
    return true;
}

function release(key) {
    _locks.delete(key);
}

module.exports = { acquire, release };
