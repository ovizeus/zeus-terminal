const Database = require('better-sqlite3');
const bandit = require('../../server/services/mlDslBandit');
let db;
beforeAll(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE ml_dsl_arm_posterior (cell_key TEXT NOT NULL, arm TEXT NOT NULL, alpha REAL NOT NULL DEFAULT 1, beta REAL NOT NULL DEFAULT 1, n INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (cell_key, arm));`);
  bandit._setDb(db);
});
afterAll(() => { try { db.close(); } catch (_) {} });

describe('mlDslBandit', () => {
  test('update shifts the posterior; a winning arm gets sampled more (deterministic rng → posterior mean)', () => {
    const cell = 'u1:TESTNET:BTCUSDT:TREND';
    for (let i = 0; i < 20; i++) bandit.update(cell, 'swing', true);
    for (let i = 0; i < 20; i++) bandit.update(cell, 'fast', false);
    const pick = bandit.sampleArm(cell, ['fast', 'swing'], () => 0.5);
    expect(pick).toBe('swing');
  });
  test('unseen cell/arm → uniform prior, returns a valid arm, no throw', () => {
    const pick = bandit.sampleArm('never:seen:cell:RANGE', ['fast', 'def'], () => 0.5);
    expect(['fast', 'def']).toContain(pick);
  });
});
