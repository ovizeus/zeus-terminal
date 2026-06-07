'use strict';

// [2026-06-07 soak audit B3] getOpenOrders' algo branch called GET
// /fapi/v1/algoOrders — a path Binance testnet rejects with -5000 "Method GET
// is invalid" (audited live as ORDER_SWEEPER_ALGO_UNAVAILABLE every sweep
// since F2 shipped). The REAL listing endpoint is /fapi/v1/openAlgoOrders
// (proven live 2026-06-07: returned the stale resl_ BNB order that blocked
// every BNB entry with -4047 for 9+ hours). The field names also differ from
// the old guess: clientAlgoId / orderType / triggerPrice / quantity /
// algoStatus — the old mapping produced clientOrderId:'' so the sweeper's
// ZEUS_PREFIX_REGEX could never match and orphans were PRESERVED forever.
//
// Real captured testnet response shape is used verbatim below — mocks must
// mirror real shapes (walletBalance lesson, 2026-06-06).

const mockSendSignedRequest = jest.fn();
jest.mock('../../server/services/binanceSigner', () => ({
    sendSignedRequest: (...args) => mockSendSignedRequest(...args),
}));
jest.mock('../../server/services/database', () => ({ db: { prepare: jest.fn() } }));
jest.mock('../../server/services/exchangeInfo', () => ({ roundOrderParams: jest.fn() }));
jest.mock('../../server/services/orderLock', () => ({ acquire: jest.fn(async () => true), release: jest.fn() }));
jest.mock('../../server/services/telegram', () => ({ alertCritical: jest.fn(), sendToUser: jest.fn() }));
jest.mock('../../server/services/serverAT', () => ({ setGlobalHalt: jest.fn() }));

const binanceOps = require('../../server/services/binanceOps');

// Captured live from Binance futures testnet 2026-06-07 (the actual stale
// BNB order that caused the -4047 entry blocks).
const REAL_OPEN_ALGO_ROW = {
    algoId: 1000000097916831,
    clientAlgoId: 'resl_VDURvyo1vB38msqa',
    algoType: 'CONDITIONAL',
    orderType: 'STOP_MARKET',
    symbol: 'BNBUSDT',
    side: 'BUY',
    positionSide: 'BOTH',
    timeInForce: 'GTC',
    quantity: '8.72',
    algoStatus: 'NEW',
    actualOrderId: '',
    actualQty: '0.0',
    triggerPrice: '601.410',
};

const CREDS = { exchange: 'binance', mode: 'testnet', apiKey: 'k', apiSecret: 's' };

describe('B3 — getOpenOrders algo branch uses the real testnet endpoint + shape', () => {
    beforeEach(() => mockSendSignedRequest.mockReset());

    test('queries /fapi/v1/openAlgoOrders (NOT /fapi/v1/algoOrders)', async () => {
        mockSendSignedRequest.mockImplementation(async (method, path) => {
            if (path === '/fapi/v1/openOrders') return [];
            if (path === '/fapi/v1/openAlgoOrders') return [REAL_OPEN_ALGO_ROW];
            throw Object.assign(new Error(`Path ${path}, Method GET is invalid`), { code: -5000 });
        });

        const out = await binanceOps.getOpenOrders(1, {}, CREDS);
        const paths = mockSendSignedRequest.mock.calls.map(c => c[1]);
        expect(paths).toContain('/fapi/v1/openAlgoOrders');
        expect(paths).not.toContain('/fapi/v1/algoOrders');
        expect(out).toHaveLength(1);
    });

    test('maps the REAL openAlgoOrders shape so the sweeper can see orphans', async () => {
        mockSendSignedRequest.mockImplementation(async (method, path) => {
            if (path === '/fapi/v1/openOrders') return [];
            if (path === '/fapi/v1/openAlgoOrders') return [REAL_OPEN_ALGO_ROW];
            throw Object.assign(new Error(`Path ${path}, Method GET is invalid`), { code: -5000 });
        });

        const [o] = await binanceOps.getOpenOrders(1, {}, CREDS);
        expect(o.orderId).toBe('1000000097916831');
        // clientAlgoId must flow into clientOrderId — the sweeper's
        // ZEUS_PREFIX_REGEX (sl_|tp_|resl_|AT_) tests this exact field.
        expect(o.clientOrderId).toBe('resl_VDURvyo1vB38msqa');
        expect(o.symbol).toBe('BNBUSDT');
        expect(o.side).toBe('BUY');
        expect(o.type).toBe('STOP_MARKET');
        expect(o.price).toBe(601.41);
        expect(o.origQty).toBe(8.72);
        expect(o.status).toBe('NEW');
        expect(o.source).toBe('algo');
    });
});
