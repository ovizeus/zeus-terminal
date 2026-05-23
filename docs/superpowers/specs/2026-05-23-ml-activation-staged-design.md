# ML Activation — Audit + 3-Stage Staged Flip

> **Status:** APPROVED 2026-05-23
> **Operator:** Ovi (wsov2@protonmail.com)

## Scope

| Stage | Flag | Effect | Risk |
|---|---|---|---|
| **0** | — | Full audit ML subsystem (read-only) | Zero |
| **1** | `ML_INGEST_ENABLED=true` | brainLogger writes decision snapshots (observability only) | LOW |
| **2** | `ML_PIPELINE_SHADOW=true` | Ring5 pipeline runs shadow (no influence) | LOW |
| **3** | `ML_DEMO_INFLUENCE_ENABLED=true` | Ring5 modifies confidence on DEMO only | MEDIUM |

Soak between stages: operator decides manually when to advance.

## Stage 0 — Full Audit (pre-activation)

**Output:** `_review/audit/ML_ACTIVATION_AUDIT_20260523.md`

Checks:
1. Flag paths — trace each ML flag from migrationFlags.js → consumer code → what activates
2. Table dependencies — every INSERT/SELECT in ML modules → verify tables exist + schema correct
3. Ring5LearningService facade — verify functions + deps (thompsonSampler, influenceProposer, reflectionGate)
4. brainLogger — verify writes to ml_decision_snapshots + ml_decision_light (NOT dead ml_brain_log)
5. Doctor modules — 64 registered, how many functional vs seed-only?
6. Invariant violations — 1 existing row, what does it say?
7. Module quarantines — 4 rows, which modules and why?
8. Dead code — references to non-existent tables/functions
9. Circular dependencies — ML modules with circular imports

## Stage 1 — ML_INGEST_ENABLED=true

- **Activates:** brainLogger writes decision snapshots every brain cycle
- **Tables written:** ml_decision_snapshots, ml_decision_light
- **Trading impact:** ZERO — pure observer
- **Verify:** `SELECT COUNT(*) FROM ml_decision_snapshots` grows after 30s
- **Rollback:** flag false → PM2 reload

## Stage 2 — ML_PIPELINE_SHADOW=true

- **Activates:** Ring5 pipeline shadow calculations (Thompson sampling, bandit posteriors)
- **Tables written:** ml_bandit_evidence, ml_bandit_posteriors, ml_module_state
- **Trading impact:** ZERO — shadow returns phase2 decision untouched
- **Verify:** ml_bandit_evidence rows grow, ml_module_state trust scores update
- **Rollback:** flag false → PM2 reload

## Stage 3 — ML_DEMO_INFLUENCE_ENABLED=true

- **Activates:** Ring5 modifies confidence on DEMO decisions only
- **Mechanism:** confidence ±adjustment from bandit, reasons array updated, tier re-evaluated
- **Trading impact:** DEMO only. TESTNET + LIVE untouched.
- **Verify:** brain_decisions with layeredBy='ring5-influence-applied'
- **Rollback:** flag false → PM2 reload

## Out of Scope

- ML_TESTNET_INFLUENCE_ENABLED — after DEMO soak green
- ML_LIVE_INFLUENCE_ENABLED — separate spec + operator opt-in
- ML_BANDIT_AUTO_APPLY_MINOR — stays false
- No new code — audit + flag flips + verify only

## Rules Applied

- Backup before any flag flip
- Verify-twice before commit
- No chained risky changes (1 flag per stage)
- Audit-first for hot path changes
- TDD for any code fix discovered during audit
