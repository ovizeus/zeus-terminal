'use strict';

/**
 * [2026-11-06] Build Your Own Indicator — the rules that decide MONEY.
 *
 * The tests that matter here are the ones about the gate falling CLOSED. A bug
 * that refuses a paying customer costs one sale; a bug that hands out a $149
 * build for free costs every time it is hit, silently, and nobody reports it.
 */
const P = require('../../server/services/byoiPricing');

describe('BYOI tiers', () => {
    it('prices the three tiers the operator chose', () => {
        expect(P.TIERS.signature.price_cents).toBe(2900);
        expect(P.TIERS.custom.price_cents).toBe(14900);
        expect(P.TIERS.bespoke.quote_only).toBe(true);
    });

    it('is the single source of truth — tiers are frozen', () => {
        expect(Object.isFrozen(P.TIERS)).toBe(true);
        expect(Object.isFrozen(P.TIERS.custom)).toBe(true);
        expect(() => { 'use strict'; P.TIERS.custom.price_cents = 1; }).toThrow();
    });

    it('formats prices without stray cents', () => {
        expect(P.formatPrice(2900)).toBe('$29');
        expect(P.formatPrice(14900)).toBe('$149');
        expect(P.formatPrice(1250)).toBe('$12.50');
        expect(P.formatPrice(NaN)).toBe('');
    });

    it('has no price for an unknown tier', () => {
        expect(P.priceCentsFor('platinum')).toBeNull();
    });
});

describe('BYOI billing mode', () => {
    it('defaults to disabled when unset', () => {
        expect(P.billingMode({})).toBe('disabled');
        expect(P.billingMode(undefined)).toBe('disabled');
    });

    it('falls back to disabled on a value it does not recognise', () => {
        // a typo in .env must not silently open the gate
        expect(P.billingMode({ BYOI_BILLING_MODE: 'LIVE' })).toBe('disabled');
        expect(P.billingMode({ BYOI_BILLING_MODE: 'yes' })).toBe('disabled');
        expect(P.billingMode({ BYOI_BILLING_MODE: '' })).toBe('disabled');
    });

    it('accepts the three real modes', () => {
        expect(P.billingMode({ BYOI_BILLING_MODE: 'live' })).toBe('live');
        expect(P.billingMode({ BYOI_BILLING_MODE: 'test' })).toBe('test');
        expect(P.billingMode({ BYOI_BILLING_MODE: 'disabled' })).toBe('disabled');
    });
});

describe('BYOI submission gate — the money path', () => {
    it('refuses an ordinary user while billing is disabled', () => {
        const r = P.evaluateSubmission({ tier: 'custom', mode: 'disabled', isAdmin: false });
        expect(r.allowed).toBe(false);
        expect(r.reason).toBe('not_launched');
    });

    it('lets the admin walk the flow, stamped as a bypass', () => {
        const r = P.evaluateSubmission({ tier: 'custom', mode: 'disabled', isAdmin: true });
        expect(r.allowed).toBe(true);
        expect(r.status).toBe('paid');
        expect(P.isBypass(r.paymentRef)).toBe(true);
    });

    it('FAILS CLOSED in live mode with no payment reference', () => {
        for (const ref of [undefined, null, '', '   ', 0, false, {}]) {
            const r = P.evaluateSubmission({ tier: 'custom', mode: 'live', isAdmin: false, paymentRef: ref });
            expect(r.allowed).toBe(false);
            expect(r.reason).toBe('payment_required');
        }
    });

    it('does not let an admin skip payment once billing is live', () => {
        const r = P.evaluateSubmission({ tier: 'custom', mode: 'live', isAdmin: true });
        expect(r.allowed).toBe(false);
    });

    it('accepts a real payment reference in live mode', () => {
        const r = P.evaluateSubmission({ tier: 'signature', mode: 'live', isAdmin: false, paymentRef: ' pi_123 ' });
        expect(r.allowed).toBe(true);
        expect(r.status).toBe('paid');
        expect(r.paymentRef).toBe('pi_123');
        expect(P.isBypass(r.paymentRef)).toBe(false);
    });

    it('never charges up front for a bespoke order — it is quoted by hand', () => {
        const r = P.evaluateSubmission({ tier: 'bespoke', mode: 'live', isAdmin: false });
        expect(r.allowed).toBe(true);
        expect(r.paymentRef).toBeNull();
    });

    it('rejects an unknown tier in every mode', () => {
        for (const mode of P.BILLING_MODES) {
            const r = P.evaluateSubmission({ tier: 'free', mode, isAdmin: true, paymentRef: 'pi_1' });
            expect(r.allowed).toBe(false);
            expect(r.reason).toBe('unknown_tier');
        }
    });

    it('never throws, whatever it is handed', () => {
        const junk = [undefined, null, {}, { tier: 1 }, { tier: 'custom', mode: 'nope' }];
        for (const arg of junk) {
            expect(() => P.evaluateSubmission(arg || {})).not.toThrow();
        }
    });
});

describe('BYOI lifecycle', () => {
    it('only a draft can be edited', () => {
        expect(P.isEditable('draft')).toBe(true);
        for (const s of ['awaiting_payment', 'paid', 'in_progress', 'delivered', 'declined', 'refunded']) {
            expect(P.isEditable(s)).toBe(false);
        }
    });

    it('declining owes a refund, and nothing else does', () => {
        expect(P.refundOwed('declined')).toBe(true);
        for (const s of ['draft', 'paid', 'in_progress', 'delivered', 'refunded']) {
            expect(P.refundOwed(s)).toBe(false);
        }
    });

    it('allows only the legal moves', () => {
        expect(P.canTransition('paid', 'in_progress')).toBe(true);
        expect(P.canTransition('in_progress', 'delivered')).toBe(true);
        expect(P.canTransition('declined', 'refunded')).toBe(true);
    });

    it('refuses to walk money backwards or sideways', () => {
        expect(P.canTransition('delivered', 'paid')).toBe(false);
        expect(P.canTransition('refunded', 'paid')).toBe(false);
        expect(P.canTransition('draft', 'delivered')).toBe(false);
        expect(P.canTransition('draft', 'in_progress')).toBe(false);
        expect(P.canTransition('nonsense', 'paid')).toBe(false);
    });

    it('delivered and refunded are terminal', () => {
        expect(P.TRANSITIONS.delivered).toHaveLength(0);
        expect(P.TRANSITIONS.refunded).toHaveLength(0);
    });
});
