'use strict';
// [ARES JOURNAL 2026-06-26] Server-side ARES ML journal — the last functional
// piece keeping ARES from being fully server-side (was client localStorage only,
// lost when the phone is closed). Real temp DB (ZEUS_DB_PATH) so the SQL + the
// serverAres close-hook are exercised end-to-end WITHOUT touching live zeus.db.

const path = require('path');
const fs = require('fs');
const os = require('os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ares-journal-'));
process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');

const db = require('../../server/services/database');
const serverAres = require('../../server/services/serverAres');

describe('ares_journal db methods', () => {
  test('insert + read newest-first, scoped per-user, with limit', () => {
    const uid = 7;
    db.insertAresJournal(uid, { symbol: 'BTCUSDT', side: 'LONG', entry_price: 100, exit_price: 102, leverage: 10, notional: 500, confidence: 72, pnl: 9.5, fees: 0.5, reason: 'DSL_PL', regime: 'TREND', session: 'NY', opened_at: 1000, closed_at: 2000, decision_json: JSON.stringify({ reasons: ['ares', 'trend'] }) });
    db.insertAresJournal(uid, { symbol: 'BTCUSDT', side: 'SHORT', entry_price: 200, exit_price: 198, leverage: 8, notional: 400, confidence: 70, pnl: 3.1, fees: 0.4, reason: 'HIT_TP', regime: 'BREAKOUT', session: 'LONDON', opened_at: 3000, closed_at: 4000, decision_json: '{}' });
    const rows = db.getAresJournal(uid, { limit: 10, offset: 0 });
    expect(rows.length).toBe(2);
    expect(rows[0].closed_at).toBe(4000); // newest first
    expect(rows[1].closed_at).toBe(2000);
    expect(rows[0].side).toBe('SHORT');
    expect(rows[1].pnl).toBeCloseTo(9.5, 5);
    expect(db.getAresJournal(999, { limit: 10, offset: 0 }).length).toBe(0);
  });
  test('coerces bad numerics to null, never throws', () => {
    const uid = 8;
    db.insertAresJournal(uid, { side: 'LONG', entry_price: NaN, leverage: undefined, pnl: 'x', closed_at: 5000 });
    const rows = db.getAresJournal(uid, { limit: 10, offset: 0 });
    expect(rows.length).toBe(1);
    expect(rows[0].entry_price).toBeNull();
    expect(rows[0].pnl).toBeNull();
  });
});

describe('serverAres writes a journal row on close', () => {
  test('close hook journals entry context + outcome', () => {
    const uid = 11;
    serverAres._recordEntryContext(uid, 5001, {
      side: 'LONG', entryPrice: 100, leverage: 10, notional: 500,
      confidence: 71, entryScore: 60, regime: 'TREND', session: 14,
      reasons: ['ares', 'trend'], openedAt: 1000,
    });
    serverAres.onPositionClosed({ owner: 'ARES', userId: uid, seq: 5001, side: 'LONG', closePnl: 8, size: 50, lev: 10, margin: 50, closeReason: 'DSL_PL', markPrice: 102 });
    const rows = db.getAresJournal(uid, { limit: 10, offset: 0 });
    expect(rows.length).toBe(1);
    expect(rows[0].confidence).toBe(71);
    expect(rows[0].regime).toBe('TREND');
    expect(rows[0].reason).toBe('DSL_PL');
    expect(rows[0].entry_price).toBe(100);
    expect(rows[0].session).toBe('NY');
    expect(rows[0].pnl).toBeLessThan(8); // net = gross - fees
  });
  test('close WITHOUT context still journals from pos (no throw)', () => {
    const uid = 12;
    serverAres.onPositionClosed({ owner: 'ARES', userId: uid, seq: 6001, side: 'SHORT', closePnl: -3, size: 40, lev: 8, margin: 40, closeReason: 'HIT_SL' });
    const rows = db.getAresJournal(uid, { limit: 10, offset: 0 });
    expect(rows.length).toBe(1);
    expect(rows[0].side).toBe('SHORT');
    expect(rows[0].reason).toBe('HIT_SL');
  });
  test('entry context is consumed (no duplicate on a second close call)', () => {
    const uid = 13;
    serverAres._recordEntryContext(uid, 7001, { side: 'LONG', entryPrice: 50, leverage: 5, notional: 100, confidence: 69, entryScore: 55, regime: 'TREND', session: 8, reasons: ['ares'], openedAt: 100 });
    serverAres.onPositionClosed({ owner: 'ARES', userId: uid, seq: 7001, side: 'LONG', closePnl: 2, size: 20, lev: 5, margin: 20, closeReason: 'HIT_TP' });
    const rows = db.getAresJournal(uid, { limit: 10, offset: 0 });
    expect(rows.length).toBe(1);
    expect(rows[0].confidence).toBe(69); // context used
    // a second (defensive) close for the same seq should not find context → still writes from pos
    serverAres.onPositionClosed({ owner: 'ARES', userId: uid, seq: 7001, side: 'LONG', closePnl: 0, size: 20, lev: 5, margin: 20, closeReason: 'DUP' });
    const rows2 = db.getAresJournal(uid, { limit: 10, offset: 0 });
    expect(rows2[0].confidence).toBeNull(); // context was consumed → null now
  });
});
