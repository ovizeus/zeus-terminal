'use strict';

/**
 * Build Your Own Indicator — pricing, states and the billing gate.
 *
 * [2026-11-06] Kept as a pure module with no database and no express, so the
 * rules that decide MONEY can be tested without booting anything.
 *
 * Operator decisions, 2026-11-06:
 *   - three tiers, not one flat price: a flat price is either too cheap to
 *     cover a real build or too dear for a rename, and it gives no escape
 *     from an unbounded request arriving at a fixed price;
 *   - a declined request is REFUNDED, automatically. Money in means an
 *     obligation out, and being able to decline cleanly is what makes it
 *     safe to decline at all.
 */

/** Tiers. price_cents is the single source of truth — never hardcode a price. */
const TIERS = Object.freeze({
    signature: Object.freeze({
        id: 'signature',
        label: 'Signature',
        price_cents: 2900,
        quote_only: false,
        blurb: 'Your name and your colours on an existing engine.',
    }),
    custom: Object.freeze({
        id: 'custom',
        label: 'Custom',
        price_cents: 14900,
        quote_only: false,
        blurb: 'A new indicator built from your spec, within a bounded scope.',
    }),
    bespoke: Object.freeze({
        id: 'bespoke',
        label: 'Bespoke',
        price_cents: 0,
        quote_only: true,
        blurb: 'Anything larger. You describe it, we quote it, you decide.',
    }),
});
const TIER_IDS = Object.freeze(Object.keys(TIERS));
const CURRENCY = 'USD';

/**
 * Billing modes.
 *   disabled — the shipped default while Zeus is pre-launch. Ordinary users
 *              cannot submit at all; an admin can, so the whole flow is
 *              walkable end to end, and those rows are stamped as bypasses so
 *              they can never be mistaken for a payment.
 *   test     — anyone may submit without paying. For a staging box only.
 *   live     — a real payment reference is required. With no provider wired
 *              this FAILS CLOSED: it refuses the order rather than handing out
 *              paid work for free, which is the direction a mistake must fall.
 */
const BILLING_MODES = Object.freeze(['disabled', 'test', 'live']);
const DEFAULT_BILLING_MODE = 'disabled';

function billingMode(env) {
    const raw = (env && env.BYOI_BILLING_MODE) || DEFAULT_BILLING_MODE;
    return BILLING_MODES.indexOf(raw) === -1 ? DEFAULT_BILLING_MODE : raw;
}

/** Request lifecycle. Anything not listed is not a legal move. */
const STATUS = Object.freeze({
    DRAFT: 'draft',
    AWAITING_PAYMENT: 'awaiting_payment',
    PAID: 'paid',
    IN_PROGRESS: 'in_progress',
    DELIVERED: 'delivered',
    DECLINED: 'declined',
    REFUNDED: 'refunded',
});
const TRANSITIONS = Object.freeze({
    draft: Object.freeze(['awaiting_payment', 'paid']),
    awaiting_payment: Object.freeze(['paid', 'draft']),
    paid: Object.freeze(['in_progress', 'declined']),
    in_progress: Object.freeze(['delivered', 'declined']),
    delivered: Object.freeze([]),
    declined: Object.freeze(['refunded']),
    refunded: Object.freeze([]),
});

function canTransition(from, to) {
    const allowed = TRANSITIONS[from];
    return Array.isArray(allowed) && allowed.indexOf(to) !== -1;
}

/** A draft is the only thing the user may edit or delete. */
function isEditable(status) { return status === STATUS.DRAFT; }

/** Declining always owes the money back — that was the operator's decision. */
function refundOwed(status) { return status === STATUS.DECLINED; }

function priceCentsFor(tierId) {
    const t = TIERS[tierId];
    if (!t) return null;
    return t.price_cents;
}

/**
 * The gate. Returns { allowed, reason, status, paymentRef } and NEVER throws:
 * a thrown error here would be a 500 on a money path.
 */
function evaluateSubmission({ tier, mode, isAdmin, paymentRef }) {
    if (!TIERS[tier]) {
        return { allowed: false, reason: 'unknown_tier' };
    }
    // A bespoke order is quoted by hand, so it is never charged up front.
    if (TIERS[tier].quote_only) {
        return { allowed: true, reason: 'quote_only', status: STATUS.PAID, paymentRef: null };
    }
    if (mode === 'live') {
        if (typeof paymentRef === 'string' && paymentRef.trim().length > 0) {
            return { allowed: true, reason: 'paid', status: STATUS.PAID, paymentRef: paymentRef.trim() };
        }
        // No provider wired yet: refuse rather than give the work away.
        return { allowed: false, reason: 'payment_required', status: STATUS.AWAITING_PAYMENT };
    }
    if (mode === 'test') {
        return { allowed: true, reason: 'bypass_test', status: STATUS.PAID, paymentRef: 'BYPASS:test' };
    }
    // disabled
    if (isAdmin) {
        return { allowed: true, reason: 'bypass_admin', status: STATUS.PAID, paymentRef: 'BYPASS:admin-test' };
    }
    return { allowed: false, reason: 'not_launched' };
}

/** True when a payment reference marks a bypass rather than real money. */
function isBypass(paymentRef) {
    return typeof paymentRef === 'string' && paymentRef.indexOf('BYPASS:') === 0;
}

function formatPrice(cents) {
    if (!Number.isFinite(cents)) return '';
    return '$' + (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}

module.exports = {
    TIERS, TIER_IDS, CURRENCY,
    BILLING_MODES, DEFAULT_BILLING_MODE, billingMode,
    STATUS, TRANSITIONS, canTransition, isEditable, refundOwed,
    priceCentsFor, evaluateSubmission, isBypass, formatPrice,
};
