'use strict';

/**
 * [2026-11-07] Clear shared module state between tests.
 *
 * Jest runs a shard's files in ONE process under --runInBand, so any module
 * that keeps state in a module-level variable carries it from one file to the
 * next. entryDedup is exactly that: a Map of `user:symbol` with an 8-second
 * window, and serverAT.reset() does not touch it because it lives in a
 * different module. An entry opened by an earlier FILE can therefore refuse an
 * entry in a later one, and the failure shows up as a test that passes alone
 * and fails in the suite.
 *
 * That is the shape of the flake chased on 7 Nov: r1-block-chokepoint failed
 * twice in full-shard runs and never once in twenty isolated runs. It was not
 * proved to be the cause — the flake did not reproduce often enough to prove
 * anything — but a shared eight-second window that nothing resets is a hazard
 * whether or not it fired that day.
 *
 * Only cheap, dependency-free modules belong here. Requiring something that
 * opens a database or starts a timer would make every test file pay for it.
 */
beforeEach(() => {
    try { require('./server/services/entryDedup')._reset(); } catch (_) { /* not present in this tree */ }
});
