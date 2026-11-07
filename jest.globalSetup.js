'use strict';

/**
 * [2026-11-07] Point the whole suite at a throwaway database.
 *
 * Found the hard way: migration 425 appeared on the PRODUCTION database with
 * no reload at all — the server process had not restarted. Several tests
 * `require('server/services/database')`, and that module opens data/zeus.db
 * and runs every pending migration the moment it loads. Harmless that time
 * (CREATE TABLE IF NOT EXISTS, zero rows), but a destructive migration would
 * have been applied to live data by a test run, and nobody would have noticed
 * until something was missing.
 *
 * The same contention is why one shard occasionally failed with "db locked"
 * and passed on a retry. An intermittent failure is worse than a constant one:
 * it teaches people to re-run instead of read.
 *
 * Copying the real file is not an option — it is 2.9 GB. An empty database is
 * enough, because the migrations build the schema from scratch; measured, that
 * left 9 failures out of 10,437, each a test that was quietly reading
 * production rows.
 *
 * A test that sets ZEUS_DB_PATH itself still wins: this only fills in a
 * default, and a handful of tests already pointed themselves at temp files.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = async () => {
    if (process.env.ZEUS_DB_PATH) return; // an explicit choice is respected
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-jest-'));
    process.env.ZEUS_DB_PATH = path.join(dir, 'test.db');
    process.env.ZEUS_JEST_TMPDIR = dir;
    // Printed so a confused reader can see WHICH database a run used, rather
    // than guessing — the whole point of this file is that it was not obvious.
    console.log(`[jest] database isolated at ${process.env.ZEUS_DB_PATH}`);
};
