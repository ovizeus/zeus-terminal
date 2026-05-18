'use strict';

// [Day 35 bugfix] Margin type set should be idempotent — Binance refuses
// redundant set when symbol has open orders, even if current marginType
// matches target. Operator reported persistent error on /api/order/place:
//   "Failed to set margin type: Binance API error: Position side cannot
//    be changed if there exists open orders."
// Root cause: -4046 (no need to change) was the only silent code; -4144
// (and any new error) blocked the entry. Fix: verify current marginType
// via positionRisk before failing; if already CROSSED, treat as idempotent.

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-idempotent-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const helper = require('../../server/services/marginTypeHelper');

describe('marginTypeHelper.ensureCrossed (Day 35 bug fix)', () => {
    test('POST succeeds → resolves silently', async () => {
        const calls = [];
        const sendSigned = async (method, path) => {
            calls.push({ method, path });
            return {};
        };
        await helper.ensureCrossed('BTCUSDT', { apiKey: 'x' }, sendSigned);
        expect(calls.length).toBe(1);
        expect(calls[0].path).toBe('/fapi/v1/marginType');
    });

    test('POST returns -4046 (already CROSSED) → silent, no verify call', async () => {
        const calls = [];
        const sendSigned = async (method, path) => {
            calls.push({ method, path });
            if (path === '/fapi/v1/marginType') {
                const e = new Error('Binance API error: No need to change margin type.');
                e.code = -4046;
                throw e;
            }
            return {};
        };
        await helper.ensureCrossed('BTCUSDT', { apiKey: 'x' }, sendSigned);
        expect(calls.length).toBe(1);  // no verify needed
    });

    test('POST fails with -4144 + current CROSSED → silent (idempotent)', async () => {
        const calls = [];
        const sendSigned = async (method, path) => {
            calls.push({ method, path });
            if (method === 'POST' && path === '/fapi/v1/marginType') {
                const e = new Error('Binance API error: Position side cannot be changed if there exists open orders.');
                e.code = -4144;
                throw e;
            }
            if (method === 'GET' && path === '/fapi/v2/positionRisk') {
                return [{ symbol: 'BTCUSDT', marginType: 'cross' }];
            }
            return {};
        };
        await helper.ensureCrossed('BTCUSDT', { apiKey: 'x' }, sendSigned);
        expect(calls.length).toBe(2);  // POST tried, then GET verify
        expect(calls[1].path).toBe('/fapi/v2/positionRisk');
    });

    test('POST fails with -4144 + current ISOLATED → throws actionable error', async () => {
        const sendSigned = async (method, path) => {
            if (method === 'POST') {
                const e = new Error('Binance API error: Position side cannot be changed if there exists open orders.');
                e.code = -4144;
                throw e;
            }
            if (method === 'GET' && path === '/fapi/v2/positionRisk') {
                return [{ symbol: 'BTCUSDT', marginType: 'isolated' }];
            }
            return {};
        };
        await expect(helper.ensureCrossed('BTCUSDT', { apiKey: 'x' }, sendSigned))
            .rejects.toThrow(/ISOLATED|set CROSSED manually/i);
    });

    test('POST fails + verify also fails → throws original error', async () => {
        const sendSigned = async (method) => {
            if (method === 'POST') {
                const e = new Error('Binance API error: original failure');
                e.code = -1234;
                throw e;
            }
            if (method === 'GET') {
                throw new Error('network down');
            }
        };
        await expect(helper.ensureCrossed('BTCUSDT', { apiKey: 'x' }, sendSigned))
            .rejects.toThrow(/original failure/i);
    });

    test('POST fails with -4048 (already has position) + current CROSSED → silent', async () => {
        const sendSigned = async (method, path) => {
            if (method === 'POST') {
                const e = new Error('Binance API error: Margin type cannot be changed if there exists position.');
                e.code = -4048;
                throw e;
            }
            if (method === 'GET') return [{ symbol: 'BTCUSDT', marginType: 'cross' }];
        };
        await helper.ensureCrossed('BTCUSDT', { apiKey: 'x' }, sendSigned);
        // No throw = pass
    });

    test('positionRisk array misses symbol → throws original error', async () => {
        const sendSigned = async (method) => {
            if (method === 'POST') {
                const e = new Error('Binance API error: weird state');
                e.code = -4144;
                throw e;
            }
            if (method === 'GET') return [{ symbol: 'ETHUSDT', marginType: 'cross' }]; // wrong sym
        };
        await expect(helper.ensureCrossed('BTCUSDT', { apiKey: 'x' }, sendSigned))
            .rejects.toThrow(/weird state/i);
    });
});
