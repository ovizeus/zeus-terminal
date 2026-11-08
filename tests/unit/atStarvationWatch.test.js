'use strict';

/**
 * [2026-11-08] The silence that hid everything.
 *
 * His wife's account sat armed for a month without receiving a single brain
 * decision, and nothing anywhere said so. Both faults behind it were invisible
 * precisely because an armed-but-skipped user produced no output at all.
 *
 * This watch is edge-triggered on purpose. The lesson from the circuit_open
 * flood still stands: one line per transition, not one per tick. A warning
 * repeated every cycle is a warning nobody reads.
 */
const W = require('../../server/services/atStarvationWatch');

describe('an armed account that gets no decisions must not stay silent', () => {
    let w;
    beforeEach(() => { w = W.create({ thresholdMs: 15 * 60_000 }); });

    it('says nothing while decisions keep coming', () => {
        expect(w.onDecision(2, 1_000)).toBeNull();
        expect(w.onArmedSkip(2, 'DATA_NOT_READY', 2_000)).toBeNull();
        expect(w.onDecision(2, 3_000)).toBeNull();
    });

    it('warns once when an armed user has been starved past the threshold', () => {
        w.onDecision(2, 0);
        expect(w.onArmedSkip(2, 'DATA_NOT_READY', 10 * 60_000)).toBeNull();
        const hit = w.onArmedSkip(2, 'DATA_NOT_READY', 16 * 60_000);
        expect(hit).toMatchObject({ userId: 2, reason: 'DATA_NOT_READY', state: 'starved' });
        expect(typeof hit.silentMs).toBe('number');
    });

    it('does NOT repeat it every cycle', () => {
        w.onDecision(2, 0);
        expect(w.onArmedSkip(2, 'DATA_NOT_READY', 16 * 60_000)).not.toBeNull();
        expect(w.onArmedSkip(2, 'DATA_NOT_READY', 17 * 60_000)).toBeNull();
        expect(w.onArmedSkip(2, 'DATA_NOT_READY', 60 * 60_000)).toBeNull();
    });

    it('says so when it recovers, so the end of a problem is visible too', () => {
        w.onDecision(2, 0);
        w.onArmedSkip(2, 'DATA_NOT_READY', 16 * 60_000);
        const back = w.onDecision(2, 17 * 60_000);
        expect(back).toMatchObject({ userId: 2, state: 'recovered' });
        // and then goes quiet again
        expect(w.onDecision(2, 18 * 60_000)).toBeNull();
    });

    it('warns again if it starves a second time', () => {
        w.onDecision(2, 0);
        w.onArmedSkip(2, 'X', 16 * 60_000);
        w.onDecision(2, 17 * 60_000);
        expect(w.onArmedSkip(2, 'X', 40 * 60_000)).not.toBeNull();
    });

    it('keeps users apart', () => {
        w.onDecision(1, 0);
        w.onDecision(2, 0);
        expect(w.onArmedSkip(2, 'X', 16 * 60_000)).not.toBeNull();
        expect(w.onArmedSkip(1, 'X', 16 * 60_000)).not.toBeNull();
    });

    it('a user never seen before starts its clock instead of warning at once', () => {
        // otherwise every fresh boot would warn about everyone
        expect(w.onArmedSkip(9, 'X', 1_000_000)).toBeNull();
        expect(w.onArmedSkip(9, 'X', 1_000_000 + 16 * 60_000)).not.toBeNull();
    });

    it('never throws on nonsense', () => {
        expect(() => w.onArmedSkip(null, null, NaN)).not.toThrow();
        expect(w.onArmedSkip(null, 'X', 1)).toBeNull();
        expect(w.onDecision(undefined, 1)).toBeNull();
    });

    it('stays bounded — it cannot grow forever on a long-lived server', () => {
        // The guarantee is a BOUND, not a fixed number: the sweep runs once the
        // map passes its limit and drops whoever has not been seen for a day.
        const limit = W.MAX_TRACKED;
        for (let uid = 1000; uid < 1000 + limit + 200; uid++) w.onDecision(uid, 0);
        expect(w.size()).toBeGreaterThan(limit);          // grown past the limit
        w.onDecision(1, W.FORGET_MS + 1000);              // a day later
        expect(w.size()).toBeLessThanOrEqual(2);          // the old ones are gone
    });
});
