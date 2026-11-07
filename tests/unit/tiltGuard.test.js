'use strict';

/**
 * [2026-11-07] The consecutive-loss tilt guard, wired up at last.
 *
 * It had existed for months and never fired once: trackEquity, its only data
 * source, was called from nowhere, so getConsecutiveLosses always returned 0,
 * getTiltModifier always returned 1.0, and serverBrain's
 * `confidence *= _mods.tilt` multiplied by one forever.
 *
 * The plumbing is connected now and the flag decides whether it bites. The
 * FIRST test is the one that matters on the day of the deploy: with the flag
 * off — the shipped default — nothing about today changes.
 */
const path = require('path');
const FLAGS = path.resolve(__dirname, '../../server/migrationFlags');
const GUARD = path.resolve(__dirname, '../../server/services/serverDrawdownGuard');

function load(enabled) {
    jest.resetModules();
    jest.doMock(FLAGS, () => ({ TILT_GUARD_ENABLED: enabled }));
    return require(GUARD);
}
function lose(g, uid, n) { for (let i = 0; i < n; i++) g.trackEquity(uid, 1000 - i, 'loss'); }

describe('shipped OFF — this deploy changes nothing', () => {
    it('stays neutral after any number of losses', () => {
        const g = load(false);
        lose(g, 1, 9);
        expect(g.getTiltModifier(1)).toBe(1.0);
    });

    it('stays neutral even though the data IS now being collected', () => {
        // the distinction that makes shipping this safe: we record history so
        // the guard has something to work with the day it is switched on, and
        // the modifier still refuses to act
        const g = load(false);
        lose(g, 1, 5);
        expect(g.getConsecutiveLosses(1)).toBe(5);
        expect(g.getTiltModifier(1)).toBe(1.0);
    });

    it('treats a missing or malformed flag as off', () => {
        jest.resetModules();
        jest.doMock(FLAGS, () => { throw new Error('flags module gone'); });
        const g = require(GUARD);
        lose(g, 1, 5);
        expect(g.getTiltModifier(1)).toBe(1.0);
    });
});

describe('switched ON — the scale the author intended', () => {
    it('does nothing below two losses', () => {
        const g = load(true);
        expect(g.getTiltModifier(1)).toBe(1.0);
        g.trackEquity(1, 1000, 'loss');
        expect(g.getTiltModifier(1)).toBe(1.0);
    });

    it('steps down as the streak grows', () => {
        for (const [n, expected] of [[2, 0.92], [3, 0.85], [4, 0.80], [5, 0.70], [9, 0.70]]) {
            const g = load(true);
            lose(g, 1, n);
            expect(g.getTiltModifier(1)).toBeCloseTo(expected, 5);
        }
    });

    it('a win clears the streak — that is the whole point', () => {
        const g = load(true);
        lose(g, 1, 4);
        expect(g.getTiltModifier(1)).toBeCloseTo(0.80, 5);
        g.trackEquity(1, 1200, 'win');
        expect(g.getTiltModifier(1)).toBe(1.0);
    });

    it('keeps users apart', () => {
        const g = load(true);
        lose(g, 1, 5);
        expect(g.getTiltModifier(2)).toBe(1.0);
    });
});

describe('the daily reset happens by itself', () => {
    it('clears the streak when the day changes', () => {
        // resetDaily() existed, was documented "call on day change", and was
        // called by nobody — which is exactly how the guard sat dormant. A
        // reset somebody must remember is a reset that will not happen.
        const g = load(true);
        const real = Date.now;
        try {
            const t1 = Date.parse('2026-11-07T23:50:00Z');
            Date.now = () => t1;
            lose(g, 1, 5);
            expect(g.getTiltModifier(1)).toBeCloseTo(0.70, 5);

            Date.now = () => Date.parse('2026-11-08T00:10:00Z');   // next day
            g.trackEquity(1, 1000, 'loss');
            expect(g.getConsecutiveLosses(1)).toBe(1);             // not 6
            expect(g.getTiltModifier(1)).toBe(1.0);
        } finally { Date.now = real; }
    });

    it('does not reset within the same day', () => {
        const g = load(true);
        const real = Date.now;
        try {
            Date.now = () => Date.parse('2026-11-07T01:00:00Z');
            lose(g, 1, 2);
            Date.now = () => Date.parse('2026-11-07T22:00:00Z');
            g.trackEquity(1, 900, 'loss');
            expect(g.getConsecutiveLosses(1)).toBe(3);
        } finally { Date.now = real; }
    });

    it('the peak is per day, so one old high cannot shadow a user forever', () => {
        const g = load(true);
        const real = Date.now;
        try {
            Date.now = () => Date.parse('2026-11-07T01:00:00Z');
            g.trackEquity(1, 50000, 'win');            // a big day
            Date.now = () => Date.parse('2026-11-08T01:00:00Z');
            g.trackEquity(1, 1000, 'loss');            // a new, smaller day
            expect(g.getMaxDrawdown(1)).toBe(0);       // not 98% down from yesterday
        } finally { Date.now = real; }
    });
});

describe('the curve cannot grow without bound', () => {
    it('is capped, so a long-running process does not accumulate forever', () => {
        const g = load(true);
        for (let i = 0; i < 2000; i++) g.trackEquity(1, 1000 + i, i % 2 ? 'win' : 'loss');
        expect(g.getDrawdownData(1, 0, 1000).equityCurveLength).toBeLessThanOrEqual(500);
    });
});
