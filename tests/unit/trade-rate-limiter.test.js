'use strict';

// Task K — Per-user trade rate limiter
// Hard cap on entries per user per hour (default 10/h). Last-line defense
// against runaway brain bugs that bypass confidence/dedup checks. Per-user
// isolation: one user hitting limit doesn't affect another.

describe('tradeRateLimiter', () => {
    let trl;

    beforeEach(() => {
        jest.resetModules();
        trl = require('../../server/services/tradeRateLimiter');
        trl._reset();
    });

    test('canEnter returns true for fresh user (no history)', () => {
        expect(trl.canEnter(42)).toBe(true);
    });

    test('recordEntry adds to history', () => {
        trl.recordEntry(42);
        const state = trl.getState(42);
        expect(state.recentEntries.length).toBe(1);
        expect(state.capacity).toBe(9);
    });

    test('default limit 10/h: 10 allowed, 11th blocked', () => {
        for (let i = 0; i < 10; i++) {
            expect(trl.canEnter(42)).toBe(true);
            trl.recordEntry(42);
        }
        expect(trl.canEnter(42)).toBe(false);
    });

    test('entries older than 1h pruned (sliding window)', () => {
        for (let i = 0; i < 10; i++) trl._testInjectEntry(42, Date.now() - 70 * 60 * 1000);
        // All entries 70min old → outside 60min window → pruned on canEnter
        expect(trl.canEnter(42)).toBe(true);
    });

    test('mixed old + new: only new entries count', () => {
        // 8 old (pruned) + 2 recent → capacity = 8
        for (let i = 0; i < 8; i++) trl._testInjectEntry(42, Date.now() - 70 * 60 * 1000);
        for (let i = 0; i < 2; i++) trl._testInjectEntry(42, Date.now() - 1000);
        const state = trl.getState(42);
        expect(state.recentEntries.length).toBe(2);
        expect(state.capacity).toBe(8);
    });

    test('per-user isolation: uid 42 limit hit, uid 99 fresh', () => {
        for (let i = 0; i < 10; i++) trl.recordEntry(42);
        expect(trl.canEnter(42)).toBe(false);
        expect(trl.canEnter(99)).toBe(true);
    });

    test('setLimit overrides default for a specific user', () => {
        trl.setLimit(42, 3);
        for (let i = 0; i < 3; i++) trl.recordEntry(42);
        expect(trl.canEnter(42)).toBe(false);
        // Other user keeps default 10
        for (let i = 0; i < 5; i++) trl.recordEntry(99);
        expect(trl.canEnter(99)).toBe(true);
    });

    test('setLimit clamps to [1, 100]', () => {
        trl.setLimit(42, 0);   // clamped up to 1
        trl.recordEntry(42);
        expect(trl.canEnter(42)).toBe(false);

        trl._reset();
        trl.setLimit(42, 999); // clamped down to 100
        for (let i = 0; i < 100; i++) trl.recordEntry(42);
        expect(trl.canEnter(42)).toBe(false);
    });

    test('getState shape: recentEntries, limit, capacity', () => {
        trl.recordEntry(42);
        const state = trl.getState(42);
        expect(state.recentEntries).toBeInstanceOf(Array);
        expect(state.limit).toBe(10);
        expect(state.capacity).toBe(9);
    });

    test('invalid userId (0, null, undefined) returns true (no rate limit)', () => {
        expect(trl.canEnter(0)).toBe(true);
        expect(trl.canEnter(null)).toBe(true);
        expect(trl.canEnter(undefined)).toBe(true);
    });
});
