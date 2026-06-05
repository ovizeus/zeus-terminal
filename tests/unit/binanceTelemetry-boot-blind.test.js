'use strict';

// [BOOT-STAGGER C 2026-06-05] The quota gate is BLIND at boot: pressure is
// measured from X-MBX-USED-WEIGHT-1M response headers, but at t=0 no response
// has arrived yet → getQuotaPressure()=0 → all lanes fire freely → boot burst
// (two 418 IP bans: 2026-06-04 rapid reloads, 2026-06-05 06:06 auto-restart
// chain). Fix: while the process is young (uptime < BOOT_BLIND_MS) AND no
// fresh header reading exists for the host, assume conservative pressure
// (0.85) so P5 defers and P4 sheds probabilistically until the first REAL
// header lands. P0-P3 unaffected (0.85 < their thresholds). The stale-reading
// deadlock fix (QUOTA_FRESHNESS_MS → return 0) is preserved OUTSIDE the boot
// window.
//
// [BOOT-STAGGER D] Observability: real 429/418 responses (and preemptive
// synthetic 429s) were invisible in logs — today's pre-restart ban had no
// trace. wrapFetch now WARN-logs them, rate-limited per host+status.

jest.mock('../../server/services/logger', () => ({
    warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const telemetry = require('../../server/services/binanceTelemetry');
const logger = require('../../server/services/logger');

const HOST = 'fapi.binance.com';
const T0 = 1_780_000_000_000;

beforeEach(() => {
    telemetry._resetForTest();
    logger.warn.mockClear();
});

describe('getQuotaPressure — boot-blind conservative window (C)', () => {
    test('THE FIX: no reading at all + uptime < window → conservative 0.85', () => {
        telemetry._setBootTsForTest(T0);
        telemetry._setNowForTest(T0 + 10_000); // 10s after boot
        expect(telemetry.getQuotaPressure(HOST)).toBeCloseTo(0.85);
    });

    test('no reading + uptime PAST window → 0 (legacy behaviour)', () => {
        telemetry._setBootTsForTest(T0);
        telemetry._setNowForTest(T0 + 200_000); // 200s after boot (>120s)
        expect(telemetry.getQuotaPressure(HOST)).toBe(0);
    });

    test('fresh real reading wins over boot-blind (gate sees truth ASAP)', () => {
        telemetry._setBootTsForTest(T0);
        telemetry._setNowForTest(T0 + 5_000);
        telemetry.recordCall({ host: HOST, path: '/fapi/v1/klines', source: 'marketFeed:klines-init', weight: 5, status: 200, latencyMs: 100, usedWeight: 600 });
        telemetry._setNowForTest(T0 + 10_000);
        expect(telemetry.getQuotaPressure(HOST)).toBeCloseTo(600 / 6000);
    });

    test('stale reading + within boot window → conservative 0.85 (not 0)', () => {
        telemetry._setBootTsForTest(T0);
        telemetry._setNowForTest(T0 + 1_000);
        telemetry.recordCall({ host: HOST, path: '/fapi/v1/klines', source: 'x', weight: 5, status: 200, latencyMs: 100, usedWeight: 6245 });
        telemetry._setNowForTest(T0 + 100_000); // reading now 99s old (>75s stale), uptime 100s (<120s)
        expect(telemetry.getQuotaPressure(HOST)).toBeCloseTo(0.85);
    });

    test('DEADLOCK FIX PRESERVED: stale reading + past boot window → 0', () => {
        telemetry._setBootTsForTest(T0);
        telemetry._setNowForTest(T0 + 130_000);
        telemetry.recordCall({ host: HOST, path: '/fapi/v1/klines', source: 'x', weight: 5, status: 200, latencyMs: 100, usedWeight: 6245 });
        telemetry._setNowForTest(T0 + 300_000); // reading 170s old, uptime 300s
        expect(telemetry.getQuotaPressure(HOST)).toBe(0);
    });

    test('per-host: another host with fresh reading unaffected by boot-blind', () => {
        telemetry._setBootTsForTest(T0);
        telemetry._setNowForTest(T0 + 5_000);
        telemetry.recordCall({ host: 'testnet.binancefuture.com', path: '/fapi/v1/balance', source: 'signer:GET /fapi/v2/balance', weight: 5, status: 200, latencyMs: 80, usedWeight: 120 });
        telemetry._setNowForTest(T0 + 10_000);
        expect(telemetry.getQuotaPressure('testnet.binancefuture.com')).toBeCloseTo(120 / 6000);
        expect(telemetry.getQuotaPressure(HOST)).toBeCloseTo(0.85); // fapi still blind
    });
});

describe('wrapFetch — 429/418 observability (D)', () => {
    function mkRes(status, usedWeight) {
        return {
            status, ok: status < 400,
            headers: { get: (k) => k.toLowerCase() === 'x-mbx-used-weight-1m' ? String(usedWeight) : null },
            json: async () => ({}),
        };
    }

    test('real 429 response → logger.warn with host/src/path', async () => {
        telemetry._setBootTsForTest(T0 - 999_000); // long past boot window
        const fetchFn = jest.fn(async () => mkRes(429, 2500));
        await telemetry.wrapFetch(fetchFn, 'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT', { __src: 'marketFeed:klines-init', __weight: 5 });
        expect(logger.warn).toHaveBeenCalled();
        const msg = logger.warn.mock.calls.map(c => c.join(' ')).join('\n');
        expect(msg).toMatch(/429/);
        expect(msg).toMatch(/fapi\.binance\.com/);
        expect(msg).toMatch(/klines/);
    });

    test('real 418 response → logger.warn', async () => {
        telemetry._setBootTsForTest(T0 - 999_000);
        const fetchFn = jest.fn(async () => mkRes(418, 6100));
        await telemetry.wrapFetch(fetchFn, 'https://fapi.binance.com/fapi/v1/ticker/24hr', { __src: 'marketRadar:scan', __weight: 40 });
        const msg = logger.warn.mock.calls.map(c => c.join(' ')).join('\n');
        expect(msg).toMatch(/418/);
    });

    test('rate-limited: identical 429s within 10s log only once', async () => {
        telemetry._setBootTsForTest(T0 - 999_000);
        telemetry._setNowForTest(T0);
        const fetchFn = jest.fn(async () => mkRes(429, 2500));
        await telemetry.wrapFetch(fetchFn, 'https://fapi.binance.com/fapi/v1/klines', { __src: 'a', __weight: 1 });
        telemetry._setNowForTest(T0 + 2_000);
        await telemetry.wrapFetch(fetchFn, 'https://fapi.binance.com/fapi/v1/klines', { __src: 'a', __weight: 1 });
        const rateLogs = logger.warn.mock.calls.filter(c => c.join(' ').includes('429'));
        expect(rateLogs.length).toBe(1);
    });

    test('200 response → no rate-limit warn', async () => {
        telemetry._setBootTsForTest(T0 - 999_000);
        const fetchFn = jest.fn(async () => mkRes(200, 100));
        await telemetry.wrapFetch(fetchFn, 'https://fapi.binance.com/fapi/v1/klines', { __src: 'a', __weight: 1 });
        expect(logger.warn).not.toHaveBeenCalled();
    });
});
