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
- **Deployed:** PM2 reload `a9cd5f4`, PID 297379, uptime OK
- **Cron registered:** posClassRetention weekly Sunday 03:00 UTC (confirmed in logs)

### Step 3 blocking gates for Step 4:
- [ ] **Pre-existing failures = exactly 21** — CONFIRMED ✅ (3 suites, 21 tests)
- [ ] **Vector detection instrumented with real markers** — CONFIRMED ✅ (_classifySource on all 3 paths)
- [ ] **/api/srv-pos/shadow-report endpoint live** — CONFIRMED ✅ (GET returns data, POST accepts from client)
- [ ] **Operator browser monitoring: 1h, 0 divergences** — WAITING FOR OPERATOR
  - Ovi deschide Chrome → F12 → Console → filter "SRV-POS"
  - Verifică la 15min: `curl http://127.0.0.1:3000/api/srv-pos/shadow-report`
  - Confirmare operator: "0 divergences" SAU plan de acțiune

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
