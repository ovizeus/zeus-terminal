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

const _locks = new Map(); // key → { expiresAt, acquiredAt } (ms)

async function acquire(key, timeoutMs = 10_000) {
    const now = Date.now();
    const existing = _locks.get(key);
    if (existing && existing.expiresAt > now) {
        // Already held and not expired
        return false;
    }
    _locks.set(key, { expiresAt: now + timeoutMs, acquiredAt: now });
    return true;
}

function release(key) {
    _locks.delete(key);
}

function getActiveLocks() {
    const now = Date.now();
    const result = [];
    for (const [key, info] of _locks.entries()) {
        // Only include non-expired locks
        if (info.expiresAt > now) {
            result.push({ key, heldMs: now - info.acquiredAt, acquired: true });
        }
    }
    return result;
}

module.exports = { acquire, release, getActiveLocks };
