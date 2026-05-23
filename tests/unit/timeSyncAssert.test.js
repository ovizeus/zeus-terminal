'use strict';

const tsa = require('../../server/services/timeSyncAssert');

describe('timeSyncAssert', () => {
    afterEach(() => {
        if (typeof tsa.stop === 'function') tsa.stop();
    });

    describe('constants', () => {
        it('THRESHOLD_MS = 500', () => {
            expect(tsa.THRESHOLD_MS).toBe(500);
        });

        it('CHECK_INTERVAL_MS = 5 minutes', () => {
            expect(tsa.CHECK_INTERVAL_MS).toBe(5 * 60 * 1000);
        });
    });

    describe('checkDrift(local, server)', () => {
        it('returns ok=true when drift within threshold', () => {
            const local = Date.now();
            const result = tsa.checkDrift(local, local + 100);
            expect(result.ok).toBe(true);
            expect(result.drift).toBe(100);
            expect(result.threshold).toBe(500);
        });

        it('returns ok=true at exact threshold boundary (500ms)', () => {
            const local = Date.now();
            expect(tsa.checkDrift(local, local + 500).ok).toBe(true);
            expect(tsa.checkDrift(local, local - 500).ok).toBe(true);
        });

        it('returns ok=false when drift > threshold', () => {
            const local = Date.now();
            const result = tsa.checkDrift(local, local + 1000);
            expect(result.ok).toBe(false);
            expect(result.drift).toBe(1000);
        });

        it('handles negative drift (local ahead)', () => {
            const local = Date.now();
            const result = tsa.checkDrift(local, local - 600);
            expect(result.ok).toBe(false);
            expect(result.drift).toBe(-600);
        });

        it('drift=0 returns ok=true', () => {
            const local = Date.now();
            expect(tsa.checkDrift(local, local)).toEqual({ ok: true, drift: 0, threshold: 500 });
        });
    });

    describe('getStatus()', () => {
        it('returns lastCheckTs + lastDrift + threshold + ok', () => {
            const status = tsa.getStatus();
            expect(status).toHaveProperty('lastCheckTs');
            expect(status).toHaveProperty('lastDrift');
            expect(status).toHaveProperty('threshold');
            expect(status).toHaveProperty('ok');
        });

        it('threshold = THRESHOLD_MS', () => {
            expect(tsa.getStatus().threshold).toBe(500);
        });
    });

    describe('start/stop lifecycle', () => {
        it('start() is idempotent (calling twice is no-op)', () => {
            tsa.start();
            expect(() => tsa.start()).not.toThrow();
            tsa.stop();
        });

        it('stop() is safe when not running', () => {
            expect(() => tsa.stop()).not.toThrow();
        });
    });
});
