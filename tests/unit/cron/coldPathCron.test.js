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
// `all()` answers the (user, env) discovery query; `get()` the decision count.
let mockPairs = [];
jest.mock('../../../server/services/database', () => ({
    db: { prepare: jest.fn(() => ({ get: jest.fn(() => ({ cnt: 7 })), run: mockRun, all: jest.fn(() => mockPairs) })) },
}));

const { _tick } = require('../../../server/cron/coldPathCron');

beforeEach(() => {
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockRun.mockClear();
    mockPairs = [];
});

describe('coldPathCron reports what it actually did', () => {
    test('a tick logs a summary naming the insights produced', () => {
        _tick();

        const lines = mockLogger.info.mock.calls.concat(mockLogger.warn.mock.calls)
            .map((c) => String(c[1] || ''));
        expect(lines.length).toBeGreaterThan(0);
        expect(lines.join(' ')).toMatch(/insights/i);
    });

    test('a quiet tick says there was nothing to analyse, and is not a warning', () => {
        // No pairs discovered → legitimately nothing to do. Reporting that as a
        // failure would train us to ignore the line, which is how the real
        // failure stayed hidden in the first place.
        mockPairs = [];
        _tick();

        const info = mockLogger.info.mock.calls.map((c) => String(c[1] || '')).join(' ');
        expect(info).toMatch(/nothing to analyse/i);
        expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    test('an analysis that throws IS a warning', () => {
        mockPairs = [{ user_id: 1, resolved_env: 'DEMO' }];
        const engine = require('../../../server/services/ml/R2_cognition/competingHypothesesEngine');
        jest.spyOn(engine, 'getCompetingHypotheses').mockImplementation(() => { throw new Error('boom'); });

        _tick();

        const warned = mockLogger.warn.mock.calls.map((c) => String(c[1] || '')).join(' ');
        expect(warned).toMatch(/FAILED/);
        engine.getCompetingHypotheses.mockRestore();
    });
});

// [2026-10-09 audit A1] The four "analyses" were calls to nothing:
//   computeCoherenceScore  — called with {recentDecisions:[]}, but it requires
//                            a `thread`, and nothing enumerates threads, so it
//                            has no periodic entry point at all.
//   getAttributionStats    — does not exist; that module exports per-event
//                            helpers (recordAttribution, classify...), nothing
//                            periodic.
//   checkQuarantine        — does not exist either; the real sweep is
//                            scanAllFeatures, which mlScanCron already owns on
//                            its own 4h cadence. Running it here every 5
//                            minutes would duplicate, not add.
//   evaluateDominance      — real, but was passed thresholds instead of the
//                            `hypotheses` array it requires.
// Only the last one is a genuine periodic analysis, so it is the one that is
// made to work; the other three are removed rather than left pretending.
describe('the cold path actually analyses something', () => {
    test('dominance is evaluated over the hypotheses that exist, and counts as an insight', () => {
        mockPairs = [{ user_id: 1, resolved_env: 'DEMO' }];
        const engine = require('../../../server/services/ml/R2_cognition/competingHypothesesEngine');
        jest.spyOn(engine, 'getCompetingHypotheses').mockReturnValue([
            { id: 1, status: 'ACTIVE', posterior: 0.8 },
            { id: 2, status: 'ACTIVE', posterior: 0.1 },
        ]);
        const dom = jest.spyOn(engine, 'evaluateDominance').mockReturnValue({ dominant: true });

        _tick();

        expect(dom).toHaveBeenCalledWith(expect.objectContaining({
            hypotheses: expect.any(Array),
        }));
        const lines = mockLogger.info.mock.calls.concat(mockLogger.warn.mock.calls)
            .map((c) => String(c[1] || '')).join(' ');
        expect(lines).toMatch(/1 insights|[1-9][0-9]* insights/);

        engine.getCompetingHypotheses.mockRestore();
        engine.evaluateDominance.mockRestore();
    });
});
