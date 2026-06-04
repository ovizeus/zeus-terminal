'use strict';

// [MARGIN-IDEMPOTENT 2026-06-04] The last blocker in the AT-execution chain.
// binanceOps.ensureSymbolReady set the margin type via sendSignedRequest, which
// THROWS on Binance error codes (binanceSigner.js:294, err.code preserved). The
// existing `marginResp.code !== -4046` check was dead on the throw path, so
// Binance code -4046 ("No need to change margin type" — the symbol is ALREADY
// CROSSED, a benign idempotent no-op) propagated as a fatal LEVERAGE_FAILED and
// blocked every entry → zombie cleanup. Tolerate -4046 in catch; other errors
// still block.

let mockSend = jest.fn();
jest.mock('../../server/services/database', () => ({
    db: { prepare: () => ({ get: () => null, run: () => ({}), all: () => [] }) },
}));
jest.mock('../../server/services/binanceSigner', () => ({ sendSignedRequest: (...a) => mockSend(...a) }));

const binanceOps = require('../../server/services/binanceOps');

beforeEach(() => { mockSend = jest.fn(); });

function thrower(code, msg) { const e = new Error(msg); e.code = code; return Promise.reject(e); }
const READY = { symbol: 'BTCUSDT', leverage: 5, marginMode: 'CROSSED' };

describe('ensureSymbolReady — margin-type -4046 idempotency (Binance throws, not returns)', () => {
    test('THE FIX: marginType throws -4046 ("No need to change margin type") → ok:true', async () => {
        mockSend
            .mockImplementationOnce(() => Promise.resolve({ leverage: 5, symbol: 'BTCUSDT' })) // leverage OK
            .mockImplementationOnce(() => thrower(-4046, 'Binance API error: No need to change margin type.')); // marginType
        const r = await binanceOps.ensureSymbolReady('1', READY, { apiKey: 'k', apiSecret: 's' });
        expect(r.ok).toBe(true);
        expect(r.marginMode).toBe('CROSSED');
    });

    test('happy path: leverage + marginType both succeed → ok:true', async () => {
        mockSend
            .mockImplementationOnce(() => Promise.resolve({ leverage: 5 }))
            .mockImplementationOnce(() => Promise.resolve({ marginType: 'CROSSED' }));
        const r = await binanceOps.ensureSymbolReady('1', READY, {});
        expect(r.ok).toBe(true);
    });

    test('a DIFFERENT margin error (e.g. -4047) still blocks → ok:false', async () => {
        mockSend
            .mockImplementationOnce(() => Promise.resolve({ leverage: 5 }))
            .mockImplementationOnce(() => thrower(-4047, 'Binance API error: Margin type cannot be changed if there exists position.'));
        const r = await binanceOps.ensureSymbolReady('1', READY, {});
        expect(r.ok).toBe(false);
    });

    test('returned (non-thrown) -4046 object is also tolerated (defensive, unchanged path) → ok:true', async () => {
        mockSend
            .mockImplementationOnce(() => Promise.resolve({ leverage: 5 }))
            .mockImplementationOnce(() => Promise.resolve({ code: -4046, msg: 'No need to change margin type.' }));
        const r = await binanceOps.ensureSymbolReady('1', READY, {});
        expect(r.ok).toBe(true);
    });
});
