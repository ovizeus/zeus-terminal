'use strict';
// tests/unit/brain-actions-retention.test.js
//
// [G-5 2026-10-25] Retention decided "is this a block?" with a string prefix.
//
// brain_decisions.final_action carried 15 different names. The 90-day retention
// rule matched them with   final_action LIKE 'blocked_%'   — so a name that
// means "blocked" but does not START with that prefix escaped the rule
// entirely. One did: `entry_blocked`, written at serverBrain.js:1655 when
// autotrade rejects the entry. 128,744 rows, oldest 2026-05-26 — 152 days, on a
// table whose own rule says 90.
//
// It was not a disk problem (measured: 849 rows/day, 1.25 MB/day, 72 GB free).
// It was a classification problem: three separate places in the server each
// decide "did this become a trade?" by re-deriving it from the name, and they
// disagree. The fix is on the CLASS (R-C-22): one list, named, shared, and a
// test that fails if a new action name is added without being classified.
//
// What this file guards:
//   1. the shared list exists and classifies every name the server writes
//   2. nothing that can carry a linked_seq is in the blocked class (R-C-21)
//   3. retention reads the list instead of re-deriving from the prefix
//   4. the blocked prune keeps the linked_seq guard
//   5. the prune is batched — no single unbounded DELETE on a 2.9 GB table
//   6. the rule actually deletes what it claims, on a real database

const fs = require('fs');
const os = require('os');
const path = require('path');

const SRV = path.join(__dirname, '..', '..', 'server');
const DB_SRC = fs.readFileSync(path.join(SRV, 'services', 'database.js'), 'utf8');

const A = require('../../server/services/brainActions');

// Every .js under server/, except version.js — that file is a changelog of
// prose which quotes action names in sentences, not a write site.
function serverFiles(dir = SRV, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) serverFiles(p, out);
    else if (e.name.endsWith('.js') && e.name !== 'version.js') out.push(p);
  }
  return out;
}

// Action names written in code: the literals that appear after `finalAction:`
// on a line, and the arguments of updateAction(...). Action names are
// lowercase_snake, which is what separates them from the uppercase state
// constants ('FILL', 'EXPIRE') that share those lines.
function writtenActions() {
  const found = new Set();
  for (const f of serverFiles()) {
    const src = fs.readFileSync(f, 'utf8');
    const chunks = [];
    // Up to the first comma, not the end of the line: the write sites put
    // other fields on the same line (finalDir: 'neutral'), and a greedy match
    // picks those up as if they were action names. Ternaries hold no commas.
    for (const m of src.matchAll(/finalAction\s*:\s*([^,\n]*)/g)) chunks.push(m[1]);
    for (const m of src.matchAll(/updateAction\s*\(([^)]*)\)/g)) chunks.push(m[1]);
    for (const c of chunks) {
      for (const lit of c.matchAll(/'([a-z][a-z0-9_]*)'/g)) found.add(lit[1]);
    }
  }
  return found;
}

describe('G-5 — brain_decisions action names are classified, not guessed', () => {

  test('the scan found the write sites at all (guard against a vacuous pass)', () => {
    const w = writtenActions();
    expect(w.size).toBeGreaterThanOrEqual(10);
    // the two that provoked this work
    expect(w.has('entry_blocked')).toBe(true);
    expect(w.has('blocked_gates')).toBe(true);
  });

  test('EVERY action name written by the server is classified', () => {
    const unclassified = [...writtenActions()].filter((a) => !A.ALL_ACTIONS.includes(a));
    // The message matters more than the assertion: a new name must arrive here
    // with a retention class, not silently outlive the rule like entry_blocked did.
    expect(unclassified).toEqual([]);
  });

  test('entry_blocked is in the blocked class — the whole point of G-5', () => {
    expect(A.isBlocked('entry_blocked')).toBe(true);
    expect(A.BLOCKED_ACTIONS).toContain('entry_blocked');
  });

  test('every blocked_* name is in the list — the IN-list is not a downgrade from LIKE', () => {
    const prefixed = [...writtenActions()].filter((a) => a.startsWith('blocked_'));
    expect(prefixed.length).toBeGreaterThanOrEqual(5);
    for (const a of prefixed) expect(A.BLOCKED_ACTIONS).toContain(a);
  });

  test('nothing that can carry a linked_seq is in the blocked class (R-C-21)', () => {
    for (const a of ['entry', 'pending_fill', 'pending_momentum']) {
      expect(A.HISTORY_ACTIONS).toContain(a);
      expect(A.isBlocked(a)).toBe(false);
    }
  });

  test('the three classes do not overlap and cover ALL_ACTIONS', () => {
    const { BLOCKED_ACTIONS: B, HISTORY_ACTIONS: H, TELEMETRY_ACTIONS: T } = A;
    const all = [...B, ...H, ...T];
    expect(new Set(all).size).toBe(all.length);          // no name in two classes
    expect([...A.ALL_ACTIONS].sort()).toEqual(all.sort()); // nothing outside a class
  });

  test('the lists are frozen — a caller cannot mutate the retention policy', () => {
    expect(Object.isFrozen(A.BLOCKED_ACTIONS)).toBe(true);
    expect(Object.isFrozen(A.HISTORY_ACTIONS)).toBe(true);
    expect(Object.isFrozen(A.ALL_ACTIONS)).toBe(true);
  });
});

describe('G-5 — the retention statement reads the list', () => {

  test('retention no longer decides "blocked" with a LIKE prefix', () => {
    expect(DB_SRC).not.toMatch(/final_action LIKE 'blocked_%'/);
  });

  test('database.js requires the shared module', () => {
    expect(DB_SRC).toMatch(/require\(['"]\.\/brainActions['"]\)/);
  });

  // NOTE: the first version of the three tests below read 600 characters after
  // the index of 'bdPruneBlocked'. That window reaches into the NEXT statement,
  // bdPruneTrade, which carries its own `+linked_seq IS NULL`. So removing the
  // guard from the blocked tier left the text test PASSING — the functional
  // test is what killed that mutation. Proximity is not wiring. The statement
  // is now cut out exactly, from its name to the closing of its template
  // literal, and each assertion is made against that text alone.
  function blockedStmt() {
    const i = DB_SRC.indexOf('bdPruneBlocked:');
    expect(i).toBeGreaterThan(-1);
    const end = DB_SRC.indexOf('`),', i);
    expect(end).toBeGreaterThan(i);
    const text = DB_SRC.slice(i, end);
    expect(text).not.toMatch(/bdPruneTrade|bdPruneNoTrade/); // the cut is clean
    return text;
  }

  test('the blocked prune keeps the linked_seq guard (R-C-21)', () => {
    expect(blockedStmt()).toMatch(/linked_seq IS NULL/);
  });

  test('the blocked prune is batched — no unbounded DELETE on a 2.9 GB table', () => {
    expect(blockedStmt()).toMatch(/LIMIT \?/);
  });

  test('the index hint is present — the planner picks idx_bd_linked otherwise', () => {
    // Measured on the live 2.9 GB database: without the + the planner uses
    // idx_bd_linked (linked_seq=?), which matches ~750k rows — 0.72s instead
    // of 0.14s, synchronously, on a better-sqlite3 handle.
    expect(blockedStmt()).toMatch(/\+linked_seq IS NULL/);
  });

  test('the blocked prune reads the shared list, not a literal name list', () => {
    expect(blockedStmt()).toMatch(/_BRAIN_ACTIONS\.BLOCKED_ACTIONS/);
  });
});

describe('G-5 — the rule deletes what it claims, on a real database', () => {
  const DAY = 86400000;
  let db, api;

  beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-g5-'));
    process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
    api = require('../../server/services/database');
    db = api.db;
  });

  afterEach(() => { db.exec('DELETE FROM brain_decisions;'); });

  function row(action, ageDays, linked = null, tier = 'SMALL') {
    api.bdInsert(
      `s_${action}_${ageDays}_${linked}_${Math.random()}`, 1, 'BTCUSDT',
      Date.now() - ageDays * DAY, 1, 'direct', tier, 60, 'long', action, linked, {}, 'DEMO');
  }
  const left = () => db.prepare('SELECT final_action a, linked_seq l FROM brain_decisions').all();

  test('an entry_blocked older than 90 days is deleted — it was not, before G-5', async () => {
    row('entry_blocked', 120);
    await api.bdPrune();
    expect(left()).toEqual([]);
  });

  test('an entry_blocked younger than 90 days is kept', async () => {
    row('entry_blocked', 30);
    await api.bdPrune();
    expect(left().length).toBe(1);
  });

  test('a LINKED row is never deleted, however old (R-C-21)', async () => {
    row('entry_blocked', 400, 777);
    row('entry', 400, 778);
    row('pending_fill', 400, 779);
    await api.bdPrune();
    expect(left().map((r) => r.a).sort()).toEqual(['entry', 'entry_blocked', 'pending_fill']);
  });

  test('the other two tiers still work — NO_TRADE 30d, unlinked entry 365d', async () => {
    row('no_trade', 40, null, 'NO_TRADE');   // past 30 → goes
    row('no_trade', 10, null, 'NO_TRADE');   // inside 30 → stays
    row('entry', 400);                       // unlinked, past 365 → goes
    row('entry', 100);                       // inside 365 → stays
    await api.bdPrune();
    const a = left().map((r) => r.a).sort();
    expect(a).toEqual(['entry', 'no_trade']);
  });

  test('every blocked_* name is pruned too, not just entry_blocked', async () => {
    for (const n of A.BLOCKED_ACTIONS) row(n, 120);
    await api.bdPrune();
    expect(left()).toEqual([]);
  });

  test('a backlog larger than one batch still drains', async () => {
    for (let i = 0; i < 25; i++) row('entry_blocked', 120);
    await api.bdPrune(Date.now(), 5);   // batch of 5 → needs several passes
    expect(left()).toEqual([]);
  });

  test('prune never throws on an empty table', async () => {
    await expect(api.bdPrune()).resolves.not.toThrow();
  });
});
