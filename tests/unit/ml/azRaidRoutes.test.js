'use strict';
const { db } = require('../../../server/services/database');

describe('A-Z Raid H: voice history', () => {
  test('ml_voice_log table has data', () => {
    const count = db.prepare('SELECT COUNT(*) as cnt FROM ml_voice_log').get();
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
