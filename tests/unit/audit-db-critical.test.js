'use strict';

// Task I — Audit DB-first pattern for critical events.
// Current audit.record swallows DB failures silently. For critical events
// (entries, halts, recoveries, watchdog), DB write failures must be loudly
// logged so operator notices broken audit trail before something catastrophic.
// Non-critical events keep existing swallow-on-fail semantics (no regression).

const path = require('path');

describe('audit.record — DB-first critical event verification', () => {
    let audit;
    let mockAuditLog;
    let consoleErrSpy;

    beforeEach(() => {
        jest.resetModules();
        mockAuditLog = jest.fn();
        jest.doMock(path.resolve(__dirname, '../../server/services/database'), () => ({
            auditLog: mockAuditLog,
        }));
        audit = require('../../server/services/audit');
        consoleErrSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrSpy.mockRestore();
    });

    test('isCriticalEvent exported as function', () => {
        expect(typeof audit.isCriticalEvent).toBe('function');
    });

    test('classifies known critical actions as critical', () => {
        expect(audit.isCriticalEvent('SAT_ENTRY_FAILED')).toBe(true);
        expect(audit.isCriticalEvent('GLOBAL_HALT_TOGGLE')).toBe(true);
        expect(audit.isCriticalEvent('RECOVERY_EXCHANGE_ONLY_AUTOSL_PLACED')).toBe(true);
        expect(audit.isCriticalEvent('RECOVERY_EXCHANGE_ONLY_AUTOSL_FAILED')).toBe(true);
        expect(audit.isCriticalEvent('SAT_EMERGENCY_CLOSE')).toBe(true);
        expect(audit.isCriticalEvent('BRAIN_WATCHDOG_HALT')).toBe(true);
        expect(audit.isCriticalEvent('KILL_SWITCH')).toBe(true);
    });

    test('classifies unknown actions as non-critical', () => {
        expect(audit.isCriticalEvent('LOGIN')).toBe(false);
        expect(audit.isCriticalEvent('TEST_EVENT')).toBe(false);
        expect(audit.isCriticalEvent('CONFIG_UPDATE')).toBe(false);
        expect(audit.isCriticalEvent('')).toBe(false);
        expect(audit.isCriticalEvent(null)).toBe(false);
    });

    test('record() of non-critical event — DB failure swallowed silently', () => {
        mockAuditLog.mockImplementation(() => { throw new Error('db locked'); });
        expect(() => audit.record('LOGIN', { userId: 1 }, 'system')).not.toThrow();
        // No console.error fired for non-critical
        expect(consoleErrSpy).not.toHaveBeenCalled();
    });

    test('record() of CRITICAL event — DB failure logged to stderr', () => {
        mockAuditLog.mockImplementation(() => { throw new Error('db locked'); });
        audit.record('SAT_ENTRY_FAILED', { userId: 42, symbol: 'BTCUSDT' }, 'SERVER_AT');
        expect(consoleErrSpy).toHaveBeenCalledWith(
            expect.stringMatching(/AUDIT.*CRITICAL.*SAT_ENTRY_FAILED.*db locked/i),
            expect.anything()
        );
    });

    test('record() of CRITICAL event — DB write attempted with correct args', () => {
        audit.record('GLOBAL_HALT_TOGGLE', { userId: 1, active: true, reason: 'manual' }, 'SERVER_AT');
        expect(mockAuditLog).toHaveBeenCalledWith(
            1,
            'GLOBAL_HALT_TOGGLE',
            expect.objectContaining({ active: true, reason: 'manual' }),
            null
        );
    });

    test('record() does not throw even if critical event DB fails', () => {
        mockAuditLog.mockImplementation(() => { throw new Error('catastrophic db crash'); });
        expect(() => audit.record('SAT_EMERGENCY_CLOSE', { userId: 1 }, 'SERVER_AT')).not.toThrow();
    });

    test('record() with null details still works', () => {
        expect(() => audit.record('GLOBAL_HALT_TOGGLE', null, 'SERVER_AT')).not.toThrow();
        expect(mockAuditLog).toHaveBeenCalledWith(null, 'GLOBAL_HALT_TOGGLE', {}, null);
    });
});
