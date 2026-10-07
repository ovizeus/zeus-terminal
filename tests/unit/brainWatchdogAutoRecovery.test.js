'use strict';
// tests/unit/brainWatchdogAutoRecovery.test.js
// [AUTO-RECOVERY 2026-10-07] The dead-man switch armed GLOBAL_HALT on a stale
// brain heartbeat but had NO path back: nothing ever disarmed it. That is what
// turned a performance bug into a two-month silent outage — the event-loop
// freeze was transient, but the halt it armed was permanent, and only a process
// restart (RECOVERY_BOOT_COMPLETE) ever cleared it.
//
// Hard constraint: auto-recovery may ONLY clear a halt the dead-man switch
// itself armed. A halt armed by the operator or by EMERGENCY_CLOSE_CATASTROPHIC
// must survive — silently undoing a real safety halt would be far worse than
// the outage this fixes.

const path = require('path');

describe('brainWatchdog auto-recovery', () => {
    let bw, dbStmt, serverATMock, telegramMock, haltState;

    const dbMock = { prepare: jest.fn() };

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        haltState = { active: false, by: null, ts: null, reason: null };
        dbStmt = { get: jest.fn() };
        dbMock.prepare = jest.fn(() => dbStmt);
        serverATMock = {
            setGlobalHalt: jest.fn((active, by, reason) => {
                haltState = { active: !!active, by, ts: Date.now(), reason };
                return haltState;
            }),
            getGlobalHaltState: jest.fn(() => haltState),
        };
        telegramMock = { sendToAll: jest.fn(() => Promise.resolve()) };
        jest.doMock(path.resolve(__dirname, '../../server/services/database'), () => ({
            db: dbMock, auditLog: jest.fn(),
        }));
        jest.doMock(path.resolve(__dirname, '../../server/services/serverAT'), () => serverATMock);
        jest.doMock(path.resolve(__dirname, '../../server/services/telegram'), () => telegramMock);
        bw = require('../../server/services/brainWatchdog');
        bw._reset();
    });

    afterEach(() => { bw.stop(); });

    const fresh = () => dbStmt.get.mockReturnValue({ last_ts: Date.now() - 5000 });
    const stale = () => dbStmt.get.mockReturnValue({ last_ts: Date.now() - 300000 });
    const healthyChecks = (n) => { fresh(); for (let i = 0; i < n; i++) bw.check(); };

    test('HEALTHY_STREAK_TO_RECOVER is exported and small enough to recover in about a minute', () => {
        expect(bw.HEALTHY_STREAK_TO_RECOVER).toBeGreaterThanOrEqual(3);
        expect(bw.HEALTHY_STREAK_TO_RECOVER).toBeLessThanOrEqual(12);
    });

    test('disarms after the required run of healthy checks once the brain is back', () => {
        stale(); bw.check();
        expect(serverATMock.setGlobalHalt).toHaveBeenCalledWith(true, 1, expect.stringContaining('DEAD_MAN_SWITCH'));
        serverATMock.setGlobalHalt.mockClear();
        healthyChecks(bw.HEALTHY_STREAK_TO_RECOVER);
        expect(serverATMock.setGlobalHalt).toHaveBeenCalledTimes(1);
        const [active, by, reason] = serverATMock.setGlobalHalt.mock.calls[0];
        expect(active).toBe(false);
        expect(by).toBe(1);
        expect(reason).toMatch(/recover/i);
    });

    test('does not disarm before the streak is complete', () => {
        stale(); bw.check();
        serverATMock.setGlobalHalt.mockClear();
        healthyChecks(bw.HEALTHY_STREAK_TO_RECOVER - 1);
        expect(serverATMock.setGlobalHalt).not.toHaveBeenCalled();
    });

    test('a stale check in the middle resets the streak', () => {
        stale(); bw.check();
        serverATMock.setGlobalHalt.mockClear();
        healthyChecks(bw.HEALTHY_STREAK_TO_RECOVER - 1);
        stale(); bw.check();
        serverATMock.setGlobalHalt.mockClear();
        healthyChecks(bw.HEALTHY_STREAK_TO_RECOVER - 1);
        expect(serverATMock.setGlobalHalt).not.toHaveBeenCalled();
    });

    test('REFUSES to clear a halt armed by anything other than the dead-man switch', () => {
        haltState = { active: true, by: 1, ts: Date.now(), reason: 'EMERGENCY_CLOSE_CATASTROPHIC' };
        healthyChecks(bw.HEALTHY_STREAK_TO_RECOVER + 5);
        expect(serverATMock.setGlobalHalt).not.toHaveBeenCalled();
        expect(haltState.active).toBe(true);
    });

    test('REFUSES to clear an operator halt', () => {
        haltState = { active: true, by: 1, ts: Date.now(), reason: 'admin_api' };
        healthyChecks(bw.HEALTHY_STREAK_TO_RECOVER + 5);
        expect(serverATMock.setGlobalHalt).not.toHaveBeenCalled();
        expect(haltState.active).toBe(true);
    });

    test('does nothing when no halt is active', () => {
        healthyChecks(bw.HEALTHY_STREAK_TO_RECOVER + 5);
        expect(serverATMock.setGlobalHalt).not.toHaveBeenCalled();
    });

    test('disarms only once, not on every later healthy check', () => {
        stale(); bw.check();
        serverATMock.setGlobalHalt.mockClear();
        healthyChecks(bw.HEALTHY_STREAK_TO_RECOVER + 10);
        expect(serverATMock.setGlobalHalt).toHaveBeenCalledTimes(1);
    });

    test('tells the operator the brain recovered', () => {
        stale(); bw.check();
        telegramMock.sendToAll.mockClear();
        healthyChecks(bw.HEALTHY_STREAK_TO_RECOVER);
        expect(telegramMock.sendToAll).toHaveBeenCalledTimes(1);
        expect(String(telegramMock.sendToAll.mock.calls[0][0])).toMatch(/recover|back/i);
    });

    test('no-signal-yet is not treated as healthy (cannot recover on absence of evidence)', () => {
        stale(); bw.check();
        serverATMock.setGlobalHalt.mockClear();
        dbStmt.get.mockReturnValue({ last_ts: null });
        for (let i = 0; i < bw.HEALTHY_STREAK_TO_RECOVER + 5; i++) bw.check();
        expect(serverATMock.setGlobalHalt).not.toHaveBeenCalled();
    });
});
