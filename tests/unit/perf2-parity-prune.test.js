const Database = require('better-sqlite3');
const db = require('../../server/services/database');

// In-memory table mirroring the parity-log shape (id PK + created_at).
function mkTable(handle, name) {
  handle.exec(`CREATE TABLE ${name} (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL)`);
}
function seed(handle, name, rows) {
  const ins = handle.prepare(`INSERT INTO ${name} (created_at) VALUES (?)`);
  for (const ts of rows) ins.run(ts);
}

describe('[PERF-2] parity-log retention prune (batched, id-keyed)', () => {
  const DAY = 24 * 3600 * 1000;
  let h;
  beforeEach(() => { h = new Database(':memory:'); });
  afterEach(() => { try { h.close(); } catch (_) {} });

  test('_parityCutoffId returns highest id older than the cutoff', () => {
    mkTable(h, 'dsl_parity_log');
    const now = 1000 * DAY;
    // 10 old rows (created 10 days ago) then 5 recent rows (today)
    seed(h, 'dsl_parity_log', Array(10).fill(now - 10 * DAY));
    seed(h, 'dsl_parity_log', Array(5).fill(now));
    const cutoff = now - 7 * DAY; // keep last 7 days → old 10 are prunable
    const cutoffId = db._parityCutoffId('dsl_parity_log', cutoff, h);
    expect(cutoffId).toBe(10); // rows 1..10 are older than cutoff
  });

  test('_parityPruneBatch deletes only up to batchLimit rows <= cutoffId', () => {
    mkTable(h, 'dsl_parity_log');
    const now = 1000 * DAY;
    seed(h, 'dsl_parity_log', Array(10).fill(now - 10 * DAY));
    seed(h, 'dsl_parity_log', Array(5).fill(now));
    const deleted = db._parityPruneBatch('dsl_parity_log', 10, 4, h); // batch of 4
    expect(deleted).toBe(4);
    expect(h.prepare('SELECT COUNT(*) c FROM dsl_parity_log').get().c).toBe(11);
  });

  test('cutoffId 0 (nothing old) → deletes nothing', () => {
    mkTable(h, 'dsl_parity_log');
    seed(h, 'dsl_parity_log', [Date.now(), Date.now()]);
    expect(db._parityPruneBatch('dsl_parity_log', 0, 100, h)).toBe(0);
  });

  test('full prune via repeated batches keeps only rows newer than cutoff', () => {
    mkTable(h, 'brain_parity_log');
    const now = 1000 * DAY;
    seed(h, 'brain_parity_log', Array(23).fill(now - 10 * DAY)); // old
    seed(h, 'brain_parity_log', Array(7).fill(now));             // keep
    const cutoff = now - 7 * DAY;
    const cutoffId = db._parityCutoffId('brain_parity_log', cutoff, h);
    let n; do { n = db._parityPruneBatch('brain_parity_log', cutoffId, 5, h); } while (n === 5);
    expect(h.prepare('SELECT COUNT(*) c FROM brain_parity_log').get().c).toBe(7); // only recent kept
  });
});
