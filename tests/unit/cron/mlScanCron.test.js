'use strict';

let mockFlagValue = true;
let scanCalls = [];
let mockUsers = [{ user_id: 1 }, { user_id: 2 }];

jest.mock('../../../server/services/database', () => ({
    db: {
        prepare: jest.fn(() => ({
            all: jest.fn(() => mockUsers),
            get: jest.fn(),
            run: jest.fn(),
        })),
    },
}));

jest.mock('../../../server/services/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

jest.mock('../../../server/services/ml/R5B_governance/autoQuarantine', () => ({
    scanAllFeatures: jest.fn((params) => {
        scanCalls.push(params);
        return { evaluated: 3, quarantined: [], skipped: 2, errors: [] };
    }),
}));

// migrationFlags requires database at load time — mock must come after database mock
jest.mock('../../../server/migrationFlags', () => {
    const handler = {
        get(_, prop) {
            if (prop === 'ML_CRON_SCAN_ENABLED') return mockFlagValue;
            return false;
        },
    };
    return new Proxy({}, handler);
});

const { _tick, schedule, stop, SCAN_INTERVAL_MS, ENVS } = require('../../../server/cron/mlScanCron');
const autoQuarantine = require('../../../server/services/ml/R5B_governance/autoQuarantine');

beforeEach(() => {
    mockFlagValue = true;
    scanCalls = [];
    mockUsers = [{ user_id: 1 }, { user_id: 2 }];
    autoQuarantine.scanAllFeatures.mockClear();
    jest.useFakeTimers();
});

afterEach(() => {
    stop();
    jest.useRealTimers();
});

describe('mlScanCron', () => {
    test('SCAN_INTERVAL_MS is 4 hours', () => {
        expect(SCAN_INTERVAL_MS).toBe(4 * 60 * 60 * 1000);
    });

    test('ENVS covers all 3 environments', () => {
        expect(ENVS).toEqual(['DEMO', 'TESTNET', 'REAL']);
    });

    test('_tick iterates users × envs and calls scanAllFeatures', () => {
        _tick();
        expect(scanCalls.length).toBe(6);
        expect(scanCalls[0]).toMatchObject({ userId: 1, resolvedEnv: 'DEMO' });
        expect(scanCalls[3]).toMatchObject({ userId: 2, resolvedEnv: 'DEMO' });
    });

    test('_tick skips when ML_CRON_SCAN_ENABLED=false', () => {
        mockFlagValue = false;
        _tick();
        expect(scanCalls.length).toBe(0);
    });

    test('_tick catches per-user errors without stopping iteration', () => {
        let callCount = 0;
        autoQuarantine.scanAllFeatures.mockImplementation((params) => {
            callCount++;
            if (params.userId === 1 && params.resolvedEnv === 'DEMO') {
                throw new Error('test error');
            }
            return { evaluated: 1, quarantined: [], skipped: 0, errors: [] };
        });
        _tick();
        expect(callCount).toBe(6);
    });

    test('schedule sets interval + delayed initial tick', () => {
        schedule();
        jest.advanceTimersByTime(60001);
        expect(autoQuarantine.scanAllFeatures).toHaveBeenCalled();
    });
});
