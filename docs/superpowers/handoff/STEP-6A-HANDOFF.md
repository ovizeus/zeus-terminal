# Step 6a Handoff — Server-Authoritative Positions Canary DEMO

> Created: 2026-05-25T22:55Z | Pre-/clear snapshot for next session

## 1. Current State

- **HEAD:** `6d3808a` (docs: PROGRESS.md — Step 4 DONE summary + TODOs)
- **Tag:** `s2-step4-DONE`
- **PM2:** zeus online, PID 309488, uptime 35+m, restarts=135
- **Shadow:** 0 divergences sustained 1h (Step 5 soak PASSED)
- **Flag:** `SERVER_AUTHORITATIVE_POSITIONS = false` (current)
- **Tests:** 73 SRV-POS PASS, 7975 total (21 pre-existing failures in 3 unrelated suites)
- **TS errors:** 0 in state.ts / liveApi.ts / positionMutex.ts / exchangeGuard.ts / positionSource.ts

## 2. Step 4 Deployed + Step 5 Soak Passed

### Files modified (Step 4):
- `server/services/serverAT.js` — srvPosFlags in WS frame
- `client/src/utils/positionSource.ts` — NEW: resolveEffectiveFlag + buildPriceUpdateMap + detectOrphans (17 tests)
- `client/src/trading/liveApi.ts` — flag-gated: price-only + orphan detect when ON, legacy when OFF
- `client/src/core/state.ts` — flag-gated canonical write + dynamic shadow source + srvPosFlags cache
- `server/routes/srvPos.js` — POST /orphan-report with threshold alerts + AT suspend
- `client/src/components/PositionOrphanBadge.tsx` — NEW: orphan UI badge
- `client/src/components/trading/PositionTable.tsx` — badge wire

### Step 5 soak: 1h flag OFF, 6 checkpoints all GREEN.

## 3. Incident Report 22:26-22:50 UTC (Reference Only)

3 incidents during soak — ALL pre-existing, ZERO Step 4 involvement:

a) **7 order/place timeouts** on Binance Testnet — Binance infra issue (their backend forwarding layer). Error: "Timeout waiting for response from backend server."

b) **"Scheduler backpressure: critical_section:8"** — client-side `binanceScheduler.js` (Phase A.2). Working as designed: defers P3-P5 kline/ticker polls while order ops in-flight. 8 kline polls rejected during 10s+ order timeout retries.

c) **SERVER_AT_REQUIRED_FOR_LIVE** gate in logs — AT brain entries blocked when `SERVER_AT=false` on live mode (correct behavior, different path than `/api/order/place` manual orders).

Deep audit confirmed: Step 4 code is CLIENT-SIDE position source logic. Server order execution path UNTOUCHED. Zero positionMutex/SRV-POS log entries during soak.

DO NOT re-investigate unless incidents recur.

## 4. Step 6a — Scope

**Objective:** Flip flag ON for DEMO mode only.

**Change:**
```json
{
  "SERVER_AUTHORITATIVE_POSITIONS": true,
  "_SRV_POS_TESTNET_ENABLED": false,
  "_SRV_POS_REAL_ENABLED": false
}
```

**Behavior after flip:**
- Demo mode → server positions canonical, Step 4 code ACTIVE
- Testnet mode → flag OFF, legacy behavior unchanged
- Real mode → flag OFF, legacy behavior unchanged

**Verify after flip:**
1. PM2 reload
2. WS frame includes `srvPosFlags.master=true`
3. Browser test DEMO mode: open manual trade → position appears immediately, orphan badge NOT visible
4. Shadow report 0 divergences on demo
5. Soak 1h with checkpoints T+15/30/45/60

**PASS criteria:**
- Shadow = 0 divergences all checkpoints
- Browser: demo positions render correctly
- PM2 restarts unchanged
- Zero SRV-POS errors in logs
- Zero false orphan alerts

## 5. Rollback Procedure

**If Step 6a fails (soft rollback — flag only):**
1. Edit `data/migration_flags.json` → `SERVER_AUTHORITATIVE_POSITIONS: false`
2. `pm2 reload zeus`
3. Verify shadow = 0 immediately
4. Report to Ovi

**If flag rollback doesn't fix (hard rollback — code):**
1. `git reset --hard s2-step3-FINAL-clean`
2. `pm2 reload zeus`
3. Report CRITICAL to Ovi

## 6. Rules

- NO /clear during Step 6a
- NO file changes in parallel with flag flip
- NO unilateral rollback — Ovi decides
- STOP and report on ANY incident
- Anti-patterns caught 3x: NO duplicate logic in tests, NO CJS mirrors, NO expect(true)

## 7. Backups

**Git tags:**
| Tag | Commit | Purpose |
|-----|--------|---------|
| `s2-step3-FINAL-clean` | `2c5efd1` | Pre-Step 4 (safe rollback) |
| `s2-step4-PRE-CHANGES` | `2c5efd1` | Same |
| `s2-step4-mid-issues` | `62a5901` | After 4.4, before 4.4b fixes |
| `s2-step4-DONE` | `6d3808a` | Current HEAD |

**File backups:**
```
~/backups/zeus/step4/liveApi.ts.backup-1779744301
~/backups/zeus/step4/state.ts.backup-1779744301
~/backups/zeus/step4/zeus.db.backup-step4-1779744301
```

## 8. First Actions Next Session

After /clear, new session MUST:
1. `cat /root/zeus-terminal/docs/superpowers/handoff/STEP-6A-HANDOFF.md`
2. `cat /root/zeus-terminal/docs/superpowers/progress/srv-pos-progress.md`
3. `git log --oneline -5`
4. `git tag --list "s2-*"`
5. `pm2 status zeus`
6. WAIT for Ovi confirm → proceed Step 6a
