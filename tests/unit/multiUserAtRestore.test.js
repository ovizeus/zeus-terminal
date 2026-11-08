'use strict';

/**
 * [2026-11-08] Why the other accounts never entered a trade.
 *
 * Two structural faults, found by investigating his wife's account (uid=2),
 * which last traded on 5 October and had not received a single brain decision
 * since the 7th:
 *
 *   1. Engine state was restored at boot ONLY for users with an OPEN position,
 *      plus uid=1 added by hand. Once her last position closed she could never
 *      be restored again — the database said "armed", memory said off, and the
 *      engine reads memory. Of 8 users with saved state, exactly one had open
 *      positions, so every restart silently disarmed 7 of 8. The server has
 *      restarted 1162 times.
 *
 *   2. An exchange feed only started when somebody SWITCHED exchange during
 *      that process's life. Nothing read the active accounts at boot. She is
 *      on bybit, so after every restart her exchange had no data at all: zero
 *      ready symbols, skipped even while armed. 2410 brain lines on binance
 *      that day, zero on bybit.
 *
 * These tests pin the rule that follows from both: being armed must not depend
 * on already being in the market, and a user's exchange must be fed because
 * the user exists, not because somebody happened to press a button.
 */

describe('who gets their engine state back after a restart', () => {
    it('the user set is built from SAVED STATE, not from open positions', () => {
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '../../server/services/serverAT.js'), 'utf8');
        // The restore must ask for users that have engine state. Asking only
        // for users with open positions is the bug itself.
        expect(src).toMatch(/atGetEngineUserIds\s*\(/);
    });

    it('still includes users holding open positions, and uid=1', () => {
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '../../server/services/serverAT.js'), 'utf8');
        expect(src).toMatch(/atGetOpenUserIds\s*\(/);
        expect(src).toMatch(/userIds\.add\(1\)/);
    });
});

describe('the database helper behind it', () => {
    const Database = require('better-sqlite3');
    let db;

    beforeEach(() => {
        db = new Database(':memory:');
        db.exec(`CREATE TABLE at_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, user_id INTEGER NOT NULL)`);
    });
    afterEach(() => db.close());

    /** The query as it ships, run against a throwaway database. */
    const engineUserIds = () => db.prepare(
        "SELECT DISTINCT user_id FROM at_state WHERE key LIKE 'engine:%' AND user_id IS NOT NULL"
    ).all().map((r) => r.user_id);

    it('finds every user that has an engine row', () => {
        db.prepare('INSERT INTO at_state VALUES (?,?,?)').run('engine:1', '{}', 1);
        db.prepare('INSERT INTO at_state VALUES (?,?,?)').run('engine:2', '{}', 2);
        db.prepare('INSERT INTO at_state VALUES (?,?,?)').run('engine:5', '{}', 5);
        expect(engineUserIds().sort()).toEqual([1, 2, 5]);
    });

    it('ignores rows that are not engine state', () => {
        db.prepare('INSERT INTO at_state VALUES (?,?,?)').run('stc:7', '{}', 7);
        db.prepare('INSERT INTO at_state VALUES (?,?,?)').run('brain:cooldowns:7', '{}', 7);
        db.prepare('INSERT INTO at_state VALUES (?,?,?)').run('global:halt', '{}', 1);
        expect(engineUserIds()).toEqual([]);
    });

    it('returns nothing rather than throwing on an empty table', () => {
        expect(engineUserIds()).toEqual([]);
    });
});

describe('which exchanges get a feed when the server starts', () => {
    const Database = require('better-sqlite3');
    let db;

    beforeEach(() => {
        db = new Database(':memory:');
        db.exec(`CREATE TABLE exchange_accounts (user_id INTEGER, exchange TEXT, is_active INTEGER)`);
    });
    afterEach(() => db.close());

    const activeExchanges = () => db.prepare(
        "SELECT DISTINCT exchange FROM exchange_accounts WHERE is_active=1 AND exchange IS NOT NULL"
    ).all().map((r) => r.exchange).sort();

    it('names every exchange somebody actually uses', () => {
        db.prepare('INSERT INTO exchange_accounts VALUES (?,?,?)').run(1, 'binance', 1);
        db.prepare('INSERT INTO exchange_accounts VALUES (?,?,?)').run(1, 'bybit', 0);
        db.prepare('INSERT INTO exchange_accounts VALUES (?,?,?)').run(2, 'bybit', 1);
        // bybit is here because uid=2 is on it — that is the whole point
        expect(activeExchanges()).toEqual(['binance', 'bybit']);
    });

    it('leaves out an exchange nobody has active', () => {
        db.prepare('INSERT INTO exchange_accounts VALUES (?,?,?)').run(1, 'bybit', 0);
        expect(activeExchanges()).toEqual([]);
    });
});
