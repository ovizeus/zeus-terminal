# ML Stage Promotion — Soak Acceptance Criteria

> **Status:** DRAFT — awaiting operator review of proposed numbers.
> **Created:** 2026-05-26 | **DD3 Sub-task 3**

## Overview

OMEGA ML uses a 5-stage flag-gated promotion ladder. Each stage must pass acceptance criteria before the next flag is flipped. All promotions are operator-initiated (manual flag flip + PM2 reload).

| Stage | Flag | What It Does |
|-------|------|-------------|
| 1 — Ingest | `ML_INGEST_ENABLED=true` | Collect brain_decisions → ml_decision_snapshots |
| 2 — Shadow | `ML_PIPELINE_SHADOW=true` | Ring5 runs parallel, proposes, records audit (no influence) |
| 3 — DEMO | `ML_DEMO_INFLUENCE_ENABLED=true` | Ring5 proposals applied on DEMO trades (virtual money) |
| 4 — TESTNET | `ML_TESTNET_INFLUENCE_ENABLED=true` | Ring5 proposals applied on TESTNET trades |
| 5 — REAL | `ML_LIVE_INFLUENCE_ENABLED=true` | Ring5 proposals applied on REAL trades |

---

## Stage 1 → Stage 2 (Ingest → Shadow)

| Criterion | Value | Source |
|-----------|-------|--------|
| Minimum soak | **7 days** `⚠️ REVIEW` | proposed |
| Data volume | **100+ ml_decision_snapshots** | proposed |
| Schema errors | 0 | PM2 logs grep `ML_INGEST` |
| brain_decisions flowing | >0 rows/hour | `SELECT COUNT(*) FROM brain_decisions WHERE ts > ?` |

**Operator action:** `ML_PIPELINE_SHADOW=true` in migration_flags.json + PM2 reload.

---

## Stage 2 → Stage 3 (Shadow → DEMO Influence)

| Criterion | Value | Source |
|-----------|-------|--------|
| Minimum soak | **14 days** `⚠️ REVIEW` | proposed |
| Data volume | **500+ ml_decision_snapshots** | proposed |
| Bandit cells seeded | Version active + preReg registered | `/api/ring5/influence/status` |
| Influence audit | All entries = `skipped/not_eligible` (not errors) | `/api/ring5/audit` |
| Auto-quarantines | 0 triggered in last 7 days | mlScanCron logs |

**Operator action:** `ML_DEMO_INFLUENCE_ENABLED=true` + PM2 reload.

---

## Stage 3 → Stage 4 (DEMO → TESTNET Influence) — GATE

| Criterion | Value | Source |
|-----------|-------|--------|
| Minimum soak | **30 days** `⚠️ REVIEW` | proposed |
| DEMO trades influenced | **1000+** | `SELECT COUNT(*) FROM ml_influence_audit WHERE status='accepted'` |
| Bandit posteriors | ≥30 obs in **50%+ of active cells** | `/api/ring5/cells` |
| Hit rate (DEMO) | **≥ 0.50** `⚠️ REVIEW` | ml_attribution_events (REQUIRES DD2 FIX) |
| Calibration quality | ≥ 0.6 | `shadowMode.evaluatePerformance` |
| Drift score | ≤ 0.25 | `shadowMode.evaluatePerformance` |
| Auto-quarantines | 0 in last 14 days | mlScanCron logs |
| PM2 stability | 0 crash-restarts during soak | PM2 restart count delta |

**Blockers:**
- DD2 attribution digest fix required (currently 0% linkage between snapshots and outcomes)
- `evaluatePerformance` cron deferred until metrics source exists

**Operator action:** `ML_TESTNET_INFLUENCE_ENABLED=true` + PM2 reload.

---

## Stage 4 → Stage 5 (TESTNET → REAL Influence) — CRITICAL GATE

| Criterion | Value | Source |
|-----------|-------|--------|
| Minimum soak | **60 days** `⚠️ REVIEW` | proposed |
| TESTNET trades influenced | **2000+** | ml_influence_audit |
| Hit rate (TESTNET) | **≥ 0.55** `⚠️ REVIEW` | ml_attribution_events |
| Max drawdown (TESTNET) | **< 15%** `⚠️ REVIEW` | at_closed PnL analysis |
| Bandit posterior stability | Changed < 10% in last 30 days | posterior alpha/beta delta |
| shadowMode stage | ≥ `limited_probation` with 28-day min met | `shadowMode.hasMinDuration` |
| Auto-quarantines | 0 in last 30 days | mlScanCron |
| PM2 stability | 0 crash-restarts during soak | PM2 restart count delta |

**Operator action:** `ML_LIVE_INFLUENCE_ENABLED=true` + PM2 reload. 24h observation window before any further risk increase.

---

## Degrade Triggers (Any Stage, Automatic)

These triggers exist in code and are checked by crons:

| Trigger | Threshold | Action | Code |
|---------|-----------|--------|------|
| Hit rate drop | < 0.45 | Auto-degrade 1 stage | `shadowMode.DEFAULT_DEGRADE_THRESHOLDS.hit_rate_min` |
| Calibration drop | < 0.6 | Auto-degrade 1 stage | `shadowMode.DEFAULT_DEGRADE_THRESHOLDS.calibration_quality_min` |
| Drift spike | > 0.25 | Auto-degrade 1 stage | `shadowMode.DEFAULT_DEGRADE_THRESHOLDS.drift_max` |
| Feature bad performance | 100+ trades, Brier > null, p<0.01, 2+ bad regimes | Auto-quarantine feature | `autoQuarantine.THRESHOLDS` |
| Shadow/probation min | 28 days each | Block advance if not met | `shadowMode.MIN_DURATION_DAYS_PER_STAGE` |

---

## Tiered Promotion (Config Changes)

| Tier | Delta Range | DEMO/TESTNET | REAL |
|------|------------|-------------|------|
| MINOR | < 0.05 | Auto-apply if `ML_BANDIT_AUTO_APPLY_MINOR=true` | Always operator approval |
| MAJOR | 0.05 – 0.20 | Operator approval queue | Operator approval queue |
| CRITICAL | ≥ 0.20 or charter/risk_config | Operator approval + 24h cooldown | Operator approval + 24h cooldown |

Source: `tieredPromotion.js` lines 38-40.

---

## Rollback Procedure

If post-promotion metrics degrade:

1. Flip influence flag to `false` (immediate, <1 min)
2. PM2 reload
3. Verify shadow report = 0 divergences
4. Investigate via: `ml_influence_audit`, `brain_decisions`, `ml_attribution_events`
5. Update this spec if new criteria discovered

---

## Manual Override

Operator can halt ML at any time:
- Flag flip any `ML_*_ENABLED` to false + PM2 reload
- `ML_CRON_SCAN_ENABLED=false` to stop auto-quarantine scanning
- Direct DB: `UPDATE ml_bandit_posteriors SET status='SUSPENDED'`

---

## Open Items

- [ ] DD2 attribution digest fix (BLOCKING Stage 3→4 gate)
- [ ] `evaluatePerformance` cron wiring (DEFERRED until metrics source)
- [ ] Automated soak validation script (equivalent to S7's s7-sanity.sh)
- [ ] Operator sign-off process for each stage promotion

---

## Proposed Numbers Summary — `⚠️ OPERATOR REVIEW`

| Gate | Min Days | Min Trades | Hit Rate | Notes |
|------|----------|------------|----------|-------|
| 1→2 | 7 | 100 snapshots | N/A | Data collection only |
| 2→3 | 14 | 500 snapshots | N/A | Shadow mode, no influence |
| 3→4 | 30 | 1000 influenced | ≥ 0.50 | DEMO influence, virtual money |
| 4→5 | 60 | 2000 influenced | ≥ 0.55 | TESTNET, real exchange but testnet funds |

These numbers are proposed based on crypto trading ML industry practice. Operator decides final values.
