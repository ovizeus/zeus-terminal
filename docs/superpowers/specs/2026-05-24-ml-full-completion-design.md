# ML Full Completion — Ring-by-Ring Gap Closure + Integration

> **Status:** APPROVED 2026-05-24
> **Operator:** Ovi (wsov2@protonmail.com)
> **Scope:** 44 gap closure + 272 module integration verification
> **Structure:** 9 waves (0-8), ring-by-ring, no intermediate soak

## Goal

Every ML module wired end-to-end in the brain cycle, producing real data, zero stubs, zero dead code. Final soak 24-48h on complete ML package.

## Baseline (pre-Wave 0)

| Metric | Value |
|--------|-------|
| Canonical points implemented | 233/241 |
| ML modules | 272 files |
| ML tests | 264 files, 6790+ passing |
| DB tables | 358 ml_* |
| Ring5 pipeline | ACTIVE (Stage 1-3 flipped) |
| Doctor system | MVP SHIPPED (D-0..D-5) |
| Gaps identified | 44 (16 P0, 8 P1, 10 P2, 3 P3, 5 supplementary) |

## Waves

| Wave | Ring | Deliverable |
|------|------|-------------|
| **0** | — | Per-ring audit: wired/unwired/broken per module. Canonical gap list. Test baseline. |
| **1** | R0 + R-1 | Substrate gaps (FEAT-244*, FEAT-245*) + Replay engine from stub to real |
| **2** | R1 | Constitution enforcement wired + verified |
| **3** | R2 | Cognition 30 modules wired in brain cycle, producing data |
| **4** | R3A + R3B | Safety + Validation 30 modules integrated |
| **5** | R4 | Execution 15 modules + EXEC-N1/N2/N3 gaps |
| **6** | R5A + R5B | Learning + Governance 41 modules + SPEC/ARCH/DOM gaps |
| **7** | R6 + R7 | Shadow/Meta + Communication from skeleton to real |
| **8** | — | Integration sweep + performance (PERF-1/2/3) + OPS gaps + final soak 24-48h |

## Per-Wave Process

1. Read Wave 0 audit for target ring
2. Backup critical files
3. Fix gaps (TDD: failing test first, then implementation)
4. Double-verify: tests green + PM2 reload + real data in DB
5. Commit + push
6. Next wave (no soak)

## Rules (NON-NEGOTIABLE)

- Verify twice before acting once
- Clean code, real implementations, no stubs, no dead code
- Surgical edits, no layout shifts
- Backup before important changes
- Audit before each wave
- Tests green after every change
- Real data, not estimates
- Ask on unclear — never assume
- Stop and report on any bug/error found
- Zero mistakes, professional execution

## 3-Tier Module Classification

### HOT PATH (brain cycle 30s, real-time trading)
Wire modules with direct impact on decisions:
- R2 detectors: regime, liquidity, smart money, confidence decay
- R3A safety gates: blackSwan, lossStreak, dataFreshness, circuitBreaker
- R4 execution: smartPostOnly, fundingAwareExit, rateLimitPriority, latency
- R5B governance: tieredPromotion trigger, autoQuarantine check
- R0 substrate: deadMansSwitch heartbeat, pointInTimeStore snapshots

### COLD PATH (reflection cron, 5-10 min interval)
Philosophical/meta modules analyze PAST decisions retrospectively:
- R2: agencyAttributionLedger, narrativeCoherence, causalDiscoveryEngine, competingHypothesesEngine, epistemicCurrencyExchange, temporalPatterns
- R5A: counterfactualPortfolio, policyRegret, driftOrchestration
- R6: internalDebate, scenarioTreePlanner
- Writes to `ml_reflection_*` tables
- Insights surface in OMEGA Voice feed

### DORMANT (no wiring, foundation libraries)
Too abstract for current utility:
- cosmicLocalityCheck, pluralSelfChamber, curiosityEngine, modalStabilityTest, epistemicMetabolismEngine, etc.
- Kept as code, not wired. Optional future promotion COLD→HOT if proven useful.

---

## Cold Path Technical Specification

### 1. Schema `ml_reflection_*`

**Tables:**

```sql
-- Per-run metadata (1 row per cron execution)
CREATE TABLE ml_reflection_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,        -- epoch ms
  finished_at INTEGER NOT NULL,
  decisions_processed INTEGER NOT NULL, -- how many brain_decisions analyzed
  modules_run INTEGER NOT NULL,
  modules_failed INTEGER NOT NULL,
  total_insights INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL
);

-- Individual insights (N rows per run, 1 per module×decision that produced output)
CREATE TABLE ml_reflection_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES ml_reflection_runs(id),
  ts INTEGER NOT NULL,                -- epoch ms
  module_id TEXT NOT NULL,            -- e.g. 'narrativeCoherence'
  decision_id INTEGER NOT NULL,       -- FK brain_decisions.id
  insight_type TEXT NOT NULL,         -- 'observation' | 'warning' | 'pattern' | 'contradiction'
  severity TEXT NOT NULL,             -- 'low' | 'medium' | 'high' | 'critical'
  insight_text TEXT NOT NULL,         -- human-readable insight (EN, max 500 chars)
  metadata_json TEXT,                 -- module-specific structured data
  surfaced_in_voice INTEGER DEFAULT 0 -- 1 if shown in OMEGA Voice feed
);

CREATE INDEX idx_reflection_insights_ts ON ml_reflection_insights(ts);
CREATE INDEX idx_reflection_insights_module ON ml_reflection_insights(module_id, ts);
CREATE INDEX idx_reflection_insights_severity ON ml_reflection_insights(severity, ts);
CREATE INDEX idx_reflection_insights_voice ON ml_reflection_insights(surfaced_in_voice, ts);
```

**Retention Policy (aligned with ML Architecture v2 frozen):**
- HOT tier (0-7d): full rows, all columns queryable
- WARM tier (7-30d): keep rows, drop metadata_json (SET NULL)
- COLD tier (30-90d): aggregate to daily summaries, delete individual rows
- DELETE after 90d

### 2. Cold Cron Frequency

**Interval: 5 minutes** (adaptive skip)

Rationale:
- Brain produces ~8 decisions/min × 5 min = ~40 decisions per batch
- ~12 cold modules × ~2-3s each = ~30s total per cycle
- 5 min gives enough decisions per batch without excessive cron overhead
- **Adaptive skip:** if zero new brain_decisions since last run → skip entirely (no wasted cycles)

### 3. Promotion COLD→HOT Criteria

**All conditions must be met:**
1. **Minimum cold soak:** 7 days continuous operation
2. **Successful runs:** 100+ consecutive runs without error (at 5min = ~8.3h minimum, but 7d soak enforces longer)
3. **Insight production:** Module produced ≥10 insights with severity ≥ 'medium' in last 7d
4. **No quarantine history:** Zero quarantine events in cold path during soak
5. **Operator approval:** Operator reviews promotion report and explicitly approves

**Promotion Report Format (auto-generated):**
```
MODULE: [module_id]
COLD SINCE: [date]
TOTAL RUNS: [N]
CONSECUTIVE SUCCESS: [N]
INSIGHTS PRODUCED: [N total] / [N medium+] / [N high+]
ERRORS: [N] (last error: [date or 'never'])
QUARANTINES: [N] (last: [date or 'never'])
SAMPLE INSIGHTS (last 5):
  - [ts] [type] [text]
RECOMMENDATION: PROMOTE / KEEP_COLD / DEMOTE_DORMANT
```

### 4. Cold Path Resource Budget

| Resource | Limit | Enforcement |
|----------|-------|-------------|
| **Total cycle time** | 30s max | AbortController timeout on entire cron tick |
| **Per-module time** | 5s max | AbortSignal.timeout(5000) per module call |
| **Memory** | No hard cap (Node GC handles) | Monitor via process.memoryUsage() delta |
| **Kill switch** | If total > 30s, abort remaining modules | Log partial completion |
| **Telemetry** | Per-module: duration_ms, ran_ok, insights_count | Via Doctor telemetryCollector.recordInvocation() |

### 5. Failure Isolation

**Architecture:** Same Node process, try/catch isolation per module (NOT separate process — SQLite single-writer constraint prevents multi-process writes).

**Isolation guarantees:**
- Each cold module wrapped in `try { ... } catch (err) { recordFailure(moduleId, err) }`
- Cold path crash NEVER propagates to hot path (different setInterval, different call stack)
- Hot path brain cycle has zero imports from cold path runner

**Auto-quarantine:**
- 3 consecutive failures → module quarantined (Doctor quarantineManager.applyQuarantine)
- Quarantined module skipped in subsequent cold runs
- Auto-resume after 24h if next run succeeds (Doctor existing anti-flapping: 3/24h rule)

**Alerting:**
- On quarantine: OMEGA Voice gets `insight_type='warning'` with `severity='high'`
- On 5+ modules quarantined simultaneously: `severity='critical'` + Telegram push to operator
- Cold path total failure (all modules crash): P0 Doctor alert + Telegram immediate

### Promotion Rule
Cold path module → HOT path only after operator reviews promotion report and explicitly approves.

## Out of Scope

- Intermediate soak between waves (only final soak)
- New canonical points beyond 255
- UI changes (unless required for verification)
- Bybit/exchange work
- Any non-ML work until completion

## Success Criteria

- All 272 modules wired and producing data in running process
- All 44 gaps closed or explicitly DEFERRED with operator approval
- Zero test failures
- ML pipeline end-to-end: brain → all rings → influence → close → learn
- 24-48h soak green with growing bandit observations
