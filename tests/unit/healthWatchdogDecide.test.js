'use strict';
// [2026-10-10] Zeus crashed 1082 times over three and a half hours last night
// and nothing told anyone — the operator found it himself, hours in. The
// self-heal shipped in b262 covers the one cause we hit; it does not cover
// "Zeus is down for any other reason". This is the part that would have turned
// that night into one minute.
//
// The decision is pure so it can be tested without pm2 or Telegram: given the
// process state and what we saw last time, should we speak, and what about?

const { decide } = require('../../scripts/health-watchdog-decide');

const NOW = 1_800_000_000_000;
const MIN = 60_000;

describe('the watchdog speaks when it matters and stays quiet otherwise', () => {
    test('a healthy process that has not restarted says nothing', () => {
        const d = decide({ status: 'online', restarts: 10, uptimeMs: 3 * 3600_000 },
            { restarts: 10, lastAlertAt: 0, alerting: false, initialised: true }, NOW);
        expect(d.alert).toBe(false);
    });

    test('the process not being online is reported', () => {
        const d = decide({ status: 'errored', restarts: 10, uptimeMs: 0 },
            { restarts: 10, lastAlertAt: 0, alerting: false, initialised: true }, NOW);
        expect(d.alert).toBe(true);
        expect(d.message).toMatch(/errored/i);
    });

    test('a restart storm is reported even while pm2 still says online', () => {
        // Exactly last night: pm2 reports "online" between crashes.
        const d = decide({ status: 'online', restarts: 25, uptimeMs: 4000 },
            { restarts: 10, lastAlertAt: 0, alerting: false, initialised: true }, NOW);
        expect(d.alert).toBe(true);
        expect(d.message).toMatch(/15/); // 15 restarts since the last look
    });

    test('a single restart is not a storm', () => {
        // A deploy reload must not page anyone.
        const d = decide({ status: 'online', restarts: 11, uptimeMs: 30_000 },
            { restarts: 10, lastAlertAt: 0, alerting: false, initialised: true }, NOW);
        expect(d.alert).toBe(false);
    });

    test('it does not repeat itself every minute while still broken', () => {
        const d = decide({ status: 'errored', restarts: 10, uptimeMs: 0 },
            { restarts: 10, lastAlertAt: NOW - 5 * MIN, alerting: true, initialised: true }, NOW);
        expect(d.alert).toBe(false);
    });

    test('but it does speak again after a long silence, so it is not forgotten', () => {
        const d = decide({ status: 'errored', restarts: 10, uptimeMs: 0 },
            { restarts: 10, lastAlertAt: NOW - 45 * MIN, alerting: true, initialised: true }, NOW);
        expect(d.alert).toBe(true);
    });

    test('recovery is announced once, then silence', () => {
        const back = decide({ status: 'online', restarts: 10, uptimeMs: 10 * MIN },
            { restarts: 10, lastAlertAt: NOW - 10 * MIN, alerting: true, initialised: true }, NOW);
        expect(back.alert).toBe(true);
        expect(back.message).toMatch(/revenit|recovered/i);
        expect(back.state.alerting).toBe(false);

        const quiet = decide({ status: 'online', restarts: 10, uptimeMs: 20 * MIN },
            back.state, NOW + MIN);
        expect(quiet.alert).toBe(false);
    });

    test('a missing process is the loudest case of all', () => {
        const d = decide(null, { restarts: 0, lastAlertAt: 0, alerting: false, initialised: true }, NOW);
        expect(d.alert).toBe(true);
        expect(d.message).toMatch(/nu exist|missing/i);
    });
    test('the very first run only learns the current count, it does not cry wolf', () => {
        // No state file yet. Without this the whole historical restart count
        // reads as "since the last look" — 1083 of them, on a healthy server.
        const d = decide({ status: 'online', restarts: 1083, uptimeMs: 10 * MIN }, {}, NOW);
        expect(d.alert).toBe(false);
        expect(d.state.restarts).toBe(1083);
        expect(d.state.initialised).toBe(true);
    });

    test('but a real storm right after that first run IS reported', () => {
        const first = decide({ status: 'online', restarts: 1083, uptimeMs: 10 * MIN }, {}, NOW);
        const next = decide({ status: 'online', restarts: 1090, uptimeMs: 4000 }, first.state, NOW + MIN);
        expect(next.alert).toBe(true);
        expect(next.message).toMatch(/7/);
    });
});
