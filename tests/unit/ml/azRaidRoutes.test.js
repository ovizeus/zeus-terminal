'use strict';
const { db } = require('../../../server/services/database');

describe('A-Z Raid H: voice history', () => {
  // [2026-11-07] "has data" is a check on LIVE rows, not on this code, and it
  // only ever passed because the suite ran against the production file. The
  // suite is isolated now, so it asks for production explicitly and
  // READ-ONLY, and skips where there is none.
  const prod = require('../../helpers/prodDb').openProdReadOnly();
  const itProd = prod ? test : test.skip;
  afterAll(() => { try { if (prod) prod.close(); } catch (_) { /* already closed */ } });

  itProd('ml_voice_log table has data', () => {
    const count = prod.prepare('SELECT COUNT(*) as cnt FROM ml_voice_log').get();
    expect(count.cnt).toBeGreaterThan(0);
  });

  test('query with mood filter returns array', () => {
    const rows = db.prepare("SELECT id, mood, text FROM ml_voice_log WHERE mood = ? LIMIT 5").all('CALM');
    expect(Array.isArray(rows)).toBe(true);
  });

  test('query with limit respects cap', () => {
    const rows = db.prepare('SELECT id FROM ml_voice_log LIMIT 10').all();
    expect(rows.length).toBeLessThanOrEqual(10);
  });
});
