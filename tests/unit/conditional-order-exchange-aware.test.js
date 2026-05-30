'use strict';

// [Phase M] _placeConditionalOrder is the shared chokepoint for ALL conditional
// SL/TP placement (manual Path-B protection + AT trailing/protection/addon/health).
// It was Binance-hardcoded (POST /fapi/v1/algoOrder). When the active exchange is
// Bybit it must route to bybitOps.placeStopLoss / placeTakeProfit instead, so manual
// AND AT positions get protected on Bybit. params.side is the ORDER (closing) side:
// SELL closes a LONG, BUY closes a SHORT.

const path = require('path');

const mockBybitOps = {
    placeStopLoss: jest.fn(async () => ({ ok: true, slOrderId: 'bysl', status: 'New', rawExchange: 'bybit' })),
    placeTakeProfit: jest.fn(async () => ({ ok: true, tpOrderId: 'bytp', status: 'New', rawExchange: 'bybit' })),
};
const mockSendSigned = jest.fn(async () => ({ algoId: 'binAlgo', algoStatus: 'NEW' }));

jest.mock(path.resolve(__dirname, '../../server/services/bybitOps'), () => mockBybitOps);
jest.mock(path.resolve(__dirname, '../../server/services/binanceSigner'), () => ({ sendSignedRequest: (...a) => mockSendSigned(...a) }));

const binanceCreds = { exchange: 'binance', mode: 'testnet', apiKey: 'k', apiSecret: 's' };
const bybitCreds = { exchange: 'bybit', mode: 'testnet', apiKey: 'k', apiSecret: 's' };

describe('[Phase M] _placeConditionalOrder exchange routing', () => {
    let serverAT;
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        jest.doMock(path.resolve(__dirname, '../../server/services/bybitOps'), () => mockBybitOps);
        jest.doMock(path.resolve(__dirname, '../../server/services/binanceSigner'), () => ({ sendSignedRequest: (...a) => mockSendSigned(...a) }));
        serverAT = require('../../server/services/serverAT');
    });

    it('bybit + STOP_MARKET → bybitOps.placeStopLoss, returns {orderId}', async () => {
        const r = await serverAT._placeConditionalOrder({
            symbol: 'BTCUSDT', side: 'SELL', type: 'STOP_MARKET',
            quantity: '0.01', stopPrice: '49000', reduceOnly: true, newClientOrderId: 'PB_SL_1',
        }, bybitCreds);
        expect(mockBybitOps.placeStopLoss).toHaveBeenCalled();
        expect(mockSendSigned).not.toHaveBeenCalled();
        // SELL closes a LONG → positionSide LONG passed to bybit
        expect(mockBybitOps.placeStopLoss.mock.calls[0][1].side).toBe('LONG');
        expect(r.orderId).toBe('bysl');
    });

    it('bybit + TAKE_PROFIT_MARKET → bybitOps.placeTakeProfit (BUY→SHORT)', async () => {
        const r = await serverAT._placeConditionalOrder({
            symbol: 'BTCUSDT', side: 'BUY', type: 'TAKE_PROFIT_MARKET',
            quantity: '0.01', stopPrice: '60000', reduceOnly: true, newClientOrderId: 'PB_TP_1',
        }, bybitCreds);
        expect(mockBybitOps.placeTakeProfit).toHaveBeenCalled();
        expect(mockBybitOps.placeTakeProfit.mock.calls[0][1].side).toBe('SHORT');
        expect(r.orderId).toBe('bytp');
    });

    it('bybit failure → throws (callers rely on try/catch)', async () => {
        mockBybitOps.placeStopLoss.mockResolvedValueOnce({ ok: false, error: { message: 'rejected' } });
        await expect(serverAT._placeConditionalOrder({
            symbol: 'BTCUSDT', side: 'SELL', type: 'STOP_MARKET', quantity: '0.01', stopPrice: '49000', newClientOrderId: 'x',
        }, bybitCreds)).rejects.toThrow(/rejected/);
    });

    it('binance → unchanged Binance algo path, returns normalized orderId', async () => {
        const r = await serverAT._placeConditionalOrder({
            symbol: 'BTCUSDT', side: 'SELL', type: 'STOP_MARKET',
            quantity: '0.01', stopPrice: '49000', reduceOnly: true, newClientOrderId: 'B_SL_1',
        }, binanceCreds);
        expect(mockSendSigned).toHaveBeenCalledWith('POST', '/fapi/v1/algoOrder', expect.objectContaining({ algoType: 'CONDITIONAL' }), binanceCreds);
        expect(mockBybitOps.placeStopLoss).not.toHaveBeenCalled();
        expect(r.orderId).toBe('binAlgo'); // algoId normalized → orderId
    });
});
