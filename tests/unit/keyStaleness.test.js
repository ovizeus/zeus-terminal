'use strict';

/**
 * [2026-11-07] Which exchange keys stopped passing their daily check.
 *
 * The case this exists for is real: an account on the live box read
 * status = 'verified' with a last-verified date four months old, while the
 * daily check had been failing on that key the whole time. The user now sees
 * it; this is so the operator does too.
 */
const K = require('../../server/services/keyStaleness');

const DAY = 86400000;
const NOW = Date.parse('2026-11-07T06:00:00Z');
const row = (o) => Object.assign({
    user_id: 2, exchange: 'bybit', mode: 'testnet',
    status: 'verified', is_active: 1,
    last_verified_at: new Date(NOW - 10 * DAY).toISOString(), email: 'u@x.test',
}, o);

describe('which accounts to report', () => {
    it('reports one whose check has not succeeded for days', () => {
        const out = K.staleAccounts([row({})], NOW);
        expect(out).toHaveLength(1);
        expect(out[0].days).toBe(10);
        expect(out[0].userId).toBe(2);
        expect(out[0].exchange).toBe('bybit');
    });

    it('says nothing about one checked today or yesterday', () => {
        expect(K.staleAccounts([row({ last_verified_at: new Date(NOW).toISOString() })], NOW)).toHaveLength(0);
        expect(K.staleAccounts([row({ last_verified_at: new Date(NOW - DAY).toISOString() })], NOW)).toHaveLength(0);
    });

    it('ignores an account someone disconnected on purpose', () => {
        // not a problem to report — it is a decision somebody made
        expect(K.staleAccounts([row({ status: 'disconnected' })], NOW)).toHaveLength(0);
    });

    it('catches the real case from the live box', () => {
        const out = K.staleAccounts([row({ last_verified_at: '2026-07-13 15:33:00' })], NOW);
        expect(out).toHaveLength(1);
        expect(out[0].days).toBeGreaterThan(100);
    });

    it('puts the worst first, so the oldest is read first', () => {
        const out = K.staleAccounts([
            row({ user_id: 5, last_verified_at: new Date(NOW - 3 * DAY).toISOString() }),
            row({ user_id: 2, last_verified_at: new Date(NOW - 99 * DAY).toISOString() }),
        ], NOW);
        expect(out.map((r) => r.userId)).toEqual([2, 5]);
    });
});

describe('what it refuses to invent', () => {
    it('a never-verified account is not reported as stale', () => {
        expect(K.staleAccounts([row({ last_verified_at: null })], NOW)).toHaveLength(0);
        expect(K.staleAccounts([row({ last_verified_at: '' })], NOW)).toHaveLength(0);
    });

    it('an unreadable date is not reported either — guessing is worse than silence', () => {
        expect(K.staleAccounts([row({ last_verified_at: 'whenever' })], NOW)).toHaveLength(0);
    });

    it('a future date is a clock problem, not an expired key', () => {
        expect(K.staleAccounts([row({ last_verified_at: new Date(NOW + 5 * DAY).toISOString() })], NOW)).toHaveLength(0);
    });

    it('survives junk rows rather than taking the admin page down with it', () => {
        expect(() => K.staleAccounts([null, {}, undefined, 7], NOW)).not.toThrow();
        expect(K.staleAccounts(null, NOW)).toEqual([]);
    });
});
