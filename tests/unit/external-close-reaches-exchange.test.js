'use strict';
/**
 * Zeus Terminal — SP2-7b money-path regression test.
 *
 * BUG: adopted/external positions (live.status='EXTERNAL') were registered with a
 * server-side protective SL, but when the server net fired the SL-triggered close
 * the close was BLOCKED from reaching the exchange — _closePosition + _handleLiveExit
 * guards excluded 'EXTERNAL'. Result: position marked closed in Zeus memory but stays
 * OPEN + unprotected on the exchange (phantom).
 *
 * KEY ASSERTION: an EXTERNAL position's SL-triggered close REACHES
 * exchangeOps.closePosition with reduceOnly/MARKET semantics and the correct qty.
 */

// Mock exchangeOps so closePosition is observable + resolves ok.
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

// Provide stub creds so _handleLiveExit's `if (!creds) return` does not short-circuit.
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

describe('SP2-7b — EXTERNAL SL close reaches the exchange', () => {
    beforeEach(() => {
        mockExchangeOps.closePosition.mockClear();
        mockExchangeOps.cancelOrder.mockClear();
    });

    test('HIT_SL on an EXTERNAL position calls exchangeOps.closePosition with reduceOnly MARKET + correct qty', async () => {
        const d = { userId: 5, symbol: 'BTCUSDT', side: 'LONG', entryPrice: '67000', qty: '0.01', exchange: 'binance' };
        const pos = serverAT._buildExternalEntry(d, 42, 65660);
        expect(pos.live.status).toBe('EXTERNAL');

        await serverAT._handleLiveExit(pos, 'HIT_SL', 65660, -13.4);

        expect(mockExchangeOps.closePosition).toHaveBeenCalledTimes(1);
        const [calledUserId, args] = mockExchangeOps.closePosition.mock.calls[0];
        expect(calledUserId).toBe(5);
        expect(args.closeType).toBe('MARKET');
        expect(parseFloat(args.qty)).toBeCloseTo(0.01, 8);
        expect(args.side).toBe('LONG'); // exchangeOps converts LONG→reduce-only SELL internally
        expect(args.symbol).toBe('BTCUSDT');
        expect(args.exchangeOverride).toBe('binance');
        // status flipped to CLOSED after a successful exchange close
        expect(pos.live.status).toBe('CLOSED');
    });

    test('does NOT throw on null slOrderId/tpOrderId (adopted positions have no resting orders)', async () => {
        const d = { userId: 7, symbol: 'ETHUSDT', side: 'SHORT', entryPrice: '2300', qty: '0.5', exchange: 'binance' };
        const pos = serverAT._buildExternalEntry(d, 11, 2346);
        await expect(serverAT._handleLiveExit(pos, 'DISASTER_SL', 2346, -23)).resolves.not.toThrow();
        expect(mockExchangeOps.closePosition).toHaveBeenCalledTimes(1);
    });
});
