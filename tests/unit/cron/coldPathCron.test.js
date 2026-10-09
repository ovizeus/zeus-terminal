'use strict';
// [2026-10-09 audit C2 + A1] coldPathCron wrote NOTHING to the logs — one of
// only two crons with no trace at all. That silence is why A1 could hide: the
// cold-path reflection layer has been running every five minutes producing
// total_insights=0 on every single recorded run, while modules_failed stayed 0
// so it looked perfectly healthy. A tick that reports what it achieved cannot
// go quiet like that again.

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('../../../server/services/logger', () => mockLogger);

const mockRun = jest.fn();
jest.mock('../../../server/services/database', () => ({
    db: { prepare: jest.fn(() => ({ get: jest.fn(() => ({ cnt: 7 })), run: mockRun, all: jest.fn(() => []) })) },
}));

const { _tick } = require('../../../server/cron/coldPathCron');

beforeEach(() => {
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockRun.mockClear();
});

describe('coldPathCron reports what it actually did', () => {
    test('a tick logs a summary naming the insights produced', () => {
        _tick();

        const lines = mockLogger.info.mock.calls.concat(mockLogger.warn.mock.calls)
            .map((c) => String(c[1] || ''));
        expect(lines.length).toBeGreaterThan(0);
        expect(lines.join(' ')).toMatch(/insights/i);
    });

    test('producing zero insights is surfaced as a warning, not buried', () => {
        // Every analysis currently throws into a silent catch, so a real tick
        // yields nothing. That must be loud: a reflection layer that reflects on
        // nothing is indistinguishable from one that is switched off.
        _tick();

        const warned = mockLogger.warn.mock.calls.map((c) => String(c[1] || '')).join(' ');
        expect(warned).toMatch(/0 insights|no insights/i);
    });
});
