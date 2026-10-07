'use strict';
// tests/unit/emergencyQueuePoisonRow.test.js
// [POISON ROW FIX 2026-10-07] 13 unresolvable rows (COIN-M symbols adopted by
// recon, closed through the USDⓈ-M /fapi path) sat in emergency_close_queue
// from 2026-08-18 and silently disabled the whole orphan-protection net:
//   (a) "Invalid symbol" (-1121) was bucketed with "CB open / rate-limit /
//       timeout" and retried forever — 5,200 attempts in one day, which kept
//       the Binance circuit breaker open and broke listenKey recreation.
//   (b) MAX_ROWS_PER_TICK=10 + ORDER BY id meant the 10 poison rows at the head
//       consumed every tick; rows 46-48 were NEVER attempted once. A real
//       orphan enqueued later would never get a turn.
//   (c) Nothing counted attempts, so the state was permanent by construction.

const path = require('path');

describe('emergencyCloseProcessor — poison rows must not starve the queue', () => {
    let mockRows, resolved, updates, queries, mockSend, telegramMock;

    function freshProcessor() {
        jest.resetModules();
        mockRows = [];
        resolved = [];
        updates = [];
        queries = [];
        mockSend = jest.fn();
        telegramMock = {
            sendToUser: jest.fn(() => Promise.resolve(true)),
            alertCritical: jest.fn(() => Promise.resolve(true)),
            escapeMarkdown: (t) => String(t == null ? '' : t),
        };
        jest.doMock(path.resolve(__dirname, '../../server/services/database'), () => ({
            db: {
                prepare: (sql) => {
                    queries.push(String(sql));
                    return {
                        all: () => mockRows,
                        get: () => null,
                        run: (...a) => {
                            if (/UPDATE emergency_close_queue SET resolved_at/i.test(sql)) {
                                resolved.push({ id: a[a.length - 1], by: a[1], sql });
                            } else if (/UPDATE emergency_close_queue SET attempts/i.test(sql)) {
                                updates.push({ id: a[a.length - 1], args: a });
                            }
                            return { changes: 1 };
                        },
                    };
                },
            },
        }));
        jest.doMock(path.resolve(__dirname, '../../server/services/credentialStore'), () => ({
            getExchangeCreds: () => ({ apiKey: 'k', apiSecret: 's', mode: 'testnet' }),
            getExchangeCredsFor: () => ({ apiKey: 'k', apiSecret: 's', mode: 'testnet' }),
        }));
        jest.doMock(path.resolve(__dirname, '../../server/services/binanceSigner'), () => ({
            sendSignedRequest: (...a) => mockSend(...a),
        }));
        jest.doMock(path.resolve(__dirname, '../../server/services/telegram'), () => telegramMock);
        return require('../../server/services/emergencyCloseProcessor');
    }

    const invalidSymbol = () => {
        const e = new Error('Invalid symbol.');
        e.code = -1121;
        return Promise.reject(e);
    };

    test('(a) a permanent error resolves the row instead of retrying forever', async () => {
        const proc = freshProcessor();
        mockRows = [{ id: 39, user_id: 1, symbol: 'BTCUSD_PERP', exchange: 'binance', qty: '778', decision_key: 'closefail_x', attempts: 0 }];
        mockSend.mockImplementation(() => invalidSymbol());
        await proc._tick();
        expect(resolved.map(r => r.id)).toEqual([39]);
        expect(String(resolved[0].by)).toMatch(/permanent/i);
    });

    test('(a) a permanent error raises an alert — an unmanageable position needs human eyes', async () => {
        const proc = freshProcessor();
        mockRows = [{ id: 39, user_id: 1, symbol: 'BTCUSD_PERP', exchange: 'binance', qty: '778', decision_key: 'k', attempts: 0 }];
        mockSend.mockImplementation(() => invalidSymbol());
        await proc._tick();
        const alerted = telegramMock.alertCritical.mock.calls.length + telegramMock.sendToUser.mock.calls.length;
        expect(alerted).toBeGreaterThan(0);
    });

    test('(b) the queue is ordered by attempts so a fresh row is tried despite poison at the head', async () => {
        const proc = freshProcessor();
        mockRows = [];
        await proc._tick();
        const sel = queries.find(q => /FROM emergency_close_queue/i.test(q) && /SELECT/i.test(q));
        expect(sel).toBeTruthy();
        expect(sel.replace(/\s+/g, ' ')).toMatch(/ORDER BY attempts ASC, id ASC/i);
    });

    test('(c) a transient error increments attempts and keeps the row', async () => {
        const proc = freshProcessor();
        mockRows = [{ id: 44, user_id: 1, symbol: 'LINKUSDT', exchange: 'binance', qty: '37', decision_key: 'k', attempts: 3 }];
        mockSend.mockImplementation(() => Promise.reject(new Error('Binance API temporarily unavailable — circuit breaker open')));
        await proc._tick();
        expect(resolved).toEqual([]);
        expect(updates.map(u => u.id)).toEqual([44]);
    });

    test('(c) a row past the attempt cap is dead-lettered so it stops starving the queue', async () => {
        const proc = freshProcessor();
        mockRows = [{ id: 44, user_id: 1, symbol: 'LINKUSDT', exchange: 'binance', qty: '37', decision_key: 'k', attempts: proc.MAX_ATTEMPTS }];
        mockSend.mockImplementation(() => Promise.reject(new Error('circuit breaker open')));
        await proc._tick();
        expect(resolved.map(r => r.id)).toEqual([44]);
        expect(String(resolved[0].by)).toMatch(/gave_up|dead_letter/i);
    });

    test('a permanently-failing row never reaches the exchange twice', async () => {
        const proc = freshProcessor();
        mockRows = [{ id: 39, user_id: 1, symbol: 'ETCUSD_PERP', exchange: 'binance', qty: '37', decision_key: 'k', attempts: 0 }];
        mockSend.mockImplementation(() => invalidSymbol());
        await proc._tick();
        expect(mockSend.mock.calls.length).toBe(1); // the GET, then resolved — no POST, no re-GET
    });

    test('existing behaviour preserved: already flat on exchange still resolves', async () => {
        const proc = freshProcessor();
        mockRows = [{ id: 8, user_id: 1, symbol: 'BNBUSDT', exchange: 'binance', qty: '9.56', decision_key: 'k', attempts: 0 }];
        mockSend.mockImplementation((method) => (method === 'GET' ? Promise.resolve([]) : Promise.reject(new Error('no POST'))));
        await proc._tick();
        expect(resolved.map(r => r.id)).toEqual([8]);
    });

    test('existing behaviour preserved: a real held position is still closed reduceOnly', async () => {
        const proc = freshProcessor();
        mockRows = [{ id: 7, user_id: 1, symbol: 'ETHUSDT', exchange: 'binance', qty: '4.511', decision_key: 'k', attempts: 0 }];
        mockSend.mockImplementation((method) => {
            if (method === 'GET') return Promise.resolve([{ symbol: 'ETHUSDT', positionAmt: '-4.511' }]);
            return Promise.resolve({ status: 'FILLED', avgPrice: '1607.82' });
        });
        await proc._tick();
        expect(resolved.map(r => r.id)).toEqual([7]);
        const post = mockSend.mock.calls.find(c => c[0] === 'POST');
        expect(post[2].reduceOnly).toBe('true');
        expect(post[2].side).toBe('BUY');
    });
});

// [2026-10-07 follow-up] The alerts added above interpolate row.symbol, and the
// symbols that trigger them are exactly the ones carrying underscores
// (BTCUSD_PERP). Unescaped, they reproduced the Telegram 400 this session had
// just fixed elsewhere — observed live at "byte offset 54". Escape them.
describe('emergency queue alerts must survive Telegram Markdown', () => {
    let mockRows, mockSend, telegramMock;

    function freshProcessor() {
        jest.resetModules();
        mockRows = [];
        mockSend = jest.fn();
        telegramMock = {
            sendToUser: jest.fn(() => Promise.resolve(true)),
            alertCritical: jest.fn(() => Promise.resolve(true)),
            escapeMarkdown: (t) => String(t == null ? '' : t).replace(/([_*`[])/g, '\\$1'),
        };
        jest.doMock(path.resolve(__dirname, '../../server/services/database'), () => ({
            db: { prepare: () => ({ all: () => mockRows, get: () => null, run: () => ({ changes: 1 }) }) },
        }));
        jest.doMock(path.resolve(__dirname, '../../server/services/credentialStore'), () => ({
            getExchangeCreds: () => ({ apiKey: 'k', apiSecret: 's' }),
            getExchangeCredsFor: () => ({ apiKey: 'k', apiSecret: 's' }),
        }));
        jest.doMock(path.resolve(__dirname, '../../server/services/binanceSigner'), () => ({
            sendSignedRequest: (...a) => mockSend(...a),
        }));
        jest.doMock(path.resolve(__dirname, '../../server/services/telegram'), () => telegramMock);
        return require('../../server/services/emergencyCloseProcessor');
    }

    const noUnescapedUnderscore = (text) => !/_/.test(String(text).replace(/\\_/g, ''));

    test('the permanent-error alert escapes the COIN-M symbol', async () => {
        const proc = freshProcessor();
        mockRows = [{ id: 39, user_id: 1, symbol: 'BTCUSD_PERP', exchange: 'binance', qty: '778', decision_key: 'k', attempts: 0 }];
        mockSend.mockImplementation(() => {
            const e = new Error('Invalid symbol.'); e.code = -1121; return Promise.reject(e);
        });
        await proc._tick();
        expect(telegramMock.sendToUser).toHaveBeenCalled();
        expect(noUnescapedUnderscore(telegramMock.sendToUser.mock.calls[0][1])).toBe(true);
    });

    test('the gave-up alert escapes the symbol too', async () => {
        const proc = freshProcessor();
        mockRows = [{ id: 44, user_id: 1, symbol: 'ETHUSD_PERP', exchange: 'binance', qty: '195', decision_key: 'k', attempts: 999999 }];
        mockSend.mockImplementation(() => Promise.reject(new Error('circuit breaker open')));
        await proc._tick();
        expect(telegramMock.sendToUser).toHaveBeenCalled();
        expect(noUnescapedUnderscore(telegramMock.sendToUser.mock.calls[0][1])).toBe(true);
    });
});
