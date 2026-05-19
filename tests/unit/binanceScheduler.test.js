'use strict';

const scheduler = require('../../server/services/binanceScheduler');

beforeEach(() => {
    scheduler._resetForTest();
});

describe('binanceScheduler — lane mapping', () => {
    test('signer order POST → P0', () => {
        expect(scheduler.laneForSrc('signer:POST /fapi/v1/order')).toBe('P0');
        expect(scheduler.laneForSrc('signer:POST /fapi/v1/algoOrder')).toBe('P0');
        expect(scheduler.laneForSrc('signer:DELETE /fapi/v1/order')).toBe('P0');
        expect(scheduler.laneForSrc('signer:POST /fapi/v1/leverage')).toBe('P0');
        expect(scheduler.laneForSrc('signer:POST /fapi/v1/marginType')).toBe('P0');
    });

    test('serverAT recon → P1', () => {
        expect(scheduler.laneForSrc('serverAT:recon-positionRisk')).toBe('P1');
    });

    test('signer status checks → P2', () => {
        expect(scheduler.laneForSrc('signer:GET /fapi/v2/positionRisk')).toBe('P2');
        expect(scheduler.laneForSrc('signer:GET /fapi/v2/balance')).toBe('P2');
        expect(scheduler.laneForSrc('signer:GET /fapi/v1/order')).toBe('P2');
        expect(scheduler.laneForSrc('signer:GET /fapi/v1/openOrders')).toBe('P2');
    });

    test('marketFeed klines-init → P3', () => {
        expect(scheduler.laneForSrc('marketFeed:klines-init')).toBe('P3');
    });

    test('marketFeed live data → P4', () => {
        expect(scheduler.laneForSrc('marketFeed:alt-klines')).toBe('P4');
        expect(scheduler.laneForSrc('marketFeed:funding')).toBe('P4');
        expect(scheduler.laneForSrc('marketFeed:oi')).toBe('P4');
    });

    test('marketRadar + serverLiquidity → P5', () => {
        expect(scheduler.laneForSrc('marketRadar:ticker24h')).toBe('P5');
        expect(scheduler.laneForSrc('marketRadar:oi')).toBe('P5');
        expect(scheduler.laneForSrc('marketRadar:funding')).toBe('P5');
        expect(scheduler.laneForSrc('serverLiquidity:depth')).toBe('P5');
    });

    test('unknown source → P5 default', () => {
        expect(scheduler.laneForSrc('mystery:something')).toBe('P5');
        expect(scheduler.laneForSrc('')).toBe('P5');
        expect(scheduler.laneForSrc(null)).toBe('P5');
        expect(scheduler.laneForSrc(undefined)).toBe('P5');
    });
});

describe('binanceScheduler — canProceed thresholds (deterministic)', () => {
    beforeEach(() => {
        scheduler._setRngForTest(() => 0.5);
    });

    test('P0 always accepted regardless of pressure', () => {
        for (const p of [0, 0.5, 0.85, 0.95, 0.99]) {
            const r = scheduler.canProceed({ pressure: p, src: 'signer:POST /fapi/v1/order' });
            expect(r.accept).toBe(true);
            expect(r.lane).toBe('P0');
        }
    });

    test('P1 always accepted regardless of pressure', () => {
        for (const p of [0, 0.5, 0.95, 0.99]) {
            const r = scheduler.canProceed({ pressure: p, src: 'serverAT:recon-positionRisk' });
            expect(r.accept).toBe(true);
            expect(r.lane).toBe('P1');
        }
    });

    test('P2 rejected at >= 95% pressure', () => {
        expect(scheduler.canProceed({ pressure: 0.94, src: 'signer:GET /fapi/v2/balance' }).accept).toBe(true);
        const r = scheduler.canProceed({ pressure: 0.95, src: 'signer:GET /fapi/v2/balance' });
        expect(r.accept).toBe(false);
        expect(r.lane).toBe('P2');
        expect(r.reason).toBe('threshold_reject');
    });

    test('P3 rejected at >= 90% pressure', () => {
        expect(scheduler.canProceed({ pressure: 0.89, src: 'marketFeed:klines-init' }).accept).toBe(true);
        const r = scheduler.canProceed({ pressure: 0.90, src: 'marketFeed:klines-init' });
        expect(r.accept).toBe(false);
        expect(r.lane).toBe('P3');
    });

    test('P5 rejected at >= 70% pressure', () => {
        expect(scheduler.canProceed({ pressure: 0.69, src: 'marketRadar:oi' }).accept).toBe(true);
        const r = scheduler.canProceed({ pressure: 0.70, src: 'marketRadar:oi' });
        expect(r.accept).toBe(false);
        expect(r.lane).toBe('P5');
    });

    test('P4 below 80% always accepts', () => {
        const r = scheduler.canProceed({ pressure: 0.79, src: 'marketFeed:alt-klines' });
        expect(r.accept).toBe(true);
        expect(r.lane).toBe('P4');
    });

    test('P4 between 80-89% probabilistic — RNG 0.51 → reject', () => {
        scheduler._setRngForTest(() => 0.51);
        const r = scheduler.canProceed({ pressure: 0.85, src: 'marketFeed:alt-klines' });
        expect(r.accept).toBe(false);
        expect(r.reason).toBe('probabilistic_reject');
    });

    test('P4 between 80-89% probabilistic — RNG 0.49 → accept', () => {
        scheduler._setRngForTest(() => 0.49);
        const r = scheduler.canProceed({ pressure: 0.85, src: 'marketFeed:alt-klines' });
        expect(r.accept).toBe(true);
        expect(r.lane).toBe('P4');
    });

    test('P4 between 90-94% probabilistic acceptProb=0.20', () => {
        scheduler._setRngForTest(() => 0.21);
        expect(scheduler.canProceed({ pressure: 0.92, src: 'marketFeed:alt-klines' }).accept).toBe(false);
        scheduler._setRngForTest(() => 0.19);
        expect(scheduler.canProceed({ pressure: 0.92, src: 'marketFeed:alt-klines' }).accept).toBe(true);
    });

    test('P4 above 95% acceptProb=0.10', () => {
        scheduler._setRngForTest(() => 0.11);
        expect(scheduler.canProceed({ pressure: 0.97, src: 'marketFeed:alt-klines' }).accept).toBe(false);
        scheduler._setRngForTest(() => 0.09);
        expect(scheduler.canProceed({ pressure: 0.97, src: 'marketFeed:alt-klines' }).accept).toBe(true);
    });
});

describe('binanceScheduler — reject response shape', () => {
    test('reject response includes lane, pressure, retryable, reason', () => {
        const r = scheduler.canProceed({ pressure: 0.85, src: 'marketRadar:oi' });
        expect(r.accept).toBe(false);
        expect(r.lane).toBe('P5');
        expect(r.pressure).toBe(0.85);
        expect(r.retryable).toBe(true);
        expect(r.reason).toBe('threshold_reject');
    });

    test('accept response includes lane', () => {
        const r = scheduler.canProceed({ pressure: 0.5, src: 'marketRadar:oi' });
        expect(r.accept).toBe(true);
        expect(r.lane).toBe('P5');
    });
});

describe('binanceScheduler — stats introspection', () => {
    test('getStats returns counts per lane and per reason', () => {
        scheduler.canProceed({ pressure: 0.5, src: 'marketRadar:oi' });
        scheduler.canProceed({ pressure: 0.75, src: 'marketRadar:oi' });
        scheduler.canProceed({ pressure: 0.99, src: 'signer:POST /fapi/v1/order' });
        const s = scheduler.getStats();
        expect(s.totalDecisions).toBe(3);
        expect(s.byLane.P5.accepted).toBe(1);
        expect(s.byLane.P5.rejected).toBe(1);
        expect(s.byLane.P0.accepted).toBe(1);
    });
});

describe('binanceScheduler — critical section ref-counted', () => {
    test('beginCriticalSection adds to active map', () => {
        scheduler.beginCriticalSection('order-1');
        expect(scheduler.getActiveCriticalSections()).toBe(1);
    });

    test('endCriticalSection removes from active map', () => {
        scheduler.beginCriticalSection('order-1');
        scheduler.endCriticalSection('order-1');
        expect(scheduler.getActiveCriticalSections()).toBe(0);
    });

    test('two overlapping sections — end of one does NOT release until both ended', () => {
        scheduler.beginCriticalSection('order-A');
        scheduler.beginCriticalSection('order-B');
        expect(scheduler.getActiveCriticalSections()).toBe(2);
        scheduler.endCriticalSection('order-A');
        expect(scheduler.getActiveCriticalSections()).toBe(1);
        scheduler.endCriticalSection('order-B');
        expect(scheduler.getActiveCriticalSections()).toBe(0);
    });

    test('beginCriticalSection with same opId is idempotent (no double-count)', () => {
        scheduler.beginCriticalSection('order-1');
        scheduler.beginCriticalSection('order-1');
        expect(scheduler.getActiveCriticalSections()).toBe(1);
    });

    test('endCriticalSection on unknown opId is no-op', () => {
        scheduler.endCriticalSection('never-started');
        expect(scheduler.getActiveCriticalSections()).toBe(0);
    });

    test('expired sections are cleaned lazily on next access', () => {
        scheduler._setNowForTest(1000);
        scheduler.beginCriticalSection('order-1', 100);
        expect(scheduler.getActiveCriticalSections()).toBe(1);
        scheduler._setNowForTest(1200);
        expect(scheduler.getActiveCriticalSections()).toBe(0);
    });

    test('during critical section P3/P4/P5 always reject regardless of pressure', () => {
        scheduler.beginCriticalSection('order-1');
        const r5 = scheduler.canProceed({ pressure: 0.10, src: 'marketRadar:oi' });
        expect(r5.accept).toBe(false);
        expect(r5.reason).toBe('critical_section');
        const r4 = scheduler.canProceed({ pressure: 0.10, src: 'marketFeed:alt-klines' });
        expect(r4.accept).toBe(false);
        expect(r4.reason).toBe('critical_section');
        const r3 = scheduler.canProceed({ pressure: 0.10, src: 'marketFeed:klines-init' });
        expect(r3.accept).toBe(false);
        expect(r3.reason).toBe('critical_section');
    });

    test('during critical section P0/P1/P2 still accept (preserved)', () => {
        scheduler.beginCriticalSection('order-1');
        expect(scheduler.canProceed({ pressure: 0.10, src: 'signer:POST /fapi/v1/order' }).accept).toBe(true);
        expect(scheduler.canProceed({ pressure: 0.10, src: 'serverAT:recon-positionRisk' }).accept).toBe(true);
        expect(scheduler.canProceed({ pressure: 0.10, src: 'signer:GET /fapi/v2/balance' }).accept).toBe(true);
    });

    test('after endCriticalSection P3/P4/P5 resume normal threshold rules', () => {
        scheduler.beginCriticalSection('order-1');
        scheduler.endCriticalSection('order-1');
        expect(scheduler.canProceed({ pressure: 0.10, src: 'marketRadar:oi' }).accept).toBe(true);
    });

    test('default maxMs is 5000', () => {
        scheduler._setNowForTest(1000);
        scheduler.beginCriticalSection('order-1');
        scheduler._setNowForTest(5999);
        expect(scheduler.getActiveCriticalSections()).toBe(1);
        scheduler._setNowForTest(6001);
        expect(scheduler.getActiveCriticalSections()).toBe(0);
    });
});
