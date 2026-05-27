'use strict';

const EventEmitter = require('events');

let mockSendSigned = jest.fn();
let mockWsInstances = [];
let mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

jest.mock('../../server/services/binanceSigner', () => ({
    sendSignedRequest: (...args) => mockSendSigned(...args),
}));
jest.mock('../../server/services/logger', () => mockLogger);
jest.mock('../../server/migrationFlags', () => ({
    USERDATA_STREAM_ENABLED: true,
    _USERDATA_STREAM_TESTNET_ENABLED: false,
    _USERDATA_STREAM_REAL_ENABLED: false,
}));

class MockWebSocket extends EventEmitter {
    constructor(url) {
        super();
        this.url = url;
        this.readyState = 1;
        this.OPEN = 1;
        mockWsInstances.push(this);
        setTimeout(() => this.emit('open'), 5);
    }
    close() { this.readyState = 3; this.emit('close'); }
    ping() {}
}
jest.mock('ws', () => MockWebSocket);

beforeEach(() => {
    jest.resetModules();
    mockSendSigned = jest.fn();
    mockWsInstances = [];
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
});

describe('userDataStream', () => {
    // ── listenKey lifecycle ──

    test('createListenKey calls POST /fapi/v1/listenKey and returns key', async () => {
        mockSendSigned.mockResolvedValueOnce({ listenKey: 'abc123' });
        const uds = require('../../server/services/userDataStream');
        const key = await uds.createListenKey({ apiKey: 'k', apiSecret: 's' });
        expect(key).toBe('abc123');
        expect(mockSendSigned).toHaveBeenCalledWith('POST', '/fapi/v1/listenKey', {}, expect.objectContaining({ apiKey: 'k' }));
    });

    test('refreshListenKey calls PUT /fapi/v1/listenKey', async () => {
        mockSendSigned.mockResolvedValueOnce({});
        const uds = require('../../server/services/userDataStream');
        await uds.refreshListenKey({ apiKey: 'k', apiSecret: 's' });
        expect(mockSendSigned).toHaveBeenCalledWith('PUT', '/fapi/v1/listenKey', {}, expect.objectContaining({ apiKey: 'k' }));
    });

    test('deleteListenKey calls DELETE /fapi/v1/listenKey', async () => {
        mockSendSigned.mockResolvedValueOnce({});
        const uds = require('../../server/services/userDataStream');
        await uds.deleteListenKey({ apiKey: 'k', apiSecret: 's' });
        expect(mockSendSigned).toHaveBeenCalledWith('DELETE', '/fapi/v1/listenKey', {}, expect.objectContaining({ apiKey: 'k' }));
    });

    // ── Event parsing ──

    test('parseAccountUpdate extracts positions and balances', () => {
        const uds = require('../../server/services/userDataStream');
        const event = {
            e: 'ACCOUNT_UPDATE', E: 1700000000000, T: 1700000000000,
            a: {
                m: 'ORDER',
                B: [{ a: 'USDT', wb: '1000.50', cw: '990.00' }],
                P: [{ s: 'BTCUSDT', pa: '0.001', ep: '50000', up: '5.00', ps: 'BOTH' }],
            }
        };
        const parsed = uds.parseAccountUpdate(event);
        expect(parsed.positions).toHaveLength(1);
        expect(parsed.positions[0].symbol).toBe('BTCUSDT');
        expect(parsed.positions[0].positionAmt).toBe(0.001);
        expect(parsed.positions[0].entryPrice).toBe(50000);
        expect(parsed.positions[0].unrealizedPnL).toBe(5);
        expect(parsed.balances).toHaveLength(1);
        expect(parsed.balances[0].asset).toBe('USDT');
        expect(parsed.balances[0].walletBalance).toBe(1000.5);
    });

    test('parseOrderUpdate extracts order fill details', () => {
        const uds = require('../../server/services/userDataStream');
        const event = {
            e: 'ORDER_TRADE_UPDATE', E: 1700000000000,
            o: {
                s: 'ETHUSDT', S: 'BUY', o: 'MARKET', x: 'TRADE', X: 'FILLED',
                i: 12345, p: '0', ap: '2500.50', q: '0.1', z: '0.1',
                rp: '0', T: 1700000000000
            }
        };
        const parsed = uds.parseOrderUpdate(event);
        expect(parsed.symbol).toBe('ETHUSDT');
        expect(parsed.side).toBe('BUY');
        expect(parsed.orderId).toBe(12345);
        expect(parsed.executionType).toBe('TRADE');
        expect(parsed.orderStatus).toBe('FILLED');
        expect(parsed.avgPrice).toBe(2500.5);
        expect(parsed.filledQty).toBe(0.1);
    });

    test('parseAccountUpdate returns null on invalid event', () => {
        const uds = require('../../server/services/userDataStream');
        expect(uds.parseAccountUpdate(null)).toBeNull();
        expect(uds.parseAccountUpdate({})).toBeNull();
        expect(uds.parseAccountUpdate({ e: 'WRONG' })).toBeNull();
    });

    // ── Concurrent update resolution ──

    test('shouldApplyUpdate returns true when incoming timestamp newer', () => {
        const uds = require('../../server/services/userDataStream');
        expect(uds.shouldApplyUpdate(1700000001000, 1700000000000)).toBe(true);
    });

    test('shouldApplyUpdate returns false when incoming timestamp older', () => {
        const uds = require('../../server/services/userDataStream');
        expect(uds.shouldApplyUpdate(1700000000000, 1700000001000)).toBe(false);
    });

    test('shouldApplyUpdate returns true when timestamps equal (WS wins tie)', () => {
        const uds = require('../../server/services/userDataStream');
        expect(uds.shouldApplyUpdate(1700000000000, 1700000000000)).toBe(true);
    });

    // ── Health metrics ──

    test('getHealthStatus returns disconnected state initially', () => {
        const uds = require('../../server/services/userDataStream');
        const health = uds.getHealthStatus();
        expect(health.connected).toBe(false);
        expect(health.eventsTotal).toBe(0);
        expect(health.reconnectCount).toBe(0);
    });

    // ── resolveEffectiveFlag (per-mode gating) ──

    test('resolveStreamFlag returns master for demo', () => {
        const uds = require('../../server/services/userDataStream');
        expect(uds.resolveStreamFlag('demo')).toBe(true);
    });

    test('resolveStreamFlag returns false for testnet when sub-flag off', () => {
        const uds = require('../../server/services/userDataStream');
        expect(uds.resolveStreamFlag('testnet')).toBe(false);
    });

    test('resolveStreamFlag returns false for real when sub-flag off', () => {
        const uds = require('../../server/services/userDataStream');
        expect(uds.resolveStreamFlag('real')).toBe(false);
    });
});
