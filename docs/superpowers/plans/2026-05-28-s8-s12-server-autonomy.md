# S8-S12 Server Brain Autonomy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Zeus server brain operates autonomously — opens/closes positions without browser. Server-authoritative execution with ML influence active.

**Architecture:** Flip SERVER_BRAIN + SERVER_AT from shadow→live. Phased: testnet first (S8), reflection enforcement (S9), single-user live (S10), global rollout (S11), cleanup (S12).

**Prerequisites (ALL must be GREEN before starting):**
- [ ] WS Proxy soak 48h clean (current — soak started 2026-05-28)
- [ ] ML influence observations growing (currently 7/30 threshold)
- [ ] Zero Binance bans in 48h
- [ ] Doctor HEALTHY 48h continuous
- [ ] Rollback drill rehearsed (flag flip <30s)

---

## S8 — TESTNET Autonomous (est. 2-3 sessions)

**What:** Server brain decides + server AT executes on TESTNET. Browser optional.

### Task S8.1: Parity validation — server vs client decisions

**Files:** `server/services/serverBrain.js`, new `tests/integration/brainParity.test.js`

- [ ] Enable `SERVER_BRAIN=true` (flag flip)
- [ ] Run 24h with browser open — log both server + client decisions
- [ ] Compare: direction match rate, confidence delta, score delta
- [ ] Acceptance: >95% direction match, <5% confidence delta avg
- [ ] If FAIL: investigate divergence root cause before proceeding

### Task S8.2: Server AT testnet execution

**Files:** `server/services/serverAT.js`, `data/migration_flags.json`

- [ ] Flip `SERVER_AT=true` (testnet only — SERVER_AT_TESTNET already true)
- [ ] Server brain decision → serverAT.processBrainDecision → placeEntry on testnet
- [ ] Verify: position opens on Binance testnet WITHOUT browser
- [ ] Verify: SL placed automatically (_placeProtectionForExistingEntry)
- [ ] Verify: DSL attaches and manages exit
- [ ] Verify: position closes correctly (SL hit, TP hit, DSL exit)

### Task S8.3: Kill switch + panic button verification

- [ ] `POST /api/at/halt` — immediate halt all entries (existing endpoint)
- [ ] Telegram panic button — `/halt` command stops everything
- [ ] Flag rollback: SERVER_AT=false → PM2 reload → all new entries blocked <30s
- [ ] Verify: existing positions NOT force-closed on halt (just no new entries)

### Task S8.4: Testnet soak — 7 days autonomous

- [ ] Close all browser tabs — server runs alone
- [ ] Daily check: positions opened? PnL reasonable? SL placed? No orphans?
- [ ] Doctor HEALTHY throughout
- [ ] Zero crashes, zero bans
- [ ] Balance stable (no unexplained losses)

**GO/NO-GO gate:** 7-day soak clean → proceed S9. Any P0 → stop, investigate.

---

## S9 — Reflection Enforcement (est. 1 session)

**What:** Reflection becomes a GATEKEEPER, not just observer. Bad decisions get blocked.

### Task S9.1: Reflection gate activation

**Files:** `server/services/serverReflection.js`

- [ ] Reflection currently logs concerns but doesn't block
- [ ] Enable blocking mode: reflection score < threshold → brain decision REJECTED
- [ ] Audit log: `REFLECTION_BLOCKED` with reasons
- [ ] Telegram alert on block

### Task S9.2: Reflection soak — 3 days

- [ ] Monitor: how many decisions blocked vs allowed?
- [ ] If >30% blocked → threshold too aggressive, tune
- [ ] If <5% blocked → threshold too permissive, investigate
- [ ] Target: 10-20% block rate (filters worst decisions)

**GO/NO-GO gate:** 3-day soak, block rate 10-20%, zero false-blocks on profitable trades.

---

## S10 — LIVE Opt-in uid=1 Only (est. 2-3 sessions)

**What:** First REAL money server-driven trade. Operator (uid=1) only.

### Task S10.1: Pre-flight safety

- [ ] Rollback drill: SERVER_AT=false + PM2 reload timed <30s (3 runs)
- [ ] Emergency: Telegram `/halt` works from phone
- [ ] Balance reference set (snapshot pre-S10)
- [ ] Max position size capped (size=100 USDT initial)
- [ ] Max daily loss capped (killPct=3%)
- [ ] SL mandatory enforcement verified (HTTP 423 on missing SL)

### Task S10.2: LIVE flag flip

**Files:** `data/migration_flags.json`

- [ ] `BYBIT_DRY_RUN_ONLY=false` (if using Bybit) OR keep Binance testnet
- [ ] Server brain LIVE execution enabled for uid=1
- [ ] First trade: SMALL (100 USDT), monitored
- [ ] Verify on exchange UI: position exists, SL exists, correct size

### Task S10.3: LIVE soak — 14 days uid=1

- [ ] Daily audit: PnL, SL coverage 100%, no orphans
- [ ] Weekly: compare server performance vs manual trades
- [ ] Doctor HEALTHY, zero P0 alerts
- [ ] No emergency closes (SL trigger guard working)
- [ ] ML influence starts applying (bandit reaches 30 obs)

**GO/NO-GO gate:** 14-day clean, SL 100%, PnL reasonable, zero incidents.

---

## S11 — LIVE Global Phased Rollout (est. 3-4 sessions)

**What:** All users get server-autonomous trading. Phased: 25% → 50% → 100%.

### Task S11.1: Multi-user infrastructure

- [ ] Per-user AT state isolation verified (already implemented)
- [ ] Per-user kill switch independent
- [ ] Per-user balance tracking independent
- [ ] Load test: 10 concurrent users simulated

### Task S11.2: Phased rollout

- [ ] Phase A (25%): uid=1 + uid=2 (Mirela test account)
  - 7 days soak, both users active
  - Cross-user: no interference, independent decisions
- [ ] Phase B (50%): add uid=5, uid=11
  - 7 days soak
- [ ] Phase C (100%): all active users
  - 7 days soak

### Task S11.3: Scale monitoring

- [ ] API weight budget: <1000w/min total (currently ~200)
- [ ] PM2 memory: <500MB
- [ ] Brain cycle latency: <100ms per user
- [ ] WS proxy: handles all subscribers without backpressure drops

**GO/NO-GO gate:** 100% rollout stable 7 days, zero user-impacting incidents.

---

## S12 — Client AT Dead Code Cleanup (est. 1 session)

**What:** Remove client-side trade execution code. Server is sole executor.

### Task S12.1: Identify dead code

- [ ] `client/src/trading/autotrade.ts` — placeAutoTrade, executeLiveEntry paths
- [ ] ~1500 LOC estimated removable
- [ ] Keep: AT UI controls, position display, journal, DSL display
- [ ] Remove: trade decision logic, Binance order placement from client

### Task S12.2: Remove + verify

- [ ] Delete identified dead code
- [ ] Build clean
- [ ] All UI features still work (display, controls)
- [ ] Trades still execute (server-side)
- [ ] Playwright: full UI verification

### Task S12.3: Final cleanup

- [ ] Remove CLIENT_BRAIN flag
- [ ] Remove ALT_WS_FEEDS code paths (WS proxy handles everything)
- [ ] Update CLAUDE.md / onboarding docs
- [ ] Tag: `s12-complete-server-authoritative`

---

## Timeline estimate

| Stage | Duration | Cumulative |
|-------|----------|-----------|
| S8 testnet autonomous | 2 weeks (incl 7d soak) | Week 2 |
| S9 reflection enforcement | 1 week (incl 3d soak) | Week 3 |
| S10 LIVE uid=1 | 3 weeks (incl 14d soak) | Week 6 |
| S11 LIVE global phased | 4 weeks (incl 3×7d soak) | Week 10 |
| S12 cleanup | 1 week | Week 11 |

**Total: ~11 weeks realistic from start.**

---

## Rollback at any stage

```
# Instant rollback (<30s):
SERVER_BRAIN=false   # brain stops deciding
SERVER_AT=false      # AT stops executing  
→ PM2 reload
→ Zeus reverts to client-driven mode (browser required)
→ Existing positions NOT affected (stay on exchange)
```

---

## Discipline

- 1 commit per task with tag
- Operator GO between every stage (S8→S9→S10→S11→S12)
- Soak periods are HARD gates — no skip
- Any P0 incident → STOP, investigate, fix, restart soak
- Phone Claude sub-audit on S10 (first real money)
- Daily audit during soak: `/api/omega/doctor/state` + PM2 logs + balance check
