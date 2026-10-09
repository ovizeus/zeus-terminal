'use strict';
// [2026-10-09 audit C2] This cron writes a disaster-recovery heartbeat every
// 60s and logged nothing at all — the second of the two completely silent
// crons. Logging each beat would be pure noise, so the fix is the other way
// round: say nothing while it works, and be audible the moment it stops. A
// heartbeat that dies quietly is worse than no heartbeat, because the DR state
// still looks like it is being maintained.

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('../../../server/services/logger', () => mockLogger);

const mockRecord = jest.fn();
jest.mock('../../../server/services/ml/R0_substrate/disasterRecoveryOrchestrator', () => ({
    recordHeartbeat: mockRecord,
}));

const { _tick, NODE_ID } = require('../../../server/cron/r0SubstrateCron');

beforeEach(() => {
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockRecord.mockReset();
});

describe('r0SubstrateCron heartbeat', () => {
    test('a healthy beat stays silent', () => {
        mockRecord.mockImplementation(() => ({ ok: true }));
        _tick();
        expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ nodeId: NODE_ID }));
        expect(mockLogger.info).not.toHaveBeenCalled();
        expect(mockLogger.warn).not.toHaveBeenCalled();
        expect(mockLogger.error).not.toHaveBeenCalled();
    });

    test('a failing beat is reported instead of swallowed', () => {
        mockRecord.mockImplementation(() => { throw new Error('db is locked'); });
        _tick();
        const said = mockLogger.warn.mock.calls.concat(mockLogger.error.mock.calls)
            .map((c) => String(c[1] || '')).join(' ');
        expect(said).toMatch(/db is locked/);
    });

    test('a persistently failing beat does not spam a line every minute', () => {
        mockRecord.mockImplementation(() => { throw new Error('db is locked'); });
        for (let i = 0; i < 10; i++) _tick();
        const lines = mockLogger.warn.mock.calls.length + mockLogger.error.mock.calls.length;
        expect(lines).toBeLessThan(10);
        expect(lines).toBeGreaterThan(0);
    });
});
