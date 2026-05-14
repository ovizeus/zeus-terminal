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
| `R7_communication/` | Inter-ring event bus (R7 ring) |

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
See `/root/.claude/projects/-root/memory/project_ml_v3_expert_acceptance_and_ux_scope_20260514.md`.

## Current Wave: 1A (DB Schema + Scaffolding)

See `/root/zeus-terminal/docs/superpowers/plans/2026-05-14-omega-wave-1a-db-schema-and-scaffolding.md`.
