'use strict';

/**
 * [2026-11-07] Record every failed test, so the next intermittent one is not lost.
 *
 * Two tests failed once in shard 2 and passed on the fourteen runs after. I
 * could not say WHICH, because the run was summarised and the detail was gone
 * by the time I looked. A flake you cannot name is a flake you cannot fix, and
 * the usual response — run it again and hope — is how a real bug hides for
 * months behind the word "flaky".
 *
 * Costs nothing on a green run: the file is only touched when something fails.
 */
const fs = require('fs');
const path = require('path');

const LOG = path.resolve(__dirname, '../data/logs/jest-failures.log');

class FlakeReporter {
    constructor(globalConfig, options) {
        this._shard = (options && options.shard) || process.env.JEST_SHARD || '';
    }

    onTestResult(_test, result) {
        const failed = (result.testResults || []).filter((t) => t.status === 'failed');
        if (failed.length === 0) return;
        const when = new Date().toISOString();
        const lines = failed.map((t) => {
            const first = (t.failureMessages && t.failureMessages[0]) || '';
            // one line each: the whole stack would bury the next failure
            const why = String(first).split('\n').find((l) => l.trim()) || '';
            return `${when}\t${this._shard}\t${result.testFilePath}\t${t.fullName}\t${why.trim().slice(0, 200)}`;
        });
        try {
            fs.mkdirSync(path.dirname(LOG), { recursive: true });
            fs.appendFileSync(LOG, lines.join('\n') + '\n');
        } catch (_) {
            // Never let the recorder break the run it is observing.
        }
    }
}

module.exports = FlakeReporter;
