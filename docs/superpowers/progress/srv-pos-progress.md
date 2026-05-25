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
- **Commit:** `6a87078` / tag `s2-step2`
- **Files modified:**
  - `client/src/core/state.ts` — shadow positions, comparison timer, seq reset detection, newer-wins mutex, vector counters, diagnostics function
- **Tests:** 7 PASS (seq reset, mutex, shadow comparison, vector counters)
- **Build:** Vite PASS (717ms), 7922 jest PASS (21 pre-existing unrelated failures)
- **Diagnostics:** `w._srvPosDiagnostics()` exposed for runtime inspection
- **Tag:** `s2-step2`

## Step 3: Deploy shadow, monitor divergences 1h — PENDING
- Requires: PM2 reload + 1h soak watching shadow logs

---

## ⚠️ CONTEXT GATE
Steps 1-3 done in current session.
**Before Step 4 → /clear or new session. PROGRESS.md + plan ensure recovery.**
Step 4 touches `liveApi.ts` (HIGH risk) — FRESH CONTEXT MANDATORY.
