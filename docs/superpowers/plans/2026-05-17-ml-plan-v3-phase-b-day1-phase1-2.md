# ML Plan v3 — Phase B Day 1 (Phase 1 + Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply PVR-1 brainLogger fix (one-line read swap, unlocks Stage 1 ingest after 24h soak) and ship the Ring5LearningService adapter facade that wraps existing Phase 2 fusion decisions per Plan v3 constraint #4 (WRAP not REWRITE).

**Architecture:** Phase 1 = surgical one-line patch in `_isServerAuthoritativeForUser` to read `engineMode` from `us` (canonical user state) instead of `stc` (transient state copy where the field is absent by design). Validation = 24h soak proving `brain_decisions` rows are persisting again per gate criteria. Phase 2 = standalone JavaScript service `Ring5LearningService` that exposes a single `wrap(phase2FusionDecision, mlBrainProInputs) → wrappedDecision` adapter; Phase 2 fusion code stays UNTOUCHED, callers route the existing fusion output through the adapter before downstream consumption. Persists per-module state in new `ml_module_state` table per SPEC-1 contract. NO bandit logic yet (that's Phase 3); adapter is a pass-through with hooks ready for downstream phases.

**Tech Stack:** Node.js + better-sqlite3 (server) + Jest (TDD). All work in `server/services/ml/` namespace per OMEGA convention.

**Branch:** `omega/wave-1-foundation` (continuation of current branch, no isolated worktree needed for these surgical changes).

**Reference specs:** `[[project_ml_v3_active_resumed]]` + `/root/_review/audit/PLAN_V3_GAP_CLOSURE_SCAFFOLDING.md` (Phase A filled doc) + `/root/_review/audit/PHASE1_BRAINLOGGER_AUDIT_20260510.md` (root cause analysis for PVR-1).

---

## File Structure

### Phase 1 (PVR-1 brainLogger fix)

- **Modify:** `server/services/serverAT.js:556` (`_isServerAuthoritativeForUser` gate function — one-line read source change)
- **Create:** `tests/unit/brainLoggerEngineModeSource.test.js` (failing test driving fix; verifies gate returns expected boolean given `us.engineMode` only, no `stc.engineMode`)
- **Soak validation:** runtime observation only — no new files. Query `SELECT COUNT(*) FROM brain_decisions WHERE ts > strftime('%s','now') - 86400` after 24h.

### Phase 2 (Ring5LearningService facade)

- **Create:** `server/services/ml/ring5LearningService.js` — adapter facade (pure functions + DB-bound persistence)
- **Create:** `server/services/ml/_ring5/ring5State.js` — state-getter/setter helper isolated for testability
- **Create:** `tests/unit/ml/ring5LearningService.test.js` — comprehensive TDD coverage (wrap pass-through, state persistence, validation guards, idempotency)
- **Modify:** `server/services/database.js` — prepend migration `369_ml_module_state` (additive table per SPEC-1 spec)

---

## Phase 1 — PVR-1 brainLogger fix (Day 1 part 1)

### Task 1.1: Verify current state + create backup

**Files:**
- Read-only: `server/services/serverAT.js:556`

- [ ] **Step 1: Confirm the bug location**

Run:
```bash
grep -n "_isServerAuthoritativeForUser" /root/zeus-terminal/server/services/serverAT.js | head -5
```

Expected output: line numbers including 556 (definition) and call sites at ~608, ~625, etc.

- [ ] **Step 2: Read the current gate function**

Run:
```bash
sed -n '550,580p' /root/zeus-terminal/server/services/serverAT.js
```

Expected: see function reading `stc.engineMode` and comparing to user-authoritative engine mode. Verify the exact field reference pattern before patching.

- [ ] **Step 3: Backup serverAT.js**

Run:
```bash
cp /root/zeus-terminal/server/services/serverAT.js \
   /root/zeus-terminal/server/services/serverAT.js.bak.pre-pvr1-20260517
md5sum /root/zeus-terminal/server/services/serverAT.js{,.bak.pre-pvr1-20260517}
```

Expected: both MD5s identical before edit.

### Task 1.2: Write failing test

**Files:**
- Create: `tests/unit/brainLoggerEngineModeSource.test.js`

- [ ] **Step 1: Write the test file**

Create `/root/zeus-terminal/tests/unit/brainLoggerEngineModeSource.test.js`:

```javascript
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pvr1-engmode-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

require('../../server/services/database');
const serverAT = require('../../server/services/serverAT');

describe('PVR-1: _isServerAuthoritativeForUser reads engineMode from us (canonical)', () => {
    test('returns true when us.engineMode=demo and stc.engineMode is absent (current broken case)', () => {
        const us = { engineMode: 'demo', userId: 1 };
        const stc = { /* no engineMode — matches at_state.stc:N JSON in prod */ };
        const result = serverAT._isServerAuthoritativeForUser(us, stc);
        expect(result).toBe(true);
    });

    test('returns true when us.engineMode=live', () => {
        const us = { engineMode: 'live', userId: 1 };
        const stc = {};
        const result = serverAT._isServerAuthoritativeForUser(us, stc);
        expect(result).toBe(true);
    });

    test('returns false when us is missing engineMode (defensive)', () => {
        const us = { userId: 1 };
        const stc = {};
        const result = serverAT._isServerAuthoritativeForUser(us, stc);
        expect(result).toBe(false);
    });
});
```

- [ ] **Step 2: Verify test fails (RED) BEFORE patching**

Run:
```bash
cd /root/zeus-terminal && npx jest tests/unit/brainLoggerEngineModeSource.test.js --runInBand 2>&1 | tail -15
```

Expected output: `Tests: 3 failed` because current code reads `stc.engineMode` which is undefined in all 3 fixtures — gate returns false universally where tests expect true for demo/live cases.

If first run shows the test ERRORS (module load fails) instead of failing assertions: read serverAT.js exports to confirm `_isServerAuthoritativeForUser` is exposed. If not, the existing prod code exposes it via `module.exports._isServerAuthoritativeForUser = _isServerAuthoritativeForUser` near end of file — add that export line if missing (defensive — needed for jest spy + this test).

### Task 1.3: Apply the one-line fix

**Files:**
- Modify: `server/services/serverAT.js:556` (or wherever the gate function lives)

- [ ] **Step 1: Identify the exact line**

Run:
```bash
grep -n "stc\.engineMode" /root/zeus-terminal/server/services/serverAT.js | head -3
```

Expected: 1-3 lines inside `_isServerAuthoritativeForUser`. Likely pattern: `if (stc.engineMode === us.engineMode)` or similar.

- [ ] **Step 2: Apply Edit using exact surrounding context**

Read 10 lines around the matched line. Locate the `stc.engineMode` read. Replace with `us.engineMode` read for the AUTHORITATIVE comparison. The pattern should logically become:

```javascript
// PVR-1 fix 2026-05-17: read engineMode from `us` (canonical user state) not
// `stc` (transient state copy where engineMode field is absent by design).
// Per audit doc PHASE1_BRAINLOGGER_AUDIT_20260510.md — fix path B.
const _engineMode = us && us.engineMode;
if (!_engineMode) return false;
// (subsequent logic compares _engineMode to expected value — preserve existing semantics)
```

Use Edit tool with old_string containing exact existing text (~5-10 lines for uniqueness) and new_string with patched version. DO NOT rewrite the whole function — surgical one-line semantic change only.

- [ ] **Step 3: Verify diff is minimal**

Run:
```bash
diff /root/zeus-terminal/server/services/serverAT.js.bak.pre-pvr1-20260517 \
     /root/zeus-terminal/server/services/serverAT.js
```

Expected: 1-3 line change inside `_isServerAuthoritativeForUser` body. NOTHING else modified.

### Task 1.4: Verify test passes (GREEN)

- [ ] **Step 1: Run isolated test**

Run:
```bash
cd /root/zeus-terminal && npx jest tests/unit/brainLoggerEngineModeSource.test.js --runInBand 2>&1 | tail -10
```

Expected: `Tests: 3 passed`.

- [ ] **Step 2: Run full regression**

Run:
```bash
cd /root/zeus-terminal && npx jest --maxWorkers=2 2>&1 | tail -8
```

Expected: total pass count INCREASES BY 3 vs pre-fix baseline (251 suites / 6573 → 251 suites / 6576). Zero new failures. Pre-existing flakey settingsStore test still counts (1 known failure, unrelated).

### Task 1.5: Commit + tag

- [ ] **Step 1: Stage + commit**

Run:
```bash
cd /root/zeus-terminal
git add server/services/serverAT.js tests/unit/brainLoggerEngineModeSource.test.js
git commit -m "$(cat <<'EOF'
fix(PVR-1): brainLogger engineMode read source — stc→us one-line swap

Root cause confirmed 2026-05-10 audit: _isServerAuthoritativeForUser(stc)
returns false because stc.engineMode field absent from at_state.stc:N JSON
+ DEFAULT_STC schema. brainLogger code intact; gate broken.

Fix path B per audit recommendation: read engineMode from us (canonical user
state) instead of stc (transient state copy). One-line surgical change.

Unblocks Stage 1 ML ingest after 24h consecutive records validation.

Tests (3 passing): demo + live engineMode cases pass; missing engineMode
defensive false guard preserved.

Audit ref: _review/audit/PHASE1_BRAINLOGGER_AUDIT_20260510.md
Plan ref: _review/audit/PLAN_V3_GAP_CLOSURE_SCAFFOLDING.md §PVR-1

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Tag**

Run:
```bash
git tag "fix-pvr1-brainlogger-engmode-source-$(date -u +%Y%m%d-%H%M%S)"
```

- [ ] **Step 3: Push**

Run:
```bash
git push origin omega/wave-1-foundation --tags 2>&1 | tail -5
```

Expected: clean push, no rejected commits.

### Task 1.6: 24h soak validation gate

This task is OFF-PLAN (runs unattended); it produces the evidence the next phase will read. Marked complete only after the 24h window passes AND query confirms records persist.

- [ ] **Step 1: Snapshot current brain_decisions count at T0**

Run:
```bash
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT COUNT(*) AS n_pre_pvr1 FROM brain_decisions" | tee /tmp/pvr1-soak-t0.txt
date -u --iso-8601=seconds >> /tmp/pvr1-soak-t0.txt
```

Note the count. Expect very low (close to zero since the bug has been blocking writes).

- [ ] **Step 2: 24h later — re-run count + diff**

Wait ≥ 24 hours after PM2 reload that picked up the patched code. Then run:

```bash
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT COUNT(*) AS n_post_pvr1 FROM brain_decisions WHERE ts > strftime('%s','now') - 86400" | tee /tmp/pvr1-soak-t24.txt
```

- [ ] **Step 3: Verify gate criteria**

Gate PASS criteria (ALL three):
- `n_post_pvr1 ≥ 10` rows in last 24h (proves brainLogger writes flowing)
- At least one row has `decision != 'NOOP'` (proves real decision capture, not just heartbeat)
- Zero exceptions in PM2 logs grep: `pm2 logs zeus --lines 1000 --nostream | grep -i "brainLogger\|_isServerAuthorit"` shows no errors

Gate FAIL → investigate further (env mismatch?, restart problem?, second hidden gate?). Do NOT proceed to Phase 2 until Gate PASS confirmed.

- [ ] **Step 4: Record outcome in memory**

After gate PASS, update `[[project_ml_v3_active_resumed]]` memory with:
"PVR-1 24h soak validation PASS YYYY-MM-DD; n_post_pvr1=X rows; Stage 1 ingest unblocked."

---

## Phase 2 — Ring5LearningService facade (Day 1 part 2)

**Phase 2 GATE:** Phase 1 Task 1.6 24h soak validation MUST be GREEN before any Phase 2 task starts. Phase 2 tasks below assume brainLogger is flowing real decision rows.

### Task 2.1: Migration `369_ml_module_state`

**Files:**
- Modify: `server/services/database.js` (prepend before line 997 `// [OMEGA Doctor D-2 telemetry collector + event log 2026-05-17]` anchor)
- Create: `tests/unit/ml/migration369ModuleState.test.js`

- [ ] **Step 1: Write the failing migration test**

Create `/root/zeus-terminal/tests/unit/ml/migration369ModuleState.test.js`:

```javascript
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig369-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');

describe('Phase 2 migration 369_ml_module_state', () => {
    test('migration applied at boot', () => {
        const row = db.prepare("SELECT name FROM _migrations WHERE name = ?").get('369_ml_module_state');
        expect(row).toBeTruthy();
    });

    test('table has all required columns', () => {
        const cols = db.prepare("PRAGMA table_info(ml_module_state)").all();
        const names = cols.map(c => c.name).sort();
        expect(names).toEqual([
            'bandit_params_json', 'id', 'last_observed_ts', 'module_id',
            'resolved_env', 'symbol', 'trust_score', 'updated_at',
            'user_id', 'version'
        ]);
    });

    test('resolved_env CHECK enforced', () => {
        expect(() => {
            db.prepare(`INSERT INTO ml_module_state
                (user_id, resolved_env, symbol, module_id, version, last_observed_ts, trust_score, bandit_params_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(1, 'INVALID', 'BTCUSDT', 'm', 1, Date.now(), 0.5, '{}', Date.now());
        }).toThrow(/CHECK/);
    });

    test('composite UNIQUE on (user_id, resolved_env, symbol, module_id)', () => {
        const now = Date.now();
        db.prepare(`INSERT INTO ml_module_state
            (user_id, resolved_env, symbol, module_id, version, last_observed_ts, trust_score, bandit_params_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(1, 'DEMO', 'BTCUSDT', 'mod_a', 1, now, 0.5, '{}', now);
        expect(() => {
            db.prepare(`INSERT INTO ml_module_state
                (user_id, resolved_env, symbol, module_id, version, last_observed_ts, trust_score, bandit_params_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(1, 'DEMO', 'BTCUSDT', 'mod_a', 1, now, 0.5, '{}', now);
        }).toThrow(/UNIQUE/);
    });

    test('trust_score CHECK enforces [0,1] range', () => {
        expect(() => {
            db.prepare(`INSERT INTO ml_module_state
                (user_id, resolved_env, symbol, module_id, version, last_observed_ts, trust_score, bandit_params_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(1, 'DEMO', 'BTCUSDT', 'mod_bad_trust', 1, Date.now(), 1.5, '{}', Date.now());
        }).toThrow(/CHECK/);
    });

    test('version CHECK enforces positive integer', () => {
        expect(() => {
            db.prepare(`INSERT INTO ml_module_state
                (user_id, resolved_env, symbol, module_id, version, last_observed_ts, trust_score, bandit_params_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(1, 'DEMO', 'BTCUSDT', 'mod_bad_v', 0, Date.now(), 0.5, '{}', Date.now());
        }).toThrow(/CHECK/);
    });

    test('index idx_mlms_cell_module exists', () => {
        const idx = db.prepare(`
            SELECT name FROM sqlite_master
            WHERE type = 'index' AND tbl_name = 'ml_module_state'
              AND name = 'idx_mlms_cell_module'
        `).get();
        expect(idx).toBeTruthy();
    });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run:
```bash
cd /root/zeus-terminal && npx jest tests/unit/ml/migration369ModuleState.test.js --runInBand 2>&1 | tail -10
```

Expected: `Tests: 7 failed` with first error `no such table: ml_module_state`.

- [ ] **Step 3: Add migration to database.js**

Edit `server/services/database.js`. Locate the existing anchor:
```javascript
// [OMEGA Doctor D-2 telemetry collector + event log 2026-05-17]
```

PREPEND the following block immediately BEFORE that anchor comment:

```javascript
// [ML Plan v3 Phase 2 — Ring5LearningService module state per SPEC-1 contract 2026-05-17]
migrate('369_ml_module_state', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_module_state (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol TEXT NOT NULL,
            module_id TEXT NOT NULL,
            version INTEGER NOT NULL CHECK(version > 0),
            last_observed_ts INTEGER NOT NULL,
            trust_score REAL NOT NULL CHECK(trust_score >= 0 AND trust_score <= 1),
            bandit_params_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, symbol, module_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mlms_cell_module
            ON ml_module_state(user_id, resolved_env, symbol, module_id);
    `);
});

```

- [ ] **Step 4: Run test, verify it passes**

Run:
```bash
cd /root/zeus-terminal && npx jest tests/unit/ml/migration369ModuleState.test.js --runInBand 2>&1 | tail -8
```

Expected: `Tests: 7 passed`.

- [ ] **Step 5: Commit**

Run:
```bash
cd /root/zeus-terminal
git add server/services/database.js tests/unit/ml/migration369ModuleState.test.js
git commit -m "$(cat <<'EOF'
feat(ml-phase-b): migration 369 ml_module_state per SPEC-1 contract

Per Plan v3 Phase A SPEC-1 decision: per-(user × resolved_env × symbol × module_id)
composite-key state row for feature modules. Stores bandit posterior params,
last_observed_ts (for §15 confidence decay), trust_score (from Doctor D-3.3),
version (incremented on every persisted write).

Schema:
  - 4-part composite UNIQUE enforces isolation
  - resolved_env CHECK 3 enum (DEMO|TESTNET|REAL)
  - trust_score CHECK [0,1]
  - version CHECK > 0
  - INDEX idx_mlms_cell_module (user, env, symbol, module) for hot lookups

7 tests passing.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 2.2: ring5State helper (pure state-getter/setter)

**Files:**
- Create: `server/services/ml/_ring5/ring5State.js`
- Create: `tests/unit/ml/ring5State.test.js`

- [ ] **Step 1: Add allowlist for `_ring5` namespace in `.gitignore`**

The Zeus `.gitignore` has a blanket `_*` rule with explicit allowlist for `_audit`, `_voice`, `_operator`, `_crosscutting`, `_meta`, `_doctor`. Add `_ring5`:

Find line containing `!server/services/ml/_doctor/` in `.gitignore`, add IMMEDIATELY AFTER:
```
!server/services/ml/_ring5/
```

Verify:
```bash
git check-ignore -v /root/zeus-terminal/server/services/ml/_ring5/ring5State.js 2>&1
```
Expected: empty output (no ignore rule matches).

- [ ] **Step 2: Write failing test**

Create `/root/zeus-terminal/tests/unit/ml/ring5State.test.js`:

```javascript
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-state-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ring5State = require('../../../server/services/ml/_ring5/ring5State');

const _now = () => Date.now();

function clean() {
    db.prepare("DELETE FROM ml_module_state").run();
}

describe('ring5State (Phase 2)', () => {
    beforeEach(clean);

    describe('getModuleState', () => {
        test('returns null for unseen cell', () => {
            const r = ring5State.getModuleState({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'unseen_mod'
            });
            expect(r).toBeNull();
        });

        test('returns hydrated row when present', () => {
            db.prepare(`INSERT INTO ml_module_state
                (user_id, resolved_env, symbol, module_id, version, last_observed_ts, trust_score, bandit_params_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(1, 'DEMO', 'BTCUSDT', 'mod_x', 3, 12345, 0.7, '{"alpha":2,"beta":1}', _now());
            const r = ring5State.getModuleState({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'mod_x'
            });
            expect(r).toBeTruthy();
            expect(r.version).toBe(3);
            expect(r.trustScore).toBe(0.7);
            expect(r.banditParams).toEqual({ alpha: 2, beta: 1 });
            expect(r.lastObservedTs).toBe(12345);
        });
    });

    describe('updateModuleState (atomic upsert)', () => {
        test('inserts new row when cell unseen', () => {
            ring5State.updateModuleState({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'mod_new',
                trustScore: 0.6,
                banditParams: { alpha: 1, beta: 1 },
                lastObservedTs: _now(),
                ts: _now()
            });
            const r = ring5State.getModuleState({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'mod_new'
            });
            expect(r.version).toBe(1);
            expect(r.trustScore).toBe(0.6);
        });

        test('increments version on existing row update', () => {
            const args = {
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'mod_v',
                trustScore: 0.5,
                banditParams: { alpha: 1, beta: 1 },
                lastObservedTs: _now(),
                ts: _now()
            };
            ring5State.updateModuleState(args);
            ring5State.updateModuleState({ ...args, trustScore: 0.6 });
            ring5State.updateModuleState({ ...args, trustScore: 0.7 });
            const r = ring5State.getModuleState({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'mod_v'
            });
            expect(r.version).toBe(3);
            expect(r.trustScore).toBe(0.7);
        });

        test('rejects invalid resolvedEnv', () => {
            expect(() => ring5State.updateModuleState({
                userId: 1, resolvedEnv: 'BAD', symbol: 'BTCUSDT', moduleId: 'm',
                trustScore: 0.5, banditParams: {}, lastObservedTs: _now(), ts: _now()
            })).toThrow(/resolvedEnv/);
        });

        test('rejects trustScore outside [0,1]', () => {
            expect(() => ring5State.updateModuleState({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'm',
                trustScore: 1.5, banditParams: {}, lastObservedTs: _now(), ts: _now()
            })).toThrow(/trustScore/);
        });

        test('rejects missing required field', () => {
            expect(() => ring5State.updateModuleState({
                resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'm',
                trustScore: 0.5, banditParams: {}, lastObservedTs: _now(), ts: _now()
            })).toThrow(/userId/);
        });
    });

    describe('per-(user × env × symbol × module) isolation', () => {
        test('same moduleId different env writes independently', () => {
            const base = {
                userId: 1, symbol: 'BTCUSDT', moduleId: 'iso_mod',
                trustScore: 0.5, banditParams: { alpha: 1, beta: 1 },
                lastObservedTs: _now(), ts: _now()
            };
            ring5State.updateModuleState({ ...base, resolvedEnv: 'DEMO', trustScore: 0.4 });
            ring5State.updateModuleState({ ...base, resolvedEnv: 'TESTNET', trustScore: 0.8 });
            const demo = ring5State.getModuleState({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'iso_mod'
            });
            const test = ring5State.getModuleState({
                userId: 1, resolvedEnv: 'TESTNET', symbol: 'BTCUSDT', moduleId: 'iso_mod'
            });
            expect(demo.trustScore).toBe(0.4);
            expect(test.trustScore).toBe(0.8);
        });

        test('same moduleId different user writes independently', () => {
            const base = {
                resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'iso_user_mod',
                trustScore: 0.5, banditParams: { alpha: 1, beta: 1 },
                lastObservedTs: _now(), ts: _now()
            };
            ring5State.updateModuleState({ ...base, userId: 1, trustScore: 0.3 });
            ring5State.updateModuleState({ ...base, userId: 2, trustScore: 0.9 });
            const a = ring5State.getModuleState({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'iso_user_mod'
            });
            const b = ring5State.getModuleState({
                userId: 2, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'iso_user_mod'
            });
            expect(a.trustScore).toBe(0.3);
            expect(b.trustScore).toBe(0.9);
        });
    });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run:
```bash
cd /root/zeus-terminal && npx jest tests/unit/ml/ring5State.test.js --runInBand 2>&1 | tail -8
```

Expected: `Cannot find module '../../../server/services/ml/_ring5/ring5State'`.

- [ ] **Step 4: Create ring5State.js**

Create directory if needed:
```bash
mkdir -p /root/zeus-terminal/server/services/ml/_ring5
```

Create `/root/zeus-terminal/server/services/ml/_ring5/ring5State.js`:

```javascript
'use strict';

/**
 * ML Plan v3 Phase 2 — ring5State helper.
 *
 * Pure DB-bound state-getter/setter per SPEC-1 ModuleState contract:
 *   Composite key: (user_id, resolved_env, symbol, module_id)
 *   Fields: version, last_observed_ts, trust_score, bandit_params_json
 *
 * Atomic upsert via INSERT ON CONFLICT UPDATE — version auto-increments on
 * existing rows, new rows start at version=1.
 *
 * No business logic; pure persistence isolated for testability. Ring5LearningService
 * facade composes this helper with adapter logic.
 */

const { db } = require('../../database');

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(p, k) {
    if (p == null || p[k] == null) {
        throw new Error(`ring5State: missing required field ${k}`);
    }
    return p[k];
}

function _validateEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`ring5State: invalid resolvedEnv '${env}'`);
    }
    return env;
}

function _validateTrustScore(v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`ring5State: trustScore must be number in [0,1], got ${v}`);
    }
    return v;
}

const _stmts = {
    select: db.prepare(`
        SELECT id, user_id, resolved_env, symbol, module_id, version,
               last_observed_ts, trust_score, bandit_params_json, updated_at
        FROM ml_module_state
        WHERE user_id = ? AND resolved_env = ? AND symbol = ? AND module_id = ?
    `),
    upsert: db.prepare(`
        INSERT INTO ml_module_state
            (user_id, resolved_env, symbol, module_id, version,
             last_observed_ts, trust_score, bandit_params_json, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env, symbol, module_id) DO UPDATE SET
            version = version + 1,
            last_observed_ts = excluded.last_observed_ts,
            trust_score = excluded.trust_score,
            bandit_params_json = excluded.bandit_params_json,
            updated_at = excluded.updated_at
    `)
};

function getModuleState(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _validateEnv(_required(params, 'resolvedEnv'));
    const symbol = _required(params, 'symbol');
    const moduleId = _required(params, 'moduleId');
    const row = _stmts.select.get(userId, resolvedEnv, symbol, moduleId);
    if (!row) return null;
    return {
        id: row.id,
        userId: row.user_id,
        resolvedEnv: row.resolved_env,
        symbol: row.symbol,
        moduleId: row.module_id,
        version: row.version,
        lastObservedTs: row.last_observed_ts,
        trustScore: row.trust_score,
        banditParams: JSON.parse(row.bandit_params_json),
        updatedAt: row.updated_at
    };
}

function updateModuleState(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _validateEnv(_required(params, 'resolvedEnv'));
    const symbol = _required(params, 'symbol');
    const moduleId = _required(params, 'moduleId');
    const trustScore = _validateTrustScore(_required(params, 'trustScore'));
    const banditParams = _required(params, 'banditParams');
    const lastObservedTs = _required(params, 'lastObservedTs');
    const ts = _required(params, 'ts');

    _stmts.upsert.run(
        userId, resolvedEnv, symbol, moduleId,
        lastObservedTs, trustScore, JSON.stringify(banditParams), ts
    );
    return { updated: true };
}

module.exports = { getModuleState, updateModuleState };
```

- [ ] **Step 5: Run test, verify it passes**

Run:
```bash
cd /root/zeus-terminal && npx jest tests/unit/ml/ring5State.test.js --runInBand 2>&1 | tail -8
```

Expected: `Tests: 10 passed`.

- [ ] **Step 6: Commit**

Run:
```bash
cd /root/zeus-terminal
git add .gitignore \
        server/services/ml/_ring5/ring5State.js \
        tests/unit/ml/ring5State.test.js
git commit -m "$(cat <<'EOF'
feat(ml-phase-b): ring5State helper — atomic upsert per SPEC-1 contract

Pure DB-bound state getter/setter for Ring5LearningService Phase 2 facade.

API:
  - getModuleState({userId, resolvedEnv, symbol, moduleId}) → hydrated record or null
  - updateModuleState({userId, resolvedEnv, symbol, moduleId, trustScore,
                       banditParams, lastObservedTs, ts}) → atomic upsert,
                       auto-increments version on existing rows

Per-(user × env × symbol × module) composite-key isolation enforced at DB
level via UNIQUE constraint (migration 369). Atomic version increment via
INSERT ON CONFLICT UPDATE.

.gitignore allowlist: !server/services/ml/_ring5/

10 tests passing (insertion, version increment, isolation across env/user
boundaries, validation guards).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 2.3: ring5LearningService facade (the wrap layer)

**Files:**
- Create: `server/services/ml/ring5LearningService.js`
- Create: `tests/unit/ml/ring5LearningService.test.js`

- [ ] **Step 1: Write failing test**

Create `/root/zeus-terminal/tests/unit/ml/ring5LearningService.test.js`:

```javascript
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-svc-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ring5 = require('../../../server/services/ml/ring5LearningService');

const _now = () => Date.now();

function clean() {
    db.prepare("DELETE FROM ml_module_state").run();
}

describe('Ring5LearningService Phase 2 facade', () => {
    beforeEach(clean);

    describe('wrap (pass-through with hooks)', () => {
        test('returns phase2 decision unmodified when no ML inputs provided', () => {
            const phase2Decision = {
                dir: 'LONG',
                confidence: 0.72,
                score: 0.65,
                reasons: ['ema_bull', 'vol_high'],
                ts: _now()
            };
            const wrapped = ring5.wrap({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                phase2Decision, mlBrainProInputs: null
            });
            // Phase 2 keys preserved exactly
            expect(wrapped.dir).toBe('LONG');
            expect(wrapped.confidence).toBe(0.72);
            expect(wrapped.score).toBe(0.65);
            expect(wrapped.reasons).toEqual(['ema_bull', 'vol_high']);
            // Phase 2 source marker added
            expect(wrapped.layeredBy).toBe('phase2-only');
        });

        test('attaches ring5 metadata when mlBrainProInputs provided (read-only mode)', () => {
            const phase2Decision = {
                dir: 'SHORT',
                confidence: 0.55,
                score: 0.40,
                reasons: ['rsi_overbought'],
                ts: _now()
            };
            const mlBrainProInputs = {
                contributions: [
                    { moduleId: 'smartMoneyDetector', contribution: -0.3, confidence: 0.8 },
                    { moduleId: 'regimeMetrics', contribution: -0.1, confidence: 0.6 }
                ]
            };
            const wrapped = ring5.wrap({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                phase2Decision, mlBrainProInputs
            });
            // Phase 2 keys preserved EXACTLY (read-only mode = no influence)
            expect(wrapped.dir).toBe('SHORT');
            expect(wrapped.confidence).toBe(0.55);
            expect(wrapped.score).toBe(0.40);
            // Ring5 attaches shadow metadata
            expect(wrapped.layeredBy).toBe('ring5-shadow');
            expect(wrapped.ring5Shadow).toBeDefined();
            expect(wrapped.ring5Shadow.contributionsCount).toBe(2);
        });

        test('preserves phase2 ts (immutability)', () => {
            const t = 1700000000000;
            const phase2Decision = { dir: 'LONG', confidence: 0.5, score: 0.5, reasons: [], ts: t };
            const wrapped = ring5.wrap({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                phase2Decision, mlBrainProInputs: null
            });
            expect(wrapped.ts).toBe(t);
        });
    });

    describe('Validation', () => {
        test('rejects missing phase2Decision', () => {
            expect(() => ring5.wrap({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                mlBrainProInputs: null
            })).toThrow(/phase2Decision/);
        });

        test('rejects invalid resolvedEnv', () => {
            const phase2Decision = { dir: 'LONG', confidence: 0.5, score: 0.5, reasons: [], ts: _now() };
            expect(() => ring5.wrap({
                userId: 1, resolvedEnv: 'BAD', symbol: 'BTCUSDT',
                phase2Decision, mlBrainProInputs: null
            })).toThrow(/resolvedEnv/);
        });

        test('rejects missing userId', () => {
            const phase2Decision = { dir: 'LONG', confidence: 0.5, score: 0.5, reasons: [], ts: _now() };
            expect(() => ring5.wrap({
                resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                phase2Decision, mlBrainProInputs: null
            })).toThrow(/userId/);
        });
    });

    describe('recordContribution (persists per-module evidence into state)', () => {
        test('inserts new state row for unseen module', () => {
            ring5.recordContribution({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'mod_smart',
                contribution: 0.2,
                confidence: 0.7,
                ts: _now()
            });
            const state = ring5._stateHelper.getModuleState({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'mod_smart'
            });
            expect(state).toBeTruthy();
            expect(state.version).toBe(1);
        });

        test('increments version on repeated contributions for same module', () => {
            const base = {
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'mod_repeat',
                contribution: 0.1, confidence: 0.5, ts: _now()
            };
            ring5.recordContribution(base);
            ring5.recordContribution({ ...base, contribution: 0.2 });
            ring5.recordContribution({ ...base, contribution: 0.15 });
            const state = ring5._stateHelper.getModuleState({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'mod_repeat'
            });
            expect(state.version).toBe(3);
        });

        test('isolation across env: same module DEMO vs TESTNET tracked separately', () => {
            const base = {
                userId: 1, symbol: 'BTCUSDT', moduleId: 'iso_env',
                contribution: 0.1, confidence: 0.5, ts: _now()
            };
            ring5.recordContribution({ ...base, resolvedEnv: 'DEMO' });
            ring5.recordContribution({ ...base, resolvedEnv: 'TESTNET' });
            const demo = ring5._stateHelper.getModuleState({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'iso_env'
            });
            const test = ring5._stateHelper.getModuleState({
                userId: 1, resolvedEnv: 'TESTNET', symbol: 'BTCUSDT', moduleId: 'iso_env'
            });
            expect(demo.version).toBe(1);
            expect(test.version).toBe(1);
        });
    });

    describe('Constraint compliance', () => {
        test('Phase 2 fusion math signature is NOT modified — adapter is pure wrap', () => {
            // Sanity test: the wrap() function should not require any callable from
            // Phase 2 — it operates on already-computed phase2Decision shape only.
            const phase2Decision = {
                dir: 'LONG', confidence: 0.7, score: 0.65,
                reasons: ['rule1'], ts: _now()
            };
            // Call wrap with NO Phase 2 dependency mock — it must just work.
            const wrapped = ring5.wrap({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                phase2Decision, mlBrainProInputs: null
            });
            expect(wrapped).toBeDefined();
            // Phase 2 keys unchanged confirms adapter is pure wrap not rewrite
            expect(Object.keys(wrapped)).toEqual(
                expect.arrayContaining(['dir', 'confidence', 'score', 'reasons', 'ts', 'layeredBy'])
            );
        });
    });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run:
```bash
cd /root/zeus-terminal && npx jest tests/unit/ml/ring5LearningService.test.js --runInBand 2>&1 | tail -8
```

Expected: `Cannot find module '../../../server/services/ml/ring5LearningService'`.

- [ ] **Step 3: Create ring5LearningService.js**

Create `/root/zeus-terminal/server/services/ml/ring5LearningService.js`:

```javascript
'use strict';

/**
 * ML Plan v3 Phase 2 — Ring5LearningService facade.
 *
 * Per constraint #4 (WRAP not REWRITE): this adapter sits between existing
 * Phase 2 fusion output and downstream consumers. Phase 2 fusion math stays
 * UNTOUCHED — Ring5 receives the already-computed phase2Decision and decorates
 * it with optional ML-Brain-Pro shadow metadata.
 *
 * Phase B Day 1 scope: READ-ONLY shadow mode. Ring5 attaches metadata about
 * what ML-Brain-Pro WOULD have done, but never modifies dir/confidence/score.
 * Promotion to influence-mode is Phase 4 (reflection enforcement + §247*
 * preRegistration + §252* tieredPromotion).
 *
 * API:
 *   - wrap({userId, resolvedEnv, symbol, phase2Decision, mlBrainProInputs?})
 *       → phase2Decision augmented with `layeredBy` marker + optional
 *         `ring5Shadow` metadata when mlBrainProInputs provided.
 *
 *   - recordContribution({userId, resolvedEnv, symbol, moduleId, contribution,
 *                        confidence, ts})
 *       → upserts per-module state row (atomic version increment).
 *
 * State persistence delegated to ring5State helper (isolated for testability).
 */

const _stateHelper = require('./_ring5/ring5State');

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(p, k) {
    if (p == null || p[k] == null) {
        throw new Error(`ring5LearningService: missing required field ${k}`);
    }
    return p[k];
}

function _validateEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`ring5LearningService: invalid resolvedEnv '${env}'`);
    }
    return env;
}

function wrap(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _validateEnv(_required(params, 'resolvedEnv'));
    const symbol = _required(params, 'symbol');
    const phase2Decision = _required(params, 'phase2Decision');
    const mlBrainProInputs = params.mlBrainProInputs ?? null;

    // Phase 2 fields preserved EXACTLY — wrap is read-only in Phase B Day 1.
    const wrapped = {
        dir: phase2Decision.dir,
        confidence: phase2Decision.confidence,
        score: phase2Decision.score,
        reasons: phase2Decision.reasons,
        ts: phase2Decision.ts,
        layeredBy: mlBrainProInputs ? 'ring5-shadow' : 'phase2-only'
    };

    if (mlBrainProInputs) {
        wrapped.ring5Shadow = {
            contributionsCount: (mlBrainProInputs.contributions || []).length,
            sumContribution: (mlBrainProInputs.contributions || [])
                .reduce((s, c) => s + (c.contribution || 0), 0),
            // Note: this is observational only. NO mutation of phase2 values.
            // Downstream Phase 4 will use this metadata as shadow-comparison input.
        };
    }

    return wrapped;
}

function recordContribution(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _validateEnv(_required(params, 'resolvedEnv'));
    const symbol = _required(params, 'symbol');
    const moduleId = _required(params, 'moduleId');
    const contribution = _required(params, 'contribution');
    const confidence = _required(params, 'confidence');
    const ts = _required(params, 'ts');

    // Phase B Day 1: trust_score initialized to confidence; bandit params stub.
    // Phase 3 will replace this with real Thompson Sampling α/β state.
    _stateHelper.updateModuleState({
        userId, resolvedEnv, symbol, moduleId,
        trustScore: Math.max(0, Math.min(1, confidence)),
        banditParams: { alpha: 1, beta: 1, lastContribution: contribution },
        lastObservedTs: ts,
        ts
    });

    return { recorded: true };
}

module.exports = {
    wrap,
    recordContribution,
    // Exposed for testing only — internal helper composition.
    _stateHelper
};
```

- [ ] **Step 4: Run test, verify it passes**

Run:
```bash
cd /root/zeus-terminal && npx jest tests/unit/ml/ring5LearningService.test.js --runInBand 2>&1 | tail -10
```

Expected: `Tests: 11 passed`.

- [ ] **Step 5: Commit**

Run:
```bash
cd /root/zeus-terminal
git add server/services/ml/ring5LearningService.js \
        tests/unit/ml/ring5LearningService.test.js
git commit -m "$(cat <<'EOF'
feat(ml-phase-b): Ring5LearningService facade — wrap layer per ARCH-4 constraint

Phase 2 fusion adapter per Plan v3 constraint #4 (WRAP not REWRITE).

API:
  - wrap({userId, resolvedEnv, symbol, phase2Decision, mlBrainProInputs?})
    Returns phase2Decision unchanged + `layeredBy` marker + optional
    `ring5Shadow` metadata (read-only Phase B Day 1 — no influence).
  - recordContribution({userId, resolvedEnv, symbol, moduleId,
                       contribution, confidence, ts})
    Persists per-module evidence via ring5State helper (atomic upsert).

Design:
  - Phase 2 fusion math UNTOUCHED — adapter receives already-computed decision
  - Per-(user × env × symbol) isolation enforced at validation + DB layer
  - Read-only mode: ring5Shadow metadata informs Phase 4 promotion path
  - State persistence isolated in _ring5/ring5State (testability)

Tests (11 passing):
  - wrap pass-through (phase2 unmodified)
  - shadow metadata attachment when mlBrainProInputs provided
  - phase2 ts immutability
  - 3 validation guards (missing fields, invalid env)
  - recordContribution upsert + version increment + env isolation
  - constraint compliance sanity (adapter is pure wrap)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 2.4: Phase B Day 1 closeout — full regression + tag + push

- [ ] **Step 1: Run full regression**

Run:
```bash
cd /root/zeus-terminal && npx jest --maxWorkers=2 2>&1 | tail -10
```

Expected: total pass count INCREASES BY ≥28 vs pre-Phase-B baseline (251 suites / 6573 → 254 suites / 6601). Zero new failures. Pre-existing flakey settingsStore stays (1 known failure).

- [ ] **Step 2: Tag the Phase B Day 1 milestone**

Run:
```bash
cd /root/zeus-terminal
git tag "ml-plan-v3-phase-b-day1-phase1-2-COMPLETE-$(date -u +%Y%m%d-%H%M%S)"
```

- [ ] **Step 3: Push branch + tags**

Run:
```bash
git push origin omega/wave-1-foundation --tags 2>&1 | tail -5
```

Expected: clean push, new tag listed.

- [ ] **Step 4: Update memory tracker**

Edit `/root/.claude/projects/-root/memory/MEMORY.md` line `ml-plan-v3-active-resumed` entry to append:

```
**Phase B Day 1 ✅ SHIPPED 2026-05-17** — PVR-1 brainLogger fix (one-line stc→us read swap) + Ring5LearningService facade (wrap-only adapter, read-only Phase B Day 1) + migration 369_ml_module_state + ring5State helper + .gitignore _ring5/ allowlist. Tag `ml-plan-v3-phase-b-day1-phase1-2-COMPLETE-…`. 28+ new tests, regression clean. Phase 1 24h soak validation gate runs in background (n_post_pvr1 ≥ 10 rows criteria). **Phase B Day 2 NEXT** = Phase 3 Thompson Sampling bandit (SPEC-8 4-level hierarchy + SPEC-7 lazy pooled evidence refresh + ARCH-2 LRU cache).
```

---

## Self-Review (writing-plans skill discipline)

**1. Spec coverage:**
- PVR-1 (brainLogger fix) — Tasks 1.1-1.5 ✅
- 24h soak validation gate — Task 1.6 ✅
- SPEC-1 (ModuleState schema) — Task 2.1 migration ✅
- ARCH-4 (wrap, not rewrite) — Task 2.3 wrap() pass-through ✅
- Per-(user × env × symbol) isolation — Task 2.2 + 2.3 tests verify ✅
- Phase 2 fusion untouched — Task 2.3 sanity test ✅

**2. Placeholder scan:** None. Every step has either an exact bash command with expected output, an exact file path + exact code block, or an explicit gate criteria.

**3. Type consistency:**
- `userId` (number), `resolvedEnv` (enum DEMO|TESTNET|REAL), `symbol` (string), `moduleId` (string), `ts` (number ms) — consistent across Task 2.1 schema → 2.2 helper → 2.3 facade.
- `banditParams` (object → JSON.stringify) consistent in Task 2.2 + 2.3.
- `trustScore` in [0,1] CHECK at DB layer (Task 2.1) + JS validation (Task 2.2 `_validateTrustScore`) — same bounds.
- Wrap output `layeredBy` field consistent between Task 2.3 test + impl.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-17-ml-plan-v3-phase-b-day1-phase1-2.md`.** Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task (1.1, 1.2, …, 2.4), review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints between Phase 1 and Phase 2.

**Which approach?**

**Phase B Day 2 + Day 3 will be written as SEPARATE plan files** when:
- Day 1 ships completely (Phase 1 closed)
- Phase 1 24h soak gate is GREEN
- Operator confirms Day 2 scope (Phase 3 Thompson Sampling bandit)
