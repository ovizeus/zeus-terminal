# ARES Server-Side Migration — 4 Phases Graduale

> **Status:** APPROVED 2026-05-25
> **Operator:** Ovi (wsov2@protonmail.com)
> **Scope:** BTCUSDT only, 1:1 migration from client localStorage to server DB

## Goal

Move ARES from browser-only (5,400 LOC client, localStorage state) to server-authoritative (DB-backed wallet, positions, decisions, execution). Client becomes render-only.

## Current Architecture (client-side)

| Component | Storage | LOC |
|-----------|---------|-----|
| Wallet (balance, locked, PnL) | localStorage `ARES_MISSION_STATE_V1_vw2` | ~90 |
| Positions (open/close, liq price) | localStorage `ARES_POSITIONS_V1` | ~100 |
| State machine (8 emotions) | localStorage `ARES_STATE_V1` | ~240 |
| Decision engine (gates) | In-memory, reads w.BRAIN | ~100 |
| Execution (orders, SL/TP) | Client liveApi.ts calls | ~95 |
| Monitor (DSL, emergency) | In-memory per-tick | ~136 |
| Mind (memory, clarity) | In-memory | ~96 |
| Journal (trade dataset) | localStorage `ARES_JOURNAL_V1` | ~68 |
| UI (render, brain SVG) | React + imperative DOM | ~1,760 |

## Target Architecture (server-side)

```
SERVER (authoritative):
  serverAresWallet.js  — fund/withdraw/reserve/release/applyPnL
  serverAresPositions.js — open/close/getOpen/reconcile  
  serverAresDecision.js — gate logic (regime/session/confidence/cooldown)
  serverAresExecution.js — order placement via exchangeOps + DSL monitor
  serverAresTick.js — 30s cycle orchestrator (like serverBrain)
  routes/ares.js — REST API for client

CLIENT (render-only):
  aresStore.ts — fetches state from API, pushes to React components
  ARESPanel.tsx + subcomponents — UI unchanged
  aresUI.ts — neural brain SVG (kept, render-only)
```

---

## Phase 1: Server Wallet + Positions + State (DB-backed)

### New DB Tables (migrations 404-407)

```sql
-- 404: ARES wallet
CREATE TABLE ares_wallet (
    user_id INTEGER PRIMARY KEY,
    balance REAL NOT NULL DEFAULT 0,
    locked REAL NOT NULL DEFAULT 0,
    realized_pnl REAL NOT NULL DEFAULT 0,
    funded_total REAL NOT NULL DEFAULT 0,
    stage TEXT NOT NULL DEFAULT 'SEED',
    stage_progress REAL NOT NULL DEFAULT 0,
    mission_start_ts INTEGER,
    updated_at INTEGER NOT NULL
);

-- 405: ARES positions  
CREATE TABLE ares_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    symbol TEXT NOT NULL DEFAULT 'BTCUSDT',
    side TEXT NOT NULL CHECK(side IN ('LONG', 'SHORT')),
    leverage INTEGER NOT NULL DEFAULT 5,
    notional REAL NOT NULL,
    entry_price REAL NOT NULL,
    mark_price REAL,
    sl REAL,
    tp REAL,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'CLOSING', 'CLOSED')),
    live_order_id TEXT,
    live_qty REAL,
    sl_order_id TEXT,
    tp_order_id TEXT,
    opened_at INTEGER NOT NULL,
    closed_at INTEGER,
    close_pnl REAL,
    close_reason TEXT
);
CREATE INDEX idx_ares_pos_user ON ares_positions(user_id, status);

-- 406: ARES engine state
CREATE TABLE ares_engine_state (
    user_id INTEGER PRIMARY KEY,
    emotional_state TEXT NOT NULL DEFAULT 'DETERMINED',
    confidence REAL NOT NULL DEFAULT 50,
    consecutive_wins INTEGER NOT NULL DEFAULT 0,
    consecutive_losses INTEGER NOT NULL DEFAULT 0,
    total_trades INTEGER NOT NULL DEFAULT 0,
    total_wins INTEGER NOT NULL DEFAULT 0,
    trajectory_delta REAL NOT NULL DEFAULT 0,
    last_trade_ts INTEGER NOT NULL DEFAULT 0,
    state_json TEXT,
    updated_at INTEGER NOT NULL
);

-- 407: ARES journal
CREATE TABLE ares_journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    entry_price REAL NOT NULL,
    exit_price REAL,
    leverage INTEGER,
    notional REAL,
    confidence REAL,
    pnl REAL,
    fees REAL,
    reason TEXT,
    regime TEXT,
    session TEXT,
    opened_at INTEGER NOT NULL,
    closed_at INTEGER,
    decision_json TEXT
);
CREATE INDEX idx_ares_journal_user ON ares_journal(user_id, closed_at);
```

### Server Modules

**`server/services/serverAresWallet.js`**
- `getWallet(userId)` → { balance, locked, available, realizedPnl, fundedTotal, stage, stageProgress }
- `fund(userId, amount)` → { ok, newBalance }
- `withdraw(userId, amount)` → { ok, newBalance }
- `reserve(userId, amount)` → { ok, locked }
- `release(userId, amount)` → { ok, locked }
- `applyPnL(userId, pnl, fees)` → { ok, newBalance, realizedPnl }
- `_updateStage(userId)` — compute SEED/ASCENT/SOVEREIGN from balance

**`server/services/serverAresPositions.js`**
- `openPosition(userId, { side, leverage, notional, entryPrice, sl, tp })` → { id, position }
- `closePosition(userId, posId, { exitPrice, reason })` → { ok, pnl }
- `getOpenPositions(userId)` → [position]
- `updateMarkPrice(userId, posId, markPrice)` → { uPnL }
- `getPosition(userId, posId)` → position or null

### API Endpoints (`server/routes/ares.js`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ares/state` | Full state: wallet + positions + engine state |
| POST | `/api/ares/fund` | Fund wallet `{ amount }` |
| POST | `/api/ares/withdraw` | Withdraw `{ amount }` |
| GET | `/api/ares/journal` | Trade history `{ limit, offset }` |

### Client Changes (Phase 1)
- `aresStore.ts`: fetch from `/api/ares/state` instead of localStorage
- `ares.ts`: wallet reads from store (API-backed), not localStorage
- localStorage keys kept as fallback during transition

---

## Phase 2: Server Decision Engine

**`server/services/serverAresDecision.js`**

Ports gate logic from `aresDecision.ts`:
- Reads regime from `serverState.getSnapshotForSymbol('BTCUSDT')`
- Reads confidence from `serverAresEngineState`
- Session check: UTC hour-based (LONDON 7-12, NY 13-21)
- Cooldown: `last_trade_ts` from DB
- Loss streak: `consecutive_losses` from DB
- Kill switch: `serverAT._isGlobalHalted()`

**Constants (same as client):**
- MIN_CONFIDENCE: 68%
- MIN_ENTRY_SCORE: 55
- MAX_OPEN_POSITIONS: 1
- COOLDOWN_MS: 300000 (5 min)
- LOSS_STREAK_BLOCK: 3
- TRADE_REGIMES: ['TREND', 'BREAKOUT']
- EXTREME_VOL_PCT: 3%

---

## Phase 3: Server Execution + Monitor

**`server/services/serverAresExecution.js`**

- `executeEntry(userId, decision)` — places order via `exchangeOps.placeEntry`
- `executeSL(userId, posId, stopPrice)` — via `exchangeOps.placeStopLoss`
- `executeTP(userId, posId, takePrice)` — via `exchangeOps.placeStopLoss` (TP variant)
- `executeClose(userId, posId, reason)` — market close via `exchangeOps.closePosition`

**DSL Monitor (in serverAresTick):**
- On each `onPriceUpdate('BTCUSDT', price)`:
  - Check breakeven trigger (1% profit → move SL)
  - Check trail trigger (1.5% → trail 1x ATR)
  - Check tighten trigger (3% → tighten 0.5x ATR)
  - Check SL/TP hit → close

---

## Phase 4: Client Render-Only

- Delete `ares.ts` engine logic (keep only type exports)
- Delete `aresDecision.ts`, `aresExecute.ts`, `aresMonitor.ts`, `aresMind.ts`
- Keep `aresJournal.ts` as read-only viewer
- Keep `aresUI.ts` neural brain SVG (render-only)
- `aresStore.ts` becomes sole data source (API-driven)
- WebSocket push for real-time position updates (existing pattern from AT)

---

## Migration Safety

- Each phase deploys independently
- Phase 1: server reads/writes DB, client reads API. localStorage kept as fallback.
- Phase 2: server decides, client confirms via API poll. Client decision engine disabled via flag.
- Phase 3: server executes. Client execution removed.
- Phase 4: cleanup — remove dead client code.

**Flag:** `SERVER_ARES_ENABLED` in migrationFlags — false by default, flip per phase.

**Rollback:** Each phase can revert by flipping flag back. Client engine resumes from localStorage.

---

## Constraints

- BTCUSDT only (hardcoded, multi-symbol later)
- Max 1 position at a time
- Completely isolated from AT/Brain (separate tables, separate tick cycle)
- ARES tick cycle: 30s (independent setInterval, not inside brain cycle)
- Fees: maker 0.02%, taker 0.055% (round-trip taker×2)
- Stages: SEED ($0-1K), ASCENT ($1K-10K), SOVEREIGN ($10K-1M)
- Mission: 365 days max

## Testing

Per phase:
- Unit tests for each server module (wallet, positions, decision, execution)
- Integration test: full tick cycle (decide → execute → monitor → close → PnL)
- Regression: existing AT/Brain unaffected

## File Map (all phases)

| File | Action | Phase |
|------|--------|-------|
| `server/services/serverAresWallet.js` | CREATE | 1 |
| `server/services/serverAresPositions.js` | CREATE | 1 |
| `server/services/database.js` | MODIFY (mig 404-407) | 1 |
| `server/routes/ares.js` | CREATE | 1 |
| `server.js` | MODIFY (mount routes) | 1 |
| `server/services/serverAresDecision.js` | CREATE | 2 |
| `server/services/serverAresTick.js` | CREATE | 2-3 |
| `server/services/serverAresExecution.js` | CREATE | 3 |
| `server/migrationFlags.js` | MODIFY (SERVER_ARES_ENABLED) | 1 |
| `data/migration_flags.json` | MODIFY | 1 |
| `client/src/stores/aresStore.ts` | MODIFY (API-driven) | 1 |
| `client/src/engine/ares.ts` | MODIFY→DELETE | 1-4 |
| `client/src/engine/aresDecision.ts` | DELETE | 4 |
| `client/src/engine/aresExecute.ts` | DELETE | 4 |
| `client/src/engine/aresMonitor.ts` | DELETE | 4 |
| `tests/unit/serverAresWallet.test.js` | CREATE | 1 |
| `tests/unit/serverAresPositions.test.js` | CREATE | 1 |
| `tests/unit/serverAresDecision.test.js` | CREATE | 2 |
| `tests/unit/serverAresExecution.test.js` | CREATE | 3 |

## Out of Scope

- Multi-symbol support (post-migration)
- RL learning loop (post-migration)
- Server-side aresMind/cognitive (post-migration)
- Neural brain SVG changes (stays client-side)
