'use strict';

// [FILL-RESULT 2026-06-04] Root cause of FILL_UNVERIFIED_FORCE_CLOSED on every
// SP2-a entry: POST /fapi/v1/order without newOrderRespType defaults to ACK —
// Binance replies instantly with status=NEW, avgPrice="0.00", executedQty="0"
// WITHOUT waiting for the matching engine. serverAT's ZT-AUD-002 gate saw 0/0
// and force-closed a position that HAD actually filled (proof: the reduceOnly
// force-close succeeded — Binance rejects reduceOnly with no position, -2022).
// Fix: (1) newOrderRespType=RESULT on entry + close POSTs (MARKET → final
// FILLED with avgPrice, per official docs); (2) defense-in-depth fallback —
// if the response is still ACK-shaped (avgPrice 0), poll GET /fapi/v1/order
// before giving up. The FILL_UNVERIFIED gate itself stays intact (fail-closed).

let mockSend = jest.fn();
let mockDbGet = () => null;
jest.mock('../../server/services/database', () => ({
    db: { prepare: () => ({ get: (...a) => mockDbGet(...a), run: () => ({ lastInsertRowid: 7 }), all: () => [] }) },
}));
jest.mock('../../server/services/binanceSigner', () => ({ sendSignedRequest: (...a) => mockSend(...a) }));
jest.mock('../../server/services/exchangeInfo', () => ({
    roundOrderParams: (sym, qty) => ({ quantity: String(qty) }),
}));
jest.mock('../../server/services/orderLock', () => ({
    acquire: async () => true,
    release: () => {},
}));
jest.mock('../../server/services/positionStateMachine', () => ({ transition: () => {} }));
jest.mock('../../server/services/positionEvents', () => ({ append: () => {} }));

const binanceOps = require('../../server/services/binanceOps');

beforeEach(() => { mockSend = jest.fn(); mockDbGet = () => null; });

const CREDS = { apiKey: 'k', apiSecret: 's', mode: 'testnet' };
const ENTRY_PARAMS = {
    symbol: 'ETHUSDT', side: 'SHORT', qty: '0.581', entryType: 'MARKET',
    sl: null, tp: null, leverage: 5, decisionKey: 'SAT_test_0001', source: 'serverAT',
};

function postOrderCalls() {
    return mockSend.mock.calls.filter(c => c[0] === 'POST' && c[1] === '/fapi/v1/order');
}
function getOrderCalls() {
    return mockSend.mock.calls.filter(c => c[0] === 'GET' && c[1] === '/fapi/v1/order');
}

describe('placeEntry — newOrderRespType=RESULT + fill-confirm fallback', () => {
    test('THE FIX: entry POST body includes newOrderRespType=RESULT', async () => {
        mockSend.mockImplementation((method, path) => {
            if (method === 'POST' && path === '/fapi/v1/order') {
                return Promise.resolve({ orderId: 111, status: 'FILLED', avgPrice: '1792.82', executedQty: '0.581' });
            }
            return Promise.resolve({});
        });
        const r = await binanceOps.placeEntry('1', ENTRY_PARAMS, CREDS);
        expect(r.ok).toBe(true);
        const posts = postOrderCalls();
        expect(posts.length).toBe(1);
        expect(posts[0][2].newOrderRespType).toBe('RESULT');
    });

    test('RESULT happy path: FILLED response → avgFillPrice/filledQty passed through, NO fallback GET', async () => {
        mockSend.mockImplementation((method, path) => {
            if (method === 'POST' && path === '/fapi/v1/order') {
                return Promise.resolve({ orderId: 111, status: 'FILLED', avgPrice: '1792.82', executedQty: '0.581' });
            }
            return Promise.resolve({});
        });
        const r = await binanceOps.placeEntry('1', ENTRY_PARAMS, CREDS);
        expect(r.ok).toBe(true);
        expect(parseFloat(r.avgFillPrice)).toBeCloseTo(1792.82);
        expect(parseFloat(r.filledQty)).toBeCloseTo(0.581);
        expect(getOrderCalls().length).toBe(0);
    });

    test('FALLBACK: ACK-shaped response (avgPrice=0.00) → polls GET /fapi/v1/order and uses its fill data', async () => {
        mockSend.mockImplementation((method, path, body) => {
            if (method === 'POST' && path === '/fapi/v1/order') {
                return Promise.resolve({ orderId: 222, status: 'NEW', avgPrice: '0.00', executedQty: '0' });
            }
            if (method === 'GET' && path === '/fapi/v1/order') {
                expect(body.symbol).toBe('ETHUSDT');
                expect(body.orderId).toBe(222);
                return Promise.resolve({ orderId: 222, status: 'FILLED', avgPrice: '1792.50', executedQty: '0.581' });
            }
            return Promise.resolve({});
        });
        const r = await binanceOps.placeEntry('1', ENTRY_PARAMS, CREDS);
        expect(r.ok).toBe(true);
        expect(parseFloat(r.avgFillPrice)).toBeCloseTo(1792.50);
        expect(parseFloat(r.filledQty)).toBeCloseTo(0.581);
        expect(getOrderCalls().length).toBeGreaterThanOrEqual(1);
    }, 15000);

    test('FAIL-CLOSED preserved: fallback exhausted (order never confirms) → avgFillPrice stays 0 so serverAT FILL_UNVERIFIED gate fires', async () => {
        mockSend.mockImplementation((method, path) => {
            if (method === 'POST' && path === '/fapi/v1/order') {
                return Promise.resolve({ orderId: 333, status: 'NEW', avgPrice: '0.00', executedQty: '0' });
            }
            if (method === 'GET' && path === '/fapi/v1/order') {
                return Promise.resolve({ orderId: 333, status: 'NEW', avgPrice: '0.00', executedQty: '0' });
            }
            return Promise.resolve({});
        });
        const r = await binanceOps.placeEntry('1', ENTRY_PARAMS, CREDS);
        expect(r.ok).toBe(true); // placeEntry itself succeeds — verification is serverAT's job
        expect(parseFloat(r.avgFillPrice || 0)).toBe(0);
    }, 15000);

    test('fallback GET throwing is tolerated (keeps polling, then fail-closed)', async () => {
        mockSend.mockImplementation((method, path) => {
            if (method === 'POST' && path === '/fapi/v1/order') {
                return Promise.resolve({ orderId: 444, status: 'NEW', avgPrice: '0.00', executedQty: '0' });
            }
            if (method === 'GET' && path === '/fapi/v1/order') {
                const e = new Error('Binance API error: timeout'); e.code = -1007; return Promise.reject(e);
            }
            return Promise.resolve({});
        });
        const r = await binanceOps.placeEntry('1', ENTRY_PARAMS, CREDS);
        expect(r.ok).toBe(true);
        expect(parseFloat(r.avgFillPrice || 0)).toBe(0);
    }, 15000);
});

describe('closePosition — newOrderRespType=RESULT', () => {
    test('row-missing fallback path (_closeWithoutLocalRow): close POST body includes newOrderRespType=RESULT', async () => {
        // db mock returns null row → exercises _closeWithoutLocalRow
        mockSend.mockImplementation((method, path) => {
            if (method === 'POST' && path === '/fapi/v1/order') {
                return Promise.resolve({ orderId: 555, status: 'FILLED', avgPrice: '1780.10', executedQty: '0.581' });
            }
            return Promise.resolve({});
        });
        const r = await binanceOps.closePosition('1', {
            seq: 7, symbol: 'ETHUSDT', side: 'SHORT', qty: '0.581',
            closeType: 'MARKET', decisionKey: 'SAT_FCUNVER_x', source: 'test',
        }, CREDS);
        expect(r.ok).toBe(true);
        const posts = postOrderCalls();
        expect(posts.length).toBe(1);
        expect(posts[0][2].newOrderRespType).toBe('RESULT');
        expect(posts[0][2].reduceOnly).toBe('true');
    });

    test('THE FIX (primary path, row found): close POST body includes newOrderRespType=RESULT', async () => {
        mockDbGet = () => ({ seq: 7, data: '{}', status: 'OPEN', user_id: '1', exchange: 'binance' });
        mockSend.mockImplementation((method, path) => {
            if (method === 'POST' && path === '/fapi/v1/order') {
                return Promise.resolve({ orderId: 556, status: 'FILLED', avgPrice: '1780.10', executedQty: '0.581' });
            }
            return Promise.resolve({});
        });
        const r = await binanceOps.closePosition('1', {
            seq: 7, symbol: 'ETHUSDT', side: 'SHORT', qty: '0.581',
            closeType: 'MARKET', decisionKey: 'SAT_close_x', source: 'test',
        }, CREDS);
        expect(r.ok).toBe(true);
        expect(parseFloat(r.avgFillPrice)).toBeCloseTo(1780.10);
        const posts = postOrderCalls();
        expect(posts.length).toBe(1);
        expect(posts[0][2].newOrderRespType).toBe('RESULT');
        expect(posts[0][2].reduceOnly).toBe('true');
    });
});
