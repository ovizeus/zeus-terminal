'use strict';

// [BOOT-STAGGER B 2026-06-05] exchangeInfo.loadExchangeInfo() was the only
// boot-time Binance call that bypassed binanceGateway/telemetry (direct
// fetch(), 10 weight, invisible to the quota gate). It now routes through the
// gateway with __src 'exchangeInfo:snapshot'. Lane must be P2: its filters
// (stepSize/tickSize/minNotional) are REQUIRED for order rounding — it must
// survive the boot-blind conservative pressure (0.85) and only shed at ≥0.95.
// Without an explicit rule it would fall to DEFAULT_LANE=P5 and be rejected
// for the whole boot-blind window (no exchangeInfo → no order rounding).

const scheduler = require('../../server/services/binanceScheduler');

beforeEach(() => scheduler._resetForTest());

describe('exchangeInfo lane mapping (boot-stagger B)', () => {
    test('THE FIX: exchangeInfo:snapshot → P2 (not default P5)', () => {
        const d = scheduler.canProceed({ pressure: 0.0, src: 'exchangeInfo:snapshot', path: '/fapi/v1/exchangeInfo' });
        expect(d.lane).toBe('P2');
        expect(d.accept).toBe(true);
    });

    test('accepted at boot-blind conservative pressure 0.85 (P2 threshold is 0.95)', () => {
        const d = scheduler.canProceed({ pressure: 0.85, src: 'exchangeInfo:snapshot', path: '/fapi/v1/exchangeInfo' });
        expect(d.accept).toBe(true);
    });

    test('still shed at extreme pressure ≥0.95 (not P0/P1-sacred)', () => {
        const d = scheduler.canProceed({ pressure: 0.96, src: 'exchangeInfo:snapshot', path: '/fapi/v1/exchangeInfo' });
        expect(d.accept).toBe(false);
    });
});
