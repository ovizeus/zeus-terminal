'use strict';

// [QUOTA-FRESH 2026-06-03] Root cause of chronic OI/sentiment/kline starvation.
// X-MBX-USED-WEIGHT-1M is Binance's 1-MINUTE rolling counter, but
// getQuotaPressure read the last usedWeight from the telemetry ring whose window
// is RING_WINDOW_MS = 1 HOUR. So a single momentary spike (e.g. a reload boot
// burst hitting 6245/6000 = 104%) made getQuotaPressure report 104% for up to an
// HOUR — blocking ALL CLASS_B analytics (OI/funding/sentiment/klines) and most
// signed traffic. Because blocked requests record usedWeight:null, no NEW real
// reading ever arrived to lower it → self-sustaining deadlock (the exact same
// 6245 echoed in logs 24 min apart). Fix: ignore usedWeight readings older than
// ~1 Binance window (75s); stale → pressure 0 so a real probe can refresh it.

const telemetry = require('../../server/services/binanceTelemetry');
const scheduler = require('../../server/services/binanceScheduler');

beforeEach(() => {
    telemetry._resetForTest();
    scheduler._resetForTest();
});

const HOST = 'fapi.binance.com';
function rec(usedWeight) {
    telemetry.recordCall({ host: HOST, path: '/x', source: 'marketRadar', weight: 1, status: 200, latencyMs: 10, usedWeight });
}

describe('getQuotaPressure freshness (1-min counter must not gate for 1h)', () => {
    test('a FRESH usedWeight reading drives pressure', () => {
        telemetry._setNowForTest(1_000_000);
        rec(6245);
        expect(telemetry.getQuotaPressure(HOST)).toBeCloseTo(6245 / 6000);
    });

    test('a STALE reading (>75s old) is ignored → pressure 0 (breaks the deadlock)', () => {
        telemetry._setNowForTest(1_000_000);
        rec(6245);                                      // momentary spike
        telemetry._setNowForTest(1_000_000 + 80_000);   // 80s later, no new reading
        // OLD behaviour: 6245/6000 ≈ 1.04 for the full 1h ring window → deadlock.
        expect(telemetry.getQuotaPressure(HOST)).toBe(0);
    });

    test('a reading still inside the window (60s) is honoured', () => {
        telemetry._setNowForTest(1_000_000);
        rec(5000);
        telemetry._setNowForTest(1_000_000 + 60_000);   // 60s < 75s freshness
        expect(telemetry.getQuotaPressure(HOST)).toBeCloseTo(5000 / 6000);
    });

    test('a fresh LOW reading after a stale spike reflects reality (recovery)', () => {
        telemetry._setNowForTest(1_000_000);
        rec(6245);                                      // spike
        telemetry._setNowForTest(1_000_000 + 80_000);
        rec(120);                                       // fresh reading: quota recovered
        expect(telemetry.getQuotaPressure(HOST)).toBeCloseTo(120 / 6000);
    });

    test('unknown host with no readings → 0', () => {
        telemetry._setNowForTest(1_000_000);
        rec(5000);
        expect(telemetry.getQuotaPressure('other.host')).toBe(0);
    });
});
