'use strict';

/**
 * [2026-11-08] "It must work for everyone who connects."
 *
 * Seven of eight accounts now trade. The eighth (uid=5) receives nothing
 * because its owner switched autotrade OFF — proven from its saved state, not
 * assumed. I did not arm it: turning autotrade on for an account whose owner
 * turned it off is a money-path action taken on my own initiative, and a
 * system that armed disarmed accounts by itself would be a worse bug than the
 * one fixed today.
 *
 * So the remaining question — does a disarmed account enter once it arms? — is
 * answered here instead, against the real gate, for an arbitrary user id that
 * belongs to nobody. This is the gate the brain cycle consults first:
 *
 *     if (!serverAT.isATActive(userId)) continue;
 */
const serverAT = require('../../server/services/serverAT');

/** An id no real account uses, so nothing live is touched. */
const GHOST = 987654;

describe('any account that arms gets into the loop', () => {
    it('starts DISARMED — nobody is ever armed by accident', () => {
        expect(serverAT.isATActive(GHOST)).toBe(false);
    });

    it('arming it opens the gate the brain checks first', () => {
        const res = serverAT.toggleActive(GHOST, true, 'demo');
        expect(res.ok).toBe(true);
        expect(serverAT.isATActive(GHOST)).toBe(true);
    });

    it('and disarming closes it again', () => {
        serverAT.toggleActive(GHOST, false, 'demo');
        expect(serverAT.isATActive(GHOST)).toBe(false);
    });

    it('will not put an account on real money without credentials', () => {
        // Stronger than what I first asserted. I expected the live switch to
        // succeed and merely not inherit demo's armed flag; it is REFUSED
        // outright, which is the better guarantee — an account cannot reach
        // real money by flipping a mode.
        serverAT.toggleActive(GHOST, true, 'demo');
        expect(serverAT.isATActive(GHOST)).toBe(true);

        const res = serverAT.setMode(GHOST, 'live');
        expect(res.ok).toBe(false);
        expect(String(res.error)).toMatch(/credentials/i);
        expect(serverAT.getMode(GHOST)).toBe('demo');   // stayed where it was

        serverAT.toggleActive(GHOST, false, 'demo');
    });

    it('demo and live are stored apart, so one cannot arm the other', () => {
        serverAT.toggleActive(GHOST, true, 'demo');
        const st = serverAT.getUserState ? serverAT.getUserState(GHOST) : null;
        if (st) {
            expect(st.atActiveDemo).toBe(true);
            expect(st.atActiveLive).toBe(false);        // untouched by the demo toggle
        }
        serverAT.toggleActive(GHOST, false, 'demo');
    });

    it('a brand-new id defaults to demo, never to live', () => {
        const FRESH = 987655;
        expect(serverAT.getMode(FRESH)).toBe('demo');
        expect(serverAT.isATActive(FRESH)).toBe(false);
    });

    it('refuses nonsense instead of guessing', () => {
        expect(serverAT.toggleActive(null, true, 'demo').ok).toBe(false);
        expect(serverAT.toggleActive(GHOST, 'yes', 'demo').ok).toBe(false);
    });

    it('one account arming does not arm another', () => {
        const A = 987656, B = 987657;
        serverAT.toggleActive(A, true, 'demo');
        expect(serverAT.isATActive(A)).toBe(true);
        expect(serverAT.isATActive(B)).toBe(false);
        serverAT.toggleActive(A, false, 'demo');
    });
});
