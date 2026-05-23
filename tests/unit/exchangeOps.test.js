'use strict';

jest.mock('../../server/services/credentialStore', () => ({
    getExchangeCreds: jest.fn((uid) => {
        if (uid === 1) return { exchange: 'binance', mode: 'testnet', apiKey: 'k1', apiSecret: 's1' };
        if (uid === 2) return { exchange: 'bybit', mode: 'testnet', apiKey: 'k2', apiSecret: 's2' };
        if (uid === 3) return { exchange: 'binance', mode: 'live', apiKey: 'k3', apiSecret: 's3' };
        return null;
    })
}));

const mockBinanceOps = {
    placeEntry: jest.fn(async () => ({ ok: true, orderId: 'b1', clientOrderId: 'dk1', status: 'FILLED', filledQty: '0.001', avgFillPrice: '50000', slOrderId: 'sl1', ts: 1, rawExchange: 'binance' })),
    closePosition: jest.fn(async () => ({ ok: true, orderId: 'c1', status: 'CLOSED', filledQty: '0.001', avgFillPrice: '51000', ts: 2, rawExchange: 'binance' })),
    ensureSymbolReady: jest.fn(async () => ({ ok: true, leverage: 5, marginMode: 'CROSSED' })),
    getPositions: jest.fn(async () => []),
    getBalance: jest.fn(async () => ({ asset: 'USDT', walletBalance: '1000', availableBalance: '950', totalUnrealizedPnL: '0', rawExchange: 'binance' })),
    getUserTrades: jest.fn(async () => []),
    ping: jest.fn(async () => ({ ok: true, latencyMs: 50 })),
    cancelOrder: jest.fn(async () => ({ ok: true, status: 'CANCELED', ts: 3 })),
    placeStopLoss: jest.fn(async () => ({ ok: true, slOrderId: 'sl2' })),
};
const mockBybitOps = {
    placeEntry: jest.fn(async () => ({ ok: true, orderId: 'by1', clientOrderId: 'dk2', status: 'FILLED', filledQty: '0.001', avgFillPrice: '50000', slOrderId: 'bysl1', ts: 1, rawExchange: 'bybit' })),
    closePosition: jest.fn(async () => ({ ok: true, orderId: 'byc1', status: 'CLOSED', filledQty: '0.001', avgFillPrice: '51000', ts: 2, rawExchange: 'bybit' })),
    ensureSymbolReady: jest.fn(async () => ({ ok: true, leverage: 5, marginMode: 'CROSSED' })),
    getPositions: jest.fn(async () => []),
    getBalance: jest.fn(async () => ({ asset: 'USDT', walletBalance: '500', availableBalance: '450', totalUnrealizedPnL: '0', rawExchange: 'bybit' })),
    getUserTrades: jest.fn(async () => []),
    ping: jest.fn(async () => ({ ok: true, latencyMs: 30 })),
    cancelOrder: jest.fn(async () => ({ ok: true, status: 'CANCELED', ts: 3 })),
    placeStopLoss: jest.fn(async () => ({ ok: true, slOrderId: 'bysl2' })),
};
jest.mock('../../server/services/binanceOps', () => mockBinanceOps);
jest.mock('../../server/services/bybitOps', () => mockBybitOps);

const exchangeOps = require('../../server/services/exchangeOps');

const _validParams = (overrides = {}) => ({
    symbol: 'BTCUSDT', side: 'LONG', qty: '0.001', entryType: 'MARKET',
    sl: { price: '49000', type: 'MARKET' }, leverage: 5,
    decisionKey: 'test_dk_abc123', source: 'auto',
    ...overrides,
});

describe('exchangeOps', () => {
    beforeEach(() => {
        exchangeOps._resetForTest();
        jest.clearAllMocks();
    });

    describe('placeEntry routing', () => {
        it('routes binance user → binanceOps', async () => {
            await exchangeOps.placeEntry(1, _validParams());
            expect(mockBinanceOps.placeEntry).toHaveBeenCalled();
            expect(mockBybitOps.placeEntry).not.toHaveBeenCalled();
        });

        it('routes bybit user → bybitOps', async () => {
            await exchangeOps.placeEntry(2, _validParams());
            expect(mockBybitOps.placeEntry).toHaveBeenCalled();
            expect(mockBinanceOps.placeEntry).not.toHaveBeenCalled();
        });

        it('throws on user without creds', async () => {
            await expect(exchangeOps.placeEntry(99999, _validParams())).rejects.toThrow(/no creds/i);
        });
    });

    describe('placeEntry hard SL guard', () => {
        it('throws on LIVE without sl', async () => {
            await expect(exchangeOps.placeEntry(3, _validParams({ sl: null }))).rejects.toMatchObject({ code: 'ErrInvalidParams' });
        });

        it('throws on LIVE with sl.price=0', async () => {
            await expect(exchangeOps.placeEntry(3, _validParams({ sl: { price: '0', type: 'MARKET' } }))).rejects.toMatchObject({ code: 'ErrInvalidParams' });
        });

        it('throws on LIVE with sl.price negative', async () => {
            await expect(exchangeOps.placeEntry(3, _validParams({ sl: { price: '-100', type: 'MARKET' } }))).rejects.toMatchObject({ code: 'ErrInvalidParams' });
        });

        it('TESTNET allows missing sl (warn only)', async () => {
            await expect(exchangeOps.placeEntry(1, _validParams({ sl: null }))).resolves.toBeDefined();
        });
    });

    describe('placeEntry decisionKey validation', () => {
        it('throws on invalid decisionKey regex', async () => {
            await expect(exchangeOps.placeEntry(1, _validParams({ decisionKey: 'invalid.key' }))).rejects.toThrow(/decisionKey/i);
        });

        it('throws on missing decisionKey', async () => {
            await expect(exchangeOps.placeEntry(1, _validParams({ decisionKey: '' }))).rejects.toThrow(/decisionKey/i);
        });
    });

    describe('placeEntry params validation', () => {
        it('throws on invalid side', async () => {
            await expect(exchangeOps.placeEntry(1, _validParams({ side: 'BUY' }))).rejects.toMatchObject({ code: 'ErrInvalidParams' });
        });

        it('throws on missing symbol', async () => {
            await expect(exchangeOps.placeEntry(1, _validParams({ symbol: '' }))).rejects.toMatchObject({ code: 'ErrInvalidParams' });
        });
    });

    describe('closePosition', () => {
        it('routes to correct ops', async () => {
            await exchangeOps.closePosition(1, { symbol: 'BTCUSDT', side: 'LONG', qty: '0.001', closeType: 'MARKET', decisionKey: 'close_test_dk', source: 'manual' });
            expect(mockBinanceOps.closePosition).toHaveBeenCalled();
        });

        it('requires valid decisionKey', async () => {
            await expect(exchangeOps.closePosition(1, { symbol: 'BTCUSDT', side: 'LONG', qty: '0.001', closeType: 'MARKET', decisionKey: 'bad.key', source: 'manual' })).rejects.toThrow(/decisionKey/i);
        });
    });

    describe('ensureSymbolReady cache (5min TTL)', () => {
        it('first call hits ops', async () => {
            await exchangeOps.ensureSymbolReady(1, { symbol: 'BTCUSDT', leverage: 5, marginMode: 'CROSSED' });
            expect(mockBinanceOps.ensureSymbolReady).toHaveBeenCalledTimes(1);
        });

        it('second identical call uses cache (no second ops call)', async () => {
            await exchangeOps.ensureSymbolReady(1, { symbol: 'BTCUSDT', leverage: 5, marginMode: 'CROSSED' });
            await exchangeOps.ensureSymbolReady(1, { symbol: 'BTCUSDT', leverage: 5, marginMode: 'CROSSED' });
            expect(mockBinanceOps.ensureSymbolReady).toHaveBeenCalledTimes(1);
        });

        it('different leverage invalidates cache', async () => {
            await exchangeOps.ensureSymbolReady(1, { symbol: 'BTCUSDT', leverage: 5, marginMode: 'CROSSED' });
            await exchangeOps.ensureSymbolReady(1, { symbol: 'BTCUSDT', leverage: 10, marginMode: 'CROSSED' });
            expect(mockBinanceOps.ensureSymbolReady).toHaveBeenCalledTimes(2);
        });

        it('invalidateReady() clears cache', async () => {
            await exchangeOps.ensureSymbolReady(1, { symbol: 'BTCUSDT', leverage: 5, marginMode: 'CROSSED' });
            exchangeOps.invalidateReady(1, 'BTCUSDT');
            await exchangeOps.ensureSymbolReady(1, { symbol: 'BTCUSDT', leverage: 5, marginMode: 'CROSSED' });
            expect(mockBinanceOps.ensureSymbolReady).toHaveBeenCalledTimes(2);
        });
    });

    describe('other methods', () => {
        it('getPositions routes', async () => {
            await exchangeOps.getPositions(1);
            expect(mockBinanceOps.getPositions).toHaveBeenCalled();
        });

        it('getPositions with exchangeOverride bypasses routing', async () => {
            await exchangeOps.getPositions(1, { exchangeOverride: 'bybit' });
            expect(mockBybitOps.getPositions).toHaveBeenCalled();
        });

        it('getBalance routes', async () => {
            await exchangeOps.getBalance(2);
            expect(mockBybitOps.getBalance).toHaveBeenCalled();
        });

        it('ping routes', async () => {
            await exchangeOps.ping(1);
            expect(mockBinanceOps.ping).toHaveBeenCalled();
        });

        it('cancelOrder routes', async () => {
            await exchangeOps.cancelOrder(1, { symbol: 'BTCUSDT', orderId: 'x' });
            expect(mockBinanceOps.cancelOrder).toHaveBeenCalled();
        });
    });

    describe('CACHE_TTL_MS constant', () => {
        it('is 5 minutes', () => {
            expect(exchangeOps.CACHE_TTL_MS).toBe(5 * 60 * 1000);
        });
    });
});
