'use strict';

// [P2c.1b] Cross-exchange reconciliation — proves recon manages each position on
// ITS OWN exchange. Before P2c, _runReconciliation queried only the ACTIVE
// exchange (Binance-hardcoded sendSignedRequest /fapi/v2/positionRisk), so after a
// switch a non-active position was either skipped or FALSE-PHANTOM-CLOSED while
// still live. After P2c.1b it groups by (user, exchange) and queries each exchange
// via exchangeOps.getPositions({exchangeOverride}).

jest.mock('../../server/services/database', () => ({
    db: { prepare: jest.fn(() => ({ all: jest.fn(() => []), get: jest.fn(() => null), run: jest.fn() })) },
    atGetState: jest.fn(() => null),
    atSetState: jest.fn(),
    saveMissedTrade: jest.fn(),
    auditLog: jest.fn(),
    getOpenPositionsForUser: jest.fn(() => []),
    getOpenPositions: jest.fn(() => []),
    countOpenPositions: jest.fn(() => 0),
    getAllActiveLiveCredentials: jest.fn(() => []),
    getMaxSeq: jest.fn(() => 0),
}));

const mockExchangeOps = {
    getPositions: jest.fn(async () => []),
    getUserTrades: jest.fn(async () => []),
    closePosition: jest.fn(async () => ({ ok: true })),
    cancelOrder: jest.fn(async () => ({ ok: true })),
    getOpenOrders: jest.fn(async () => []),
};
jest.mock('../../server/services/exchangeOps', () => mockExchangeOps);

jest.mock('../../server/services/credentialStore', () => ({
    getExchangeCreds: jest.fn(() => ({ exchange: 'binance', mode: 'testnet', apiKey: 'k', apiSecret: 's' })),
    getExchangeCredsFor: jest.fn((uid, exchange) => ({ exchange, mode: 'testnet', apiKey: `k_${exchange}`, apiSecret: 's' })),
}));

jest.mock('../../server/services/binanceSigner', () => ({ sendSignedRequest: jest.fn(async () => []) }));

jest.mock('../../server/services/telegram', () => ({ sendToUser: jest.fn(), alertOrderFilled: jest.fn(), notifyUser: jest.fn() }));

jest.mock('../../server/services/marketFeed', () => ({
    getActiveSymbols: jest.fn(() => new Set(['BTCUSDT'])),
    subscribeForRef: jest.fn(async () => false),
    onPrice: jest.fn(),
}));

jest.mock('@sentry/node', () => ({
    init: jest.fn(), captureMessage: jest.fn(), captureException: jest.fn(),
    withScope: jest.fn((fn) => fn({ setUser: jest.fn(), setTag: jest.fn(), setExtra: jest.fn() })),
    setUser: jest.fn(), setContext: jest.fn(),
}));

const serverAT = require('../../server/services/serverAT.js');
const audit = require('../../server/services/audit');

describe('[P2c.1b] cross-exchange reconciliation routing', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        serverAT._reconTestHooks.reset();
    });
    afterEach(() => serverAT._reconTestHooks.reset());

    function bybitLivePosition() {
        return {
            seq: 101, userId: 1, symbol: 'BTCUSDT', side: 'LONG', mode: 'live',
            exchange: 'bybit', price: 60000, qty: 0.01, size: 100, lev: 10,
            openTs: 1, ts: 1,
            live: { status: 'LIVE', executedQty: '0.01', slOrderId: 'sl1', tpOrderId: null },
        };
    }

    it('queries the position OWN exchange via exchangeOps.getPositions({exchangeOverride})', async () => {
        serverAT._reconTestHooks.seedPositions([bybitLivePosition()]);
        // Bybit reports the position as live → recon must NOT treat it as phantom.
        mockExchangeOps.getPositions.mockImplementation(async (uid, params) => {
            if (params && params.exchangeOverride === 'bybit') {
                return [{ symbol: 'BTCUSDT', side: 'LONG', qty: '0.01', entryPrice: '60000', markPrice: '60000', unrealizedPnl: '0' }];
            }
            return [];
        });

        await serverAT._runReconciliation(false);

        // Per-exchange routing proof (RED on pre-P2c.1b: recon used sendSignedRequest, never exchangeOps.getPositions).
        expect(mockExchangeOps.getPositions).toHaveBeenCalledWith(1, expect.objectContaining({ exchangeOverride: 'bybit' }));
    });

    it('does NOT false-phantom-close a live position confirmed on its own exchange', async () => {
        serverAT._reconTestHooks.seedPositions([bybitLivePosition()]);
        mockExchangeOps.getPositions.mockImplementation(async (uid, params) => {
            if (params && params.exchangeOverride === 'bybit') {
                return [{ symbol: 'BTCUSDT', side: 'LONG', qty: '0.01', entryPrice: '60000', markPrice: '60000', unrealizedPnl: '0' }];
            }
            return [];
        });

        const auditSpy = jest.spyOn(audit, 'record');
        await serverAT._runReconciliation(false);

        // Position still tracked; never phantom-closed.
        const remaining = serverAT._reconTestHooks.getPositions();
        expect(remaining.some((p) => p.seq === 101)).toBe(true);
        const phantomCalls = auditSpy.mock.calls.filter((args) => args[0] === 'SAT_RECON_PHANTOM');
        expect(phantomCalls.length).toBe(0);
        auditSpy.mockRestore();
    });
});
