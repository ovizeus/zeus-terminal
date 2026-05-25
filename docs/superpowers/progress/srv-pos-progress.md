# Server-Authoritative Positions — Progress Tracker

> Plan: `docs/superpowers/plans/2026-05-25-server-authoritative-positions.md` (v3)

## Step 1: Feature flag + migration + audit retention cron — DONE
- **Commit:** `b357f71` / tag `s2-step1`
- **Files modified:**
  - `server/migrationFlags.js` — added SERVER_AUTHORITATIVE_POSITIONS + _SRV_POS_TESTNET_ENABLED + _SRV_POS_REAL_ENABLED
  - `data/migration_flags.json` — all 3 flags = false
  - `server/services/database.js` — migration 404_position_classifications
  - `server/cron/posClassRetention.js` — NEW, weekly 30d prune Sunday 03:00 UTC
  - `server.js` — cron wiring
- **Tests:** 13 PASS (4 cron + 3 flag + 6 migration)
- **Diagnostics:** table exists on prod DB, flag defaults verified
- **Tag:** `s2-step1`

## Step 2: Shadow mode READ-ONLY + seq reset — DONE
- **Commit:** `6a87078` / tag `s2-step2` + `8b7ae2c` (vector fix) + `a9cd5f4` (CSRF fix)
- **Files modified:**
  - `client/src/core/state.ts` — shadow positions, comparison timer, seq reset detection, newer-wins mutex, vector counters, _reportDivergence POST
  - `client/src/trading/liveApi.ts` — _classifySource: 'sync_merge' marker
  - `server/routes/srvPos.js` — NEW endpoint: POST+GET /shadow-report, GET /status
  - `server.js` — route mount pre-auth
- **Tests:** 8 shadow + 8 route = 16 PASS
- **Build:** Vite PASS (727ms)
- **Full jest:** 21 failed (pre-existing, same 3 suites), 7931 passed
- **Pre-existing failures verified:** executeLiveEntryCore, exchangeRoutes, order-place-flow (not touched by SRV-POS)
- **Vector instrumentation:**
  - `_classifySource: 'ws_push'` — state.ts _mapServerPos
  - `_classifySource: 'sync_merge'` — liveApi.ts exchange sync
  - `_classifySource: 'boot_resume'` — state.ts localStorage restore
- **Diagnostics exposed:**
  - Browser: `window._srvPosDiagnostics()` (vectors, writeDrops, shadow counts, lastFrameSeq)
  - Server: `curl http://127.0.0.1:3000/api/srv-pos/status` (flags + report count)
  - Server: `curl http://127.0.0.1:3000/api/srv-pos/shadow-report` (divergence history)
  - PM2 logs: `pm2 logs zeus | grep SRV-POS`
- **Tag:** `s2-step2` (base), head at `a9cd5f4`

## Step 3: Deploy shadow, monitor divergences — IN PROGRESS
- **Deployed:** PM2 reload `9fc0a15` (security-hardened), uptime OK
- **Cron registered:** posClassRetention weekly Sunday 03:00 UTC (confirmed in logs)
- **Security added:** POST rate limit 5/min per IP + origin validation
- **Dead code cleaned:** _shadowPositions, _writeSeqCounter, _positionWriteLock removed (Step 4 re-adds)
- **Deep look C result:** 0 real issues found (6 items checked, all safe)

### Step 3 blocking gates for Step 4:
- [x] **Pre-existing failures = exactly 21** — CONFIRMED (3 suites: executeLiveEntryCore, exchangeRoutes, order-place-flow)
- [x] **Vector detection instrumented with real markers** — CONFIRMED (_classifySource on ws_push/sync_merge/boot_resume)
- [x] **/api/srv-pos/shadow-report endpoint live** — CONFIRMED (rate-limited, origin-checked)
- [x] **Security review (A.1):** x-zeus-request custom header (CSRF-proof, no Host injection vuln)
- [x] **Multi-tab decision (A.2):** Option C accepted, documented in code
- [x] **Rate limit tests (A.3):** black-box HTTP buffer cap + rate limit + window reset (12 tests)
- [x] **_postTimestamps leak (fix 3):** 5min cleanup interval prevents Map growth
- [x] **Mutex (fix 4):** Newer-wins live on BOTH paths (state.ts WS + liveApi.ts sync). Race protected NOW
- [x] **Shallow copy (fix 5):** _mapServerPos returns new objects, .slice() safe
- [x] **Deep look (C):** 0 real issues, dead code cleaned, plan updated
- [x] **CRITICAL FIX: liveApi mutex return null (was balance:0 = false data)**
  - Mutex acquire moved to function START (before any TP writes)
  - Return null on drop — callers receive null safely, TP values unchanged
- [x] **CORS preflight verified:** No Access-Control-Allow-* → cross-origin POST blocked
- [x] **11 mutex tests import REAL positionMutex.ts** (ts-jest, CJS mirror deleted, zero duplicate code)
- [x] **Zero fake tests** (_setCounterForTest for real interleave simulation, no expect(true))
- [x] **TS errors verified per-file** — 0 errors in state.ts/liveApi.ts/positionMutex.ts
- [x] **Window exports consistent** — all underscore prefix (_srvPosDiagnostics, _acquirePositionWrite)
- [x] **Boot mutex always-acquire** — no skip scenario, user always sees restored positions
- [x] **liveApi mutex at function START** — return null on drop (was {balance:0} = false data BUG)
- [x] **Multi-exchange forward-compat — ALL 3 hooks shipped:**
  - H1: migration 405 (exchange column DEFAULT 'binance')
  - H2: server getFullState() returns `exchange: us.exchange || 'binance'`
  - H2b: client guard skips frames from different exchange (inert until multi-ex)
  - H3: _classifyExchange marker on ws_push/sync_merge/boot_resume
- [x] **Multi-exchange timeline memorized** — Bybit Jun, OKX Jul, Hyper Aug-Sep (DEX last)
- [ ] **Operator browser monitoring: 1h, 0 divergences** — WAITING FOR OPERATOR
  - HEAD at `1ffcc11` / tag `s2-step3-FINAL-clean`
  - 44 SRV-POS tests PASS, Vite PASS, 0 TS errors

### Monitoring checklist (operator can run any time):
```bash
# Divergence report (should show totalDivergences: 0)
curl -s http://127.0.0.1:3000/api/srv-pos/shadow-report | python3 -m json.tool

# Flag status
curl -s http://127.0.0.1:3000/api/srv-pos/status | python3 -m json.tool

# PM2 logs for SRV-POS entries
pm2 logs zeus --lines 200 --nostream 2>&1 | grep -i "SRV-POS\|shadow"

# Rate state
pm2 logs zeus --lines 50 --nostream 2>&1 | grep "rate_state"

# Position classifications table rows
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT COUNT(*) FROM position_classifications"

# Brain producing
pm2 logs zeus --lines 50 --nostream 2>&1 | grep "brain.*cycle\|BRAIN" | tail -5
```

---

## ⚠️ CONTEXT GATE
Steps 1-3 done in current session.
**Before Step 4 → /clear or new session. PROGRESS.md + plan ensure recovery.**
Step 4 touches `liveApi.ts` (HIGH risk) — FRESH CONTEXT MANDATORY.
