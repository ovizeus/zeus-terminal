'use strict';

// [BIN-TELEM 2026-05-19] Instrumentation pentru diagnosticare rate-limit 429
// pe Binance (incident 07:47:54 UTC 2026-05-19). Scop: counter per source,
// per host, per endpoint + capture X-MBX-USED-WEIGHT-1M header pentru ground
// truth pe quota IP. Zero behavior change pe call sites — additive only.

const telemetry = require('../../server/services/binanceTelemetry');
const scheduler = require('../../server/services/binanceScheduler');

beforeEach(() => {
    telemetry._resetForTest();
    // [V6 2026-05-20] Disable V6 mode gating for legacy telemetry tests —
    // these tests don't mock the rateState DB so live ban rows would
    // otherwise short-circuit canProceed and break expected behavior.
    scheduler._resetForTest();
});

describe('binanceTelemetry — core recording', () => {
    test('recordCall stores entry in ring buffer', () => {
        telemetry.recordCall({
            host: 'fapi.binance.com',
            path: '/fapi/v1/ticker/24hr',
            source: 'marketRadar',
            weight: 40,
            status: 200,
            latencyMs: 123,
        });
        const snap = telemetry.getSnapshot();
        expect(snap.totalCalls).toBe(1);
        expect(snap.bySource.marketRadar.calls).toBe(1);
        expect(snap.bySource.marketRadar.weightSum).toBe(40);
        expect(snap.byHost['fapi.binance.com'].calls).toBe(1);
    });

    test('multiple sources are tracked independently', () => {
        telemetry.recordCall({ host: 'fapi.binance.com', path: '/a', source: 'marketRadar', weight: 1, status: 200, latencyMs: 50 });
        telemetry.recordCall({ host: 'fapi.binance.com', path: '/b', source: 'marketFeed', weight: 1, status: 200, latencyMs: 60 });
        telemetry.recordCall({ host: 'testnet.binancefuture.com', path: '/c', source: 'serverAT-signed', weight: 5, status: 200, latencyMs: 80 });
        const snap = telemetry.getSnapshot();
        expect(snap.totalCalls).toBe(3);
        expect(Object.keys(snap.bySource).sort()).toEqual(['marketFeed', 'marketRadar', 'serverAT-signed']);
        expect(snap.bySource['serverAT-signed'].weightSum).toBe(5);
        expect(Object.keys(snap.byHost).sort()).toEqual(['fapi.binance.com', 'testnet.binancefuture.com']);
    });

    test('error statuses are tracked separately', () => {
        telemetry.recordCall({ host: 'fapi.binance.com', path: '/a', source: 'marketRadar', weight: 1, status: 200, latencyMs: 10 });
        telemetry.recordCall({ host: 'fapi.binance.com', path: '/a', source: 'marketRadar', weight: 1, status: 429, latencyMs: 10 });
        telemetry.recordCall({ host: 'fapi.binance.com', path: '/a', source: 'marketRadar', weight: 1, status: 418, latencyMs: 10 });
        const snap = telemetry.getSnapshot();
        expect(snap.bySource.marketRadar.calls).toBe(3);
        expect(snap.bySource.marketRadar.errors2xx).toBe(1);
        expect(snap.bySource.marketRadar.errors4xx).toBe(2);
    });

    test('topEndpoints returns sorted by call count desc', () => {
        for (let i = 0; i < 5; i++) telemetry.recordCall({ host: 'h', path: '/heavy', source: 's', weight: 1, status: 200, latencyMs: 1 });
        for (let i = 0; i < 2; i++) telemetry.recordCall({ host: 'h', path: '/light', source: 's', weight: 1, status: 200, latencyMs: 1 });
        const snap = telemetry.getSnapshot();
        expect(snap.topEndpoints[0]).toEqual({ host: 'h', path: '/heavy', calls: 5 });
        expect(snap.topEndpoints[1]).toEqual({ host: 'h', path: '/light', calls: 2 });
    });

    test('ring buffer bounded — old entries pruned after window', () => {
        // Telemetry keeps last hour by default. Use setTimeForTest to simulate.
        telemetry._setNowForTest(1_000_000);
        telemetry.recordCall({ host: 'h', path: '/old', source: 's', weight: 1, status: 200, latencyMs: 1 });
        telemetry._setNowForTest(1_000_000 + 61 * 60 * 1000);  // +61 min
        telemetry.recordCall({ host: 'h', path: '/fresh', source: 's', weight: 1, status: 200, latencyMs: 1 });
        const snap = telemetry.getSnapshot();
        expect(snap.totalCalls).toBe(1);
        expect(snap.topEndpoints[0].path).toBe('/fresh');
    });
});

describe('binanceTelemetry — used-weight header (Binance ground truth)', () => {
    test('parseUsedWeight extracts X-MBX-USED-WEIGHT-1M case-insensitive', () => {
        expect(telemetry.parseUsedWeight({ 'x-mbx-used-weight-1m': '423' })).toBe(423);
        expect(telemetry.parseUsedWeight({ 'X-MBX-USED-WEIGHT-1M': '1234' })).toBe(1234);
        expect(telemetry.parseUsedWeight({ 'X-Mbx-Used-Weight-1m': '0' })).toBe(0);
    });

    test('parseUsedWeight returns null when missing or invalid', () => {
        expect(telemetry.parseUsedWeight({})).toBe(null);
        expect(telemetry.parseUsedWeight({ 'content-type': 'application/json' })).toBe(null);
        expect(telemetry.parseUsedWeight({ 'x-mbx-used-weight-1m': 'not-a-number' })).toBe(null);
    });

    test('parseUsedWeight reads from Headers-like object with .get()', () => {
        const headers = new Map([['x-mbx-used-weight-1m', '777']]);
        headers.get = function (k) { return Map.prototype.get.call(this, k.toLowerCase()); };
        expect(telemetry.parseUsedWeight(headers)).toBe(777);
    });

    test('recordCall captures usedWeight when provided', () => {
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/a', source: 'marketRadar',
            weight: 40, status: 200, latencyMs: 50, usedWeight: 423,
        });
        const snap = telemetry.getSnapshot();
        expect(snap.byHost['fapi.binance.com'].lastUsedWeight).toBe(423);
        expect(snap.byHost['fapi.binance.com'].peakUsedWeight).toBe(423);
    });

    test('peakUsedWeight tracks high water mark per host', () => {
        telemetry.recordCall({ host: 'h', path: '/a', source: 's', weight: 1, status: 200, latencyMs: 1, usedWeight: 100 });
        telemetry.recordCall({ host: 'h', path: '/a', source: 's', weight: 1, status: 200, latencyMs: 1, usedWeight: 500 });
        telemetry.recordCall({ host: 'h', path: '/a', source: 's', weight: 1, status: 200, latencyMs: 1, usedWeight: 300 });
        const snap = telemetry.getSnapshot();
        expect(snap.byHost.h.peakUsedWeight).toBe(500);
        expect(snap.byHost.h.lastUsedWeight).toBe(300);
    });
});

describe('binanceTelemetry — wrapped fetch', () => {
    test('wrapFetch records timing + status + source on success', async () => {
        const fakeFetch = async () => ({
            status: 200,
            ok: true,
            headers: { get: (k) => k.toLowerCase() === 'x-mbx-used-weight-1m' ? '123' : null },
            json: async () => ({ ok: true }),
        });
        const res = await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/fapi/v1/test', { __src: 'marketRadar' });
        expect(res.status).toBe(200);
        const snap = telemetry.getSnapshot();
        expect(snap.totalCalls).toBe(1);
        expect(snap.bySource.marketRadar.calls).toBe(1);
        expect(snap.byHost['fapi.binance.com'].lastUsedWeight).toBe(123);
    });

    test('wrapFetch records 429 as error4xx', async () => {
        const fakeFetch = async () => ({
            status: 429,
            ok: false,
            headers: { get: () => null },
            json: async () => ({ msg: 'rate-limit' }),
        });
        const res = await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/x', { __src: 'marketFeed' });
        expect(res.status).toBe(429);
        const snap = telemetry.getSnapshot();
        expect(snap.bySource.marketFeed.errors4xx).toBe(1);
    });

    test('wrapFetch records thrown error as networkErrors', async () => {
        const fakeFetch = async () => { throw new Error('ECONNRESET'); };
        await expect(
            telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/x', { __src: 'depth' })
        ).rejects.toThrow('ECONNRESET');
        const snap = telemetry.getSnapshot();
        expect(snap.bySource.depth.networkErrors).toBe(1);
    });

    test('wrapFetch with missing __src defaults to "unknown"', async () => {
        const fakeFetch = async () => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => ({}) });
        await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/x', {});
        const snap = telemetry.getSnapshot();
        expect(snap.bySource.unknown.calls).toBe(1);
    });
});

describe('binanceTelemetry — growth markers', () => {
    test('snapshot reports bootTs + uptimeMs', () => {
        const snap = telemetry.getSnapshot();
        expect(typeof snap.bootTs).toBe('number');
        expect(typeof snap.uptimeMs).toBe('number');
        expect(snap.uptimeMs).toBeGreaterThanOrEqual(0);
    });

    test('snapshot reports activePollersHint when registered', () => {
        telemetry.registerActivePollersProvider(() => ({ alt_klines: 12, depth: 4 }));
        const snap = telemetry.getSnapshot();
        expect(snap.activePollers).toEqual({ alt_klines: 12, depth: 4 });
    });

    test('callsPer1min computed from last 60s of ring buffer', () => {
        telemetry._setNowForTest(1_000_000);
        // 5 calls în "ultimul minut"
        for (let i = 0; i < 5; i++) {
            telemetry.recordCall({ host: 'h', path: '/a', source: 's', weight: 1, status: 200, latencyMs: 1 });
        }
        telemetry._setNowForTest(1_000_000 + 30 * 60 * 1000);  // +30min
        // 2 calls "acum" (după 30min)
        for (let i = 0; i < 2; i++) {
            telemetry.recordCall({ host: 'h', path: '/a', source: 's', weight: 1, status: 200, latencyMs: 1 });
        }
        const snap = telemetry.getSnapshot();
        // Doar ultimele 60s contează pentru callsPer1min
        expect(snap.callsPer1min).toBe(2);
        // 5min window prinde toate cele 2 recente, nu cele 5 vechi
        expect(snap.callsPer5min).toBe(2);
    });
});

describe('binanceTelemetry — quota pressure (Phase A.1)', () => {
    test('getQuotaPressure returns 0 when no calls recorded', () => {
        expect(telemetry.getQuotaPressure('fapi.binance.com')).toBe(0);
    });

    test('getQuotaPressure returns lastUsedWeight/CAP ratio', () => {
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/a', source: 'marketRadar',
            weight: 40, status: 200, latencyMs: 50, usedWeight: 3000,
        });
        // Default CAP 6000 → 3000/6000 = 0.5
        expect(telemetry.getQuotaPressure('fapi.binance.com')).toBe(0.5);
    });

    test('getQuotaPressure unknown host returns 0', () => {
        expect(telemetry.getQuotaPressure('nowhere.example.com')).toBe(0);
    });

    test('getQuotaPressure tracks lastUsedWeight (not peak)', () => {
        telemetry.recordCall({ host: 'h', path: '/a', source: 's', weight: 1, status: 200, latencyMs: 1, usedWeight: 5000 });
        telemetry.recordCall({ host: 'h', path: '/a', source: 's', weight: 1, status: 200, latencyMs: 1, usedWeight: 2000 });
        // last=2000, peak=5000. Pressure must reflect LAST not peak (recovery aware).
        expect(telemetry.getQuotaPressure('h')).toBeCloseTo(2000 / 6000, 4);
    });

    test('isSignedSource detects signer: prefix', () => {
        expect(telemetry.isSignedSource('signer:GET /fapi/v2/balance')).toBe(true);
        expect(telemetry.isSignedSource('signer:POST /fapi/v1/order')).toBe(true);
    });

    test('isSignedSource detects serverAT: prefix', () => {
        expect(telemetry.isSignedSource('serverAT:recon-positionRisk')).toBe(true);
    });

    test('isSignedSource returns false for public sources', () => {
        expect(telemetry.isSignedSource('marketRadar:oi')).toBe(false);
        expect(telemetry.isSignedSource('marketFeed:alt-klines')).toBe(false);
        expect(telemetry.isSignedSource('serverLiquidity:depth')).toBe(false);
        expect(telemetry.isSignedSource('unknown')).toBe(false);
        expect(telemetry.isSignedSource(null)).toBe(false);
        expect(telemetry.isSignedSource(undefined)).toBe(false);
    });
});

describe('binanceTelemetry — wrapFetch preemptive gate (Phase A.1)', () => {
    test('wrapFetch returns synthetic 429 when signed P1 pressure >= 97%', async () => {
        // Phase A.2: scheduler passes P1 (recon) but A.1 still blocks signed
        // sources at 97%. P1 (serverAT:recon-) at 97.2% must be blocked by A.1.
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/seed', source: 'signer:warmup',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 5830,  // 97.2%
        });
        let fetchCalled = false;
        const fakeFetch = async () => { fetchCalled = true; return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({}) }; };
        const res = await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/test', { __src: 'serverAT:recon-positionRisk' });
        expect(fetchCalled).toBe(false);
        expect(res.status).toBe(429);
        expect(res.ok).toBe(false);
        const body = await res.json();
        expect(body.code).toBe(-1003);
        expect(body.msg).toMatch(/preemptive/i);
    });

    test('wrapFetch allows P5 request when pressure < 70% (below scheduler threshold)', async () => {
        // Phase A.2: P5 (marketRadar) scheduler threshold is 70%. Below that,
        // scheduler passes and A.1 95% gate is not reached — request proceeds.
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/seed', source: 'marketRadar',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 3000,  // 50%
        });
        let fetchCalled = false;
        const fakeFetch = async () => { fetchCalled = true; return { status: 200, ok: true, headers: { get: () => '3050' }, json: async () => ({}) }; };
        const res = await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/test', { __src: 'marketRadar:oi' });
        expect(fetchCalled).toBe(true);
        expect(res.status).toBe(200);
    });

    test('wrapFetch P0 signed tolerates pressure below A.1 signed threshold (97%)', async () => {
        // Phase A.2: P0 bypasses scheduler; A.1 signed threshold is 97%.
        // At 96% P0 must proceed.
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/seed', source: 'signer:warmup',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 5760,  // 96%
        });
        let fetchCalled = false;
        const fakeFetch = async () => { fetchCalled = true; return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({}) }; };
        const res = await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/test', { __src: 'signer:POST /fapi/v1/order' });
        expect(fetchCalled).toBe(true);  // P0 gets through scheduler + A.1 at 96%
        expect(res.status).toBe(200);
    });

    test('wrapFetch P1 DOES block at 97% pressure via A.1', async () => {
        // Phase A.2: P1 bypasses scheduler; A.1 signed threshold is 97%.
        // Different recon path to confirm all serverAT:recon- variants blocked.
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/seed', source: 'signer:warmup',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 5900,  // 98.3%
        });
        let fetchCalled = false;
        const fakeFetch = async () => { fetchCalled = true; return { status: 200 }; };
        const res = await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/test', { __src: 'serverAT:recon-balance' });
        expect(fetchCalled).toBe(false);
        expect(res.status).toBe(429);
    });

    test('synthetic 429 records blockedByPressure counter for P1 source', async () => {
        // Phase A.2: P1 (serverAT:recon-) bypasses scheduler but not A.1.
        // At 97.2% A.1 blocks the signed P1 source (signed threshold = 97%).
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/seed', source: 'signer:warmup',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 5830,  // 97.2%
        });
        const fakeFetch = async () => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => ({}) });
        await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/x', { __src: 'serverAT:recon-positionRisk' });
        await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/y', { __src: 'serverAT:recon-positionRisk' });
        const snap = telemetry.getSnapshot();
        expect(snap.bySource['serverAT:recon-positionRisk'].blockedByPressure).toBe(2);
    });

    test('non-blocked request does NOT increment blockedByPressure', async () => {
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/seed', source: 'marketRadar',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 1000,  // 16%
        });
        const fakeFetch = async () => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => ({}) });
        await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/x', { __src: 'marketRadar:oi' });
        const snap = telemetry.getSnapshot();
        // Either 0 or undefined acceptable since source created mid-flight
        const cnt = (snap.bySource['marketRadar:oi'] || {}).blockedByPressure || 0;
        expect(cnt).toBe(0);
    });

    test('synthetic 429 response.headers.get returns last usedWeight (P1 source)', async () => {
        // Phase A.2: P1 (serverAT:recon-) bypasses scheduler but not A.1.
        // At 97.2% A.1 blocks and returns headers with usedWeight.
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/seed', source: 'signer:warmup',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 5830,  // 97.2%
        });
        const res = await telemetry.wrapFetch(async () => ({}), 'https://fapi.binance.com/x', { __src: 'serverAT:recon-positionRisk' });
        expect(res.headers.get('x-mbx-used-weight-1m')).toBe('5830');
    });
});

describe('binanceTelemetry — getSnapshot exposes pressure (Phase A.1)', () => {
    test('snapshot.quotaPressure reports ratio per host', () => {
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/a', source: 's',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 3000,
        });
        telemetry.recordCall({
            host: 'testnet.binancefuture.com', path: '/b', source: 's',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 5400,
        });
        const snap = telemetry.getSnapshot();
        expect(snap.quotaPressure).toBeDefined();
        expect(snap.quotaPressure['fapi.binance.com']).toBeCloseTo(0.5, 3);
        expect(snap.quotaPressure['testnet.binancefuture.com']).toBeCloseTo(0.9, 3);
    });

    test('snapshot.quotaThresholds reports configured caps', () => {
        const snap = telemetry.getSnapshot();
        expect(snap.quotaThresholds).toBeDefined();
        expect(snap.quotaThresholds.cap).toBe(6000);
        expect(snap.quotaThresholds.blockPublicPct).toBe(95);
        expect(snap.quotaThresholds.blockSignedPct).toBe(97);
    });
});

describe('binanceTelemetry — scheduler integration (Phase A.2)', () => {
    test('wrapFetch returns synthetic 503 when scheduler rejects', async () => {
        // Seed pressure at 75% — P5 reject at 70%
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/seed', source: 'marketRadar',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 4500,  // 75%
        });
        let fetchCalled = false;
        const fakeFetch = async () => { fetchCalled = true; return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({}) }; };
        const res = await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/x', { __src: 'marketRadar:oi' });
        expect(fetchCalled).toBe(false);
        expect(res.status).toBe(503);
        expect(res.ok).toBe(false);
        const body = await res.json();
        expect(body.code).toBe('BINANCE_SCHEDULER_BACKPRESSURE');
        expect(body.lane).toBe('P5');
        expect(body.retryable).toBe(true);
        expect(body.synthetic).toBe(true);
        expect(body.pressure).toBeCloseTo(0.75, 2);
    });

    test('wrapFetch records rejectedByScheduler flag in stats', async () => {
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/seed', source: 'marketRadar',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 4500,
        });
        const fakeFetch = async () => ({ status: 200 });
        await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/x', { __src: 'marketRadar:oi' });
        const snap = telemetry.getSnapshot();
        expect(snap.bySource['marketRadar:oi'].rejectedByScheduler).toBe(1);
    });

    test('wrapFetch P0 always proceeds even at extreme pressure', async () => {
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/seed', source: 'signer:warmup',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 5950,  // 99.2%
        });
        let fetchCalled = false;
        const fakeFetch = async () => { fetchCalled = true; return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({}) }; };
        await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/x', { __src: 'signer:POST /fapi/v1/order' });
        expect(fetchCalled).toBe(true);  // P0 proceeds
    });

    test('wrapFetch low pressure allows normal flow', async () => {
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/seed', source: 'marketRadar',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 1000,  // 16.7%
        });
        let fetchCalled = false;
        const fakeFetch = async () => { fetchCalled = true; return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({}) }; };
        const res = await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/x', { __src: 'marketRadar:oi' });
        expect(fetchCalled).toBe(true);
        expect(res.status).toBe(200);
    });

    test('getSnapshot exposes schedulerStats', () => {
        const snap = telemetry.getSnapshot();
        expect(snap.schedulerStats).toBeDefined();
        expect(snap.schedulerStats.byLane).toBeDefined();
        expect(snap.schedulerStats.totalDecisions).toBeGreaterThanOrEqual(0);
    });
});

describe('binanceTelemetry — synthetic 429 must NOT poison lastUsedWeight', () => {
    test('synthetic 429 (blockedByPressure) does NOT update lastUsedWeight in ring', () => {
        // Only a synthetic 429 — no real call before it
        telemetry.recordCall({
            host: 'fapi.binance.com',
            path: '/fapi/v1/klines',
            source: 'marketProxy',
            weight: 0,
            status: 429,
            latencyMs: 0,
            usedWeight: 5834,
            blockedByPressure: true,
        });

        const snap = telemetry.getSnapshot();
        // Synthetic should NOT set lastUsedWeight — stale data must not poison the ring
        expect(snap.byHost['fapi.binance.com'].lastUsedWeight).toBeNull();
    });

    test('real call after synthetic properly updates lastUsedWeight', () => {
        // Synthetic first (stale 5834)
        telemetry.recordCall({
            host: 'fapi.binance.com',
            path: '/fapi/v1/klines',
            source: 'marketProxy',
            weight: 0,
            status: 429,
            latencyMs: 0,
            usedWeight: 5834,
            blockedByPressure: true,
        });

        // Real call with fresh weight from Binance
        telemetry.recordCall({
            host: 'fapi.binance.com',
            path: '/fapi/v1/ticker/24hr',
            source: 'marketProxy',
            weight: 40,
            status: 200,
            latencyMs: 80,
            usedWeight: 137,
        });

        const snap = telemetry.getSnapshot();
        expect(snap.byHost['fapi.binance.com'].lastUsedWeight).toBe(137);
    });

    test('quota pressure is 0 when only synthetic 429s exist in ring', () => {
        telemetry.recordCall({
            host: 'fapi.binance.com',
            path: '/fapi/v1/klines',
            source: 'marketProxy',
            weight: 0,
            status: 429,
            latencyMs: 0,
            usedWeight: 5834,
            blockedByPressure: true,
        });

        expect(telemetry.getQuotaPressure('fapi.binance.com')).toBe(0);
    });

    test('after stale weight expires from ring, pressure drops to 0', () => {
        telemetry._setNowForTest(Date.now() - 3700_000);
        telemetry.recordCall({
            host: 'fapi.binance.com',
            path: '/fapi/v1/klines',
            source: 'signer:recon',
            weight: 5,
            status: 200,
            latencyMs: 50,
            usedWeight: 5834,
        });

        telemetry._setNowForTest(null);
        const snap = telemetry.getSnapshot();
        expect(snap.byHost['fapi.binance.com']).toBeUndefined();
        expect(telemetry.getQuotaPressure('fapi.binance.com')).toBe(0);
    });
});
