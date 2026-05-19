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
