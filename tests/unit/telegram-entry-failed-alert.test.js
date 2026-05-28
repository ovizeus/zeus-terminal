'use strict';

// Task D — telegramBot.notifyEntryFailed for autonomous brain entry failures
// Distinguishes brain-driven (autonomous) entries from manual orders.
// Includes seq number + sizeUsd + error code for operator triage.

const path = require('path');

const telegramMock = { sendToUser: jest.fn(() => Promise.resolve()) };

describe('telegramBot.notifyEntryFailed — autonomous entry alert', () => {
    let tb;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        telegramMock.sendToUser = jest.fn(() => Promise.resolve());
        jest.doMock(path.resolve(__dirname, '../../server/services/telegram'), () => telegramMock);
        tb = require('../../server/services/telegramBot');
    });

    test('notifyEntryFailed exists as exported function', () => {
        expect(typeof tb.notifyEntryFailed).toBe('function');
    });

    test('sends P1 alert with symbol+side+sizeUsd+error+seq', async () => {
        await tb.notifyEntryFailed(42, {
            symbol: 'BTCUSDT', side: 'LONG', sizeUsd: 100,
            error: 'INSUFFICIENT_BALANCE', seq: 999,
        });
        expect(telegramMock.sendToUser).toHaveBeenCalledTimes(1);
        const [uid, msg] = telegramMock.sendToUser.mock.calls[0];
        expect(uid).toBe(42);
        expect(msg).toMatch(/AUTONOMOUS ENTRY FAILED/i);
        expect(msg).toContain('BTCUSDT');
        expect(msg).toContain('LONG');
        expect(msg).toContain('100');
        expect(msg).toContain('INSUFFICIENT_BALANCE');
        expect(msg).toContain('#999');
    });

    test('SHORT direction reported correctly', async () => {
        await tb.notifyEntryFailed(42, {
            symbol: 'ETHUSDT', side: 'SHORT', sizeUsd: 50,
            error: 'ALL_FAILED', seq: 1,
        });
        const msg = telegramMock.sendToUser.mock.calls[0][1];
        expect(msg).toContain('SHORT');
        expect(msg).toContain('ETHUSDT');
    });

    test('truncates oversize error messages to keep message under 1500 chars', async () => {
        const longError = 'X'.repeat(2000);
        await tb.notifyEntryFailed(42, {
            symbol: 'ETHUSDT', side: 'SHORT', sizeUsd: 50, error: longError, seq: 1,
        });
        const msg = telegramMock.sendToUser.mock.calls[0][1];
        expect(msg.length).toBeLessThan(1500);
    });

    test('missing userId is no-op (returns silently)', async () => {
        await expect(tb.notifyEntryFailed(null, { symbol: 'BTC' })).resolves.toBeUndefined();
        expect(telegramMock.sendToUser).not.toHaveBeenCalled();
    });

    test('missing info is no-op', async () => {
        await expect(tb.notifyEntryFailed(42, null)).resolves.toBeUndefined();
        expect(telegramMock.sendToUser).not.toHaveBeenCalled();
    });

    test('telegram.sendToUser throw does not propagate', async () => {
        telegramMock.sendToUser = jest.fn(() => Promise.reject(new Error('telegram api down')));
        jest.resetModules();
        jest.doMock(path.resolve(__dirname, '../../server/services/telegram'), () => telegramMock);
        tb = require('../../server/services/telegramBot');
        await expect(tb.notifyEntryFailed(42, {
            symbol: 'BTC', side: 'LONG', sizeUsd: 1, error: 'x', seq: 1,
        })).resolves.toBeUndefined();
    });

    test('handles missing optional fields gracefully', async () => {
        await tb.notifyEntryFailed(42, { symbol: 'BTCUSDT', side: 'LONG' });
        expect(telegramMock.sendToUser).toHaveBeenCalledTimes(1);
        const msg = telegramMock.sendToUser.mock.calls[0][1];
        expect(msg).toMatch(/AUTONOMOUS ENTRY FAILED/i);
        expect(msg).toContain('BTCUSDT');
    });
});
