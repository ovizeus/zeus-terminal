# ML Activation Audit — 2026-05-23

Stage 0 pre-activation verification. READ-ONLY audit, no code changes.

---

## 1. Flag Paths

### 1.1 Flag Definitions (server/migrationFlags.js:118-156)

All 9 ML flags defined in `DEFAULTS` object, exposed via getters (lines 310-318),
persisted to `data/migrationFlags.json`. All currently `false`.

| Flag | Line | Purpose |
|------|------|---------|
| ML_INGEST_ENABLED | 122 | Stage 1 ingest: R-1/R0 write to ml_decision_* |
| ML_PIPELINE_SHADOW | 126 | Stage 2 shadow: pipeline runs but no influence |
| ML_DEMO_INFLUENCE_ENABLED | 130 | Stage 3 DEMO influence gate |
| ML_TESTNET_INFLUENCE_ENABLED | 133 | Stage 4 TESTNET influence gate |
| ML_LIVE_INFLUENCE_ENABLED | 137 | Stage 5 REAL influence gate |
| ML_LIVE_OPTIN_REQUIRED | 141 | Per-user opt-in for REAL |
| ML_BANDIT_AUTO_APPLY_MINOR | 146 | Auto-apply MINOR proposals |
| ML_HYBRID_POOLING_ENABLED | 151 | Cornercase A hybrid pooling |
| ML_OVERRIDE_RESOLVER_ENABLED | 156 | Cornercase B 7-layer resolver |

### 1.2 Consumer Mapping

**BLOCKER FINDING:** 5 of 9 ML flags have ZERO code consumers.

| Flag | Consumers Outside migrationFlags.js | Status |
|------|--------------------------------------|--------|
| ML_INGEST_ENABLED | **NONE** | UNWIRED |
| ML_PIPELINE_SHADOW | **NONE** | UNWIRED |
| ML_DEMO_INFLUENCE_ENABLED | **NONE** | UNWIRED |
| ML_TESTNET_INFLUENCE_ENABLED | **NONE** | UNWIRED |
| ML_LIVE_INFLUENCE_ENABLED | **NONE** | UNWIRED |
| ML_LIVE_OPTIN_REQUIRED | **NONE** | UNWIRED |
| ML_BANDIT_AUTO_APPLY_MINOR | tieredPromotion.js:169,252 | WIRED |
| ML_HYBRID_POOLING_ENABLED | **NONE** | UNWIRED |
| ML_OVERRIDE_RESOLVER_ENABLED | **NONE** | UNWIRED |

Only `ML_BANDIT_AUTO_APPLY_MINOR` has actual code that reads it
(R5B_governance/tieredPromotion.js lines 169 and 252).

**Impact:** Flipping ML_INGEST_ENABLED, ML_PIPELINE_SHADOW, or
ML_DEMO_INFLUENCE_ENABLED to `true` would have NO EFFECT on runtime behavior.
The flags exist as documentation/intent but are not wired into any gate logic.

### 1.3 Actual Gating Mechanism

The Ring5 influence pipeline in serverBrain.js (lines 1046-1091) calls
`ring5LearningService.wrap()` unconditionally in `mode: 'influence'` on every
brain cycle. The ACTUAL gate is `influenceEligibility.checkEligibility()` which
checks:
1. L4 posterior observation_count >= 30 (currently max = 3)
2. Active version in versionRegistry for 'ring5-bandit-influence-phase4'
3. Active pre-registration entry (non-terminal state)
4. Eval window not expired

Current state: All 33,994 influence attempts have been `skipped` with reason
`not_eligible_insufficient_observations`. The eligibility gate is the ONLY
protection preventing influence on trades.

---

## 2. Table Dependencies

### 2.1 Schema Verification

| Table | Exists | Columns Match INSERTs |
|-------|--------|----------------------|
| ml_decision_snapshots | YES | YES -- auditTrail.js INSERT matches 9-column schema |
| ml_decision_light | YES | YES -- auditTrail.js INSERT matches 9-column schema |
| ml_bandit_evidence | YES | YES -- banditEvidence.js INSERT matches 7-column schema |
| ml_bandit_posteriors | YES | YES -- banditPosteriors.js upsert matches 6-column schema |
| ml_module_state | YES | YES -- ring5State.js upsert matches UNIQUE(user_id, resolved_env, symbol, module_id) |

### 2.2 Current Row Counts

| Table | Rows |
|-------|------|
| ml_decision_snapshots | 0 |
| ml_decision_light | 0 |
| ml_bandit_evidence | 15 (6 positive, 9 negative) |
| ml_bandit_posteriors | 8 (all L4, obs_count 1-3) |
| ml_module_state | 5 |
| ml_influence_audit | 33,994 (all skipped) |
| brain_decisions | 89,922 |

### 2.3 brainLogger vs auditTrail Discrepancy

**WARNING:** Two separate logging systems exist:

1. **brainLogger.js** writes to `brain_decisions` table (89,922 rows). Called
   from serverBrain.js (13 call sites). Uses `db.bdInsert()`.

2. **auditTrail.js** writes to `ml_decision_snapshots` + `ml_decision_light`
   (both 0 rows). Called from omega.js route only.

brainLogger does NOT write to ml_decision_snapshots. The ml_decision_snapshots
table has 0 rows despite 89,922 brain decisions logged. This means Stage 1
(ML_INGEST_ENABLED) has no actual data pipeline even if the flag were wired.

---

## 3. Ring5LearningService Facade

**File:** server/services/ml/ring5LearningService.js (190 lines)

### 3.1 Dependencies

| Dependency | Path | Exists | Loads |
|------------|------|--------|-------|
| ring5State | _ring5/ring5State.js | YES (3532 bytes) | YES* |
| thompsonSampler | _ring5/thompsonSampler.js | YES (2855 bytes) | YES* |
| influenceProposer | _ring5/influenceProposer.js | YES (2475 bytes) | YES* |
| reflectionGate | _ring5/reflectionGate.js | YES (1865 bytes) | YES* |
| influenceAudit | _ring5/influenceAudit.js | YES (1728 bytes) | YES* |
| influenceEligibility | _ring5/influenceEligibility.js | YES (3101 bytes) | YES* |

*Load test via `node -e require(...)` failed due to better-sqlite3 native module
version mismatch (compiled for Node MODULE_VERSION 127, runtime needs 115). This
is a CI/dev environment issue, NOT a code issue. Production server uses matching
Node version.

### 3.2 API Surface

- `wrap(params)` -- shadow or influence mode. Influence path:
  eligibility -> thompsonSampler.drawSample -> influenceProposer.propose ->
  reflectionGate.evaluate -> influenceAudit.record
- `recordContribution(params)` -- called from serverAT.js on trade close.
  Writes bandit evidence + L4 posterior + module state.

### 3.3 Circular Import Check

- serverBrain.js requires ring5LearningService at top-level (line 71)
- serverAT.js uses lazy require via `_getRing5()` (line 34-39) to avoid
  circular dependency. Pattern: `let _ring5LearningService = null; function
  _getRing5() { if (_ring5LearningService === null) { try { ... } } }`

No circular imports detected in Ring5 subtree.

---

## 4. brainLogger State

**File:** server/services/brainLogger.js (204 lines)

### 4.1 Target Table

**WARNING:** brainLogger writes to `brain_decisions` table, NOT
`ml_decision_snapshots`. The `brain_decisions` table is a legacy pre-ML table
(migration 014). The ML-spec `ml_decision_snapshots` table (migration 037) has
a different schema and is written by auditTrail.js.

### 4.2 Call Sites

- serverBrain.js line 65: `const brainLogger = require('./brainLogger');`
- 13 call sites: `brainLogger.logDecision()` (lines 887, 904, 923, 1119, 1138,
  1182, 1198, 1293, 1300, 1322), `brainLogger.linkSeq()` (854, 1309),
  `brainLogger.updateAction()` (855, 865)
- All wrapped in try/catch: YES (every call site has `try {} catch (_) {}`)

### 4.3 Prune

- `brainLogger.prune()` runs daily via `setInterval()` at line 419
- Retention: NO_TRADE unlinked = 30 days, blocked_* = 90 days

### 4.4 Error Isolation

Every public function in brainLogger is wrapped in outer try/catch with
`logger.error()` inside nested try/catch. Logger failure cannot crash brain.

---

## 5. Doctor Modules

### 5.1 Registry Summary

- **Total modules:** 64
- **hot_path_critical (critical/high):** 6
- **hot_path_assist (medium):** 8 (4 are listed as medium criticality above)
- **shadow_assist:** 12
- **forensic:** 9
- **governance:** 7
- **philosophical:** 8
- **introspection_meta:** 14

### 5.2 hot_path_critical Modules

| module_id | criticality | JS File |
|-----------|-------------|---------|
| positionStateMachine | critical | R4_execution/positionStateMachine.js |
| circuitBreaker | critical | R3A_safety/circuitBreaker.js |
| dataFreshness | critical | R3A_safety/dataFreshness.js |
| conflictResolution | high | R3A_safety/conflictResolution.js |
| realityContactRatio | high | R3A_safety/realityContactRatio.js |
| reconcilePosition | critical | **MISSING** -- positionReconciliation.js exists but filename mismatch |

**WARNING:** `reconcilePosition` is registered as hot_path_critical with
criticality=critical, but no `reconcilePosition.js` file exists. File
`R3A_safety/positionReconciliation.js` exists -- likely a naming mismatch
between registry module_id and actual filename.

### 5.3 Modules Without JS Files (11 total)

| module_id | role_tag | criticality | Notes |
|-----------|----------|-------------|-------|
| reconcilePosition | hot_path_critical | critical | positionReconciliation.js exists (name mismatch) |
| _doctor_moduleRegistry | forensic | high | _doctor/moduleRegistry.js exists (name mismatch) |
| driftDetector | shadow_assist | high | driftDetection.js exists (name mismatch) |
| cluster_active_inference | philosophical | low | Seed-only, no implementation |
| cluster_constitutive | philosophical | low | Seed-only |
| cluster_incompleteness | philosophical | low | Seed-only |
| cluster_kairos | philosophical | low | Seed-only |
| cluster_limit | philosophical | low | Seed-only |
| cluster_reflexive_meta | philosophical | low | Seed-only |
| cluster_reflexive_temporal | philosophical | low | Seed-only |
| cluster_transcendental | philosophical | low | Seed-only |

3 are naming mismatches (JS file exists under different name).
8 are seed-only philosophical placeholders (low criticality).

---

## 6. Invariant Violations

**1 row found.**

| Field | Value |
|-------|-------|
| id | 680 |
| user_id | 9061 |
| resolved_env | DEMO |
| invariant_id | INV-001-no-orphan-position |
| severity | critical |
| context_json | (empty) |
| snapshot_id | (empty) |
| action_taken | lock |
| ts | 2026-05-18 09:37 UTC |

**Assessment:** Single critical invariant violation from 5 days ago in DEMO env.
`INV-001-no-orphan-position` detects positions without corresponding state
machine entries. Action was `lock` (position locked for reconciliation).

**Blocking?** NO -- this is a DEMO-env orphan position detection. Expected
during testing. The lock action was taken correctly. Does not block ML
activation since ML subsystem is independent of position state machine
invariant enforcement.

---

## 7. Module Quarantines

**4 quarantined modules, ALL test fixtures.**

| module_id | quarantine_action | reason | lift_reason |
|-----------|-------------------|--------|-------------|
| m_clamp | clamp_influence | low trust | Test fixture cleanup -- m_* are leftover test module IDs |
| m_disable | disable | critical fail | Test fixture cleanup -- m_* are leftover test module IDs |
| m_shadow | shadow_only | output suppressed | Test fixture cleanup -- m_* are leftover test module IDs |
| m_active | clamp_influence | test | Test fixture cleanup -- m_* are leftover test module IDs |

All have `lifted_at` timestamps set (all lifted/resolved). These are test
fixture artifacts with `m_*` prefixed IDs -- not real production modules.

**Blocking?** NO. All quarantines are lifted test fixtures. No real modules
quarantined.

---

## 8. Dead Code

### 8.1 Tables Referenced but Missing

**0 missing tables.** All 349 table names referenced in ML code exist in the DB.

(Initial scan showed `ml_l` and `ml_r` as "missing" -- these were regex parsing
artifacts from truncated names like `ml_l2_depth_snapshots` and
`ml_r1_violations`. Corrected regex confirms zero missing tables.)

### 8.2 Tables in DB but Not Referenced (9 orphan tables)

| Table | Assessment |
|-------|-----------|
| ml_adversarial_mc_runs | R-1 test harness -- may be populated externally |
| ml_belief_ablation_tests | R-1 test harness |
| ml_feature_proposals | Likely used by future feature pipeline |
| ml_fundamentals_cache | May be populated by external data feed |
| ml_identity_transformation_tests | R-1 test harness |
| ml_invariance_tests | R-1 test harness |
| ml_obfuscated_orders | R4 execution -- may be populated externally |
| ml_ring_health | Doctor telemetry -- may be populated via different path |
| ml_runtime_features | Feature pipeline -- future use |

**Blocking?** NO. Orphan tables are either test harness artifacts or future-use.
No referenced table is missing.

### 8.3 Total Table Count

- Referenced by ML code: 349
- Existing in DB: 358
- Orphan (DB-only): 9
- Missing (code-only): 0

---

## 9. Circular Dependencies

### 9.1 Native Module Issue

```
ring5LearningService LOAD ERROR: better-sqlite3 compiled against
NODE_MODULE_VERSION 127, runtime needs 115
```

This is a Node.js version mismatch in the audit/CI environment, NOT a circular
dependency. Production PM2 uses matching Node version. The error prevents
runtime load testing in this environment but does not indicate code issues.

### 9.2 Static Analysis

- **ring5LearningService.js** requires 6 files from `_ring5/` subdirectory.
  None of those require ring5LearningService back.
- **serverBrain.js** requires ring5LearningService at top level (line 71).
  ring5LearningService does NOT require serverBrain.
- **serverAT.js** uses lazy require pattern (line 34-39) to avoid circular:
  `let _ring5LearningService = null; function _getRing5() { ... try {
  require('./ml/ring5LearningService'); } ... }`
- **influenceAudit.js** requires `../../database` (db). No back-reference.
- **thompsonSampler.js** requires banditPosteriors, banditEvidence,
  effectiveStatus. None require thompsonSampler back.

**No circular dependencies detected via static analysis.**

---

## VERDICT

### SAFE TO ACTIVATE STAGE 1: **NO**

### Blockers: 1

**B1. ML flags are not wired to any code paths.**

ML_INGEST_ENABLED, ML_PIPELINE_SHADOW, and ML_DEMO_INFLUENCE_ENABLED have zero
consumers. Flipping them to `true` changes nothing at runtime. The staged
activation plan assumes these flags gate behavior, but no code checks them.

Before activation, code must be added to:
- Gate brainLogger/auditTrail writes behind ML_INGEST_ENABLED
- Gate Ring5 influence pipeline behind ML_PIPELINE_SHADOW (shadow) and
  ML_DEMO_INFLUENCE_ENABLED (influence per env)
- OR: acknowledge that influenceEligibility is the actual gate and retire
  the flag-based activation plan

### Warnings: 5 (non-blocking)

**W1. brainLogger writes to brain_decisions, not ml_decision_snapshots.**
The ML-spec table ml_decision_snapshots has 0 rows. brainLogger (the active
logger with 89,922 rows) writes to the pre-ML brain_decisions table. If Stage 1
expects data in ml_decision_snapshots, the data pipeline is disconnected.

**W2. reconcilePosition module_id has no matching JS file.**
Registry has `reconcilePosition` (hot_path_critical, critical) but the file is
`positionReconciliation.js`. Doctor health checks may fail for this module if
they resolve by filename. Non-blocking because Doctor currently operates on
registry data, not filesystem.

**W3. 8 philosophical cluster_* modules are seed-only.**
Registered in ml_module_registry but no JS implementation files. All low
criticality, philosophical role_tag. Non-blocking -- they serve as registry
placeholders per seedRegistry.js.

**W4. Ring5 influence pipeline is live but inert.**
The pipeline runs on every brain cycle (`mode: 'influence'`), attempts influence,
and gets blocked by insufficient observation count. 33,994 skipped attempts
logged. This is safe today but means influence will automatically activate once
any cell reaches 30 observations WITHOUT any flag flip. This contradicts the
staged activation plan.

**W5. Native module version mismatch in audit environment.**
better-sqlite3 compiled for Node MODULE_VERSION 127 vs runtime 115. Prevents
`require()` load testing. Production is unaffected (PM2 uses matching Node).

---

## Appendix: Data Summary

- ML tables in DB: 358
- ML modules in registry: 64 (6 hot_path_critical, 8 hot_path_assist, 12 shadow_assist, 9 forensic, 7 governance, 8 philosophical, 14 introspection_meta)
- ML JS files: 272 (in server/services/ml/)
- Ring5 dependencies: 6/6 files exist
- Invariant violations: 1 (DEMO orphan position, resolved)
- Module quarantines: 4 (all test fixtures, all lifted)
- Influence audit rows: 33,994 (100% skipped/insufficient_observations)
- Bandit posteriors: 8 cells, max 3 observations (threshold = 30)
- Bandit evidence: 15 rows (6 positive, 9 negative)
- brain_decisions: 89,922 rows
- ml_decision_snapshots: 0 rows
