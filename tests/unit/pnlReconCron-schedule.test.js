'use strict';
// [P1 2026-06-09] pnlReconCron schedule moved 02:00 → 04:05 UTC. 02:00 sits
// at the edge of the Binance anti-ban window (22:00-02:00 UTC) and collides
// with omegaMemoryCleanup (02:00). 04:05 is clear of every other cron
// (offsite 03:30, posClass Sun 03:00).

jest.mock('../../server/services/database', () => ({ db: { prepare: () => ({ all: () => [], run: () => ({}) }) } }));
jest.mock('../../server/services/exchangeOps', () => ({ getUserTrades: async () => [] }));

const { _msUntilNextHour, RECON_HOUR_UTC, RECON_MIN_UTC } = require('../../server/services/pnlReconCron');

describe('pnlReconCron schedule target', () => {
    test('targets 04:05 UTC (outside anti-ban window, no cron collision)', () => {
        expect(RECON_HOUR_UTC).toBe(4);
        expect(RECON_MIN_UTC).toBe(5);
    });

    test('_msUntilNextHour honors minutes: 03:00 → 04:05 = 65min', () => {
        expect(_msUntilNextHour(4, 5, new Date('2026-06-09T03:00:00Z'))).toBe(65 * 60000);
    });

    test('_msUntilNextHour rolls to next day when target already passed', () => {
        expect(_msUntilNextHour(4, 5, new Date('2026-06-09T04:06:00Z'))).toBe(24 * 3600000 - 60000);
    });

    test('_msUntilNextHour stays backward-compatible without minutes', () => {
        expect(_msUntilNextHour(2, undefined, new Date('2026-06-09T01:00:00Z'))).toBe(3600000);
    });
});
