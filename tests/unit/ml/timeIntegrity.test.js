/**
 * R0 Substrate — timeIntegrity.js tests
 *
 * Spec 245* — time skew detection + monotonic clock + timestamp validation.
 * Foundation primitive: every ring relies on consistent time for decisions.
 */

const {
    monotonicNow,
    detectTimeSkew,
    validateTimestamp,
    MAX_SKEW_MS
} = require('../../../server/services/ml/R0_substrate/timeIntegrity');

describe('R0 Substrate — timeIntegrity', () => {
    describe('monotonicNow', () => {
        test('returns a number', () => {
            expect(typeof monotonicNow()).toBe('number');
        });

        test('is monotonically non-decreasing', async () => {
            const t1 = monotonicNow();
            await new Promise(r => setTimeout(r, 5));
            const t2 = monotonicNow();
            expect(t2).toBeGreaterThanOrEqual(t1);
        });

        test('reflects elapsed time roughly accurately', async () => {
            const t1 = monotonicNow();
            await new Promise(r => setTimeout(r, 50));
            const t2 = monotonicNow();
            expect(t2 - t1).toBeGreaterThanOrEqual(45);
            expect(t2 - t1).toBeLessThan(200);
        });
    });

    describe('detectTimeSkew', () => {
        test('returns 0 when reference equals local time', () => {
            const now = Date.now();
            expect(detectTimeSkew(now)).toBe(0);
        });

        test('returns positive value when reference is in past', () => {
            const past = Date.now() - 1000;
            expect(detectTimeSkew(past)).toBeGreaterThan(900);
        });

        test('returns negative value when reference is in future', () => {
            const future = Date.now() + 1000;
            expect(detectTimeSkew(future)).toBeLessThan(-900);
        });

        test('throws on non-numeric input', () => {
            expect(() => detectTimeSkew('not-a-number')).toThrow(/numeric|number/i);
        });
    });

    describe('validateTimestamp', () => {
        test('accepts current timestamp', () => {
            expect(() => validateTimestamp(Date.now())).not.toThrow();
        });

        test('rejects timestamp older than MAX_SKEW_MS', () => {
            const old = Date.now() - MAX_SKEW_MS - 1000;
            expect(() => validateTimestamp(old)).toThrow(/skew|stale|old/i);
        });

        test('rejects timestamp too far in the future', () => {
            const future = Date.now() + MAX_SKEW_MS + 1000;
            expect(() => validateTimestamp(future)).toThrow(/skew|future/i);
        });

        test('respects custom maxSkewMs parameter', () => {
            const slightlyOld = Date.now() - 200;
            expect(() => validateTimestamp(slightlyOld, 100)).toThrow();
            expect(() => validateTimestamp(slightlyOld, 500)).not.toThrow();
        });

        test('throws on non-numeric input', () => {
            expect(() => validateTimestamp('bad')).toThrow();
        });
    });

    describe('MAX_SKEW_MS constant', () => {
        test('is a sensible positive integer', () => {
            expect(typeof MAX_SKEW_MS).toBe('number');
            expect(MAX_SKEW_MS).toBeGreaterThan(0);
            expect(MAX_SKEW_MS).toBeLessThan(60_000);
        });
    });
});
