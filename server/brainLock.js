// Zeus Terminal — Server Brain Execution Lock
// Ensures only ONE brain/AT cycle runs at any time on the server.
// Used by future server-side brain/AT phases.
//
// Usage:
//   const lock = require('./brainLock');
//   if (!lock.acquire('brainCycle')) return; // already running
//   try { /* brain logic */ } finally { lock.release('brainCycle'); }
'use strict';

const _locks = new Map(); // name → { ts, owner }

/**
 * Try to acquire a named lock. Returns true if acquired, false if already held.
 * Includes a safety timeout: if a lock is held for > maxMs, it's forcibly released.
 */
function acquire(name, maxMs = 30000) {
    const existing = _locks.get(name);
    if (existing) {
        const age = Date.now() - existing.ts;
        if (age < maxMs) return false; // still held
        // Safety: force-release stale lock
        console.warn(`[LOCK] Force-releasing stale lock '${name}' held for ${age}ms`);
    }
    _locks.set(name, { ts: Date.now(), owner: name });
    return true;
}

/**
 * Release a named lock.
 */
function release(name) {
    _locks.delete(name);
}

/**
 * Check if a named lock is currently held.
 */
function isLocked(name) {
    return _locks.has(name);
}

/**
 * Get status of all locks (for /health or debugging).
 */
function status() {
    const out = {};
    for (const [name, info] of _locks) {
        out[name] = { held: true, ageMs: Date.now() - info.ts };
    }
    return out;
}

module.exports = { acquire, release, isLocked, status };
