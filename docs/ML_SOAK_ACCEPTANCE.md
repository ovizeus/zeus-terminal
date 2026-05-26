# ML Stage Promotion — Soak Acceptance Criteria

> **Status:** DRAFT v2 — Phone Claude reviewed, awaiting operator final approval.
> **Created:** 2026-05-26 | **DD3 Sub-task 3** | **Revised:** 2026-05-26

## Overview

OMEGA ML uses a 5-stage flag-gated promotion ladder. Each stage must pass acceptance criteria before the next flag is flipped. All promotions are operator-initiated (manual flag flip + PM2 reload) with sign-off audit trail.

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
| Minimum soak | **7 days** | data integrity test |
| Data volume | **100+ ml_decision_snapshots** | `SELECT COUNT(*) FROM ml_decision_snapshots` |
| Schema errors | 0 | PM2 logs grep `ML_INGEST` |
| brain_decisions flowing | >0 rows/hour | `SELECT COUNT(*) FROM brain_decisions WHERE ts > ?` |

**Operator action:** `ML_PIPELINE_SHADOW=true` in migration_flags.json + PM2 reload.

---

## Stage 2 → Stage 3 (Shadow → DEMO Influence)

| Criterion | Value | Source |
|-----------|-------|--------|
| Minimum soak | **21 days** | extended for multiple market regime coverage |
| Data volume | **500+ ml_decision_snapshots** | |
| Bandit cells seeded | Version active + preReg registered | `/api/ring5/influence/status` |
| Bandit posteriors | ≥30 obs per cell in **≥70% of active cells** | `/api/ring5/cells` |
| Influence audit | All entries = `skipped/not_eligible` (not errors) | `/api/ring5/audit` |
| Auto-quarantines | 0 triggered in last 7 days | mlScanCron logs |

**Operator action:** `ML_DEMO_INFLUENCE_ENABLED=true` + PM2 reload.

---

## Stage 3 → Stage 4 (DEMO → TESTNET Influence) — GATE

| Criterion | Value | Source |
|-----------|-------|--------|
| Minimum soak | **30 days** | |
| DEMO trades influenced | **1000+** | `SELECT COUNT(*) FROM ml_influence_audit WHERE status='accepted'` |
| Bandit posteriors | ≥30 obs in **≥70% of active cells** | `/api/ring5/cells` |
| Hit rate minimum (DEMO) | **≥ 0.52** | ml_attribution_events (REQUIRES DD2 FIX) |
| Hit rate target (DEMO) | **≥ 0.55** (recommended go-ahead) | |
| Attribution linkage | **≥ 80%** brain entries linked to trades | REQUIRES DD2 FIX |
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
| Minimum soak | **90 days** | extended — real money requires high confidence |
| TESTNET trades influenced | **3000+** | ml_influence_audit |
| Hit rate (TESTNET) | **≥ 0.58** | ml_attribution_events |
| Max drawdown (TESTNET) | **< 7%** | at_closed PnL analysis |
| Bandit posterior stability | Changed **< 5%** in last 30 days | posterior alpha/beta delta |
| 7-day stability window | No major events/anomalies before flip | operator judgment |
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
| Drawdown spike | > 10% in 24h | AUTO halt + Telegram alert | NEW — to be wired |
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

## Sign-Off Process

Each stage promotion requires an audit trail entry:

| Field | Description |
|-------|-------------|
| operator_user_id | Who authorized the promotion |
| timestamp_utc | When |
| stage_from | Previous stage |
| stage_to | New stage |
| spec_version | Which version of this spec was reviewed |
| criteria_met | JSON snapshot of all criteria values at promotion time |

Implementation: future `/api/ml/stage-promote` endpoint (after DD2 fix). Until then, manual flag flip + operator confirms in chat/Telegram.

---

## DD2 Attribution Fix — COMPLETED 2026-05-26

Stage 3→4 promotion blocker RESOLVED via 3 commits:

| Fix | Commit | Impact |
|-----|--------|--------|
| Phantom entries | `0711b35` | logDecision after AT execution — no more false 'entry' records |
| Attribution digest | `d2153c6` | MD5 hash threads decision→close via ml_decision_snapshots |
| Pruning protection | `932b51e` | linked_seq records preserved from pruning |

**Baseline pre-fix:** 699/721 phantom entries (96.9%), 0.05% attribution linkage.

**Expected post-fix:** Phantom rate <5%, attribution linkage >80% (via decision_digest).

**Known limitation:** Digest lookup uses `ORDER BY created_at DESC LIMIT 1` — approximation acceptable for Stage 3-4. Refinement needed for Stage 5 REAL (thread digest through position data).

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

- [x] DD2 attribution digest fix — RESOLVED 2026-05-26 (3 commits: 0711b35, d2153c6, 932b51e)
- [ ] DD2 dedicated tests (phantom + digest + prune guard) — ~1h
- [ ] DD2 digest lookup refinement for Stage 5 REAL (thread through position data)
- [ ] `evaluatePerformance` cron wiring (DEFERRED until metrics accumulate post-DD2)
- [ ] Automated soak validation script (equivalent to S7's s7-sanity.sh)
- [ ] `/api/ml/stage-promote` sign-off endpoint
- [ ] Drawdown spike >10%/24h degrade trigger wiring

---

## Numbers Summary — FINAL PROPOSED

| Gate | Min Days | Min Trades | Hit Rate | Drawdown | Notes |
|------|----------|------------|----------|----------|-------|
| 1→2 | 7 | 100 snapshots | N/A | N/A | Data collection only |
| 2→3 | 21 | 500 snapshots | N/A | N/A | Shadow, multiple market regimes |
| 3→4 | 30 | 1000 influenced | ≥ 0.52 (min) / 0.55 (target) | N/A | DEMO, virtual money |
| 4→5 | 90 | 3000 influenced | ≥ 0.58 | < 7% | TESTNET → REAL, high confidence |

Operator decides final values. These are Phone Claude recommended + operator reviewed.
