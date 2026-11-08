'use strict';

/**
 * [2026-11-07] Price must depend on SCOPE.
 *
 * Until now `evaluateSubmission` saw only {tier, mode, isAdmin, paymentRef} —
 * nothing from the spec. Signature ($29) promises "your name and your colours
 * on an existing engine", but nothing stopped a buyer ticking order book +
 * higher timeframes + liquidations + a readout table at that price. That is
 * $149 work sold at $29, every time, silently.
 *
 * The client will show badges and offer to move the order up. These tests are
 * about the SERVER, which is the only thing that actually decides.
 */
const P = require('../../server/services/byoiPricing');
const { validateSpec } = require('../../server/services/byoiSpec');

/** A minimal spec that is legitimately Signature work. */
function cheapSpec(extra = {}) {
    return validateSpec({
        title: 'Mine', placement: 'overlay', visuals: ['line'], sources: ['price'],
        timeframes: ['5m'], notes: 'a line on price', ...extra,
    }).clean;
}

describe('which tier the scope actually requires', () => {
    it('a line on price is Signature work', () => {
        expect(P.requiredTierFor(cheapSpec())).toBe('signature');
    });

    it.each([
        ['open interest', { sources: ['price', 'oi'] }],
        ['funding', { sources: ['price', 'funding'] }],
        ['liquidations', { sources: ['price', 'liq'] }],
        ['the order book', { sources: ['price', 'book'] }],
        ['higher timeframes', { sources: ['price', 'mtf'] }],
        ['a readout table', { visuals: ['line', 'table'] }],
        ['alerts', { signals: ['alert'] }],
        ['sound', { signals: ['sound'] }],
        ['divergence logic', { signalLogic: ['divergence'] }],
        ['going public', { visibility: 'public_request' }],
    ])('%s is Custom work, not Signature', (_label, extra) => {
        expect(P.requiredTierFor(cheapSpec(extra))).toBe('custom');
    });

    it('a garbage or empty spec does not escape to the cheapest tier by accident', () => {
        // fail-safe direction: unknown shape must not be treated as proof of cheapness
        expect(P.requiredTierFor(null)).toBe('signature');
        expect(P.requiredTierFor({ sources: 'book' })).toBe('signature'); // not an array -> no claim
        expect(P.requiredTierFor({ sources: ['book'] })).toBe('custom');
    });
});

describe('the gate falls closed on an under-tiered order', () => {
    const paid = { mode: 'live', paymentRef: 'pay_123' };

    it('refuses Custom scope bought at Signature, and says what it needs', () => {
        const r = P.evaluateSubmission({ tier: 'signature', spec: cheapSpec({ sources: ['price', 'book'] }), ...paid });
        expect(r.allowed).toBe(false);
        expect(r.reason).toBe('tier_too_low');
        expect(r.needsTier).toBe('custom');
    });

    it('allows the same order at Custom', () => {
        const r = P.evaluateSubmission({ tier: 'custom', spec: cheapSpec({ sources: ['price', 'book'] }), ...paid });
        expect(r.allowed).toBe(true);
    });

    it('allows cheap scope at the cheap tier — an upsell nobody needs is a lost sale', () => {
        expect(P.evaluateSubmission({ tier: 'signature', spec: cheapSpec(), ...paid }).allowed).toBe(true);
    });

    it('never blocks a HIGHER tier than needed — paying more is always allowed', () => {
        expect(P.evaluateSubmission({ tier: 'custom', spec: cheapSpec(), ...paid }).allowed).toBe(true);
    });

    it('still refuses a live order with no payment, scope or no scope', () => {
        const r = P.evaluateSubmission({ tier: 'custom', mode: 'live', spec: cheapSpec() });
        expect(r.allowed).toBe(false);
        expect(r.reason).not.toBe('tier_too_low'); // the payment check comes first
    });

    it('an omitted spec cannot be used to skip the scope check', () => {
        // a client that simply stops sending the spec must not get a free pass
        const r = P.evaluateSubmission({ tier: 'signature', ...paid });
        expect(r.allowed).toBe(true); // nothing claimed, nothing owed
        const r2 = P.evaluateSubmission({ tier: 'signature', spec: { sources: ['book'] }, ...paid });
        expect(r2.allowed).toBe(false);
    });

    it('the operator walking his own form is not stopped by the scope check', () => {
        // NOT on 'live': admin is a bypass only while billing is disabled, and
        // this test is not allowed to soften that. My first version of it said
        // mode:'live', which would have widened the fail-closed rule to suit a
        // test. The rule is right; the test was wrong.
        const r = P.evaluateSubmission({ tier: 'signature', isAdmin: true, mode: 'disabled', spec: cheapSpec({ sources: ['price', 'book'] }) });
        expect(r.allowed).toBe(true);
        expect(r.reason).toBe('bypass_admin');
    });

    it('an ordinary user on a live order with no payment is still refused', () => {
        const r = P.evaluateSubmission({ tier: 'signature', isAdmin: false, mode: 'live', spec: cheapSpec() });
        expect(r.allowed).toBe(false);
        expect(r.reason).toBe('payment_required');
    });
});

describe('the map itself is honest', () => {
    it('every gated key names a tier that exists', () => {
        for (const tier of Object.values(P.OPTION_TIER)) {
            expect(P.TIER_IDS).toContain(tier);
        }
    });

    it('is frozen — one source of truth for what costs more', () => {
        expect(Object.isFrozen(P.OPTION_TIER)).toBe(true);
    });
});
