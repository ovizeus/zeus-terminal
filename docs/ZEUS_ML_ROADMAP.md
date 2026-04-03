# Zeus Terminal — ML Data Layer Roadmap

> Last updated: 2026-04-03
> Status: PLANNING COMPLETE — ready for Phase 1+2 implementation

---

## Overview

Brain V3 is live with 17 modules, 8 fusion weights, 9+ modifiers, and 8 gates.
However, decision intermediate values are not persisted — only the final confidence integer survives.
This blocks all ML work: no input features linked to outcomes = no training data.

The ML data layer adds pure-observer logging to capture training-quality decision snapshots
without changing any Brain/AT behavior.

---

## Corrected Phase Order

```
Phase 1+2 (single deploy)
    │
    ├─ brain_decisions table + brainLogger.js
    ├─ snapshot capture at every decision point
    ├─ linkage to trade outcomes (seq, PnL, MAE, MFE)
    ├─ no-trade sampling policy active
    │
    ▼
DATA ACCUMULATION: 2-4 weeks minimum
    │
    ▼
Phase 3: Export + Analysis
    │
    ├─ admin export route
    ├─ feature correlation analysis
    ├─ modifier impact analysis
    ├─ validate data quality
    │
    ▼
Phase 4: Shadow Scorer Scaffolding (disabled by default)
    │
    ├─ brainShadowScorer.js — hooks only, no active model
    ├─ can be deployed anytime, costs nothing when disabled
    │
    ▼
MODEL EVALUATION: requires 500+ labeled trades
    │
    ├─ train on accumulated data
    ├─ shadow score vs Brain decisions
    ├─ evaluate accuracy before any live consideration
```

---

## Phase 1+2: Data Capture + Linkage (SINGLE DEPLOY)

### Objective
Persist complete decision snapshots with outcome linkage from day one.

### What gets built
- **New table:** `brain_decisions` in SQLite
  - Indexed columns: snap_id, user_id, symbol, ts, final_tier, final_action, linked_seq
  - JSON blob `data` column with all snapshot fields
- **New module:** `server/services/brainLogger.js` (~80 LOC)
  - `logDecision(fields)` — writes snapshot to DB
  - `linkOutcome(snapId, outcomeFields)` — updates record on trade close
  - All calls wrapped in try/catch — logger crash must never crash Brain
- **Modify:** `server/services/serverBrain.js`
  - `_computeFusion()` exposes intermediate values (8 scores + 9 modifiers) via return object
  - `_runCycle()` calls `brainLogger.logDecision()` at every exit point
  - Zero change to decision logic or execution
- **Linkage:**
  - Direct entry: AT returns `entry.seq` → immediate `linked_seq` update
  - Pending entry: `snapId` carried on pending record → on fill, link updated
  - Pending expire: action updated to `pending_expire`
  - Scale-in: new snapshot linked to parent position seq
  - Trade close: `brainLogger.linkOutcome()` called with PnL/MAE/MFE/holdMin
  - No-trade: evaluated by serverReflection → outcome label updated
- **No-trade sampling policy:**
  - Near-miss (confidence >= 50): STORE
  - Gate state flip since last snapshot: STORE
  - Regime change: STORE
  - Heartbeat every 10 cycles (~5 min): STORE
  - High-signal confluence >= 60: STORE
  - Everything else: SKIP
  - Expected: ~200-400 no-trade records/day vs ~5,760 raw

### Minimal snapshot fields (Phase 1): 45 fields
Identity (6) + core indicators (9) + regime (5) + confluence (4) + gates summary (2) +
raw confidence (1) + key modifiers (7) + final decision (5) + linkage (1) + outcomes (5)

### Files touched
- NEW: `server/services/brainLogger.js`
- NEW: DB migration in `server/services/database.js`
- MODIFY: `server/services/serverBrain.js` (expose intermediates + add log calls)
- MODIFY: `server/services/serverAT.js` (pass snapId back on entry)
- MODIFY: `server/services/serverPendingEntry.js` (carry snapId)

### What must NOT change
- `_computeFusion()` output values (same decisions)
- `_checkGates()` logic
- `processBrainDecision()` execution flow
- All modifier functions (same return values)
- `at_closed` table and write path
- DSL system, risk guard, kill switch
- Fusion weights and tier thresholds
- Client-side code
- WebSocket/REST data feeds

### Retention
- Entry snapshots: forever (tiny volume, ~5-15/day)
- Blocked snapshots: 90 days rolling
- No-trade snapshots: 30 days rolling

### Validation
- `SELECT COUNT(*), final_action FROM brain_decisions GROUP BY final_action` — all paths produce records
- Brain decisions unchanged: compare decision log before/after
- Cycle duration increase < 2ms
- After 1 week: orphan rate (linked_seq IS NULL on trades) < 5%

### Rules
- Backup before implementation
- Run full test suite after (must stay 275/275 or current count)
- Deploy and monitor for 24h before declaring stable

---

## DATA ACCUMULATION PERIOD: 2-4 weeks

### What happens
- Brain runs normally, brainLogger captures snapshots
- Trade outcomes get linked automatically as positions close
- No-trade evaluations run via serverReflection

### What to monitor
- Are all source paths producing records? (direct, pending_fill, pending_expire, scale_in, no_trade, blocked_*)
- Are outcomes linking correctly? (linked_seq populated)
- Is no-trade sampling working? (not too many, not too few)
- Storage growth reasonable? (~24MB/month expected)

### Exit criteria
- 200+ trade snapshots with linked outcomes
- All source paths have at least 5 records each
- Orphan rate < 5%
- Zero impact on Brain performance confirmed

---

## Phase 3: Export + Analysis

### Objective
Extract and analyze accumulated data. Validate data quality. No model training.

### What gets built
- Admin route `/api/ml/export` — joins brain_decisions + at_closed → CSV/JSON
- Analysis script: feature correlations, modifier impact, gate tightness distribution
- Dashboard additions (optional): show snapshot capture stats

### Validation
- Export 100 records, manually verify 10 against chart data
- Label distribution matches known trade history
- Feature values are in expected ranges (no NaN, no impossible values)

### Rules
- Read-only queries only — no writes to brain_decisions from analysis
- Backup before any new route deployment

---

## Phase 4: Shadow Scorer Scaffolding

### Objective
Build infrastructure for a shadow ML scorer. Disabled by default. Zero cost when off.

### What gets built
- `server/services/brainShadowScorer.js` — disabled by default
- Migration flag: `MF.SHADOW_SCORER` (default: false)
- When enabled: loads model, scores each decision, logs alongside Brain decision
- Extends brain_decisions JSON blob with `shadow_score` and `shadow_action`
- Comparison logic: Brain decision vs Shadow vs actual outcome

### Model evaluation requirement
- 500+ labeled trades before activating shadow scoring with a real model
- Shadow scorer accuracy must exceed Brain accuracy on held-out test set before any live consideration
- Shadow mode NEVER affects real decisions

### Rules
- Scaffolding can be deployed anytime (it's inert when disabled)
- Model loading must have timeout + fallback
- Shadow scoring failure must not affect Brain cycle

---

## Completed Work

| Item | Date | Status |
|------|------|--------|
| Brain V3 (6 modules) | 2026-04-02 | DEPLOYED, 275/275 tests |
| Technical audit (12 sections) | 2026-04-03 | COMPLETE |
| Verification pass (10 claims) | 2026-04-03 | COMPLETE, all TRUE |
| ML data-layer blueprint | 2026-04-03 | COMPLETE |
| Roadmap corrections (GPT review) | 2026-04-03 | APPLIED |
| Phase 1 — Data Capture | 2026-04-03 | COMPLETE, 161/161 tests |
| Phase 2 — Linkage + Outcomes | 2026-04-03 | COMPLETE, 161/161 tests |

## Remaining Work

| Item | Depends On | Status |
|------|-----------|--------|
| Phase 1+2 implementation | User approval | COMPLETE (2026-04-03) |
| Data accumulation (2-4 weeks) | Phase 1+2 deployed | AWAITING DEPLOY |
| Phase 3 export + analysis | Accumulated data | NOT STARTED |
| Phase 4 scaffolding | Phase 3 validated | NOT STARTED |
| Model training + evaluation | 500+ labeled trades | NOT STARTED |

---

## Universal Rules (apply to every phase)

1. **Backup before every implementation step**
2. **Run full test suite after every change** — must pass at current count or above
3. **Stop after each phase** — verify before proceeding
4. **brainLogger is a pure observer** — never feeds values back into decision pipeline
5. **Every brainLogger call wrapped in try/catch** — logger failure must never crash Brain
6. **Zero behavior change** — same decisions, same execution, same outcomes
7. **Deploy → monitor 24h → confirm stable → proceed**
