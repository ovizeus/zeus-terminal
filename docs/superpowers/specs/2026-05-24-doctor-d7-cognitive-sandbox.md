# Doctor D-7: Cognitive Sandbox — A/B Module Testing

> **Status:** APPROVED 2026-05-24
> **Operator:** Ovi (wsov2@protonmail.com)
> **Builds on:** D-6 (snapshots + blame tree + conflict map)

## Goal

Run two variants of a Doctor/ML module simultaneously in shadow mode, compare their outputs, and promote the winner — using existing R6 abTesting infrastructure.

## Architecture

The sandbox wraps `R6_shadowMeta/abTesting.js` (already implemented but unused — 0 experiments) with a Doctor-specific orchestrator that:
1. Creates experiments targeting specific modules
2. Routes brain decisions through both variants (shadow, no trading impact)
3. Collects outcome data per variant
4. Compares via D-6 conflict map divergence analysis
5. Promotes winner via R5B versionRegistry

## Components

### 1. Sandbox Orchestrator (`cognitiveSandbox.js`)

**Exports:**
- `createExperiment({ moduleId, variantAConfig, variantBConfig, allocationPctB?, durationMs? })` → { experimentId }
- `routeDecision({ experimentId, decisionContext })` → { variant: 'A'|'B', output }
- `getExperimentStatus({ experimentId })` → { state, outcomesA, outcomesB, winnerSoFar }
- `completeExperiment({ experimentId })` → { winner, statsA, statsB, promoted }
- `listExperiments({ state? })` → array

**Flow:**
1. Admin creates experiment via API: "test confidenceDecay with threshold 0.3 vs 0.5"
2. Each brain cycle, sandbox routes to variant A or B (deterministic hash, default 50/50)
3. Both variants run in shadow (output recorded, not used for trading)
4. After duration expires (or manual complete), stats compared
5. Winner optionally promoted to production config

**Storage:** Uses existing `ml_experiments` + `ml_experiment_outcomes` tables from R6 abTesting (0 rows currently — first real use).

### 2. Sandbox API (3 endpoints in doctor.js)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/omega/doctor/sandbox/create` | Create new A/B experiment |
| GET | `/api/omega/doctor/sandbox/:id` | Get experiment status + stats |
| POST | `/api/omega/doctor/sandbox/:id/complete` | Complete experiment + promote winner |

### 3. Integration with D-6

- On experiment completion, auto-capture cognitive snapshot (before + after promotion)
- Conflict map shows divergence between pre/post-promotion state

## Constraints

- All shadow — zero trading impact
- Uses existing R6 abTesting.createExperiment / recordOutcome / completeExperiment
- Max 1 active experiment per module (prevent conflict)
- Admin-only endpoints
- Duration default: 24h, max: 7d

## File Map

| File | Action |
|------|--------|
| `server/services/ml/_doctor/cognitiveSandbox.js` | CREATE |
| `server/routes/doctor.js` | MODIFY (3 new endpoints) |
| `tests/unit/ml/doctorSandbox.test.js` | CREATE |
| `tests/unit/ml/doctorD7Routes.test.js` | CREATE |

## Testing

- `doctorSandbox.test.js`: create experiment, route decision, get status, complete + winner
- `doctorD7Routes.test.js`: 3 API endpoints + admin guard

## Out of Scope

- UI for sandbox management (API-only for now)
- Multi-module experiments (1 module per experiment)
- Cognitive Checkpoints (D-8)
