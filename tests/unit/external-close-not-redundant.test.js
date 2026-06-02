'use strict';
/**
 * Zeus Terminal — SP2-7b money-path regression test (companion to
 * external-close-reaches-exchange.test.js).
 *
 * BUG: onUserDataEvent handled an externally-closed EXTERNAL position by calling
 * BOTH _closePosition(...,'EXTERNAL_CLOSE',...) (which internally fires
 * _handleLiveExit since commit ee441f30) AND a redundant explicit
 * _handleLiveExit(...,'EXTERNAL_CLOSE',...). Result: _handleLiveExit('EXTERNAL_CLOSE')
 * ran TWICE → two concurrent reduceOnly closePosition attempts on an
 * already-zero position → both rejected, retry loops exhaust.
 *
 * Semantically EXTERNAL_CLOSE means the exchange ALREADY closed the position →
 * Zeus must send NO close order (same as RECON_PHANTOM / RECON_EXCHANGE_CLOSED).
 *
 * KEY ASSERTIONS:
 *  - EXTERNAL_CLOSE on an EXTERNAL position does NOT call exchangeOps.closePosition.
 *  - HIT_SL on an EXTERNAL position STILL calls exchangeOps.closePosition once
 *    (regression guard — Part 1 must not break the server-net SL close).
 */

const mockExchangeOps = {
    closePosition: jest.fn().mockResolvedValue({ ok: true, avgFillPrice: 65660, orderId: 'X1' }),
    cancelOrder: jest.fn().mockResolvedValue({ ok: true }),
    placeStopLoss: jest.fn().mockResolvedValue({ ok: true, slOrderId: 'SL1' }),
};
jest.mock('../../server/services/exchangeOps', () => mockExchangeOps);

jest.mock('../../server/services/database', () => ({
    db: { prepare: jest.fn(() => ({ all: jest.fn(() => []), run: jest.fn() })) },
    atGetState: jest.fn(() => null),
    atSetState: jest.fn(),
    saveMissedTrade: jest.fn(),
    auditLog: jest.fn(),
    getOpenPositionsForUser: jest.fn(() => []),
    getOpenPositions: jest.fn(() => []),
    getRecentActions: jest.fn(() => []),
    getLastActiveAt: jest.fn(() => null),
    setLastActiveAt: jest.fn(),
    getMaxSeq: jest.fn(() => 0),
    getGhostCandidates: jest.fn(() => []),
    deleteAtPosition: jest.fn(),
    saveAtPosition: jest.fn(),
    moveToClosedAtomic: jest.fn(),
    getRecentClosedForUser: jest.fn(() => []),
    countOpenPositions: jest.fn(() => 0),
}));

jest.mock('../../server/services/binanceSigner', () => ({
    sendSignedRequest: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../server/services/telegram', () => ({
    sendToUser: jest.fn(),
    alertOrderFilled: jest.fn(),
    notifyUser: jest.fn(),
}));

jest.mock('@sentry/node', () => ({
    init: jest.fn(),
    captureMessage: jest.fn(),
    captureException: jest.fn(),
    withScope: jest.fn((fn) => fn({ setUser: jest.fn(), setTag: jest.fn(), setExtra: jest.fn() })),
    setUser: jest.fn(),
    setContext: jest.fn(),
}));

jest.mock('../../server/services/exchangeInfo', () => ({
    roundOrderParams: jest.fn((sym, qty) => ({ quantity: parseFloat(qty), price: 0 })),
    getFilters: jest.fn(() => ({ stepSize: '0.001', tickSize: '0.01', minQty: '0.001' })),
}));

jest.mock('../../server/services/credentialStore', () => {
    const _creds = (userId) => ({
        apiKey: 'test-stub-key-uid-' + userId,
        apiSecret: 'test-stub-secret-uid-' + userId,
        isTestnet: true,
        exchange: 'binance',
        mode: 'testnet',
        baseUrl: 'https://testnet.binancefuture.com',
    });
    return {
        getExchangeCreds: jest.fn((userId) => _creds(userId)),
        getExchangeCredsFor: jest.fn((userId) => _creds(userId)),
    };
});

const serverAT = require('../../server/services/serverAT.js');

describe('SP2-7b — EXTERNAL_CLOSE sends NO redundant exchange close', () => {
    beforeEach(() => {
        mockExchangeOps.closePosition.mockClear();
        mockExchangeOps.cancelOrder.mockClear();
    });

    test('EXTERNAL_CLOSE on an EXTERNAL position does NOT call exchangeOps.closePosition (exchange already closed it)', async () => {
        const d = { userId: 5, symbol: 'BTCUSDT', side: 'LONG', entryPrice: '67000', qty: '0.01', exchange: 'binance' };
        const pos = serverAT._buildExternalEntry(d, 42, 65660);
        expect(pos.live.status).toBe('EXTERNAL');

        await serverAT._handleLiveExit(pos, 'EXTERNAL_CLOSE', 65660, -13.4);

        expect(mockExchangeOps.closePosition).not.toHaveBeenCalled();
    });

    test('HIT_SL on an EXTERNAL position STILL calls exchangeOps.closePosition once (regression guard)', async () => {
        const d = { userId: 6, symbol: 'ETHUSDT', side: 'SHORT', entryPrice: '2300', qty: '0.5', exchange: 'binance' };
        const pos = serverAT._buildExternalEntry(d, 43, 2346);
        expect(pos.live.status).toBe('EXTERNAL');

        await serverAT._handleLiveExit(pos, 'HIT_SL', 2346, -23);

        expect(mockExchangeOps.closePosition).toHaveBeenCalledTimes(1);
    });
});
