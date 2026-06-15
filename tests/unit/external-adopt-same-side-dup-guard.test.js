'use strict';
// [DUAL-WRITE DUP FIX 2026-06-15] recon / _syncExternalPosition adopted a SECOND
// same-side position for a symbol serverAT already tracked OPEN. On a ONE-WAY
// account (the only kind serverAT trades) that is the SAME physical position →
// the duplicate (source=external, autoTrade undefined, lev=1) shows in the Manual
// panel AND double-counts PnL on close. Operator observed BNBUSDT SHORT: the real
// AT seq closed -$100.76 and the orphan dup closed -$100.10 for ONE trade.
// Guard: skip adoption when a same-(user,symbol,side) OPEN non-demo position exists.
const path = require('path');
const fs = require('fs');
const os = require('os');
const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-dup-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const database = require('../../server/services/database');
const { db } = database;
const serverAT = require('../../server/services/serverAT');
const { _findSameSideOpenDup } = serverAT;

function seedUser(uid) {
  try { db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)`).run(uid, `u${uid}@test.local`, 'x'); } catch (_) {}
}

describe('_findSameSideOpenDup (same-side open-duplicate predicate)', () => {
  const bnbShortLive = { userId: 1, symbol: 'BNBUSDT', side: 'SHORT', mode: 'live', status: 'OPEN' };
  test('is an exported function', () => expect(typeof _findSameSideOpenDup).toBe('function'));
  test('finds an existing OPEN same user/symbol/side/mode position', () => {
    expect(_findSameSideOpenDup([bnbShortLive], { userId: 1, symbol: 'BNBUSDT', side: 'SHORT', mode: 'live' })).toBe(bnbShortLive);
  });
  test('no match for a different side', () => {
    expect(_findSameSideOpenDup([bnbShortLive], { userId: 1, symbol: 'BNBUSDT', side: 'LONG', mode: 'live' }) == null).toBe(true);
  });
  test('no match for a different symbol', () => {
    expect(_findSameSideOpenDup([bnbShortLive], { userId: 1, symbol: 'BTCUSDT', side: 'SHORT', mode: 'live' }) == null).toBe(true);
  });
  test('no match across users', () => {
    expect(_findSameSideOpenDup([bnbShortLive], { userId: 2, symbol: 'BNBUSDT', side: 'SHORT', mode: 'live' }) == null).toBe(true);
  });
  test('ignores CLOSED positions', () => {
    const closed = { ...bnbShortLive, status: 'CLOSED' };
    expect(_findSameSideOpenDup([closed], { userId: 1, symbol: 'BNBUSDT', side: 'SHORT', mode: 'live' }) == null).toBe(true);
  });
  test('does NOT match a demo position for a live adoption (separate books)', () => {
    const demo = { ...bnbShortLive, mode: 'demo' };
    expect(_findSameSideOpenDup([demo], { userId: 1, symbol: 'BNBUSDT', side: 'SHORT', mode: 'live' }) == null).toBe(true);
  });
  test('empty / non-array input is safe', () => {
    expect(_findSameSideOpenDup([], { userId: 1, symbol: 'X', side: 'LONG', mode: 'live' }) == null).toBe(true);
    expect(_findSameSideOpenDup(null, { userId: 1, symbol: 'X', side: 'LONG', mode: 'live' }) == null).toBe(true);
  });
});

describe('_syncExternalPosition skips a same-side duplicate adoption', () => {
  test('does NOT adopt when serverAT already holds an OPEN same-side live position', () => {
    const UID = 880022;
    seedUser(UID);
    serverAT.reset(UID);
    serverAT._reconTestHooks.seedPositions([
      { userId: UID, symbol: 'BNBUSDT', side: 'SHORT', mode: 'live', status: 'OPEN', seq: 111, autoTrade: true, owner: 'AT' },
    ]);
    const res = serverAT._syncExternalPosition({
      userId: UID, symbol: 'BNBUSDT', side: 'SHORT', entryPrice: 615.66, qty: 13, markPrice: 615.66, exchange: 'binance',
    });
    expect(res.ok).toBe(false);
    expect(res.skipped).toBe(true);
    const stillOpen = serverAT._reconTestHooks.getPositions().filter(p => p.symbol === 'BNBUSDT' && p.status === 'OPEN');
    expect(stillOpen.length).toBe(1); // no duplicate row added
  });

  test('still adopts a genuine external when no same-side position exists', () => {
    const UID = 880033;
    seedUser(UID);
    serverAT.reset(UID);
    serverAT._reconTestHooks.reset();
    const res = serverAT._syncExternalPosition({
      userId: UID, symbol: 'AVAXUSDT', side: 'LONG', entryPrice: 30, qty: 5, markPrice: 30, exchange: 'binance',
    });
    expect(res.ok).toBe(true);
  });
});
