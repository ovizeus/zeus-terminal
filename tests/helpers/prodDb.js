'use strict';

/**
 * [2026-11-07] Open the production database READ-ONLY, on purpose and in the
 * open.
 *
 * A couple of checks in this suite are not unit tests at all — they assert
 * that live data has not been lost, which is a real and useful thing to check,
 * but it only worked because the whole suite was silently running against the
 * production file. Now that the suite is isolated, a test that genuinely wants
 * production has to say so, and gets it read-only so it can never write.
 *
 * Returns null when there is no production database (a developer machine, a
 * fresh clone), so the caller can skip rather than fail for the wrong reason.
 */
const fs = require('fs');
const path = require('path');

const PROD_PATH = path.resolve(__dirname, '../../data/zeus.db');

function openProdReadOnly() {
    if (!fs.existsSync(PROD_PATH)) return null;
    try {
        const Database = require('better-sqlite3');
        return new Database(PROD_PATH, { readonly: true, fileMustExist: true });
    } catch (_) {
        return null; // locked, unreadable, or no driver — the caller skips
    }
}

module.exports = { openProdReadOnly, PROD_PATH };
