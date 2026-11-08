'use strict';

/**
 * Armed, but never asked: the watch over accounts that get no decisions.
 *
 * [2026-11-08] His wife's account sat armed for a month without a single brain
 * decision, and nothing said so. Two separate faults caused it, and both
 * stayed invisible for the same reason: a user who is skipped produces no
 * output, so there is nothing to notice.
 *
 * Edge-triggered, deliberately. The circuit_open flood earlier this month was
 * 19 thousand lines a day of a true statement repeated every tick; the lesson
 * was one line per TRANSITION. So: one warning when an armed user goes quiet
 * past the threshold, one line when decisions come back, nothing in between.
 */

const DEFAULT_THRESHOLD_MS = 15 * 60_000;
/** Drop users untouched for this long so the map cannot grow without bound. */
const FORGET_MS = 24 * 3600_000;
const MAX_TRACKED = 500;

function _num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function create(opts) {
    const thresholdMs = _num(opts && opts.thresholdMs) || DEFAULT_THRESHOLD_MS;
    /** userId → { lastDecisionAt, starved } */
    const seen = new Map();

    function _entry(uid, now) {
        let e = seen.get(uid);
        if (!e) {
            // A user met for the first time starts its clock now. Warning
            // immediately would mean warning about everyone at every boot.
            e = { lastDecisionAt: now, starved: false };
            seen.set(uid, e);
        }
        return e;
    }

    function _sweep(now) {
        if (seen.size <= MAX_TRACKED) return;
        for (const [uid, e] of seen) {
            if (now - e.lastDecisionAt > FORGET_MS) seen.delete(uid);
        }
    }

    return {
        /** Call when a decision was produced for this user. */
        onDecision(userId, now) {
            try {
                const uid = _num(userId), t = _num(now);
                if (uid === null || t === null) return null;
                const e = _entry(uid, t);
                const wasStarved = e.starved;
                const silentMs = t - e.lastDecisionAt;
                e.lastDecisionAt = t;
                e.starved = false;
                _sweep(t);
                return wasStarved ? { userId: uid, state: 'recovered', silentMs } : null;
            } catch (_) { return null; }
        },

        /** Call when an ARMED user was skipped this cycle, with the reason. */
        onArmedSkip(userId, reason, now) {
            try {
                const uid = _num(userId), t = _num(now);
                if (uid === null || t === null) return null;
                const e = _entry(uid, t);
                if (e.starved) return null;                  // already said
                const silentMs = t - e.lastDecisionAt;
                if (silentMs < thresholdMs) return null;
                e.starved = true;
                _sweep(t);
                return { userId: uid, state: 'starved', reason: reason || 'unknown', silentMs };
            } catch (_) { return null; }
        },

        size() { return seen.size; },
        _peek(userId) { return seen.get(_num(userId)); },
    };
}

module.exports = { create, DEFAULT_THRESHOLD_MS, FORGET_MS, MAX_TRACKED };
