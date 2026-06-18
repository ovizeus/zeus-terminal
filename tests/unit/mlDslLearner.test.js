const Database = require('better-sqlite3');
const learner = require('../../server/services/mlDslLearner');
let db;
beforeAll(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE ml_dsl_arm_posterior (cell_key TEXT NOT NULL, arm TEXT NOT NULL, alpha REAL NOT NULL DEFAULT 1, beta REAL NOT NULL DEFAULT 1, n INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (cell_key, arm));`);
  db.exec(`CREATE TABLE ml_dsl_outcome (id INTEGER PRIMARY KEY AUTOINCREMENT, pos_id TEXT NOT NULL, user_id INTEGER NOT NULL, env TEXT, symbol TEXT, regime TEXT, arm TEXT, cohort TEXT, ml_pnl_pct REAL, baseline_pnl_pct REAL, advantage REAL, win INTEGER, ts INTEGER NOT NULL);`);
  learner._setDb(db);
});
afterAll(() => { try { db.close(); } catch (_) {} });

describe('mlDslLearner', () => {
  test('cellKey shape', () => {
    expect(learner.cellKey({ userId: 1, env: 'TESTNET', symbol: 'BTCUSDT', regime: 'TREND' })).toBe('1:TESTNET:BTCUSDT:TREND');
  });
  test('reward = advantage vs baseline; positive advantage is a win', () => {
    expect(learner.reward({ pnlPct: 3 }, { pnlPct: 1 })).toEqual({ advantage: 2, win: true });
    expect(learner.reward({ pnlPct: -1 }, { pnlPct: 0.5 })).toEqual({ advantage: -1.5, win: false });
  });
  test('learn persists an outcome row, updates the bandit, returns recorded', () => {
    const r = learner.learn({
      posId: 'p1', userId: 1, env: 'TESTNET', symbol: 'BTCUSDT', regime: 'TREND',
      arm: 'swing', cohort: 'ml', outcome: { pnlPct: 2.5 }, baseline: { pnlPct: 1.0 }, ts: 123,
    });
    expect(r.recorded).toBe(true);
    expect(r.win).toBe(true);
    expect(r.advantage).toBeCloseTo(1.5, 6);
    const row = db.prepare('SELECT * FROM ml_dsl_outcome WHERE pos_id=?').get('p1');
    expect(row.arm).toBe('swing'); expect(row.win).toBe(1);
    const post = db.prepare('SELECT alpha, beta FROM ml_dsl_arm_posterior WHERE cell_key=? AND arm=?').get('1:TESTNET:BTCUSDT:TREND', 'swing');
    expect(post.alpha).toBe(2);
  });
});
