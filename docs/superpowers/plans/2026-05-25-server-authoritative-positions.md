# Server-Authoritative Positions — Eliminate AT/Manual Misclassification

> **Status:** PLAN v3 (7 operator corrections applied) — APPROVED
> **Priority:** HIGH — bug reported 3+ times, 5 loss vectors identified
> **Risk:** Real money misclassification if done wrong

## Context Management Protocol

| Steps | Risk | Context Rule |
|-------|------|-------------|
| 1-3 | LOW/MEDIUM | OK in current session |
| 4 | HIGH (liveApi.ts) | **/clear or new session MANDATORY** |
| 5-7 | MEDIUM | Fresh session recommended |
| 8 | HIGH | Separate spec + separate session |

PROGRESS.md (`docs/superpowers/progress/srv-pos-progress.md`) tracks state across sessions.
Plan file is the canonical reference for context recovery.

## Problem

AT positions appear in Manual Trade panel. 5 identified loss vectors where `autoTrade` flag gets lost between server → client:

| Vector | Location | Mechanism | Fixed by this plan? |
|--------|----------|-----------|-------------------|
| #1 | `_normalizePositionRow` server | autoTrade undefined + sourceMode null → false | ✅ YES — server always has autoTrade |
| #2 | WS reconnect race | `/api/at/state` vs `at_update` race | ✅ YES — single source, no merge |
| #3 | `_mapServerPos` client | Server omits field + no existing → DEFAULT FALSE | ✅ YES — server positions are canonical |
| #4 | Boot race | liveApiSyncState before _lastServerPositions | ✅ YES — no liveApiSyncState for positions |
| #5 | ManualTradePanel filter | null/undefined autoTrade = manual | ✅ YES — server always provides boolean |

**ALL 5 VECTORS ELIMINATED** by making server the sole position source.

## Architecture Change

```
BEFORE (broken):
  Server AT → _positions[] (has autoTrade)
  Client liveApi → Binance getPositions() (NO autoTrade)
  Client MERGES both → autoTrade lost in merge race
  ManualTradePanel reads merged → misclassified

AFTER (fix):
  Server AT → _positions[] (has autoTrade) → WS push to client
  Client reads ONLY server WS state for position list
  Binance getPositions() used ONLY for mark price + uPnL update
  ManualTradePanel reads server-authoritative → always correct
```

## Feature Flag

```javascript
SERVER_AUTHORITATIVE_POSITIONS: false  // default OFF — flip per canary schedule
```

When `true`: client position list = server WS `state.livePositions` + `state.demoPositions`
When `false`: client position list = legacy liveApi merge (current behavior)

## Auto-Rollback Threshold

```
IF divergence_rate > 20% in ANY 5-minute window THEN:
  1. Log CRITICAL alert
  2. Auto-flip SERVER_AUTHORITATIVE_POSITIONS = false (runtime only, no file write)
  3. Push Telegram alert to operator (rate-limited: max 1/60s, grouped)
  4. Resume legacy path
  5. NEVER auto-flip back to true — operator must manually re-enable
```

**Telegram alert template:**
```
🚨 SRV-POS AUTO-ROLLBACK
{N} divergences in last 60s
Top vector: v{X} ({pct}%)
Symbols: {sym1}, {sym2}
Flag auto-flipped to FALSE
```
Rate limit: max 1 alert per 60s. Batch divergences into single message.

## WS Frame Versioning

Server `getFullState()` returns `seq: ++_wsFrameSeq` (monotonic).
Client tracks `_lastAppliedFrameSeq` (state.ts line 1000).

Rule: **only apply frame if `frame.seq > _lastAppliedFrameSeq`**. Already implemented.

In-flight old frames: if client receives frame with lower seq → SKIP (dedup gate at line 1000).

**SEQ RESET on PM2 reload:**
Server restarts → seq=1. Client has seq=50000 → ALL new frames SKIP-ed.
Fix: client detects "seq dropped by >50%" → reset `_lastAppliedFrameSeq = 0` + log `SRV-POS: seq reset detected (old={N}, new={M}), tracker reset`.
This handles PM2 reload, server crash, cluster worker replacement.

## In-Flight Positions (already classified)

On flag flip from false → true:
- Positions already in `TP.livePositions` with wrong `autoTrade` → IMMEDIATELY replaced by server positions
- No gradual migration — server state is canonical, replaces client state atomically
- Any position in client but NOT in server → logged as orphan, kept visible 30s, then removed

## Audit Log Table

New migration: `position_classifications` (NOT ml_* — this is trading infra)

```sql
CREATE TABLE position_classifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    pos_seq INTEGER,
    symbol TEXT,
    side TEXT,
    classified_as TEXT NOT NULL CHECK(classified_as IN ('AT', 'MANUAL', 'UNKNOWN')),
    vector TEXT,
    old_said TEXT,
    new_said TEXT,
    flag_state TEXT NOT NULL CHECK(flag_state IN ('legacy', 'shadow', 'authoritative')),
    ws_frame_age_ms INTEGER,
    source TEXT
);
CREATE INDEX idx_pos_class_ts ON position_classifications(ts);
```

Written on EVERY classification change (not on stable reads — only transitions).

**Retention cron:** Weekly `DELETE FROM position_classifications WHERE ts < strftime('%s','now','-30 days') * 1000`.
Registered in `server/cron/` alongside existing cleanup jobs. Keeps table bounded (~30d window).

## Shadow Mode = READ-ONLY

Shadow path:
1. Server WS `at_update` arrives → `_shadowPositions = state.livePositions.concat(state.demoPositions)`
2. Shadow is stored in **separate variable** — NEVER touches `TP.livePositions` or `positionsStore`
3. Every 10s: compare shadow vs legacy, log divergences
4. Shadow data is READ-ONLY diagnostic — zero state mutation

Mutex: `_positionWriteLock` with **newer-wins** strategy:
- Each writer carries a monotonic `writeSeq` (++counter on each attempt)
- If lock held by older writer → older writer yields, newer writer proceeds
- If lock held by newer writer → current writer drops (stale data, no point)
- Dropped writes logged with count: `SRV-POS: write dropped (stale seq={N}, current={M})`
- **NEVER drop silently** — every drop increments `_writeDropCount` counter exposed in diagnostics

## Metric Counters Per Vector

```javascript
const _vectorHits = { v1: 0, v2: 0, v3: 0, v4: 0, v5: 0 };
// Incremented each time a vector's condition is detected in shadow mode
// Exposed via /api/market/cache/health endpoint
```

Shows which vectors fire most in production — validates the fix targets the right root cause.

## Test Matrix (explicit PASS criteria)

| # | Scenario | PASS criteria | Diagnostic check |
|---|----------|--------------|------------------|
| 1 | AT entry DEMO | `autoTrade===true` in positionsStore AND NOT in manual panel | DB brain_decisions has entry + at_positions has autoTrade=1 |
| 2 | AT entry TESTNET | `autoTrade===true` in positionsStore AND NOT in manual panel | Same as #1 on testnet mode |
| 3 | Manual entry TESTNET | `autoTrade===false` in positionsStore AND in manual panel | at_positions has autoTrade=0 or null |
| 4 | PM2 reload | Same autoTrade values pre/post reload (zero reclassification) | position_classifications table: 0 new rows during reload |
| 5 | WS reconnect | Zero divergence in shadow log during reconnect | pm2 logs: no DIVERGENCE entries |
| 6 | Mixed AT + Manual | Both visible in correct panels simultaneously | API /api/at/state shows both with correct autoTrade |
| 7 | Position close | Removed from correct panel, audit logged | at_closed has correct autoTrade |
| 8 | Exchange-only position | Detected as RECON_PHANTOM, logged | position_classifications: vector='exchange_orphan' |

## Files To Be Modified

| File | Change | Risk |
|------|--------|------|
| `server/migrationFlags.js` | Add SERVER_AUTHORITATIVE_POSITIONS flag | LOW |
| `data/migration_flags.json` | Add flag = false | LOW |
| `server/services/database.js` | Migration: position_classifications table | LOW |
| `client/src/core/state.ts` | Shadow positions + comparison + audit writes | MEDIUM |
| `client/src/trading/liveApi.ts` | When flag ON: server positions canonical, exchange for prices only | HIGH |
| `client/src/stores/positionsStore.ts` | Write lock + flag-aware source | MEDIUM |
| `client/src/components/dock/ManualTradePanel.tsx` | No change (filter already correct) | NONE |

## Canary Cutover Schedule

```
Step 6a: Flag ON — DEMO only         → 1h soak  (shadow stays active as observer)
Step 6b: Flag ON — DEMO + TESTNET    → 2h soak  (shadow stays active as observer)
Step 6c: Flag ON — ALL (incl REAL)   → 4h+ soak (shadow stays active as observer)
```

**NU flip direct REAL.** DEMO → TESTNET → REAL incrementally.

**Shadow stays 24h post-cutover:**
After each canary step, shadow comparison continues running for 24h as observer.
This ensures auto-rollback detector has data even after flag is ON.
Shadow reads server positions + legacy path in parallel, compares, logs divergences.
Without this, auto-rollback is blind exactly when it's needed most.

Implementation: flag check includes mode comparison:
```javascript
const useServerAuth = MF.SERVER_AUTHORITATIVE_POSITIONS && (
    engineMode === 'demo' ||
    (engineMode === 'live' && MF._SRV_POS_TESTNET_ENABLED) ||
    (engineMode === 'live' && MF._SRV_POS_REAL_ENABLED)
);
```

## Execution Order (8 steps with gates)

Each step:
- [ ] Code change
- [ ] Test PASS (explicit criteria)
- [ ] Diagnostic check: rate state + brain + cache + PM2 + audit row count
- [ ] Git tag `s2-stepN`
- [ ] PROGRESS.md update

### Step 1: Feature flag + migration + audit retention cron (LOW risk)
### Step 2: Shadow mode (state.ts) — READ-ONLY diagnostic + seq reset detection + newer-wins mutex (MEDIUM risk)
### Step 3: Deploy shadow, monitor divergences 1h

⚠️ **CONTEXT GATE:** Steps 1-3 safe in current session. Before Step 4 → /clear or new session. PROGRESS.md + plan ensure context recovery.

### Step 3.5: Multi-Exchange Forward-Compat Hooks (added 2026-05-25)

Hooks shipped pre-Step 4 (low-risk preparation for Bybit Jun 2026):
- **H1:** Migration 405 — position_classifications + exchange column DEFAULT 'binance'
- **H2:** Server getFullState() returns frame.exchange field
- **H2b:** Client _applyServerATState guard skips frames from different exchange (inert until w._activeExchange set)
- **H3:** _classifyExchange marker on ws_push/sync_merge/boot_resume paths

Multi-exchange roadmap (decided by operator Ovi 2026-05-25):
1. NOW — SRV-POS Steps 4-8 (Binance bug fix)
2. Jun 2026 — Foundation multi-exchange (CEX abstraction)
3. Jun 2026 — Bybit (CEX)
4. Jul 2026 — OKX + Bitget
5. Jul-Aug 2026 — MEXC + HTX
6. Aug-Sep 2026 — **Hyperliquid (DEX, ULTIMUL)** — wallet sig EIP-712, asset index symbols, 1h funding, ADL on-chain, ethers.js. Zero CEX reuse → CEX architecture matures first.

Full spec: `docs/superpowers/specs/2026-06-XX-multi-exchange-srv-pos.md` (post-Step 7)

### Step 4: liveApi.ts position source (flag-gated) — HIGH risk, FRESH CONTEXT MANDATORY
### Step 5: Deploy flag OFF, verify shadow clean
### Step 6a: Canary DEMO — flag ON demo only, 1h soak (shadow observer active)
### Step 6b: Canary TESTNET — flag ON demo+testnet, 2h soak (shadow observer active)
### Step 6c: Canary REAL — flag ON all, 4h+ soak (shadow observer active)
### Step 7: Monitor 48h (shadow observer 24h post-cutover)
### Step 8: Legacy cleanup — SEPARATE SPEC REQUIRED

**Step 8 is its own project.** Removing legacy position merge is a HIGH risk change that touches every file Step 4 touched, plus ManualTradePanel, plus stores. Treat as:
- Own spec document (what exactly to remove, what to keep)
- Own test plan (regression for all 8 test scenarios above)
- Own soak (24h minimum after cleanup)
- Own rollback (ability to restore legacy path from git tag)
- Gate: Step 7 passes 48h soak with 0 divergences

## PROGRESS.md Protocol

After every 2 steps, write to `docs/superpowers/progress/srv-pos-progress.md`:
- Step completed
- Files modified (exact)
- Tests passed (names + counts)
- Diagnostics run (rate state, brain, cache, pm2, audit rows)
- Git tag created
- Any issues found

This ensures context recovery across session compaction.

## Rollback

1. Flip `SERVER_AUTHORITATIVE_POSITIONS = false` → instant revert
2. Auto-rollback if divergence > 20% in 5min
3. PM2 reload → client uses legacy path
4. Zero data loss (server positions + DB unchanged)

## Backup Before Start

```bash
git tag pre-srv-pos-$(date +%Y%m%d-%H%M)
cp data/zeus.db data/zeus.db.pre-srv-pos
git push --tags
```

## TODO (separate, post-soak)

- [ ] Cleanup gateway fallback paths in marketFeed.js + marketRadar.js (48h soak passed)
- [ ] Step 8 legacy cleanup — requires own spec, own tests, own soak (see Step 8 above)
- [ ] Remove canary sub-flags after REAL confirmed + 48h green
