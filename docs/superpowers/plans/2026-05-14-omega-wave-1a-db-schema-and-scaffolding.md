# OMEGA Wave 1A — DB Schema + Directory Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the foundation for OMEGA ML implementation — create `server/services/ml/` directory tree per 9-ring architecture + 10 additive DB tables (migrations 032-041) + 9 new migration flags. Zero behavioral change; zero existing code touched. Pure additive scaffolding.

**Architecture:** New directory tree at `server/services/ml/` containing one subdirectory per ring (R-1 through R7) + 4 cross-cutting (`_audit`, `_voice`, `_operator`, `_communication`). DB schema additive via `migrate()` framework in `server/services/database.js`. All migrations idempotent via `CREATE TABLE IF NOT EXISTS`. Migration flags default OFF.

**Tech Stack:** Node.js + Express + better-sqlite3 + Jest (existing). No new dependencies.

**Branch:** `omega/wave-1-foundation` (already created off `post-v2/real-finish` at commit `c92ce0e`).

**Backup:** Git tag `pre-omega-wave-1-20260514-214634` (already created).

## ⚠️ Migration numbering correction (2026-05-14 post-plan)

Plan originally targeted migrations 032-041. **Live DB already has `032_at_closed_fk_user`** applied (introduced earlier). Per Rule 21 finding:

**OMEGA migrations renumbered to 033-042:**
- 033 = `ml_runtime_features` (was 032)
- 034 = `ml_feature_audit_log` (was 033)
- 035 = `ml_feature_proposals` (was 034)
- 036 = `ml_feature_global_overrides` (was 035)
- 037 = `ml_decision_snapshots` (was 036)
- 038 = `ml_decision_light` (was 037)
- 039 = `ml_attribution_events` (was 038)
- 040 = `ml_voice_log` (was 039)
- 041 = `ml_operator_approval` (was 040)
- 042 = `ml_ring_health` (was 041)

Task code blocks below retain original 032-041 numbers for narrative — implementer subagents are instructed to use 033-042 actual numbers.

**Constraint reminder (per memory `project_ml_architecture_frozen.md`):**
- 7 corrections frozen; 4 corner-cases A-D frozen
- Per-user × per-env × per-symbol isolation strict
- DEMO ≠ TESTNET ≠ REAL evidence flow
- Phase 1 brainLogger fix separate (NOT in Wave 1)
- Server-only ML; frontend = read-model
- Schema additive only — NO ALTER on Phase 2 tables

---

## File Structure

### New directory tree (created in Task 2):

```
server/services/ml/
├── R-1_testHarness/          # Test infrastructure (Claude addition)
│   └── .gitkeep
├── R0_substrate/              # DB, time, opsec, DR core
│   └── .gitkeep
├── R1_constitution/           # Tiered authority, sacred zones
│   └── .gitkeep
├── R2_brain/                  # Brain detectors facades
│   └── .gitkeep
├── R3A_safety/                # Hard safety guards
│   └── .gitkeep
├── R3B_validation/            # Conformal, OOD, evidence
│   └── .gitkeep
├── R4_execution/              # Exactly-once execution
│   └── .gitkeep
├── R5A_learning/              # Thompson bandit, attribution
│   └── .gitkeep
├── R5B_governance/            # Quarantine, promotion, pre-registration
│   └── .gitkeep
├── R6_shadowMeta/             # A/B, counterfactual, self-improvement
│   └── .gitkeep
├── R7_communication/          # Inter-ring event bus
│   └── .gitkeep
├── _audit/                    # Cross-cutting: audit trail
│   └── .gitkeep
├── _voice/                    # Cross-cutting: Voice Layer (OMEGA personality)
│   └── .gitkeep
├── _operator/                 # Cross-cutting: Operator Interaction
│   └── .gitkeep
└── README.md                  # Architecture overview pointer
```

### New tests directory:

```
tests/unit/ml/
├── omegaScaffolding.test.js   # Wave 1A: directory structure exists
└── omegaMigrations.test.js    # Wave 1A: 10 migrations applied + schemas correct
```

### Modified existing files (additive only):

```
server/services/database.js      # +10 migrate() blocks (lines appended at end of migration sequence)
server/migrationFlags.js         # +9 new flag getters
```

---

## Tasks

### Task 1: Pre-implementation spec re-read (no code)

**Why:** Per Rule 3 (Audit-first) and writing-plans discipline — verify canonical spec matches my schema proposals before any code is written.

**Files:**
- Read: `/root/_review/ml_brain/ml_brain_canonic.txt` (7580 lines, canonical PDF source)
- Read: `/root/.claude/projects/-root/memory/project_ml_architecture_frozen.md`
- Read: `/root/.claude/projects/-root/memory/project_ml_v3_expert_acceptance_and_ux_scope_20260514.md`

**Specific sections to grep (in canonical):**

```bash
# Find R0 substrate spec section
grep -n -i "substrate\|R0\|ring 0\|disaster recovery\|opsec\|time integrity" /root/_review/ml_brain/ml_brain_canonic.txt | head -50

# Find DB schema spec (10 tables)
grep -n -i "feature_runtime_state\|feature_audit_log\|feature_proposals\|attribution_events\|ml_decision_snapshots\|ml_decision_light\|feature_global_overrides" /root/_review/ml_brain/ml_brain_canonic.txt | head -30

# Find migration flags spec
grep -n -i "ML_INGEST_ENABLED\|ML_PIPELINE_SHADOW\|ML_DEMO_INFLUENCE\|ML_TESTNET_INFLUENCE\|ML_LIVE_INFLUENCE" /root/_review/ml_brain/ml_brain_canonic.txt | head -20
```

- [ ] **Step 1:** Grep canonical for R0 substrate sections; document any divergence from frozen memory
- [ ] **Step 2:** Grep canonical for 10 DB tables; verify schemas match memory
- [ ] **Step 3:** Grep canonical for migration flags; verify 9 flags match memory
- [ ] **Step 4:** Document findings — if NO DIVERGENCE → proceed with plan as-is. If DIVERGENCE → flag operator per Rule 22, await direction.

**Expected output:** Single comment-only commit OR proceed verbal "spec verified, no divergence — proceeding with Task 2".

**Commit message (if findings recorded as doc):**
```
docs(omega): Wave 1A spec verification notes (no code)
```

---

### Task 2: Create directory scaffolding

**Files to create:**
- `server/services/ml/R-1_testHarness/.gitkeep`
- `server/services/ml/R0_substrate/.gitkeep`
- `server/services/ml/R1_constitution/.gitkeep`
- `server/services/ml/R2_brain/.gitkeep`
- `server/services/ml/R3A_safety/.gitkeep`
- `server/services/ml/R3B_validation/.gitkeep`
- `server/services/ml/R4_execution/.gitkeep`
- `server/services/ml/R5A_learning/.gitkeep`
- `server/services/ml/R5B_governance/.gitkeep`
- `server/services/ml/R6_shadowMeta/.gitkeep`
- `server/services/ml/R7_communication/.gitkeep`
- `server/services/ml/_audit/.gitkeep`
- `server/services/ml/_voice/.gitkeep`
- `server/services/ml/_operator/.gitkeep`
- `server/services/ml/README.md` (architecture overview)

**Test file to create:**
- `tests/unit/ml/omegaScaffolding.test.js`

- [ ] **Step 1: Write failing test first**

Create `tests/unit/ml/omegaScaffolding.test.js`:

```javascript
const fs = require('fs');
const path = require('path');

const ML_ROOT = path.join(__dirname, '..', '..', '..', 'server', 'services', 'ml');

const REQUIRED_DIRS = [
    'R-1_testHarness',
    'R0_substrate',
    'R1_constitution',
    'R2_brain',
    'R3A_safety',
    'R3B_validation',
    'R4_execution',
    'R5A_learning',
    'R5B_governance',
    'R6_shadowMeta',
    'R7_communication',
    '_audit',
    '_voice',
    '_operator',
];

describe('OMEGA Wave 1A — Scaffolding', () => {
    test('server/services/ml/ directory exists', () => {
        expect(fs.existsSync(ML_ROOT)).toBe(true);
        expect(fs.statSync(ML_ROOT).isDirectory()).toBe(true);
    });

    test.each(REQUIRED_DIRS)('subdirectory %s exists', (dirName) => {
        const dirPath = path.join(ML_ROOT, dirName);
        expect(fs.existsSync(dirPath)).toBe(true);
        expect(fs.statSync(dirPath).isDirectory()).toBe(true);
    });

    test('README.md exists with architecture overview', () => {
        const readmePath = path.join(ML_ROOT, 'README.md');
        expect(fs.existsSync(readmePath)).toBe(true);
        const content = fs.readFileSync(readmePath, 'utf8');
        expect(content).toContain('OMEGA');
        expect(content).toContain('9-ring');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /root/zeus-terminal && npx jest tests/unit/ml/omegaScaffolding.test.js
```

Expected: FAIL with "ENOENT: no such file or directory" for `server/services/ml`.

- [ ] **Step 3: Create directory tree + .gitkeep files**

```bash
cd /root/zeus-terminal && mkdir -p \
  server/services/ml/R-1_testHarness \
  server/services/ml/R0_substrate \
  server/services/ml/R1_constitution \
  server/services/ml/R2_brain \
  server/services/ml/R3A_safety \
  server/services/ml/R3B_validation \
  server/services/ml/R4_execution \
  server/services/ml/R5A_learning \
  server/services/ml/R5B_governance \
  server/services/ml/R6_shadowMeta \
  server/services/ml/R7_communication \
  server/services/ml/_audit \
  server/services/ml/_voice \
  server/services/ml/_operator

# Add .gitkeep to each so git tracks empty dirs
for d in server/services/ml/*/; do touch "$d.gitkeep"; done
```

- [ ] **Step 4: Create README.md**

Content for `server/services/ml/README.md`:

```markdown
# OMEGA — ML Brain Pro

**Codename:** OMEGA (Ω)
**Status:** Wave 1A in progress (directory scaffolding)
**Started:** 2026-05-14
**Spec:** Plan v3 (51 entries + 9-ring + 5 cross-cutting)

## 9-Ring Architecture

| Ring | Role |
|---|---|
| R-1 | Test Harness (mocks, replay, property, chaos) |
| R0  | Substrate (time, opsec, DR, snapshots) |
| R1  | Constitution (authority, sacred zones, opsec) |
| R2  | Brain Detectors (regime, liquidity, orderflow, structure, sentiment) |
| R3A | Safety Guards (black swan, DD, CB multi) |
| R3B | Validation (conformal, OOD, evidence sufficiency) |
| R4  | Execution (exactly-once, exposure, intent ledger) |
| R5A | Learning Core (Thompson bandit, attribution, drift, calibration) |
| R5B | Governance (auto-quarantine, auto-resume, tiered promotion, pre-registration) |
| R6  | Shadow/Meta (A/B, counterfactual, self-improvement) |
| R7  | Inter-Ring Communication (event bus, lifecycle, tracer) |

## 5 Cross-Cutting Concerns

| Dir | Concern |
|---|---|
| `_audit/`       | Audit Trail (every decision loggable + replay-able) |
| `_voice/`       | The Voice Layer (OMEGA personality, mood, thoughts) |
| `_operator/`    | Operator Interaction Layer (approval queue, signature, cooldown) |
| `R7_communication/` | Inter-ring event bus (NOT a cross-cutting dir, but R7 ring) |

## Constraints absolute

- Server-only ML execution
- Per-user × per-env × per-symbol isolation
- Frontend = read-model only (WS push + REST admin)
- Wrap NOT rewrite existing Phase 2 services
- Phase 1 brainLogger fix separate (not in Wave 1)
- TDD strict per module
- 10 DB tables additive only (no ALTER)
- All migration flags default OFF

## Roadmap

8 waves, ~16-18 weeks, 300 points (255 spec + 45 Claude extras).
See `/root/.claude/projects/-root/memory/project_ml_v3_expert_acceptance_and_ux_scope_20260514.md` for full breakdown.

## Current Wave: 1A (DB Schema + Scaffolding)

See `/root/zeus-terminal/docs/superpowers/plans/2026-05-14-omega-wave-1a-db-schema-and-scaffolding.md`.
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /root/zeus-terminal && npx jest tests/unit/ml/omegaScaffolding.test.js
```

Expected: PASS (15+ tests green: root dir + 14 subdirs + README.md).

- [ ] **Step 6: Commit**

```bash
git add server/services/ml tests/unit/ml/omegaScaffolding.test.js
git commit -m "feat(omega): Wave 1A scaffolding — 9-ring + 5 cross-cutting directory tree

- Create server/services/ml/{R-1..R7,_audit,_voice,_operator}/ tree
- Add .gitkeep per dir for git tracking
- Add README.md with architecture overview
- TDD: omegaScaffolding.test.js (15 tests, all GREEN)
- Zero behavioral change, pure additive scaffolding

Plan: docs/superpowers/plans/2026-05-14-omega-wave-1a-db-schema-and-scaffolding.md"
```

---

### Task 3: Migration 032 — `ml_runtime_features` (R5A bandit state)

Per spec frozen + memory: this is the per-(user, env, symbol, feature_id) runtime state table. Replaces older `feature_runtime_state` naming with explicit `ml_` prefix for namespace clarity.

**Files:**
- Modify: `server/services/database.js` (append new `migrate('032_ml_runtime_features', ...)` block)
- Test: `tests/unit/ml/omegaMigrations.test.js` (create)

- [ ] **Step 1: Write failing test first**

Create `tests/unit/ml/omegaMigrations.test.js`:

```javascript
const path = require('path');
const fs = require('fs');

// Use in-memory test DB to avoid touching production data/zeus.db
const Database = require('better-sqlite3');

describe('OMEGA Wave 1A — DB Migrations', () => {
    let db;

    beforeAll(() => {
        // Open test DB, replay the production migrations including new ones
        const testDbPath = ':memory:';
        db = new Database(testDbPath);
        // Reuse migration runner from production module — pure logic
        const { _runAllMigrations } = require('../../../server/services/database.js');
        _runAllMigrations(db);
    });

    afterAll(() => { db.close(); });

    describe('Migration 032 — ml_runtime_features', () => {
        test('table exists', () => {
            const row = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='ml_runtime_features'"
            ).get();
            expect(row).toBeDefined();
            expect(row.name).toBe('ml_runtime_features');
        });

        test('has expected columns', () => {
            const cols = db.prepare("PRAGMA table_info(ml_runtime_features)").all();
            const colNames = cols.map(c => c.name);
            expect(colNames).toEqual(expect.arrayContaining([
                'id', 'user_id', 'resolved_env', 'symbol', 'feature_id',
                'effective_weight', 'sample_count', 'success_count',
                'last_updated_at', 'created_at',
                'status', 'evidence_json'
            ]));
        });

        test('PRIMARY KEY is (user_id, resolved_env, symbol, feature_id)', () => {
            const idxList = db.prepare(
                "PRAGMA index_list(ml_runtime_features)"
            ).all();
            const pk = idxList.find(i => i.origin === 'pk');
            expect(pk).toBeDefined();
            const pkCols = db.prepare(`PRAGMA index_info(${pk.name})`).all();
            const pkNames = pkCols.map(c => c.name);
            expect(pkNames).toEqual(['user_id', 'resolved_env', 'symbol', 'feature_id']);
        });

        test('resolved_env CHECK constraint enforces DEMO/TESTNET/REAL', () => {
            expect(() => {
                db.prepare(`INSERT INTO ml_runtime_features
                    (user_id, resolved_env, symbol, feature_id, status, created_at, last_updated_at)
                    VALUES (1, 'INVALID', 'BTCUSDT', 'test_feat', 'ACTIVE', 0, 0)
                `).run();
            }).toThrow(/CHECK constraint/);
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /root/zeus-terminal && npx jest tests/unit/ml/omegaMigrations.test.js -t "Migration 032"
```

Expected: FAIL — table doesn't exist OR `_runAllMigrations` not exported yet.

- [ ] **Step 3: First, expose `_runAllMigrations` from database.js**

In `server/services/database.js`, near the bottom where migrations are run, expose internal runner for tests:

```javascript
// Existing migration sequence ends with line like: migrate('031_dsl_parity_log', ...)
// Just before module.exports section, add:

function _runAllMigrations(targetDb) {
    // Re-run all migrate() blocks on a different DB (used by tests)
    // Implementation: refactor existing migrate() to accept optional db param
    // OR copy the migration calls into this function for test use
    // ...
}

module.exports = {
    // existing exports
    _runAllMigrations,  // test-only
};
```

**NOTE:** This refactor may require touching the migrate() framework wrapper. Per Rule 5 (Surgical patches) — if existing migration framework already supports passing DB instance, just expose it. If not, add a minimal `_runAllMigrations` that calls the same SQL.

- [ ] **Step 4: Add migration 032 to database.js**

Append to the migration sequence (after `migrate('031_dsl_parity_log', ...)` block):

```javascript
// [OMEGA Wave 1A 2026-05-14] R5A Learning Core — bandit runtime state per
// (user, env, symbol, feature_id). Per Cornercase A (hybrid pooling) writes
// strict per-cell. Spec frozen: project_ml_architecture_frozen.md table list.
migrate('032_ml_runtime_features', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_runtime_features (
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol            TEXT NOT NULL,
            feature_id        TEXT NOT NULL,
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            effective_weight  REAL NOT NULL DEFAULT 0.0,
            sample_count      INTEGER NOT NULL DEFAULT 0,
            success_count     INTEGER NOT NULL DEFAULT 0,
            status            TEXT NOT NULL DEFAULT 'ACTIVE'
                              CHECK(status IN ('ACTIVE','QUARANTINED','RETIRED','SHADOW','PROPOSED')),
            evidence_json     TEXT,
            last_updated_at   INTEGER NOT NULL,
            created_at        INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, symbol, feature_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mlrf_user_env_sym
            ON ml_runtime_features(user_id, resolved_env, symbol);
        CREATE INDEX IF NOT EXISTS idx_mlrf_status_env
            ON ml_runtime_features(status, resolved_env);
    `);
});
```

**Schema decisions documented inline:**
- `id` is INTEGER PRIMARY KEY AUTOINCREMENT for internal references; uniqueness enforced by `UNIQUE` constraint on the composite key
- `status` CHECK list per Cornercase C (RETIRED preserved, not deleted)
- `evidence_json` stores `source_scope` per Cornercase A

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /root/zeus-terminal && npx jest tests/unit/ml/omegaMigrations.test.js -t "Migration 032"
```

Expected: PASS (4 tests for migration 032).

- [ ] **Step 6: Commit**

```bash
git add server/services/database.js tests/unit/ml/omegaMigrations.test.js
git commit -m "feat(omega): migration 032 ml_runtime_features (R5A bandit state)

- Per-(user, env, symbol, feature_id) runtime state per Cornercase A
- status CHECK enforces ACTIVE/QUARANTINED/RETIRED/SHADOW/PROPOSED (Cornercase C)
- resolved_env CHECK enforces DEMO/TESTNET/REAL (invariant #3)
- evidence_json stores source_scope (USER_CELL/ENV_SYMBOL_POOL/SYMBOL_POOL/GLOBAL_POOL)
- TDD: 4 tests in omegaMigrations.test.js GREEN

Plan: docs/superpowers/plans/2026-05-14-omega-wave-1a-db-schema-and-scaffolding.md (Task 3)"
```

---

### Task 4: Migration 033 — `ml_feature_audit_log` (R5A feature audit)

Per-feature state change history. Append-only.

**Files:**
- Modify: `server/services/database.js`
- Test: `tests/unit/ml/omegaMigrations.test.js` (add new describe block)

- [ ] **Step 1: Write failing test**

Add to `omegaMigrations.test.js`:

```javascript
describe('Migration 033 — ml_feature_audit_log', () => {
    test('table exists with append-only schema', () => {
        const row = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='ml_feature_audit_log'"
        ).get();
        expect(row).toBeDefined();
    });

    test('has expected columns', () => {
        const cols = db.prepare("PRAGMA table_info(ml_feature_audit_log)").all();
        const colNames = cols.map(c => c.name);
        expect(colNames).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'symbol', 'feature_id',
            'event_type', 'old_value_json', 'new_value_json',
            'actor', 'reason', 'created_at'
        ]));
    });

    test('event_type CHECK enforces enum', () => {
        expect(() => {
            db.prepare(`INSERT INTO ml_feature_audit_log
                (user_id, resolved_env, symbol, feature_id, event_type, actor, created_at)
                VALUES (1, 'DEMO', 'BTCUSDT', 'test', 'INVALID_EVENT', 'system', 0)
            `).run();
        }).toThrow(/CHECK constraint/);
    });
});
```

- [ ] **Step 2: Run test (expect fail)**

```bash
cd /root/zeus-terminal && npx jest tests/unit/ml/omegaMigrations.test.js -t "Migration 033"
```

Expected: FAIL (table doesn't exist).

- [ ] **Step 3: Add migration 033**

Append to `database.js`:

```javascript
// [OMEGA Wave 1A 2026-05-14] R5A feature audit log — append-only history of
// state changes per feature. Cornercase B reference: status transitions logged.
migrate('033_ml_feature_audit_log', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_feature_audit_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol          TEXT NOT NULL,
            feature_id      TEXT NOT NULL,
            event_type      TEXT NOT NULL CHECK(event_type IN (
                'PROPOSED','PROMOTED','DEMOTED','QUARANTINED','UNQUARANTINED',
                'RETIRED','WEIGHT_UPDATED','SAMPLE_INCREMENTED'
            )),
            old_value_json  TEXT,
            new_value_json  TEXT,
            actor           TEXT NOT NULL,
            reason          TEXT,
            created_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlfal_feature_ts
            ON ml_feature_audit_log(user_id, resolved_env, symbol, feature_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_mlfal_event_ts
            ON ml_feature_audit_log(event_type, created_at);
    `);
});
```

- [ ] **Step 4: Run test (expect pass)**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/database.js tests/unit/ml/omegaMigrations.test.js
git commit -m "feat(omega): migration 033 ml_feature_audit_log (R5A append-only history)

- Per-feature state transitions logged with actor + reason
- event_type CHECK: PROPOSED/PROMOTED/DEMOTED/QUARANTINED/etc
- 2 indexes for feature lookup + event-type queries
- TDD: 3 new tests GREEN"
```

---

### Task 5: Migration 034 — `ml_feature_proposals` (R5A bandit proposals)

Pending bandit proposals — output of Thompson Sampling, awaiting auto-apply (MINOR + 252* gate) or operator approval (MAJOR/CRITICAL).

**Files:**
- Modify: `server/services/database.js`
- Test: `tests/unit/ml/omegaMigrations.test.js`

- [ ] **Step 1: Write failing test**

```javascript
describe('Migration 034 — ml_feature_proposals', () => {
    test('table exists', () => {
        const row = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='ml_feature_proposals'"
        ).get();
        expect(row).toBeDefined();
    });

    test('has columns including proposal lifecycle', () => {
        const cols = db.prepare("PRAGMA table_info(ml_feature_proposals)").all();
        const colNames = cols.map(c => c.name);
        expect(colNames).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'symbol', 'feature_id',
            'proposed_weight', 'current_weight', 'delta_class',
            'evidence_json', 'state', 'decided_at', 'decided_by',
            'created_at'
        ]));
    });

    test('delta_class CHECK enforces MINOR/MAJOR/CRITICAL', () => {
        expect(() => {
            db.prepare(`INSERT INTO ml_feature_proposals
                (user_id, resolved_env, symbol, feature_id, proposed_weight, delta_class, state, created_at)
                VALUES (1, 'DEMO', 'BTC', 'test', 0.5, 'GIGANTIC', 'PENDING', 0)
            `).run();
        }).toThrow(/CHECK constraint/);
    });

    test('state CHECK enforces PENDING/APPLIED/REJECTED/EXPIRED', () => {
        expect(() => {
            db.prepare(`INSERT INTO ml_feature_proposals
                (user_id, resolved_env, symbol, feature_id, proposed_weight, delta_class, state, created_at)
                VALUES (1, 'DEMO', 'BTC', 'test', 0.5, 'MINOR', 'INVALID', 0)
            `).run();
        }).toThrow(/CHECK constraint/);
    });
});
```

- [ ] **Step 2: Run test (expect fail)**
- [ ] **Step 3: Add migration**

```javascript
// [OMEGA Wave 1A 2026-05-14] R5A bandit proposals — Thompson sampling output
// awaiting auto-apply (MINOR + 252*) or operator approval (MAJOR/CRITICAL).
migrate('034_ml_feature_proposals', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_feature_proposals (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol            TEXT NOT NULL,
            feature_id        TEXT NOT NULL,
            proposed_weight   REAL NOT NULL,
            current_weight    REAL,
            delta_class       TEXT NOT NULL CHECK(delta_class IN ('MINOR','MAJOR','CRITICAL')),
            evidence_json     TEXT,
            state             TEXT NOT NULL DEFAULT 'PENDING'
                              CHECK(state IN ('PENDING','APPLIED','REJECTED','EXPIRED')),
            decided_at        INTEGER,
            decided_by        TEXT,
            created_at        INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlfp_state_created
            ON ml_feature_proposals(state, created_at);
        CREATE INDEX IF NOT EXISTS idx_mlfp_user_env_pending
            ON ml_feature_proposals(user_id, resolved_env, state) WHERE state = 'PENDING';
    `);
});
```

- [ ] **Step 4: Run test (expect pass)**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(omega): migration 034 ml_feature_proposals (R5A bandit output queue)

- delta_class MINOR/MAJOR/CRITICAL per spec point 252*
- state lifecycle PENDING/APPLIED/REJECTED/EXPIRED
- Partial index on PENDING for fast operator queue queries
- TDD: 4 tests GREEN"
```

---

### Task 6: Migration 035 — `ml_feature_global_overrides` (R5B Cornercase B)

Per Cornercase B (DB override resolver). 7-layer resolver foundation: CHARTER → GLOBAL → RESOLVED_ENV → SYMBOL → ENV_SYMBOL → per-cell → registry default.

**Files:** same pattern as previous.

- [ ] **Step 1: Write failing test**

```javascript
describe('Migration 035 — ml_feature_global_overrides', () => {
    test('table exists', () => {
        const row = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='ml_feature_global_overrides'"
        ).get();
        expect(row).toBeDefined();
    });

    test('scope CHECK enforces 4-layer hierarchy', () => {
        expect(() => {
            db.prepare(`INSERT INTO ml_feature_global_overrides
                (scope, scope_key, feature_id, override_status, reason, created_by, created_at)
                VALUES ('INVALID_SCOPE', 'x', 'test', 'QUARANTINED', 'test', 'admin', 0)
            `).run();
        }).toThrow(/CHECK constraint/);
    });

    test('insert with valid scope GLOBAL works', () => {
        const result = db.prepare(`INSERT INTO ml_feature_global_overrides
            (scope, scope_key, feature_id, override_status, reason, created_by, created_at)
            VALUES ('GLOBAL', '*', 'test_global_feat', 'QUARANTINED', 'broken signal', 'system', 1)
        `).run();
        expect(result.changes).toBe(1);
    });
});
```

- [ ] **Step 2: Run test (expect fail)**
- [ ] **Step 3: Add migration**

```javascript
// [OMEGA Wave 1A 2026-05-14] R5B Cornercase B — global override resolver table.
// Resolver order: CHARTER → GLOBAL → RESOLVED_ENV → SYMBOL → ENV_SYMBOL
// → per-cell runtime_state → registry default. Zero cascade writes (40K+ cells safe).
migrate('035_ml_feature_global_overrides', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_feature_global_overrides (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            scope             TEXT NOT NULL CHECK(scope IN (
                'CHARTER','GLOBAL','RESOLVED_ENV','SYMBOL','ENV_SYMBOL'
            )),
            scope_key         TEXT NOT NULL,
            feature_id        TEXT NOT NULL,
            override_status   TEXT NOT NULL CHECK(override_status IN (
                'QUARANTINED','RETIRED','BLOCKED','FORCED_ACTIVE'
            )),
            reason            TEXT NOT NULL,
            created_by        TEXT NOT NULL,
            created_at        INTEGER NOT NULL,
            expires_at        INTEGER,
            UNIQUE(scope, scope_key, feature_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mlfgo_resolver
            ON ml_feature_global_overrides(scope, feature_id);
    `);
});
```

- [ ] **Step 4: Run test (expect pass)**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(omega): migration 035 ml_feature_global_overrides (R5B Cornercase B)

- 5-scope hierarchy: CHARTER/GLOBAL/RESOLVED_ENV/SYMBOL/ENV_SYMBOL
- override_status: QUARANTINED/RETIRED/BLOCKED/FORCED_ACTIVE
- UNIQUE constraint prevents duplicate overrides at same scope
- Foundation for 7-layer effectiveStatus resolver per Cornercase B
- TDD: 3 tests GREEN"
```

---

### Task 7: Migration 036 — `ml_decision_snapshots` (Cross-cutting TIER 1)

Per Cornercase D: full snapshots stored only for TRADE / ABSTAIN_CRITIC / NEAR_THRESHOLD / OPERATOR_OVERRIDE / QUARANTINE_TRIGGER / PROMOTION_TRIGGER / ANOMALY_DRIFT events. NO_TRADE normal → light summary in table 037.

**Files:** same pattern.

- [ ] **Step 1: Write failing test**

```javascript
describe('Migration 036 — ml_decision_snapshots', () => {
    test('table exists', () => {
        const row = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='ml_decision_snapshots'"
        ).get();
        expect(row).toBeDefined();
    });

    test('snapshot_event_type CHECK enforces TIER 1 enum', () => {
        expect(() => {
            db.prepare(`INSERT INTO ml_decision_snapshots
                (user_id, resolved_env, symbol, snapshot_event_type, snapshot_json, decision_digest, created_at)
                VALUES (1, 'DEMO', 'BTC', 'INVALID', '{}', 'abc', 0)
            `).run();
        }).toThrow(/CHECK constraint/);
    });

    test('decision_digest is required (replay determinism)', () => {
        const cols = db.prepare("PRAGMA table_info(ml_decision_snapshots)").all();
        const digestCol = cols.find(c => c.name === 'decision_digest');
        expect(digestCol).toBeDefined();
        expect(digestCol.notnull).toBe(1);
    });
});
```

- [ ] **Step 2: Run test (expect fail)**
- [ ] **Step 3: Add migration**

```javascript
// [OMEGA Wave 1A 2026-05-14] Cross-cutting TIER 1 — full decision snapshots
// per Cornercase D. Retention 30 days. Spec invariant #6: replay determinism
// via decision_digest + snapshot_json.
migrate('036_ml_decision_snapshots', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_decision_snapshots (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol                   TEXT NOT NULL,
            snapshot_event_type      TEXT NOT NULL CHECK(snapshot_event_type IN (
                'TRADE','ABSTAIN_CRITIC','NEAR_THRESHOLD','OPERATOR_OVERRIDE',
                'QUARANTINE_TRIGGER','PROMOTION_TRIGGER','ANOMALY_DRIFT'
            )),
            decision_digest          TEXT NOT NULL,
            snapshot_json            TEXT NOT NULL,
            registry_digest          TEXT NOT NULL,
            input_snapshot_ref       TEXT,
            created_at               INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlds_user_env_ts
            ON ml_decision_snapshots(user_id, resolved_env, created_at);
        CREATE INDEX IF NOT EXISTS idx_mlds_digest
            ON ml_decision_snapshots(decision_digest);
        CREATE INDEX IF NOT EXISTS idx_mlds_event_ts
            ON ml_decision_snapshots(snapshot_event_type, created_at);
    `);
});
```

- [ ] **Step 4: Run test (expect pass)**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(omega): migration 036 ml_decision_snapshots (TIER 1 cross-cutting)

- Cornercase D: full snapshots ONLY for 7 event types (TRADE/ABSTAIN_CRITIC/etc)
- decision_digest NOT NULL (replay determinism invariant #6)
- 3 indexes: user+env+ts, digest lookup, event-type queries
- NO_TRADE normal events go to ml_decision_light (Task 8)
- TDD: 3 tests GREEN"
```

---

### Task 8: Migration 037 — `ml_decision_light` (Cross-cutting light summary)

Per Cornercase D: NO_TRADE normal events stored as light summary, 90-day retention.

- [ ] **Step 1: Write failing test**

```javascript
describe('Migration 037 — ml_decision_light', () => {
    test('table exists', () => {
        const row = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='ml_decision_light'"
        ).get();
        expect(row).toBeDefined();
    });

    test('has minimal column set for light summary', () => {
        const cols = db.prepare("PRAGMA table_info(ml_decision_light)").all();
        const colNames = cols.map(c => c.name);
        expect(colNames).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'symbol',
            'decision_digest', 'score', 'top5_features_json',
            'abstain_count', 'reason_code', 'created_at'
        ]));
    });
});
```

- [ ] **Step 2: Run test (expect fail)**
- [ ] **Step 3: Add migration**

```javascript
// [OMEGA Wave 1A 2026-05-14] Cross-cutting light — NO_TRADE summary per
// Cornercase D. Retention 90 days. Compact row for billions/year scale.
migrate('037_ml_decision_light', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_decision_light (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol              TEXT NOT NULL,
            decision_digest     TEXT NOT NULL,
            score               REAL,
            top5_features_json  TEXT,
            abstain_count       INTEGER NOT NULL DEFAULT 0,
            reason_code         TEXT,
            created_at          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mldl_user_env_ts
            ON ml_decision_light(user_id, resolved_env, created_at);
    `);
});
```

- [ ] **Step 4: Run test (expect pass)**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(omega): migration 037 ml_decision_light (90-day NO_TRADE summary)

- Compact summary for normal decisions per Cornercase D
- Minimal columns: digest, score, top5 features, abstain count, reason
- TDD: 2 tests GREEN"
```

---

### Task 9: Migration 038 — `ml_attribution_events` (R5A post-trade learning)

Post-trade attribution: ties decision_digest to outcome (PnL, R-multiple, drawdown contribution).

- [ ] **Step 1: Write failing test**

```javascript
describe('Migration 038 — ml_attribution_events', () => {
    test('table exists', () => {
        const row = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='ml_attribution_events'"
        ).get();
        expect(row).toBeDefined();
    });

    test('has columns for attribution closure', () => {
        const cols = db.prepare("PRAGMA table_info(ml_attribution_events)").all();
        const colNames = cols.map(c => c.name);
        expect(colNames).toEqual(expect.arrayContaining([
            'id', 'decision_digest', 'user_id', 'resolved_env', 'symbol',
            'pos_id', 'outcome_class', 'r_multiple', 'pnl_pct',
            'operator_feedback', 'attributed_at'
        ]));
    });

    test('outcome_class CHECK enforces enum', () => {
        expect(() => {
            db.prepare(`INSERT INTO ml_attribution_events
                (decision_digest, user_id, resolved_env, symbol, outcome_class, attributed_at)
                VALUES ('abc', 1, 'DEMO', 'BTC', 'INVALID', 0)
            `).run();
        }).toThrow(/CHECK constraint/);
    });
});
```

- [ ] **Step 2: Run test (expect fail)**
- [ ] **Step 3: Add migration**

```javascript
// [OMEGA Wave 1A 2026-05-14] R5A attribution — close-of-trade outcomes wired
// back to decision_digest for bandit learning loop. operator_feedback per
// Rule 22-derived FEEDBACK-N1 (operator thumb up/down ground truth).
migrate('038_ml_attribution_events', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_attribution_events (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            decision_digest      TEXT NOT NULL,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol               TEXT NOT NULL,
            pos_id               TEXT,
            outcome_class        TEXT NOT NULL CHECK(outcome_class IN (
                'WIN','LOSS','BREAKEVEN','TIMEOUT','MANUAL_CLOSE','ABSTAIN_CORRECT','ABSTAIN_WRONG'
            )),
            r_multiple           REAL,
            pnl_pct              REAL,
            operator_feedback    INTEGER,
            attributed_at        INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlae_digest
            ON ml_attribution_events(decision_digest);
        CREATE INDEX IF NOT EXISTS idx_mlae_user_env_ts
            ON ml_attribution_events(user_id, resolved_env, attributed_at);
    `);
});
```

`operator_feedback` is INTEGER: NULL = no feedback yet, 1 = thumb up, -1 = thumb down, 0 = neutral.

- [ ] **Step 4: Run test (expect pass)**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(omega): migration 038 ml_attribution_events (R5A bandit loop closure)

- decision_digest → outcome wired (WIN/LOSS/BREAKEVEN/TIMEOUT/MANUAL_CLOSE/ABSTAIN_CORRECT/ABSTAIN_WRONG)
- operator_feedback INTEGER: 1=👍 / -1=👎 / 0=neutral / NULL=pending (Rule 22 derivative FEEDBACK-N1)
- 2 indexes: digest lookup + user+env+ts queries
- TDD: 3 tests GREEN"
```

---

### Task 10: Migration 039 — `ml_voice_log` (Voice Layer NEW)

Every Omega utterance — text + mood + delivery channel. Powers the "history/replay" feature (A-Z raid item H).

- [ ] **Step 1: Write failing test**

```javascript
describe('Migration 039 — ml_voice_log', () => {
    test('table exists', () => {
        const row = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='ml_voice_log'"
        ).get();
        expect(row).toBeDefined();
    });

    test('has columns for Voice Layer audit', () => {
        const cols = db.prepare("PRAGMA table_info(ml_voice_log)").all();
        const colNames = cols.map(c => c.name);
        expect(colNames).toEqual(expect.arrayContaining([
            'id', 'user_id', 'utterance_type', 'mood',
            'text', 'template_id', 'context_json', 'created_at'
        ]));
    });

    test('mood CHECK enforces mood enum', () => {
        expect(() => {
            db.prepare(`INSERT INTO ml_voice_log
                (user_id, utterance_type, mood, text, created_at)
                VALUES (1, 'THOUGHT', 'INVALID_MOOD', 'hello', 0)
            `).run();
        }).toThrow(/CHECK constraint/);
    });
});
```

- [ ] **Step 2: Run test (expect fail)**
- [ ] **Step 3: Add migration**

```javascript
// [OMEGA Wave 1A 2026-05-14] Voice Layer — every Ω utterance logged for
// replay + history. Powers A-Z raid item H (history/replay). NU storing
// audio — only text + mood + context. TTS happens client-side.
migrate('039_ml_voice_log', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_voice_log (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            utterance_type    TEXT NOT NULL CHECK(utterance_type IN (
                'THOUGHT','CHAT_REPLY','GREETING','FAREWELL','CRITICAL_ALERT','REACTION'
            )),
            mood              TEXT NOT NULL CHECK(mood IN (
                'CALM','FOCUSED','EXCITED','NERVOUS','ANGRY','SAD','BORED'
            )),
            text              TEXT NOT NULL,
            template_id       TEXT,
            context_json      TEXT,
            decision_digest   TEXT,
            created_at        INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlvl_user_ts
            ON ml_voice_log(user_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_mlvl_type_mood
            ON ml_voice_log(utterance_type, mood);
    `);
});
```

- [ ] **Step 4: Run test (expect pass)**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(omega): migration 039 ml_voice_log (Voice Layer storage)

- Every Ω utterance: THOUGHT/CHAT_REPLY/GREETING/FAREWELL/CRITICAL_ALERT/REACTION
- 7 moods: CALM/FOCUSED/EXCITED/NERVOUS/ANGRY/SAD/BORED
- decision_digest links utterance to triggering decision (replay)
- template_id stores which voice pattern was used
- TDD: 3 tests GREEN"
```

---

### Task 11: Migration 040 — `ml_operator_approval` (Operator Interaction Layer)

Approval queue for MAJOR/CRITICAL decisions per Tiered Authority (spec 252*).

- [ ] **Step 1: Write failing test**

```javascript
describe('Migration 040 — ml_operator_approval', () => {
    test('table exists', () => {
        const row = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='ml_operator_approval'"
        ).get();
        expect(row).toBeDefined();
    });

    test('has approval workflow columns', () => {
        const cols = db.prepare("PRAGMA table_info(ml_operator_approval)").all();
        const colNames = cols.map(c => c.name);
        expect(colNames).toEqual(expect.arrayContaining([
            'id', 'user_id', 'request_type', 'request_payload_json',
            'tier', 'queue_state', 'cooldown_until',
            'requested_at', 'decided_at', 'decided_by', 'decision'
        ]));
    });

    test('tier CHECK enforces MINOR/MAJOR/CRITICAL', () => {
        expect(() => {
            db.prepare(`INSERT INTO ml_operator_approval
                (user_id, request_type, request_payload_json, tier, queue_state, requested_at)
                VALUES (1, 'PROMOTION', '{}', 'INVALID', 'PENDING', 0)
            `).run();
        }).toThrow(/CHECK constraint/);
    });
});
```

- [ ] **Step 2: Run test (expect fail)**
- [ ] **Step 3: Add migration**

```javascript
// [OMEGA Wave 1A 2026-05-14] Operator Interaction Layer — approval queue
// for MAJOR/CRITICAL changes per spec 252* tiered authority. CRITICAL =
// 24h cooldown_until enforced before decision applies.
migrate('040_ml_operator_approval', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_operator_approval (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            request_type             TEXT NOT NULL CHECK(request_type IN (
                'PROMOTION','DEMOTION','QUARANTINE','RESUME','CHARTER_CHANGE',
                'OVERRIDE_ADD','OVERRIDE_REMOVE','EMERGENCY_HALT','RESUME_FROM_HALT'
            )),
            request_payload_json     TEXT NOT NULL,
            tier                     TEXT NOT NULL CHECK(tier IN ('MINOR','MAJOR','CRITICAL')),
            queue_state              TEXT NOT NULL DEFAULT 'PENDING'
                                     CHECK(queue_state IN ('PENDING','APPROVED','REJECTED','EXPIRED','APPLIED')),
            cooldown_until           INTEGER,
            requested_at             INTEGER NOT NULL,
            decided_at               INTEGER,
            decided_by               TEXT,
            decision                 TEXT,
            signature                TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_mloa_user_state
            ON ml_operator_approval(user_id, queue_state);
        CREATE INDEX IF NOT EXISTS idx_mloa_tier_state
            ON ml_operator_approval(tier, queue_state);
    `);
});
```

- [ ] **Step 4: Run test (expect pass)**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(omega): migration 040 ml_operator_approval (tiered authority queue)

- request_type: PROMOTION/DEMOTION/QUARANTINE/RESUME/CHARTER_CHANGE/etc
- tier: MINOR (auto)/MAJOR (operator)/CRITICAL (operator + 24h cooldown)
- queue_state: PENDING/APPROVED/REJECTED/EXPIRED/APPLIED
- signature column reserved for cryptographic operator approval (future)
- TDD: 3 tests GREEN"
```

---

### Task 12: Migration 041 — `ml_ring_health` (R7 communication)

Health check per ring — last reported state, error count, last error.

- [ ] **Step 1: Write failing test**

```javascript
describe('Migration 041 — ml_ring_health', () => {
    test('table exists', () => {
        const row = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='ml_ring_health'"
        ).get();
        expect(row).toBeDefined();
    });

    test('has health monitoring columns', () => {
        const cols = db.prepare("PRAGMA table_info(ml_ring_health)").all();
        const colNames = cols.map(c => c.name);
        expect(colNames).toEqual(expect.arrayContaining([
            'ring_id', 'state', 'last_heartbeat', 'error_count_1h',
            'last_error_text', 'last_error_at', 'updated_at'
        ]));
    });

    test('state CHECK enforces ring lifecycle states', () => {
        expect(() => {
            db.prepare(`INSERT INTO ml_ring_health
                (ring_id, state, last_heartbeat, updated_at)
                VALUES ('R0', 'INVALID', 0, 0)
            `).run();
        }).toThrow(/CHECK constraint/);
    });
});
```

- [ ] **Step 2: Run test (expect fail)**
- [ ] **Step 3: Add migration**

```javascript
// [OMEGA Wave 1A 2026-05-14] R7 Communication — health check per ring.
// Single row per ring_id (PK), updated on heartbeat/error. R7 event bus
// gates degraded ring access; operator dashboard reads this for status.
migrate('041_ml_ring_health', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_ring_health (
            ring_id           TEXT PRIMARY KEY CHECK(ring_id IN (
                'R-1','R0','R1','R2','R3A','R3B','R4','R5A','R5B','R6','R7'
            )),
            state             TEXT NOT NULL CHECK(state IN (
                'OK','DEGRADED','OFFLINE','DISABLED','INITIALIZING'
            )),
            last_heartbeat    INTEGER NOT NULL,
            error_count_1h    INTEGER NOT NULL DEFAULT 0,
            last_error_text   TEXT,
            last_error_at     INTEGER,
            updated_at        INTEGER NOT NULL
        );
    `);
});
```

No index needed — PK lookup only.

- [ ] **Step 4: Run test (expect pass)**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(omega): migration 041 ml_ring_health (R7 inter-ring health)

- Single row per ring (PK on ring_id, 11 allowed values R-1..R7)
- state: OK/DEGRADED/OFFLINE/DISABLED/INITIALIZING
- error_count_1h sliding window for rate-based alarms
- TDD: 3 tests GREEN"
```

---

### Task 13: Migration 042 — `ml_quarantine_log` + Migration 043 — `ml_pre_registration`

These are the final 2 tables. Combined into single task for efficiency since both are simple log tables.

**Wait — count check:** We've added 032, 033, 034, 035, 036, 037, 038, 039, 040, 041 = **10 tables**. That matches spec. No need for 042-043.

**Decision:** Skip this task. The 10 tables specified are sufficient for Wave 1A. `ml_quarantine_log` and `ml_pre_registration` will be added in later waves when R5B is implemented (Wave 4).

This task is REMOVED from Wave 1A plan. Move to Task 14.

---

### Task 14: Add 9 migration flags to `server/migrationFlags.js`

Per spec frozen: `ML_INGEST_ENABLED`, `ML_PIPELINE_SHADOW`, `ML_DEMO_INFLUENCE_ENABLED`, `ML_TESTNET_INFLUENCE_ENABLED`, `ML_LIVE_INFLUENCE_ENABLED`, `ML_LIVE_OPTIN_REQUIRED`, `ML_BANDIT_AUTO_APPLY_MINOR`, `ML_HYBRID_POOLING_ENABLED`, `ML_OVERRIDE_RESOLVER_ENABLED`. All default OFF.

**Files:**
- Modify: `server/migrationFlags.js`
- Test: `tests/unit/ml/omegaFlags.test.js` (create)

- [ ] **Step 1: Write failing test first**

Create `tests/unit/ml/omegaFlags.test.js`:

```javascript
describe('OMEGA Wave 1A — Migration Flags', () => {
    let MF;

    beforeAll(() => {
        // Force module reload to get fresh state
        delete require.cache[require.resolve('../../../server/migrationFlags')];
        MF = require('../../../server/migrationFlags');
    });

    const EXPECTED_FLAGS = [
        'ML_INGEST_ENABLED',
        'ML_PIPELINE_SHADOW',
        'ML_DEMO_INFLUENCE_ENABLED',
        'ML_TESTNET_INFLUENCE_ENABLED',
        'ML_LIVE_INFLUENCE_ENABLED',
        'ML_LIVE_OPTIN_REQUIRED',
        'ML_BANDIT_AUTO_APPLY_MINOR',
        'ML_HYBRID_POOLING_ENABLED',
        'ML_OVERRIDE_RESOLVER_ENABLED',
    ];

    test.each(EXPECTED_FLAGS)('flag %s exists', (flagName) => {
        expect(MF).toHaveProperty(flagName);
    });

    test.each(EXPECTED_FLAGS)('flag %s defaults to false', (flagName) => {
        expect(MF[flagName]).toBe(false);
    });
});
```

- [ ] **Step 2: Run test (expect fail)**

```bash
cd /root/zeus-terminal && npx jest tests/unit/ml/omegaFlags.test.js
```

Expected: FAIL — flags don't exist.

- [ ] **Step 3: Backup migrationFlags.js then add flags**

```bash
cp server/migrationFlags.js server/migrationFlags.js.bak.pre-omega-wave-1a-20260514
```

Then add the 9 flag getters following existing pattern (each likely looks like a `get FLAG_NAME() { return ... }` property). Read first 50 lines of `migrationFlags.js` to confirm exact pattern:

```bash
head -60 server/migrationFlags.js
```

Then append the 9 new property getters per existing convention.

- [ ] **Step 4: Run test (expect pass)**
- [ ] **Step 5: Commit**

```bash
git add server/migrationFlags.js tests/unit/ml/omegaFlags.test.js
git commit -m "feat(omega): add 9 ML migration flags (default OFF, spec frozen)

- ML_INGEST_ENABLED — Stage 1 ingest activator
- ML_PIPELINE_SHADOW — shadow mode (no influence on trading)
- ML_DEMO_INFLUENCE_ENABLED — DEMO influence gate (post S6)
- ML_TESTNET_INFLUENCE_ENABLED — TESTNET influence gate (post S8)
- ML_LIVE_INFLUENCE_ENABLED — REAL influence gate (post S10/S11)
- ML_LIVE_OPTIN_REQUIRED — explicit per-user opt-in for REAL
- ML_BANDIT_AUTO_APPLY_MINOR — auto-apply MINOR proposals (252* gate)
- ML_HYBRID_POOLING_ENABLED — Cornercase A hybrid pooling
- ML_OVERRIDE_RESOLVER_ENABLED — Cornercase B effectiveStatus resolver

All default OFF. Backup: server/migrationFlags.js.bak.pre-omega-wave-1a-20260514
TDD: 18 tests GREEN (9 exist + 9 default false)"
```

---

### Task 15: Final smoke + PM2 reload + push branch

- [ ] **Step 1: Run full jest baseline**

```bash
cd /root/zeus-terminal && npx jest 2>&1 | tail -20
```

Expected: All existing tests + new Omega tests GREEN. No regressions.

- [ ] **Step 2: Verify migrations applied via live DB check**

```bash
cd /root/zeus-terminal && sqlite3 data/zeus.db \
  "SELECT name FROM _migrations WHERE name LIKE '03_ml%' OR name LIKE '04_ml%' OR name LIKE '03[2-9]_%' OR name LIKE '04[0-1]_%' ORDER BY name"
```

Expected: 10 rows showing migrations 032-041 applied.

```bash
sqlite3 data/zeus.db ".tables ml_*"
```

Expected: 10 tables listed with `ml_` prefix.

- [ ] **Step 3: PM2 reload (operator-triggered, NOT automated)**

```bash
pm2 reload zeus --update-env
sleep 5
pm2 logs zeus --lines 50 --nostream | grep -i "migration\|omega\|error" | tail -20
```

Expected: Migration runner logs show 10 new migrations applied. No errors.

- [ ] **Step 4: Push branch to origin**

```bash
git push -u origin omega/wave-1-foundation
```

- [ ] **Step 5: Tag Wave 1A completion**

```bash
TAG="omega-wave-1a-complete-$(date -u +%Y%m%d-%H%M%S)"
git tag -a "$TAG" -m "OMEGA Wave 1A complete: scaffolding + 10 DB migrations + 9 flags"
git push origin "$TAG"
echo "TAG: $TAG"
```

- [ ] **Step 6: Update memory + tasks**

Update memory file `project_ml_v3_expert_acceptance_and_ux_scope_20260514.md` Section G with:
- Wave 1A: ✅ DONE (commit hashes + tag)
- Next: Wave 1B R-1 test harness

Update Task #77 status: completed.

---

## Critical Files

| File | Modification scope | Recovery if broken |
|---|---|---|
| `server/services/database.js` | +10 migrate() blocks appended | Backup + git revert; live DB has additive tables, no rollback of schema needed (additive only) |
| `server/migrationFlags.js` | +9 property getters appended | Backup `*.bak.pre-omega-wave-1a-20260514` + git revert |
| `server/services/ml/**` | New tree (zero existing files touched) | `rm -rf server/services/ml/` + git revert |
| `tests/unit/ml/*` | New test files | `rm -rf tests/unit/ml/` + git revert |

---

## Verification (post all 15 tasks)

### Smoke validation (5 min)

```bash
# 1. All jest tests green
npx jest 2>&1 | tail -5

# 2. PM2 stable post-reload
pm2 list | grep zeus
pm2 logs zeus --lines 20 --nostream | grep -iE "error|crash|fatal" | head -5

# 3. 10 new tables present
sqlite3 data/zeus.db ".tables ml_*" | wc -w

# 4. 10 new _migrations rows
sqlite3 data/zeus.db "SELECT COUNT(*) FROM _migrations WHERE name LIKE '03[2-9]_%' OR name LIKE '04[0-1]_%'"

# 5. 9 new flags accessible
node -e "const MF = require('./server/migrationFlags'); console.log({
  ML_INGEST: MF.ML_INGEST_ENABLED,
  ML_SHADOW: MF.ML_PIPELINE_SHADOW,
  ML_DEMO: MF.ML_DEMO_INFLUENCE_ENABLED
})"

# 6. Branch + tag pushed
git ls-remote origin omega/wave-1-foundation
git ls-remote origin --tags | grep omega-wave-1a-complete
```

### Acceptance criteria (Wave 1A GREEN)

- [ ] 10 new `ml_*` tables exist in production DB
- [ ] All 10 migrations recorded in `_migrations` table
- [ ] 9 new flags in `MF` interface, all default `false`
- [ ] Full jest suite GREEN (no regressions vs baseline 282/285)
- [ ] PM2 stable post-reload, no error spam
- [ ] No production data touched (zero rows in any `ml_*` table — all empty)
- [ ] Branch `omega/wave-1-foundation` pushed to origin
- [ ] Tag `omega-wave-1a-complete-*` pushed
- [ ] Memory updated with status

### Rollback (if needed within Wave 1A)

```bash
# Soft rollback — just revert PM2 to pre-omega state
git checkout pre-omega-wave-1-20260514-214634
pm2 reload zeus --update-env

# Hard rollback — drop tables + remove migration rows
sqlite3 data/zeus.db <<EOF
DROP TABLE IF EXISTS ml_runtime_features;
DROP TABLE IF EXISTS ml_feature_audit_log;
DROP TABLE IF EXISTS ml_feature_proposals;
DROP TABLE IF EXISTS ml_feature_global_overrides;
DROP TABLE IF EXISTS ml_decision_snapshots;
DROP TABLE IF EXISTS ml_decision_light;
DROP TABLE IF EXISTS ml_attribution_events;
DROP TABLE IF EXISTS ml_voice_log;
DROP TABLE IF EXISTS ml_operator_approval;
DROP TABLE IF EXISTS ml_ring_health;
DELETE FROM _migrations WHERE name IN (
  '032_ml_runtime_features','033_ml_feature_audit_log','034_ml_feature_proposals',
  '035_ml_feature_global_overrides','036_ml_decision_snapshots','037_ml_decision_light',
  '038_ml_attribution_events','039_ml_voice_log','040_ml_operator_approval','041_ml_ring_health'
);
EOF
```

Per Cornercase: schema additive means even if we abandon Wave 1A, the tables are no-op (zero rows) and don't affect existing behavior. Hard rollback only needed if column conflict suspected.

---

## Existing utilities reused

- `migrate()` framework in `server/services/database.js` — track-once via `_migrations` table
- Jest test framework (existing 282 tests baseline)
- `MF` module pattern (S3 brainParity.js precedent for property getters)
- Git tag protocol (S6-B7 / S7 / M1 precedent)
- `*.bak.pre-<feature>-<date>` backup convention (Rule 4)

---

## Post-execution

After Task 15 complete:

1. Update memory `project_ml_v3_expert_acceptance_and_ux_scope_20260514.md` Section G — Wave 1A ✅
2. Update Task #77 status: completed (TaskUpdate)
3. Update Task #78 status: in_progress (TaskUpdate) — ready for Wave 1B (R-1 Test Harness)
4. Operator review: confirm GREEN, approve Wave 1B start
5. Begin Wave 1B plan draft (separate plan doc)

---

## Self-review notes (per writing-plans skill)

1. **Spec coverage:**
   - ✅ 10 DB tables specified in Cornercase D + memory listed: covered (032-041)
   - ✅ 9 migration flags from spec frozen: covered (Task 14)
   - ✅ Per-(user, env, symbol, feature_id) isolation: enforced via UNIQUE constraint Task 3
   - ✅ DEMO/TESTNET/REAL CHECK on all relevant tables
   - ✅ Cornercase A (hybrid pooling): evidence_json source_scope in Task 3 schema
   - ✅ Cornercase B (override resolver): Task 6 establishes table
   - ✅ Cornercase C (RETIRED-NOT-DELETE): status CHECK enum in Task 3 includes RETIRED
   - ✅ Cornercase D (TIER 1 + light): Task 7 + Task 8 split

2. **Placeholder scan:** Zero `TODO`, zero "implement later", zero "TBD" found.

3. **Type consistency:**
   - `resolved_env CHECK(IN ('DEMO','TESTNET','REAL'))` — used consistently across tables (Tasks 3, 4, 5, 6, 7, 8, 9, 10, 11)
   - `created_at INTEGER NOT NULL` — used consistently (epoch ms)
   - Index naming: `idx_<table-abbrev>_<columns>` — consistent
   - PK naming: `id INTEGER PRIMARY KEY AUTOINCREMENT` — consistent

4. **Risks called out:**
   - Task 3 Step 3 may require refactoring `migrate()` framework to expose `_runAllMigrations`. If existing framework doesn't support, fallback: skip in-memory test, run integration test against live DB during smoke (Task 15). Decision deferred to operator if Task 3 Step 3 hits non-trivial refactor — log via Rule 21.

5. **Estimated time:**
   - Tasks 1-2 (prep + scaffolding): ~20 min
   - Tasks 3-12 (10 migrations × ~10 min each TDD): ~100 min
   - Task 14 (flags): ~15 min
   - Task 15 (smoke + push): ~15 min
   - **Total Wave 1A: ~2.5 hours of focused work**

6. **Skipped (out of scope):**
   - Wave 1B test harness modules (separate plan)
   - Wave 1C R0 substrate modules (separate plan)
   - Phase 1 brainLogger fix (entirely separate per spec invariant #9)

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-14-omega-wave-1a-db-schema-and-scaffolding.md`**.

Two execution options per writing-plans skill:

**1. Subagent-Driven (recommended)** — Claude dispatches fresh subagent per task + spec compliance reviewer + code quality reviewer. Best for parallel safety + quality gates.

**2. Inline Execution** — Claude executes tasks in this session with operator checkpoint between each phase. Best for tight collab + fast iteration.

**Operator pick required.**
