'use strict';

/**
 * Noticing that a symbol never got its candle history.
 *
 * [2026-11-09] A restart during an exchange IP ban leaves every symbol with
 * "0 initial candles". The live poller only fetches the newest two candles, so
 * a symbol that starts empty needs roughly four hours of real time to reach the
 * 50 bars that make it usable — and the next restart puts it back to zero.
 * Seven accounts went a whole night without a single new entry because of
 * exactly that, and nothing in the system ever said so.
 *
 * The history is fetched once, at subscribe, and nobody checks whether it
 * worked. This module is the check. It is pure: it decides WHAT needs
 * re-fetching, the caller decides when and does the fetching.
 */

/** The bar count `isDataReadyForSymbol` insists on. Below this, a symbol is
 *  invisible to the brain, so re-seeding below it is the entire point. */
const RESEED_MIN_BARS = 50;

/** True when this series is too short to be usable. */
function needsReseed(bars) {
    if (!Array.isArray(bars)) return true;
    return bars.length < RESEED_MIN_BARS;
}

/**
 * The symbol/timeframe pairs worth re-fetching, newest problem first, capped.
 *
 * The cap matters: a boot during a ban leaves EVERY pair empty, and asking for
 * all of them at once is the burst that earns the next ban. Fixing a few per
 * pass, spaced out by the caller, recovers within minutes without a spike.
 */
function pickReseedTargets(klineStore, max) {
    const out = [];
    const limit = Number.isFinite(max) && max > 0 ? max : 3;
    if (!klineStore || typeof klineStore !== 'object') return out;
    for (const symbol of Object.keys(klineStore)) {
        const byTf = klineStore[symbol];
        if (!byTf || typeof byTf !== 'object') continue;
        for (const tf of Object.keys(byTf)) {
            if (out.length >= limit) return out;
            if (needsReseed(byTf[tf])) out.push({ symbol, tf });
        }
    }
    return out;
}

/**
 * Should the boot history fetch run at all?
 *
 * [2026-11-09] Last night the process restarted DURING an IP ban. The boot
 * fetch has no idea a ban is in force: it fired twenty-one requests into a
 * wall, burned them, logged "0 initial candles" for every symbol, and left
 * the feed blind for five hours. The state it needed was in the database the
 * whole time.
 *
 * Fails OPEN. If the state cannot be read, seed anyway: a few wasted requests
 * are a far smaller problem than a feed that stays dark because one query
 * misbehaved.
 */
function shouldSeedAtBoot(state, now) {
    const t = Number.isFinite(now) ? now : Date.now();
    if (!state || typeof state !== 'object') return { seed: true };
    const banned = Number(state.banned_until);
    const warm = Number(state.warm_until);
    if (Number.isFinite(banned) && banned > t) return { seed: false, reason: 'banned' };
    if (Number.isFinite(warm) && warm > t) return { seed: false, reason: 'warming' };
    return { seed: true };
}

module.exports = { needsReseed, pickReseedTargets, shouldSeedAtBoot, RESEED_MIN_BARS };
