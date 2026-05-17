'use strict';

/**
 * OMEGA Doctor D-3.4 — Decay Scheduler.
 *
 * Per Phone Claude proposal (Decay item #5, scoped to Doctor-specific state):
 *   - Trust scores: idle modules pull back toward INITIAL_TRUST 0.50 over time
 *     (anti-rigidity — old extremes should not block re-evaluation)
 *   - Quarantine penalty: linear decay from 1.0 to 0 over 7 days
 *     (failed module gets opportunity to re-prove itself)
 *
 * Idle threshold = 24h. Trust decay = 2%/day toward 0.50.
 *
 * Quarantine penalty (used in alert generation: down-weighted alerts):
 *   - penalty(t) = max(0, 1 - t/QUARANTINE_DECAY_DAYS)
 *   - At t=0: penalty=1.0 (just quarantined; alerts heavily suppressed)
 *   - At t=7d: penalty=0 (full re-trust available)
 *
 * Architecture note: this module operates on trustScorer's in-memory state
 * via listAllScores + applyDecay. Quarantine penalty is a pure function
 * (no state) — caller (Quarantine Manager D-5) computes on demand.
 */

const trustScorer = require('./trustScorer');

const TRUST_DECAY_PER_DAY = 0.02;
const TRUST_DECAY_TARGET = trustScorer.INITIAL_TRUST;  // 0.50
const QUARANTINE_DECAY_DAYS = 7;
const QUARANTINE_DECAY_MS = QUARANTINE_DECAY_DAYS * 86400_000;
const IDLE_THRESHOLD_MS = 24 * 3600_000;  // 24h

function _required(p, k) {
    if (p == null || p[k] == null) {
        throw new Error(`decayScheduler: missing required field ${k}`);
    }
    return p[k];
}

function _daysSince(tsThen, tsNow) {
    return (tsNow - tsThen) / 86400_000;
}

function decayTrustForIdleModule(params) {
    const moduleId = _required(params, 'moduleId');
    const nowTs = _required(params, 'nowTs');

    const all = trustScorer.listAllScores();
    const entry = all.find(e => e.moduleId === moduleId);
    if (!entry) return { decayed: false, reason: 'unknown_module' };

    const idleMs = nowTs - entry.lastUpdateTs;
    if (idleMs <= IDLE_THRESHOLD_MS) {
        return { decayed: false, reason: 'not_idle' };
    }

    const idleDays = idleMs / 86400_000;
    // Pull strength toward target = decay_per_day × idle_days, capped at 1.0
    const pullStrength = Math.min(1.0, TRUST_DECAY_PER_DAY * idleDays);

    const current = entry.trustScore;
    // newScore = current + pullStrength * (target - current)
    let newScore = current + pullStrength * (TRUST_DECAY_TARGET - current);

    // Clamp so we never cross the target line (cannot overshoot).
    if (current > TRUST_DECAY_TARGET && newScore < TRUST_DECAY_TARGET) {
        newScore = TRUST_DECAY_TARGET;
    } else if (current < TRUST_DECAY_TARGET && newScore > TRUST_DECAY_TARGET) {
        newScore = TRUST_DECAY_TARGET;
    }

    trustScorer.applyDecay({ moduleId, newScore });
    return { decayed: true, oldScore: current, newScore, idleDays };
}

function computeQuarantinePenalty(params) {
    const quarantinedAt = _required(params, 'quarantinedAt');
    const nowTs = _required(params, 'nowTs');

    const elapsedMs = nowTs - quarantinedAt;
    if (elapsedMs >= QUARANTINE_DECAY_MS) return { penalty: 0 };
    if (elapsedMs <= 0) return { penalty: 1.0 };

    const penalty = 1.0 - (elapsedMs / QUARANTINE_DECAY_MS);
    return { penalty: Math.max(0, Math.min(1.0, penalty)) };
}

function runDecayPass(params) {
    const nowTs = _required(params, 'nowTs');
    const all = trustScorer.listAllScores();
    let modulesDecayed = 0;
    for (const entry of all) {
        const result = decayTrustForIdleModule({ moduleId: entry.moduleId, nowTs });
        if (result.decayed) modulesDecayed += 1;
    }
    return { modulesDecayed };
}

function resetForTest() {
    // Stateless — depends entirely on trustScorer state.
}

module.exports = {
    TRUST_DECAY_PER_DAY, TRUST_DECAY_TARGET,
    QUARANTINE_DECAY_DAYS, IDLE_THRESHOLD_MS,
    decayTrustForIdleModule, computeQuarantinePenalty,
    runDecayPass, resetForTest
};
