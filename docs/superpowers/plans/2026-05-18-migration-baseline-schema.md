# Migration Baseline Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate latent migration ordering bugs that prevent fresh DBs (test isolates, dev clones) from running tests by introducing a schema baseline + incremental migrations pattern, then enable `ZEUS_DB_PATH` env var so jest tests stop polluting production DB.

**Architecture:** Industry-standard "schema baseline" approach. Snapshot the current production DB schema (all CREATE TABLE / INDEX statements) into a versioned SQL file. Add a `seedBaselineSchema()` step to `database.js` that runs BEFORE migrate() calls: if `_migrations` table is empty (truly fresh DB), exec the schema snapshot + bulk-insert all known migration names as "already applied". Existing migrations then become no-ops on fresh DB (they're marked applied without executing). Prod DB unaffected (`_migrations` already populated → seed step skipped). Once fresh-DB regression passes, enable `ZEUS_DB_PATH` env var.

**Tech Stack:** Node.js + better-sqlite3 + bash (sqlite3 CLI for schema dump) + Jest for verification.

**Branch:** `omega/wave-1-foundation` (continuation).

**Gate:** Day 14 investigation 2026-05-18 documented 212 fresh-DB suite failures due to migration ordering. This plan replaces reorder approach (200+ migrations risk) with baseline snapshot (safer).

**Reference:**
- Day 14 memory note: `MEMORY.md` line 23 documents the investigation
- Prod DB: 373 migrations applied (`SELECT COUNT(*) FROM _migrations` = 373)
- database.js: 373 `migrate('NNN_name', fn)` calls

---

## File Structure

- **Create:** `server/services/baseline_schema.sql` — snapshot of all `CREATE TABLE` + `CREATE INDEX` from prod (~373 statements)
- **Create:** `server/services/baseline_migrations.txt` — newline-separated list of 373 migration names already applied as of snapshot
- **Modify:** `server/services/database.js` — add `_seedBaselineIfFresh()` step before migrate() calls + read `ZEUS_DB_PATH` env
- **Test:** Verify by running full regression (jest --maxWorkers=2) — should show 0 failures on fresh test DBs

---

## Task 16.1: Dump prod schema snapshot

**Files:**
- Create: `server/services/baseline_schema.sql`
- Create: `server/services/baseline_migrations.txt`

- [ ] **Step 1: Dump schema (CREATE TABLE + CREATE INDEX only, no data)**

```bash
cd /root/zeus-terminal
sqlite3 data/zeus.db .schema > server/services/baseline_schema.sql
wc -l server/services/baseline_schema.sql
```

Expected: ~600-1500 lines (one CREATE per table + indices). Confirm `_migrations` table CREATE is included.

- [ ] **Step 2: Verify dump is replayable on empty DB**

```bash
cd /root/zeus-terminal
TMPDIR=$(mktemp -d)
sqlite3 "$TMPDIR/check.db" < server/services/baseline_schema.sql
echo "EXIT=$?"
sqlite3 "$TMPDIR/check.db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
rm -rf "$TMPDIR"
```

Expected: EXIT=0, table count matches prod (~150-200 tables). Any error here = schema dump broken; investigate before continuing.

- [ ] **Step 3: Dump list of applied migrations**

```bash
cd /root/zeus-terminal
sqlite3 data/zeus.db "SELECT name FROM _migrations ORDER BY id" > server/services/baseline_migrations.txt
wc -l server/services/baseline_migrations.txt
```

Expected: 373 lines. Each line = one migration name (`033_ml_runtime_features`, etc.).

- [ ] **Step 4: Commit baseline files**

```bash
cd /root/zeus-terminal
git add server/services/baseline_schema.sql server/services/baseline_migrations.txt
git commit -m "feat(db): baseline schema snapshot for fresh-DB seeding

Snapshot of current prod schema (all CREATE TABLE + CREATE INDEX) +
list of 373 applied migration names. Will be used in Task 16.2 to
short-circuit fresh-DB test isolates: instead of running ALL 373
migrations sequentially (which fails due to ordering bugs — ALTER
references tables created later in file), fresh DB execs this snapshot
then marks all 373 migrations as already-applied.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 16.2: Add `_seedBaselineIfFresh()` to database.js

**Files:**
- Modify: `server/services/database.js:1-50` (after `const db = new Database(DB_PATH)` line ~15)

- [ ] **Step 1: Read current database.js init block**

```bash
sed -n '1,40p' /root/zeus-terminal/server/services/database.js
```

Confirm structure: imports + DB_PATH constant + `new Database(DB_PATH)` call. Note line number of the `new Database` call (currently line 15).

- [ ] **Step 2: Backup database.js**

```bash
cp /root/zeus-terminal/server/services/database.js \
   /root/zeus-terminal/server/services/database.js.bak.pre-baseline-20260518
echo "BACKUP OK"
```

- [ ] **Step 3: Add `_seedBaselineIfFresh()` helper after `new Database(DB_PATH)` line**

Use Edit tool to replace this block:

```javascript
const db = new Database(DB_PATH);

// WAL mode for better concurrency
db.pragma('journal_mode = WAL');
```

with:

```javascript
const db = new Database(DB_PATH);

// [Day 16 2026-05-18] Baseline schema seeding for fresh DBs.
// On a truly fresh DB (no _migrations table), exec the prod schema snapshot
// + bulk-insert all known migration names as already-applied. Existing
// migrate() calls then become no-ops on fresh DB (already marked applied),
// bypassing latent ordering bugs (ALTER migrations referencing tables
// created later in file).
// Prod DB unaffected — `_migrations` already populated → seed step skipped.
function _seedBaselineIfFresh() {
    try {
        const hasMigrationsTable = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'"
        ).get();
        if (hasMigrationsTable) return; // not fresh — skip

        const schemaSqlPath = path.join(__dirname, 'baseline_schema.sql');
        const migListPath = path.join(__dirname, 'baseline_migrations.txt');
        if (!fs.existsSync(schemaSqlPath) || !fs.existsSync(migListPath)) {
            return; // baseline files missing — let migrations run normally
        }

        const schemaSql = fs.readFileSync(schemaSqlPath, 'utf8');
        const migList = fs.readFileSync(migListPath, 'utf8')
            .split('\n').map(s => s.trim()).filter(Boolean);

        // Exec the schema (CREATE TABLE / INDEX statements) in a single transaction.
        db.exec('BEGIN;\n' + schemaSql + '\nCOMMIT;');

        // Bulk-mark all known migrations as applied.
        const insert = db.prepare("INSERT OR IGNORE INTO _migrations (name, applied_at) VALUES (?, datetime('now'))");
        const tx = db.transaction((names) => {
            for (const name of names) insert.run(name);
        });
        tx(migList);

        console.log(`[DB] Baseline schema seeded: ${migList.length} migrations marked applied`);
    } catch (err) {
        console.warn('[DB] Baseline seed failed (will fall back to per-migration apply):', err.message);
    }
}

_seedBaselineIfFresh();

// WAL mode for better concurrency
db.pragma('journal_mode = WAL');
```

- [ ] **Step 4: Verify syntax + Node loads cleanly**

```bash
cd /root/zeus-terminal
node -e "const {db} = require('./server/services/database'); console.log('OK migrations:', db.prepare('SELECT COUNT(*) AS n FROM _migrations').get().n)"
```

Expected: `OK migrations: 373` (prod DB unchanged — seed skipped because `_migrations` already exists).

- [ ] **Step 5: Smoke test fresh DB path**

```bash
cd /root/zeus-terminal
TMPDIR=$(mktemp -d)
ZEUS_DB_PATH="$TMPDIR/fresh.db" node -e "const {db} = require('./server/services/database'); const n = db.prepare('SELECT COUNT(*) AS n FROM _migrations').get().n; const t = db.prepare(\"SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'\").get().n; console.log('migrations:', n, 'tables:', t);"
rm -rf "$TMPDIR"
```

Expected: `migrations: 373` and `tables: 150+`. Note: this REQUIRES Task 16.3 (ZEUS_DB_PATH env read) to actually use the temp DB. Without Task 16.3, it uses prod DB and we just see prod numbers. So this is a "preview" step — if it shows prod numbers, that's expected. We'll re-verify after Task 16.3.

- [ ] **Step 6: Commit**

```bash
cd /root/zeus-terminal
git add server/services/database.js
git commit -m "feat(db): _seedBaselineIfFresh() — schema baseline for fresh DBs

Detects truly fresh DB (no _migrations table) → execs baseline_schema.sql
+ bulk-marks all 373 migrations as applied. Existing migrate() calls then
no-op (already in _migrations). Prod DB unaffected (table exists → seed
skipped on every reload).

Sets up Task 16.3: ZEUS_DB_PATH env var read can now ship safely —
fresh test DBs will get schema baseline instead of failing on migration
ordering bugs.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 16.3: Enable `ZEUS_DB_PATH` env var read

**Files:**
- Modify: `server/services/database.js:9-15` (DB_PATH constant)

- [ ] **Step 1: Edit DB_PATH to read env first**

Use Edit tool to replace:

```javascript
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'zeus.db');
```

with:

```javascript
// [Day 16 2026-05-18] Read ZEUS_DB_PATH env if set (used by tests + dev to
// point at temp/isolated DBs). Falls back to canonical prod path so existing
// runtime behavior unchanged when env not set.
const DB_PATH = process.env.ZEUS_DB_PATH
    ? path.resolve(process.env.ZEUS_DB_PATH)
    : path.join(__dirname, '..', '..', 'data', 'zeus.db');
```

- [ ] **Step 2: Run full jest regression to verify fresh DB tests now pass**

```bash
cd /root/zeus-terminal
npx jest --maxWorkers=2 > /tmp/baseline-reg.log 2>&1
echo "EXIT=$?"
grep -E "^(Tests:|Test Suites:|FAIL )" /tmp/baseline-reg.log | head -10
```

Expected: `Tests: 6790+ passed, 0 failed`. No `FAIL` lines. If any FAIL, see Step 3.

- [ ] **Step 3: If tests fail (unexpected), troubleshoot**

If migration-related errors appear: `Migration NNN failed: no such table: X`, the schema snapshot was incomplete. Re-run Task 16.1 Step 1 to regenerate, commit, then re-run regression.

If other test failures (assertion errors): NOT related to baseline change. Compare against pre-change baseline (`npx jest --maxWorkers=2` against original `database.js` from before Task 16.2) to confirm same failures existed before.

- [ ] **Step 4: Verify prod DB unchanged**

```bash
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT COUNT(*) FROM _migrations" 
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
```

Expected: 373 migrations + same table count as before. Prod DB structurally identical.

- [ ] **Step 5: Verify test pollution stopped**

```bash
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT COUNT(*) FROM ml_influence_audit"
```

Record current count. Run jest test that previously polluted:

```bash
cd /root/zeus-terminal
npx jest tests/unit/ml/ring5Routes.test.js --runInBand > /dev/null 2>&1
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT COUNT(*) FROM ml_influence_audit"
```

Expected: count UNCHANGED (test wrote to its own temp DB, not prod).

- [ ] **Step 6: Commit**

```bash
cd /root/zeus-terminal
git add server/services/database.js
git commit -m "feat(db): enable ZEUS_DB_PATH env var (paired with Task 16.2 baseline)

Tests + dev tools setting process.env.ZEUS_DB_PATH = mkdtemp() path now
get isolated DBs as intended. Combined with Task 16.2 schema baseline,
fresh test DBs work end-to-end (~200 latent migration ordering bugs
bypassed via baseline seed).

Verified:
- Prod DB unchanged (373 migrations, table count unchanged).
- Jest regression: 6790+ pass / 0 fail on fresh DBs.
- Sample test run NO LONGER pollutes prod ml_influence_audit.

Closes 10+ day open issue documented in PHASE B Day 4+7+14 memory notes.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 16.4: Cleanup + memory update

- [ ] **Step 1: Remove pre-baseline backup**

```bash
rm -f /root/zeus-terminal/server/services/database.js.bak.pre-baseline-20260518
```

- [ ] **Step 2: Run one final regression to confirm clean state**

```bash
cd /root/zeus-terminal
npx jest --maxWorkers=2 > /tmp/p16-final.log 2>&1
echo "EXIT=$?"
grep -E "^(Tests:|Test Suites:|FAIL )" /tmp/p16-final.log | head -5
```

Expected: 0 failures, 0 skipped suites due to migration errors.

- [ ] **Step 3: Tag**

```bash
cd /root/zeus-terminal
TAG="db-baseline-schema-COMPLETE-$(date -u +%Y%m%d-%H%M%S)"
git tag -a "$TAG" -m "Database baseline schema + ZEUS_DB_PATH env var COMPLETE

Schema baseline approach (industry-standard) replaces broken migration
ordering for fresh DBs. Closes 10+ day open issue.

Tasks shipped:
- 16.1: Dump prod schema snapshot (baseline_schema.sql + baseline_migrations.txt)
- 16.2: _seedBaselineIfFresh() helper in database.js
- 16.3: ZEUS_DB_PATH env var read enabled

Impact:
- Prod DB unaffected (seed skipped when _migrations exists)
- Tests can use isolated temp DBs via process.env.ZEUS_DB_PATH
- Jest regression no longer pollutes prod tables
- No reorder of 373 historical migrations needed"
echo "TAG=$TAG"
git push origin HEAD --tags
```

- [ ] **Step 4: Memory update**

Edit `/root/.claude/projects/-root/memory/MEMORY.md` line 23 — append after Day 15.5 SHIPPED block: a new entry documenting Day 16 completion with the schema-baseline approach + ZEUS_DB_PATH fix verified.

---

## Self-Review

**1. Spec coverage:**
- Migration ordering issue resolved ✅ (via baseline snapshot, not reorder)
- ZEUS_DB_PATH env read ✅ (Task 16.3)
- Prod DB safety ✅ (seed step skipped when `_migrations` table exists)
- Test isolation ✅ (Task 16.3 Step 5 verifies test pollution stopped)

**2. Placeholder scan:**
- All commands explicit ✅
- All file paths absolute ✅
- All expected outputs concrete (counts + EXIT codes) ✅
- Troubleshooting path Step 3 references concrete actions ✅

**3. Type consistency:**
- `_seedBaselineIfFresh()` function name consistent across Task 16.2 + commit message
- `baseline_schema.sql` + `baseline_migrations.txt` file names consistent
- `ZEUS_DB_PATH` env var name consistent
- Migration table name `_migrations` consistent with existing prod table

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-18-migration-baseline-schema.md`.

**Inline execution recommended** — 4 tasks, tightly coupled, fast iteration with prod DB verification at each step.
