'use strict';

// Task M — Boot orphan order sweeper
//
// After PM2 restart, scan exchange open orders. SL/TP orders placed by Zeus
// with clientOrderId prefixes sl_/tp_/resl_ that are NOT recorded in our
// at_positions DB are ORPHANS (crash between exchange place and DB write).
// Cancel orphans to free up margin. Non-Zeus orders (user manual) are preserved.

const path = require('path');

const exchangeOpsMock = {
    getOpenOrders: jest.fn(),
    cancelOrder: jest.fn(() => Promise.resolve({ ok: true })),
};
jest.mock(path.resolve(__dirname, '../../server/services/exchangeOps'), () => exchangeOpsMock);

const dbMock = {
    getZeusOrderIds: jest.fn(() => new Set()),
    auditLog: jest.fn(),
};
jest.mock(path.resolve(__dirname, '../../server/services/database'), () => ({ db: dbMock }));

const telegramMock = { sendToUser: jest.fn(() => Promise.resolve()) };
jest.mock(path.resolve(__dirname, '../../server/services/telegram'), () => telegramMock);

describe('orderSweeper.sweep', () => {
    let sweeper;

    beforeEach(() => {
        jest.resetModules();
        // mockReset clears once-queue (mockClear does not).
        exchangeOpsMock.getOpenOrders.mockReset();
        exchangeOpsMock.cancelOrder.mockReset().mockResolvedValue({ ok: true });
        dbMock.getZeusOrderIds.mockReset().mockReturnValue(new Set());
        dbMock.auditLog.mockReset();
        telegramMock.sendToUser.mockReset().mockResolvedValue({ ok: true });
        jest.doMock(path.resolve(__dirname, '../../server/services/exchangeOps'), () => exchangeOpsMock);
        jest.doMock(path.resolve(__dirname, '../../server/services/database'), () => ({ db: dbMock }));
        jest.doMock(path.resolve(__dirname, '../../server/services/telegram'), () => telegramMock);
        sweeper = require('../../server/services/orderSweeper');
    });

    test('non-Zeus orders (user manual) preserved untouched', async () => {
        exchangeOpsMock.getOpenOrders.mockResolvedValue([
            { orderId: 'x1', clientOrderId: 'my_manual_buy', symbol: 'BTCUSDT' },
            { orderId: 'x2', clientOrderId: 'web_42_buy', symbol: 'ETHUSDT' },
        ]);
        const result = await sweeper.sweep(42);
        expect(exchangeOpsMock.cancelOrder).not.toHaveBeenCalled();
        expect(result.cancelled).toEqual([]);
        expect(result.preserved.length).toBe(2);
    });

    test('Zeus-prefixed sl_ order NOT in DB → cancelled (orphan)', async () => {
        exchangeOpsMock.getOpenOrders.mockResolvedValue([
            { orderId: 'x1', clientOrderId: 'sl_abc123_0', symbol: 'BTCUSDT' },
        ]);
        dbMock.getZeusOrderIds.mockReturnValue(new Set());
        const result = await sweeper.sweep(42);
        expect(exchangeOpsMock.cancelOrder).toHaveBeenCalledWith(42, {
            symbol: 'BTCUSDT', orderId: 'x1',
        });
        expect(result.cancelled.length).toBe(1);
    });

    test('Zeus tp_ order IN DB preserved (active management)', async () => {
        exchangeOpsMock.getOpenOrders.mockResolvedValue([
            { orderId: 'x1', clientOrderId: 'tp_def456', symbol: 'BTCUSDT' },
        ]);
        dbMock.getZeusOrderIds.mockReturnValue(new Set(['x1']));
        const result = await sweeper.sweep(42);
        expect(exchangeOpsMock.cancelOrder).not.toHaveBeenCalled();
        expect(result.preserved.length).toBe(1);
    });

    test('resl_ prefix (re-SL after retry) also recognized as Zeus', async () => {
        exchangeOpsMock.getOpenOrders.mockResolvedValue([
            { orderId: 'x1', clientOrderId: 'resl_abc123', symbol: 'BTCUSDT' },
        ]);
        dbMock.getZeusOrderIds.mockReturnValue(new Set());
        const result = await sweeper.sweep(42);
        expect(exchangeOpsMock.cancelOrder).toHaveBeenCalledWith(42, expect.objectContaining({ orderId: 'x1' }));
        expect(result.cancelled.length).toBe(1);
    });

    test('mixed orders: 2 Zeus orphans cancelled, 1 in-DB preserved, 1 manual preserved', async () => {
        exchangeOpsMock.getOpenOrders.mockResolvedValue([
            { orderId: 'x1', clientOrderId: 'sl_a_0', symbol: 'BTCUSDT' },      // orphan
            { orderId: 'x2', clientOrderId: 'tp_b', symbol: 'ETHUSDT' },        // in DB
            { orderId: 'x3', clientOrderId: 'my_order', symbol: 'SOLUSDT' },    // manual
            { orderId: 'x4', clientOrderId: 'sl_c_0', symbol: 'BNBUSDT' },      // orphan
        ]);
        dbMock.getZeusOrderIds.mockReturnValue(new Set(['x2']));
        const result = await sweeper.sweep(42);
        expect(result.cancelled.length).toBe(2);
        expect(result.preserved.length).toBe(2);
        expect(exchangeOpsMock.cancelOrder).toHaveBeenCalledTimes(2);
        expect(telegramMock.sendToUser).toHaveBeenCalledWith(42, expect.stringMatching(/2.*orphan/i));
    });

    test('cancel failure logged but does not throw or stop sweep', async () => {
        exchangeOpsMock.getOpenOrders.mockResolvedValue([
            { orderId: 'x1', clientOrderId: 'sl_a_0', symbol: 'BTCUSDT' },
            { orderId: 'x2', clientOrderId: 'sl_b_0', symbol: 'ETHUSDT' },
        ]);
        exchangeOpsMock.cancelOrder
            .mockRejectedValueOnce(new Error('not found'))
            .mockResolvedValueOnce({ ok: true });
        await expect(sweeper.sweep(42)).resolves.not.toThrow();
        expect(exchangeOpsMock.cancelOrder).toHaveBeenCalledTimes(2);
        expect(dbMock.auditLog).toHaveBeenCalledWith(42, 'ORDER_SWEEPER_CANCEL_FAILED', expect.any(Object), null);
    });

    test('getOpenOrders failure → no throw, empty result', async () => {
        exchangeOpsMock.getOpenOrders.mockRejectedValue(new Error('network timeout'));
        const result = await sweeper.sweep(42);
        expect(result.cancelled).toEqual([]);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(exchangeOpsMock.cancelOrder).not.toHaveBeenCalled();
    });

    test('no open orders → clean exit', async () => {
        exchangeOpsMock.getOpenOrders.mockResolvedValue([]);
        const result = await sweeper.sweep(42);
        expect(result.cancelled).toEqual([]);
        expect(result.preserved).toEqual([]);
        expect(telegramMock.sendToUser).not.toHaveBeenCalled();
    });

    test('only cancels emit telegram (preserve-only is silent)', async () => {
        exchangeOpsMock.getOpenOrders.mockResolvedValue([
            { orderId: 'x1', clientOrderId: 'my_order', symbol: 'BTCUSDT' },
        ]);
        await sweeper.sweep(42);
        expect(telegramMock.sendToUser).not.toHaveBeenCalled();
    });

    test('successful cancel writes ORDER_SWEEPER_CANCELLED audit', async () => {
        exchangeOpsMock.getOpenOrders.mockResolvedValue([
            { orderId: 'x1', clientOrderId: 'sl_a_0', symbol: 'BTCUSDT' },
        ]);
        await sweeper.sweep(42);
        expect(dbMock.auditLog).toHaveBeenCalledWith(42, 'ORDER_SWEEPER_CANCELLED', expect.objectContaining({
            orderId: 'x1', symbol: 'BTCUSDT', clientOrderId: 'sl_a_0',
        }), null);
    });
});
