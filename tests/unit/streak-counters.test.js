'use strict';

// Task S8-P1-4 — Server-side streak counters for brain gate parity.
// When the server executes trades (S8), the client's _bmPostClose never fires,
// so w.BM.lossStreak stays 0 → brain PREDATOR/DEFENSE gates compute wrong.
// Server must track lossStreak/winStreak/dailyTrades and broadcast them.
// _updateStreakCounters is the pure logic, exposed via test hook.

const path = require('path');

// serverAT pulls many deps; ensure JWT etc. don't abort. Provide minimal env.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-streak';

let _updateStreakCounters;
beforeAll(() => {
    const serverAT = require('../../server/services/serverAT');
    _updateStreakCounters = serverAT._s8p1TestHooks.updateStreakCounters;
});

describe('_updateStreakCounters', () => {
    function freshUs() {
        return { lossStreak: 0, winStreak: 0, dailyTrades: 0 };
    }

    test('win → winStreak++ , lossStreak reset to 0 , dailyTrades++', () => {
        const us = freshUs();
        _updateStreakCounters(us, 10);
        expect(us.winStreak).toBe(1);
        expect(us.lossStreak).toBe(0);
        expect(us.dailyTrades).toBe(1);
    });

    test('loss → lossStreak++ , winStreak reset to 0 , dailyTrades++', () => {
        const us = freshUs();
        _updateStreakCounters(us, -10);
        expect(us.lossStreak).toBe(1);
        expect(us.winStreak).toBe(0);
        expect(us.dailyTrades).toBe(1);
    });

    test('flat (pnl=0) → no streak change, dailyTrades++ still', () => {
        const us = { lossStreak: 2, winStreak: 0, dailyTrades: 5 };
        _updateStreakCounters(us, 0);
        expect(us.lossStreak).toBe(2);
        expect(us.winStreak).toBe(0);
        expect(us.dailyTrades).toBe(6);
    });

    test('consecutive losses accumulate', () => {
        const us = freshUs();
        _updateStreakCounters(us, -5);
        _updateStreakCounters(us, -3);
        _updateStreakCounters(us, -8);
        expect(us.lossStreak).toBe(3);
        expect(us.winStreak).toBe(0);
        expect(us.dailyTrades).toBe(3);
    });

    test('win breaks a loss streak', () => {
        const us = { lossStreak: 4, winStreak: 0, dailyTrades: 10 };
        _updateStreakCounters(us, 12);
        expect(us.lossStreak).toBe(0);
        expect(us.winStreak).toBe(1);
        expect(us.dailyTrades).toBe(11);
    });

    test('loss breaks a win streak', () => {
        const us = { lossStreak: 0, winStreak: 3, dailyTrades: 7 };
        _updateStreakCounters(us, -2);
        expect(us.winStreak).toBe(0);
        expect(us.lossStreak).toBe(1);
        expect(us.dailyTrades).toBe(8);
    });

    test('handles undefined counters (defensive) — treats as 0', () => {
        const us = {};
        _updateStreakCounters(us, -5);
        expect(us.lossStreak).toBe(1);
        expect(us.winStreak).toBe(0);
        expect(us.dailyTrades).toBe(1);
    });

    test('non-numeric pnl treated as flat (no streak change)', () => {
        const us = { lossStreak: 1, winStreak: 0, dailyTrades: 2 };
        _updateStreakCounters(us, NaN);
        expect(us.lossStreak).toBe(1);
        expect(us.winStreak).toBe(0);
        expect(us.dailyTrades).toBe(3);
    });
});
