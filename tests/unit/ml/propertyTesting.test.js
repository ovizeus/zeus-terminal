/**
 * R-1 Test Harness — propertyTesting.js tests
 *
 * Verifies property-based test generators + forAll runner. Used by other
 * rings for fuzzing common inputs (env, symbol, feature_id, weight).
 */

const {
    randomEnv,
    randomSymbol,
    randomFeatureId,
    randomWeight,
    forAll
} = require('../../../server/services/ml/R-1_testHarness/propertyTesting');

describe('R-1 Test Harness — propertyTesting', () => {
    describe('generators', () => {
        test('randomEnv returns DEMO/TESTNET/REAL', () => {
            for (let i = 0; i < 50; i++) {
                expect(['DEMO', 'TESTNET', 'REAL']).toContain(randomEnv());
            }
        });

        test('randomSymbol returns valid symbol pattern', () => {
            for (let i = 0; i < 50; i++) {
                const s = randomSymbol();
                expect(typeof s).toBe('string');
                expect(s.length).toBeGreaterThan(2);
                expect(s).toMatch(/^[A-Z]+USDT?$/);
            }
        });

        test('randomFeatureId returns non-empty string', () => {
            for (let i = 0; i < 50; i++) {
                const f = randomFeatureId();
                expect(typeof f).toBe('string');
                expect(f.length).toBeGreaterThan(0);
            }
        });

        test('randomWeight returns finite number in [0, 1]', () => {
            for (let i = 0; i < 50; i++) {
                const w = randomWeight();
                expect(typeof w).toBe('number');
                expect(isFinite(w)).toBe(true);
                expect(w).toBeGreaterThanOrEqual(0);
                expect(w).toBeLessThanOrEqual(1);
            }
        });
    });

    describe('forAll runner', () => {
        test('runs N iterations', () => {
            let calls = 0;
            forAll(randomEnv, 25, () => { calls++; });
            expect(calls).toBe(25);
        });

        test('passes generated value to predicate', () => {
            const seen = new Set();
            forAll(randomEnv, 100, (val) => { seen.add(val); });
            // With 100 iterations over 3 values, all 3 should be sampled
            expect(seen.size).toBeGreaterThan(1);
        });

        test('throws if predicate fails on any iteration', () => {
            expect(() => {
                forAll(randomWeight, 10, (w) => {
                    if (w < 0.5) throw new Error('weight too low');
                });
            }).toThrow();
        });

        test('passes when predicate is always satisfied', () => {
            expect(() => {
                forAll(randomWeight, 10, (w) => {
                    if (w < 0 || w > 1) throw new Error('out of range');
                });
            }).not.toThrow();
        });
    });
});
