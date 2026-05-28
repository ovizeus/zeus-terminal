'use strict';

// Task H — Brain Watchdog (Dead Man's Switch consumer)
// serverBrain._runCycle emits per-cycle heartbeat via telemetryCollector
// (module_id='serverBrain', flushed to ml_module_heartbeats every 1s).
// If brain cycle gets stuck (_running flag stuck true, deadlock, event-loop
// blocked), heartbeats stop arriving — but no consumer alerts on missing
// heartbeats today. This watchdog polls the table, alerts + halts on stale.

const path = require('path');

describe('brainWatchdog', () => {
    let bw;
    let dbStmt;

    const dbMock = {
        prepare: jest.fn(),
    };
    const serverATMock = { setGlobalHalt: jest.fn() };
    const telegramMock = { sendToAll: jest.fn(() => Promise.resolve()) };

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        dbStmt = { get: jest.fn() };
        dbMock.prepare = jest.fn(() => dbStmt);
        jest.doMock(path.resolve(__dirname, '../../server/services/database'), () => ({
            db: dbMock,
            auditLog: jest.fn(),
        }));
        jest.doMock(path.resolve(__dirname, '../../server/services/serverAT'), () => serverATMock);
        jest.doMock(path.resolve(__dirname, '../../server/services/telegram'), () => telegramMock);
        bw = require('../../server/services/brainWatchdog');
        bw._reset();
    });

    afterEach(() => { bw.stop(); });

    test('check() with fresh heartbeat (<60s old) returns stale=false', () => {
        dbStmt.get.mockReturnValue({ last_ts: Date.now() - 10000 });
        const result = bw.check();
        expect(result.stale).toBe(false);
        expect(serverATMock.setGlobalHalt).not.toHaveBeenCalled();
    });

    test('check() with stale heartbeat (>60s old) → halt + Telegram P0', () => {
        dbStmt.get.mockReturnValue({ last_ts: Date.now() - 70000 });
        const result = bw.check();
        expect(result.stale).toBe(true);
        expect(result.ageMs).toBeGreaterThan(60000);
        expect(serverATMock.setGlobalHalt).toHaveBeenCalledWith(
            true, 1, expect.stringMatching(/DEAD_MAN_SWITCH/));
        expect(telegramMock.sendToAll).toHaveBeenCalledWith(
            expect.stringMatching(/BRAIN DEAD|brain.*dead|dead man/i));
    });

    test('no heartbeat row yet (fresh DB) → NOT stale (brain not started)', () => {
        dbStmt.get.mockReturnValue(undefined);
        const result = bw.check();
        expect(result.stale).toBe(false);
        expect(serverATMock.setGlobalHalt).not.toHaveBeenCalled();
    });

    test('debounce: second stale check within 5min does NOT re-fire halt', () => {
        dbStmt.get.mockReturnValue({ last_ts: Date.now() - 70000 });
        bw.check();
        bw.check();
        expect(serverATMock.setGlobalHalt).toHaveBeenCalledTimes(1);
        expect(telegramMock.sendToAll).toHaveBeenCalledTimes(1);
    });

    test('DB query failure → no throw, returns stale=false (defensive)', () => {
        dbMock.prepare = jest.fn(() => { throw new Error('table missing'); });
        const result = bw.check();
        expect(result.stale).toBe(false);
        expect(serverATMock.setGlobalHalt).not.toHaveBeenCalled();
    });

    test('start() schedules periodic check', () => {
        jest.useFakeTimers();
        dbStmt.get.mockReturnValue({ last_ts: Date.now() - 70000 });
        bw.start({ intervalMs: 10000, staleThresholdMs: 60000 });
        jest.advanceTimersByTime(10001);
        expect(serverATMock.setGlobalHalt).toHaveBeenCalled();
        jest.useRealTimers();
    });

    test('stop() clears the timer', () => {
        jest.useFakeTimers();
        bw.start({ intervalMs: 10000, staleThresholdMs: 60000 });
        bw.stop();
        dbStmt.get.mockReturnValue({ last_ts: Date.now() - 70000 });
        jest.advanceTimersByTime(20001);
        expect(serverATMock.setGlobalHalt).not.toHaveBeenCalled();
        jest.useRealTimers();
    });

    test('configurable staleThresholdMs respected', () => {
        // 30s threshold; heartbeat 40s old → stale
        dbStmt.get.mockReturnValue({ last_ts: Date.now() - 40000 });
        const result = bw.check({ staleThresholdMs: 30000 });
        expect(result.stale).toBe(true);
    });
});
