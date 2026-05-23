/**
 * R-1 Test Harness — chaosInjector.js tests
 *
 * Verifies chaos injection wrappers for delay/failure/timeout. Used by
 * resilience tests to verify R3A safety guards handle realistic adversity.
 */

const {
    injectDelay,
    injectFailure,
    injectTimeout
} = require('../../../server/services/ml/R-1_testHarness/chaosInjector');

describe('R-1 Test Harness — chaosInjector', () => {
    describe('injectDelay', () => {
        test('returns wrapped function', () => {
            const fn = async () => 'ok';
            const wrapped = injectDelay(fn, 10);
            expect(typeof wrapped).toBe('function');
        });

        test('delays before resolving', async () => {
            const fn = async () => 'ok';
            const wrapped = injectDelay(fn, 50);
            const start = Date.now();
            const result = await wrapped();
            const elapsed = Date.now() - start;
            expect(result).toBe('ok');
            expect(elapsed).toBeGreaterThanOrEqual(45);
        });

        test('preserves arguments and return value', async () => {
            const fn = async (a, b) => a + b;
            const wrapped = injectDelay(fn, 5);
            expect(await wrapped(2, 3)).toBe(5);
        });
    });

    describe('injectFailure', () => {
        test('returns wrapped function', () => {
            const fn = async () => 'ok';
            const wrapped = injectFailure(fn, 0.5);
            expect(typeof wrapped).toBe('function');
        });

        test('rate=1.0 always throws', async () => {
            const fn = async () => 'ok';
            const wrapped = injectFailure(fn, 1.0);
            await expect(wrapped()).rejects.toThrow(/chaos injection/i);
        });

        test('rate=0 never throws', async () => {
            const fn = async () => 'ok';
            const wrapped = injectFailure(fn, 0);
            for (let i = 0; i < 20; i++) {
                expect(await wrapped()).toBe('ok');
            }
        });

        test('throws on invalid rate', () => {
            const fn = async () => 'ok';
            expect(() => injectFailure(fn, -0.1)).toThrow(/rate/i);
            expect(() => injectFailure(fn, 1.5)).toThrow(/rate/i);
        });
    });

    describe('injectTimeout', () => {
        test('returns wrapped function', () => {
            const fn = async () => 'ok';
            const wrapped = injectTimeout(fn, 100);
            expect(typeof wrapped).toBe('function');
        });

        test('resolves normally if fn completes within timeout', async () => {
            const fn = async () => 'fast';
            const wrapped = injectTimeout(fn, 100);
            expect(await wrapped()).toBe('fast');
        });

        test('rejects with timeout error if fn exceeds timeout', async () => {
            const slowFn = () => new Promise(r => setTimeout(() => r('slow'), 100));
            const wrapped = injectTimeout(slowFn, 20);
            await expect(wrapped()).rejects.toThrow(/timeout/i);
        });
    });
});
