'use strict';

/**
 * OMEGA R-1 Test Harness — chaosInjector
 *
 * Wrapper functions that inject controllable adversity into async operations.
 * Used to verify R3A safety guards handle realistic failures: latency spikes,
 * intermittent errors, hard timeouts. Each wrapper preserves the wrapped
 * function's interface so it can be drop-in swapped during tests.
 *
 * Spec: project_ml_v3_expert_acceptance_and_ux_scope_20260514.md Wave 1B.
 */

function injectDelay(fn, ms) {
    if (typeof fn !== 'function') {
        throw new Error('injectDelay: fn must be a function');
    }
    if (!Number.isFinite(ms) || ms < 0) {
        throw new Error('injectDelay: ms must be a non-negative number');
    }
    return async (...args) => {
        if (ms > 0) {
            await new Promise(r => setTimeout(r, ms));
        }
        return fn(...args);
    };
}

function injectFailure(fn, rate) {
    if (typeof fn !== 'function') {
        throw new Error('injectFailure: fn must be a function');
    }
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
        throw new Error('injectFailure: rate must be a number in [0, 1]');
    }
    return async (...args) => {
        if (rate > 0 && Math.random() < rate) {
            throw new Error(`chaos injection: random failure (rate=${rate})`);
        }
        return fn(...args);
    };
}

function injectTimeout(fn, ms) {
    if (typeof fn !== 'function') {
        throw new Error('injectTimeout: fn must be a function');
    }
    if (!Number.isFinite(ms) || ms <= 0) {
        throw new Error('injectTimeout: ms must be a positive number');
    }
    return (...args) => new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`chaos injection: timeout after ${ms}ms`)),
            ms
        );
        Promise.resolve()
            .then(() => fn(...args))
            .then(
                value => { clearTimeout(timer); resolve(value); },
                err => { clearTimeout(timer); reject(err); }
            );
    });
}

module.exports = { injectDelay, injectFailure, injectTimeout };
