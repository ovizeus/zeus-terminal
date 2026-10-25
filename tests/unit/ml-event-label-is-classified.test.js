'use strict';
// tests/unit/ml-event-label-is-classified.test.js
//
// [G-6 2026-10-25] The ML snapshot label said TRADE about things that never
// traded.
//
// brainLogger decides what `snapshot_event_type` to write into
// ml_decision_snapshots, and it decided trade-ness the same way retention used
// to decide blocked-ness — from the shape of the name:
//
//     if (finalTier === 'NO_TRADE' || finalAction.startsWith('blocked_'))
//         eventType = 'ABSTAIN_CRITIC';
//     else if (conf >= 50 && conf < 60) eventType = 'NEAR_THRESHOLD';
//     else                              eventType = 'TRADE';
//
// `entry_blocked` passes neither test, so it fell through to TRADE. So did
// `pending_created` and `pending_expire`. Applying that rule over the whole of
// brain_decisions: 181,135 rows get the TRADE label and only 1,683 of them —
// 0.93% — are trades.
//
// TWO CORRECTIONS to what I wrote in the Book when I found this, both measured
// after the fact and both making the finding SMALLER than I claimed:
//
//   1. I said ML had been training on a 99%-wrong class. It has not.
//      `snapshot_event_type` has NO READER anywhere: not a filter, not a
//      branch, not a query. omega.js requires auditTrail and never calls it;
//      replayEngine never mentions the column; serverAT reads only the digest.
//      And mlTelemetryRetention prunes the table at 30 days, so "for months"
//      was wrong too. It is a write-only, indexed, CHECK-constrained column
//      that is labelled wrong — which is why fixing it changes no behaviour.
//
//   2. I said entry_blocked is numerous BECAUSE it escapes the NO_TRADE
//      sampler. Measured: 52,893 of 54,268 entry_blocked rows (97.5%) have
//      confidence >= 50, and the sampler keeps everything at >= 50 anyway.
//      They are numerous because autotrade rejects a lot. The sampling escape
//      is real in the code and almost without effect in the data.
//
// So this file pins the label, and pins the sampling site as DELIBERATELY
// unchanged, with the reason, so nobody "tidies" it later on the assumption
// that consistency is free.

const BetterSqlite3 = require('better-sqlite3');

let mockIngestFlag = true;
let mockDb = null;

jest.mock('../../server/migrationFlags', () => ({
    get ML_INGEST_ENABLED() { return mockIngestFlag; },
    get ML_PIPELINE_SHADOW() { return false; },
    get ML_DEMO_INFLUENCE_ENABLED() { return false; },
    get SERVER_BRAIN_DEMO() { return false; },
    get SERVER_AT_DEMO() { return false; },
    get PARITY_SHADOW_ENABLED() { return false; },
    get ALT_WS_FEEDS() { return false; },
    get SERVER_MARKET_DATA() { return false; },
    get SERVER_BRAIN() { return false; },
    get SERVER_AT() { return false; },
    get CLIENT_BRAIN() { return true; },
    get CLIENT_AT() { return true; },
    get POSITIONS_WS() { return false; },
    get BYBIT_TESTNET_ENABLED() { return false; },
    get BYBIT_LIVE_ENABLED() { return false; },
}));

jest.mock('../../server/services/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

jest.mock('../../server/services/database', () => ({
    get db() { return mockDb; },
    bdInsert(snapId, userId, symbol, ts, cycle, sourcePath, finalTier, finalConf, finalDir, finalAction, linkedSeq, data) {
        mockDb.prepare(
            'INSERT OR IGNORE INTO brain_decisions ' +
            '(snap_id, user_id, symbol, ts, cycle, source_path, final_tier, final_conf, final_dir, final_action, linked_seq, data) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(snapId, userId, symbol, ts, cycle, sourcePath, finalTier, finalConf, finalDir, finalAction, linkedSeq,
            typeof data === 'string' ? data : JSON.stringify(data));
    },
    bdLinkSeq: jest.fn(), bdUpdateData: jest.fn(), bdUpdateAction: jest.fn(),
    bdGetBySnap: jest.fn(() => null), bdGetBySeq: jest.fn(() => []),
    bdPrune: jest.fn(), bdCount: jest.fn(() => []),
}));

const fs = require('fs');
const path = require('path');
const BL_SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'server', 'services', 'brainLogger.js'), 'utf8');

const A = require('../../server/services/brainActions');
const brainLogger = require('../../server/services/brainLogger');

function schema(db) {
    db.exec(`
        CREATE TABLE brain_decisions (
            snap_id TEXT PRIMARY KEY, user_id INTEGER, symbol TEXT, ts INTEGER,
            cycle INTEGER, source_path TEXT, final_tier TEXT, final_conf REAL,
            final_dir TEXT, final_action TEXT, linked_seq TEXT, data TEXT);
        CREATE TABLE ml_decision_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol TEXT NOT NULL,
            snapshot_event_type TEXT NOT NULL CHECK(snapshot_event_type IN (
                'TRADE','ABSTAIN_CRITIC','NEAR_THRESHOLD','OPERATOR_OVERRIDE',
                'QUARANTINE_TRIGGER','PROMOTION_TRIGGER','ANOMALY_DRIFT')),
            decision_digest TEXT NOT NULL, snapshot_json TEXT NOT NULL,
            registry_digest TEXT NOT NULL, input_snapshot_ref TEXT,
            created_at INTEGER NOT NULL);
        CREATE TABLE ml_decision_light (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol TEXT NOT NULL, decision_digest TEXT NOT NULL, score REAL,
            top5_features_json TEXT, abstain_count INTEGER NOT NULL DEFAULT 0,
            reason_code TEXT, created_at INTEGER NOT NULL);
    `);
}

let cycle = 0;
// Returns the label written for one decision. Confidence defaults to 80 so the
// NEAR_THRESHOLD band (50..59) is out of the way unless a test asks for it.
function labelFor(finalAction, { conf = 80, tier = 'LARGE' } = {}) {
    cycle += 1;
    brainLogger.logDecision({
        userId: 1, symbol: 'BTCUSDT', ts: Date.now(), cycle,
        sourcePath: 'direct', finalTier: tier, finalAction,
        finalConfidence: conf, finalDir: 'long',
    });
    const r = mockDb.prepare(
        'SELECT snapshot_event_type t FROM ml_decision_snapshots ORDER BY id DESC LIMIT 1').get();
    return r ? r.t : null;
}

beforeEach(() => {
    mockDb = new BetterSqlite3(':memory:');
    schema(mockDb);
    mockIngestFlag = true;
});
afterEach(() => { if (mockDb) { mockDb.close(); mockDb = null; } });

describe('G-6 — the ML label says TRADE only about things that traded', () => {

    test('the harness writes a label at all (guard against a vacuous pass)', () => {
        expect(labelFor('entry')).not.toBeNull();
    });

    test('entry_blocked is NOT a trade — the whole point of G-6', () => {
        expect(labelFor('entry_blocked')).toBe('ABSTAIN_CRITIC');
    });

    test('a pending that was created or expired is not a trade either', () => {
        expect(labelFor('pending_created')).toBe('ABSTAIN_CRITIC');
        expect(labelFor('pending_expire')).toBe('ABSTAIN_CRITIC');
        expect(labelFor('pending_cancel')).toBe('ABSTAIN_CRITIC');
    });

    test('EVERY blocked action is labelled ABSTAIN_CRITIC, not just entry_blocked', () => {
        for (const a of A.BLOCKED_ACTIONS) {
            expect(labelFor(a)).toBe('ABSTAIN_CRITIC');
        }
    });

    test('the three actions that ARE trades keep the TRADE label', () => {
        for (const a of A.HISTORY_ACTIONS) {
            expect(labelFor(a)).toBe('TRADE');
        }
    });

    test('NEAR_THRESHOLD still works, and only for something that could trade', () => {
        expect(labelFor('entry', { conf: 55 })).toBe('NEAR_THRESHOLD');
        // a blocked decision in the same band is still an abstention, not a near-miss
        expect(labelFor('entry_blocked', { conf: 55 })).toBe('ABSTAIN_CRITIC');
    });

    test('unchanged: a NO_TRADE tier is an abstention whatever the confidence', () => {
        expect(labelFor('no_trade', { tier: 'NO_TRADE', conf: 80 })).toBe('ABSTAIN_CRITIC');
        expect(labelFor('no_trade', { tier: 'NO_TRADE', conf: 55 })).toBe('ABSTAIN_CRITIC');
    });

    test('a NO_TRADE tier wins over the action — the belt is still buckled', () => {
        // Without this, removing the `finalTier === 'NO_TRADE'` check would be
        // invisible: every action that reaches it is already non-history. This
        // pins the one case where the two differ, so the belt cannot be cut
        // silently.
        expect(labelFor('entry', { tier: 'NO_TRADE', conf: 80 })).toBe('ABSTAIN_CRITIC');
    });

    test('an action nobody classified is treated as NOT a trade — fails safe', () => {
        expect(labelFor('something_nobody_wrote_down')).toBe('ABSTAIN_CRITIC');
    });
});

describe('G-6 — the label site reads the classification, the sampling site does not', () => {

    test('the label no longer decides trade-ness from the name prefix', () => {
        // The source around the eventType assignment must not re-derive it.
        const i = BL_SRC.indexOf('let eventType');
        expect(i).toBeGreaterThan(-1);
        const block = BL_SRC.slice(i - 400, i + 500);
        expect(block).not.toMatch(/startsWith\('blocked_'\)/);
        expect(block).toMatch(/_BRAIN_ACTIONS\.isHistory/);
    });

    test('brainLogger requires the shared classification', () => {
        expect(BL_SRC).toMatch(/require\(['"]\.\/brainActions['"]\)/);
    });

    test('the SAMPLING site deliberately still uses the prefix, and says why', () => {
        // Measured: 52,893 of 54,268 entry_blocked rows are at confidence >= 50,
        // and _shouldStoreNoTrade keeps everything at >= 50. Routing them
        // through the sampler would change at most 2.5% of rows, and those are
        // autotrade rejections on the money path — the rows most worth keeping.
        // So this inconsistency is a decision, not an oversight, and this test
        // fails if someone removes it without removing the reasoning too.
        const i = BL_SRC.indexOf('_shouldStoreNoTrade(fields.symbol');
        expect(i).toBeGreaterThan(-1);
        const block = BL_SRC.slice(i - 900, i + 200);
        expect(block).toMatch(/startsWith\('blocked_'\)/);  // still the prefix, on purpose
        expect(block).toMatch(/G-6/);                        // and the reason is written here
    });

    test('the file was really read (guard against a vacuous pass)', () => {
        expect(BL_SRC.length).toBeGreaterThan(5000);
    });
});
