'use strict';

/**
 * [2026-11-09] Do not fire the boot history fetch into an active ban.
 *
 * Last night's cascade, in order: four reloads in ninety minutes → Binance
 * banned the IP → the process restarted DURING the ban → every symbol logged
 * "0 initial candles" → the brain could not see any binance symbol → seven
 * accounts went five hours without a new entry.
 *
 * Every step after the first was avoidable. The boot fetch has no idea a ban
 * is in force: it fires twenty-one requests into a wall, burns them, logs
 * zeros, and leaves the feed blind until something else notices. The state it
 * needed was sitting in the database the whole time.
 *
 * So: when the state says banned or warming, skip the boot fetch and let the
 * self-heal watchdog fill it in once the window clears. Fewer requests into a
 * ban is also fewer chances of extending it.
 */
const { shouldSeedAtBoot } = require('../../server/services/klineSelfHeal');

const now = 1_000_000;

describe('deciding whether the boot fetch should run at all', () => {
    it('runs normally when nothing is wrong', () => {
        expect(shouldSeedAtBoot({ banned_until: 0, warm_until: 0 }, now)).toEqual({ seed: true });
    });

    it('does NOT fire into an active ban', () => {
        const d = shouldSeedAtBoot({ banned_until: now + 60_000, warm_until: 0 }, now);
        expect(d.seed).toBe(false);
        expect(d.reason).toBe('banned');
    });

    it('does not fire during the warm-up either — that is what re-banned us', () => {
        const d = shouldSeedAtBoot({ banned_until: 0, warm_until: now + 60_000 }, now);
        expect(d.seed).toBe(false);
        expect(d.reason).toBe('warming');
    });

    it('runs again once the window has passed', () => {
        expect(shouldSeedAtBoot({ banned_until: now - 1, warm_until: now - 1 }, now).seed).toBe(true);
    });

    it('seeds when the state cannot be read — the feed must not stay dark on a bad row', () => {
        // fail OPEN here on purpose: refusing to seed because a query failed
        // would be a worse outage than a few wasted requests
        expect(shouldSeedAtBoot(null, now).seed).toBe(true);
        expect(shouldSeedAtBoot({}, now).seed).toBe(true);
        expect(shouldSeedAtBoot({ banned_until: 'x' }, now).seed).toBe(true);
    });

    it('says which window it is in, so the log explains itself', () => {
        expect(shouldSeedAtBoot({ banned_until: now + 1, warm_until: now + 1 }, now).reason).toBe('banned');
    });
});
