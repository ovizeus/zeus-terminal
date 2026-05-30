'use strict';

// [P2 close-desync REPRO] Operator reported: closed a manual Bybit (testnet) position
// in Zeus, but it stayed OPEN on Bybit ("am inchis pe zeus a ramas pe bibyt"). Logs:
//   [AT_LIVE] [seq] MANUAL_CLIENT market close attempt 1-4/4 failed:
//   position seq=<seq> not found for uid=1 → ALL close retries failed — queued for reconciliation
//
// Root-cause hypothesis (this file disambiguates it):
//   bybitOps.closePosition(uid,{seq}) does: SELECT ... FROM at_positions WHERE seq=? AND user_id=?
//   - status='CLOSED' (row PRESENT) → returns ok:true closedBySL (SL-race handled). NOT a desync.
//   - row ABSENT (archived to at_closed = DELETED from at_positions) → throws ErrNotFound
//     "position seq=X not found for uid=Y" → the exchange close is NEVER sent → the position
//     stays open on the exchange = the operator's desync.
//
// So the desync is structurally: the close path can ONLY close a position whose at_positions
// row still exists. If recon/phantom-close archived it locally (assuming it was closed on the
// exchange) while it is in fact STILL OPEN on the exchange, the manual close has nothing to act
// on and the exchange position is orphaned. This is PRE-EXISTING (recon + bybitOps close paths,
// untouched by P-A) and reproduces on the current rolled-back code.

const Database = require('better-sqlite3');
const fs = require('fs');
const TEST_DB = '/tmp/zeus-close-desync-' + Date.now() + '.db';
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
const mockDb = new Database(TEST_DB);
mockDb.exec(`
    CREATE TABLE at_positions (seq INTEGER PRIMARY KEY, data TEXT, status TEXT DEFAULT 'OPEN', user_id INTEGER, exchange TEXT DEFAULT 'bybit', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE at_closed (seq INTEGER PRIMARY KEY, data TEXT NOT NULL, closed_at TEXT NOT NULL DEFAULT (datetime('now')), user_id INTEGER, exchange TEXT DEFAULT 'bybit');
    CREATE TABLE position_events (id INTEGER PRIMARY KEY, position_seq INTEGER NOT NULL, user_id INTEGER NOT NULL, exchange TEXT NOT NULL, event_type TEXT NOT NULL, from_state TEXT, to_state TEXT, payload TEXT NOT NULL DEFAULT '{}', cycle_no INTEGER, ts INTEGER NOT NULL);
    CREATE TABLE emergency_close_queue (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, symbol TEXT NOT NULL, exchange TEXT NOT NULL, qty TEXT NOT NULL, decision_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, resolved_at INTEGER, resolved_by TEXT);
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, details TEXT, created_at TEXT DEFAULT (datetime('now')));
`);
jest.mock('../../server/services/database', () => ({ db: mockDb }));

const mockSendSignedRequest = jest.fn(async () => { throw new Error('sendSignedRequest should not be called — enqueue synthetic responses'); });
jest.mock('../../server/services/bybitSigner', () => ({
    buildSignedRequestDryRun: jest.fn(() => undefined),
    sendSignedRequest: (...a) => mockSendSignedRequest(...a),
    parseBybitError: jest.fn((resp) => ({ code: 'ErrUnknown', message: resp && resp.retMsg || 'unknown' })),
}));
jest.mock('../../server/services/orderLock', () => ({
    acquire: jest.fn(async () => true),
    release: jest.fn(),
}));
jest.mock('../../server/services/telegram', () => ({ alertCritical: jest.fn(), sendToUser: jest.fn() }));
jest.mock('../../server/services/serverAT', () => ({ setGlobalHalt: jest.fn() }));
jest.mock('../../server/migrationFlags', () => ({ BYBIT_DRY_RUN_ONLY: true }));

const bybitOps = require('../../server/services/bybitOps');
const _validCreds = { exchange: 'bybit', mode: 'testnet', apiKey: 'k', apiSecret: 's' };

// serverAT persists positions with an EXPLICIT huge timestamp seq (++us.seq), unlike bybitOps'
// auto-increment PENDING rows. This mirrors what _registerManualPositionLegacy → _persistPosition
// → atSavePosition writes for a manual Bybit live position (the operator's testnet trade).
const SERVERAT_SEQ = 1776859653085;

beforeEach(() => {
    mockSendSignedRequest.mockReset().mockImplementation(async () => { throw new Error('sendSignedRequest should not be called'); });
    bybitOps._resetSyntheticQueue();
    mockDb.exec('DELETE FROM at_positions; DELETE FROM position_events; DELETE FROM at_closed; DELETE FROM emergency_close_queue; DELETE FROM audit_log;');
});

describe('[P2 REPRO] manual Bybit close — structural path', () => {
    it('CONTROL: serverAT-style row (huge explicit seq, user_id set) present → close SUCCEEDS', async () => {
        // Persist exactly like serverAT.atSavePosition(entry): explicit seq, data carries userId.
        mockDb.prepare(
            `INSERT INTO at_positions (seq, data, status, user_id, exchange) VALUES (?, ?, 'OPEN', 1, 'bybit')`
        ).run(SERVERAT_SEQ, JSON.stringify({ seq: SERVERAT_SEQ, userId: 1, symbol: 'BTCUSDT', side: 'SHORT', qty: '0.054', mode: 'live', exchange: 'bybit', slOrderId: null, tpOrderId: null }));

        bybitOps._enqueueSynthetic({ retCode: 0, result: { orderId: 'byclose1', orderStatus: 'Filled', cumExecQty: '0.054', avgPrice: '73000' } });

        const r = await bybitOps.closePosition(1, { seq: SERVERAT_SEQ, symbol: 'BTCUSDT', side: 'SHORT', qty: '0.054', closeType: 'MARKET', decisionKey: 'cdk_ctrl', source: 'MANUAL_CLIENT' }, _validCreds);
        // If this passes, the huge-seq serverAT row IS findable+closeable → the structural path is fine.
        expect(r.ok).toBe(true);
    });

    it('THE BUG: row already archived (deleted from at_positions) → close throws "not found" → exchange position orphaned', async () => {
        // Simulate recon/phantom-close having archived the position locally (atInsertClosed + atDeletePos)
        // while it is STILL OPEN on the exchange. at_positions no longer has the row.
        mockDb.prepare(
            `INSERT INTO at_closed (seq, data, user_id, exchange) VALUES (?, ?, 1, 'bybit')`
        ).run(SERVERAT_SEQ, JSON.stringify({ seq: SERVERAT_SEQ, userId: 1, symbol: 'BTCUSDT', side: 'SHORT', qty: '0.054', mode: 'live', exchange: 'bybit' }));
        // (at_positions intentionally has NO row for SERVERAT_SEQ)

        // Characterization of the CURRENT (broken) behavior: closePosition throws ErrNotFound
        // with the exact production message and never attempts the exchange close. canonicalErrors
        // throws a non-Error object, so capture + assert on the value (jest .rejects.toThrow only
        // matches Error instances).
        let outcome;
        try {
            const r = await bybitOps.closePosition(1, { seq: SERVERAT_SEQ, symbol: 'BTCUSDT', side: 'SHORT', qty: '0.054', closeType: 'MARKET', decisionKey: 'cdk_bug', source: 'MANUAL_CLIENT' }, _validCreds);
            outcome = { kind: 'resolved', value: r };
        } catch (e) {
            outcome = { kind: 'threw', message: e && e.message, code: e && e.code };
        }
        expect(outcome.kind).toBe('threw');
        expect(outcome.code).toBe('ErrNotFound');
        expect(outcome.message).toMatch(/not found for uid=1/);
        // The smoking gun: NO close order was even attempted → exchange position orphaned.
        expect(mockSendSignedRequest).not.toHaveBeenCalled();
    });
});
