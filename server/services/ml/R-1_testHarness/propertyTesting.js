'use strict';

/**
 * OMEGA R-1 Test Harness — propertyTesting
 *
 * Lightweight property-based testing helpers without external dependencies.
 * Provides domain-specific generators (env, symbol, feature_id, weight) +
 * a `forAll(gen, n, predicate)` runner. Used by other rings to fuzz common
 * inputs and surface edge cases that hand-written tests miss.
 *
 * Spec: project_ml_v3_expert_acceptance_and_ux_scope_20260514.md Wave 1B.
 */

const ENVS = ['DEMO', 'TESTNET', 'REAL'];
const BASE_SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'ADA', 'XRP', 'DOT', 'AVAX'];
const FEATURE_PREFIXES = ['vol_', 'trend_', 'liq_', 'momentum_', 'orderbook_', 'regime_'];

function randomEnv() {
    return ENVS[Math.floor(Math.random() * ENVS.length)];
}

function randomSymbol() {
    const base = BASE_SYMBOLS[Math.floor(Math.random() * BASE_SYMBOLS.length)];
    return `${base}USDT`;
}

function randomFeatureId() {
    const prefix = FEATURE_PREFIXES[Math.floor(Math.random() * FEATURE_PREFIXES.length)];
    const num = Math.floor(Math.random() * 100);
    return `${prefix}${num}`;
}

function randomWeight() {
    return Math.random();
}

function forAll(generator, iterations, predicate) {
    if (typeof generator !== 'function') {
        throw new Error('forAll: generator must be a function');
    }
    if (!Number.isInteger(iterations) || iterations < 1) {
        throw new Error('forAll: iterations must be a positive integer');
    }
    if (typeof predicate !== 'function') {
        throw new Error('forAll: predicate must be a function');
    }
    for (let i = 0; i < iterations; i++) {
        const value = generator();
        try {
            predicate(value);
        } catch (err) {
            const augmented = new Error(
                `forAll iteration ${i + 1}/${iterations} failed ` +
                `(value=${JSON.stringify(value)}): ${err.message}`
            );
            augmented.cause = err;
            throw augmented;
        }
    }
}

module.exports = {
    randomEnv,
    randomSymbol,
    randomFeatureId,
    randomWeight,
    forAll
};
