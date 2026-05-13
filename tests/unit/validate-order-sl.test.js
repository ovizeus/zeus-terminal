/**
 * Zeus Terminal — Unit Tests: validateOrderBody SL enforcement (BUG-T5 2026-05-13)
 *
 * Defense-in-depth guard: live mode orders MUST include valid SL.
 * Demo mode unchanged — SL=null/missing acceptable (per Mirela manual playground).
 *
 * Operator-mandated edge cases (BUG-T5 2026-05-13):
 *   0, "0", null, undefined, negative values, NaN, Infinity, malformed decimals.
 */
'use strict';

const { validateOrderBody } = require('../../server/middleware/validate');

// Helper: mock req/res/next
function makeReqRes(body) {
    return {
        req: { body },
        res: {
            statusCode: null,
            jsonBody: null,
            status(c) { this.statusCode = c; return this; },
            json(b) { this.jsonBody = b; return this; }
        },
        next: jest.fn()
    };
}

// Helper: valid base order body (all required fields except sl)
function baseLiveOrder(extras) {
    return Object.assign({
        symbol: 'BTCUSDT',
        side: 'BUY',
        type: 'MARKET',
        quantity: 0.001,
        leverage: 5,
        mode: 'live'
    }, extras || {});
}

function baseDemoOrder(extras) {
    return Object.assign({
        symbol: 'BTCUSDT',
        side: 'BUY',
        type: 'MARKET',
        quantity: 0.001,
        leverage: 5,
        mode: 'demo'
    }, extras || {});
}

describe('BUG-T5: validateOrderBody enforces SL for live mode', () => {

    // ══════════════ LIVE mode — SL REQUIRED ══════════════

    describe('live mode REJECTS missing/invalid SL', () => {
        test.each([
            ['undefined (missing field)',     baseLiveOrder()],
            ['null',                          baseLiveOrder({ sl: null })],
            ['empty string ""',               baseLiveOrder({ sl: '' })],
            ['zero number 0',                 baseLiveOrder({ sl: 0 })],
            ['zero string "0"',               baseLiveOrder({ sl: '0' })],
            ['zero decimal "0.0"',            baseLiveOrder({ sl: '0.0' })],
            ['zero scientific "0e0"',         baseLiveOrder({ sl: '0e0' })],
            ['negative number -100',          baseLiveOrder({ sl: -100 })],
            ['negative string "-100.5"',      baseLiveOrder({ sl: '-100.5' })],
            ['negative zero -0',              baseLiveOrder({ sl: -0 })],
            ['NaN literal',                   baseLiveOrder({ sl: NaN })],
            ['NaN string "NaN"',              baseLiveOrder({ sl: 'NaN' })],
            ['Infinity literal',              baseLiveOrder({ sl: Infinity })],
            ['negative Infinity',             baseLiveOrder({ sl: -Infinity })],
            ['malformed "abc"',               baseLiveOrder({ sl: 'abc' })],
            ['malformed "1.2.3"',             baseLiveOrder({ sl: '1.2.3' })],
            ['object {}',                     baseLiveOrder({ sl: {} })],
            ['array [50000]',                 baseLiveOrder({ sl: [50000] })],
            ['boolean false',                 baseLiveOrder({ sl: false })],
            ['boolean true',                  baseLiveOrder({ sl: true })],
        ])('live mode WITH sl=%s → 400', (_label, body) => {
            const { req, res, next } = makeReqRes(body);
            validateOrderBody(req, res, next);
            expect(res.statusCode).toBe(400);
            expect(res.jsonBody).toHaveProperty('error');
            expect(res.jsonBody.error).toMatch(/SL required/i);
            expect(next).not.toHaveBeenCalled();
        });
    });

    // ══════════════ LIVE mode — SL VALID ══════════════

    describe('live mode ACCEPTS valid SL', () => {
        test.each([
            ['positive number',           50000],
            ['positive decimal',          50000.5],
            ['positive string',           '50000'],
            ['positive string decimal',   '50000.5'],
            ['small positive 0.00001',    0.00001],
            ['very small string',         '1e-8'],
            ['large number',              999999999],
        ])('live mode WITH sl=%s → next() called', (_label, sl) => {
            const { req, res, next } = makeReqRes(baseLiveOrder({ sl }));
            validateOrderBody(req, res, next);
            expect(next).toHaveBeenCalled();
            expect(res.statusCode).toBe(null);  // no 400 set
        });
    });

    // ══════════════ DEMO mode — SL EXEMPT (Mirela playground pattern) ══════════════

    describe('demo mode EXEMPT (SL allowed null/missing)', () => {
        test.each([
            ['undefined (missing)',  baseDemoOrder()],
            ['null',                 baseDemoOrder({ sl: null })],
            ['empty string',         baseDemoOrder({ sl: '' })],
            ['zero',                 baseDemoOrder({ sl: 0 })],
            ['negative',             baseDemoOrder({ sl: -100 })],
            ['NaN',                  baseDemoOrder({ sl: NaN })],
        ])('demo mode WITH sl=%s → passes (next called)', (_label, body) => {
            const { req, res, next } = makeReqRes(body);
            validateOrderBody(req, res, next);
            expect(next).toHaveBeenCalled();
            expect(res.statusCode).toBe(null);
        });

        test('demo mode WITH valid sl → passes', () => {
            const { req, res, next } = makeReqRes(baseDemoOrder({ sl: 50000 }));
            validateOrderBody(req, res, next);
            expect(next).toHaveBeenCalled();
        });
    });

    // ══════════════ NO mode field — default behavior ══════════════

    describe('no mode field (legacy/undefined) → SL NOT enforced (backwards-compat)', () => {
        test('no mode + no sl → passes (no enforcement triggered)', () => {
            const body = baseLiveOrder();
            delete body.mode;
            const { req, res, next } = makeReqRes(body);
            validateOrderBody(req, res, next);
            expect(next).toHaveBeenCalled();
        });

        test('mode="testnet" + no sl → passes (only live triggers enforcement)', () => {
            const { req, res, next } = makeReqRes(baseLiveOrder({ mode: 'testnet' }));
            validateOrderBody(req, res, next);
            expect(next).toHaveBeenCalled();
        });
    });

    // ══════════════ Pre-existing validators NOT regressed ══════════════

    describe('pre-existing validators still work (zero regression)', () => {
        test('invalid symbol → 400 (pre-existing guard)', () => {
            const { req, res, next } = makeReqRes(baseLiveOrder({ symbol: 'bad symbol!', sl: 50000 }));
            validateOrderBody(req, res, next);
            expect(res.statusCode).toBe(400);
            expect(res.jsonBody.error).toMatch(/symbol/i);
        });

        test('invalid quantity → 400 (pre-existing guard)', () => {
            const { req, res, next } = makeReqRes(baseLiveOrder({ quantity: -1, sl: 50000 }));
            validateOrderBody(req, res, next);
            expect(res.statusCode).toBe(400);
            expect(res.jsonBody.error).toMatch(/quantity/i);
        });
    });
});
