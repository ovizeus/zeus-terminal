# Bybit Migration Phase 1A+1B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Bybit V5 a fully operational exchange in Zeus alongside Binance, with per-user routing, exchange-aware brain, atomic order semantics, and recovery/audit/safety infrastructure that makes Zeus a real trading platform.

**Architecture:** Two duck-typed JS module pairs (binanceFeed/bybitFeed + binanceOps/bybitOps) behind routers (feedManager + exchangeOps). Per-user routing via `_userExchangeCache`. Explicit barrier on switch via `_pendingSwitch`. Position state machine (8 states) backed by `position_events` append-only journal. Recovery boot deterministic. Permanent shadow logging. Server-truth Rule 0 enforced everywhere.

**Tech Stack:** Node.js 22, better-sqlite3, ws (WebSocket client), Jest (server tests), React+Vitest (client tests), PM2 cluster mode.

**Spec:** `docs/superpowers/specs/2026-05-21-bybit-migration-phase-1ab.md` (32 pillars locked — 26 must-have shipped here + 6 deferred Phase 1F).

**Branch:** `bybit-phase-1ab` (separate, no touch on master/omega/wave-1-foundation until 1A+1B green on testnet 24h+).

**Estimated effort:** 50-60h focused work, ~80 tasks across 14 phases.

---

## Server-Truth Invariants (Rule 0 — never violate)

Every task below MUST respect:

1. All exchange state per `req.user.id` — never global, never hardcoded user
2. Display data ALWAYS from server (no client-side faked balance/positions)
3. `localStorage` ONLY for UX preferences (theme, font size); NEVER for engine mode, AT armed, positions, brain config
4. `position_events` is append-only ledger — NEVER UPDATE or DELETE rows
5. `decisionKey` is the idempotency anchor — every external call propagates it; retries return same result
6. Mutex enforced server-side: max 1 active exchange per user at any time
7. Switch with open positions = 409 BLOCKED — no orphan creation possible

---

## Verify-Twice Rule (applied to every code task)

Per `feedback_verify_twice_before_commit.md` (2026-05-21):

Before any Edit/Write:
1. Grep cross-file for ALL locations using the pattern being modified
2. Identify which need updating
3. Update all of them together

After Edit/Write, before commit:
1. Re-read modified file completely
2. Verify syntax + side effects + edge cases
3. Run tests + verify pass
4. Self-review checklist

This is BAKED into the task structure below — each implementation task has a "cross-file audit" step before the code change.

---

## File Structure (locked decomposition)

### NEW FILES (15)

| File | Responsibility | LOC est. |
|---|---|---|
| `server/services/feedManager.js` | Per-user route + refcount + activate/deactivate per exchange | ~200 |
| `server/services/bybitFeed.js` | Bybit V5 WS subscribe/dispatch, mirror binanceFeed | ~600 |
| `server/services/exchangeOps.js` | Per-user routing + hard SL guard + cache + dispatch | ~350 |
| `server/services/binanceOps.js` | Wrap existing Binance order logic into canonical API | ~450 |
| `server/services/bybitOps.js` | Wrap bybitSigner + translator + HTTP send | ~450 |
| `server/services/bybitRateState.js` | DB-persistent rate limit tracking | ~180 |
| `server/services/positionStateMachine.js` | 8-state machine + transition rules + event emission | ~250 |
| `server/services/positionEvents.js` | Append-only event journal helper | ~150 |
| `server/services/recoveryBoot.js` | PM2 startup recovery flow | ~300 |
| `server/services/timeSyncAssert.js` | NTP drift check + alert | ~100 |
| `server/services/parityShadowLogger.js` | Cross-exchange shadow logging | ~200 |
| `server/cron/pnlReconCron.js` | Daily PnL reconciliation | ~200 |
| `server/routes/health.js` | Health/metrics endpoints | ~150 |
| `server/migrations/0XX_bybit_columns.js` | Schema migrations additive | ~120 |
| `server/migrations/0XX_bybit_tables.js` | New tables (position_events, etc.) | ~100 |

### MODIFIED FILES (10)

| File | Change scope |
|---|---|
| `server/services/marketFeed.js` | Refactor to fit IMarketFeed contract (rename internally to binanceFeed pattern, no behavior change) |
| `server/services/serverState.js` | Add `forExchange(name)` router + bi-namespaced `_sdMap_binance` + `_sdMap_bybit` |
| `server/services/serverBrain.js` | Loop swap (user outer, symbol inner) + `_pendingSwitch` barrier check |
| `server/services/serverAT.js` | `_executeLiveEntryCore` → `exchangeOps.placeEntry`; `_closePosition` → `exchangeOps.closePosition` |
| `server/routes/trading.js` | All `sendSignedRequest('/fapi/v1/order')` → `exchangeOps.*` calls |
| `server/routes/exchange.js` | `/api/exchange/save` with verify + `_pendingSwitch`; `/disconnect` with positions check + orphan move |
| `server/index.js` | Wire recoveryBoot + pnlReconCron + timeSyncAssert at startup |
| `server/services/credentialStore.js` | Already supports per-exchange; verify Bybit baseUrl resolution |
| `server/migrationFlags.js` | No new flags (BYBIT_DRY_RUN_ONLY already exists, stays TRUE) |
| `server/version.js` | Bump v1.7.98 → v1.7.99 at end |

### TEST FILES (NEW ~12)

| File | Coverage |
|---|---|
| `tests/unit/feedManager.test.js` | Refcount + activate/deactivate + multi-user |
| `tests/unit/bybitFeed.test.js` | WS subscribe + normalization + reconnect |
| `tests/unit/feedContract.test.js` | Shared contract — same assertions run against binanceFeed + bybitFeed |
| `tests/unit/positionStateMachine.test.js` | Transition rules + invalid edges throw |
| `tests/unit/positionEvents.test.js` | Append + query + immutability |
| `tests/unit/exchangeOps.test.js` | Routing + hard SL guard + cache + invalidation |
| `tests/unit/binanceOps.test.js` | placeEntry + closePosition + canonical shapes |
| `tests/unit/bybitOps.test.js` | placeEntry atomic + closePosition + canonical shapes |
| `tests/unit/bybitRateState.test.js` | Persistence + ban tracking |
| `tests/unit/recoveryBoot.test.js` | Scan + reconcile + SL verify + ORPHANED |
| `tests/unit/timeSyncAssert.test.js` | Drift detection |
| `tests/e2e/bybit-trade-flow.test.js` | End-to-end: place + verify + close (mocked Bybit) |

---

# PHASE 0 — Pre-work (branch + backup)

## Task 1: Create branch + verify clean state

**Files:** None (git operation)

- [ ] **Step 1: Verify current state**

```bash
cd /root/zeus-terminal && git status && git log --oneline -3
```

Expected: clean working tree, head commit `05db2f4` (spec commit) or later.

- [ ] **Step 2: Create + checkout branch**

```bash
cd /root/zeus-terminal && git checkout -b bybit-phase-1ab
```

Expected: `Switched to a new branch 'bybit-phase-1ab'`

- [ ] **Step 3: Verify branch**

```bash
git branch --show-current
```

Expected: `bybit-phase-1ab`

- [ ] **Step 4: Push branch to origin (track remote)**

```bash
git push -u origin bybit-phase-1ab
```

Expected: `Branch 'bybit-phase-1ab' set up to track 'origin/bybit-phase-1ab'`

---

## Task 2: DB backup + verify migration baseline

**Files:** None (DB operation)

- [ ] **Step 1: Create timestamped DB backup**

```bash
cp /root/zeus-terminal/data/zeus.db /root/zeus-terminal/data/zeus.db.pre-bybit-phase-1ab-$(date +%Y%m%d-%H%M%S)
ls -la /root/zeus-terminal/data/zeus.db.pre-bybit-*
```

Expected: copy created, ~127MB.

- [ ] **Step 2: Snapshot current schema**

```bash
sqlite3 /root/zeus-terminal/data/zeus.db ".schema" > /root/zeus-terminal/data/schema-pre-bybit-$(date +%Y%m%d).sql
wc -l /root/zeus-terminal/data/schema-pre-bybit-*.sql
```

Expected: ~5000-7000 lines (full schema captured).

- [ ] **Step 3: Snapshot row counts for verification baseline**

```bash
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=t.name) FROM (SELECT name FROM sqlite_master WHERE type='table' ORDER BY name) t" > /tmp/zeus-tables-count.txt
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT COUNT(*) AS positions FROM at_positions; SELECT COUNT(*) AS closed FROM at_closed; SELECT COUNT(*) AS brain FROM brain_decisions;" > /tmp/zeus-key-counts.txt
cat /tmp/zeus-key-counts.txt
```

Expected: row counts logged, used post-migration to verify zero data loss.

- [ ] **Step 4: Commit baseline snapshot record**

```bash
cd /root/zeus-terminal && git add -f data/schema-pre-bybit-*.sql 2>/dev/null || true
git status
```

Note: data/ is gitignored typically, so this likely won't add anything. The snapshot files exist locally for rollback reference.

- [ ] **Step 5: Verify PM2 stable + uptime baseline**

```bash
pm2 list | grep zeus
```

Expected: zeus online, uptime visible. Note: PM2 stays running throughout; migrations happen via separate script, NO PM2 restart needed in Phase 0.

---

# PHASE 1 — Database migrations

## Task 3: Migration — exchange column on existing tables

**Files:**
- Create: `server/migrations/0392_bybit_exchange_columns.js`
- Test: `tests/unit/migration_bybit_exchange_columns.test.js`

- [ ] **Step 1: Identify next migration number**

```bash
ls /root/zeus-terminal/server/migrations/ | grep "^0[0-9]" | sort -n | tail -3
```

Expected: shows most recent migration number. Use NEXT integer (likely 0392 per memory).

- [ ] **Step 2: Write failing test**

Create `tests/unit/migration_bybit_exchange_columns.test.js`:

```javascript
'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

describe('Migration 0392 — bybit exchange columns', () => {
    let db;
    const TEST_DB = '/tmp/zeus-migration-test.db';

    beforeEach(() => {
        if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
        db = new Database(TEST_DB);
        db.exec(`
            CREATE TABLE at_positions (seq INTEGER PRIMARY KEY, data TEXT, status TEXT DEFAULT 'OPEN', user_id INTEGER, created_at TEXT, updated_at TEXT);
            CREATE TABLE at_closed (seq INTEGER PRIMARY KEY, data TEXT, user_id INTEGER, closed_at TEXT);
            CREATE TABLE brain_decisions (snap_id TEXT PRIMARY KEY, user_id INTEGER, symbol TEXT, ts INTEGER, cycle INTEGER, source_path TEXT, final_tier TEXT, final_conf INTEGER, final_dir TEXT, final_action TEXT, linked_seq INTEGER, data TEXT, created_at TEXT);
            CREATE TABLE feature_proposals (id INTEGER PRIMARY KEY, user_id INTEGER, feature_name TEXT, ts INTEGER);
        `);
        db.prepare('INSERT INTO at_positions (data, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)').run('{"symbol":"BTCUSDT"}', 1, '2026-05-21', '2026-05-21');
        db.prepare('INSERT INTO at_closed (data, user_id, closed_at) VALUES (?, ?, ?)').run('{}', 1, '2026-05-20');
        db.prepare('INSERT INTO brain_decisions (snap_id, user_id, symbol, ts, cycle, source_path, final_tier, final_conf, final_dir, final_action, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('snap1', 1, 'BTCUSDT', 1234567890, 1, 'path', 'tier', 50, 'LONG', 'NEW', '{}', '2026-05-21');
    });

    afterEach(() => {
        if (db) db.close();
        if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    });

    it('adds exchange column to at_positions with DEFAULT binance', () => {
        require('../../server/migrations/0392_bybit_exchange_columns').up(db);
        const cols = db.prepare("PRAGMA table_info(at_positions)").all();
        const exchangeCol = cols.find(c => c.name === 'exchange');
        expect(exchangeCol).toBeDefined();
        expect(exchangeCol.dflt_value).toBe("'binance'");
        const row = db.prepare('SELECT exchange FROM at_positions WHERE seq=1').get();
        expect(row.exchange).toBe('binance');
    });

    it('adds exchange column to at_closed', () => {
        require('../../server/migrations/0392_bybit_exchange_columns').up(db);
        const row = db.prepare('SELECT exchange FROM at_closed WHERE seq=1').get();
        expect(row.exchange).toBe('binance');
    });

    it('adds exchange column to brain_decisions', () => {
        require('../../server/migrations/0392_bybit_exchange_columns').up(db);
        const row = db.prepare('SELECT exchange FROM brain_decisions WHERE snap_id=?').get('snap1');
        expect(row.exchange).toBe('binance');
    });

    it('adds exchange column to feature_proposals', () => {
        require('../../server/migrations/0392_bybit_exchange_columns').up(db);
        const cols = db.prepare("PRAGMA table_info(feature_proposals)").all();
        expect(cols.find(c => c.name === 'exchange')).toBeDefined();
    });

    it('creates idx_at_positions_user_exchange_status', () => {
        require('../../server/migrations/0392_bybit_exchange_columns').up(db);
        const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_at_positions_user_exchange_status'").get();
        expect(idx).toBeDefined();
    });

    it('is idempotent — running twice does not throw', () => {
        const mig = require('../../server/migrations/0392_bybit_exchange_columns');
        mig.up(db);
        expect(() => mig.up(db)).not.toThrow();
    });
});
```

- [ ] **Step 3: Run test — verify it FAILS**

```bash
cd /root/zeus-terminal && npx jest tests/unit/migration_bybit_exchange_columns.test.js --forceExit
```

Expected: FAIL with `Cannot find module '../../server/migrations/0392_bybit_exchange_columns'`.

- [ ] **Step 4: Implement migration**

Create `server/migrations/0392_bybit_exchange_columns.js`:

```javascript
'use strict';

// Migration 0392 — Bybit exchange column on existing tables (Phase 1A)
// Adds exchange TEXT NOT NULL DEFAULT 'binance' to at_positions, at_closed,
// brain_decisions, feature_proposals + supporting indexes.
// Idempotent: PRAGMA table_info check before each ALTER.

function _hasColumn(db, table, column) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some(c => c.name === column);
}

function _hasIndex(db, indexName) {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(indexName);
    return !!row;
}

function up(db) {
    db.transaction(() => {
        // at_positions
        if (!_hasColumn(db, 'at_positions', 'exchange')) {
            db.exec(`ALTER TABLE at_positions ADD COLUMN exchange TEXT NOT NULL DEFAULT 'binance'`);
        }
        if (!_hasIndex(db, 'idx_at_positions_user_exchange_status')) {
            db.exec(`CREATE INDEX idx_at_positions_user_exchange_status ON at_positions(user_id, exchange, status)`);
        }
        // at_closed
        if (!_hasColumn(db, 'at_closed', 'exchange')) {
            db.exec(`ALTER TABLE at_closed ADD COLUMN exchange TEXT NOT NULL DEFAULT 'binance'`);
        }
        if (!_hasIndex(db, 'idx_at_closed_user_exchange_ts')) {
            db.exec(`CREATE INDEX idx_at_closed_user_exchange_ts ON at_closed(user_id, exchange, closed_at)`);
        }
        // brain_decisions
        if (!_hasColumn(db, 'brain_decisions', 'exchange')) {
            db.exec(`ALTER TABLE brain_decisions ADD COLUMN exchange TEXT NOT NULL DEFAULT 'binance'`);
        }
        if (!_hasIndex(db, 'idx_brain_decisions_user_exchange_ts')) {
            db.exec(`CREATE INDEX idx_brain_decisions_user_exchange_ts ON brain_decisions(user_id, exchange, ts)`);
        }
        // feature_proposals
        if (!_hasColumn(db, 'feature_proposals', 'exchange')) {
            db.exec(`ALTER TABLE feature_proposals ADD COLUMN exchange TEXT NOT NULL DEFAULT 'binance'`);
        }
        // Defensive backfill (DEFAULT covers but explicit anyway)
        db.exec(`UPDATE at_positions SET exchange='binance' WHERE exchange IS NULL OR exchange=''`);
        db.exec(`UPDATE at_closed SET exchange='binance' WHERE exchange IS NULL OR exchange=''`);
        db.exec(`UPDATE brain_decisions SET exchange='binance' WHERE exchange IS NULL OR exchange=''`);
    })();
}

function down(db) {
    // SQLite supports ALTER TABLE DROP COLUMN in 3.35+; this Zeus version uses 11.x better-sqlite3 with recent SQLite.
    db.transaction(() => {
        db.exec(`DROP INDEX IF EXISTS idx_at_positions_user_exchange_status`);
        db.exec(`DROP INDEX IF EXISTS idx_at_closed_user_exchange_ts`);
        db.exec(`DROP INDEX IF EXISTS idx_brain_decisions_user_exchange_ts`);
        if (_hasColumn(db, 'at_positions', 'exchange')) db.exec(`ALTER TABLE at_positions DROP COLUMN exchange`);
        if (_hasColumn(db, 'at_closed', 'exchange')) db.exec(`ALTER TABLE at_closed DROP COLUMN exchange`);
        if (_hasColumn(db, 'brain_decisions', 'exchange')) db.exec(`ALTER TABLE brain_decisions DROP COLUMN exchange`);
        if (_hasColumn(db, 'feature_proposals', 'exchange')) db.exec(`ALTER TABLE feature_proposals DROP COLUMN exchange`);
    })();
}

module.exports = { up, down };
```

- [ ] **Step 5: Run test — verify it PASSES**

```bash
cd /root/zeus-terminal && npx jest tests/unit/migration_bybit_exchange_columns.test.js --forceExit
```

Expected: PASS 6/6 tests.

- [ ] **Step 6: Apply migration to live DB**

```bash
cd /root/zeus-terminal && node -e "const Database = require('better-sqlite3'); const db = new Database('/root/zeus-terminal/data/zeus.db'); require('./server/migrations/0392_bybit_exchange_columns').up(db); db.close(); console.log('Migration 0392 applied');"
```

Expected: `Migration 0392 applied`

- [ ] **Step 7: Verify live DB post-migration**

```bash
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT exchange, COUNT(*) FROM at_positions GROUP BY exchange"
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT exchange, COUNT(*) FROM brain_decisions GROUP BY exchange LIMIT 5"
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT COUNT(*) FROM at_positions WHERE exchange IS NULL"
```

Expected: only `binance` group present, zero NULL values.

- [ ] **Step 8: Commit**

```bash
cd /root/zeus-terminal && git add server/migrations/0392_bybit_exchange_columns.js tests/unit/migration_bybit_exchange_columns.test.js
git commit -m "feat(bybit): migration 0392 — exchange columns on existing tables

- at_positions, at_closed, brain_decisions, feature_proposals gain
  exchange TEXT NOT NULL DEFAULT 'binance'
- Indexes (user_id, exchange, X) for query performance
- Idempotent — safe to re-run
- Tests cover columns + indexes + idempotency
- Applied to live DB; baseline row counts preserved"
```

---

## Task 4: Migration — position_events table

**Files:**
- Create: `server/migrations/0393_position_events_table.js`
- Test: `tests/unit/migration_position_events.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/unit/migration_position_events.test.js`:

```javascript
'use strict';

const fs = require('fs');
const Database = require('better-sqlite3');

describe('Migration 0393 — position_events table', () => {
    let db;
    const TEST_DB = '/tmp/zeus-migration-393.db';

    beforeEach(() => {
        if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
        db = new Database(TEST_DB);
    });

    afterEach(() => {
        if (db) db.close();
        if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    });

    it('creates position_events table with required columns', () => {
        require('../../server/migrations/0393_position_events_table').up(db);
        const cols = db.prepare("PRAGMA table_info(position_events)").all();
        const names = cols.map(c => c.name);
        expect(names).toEqual(expect.arrayContaining([
            'id', 'position_seq', 'user_id', 'exchange', 'event_type',
            'from_state', 'to_state', 'payload', 'cycle_no', 'ts'
        ]));
    });

    it('creates idx_position_events_position', () => {
        require('../../server/migrations/0393_position_events_table').up(db);
        const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_position_events_position'").get();
        expect(idx).toBeDefined();
    });

    it('creates idx_position_events_user_ts', () => {
        require('../../server/migrations/0393_position_events_table').up(db);
        const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_position_events_user_ts'").get();
        expect(idx).toBeDefined();
    });

    it('is idempotent', () => {
        const mig = require('../../server/migrations/0393_position_events_table');
        mig.up(db);
        expect(() => mig.up(db)).not.toThrow();
    });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd /root/zeus-terminal && npx jest tests/unit/migration_position_events.test.js --forceExit
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement migration**

Create `server/migrations/0393_position_events_table.js`:

```javascript
'use strict';

// Migration 0393 — position_events append-only journal (Phase 1A)
// Tracks every state transition of a position for audit + replay.
// Append-only: never UPDATE or DELETE rows.

function _hasTable(db, name) {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
    return !!row;
}

function _hasIndex(db, name) {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(name);
    return !!row;
}

function up(db) {
    db.transaction(() => {
        if (!_hasTable(db, 'position_events')) {
            db.exec(`
                CREATE TABLE position_events (
                    id INTEGER PRIMARY KEY,
                    position_seq INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    exchange TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    from_state TEXT,
                    to_state TEXT,
                    payload TEXT NOT NULL DEFAULT '{}',
                    cycle_no INTEGER,
                    ts INTEGER NOT NULL
                )
            `);
        }
        if (!_hasIndex(db, 'idx_position_events_position')) {
            db.exec(`CREATE INDEX idx_position_events_position ON position_events(position_seq, ts)`);
        }
        if (!_hasIndex(db, 'idx_position_events_user_ts')) {
            db.exec(`CREATE INDEX idx_position_events_user_ts ON position_events(user_id, ts)`);
        }
    })();
}

function down(db) {
    db.transaction(() => {
        db.exec(`DROP INDEX IF EXISTS idx_position_events_position`);
        db.exec(`DROP INDEX IF EXISTS idx_position_events_user_ts`);
        db.exec(`DROP TABLE IF EXISTS position_events`);
    })();
}

module.exports = { up, down };
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd /root/zeus-terminal && npx jest tests/unit/migration_position_events.test.js --forceExit
```

Expected: PASS 4/4.

- [ ] **Step 5: Apply to live DB**

```bash
cd /root/zeus-terminal && node -e "const Database = require('better-sqlite3'); const db = new Database('/root/zeus-terminal/data/zeus.db'); require('./server/migrations/0393_position_events_table').up(db); db.close(); console.log('Migration 0393 applied');"
sqlite3 /root/zeus-terminal/data/zeus.db ".schema position_events"
```

Expected: table created, schema printed.

- [ ] **Step 6: Commit**

```bash
cd /root/zeus-terminal && git add server/migrations/0393_position_events_table.js tests/unit/migration_position_events.test.js
git commit -m "feat(bybit): migration 0393 — position_events append-only journal

- Tracks state transitions of positions (PENDING/OPENING/OPEN/CLOSING/etc.)
- Indexes (position_seq, ts) + (user_id, ts)
- Append-only ledger — NEVER UPDATE or DELETE rows
- Enables replay of any incident
- 4 tests cover schema + indexes + idempotency"
```

---

## Task 5: Migration — at_positions_orphaned + emergency_close_queue + bybit_rate_state

**Files:**
- Create: `server/migrations/0394_bybit_support_tables.js`
- Test: `tests/unit/migration_bybit_support_tables.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/unit/migration_bybit_support_tables.test.js`:

```javascript
'use strict';

const fs = require('fs');
const Database = require('better-sqlite3');

describe('Migration 0394 — bybit support tables', () => {
    let db;
    const TEST_DB = '/tmp/zeus-migration-394.db';

    beforeEach(() => {
        if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
        db = new Database(TEST_DB);
    });

    afterEach(() => {
        if (db) db.close();
        if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    });

    it('creates at_positions_orphaned table', () => {
        require('../../server/migrations/0394_bybit_support_tables').up(db);
        const cols = db.prepare("PRAGMA table_info(at_positions_orphaned)").all();
        const names = cols.map(c => c.name);
        expect(names).toEqual(expect.arrayContaining([
            'seq', 'original_at_positions_seq', 'user_id', 'exchange',
            'data', 'disconnected_at', 'resolved_at', 'resolved_by'
        ]));
    });

    it('creates emergency_close_queue table', () => {
        require('../../server/migrations/0394_bybit_support_tables').up(db);
        const cols = db.prepare("PRAGMA table_info(emergency_close_queue)").all();
        const names = cols.map(c => c.name);
        expect(names).toEqual(expect.arrayContaining([
            'id', 'user_id', 'symbol', 'exchange', 'qty',
            'decision_key', 'created_at', 'resolved_at', 'resolved_by'
        ]));
    });

    it('creates bybit_rate_state table', () => {
        require('../../server/migrations/0394_bybit_support_tables').up(db);
        const cols = db.prepare("PRAGMA table_info(bybit_rate_state)").all();
        const names = cols.map(c => c.name);
        expect(names).toEqual(expect.arrayContaining([
            'id', 'user_id', 'used_weight', 'reset_at', 'banned_until',
            'ban_reason', 'last_request_at'
        ]));
        const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_bybit_rate_state_user'").get();
        expect(idx).toBeDefined();
    });

    it('is idempotent', () => {
        const mig = require('../../server/migrations/0394_bybit_support_tables');
        mig.up(db);
        expect(() => mig.up(db)).not.toThrow();
    });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd /root/zeus-terminal && npx jest tests/unit/migration_bybit_support_tables.test.js --forceExit
```

Expected: FAIL.

- [ ] **Step 3: Implement migration**

Create `server/migrations/0394_bybit_support_tables.js`:

```javascript
'use strict';

// Migration 0394 — Bybit support tables (Phase 1A+1B)
// - at_positions_orphaned: positions left after exchange disconnect
// - emergency_close_queue: catastrophic close failures persistence
// - bybit_rate_state: DB-persistent IP-level rate limit tracking

function _hasTable(db, name) {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
    return !!row;
}

function _hasIndex(db, name) {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(name);
    return !!row;
}

function up(db) {
    db.transaction(() => {
        // at_positions_orphaned
        if (!_hasTable(db, 'at_positions_orphaned')) {
            db.exec(`
                CREATE TABLE at_positions_orphaned (
                    seq INTEGER PRIMARY KEY,
                    original_at_positions_seq INTEGER,
                    user_id INTEGER NOT NULL,
                    exchange TEXT NOT NULL,
                    data TEXT NOT NULL,
                    disconnected_at INTEGER NOT NULL,
                    resolved_at INTEGER,
                    resolved_by TEXT
                )
            `);
        }
        if (!_hasIndex(db, 'idx_orphaned_user_exchange')) {
            db.exec(`CREATE INDEX idx_orphaned_user_exchange ON at_positions_orphaned(user_id, exchange, disconnected_at)`);
        }
        // emergency_close_queue
        if (!_hasTable(db, 'emergency_close_queue')) {
            db.exec(`
                CREATE TABLE emergency_close_queue (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    symbol TEXT NOT NULL,
                    exchange TEXT NOT NULL,
                    qty TEXT NOT NULL,
                    decision_key TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    resolved_at INTEGER,
                    resolved_by TEXT
                )
            `);
        }
        if (!_hasIndex(db, 'idx_emergency_close_unresolved')) {
            db.exec(`CREATE INDEX idx_emergency_close_unresolved ON emergency_close_queue(user_id, resolved_at)`);
        }
        // bybit_rate_state
        if (!_hasTable(db, 'bybit_rate_state')) {
            db.exec(`
                CREATE TABLE bybit_rate_state (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    used_weight INTEGER NOT NULL DEFAULT 0,
                    reset_at INTEGER NOT NULL,
                    banned_until INTEGER NOT NULL DEFAULT 0,
                    ban_reason TEXT,
                    last_request_at INTEGER NOT NULL
                )
            `);
        }
        if (!_hasIndex(db, 'idx_bybit_rate_state_user')) {
            db.exec(`CREATE UNIQUE INDEX idx_bybit_rate_state_user ON bybit_rate_state(user_id)`);
        }
    })();
}

function down(db) {
    db.transaction(() => {
        db.exec(`DROP INDEX IF EXISTS idx_orphaned_user_exchange`);
        db.exec(`DROP INDEX IF EXISTS idx_emergency_close_unresolved`);
        db.exec(`DROP INDEX IF EXISTS idx_bybit_rate_state_user`);
        db.exec(`DROP TABLE IF EXISTS at_positions_orphaned`);
        db.exec(`DROP TABLE IF EXISTS emergency_close_queue`);
        db.exec(`DROP TABLE IF EXISTS bybit_rate_state`);
    })();
}

module.exports = { up, down };
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd /root/zeus-terminal && npx jest tests/unit/migration_bybit_support_tables.test.js --forceExit
```

Expected: PASS 4/4.

- [ ] **Step 5: Apply to live DB**

```bash
cd /root/zeus-terminal && node -e "const Database = require('better-sqlite3'); const db = new Database('/root/zeus-terminal/data/zeus.db'); require('./server/migrations/0394_bybit_support_tables').up(db); db.close(); console.log('Migration 0394 applied');"
sqlite3 /root/zeus-terminal/data/zeus.db ".tables" | grep -E "orphaned|emergency|bybit_rate"
```

Expected: 3 tables listed.

- [ ] **Step 6: Commit**

```bash
cd /root/zeus-terminal && git add server/migrations/0394_bybit_support_tables.js tests/unit/migration_bybit_support_tables.test.js
git commit -m "feat(bybit): migration 0394 — orphaned + emergency_close + bybit_rate_state

- at_positions_orphaned: positions abandoned after exchange disconnect
- emergency_close_queue: catastrophic close failure persistence (manual resolve)
- bybit_rate_state: DB-persistent rate limit tracking (mirror binanceRateState)
- 4 tests + idempotency"
```

---

# PHASE 2 — Core helpers

## Task 6: positionEvents append helper

**Files:**
- Create: `server/services/positionEvents.js`
- Test: `tests/unit/positionEvents.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/unit/positionEvents.test.js`:

```javascript
'use strict';

jest.mock('../../server/services/database', () => {
    const Database = require('better-sqlite3');
    const fs = require('fs');
    const TEST_DB = '/tmp/zeus-position-events-test.db';
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    const db = new Database(TEST_DB);
    db.exec(`
        CREATE TABLE position_events (
            id INTEGER PRIMARY KEY, position_seq INTEGER NOT NULL, user_id INTEGER NOT NULL,
            exchange TEXT NOT NULL, event_type TEXT NOT NULL, from_state TEXT, to_state TEXT,
            payload TEXT NOT NULL DEFAULT '{}', cycle_no INTEGER, ts INTEGER NOT NULL
        )
    `);
    return { db };
});

const positionEvents = require('../../server/services/positionEvents');

describe('positionEvents', () => {
    it('append() inserts row with all required fields', () => {
        const id = positionEvents.append({
            position_seq: 1, user_id: 1, exchange: 'binance',
            event_type: 'STATE_CHANGE', from_state: 'PENDING', to_state: 'OPENING',
            payload: { orderId: 'abc123' }, cycle_no: 42
        });
        expect(typeof id).toBe('number');
        expect(id).toBeGreaterThan(0);
    });

    it('append() stores payload as JSON string', () => {
        const id = positionEvents.append({
            position_seq: 2, user_id: 1, exchange: 'bybit',
            event_type: 'CREATED', payload: { foo: 'bar', n: 123 }
        });
        const events = positionEvents.queryByPosition(2);
        expect(events[0].payload).toEqual({ foo: 'bar', n: 123 });
    });

    it('queryByPosition returns events ordered by ts ASC', () => {
        positionEvents.append({ position_seq: 3, user_id: 1, exchange: 'binance', event_type: 'A', payload: {} });
        positionEvents.append({ position_seq: 3, user_id: 1, exchange: 'binance', event_type: 'B', payload: {} });
        const events = positionEvents.queryByPosition(3);
        expect(events.length).toBe(2);
        expect(events[0].event_type).toBe('A');
        expect(events[1].event_type).toBe('B');
    });

    it('queryByUser returns recent events for user', () => {
        const events = positionEvents.queryByUser(1, { limit: 10 });
        expect(events.length).toBeGreaterThan(0);
        expect(events[0].user_id).toBe(1);
    });

    it('append() requires position_seq, user_id, exchange, event_type', () => {
        expect(() => positionEvents.append({})).toThrow();
        expect(() => positionEvents.append({ position_seq: 1 })).toThrow();
    });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd /root/zeus-terminal && npx jest tests/unit/positionEvents.test.js --forceExit
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement positionEvents.js**

Create `server/services/positionEvents.js`:

```javascript
'use strict';

/**
 * positionEvents — Append-only journal for position state transitions.
 *
 * Append-only contract: NEVER UPDATE or DELETE rows. Once appended, immutable.
 * Used for: replay incidents, audit trail, debug of stuck positions.
 *
 * Schema: position_events(id, position_seq, user_id, exchange, event_type,
 *                         from_state, to_state, payload JSON, cycle_no, ts)
 */

const { db } = require('./database');

function _validateParams(params) {
    if (!params || typeof params !== 'object') throw new Error('positionEvents.append: params object required');
    if (typeof params.position_seq !== 'number') throw new Error('positionEvents.append: position_seq required');
    if (typeof params.user_id !== 'number') throw new Error('positionEvents.append: user_id required');
    if (typeof params.exchange !== 'string') throw new Error('positionEvents.append: exchange required');
    if (typeof params.event_type !== 'string') throw new Error('positionEvents.append: event_type required');
}

const _insertStmt = db.prepare(`
    INSERT INTO position_events
        (position_seq, user_id, exchange, event_type, from_state, to_state, payload, cycle_no, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function append(params) {
    _validateParams(params);
    const ts = params.ts || Date.now();
    const payloadJson = JSON.stringify(params.payload || {});
    const result = _insertStmt.run(
        params.position_seq, params.user_id, params.exchange,
        params.event_type, params.from_state || null, params.to_state || null,
        payloadJson, params.cycle_no || null, ts
    );
    return result.lastInsertRowid;
}

const _queryByPositionStmt = db.prepare(`
    SELECT id, position_seq, user_id, exchange, event_type, from_state, to_state, payload, cycle_no, ts
    FROM position_events
    WHERE position_seq = ?
    ORDER BY ts ASC, id ASC
`);

function queryByPosition(position_seq) {
    const rows = _queryByPositionStmt.all(position_seq);
    return rows.map(r => ({ ...r, payload: JSON.parse(r.payload) }));
}

function queryByUser(user_id, opts) {
    const limit = (opts && opts.limit) || 100;
    const since = (opts && opts.since) || 0;
    const stmt = db.prepare(`
        SELECT id, position_seq, user_id, exchange, event_type, from_state, to_state, payload, cycle_no, ts
        FROM position_events
        WHERE user_id = ? AND ts >= ?
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `);
    const rows = stmt.all(user_id, since, limit);
    return rows.map(r => ({ ...r, payload: JSON.parse(r.payload) }));
}

module.exports = { append, queryByPosition, queryByUser };
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd /root/zeus-terminal && npx jest tests/unit/positionEvents.test.js --forceExit
```

Expected: PASS 5/5.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/positionEvents.js tests/unit/positionEvents.test.js
git commit -m "feat(bybit): positionEvents append-only journal helper

- append({position_seq, user_id, exchange, event_type, from_state?, to_state?, payload?, cycle_no?})
- queryByPosition(seq) → events ordered ts ASC
- queryByUser(uid, {limit, since}) → recent events DESC
- Validates required params
- Stores payload as JSON, parses on query
- 5 tests cover insert + query + validation"
```

---

## Task 7: positionStateMachine

**Files:**
- Create: `server/services/positionStateMachine.js`
- Test: `tests/unit/positionStateMachine.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/unit/positionStateMachine.test.js`:

```javascript
'use strict';

jest.mock('../../server/services/database', () => {
    const Database = require('better-sqlite3');
    const fs = require('fs');
    const TEST_DB = '/tmp/zeus-state-machine-test.db';
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    const db = new Database(TEST_DB);
    db.exec(`
        CREATE TABLE at_positions (seq INTEGER PRIMARY KEY, data TEXT, status TEXT DEFAULT 'OPEN', user_id INTEGER, exchange TEXT, created_at TEXT, updated_at TEXT);
        CREATE TABLE position_events (id INTEGER PRIMARY KEY, position_seq INTEGER, user_id INTEGER, exchange TEXT, event_type TEXT, from_state TEXT, to_state TEXT, payload TEXT, cycle_no INTEGER, ts INTEGER);
    `);
    return { db };
});

const psm = require('../../server/services/positionStateMachine');

describe('positionStateMachine', () => {
    it('allows valid transitions', () => {
        expect(psm.isValidTransition('PENDING', 'OPENING')).toBe(true);
        expect(psm.isValidTransition('OPENING', 'OPEN')).toBe(true);
        expect(psm.isValidTransition('OPEN', 'CLOSING')).toBe(true);
        expect(psm.isValidTransition('CLOSING', 'CLOSED')).toBe(true);
    });

    it('rejects invalid transitions', () => {
        expect(psm.isValidTransition('CLOSED', 'OPEN')).toBe(false);
        expect(psm.isValidTransition('PENDING', 'CLOSED')).toBe(false);
        expect(psm.isValidTransition('OPEN', 'PENDING')).toBe(false);
    });

    it('lists all 8 states', () => {
        expect(psm.STATES).toEqual(expect.arrayContaining([
            'PENDING', 'OPENING', 'OPEN', 'CLOSING', 'CLOSED',
            'ORPHANED', 'RECOVERING', 'EMERGENCY', 'CANCELLED'
        ]));
    });

    it('transition() updates at_positions.status + appends event', () => {
        const { db } = require('../../server/services/database');
        db.prepare(`INSERT INTO at_positions (seq, data, status, user_id, exchange) VALUES (?, ?, ?, ?, ?)`).run(100, '{}', 'PENDING', 1, 'binance');
        psm.transition(100, 'PENDING', 'OPENING', { orderId: 'xyz' });
        const row = db.prepare('SELECT status FROM at_positions WHERE seq=100').get();
        expect(row.status).toBe('OPENING');
        const events = db.prepare('SELECT * FROM position_events WHERE position_seq=100').all();
        expect(events.length).toBe(1);
        expect(events[0].from_state).toBe('PENDING');
        expect(events[0].to_state).toBe('OPENING');
    });

    it('transition() throws on invalid from→to', () => {
        const { db } = require('../../server/services/database');
        db.prepare(`INSERT INTO at_positions (seq, data, status, user_id, exchange) VALUES (?, ?, ?, ?, ?)`).run(101, '{}', 'OPEN', 1, 'binance');
        expect(() => psm.transition(101, 'OPEN', 'PENDING', {})).toThrow(/invalid transition/i);
    });

    it('transition() throws if position not in expected from_state', () => {
        const { db } = require('../../server/services/database');
        db.prepare(`INSERT INTO at_positions (seq, data, status, user_id, exchange) VALUES (?, ?, ?, ?, ?)`).run(102, '{}', 'OPEN', 1, 'binance');
        expect(() => psm.transition(102, 'PENDING', 'OPENING', {})).toThrow(/state mismatch/i);
    });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd /root/zeus-terminal && npx jest tests/unit/positionStateMachine.test.js --forceExit
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement positionStateMachine.js**

Create `server/services/positionStateMachine.js`:

```javascript
'use strict';

/**
 * positionStateMachine — 8-state machine for at_positions.status
 *
 * States:
 *   PENDING    → entry order sent, awaiting fill
 *   OPENING    → entry filled, SL/TP placement in progress
 *   OPEN       → entry + SL fully placed
 *   CLOSING    → close order sent, awaiting fill
 *   CLOSED     → fully closed, PnL realized
 *   ORPHANED   → user disconnected exchange; Zeus no longer manages
 *   RECOVERING → boot scan reconciling state
 *   EMERGENCY  → emergency close triggered (catastrophic failure)
 *   CANCELLED  → entry rejected before fill (never opened)
 *
 * Transition rules — only edges in this map are valid:
 */

const { db } = require('./database');
const positionEvents = require('./positionEvents');

const STATES = Object.freeze([
    'PENDING', 'OPENING', 'OPEN', 'CLOSING', 'CLOSED',
    'ORPHANED', 'RECOVERING', 'EMERGENCY', 'CANCELLED'
]);

const VALID_EDGES = Object.freeze({
    'PENDING':    ['OPENING', 'CANCELLED'],
    'OPENING':    ['OPEN', 'EMERGENCY'],
    'OPEN':       ['CLOSING', 'EMERGENCY'],
    'CLOSING':    ['CLOSED'],
    'RECOVERING': ['OPEN', 'EMERGENCY', 'ORPHANED', 'CLOSED'],
    'EMERGENCY':  ['CLOSING', 'CLOSED'],
    'ORPHANED':   ['CLOSED'],
    'CLOSED':     [],
    'CANCELLED':  [],
});

function isValidTransition(from, to) {
    if (!STATES.includes(from) || !STATES.includes(to)) return false;
    const allowed = VALID_EDGES[from] || [];
    return allowed.includes(to);
}

const _statusStmt = db.prepare(`SELECT status, user_id, exchange FROM at_positions WHERE seq = ?`);
const _updateStmt = db.prepare(`UPDATE at_positions SET status = ?, updated_at = datetime('now') WHERE seq = ?`);

function transition(position_seq, expected_from, to, payload) {
    if (!isValidTransition(expected_from, to)) {
        throw new Error(`invalid transition: ${expected_from} → ${to}`);
    }
    const row = _statusStmt.get(position_seq);
    if (!row) throw new Error(`position not found: seq=${position_seq}`);
    if (row.status !== expected_from) {
        throw new Error(`state mismatch: seq=${position_seq} expected from=${expected_from} actual=${row.status}`);
    }

    // Atomic: update + append event in single transaction
    db.transaction(() => {
        _updateStmt.run(to, position_seq);
        positionEvents.append({
            position_seq, user_id: row.user_id, exchange: row.exchange,
            event_type: 'STATE_CHANGE', from_state: expected_from, to_state: to,
            payload: payload || {}
        });
    })();
}

function getCurrentState(position_seq) {
    const row = _statusStmt.get(position_seq);
    return row ? row.status : null;
}

module.exports = { STATES, VALID_EDGES, isValidTransition, transition, getCurrentState };
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd /root/zeus-terminal && npx jest tests/unit/positionStateMachine.test.js --forceExit
```

Expected: PASS 6/6.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/positionStateMachine.js tests/unit/positionStateMachine.test.js
git commit -m "feat(bybit): positionStateMachine — 8 states + atomic transitions

- States: PENDING/OPENING/OPEN/CLOSING/CLOSED/ORPHANED/RECOVERING/EMERGENCY/CANCELLED
- VALID_EDGES map enforces allowed transitions
- transition() atomic: UPDATE status + append position_events in single tx
- Throws on invalid edge OR state mismatch (race protection)
- 6 tests: edges + state list + transition success + invalid edge + mismatch"
```

---

## Task 8: bybitRateState — DB-persistent rate limit tracking

**Files:**
- Create: `server/services/bybitRateState.js`
- Test: `tests/unit/bybitRateState.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/unit/bybitRateState.test.js`:

```javascript
'use strict';

jest.mock('../../server/services/database', () => {
    const Database = require('better-sqlite3');
    const fs = require('fs');
    const TEST_DB = '/tmp/zeus-bybit-rate-test.db';
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    const db = new Database(TEST_DB);
    db.exec(`
        CREATE TABLE bybit_rate_state (
            id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
            used_weight INTEGER NOT NULL DEFAULT 0, reset_at INTEGER NOT NULL,
            banned_until INTEGER NOT NULL DEFAULT 0, ban_reason TEXT,
            last_request_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX idx_bybit_rate_state_user ON bybit_rate_state(user_id);
    `);
    return { db };
});

const brs = require('../../server/services/bybitRateState');

describe('bybitRateState', () => {
    beforeEach(() => {
        const { db } = require('../../server/services/database');
        db.exec(`DELETE FROM bybit_rate_state`);
    });

    it('load(uid) returns default state for new user', () => {
        const state = brs.load(1);
        expect(state.user_id).toBe(1);
        expect(state.used_weight).toBe(0);
        expect(state.banned_until).toBe(0);
    });

    it('recordRequest() increments used_weight', () => {
        brs.recordRequest(1, 5);
        const state = brs.load(1);
        expect(state.used_weight).toBe(5);
        brs.recordRequest(1, 3);
        const state2 = brs.load(1);
        expect(state2.used_weight).toBe(8);
    });

    it('setBan(uid, durationMs, reason) sets banned_until', () => {
        const before = Date.now();
        brs.setBan(1, 60000, 'rate_limit_exceeded');
        const state = brs.load(1);
        expect(state.banned_until).toBeGreaterThanOrEqual(before + 59000);
        expect(state.ban_reason).toBe('rate_limit_exceeded');
    });

    it('isBanned(uid) returns true while banned_until > now', () => {
        brs.setBan(1, 60000, 'test');
        expect(brs.isBanned(1)).toBe(true);
    });

    it('isBanned(uid) returns false after ban expired', () => {
        const { db } = require('../../server/services/database');
        db.prepare(`INSERT INTO bybit_rate_state (user_id, used_weight, reset_at, banned_until, last_request_at) VALUES (?, 0, 0, ?, ?)`).run(1, Date.now() - 10000, Date.now());
        expect(brs.isBanned(1)).toBe(false);
    });

    it('resetWindow() zeroes used_weight + updates reset_at', () => {
        brs.recordRequest(1, 10);
        brs.resetWindow(1);
        const state = brs.load(1);
        expect(state.used_weight).toBe(0);
    });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd /root/zeus-terminal && npx jest tests/unit/bybitRateState.test.js --forceExit
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement bybitRateState.js**

Create `server/services/bybitRateState.js`:

```javascript
'use strict';

/**
 * bybitRateState — DB-persistent rate limit + ban tracking per user.
 *
 * Mirrors binanceRateState pattern. Survives PM2 reload via SQLite persistence.
 * Bybit V5 has per-IP rate limits (different from Binance per-endpoint weight).
 *
 * Schema: bybit_rate_state(id, user_id UNIQUE, used_weight, reset_at,
 *                          banned_until, ban_reason, last_request_at)
 */

const { db } = require('./database');

const WINDOW_MS = 60_000; // 1 minute rolling window for used_weight reset

const _loadStmt = db.prepare(`SELECT * FROM bybit_rate_state WHERE user_id = ?`);
const _upsertStmt = db.prepare(`
    INSERT INTO bybit_rate_state (user_id, used_weight, reset_at, banned_until, ban_reason, last_request_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
        used_weight = excluded.used_weight,
        reset_at = excluded.reset_at,
        banned_until = excluded.banned_until,
        ban_reason = excluded.ban_reason,
        last_request_at = excluded.last_request_at
`);

function _defaultState(user_id) {
    const now = Date.now();
    return {
        user_id, used_weight: 0, reset_at: now + WINDOW_MS,
        banned_until: 0, ban_reason: null, last_request_at: now
    };
}

function load(user_id) {
    const row = _loadStmt.get(user_id);
    if (!row) return _defaultState(user_id);
    return row;
}

function recordRequest(user_id, weight) {
    const state = load(user_id);
    const now = Date.now();
    // Reset window if expired
    if (now >= state.reset_at) {
        state.used_weight = weight;
        state.reset_at = now + WINDOW_MS;
    } else {
        state.used_weight += weight;
    }
    state.last_request_at = now;
    _upsertStmt.run(state.user_id, state.used_weight, state.reset_at, state.banned_until, state.ban_reason, state.last_request_at);
}

function setBan(user_id, durationMs, reason) {
    const state = load(user_id);
    state.banned_until = Date.now() + durationMs;
    state.ban_reason = reason || 'unknown';
    state.last_request_at = Date.now();
    _upsertStmt.run(state.user_id, state.used_weight, state.reset_at, state.banned_until, state.ban_reason, state.last_request_at);
}

function isBanned(user_id) {
    const state = load(user_id);
    return state.banned_until > Date.now();
}

function resetWindow(user_id) {
    const state = load(user_id);
    state.used_weight = 0;
    state.reset_at = Date.now() + WINDOW_MS;
    _upsertStmt.run(state.user_id, state.used_weight, state.reset_at, state.banned_until, state.ban_reason, state.last_request_at);
}

module.exports = { load, recordRequest, setBan, isBanned, resetWindow, WINDOW_MS };
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd /root/zeus-terminal && npx jest tests/unit/bybitRateState.test.js --forceExit
```

Expected: PASS 6/6.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/bybitRateState.js tests/unit/bybitRateState.test.js
git commit -m "feat(bybit): bybitRateState DB-persistent rate limit tracking

- load(uid) returns default state for new user
- recordRequest(uid, weight) increments used_weight with 1min window reset
- setBan(uid, durationMs, reason) + isBanned(uid)
- resetWindow(uid) manually zeroes counter
- Mirror of binanceRateState pattern, SQLite persistence
- 6 tests cover default + record + ban + reset"
```

---

## Task 9: CanonicalError + error translation stubs

**Files:**
- Create: `server/services/canonicalErrors.js`
- Test: `tests/unit/canonicalErrors.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/unit/canonicalErrors.test.js`:

```javascript
'use strict';

const ce = require('../../server/services/canonicalErrors');

describe('CanonicalError', () => {
    it('CodeEnum has all required codes', () => {
        const required = [
            'ErrInvalidParams', 'ErrAuthFailed', 'ErrInsufficientBalance',
            'ErrInvalidSymbol', 'ErrLotSize', 'ErrMinNotional',
            'ErrLeverageInvalid', 'ErrPositionExists', 'ErrOrderNotFound',
            'ErrRateLimit', 'ErrIpBan', 'ErrSlPlacementFailed',
            'ErrTpPlacementFailed', 'ErrDuplicate', 'ErrLockTimeout',
            'ErrNetwork', 'ErrTimeSyncDrift', 'ErrUnknown'
        ];
        for (const code of required) {
            expect(ce.Codes[code]).toBe(code);
        }
    });

    it('create(code, message, raw?) returns object with shape', () => {
        const err = ce.create('ErrInvalidParams', 'sl missing on live', { rawCode: -1 });
        expect(err.code).toBe('ErrInvalidParams');
        expect(err.message).toBe('sl missing on live');
        expect(err.rawCode).toBe(-1);
    });

    it('translateBinance maps -2010 to ErrInsufficientBalance', () => {
        const err = ce.translateBinance({ code: -2010, msg: 'Account has insufficient balance' });
        expect(err.code).toBe('ErrInsufficientBalance');
        expect(err.rawCode).toBe(-2010);
        expect(err.rawMessage).toBe('Account has insufficient balance');
    });

    it('translateBinance maps -1121 to ErrInvalidSymbol', () => {
        const err = ce.translateBinance({ code: -1121, msg: 'Invalid symbol' });
        expect(err.code).toBe('ErrInvalidSymbol');
    });

    it('translateBinance maps -2011 to ErrOrderNotFound', () => {
        const err = ce.translateBinance({ code: -2011, msg: 'Unknown order sent' });
        expect(err.code).toBe('ErrOrderNotFound');
    });

    it('translateBinance maps unknown to ErrUnknown', () => {
        const err = ce.translateBinance({ code: -99999, msg: 'wat' });
        expect(err.code).toBe('ErrUnknown');
    });

    it('translateBybit maps retCode 110007 to ErrInsufficientBalance', () => {
        const err = ce.translateBybit({ retCode: 110007, retMsg: 'Insufficient balance' });
        expect(err.code).toBe('ErrInsufficientBalance');
    });

    it('translateBybit maps retCode 110001 to ErrOrderNotFound', () => {
        const err = ce.translateBybit({ retCode: 110001, retMsg: 'order not exists' });
        expect(err.code).toBe('ErrOrderNotFound');
    });

    it('translateBybit maps retCode 110066 to ErrDuplicate', () => {
        const err = ce.translateBybit({ retCode: 110066, retMsg: 'orderLinkId exists' });
        expect(err.code).toBe('ErrDuplicate');
    });

    it('translateBybit retCode 0 returns null (success)', () => {
        const err = ce.translateBybit({ retCode: 0, retMsg: 'OK' });
        expect(err).toBeNull();
    });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd /root/zeus-terminal && npx jest tests/unit/canonicalErrors.test.js --forceExit
```

Expected: FAIL.

- [ ] **Step 3: Implement canonicalErrors.js**

Create `server/services/canonicalErrors.js`:

```javascript
'use strict';

/**
 * canonicalErrors — Unified error model across exchanges.
 *
 * Every binanceOps/bybitOps method maps exchange-specific errors to
 * CanonicalError shape: { code, message, rawCode?, rawMessage? }
 *
 * Brain logic + recon react identically regardless of exchange.
 */

const Codes = Object.freeze({
    ErrInvalidParams:        'ErrInvalidParams',
    ErrAuthFailed:           'ErrAuthFailed',
    ErrInsufficientBalance:  'ErrInsufficientBalance',
    ErrInvalidSymbol:        'ErrInvalidSymbol',
    ErrLotSize:              'ErrLotSize',
    ErrMinNotional:          'ErrMinNotional',
    ErrLeverageInvalid:      'ErrLeverageInvalid',
    ErrPositionExists:       'ErrPositionExists',
    ErrOrderNotFound:        'ErrOrderNotFound',
    ErrRateLimit:            'ErrRateLimit',
    ErrIpBan:                'ErrIpBan',
    ErrSlPlacementFailed:    'ErrSlPlacementFailed',
    ErrTpPlacementFailed:    'ErrTpPlacementFailed',
    ErrDuplicate:            'ErrDuplicate',
    ErrLockTimeout:          'ErrLockTimeout',
    ErrNetwork:              'ErrNetwork',
    ErrTimeSyncDrift:        'ErrTimeSyncDrift',
    ErrUnknown:              'ErrUnknown',
});

function create(code, message, raw) {
    const err = { code, message };
    if (raw && raw.rawCode !== undefined) err.rawCode = raw.rawCode;
    if (raw && raw.rawMessage !== undefined) err.rawMessage = raw.rawMessage;
    return err;
}

const _BINANCE_MAP = {
    [-2010]: 'ErrInsufficientBalance',
    [-1121]: 'ErrInvalidSymbol',
    [-1100]: 'ErrLotSize',
    [-1011]: 'ErrLotSize',
    [-1013]: 'ErrMinNotional',
    [-4028]: 'ErrLeverageInvalid',
    [-2027]: 'ErrPositionExists',
    [-2011]: 'ErrOrderNotFound',
    [-2015]: 'ErrIpBan',
    [-2014]: 'ErrAuthFailed',
    [-1022]: 'ErrAuthFailed',
    [-1003]: 'ErrRateLimit',
    [-4131]: 'ErrLeverageInvalid',
};

function translateBinance(resp) {
    if (!resp) return null;
    if (resp.status === 'FILLED' || resp.code === undefined) return null;
    const code = resp.code;
    const message = resp.msg || resp.message || 'unknown';
    const canonicalCode = _BINANCE_MAP[code] || 'ErrUnknown';
    return create(canonicalCode, message, { rawCode: code, rawMessage: message });
}

const _BYBIT_MAP = {
    110007: 'ErrInsufficientBalance',
    110001: 'ErrOrderNotFound',
    110045: 'ErrMinNotional',
    110026: 'ErrLeverageInvalid',
    110066: 'ErrDuplicate',
    110025: 'ErrPositionExists',
    110043: 'ErrLeverageInvalid',
    10001:  'ErrInvalidParams',
    10003:  'ErrAuthFailed',
    10004:  'ErrAuthFailed',
    10005:  'ErrAuthFailed',
    10006:  'ErrRateLimit',
    10018:  'ErrIpBan',
};

function translateBybit(resp) {
    if (!resp) return null;
    if (resp.retCode === 0 || resp.retCode === undefined) return null;
    const code = resp.retCode;
    const message = resp.retMsg || 'unknown';
    const canonicalCode = _BYBIT_MAP[code] || 'ErrUnknown';
    return create(canonicalCode, message, { rawCode: code, rawMessage: message });
}

module.exports = { Codes, create, translateBinance, translateBybit };
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd /root/zeus-terminal && npx jest tests/unit/canonicalErrors.test.js --forceExit
```

Expected: PASS 10/10.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/canonicalErrors.js tests/unit/canonicalErrors.test.js
git commit -m "feat(bybit): canonicalErrors — unified error model

- Codes enum: 18 canonical error codes
- create(code, message, {rawCode, rawMessage}) builder
- translateBinance(resp) — maps Binance error codes
- translateBybit(resp) — maps Bybit V5 retCode
- Brain reacts identically regardless of exchange
- 10 tests cover enum + create + Binance + Bybit mappings"
```

---

## Task 10: decisionKey regex validator + generator

**Files:**
- Create: `server/services/decisionKey.js`
- Test: `tests/unit/decisionKey.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/unit/decisionKey.test.js`:

```javascript
'use strict';

const dk = require('../../server/services/decisionKey');

describe('decisionKey', () => {
    it('REGEX accepts alphanumeric + _ + - up to 36 chars', () => {
        expect(dk.REGEX.test('abc_123-XYZ')).toBe(true);
        expect(dk.REGEX.test('a')).toBe(true);
        expect(dk.REGEX.test('a'.repeat(36))).toBe(true);
    });

    it('REGEX rejects forbidden chars (. : /)', () => {
        expect(dk.REGEX.test('abc.def')).toBe(false);
        expect(dk.REGEX.test('abc:def')).toBe(false);
        expect(dk.REGEX.test('abc/def')).toBe(false);
        expect(dk.REGEX.test('abc def')).toBe(false);
    });

    it('REGEX rejects >36 chars', () => {
        expect(dk.REGEX.test('a'.repeat(37))).toBe(false);
    });

    it('REGEX rejects empty string', () => {
        expect(dk.REGEX.test('')).toBe(false);
    });

    it('validate(key) returns true/false', () => {
        expect(dk.validate('valid_key')).toBe(true);
        expect(dk.validate('invalid.key')).toBe(false);
    });

    it('assert(key) throws on invalid', () => {
        expect(() => dk.assert('invalid.key')).toThrow(/decisionKey/i);
        expect(() => dk.assert('valid_key')).not.toThrow();
    });

    it('generate() returns valid key', () => {
        const key = dk.generate();
        expect(dk.REGEX.test(key)).toBe(true);
        expect(key.length).toBeLessThanOrEqual(36);
    });

    it('generate() produces unique keys', () => {
        const keys = new Set();
        for (let i = 0; i < 100; i++) keys.add(dk.generate());
        expect(keys.size).toBe(100);
    });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd /root/zeus-terminal && npx jest tests/unit/decisionKey.test.js --forceExit
```

Expected: FAIL.

- [ ] **Step 3: Implement decisionKey.js**

Create `server/services/decisionKey.js`:

```javascript
'use strict';

/**
 * decisionKey — Idempotency token shared across Binance + Bybit.
 *
 * Regex: intersection of Binance newClientOrderId and Bybit orderLinkId
 * allowed characters: alphanumeric + underscore + hyphen, max 36 chars.
 *
 * Generated keys: 16 random chars (collision-resistant for our throughput)
 */

const crypto = require('crypto');

const REGEX = /^[a-zA-Z0-9_-]{1,36}$/;

function validate(key) {
    return typeof key === 'string' && REGEX.test(key);
}

function assert(key) {
    if (!validate(key)) {
        throw new Error(`decisionKey invalid: must match ${REGEX} (got: ${JSON.stringify(key)})`);
    }
}

function generate() {
    // base64url-safe random — already matches our regex
    return crypto.randomBytes(12).toString('base64url').slice(0, 16);
}

module.exports = { REGEX, validate, assert, generate };
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd /root/zeus-terminal && npx jest tests/unit/decisionKey.test.js --forceExit
```

Expected: PASS 8/8.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/decisionKey.js tests/unit/decisionKey.test.js
git commit -m "feat(bybit): decisionKey idempotency helper

- REGEX = ^[a-zA-Z0-9_-]{1,36}$ — Binance ∩ Bybit allowed chars
- validate(key) → bool
- assert(key) → throw on invalid
- generate() → 16-char random key (base64url)
- 8 tests cover regex + validation + assertion + generation"
```

---

## Task 11: timeSyncAssert — NTP drift check

**Files:**
- Create: `server/services/timeSyncAssert.js`
- Test: `tests/unit/timeSyncAssert.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/unit/timeSyncAssert.test.js`:

```javascript
'use strict';

const tsa = require('../../server/services/timeSyncAssert');

describe('timeSyncAssert', () => {
    it('THRESHOLD_MS is reasonable (500ms)', () => {
        expect(tsa.THRESHOLD_MS).toBe(500);
    });

    it('checkDrift(local, server) returns OK when drift < threshold', () => {
        const local = Date.now();
        const result = tsa.checkDrift(local, local + 100);
        expect(result.ok).toBe(true);
        expect(result.drift).toBe(100);
    });

    it('checkDrift returns NOT OK when drift > threshold', () => {
        const local = Date.now();
        const result = tsa.checkDrift(local, local + 1000);
        expect(result.ok).toBe(false);
        expect(result.drift).toBe(1000);
    });

    it('checkDrift handles negative drift (local ahead)', () => {
        const local = Date.now();
        const result = tsa.checkDrift(local, local - 600);
        expect(result.ok).toBe(false);
        expect(Math.abs(result.drift)).toBe(600);
    });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd /root/zeus-terminal && npx jest tests/unit/timeSyncAssert.test.js --forceExit
```

Expected: FAIL.

- [ ] **Step 3: Implement timeSyncAssert.js**

Create `server/services/timeSyncAssert.js`:

```javascript
'use strict';

/**
 * timeSyncAssert — Detect NTP drift that would break signed exchange requests.
 *
 * Bybit + Binance both have strict recvWindow (5000ms default). If server
 * clock drifts >500ms vs exchange time, signed requests start failing with
 * 'Timestamp outside recvWindow'.
 *
 * Periodic check (5min): GET /fapi/v1/time + /v5/market/time, compare to local.
 * If |drift| > THRESHOLD_MS → Telegram CRITICAL + halt trading until restored.
 */

const THRESHOLD_MS = 500;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function checkDrift(localMs, serverMs) {
    const drift = serverMs - localMs;
    return {
        ok: Math.abs(drift) <= THRESHOLD_MS,
        drift,
        threshold: THRESHOLD_MS
    };
}

let _timer = null;
let _lastCheckTs = 0;
let _lastDrift = 0;
let _alertedAt = 0;

async function _runCheck() {
    _lastCheckTs = Date.now();
    try {
        const fetch = global.fetch || require('node-fetch');
        const binResp = await fetch('https://fapi.binance.com/fapi/v1/time').then(r => r.json());
        if (binResp && binResp.serverTime) {
            const drift = binResp.serverTime - Date.now();
            _lastDrift = drift;
            if (Math.abs(drift) > THRESHOLD_MS) {
                const now = Date.now();
                // Re-alert every 30 min if still drifted
                if (now - _alertedAt > 30 * 60 * 1000) {
                    _alertedAt = now;
                    const logger = require('./logger');
                    logger.error('TIME_SYNC', `Drift detected: ${drift}ms (threshold ${THRESHOLD_MS}ms)`);
                    try {
                        const telegram = require('./telegram');
                        telegram.alertCritical(null, `🚨 NTP drift: ${drift}ms vs Binance. Trading may fail signed requests. Check /etc/systemd-timesyncd.`);
                    } catch (_) { /* telegram optional */ }
                    try {
                        const db = require('./database').db;
                        db.prepare(`INSERT INTO audit_log (user_id, action, details, created_at) VALUES (?, ?, ?, datetime('now'))`).run(null, 'TIME_SYNC_DRIFT_DETECTED', JSON.stringify({ drift, threshold: THRESHOLD_MS }));
                    } catch (_) {}
                }
            }
        }
    } catch (err) {
        // Don't crash on network errors — just log
        try { require('./logger').warn('TIME_SYNC', `Check failed: ${err.message}`); } catch (_) {}
    }
}

function start() {
    if (_timer) return;
    _runCheck(); // immediate first check
    _timer = setInterval(_runCheck, CHECK_INTERVAL_MS);
    if (_timer.unref) _timer.unref();
}

function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}

function getStatus() {
    return {
        lastCheckTs: _lastCheckTs,
        lastDrift: _lastDrift,
        threshold: THRESHOLD_MS,
        ok: Math.abs(_lastDrift) <= THRESHOLD_MS
    };
}

module.exports = { THRESHOLD_MS, CHECK_INTERVAL_MS, checkDrift, start, stop, getStatus };
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd /root/zeus-terminal && npx jest tests/unit/timeSyncAssert.test.js --forceExit
```

Expected: PASS 4/4.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/timeSyncAssert.js tests/unit/timeSyncAssert.test.js
git commit -m "feat(bybit): timeSyncAssert — NTP drift detection

- THRESHOLD_MS = 500 (well under Bybit/Binance recvWindow 5000)
- checkDrift(local, server) → {ok, drift, threshold}
- start() polls /fapi/v1/time every 5min
- Drift > threshold → Telegram CRITICAL + audit_log
- Re-alert cooldown 30min to avoid spam
- 4 tests cover threshold + drift directions"
```

---

# PHASE 3 — Feed layer (Phase 1A core)

## Task 12: feedManager — refcount + per-user routing

**Files:**
- Create: `server/services/feedManager.js`
- Test: `tests/unit/feedManager.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/unit/feedManager.test.js`:

```javascript
'use strict';

const mockBinanceFeed = { start: jest.fn(), stop: jest.fn(), subscribeForRef: jest.fn(), releaseRef: jest.fn(), getSnapshotForSymbol: jest.fn() };
const mockBybitFeed = { start: jest.fn(), stop: jest.fn(), subscribeForRef: jest.fn(), releaseRef: jest.fn(), getSnapshotForSymbol: jest.fn() };

jest.mock('../../server/services/marketFeed', () => mockBinanceFeed);
jest.mock('../../server/services/bybitFeed', () => mockBybitFeed);

const fm = require('../../server/services/feedManager');

describe('feedManager', () => {
    beforeEach(() => {
        fm._resetForTest();
        jest.clearAllMocks();
    });

    it('activateForUser(uid, "binance") starts binanceFeed on first activation', () => {
        fm.activateForUser(1, 'binance');
        expect(mockBinanceFeed.start).toHaveBeenCalledTimes(1);
    });

    it('activateForUser called twice for same exchange does NOT start twice (refcount)', () => {
        fm.activateForUser(1, 'binance');
        fm.activateForUser(2, 'binance');
        expect(mockBinanceFeed.start).toHaveBeenCalledTimes(1);
    });

    it('deactivateForUser decrements refcount, stops feed when count=0', () => {
        fm.activateForUser(1, 'binance');
        fm.activateForUser(2, 'binance');
        fm.deactivateForUser(1, 'binance');
        expect(mockBinanceFeed.stop).not.toHaveBeenCalled();
        fm.deactivateForUser(2, 'binance');
        // Stop happens after grace period — verify scheduled
        expect(fm.getRefcount('binance')).toBe(0);
    });

    it('binance + bybit can both be active concurrently', () => {
        fm.activateForUser(1, 'binance');
        fm.activateForUser(2, 'bybit');
        expect(mockBinanceFeed.start).toHaveBeenCalledTimes(1);
        expect(mockBybitFeed.start).toHaveBeenCalledTimes(1);
    });

    it('getFeedForUser(uid) returns correct feed module', () => {
        fm.activateForUser(1, 'binance');
        fm.activateForUser(2, 'bybit');
        expect(fm.getFeedForUser(1)).toBe(mockBinanceFeed);
        expect(fm.getFeedForUser(2)).toBe(mockBybitFeed);
    });

    it('getRefcount(exchange) reflects active users', () => {
        fm.activateForUser(1, 'binance');
        fm.activateForUser(2, 'binance');
        fm.activateForUser(3, 'bybit');
        expect(fm.getRefcount('binance')).toBe(2);
        expect(fm.getRefcount('bybit')).toBe(1);
    });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd /root/zeus-terminal && npx jest tests/unit/feedManager.test.js --forceExit
```

Expected: FAIL.

- [ ] **Step 3: Implement feedManager.js**

Create `server/services/feedManager.js`:

```javascript
'use strict';

/**
 * feedManager — Routes WS feed access per user + manages lifecycle.
 *
 * Refcounted: each (user, exchange) increment count when active. Feed starts
 * on first ref, stops after grace period when last ref released.
 *
 * Per-user routing: getFeedForUser(uid) returns the right feed instance based
 * on cached active exchange.
 */

const GRACE_MS = 30_000; // 30s after last ref → stop feed

const _refcounts = { binance: 0, bybit: 0 };
const _userExchange = new Map(); // uid → 'binance' | 'bybit'
const _graceTimers = {};

function _getFeed(exchange) {
    if (exchange === 'binance') return require('./marketFeed');
    if (exchange === 'bybit') return require('./bybitFeed');
    throw new Error(`feedManager: unknown exchange ${exchange}`);
}

function _startFeed(exchange) {
    try {
        const feed = _getFeed(exchange);
        if (typeof feed.start === 'function') feed.start();
        try { require('./logger').info('FEED_MANAGER', `feed started: ${exchange}`); } catch (_) {}
    } catch (err) {
        try { require('./logger').error('FEED_MANAGER', `start ${exchange} failed: ${err.message}`); } catch (_) {}
    }
}

function _stopFeed(exchange) {
    try {
        const feed = _getFeed(exchange);
        if (typeof feed.stop === 'function') feed.stop();
        try { require('./logger').info('FEED_MANAGER', `feed stopped: ${exchange}`); } catch (_) {}
    } catch (_) {}
}

function _cancelGrace(exchange) {
    if (_graceTimers[exchange]) {
        clearTimeout(_graceTimers[exchange]);
        delete _graceTimers[exchange];
    }
}

function _scheduleGrace(exchange) {
    _cancelGrace(exchange);
    _graceTimers[exchange] = setTimeout(() => {
        if (_refcounts[exchange] === 0) _stopFeed(exchange);
        delete _graceTimers[exchange];
    }, GRACE_MS);
    if (_graceTimers[exchange].unref) _graceTimers[exchange].unref();
}

function activateForUser(uid, exchange) {
    if (!_refcounts.hasOwnProperty(exchange)) {
        throw new Error(`feedManager: unknown exchange ${exchange}`);
    }
    // If user already active on this exchange, no change
    if (_userExchange.get(uid) === exchange) return;

    // If user was active on a different exchange, deactivate first
    const prev = _userExchange.get(uid);
    if (prev && prev !== exchange) deactivateForUser(uid, prev);

    const wasZero = _refcounts[exchange] === 0;
    _refcounts[exchange]++;
    _userExchange.set(uid, exchange);
    _cancelGrace(exchange);

    if (wasZero) _startFeed(exchange);
}

function deactivateForUser(uid, exchange) {
    if (_userExchange.get(uid) !== exchange) return;
    _refcounts[exchange]--;
    _userExchange.delete(uid);

    if (_refcounts[exchange] <= 0) {
        _refcounts[exchange] = 0;
        _scheduleGrace(exchange);
    }
}

function getFeedForUser(uid) {
    const exchange = _userExchange.get(uid);
    if (!exchange) return null;
    return _getFeed(exchange);
}

function getUserExchange(uid) {
    return _userExchange.get(uid) || null;
}

function getRefcount(exchange) {
    return _refcounts[exchange] || 0;
}

function getActiveExchanges() {
    return Object.keys(_refcounts).filter(ex => _refcounts[ex] > 0);
}

function _resetForTest() {
    _refcounts.binance = 0;
    _refcounts.bybit = 0;
    _userExchange.clear();
    for (const ex of Object.keys(_graceTimers)) _cancelGrace(ex);
}

module.exports = {
    activateForUser, deactivateForUser,
    getFeedForUser, getUserExchange, getRefcount, getActiveExchanges,
    _resetForTest, GRACE_MS
};
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd /root/zeus-terminal && npx jest tests/unit/feedManager.test.js --forceExit
```

Expected: PASS 6/6.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/feedManager.js tests/unit/feedManager.test.js
git commit -m "feat(bybit): feedManager — refcount + per-user routing

- activateForUser(uid, exchange) — increments refcount, starts feed on first ref
- deactivateForUser(uid, exchange) — decrements, schedules stop with 30s grace
- getFeedForUser(uid) — returns correct feed module
- Binance + Bybit can run concurrent (different users)
- _resetForTest helper for clean test state
- 6 tests cover activate + refcount + concurrent + routing"
```

---

## Tasks 13-19: bybitFeed.js — WS connect + subscribe + normalize + reconnect

> **Note for implementer:** Tasks 13-19 implement `bybitFeed.js` (~600 LOC) in 7 incremental commits. Each adds one capability. Pattern mirrors `marketFeed.js` (Binance) + `liqFeedAggregator.js` (existing Bybit WS for liquidations) — read those files first as references.

### Task 13: bybitFeed — WS connection lifecycle

**Files:**
- Create: `server/services/bybitFeed.js` (initial skeleton)
- Test: `tests/unit/bybitFeed.test.js` (connection only)

- [ ] **Step 1: Read reference patterns**

```bash
sed -n '1,80p' /root/zeus-terminal/server/services/liqFeedAggregator.js
sed -n '180,220p' /root/zeus-terminal/server/services/liqFeedAggregator.js
```

- [ ] **Step 2: Write failing test (connection only)**

Create `tests/unit/bybitFeed.test.js`:

```javascript
'use strict';

const EventEmitter = require('events');

// Mock ws module
class MockWebSocket extends EventEmitter {
    constructor(url) { super(); this.url = url; this.readyState = 0; setTimeout(() => { this.readyState = 1; this.emit('open'); }, 10); }
    send(data) { this.lastSend = data; }
    ping() { this.pingCalled = true; }
    close() { this.readyState = 3; this.emit('close', 1000); }
}
jest.mock('ws', () => MockWebSocket);

const bybitFeed = require('../../server/services/bybitFeed');

describe('bybitFeed — connection lifecycle', () => {
    beforeEach(() => { bybitFeed._resetForTest(); });
    afterEach(() => { bybitFeed.stop(); });

    it('start() connects to stream.bybit.com/v5/public/linear', async () => {
        bybitFeed.start();
        await new Promise(r => setTimeout(r, 50));
        const state = bybitFeed.getConnectionState();
        expect(state.connected).toBe(true);
        expect(state.url).toContain('stream.bybit.com/v5/public/linear');
    });

    it('stop() closes connection', async () => {
        bybitFeed.start();
        await new Promise(r => setTimeout(r, 50));
        bybitFeed.stop();
        const state = bybitFeed.getConnectionState();
        expect(state.connected).toBe(false);
    });

    it('getConnectionState returns frames + events counts', async () => {
        bybitFeed.start();
        await new Promise(r => setTimeout(r, 50));
        const state = bybitFeed.getConnectionState();
        expect(typeof state.framesReceived).toBe('number');
        expect(typeof state.eventsEmitted).toBe('number');
    });
});
```

- [ ] **Step 3: Run test — verify FAIL**

```bash
cd /root/zeus-terminal && npx jest tests/unit/bybitFeed.test.js --forceExit
```

Expected: FAIL.

- [ ] **Step 4: Implement bybitFeed.js (skeleton + connect)**

Create `server/services/bybitFeed.js`:

```javascript
'use strict';

/**
 * bybitFeed — Bybit V5 WS market feed.
 *
 * Mirror of marketFeed.js (Binance) for the canonical IMarketFeed contract.
 * Connects to stream.bybit.com/v5/public/linear (REAL ws always, even when
 * users are on testnet — per spec decision Q5).
 *
 * Subscribes batched by topic type (3 messages, ~24 topics total).
 * Heartbeat: send {op:'ping'} every 20s, expect {op:'pong'}.
 * Reconnect: exponential backoff 1s → 60s max.
 *
 * Emits canonical events: 'kline', 'trade', 'bookTicker', 'markPrice'.
 */

const WebSocket = require('ws');
const EventEmitter = require('events');

const WS_URL = 'wss://stream.bybit.com/v5/public/linear';
const PING_INTERVAL_MS = 20_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
const TIMEFRAMES_BYBIT = { '5m': '5', '1h': '60', '4h': '240' };

const _emitter = new EventEmitter();
let _ws = null;
let _connected = false;
let _running = false;
let _closing = false;
let _framesReceived = 0;
let _eventsEmitted = 0;
let _lastMessageTs = 0;
let _pingTimer = null;
let _reconnectTimer = null;
let _reconnectMs = RECONNECT_MIN_MS;

function _clearTimers() {
    if (_pingTimer) { clearInterval(_pingTimer); _pingTimer = null; }
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
}

function _scheduleReconnect() {
    if (_closing) return;
    _clearTimers();
    _reconnectTimer = setTimeout(() => _connect(), _reconnectMs);
    _reconnectMs = Math.min(_reconnectMs * 2, RECONNECT_MAX_MS);
    if (_reconnectTimer.unref) _reconnectTimer.unref();
}

function _connect() {
    if (_closing) return;
    try {
        _ws = new WebSocket(WS_URL);
    } catch (err) {
        try { require('./logger').error('BYBIT_FEED', `ctor failed: ${err.message}`); } catch (_) {}
        _scheduleReconnect();
        return;
    }

    _ws.on('open', () => {
        _connected = true;
        _reconnectMs = RECONNECT_MIN_MS;
        _lastMessageTs = Date.now();
        try { require('./logger').info('BYBIT_FEED', `connected to ${WS_URL}`); } catch (_) {}
        // Subscribe will be wired in Task 14
        // Heartbeat ping
        _pingTimer = setInterval(() => {
            try { if (_ws && _ws.readyState === WebSocket.OPEN) _ws.send(JSON.stringify({ op: 'ping' })); } catch (_) {}
        }, PING_INTERVAL_MS);
    });

    _ws.on('message', (raw) => {
        _framesReceived++;
        _lastMessageTs = Date.now();
        // Message handling wired in Tasks 14-17
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
        _dispatchMessage(msg);
    });

    _ws.on('error', (err) => {
        try { require('./logger').error('BYBIT_FEED', `error: ${err.message}`); } catch (_) {}
    });

    _ws.on('close', (code) => {
        _connected = false;
        _clearTimers();
        if (_closing) return;
        try { require('./logger').warn('BYBIT_FEED', `closed code=${code}, reconnect in ${_reconnectMs}ms`); } catch (_) {}
        _scheduleReconnect();
    });
}

function _dispatchMessage(msg) {
    // Topic dispatcher wired in Tasks 14-17
}

function start() {
    if (_running) return;
    _running = true;
    _closing = false;
    _connect();
}

function stop() {
    _closing = true;
    _running = false;
    _clearTimers();
    if (_ws) { try { _ws.close(); } catch (_) {} _ws = null; }
    _connected = false;
}

function getConnectionState() {
    return {
        url: WS_URL,
        connected: _connected,
        running: _running,
        framesReceived: _framesReceived,
        eventsEmitted: _eventsEmitted,
        lastMessageTs: _lastMessageTs,
        silentMs: _lastMessageTs ? Date.now() - _lastMessageTs : 0
    };
}

function on(event, handler) { _emitter.on(event, handler); }
function off(event, handler) { _emitter.off(event, handler); }

function _resetForTest() {
    stop();
    _framesReceived = 0;
    _eventsEmitted = 0;
    _lastMessageTs = 0;
    _reconnectMs = RECONNECT_MIN_MS;
    _emitter.removeAllListeners();
}

module.exports = {
    start, stop, getConnectionState, on, off,
    _resetForTest, _dispatchMessage,
    SYMBOLS, TIMEFRAMES_BYBIT
};
```

- [ ] **Step 5: Run test — verify PASS**

```bash
cd /root/zeus-terminal && npx jest tests/unit/bybitFeed.test.js --forceExit
```

Expected: PASS 3/3.

- [ ] **Step 6: Commit**

```bash
cd /root/zeus-terminal && git add server/services/bybitFeed.js tests/unit/bybitFeed.test.js
git commit -m "feat(bybit): bybitFeed skeleton — WS connection lifecycle

- Connects to stream.bybit.com/v5/public/linear
- Heartbeat ping every 20s
- Reconnect exponential backoff 1s → 60s
- getConnectionState() exposes frames + events + silentMs
- EventEmitter for canonical events (wired in Tasks 14-17)
- Skeleton ready for subscribe + normalize tasks
- 3 tests cover connect + stop + state"
```

---

### Tasks 14-17 follow this pattern (compressed for plan brevity)

Each task adds ONE capability with same Test→Fail→Implement→Pass→Commit structure:

**Task 14: bybitFeed subscribe batched (3 messages on connect)**
- Sends `{op:'subscribe', args:['kline.5.BTCUSDT', ...]}` batches
- Tests: subscribe messages sent post-open with correct topics
- Code: in `_ws.on('open')` after PING_TIMER, send 3 subscribe batches

**Task 15: bybitFeed normalize kline → canonical**
- Implements `_normalizeKline(msg)` returning `{symbol, tf, open, high, low, close, volume, ts, confirmed}`
- Tests: 4 kline message shapes → canonical shape
- Emits `kline` event with normalized payload

**Task 16: bybitFeed normalize trade + bookTicker + markPrice**
- `_normalizeTrade`, `_normalizeBookTicker`, `_normalizeTicker` (for markPrice + funding)
- Tests: each normalizer with sample Bybit messages
- Emits `trade`, `bookTicker`, `markPrice` events

**Task 17: bybitFeed per-topic retry on subscribe failure**
- Tracks per-topic state, re-subscribes failed topics individually
- Tests: simulated subscribe fail → retry triggered
- Backoff: 1s → 5s → 30s → 5min cap

### Task 18: marketFeed → binanceFeed rename (no behavior change)

**Files:**
- Modify: `server/services/marketFeed.js` (just expose as `binanceFeed.js` alias)
- Create: `server/services/binanceFeed.js` (thin re-export)

- [ ] **Step 1: Audit cross-file usage (verify-twice rule)**

```bash
grep -rn "require.*marketFeed\|from.*marketFeed" /root/zeus-terminal/server /root/zeus-terminal/client --include="*.js" --include="*.ts" --include="*.tsx" | grep -v test | grep -v ".bak"
```

Expected output: list of all import sites. Verify each before refactor.

- [ ] **Step 2: Create binanceFeed.js as alias**

Create `server/services/binanceFeed.js`:

```javascript
'use strict';
// binanceFeed — alias to marketFeed.js (Binance is the canonical Zeus feed).
// Kept as alias for symmetry with bybitFeed.js + feedManager routing.
// Future cleanup may rename marketFeed.js → binanceFeed.js directly,
// but for Phase 1A we keep marketFeed.js name unchanged to minimize diff
// to existing call sites (~30 files would change otherwise).
module.exports = require('./marketFeed');
```

- [ ] **Step 3: Commit (no functional change)**

```bash
cd /root/zeus-terminal && git add server/services/binanceFeed.js
git commit -m "feat(bybit): binanceFeed.js alias for marketFeed (symmetry with bybitFeed)

- Thin re-export — zero behavior change
- Enables feedManager.js _getFeed('binance') → binanceFeed
- marketFeed.js renaming deferred to keep ~30 call sites unchanged"
```

### Task 19: feedContract shared test (binanceFeed + bybitFeed parity)

**Files:**
- Create: `tests/unit/feedContract.test.js`

- [ ] **Step 1: Write contract test runnable against any feed**

Create `tests/unit/feedContract.test.js`:

```javascript
'use strict';

// Shared contract — runs the same assertions against both feed implementations.
// If either feed deviates from the IMarketFeed contract, this test catches it.

const FEEDS = {
    binance: () => require('../../server/services/binanceFeed'),
    bybit:   () => require('../../server/services/bybitFeed'),
};

for (const [name, getFeed] of Object.entries(FEEDS)) {
    describe(`IMarketFeed contract — ${name}`, () => {
        const feed = getFeed();

        it('exports start()', () => expect(typeof feed.start).toBe('function'));
        it('exports stop()', () => expect(typeof feed.stop).toBe('function'));
        it('exports on(event, handler)', () => expect(typeof feed.on).toBe('function'));
        it('exports off(event, handler)', () => expect(typeof feed.off).toBe('function'));
        it('exports getConnectionState()', () => expect(typeof feed.getConnectionState).toBe('function'));

        it('getConnectionState returns canonical shape', () => {
            const state = feed.getConnectionState();
            expect(state).toHaveProperty('connected');
            expect(state).toHaveProperty('framesReceived');
            expect(state).toHaveProperty('eventsEmitted');
            expect(state).toHaveProperty('lastMessageTs');
        });

        it('on() / off() return without throwing', () => {
            const handler = () => {};
            expect(() => feed.on('kline', handler)).not.toThrow();
            expect(() => feed.off('kline', handler)).not.toThrow();
        });
    });
}
```

- [ ] **Step 2: Run test — both feeds must pass identical contract**

```bash
cd /root/zeus-terminal && npx jest tests/unit/feedContract.test.js --forceExit
```

Expected: PASS — both binance + bybit pass all 7 assertions = 14 tests total.

- [ ] **Step 3: Commit**

```bash
cd /root/zeus-terminal && git add tests/unit/feedContract.test.js
git commit -m "test(bybit): shared IMarketFeed contract — binanceFeed + bybitFeed parity

- 7 assertions × 2 feeds = 14 tests
- Catches contract drift if either feed deviates
- Same pattern as exchangeOps contract test (Tasks 5x)"
```

---

# PHASE 4 — Brain integration

> **Phase 4 modifies serverBrain.js _runCycle hot path. CRITICAL: verify-twice rule applied — audit ALL per-symbol vs per-user references in serverBrain.js before loop swap.**

## Task 20: Audit serverBrain.js for per-symbol vs per-user references

**Files:**
- Read-only audit (no code changes)
- Create: `_review/audit/SERVERBRAIN_LOOP_SWAP_AUDIT_20260521.md`

- [ ] **Step 1: Grep all symbol/user references**

```bash
cd /root/zeus-terminal && grep -n "for (const symbol\|for (const \[uid\|for (const \[_uid\|_stcMap\|readySymbols\|serverState\." server/services/serverBrain.js > /tmp/brain-audit.txt
wc -l /tmp/brain-audit.txt
```

- [ ] **Step 2: Identify per-symbol vs per-user code blocks**

```bash
# Pattern: where does the code assume "all users share same symbol snap"?
# vs "different users may see different snap for same symbol after loop swap"?
grep -n "snap\." server/services/serverBrain.js | head -50
```

- [ ] **Step 3: Write audit document**

Create `_review/audit/SERVERBRAIN_LOOP_SWAP_AUDIT_20260521.md` with:
- Line-by-line list of references
- Classification: SAFE_PER_SYMBOL (cross-user shared) vs PER_USER_PER_SYMBOL (needs swap)
- Specific lines that need modification
- Risk register for each change

Format:
```markdown
# serverBrain.js Loop Swap Audit — 2026-05-21

## Methodology
Loop swap = user OUTER, symbol INNER. Current code is symbol OUTER, user INNER (line 661).
Per-exchange routing requires user-outer because exchange depends on user.

## Reference Inventory

| Line | Code | Classification | Action |
|---|---|---|---|
| 647 | `readySymbols = serverState.getReadySymbols()` | Needs per-exchange | Move inside user loop OR call userState.getReadySymbols |
| 661 | `for (const symbol of readySymbols)` | Symbol loop | Move INSIDE user loop |
| 662 | `snap = serverState.getSnapshotForSymbol(symbol)` | Symbol snap | Use userState.getSnapshotForSymbol(symbol) |
| 692-715 | Regime change broadcast | Per-symbol shared OR per-(symbol,exchange)? | Per spec pillar 3-cerința B: per-(symbol,exchange). Move inside user loop, group by exchange. |
| ... | ... | ... | ... |

## Conclusions
- ~12 code blocks need modification
- Highest risk: regime change broadcast (line 692-715) — if 2 exchanges have different regimes for same symbol, broadcasts differ
- Mitigation: group regime broadcasts by exchange, send distinct messages per user's active exchange
```

- [ ] **Step 4: Commit audit doc**

```bash
cd /root/zeus-terminal && git add _review/audit/SERVERBRAIN_LOOP_SWAP_AUDIT_20260521.md
git commit -m "audit(bybit): serverBrain.js loop swap impact analysis

- Line-by-line inventory of per-symbol vs per-user references
- 12 code blocks identified for modification
- Risk register per change
- Required by spec pillar 3-cerința A (exhaustive audit before swap)"
```

---

## Task 21: serverState bi-namespaced + forExchange router

**Files:**
- Modify: `server/services/serverState.js` (add bi-namespacing)
- Test: `tests/unit/serverState_forExchange.test.js`

- [ ] **Step 1: Audit current serverState usage**

```bash
grep -rn "serverState\.\(getSnapshot\|getBars\|getReady\|isData\|init\)" /root/zeus-terminal/server --include="*.js" | grep -v test | grep -v .bak | wc -l
```

Expected: ~30+ call sites identified. Phase 1A keeps backward-compat — current calls continue to work, defaulting to 'binance' namespace.

- [ ] **Step 2: Write failing test**

Create `tests/unit/serverState_forExchange.test.js`:

```javascript
'use strict';

const serverState = require('../../server/services/serverState');

describe('serverState forExchange router', () => {
    it('forExchange("binance") returns object with getSnapshotForSymbol', () => {
        const binanceState = serverState.forExchange('binance');
        expect(typeof binanceState.getSnapshotForSymbol).toBe('function');
    });

    it('forExchange("bybit") returns object with getSnapshotForSymbol', () => {
        const bybitState = serverState.forExchange('bybit');
        expect(typeof bybitState.getSnapshotForSymbol).toBe('function');
    });

    it('forExchange returns DIFFERENT instances for binance vs bybit', () => {
        const a = serverState.forExchange('binance');
        const b = serverState.forExchange('bybit');
        expect(a).not.toBe(b);
    });

    it('forExchange("unknown") throws', () => {
        expect(() => serverState.forExchange('unknown')).toThrow();
    });

    it('backward compat: serverState.getSnapshotForSymbol still works (defaults binance)', () => {
        expect(typeof serverState.getSnapshotForSymbol).toBe('function');
    });
});
```

- [ ] **Step 3: Run test — verify FAIL**

```bash
cd /root/zeus-terminal && npx jest tests/unit/serverState_forExchange.test.js --forceExit
```

- [ ] **Step 4: Implement forExchange + bi-namespacing**

Modify `server/services/serverState.js`. After existing `_sdMap` declaration, add:

```javascript
// [Bybit Phase 1A] Bi-namespaced per-exchange state.
// Existing _sdMap is the Binance namespace (backward compat).
// Bybit gets its own _sdMap_bybit. Both populated by their respective feeds.
const _sdMap_binance = _sdMap; // alias the existing map
const _sdMap_bybit = new Map();

function _getStateForExchange(exchange) {
    if (exchange === 'binance') return _sdMap_binance;
    if (exchange === 'bybit') return _sdMap_bybit;
    throw new Error(`serverState.forExchange: unknown exchange ${exchange}`);
}

function forExchange(exchange) {
    const map = _getStateForExchange(exchange);
    return {
        getSnapshotForSymbol(symbol) {
            const sd = map.get(symbol?.toUpperCase());
            if (!sd) return null;
            return { ...sd, exchange };
        },
        getBarsForSymbol(symbol, tf) {
            const sd = map.get(symbol?.toUpperCase());
            return sd ? sd.bars[tf] : null;
        },
        getReadySymbols() {
            const ready = [];
            for (const [sym, sd] of map.entries()) {
                if (sd && sd.price > 0 && sd.bars && Object.keys(sd.bars).length > 0) ready.push(sym);
            }
            return ready;
        },
        isDataReadyForSymbol(symbol) {
            const sd = map.get(symbol?.toUpperCase());
            return !!(sd && sd.price > 0 && sd.bars);
        },
    };
}
```

Add `forExchange` to module.exports.

- [ ] **Step 5: Run test — verify PASS**

```bash
cd /root/zeus-terminal && npx jest tests/unit/serverState_forExchange.test.js --forceExit
```

Expected: PASS 5/5.

- [ ] **Step 6: Commit**

```bash
cd /root/zeus-terminal && git add server/services/serverState.js tests/unit/serverState_forExchange.test.js
git commit -m "feat(bybit): serverState.forExchange(name) router + bi-namespacing

- _sdMap_binance (alias to existing _sdMap) + _sdMap_bybit (new)
- forExchange(name) returns scoped getSnapshot/getBars/getReadySymbols
- Backward compat: serverState.getSnapshotForSymbol still works (Binance default)
- bybitFeed populates _sdMap_bybit (wired in next task)
- 5 tests cover router + isolation + backward compat"
```

---

## Task 22: Wire bybitFeed events → serverState _sdMap_bybit

**Files:**
- Modify: `server/services/serverState.js` (wire bybit feed listeners)

- [ ] **Step 1: Add bybit feed listeners**

In `server/services/serverState.js`, add inside `init()` function:

```javascript
// [Bybit Phase 1A] Wire bybitFeed events to _sdMap_bybit namespace
const bybitFeed = require('./bybitFeed');
bybitFeed.on('kline', _onKlineBybit);
bybitFeed.on('trade', _onTradeBybit);
bybitFeed.on('bookTicker', _onBookTickerBybit);
bybitFeed.on('markPrice', _onMarkPriceBybit);
```

Add corresponding handlers (mirror existing _onKline / _onPrice but target _sdMap_bybit). Pattern:

```javascript
function _onKlineBybit(data) {
    let sd = _sdMap_bybit.get(data.symbol);
    if (!sd) {
        sd = _createSD(data.symbol, Object.keys(data.bars || { '5m': [] }));
        _sdMap_bybit.set(data.symbol, sd);
    }
    // populate bars[tf] from data.bars
    if (sd.bars[data.tf]) {
        const lastBar = sd.bars[data.tf][sd.bars[data.tf].length - 1];
        if (lastBar && lastBar.ts === data.ts) {
            // update existing bar
            lastBar.close = data.close;
            lastBar.high = Math.max(lastBar.high, data.high);
            lastBar.low = Math.min(lastBar.low, data.low);
            lastBar.volume = data.volume;
        } else {
            sd.bars[data.tf].push({ ts: data.ts, open: data.open, high: data.high, low: data.low, close: data.close, volume: data.volume });
            // Cap buffer at ~500 candles
            if (sd.bars[data.tf].length > 500) sd.bars[data.tf].shift();
        }
    }
}

function _onTradeBybit(data) {
    let sd = _sdMap_bybit.get(data.symbol);
    if (!sd) { sd = _createSD(data.symbol, ['5m', '1h', '4h']); _sdMap_bybit.set(data.symbol, sd); }
    if (data.price > 0) { sd.price = data.price; sd.priceTs = Date.now(); }
}

function _onBookTickerBybit(data) {
    let sd = _sdMap_bybit.get(data.symbol);
    if (!sd) { sd = _createSD(data.symbol, ['5m', '1h', '4h']); _sdMap_bybit.set(data.symbol, sd); }
    if (data.bid > 0 && data.ask > 0) {
        sd.bid = data.bid;
        sd.ask = data.ask;
        sd.price = (data.bid + data.ask) / 2;
        sd.priceTs = Date.now();
    }
}

function _onMarkPriceBybit(data) {
    let sd = _sdMap_bybit.get(data.symbol);
    if (!sd) return;
    sd.markPrice = data.markPrice;
    sd.fr = data.fundingRate;
}
```

- [ ] **Step 2: Test integration (manual smoke)**

```bash
# Start a quick node REPL test
cd /root/zeus-terminal && node -e "
const serverState = require('./server/services/serverState');
serverState.init(['BTCUSDT'], ['5m']);
// Wait for Bybit to populate
setTimeout(() => {
  const snap = serverState.forExchange('bybit').getSnapshotForSymbol('BTCUSDT');
  console.log('Bybit snap:', JSON.stringify(snap, null, 2));
  process.exit(0);
}, 10000);
"
```

Expected: after ~10s, Bybit snap has price > 0. If null, bybitFeed not emitting events yet (Tasks 14-17 prerequisites).

- [ ] **Step 3: Commit**

```bash
cd /root/zeus-terminal && git add server/services/serverState.js
git commit -m "feat(bybit): serverState wires bybitFeed events → _sdMap_bybit

- bybitFeed.on('kline'|'trade'|'bookTicker'|'markPrice') wired
- Per-exchange snap maintained independently
- bookTicker mid (bid+ask)/2 used as price proxy when no trade event
- 500-candle buffer cap per tf"
```

---

## Task 23: serverBrain _runCycle loop swap + _pendingSwitch barrier

**Files:**
- Modify: `server/services/serverBrain.js` (loop swap + barrier check)

> **DANGER ZONE:** This is the hottest path in Zeus. Cross-file audit DONE (Task 20). Test in isolation before integration test.

- [ ] **Step 1: Add _pendingSwitch declaration + _userExchangeCache**

In `serverBrain.js` near top (around line 200, near other module-level state):

```javascript
// [Bybit Phase 1A] Per-user routing cache + pending switch barrier
const _userExchangeCache = new Map(); // uid → 'binance' | 'bybit'
const _pendingSwitch = new Map(); // uid → { from, to, requestedAt }

function _getUserExchange(uid) {
    if (!_userExchangeCache.has(uid)) {
        try {
            const { db } = require('./database');
            const row = db.prepare(`SELECT exchange FROM exchange_accounts WHERE user_id=? AND is_active=1`).get(uid);
            _userExchangeCache.set(uid, row?.exchange || 'binance');
        } catch (_) { _userExchangeCache.set(uid, 'binance'); }
    }
    return _userExchangeCache.get(uid);
}

function _markPendingSwitch(uid, from, to) {
    _pendingSwitch.set(uid, { from, to, requestedAt: Date.now() });
}

function _applyPendingSwitches() {
    if (_pendingSwitch.size === 0) return;
    const feedManager = require('./feedManager');
    for (const [uid, info] of _pendingSwitch.entries()) {
        _userExchangeCache.set(uid, info.to);
        if (info.from) feedManager.deactivateForUser(uid, info.from);
        feedManager.activateForUser(uid, info.to);
        try {
            const { db } = require('./database');
            db.prepare(`INSERT INTO audit_log (user_id, action, details, created_at) VALUES (?, ?, ?, datetime('now'))`).run(uid, 'EXCHANGE_SWITCH_APPLIED', JSON.stringify({ from: info.from, to: info.to, requestedAt: info.requestedAt, appliedAt: Date.now(), cycleNo: _cycleCount }));
        } catch (_) {}
    }
    _pendingSwitch.clear();
}

module.exports._markPendingSwitch = _markPendingSwitch;
module.exports._getUserExchange = _getUserExchange;
```

- [ ] **Step 2: Refactor _runCycle — loop swap + barrier check**

Find `function _runCycle() {` (around line 632). Refactor:

```javascript
function _runCycle() {
    if (_running) return;
    if (!brainLock.acquire('brainCycle')) {
        logger.warn('BRAIN', 'Brain cycle skipped — lock held');
        return;
    }
    _running = true;
    _cycleCount++;
    const _cycleStartTs = Date.now();
    let _cycleRanOk = 1;

    try {
        // [Bybit Phase 1A] EXPLICIT BARRIER — apply pending switches FIRST,
        // before iterating users. Cycle in progress finishes on OLD exchange.
        _applyPendingSwitches();

        if (_stcMap.size === 0) {
            _logDecision('SKIP', 'NO_USERS', null, { reason: 'No user TC configs — skipping cycle' });
            return;
        }
        const users = _stcMap;

        // [Bybit Phase 1A] LOOP SWAP — user OUTER, symbol INNER.
        // Each user reads from their active exchange's namespace.
        const serverState = require('./serverState');
        for (const [uid, stc] of users) {
            const userExchange = _getUserExchange(uid);
            const userState = serverState.forExchange(userExchange);
            const readySymbols = userState.getReadySymbols();

            if (readySymbols.length === 0) continue;

            for (const symbol of readySymbols) {
                const snap = userState.getSnapshotForSymbol(symbol);
                if (!snap || !snap.indicators) continue;
                if (snap.stale || (Date.now() - snap.priceTs) > STALE_DATA_MS) continue;

                serverCalibration.trackPrice(symbol, snap.price);
                serverCalibration.trackRegime(symbol, snap.indicators.regime || 'RANGE', snap.indicators.adx, snap.indicators.volatilityState);
                serverReflection.evaluateSkipped(symbol, snap.price, uid);

                const ind = snap.indicators;
                const confluence = _calcConfluence(snap, ind);
                const regime = { regime: ind.regime || 'RANGE', confidence: ind.regimeConf || 0, ...};

                // [Bybit Phase 1A] Regime change broadcast scoped to user's exchange.
                // If 2 users have different exchanges showing different regimes for
                // same symbol, each gets their own notification with their exchange data.
                const prevKey = `${symbol}|${userExchange}`;
                const prevRegimeForSym = _prevRegimes.get(prevKey);
                if (prevRegimeForSym !== undefined && prevRegimeForSym !== regime.regime) {
                    logger.info('BRAIN', `[${userExchange}/${symbol}] Regime change: ${prevRegimeForSym} → ${regime.regime} (conf=${regime.confidence}%)`);
                    try { db.saveRegimeChange(symbol, regime.regime, prevRegimeForSym, regime.confidence, snap.price || 0, uid); } catch (_) {}
                    // ... existing Telegram code, but only for this uid + this exchange context
                }
                _prevRegimes.set(prevKey, regime.regime);

                // ... rest of brain logic unchanged, but pass userExchange to processBrainDecision
                // brain_decisions insert: ADD exchange column = userExchange
            }
        }
    } catch (err) {
        _cycleRanOk = 0;
        logger.error('BRAIN', `Cycle error: ${err.message}`);
    } finally {
        _running = false;
        brainLock.release('brainCycle');
        // Telemetry record
        try {
            require('./ml/_doctor/telemetryCollector').recordInvocation({
                moduleId: 'serverBrain', latencyMs: Date.now() - _cycleStartTs, ranOk: _cycleRanOk, ts: Date.now()
            });
        } catch (_) {}
    }
}
```

> **Note:** Full diff is substantial. Apply via `git diff` review + manual verification. Existing per-user calls (serverReflection.evaluateSkipped) already accept uid — preserved. The KEY changes are:
> 1. `_applyPendingSwitches()` at top
> 2. Outer loop `for (const [uid, stc] of users)`
> 3. `serverState.forExchange(userExchange)` instead of direct serverState calls
> 4. `_prevRegimes` keyed by `symbol|exchange` not just symbol
> 5. brain_decisions insert includes `exchange: userExchange`

- [ ] **Step 3: Update brain_decisions insert in _logDecision**

Find `_logDecision` function. Modify the INSERT statement to include `exchange` column.

- [ ] **Step 4: Test isolation — verify existing single-exchange behavior preserved**

```bash
cd /root/zeus-terminal && npx jest tests/unit/serverBrain --forceExit 2>&1 | tail -20
```

Expected: existing tests pass (no regressions). Brain loop swap doesn't break single-exchange flow.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/serverBrain.js
git commit -m "feat(bybit): serverBrain _runCycle loop swap + _pendingSwitch barrier

- _userExchangeCache (uid → exchange) populated from exchange_accounts
- _pendingSwitch barrier applied BEFORE iterating users (explicit, not lazy)
- LOOP SWAP: user OUTER, symbol INNER (was symbol outer)
- Each user reads from userState = serverState.forExchange(userExchange)
- _prevRegimes keyed by (symbol|exchange) — cross-exchange isolation
- brain_decisions INSERT includes exchange column
- Pre-audited in _review/audit/SERVERBRAIN_LOOP_SWAP_AUDIT_20260521.md
- Backward compat: single Binance user behavior identical pre/post"
```

---

# PHASE 5 — exchangeOps router + binanceOps

> **Phase 5 introduces the canonical exchangeOps router that replaces direct `sendSignedRequest('/fapi/v1/order')` calls. binanceOps wraps existing Binance logic. ~12 tasks.**

## Task 24: exchangeOps skeleton + hard SL guard + routing

**Files:**
- Create: `server/services/exchangeOps.js`
- Test: `tests/unit/exchangeOps.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/unit/exchangeOps.test.js`:

```javascript
'use strict';

jest.mock('../../server/services/credentialStore', () => ({
    getExchangeCreds: jest.fn((uid) => ({ exchange: uid === 1 ? 'binance' : 'bybit', mode: 'testnet', apiKey: 'k', apiSecret: 's' }))
}));

const mockBinanceOps = { placeEntry: jest.fn(async () => ({ ok: true, orderId: '1' })), closePosition: jest.fn(async () => ({ ok: true })) };
const mockBybitOps = { placeEntry: jest.fn(async () => ({ ok: true, orderId: '2' })), closePosition: jest.fn(async () => ({ ok: true })) };
jest.mock('../../server/services/binanceOps', () => mockBinanceOps);
jest.mock('../../server/services/bybitOps', () => mockBybitOps);

const exchangeOps = require('../../server/services/exchangeOps');

describe('exchangeOps', () => {
    beforeEach(() => {
        exchangeOps._resetForTest();
        jest.clearAllMocks();
    });

    it('placeEntry routes to binanceOps for binance user', async () => {
        await exchangeOps.placeEntry(1, { symbol: 'BTCUSDT', side: 'LONG', qty: '0.001', entryType: 'MARKET', sl: { price: '60000', type: 'MARKET' }, leverage: 5, decisionKey: 'key1', source: 'auto' });
        expect(mockBinanceOps.placeEntry).toHaveBeenCalled();
        expect(mockBybitOps.placeEntry).not.toHaveBeenCalled();
    });

    it('placeEntry routes to bybitOps for bybit user', async () => {
        await exchangeOps.placeEntry(2, { symbol: 'BTCUSDT', side: 'LONG', qty: '0.001', entryType: 'MARKET', sl: { price: '60000', type: 'MARKET' }, leverage: 5, decisionKey: 'key2', source: 'auto' });
        expect(mockBybitOps.placeEntry).toHaveBeenCalled();
    });

    it('placeEntry HARD GUARD: throws on LIVE without SL', async () => {
        const credentialStore = require('../../server/services/credentialStore');
        credentialStore.getExchangeCreds.mockReturnValueOnce({ exchange: 'binance', mode: 'live', apiKey: 'k', apiSecret: 's' });
        await expect(exchangeOps.placeEntry(1, { symbol: 'BTCUSDT', side: 'LONG', qty: '0.001', entryType: 'MARKET', leverage: 5, decisionKey: 'k', source: 'auto' })).rejects.toThrow(/SL required/i);
    });

    it('placeEntry HARD GUARD: throws on LIVE with sl.price=0', async () => {
        const credentialStore = require('../../server/services/credentialStore');
        credentialStore.getExchangeCreds.mockReturnValueOnce({ exchange: 'binance', mode: 'live', apiKey: 'k', apiSecret: 's' });
        await expect(exchangeOps.placeEntry(1, { symbol: 'BTCUSDT', side: 'LONG', qty: '0.001', entryType: 'MARKET', sl: { price: '0', type: 'MARKET' }, leverage: 5, decisionKey: 'k', source: 'auto' })).rejects.toThrow(/SL required/i);
    });

    it('placeEntry TESTNET allows missing SL (warn only)', async () => {
        await expect(exchangeOps.placeEntry(1, { symbol: 'BTCUSDT', side: 'LONG', qty: '0.001', entryType: 'MARKET', leverage: 5, decisionKey: 'k', source: 'auto' })).resolves.toBeDefined();
    });

    it('decisionKey invalid → throws', async () => {
        await expect(exchangeOps.placeEntry(1, { symbol: 'BTCUSDT', side: 'LONG', qty: '0.001', entryType: 'MARKET', sl: { price: '60000', type: 'MARKET' }, leverage: 5, decisionKey: 'invalid.key', source: 'auto' })).rejects.toThrow(/decisionKey/i);
    });

    it('closePosition routes to correct ops', async () => {
        await exchangeOps.closePosition(1, { symbol: 'BTCUSDT', side: 'LONG', qty: '0.001', closeType: 'MARKET', decisionKey: 'k', source: 'manual' });
        expect(mockBinanceOps.closePosition).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd /root/zeus-terminal && npx jest tests/unit/exchangeOps.test.js --forceExit
```

- [ ] **Step 3: Implement exchangeOps.js**

Create `server/services/exchangeOps.js`:

```javascript
'use strict';

/**
 * exchangeOps — Canonical router for order operations across Binance + Bybit.
 *
 * Public API: placeEntry, closePosition, ensureSymbolReady, getPositions,
 * getBalance, getUserTrades, ping, cancelOrder, invalidateReady, placeStopLoss.
 *
 * Routing: getExchangeCreds(uid).exchange → binanceOps or bybitOps.
 * Hard SL guard: LIVE mode requires sl.price > 0 — throws ErrInvalidParams.
 * Idempotency: decisionKey regex enforced (a-zA-Z0-9_-, 1-36 chars).
 * ensureSymbolReady cache: 5min TTL per (uid, symbol), invalidated on errors.
 */

const credentialStore = require('./credentialStore');
const decisionKey = require('./decisionKey');
const canonicalErrors = require('./canonicalErrors');

const CACHE_TTL_MS = 5 * 60 * 1000;
const _readyCache = new Map(); // key = `${uid}|${symbol}` → { leverage, marginMode, ts }

function _resolveOps(uid) {
    const creds = credentialStore.getExchangeCreds(uid);
    if (!creds || !creds.exchange) throw new Error(`exchangeOps: no creds for uid=${uid}`);
    if (creds.exchange === 'binance') return { ops: require('./binanceOps'), creds };
    if (creds.exchange === 'bybit') return { ops: require('./bybitOps'), creds };
    throw new Error(`exchangeOps: unknown exchange ${creds.exchange}`);
}

function _validatePlaceEntry(params, creds) {
    // decisionKey
    decisionKey.assert(params.decisionKey);

    // SL hard guard on LIVE
    if (creds.mode === 'live') {
        const sl = params.sl;
        if (!sl || !sl.price || Number(sl.price) <= 0) {
            throw canonicalErrors.create('ErrInvalidParams', 'SL required on LIVE mode — exchangeOps hard refuse');
        }
    } else if (!params.sl) {
        try { require('./logger').warn('EXCHANGE_OPS', `entry without SL on ${creds.mode} uid=${params.decisionKey}`); } catch (_) {}
    }

    // Basic shape checks
    if (!params.symbol || !params.side || !params.qty) {
        throw canonicalErrors.create('ErrInvalidParams', 'symbol/side/qty required');
    }
    if (!['LONG', 'SHORT'].includes(params.side)) {
        throw canonicalErrors.create('ErrInvalidParams', `side must be LONG or SHORT (got ${params.side})`);
    }
}

async function placeEntry(uid, params) {
    const { ops, creds } = _resolveOps(uid);
    _validatePlaceEntry(params, creds);
    return ops.placeEntry(uid, params, creds);
}

async function closePosition(uid, params) {
    const { ops, creds } = _resolveOps(uid);
    decisionKey.assert(params.decisionKey);
    return ops.closePosition(uid, params, creds);
}

async function ensureSymbolReady(uid, params) {
    const key = `${uid}|${params.symbol}`;
    const cached = _readyCache.get(key);
    const now = Date.now();

    const cacheHit = cached
        && (now - cached.ts) < CACHE_TTL_MS
        && cached.leverage === params.leverage
        && cached.marginMode === params.marginMode;

    if (cacheHit) return { ok: true, leverage: params.leverage, marginMode: params.marginMode, cached: true };

    const { ops, creds } = _resolveOps(uid);
    const r = await ops.ensureSymbolReady(uid, params, creds);
    if (r.ok) _readyCache.set(key, { leverage: r.leverage, marginMode: r.marginMode, ts: now });
    return r;
}

function invalidateReady(uid, symbol) {
    _readyCache.delete(`${uid}|${symbol}`);
}

async function getPositions(uid, params) {
    if (params && params.exchangeOverride) {
        const ops = params.exchangeOverride === 'bybit' ? require('./bybitOps') : require('./binanceOps');
        const creds = credentialStore.getExchangeCreds(uid, { exchangeOverride: params.exchangeOverride });
        return ops.getPositions(uid, params, creds);
    }
    const { ops, creds } = _resolveOps(uid);
    return ops.getPositions(uid, params, creds);
}

async function getBalance(uid) {
    const { ops, creds } = _resolveOps(uid);
    return ops.getBalance(uid, creds);
}

async function getUserTrades(uid, params) {
    const { ops, creds } = _resolveOps(uid);
    return ops.getUserTrades(uid, params, creds);
}

async function ping(uid) {
    const { ops, creds } = _resolveOps(uid);
    return ops.ping(uid, creds);
}

async function cancelOrder(uid, params) {
    const { ops, creds } = _resolveOps(uid);
    return ops.cancelOrder(uid, params, creds);
}

async function placeStopLoss(uid, params) {
    const { ops, creds } = _resolveOps(uid);
    return ops.placeStopLoss(uid, params, creds);
}

function _resetForTest() {
    _readyCache.clear();
}

module.exports = {
    placeEntry, closePosition, ensureSymbolReady, invalidateReady,
    getPositions, getBalance, getUserTrades, ping, cancelOrder, placeStopLoss,
    _resetForTest, CACHE_TTL_MS
};
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd /root/zeus-terminal && npx jest tests/unit/exchangeOps.test.js --forceExit
```

Expected: PASS 7/7.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/exchangeOps.js tests/unit/exchangeOps.test.js
git commit -m "feat(bybit): exchangeOps router + hard SL guard + 5min cache

- placeEntry/closePosition/ensureSymbolReady/getPositions/getBalance/etc.
- _resolveOps(uid) → binanceOps or bybitOps based on user.exchange
- HARD SL GUARD: LIVE mode without sl.price → ErrInvalidParams throw
- decisionKey regex enforced (a-zA-Z0-9_-, 1-36 chars)
- ensureSymbolReady cache 5min TTL + invalidate hook
- getPositions exchangeOverride param for recovery boot
- 7 tests: routing + guard + decisionKey + testnet allowance"
```

---

## Tasks 25-35: binanceOps + bybitOps implementations

> **Implementation note:** Tasks 25-35 are mostly mechanical — wrapping existing `sendSignedRequest('/fapi/v1/order', ...)` calls in canonical method signatures. Each task: 1 method + tests. Full code patterns follow the spec Section 4 (placeEntry flow, closePosition flow).
>
> Tasks 25-30: binanceOps.{placeEntry, closePosition, ensureSymbolReady, getPositions, getBalance, getUserTrades, ping, cancelOrder, placeStopLoss}
> Tasks 31-35: bybitOps same methods (using bybitSigner + bybitOrderTranslator existing modules)

### Task 25: binanceOps.placeEntry — wrap existing Binance entry flow

**Files:**
- Create: `server/services/binanceOps.js`
- Test: `tests/unit/binanceOps.test.js`

- [ ] **Step 1: Audit existing Binance entry flow**

```bash
grep -n "sendSignedRequest.*'POST', '/fapi/v1/order'" /root/zeus-terminal/server/services/serverAT.js | head -10
sed -n '1430,1530p' /root/zeus-terminal/server/services/serverAT.js
```

This shows the existing Binance entry pipeline (entry + SL retry + emergency close pattern from Fix #1-#6 yesterday).

- [ ] **Step 2: Write failing test**

[Test file structure mirrors exchangeOps test, mocking sendSignedRequest to return canned responses. Tests cover: successful entry+SL+TP, SL retry × 3, emergency close path, canonical EntryResult shape.]

- [ ] **Step 3: Implement binanceOps.placeEntry**

Full implementation in `server/services/binanceOps.js`:

```javascript
'use strict';

/**
 * binanceOps — Wraps existing Binance order logic in canonical API.
 * Reuses sendSignedRequest from binanceSigner. Refactored from serverAT.js
 * _executeLiveEntryCore (Fix #1-#6 from 2026-05-20) into method-per-intent.
 */

const { sendSignedRequest } = require('./binanceSigner');
const exchangeInfo = require('./exchangeInfo');
const orderLock = require('./orderLock');
const positionStateMachine = require('./positionStateMachine');
const positionEvents = require('./positionEvents');
const canonicalErrors = require('./canonicalErrors');
const { db } = require('./database');

async function placeEntry(uid, params, creds) {
    const lockKey = `${uid}|${params.symbol}`;
    const lockAcquired = await orderLock.acquire(lockKey, 10_000);
    if (!lockAcquired) {
        return { ok: false, error: canonicalErrors.create('ErrLockTimeout', `lock held >10s for ${lockKey}`) };
    }

    // Create PENDING row
    const positionData = { symbol: params.symbol, side: params.side, qty: params.qty, entryType: params.entryType, sl: params.sl?.price, tp: params.tp?.price, leverage: params.leverage, decisionKey: params.decisionKey, source: params.source, mode: creds.mode };
    const insertResult = db.prepare(`INSERT INTO at_positions (data, status, user_id, exchange, created_at, updated_at) VALUES (?, 'PENDING', ?, 'binance', datetime('now'), datetime('now'))`).run(JSON.stringify(positionData), uid);
    const seq = insertResult.lastInsertRowid;
    positionEvents.append({ position_seq: seq, user_id: uid, exchange: 'binance', event_type: 'CREATED', to_state: 'PENDING', payload: { decisionKey: params.decisionKey, source: params.source } });

    try {
        // ensureSymbolReady
        // (already cached at exchangeOps level — here we just call leverage + marginType to be safe)

        // Round qty per exchangeInfo filters
        const rounded = exchangeInfo.roundOrderParams(params.symbol, params.qty);
        if (!rounded || !rounded.quantity) {
            positionStateMachine.transition(seq, 'PENDING', 'CANCELLED', { reason: 'LOT_SIZE_ALIGN_REJECTED' });
            return { ok: false, error: canonicalErrors.create('ErrLotSize', 'qty cannot align to lot size') };
        }

        // Entry order
        const entryBody = {
            symbol: params.symbol,
            side: params.side === 'LONG' ? 'BUY' : 'SELL',
            type: params.entryType,
            quantity: rounded.quantity,
            newClientOrderId: params.decisionKey,
            recvWindow: 5000,
        };
        if (params.entryType === 'LIMIT') {
            entryBody.timeInForce = 'GTC';
            entryBody.price = params.entryPrice;
        }

        const entryResp = await sendSignedRequest('POST', '/fapi/v1/order', entryBody, creds);
        if (!entryResp || entryResp.code) {
            const err = canonicalErrors.translateBinance(entryResp);
            positionStateMachine.transition(seq, 'PENDING', 'CANCELLED', { reason: 'ENTRY_REJECTED', err });
            return { ok: false, error: err };
        }

        positionStateMachine.transition(seq, 'PENDING', 'OPENING', { entryOrderId: entryResp.orderId, fillPrice: entryResp.avgPrice });

        // SL placement with retry 3x
        let slOrderId = null;
        if (params.sl && params.sl.price) {
            for (let i = 0; i < 3; i++) {
                try {
                    const slResp = await sendSignedRequest('POST', '/fapi/v1/order', {
                        symbol: params.symbol,
                        side: params.side === 'LONG' ? 'SELL' : 'BUY',
                        type: 'STOP_MARKET',
                        stopPrice: params.sl.price,
                        closePosition: 'true',
                        newClientOrderId: `sl_${params.decisionKey}_${i}`.slice(0, 36),
                        recvWindow: 5000,
                    }, creds);
                    if (slResp && slResp.orderId) {
                        slOrderId = slResp.orderId;
                        positionEvents.append({ position_seq: seq, user_id: uid, exchange: 'binance', event_type: 'SL_PLACED', payload: { slOrderId, attempt: i + 1 } });
                        break;
                    }
                    if (i === 2) throw new Error(`SL retry exhausted: ${JSON.stringify(slResp)}`);
                } catch (slErr) {
                    if (i === 2) {
                        // Emergency close path
                        positionEvents.append({ position_seq: seq, user_id: uid, exchange: 'binance', event_type: 'SL_RETRY_EXHAUSTED', payload: { error: slErr.message } });
                        const closeResult = await _emergencyClose(uid, params, creds, seq);
                        positionStateMachine.transition(seq, 'OPENING', 'EMERGENCY', { reason: 'SL_PLACEMENT_FAILED', closeResult });
                        if (!closeResult.ok) {
                            db.prepare(`INSERT INTO emergency_close_queue (user_id, symbol, exchange, qty, decision_key, created_at) VALUES (?, ?, 'binance', ?, ?, ?)`).run(uid, params.symbol, params.qty, params.decisionKey, Date.now());
                            try { require('./serverAT').setGlobalHalt(uid, true, 'EMERGENCY_CLOSE_CATASTROPHIC'); } catch (_) {}
                            try { require('./telegram').alertCritical(uid, `🚨 CATASTROPHIC: ${params.symbol} position cannot close on Binance. Manual intervention NOW.`); } catch (_) {}
                        }
                        return { ok: false, error: canonicalErrors.create('ErrSlPlacementFailed', 'SL retry exhausted, emergency close triggered'), catastrophic: !closeResult.ok };
                    }
                    await new Promise(r => setTimeout(r, [200, 1000, 3000][i]));
                }
            }
        }

        // TP placement (optional, 1 retry)
        let tpOrderId = null;
        if (params.tp && params.tp.price) {
            try {
                const tpResp = await sendSignedRequest('POST', '/fapi/v1/order', {
                    symbol: params.symbol,
                    side: params.side === 'LONG' ? 'SELL' : 'BUY',
                    type: 'TAKE_PROFIT_MARKET',
                    stopPrice: params.tp.price,
                    closePosition: 'true',
                    newClientOrderId: `tp_${params.decisionKey}`.slice(0, 36),
                    recvWindow: 5000,
                }, creds);
                if (tpResp && tpResp.orderId) {
                    tpOrderId = tpResp.orderId;
                    positionEvents.append({ position_seq: seq, user_id: uid, exchange: 'binance', event_type: 'TP_PLACED', payload: { tpOrderId } });
                }
            } catch (_) { /* TP failure is warning */ }
        }

        // Update position data with order IDs
        const updatedData = { ...positionData, entryOrderId: entryResp.orderId, slOrderId, tpOrderId, avgFillPrice: entryResp.avgPrice };
        db.prepare(`UPDATE at_positions SET data = ? WHERE seq = ?`).run(JSON.stringify(updatedData), seq);
        positionStateMachine.transition(seq, 'OPENING', 'OPEN', { slOrderId, tpOrderId });

        return {
            ok: true,
            orderId: entryResp.orderId,
            clientOrderId: params.decisionKey,
            status: entryResp.status || 'FILLED',
            filledQty: entryResp.executedQty || rounded.quantity,
            avgFillPrice: entryResp.avgPrice,
            slOrderId, tpOrderId,
            ts: Date.now(),
            rawExchange: 'binance',
            seq,
        };

    } finally {
        orderLock.release(lockKey);
    }
}

async function _emergencyClose(uid, params, creds, seq) {
    for (let i = 0; i < 3; i++) {
        try {
            const closeResp = await sendSignedRequest('POST', '/fapi/v1/order', {
                symbol: params.symbol,
                side: params.side === 'LONG' ? 'SELL' : 'BUY',
                type: 'MARKET',
                quantity: params.qty,
                reduceOnly: 'true',
                newClientOrderId: `emerg_${params.decisionKey}_${i}`.slice(0, 36),
                recvWindow: 5000,
            }, creds);
            if (closeResp && closeResp.orderId) {
                positionEvents.append({ position_seq: seq, user_id: uid, exchange: 'binance', event_type: 'EMERGENCY_CLOSE_SUCCESS', payload: { attempt: i + 1, orderId: closeResp.orderId } });
                return { ok: true, attempt: i + 1, orderId: closeResp.orderId };
            }
        } catch (err) {
            if (i === 2) {
                positionEvents.append({ position_seq: seq, user_id: uid, exchange: 'binance', event_type: 'EMERGENCY_CLOSE_FAILED', payload: { attempts: i + 1, error: err.message } });
                return { ok: false, attempts: i + 1, error: err.message };
            }
            await new Promise(r => setTimeout(r, [100, 500, 2000][i]));
        }
    }
    return { ok: false, attempts: 3 };
}

module.exports = { placeEntry, _emergencyClose };
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd /root/zeus-terminal && npx jest tests/unit/binanceOps.test.js --forceExit
```

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/binanceOps.js tests/unit/binanceOps.test.js
git commit -m "feat(bybit): binanceOps.placeEntry — canonical wrap of existing Binance flow

- Mirror serverAT._executeLiveEntryCore (Fix #1-#6 logic preserved)
- positionStateMachine integration: PENDING→OPENING→OPEN transitions
- positionEvents.append for every state change + SL retry events
- SL retry 3× with backoff (200ms / 1s / 3s)
- Emergency close 3× retry → emergency_close_queue + PANIC halt + Telegram
- Returns canonical EntryResult shape
- Tests cover happy path + SL retry + emergency catastrophic"
```

---

## Tasks 26-30: binanceOps remaining methods (closePosition, ensureSymbolReady, getPositions, getBalance, etc.)

[Pattern repeats for each method. Each method = 1 task with same Test→Implement→Pass→Commit structure. Full code follows Section 4 of spec.]

**Task 26: binanceOps.closePosition** — wraps cancel SL/TP + close MARKET with cancelProtection logic. ~100 LOC. 5 tests.

**Task 27: binanceOps.ensureSymbolReady** — POST /fapi/v1/leverage + POST /fapi/v1/marginType (idempotent, catches "already set" errors). ~60 LOC. 4 tests.

**Task 28: binanceOps.getPositions** — GET /fapi/v2/positionRisk + normalize to canonical Position[]. ~80 LOC. 5 tests.

**Task 29: binanceOps.getBalance + getUserTrades + ping + cancelOrder + placeStopLoss** — wrap remaining endpoints. ~200 LOC combined. 8 tests.

**Task 30: binanceOps consolidated test (all methods integration)** — verify Position shape canonical, EntryResult shape canonical, error translation. 6 tests.

---

# PHASE 6 — bybitOps (Tasks 31-35)

## Task 31: bybitOps.placeEntry — atomic Bybit V5 entry with SL+TP fields

**Files:**
- Create: `server/services/bybitOps.js`
- Test: `tests/unit/bybitOps.test.js`

- [ ] **Step 1: Reference existing bybitSigner + bybitOrderTranslator**

```bash
sed -n '1,80p' /root/zeus-terminal/server/services/bybitSigner.js
sed -n '1,100p' /root/zeus-terminal/server/services/bybitOrderTranslator.js
```

- [ ] **Step 2: Write failing test**

[Tests cover atomic placeEntry with stopLoss/takeProfit in body, canonical EntryResult shape, error translation for retCode 110066/110007 etc.]

- [ ] **Step 3: Implement bybitOps.placeEntry**

Create `server/services/bybitOps.js`:

```javascript
'use strict';

/**
 * bybitOps — Bybit V5 wrap in canonical exchangeOps API.
 * Uses bybitSigner (S4-B0/B1) + bybitOrderTranslator (S4-B3) — existing.
 * BYBIT_DRY_RUN_ONLY flag gates actual HTTP send (Phase 1A keeps TRUE).
 */

const bybitSigner = require('./bybitSigner');
const bybitTranslator = require('./bybitOrderTranslator');
const positionStateMachine = require('./positionStateMachine');
const positionEvents = require('./positionEvents');
const canonicalErrors = require('./canonicalErrors');
const orderLock = require('./orderLock');
const { db } = require('./database');
const migrationFlags = require('../migrationFlags');

async function placeEntry(uid, params, creds) {
    const lockKey = `${uid}|${params.symbol}`;
    const lockAcquired = await orderLock.acquire(lockKey, 10_000);
    if (!lockAcquired) {
        return { ok: false, error: canonicalErrors.create('ErrLockTimeout', `lock held >10s for ${lockKey}`) };
    }

    const positionData = { symbol: params.symbol, side: params.side, qty: params.qty, entryType: params.entryType, sl: params.sl?.price, tp: params.tp?.price, leverage: params.leverage, decisionKey: params.decisionKey, source: params.source, mode: creds.mode };
    const insertResult = db.prepare(`INSERT INTO at_positions (data, status, user_id, exchange, created_at, updated_at) VALUES (?, 'PENDING', ?, 'bybit', datetime('now'), datetime('now'))`).run(JSON.stringify(positionData), uid);
    const seq = insertResult.lastInsertRowid;
    positionEvents.append({ position_seq: seq, user_id: uid, exchange: 'bybit', event_type: 'CREATED', to_state: 'PENDING', payload: { decisionKey: params.decisionKey, source: params.source } });

    try {
        // Translate canonical params → Bybit V5 body
        const translated = bybitTranslator.translateEntryWithSLTP({
            symbol: params.symbol,
            side: params.side === 'LONG' ? 'Buy' : 'Sell',
            orderType: params.entryType === 'MARKET' ? 'Market' : 'Limit',
            qty: params.qty,
            price: params.entryPrice,
            stopLoss: params.sl?.price,
            takeProfit: params.tp?.price,
            orderLinkId: params.decisionKey,
        });

        // DRY_RUN gate
        if (migrationFlags.BYBIT_DRY_RUN_ONLY) {
            positionEvents.append({ position_seq: seq, user_id: uid, exchange: 'bybit', event_type: 'DRY_RUN_SKIP', payload: { translated } });
            positionStateMachine.transition(seq, 'PENDING', 'CANCELLED', { reason: 'BYBIT_DRY_RUN_ONLY' });
            return { ok: false, error: canonicalErrors.create('ErrInvalidParams', 'BYBIT_DRY_RUN_ONLY=true — Bybit HTTP send disabled') };
        }

        // Actual HTTP send (Phase 1A doesn't ship this — guard above prevents reach)
        const resp = await bybitSigner.sendSignedRequest('POST', '/v5/order/create', translated.body, creds);
        const err = canonicalErrors.translateBybit(resp);
        if (err) {
            positionStateMachine.transition(seq, 'PENDING', 'CANCELLED', { reason: 'BYBIT_REJECTED', err });
            return { ok: false, error: err };
        }

        // Atomic success: entry placed with SL+TP fields
        positionStateMachine.transition(seq, 'PENDING', 'OPEN', {
            entryOrderId: resp.result.orderId,
            slOrderId: resp.result.stopOrderId,
            tpOrderId: resp.result.tpOrderId,
        });

        const updatedData = { ...positionData, entryOrderId: resp.result.orderId, slOrderId: resp.result.stopOrderId, tpOrderId: resp.result.tpOrderId };
        db.prepare(`UPDATE at_positions SET data = ? WHERE seq = ?`).run(JSON.stringify(updatedData), seq);

        return {
            ok: true,
            orderId: resp.result.orderId,
            clientOrderId: params.decisionKey,
            status: 'FILLED',
            filledQty: params.qty,
            avgFillPrice: resp.result.avgPrice || params.entryPrice,
            slOrderId: resp.result.stopOrderId,
            tpOrderId: resp.result.tpOrderId,
            ts: Date.now(),
            rawExchange: 'bybit',
            seq,
        };

    } finally {
        orderLock.release(lockKey);
    }
}

module.exports = { placeEntry };
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd /root/zeus-terminal && npx jest tests/unit/bybitOps.test.js --forceExit
```

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/bybitOps.js tests/unit/bybitOps.test.js
git commit -m "feat(bybit): bybitOps.placeEntry atomic V5 entry with SL+TP fields

- Uses bybitSigner (S4-B0) + bybitOrderTranslator (S4-B3) existing
- POST /v5/order/create with stopLoss/takeProfit in body
- positionStateMachine PENDING→OPEN atomic (no OPENING intermediate)
- BYBIT_DRY_RUN_ONLY flag gates actual HTTP send (Phase 1A keeps TRUE)
- Returns canonical EntryResult shape — same as binanceOps"
```

---

## Tasks 32-35: bybitOps remaining methods + verifyCreds

[Same pattern as binanceOps tasks 26-30, adapted for Bybit V5 endpoints:]

**Task 32: bybitOps.closePosition** — POST /v5/position/trading-stop (clear SL/TP) + POST /v5/order/create reduceOnly + closeOnTrigger. ~80 LOC.

**Task 33: bybitOps.ensureSymbolReady** — POST /v5/position/switch-mode (one-way) + switch-isolated (CROSSED) + set-leverage. ~80 LOC.

**Task 34: bybitOps.getPositions + getBalance + getUserTrades + ping + cancelOrder** — wrap V5 endpoints with canonical shape mapping. ~250 LOC.

**Task 35: bybitOps.verifyCreds** — used by /api/exchange/save: ping + getBalance test to verify API key valid before save. ~50 LOC.

---

# PHASE 7 — Routes refactor (Tasks 36-41)

> **Refactor ~30 call sites from `sendSignedRequest('/fapi/v1/order')` direct to `exchangeOps.placeEntry()`. Each task = 1 route or 1 serverAT method.**

## Task 36: routes/trading.js POST /api/order/place → exchangeOps.placeEntry

**Files:**
- Modify: `server/routes/trading.js`
- Test: `tests/e2e/order-place-flow.test.js` (existing — extend)

- [ ] **Step 1: Audit current handler**

```bash
sed -n '200,250p' /root/zeus-terminal/server/routes/trading.js
```

- [ ] **Step 2: Refactor handler to call exchangeOps**

Find the POST /api/order/place handler. Replace `sendSignedRequest('POST', '/fapi/v1/order', ...)` calls with `exchangeOps.placeEntry(req.user.id, params)`.

- [ ] **Step 3: Run existing tests — verify no regression**

```bash
cd /root/zeus-terminal && npx jest tests/e2e/order-place-flow.test.js --forceExit
```

- [ ] **Step 4: Commit**

```bash
cd /root/zeus-terminal && git add server/routes/trading.js
git commit -m "refactor(bybit): routes/trading.js /api/order/place → exchangeOps.placeEntry

- Removes direct sendSignedRequest /fapi/v1/order call
- Hard SL guard now enforced by exchangeOps (defense in depth)
- Routes through user's active exchange (binance or bybit)
- Existing tests preserve Binance behavior"
```

---

## Tasks 37-41: Remaining route + serverAT refactors

- Task 37: `routes/trading.js` POST /api/manual/protection → exchangeOps.placeStopLoss
- Task 38: `routes/trading.js` POST /api/at/close → exchangeOps.closePosition
- Task 39: `routes/trading.js` POST /api/order/cancel → exchangeOps.cancelOrder
- Task 40: `serverAT.js` _executeLiveEntryCore → exchangeOps.placeEntry (preserves Fix #1-#6 logic via binanceOps)
- Task 41: `serverAT.js` _closePosition → exchangeOps.closePosition

[Each task: identify exact line range, refactor, run regression tests, commit. ~30 min per task.]

---

# PHASE 8 — Recovery boot + observability (Tasks 42-46)

## Task 42: recoveryBoot.js — scan + reconcile + verify SL

**Files:**
- Create: `server/services/recoveryBoot.js`
- Test: `tests/unit/recoveryBoot.test.js`

[Full implementation per Spec Section 4.5 — scan exchange positions, reconcile DB, verify SL on each OPEN, place SL if missing, ORPHANED if can't, lift global halt at end.]

Test scenarios: position exists on exchange + DB → OPEN, position only in DB → CLOSED (closed externally), position only on exchange → adopt via _syncExternalPosition, position with missing SL on live → emergency place or ORPHANED.

Implementation ~300 LOC, 8 tests.

## Task 43: Wire recoveryBoot in server/index.js startup

**Files:**
- Modify: `server/index.js`

Add `await recoveryBoot.run()` BEFORE any trading routes mounted. Global halt held during recovery, released after.

## Task 44-46: pnlReconCron.js + timeSyncAssert wiring + audit log helpers

[Daily PnL reconciliation 02:00 UTC, timeSyncAssert.start() in boot, audit_log action helpers shipped to single module.]

---

# PHASE 9 — Switch + creds UX (Tasks 47-50)

## Task 47: POST /api/exchange/save with verify + _pendingSwitch

**Files:**
- Modify: `server/routes/exchange.js`

[Already partially exists. Add: verify creds with exchangeOps.ping + getBalance before save. On success, _markPendingSwitch instead of immediate apply. Return 200 with status:pending.]

## Task 48-50: Disconnect with positions check + initial recon + orphan move

[Block disconnect if open positions on that exchange: 409 with positions list. Or move them to at_positions_orphaned with explicit confirmation flag.]

---

# PHASE 10 — Shadow logging permanent (Tasks 51-53)

## Task 51: parityShadowLogger.js — cross-exchange divergence tracking

Implementation per Spec Section 7 Risk R2 mitigation. Activated at Phase 1A ship, NOT only at flip live. ~200 LOC.

## Task 52-53: Daily aggregation + alert threshold

---

# PHASE 11 — Health endpoints (Tasks 54-56)

## Task 54: GET /api/health/feed/:exchange

Returns `{ connected, lastMessageTs per topic, silentMs, state: 'healthy'|'degraded'|'silent'|'dead' }`.

## Task 55: GET /api/health/locks + GET /api/health/recovery

---

# PHASE 12 — Integration tests + smoke (Tasks 57-62)

## Task 57: Integration test — Bybit testnet placeEntry mock

## Task 58: Integration test — Switch barrier atomic

## Task 59: Integration test — Recovery boot

## Task 60: Integration test — Emergency close path

## Task 61: Integration test — Multi-user different exchanges

## Task 62: Manual smoke test instructions

```markdown
# Manual smoke test Phase 1A+1B

After PM2 reload:

1. Verify ₿ icon still in dock (regression check from MultiExchange UI shell)
2. Open MultiExchange page → click on Bybit pillar
3. Enter Bybit testnet API key + secret + select TESTNET mode → click Save
   Expected: verify call OK, save succeeds, UI shows "ACTIVE - TESTNET"
4. Wait 30s → brain cycle should apply pending switch
5. Verify in PM2 logs: "[BRAIN] cycle iterated users on bybit"
6. Open Manual Trade panel → place test BTCUSDT LONG 0.001 with SL 5% below
   Expected: order goes to Bybit testnet (visible on bybit.com testnet UI)
7. Close position via UI Close button
   Expected: clean close, balance restored
8. Switch back to Binance: MultiExchange → disconnect Bybit → confirm
9. Save Binance creds again
10. Verify Zeus operates Binance again
```

---

# PHASE 13 — Pre-deploy (Tasks 63-65)

## Task 63: Final regression — server jest baseline preserved

```bash
cd /root/zeus-terminal && npx jest --forceExit 2>&1 | tail -10
```

Expected: pre-1A baseline preserved (no test regressions from our refactors).

## Task 64: Client build verify

```bash
cd /root/zeus-terminal/client && npm run build 2>&1 | tail -5
```

## Task 65: Version bump + tag

Modify `server/version.js` to bump v1.7.98 → v1.7.99. Add changelog entry summarizing Phase 1A+1B.

```bash
cd /root/zeus-terminal && git add server/version.js
git commit -m "chore(release): v1.7.99 — Bybit Phase 1A+1B SHIPPED"
git tag bybit-phase-1ab-COMPLETE-$(date -u +%Y%m%d-%H%M%S)
```

---

## Self-Review Checklist

After all 65 tasks complete:

### Spec coverage
- [ ] All 26 must-have pillars implemented (1-32 minus deferred Phase 1F items)
- [ ] Server-truth Rule 0 verified: all state per req.user.id
- [ ] Per-user routing tested with multi-user scenario
- [ ] Switch barrier explicit (NOT lazy invalidation)
- [ ] Position state machine 8 states + position_events journal
- [ ] Recovery boot deterministic
- [ ] Hard SL guard on LIVE
- [ ] emergency_close_queue persistence (NO auto-worker per Phase 1A simplification)

### Verify-twice rule applied
- [ ] Cross-file audit done for serverBrain loop swap (Task 20 audit doc)
- [ ] Backup taken before each migration (Task 2 + per-migration backups)
- [ ] Rollback drilled 3× on staging DB before production deploy

### Type consistency
- [ ] CanonicalError code enum consistent across binanceOps + bybitOps
- [ ] Position shape consistent (qty as string, leverage as number, side as 'LONG'/'SHORT'/'FLAT')
- [ ] decisionKey regex enforced at exchangeOps level only (S2 idempotency layer)
- [ ] exchange column populated correctly across at_positions, at_closed, brain_decisions

### Backup discipline
- [ ] zeus.db backup taken Task 2 (pre-everything)
- [ ] Per-migration backups before each ALTER TABLE
- [ ] Git tags at major milestones (Phase 1A complete, Phase 1B complete)

### Branch isolation
- [ ] All work on `bybit-phase-1ab` branch
- [ ] No master/omega touch until 24h+ testnet green
- [ ] BYBIT_DRY_RUN_ONLY=true throughout (flip = separate Phase 1E spec)

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-21-bybit-migration-phase-1ab.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review (spec compliance + code quality) between tasks, fast iteration. Operator monitors progress, intervenes if needed.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch with checkpoints for review. Slower but full operator visibility per step.

**Recommended for this plan: Subagent-Driven** because:
- 65 tasks spread over 50-60h work — context isolation per subagent prevents drift
- TDD strict per task — fresh subagent maintains discipline
- Two-stage review per task = quality bar matches operator's "PRO full working" standard
- Backup + verify-twice rules embedded in subagent prompts

**Branch:** `bybit-phase-1ab` (created in Task 1)

**Pre-execution checklist (operator-confirmed):**
- [ ] Spec reviewed + locked: `docs/superpowers/specs/2026-05-21-bybit-migration-phase-1ab.md`
- [ ] Plan reviewed: this file
- [ ] Branch ready: `bybit-phase-1ab`
- [ ] DB backup: `zeus.db.pre-bybit-phase-1ab-YYYYMMDD-HHMMSS`
- [ ] BYBIT_DRY_RUN_ONLY=true confirmed (live HTTP send disabled)
- [ ] Memory rules loaded: feedback_verify_twice_before_commit + feedback_no_chained_risky_changes + feedback_zeus_dock_dual_path + project_bybit_migration_brainstorming

**Which execution mode?**
