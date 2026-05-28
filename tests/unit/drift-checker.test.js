'use strict';

// Task N — Periodic drift checker
// Every 15min, compare serverAT.getOpenPositions vs exchangeOps.getPositions
// per active user. Diff types: exchange-only, db-only, size-mismatch (>5%).
// 2 consecutive drift detections → globalHalt + Telegram P0 + audit.
// Clean check resets the consecutive counter. Defensive: getPositions
// failure does NOT count as drift (we don't have signal).

const path = require('path');

const serverATMock = {
    getOpenPositions: jest.fn(() => []),
    setGlobalHalt: jest.fn(),
};
const exchangeOpsMock = { getPositions: jest.fn(() => Promise.resolve([])) };
const dbMock = {
    listActiveExchangeUsers: jest.fn(() => []),
    auditLog: jest.fn(),
};
const telegramMock = { sendToUser: jest.fn(() => Promise.resolve()) };

describe('driftChecker', () => {
    let dc;

    beforeEach(() => {
        jest.resetModules();
        serverATMock.getOpenPositions.mockReset().mockReturnValue([]);
        serverATMock.setGlobalHalt.mockReset();
        exchangeOpsMock.getPositions.mockReset().mockResolvedValue([]);
        dbMock.listActiveExchangeUsers.mockReset().mockReturnValue([]);
        dbMock.auditLog.mockReset();
        telegramMock.sendToUser.mockReset().mockResolvedValue({ ok: true });
        jest.doMock(path.resolve(__dirname, '../../server/services/serverAT'), () => serverATMock);
        jest.doMock(path.resolve(__dirname, '../../server/services/exchangeOps'), () => exchangeOpsMock);
        jest.doMock(path.resolve(__dirname, '../../server/services/database'), () => ({ db: dbMock }));
        jest.doMock(path.resolve(__dirname, '../../server/services/telegram'), () => telegramMock);
        dc = require('../../server/services/driftChecker');
        dc._reset();
    });

    afterEach(() => { dc.stop(); });

    test('matching positions → no drift', async () => {
        serverATMock.getOpenPositions.mockReturnValue([{ userId: 42, symbol: 'BTCUSDT', side: 'LONG', qty: 0.01 }]);
        exchangeOpsMock.getPositions.mockResolvedValue([{ symbol: 'BTCUSDT', side: 'LONG', qty: 0.01 }]);
        const result = await dc.checkUser(42);
        expect(result.driftDetected).toBe(false);
        expect(serverATMock.setGlobalHalt).not.toHaveBeenCalled();
    });

    test('exchange has position DB does not → drift', async () => {
        serverATMock.getOpenPositions.mockReturnValue([]);
        exchangeOpsMock.getPositions.mockResolvedValue([{ symbol: 'BTCUSDT', side: 'LONG', qty: 0.01 }]);
        const result = await dc.checkUser(42);
        expect(result.driftDetected).toBe(true);
        expect(result.diff.exchangeOnly.length).toBe(1);
    });

    test('DB has position exchange does not → drift', async () => {
        serverATMock.getOpenPositions.mockReturnValue([{ userId: 42, symbol: 'BTCUSDT', side: 'LONG', qty: 0.01 }]);
        exchangeOpsMock.getPositions.mockResolvedValue([]);
        const result = await dc.checkUser(42);
        expect(result.driftDetected).toBe(true);
        expect(result.diff.dbOnly.length).toBe(1);
    });

    test('size mismatch > 5% → drift', async () => {
        serverATMock.getOpenPositions.mockReturnValue([{ userId: 42, symbol: 'BTCUSDT', side: 'LONG', qty: 0.01 }]);
        exchangeOpsMock.getPositions.mockResolvedValue([{ symbol: 'BTCUSDT', side: 'LONG', qty: 0.015 }]);  // 50% diff
        const result = await dc.checkUser(42);
        expect(result.driftDetected).toBe(true);
        expect(result.diff.sizeMismatch.length).toBe(1);
    });

    test('size diff < 5% tolerated', async () => {
        serverATMock.getOpenPositions.mockReturnValue([{ userId: 42, symbol: 'BTCUSDT', side: 'LONG', qty: 0.010 }]);
        exchangeOpsMock.getPositions.mockResolvedValue([{ symbol: 'BTCUSDT', side: 'LONG', qty: 0.0101 }]);  // 1% diff
        const result = await dc.checkUser(42);
        expect(result.driftDetected).toBe(false);
    });

    test('zero-qty exchange positions filtered out (not counted as drift)', async () => {
        serverATMock.getOpenPositions.mockReturnValue([]);
        exchangeOpsMock.getPositions.mockResolvedValue([{ symbol: 'BTCUSDT', side: 'LONG', qty: 0 }]);
        const result = await dc.checkUser(42);
        expect(result.driftDetected).toBe(false);
    });

    test('drift requires 2 consecutive fails before halt', async () => {
        serverATMock.getOpenPositions.mockReturnValue([]);
        exchangeOpsMock.getPositions.mockResolvedValue([{ symbol: 'BTCUSDT', side: 'LONG', qty: 0.01 }]);
        await dc.checkUser(42);
        expect(serverATMock.setGlobalHalt).not.toHaveBeenCalled();
        await dc.checkUser(42);  // 2nd consecutive
        expect(serverATMock.setGlobalHalt).toHaveBeenCalledWith(true, 42, expect.stringMatching(/DRIFT_DETECTED/));
        expect(telegramMock.sendToUser).toHaveBeenCalledWith(42, expect.stringMatching(/DRIFT/i));
        expect(dbMock.auditLog).toHaveBeenCalledWith(42, 'DRIFT_DETECTED_HALT', expect.any(Object), null);
    });

    test('clean check resets consecutive counter', async () => {
        // 1st: drift
        serverATMock.getOpenPositions.mockReturnValueOnce([]);
        exchangeOpsMock.getPositions.mockResolvedValueOnce([{ symbol: 'BTCUSDT', side: 'LONG', qty: 0.01 }]);
        await dc.checkUser(42);
        // 2nd: clean (matching)
        serverATMock.getOpenPositions.mockReturnValueOnce([{ userId: 42, symbol: 'BTCUSDT', side: 'LONG', qty: 0.01 }]);
        exchangeOpsMock.getPositions.mockResolvedValueOnce([{ symbol: 'BTCUSDT', side: 'LONG', qty: 0.01 }]);
        await dc.checkUser(42);
        // 3rd: drift again — should NOT halt yet (counter reset)
        serverATMock.getOpenPositions.mockReturnValueOnce([]);
        exchangeOpsMock.getPositions.mockResolvedValueOnce([{ symbol: 'BTCUSDT', side: 'LONG', qty: 0.01 }]);
        await dc.checkUser(42);
        expect(serverATMock.setGlobalHalt).not.toHaveBeenCalled();
    });

    test('getPositions failure → no drift signal (NOT counted)', async () => {
        serverATMock.getOpenPositions.mockReturnValue([]);
        exchangeOpsMock.getPositions.mockRejectedValue(new Error('network timeout'));
        const result = await dc.checkUser(42);
        expect(result.driftDetected).toBe(false);
        expect(result.error).toMatch(/network timeout/);
        // Twice failure → still no halt (we don't have signal to make decision)
        await dc.checkUser(42);
        expect(serverATMock.setGlobalHalt).not.toHaveBeenCalled();
    });

    test('halt does NOT re-fire on subsequent drift after initial halt (debounce)', async () => {
        serverATMock.getOpenPositions.mockReturnValue([]);
        exchangeOpsMock.getPositions.mockResolvedValue([{ symbol: 'BTCUSDT', side: 'LONG', qty: 0.01 }]);
        await dc.checkUser(42);
        await dc.checkUser(42);  // halt fires
        await dc.checkUser(42);  // 3rd — should not re-halt
        await dc.checkUser(42);  // 4th
        expect(serverATMock.setGlobalHalt).toHaveBeenCalledTimes(1);
    });

    test('checkAllUsers iterates listActiveExchangeUsers', async () => {
        dbMock.listActiveExchangeUsers.mockReturnValue([{ user_id: 42 }, { user_id: 99 }]);
        await dc.checkAllUsers();
        expect(serverATMock.getOpenPositions).toHaveBeenCalledWith(42);
        expect(serverATMock.getOpenPositions).toHaveBeenCalledWith(99);
    });

    test('start() schedules periodic check, stop() clears it', () => {
        jest.useFakeTimers();
        dbMock.listActiveExchangeUsers.mockReturnValue([]);
        dc.start({ intervalMs: 10000 });
        jest.advanceTimersByTime(10001);
        expect(dbMock.listActiveExchangeUsers).toHaveBeenCalled();
        const callsBefore = dbMock.listActiveExchangeUsers.mock.calls.length;
        dc.stop();
        jest.advanceTimersByTime(20000);
        expect(dbMock.listActiveExchangeUsers.mock.calls.length).toBe(callsBefore);
        jest.useRealTimers();
    });

    test('side mismatch (LONG vs SHORT) treated as separate positions → drift', async () => {
        serverATMock.getOpenPositions.mockReturnValue([{ userId: 42, symbol: 'BTCUSDT', side: 'LONG', qty: 0.01 }]);
        exchangeOpsMock.getPositions.mockResolvedValue([{ symbol: 'BTCUSDT', side: 'SHORT', qty: 0.01 }]);
        const result = await dc.checkUser(42);
        expect(result.driftDetected).toBe(true);
        expect(result.diff.exchangeOnly.length).toBe(1);
        expect(result.diff.dbOnly.length).toBe(1);
    });
});
