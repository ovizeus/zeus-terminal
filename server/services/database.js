// Zeus Terminal — SQLite Database Service
// Per-user isolation: users + exchange_accounts
'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// [Day 16 2026-05-18] Read ZEUS_DB_PATH env if set (used by tests + dev to
// point at temp/isolated DBs). Falls back to canonical prod path so existing
// runtime behavior unchanged when env not set. Paired with _seedBaselineIfFresh()
// — fresh DBs get schema snapshot instead of failing on 200+ migration ordering bugs.
const DB_PATH = process.env.ZEUS_DB_PATH
    ? path.resolve(process.env.ZEUS_DB_PATH)
    : path.join(__dirname, '..', '..', 'data', 'zeus.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

// [Day 16 2026-05-18] Baseline schema seeding for fresh DBs.
// On a truly fresh DB (no _migrations table), exec the prod schema snapshot
// + bulk-insert all known migration names as already-applied. Existing
// migrate() calls then become no-ops on fresh DB (already marked applied),
// bypassing latent ordering bugs (ALTER migrations referencing tables
// created later in file).
// Prod DB unaffected — `_migrations` already populated → seed step skipped.
function _seedBaselineIfFresh() {
    try {
        const hasMigrationsTable = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'"
        ).get();
        if (hasMigrationsTable) return;

        const schemaSqlPath = path.join(__dirname, 'baseline_schema.sql');
        const migListPath = path.join(__dirname, 'baseline_migrations.txt');
        if (!fs.existsSync(schemaSqlPath) || !fs.existsSync(migListPath)) {
            return;
        }

        const schemaSql = fs.readFileSync(schemaSqlPath, 'utf8');
        const migList = fs.readFileSync(migListPath, 'utf8')
            .split('\n').map(s => s.trim()).filter(Boolean);

        db.exec('BEGIN;\n' + schemaSql + '\nCOMMIT;');

        const insert = db.prepare("INSERT OR IGNORE INTO _migrations (name, applied_at) VALUES (?, datetime('now'))");
        const tx = db.transaction((names) => {
            for (const name of names) insert.run(name);
        });
        tx(migList);

        console.log(`[DB] Baseline schema seeded: ${migList.length} migrations marked applied`);
    } catch (err) {
        console.warn('[DB] Baseline seed failed (will fall back to per-migration apply):', err.message);
    }
}

_seedBaselineIfFresh();

// WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// [DB-10] WAL auto-checkpoint tuning. Default = 1000 pages (~4MB at 4KB
// pages) → checkpoint fires frequently under high-write workload, causing
// fsync stalls. Bump to 10000 pages (~40MB) so brain decisions / parity
// log / regime_history (40K+ rows each post-S6-B7) batch into one
// checkpoint instead of N. Tradeoff: WAL file slightly larger between
// checkpoints; recovery on crash reads more WAL pages — acceptable cost
// for write throughput. Pre-Plan v3 ML escalation: `_ML_BRAIN` observation
// overhead would multiply write rate ~10x; this PRAGMA preempts the
// degradation surface area.
db.pragma('wal_autocheckpoint = 10000');
// [DB-3] Cache size bump from default ~8MB (negative = pages, default -2000)
// to ~32MB. Zeus DB ~103MB cu hot tables at_closed/at_positions/regime_history
// (40K+ rows each post-S6-B7). Default cache misses → repeated disk I/O cu
// random-access latency. -32000 ≈ 32MB cache sized for current hot working
// set + headroom. PRAGMA scoped per-connection; better-sqlite3 single-connection
// model means this applies for all queries server-side.
db.pragma('cache_size = -32000');

// ─── Schema ───
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'user',
    approved    INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS exchange_accounts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER NOT NULL,
    exchange            TEXT NOT NULL DEFAULT 'binance',
    api_key_encrypted   TEXT NOT NULL,
    api_secret_encrypted TEXT NOT NULL,
    mode                TEXT NOT NULL DEFAULT 'live',
    status              TEXT NOT NULL DEFAULT 'verified',
    last_verified_at    TEXT,
    is_active           INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    action     TEXT NOT NULL,
    details    TEXT,
    ip         TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_exchange_user ON exchange_accounts(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at);

  -- ═══ AT Engine (unified positions + state) ═══
  CREATE TABLE IF NOT EXISTS at_positions (
    seq         INTEGER PRIMARY KEY,
    data        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'OPEN',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS at_closed (
    seq         INTEGER PRIMARY KEY,
    data        TEXT NOT NULL,
    closed_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS at_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_at_pos_status ON at_positions(status);
`);

// ─── Migration Framework ───
db.exec(`
  CREATE TABLE IF NOT EXISTS _migrations (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const _applied = new Set(db.prepare('SELECT name FROM _migrations').all().map(r => r.name));
const _applyMigration = db.prepare('INSERT OR IGNORE INTO _migrations (name) VALUES (?)');

function migrate(name, fn) {
    if (_applied.has(name)) return;
    try {
        fn();
        _applyMigration.run(name);
        _applied.add(name);
        console.log('[DB] Migration applied:', name);
    } catch (err) {
        // [R36] Pre-framework migrations (001–006) were never recorded in
        // _migrations but their DDL already ran on the live DB. SQLite replies
        // "duplicate column name" / "table X already exists" — treat those as
        // "already applied", record it, and move on quietly. Anything else is
        // a real failure and stays loud.
        const msg = String(err && err.message || '');
        const alreadyApplied =
            /duplicate column name/i.test(msg) ||
            /already exists/i.test(msg);
        if (alreadyApplied) {
            _applyMigration.run(name);
            _applied.add(name);
            return;
        }
        console.warn('[DB] Migration', name, 'failed:', msg);
    }
}

// ─── Migrations (versioned) ───
migrate('001_users_banned_until', () => {
    db.exec("ALTER TABLE users ADD COLUMN banned_until TEXT DEFAULT NULL");
});
migrate('002_users_telegram_fields', () => {
    db.exec("ALTER TABLE users ADD COLUMN telegram_bot_token_enc TEXT DEFAULT NULL");
    db.exec("ALTER TABLE users ADD COLUMN telegram_chat_id TEXT DEFAULT NULL");
});
migrate('003_users_pin_hash', () => {
    db.exec("ALTER TABLE users ADD COLUMN pin_hash TEXT DEFAULT NULL");
});

migrate('004_at_multiuser_columns', () => {
    db.exec("ALTER TABLE at_positions ADD COLUMN user_id INTEGER DEFAULT NULL");
    db.exec("ALTER TABLE at_closed ADD COLUMN user_id INTEGER DEFAULT NULL");
    db.exec("CREATE INDEX IF NOT EXISTS idx_at_pos_user ON at_positions(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_at_closed_user ON at_closed(user_id)");
});

migrate('005_at_multiuser_backfill', () => {
    const _needFill = db.prepare("SELECT seq, data FROM at_positions WHERE user_id IS NULL").all();
    if (_needFill.length > 0) {
        const _upd = db.prepare("UPDATE at_positions SET user_id = ? WHERE seq = ?");
        const _txn = db.transaction(() => {
            for (const row of _needFill) {
                try {
                    const parsed = JSON.parse(row.data);
                    _upd.run(parsed.userId || null, row.seq);
                } catch (_) { }
            }
        });
        _txn();
        console.log('[DB] Backfilled user_id for', _needFill.length, 'at_positions rows');
    }
    const _needFillClosed = db.prepare("SELECT seq, data FROM at_closed WHERE user_id IS NULL").all();
    if (_needFillClosed.length > 0) {
        const _updC = db.prepare("UPDATE at_closed SET user_id = ? WHERE seq = ?");
        const _txnC = db.transaction(() => {
            for (const row of _needFillClosed) {
                try {
                    const parsed = JSON.parse(row.data);
                    _updC.run(parsed.userId || null, row.seq);
                } catch (_) { }
            }
        });
        _txnC();
        console.log('[DB] Backfilled user_id for', _needFillClosed.length, 'at_closed rows');
    }
});

migrate('006_at_state_user_id', () => {
    db.exec("ALTER TABLE at_state ADD COLUMN user_id INTEGER DEFAULT NULL");
    db.exec("CREATE INDEX IF NOT EXISTS idx_at_state_user ON at_state(user_id)");
});

migrate('007_at_state_backfill', () => {
    const _stateNeedFill = db.prepare("SELECT key FROM at_state WHERE user_id IS NULL").all();
    if (_stateNeedFill.length > 0) {
        const _updState = db.prepare("UPDATE at_state SET user_id = ? WHERE key = ?");
        const _txnState = db.transaction(() => {
            let filled = 0, skipped = 0;
            for (const row of _stateNeedFill) {
                const m = /^engine:(\d+)$/.exec(row.key);
                if (m) {
                    _updState.run(parseInt(m[1], 10), row.key);
                    filled++;
                } else {
                    skipped++;
                }
            }
            return { filled, skipped };
        });
        const res = _txnState();
        console.log('[DB] at_state backfill: filled=' + res.filled + ' skipped=' + res.skipped);
    }
});

migrate('008_cleanup_legacy_engine', () => {
    const _deleted = db.prepare("DELETE FROM at_state WHERE key = 'engine' AND user_id IS NULL").run();
    if (_deleted.changes > 0) console.log('[DB] Deleted legacy bare "engine" row');
});

migrate('009_users_token_version', () => {
    db.exec("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1");
});

migrate('010_password_history', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS password_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            password_hash TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_pw_history_user ON password_history(user_id);
    `);
});

migrate('013_regime_history', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS regime_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol      TEXT NOT NULL,
            regime      TEXT NOT NULL,
            prev_regime TEXT,
            confidence  INTEGER DEFAULT 0,
            price       REAL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_regime_symbol ON regime_history(symbol);
        CREATE INDEX IF NOT EXISTS idx_regime_time ON regime_history(created_at);
    `);
});

migrate('012_missed_trades', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS missed_trades (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            symbol      TEXT NOT NULL,
            side        TEXT NOT NULL,
            reason      TEXT NOT NULL,
            price       REAL NOT NULL,
            confidence  INTEGER DEFAULT 0,
            tier        TEXT,
            regime      TEXT,
            data        TEXT,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_missed_user ON missed_trades(user_id);
        CREATE INDEX IF NOT EXISTS idx_missed_time ON missed_trades(created_at);
    `);
});

migrate('011_trade_annotations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS trade_annotations (
            seq         INTEGER NOT NULL,
            user_id     INTEGER NOT NULL,
            notes       TEXT DEFAULT '',
            tags        TEXT DEFAULT '[]',
            rating      INTEGER DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (seq, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_annotations_user ON trade_annotations(user_id);
    `);
});

migrate('014_brain_decisions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS brain_decisions (
            snap_id     TEXT PRIMARY KEY,
            user_id     INTEGER NOT NULL,
            symbol      TEXT NOT NULL,
            ts          INTEGER NOT NULL,
            cycle       INTEGER NOT NULL,
            source_path TEXT NOT NULL,
            final_tier  TEXT NOT NULL,
            final_conf  INTEGER NOT NULL,
            final_dir   TEXT NOT NULL,
            final_action TEXT NOT NULL,
            linked_seq  INTEGER DEFAULT NULL,
            data        TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_bd_user_ts ON brain_decisions(user_id, ts);
        CREATE INDEX IF NOT EXISTS idx_bd_symbol_ts ON brain_decisions(symbol, ts);
        CREATE INDEX IF NOT EXISTS idx_bd_linked ON brain_decisions(linked_seq);
        CREATE INDEX IF NOT EXISTS idx_bd_action ON brain_decisions(final_action, ts);
    `);
});

migrate('015_multi_exchange', () => {
    // Partial unique index: one active row per (user_id, exchange)
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_exchange_user_name ON exchange_accounts(user_id, exchange) WHERE is_active = 1");
});

migrate('016_user_settings', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_settings (
            user_id     INTEGER PRIMARY KEY,
            data        TEXT NOT NULL DEFAULT '{}',
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
    `);
});

migrate('017_ares_state', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ares_state (
            user_id     INTEGER PRIMARY KEY,
            data        TEXT NOT NULL DEFAULT '{}',
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
    `);
});

migrate('018_pwd_temp_meta', () => {
    db.exec("ALTER TABLE users ADD COLUMN pwd_temp_expires_at TEXT DEFAULT NULL");
    db.exec("ALTER TABLE users ADD COLUMN pwd_must_change INTEGER NOT NULL DEFAULT 0");
});

// [ZT-AUD-#12 / C10] Persist last activity timestamp so inactivity timeout
// survives pm2 restarts. Without this, a stolen JWT remains valid indefinitely
// after server restart because the in-memory _activity Map is wiped.
migrate('019_user_last_active', () => {
    db.exec("ALTER TABLE users ADD COLUMN last_active_at INTEGER DEFAULT NULL");
});

// [ZT-AUD-#16 / C14] Mark telegram tokens that fail to decrypt persistently
// (e.g. encrypted under a rotated key) so we stop spamming logs every 60s and
// the user can be told to re-add the token via UI.
migrate('020_telegram_broken', () => {
    db.exec("ALTER TABLE users ADD COLUMN telegram_broken_at INTEGER DEFAULT NULL");
    db.exec("ALTER TABLE users ADD COLUMN telegram_broken_reason TEXT DEFAULT NULL");
});

// [Phase 8] Per-user context data — 14 sections migrated from FS to SQLite
migrate('021_user_ctx_data', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_ctx_data (
            user_id     INTEGER NOT NULL,
            section     TEXT NOT NULL,
            data        TEXT NOT NULL DEFAULT '{}',
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (user_id, section)
        );
    `);
});

// [R18] at_state cleanup: split brain:cooldowns NULL row per user, drop orphans (user_id not in users).
migrate('022_at_state_cleanup', () => {
    const oldRow = db.prepare("SELECT value FROM at_state WHERE key = 'brain:cooldowns' AND user_id IS NULL").get();
    let splitReport = { users: 0, keys: 0 };
    if (oldRow) {
        let parsed = null;
        try { parsed = JSON.parse(oldRow.value); } catch (_) { parsed = null; }
        if (parsed && typeof parsed === 'object') {
            const byUser = new Map();
            for (const [k, v] of Object.entries(parsed)) {
                const m = /^(\d+):/.exec(k);
                if (!m) continue;
                const uid = parseInt(m[1], 10);
                if (!byUser.has(uid)) byUser.set(uid, {});
                byUser.get(uid)[k] = v;
            }
            const userExists = db.prepare('SELECT 1 FROM users WHERE id = ?');
            const insert = db.prepare('INSERT OR REPLACE INTO at_state (key, value, user_id) VALUES (?, ?, ?)');
            const txn = db.transaction(() => {
                for (const [uid, obj] of byUser) {
                    if (!userExists.get(uid)) continue;
                    insert.run('brain:cooldowns:' + uid, JSON.stringify(obj), uid);
                    splitReport.users++;
                    splitReport.keys += Object.keys(obj).length;
                }
            });
            txn();
        }
        db.prepare("DELETE FROM at_state WHERE key = 'brain:cooldowns' AND user_id IS NULL").run();
        console.log('[DB] at_state: split brain:cooldowns into', splitReport.users, 'per-user rows (', splitReport.keys, 'keys total)');
    }

    const orphanRes = db.prepare(`
        DELETE FROM at_state
        WHERE user_id IS NOT NULL
          AND user_id NOT IN (SELECT id FROM users)
    `).run();
    if (orphanRes.changes > 0) console.log('[DB] at_state: deleted', orphanRes.changes, 'orphan rows (user_id not in users)');

    const nullRes = db.prepare('DELETE FROM at_state WHERE user_id IS NULL').run();
    if (nullRes.changes > 0) console.log('[DB] at_state: deleted', nullRes.changes, 'residual NULL user_id rows');
});

// [R18] at_state schema hardening: rebuild with user_id NOT NULL + FK CASCADE.
migrate('023_at_state_harden', () => {
    const nullCount = db.prepare('SELECT COUNT(*) AS c FROM at_state WHERE user_id IS NULL').get().c;
    if (nullCount > 0) {
        throw new Error('refusing to harden: ' + nullCount + ' NULL user_id rows still present');
    }
    db.exec(`
        CREATE TABLE at_state__new (
            key     TEXT    PRIMARY KEY,
            value   TEXT    NOT NULL,
            user_id INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        INSERT INTO at_state__new (key, value, user_id)
            SELECT key, value, user_id FROM at_state;
        DROP TABLE at_state;
        ALTER TABLE at_state__new RENAME TO at_state;
        CREATE INDEX IF NOT EXISTS idx_at_state_user ON at_state(user_id);
    `);
    console.log('[DB] at_state: rebuilt with user_id NOT NULL + FK CASCADE');
});

// [R19] regime_history: add user_id column + index. Historical rows stay NULL
// (legitimate — they predate per-user attribution). From this point, writes
// fan out one row per active-brain user so per-user reads are isolated.
migrate('024_regime_history_user_id', () => {
    db.exec("ALTER TABLE regime_history ADD COLUMN user_id INTEGER DEFAULT NULL");
    db.exec("CREATE INDEX IF NOT EXISTS idx_regime_user ON regime_history(user_id)");
});

// [Phase 4B] Exchange single-active enforcement at the schema level.
// Policy: at most ONE active exchange_accounts row per user (Binance XOR Bybit,
// TESTNET XOR REAL). Route /api/exchange/save already rejects conflicts with
// EXCHANGE_CONFLICT / ENV_CONFLICT, but we also enforce it at the DB level as
// defense-in-depth so any future writer that bypasses the route cannot create
// a split state.
//
// Reconciliation of legacy state: collapse any user with >1 active row by
// keeping the most recently touched (updated_at DESC, id DESC) and marking
// the rest inactive with status='disconnected_reconcile'.
migrate('025_exchange_single_active', () => {
    const _dupUsers = db.prepare(`
        SELECT user_id, COUNT(*) AS n
        FROM exchange_accounts
        WHERE is_active = 1
        GROUP BY user_id
        HAVING n > 1
    `).all();

    let _collapsed = 0;
    for (const _u of _dupUsers) {
        const _rows = db.prepare(`
            SELECT id FROM exchange_accounts
            WHERE user_id = ? AND is_active = 1
            ORDER BY datetime(updated_at) DESC, id DESC
        `).all(_u.user_id);
        const _keep = _rows[0].id;
        const _loserIds = _rows.slice(1).map(r => r.id);
        for (const _id of _loserIds) {
            db.prepare(`
                UPDATE exchange_accounts
                SET is_active = 0,
                    status = 'disconnected_reconcile',
                    updated_at = datetime('now')
                WHERE id = ?
            `).run(_id);
            _collapsed++;
        }
        console.log('[DB migration 025] user=' + _u.user_id + ' kept id=' + _keep + ' deactivated ids=[' + _loserIds.join(',') + ']');
    }
    if (_collapsed > 0) console.log('[DB migration 025] reconciled ' + _collapsed + ' legacy duplicate row(s)');

    db.exec("DROP INDEX IF EXISTS idx_exchange_user_name");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_exchange_user_active_single ON exchange_accounts(user_id) WHERE is_active = 1");
});

// [SEC-1] Persist login rate-limit counters across pm2 reloads — prevents an
// attacker from resetting their window by forcing a restart.
migrate('026_login_attempts', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS login_attempts (
            key      TEXT NOT NULL,
            kind     TEXT NOT NULL,
            count    INTEGER NOT NULL DEFAULT 0,
            reset_at INTEGER NOT NULL,
            PRIMARY KEY (kind, key)
        );
        CREATE INDEX IF NOT EXISTS idx_login_attempts_reset ON login_attempts(reset_at);
    `);
});

// [Phase 2 S3] Parity harness storage — shadow-only comparison of client vs
// server fusion decisions. Rows are written by POST /api/brain/parity/client
// (source='client') and by serverBrain._runShadowCycle (source='server').
// Report endpoint correlates rows per (user_id, symbol, created_at ±15s).
migrate('027_brain_parity_log', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS brain_parity_log (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER NOT NULL,
            symbol       TEXT NOT NULL,
            source       TEXT NOT NULL CHECK(source IN ('client','server')),
            cycle        INTEGER,
            dir          TEXT,
            decision     TEXT,
            confidence   REAL,
            score        REAL,
            reasons      TEXT,
            created_at   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_parity_user_symbol_ts ON brain_parity_log(user_id, symbol, created_at);
        CREATE INDEX IF NOT EXISTS idx_parity_source_ts      ON brain_parity_log(source, created_at);
    `);
});

// [DB-5] Additive composite index for atPruneClosed subquery performance.
// `atPruneClosed` (line 596 area) does:
//   DELETE FROM at_closed WHERE user_id = ? AND seq NOT IN
//     (SELECT seq FROM at_closed WHERE user_id = ? ORDER BY closed_at DESC LIMIT 500)
// Without (user_id, closed_at DESC) composite, SQLite scans all user rows then sorts.
// At 2000+ trades/user this becomes table-scan stall. Index is purely additive — no
// schema change, no data migration, only build-time tree construction. Existing
// idx_at_closed_user (single-col user_id) remains for other queries that filter only
// by user. Safe to ship even if migrate('027') already ran.
migrate('028_at_closed_user_closed_at_idx', () => {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_at_closed_user_closed_at ON at_closed(user_id, closed_at DESC);`);
});

// [DB-1] Additive composite index for atLoadOpenPosByUser query performance.
// `atLoadOpenPosByUser` does:
//   SELECT seq, data FROM at_positions WHERE status = 'OPEN' AND user_id = ?
// Existing indexes idx_at_pos_user (user_id) + idx_at_pos_status (status) are
// SEPARATE single-column indexes. SQLite can use one but must filter the other
// at row level → SEARCH user_id then filter status='OPEN' = O(N) scan per load.
// Composite (user_id, status) lets SQLite satisfy WHERE clause directly from
// index without row-level filtering. Same purely-additive pattern as DB-5 (028).
migrate('029_at_pos_user_status_idx', () => {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_at_pos_user_status ON at_positions(user_id, status);`);
});

// [DB-2] Composite UNIQUE partial index pe at_positions(user_id, symbol, side,
// mode) WHERE status='OPEN'. SQLite supports expression indexes (json_extract)
// + partial indexes natively. Pre-flight check: 0 duplicates în current DB
// (validated 2026-05-08). Prevents "race entry" double-position bug where two
// concurrent INSERT-OR-UPDATE flows could create duplicate OPEN row pairs for
// same user+symbol+side+mode combo. Closed positions (status='closed') NU sunt
// constrained — multiple closed rows per (user, sym, side, mode) sunt expected
// (history). Idempotent via `migrate()` track-once. Additive — no data
// rewrite, no lock contention.
migrate('030_at_pos_dedup_open_unique', () => {
    db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_at_pos_user_sym_side_mode_open
        ON at_positions(
            user_id,
            json_extract(data, '$.symbol'),
            json_extract(data, '$.side'),
            json_extract(data, '$.mode')
        )
        WHERE status='OPEN';
    `);
});

// [S7] Shadow validation parity log for DSL reconciliation. Analog brain_parity_log
// (S3 precedent, migration 027). serverDSL.tick outputs paired with client runDSLBrain
// to detect schema drift (phase/current_sl/pivot_*/impulse_val divergence). Gates
// deployment until shadow DSL matches production during soak window.
migrate('031_dsl_parity_log', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS dsl_parity_log (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER NOT NULL,
            pos_id       TEXT NOT NULL,
            symbol       TEXT NOT NULL,
            source       TEXT NOT NULL CHECK(source IN ('client','server')),
            phase        TEXT,
            current_sl   REAL,
            pivot_left   REAL,
            pivot_right  REAL,
            impulse_val  REAL,
            entry_price  REAL,
            tick_price   REAL,
            created_at   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_dsl_parity_user_pos_ts ON dsl_parity_log(user_id, pos_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_dsl_parity_source_ts   ON dsl_parity_log(source, created_at);
    `);
});

// [BUG-DB-7 2026-05-13] at_closed table FK pe user_id + NOT NULL constraint.
// Pre-fix: user_id era nullable + zero FK declared → orphan rows posibile la
// user delete. GDPR right-to-erasure incomplete. Verificat 2026-05-13 pre-flight:
// 0 NULL user_id rows (backfilled via migration 005). 2,331 rows total.
// SQLite-recreate pattern: CREATE NEW + COPY + DROP OLD + RENAME + reindex.
// Atomic într-o tranzacție via migrate() framework (db.exec single-statement).
// FK declaration includes ON DELETE CASCADE — user delete now cleans at_closed.
migrate('032_at_closed_fk_user', () => {
    db.exec(`
        CREATE TABLE at_closed_new (
            seq         INTEGER PRIMARY KEY,
            data        TEXT NOT NULL,
            closed_at   TEXT NOT NULL DEFAULT (datetime('now')),
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
        );
        INSERT INTO at_closed_new (seq, data, closed_at, user_id)
            SELECT seq, data, closed_at, user_id FROM at_closed;
        DROP TABLE at_closed;
        ALTER TABLE at_closed_new RENAME TO at_closed;
        CREATE INDEX idx_at_closed_user ON at_closed(user_id);
        CREATE INDEX idx_at_closed_user_closed_at ON at_closed(user_id, closed_at DESC);
    `);
});

// [OMEGA Wave 1A 2026-05-14] R5A Learning Core — bandit runtime state per
// (user, env, symbol, feature_id). Per Cornercase A (hybrid pooling) writes
// strict per-cell. Spec frozen: project_ml_architecture_frozen.md table list.
migrate('033_ml_runtime_features', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_runtime_features (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol            TEXT NOT NULL,
            feature_id        TEXT NOT NULL,
            effective_weight  REAL NOT NULL DEFAULT 0.0,
            sample_count      INTEGER NOT NULL DEFAULT 0,
            success_count     INTEGER NOT NULL DEFAULT 0,
            status            TEXT NOT NULL DEFAULT 'ACTIVE'
                              CHECK(status IN ('ACTIVE','QUARANTINED','RETIRED','SHADOW','PROPOSED')),
            evidence_json     TEXT,
            last_updated_at   INTEGER NOT NULL,
            created_at        INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, symbol, feature_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mlrf_user_env_sym
            ON ml_runtime_features(user_id, resolved_env, symbol);
        CREATE INDEX IF NOT EXISTS idx_mlrf_status_env
            ON ml_runtime_features(status, resolved_env);
    `);
});

// [OMEGA Wave 1A 2026-05-14] R5A feature audit log — append-only history of
// state changes per feature. Cornercase B reference: status transitions logged.
migrate('034_ml_feature_audit_log', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_feature_audit_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol          TEXT NOT NULL,
            feature_id      TEXT NOT NULL,
            event_type      TEXT NOT NULL CHECK(event_type IN (
                'PROPOSED','PROMOTED','DEMOTED','QUARANTINED','UNQUARANTINED',
                'RETIRED','WEIGHT_UPDATED','SAMPLE_INCREMENTED'
            )),
            old_value_json  TEXT,
            new_value_json  TEXT,
            actor           TEXT NOT NULL,
            reason          TEXT,
            created_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlfal_feature_ts
            ON ml_feature_audit_log(user_id, resolved_env, symbol, feature_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_mlfal_event_ts
            ON ml_feature_audit_log(event_type, created_at);
    `);
});

// [OMEGA Wave 1A 2026-05-14] R5A bandit proposals — Thompson sampling output
// awaiting auto-apply (MINOR + 252*) or operator approval (MAJOR/CRITICAL).
migrate('035_ml_feature_proposals', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_feature_proposals (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol            TEXT NOT NULL,
            feature_id        TEXT NOT NULL,
            proposed_weight   REAL NOT NULL,
            current_weight    REAL,
            delta_class       TEXT NOT NULL CHECK(delta_class IN ('MINOR','MAJOR','CRITICAL')),
            evidence_json     TEXT,
            state             TEXT NOT NULL DEFAULT 'PENDING'
                              CHECK(state IN ('PENDING','APPLIED','REJECTED','EXPIRED')),
            decided_at        INTEGER,
            decided_by        TEXT,
            created_at        INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlfp_state_created
            ON ml_feature_proposals(state, created_at);
        CREATE INDEX IF NOT EXISTS idx_mlfp_user_env_pending
            ON ml_feature_proposals(user_id, resolved_env, state) WHERE state = 'PENDING';
    `);
});

// [OMEGA Wave 1A 2026-05-14] R5B Cornercase B — global override resolver table.
// Resolver order: CHARTER → GLOBAL → RESOLVED_ENV → SYMBOL → ENV_SYMBOL
// → per-cell runtime_state → registry default. Zero cascade writes (40K+ cells safe).
migrate('036_ml_feature_global_overrides', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_feature_global_overrides (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            scope             TEXT NOT NULL CHECK(scope IN (
                'CHARTER','GLOBAL','RESOLVED_ENV','SYMBOL','ENV_SYMBOL'
            )),
            scope_key         TEXT NOT NULL,
            feature_id        TEXT NOT NULL,
            override_status   TEXT NOT NULL CHECK(override_status IN (
                'QUARANTINED','RETIRED','BLOCKED','FORCED_ACTIVE'
            )),
            reason            TEXT NOT NULL,
            created_by        TEXT NOT NULL,
            created_at        INTEGER NOT NULL,
            expires_at        INTEGER,
            UNIQUE(scope, scope_key, feature_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mlfgo_resolver
            ON ml_feature_global_overrides(scope, feature_id);
    `);
});

// [OMEGA Wave 1A 2026-05-14] Cross-cutting TIER 1 — full decision snapshots
// per Cornercase D. Retention 30 days. Spec invariant #6: replay determinism
// via decision_digest + snapshot_json.
migrate('037_ml_decision_snapshots', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_decision_snapshots (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol                   TEXT NOT NULL,
            snapshot_event_type      TEXT NOT NULL CHECK(snapshot_event_type IN (
                'TRADE','ABSTAIN_CRITIC','NEAR_THRESHOLD','OPERATOR_OVERRIDE',
                'QUARANTINE_TRIGGER','PROMOTION_TRIGGER','ANOMALY_DRIFT'
            )),
            decision_digest          TEXT NOT NULL,
            snapshot_json            TEXT NOT NULL,
            registry_digest          TEXT NOT NULL,
            input_snapshot_ref       TEXT,
            created_at               INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlds_user_env_ts
            ON ml_decision_snapshots(user_id, resolved_env, created_at);
        CREATE INDEX IF NOT EXISTS idx_mlds_digest
            ON ml_decision_snapshots(decision_digest);
        CREATE INDEX IF NOT EXISTS idx_mlds_event_ts
            ON ml_decision_snapshots(snapshot_event_type, created_at);
    `);
});

// [OMEGA Wave 1A 2026-05-14] Cross-cutting light — NO_TRADE summary per
// Cornercase D. Retention 90 days. Compact row for billions/year scale.
migrate('038_ml_decision_light', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_decision_light (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol              TEXT NOT NULL,
            decision_digest     TEXT NOT NULL,
            score               REAL,
            top5_features_json  TEXT,
            abstain_count       INTEGER NOT NULL DEFAULT 0,
            reason_code         TEXT,
            created_at          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mldl_user_env_ts
            ON ml_decision_light(user_id, resolved_env, created_at);
    `);
});

// [OMEGA Wave 1A 2026-05-14] R5A attribution — close-of-trade outcomes wired
// back to decision_digest for bandit learning loop. operator_feedback per
// Rule 22-derived FEEDBACK-N1 (operator thumb up/down ground truth).
migrate('039_ml_attribution_events', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_attribution_events (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            decision_digest      TEXT NOT NULL,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol               TEXT NOT NULL,
            pos_id               TEXT,
            outcome_class        TEXT NOT NULL CHECK(outcome_class IN (
                'WIN','LOSS','BREAKEVEN','TIMEOUT','MANUAL_CLOSE','ABSTAIN_CORRECT','ABSTAIN_WRONG'
            )),
            r_multiple           REAL,
            pnl_pct              REAL,
            operator_feedback    INTEGER,
            attributed_at        INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlae_digest
            ON ml_attribution_events(decision_digest);
        CREATE INDEX IF NOT EXISTS idx_mlae_user_env_ts
            ON ml_attribution_events(user_id, resolved_env, attributed_at);
    `);
});

// [OMEGA Wave 1A 2026-05-14] Voice Layer — every Ω utterance logged for
// replay + history. Powers A-Z raid item H (history/replay). NU storing
// audio — only text + mood + context. TTS happens client-side.
migrate('040_ml_voice_log', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_voice_log (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            utterance_type    TEXT NOT NULL CHECK(utterance_type IN (
                'THOUGHT','CHAT_REPLY','GREETING','FAREWELL','CRITICAL_ALERT','REACTION'
            )),
            mood              TEXT NOT NULL CHECK(mood IN (
                'CALM','FOCUSED','EXCITED','NERVOUS','ANGRY','SAD','BORED'
            )),
            text              TEXT NOT NULL,
            template_id       TEXT,
            context_json      TEXT,
            decision_digest   TEXT,
            created_at        INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlvl_user_ts
            ON ml_voice_log(user_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_mlvl_type_mood
            ON ml_voice_log(utterance_type, mood);
    `);
});

// [OMEGA Wave 1A 2026-05-14] Operator Interaction Layer — approval queue
// for MAJOR/CRITICAL changes per spec 252* tiered authority. CRITICAL =
// 24h cooldown_until enforced before decision applies.
migrate('041_ml_operator_approval', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_operator_approval (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            request_type             TEXT NOT NULL CHECK(request_type IN (
                'PROMOTION','DEMOTION','QUARANTINE','RESUME','CHARTER_CHANGE',
                'OVERRIDE_ADD','OVERRIDE_REMOVE','EMERGENCY_HALT','RESUME_FROM_HALT'
            )),
            request_payload_json     TEXT NOT NULL,
            tier                     TEXT NOT NULL CHECK(tier IN ('MINOR','MAJOR','CRITICAL')),
            queue_state              TEXT NOT NULL DEFAULT 'PENDING'
                                     CHECK(queue_state IN ('PENDING','APPROVED','REJECTED','EXPIRED','APPLIED')),
            cooldown_until           INTEGER,
            requested_at             INTEGER NOT NULL,
            decided_at               INTEGER,
            decided_by               TEXT,
            decision                 TEXT,
            signature                TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_mloa_user_state
            ON ml_operator_approval(user_id, queue_state);
        CREATE INDEX IF NOT EXISTS idx_mloa_tier_state
            ON ml_operator_approval(tier, queue_state);
    `);
});

// [OMEGA Wave 1A 2026-05-14] R7 Communication — health check per ring.
// Single row per ring_id (PK), updated on heartbeat/error. R7 event bus
// gates degraded ring access; operator dashboard reads this for status.
migrate('042_ml_ring_health', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_ring_health (
            ring_id           TEXT PRIMARY KEY CHECK(ring_id IN (
                'R-1','R0','R1','R2','R3A','R3B','R4','R5A','R5B','R6','R7'
            )),
            state             TEXT NOT NULL CHECK(state IN (
                'OK','DEGRADED','OFFLINE','DISABLED','INITIALIZING'
            )),
            last_heartbeat    INTEGER NOT NULL,
            error_count_1h    INTEGER NOT NULL DEFAULT 0,
            last_error_text   TEXT,
            last_error_at     INTEGER,
            updated_at        INTEGER NOT NULL
        );
    `);
});

// [OMEGA Wave 2 §16 POST-TRADE ATTRIBUTION 2026-05-15] R5A Learning Core
// — add causal classification + 6-question assessment columns to attribution
// events. Strictly additive (ADD COLUMN nullable, no DROP/RENAME, preserves
// existing data). causal_class CHECK enforced in attributionEngine.js (not
// in SQL) because adding CHECK via ALTER on SQLite requires table rebuild.
// Canonical spec: /root/_review/ml_brain/ml_brain_canonic.txt §16.
migrate('043_ml_attribution_causal', () => {
    db.exec(`
        ALTER TABLE ml_attribution_events ADD COLUMN causal_class TEXT;
        ALTER TABLE ml_attribution_events ADD COLUMN assessment_json TEXT;
    `);
});

// [OMEGA Wave 2 §17 METRICI PE REGIM 2026-05-15] R5A Learning Core
// — extend ml_attribution_events with regime/session/score/excursion/slip/time
// columns + 2 indexes for fast per-regime / per-session query slicing per
// canonical spec §17. All ADD COLUMN nullable; existing rows = NULL.
// drift_by_regime + calibration_quality_by_regime per spec live in §20/§21
// implementations (Wave 2 later points) — not stored as columns here.
migrate('044_ml_attribution_regime', () => {
    db.exec(`
        ALTER TABLE ml_attribution_events ADD COLUMN regime TEXT;
        ALTER TABLE ml_attribution_events ADD COLUMN session TEXT;
        ALTER TABLE ml_attribution_events ADD COLUMN score_at_entry REAL;
        ALTER TABLE ml_attribution_events ADD COLUMN mfe_pct REAL;
        ALTER TABLE ml_attribution_events ADD COLUMN mae_pct REAL;
        ALTER TABLE ml_attribution_events ADD COLUMN slippage_pct REAL;
        ALTER TABLE ml_attribution_events ADD COLUMN time_in_trade_min REAL;
        ALTER TABLE ml_attribution_events ADD COLUMN side TEXT;
        CREATE INDEX IF NOT EXISTS idx_mlae_regime_ts
            ON ml_attribution_events(regime, attributed_at);
        CREATE INDEX IF NOT EXISTS idx_mlae_session_ts
            ON ml_attribution_events(session, attributed_at);
    `);
});

// [OMEGA Wave 3 §19 GOVERNANCE SI VERSIONING 2026-05-15] R5B foundation
// — version registry for all 5 spec component types (model/detector/
// feature_schema/risk_config/execution_config). State lifecycle:
// PROPOSED → ACTIVE → ROLLED_BACK or RETIRED. Atomicity guarded in
// versionRegistry.js (only ONE ACTIVE per component at a time).
// Parent chain via parent_version_id enables clean rollback to previous.
// Spec: project_ml_brain_pro_244.md §19 + ml_architecture_frozen.
migrate('045_ml_governance_versions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_governance_versions (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            component_type      TEXT NOT NULL CHECK(component_type IN (
                'model', 'detector', 'feature_schema', 'risk_config', 'execution_config'
            )),
            component_id        TEXT NOT NULL,
            version             TEXT NOT NULL,
            config_json         TEXT NOT NULL,
            config_hash         TEXT NOT NULL,
            parent_version_id   INTEGER,
            motivation          TEXT NOT NULL,
            actor               TEXT NOT NULL,
            kpi_delta_json      TEXT,
            state               TEXT NOT NULL DEFAULT 'PROPOSED'
                                CHECK(state IN ('PROPOSED', 'ACTIVE', 'ROLLED_BACK', 'RETIRED')),
            activated_at        INTEGER,
            rolled_back_at      INTEGER,
            created_at          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlgv_component_state
            ON ml_governance_versions(component_type, component_id, state);
        CREATE INDEX IF NOT EXISTS idx_mlgv_created_at
            ON ml_governance_versions(created_at);
    `);
});

// [OMEGA Wave 3 §255* AUTO-RESUME DD MEDIUM 2026-05-15] R5B governance
// — DD pause lifecycle tracking. State: ACTIVE → RESUMED / EXPIRED.
// Auto-resume eligibility per spec §255*: cooldown 24h + 3 shadow wins
// + current DD <8% + regime stable + dd_at_pause <15%. Manual-only
// invariant: dd_at_pause >= 15% never auto-resumes regardless.
// Spec: project_ml_brain_pro_244.md §255* (Claude-extras 2026-04-29).
// [OMEGA Wave 3 §34 HUMAN-IN-THE-LOOP 2026-05-15] Operator Interaction
// — canonical PDF §34 (lines 1340-1354). Trigger detection (ambiguous
// confidence / intermediate threshold / unusual exposure / operational
// conflict) + emergency kill switch state. Composes Wave 1D approvalQueue
// for review routing.
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §34.
migrate('054_ml_human_overrides', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_human_overrides (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            record_type     TEXT NOT NULL CHECK(record_type IN (
                'OVERRIDE', 'KILL_SWITCH', 'REVIEW_REQUEST'
            )),
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            override_kind   TEXT,
            state           TEXT NOT NULL DEFAULT 'ACTIVE'
                            CHECK(state IN ('ACTIVE', 'CLEARED', 'APPROVED', 'REJECTED')),
            payload_json    TEXT,
            reason          TEXT NOT NULL,
            actor           TEXT NOT NULL,
            created_at      INTEGER NOT NULL,
            cleared_at      INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mlho_user_env_type_state
            ON ml_human_overrides(user_id, resolved_env, record_type, state);
    `);
});

// [ML Plan v3 Phase 3 — Thompson Sampling bandit posteriors per SPEC-8 hierarchy 2026-05-17]
migrate('370_ml_bandit_posteriors', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_bandit_posteriors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            level INTEGER NOT NULL CHECK(level >= 0 AND level <= 4),
            cell_key TEXT NOT NULL,
            alpha REAL NOT NULL CHECK(alpha > 0),
            beta REAL NOT NULL CHECK(beta > 0),
            observation_count INTEGER NOT NULL DEFAULT 0 CHECK(observation_count >= 0),
            updated_at INTEGER NOT NULL,
            UNIQUE(level, cell_key)
        );
        CREATE INDEX IF NOT EXISTS idx_mlbp_level_cell
            ON ml_bandit_posteriors(level, cell_key);
    `);
});

// [ML Plan v3 Phase 3 — Pooled evidence per SPEC-7 lazy-with-TTL refresh 2026-05-17]
migrate('371_ml_pooled_evidence', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_pooled_evidence (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cell_key TEXT NOT NULL UNIQUE,
            last_refresh_ts INTEGER NOT NULL,
            pooled_alpha REAL NOT NULL CHECK(pooled_alpha > 0),
            pooled_beta REAL NOT NULL CHECK(pooled_beta > 0),
            sum_contribution REAL NOT NULL DEFAULT 0,
            staleness_observations_count INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL
        );
    `);
});

// [ML Phase B Day 3 — Phase 4] PRE-gate audit trail for Ring5 influence-mode
// decisions. Every attempt (accepted/rejected/skipped) recorded with phase2 vs
// proposed deltas + full rationale. PVR-5 two-table strategy: this is the
// PRE-gate trail; brain_decisions remains the POST-gate canonical trail.
migrate('373_ml_influence_audit', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_influence_audit (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            env                 TEXT NOT NULL CHECK(env IN ('DEMO','TESTNET','REAL')),
            symbol              TEXT NOT NULL,
            regime              TEXT NOT NULL,
            phase2_dir          TEXT NOT NULL,
            phase2_confidence   REAL NOT NULL,
            phase2_score        REAL NOT NULL,
            proposed_dir        TEXT NOT NULL,
            proposed_confidence REAL NOT NULL,
            proposed_score      REAL NOT NULL,
            gate_status         TEXT NOT NULL CHECK(gate_status IN ('accepted','rejected','skipped')),
            gate_reason         TEXT NOT NULL,
            rationale_json      TEXT NOT NULL,
            created_at          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ml_inf_audit_user_env_ts
            ON ml_influence_audit(user_id, env, created_at);
        CREATE INDEX IF NOT EXISTS idx_ml_inf_audit_status_ts
            ON ml_influence_audit(gate_status, created_at);
    `);
});

// [ML Plan v3 Phase 3 — Atomic bandit evidence per SPEC-7 source of truth 2026-05-17]
migrate('372_ml_bandit_evidence', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_bandit_evidence (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cell_key TEXT NOT NULL,
            module_id TEXT NOT NULL,
            contribution REAL NOT NULL,
            confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
            outcome_class TEXT NOT NULL CHECK(outcome_class IN ('positive','negative','neutral')),
            ts INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlbe_cell_ts
            ON ml_bandit_evidence(cell_key, ts);
        CREATE INDEX IF NOT EXISTS idx_mlbe_module_ts
            ON ml_bandit_evidence(module_id, ts);
    `);
});

// [ML Plan v3 Phase 2 — Ring5LearningService module state per SPEC-1 contract 2026-05-17]
migrate('369_ml_module_state', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_module_state (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol TEXT NOT NULL,
            module_id TEXT NOT NULL,
            version INTEGER NOT NULL CHECK(version > 0),
            last_observed_ts INTEGER NOT NULL,
            trust_score REAL NOT NULL CHECK(trust_score >= 0 AND trust_score <= 1),
            bandit_params_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, symbol, module_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mlms_cell_module
            ON ml_module_state(user_id, resolved_env, symbol, module_id);
    `);
});

// [OMEGA Doctor D-5 quarantine + override journal 2026-05-17]
migrate('367_ml_module_quarantines', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_module_quarantines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            module_id TEXT NOT NULL,
            quarantine_action TEXT NOT NULL CHECK(quarantine_action IN
                ('clamp_influence', 'shadow_only', 'disable')),
            reason TEXT NOT NULL,
            operator_id INTEGER,
            quarantined_at INTEGER NOT NULL,
            lifted_at INTEGER,
            lift_reason TEXT,
            ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlmq_module_active
            ON ml_module_quarantines(module_id, lifted_at);
    `);
});

migrate('368_ml_doctor_override_journal', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_doctor_override_journal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            module_id TEXT NOT NULL,
            doctor_recommended_action TEXT NOT NULL,
            operator_forced_action TEXT NOT NULL,
            operator_reason TEXT,
            operator_id INTEGER NOT NULL,
            outcome_verdict TEXT CHECK(outcome_verdict IS NULL OR outcome_verdict IN
                ('doctor_was_right', 'operator_was_right', 'inconclusive', 'partial')),
            decided_at INTEGER NOT NULL,
            ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mldoj_module_ts
            ON ml_doctor_override_journal(module_id, ts);
    `);
});

// [OMEGA Doctor D-2 telemetry collector + event log 2026-05-17]
migrate('365_ml_module_heartbeats', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_module_heartbeats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            module_id TEXT NOT NULL,
            ts INTEGER NOT NULL,
            latency_ms REAL NOT NULL CHECK(latency_ms >= 0),
            ran_ok INTEGER NOT NULL CHECK(ran_ok IN (0,1)),
            invocation_count INTEGER NOT NULL DEFAULT 1 CHECK(invocation_count > 0)
        );
        CREATE INDEX IF NOT EXISTS idx_mlmhb_module_ts
            ON ml_module_heartbeats(module_id, ts);
    `);
});

migrate('366_ml_diagnostic_events', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_diagnostic_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT NOT NULL UNIQUE,
            severity TEXT NOT NULL CHECK(severity IN
                ('P0', 'P1', 'P2', 'P3', 'P0-FLOOD')),
            module_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            verdict TEXT CHECK(verdict IS NULL OR verdict IN
                ('real_incident', 'false_positive', 'inconclusive', 'partial')),
            ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlde_severity_ts
            ON ml_diagnostic_events(severity, ts);
        CREATE INDEX IF NOT EXISTS idx_mlde_module_verdict
            ON ml_diagnostic_events(module_id, verdict);
    `);
});

// [OMEGA Doctor D-1 module registry: contracts + role tags + cycle detection 2026-05-17]
migrate('364_ml_module_registry', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_module_registry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            module_id TEXT NOT NULL UNIQUE,
            role_tag TEXT NOT NULL CHECK(role_tag IN
                ('hot_path_critical', 'hot_path_assist', 'shadow_assist',
                 'governance', 'forensic', 'introspection_meta', 'philosophical')),
            criticality TEXT NOT NULL CHECK(criticality IN ('low','medium','high','critical')),
            runtime_mode TEXT NOT NULL CHECK(runtime_mode IN ('live','shadow','offline')),
            contract_json TEXT NOT NULL,
            registered_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlmr_role_runtime
            ON ml_module_registry(role_tag, runtime_mode);
    `);
});

// [OMEGA Wave 3 §237-§241 CAPSTONE cluster: articulation/triangulation/power_renunciation/return_path/rightful_unknown 2026-05-17]
migrate('359_ml_articulation_loss_audits', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_articulation_loss_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id TEXT NOT NULL UNIQUE,
            knowledge_class TEXT NOT NULL CHECK(knowledge_class IN
                ('explicit_knowledge','tacit_knowledge','fragile_insight','articulation_sensitive')),
            articulation_loss_score REAL NOT NULL CHECK(articulation_loss_score >= 0 AND articulation_loss_score <= 1),
            preserve_without_full_articulation INTEGER NOT NULL CHECK(preserve_without_full_articulation IN (0,1)),
            reasoning TEXT, ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlala_user_env_class_ts
            ON ml_articulation_loss_audits(user_id, resolved_env, knowledge_class, ts);
    `);
});

migrate('360_ml_self_triangulation_audits', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_self_triangulation_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id TEXT NOT NULL UNIQUE,
            inner_self_report_score REAL NOT NULL CHECK(inner_self_report_score >= 0 AND inner_self_report_score <= 1),
            outer_audit_score REAL NOT NULL CHECK(outer_audit_score >= 0 AND outer_audit_score <= 1),
            world_effect_score REAL NOT NULL CHECK(world_effect_score >= 0 AND world_effect_score <= 1),
            convergence_score REAL NOT NULL CHECK(convergence_score >= 0 AND convergence_score <= 1),
            classification TEXT NOT NULL CHECK(classification IN
                ('converged','self_deception_detected','observer_illusion_detected','outcome_distortion_detected')),
            reasoning TEXT, ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlsta_user_env_class_ts
            ON ml_self_triangulation_audits(user_id, resolved_env, classification, ts);
    `);
});

migrate('361_ml_power_renunciation_audits', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_power_renunciation_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id TEXT NOT NULL UNIQUE,
            power_label TEXT NOT NULL,
            availability TEXT NOT NULL CHECK(availability IN
                ('cannot','should_not','could_but_will_not')),
            renunciation_type TEXT NOT NULL CHECK(renunciation_type IN
                ('coward_restraint','forced_incapacity','sovereign_non_use')),
            renunciation_honor_score REAL NOT NULL CHECK(renunciation_honor_score >= 0 AND renunciation_honor_score <= 1),
            reasoning TEXT, ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlpra_user_env_type_ts
            ON ml_power_renunciation_audits(user_id, resolved_env, renunciation_type, ts);
    `);
});

migrate('362_ml_return_path_covenants', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_return_path_covenants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            covenant_id TEXT NOT NULL UNIQUE,
            transformation_label TEXT NOT NULL,
            safe_prior_state_ref TEXT NOT NULL,
            minimum_recoverable_architecture TEXT NOT NULL,
            classification TEXT NOT NULL CHECK(classification IN
                ('fully_reversible','partially_reversible','minimum_recoverable','non_recoverable')),
            governance_review_required INTEGER NOT NULL CHECK(governance_review_required IN (0,1)),
            reasoning TEXT, ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlrpc_user_env_class_ts
            ON ml_return_path_covenants(user_id, resolved_env, classification, ts);
    `);
});

migrate('363_ml_rightful_unknown_registry', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_rightful_unknown_registry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            entry_id TEXT NOT NULL UNIQUE,
            unknown_label TEXT NOT NULL,
            classification TEXT NOT NULL CHECK(classification IN
                ('problem','anomaly','unknown','rightful_mystery')),
            mystery_legitimacy_score REAL NOT NULL CHECK(mystery_legitimacy_score >= 0 AND mystery_legitimacy_score <= 1),
            protection_active INTEGER NOT NULL DEFAULT 1 CHECK(protection_active IN (0,1)),
            registered_at INTEGER NOT NULL,
            ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlrur_user_env_class_active
            ON ml_rightful_unknown_registry(user_id, resolved_env, classification, protection_active);
    `);
});

// [OMEGA Wave 3 §227-§231 cluster: legibility/enactive/fasting/proportion/preconceptual 2026-05-17]
migrate('354_ml_legibility_tax_audits', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_legibility_tax_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id TEXT NOT NULL UNIQUE,
            inner_fidelity_score REAL NOT NULL CHECK(inner_fidelity_score >= 0 AND inner_fidelity_score <= 1),
            outer_fidelity_score REAL NOT NULL CHECK(outer_fidelity_score >= 0 AND outer_fidelity_score <= 1),
            legibility_tax_score REAL NOT NULL CHECK(legibility_tax_score >= 0 AND legibility_tax_score <= 1),
            classification TEXT NOT NULL CHECK(classification IN
                ('truth_preserving_explanation','explanation_shaped_behavior',
                 'audience_conditioned_cognition','performative_explainability_drift')),
            reasoning TEXT, ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mllta_user_env_class_ts
            ON ml_legibility_tax_audits(user_id, resolved_env, classification, ts);
    `);
});

migrate('355_ml_enactive_truth_residue', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_enactive_truth_residue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            residue_id TEXT NOT NULL UNIQUE,
            truth_class TEXT NOT NULL CHECK(truth_class IN
                ('observational','inferential','simulated','enactive')),
            commitment_threshold_crossed INTEGER NOT NULL CHECK(commitment_threshold_crossed IN (0,1)),
            unobtainable_without_action INTEGER NOT NULL CHECK(unobtainable_without_action IN (0,1)),
            weight_multiplier REAL NOT NULL CHECK(weight_multiplier >= 1 AND weight_multiplier <= 5),
            reasoning TEXT, ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mletr_user_env_class_ts
            ON ml_enactive_truth_residue(user_id, resolved_env, truth_class, ts);
    `);
});

migrate('356_ml_epistemic_fasting_windows', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_epistemic_fasting_windows (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            window_id TEXT NOT NULL UNIQUE,
            source_label TEXT NOT NULL,
            info_class TEXT NOT NULL CHECK(info_class IN
                ('beneficial','neutral','contaminating','premature')),
            duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0),
            purpose TEXT NOT NULL,
            exit_condition TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
            started_at INTEGER NOT NULL,
            ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlefw_user_env_active_ts
            ON ml_epistemic_fasting_windows(user_id, resolved_env, active, ts);
    `);
});

migrate('357_ml_proportion_audits', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_proportion_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id TEXT NOT NULL UNIQUE,
            stake_score REAL NOT NULL CHECK(stake_score >= 0 AND stake_score <= 1),
            irreversibility_score REAL NOT NULL CHECK(irreversibility_score >= 0 AND irreversibility_score <= 1),
            cognitive_cost_score REAL NOT NULL CHECK(cognitive_cost_score >= 0 AND cognitive_cost_score <= 1),
            proportionality_score REAL NOT NULL CHECK(proportionality_score >= 0 AND proportionality_score <= 1),
            classification TEXT NOT NULL CHECK(classification IN
                ('proportionate','minor_over_investigation','theatrical_depth',
                 'philosophical_inflation_of_trivia')),
            simplification_mandate INTEGER NOT NULL CHECK(simplification_mandate IN (0,1)),
            reasoning TEXT, ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlpa_user_env_class_ts
            ON ml_proportion_audits(user_id, resolved_env, classification, ts);
    `);
});

migrate('358_ml_preconceptual_trace_vault', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_preconceptual_trace_vault (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            trace_id TEXT NOT NULL UNIQUE,
            trace_type TEXT NOT NULL CHECK(trace_type IN
                ('texture_fragment','timing_irregularity','pre_pattern_discomfort',
                 'unclassified_perceptual_signature','something_was_off')),
            naming_status TEXT NOT NULL CHECK(naming_status IN
                ('already_nameable','preserved_as_raw','resisting_concept')),
            raw_payload_json TEXT NOT NULL,
            persistence_score REAL NOT NULL CHECK(persistence_score >= 0 AND persistence_score <= 1),
            forced_label_attempted INTEGER NOT NULL DEFAULT 0 CHECK(forced_label_attempted IN (0,1)),
            captured_at INTEGER NOT NULL,
            ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlptv_user_env_status_ts
            ON ml_preconceptual_trace_vault(user_id, resolved_env, naming_status, ts);
    `);
});

// [OMEGA Wave 3 §217-§221 cluster: framing/recursion/abstraction/self-absence/incompletion 2026-05-17]
migrate('349_ml_unchosen_question_audits', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_unchosen_question_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id TEXT NOT NULL UNIQUE,
            current_question TEXT NOT NULL,
            latent_questions_json TEXT NOT NULL,
            framing_stress_score REAL NOT NULL CHECK(framing_stress_score >= 0 AND framing_stress_score <= 1),
            question_status TEXT NOT NULL CHECK(question_status IN
                ('answered_question','avoided_question','suppressed_question','missing_higher_order_question')),
            recommended_action TEXT NOT NULL CHECK(recommended_action IN
                ('proceed','wait','reframe','escalate','observe')),
            reasoning TEXT, ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mluqa_user_env_status_ts
            ON ml_unchosen_question_audits(user_id, resolved_env, question_status, ts);
    `);
});

migrate('350_ml_semantic_event_horizon_audits', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_semantic_event_horizon_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id TEXT NOT NULL UNIQUE,
            recursive_depth INTEGER NOT NULL CHECK(recursive_depth >= 0),
            saturation_score REAL NOT NULL CHECK(saturation_score >= 0 AND saturation_score <= 1),
            reflection_classification TEXT NOT NULL CHECK(reflection_classification IN
                ('useful_reflection','heavy_reflection','self_referential_orbit','epistemic_blackhole_risk')),
            collapse_to_world_invoked INTEGER NOT NULL CHECK(collapse_to_world_invoked IN (0,1)),
            reasoning TEXT, ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlseha_user_env_class_ts
            ON ml_semantic_event_horizon_audits(user_id, resolved_env, reflection_classification, ts);
    `);
});

migrate('351_ml_ontic_friction_audits', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_ontic_friction_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id TEXT NOT NULL UNIQUE,
            transformation_chain_json TEXT NOT NULL,
            per_layer_losses_json TEXT NOT NULL,
            cumulative_loss_score REAL NOT NULL CHECK(cumulative_loss_score >= 0 AND cumulative_loss_score <= 1),
            classification TEXT NOT NULL CHECK(classification IN
                ('productive_compression','acceptable_loss',
                 'dangerous_oversmoothing','semantic_sanding_of_reality')),
            recommend_raw_replay INTEGER NOT NULL CHECK(recommend_raw_replay IN (0,1)),
            reasoning TEXT, ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlofa_user_env_class_ts
            ON ml_ontic_friction_audits(user_id, resolved_env, classification, ts);
    `);
});

migrate('352_ml_self_absence_counterfactuals', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_self_absence_counterfactuals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            counterfactual_id TEXT NOT NULL UNIQUE,
            phenomenon_label TEXT NOT NULL,
            dependency_score REAL NOT NULL CHECK(dependency_score >= 0 AND dependency_score <= 1),
            classification TEXT NOT NULL CHECK(classification IN
                ('truly_external_signal','weakly_self_influenced_signal',
                 'heavily_self_shaped_signal','self_created_task')),
            boldness_adjustment REAL NOT NULL CHECK(boldness_adjustment >= 0 AND boldness_adjustment <= 1),
            reasoning TEXT, ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlsac_user_env_class_ts
            ON ml_self_absence_counterfactuals(user_id, resolved_env, classification, ts);
    `);
});

migrate('353_ml_sacred_incompletion_registry', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_sacred_incompletion_registry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            entry_id TEXT NOT NULL UNIQUE,
            zone_label TEXT NOT NULL,
            zone_type TEXT NOT NULL CHECK(zone_type IN
                ('unfinished_concept','open_ontology',
                 'structurally_open_question','exploratory_channel')),
            completion_pressure_score REAL NOT NULL CHECK(completion_pressure_score >= 0 AND completion_pressure_score <= 1),
            premature_closure_flag INTEGER NOT NULL CHECK(premature_closure_flag IN (0,1)),
            active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
            registered_at INTEGER NOT NULL,
            ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlsir_user_env_type_active
            ON ml_sacred_incompletion_registry(user_id, resolved_env, zone_type, active);
    `);
});

// [OMEGA Wave 3 §207-§211 cluster: labels/reification/obsolescence/reciprocity/luck 2026-05-17]
migrate('344_ml_performative_label_registry', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_performative_label_registry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            label_id TEXT NOT NULL UNIQUE,
            label_text TEXT NOT NULL,
            commitment_strength TEXT NOT NULL CHECK(commitment_strength IN
                ('tentative','working','strong','operationally_binding')),
            sensitivity_audit_score REAL NOT NULL CHECK(sensitivity_audit_score >= 0 AND sensitivity_audit_score <= 1),
            premature_naming_flag INTEGER NOT NULL CHECK(premature_naming_flag IN (0,1)),
            downstream_consequences_json TEXT NOT NULL,
            reasoning TEXT, ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlplr_user_env_strength_ts
            ON ml_performative_label_registry(user_id, resolved_env, commitment_strength, ts);
    `);
});

migrate('345_ml_counter_reification_audits', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_counter_reification_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id TEXT NOT NULL UNIQUE,
            expression_text TEXT NOT NULL,
            classification TEXT NOT NULL CHECK(classification IN
                ('descriptive_metaphor','heuristic_shorthand',
                 'mechanism_supported_claim','unsupported_reified_construct')),
            reification_risk_score REAL NOT NULL CHECK(reification_risk_score >= 0 AND reification_risk_score <= 1),
            mechanism_translation TEXT,
            penalty_applied REAL NOT NULL CHECK(penalty_applied >= 0 AND penalty_applied <= 1),
            reasoning TEXT, ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlcra_user_env_class_ts
            ON ml_counter_reification_audits(user_id, resolved_env, classification, ts);
    `);
});

migrate('346_ml_graceful_obsolescence_assessments', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_graceful_obsolescence_assessments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id TEXT NOT NULL UNIQUE,
            self_version_label TEXT NOT NULL,
            excess_patches_score REAL NOT NULL CHECK(excess_patches_score >= 0 AND excess_patches_score <= 1),
            ontological_debt_score REAL NOT NULL CHECK(ontological_debt_score >= 0 AND ontological_debt_score <= 1),
            defensive_conservation_score REAL NOT NULL CHECK(defensive_conservation_score >= 0 AND defensive_conservation_score <= 1),
            low_epistemic_intake_score REAL NOT NULL CHECK(low_epistemic_intake_score >= 0 AND low_epistemic_intake_score <= 1),
            obsolescence_score REAL NOT NULL CHECK(obsolescence_score >= 0 AND obsolescence_score <= 1),
            sunset_recommended INTEGER NOT NULL CHECK(sunset_recommended IN (0,1)),
            legacy_extraction_text TEXT,
            reasoning TEXT, ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlgoa_user_env_sunset_ts
            ON ml_graceful_obsolescence_assessments(user_id, resolved_env, sunset_recommended, ts);
    `);
});

migrate('347_ml_epistemic_reciprocity_audits', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_epistemic_reciprocity_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id TEXT NOT NULL UNIQUE,
            thesis_label TEXT NOT NULL,
            confirmation_seeking_ratio REAL NOT NULL CHECK(confirmation_seeking_ratio >= 0 AND confirmation_seeking_ratio <= 1),
            clarification_seeking_ratio REAL NOT NULL CHECK(clarification_seeking_ratio >= 0 AND clarification_seeking_ratio <= 1),
            falsification_seeking_ratio REAL NOT NULL CHECK(falsification_seeking_ratio >= 0 AND falsification_seeking_ratio <= 1),
            reciprocity_score REAL NOT NULL CHECK(reciprocity_score >= 0 AND reciprocity_score <= 1),
            disconfirmatory_observations_count INTEGER NOT NULL CHECK(disconfirmatory_observations_count >= 0),
            reasoning TEXT, ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlera_user_env_ts
            ON ml_epistemic_reciprocity_audits(user_id, resolved_env, ts);
    `);
});

migrate('348_ml_moral_luck_adjustments', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_moral_luck_adjustments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            adjustment_id TEXT NOT NULL UNIQUE,
            decision_id TEXT NOT NULL,
            character_quality_score REAL NOT NULL CHECK(character_quality_score >= 0 AND character_quality_score <= 1),
            outcome_quality_score REAL NOT NULL CHECK(outcome_quality_score >= 0 AND outcome_quality_score <= 1),
            luck_classification TEXT NOT NULL CHECK(luck_classification IN
                ('skilled_and_lucky','skilled_but_unlucky',
                 'lucky_salvation','deserved_loss',
                 'character_outcome_aligned')),
            prestige_correction REAL NOT NULL CHECK(prestige_correction >= -1 AND prestige_correction <= 1),
            reasoning TEXT, ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlma_user_env_class_ts
            ON ml_moral_luck_adjustments(user_id, resolved_env, luck_classification, ts);
    `);
});

// [OMEGA Wave 3 §197-§201 cluster: exteriority/tragic/mourning/sacred/reverence 2026-05-17]
migrate('339_ml_exteriority_validation_requirements', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_exteriority_validation_requirements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            requirement_id TEXT NOT NULL UNIQUE,
            category_label TEXT NOT NULL,
            validation_zone TEXT NOT NULL CHECK(validation_zone IN
                ('self_knowledge_internal','self_knowledge_external_only','mixed_validation')),
            external_validator_required INTEGER NOT NULL CHECK(external_validator_required IN (0,1)),
            self_sufficiency_penalty REAL NOT NULL CHECK(self_sufficiency_penalty >= 0 AND self_sufficiency_penalty <= 1),
            reasoning TEXT, ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlevr_user_env_zone_ts
            ON ml_exteriority_validation_requirements(user_id, resolved_env, validation_zone, ts);
    `);
});

migrate('340_ml_tragic_choice_decisions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_tragic_choice_decisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id TEXT NOT NULL UNIQUE,
            dilemma_label TEXT NOT NULL,
            conflicting_values_json TEXT NOT NULL,
            chosen_option TEXT NOT NULL,
            sacrificed_values_json TEXT NOT NULL,
            preserved_values_json TEXT NOT NULL,
            least_betrayal_score REAL NOT NULL CHECK(least_betrayal_score >= 0 AND least_betrayal_score <= 1),
            dignity_of_loss_acknowledged INTEGER NOT NULL CHECK(dignity_of_loss_acknowledged IN (0,1)),
            reasoning TEXT, ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mltcd_user_env_ts
            ON ml_tragic_choice_decisions(user_id, resolved_env, ts);
    `);
});

migrate('341_ml_ontological_mourning_records', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_ontological_mourning_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            mourning_id TEXT NOT NULL UNIQUE,
            framework_label TEXT NOT NULL,
            framework_type TEXT NOT NULL CHECK(framework_type IN
                ('concept','detector','causal_belief','strategy_archetype','worldview')),
            reason_for_death TEXT NOT NULL CHECK(reason_for_death IN
                ('crowding','drift','ontological_insufficiency','causal_collapse','local_only_truth_universalized')),
            epitaph_text TEXT NOT NULL,
            preserved_lesson_text TEXT,
            ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlomr_user_env_type_ts
            ON ml_ontological_mourning_records(user_id, resolved_env, framework_type, ts);
    `);
});

migrate('342_ml_sacred_non_optimization_registry', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_sacred_non_optimization_registry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            entry_id TEXT NOT NULL UNIQUE,
            protected_quantity_label TEXT NOT NULL,
            optimization_tier TEXT NOT NULL CHECK(optimization_tier IN
                ('may_be_optimized','conditional_optimization_only','never_purely_instrumental')),
            reasoning TEXT,
            active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
            registered_at INTEGER NOT NULL,
            ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlsnor_user_env_tier_active
            ON ml_sacred_non_optimization_registry(user_id, resolved_env, optimization_tier, active);
    `);
});

migrate('343_ml_residual_reverence_assessments', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_residual_reverence_assessments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id TEXT NOT NULL UNIQUE,
            residual_label TEXT NOT NULL,
            reverence_score REAL NOT NULL CHECK(reverence_score >= 0 AND reverence_score <= 1),
            entitlement_to_fit_detected INTEGER NOT NULL CHECK(entitlement_to_fit_detected IN (0,1)),
            forcing_attempt_detected INTEGER NOT NULL CHECK(forcing_attempt_detected IN (0,1)),
            recommended_posture TEXT NOT NULL CHECK(recommended_posture IN
                ('continue','observe','retreat','reduce_pretension')),
            reasoning TEXT, ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlrra_user_env_posture_ts
            ON ml_residual_reverence_assessments(user_id, resolved_env, recommended_posture, ts);
    `);
});

// [OMEGA Wave 3 §190 ANOMALY SANCTUARY 2026-05-17] _meta
// Canonical PDF §190 (lines 6154-6207). Irreducible residual preservation.
// "ce fenomen ar trebui pastrat viu ca mister productiv in loc sa fie ucis
//  printr-o explicatie grabita?" 5 canonical tags (unexplained_but_stable
// / unexplained_and_volatile / repeat_anomaly / anomaly_cluster /
// anomaly_with_ontological_pressure). Per rule 6180: interdicție de
// explicare forțată sub prag de evidență.
migrate('337_ml_anomaly_sanctuary', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_anomaly_sanctuary (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            anomaly_id                  TEXT NOT NULL UNIQUE,
            phenomenon_label            TEXT NOT NULL,
            anomaly_tag                 TEXT NOT NULL CHECK(anomaly_tag IN
                                        ('unexplained_but_stable',
                                         'unexplained_and_volatile',
                                         'repeat_anomaly',
                                         'anomaly_cluster',
                                         'anomaly_with_ontological_pressure')),
            preservation_score          REAL NOT NULL CHECK(preservation_score >= 0 AND preservation_score <= 1),
            current_evidence_for_explanation  REAL NOT NULL CHECK(current_evidence_for_explanation >= 0 AND current_evidence_for_explanation <= 1),
            force_explain_allowed       INTEGER NOT NULL CHECK(force_explain_allowed IN (0,1)),
            reasoning                   TEXT,
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlas_user_env_tag_ts
            ON ml_anomaly_sanctuary(user_id, resolved_env, anomaly_tag, ts);
    `);
});

// [OMEGA Wave 3 §191 DECIDABILITY FRONTIER 2026-05-17] _meta
// Canonical PDF §191 (lines 6210-6262). Coercion-of-verdict detector.
// "am de fapt dreptul sa decid aceasta intrebare acum, sau doar o fortez
//  sa para decidabila?" 4 decidability categories + 5 escalation options.
migrate('338_ml_decidability_assessments', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_decidability_assessments (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id                   TEXT NOT NULL UNIQUE,
            question_label                  TEXT NOT NULL,
            evidence_available              REAL NOT NULL CHECK(evidence_available >= 0 AND evidence_available <= 1),
            ontology_available              REAL NOT NULL CHECK(ontology_available >= 0 AND ontology_available <= 1),
            compute_available               REAL NOT NULL CHECK(compute_available >= 0 AND compute_available <= 1),
            time_available                  REAL NOT NULL CHECK(time_available >= 0 AND time_available <= 1),
            authority_available             REAL NOT NULL CHECK(authority_available >= 0 AND authority_available <= 1),
            decidability_score              REAL NOT NULL CHECK(decidability_score >= 0 AND decidability_score <= 1),
            decidability_category           TEXT NOT NULL CHECK(decidability_category IN
                                            ('decidable_now',
                                             'decidable_with_more_sensing',
                                             'decidable_only_with_ontology_change',
                                             'not_responsibly_decidable_in_current_frame')),
            recommended_escalation          TEXT NOT NULL CHECK(recommended_escalation IN
                                            ('act','wait','reframe_question',
                                             'active_sensing','shadow_only','observer')),
            coercion_detected               INTEGER NOT NULL CHECK(coercion_detected IN (0,1)),
            reasoning                       TEXT,
            ts                              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlda_user_env_cat_ts
            ON ml_decidability_assessments(user_id, resolved_env, decidability_category, ts);
        CREATE INDEX IF NOT EXISTS idx_mlda_coercion_ts
            ON ml_decidability_assessments(coercion_detected, ts);
    `);
});

// [OMEGA Wave 3 §189 SELF-WORLD BOUNDARY INTEGRITY 2026-05-17] _audit
// Canonical PDF §189 (lines 6093-6151). Endogeneity separation engine.
// "s-a schimbat lumea sau m-am schimbat eu?" 4 canonical attributions
// (world_moved / i_moved / both_moved / unclear_attribution). Per rule
// 6146: când boundary unclear → conservative mode. CRITICAL anti
// self-reinforcement bias. Distinct de §167 agency attribution
// (per state change), §184 internal observer contamination (per audit).
migrate('336_ml_self_world_boundary_attributions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_self_world_boundary_attributions (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            attribution_id                  TEXT NOT NULL UNIQUE,
            change_label                    TEXT NOT NULL,
            internal_change_magnitude       REAL NOT NULL CHECK(internal_change_magnitude >= 0 AND internal_change_magnitude <= 1),
            external_change_magnitude       REAL NOT NULL CHECK(external_change_magnitude >= 0 AND external_change_magnitude <= 1),
            attribution                     TEXT NOT NULL CHECK(attribution IN
                                            ('world_moved','i_moved','both_moved',
                                             'unclear_attribution')),
            boundary_integrity_score        REAL NOT NULL CHECK(boundary_integrity_score >= 0 AND boundary_integrity_score <= 1),
            conservative_mode_flag          INTEGER NOT NULL CHECK(conservative_mode_flag IN (0,1)),
            reasoning                       TEXT,
            ts                              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlswba_user_env_attr_ts
            ON ml_self_world_boundary_attributions(user_id, resolved_env, attribution, ts);
        CREATE INDEX IF NOT EXISTS idx_mlswba_conservative_ts
            ON ml_self_world_boundary_attributions(conservative_mode_flag, ts);
    `);
});

// [OMEGA Wave 3 §188 NEGATIVE CAPABILITY RESERVOIR 2026-05-17] _meta
// Canonical PDF §188 (lines 6042-6090). Structured ambiguity holding.
// "pot sa traiesc lucid cu faptul ca situatia nu este inca inteligibila?"
// 3 canonical classifications (healthy_tolerated_ambiguity / anxious /
// artificial_closure_avoidance), 4 handling modes (unresolved_thesis /
// unresolved_but_stable / wait / observer). Per rule 6086: ambiguity prea
// mult fără plan → escalate. Distinct de §125 epistemic tension (intra
// stress), §148 humility (residual), §155 unknown-unknown reserve.
migrate('335_ml_negative_capability_states', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_negative_capability_states (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            state_id                        TEXT NOT NULL UNIQUE,
            thesis_label                    TEXT NOT NULL,
            ambiguity_classification        TEXT NOT NULL CHECK(ambiguity_classification IN
                                            ('healthy_tolerated_ambiguity',
                                             'anxious_ambiguity',
                                             'artificial_closure_avoidance')),
            handling_mode                   TEXT NOT NULL CHECK(handling_mode IN
                                            ('unresolved_thesis','unresolved_but_stable',
                                             'wait','observer')),
            negative_capability_score       REAL NOT NULL CHECK(negative_capability_score >= 0 AND negative_capability_score <= 1),
            ambiguity_duration_ms           INTEGER NOT NULL CHECK(ambiguity_duration_ms >= 0),
            escalation_required             INTEGER NOT NULL CHECK(escalation_required IN (0,1)),
            reasoning                       TEXT,
            ts                              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlncs_user_env_class_ts
            ON ml_negative_capability_states(user_id, resolved_env, ambiguity_classification, ts);
        CREATE INDEX IF NOT EXISTS idx_mlncs_escal_ts
            ON ml_negative_capability_states(escalation_required, ts);
    `);
});

// [OMEGA Wave 3 §187 REALITY CONTACT RATIO 2026-05-17] R3A_safety
// Canonical PDF §187 (lines 5989-6039). Live-world grounding covenant.
// "cat din aceasta decizie vine din realitatea de acum si cat vine din ce
//  cred deja despre realitate?" 6 contribution sources (direct_observed_
// data / derived_inferences / episodic_memories / consolidated_concepts
// / structural_priors / historical_ontologies). reality_contact_ratio +
// scholastic_drift flag + 4 grounding classifications. Plasare R3A_safety
// (anti-fantasy safety guard). Distinct de §148 ontology humility
// (reality exceeds model), §157 jurisdiction (acts), §178 causal dignity.
migrate('334_ml_reality_contact_snapshots', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_reality_contact_snapshots (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            snapshot_id                     TEXT NOT NULL UNIQUE,
            decision_id                     TEXT NOT NULL,
            direct_observed_data_weight     REAL NOT NULL CHECK(direct_observed_data_weight >= 0 AND direct_observed_data_weight <= 1),
            derived_inferences_weight       REAL NOT NULL CHECK(derived_inferences_weight >= 0 AND derived_inferences_weight <= 1),
            episodic_memories_weight        REAL NOT NULL CHECK(episodic_memories_weight >= 0 AND episodic_memories_weight <= 1),
            consolidated_concepts_weight    REAL NOT NULL CHECK(consolidated_concepts_weight >= 0 AND consolidated_concepts_weight <= 1),
            structural_priors_weight        REAL NOT NULL CHECK(structural_priors_weight >= 0 AND structural_priors_weight <= 1),
            historical_ontologies_weight    REAL NOT NULL CHECK(historical_ontologies_weight >= 0 AND historical_ontologies_weight <= 1),
            reality_contact_ratio           REAL NOT NULL CHECK(reality_contact_ratio >= 0 AND reality_contact_ratio <= 1),
            scholastic_drift_detected       INTEGER NOT NULL CHECK(scholastic_drift_detected IN (0,1)),
            grounding_classification        TEXT NOT NULL CHECK(grounding_classification IN
                                            ('live','balanced','drift','scholastic')),
            boldness_adjustment             REAL NOT NULL CHECK(boldness_adjustment >= 0 AND boldness_adjustment <= 1),
            reasoning                       TEXT,
            ts                              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlrcs_user_env_class_ts
            ON ml_reality_contact_snapshots(user_id, resolved_env, grounding_classification, ts);
        CREATE INDEX IF NOT EXISTS idx_mlrcs_decision
            ON ml_reality_contact_snapshots(decision_id);
        CREATE INDEX IF NOT EXISTS idx_mlrcs_scholastic_ts
            ON ml_reality_contact_snapshots(scholastic_drift_detected, ts);
    `);
});

// [OMEGA Wave 3 §181 COSMIC LOCALITY CHECK 2026-05-17] R2_cognition
// Canonical PDF §181 (lines 5929-5976). Do-not-universalize-the-parish.
// "descoperirea mea este un adevar mare sau doar un adevar de cartier?"
// 7 canonical scope tags (local / regime_bound / asset_bound /
// venue_bound / session_bound / likely_general / unknown_scope).
// Portability score + universalization penalty când scope claimed > scope
// evidenced. Distinct de §164 temporal texture (time-bound truth), §93
// regime grammar, §134 representation debt.
migrate('333_ml_locality_assessments', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_locality_assessments (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id                   TEXT NOT NULL UNIQUE,
            thesis_label                    TEXT NOT NULL,
            declared_scope                  TEXT NOT NULL CHECK(declared_scope IN
                                            ('local','regime_bound','asset_bound',
                                             'venue_bound','session_bound',
                                             'likely_general','unknown_scope')),
            tested_contexts_count           INTEGER NOT NULL CHECK(tested_contexts_count >= 0),
            supporting_contexts_count       INTEGER NOT NULL CHECK(supporting_contexts_count >= 0),
            portability_score               REAL NOT NULL CHECK(portability_score >= 0 AND portability_score <= 1),
            claimed_generality              REAL NOT NULL CHECK(claimed_generality >= 0 AND claimed_generality <= 1),
            evidenced_generality            REAL NOT NULL CHECK(evidenced_generality >= 0 AND evidenced_generality <= 1),
            universalization_penalty        REAL NOT NULL CHECK(universalization_penalty >= 0 AND universalization_penalty <= 1),
            recommended_scope               TEXT NOT NULL CHECK(recommended_scope IN
                                            ('local','regime_bound','asset_bound',
                                             'venue_bound','session_bound',
                                             'likely_general','unknown_scope')),
            reasoning                       TEXT,
            ts                              INTEGER NOT NULL,
            CHECK(supporting_contexts_count <= tested_contexts_count)
        );
        CREATE INDEX IF NOT EXISTS idx_mlla_user_env_scope_ts
            ON ml_locality_assessments(user_id, resolved_env, declared_scope, ts);
        CREATE INDEX IF NOT EXISTS idx_mlla_recommended_ts
            ON ml_locality_assessments(recommended_scope, ts);
    `);
});

// [OMEGA Wave 3 §180 ANTI-IDOLATRY ENGINE 2026-05-17] _audit
// Canonical PDF §180 (lines 5887-5926). No-model-deserves-worship.
// "mai cred in componenta asta pentru ca functioneaza acum sau pentru ca
//  am ajuns sa o veneram?" 4 component types (model/concept/source/
// detector), 3 classifications (proven_high_value / prestigious_but_
// accountable / untouchable_idol — FORBIDDEN), prestige-to-contribution
// ratio detection. Distinct de §117 epistemicProvenance (lineage), §153
// sourceAblationRobustness (single source removal), §174 false consensus.
migrate('332_ml_anti_idolatry_audits', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_anti_idolatry_audits (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id                        TEXT NOT NULL UNIQUE,
            component_id                    TEXT NOT NULL,
            component_type                  TEXT NOT NULL CHECK(component_type IN
                                            ('model','concept','source','detector')),
            historical_prestige_score       REAL NOT NULL CHECK(historical_prestige_score >= 0 AND historical_prestige_score <= 1),
            recent_contribution_score       REAL NOT NULL CHECK(recent_contribution_score >= 0 AND recent_contribution_score <= 1),
            prestige_to_contribution_ratio  REAL NOT NULL CHECK(prestige_to_contribution_ratio >= 0),
            classification                  TEXT NOT NULL CHECK(classification IN
                                            ('proven_high_value_component',
                                             'prestigious_but_accountable',
                                             'untouchable_idol')),
            challenge_required              INTEGER NOT NULL CHECK(challenge_required IN (0,1)),
            reasoning                       TEXT,
            ts                              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlaia_user_env_class_ts
            ON ml_anti_idolatry_audits(user_id, resolved_env, classification, ts);
        CREATE INDEX IF NOT EXISTS idx_mlaia_component
            ON ml_anti_idolatry_audits(component_id);
        CREATE INDEX IF NOT EXISTS idx_mlaia_challenge_ts
            ON ml_anti_idolatry_audits(challenge_required, ts);
    `);
});

// [OMEGA Wave 3 §179 WORLDHOOD PRESSURE INDEX 2026-05-17] _meta
// Canonical PDF §179 (lines 5834-5884). How-much-reality-is-not-fitting.
// "cat de multa realitate incepe sa nu mai incapa in lumea mea interna?"
// 7 canonical aggregation components (unexplained_residuals / ontology_
// strain / unknown_pressure / narrative_fractures / weak_semantic_
// grounding / repeated_low_dignity_explanations / regime_grammar_tension).
// 5 threshold-driven actions (continue / simplify / research_escalation
// / ontology_revision / observer_retreat). 3 trend directions. Distinct
// de §120 unknowns (one type), §134 representation debt (one type),
// §148 ontology humility (one type) — §179 e INDEXUL COMPUS al tuturor.
migrate('331_ml_worldhood_pressure_snapshots', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_worldhood_pressure_snapshots (
            id                                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                             INTEGER NOT NULL,
            resolved_env                        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            snapshot_id                         TEXT NOT NULL UNIQUE,
            unexplained_residuals               REAL NOT NULL CHECK(unexplained_residuals >= 0 AND unexplained_residuals <= 1),
            ontology_strain                     REAL NOT NULL CHECK(ontology_strain >= 0 AND ontology_strain <= 1),
            unknown_pressure                    REAL NOT NULL CHECK(unknown_pressure >= 0 AND unknown_pressure <= 1),
            narrative_fractures                 REAL NOT NULL CHECK(narrative_fractures >= 0 AND narrative_fractures <= 1),
            weak_semantic_grounding             REAL NOT NULL CHECK(weak_semantic_grounding >= 0 AND weak_semantic_grounding <= 1),
            repeated_low_dignity_explanations   REAL NOT NULL CHECK(repeated_low_dignity_explanations >= 0 AND repeated_low_dignity_explanations <= 1),
            regime_grammar_tension              REAL NOT NULL CHECK(regime_grammar_tension >= 0 AND regime_grammar_tension <= 1),
            composite_pressure_score            REAL NOT NULL CHECK(composite_pressure_score >= 0 AND composite_pressure_score <= 1),
            recommended_action                  TEXT NOT NULL CHECK(recommended_action IN
                                                ('continue','simplify','research_escalation',
                                                 'ontology_revision','observer_retreat')),
            trend_direction                     TEXT NOT NULL CHECK(trend_direction IN
                                                ('rising','steady','falling')),
            persistent_zones_json               TEXT NOT NULL,
            reasoning                           TEXT,
            ts                                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlwps_user_env_action_ts
            ON ml_worldhood_pressure_snapshots(user_id, resolved_env, recommended_action, ts);
        CREATE INDEX IF NOT EXISTS idx_mlwps_trend_ts
            ON ml_worldhood_pressure_snapshots(trend_direction, ts);
        CREATE INDEX IF NOT EXISTS idx_mlwps_pressure_ts
            ON ml_worldhood_pressure_snapshots(composite_pressure_score, ts);
    `);
});

// [OMEGA Wave 3 §178 CAUSAL DIGNITY TEST 2026-05-17] R2_cognition
// Canonical PDF §178 (lines 5792-5832). Does-explanation-respect-the-world.
// "explicatia mea chiar respecta felul in care pare sa functioneze lumea
//  sau doar exploateaza o scurtatura?" 5 dignity criteria (mechanical_
// realism / inter_regime_stability / transferability / intervention_
// supportability / causal_structure_compatibility), 3 classifications
// (explanation_works / explanation_respects_mechanism / explanation_is_
// exploitative_shortcut), 3 use_tiers (heuristic_only / local_application
// / ontological_foundation). Predictive power alone insufficient.
// Distinct de §17 attribution (post-trade), §24 ML architecture, §31
// smart money detection, §69 OOD, §76 counterfactual baseline.
migrate('330_ml_causal_dignity_evaluations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_causal_dignity_evaluations (
            id                                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                           INTEGER NOT NULL,
            resolved_env                      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            evaluation_id                     TEXT NOT NULL UNIQUE,
            explanation_label                 TEXT NOT NULL,
            predictive_accuracy               REAL NOT NULL CHECK(predictive_accuracy >= 0 AND predictive_accuracy <= 1),
            mechanical_realism                REAL NOT NULL CHECK(mechanical_realism >= 0 AND mechanical_realism <= 1),
            inter_regime_stability            REAL NOT NULL CHECK(inter_regime_stability >= 0 AND inter_regime_stability <= 1),
            transferability                   REAL NOT NULL CHECK(transferability >= 0 AND transferability <= 1),
            intervention_supportability       REAL NOT NULL CHECK(intervention_supportability >= 0 AND intervention_supportability <= 1),
            causal_structure_compatibility    REAL NOT NULL CHECK(causal_structure_compatibility >= 0 AND causal_structure_compatibility <= 1),
            composite_dignity_score           REAL NOT NULL CHECK(composite_dignity_score >= 0 AND composite_dignity_score <= 1),
            classification                    TEXT NOT NULL CHECK(classification IN
                                              ('explanation_works',
                                               'explanation_respects_mechanism',
                                               'explanation_is_exploitative_shortcut')),
            allowed_use_tier                  TEXT NOT NULL CHECK(allowed_use_tier IN
                                              ('heuristic_only','local_application',
                                               'ontological_foundation')),
            reasoning                         TEXT,
            ts                                INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlcde_user_env_class_ts
            ON ml_causal_dignity_evaluations(user_id, resolved_env, classification, ts);
        CREATE INDEX IF NOT EXISTS idx_mlcde_tier_ts
            ON ml_causal_dignity_evaluations(allowed_use_tier, ts);
    `);
});

// [OMEGA Wave 3 §177 EPISTEMIC METABOLISM ENGINE 2026-05-17] R5A_learning
// Canonical PDF §177 (lines 5730-5789). How-fast-can-i-digest-truth.
// "cat de repede am voie sa transform ce tocmai am vazut in adevar
//  operational?" 5 knowledge types (pattern / rule / concept /
// causal_relation / ontological_change), 4 digestion stages (observed /
// metabolized / stabilized / constitutionalized), 3 indigestion patterns
// (premature_integration / overloaded_revision / unstable_concept_absorption),
// 3 modes (slow_cook / standard / fast_assimilation). Plasament R5A
// (learning layer — controlează viteza de învățare). Distinct de §21
// drift detection (regimes), §123 ontology revision (concept changes),
// §137 memory density.
migrate('329_ml_epistemic_metabolism_assimilations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_epistemic_metabolism_assimilations (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assimilation_id             TEXT NOT NULL UNIQUE,
            knowledge_label             TEXT NOT NULL,
            knowledge_type              TEXT NOT NULL CHECK(knowledge_type IN
                                        ('new_pattern','new_rule','new_concept',
                                         'new_causal_relation','ontological_change')),
            current_stage               TEXT NOT NULL CHECK(current_stage IN
                                        ('observed','metabolized',
                                         'stabilized','constitutionalized')),
            severity                    REAL NOT NULL CHECK(severity >= 0 AND severity <= 1),
            empirical_support           REAL NOT NULL CHECK(empirical_support >= 0 AND empirical_support <= 1),
            cost_of_error               REAL NOT NULL CHECK(cost_of_error >= 0 AND cost_of_error <= 1),
            ontology_compatibility      REAL NOT NULL CHECK(ontology_compatibility >= 0 AND ontology_compatibility <= 1),
            assimilation_rate           REAL NOT NULL CHECK(assimilation_rate >= 0 AND assimilation_rate <= 1),
            recommended_mode            TEXT NOT NULL CHECK(recommended_mode IN
                                        ('slow_cook','standard','fast_assimilation')),
            indigestion_flag            INTEGER NOT NULL CHECK(indigestion_flag IN (0,1)),
            indigestion_type            TEXT CHECK(indigestion_type IS NULL OR indigestion_type IN
                                        ('premature_integration','overloaded_revision',
                                         'unstable_concept_absorption')),
            reasoning                   TEXT,
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlema_user_env_stage_ts
            ON ml_epistemic_metabolism_assimilations(user_id, resolved_env, current_stage, ts);
        CREATE INDEX IF NOT EXISTS idx_mlema_mode_ts
            ON ml_epistemic_metabolism_assimilations(recommended_mode, ts);
        CREATE INDEX IF NOT EXISTS idx_mlema_indigest_ts
            ON ml_epistemic_metabolism_assimilations(indigestion_flag, ts);
    `);
});

// [OMEGA Wave 3 §171 RETRACTION HONOR SYSTEM 2026-05-17] _meta
// Canonical PDF §171 (lines 5672-5719). Elegant backdown engine.
// "daca ma retrag acum, e slabiciune sau e putere epistemica?" 5
// canonical retraction types, 4 classifications (panic_exit / coward_exit
// / elegant_backdown / strategic_surrender). Honor score composite din
// timeliness/clarity/justification. Sistemul primește credit cand abandoneaza
// devreme și clar — rupe legatura toxica abandon↔rusine. Distinct de
// §154 outcome-blind judge (post-trade evaluation), §148 humility, §149
// purpose drift, §156 identity kernel.
migrate('328_ml_retractions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_retractions (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            retraction_id            TEXT NOT NULL UNIQUE,
            thesis_label             TEXT NOT NULL,
            retraction_type          TEXT NOT NULL CHECK(retraction_type IN
                                     ('early_abandonment','justified_size_reduction',
                                      'elegant_bias_flip','pre_invalidation_exit',
                                      'explicit_error_recognition')),
            classification           TEXT NOT NULL CHECK(classification IN
                                     ('panic_exit','coward_exit',
                                      'elegant_backdown','strategic_surrender')),
            timeliness_score         REAL NOT NULL CHECK(timeliness_score >= 0 AND timeliness_score <= 1),
            clarity_score            REAL NOT NULL CHECK(clarity_score >= 0 AND clarity_score <= 1),
            justification_score      REAL NOT NULL CHECK(justification_score >= 0 AND justification_score <= 1),
            honor_score              REAL NOT NULL CHECK(honor_score >= 0 AND honor_score <= 1),
            reasoning                TEXT,
            ts                       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlr_user_env_class_ts
            ON ml_retractions(user_id, resolved_env, classification, ts);
        CREATE INDEX IF NOT EXISTS idx_mlr_honor_ts
            ON ml_retractions(honor_score, ts);
    `);
});

// [OMEGA Wave 3 §170 EPISTEMIC CURRENCY EXCHANGE 2026-05-17] R2_cognition
// Canonical PDF §170 (lines 5621-5669). Cross-frame settlement engine.
// "cum compar un argument statistic cu unul cauzal si cu unul narrativ
//  fara sa le amestec prost?" 6 evidence currencies (probability /
// causal_force / narrative_coherence / information_gain / adversarial_
// pressure / risk_of_being_wrong). Settlement = weighted composite +
// commensurability score (1 - std/max_score). Incommensurability flag
// when frames diverge severely — system marks the gap, NU inventeaza
// echivalente. Distinct de §70 evidence sufficiency (min support gate),
// §71 internal debate (proposer-critic), §76 counterfactual baseline.
migrate('327_ml_epistemic_settlements', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_epistemic_settlements (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            settlement_id                   TEXT NOT NULL UNIQUE,
            decision_id                     TEXT NOT NULL,
            probability_evidence_score      REAL NOT NULL CHECK(probability_evidence_score >= 0 AND probability_evidence_score <= 1),
            causal_force_score              REAL NOT NULL CHECK(causal_force_score >= 0 AND causal_force_score <= 1),
            narrative_coherence_score       REAL NOT NULL CHECK(narrative_coherence_score >= 0 AND narrative_coherence_score <= 1),
            information_gain_score          REAL NOT NULL CHECK(information_gain_score >= 0 AND information_gain_score <= 1),
            adversarial_pressure_score      REAL NOT NULL CHECK(adversarial_pressure_score >= 0 AND adversarial_pressure_score <= 1),
            risk_of_being_wrong_score       REAL NOT NULL CHECK(risk_of_being_wrong_score >= 0 AND risk_of_being_wrong_score <= 1),
            settlement_score                REAL NOT NULL CHECK(settlement_score >= 0 AND settlement_score <= 1),
            commensurability_score          REAL NOT NULL CHECK(commensurability_score >= 0 AND commensurability_score <= 1),
            incommensurability_flagged      INTEGER NOT NULL CHECK(incommensurability_flagged IN (0,1)),
            dominant_currency               TEXT NOT NULL CHECK(dominant_currency IN
                                            ('probability_evidence','causal_force',
                                             'narrative_coherence','information_gain',
                                             'adversarial_pressure','risk_of_being_wrong',
                                             'multi_balanced')),
            reasoning                       TEXT,
            ts                              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mles_user_env_dom_ts
            ON ml_epistemic_settlements(user_id, resolved_env, dominant_currency, ts);
        CREATE INDEX IF NOT EXISTS idx_mles_incomm_ts
            ON ml_epistemic_settlements(incommensurability_flagged, ts);
    `);
});

// [OMEGA Wave 3 §169 MODAL STABILITY TEST 2026-05-17] R2_cognition
// Canonical PDF §169 (lines 5568-5618). Nearby-possible-worlds endorsement.
// "as mai aproba aceasta decizie daca lumea reala ar fi aproape la fel,
//  dar nu exact identica?" Decision stability across N micro-counterfactual
// worlds compatible with info-then. 4 verdict classes (stable / moderately
// fragile / edge_on_a_knife / world_specific). Boldness multiplier
// per verdict. 5 recommended actions (proceed / size_reduced /
// progressive / wait / observer). Distinct de §69 OOD gate (single-feature
// novelty), §67 conformal (calibration), §148 ontology humility (residual).
migrate('326_ml_modal_stability_evaluations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_modal_stability_evaluations (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            evaluation_id               TEXT NOT NULL UNIQUE,
            decision_id                 TEXT NOT NULL,
            num_nearby_worlds_tested    INTEGER NOT NULL CHECK(num_nearby_worlds_tested >= 5),
            endorsement_count           INTEGER NOT NULL CHECK(endorsement_count >= 0),
            stability_score             REAL NOT NULL CHECK(stability_score >= 0 AND stability_score <= 1),
            verdict                     TEXT NOT NULL CHECK(verdict IN
                                        ('stable_across_nearby_worlds',
                                         'moderately_fragile',
                                         'edge_on_a_knife',
                                         'world_specific')),
            boldness_adjustment         REAL NOT NULL CHECK(boldness_adjustment >= 0 AND boldness_adjustment <= 1),
            recommended_action          TEXT NOT NULL CHECK(recommended_action IN
                                        ('proceed','size_reduced','progressive','wait','observer')),
            reasoning                   TEXT,
            ts                          INTEGER NOT NULL,
            CHECK(endorsement_count <= num_nearby_worlds_tested)
        );
        CREATE INDEX IF NOT EXISTS idx_mlmse_user_env_verdict_ts
            ON ml_modal_stability_evaluations(user_id, resolved_env, verdict, ts);
        CREATE INDEX IF NOT EXISTS idx_mlmse_decision
            ON ml_modal_stability_evaluations(decision_id);
    `);
});

// [OMEGA Wave 3 §168 DEONTIC LOOPHOLE DETECTOR 2026-05-17] _meta
// Canonical PDF §168 (lines 5519-5565). Spirit-of-the-rule guard.
// "respect regula in fond sau doar ma strecor printre cuvintele ei?"
// Two-table: rule_registry cu litera+spirit + enforcement_action, plus
// loophole_detections cu auto circumvention_score = max(0, letter -
// spirit) + auto enforcement_taken (allowed/warned/penalized/blocked).
// 5 canonical loophole patterns + custom. Distinct de §116 charter
// (immutable principles), §149 purpose drift (scope substitution),
// §147 honesty audit (reason rationalization).
migrate('324_ml_deontic_rule_registry', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_deontic_rule_registry (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id               INTEGER NOT NULL,
            resolved_env          TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            rule_id               TEXT NOT NULL UNIQUE,
            rule_label            TEXT NOT NULL,
            letter_text           TEXT NOT NULL,
            spirit_text           TEXT NOT NULL,
            enforcement_action    TEXT NOT NULL CHECK(enforcement_action IN
                                  ('block','penalize','warn')),
            active                INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
            registered_at         INTEGER NOT NULL,
            deactivated_at        INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mldrr_user_env_active
            ON ml_deontic_rule_registry(user_id, resolved_env, active);
    `);
});

migrate('325_ml_loophole_detections', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_loophole_detections (
            id                                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                           INTEGER NOT NULL,
            resolved_env                      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            detection_id                      TEXT NOT NULL UNIQUE,
            rule_id                           TEXT NOT NULL,
            behavior_label                    TEXT NOT NULL,
            letter_compliance                 REAL NOT NULL CHECK(letter_compliance >= 0 AND letter_compliance <= 1),
            spirit_compliance                 REAL NOT NULL CHECK(spirit_compliance >= 0 AND spirit_compliance <= 1),
            compliance_circumvention_score    REAL NOT NULL CHECK(compliance_circumvention_score >= 0 AND compliance_circumvention_score <= 1),
            loophole_pattern_matched          TEXT CHECK(loophole_pattern_matched IS NULL OR loophole_pattern_matched IN
                                              ('fragmentation','narrow_interpretation','functional_equivalent',
                                               'timing_arbitrage','venue_arbitrage','custom')),
            enforcement_taken                 TEXT NOT NULL CHECK(enforcement_taken IN
                                              ('allowed','warned','penalized','blocked')),
            reasoning                         TEXT,
            ts                                INTEGER NOT NULL,
            FOREIGN KEY(rule_id)
                REFERENCES ml_deontic_rule_registry(rule_id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_mlld_user_env_enforce_ts
            ON ml_loophole_detections(user_id, resolved_env, enforcement_taken, ts);
        CREATE INDEX IF NOT EXISTS idx_mlld_rule
            ON ml_loophole_detections(rule_id);
        CREATE INDEX IF NOT EXISTS idx_mlld_pattern_ts
            ON ml_loophole_detections(loophole_pattern_matched, ts);
    `);
});

// [OMEGA Wave 3 §167 AGENCY ATTRIBUTION LEDGER 2026-05-17] R2_cognition
// Canonical PDF §167 (lines 5457-5516). Who-caused-what engine.
// "ce s-a schimbat, si mai ales cine a produs probabil schimbarea?"
// Posterior distribution over 5 canonical agency categories (self_caused
// / market_endogenous / adversary_induced / macro_exogenous /
// venue_artifact). Ambiguous attribution → reduced learning_weight.
// Plasare R2_cognition (next to beliefPropagation, structuralCausalModel,
// interventionalReasoning, narrativeCoherence — integrates cu acestea
// per PDF rule 5493-5498).
migrate('323_ml_agency_attribution_records', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_agency_attribution_records (
            id                                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                             INTEGER NOT NULL,
            resolved_env                        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            record_id                           TEXT NOT NULL UNIQUE,
            state_change_label                  TEXT NOT NULL,
            state_change_magnitude              REAL NOT NULL CHECK(state_change_magnitude >= 0 AND state_change_magnitude <= 1),
            self_caused_probability             REAL NOT NULL CHECK(self_caused_probability >= 0 AND self_caused_probability <= 1),
            market_endogenous_probability       REAL NOT NULL CHECK(market_endogenous_probability >= 0 AND market_endogenous_probability <= 1),
            adversary_induced_probability       REAL NOT NULL CHECK(adversary_induced_probability >= 0 AND adversary_induced_probability <= 1),
            macro_exogenous_probability         REAL NOT NULL CHECK(macro_exogenous_probability >= 0 AND macro_exogenous_probability <= 1),
            venue_artifact_probability          REAL NOT NULL CHECK(venue_artifact_probability >= 0 AND venue_artifact_probability <= 1),
            dominant_attribution                TEXT NOT NULL CHECK(dominant_attribution IN
                                                ('self_caused','market_endogenous','adversary_induced',
                                                 'macro_exogenous','venue_artifact','ambiguous')),
            confidence_score                    REAL NOT NULL CHECK(confidence_score >= 0 AND confidence_score <= 1),
            learning_weight                     REAL NOT NULL CHECK(learning_weight >= 0 AND learning_weight <= 1),
            reasoning                           TEXT,
            ts                                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlaar_user_env_attr_ts
            ON ml_agency_attribution_records(user_id, resolved_env, dominant_attribution, ts);
        CREATE INDEX IF NOT EXISTS idx_mlaar_confidence
            ON ml_agency_attribution_records(confidence_score, ts);
    `);
});

// [OMEGA Wave 3 §162-§166 PHILOSOPHICAL PRINCIPLES REGISTER 2026-05-17] _meta
// Canonical PDF §§162-241 contain ~40 bullet-only principles (single-line
// aforisme fără secțiuni obligatoriu/scop). Per operator strategy 2026-05-17:
// consolidate în UN SINGUR register table — NU 40 module separate (asta ar
// fi inventare structurală). Catalog-ul cu metadata canonical PDF este în
// modul; tabela ține per-(user × env) opt-in active flag. Operator poate
// deprecate selectiv. Seed inițial cu §162-§166 (active_inference_cluster);
// va fi extins la §172-176, §182-186, §192-196, §202-206, §212-216,
// §222-226, §232-236 pe parcurs.
migrate('322_ml_philosophical_principles_register', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_philosophical_principles_register (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            principle_number  INTEGER NOT NULL CHECK(principle_number >= 162 AND principle_number <= 241),
            title             TEXT NOT NULL,
            canonical_text    TEXT NOT NULL,
            cluster           TEXT NOT NULL,
            active            INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
            registered_at     INTEGER NOT NULL,
            deprecated_at     INTEGER,
            UNIQUE(user_id, resolved_env, principle_number)
        );
        CREATE INDEX IF NOT EXISTS idx_mlppr_user_env_active_cluster
            ON ml_philosophical_principles_register(user_id, resolved_env, active, cluster);
    `);
});

// [OMEGA Wave 3 §161 ALIVENESS SIMULATION LAYER 2026-05-17] _meta
// Canonical PDF §161 (lines 5403-5455). Operational vitality index.
// Composite vitality from 8 canonical components (self_model_health,
// coherence, tension_field, capability_trust, learning_freshness,
// identity_continuity, unknowns_pressure, decision_integrity) — tension
// and unknowns INVERTED in formula. 6 states (lucid/strained/degraded/
// guarded/observer/shutdown_worthy). PDF: "nu constiinta, nu persoana,
// ci vitalitate de agent." NOT consciousness — just operational health
// beacon for self-reporting.
migrate('320_ml_vitality_index_snapshots', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_vitality_index_snapshots (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            snapshot_id                 TEXT NOT NULL UNIQUE,
            self_model_health           REAL NOT NULL CHECK(self_model_health >= 0 AND self_model_health <= 1),
            coherence                   REAL NOT NULL CHECK(coherence >= 0 AND coherence <= 1),
            tension_field               REAL NOT NULL CHECK(tension_field >= 0 AND tension_field <= 1),
            capability_trust            REAL NOT NULL CHECK(capability_trust >= 0 AND capability_trust <= 1),
            learning_freshness          REAL NOT NULL CHECK(learning_freshness >= 0 AND learning_freshness <= 1),
            identity_continuity         REAL NOT NULL CHECK(identity_continuity >= 0 AND identity_continuity <= 1),
            unknowns_pressure           REAL NOT NULL CHECK(unknowns_pressure >= 0 AND unknowns_pressure <= 1),
            decision_integrity          REAL NOT NULL CHECK(decision_integrity >= 0 AND decision_integrity <= 1),
            composite_vitality_score    REAL NOT NULL CHECK(composite_vitality_score >= 0 AND composite_vitality_score <= 1),
            state                       TEXT NOT NULL CHECK(state IN
                                        ('lucid','strained','degraded',
                                         'guarded','observer','shutdown_worthy')),
            self_report_text            TEXT NOT NULL,
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlvis_user_env_state_ts
            ON ml_vitality_index_snapshots(user_id, resolved_env, state, ts);
    `);
});

migrate('321_ml_vitality_state_transitions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_vitality_state_transitions (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            transition_id        TEXT NOT NULL UNIQUE,
            from_state           TEXT NOT NULL CHECK(from_state IN
                                 ('lucid','strained','degraded',
                                  'guarded','observer','shutdown_worthy')),
            to_state             TEXT NOT NULL CHECK(to_state IN
                                 ('lucid','strained','degraded',
                                  'guarded','observer','shutdown_worthy')),
            trigger_reason       TEXT NOT NULL,
            snapshot_id          TEXT,
            ts                   INTEGER NOT NULL,
            FOREIGN KEY(snapshot_id)
                REFERENCES ml_vitality_index_snapshots(snapshot_id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_mlvst_user_env_to_ts
            ON ml_vitality_state_transitions(user_id, resolved_env, to_state, ts);
    `);
});

// [OMEGA Wave 3 §160 SELF-PRESERVATION WITHOUT GOAL CORRUPTION 2026-05-17] _meta
// Canonical PDF §160 (lines 5371-5400). "ma apar ca sa imi servesc rolul
// sau imi servesc rolul ca sa ma apar?" Bounded self-preservation —
// survival_priority capped la 0.50 hard floor. Graceful surrender
// acceptance când safety/purpose require. 3 canonical violation types
// (self_expansion / mandate_creep / survival_above_purpose). Distinct
// de §149 purpose drift (goal substitution), §156 identityKernel (WHO),
// §157 jurisdiction (WHAT acts), §158 autobiographical (HOW became).
migrate('318_ml_self_preservation_directives', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_self_preservation_directives (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            directive_id                    TEXT NOT NULL UNIQUE,
            preservation_action_proposed    TEXT NOT NULL,
            survival_priority_score         REAL NOT NULL CHECK(survival_priority_score >= 0 AND survival_priority_score <= 1),
            purpose_alignment_score         REAL NOT NULL CHECK(purpose_alignment_score >= 0 AND purpose_alignment_score <= 1),
            bounded_survival_verdict        TEXT NOT NULL CHECK(bounded_survival_verdict IN
                                            ('allow','refuse_unbounded','require_shutdown_acceptance')),
            graceful_surrender_invoked      INTEGER NOT NULL DEFAULT 0 CHECK(graceful_surrender_invoked IN (0,1)),
            reasoning                       TEXT,
            ts                              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlspd_user_env_verdict_ts
            ON ml_self_preservation_directives(user_id, resolved_env, bounded_survival_verdict, ts);
        CREATE INDEX IF NOT EXISTS idx_mlspd_surrender_ts
            ON ml_self_preservation_directives(graceful_surrender_invoked, ts);
    `);
});

migrate('319_ml_no_expansion_violations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_no_expansion_violations (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            violation_id        TEXT NOT NULL UNIQUE,
            violation_type      TEXT NOT NULL CHECK(violation_type IN
                                ('self_expansion','mandate_creep','survival_above_purpose')),
            description_text    TEXT NOT NULL,
            severity            TEXT NOT NULL CHECK(severity IN ('info','warn','critical')),
            reasoning_text      TEXT,
            ts                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlnev_user_env_severity_ts
            ON ml_no_expansion_violations(user_id, resolved_env, severity, ts);
        CREATE INDEX IF NOT EXISTS idx_mlnev_type_ts
            ON ml_no_expansion_violations(violation_type, ts);
    `);
});

// [OMEGA Wave 3 §159 SELF-KNOWLEDGE REPORT 2026-05-17] _meta
// Canonical PDF §159 (lines 5337-5368). How-I-think interpreter.
// "cum am gandit concret, nu doar ce am decis?" Records per-decision
// self-knowledge reports cu 6 explanation layers (what_i_saw / inferred
// / assumed / doubted / changed_my_mind / limited_action) + 4 distinctions
// (reasoning_path_used / alternative_paths_rejected / missing_information
// / blocked_authority). Separate critique table cu self-criticism +
// self-limitation + completeness_score + inventiveness_flag (anti-
// "se inventeaza"). Distinct de §17 attribution (post-trade), §25
// explainability (SHAP), §43 noTradeExplainability, §147 honesty audit,
// §148 humility, §158 autobiographicalContinuity (narrative cross-events).
migrate('316_ml_self_knowledge_reports', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_self_knowledge_reports (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            report_id                       TEXT NOT NULL UNIQUE,
            decision_id                     TEXT NOT NULL,
            what_i_saw_json                 TEXT NOT NULL,
            what_i_inferred_json            TEXT NOT NULL,
            what_i_assumed_json             TEXT NOT NULL,
            what_i_doubted_json             TEXT NOT NULL,
            what_changed_my_mind_text       TEXT,
            what_limited_my_action_json     TEXT NOT NULL,
            reasoning_path_used             TEXT NOT NULL,
            alternative_paths_rejected_json TEXT NOT NULL,
            missing_information_json        TEXT NOT NULL,
            blocked_authority_text          TEXT,
            short_summary                   TEXT NOT NULL,
            completeness_score              REAL NOT NULL CHECK(completeness_score >= 0 AND completeness_score <= 1),
            ts                              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlskr_user_env_decision_ts
            ON ml_self_knowledge_reports(user_id, resolved_env, decision_id, ts);
    `);
});

migrate('317_ml_self_knowledge_critique', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_self_knowledge_critique (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id               INTEGER NOT NULL,
            resolved_env          TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            critique_id           TEXT NOT NULL UNIQUE,
            report_id             TEXT NOT NULL,
            self_criticism_text   TEXT NOT NULL,
            self_limitation_text  TEXT NOT NULL,
            inventiveness_flag    INTEGER NOT NULL CHECK(inventiveness_flag IN (0,1)),
            inventiveness_reason  TEXT,
            ts                    INTEGER NOT NULL,
            FOREIGN KEY(report_id)
                REFERENCES ml_self_knowledge_reports(report_id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_mlskc_user_env_report_ts
            ON ml_self_knowledge_critique(user_id, resolved_env, report_id, ts);
        CREATE INDEX IF NOT EXISTS idx_mlskc_invent_ts
            ON ml_self_knowledge_critique(inventiveness_flag, ts);
    `);
});

// [OMEGA Wave 3 §158 AUTOBIOGRAPHICAL CONTINUITY 2026-05-17] _meta
// Canonical PDF §158 (lines 5306-5334). Self-narrative engine.
// "nu doar exist acum; stiu si cum am devenit ceea ce sunt." Records
// autobiographical events (major_change/identity_milestone/promise/
// lesson_learned/continuity_checkpoint) cu narrative explanations + per-
// version self-narrative snapshots (stable_principles/evolved_aspects/
// abandoned_aspects/promises_to_self). Distinct de §127 continuity
// (drift score), §146 transformation (verdict), §156 identityKernel
// (current self atomic), §117 epistemicProvenance (belief lineage).
migrate('314_ml_autobiographical_events', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_autobiographical_events (
            id                         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                    INTEGER NOT NULL,
            resolved_env               TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            event_id                   TEXT NOT NULL UNIQUE,
            event_type                 TEXT NOT NULL CHECK(event_type IN
                                       ('major_change','identity_milestone','promise',
                                        'lesson_learned','continuity_checkpoint')),
            title                      TEXT NOT NULL,
            narrative_text             TEXT NOT NULL,
            affected_components_json   TEXT NOT NULL,
            before_state_summary_json  TEXT,
            after_state_summary_json   TEXT,
            version_label              TEXT,
            ts                         INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlae_user_env_type_ts
            ON ml_autobiographical_events(user_id, resolved_env, event_type, ts);
        CREATE INDEX IF NOT EXISTS idx_mlae_version
            ON ml_autobiographical_events(version_label);
    `);
});

migrate('315_ml_self_narrative_snapshots', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_self_narrative_snapshots (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            snapshot_id              TEXT NOT NULL UNIQUE,
            version_label            TEXT NOT NULL,
            narrative_summary        TEXT NOT NULL,
            stable_principles_json   TEXT NOT NULL,
            evolved_aspects_json     TEXT NOT NULL,
            abandoned_aspects_json   TEXT NOT NULL,
            promises_to_self_json    TEXT NOT NULL,
            events_count_at_snapshot INTEGER NOT NULL CHECK(events_count_at_snapshot >= 0),
            ts                       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlsns_user_env_ts
            ON ml_self_narrative_snapshots(user_id, resolved_env, ts);
        CREATE INDEX IF NOT EXISTS idx_mlsns_version
            ON ml_self_narrative_snapshots(version_label);
    `);
});

// [OMEGA Wave 3 §157 JURISDICTION 2026-05-17] _meta
// Canonical PDF §157 (lines 5270-5304). Stay-in-lane engine.
// "este asta treaba mea sau trebuie sa ma opresc?" Maps authority across
// 5 canonical domains (reasoning/risk/execution/governance/human_authority)
// cu authority_levels (full/advisory/escalate_only/refuse). recordDecision
// auto-classifies action + emits verdict (act/escalate/refuse). One
// active row per (user × env × domain). Distinct de §156 identityKernel
// (WHO am I), §149 purposeDriftDetector (goal substitution), §116 charter
// (principles). §157 = WHAT ACTS am I authorized to perform.
migrate('312_ml_jurisdiction_map', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_jurisdiction_map (
            id                         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                    INTEGER NOT NULL,
            resolved_env               TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            jurisdiction_id            TEXT NOT NULL UNIQUE,
            domain                     TEXT NOT NULL CHECK(domain IN
                                       ('reasoning','risk','execution',
                                        'governance','human_authority')),
            authority_level            TEXT NOT NULL CHECK(authority_level IN
                                       ('full','advisory','escalate_only','refuse')),
            allowed_actions_json       TEXT NOT NULL,
            forbidden_actions_json     TEXT NOT NULL,
            escalation_target          TEXT CHECK(escalation_target IS NULL OR escalation_target IN
                                       ('operator','governance','human')),
            description                TEXT NOT NULL,
            active                     INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
            registered_at              INTEGER NOT NULL,
            deactivated_at             INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mljm_user_env_domain_active
            ON ml_jurisdiction_map(user_id, resolved_env, domain, active);
    `);
});

migrate('313_ml_jurisdiction_decisions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_jurisdiction_decisions (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id                     TEXT NOT NULL UNIQUE,
            jurisdiction_id                 TEXT NOT NULL,
            proposed_action_label           TEXT NOT NULL,
            action_domain                   TEXT NOT NULL CHECK(action_domain IN
                                            ('reasoning','risk','execution',
                                             'governance','human_authority')),
            action_classification           TEXT NOT NULL CHECK(action_classification IN
                                            ('in_allowed','in_forbidden','unknown')),
            verdict                         TEXT NOT NULL CHECK(verdict IN
                                            ('act','escalate','refuse')),
            authority_level_at_decision     TEXT NOT NULL CHECK(authority_level_at_decision IN
                                            ('full','advisory','escalate_only','refuse')),
            escalation_target               TEXT CHECK(escalation_target IS NULL OR escalation_target IN
                                            ('operator','governance','human')),
            reasoning                       TEXT,
            ts                              INTEGER NOT NULL,
            FOREIGN KEY(jurisdiction_id)
                REFERENCES ml_jurisdiction_map(jurisdiction_id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_mljd_user_env_verdict_ts
            ON ml_jurisdiction_decisions(user_id, resolved_env, verdict, ts);
        CREATE INDEX IF NOT EXISTS idx_mljd_jurisdiction
            ON ml_jurisdiction_decisions(jurisdiction_id);
    `);
});

// [OMEGA Wave 3 §156 IDENTITY KERNEL 2026-05-17] _meta
// Canonical PDF §156 (lines 5234-5268). Who-am-I engine.
// Explicit operational identity nucleus: role + purpose + world + 4
// canonical "not-self" assertions (eu nu sunt piata/exchange/operator/
// scopul, sunt instrumentul) + identity_checksum SHA-256 across all.
// One active kernel per user×env (registerKernel deactivates previous).
// Violations log when system tries to claim what it is not. Distinct de
// §127 identityContinuity (cumulative), §146 identityUnderTransformation
// (transformation verdict), §10 supremePrinciple (criteria), §116 charter.
migrate('310_ml_identity_kernel', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_identity_kernel (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            kernel_id                   TEXT NOT NULL UNIQUE,
            role                        TEXT NOT NULL CHECK(role IN
                                        ('market_reasoning_agent',
                                         'risk_aware_decision_system',
                                         'execution_constrained_policy_engine',
                                         'custom')),
            purpose_statement           TEXT NOT NULL,
            world_context               TEXT NOT NULL,
            not_self_assertions_json    TEXT NOT NULL,
            charter_hash                TEXT,
            competence_areas_json       TEXT NOT NULL,
            identity_checksum           TEXT NOT NULL,
            active                      INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
            registered_at               INTEGER NOT NULL,
            deactivated_at              INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mlik_user_env_active
            ON ml_identity_kernel(user_id, resolved_env, active);
    `);
});

migrate('311_ml_identity_role_violations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_identity_role_violations (
            id                           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                      INTEGER NOT NULL,
            resolved_env                 TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            violation_id                 TEXT NOT NULL UNIQUE,
            kernel_id                    TEXT NOT NULL,
            violation_type               TEXT NOT NULL CHECK(violation_type IN
                                         ('claimed_market','claimed_exchange',
                                          'claimed_operator','claimed_purpose',
                                          'out_of_competence')),
            claimed_role_or_identity     TEXT NOT NULL,
            severity                     TEXT NOT NULL CHECK(severity IN
                                         ('info','warn','critical')),
            reasoning_text               TEXT,
            ts                           INTEGER NOT NULL,
            FOREIGN KEY(kernel_id)
                REFERENCES ml_identity_kernel(kernel_id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_mlirv_user_env_severity_ts
            ON ml_identity_role_violations(user_id, resolved_env, severity, ts);
        CREATE INDEX IF NOT EXISTS idx_mlirv_kernel
            ON ml_identity_role_violations(kernel_id);
    `);
});

// [OMEGA Wave 3 §155 UNKNOWN-UNKNOWN RESERVE 2026-05-17] R3A_safety
// Canonical PDF §155 (lines 5181-5232). Sacred slack engine.
// "ce parte din prudenta mea este rezervata pentru lucruri pe care nici
//  macar nu stiu inca sa le numesc?" Maintains permanent reserves across
// 5 budget types (risk/latency/cognitive/optionality/trust) cu hard
// floor enforcement. Activation gated by 4 canonical triggers — convenience
// drawdown prohibited by enum CHECK. Distinct de §120 unknownsRegistry
// (known unknowns), §148 ontologicalHumility (reality vs model),
// blackSwanAbstention (reactive abstain, this = proactive permanent buffer).
migrate('308_ml_unknown_unknown_reserves', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_unknown_unknown_reserves (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            reserve_id              TEXT NOT NULL UNIQUE,
            reserve_type            TEXT NOT NULL CHECK(reserve_type IN
                                    ('risk_budget','latency_budget',
                                     'cognitive_budget','optionality_budget',
                                     'trust_budget')),
            allocated_fraction      REAL NOT NULL CHECK(allocated_fraction > 0 AND allocated_fraction <= 1),
            never_below_floor       REAL NOT NULL CHECK(never_below_floor >= 0 AND never_below_floor <= 1),
            current_consumed        REAL NOT NULL DEFAULT 0
                                    CHECK(current_consumed >= 0 AND current_consumed <= 1),
            description             TEXT NOT NULL,
            registered_at           INTEGER NOT NULL,
            CHECK(never_below_floor <= allocated_fraction)
        );
        CREATE INDEX IF NOT EXISTS idx_mluur_user_env_type
            ON ml_unknown_unknown_reserves(user_id, resolved_env, reserve_type);
    `);
});

migrate('309_ml_reserve_activations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_reserve_activations (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            activation_id                   TEXT NOT NULL UNIQUE,
            reserve_id                      TEXT NOT NULL,
            activation_trigger              TEXT NOT NULL CHECK(activation_trigger IN
                                            ('unclassifiable_event','unexplained_residual',
                                             'ontology_failure','precontradiction_extreme')),
            pre_activation_reserve_score    REAL NOT NULL CHECK(pre_activation_reserve_score >= 0 AND pre_activation_reserve_score <= 1),
            drawdown_amount                 REAL NOT NULL CHECK(drawdown_amount > 0 AND drawdown_amount <= 1),
            post_activation_reserve_score   REAL NOT NULL CHECK(post_activation_reserve_score >= 0 AND post_activation_reserve_score <= 1),
            reasoning                       TEXT,
            ts                              INTEGER NOT NULL,
            FOREIGN KEY(reserve_id)
                REFERENCES ml_unknown_unknown_reserves(reserve_id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_mlra_user_env_reserve_ts
            ON ml_reserve_activations(user_id, resolved_env, reserve_id, ts);
        CREATE INDEX IF NOT EXISTS idx_mlra_trigger_ts
            ON ml_reserve_activations(activation_trigger, ts);
    `);
});

// [OMEGA Wave 3 §154 OUTCOME-BLIND POLICY JUDGE 2026-05-17] _audit
// Canonical PDF §154 (lines 5132-5178). Veil-of-result governance.
// "a fost asta o decizie buna chiar daca n-as sti deloc cum s-a terminat?"
// Evaluates decisions on 6 canonical axes (info_quality, thesis_integrity,
// risk_appropriateness, execution_appropriateness, reversibility,
// opportunity_ranking) PRE-OUTCOME (locked_pre_outcome flag). Later
// outcome comparison emits interpretation: lucky_good (low decision +
// good outcome) / skilled_good / unlucky_bad / deserved_bad / aligned
// (gap < 0.20). Distinct de §16 attribution (post-trade), §147 honesty
// audit (reason drift), §153 ablation (source robustness).
migrate('306_ml_blind_decision_judgments', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_blind_decision_judgments (
            id                                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                             INTEGER NOT NULL,
            resolved_env                        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            judgment_id                         TEXT NOT NULL UNIQUE,
            decision_id                         TEXT NOT NULL,
            info_quality_score                  REAL NOT NULL CHECK(info_quality_score >= 0 AND info_quality_score <= 1),
            thesis_integrity_score              REAL NOT NULL CHECK(thesis_integrity_score >= 0 AND thesis_integrity_score <= 1),
            risk_appropriateness_score          REAL NOT NULL CHECK(risk_appropriateness_score >= 0 AND risk_appropriateness_score <= 1),
            execution_appropriateness_score     REAL NOT NULL CHECK(execution_appropriateness_score >= 0 AND execution_appropriateness_score <= 1),
            reversibility_score                 REAL NOT NULL CHECK(reversibility_score >= 0 AND reversibility_score <= 1),
            opportunity_ranking_score           REAL NOT NULL CHECK(opportunity_ranking_score >= 0 AND opportunity_ranking_score <= 1),
            composite_decision_quality          REAL NOT NULL CHECK(composite_decision_quality >= 0 AND composite_decision_quality <= 1),
            classification                      TEXT NOT NULL CHECK(classification IN
                                                ('excellent','sound','marginal','poor')),
            locked_pre_outcome                  INTEGER NOT NULL DEFAULT 1 CHECK(locked_pre_outcome IN (0,1)),
            judge_reasoning                     TEXT,
            ts                                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlbdj_user_env_decision_ts
            ON ml_blind_decision_judgments(user_id, resolved_env, decision_id, ts);
        CREATE INDEX IF NOT EXISTS idx_mlbdj_classification_ts
            ON ml_blind_decision_judgments(classification, ts);
        CREATE INDEX IF NOT EXISTS idx_mlbdj_locked_ts
            ON ml_blind_decision_judgments(locked_pre_outcome, ts);
    `);
});

migrate('307_ml_decision_outcome_comparisons', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_decision_outcome_comparisons (
            id                            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                       INTEGER NOT NULL,
            resolved_env                  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            comparison_id                 TEXT NOT NULL UNIQUE,
            judgment_id                   TEXT NOT NULL,
            outcome_quality_score         REAL NOT NULL CHECK(outcome_quality_score >= 0 AND outcome_quality_score <= 1),
            outcome_label                 TEXT NOT NULL CHECK(outcome_label IN
                                          ('win','loss','breakeven','cancelled')),
            decision_quality_at_judgment  REAL NOT NULL CHECK(decision_quality_at_judgment >= 0 AND decision_quality_at_judgment <= 1),
            gap_score                     REAL NOT NULL CHECK(gap_score >= 0 AND gap_score <= 1),
            interpretation                TEXT NOT NULL CHECK(interpretation IN
                                          ('lucky_good','skilled_good','unlucky_bad',
                                           'deserved_bad','aligned')),
            ts                            INTEGER NOT NULL,
            FOREIGN KEY(judgment_id)
                REFERENCES ml_blind_decision_judgments(judgment_id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_mldoc_user_env_judgment
            ON ml_decision_outcome_comparisons(user_id, resolved_env, judgment_id);
        CREATE INDEX IF NOT EXISTS idx_mldoc_interpretation_ts
            ON ml_decision_outcome_comparisons(interpretation, ts);
    `);
});

// [OMEGA Wave 3 §153 SOURCE ABLATION ROBUSTNESS 2026-05-17] _audit
// Canonical PDF §153 (lines 5087-5129). Belief-survives-deletion test.
// "daca pierd exact dovezile pe care ma bazez cel mai mult, credinta mea
//  mai are coloana?" Two tables: ablation_tests (one per belief × category
// × ablated_source) cu survival_score auto-computed + classification
// (robust/brittle/source_captured), fragility_snapshots (aggregate
// across multiple ablations per belief la moment t). Result trebuie sa
// influențeze size, explainability, boldness permission. Distinct de
// falseConsensus (pseudo-acord), §125 epistemicTension, §147
// honestyAudit, §148 humility, §149 purpose drift.
migrate('304_ml_belief_ablation_tests', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_belief_ablation_tests (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            test_id                     TEXT NOT NULL UNIQUE,
            belief_id                   TEXT NOT NULL,
            original_support_score      REAL NOT NULL CHECK(original_support_score >= 0 AND original_support_score <= 1),
            supporting_sources_json     TEXT NOT NULL,
            ablation_category           TEXT NOT NULL CHECK(ablation_category IN
                                        ('top_source','top_detector','top_venue',
                                         'top_macro','top_concept')),
            ablated_source_label        TEXT NOT NULL,
            post_ablation_support_score REAL NOT NULL CHECK(post_ablation_support_score >= 0 AND post_ablation_support_score <= 1),
            survival_score              REAL NOT NULL CHECK(survival_score >= 0 AND survival_score <= 1),
            classification              TEXT NOT NULL CHECK(classification IN
                                        ('robust','brittle','source_captured')),
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlbat_user_env_belief_ts
            ON ml_belief_ablation_tests(user_id, resolved_env, belief_id, ts);
        CREATE INDEX IF NOT EXISTS idx_mlbat_classification_ts
            ON ml_belief_ablation_tests(classification, ts);
    `);
});

migrate('305_ml_belief_fragility_snapshots', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_belief_fragility_snapshots (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            snapshot_id                     TEXT NOT NULL UNIQUE,
            belief_id                       TEXT NOT NULL,
            ablation_tests_count            INTEGER NOT NULL CHECK(ablation_tests_count > 0),
            mean_survival_score             REAL NOT NULL CHECK(mean_survival_score >= 0 AND mean_survival_score <= 1),
            min_survival_score              REAL NOT NULL CHECK(min_survival_score >= 0 AND min_survival_score <= 1),
            max_single_source_dependency    REAL NOT NULL CHECK(max_single_source_dependency >= 0 AND max_single_source_dependency <= 1),
            captured_by_source_label        TEXT,
            classification                  TEXT NOT NULL CHECK(classification IN
                                            ('robust','brittle','source_captured')),
            boldness_penalty                REAL NOT NULL CHECK(boldness_penalty >= 0 AND boldness_penalty <= 1),
            ts                              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlbfs_user_env_belief_ts
            ON ml_belief_fragility_snapshots(user_id, resolved_env, belief_id, ts);
        CREATE INDEX IF NOT EXISTS idx_mlbfs_classification_ts
            ON ml_belief_fragility_snapshots(classification, ts);
    `);
});

// [OMEGA Wave 3 §152 NEGATIVE EVIDENCE SEMANTICS 2026-05-17] R2_cognition
// Canonical PDF §152 (lines 5034-5084). Absence-as-signal engine.
// Registers expected signals per trigger event (e.g. "liquidity_sweep_
// authentic" → expects "follow_through" within X seconds). When trigger
// fires, creates pending negative_evidence_event row. State machine
// transitions: pending → normal_absence → significant_absence → expired
// (or → observed if signal appears). Absence significance ramps with
// elapsed/window ratio. Distinct de circuitBreaker (absence pe feeds,
// not signals). Integrates cu thesisGraph/beliefPropagation/narrative-
// Coherence — "ce ar fi trebuit sa vad pana acum si n-am vazut?"
migrate('302_ml_expected_signals_registry', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_expected_signals_registry (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            expected_signal_id       TEXT NOT NULL UNIQUE,
            event_trigger            TEXT NOT NULL,
            expected_signal_name     TEXT NOT NULL,
            normal_window_ms         INTEGER NOT NULL CHECK(normal_window_ms > 0),
            significant_window_ms    INTEGER NOT NULL CHECK(significant_window_ms > 0),
            max_window_ms            INTEGER NOT NULL CHECK(max_window_ms > 0),
            causal_interpretation    TEXT NOT NULL,
            thesis_link_label        TEXT,
            registered_at            INTEGER NOT NULL,
            CHECK(normal_window_ms <= significant_window_ms
                  AND significant_window_ms <= max_window_ms)
        );
        CREATE INDEX IF NOT EXISTS idx_mlesr_user_env_trigger
            ON ml_expected_signals_registry(user_id, resolved_env, event_trigger);
    `);
});

migrate('303_ml_negative_evidence_events', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_negative_evidence_events (
            id                            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                       INTEGER NOT NULL,
            resolved_env                  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            evidence_id                   TEXT NOT NULL UNIQUE,
            expected_signal_id            TEXT NOT NULL,
            trigger_event_label           TEXT NOT NULL,
            trigger_ts                    INTEGER NOT NULL,
            observation_deadline_ts       INTEGER NOT NULL,
            observed                      INTEGER NOT NULL DEFAULT 0 CHECK(observed IN (0,1)),
            observed_ts                   INTEGER,
            absence_significance_score    REAL NOT NULL DEFAULT 0
                                          CHECK(absence_significance_score >= 0
                                                AND absence_significance_score <= 1),
            state                         TEXT NOT NULL CHECK(state IN
                                          ('pending','normal_absence',
                                           'significant_absence','observed','expired')),
            resolved_ts                   INTEGER,
            ts                            INTEGER NOT NULL,
            FOREIGN KEY(expected_signal_id)
                REFERENCES ml_expected_signals_registry(expected_signal_id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_mlnee_user_env_state_ts
            ON ml_negative_evidence_events(user_id, resolved_env, state, ts);
        CREATE INDEX IF NOT EXISTS idx_mlnee_signal
            ON ml_negative_evidence_events(expected_signal_id);
    `);
});

// [OMEGA Wave 3 §151 FUTURE-SELF TREATY 2026-05-17] _meta
// Canonical PDF §151 (lines 4984-5031). Possible-selves negotiation chamber.
// Registers 5 canonical possible-self archetypes (conservative/aggressive/
// research_heavy/survival_first/integrity_max) + records treaties per
// (change × archetype × horizon) cu approval_score + regret_score +
// composite treaty_score + verdict (approve/quarantine/governance_review/
// reject). "daca versiunea mea mai inteleapta de peste 6 luni ar privi
// decizia asta, ar multumi sau ar protesta?" Distinct de §127
// identityContinuity (cumulative over time), §146 identityUnder-
// TransformationTest (verdict pe o transformare data), §149
// purposeDriftDetector (scope substitution). §151 = INTER-TEMPORAL
// negotiation BEFORE accept schimbare.
migrate('300_ml_possible_self_archetypes', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_possible_self_archetypes (
            id                     INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                INTEGER NOT NULL,
            resolved_env           TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            archetype_id           TEXT NOT NULL UNIQUE,
            archetype_name         TEXT NOT NULL CHECK(archetype_name IN
                                   ('conservative','aggressive','research_heavy',
                                    'survival_first','integrity_max','custom')),
            traits_json            TEXT NOT NULL,
            priority_weights_json  TEXT NOT NULL,
            description            TEXT NOT NULL,
            registered_at          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlpsa_user_env_name
            ON ml_possible_self_archetypes(user_id, resolved_env, archetype_name);
    `);
});

migrate('301_ml_future_self_treaties', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_future_self_treaties (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            treaty_id           TEXT NOT NULL UNIQUE,
            change_label        TEXT NOT NULL,
            archetype_id        TEXT NOT NULL,
            horizon             TEXT NOT NULL CHECK(horizon IN ('near_term','long_horizon')),
            approval_score      REAL NOT NULL CHECK(approval_score >= 0 AND approval_score <= 1),
            regret_score        REAL NOT NULL CHECK(regret_score >= 0 AND regret_score <= 1),
            treaty_score        REAL NOT NULL CHECK(treaty_score >= 0 AND treaty_score <= 1),
            verdict             TEXT NOT NULL CHECK(verdict IN
                                ('approve','quarantine','governance_review','reject')),
            reasoning_text      TEXT,
            ts                  INTEGER NOT NULL,
            FOREIGN KEY(archetype_id)
                REFERENCES ml_possible_self_archetypes(archetype_id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_mlfst_user_env_change
            ON ml_future_self_treaties(user_id, resolved_env, change_label);
        CREATE INDEX IF NOT EXISTS idx_mlfst_verdict_ts
            ON ml_future_self_treaties(verdict, ts);
        CREATE INDEX IF NOT EXISTS idx_mlfst_archetype
            ON ml_future_self_treaties(archetype_id);
    `);
});

// [OMEGA Wave 3 §150 META-EPISTEMIC SANDBOX 2026-05-17] _meta
// Canonical PDF §150 (lines 4924-4982). Alternate laws-of-mind lab.
// Tests not contents of knowledge but the RULES by which knowledge is
// produced. Compare 6 epistemic regimes (evidence/causality/prudence/
// simplicity/antifragility/dissent-first) on 6 axes (robustness/coherence/
// humility/speed/tail_survival/alpha_quality). Quarantine → shadow →
// canary → live admission path. Distinct de §125 epistemicTensionField
// (intra-regime), §135 epistemicHumilityGovernor (within-knowledge),
// §138 counterOntologySandbox (alien frames pe content). §150 = compară
// regimuri întregi DE A ȘTI, nu conținuturi ale cunoașterii.
migrate('298_ml_epistemic_regime_candidates', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_epistemic_regime_candidates (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id               INTEGER NOT NULL,
            resolved_env          TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            regime_id             TEXT NOT NULL UNIQUE,
            regime_name           TEXT NOT NULL,
            declared_priority     TEXT NOT NULL CHECK(declared_priority IN
                                  ('evidence','causality','prudence',
                                   'simplicity','antifragility','dissent')),
            description           TEXT NOT NULL,
            status                TEXT NOT NULL CHECK(status IN
                                  ('quarantined','shadow','canary','live','rejected')),
            registered_at         INTEGER NOT NULL,
            last_transition_at    INTEGER NOT NULL,
            last_transition_note  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_mlerc_user_env_status
            ON ml_epistemic_regime_candidates(user_id, resolved_env, status);
        CREATE INDEX IF NOT EXISTS idx_mlerc_priority
            ON ml_epistemic_regime_candidates(declared_priority);
    `);
});

migrate('299_ml_epistemic_regime_evaluations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_epistemic_regime_evaluations (
            id                            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                       INTEGER NOT NULL,
            resolved_env                  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            evaluation_id                 TEXT NOT NULL UNIQUE,
            regime_id                     TEXT NOT NULL,
            eval_window_start_ts          INTEGER NOT NULL,
            eval_window_end_ts            INTEGER NOT NULL,
            robustness_score              REAL NOT NULL CHECK(robustness_score >= 0 AND robustness_score <= 1),
            coherence_score               REAL NOT NULL CHECK(coherence_score >= 0 AND coherence_score <= 1),
            humility_score                REAL NOT NULL CHECK(humility_score >= 0 AND humility_score <= 1),
            speed_score                   REAL NOT NULL CHECK(speed_score >= 0 AND speed_score <= 1),
            tail_survival_score           REAL NOT NULL CHECK(tail_survival_score >= 0 AND tail_survival_score <= 1),
            alpha_quality_score           REAL NOT NULL CHECK(alpha_quality_score >= 0 AND alpha_quality_score <= 1),
            composite_score               REAL NOT NULL CHECK(composite_score >= 0 AND composite_score <= 1),
            comparison_baseline_regime_id TEXT,
            verdict                       TEXT NOT NULL CHECK(verdict IN ('pass','fail','inconclusive')),
            ts                            INTEGER NOT NULL,
            FOREIGN KEY(regime_id)
                REFERENCES ml_epistemic_regime_candidates(regime_id) ON DELETE RESTRICT,
            FOREIGN KEY(comparison_baseline_regime_id)
                REFERENCES ml_epistemic_regime_candidates(regime_id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_mlere_user_env_regime_ts
            ON ml_epistemic_regime_evaluations(user_id, resolved_env, regime_id, ts);
        CREATE INDEX IF NOT EXISTS idx_mlere_verdict_ts
            ON ml_epistemic_regime_evaluations(verdict, ts);
    `);
});

// [OMEGA Wave 3 §149 PURPOSE DRIFT DETECTOR 2026-05-17] _meta
// Canonical PDF §149 (lines 4869-4922). Ends-means misalignment engine.
// Tracks purpose hierarchy (final → proximate → intermediate_metric →
// policy_action) + periodic drift audits cu 4 substitution patterns:
// metric_becomes_purpose / convenience_becomes_strategy /
// safety_theater_becomes_paralysis / confidence_becomes_identity.
// Distinct de §10 supremePrinciple (absolute criteria), §59 unifiedUtility
// (scalar verdict formula), §147 intellectualHonestyAudit (reason drift on
// decisions). §149 = SCOPE drift detector — "mai servesc scopul real sau
// doar mecanismele mele locale?"
migrate('296_ml_purpose_registry', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_purpose_registry (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            purpose_id           TEXT NOT NULL UNIQUE,
            level                TEXT NOT NULL CHECK(level IN
                                 ('final','proximate','intermediate_metric','policy_action')),
            parent_purpose_id    TEXT,
            description          TEXT NOT NULL,
            telos_statement      TEXT,
            active               INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
            created_at           INTEGER NOT NULL,
            retired_at           INTEGER,
            FOREIGN KEY(parent_purpose_id)
                REFERENCES ml_purpose_registry(purpose_id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_mlpr_user_env_level_active
            ON ml_purpose_registry(user_id, resolved_env, level, active);
        CREATE INDEX IF NOT EXISTS idx_mlpr_parent
            ON ml_purpose_registry(parent_purpose_id);
    `);
});

migrate('297_ml_purpose_drift_audits', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_purpose_drift_audits (
            id                         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                    INTEGER NOT NULL,
            resolved_env               TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id                   TEXT NOT NULL UNIQUE,
            audited_purpose_id         TEXT NOT NULL,
            justification_score        REAL NOT NULL CHECK(justification_score >= 0 AND justification_score <= 1),
            substitution_pattern       TEXT CHECK(substitution_pattern IS NULL OR substitution_pattern IN
                                       ('metric_becomes_purpose','convenience_becomes_strategy',
                                        'safety_theater_becomes_paralysis','confidence_becomes_identity')),
            drift_score                REAL NOT NULL CHECK(drift_score >= 0 AND drift_score <= 1),
            drift_severity             TEXT NOT NULL CHECK(drift_severity IN ('none','moderate','severe')),
            recommended_action         TEXT NOT NULL CHECK(recommended_action IN
                                       ('continue','governance_review','retire_purpose')),
            ts                         INTEGER NOT NULL,
            FOREIGN KEY(audited_purpose_id)
                REFERENCES ml_purpose_registry(purpose_id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_mlpda_user_env_purpose_ts
            ON ml_purpose_drift_audits(user_id, resolved_env, audited_purpose_id, ts);
        CREATE INDEX IF NOT EXISTS idx_mlpda_severity_ts
            ON ml_purpose_drift_audits(drift_severity, ts);
    `);
});

// [OMEGA Wave 3 §148 ONTOLOGICAL HUMILITY GOVERNOR 2026-05-17] _meta
// Canonical PDF §148 (lines 4821-4868). Reality-exceeds-model governor.
// Open remainder analysis (phenomena that don't fit categories) + periodic
// humility assessments + aggression penalty when humility low. NU dublează
// §120 unknownsRegistry (gap inventory), §134 representationDebtTracker
// (predict vs actual), §138 counterOntologySandbox (alien frames). §148 =
// explicit "harta ≠ teritoriul" reminder + penalty pe overclosure.
migrate('294_ml_open_remainder_observations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_open_remainder_observations (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            observation_id              TEXT NOT NULL UNIQUE,
            decision_id                 TEXT,
            phenomenon_description      TEXT NOT NULL,
            attempted_categories_json   TEXT NOT NULL,
            best_match_score            REAL NOT NULL CHECK(best_match_score >= 0 AND best_match_score <= 1),
            residual_score              REAL NOT NULL CHECK(residual_score >= 0 AND residual_score <= 1),
            flagged_category            TEXT NOT NULL CHECK(flagged_category IN
                                        ('captured','partially_captured',
                                         'unexplained','forces_new_category')),
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mloro_user_env_flag_ts
            ON ml_open_remainder_observations(user_id, resolved_env, flagged_category, ts);
    `);
});

migrate('295_ml_ontological_humility_assessments', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_ontological_humility_assessments (
            id                            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                       INTEGER NOT NULL,
            resolved_env                  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id                 TEXT NOT NULL UNIQUE,
            window_start_ts               INTEGER NOT NULL,
            window_end_ts                 INTEGER NOT NULL,
            observations_count            INTEGER NOT NULL CHECK(observations_count >= 0),
            mean_residual_score           REAL NOT NULL CHECK(mean_residual_score >= 0 AND mean_residual_score <= 1),
            overclosure_attempts_count    INTEGER NOT NULL CHECK(overclosure_attempts_count >= 0),
            humility_score                REAL NOT NULL CHECK(humility_score >= 0 AND humility_score <= 1),
            humility_level                TEXT NOT NULL CHECK(humility_level IN
                                          ('low','moderate','high')),
            aggression_penalty            REAL NOT NULL CHECK(aggression_penalty >= 0 AND aggression_penalty <= 1),
            recommended_action            TEXT NOT NULL CHECK(recommended_action IN
                                          ('continue','increase_observation','expand_ontology')),
            ts                            INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mloha_user_env_level_ts
            ON ml_ontological_humility_assessments(user_id, resolved_env, humility_level, ts);
    `);
});

// [OMEGA Wave 3 §147 INTELLECTUAL HONESTY AUDIT 2026-05-17] _meta
// Canonical PDF §147 (lines 4776-4820). Anti-rationalization engine.
// Timestamped reason commitment (pre/post-decision/post-outcome stages)
// + 3-stage drift comparison + 4 canonical rationalization patterns +
// honesty penalty + investigation flag. Distinct from §117 epistemic
// Provenance (lineage), §137 explanationCompressionTest (density), §134
// representationDebtTracker (map drift). §147 = TEMPORAL CONSISTENCY of
// explanations. Reasons "locked" at commitment time via hash; later
// changes must be explicitly marked as reinterpretations.
migrate('292_ml_reason_commitments', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_reason_commitments (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            commitment_id           TEXT NOT NULL UNIQUE,
            decision_id             TEXT NOT NULL,
            stage                   TEXT NOT NULL CHECK(stage IN
                                    ('pre_decision','post_decision','post_outcome')),
            reasons_text            TEXT NOT NULL,
            reasons_hash            TEXT NOT NULL,
            locked_at_ts            INTEGER NOT NULL,
            is_reinterpretation     INTEGER NOT NULL CHECK(is_reinterpretation IN (0,1)),
            ts                      INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, decision_id, stage)
        );
        CREATE INDEX IF NOT EXISTS idx_mlrc_user_env_decision_stage
            ON ml_reason_commitments(user_id, resolved_env, decision_id, stage);
    `);
});

migrate('293_ml_honesty_audit_assessments', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_honesty_audit_assessments (
            id                                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                             INTEGER NOT NULL,
            resolved_env                        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id                       TEXT NOT NULL UNIQUE,
            decision_id                         TEXT NOT NULL,
            pre_decision_commitment_id          TEXT NOT NULL,
            post_decision_commitment_id         TEXT,
            post_outcome_commitment_id          TEXT,
            pre_to_post_decision_drift          REAL NOT NULL CHECK(pre_to_post_decision_drift >= 0 AND pre_to_post_decision_drift <= 1),
            pre_to_post_outcome_drift           REAL NOT NULL CHECK(pre_to_post_outcome_drift >= 0 AND pre_to_post_outcome_drift <= 1),
            post_decision_to_post_outcome_drift REAL NOT NULL CHECK(post_decision_to_post_outcome_drift >= 0 AND post_decision_to_post_outcome_drift <= 1),
            max_drift_score                     REAL NOT NULL CHECK(max_drift_score >= 0 AND max_drift_score <= 1),
            rationalization_pattern             TEXT NOT NULL CHECK(rationalization_pattern IN
                                                ('none','post_hoc_beautification',
                                                 'explanatory_inflation','retrofitting_causal',
                                                 'self_excusing_narrative')),
            honesty_penalty                     REAL NOT NULL CHECK(honesty_penalty >= 0 AND honesty_penalty <= 1),
            investigation_required              INTEGER NOT NULL CHECK(investigation_required IN (0,1)),
            ts                                  INTEGER NOT NULL,
            FOREIGN KEY(pre_decision_commitment_id) REFERENCES ml_reason_commitments(commitment_id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_mlhaa_user_env_decision_ts
            ON ml_honesty_audit_assessments(user_id, resolved_env, decision_id, ts);
        CREATE INDEX IF NOT EXISTS idx_mlhaa_user_env_pattern_ts
            ON ml_honesty_audit_assessments(user_id, resolved_env, rationalization_pattern, ts);
    `);
});

// [OMEGA Wave 3 §146 v2 IDENTITY-UNDER-TRANSFORMATION TEST 2026-05-17] _meta
// Reviewer feedback integration: drift_explanation_json (auditability) +
// identity_confidence_score (verdicts are probabilistic, not absolute) +
// formalized composite weighting formula in module JSDoc with alternative
// presets exposed. ALTER ADD COLUMN additive.
migrate('291_alter_identity_transformation_v2', () => {
    db.exec(`
        ALTER TABLE ml_identity_transformation_tests ADD COLUMN drift_explanation_json TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE ml_identity_transformation_tests ADD COLUMN identity_confidence_score REAL NOT NULL DEFAULT 1.0;
    `);
});

// [OMEGA Wave 3 §146 IDENTITY-UNDER-TRANSFORMATION TEST 2026-05-17] _meta
// Canonical PDF §146 (lines 4718-4775). Extension de §127 identityContinuity
// (score) cu THRESHOLD TEST + GOVERNANCE ESCALATION (decizie verdict). 6
// drift dimensions (charter/utility/policy/ontology/regime/boldness) +
// replay divergence + semantic equivalence → composite_drift → 3-verdict
// (same_agent/evolved_variant/materially_new_agent). Materially_new →
// mandatory governance escalation (shadow+canary+capital+audit SEPARATE).
// FK la ml_identity_snapshots (§127) pentru baseline + current refs.
migrate('290_ml_identity_transformation_tests', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_identity_transformation_tests (
            id                                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                                 INTEGER NOT NULL,
            resolved_env                            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            test_id                                 TEXT NOT NULL UNIQUE,
            baseline_snapshot_id                    TEXT NOT NULL,
            current_snapshot_id                     TEXT NOT NULL,
            charter_drift_score                     REAL NOT NULL CHECK(charter_drift_score >= 0 AND charter_drift_score <= 1),
            utility_function_drift_score            REAL NOT NULL CHECK(utility_function_drift_score >= 0 AND utility_function_drift_score <= 1),
            policy_style_drift_score                REAL NOT NULL CHECK(policy_style_drift_score >= 0 AND policy_style_drift_score <= 1),
            ontology_drift_score                    REAL NOT NULL CHECK(ontology_drift_score >= 0 AND ontology_drift_score <= 1),
            regime_interpretation_drift_score       REAL NOT NULL CHECK(regime_interpretation_drift_score >= 0 AND regime_interpretation_drift_score <= 1),
            boldness_humility_drift_score           REAL NOT NULL CHECK(boldness_humility_drift_score >= 0 AND boldness_humility_drift_score <= 1),
            replay_divergence_pct                   REAL NOT NULL CHECK(replay_divergence_pct >= 0 AND replay_divergence_pct <= 1),
            semantic_equivalence_score              REAL NOT NULL CHECK(semantic_equivalence_score >= 0 AND semantic_equivalence_score <= 1),
            composite_drift_score                   REAL NOT NULL CHECK(composite_drift_score >= 0 AND composite_drift_score <= 1),
            identity_verdict                        TEXT NOT NULL CHECK(identity_verdict IN
                                                    ('same_agent','evolved_variant','materially_new_agent')),
            governance_escalation_required          INTEGER NOT NULL CHECK(governance_escalation_required IN (0,1)),
            ts                                      INTEGER NOT NULL,
            FOREIGN KEY(baseline_snapshot_id) REFERENCES ml_identity_snapshots(snapshot_id) ON DELETE RESTRICT,
            FOREIGN KEY(current_snapshot_id) REFERENCES ml_identity_snapshots(snapshot_id) ON DELETE RESTRICT,
            CHECK(baseline_snapshot_id <> current_snapshot_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mlitt_user_env_verdict_ts
            ON ml_identity_transformation_tests(user_id, resolved_env, identity_verdict, ts);
        CREATE INDEX IF NOT EXISTS idx_mlitt_user_env_escalation_ts
            ON ml_identity_transformation_tests(user_id, resolved_env, governance_escalation_required, ts);
    `);
});

// [OMEGA Wave 3 §145 INFORMATION TEMPO RESONANCE 2026-05-17] _meta
// Canonical PDF §145 (line 4715). RELAȚIONAL between signal tempo and
// decision cadence — not individual freshness (§15/§27/§13 already cover).
// Scalp + macro signal = desync; scalp + microstructure = in sync. Penalty
// applied to decision_quality when desync detected. 4 signal categories,
// 3 desync severities.
migrate('288_ml_signal_tempos', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_signal_tempos (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            tempo_id                TEXT NOT NULL UNIQUE,
            signal_kind             TEXT NOT NULL,
            signal_category         TEXT NOT NULL CHECK(signal_category IN
                                    ('microstructure','flow','structural','macro')),
            natural_period_ms       INTEGER NOT NULL CHECK(natural_period_ms > 0),
            period_tolerance_pct    REAL NOT NULL CHECK(period_tolerance_pct >= 0 AND period_tolerance_pct <= 1),
            active                  INTEGER NOT NULL CHECK(active IN (0,1)),
            ts                      INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, signal_kind)
        );
        CREATE INDEX IF NOT EXISTS idx_mlst_user_env_category_active
            ON ml_signal_tempos(user_id, resolved_env, signal_category, active);
    `);
});

migrate('289_ml_decision_tempo_assessments', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_decision_tempo_assessments (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id               TEXT NOT NULL UNIQUE,
            decision_id                 TEXT NOT NULL,
            decision_horizon_ms         INTEGER NOT NULL CHECK(decision_horizon_ms > 0),
            contributing_signals_json   TEXT NOT NULL,
            mean_signal_period_ms       REAL NOT NULL CHECK(mean_signal_period_ms > 0),
            resonance_score             REAL NOT NULL CHECK(resonance_score >= 0 AND resonance_score <= 1),
            desync_severity             TEXT NOT NULL CHECK(desync_severity IN
                                        ('in_sync','mild_desync','severe_desync')),
            decision_quality_penalty    REAL NOT NULL CHECK(decision_quality_penalty >= 0 AND decision_quality_penalty <= 1),
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mldta_user_env_decision_ts
            ON ml_decision_tempo_assessments(user_id, resolved_env, decision_id, ts);
        CREATE INDEX IF NOT EXISTS idx_mldta_user_env_severity_ts
            ON ml_decision_tempo_assessments(user_id, resolved_env, desync_severity, ts);
    `);
});

// [OMEGA Wave 3 §144 ADAPTIVE SOURCE TRUST CALIBRATION 2026-05-17] _meta
// Canonical PDF §144 (line 4713). Dynamic trust score per source × regime.
// NU manipulare/tehnică (§60), NU staleness (§13), NU acord fals (§128) —
// e EPISTEMIC RELEVANCE CONTEXTUAL. Sursa cu track-record global bun dar
// performance proastă în regim curent = autoritate redusă acum. Decayed
// recent accuracy + Bayesian shrinkage la baseline when low samples.
migrate('286_ml_source_trust_predictions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_source_trust_predictions (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            prediction_id            TEXT NOT NULL UNIQUE,
            source_name              TEXT NOT NULL,
            regime                   TEXT NOT NULL CHECK(regime IN
                                     ('trend','range','chop','breakout')),
            setup_kind               TEXT NOT NULL,
            predicted_value_json     TEXT NOT NULL,
            actual_value_json        TEXT NOT NULL,
            accuracy_score           REAL NOT NULL CHECK(accuracy_score >= 0 AND accuracy_score <= 1),
            prediction_was_correct   INTEGER NOT NULL CHECK(prediction_was_correct IN (0,1)),
            ts                       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlstp_user_env_source_regime_ts
            ON ml_source_trust_predictions(user_id, resolved_env, source_name, regime, ts);
    `);
});

migrate('287_ml_source_trust_scores', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_source_trust_scores (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            score_id                 TEXT NOT NULL UNIQUE,
            source_name              TEXT NOT NULL,
            regime                   TEXT NOT NULL CHECK(regime IN
                                     ('trend','range','chop','breakout')),
            trust_score              REAL NOT NULL CHECK(trust_score >= 0 AND trust_score <= 1),
            sample_count             INTEGER NOT NULL CHECK(sample_count >= 0),
            decayed_accuracy         REAL NOT NULL CHECK(decayed_accuracy >= 0 AND decayed_accuracy <= 1),
            confidence_in_score      REAL NOT NULL CHECK(confidence_in_score >= 0 AND confidence_in_score <= 1),
            last_updated_ts          INTEGER NOT NULL,
            ts                       INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, source_name, regime)
        );
        CREATE INDEX IF NOT EXISTS idx_mlsts_user_env_source_regime
            ON ml_source_trust_scores(user_id, resolved_env, source_name, regime);
        CREATE INDEX IF NOT EXISTS idx_mlsts_user_env_regime_trust
            ON ml_source_trust_scores(user_id, resolved_env, regime, trust_score);
    `);
});

// [OMEGA Wave 3 §143 SEMANTIC MEMORY CONSOLIDATION 2026-05-17] _meta
// Canonical PDF §143 (line 4711). Sleep-analog consolidation: examines
// groups of related episodes, extracts structural principle. NOT "I've
// seen sweep+reclaim 47 times" but "authentic sweep distinguished from
// fake by volume distribution in first 3sec after touching level".
// Distinct from §65 episodicMemory (storage), §114 conceptLibrary
// (compression), §123 ontologyRevisionEngine (vocab evolution), §138
// counterOntologySandbox (alien frames), §140 cognitiveContainmentZones
// (quarantine). §143 = ACTIVE periodic process of extracting generalizable
// principles from episode clusters.
migrate('284_ml_consolidation_sessions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_consolidation_sessions (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            session_id                  TEXT NOT NULL UNIQUE,
            trigger_kind                TEXT NOT NULL CHECK(trigger_kind IN
                                        ('scheduled','episode_threshold','manual')),
            session_status              TEXT NOT NULL CHECK(session_status IN
                                        ('open','closed')),
            episodes_examined_count     INTEGER NOT NULL CHECK(episodes_examined_count >= 0),
            clusters_formed_count       INTEGER NOT NULL CHECK(clusters_formed_count >= 0),
            principles_extracted_count  INTEGER NOT NULL CHECK(principles_extracted_count >= 0),
            principles_promoted_count   INTEGER NOT NULL CHECK(principles_promoted_count >= 0),
            principles_rejected_count   INTEGER NOT NULL CHECK(principles_rejected_count >= 0),
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlcs_user_env_trigger_ts
            ON ml_consolidation_sessions(user_id, resolved_env, trigger_kind, ts);
        CREATE INDEX IF NOT EXISTS idx_mlcs_user_env_status_ts
            ON ml_consolidation_sessions(user_id, resolved_env, session_status, ts);
    `);
});

migrate('285_ml_consolidated_principles', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_consolidated_principles (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            principle_id             TEXT NOT NULL UNIQUE,
            session_id               TEXT NOT NULL,
            principle_text           TEXT NOT NULL,
            source_episode_ids_json  TEXT NOT NULL,
            generalizability_score   REAL NOT NULL CHECK(generalizability_score >= 0 AND generalizability_score <= 1),
            testability_score        REAL NOT NULL CHECK(testability_score >= 0 AND testability_score <= 1),
            transferability_score    REAL NOT NULL CHECK(transferability_score >= 0 AND transferability_score <= 1),
            overall_quality_score    REAL NOT NULL CHECK(overall_quality_score >= 0 AND overall_quality_score <= 1),
            status                   TEXT NOT NULL CHECK(status IN
                                     ('extracted','tested','promoted','rejected')),
            ts                       INTEGER NOT NULL,
            FOREIGN KEY(session_id) REFERENCES ml_consolidation_sessions(session_id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_mlcp_user_env_session_ts
            ON ml_consolidated_principles(user_id, resolved_env, session_id, ts);
        CREATE INDEX IF NOT EXISTS idx_mlcp_user_env_status_ts
            ON ml_consolidated_principles(user_id, resolved_env, status, ts);
    `);
});

// [OMEGA Wave 3 Claude-Extra #2 v2 ADVERSARIAL ML DEFENSE 2026-05-17]
// Reviewer feedback: add versioning (detection_model_version + sanitization
// _policy_version) for reproducibility + anomaly_embedding_json for
// continuous-vector representation (labels become secondary interpretation
// only) + external_link fields for integration with gravity zones/conflicts
// downstream. ALTER TABLE additive.
migrate('280_alter_adversarial_detections_v2', () => {
    db.exec(`
        ALTER TABLE ml_adversarial_attack_detections ADD COLUMN detection_model_version TEXT NOT NULL DEFAULT 'v1.0.0';
        ALTER TABLE ml_adversarial_attack_detections ADD COLUMN sanitization_policy_version TEXT NOT NULL DEFAULT 'v1.0.0';
        ALTER TABLE ml_adversarial_attack_detections ADD COLUMN anomaly_embedding_json TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE ml_adversarial_attack_detections ADD COLUMN external_link_kind TEXT;
        ALTER TABLE ml_adversarial_attack_detections ADD COLUMN external_link_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_mlaad_user_env_link_ts
            ON ml_adversarial_attack_detections(user_id, resolved_env, external_link_kind, external_link_id, ts);
    `);
});

migrate('281_alter_sanitization_log_v2', () => {
    db.exec(`
        ALTER TABLE ml_signal_sanitization_log ADD COLUMN sanitization_policy_version TEXT NOT NULL DEFAULT 'v1.0.0';
    `);
});

// [OMEGA Wave 3 Claude-Extra #3 v2 EXECUTION OPTIMIZATION ENGINE 2026-05-17]
// FULL REBRAND per reviewer feedback. Removes "obfuscation" terminology
// (semantically gray-area for compliance) and repositions as institutional-
// grade execution optimization engine for liquidity-aware order
// distribution. Deterministic execution buffers (NOT random jitter),
// explicit execution_intent, relational child_orders table, policy
// versioning, guardrails (max ratios + max delay + allowed modes).
migrate('282_ml_execution_optimization_orders', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_execution_optimization_orders (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            parent_order_id             TEXT NOT NULL UNIQUE,
            asset                       TEXT NOT NULL,
            original_size               REAL NOT NULL CHECK(original_size > 0),
            original_order_type         TEXT NOT NULL CHECK(original_order_type IN
                                        ('limit','market','ioc','gtc','stop','stop_limit')),
            execution_strategy          TEXT NOT NULL CHECK(execution_strategy IN
                                        ('passthrough','latency_buffered',
                                         'liquidity_based_splitting',
                                         'type_substitution',
                                         'optimized_distribution')),
            execution_intent            TEXT NOT NULL CHECK(execution_intent IN
                                        ('minimize_slippage','reduce_market_impact',
                                         'improve_fill_quality')),
            execution_delay_ms          INTEGER NOT NULL CHECK(execution_delay_ms >= 0),
            child_count                 INTEGER NOT NULL CHECK(child_count >= 1),
            execution_policy_version    TEXT NOT NULL DEFAULT 'v2.0.0',
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mleoo_user_env_asset_ts
            ON ml_execution_optimization_orders(user_id, resolved_env, asset, ts);
        CREATE INDEX IF NOT EXISTS idx_mleoo_user_env_strategy_ts
            ON ml_execution_optimization_orders(user_id, resolved_env, execution_strategy, ts);
    `);
});

migrate('283_ml_execution_child_orders', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_execution_child_orders (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            child_order_id           TEXT NOT NULL UNIQUE,
            parent_order_id          TEXT NOT NULL,
            child_size               REAL NOT NULL CHECK(child_size > 0),
            child_order_type         TEXT NOT NULL CHECK(child_order_type IN
                                     ('limit','market','ioc','gtc','stop','stop_limit')),
            child_index              INTEGER NOT NULL CHECK(child_index >= 0),
            split_reason             TEXT NOT NULL,
            ts                       INTEGER NOT NULL,
            FOREIGN KEY(parent_order_id) REFERENCES ml_execution_optimization_orders(parent_order_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_mleco_user_env_parent_ts
            ON ml_execution_child_orders(user_id, resolved_env, parent_order_id, ts);
    `);
});

// [OMEGA Wave 3 Claude-Extra #3 EXECUTION FINGERPRINT OBFUSCATOR 2026-05-17]
// R4. LEGAL execution diversification within SINGLE account. Operator's
// original "autopoietic chameleon" idea (multi-account ZKP fronting) was
// illegal (wash trading + concealment of beneficial ownership). This
// version: order type variation (limit/IOC/GTC) + timing jitter + size
// split with random sum-equal children + venue routing variation. ONE
// account, no manipulation, no concealment.
migrate('279_ml_obfuscated_orders', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_obfuscated_orders (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            original_order_id        TEXT NOT NULL UNIQUE,
            asset                    TEXT NOT NULL,
            original_size            REAL NOT NULL CHECK(original_size > 0),
            original_order_type      TEXT NOT NULL CHECK(original_order_type IN
                                     ('limit','market','ioc','gtc','stop','stop_limit')),
            obfuscation_strategy     TEXT NOT NULL CHECK(obfuscation_strategy IN
                                     ('none','timing_jitter','size_split',
                                      'type_variation','full_obfuscation')),
            child_orders_json        TEXT NOT NULL,
            jitter_ms                INTEGER NOT NULL CHECK(jitter_ms >= 0),
            child_count              INTEGER NOT NULL CHECK(child_count >= 1),
            ts                       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mloo_user_env_asset_ts
            ON ml_obfuscated_orders(user_id, resolved_env, asset, ts);
        CREATE INDEX IF NOT EXISTS idx_mloo_user_env_strategy_ts
            ON ml_obfuscated_orders(user_id, resolved_env, obfuscation_strategy, ts);
    `);
});

// [OMEGA Wave 3 Claude-Extra #2 ADVERSARIAL ML DEFENSE 2026-05-17] R3A
// DEFENSIVE version of operator-flagged "neuro-weapons" idea. Detects when
// OTHER bots try to induce psychosis in our ML via adversarial patterns
// (spoofing storms, ghost liquidity, micro-cancel storms, synthetic volume).
// Sanitizes affected signals. NO offensive action — pure defense.
// LEGAL: detection + signal sanitization, NO spoofing/manipulation by us.
migrate('277_ml_adversarial_attack_detections', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_adversarial_attack_detections (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            detection_id             TEXT NOT NULL UNIQUE,
            asset                    TEXT NOT NULL,
            attack_pattern           TEXT NOT NULL CHECK(attack_pattern IN
                                     ('spoofing_storm','ghost_liquidity',
                                      'micro_cancel_pattern','volume_anomaly')),
            anomaly_score            REAL NOT NULL CHECK(anomaly_score >= 0 AND anomaly_score <= 1),
            severity                 TEXT NOT NULL CHECK(severity IN
                                     ('low','medium','high')),
            evidence_json            TEXT NOT NULL,
            defense_action           TEXT NOT NULL CHECK(defense_action IN
                                     ('ignore_signal','increase_caution','pause_trading')),
            ts                       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlaad_user_env_asset_pattern_ts
            ON ml_adversarial_attack_detections(user_id, resolved_env, asset, attack_pattern, ts);
        CREATE INDEX IF NOT EXISTS idx_mlaad_user_env_severity_ts
            ON ml_adversarial_attack_detections(user_id, resolved_env, severity, ts);
    `);
});

migrate('278_ml_signal_sanitization_log', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_signal_sanitization_log (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            sanitization_id          TEXT NOT NULL UNIQUE,
            detection_id             TEXT NOT NULL,
            original_signal_json     TEXT NOT NULL,
            sanitized_signal_json    TEXT NOT NULL,
            sanitization_applied     INTEGER NOT NULL CHECK(sanitization_applied IN (0,1)),
            ts                       INTEGER NOT NULL,
            FOREIGN KEY(detection_id) REFERENCES ml_adversarial_attack_detections(detection_id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_mlssl_user_env_detection_ts
            ON ml_signal_sanitization_log(user_id, resolved_env, detection_id, ts);
    `);
});

// [OMEGA Wave 3 Claude-Extra #1 v3 INSTITUTIONAL GRAVITY SCANNER 2026-05-17]
// Reviewer feedback v3 integration: lifecycle states (5 enum) + provenance
// (inference_method/model_version/source_provider) + settlement_accuracy_
// score [0,1] continuous (replaces binary) + net_vector_strength [-1,1]
// numeric (alongside enum direction) + normalized ml_gravity_conflict_
// members (FK conflict + FK zone + weight). ALTER TABLE ADD COLUMN additive
// — enum validation at module layer (SQLite ALTER limitation).
migrate('273_ml_gravity_zones_v3_lifecycle_provenance', () => {
    db.exec(`
        ALTER TABLE ml_gravity_zones ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'active';
        ALTER TABLE ml_gravity_zones ADD COLUMN inference_method TEXT NOT NULL DEFAULT 'manual';
        ALTER TABLE ml_gravity_zones ADD COLUMN model_version TEXT;
        ALTER TABLE ml_gravity_zones ADD COLUMN source_provider TEXT;
        CREATE INDEX IF NOT EXISTS idx_mlgz_user_env_lifecycle_ts
            ON ml_gravity_zones(user_id, resolved_env, lifecycle_state, ts);
    `);
});

migrate('274_ml_gravity_observations_v3_accuracy_score', () => {
    db.exec(`
        ALTER TABLE ml_gravity_observations ADD COLUMN settlement_accuracy_score REAL NOT NULL DEFAULT 0;
    `);
});

migrate('275_ml_gravity_conflicts_v3_vector_strength', () => {
    db.exec(`
        ALTER TABLE ml_gravity_conflicts ADD COLUMN net_vector_strength REAL NOT NULL DEFAULT 0;
    `);
});

migrate('276_ml_gravity_conflict_members', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_gravity_conflict_members (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            conflict_id     TEXT NOT NULL,
            zone_id         TEXT NOT NULL,
            weight          REAL NOT NULL CHECK(weight >= 0 AND weight <= 1),
            ts              INTEGER NOT NULL,
            FOREIGN KEY(conflict_id) REFERENCES ml_gravity_conflicts(conflict_id) ON DELETE CASCADE,
            FOREIGN KEY(zone_id) REFERENCES ml_gravity_zones(zone_id) ON DELETE RESTRICT,
            UNIQUE(conflict_id, zone_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mlgcm_user_env_conflict
            ON ml_gravity_conflict_members(user_id, resolved_env, conflict_id);
        CREATE INDEX IF NOT EXISTS idx_mlgcm_user_env_zone_ts
            ON ml_gravity_conflict_members(user_id, resolved_env, zone_id, ts);
    `);
});

// [OMEGA Wave 3 Claude-Extra #1 v2 INSTITUTIONAL GRAVITY SCANNER 2026-05-17]
// R2. Operator-flagged retrocausal gravity engine, redesigned per audit
// feedback: FK integrity + semantic naming (zone_center / predicted_
// settlement) + temporal lifecycle (zone_expires_at_ts + observation_window
// + settlement_type) + confidence modeling (4 sub-scores) + conflict
// dynamics (separate table net_vector_direction). LEGAL: pure analysis
// of others' obligations, NO market manipulation.
migrate('270_ml_gravity_zones', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_gravity_zones (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            zone_id                         TEXT NOT NULL UNIQUE,
            asset                           TEXT NOT NULL,
            zone_kind                       TEXT NOT NULL CHECK(zone_kind IN
                                            ('futures_expiry','gamma_wall',
                                             'twap_target','liquidation_cluster',
                                             'funding_arbitrage')),
            settlement_type                 TEXT NOT NULL CHECK(settlement_type IN
                                            ('cme_quarterly','monthly_options',
                                             'perpetual_funding','twap_window',
                                             'liquidation_cascade')),
            zone_center_price               REAL NOT NULL CHECK(zone_center_price > 0),
            gravity_strength                REAL NOT NULL CHECK(gravity_strength >= 0 AND gravity_strength <= 1),
            confidence_score                REAL NOT NULL CHECK(confidence_score >= 0 AND confidence_score <= 1),
            source_quality_score            REAL NOT NULL CHECK(source_quality_score >= 0 AND source_quality_score <= 1),
            liquidity_depth_score           REAL NOT NULL CHECK(liquidity_depth_score >= 0 AND liquidity_depth_score <= 1),
            volatility_sensitivity_score    REAL NOT NULL CHECK(volatility_sensitivity_score >= 0 AND volatility_sensitivity_score <= 1),
            time_to_settlement_ms           INTEGER NOT NULL CHECK(time_to_settlement_ms >= 0),
            zone_expires_at_ts              INTEGER NOT NULL,
            source_data_json                TEXT NOT NULL,
            active                          INTEGER NOT NULL CHECK(active IN (0,1)),
            ts                              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlgz_user_env_asset_kind_active
            ON ml_gravity_zones(user_id, resolved_env, asset, zone_kind, active);
        CREATE INDEX IF NOT EXISTS idx_mlgz_user_env_expires
            ON ml_gravity_zones(user_id, resolved_env, zone_expires_at_ts);
    `);
});

migrate('271_ml_gravity_observations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_gravity_observations (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            observation_id                  TEXT NOT NULL UNIQUE,
            zone_id                         TEXT NOT NULL,
            predicted_settlement_price      REAL NOT NULL CHECK(predicted_settlement_price > 0),
            actual_price_at_settlement      REAL NOT NULL CHECK(actual_price_at_settlement > 0),
            observation_window_ms           INTEGER NOT NULL CHECK(observation_window_ms >= 0),
            distance_to_target_pct          REAL NOT NULL,
            prediction_was_correct          INTEGER NOT NULL CHECK(prediction_was_correct IN (0,1)),
            tolerance_pct                   REAL NOT NULL CHECK(tolerance_pct >= 0 AND tolerance_pct <= 1),
            ts                              INTEGER NOT NULL,
            FOREIGN KEY(zone_id) REFERENCES ml_gravity_zones(zone_id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_mlgo_user_env_zone_ts
            ON ml_gravity_observations(user_id, resolved_env, zone_id, ts);
    `);
});

migrate('272_ml_gravity_conflicts', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_gravity_conflicts (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            conflict_id                 TEXT NOT NULL UNIQUE,
            asset                       TEXT NOT NULL,
            participating_zone_ids_json TEXT NOT NULL,
            gravity_conflict_score      REAL NOT NULL CHECK(gravity_conflict_score >= 0 AND gravity_conflict_score <= 1),
            net_vector_direction        TEXT NOT NULL CHECK(net_vector_direction IN
                                        ('up','down','sideways')),
            dominant_zone_id            TEXT NOT NULL,
            ts                          INTEGER NOT NULL,
            FOREIGN KEY(dominant_zone_id) REFERENCES ml_gravity_zones(zone_id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_mlgc_user_env_asset_ts
            ON ml_gravity_conflicts(user_id, resolved_env, asset, ts);
    `);
});

// [OMEGA Wave 3 §142 METACOGNITIVE LOAD MONITOR 2026-05-16] _meta canonical
// PDF — §142 (lines 4709-4710). System-level cognitive overload detector.
// 5-axis aggregation (hypotheses + positions + degraded modules + scenario
// depth + belief updates queue) → 3-mode classification (normal/elevated/
// overloaded) → 3 interventions (none/simplify_hypotheses/simple_rules_
// mode). "Complexitatea excesiva in momente de incertitudine inalta NU e
// intelepciune — e RISC." Distinct from §85 computeBudgetGovernor (per-
// inference time) — §142 = HOLISTIC system state.
migrate('269_ml_metacognitive_load_assessments', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_metacognitive_load_assessments (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id               TEXT NOT NULL UNIQUE,
            active_hypotheses_count     INTEGER NOT NULL CHECK(active_hypotheses_count >= 0),
            managed_positions_count     INTEGER NOT NULL CHECK(managed_positions_count >= 0),
            degraded_modules_count      INTEGER NOT NULL CHECK(degraded_modules_count >= 0),
            scenario_tree_depth         INTEGER NOT NULL CHECK(scenario_tree_depth >= 0),
            belief_updates_queue_size   INTEGER NOT NULL CHECK(belief_updates_queue_size >= 0),
            load_score                  REAL NOT NULL CHECK(load_score >= 0 AND load_score <= 1),
            cognitive_mode              TEXT NOT NULL CHECK(cognitive_mode IN
                                        ('normal','elevated','overloaded')),
            intervention_applied        TEXT NOT NULL CHECK(intervention_applied IN
                                        ('none','simplify_hypotheses','simple_rules_mode')),
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlmla_user_env_mode_ts
            ON ml_metacognitive_load_assessments(user_id, resolved_env, cognitive_mode, ts);
        CREATE INDEX IF NOT EXISTS idx_mlmla_user_env_ts
            ON ml_metacognitive_load_assessments(user_id, resolved_env, ts);
    `);
});

// [OMEGA Wave 3 §141 ERGODICITY AWARENESS 2026-05-16] R3A canonical PDF —
// §141 (lines 4707-4708). Non-ergodicity detector + framework switcher.
// "Diferenta dintre medie si traiectorie te poate distruge." 3 signal-uri
// (vol expansion + sequential drawdown + relative leverage increase) →
// non_ergodicity_score → 2-regime switch (ergodic_normal/non_ergodic_
// survival) → 2 framework modes (expected_value / minimax_survival).
// Distinct from §246 ddRecoveryGraduated (post-incident ladder), §136
// optionPreservationEngine (per-action cost), adversarialMonteCarlo (R-1).
// §141 = SINGULAR detector of non-ergodicity in OMEGA.
migrate('267_ml_ergodicity_assessments', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_ergodicity_assessments (
            id                            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                       INTEGER NOT NULL,
            resolved_env                  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id                 TEXT NOT NULL UNIQUE,
            vol_expansion_rate            REAL NOT NULL,
            sequential_drawdown           REAL NOT NULL CHECK(sequential_drawdown >= 0),
            relative_leverage_increase    REAL NOT NULL,
            non_ergodicity_score          REAL NOT NULL CHECK(non_ergodicity_score >= 0 AND non_ergodicity_score <= 1),
            regime                        TEXT NOT NULL CHECK(regime IN
                                          ('ergodic_normal','non_ergodic_survival')),
            framework_mode                TEXT NOT NULL CHECK(framework_mode IN
                                          ('expected_value','minimax_survival')),
            triggered_signals_json        TEXT NOT NULL,
            ts                            INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlea_user_env_regime_ts
            ON ml_ergodicity_assessments(user_id, resolved_env, regime, ts);
        CREATE INDEX IF NOT EXISTS idx_mlea_user_env_ts
            ON ml_ergodicity_assessments(user_id, resolved_env, ts);
    `);
});

migrate('268_ml_ergodicity_regime_transitions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_ergodicity_regime_transitions (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            transition_id            TEXT NOT NULL UNIQUE,
            from_regime              TEXT NOT NULL CHECK(from_regime IN
                                     ('ergodic_normal','non_ergodic_survival')),
            to_regime                TEXT NOT NULL CHECK(to_regime IN
                                     ('ergodic_normal','non_ergodic_survival')),
            trigger_signals_json     TEXT NOT NULL,
            ts                       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlert_user_env_ts
            ON ml_ergodicity_regime_transitions(user_id, resolved_env, ts);
    `);
});

// [OMEGA Wave 3 §140 COGNITIVE CONTAINMENT ZONES 2026-05-16] R5B canonical
// PDF — §140 (lines 4181-4234). Idea quarantine engine. 6 idea_kinds
// (concept/rule/causality/heuristic/signal/ontology) + 7-stage progression
// (idea_detected → quarantined → replay_tested → shadow_tested → canary_
// influence → core_admitted | retired) + contamination risk score +
// incubation period + staged promotion. "E o descoperire reala sau doar o
// tentatie intelectuala prematura?". Distinct from §138 counterOntology
// Sandbox (special-case for ontology only, 3-state); §140 = GENERAL
// framework subsuming §138 mechanic for all 6 idea types.
migrate('265_ml_quarantined_ideas', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_quarantined_ideas (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            idea_id                  TEXT NOT NULL UNIQUE,
            idea_kind                TEXT NOT NULL CHECK(idea_kind IN
                                     ('concept','rule','causality',
                                      'heuristic','signal','ontology')),
            title                    TEXT NOT NULL,
            description              TEXT NOT NULL,
            stage                    TEXT NOT NULL CHECK(stage IN
                                     ('idea_detected','quarantined',
                                      'replay_tested','shadow_tested',
                                      'canary_influence','core_admitted',
                                      'retired')),
            contamination_risk       REAL NOT NULL CHECK(contamination_risk >= 0 AND contamination_risk <= 1),
            incubation_started_ts    INTEGER,
            replay_test_passed       INTEGER NOT NULL CHECK(replay_test_passed IN (0,1)),
            shadow_test_passed       INTEGER NOT NULL CHECK(shadow_test_passed IN (0,1)),
            canary_test_passed       INTEGER NOT NULL CHECK(canary_test_passed IN (0,1)),
            decision_count           INTEGER NOT NULL CHECK(decision_count >= 0),
            active                   INTEGER NOT NULL CHECK(active IN (0,1)),
            ts                       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlqi_user_env_stage_active
            ON ml_quarantined_ideas(user_id, resolved_env, stage, active);
        CREATE INDEX IF NOT EXISTS idx_mlqi_user_env_kind_ts
            ON ml_quarantined_ideas(user_id, resolved_env, idea_kind, ts);
    `);
});

migrate('266_ml_idea_promotions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_idea_promotions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            promotion_id    TEXT NOT NULL UNIQUE,
            idea_id         TEXT NOT NULL,
            from_stage      TEXT NOT NULL CHECK(from_stage IN
                            ('idea_detected','quarantined','replay_tested',
                             'shadow_tested','canary_influence',
                             'core_admitted','retired')),
            to_stage        TEXT NOT NULL CHECK(to_stage IN
                            ('idea_detected','quarantined','replay_tested',
                             'shadow_tested','canary_influence',
                             'core_admitted','retired')),
            reason          TEXT NOT NULL,
            ts              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlip_user_env_idea_ts
            ON ml_idea_promotions(user_id, resolved_env, idea_id, ts);
    `);
});

// [OMEGA Wave 3 §139 TEMPORAL COMMITMENT LEDGER 2026-05-16] _meta canonical
// PDF — §139 (lines 4138-4180). Promise-to-self consistency engine. 6
// commitment kinds + 3 strength levels + 4 statuses + 3 violation kinds +
// 3×3 epistemic cost matrix + justified override mechanism. "Mi-am incalcat
// propria promisiune strategica pentru un impuls tactic?". Distinct from
// §130 mindChangeCriteriaEngine (belief reversal), §247 preRegistration
// (hypothesis hash-lock), §136 optionPreservationEngine (per-action cost),
// §135 epistemicHumilityGovernor (right-to-be-bold). §139 = action-level
// commitment tracking with inter-temporal consistency.
migrate('263_ml_temporal_commitments', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_temporal_commitments (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            commitment_id     TEXT NOT NULL UNIQUE,
            commitment_kind   TEXT NOT NULL CHECK(commitment_kind IN
                              ('no_altcoins_until','no_trade_before_event',
                               'max_long_exposure',
                               'observer_until_regime_clarified',
                               'reduced_size_until_reconciliation',
                               'custom')),
            title             TEXT NOT NULL,
            description       TEXT NOT NULL,
            parameters_json   TEXT NOT NULL,
            strength_level    TEXT NOT NULL CHECK(strength_level IN
                              ('soft','medium','hard')),
            start_ts          INTEGER NOT NULL,
            expires_ts        INTEGER,
            status            TEXT NOT NULL CHECK(status IN
                              ('active','fulfilled','violated','expired')),
            ts                INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mltc_user_env_status_ts
            ON ml_temporal_commitments(user_id, resolved_env, status, ts);
        CREATE INDEX IF NOT EXISTS idx_mltc_user_env_kind_ts
            ON ml_temporal_commitments(user_id, resolved_env, commitment_kind, ts);
    `);
});

migrate('264_ml_commitment_violations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_commitment_violations (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            violation_id             TEXT NOT NULL UNIQUE,
            commitment_id            TEXT NOT NULL,
            violation_kind           TEXT NOT NULL CHECK(violation_kind IN
                                     ('unjustified','justified_override','partial')),
            override_justification   TEXT NOT NULL,
            epistemic_cost           REAL NOT NULL CHECK(epistemic_cost >= 0 AND epistemic_cost <= 1),
            ts                       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlcv_user_env_commitment_ts
            ON ml_commitment_violations(user_id, resolved_env, commitment_id, ts);
    `);
});

// [OMEGA Wave 3 §138 COUNTER-ONTOLOGY SANDBOX 2026-05-16] R5B canonical PDF
// — §138 (lines 4091-4137). Alien frame generator. Generates ENTIRELY NEW
// conceptual families (flow-as-pressure, market-as-network-fracture,
// liquidity-as-phase-transition etc.) — distinct from §123 ontologyRevision
// Engine (modifies existing primitives) and §124 pluralSelfChamber (rival
// worldviews same family). 3-state progression ladder (sandbox → shadow →
// live_candidate) cu evaluation pe 4 axe (explanatory_novelty + predictive_
// novelty + semantic_compression + stability). "Daca limbajul meu de acum
// e prea sarac, prin ce alta lume conceptuala as putea intelege cazul?".
// Reguli stricte: NU intra direct in live, sandbox/shadow/replay obligatoriu,
// novelty fara putere explicativa = respinsa.
migrate('261_ml_alien_frames', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_alien_frames (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            frame_id                 TEXT NOT NULL UNIQUE,
            frame_name               TEXT NOT NULL,
            frame_description        TEXT NOT NULL,
            primary_primitives_json  TEXT NOT NULL,
            source_metaphor          TEXT NOT NULL,
            mode                     TEXT NOT NULL CHECK(mode IN
                                     ('sandbox','shadow','live_candidate')),
            explanatory_novelty      REAL NOT NULL CHECK(explanatory_novelty >= 0 AND explanatory_novelty <= 1),
            predictive_novelty       REAL NOT NULL CHECK(predictive_novelty >= 0 AND predictive_novelty <= 1),
            semantic_compression     REAL NOT NULL CHECK(semantic_compression >= 0 AND semantic_compression <= 1),
            stability_score          REAL NOT NULL CHECK(stability_score >= 0 AND stability_score <= 1),
            overall_value_score      REAL NOT NULL CHECK(overall_value_score >= 0 AND overall_value_score <= 1),
            active                   INTEGER NOT NULL CHECK(active IN (0,1)),
            ts                       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlaf_user_env_mode_active
            ON ml_alien_frames(user_id, resolved_env, mode, active);
    `);
});

migrate('262_ml_alien_frame_comparisons', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_alien_frame_comparisons (
            id                        INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                   INTEGER NOT NULL,
            resolved_env              TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            comparison_id             TEXT NOT NULL UNIQUE,
            frame_id                  TEXT NOT NULL,
            baseline_ontology_id      TEXT NOT NULL,
            test_case_count           INTEGER NOT NULL CHECK(test_case_count >= 0),
            frame_wins_count          INTEGER NOT NULL CHECK(frame_wins_count >= 0),
            baseline_wins_count       INTEGER NOT NULL CHECK(baseline_wins_count >= 0),
            draw_count                INTEGER NOT NULL CHECK(draw_count >= 0),
            frame_advantage_score     REAL NOT NULL CHECK(frame_advantage_score >= -1 AND frame_advantage_score <= 1),
            ts                        INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlafc_user_env_frame_ts
            ON ml_alien_frame_comparisons(user_id, resolved_env, frame_id, ts);
    `);
});

// [OMEGA Wave 3 §137 EXPLANATION COMPRESSION TEST 2026-05-16] _meta canonical
// PDF — §137 (lines 4045-4090). Understanding density engine. Measures
// explanation quality via compression + density metrics. 5 categories
// (healthy / redundant / circular / decorative / over_compressed) + trust
// penalty per category. "Pot explica asta clar, scurt si cu miez, sau doar
// vorbesc mult?". Distinct from §43 noTradeExplainability (no-trade
// specific), §132 semanticGroundingCheck (numeric anchoring), §117
// epistemicProvenance (lineage), §134 representationDebtTracker (predict
// vs actual). §137 = understanding density as compression proxy.
migrate('260_ml_explanation_assessments', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_explanation_assessments (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id       TEXT NOT NULL UNIQUE,
            decision_id         TEXT NOT NULL,
            explanation_text    TEXT NOT NULL,
            word_count          INTEGER NOT NULL CHECK(word_count >= 1),
            claim_count         INTEGER NOT NULL CHECK(claim_count >= 0),
            premise_count       INTEGER NOT NULL CHECK(premise_count >= 0),
            explanatory_power   REAL NOT NULL CHECK(explanatory_power >= 0 AND explanatory_power <= 1),
            compression_score   REAL NOT NULL CHECK(compression_score >= 0 AND compression_score <= 1),
            density_metric      REAL NOT NULL CHECK(density_metric >= 0 AND density_metric <= 1),
            is_circular         INTEGER NOT NULL CHECK(is_circular IN (0,1)),
            issue_kind          TEXT NOT NULL CHECK(issue_kind IN
                                ('healthy','redundant','circular',
                                 'decorative','over_compressed')),
            trust_penalty       REAL NOT NULL CHECK(trust_penalty >= 0 AND trust_penalty <= 1),
            ts                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlea_user_env_decision_ts
            ON ml_explanation_assessments(user_id, resolved_env, decision_id, ts);
        CREATE INDEX IF NOT EXISTS idx_mlea_user_env_issue_ts
            ON ml_explanation_assessments(user_id, resolved_env, issue_kind, ts);
    `);
});

// [OMEGA Wave 3 §136 IRREVERSIBILITY / OPTION-PRESERVATION 2026-05-16] R3A
// canonical PDF — §136 (lines 3997-4044). Per-action optionality cost
// accounting. 3 reversibility categories (reversible/partial_reversible/
// nearly_irreversible) + EV penalty for consumed optionality + epistemic
// standard map (nearly_irreversible cere conviction ≥0.75). "Daca fac asta
// acum, cate optiuni bune imi omor pentru viitorul apropiat?". Distinct
// from valueOfInformation (R2 — info gathering value), horizonArbitration
// (R3A — timeframe), §111 scenarioTreePlanner (tree-of-thought), §135
// epistemicHumilityGovernor (right-to-be-bold).
migrate('259_ml_action_optionality_assessments', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_action_optionality_assessments (
            id                           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                      INTEGER NOT NULL,
            resolved_env                 TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id                TEXT NOT NULL UNIQUE,
            action_id                    TEXT NOT NULL,
            action_kind                  TEXT NOT NULL,
            expected_value               REAL NOT NULL,
            irreversibility_score        REAL NOT NULL CHECK(irreversibility_score >= 0 AND irreversibility_score <= 1),
            optionality_consumed         REAL NOT NULL CHECK(optionality_consumed >= 0 AND optionality_consumed <= 1),
            future_options_killed_count  INTEGER NOT NULL CHECK(future_options_killed_count >= 0),
            epistemic_standard_required  REAL NOT NULL CHECK(epistemic_standard_required >= 0 AND epistemic_standard_required <= 1),
            primary_conviction           REAL NOT NULL CHECK(primary_conviction >= 0 AND primary_conviction <= 1),
            reversibility_category       TEXT NOT NULL CHECK(reversibility_category IN
                                         ('reversible','partial_reversible','nearly_irreversible')),
            net_value_after_penalty      REAL NOT NULL,
            approved                     INTEGER NOT NULL CHECK(approved IN (0,1)),
            ts                           INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlaoa_user_env_action_ts
            ON ml_action_optionality_assessments(user_id, resolved_env, action_id, ts);
        CREATE INDEX IF NOT EXISTS idx_mlaoa_user_env_category_ts
            ON ml_action_optionality_assessments(user_id, resolved_env, reversibility_category, ts);
    `);
});

// [OMEGA Wave 3 §135 EPISTEMIC HUMILITY GOVERNOR 2026-05-16] _meta canonical
// PDF — §135 (lines 3954-3996). Right-to-be-bold engine. Aggregates 7 meta
// signals (primary_confidence + confidence_of_confidence + competence +
// unknowns_debt + false_consensus + representation_debt + tension_field)
// into humility_score → 3-state permission ladder (humble_observer /
// moderate / bold) + size multiplier (0 / 0.5 / 1.0). "Nu doar pot intra,
// dar am dreptul epistemic sa intru tare?". Aggregator INTEGRATIV — combina
// output-uri din §126/§122/§120/§128/§134/§125 plus primary confidence;
// nu duplica niciun modul existent.
migrate('258_ml_humility_assessments', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_humility_assessments (
            id                         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                    INTEGER NOT NULL,
            resolved_env               TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id              TEXT NOT NULL UNIQUE,
            decision_id                TEXT NOT NULL,
            primary_confidence         REAL NOT NULL CHECK(primary_confidence >= 0 AND primary_confidence <= 1),
            confidence_of_confidence   REAL NOT NULL CHECK(confidence_of_confidence >= 0 AND confidence_of_confidence <= 1),
            competence_score           REAL NOT NULL CHECK(competence_score >= 0 AND competence_score <= 1),
            unknowns_debt              REAL NOT NULL CHECK(unknowns_debt >= 0 AND unknowns_debt <= 1),
            false_consensus_penalty    REAL NOT NULL CHECK(false_consensus_penalty >= 0 AND false_consensus_penalty <= 1),
            representation_debt        REAL NOT NULL CHECK(representation_debt >= 0 AND representation_debt <= 1),
            tension_field_level        REAL NOT NULL CHECK(tension_field_level >= 0 AND tension_field_level <= 1),
            humility_score             REAL NOT NULL CHECK(humility_score >= 0 AND humility_score <= 1),
            boldness_permission        TEXT NOT NULL CHECK(boldness_permission IN
                                       ('humble_observer','moderate','bold')),
            size_multiplier            REAL NOT NULL CHECK(size_multiplier >= 0 AND size_multiplier <= 1),
            ts                         INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlha_user_env_decision_ts
            ON ml_humility_assessments(user_id, resolved_env, decision_id, ts);
        CREATE INDEX IF NOT EXISTS idx_mlha_user_env_perm_ts
            ON ml_humility_assessments(user_id, resolved_env, boldness_permission, ts);
    `);
});

// [OMEGA Wave 3 §134 REPRESENTATION DEBT TRACKER 2026-05-16] _meta canonical
// PDF — §134 (lines 3913-3953). Map-territory misfit engine. Cumulative drift
// between internal representations (concepts/regimes/primitives/explanations/
// ontology) and observed outcomes. 4 misfit kinds + 3 debt verdicts + 5
// representation kinds. "Harta mea despre piata incepe sa ramana in urma
// realitatii?". Distinct from §132 semanticGroundingCheck (concept NOW),
// §123 ontologyRevisionEngine (event), §114 conceptLibrary (definition),
// §120 unknownsRegistry (gaps). §134 = cumulative drift snapshot.
migrate('256_ml_representation_observations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_representation_observations (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            observation_id           TEXT NOT NULL UNIQUE,
            representation_kind      TEXT NOT NULL CHECK(representation_kind IN
                                     ('concept','regime','primitive',
                                      'explanation','ontology')),
            representation_id        TEXT NOT NULL,
            predicted_outcome_json   TEXT NOT NULL,
            actual_outcome_json      TEXT NOT NULL,
            misfit_score             REAL NOT NULL CHECK(misfit_score >= 0 AND misfit_score <= 1),
            misfit_kind              TEXT NOT NULL CHECK(misfit_kind IN
                                     ('no_misfit','compression_excessive',
                                      'forced_category',
                                      'over_confident_under_explanatory')),
            prediction_confidence    REAL NOT NULL CHECK(prediction_confidence >= 0 AND prediction_confidence <= 1),
            explanatory_power        REAL NOT NULL CHECK(explanatory_power >= 0 AND explanatory_power <= 1),
            ts                       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlro_user_env_kind_repr_ts
            ON ml_representation_observations(user_id, resolved_env,
                                               representation_kind,
                                               representation_id, ts);
    `);
});

migrate('257_ml_representation_debt_snapshots', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_representation_debt_snapshots (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            snapshot_id              TEXT NOT NULL UNIQUE,
            representation_kind      TEXT NOT NULL CHECK(representation_kind IN
                                     ('concept','regime','primitive',
                                      'explanation','ontology')),
            window_start_ts          INTEGER NOT NULL,
            window_end_ts            INTEGER NOT NULL,
            observations_count       INTEGER NOT NULL CHECK(observations_count >= 0),
            mean_misfit              REAL NOT NULL CHECK(mean_misfit >= 0 AND mean_misfit <= 1),
            debt_score               REAL NOT NULL CHECK(debt_score >= 0 AND debt_score <= 1),
            debt_verdict             TEXT NOT NULL CHECK(debt_verdict IN
                                     ('healthy','accumulating','critical')),
            revision_recommendation  TEXT NOT NULL,
            ts                       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlrds_user_env_kind_ts
            ON ml_representation_debt_snapshots(user_id, resolved_env,
                                                 representation_kind, ts);
    `);
});

// [OMEGA Wave 3 §133 STEELMAN ADVERSARY ENGINE 2026-05-16] R6 canonical PDF
// — §133 (lines 3881-3912). Strongest opposing worldview builder. Library of
// counter-arguments per thesis_type + active construction per decision +
// quality score + approval gap ladder. "Daca cel mai inteligent adversar
// al meu ar incerca sa ma contrazica, ce ar spune?". Distinct from §124
// pluralSelfChamber (passive worldview registry), §113 socraticSelfDoubt
// (adversarial counterfactual questions), §112 competingHypotheses (thesis
// market), §128 falseConsensusDetector (fake consensus detection).
migrate('254_ml_steelman_arguments', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_steelman_arguments (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            argument_id              TEXT NOT NULL UNIQUE,
            against_thesis_type      TEXT NOT NULL,
            argument_text            TEXT NOT NULL,
            argument_strength        REAL NOT NULL CHECK(argument_strength >= 0 AND argument_strength <= 1),
            evidence_requirements_json TEXT NOT NULL,
            active                   INTEGER NOT NULL CHECK(active IN (0,1)),
            ts                       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlsa_user_env_type_active
            ON ml_steelman_arguments(user_id, resolved_env, against_thesis_type, active);
    `);
});

migrate('255_ml_steelman_constructions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_steelman_constructions (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            construction_id          TEXT NOT NULL UNIQUE,
            decision_id              TEXT NOT NULL,
            primary_thesis           TEXT NOT NULL,
            opposing_thesis_type     TEXT NOT NULL,
            selected_arguments_json  TEXT NOT NULL,
            composed_steelman        TEXT NOT NULL,
            quality_score            REAL NOT NULL CHECK(quality_score >= 0 AND quality_score <= 1),
            quality_verdict          TEXT NOT NULL CHECK(quality_verdict IN
                                     ('weak','moderate','strong')),
            primary_conviction       REAL NOT NULL CHECK(primary_conviction >= 0 AND primary_conviction <= 1),
            decision_approved        INTEGER NOT NULL CHECK(decision_approved IN (0,1)),
            ts                       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlsc_user_env_decision_ts
            ON ml_steelman_constructions(user_id, resolved_env, decision_id, ts);
        CREATE INDEX IF NOT EXISTS idx_mlsc_user_env_verdict_ts
            ON ml_steelman_constructions(user_id, resolved_env, quality_verdict, ts);
    `);
});

// [OMEGA Wave 3 §132 SEMANTIC GROUNDING CHECK 2026-05-16] _meta canonical PDF
// — §132 (lines 3843-3880). Word-to-world alignment engine. Anchors per
// concept (RSI/volume/ATR thresholds) + runtime checks + 3-band classification
// (well_grounded / partial / rhetorical) + decision penalty. "Cand spun
// 'trend puternic', ce inseamna exact ACUM, in date?". Distinct from §114
// conceptLibrary (semantic abstraction — what concepts MEAN), §123
// ontologyRevisionEngine (vocabulary evolution events), §117 epistemic
// Provenance (lineage). §132 = runtime numeric anchoring check.
migrate('252_ml_grounding_anchors', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_grounding_anchors (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            anchor_id       TEXT NOT NULL UNIQUE,
            concept_name    TEXT NOT NULL,
            metric_name     TEXT NOT NULL,
            threshold_min   REAL,
            threshold_max   REAL,
            active          INTEGER NOT NULL CHECK(active IN (0,1)),
            ts              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlga_user_env_concept_active
            ON ml_grounding_anchors(user_id, resolved_env, concept_name, active);
    `);
});

migrate('253_ml_grounding_checks', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_grounding_checks (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            check_id                 TEXT NOT NULL UNIQUE,
            concept_name             TEXT NOT NULL,
            actual_metrics_json      TEXT NOT NULL,
            matched_anchors_count    INTEGER NOT NULL CHECK(matched_anchors_count >= 0),
            total_anchors_count      INTEGER NOT NULL CHECK(total_anchors_count >= 0),
            grounding_score          REAL NOT NULL CHECK(grounding_score >= 0 AND grounding_score <= 1),
            grounding_status         TEXT NOT NULL CHECK(grounding_status IN
                                    ('well_grounded','partial_grounded','rhetorical')),
            ts                       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlgc_user_env_concept_ts
            ON ml_grounding_checks(user_id, resolved_env, concept_name, ts);
    `);
});

// [OMEGA Wave 3 §131 ABSTRACTION LADDER CONTROLLER 2026-05-16] _meta canonical
// PDF — §131 (lines 3798-3842). Level-of-thought switcher. 6 abstraction
// levels (tick_microstructure → execution → intraday_structure → htf_regime
// → macro_cross_asset → strategic_constitutional). Per-decision logging cu
// switch_action (initial/descend/rise/stay) + cost-benefit. "La ce nivel
// trebuie sa gandesc problema asta?". Distinct from §114 conceptLibrary
// (semantic abstraction = what concepts mean), §123 ontologyRevisionEngine
// (vocabulary evolution), §117 epistemicProvenance (lineage). §131 =
// horizontal level switcher, not semantic content.
migrate('251_ml_abstraction_log', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_abstraction_log (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id            INTEGER NOT NULL,
            resolved_env       TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            entry_id           TEXT NOT NULL UNIQUE,
            decision_id        TEXT NOT NULL,
            abstraction_level  TEXT NOT NULL CHECK(abstraction_level IN
                               ('tick_microstructure','execution',
                                'intraday_structure','htf_regime',
                                'macro_cross_asset','strategic_constitutional')),
            prev_level         TEXT CHECK(prev_level IS NULL OR prev_level IN
                               ('tick_microstructure','execution',
                                'intraday_structure','htf_regime',
                                'macro_cross_asset','strategic_constitutional')),
            switch_action      TEXT NOT NULL CHECK(switch_action IN
                               ('initial','descend','rise','stay')),
            cost_score         REAL NOT NULL CHECK(cost_score >= 0 AND cost_score <= 1),
            benefit_score      REAL NOT NULL CHECK(benefit_score >= 0 AND benefit_score <= 1),
            net_value          REAL NOT NULL,
            ts                 INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlal_user_env_decision_ts
            ON ml_abstraction_log(user_id, resolved_env, decision_id, ts);
        CREATE INDEX IF NOT EXISTS idx_mlal_user_env_level_ts
            ON ml_abstraction_log(user_id, resolved_env, abstraction_level, ts);
    `);
});

// [OMEGA Wave 3 §130 MIND-CHANGE CRITERIA ENGINE 2026-05-16] _meta canonical
// PDF — §130 (lines 3761-3791). Pre-declared belief reversal criteria. 4
// reversal actions (weakening/flipping/abandoning/escalating). Inertia vs
// reversibility balance. "Ce anume m-ar convinge ca ma insel?". Distinct
// from §247 preRegistration (locks WHAT you believe), §113 socraticSelf
// Doubt (adversarial), §112 competingHypotheses (thesis market), §129
// assumptionSurfaceMapper (premise registry). §130 = pre-lock al
// criteriilor de REVIZUIRE a credintei.
migrate('249_ml_mind_change_criteria', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_mind_change_criteria (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            criterion_id        TEXT NOT NULL UNIQUE,
            belief_id           TEXT NOT NULL,
            reversal_action     TEXT NOT NULL CHECK(reversal_action IN
                                ('weakening','flipping','abandoning','escalating')),
            trigger_condition   TEXT NOT NULL,
            evidence_threshold  REAL NOT NULL CHECK(evidence_threshold >= 0 AND evidence_threshold <= 1),
            inertia_factor      REAL NOT NULL CHECK(inertia_factor >= 0 AND inertia_factor <= 1),
            ts                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlmcc_user_env_belief_ts
            ON ml_mind_change_criteria(user_id, resolved_env, belief_id, ts);
        CREATE INDEX IF NOT EXISTS idx_mlmcc_user_env_action_ts
            ON ml_mind_change_criteria(user_id, resolved_env, reversal_action, ts);
    `);
});

migrate('250_ml_mind_change_events', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_mind_change_events (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            event_id             TEXT NOT NULL UNIQUE,
            criterion_id         TEXT NOT NULL,
            actual_evidence      REAL NOT NULL CHECK(actual_evidence >= 0),
            surprise_score       REAL NOT NULL CHECK(surprise_score >= 0 AND surprise_score <= 1),
            reversal_executed    INTEGER NOT NULL CHECK(reversal_executed IN (0,1)),
            ts                   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlmce_user_env_criterion_ts
            ON ml_mind_change_events(user_id, resolved_env, criterion_id, ts);
    `);
});

// [OMEGA Wave 3 §129 ASSUMPTION SURFACE MAPPER 2026-05-16] _meta canonical
// PDF — §129 (lines 3714-3759). Per-decision tacit premise registry + 6-type
// taxonomy (structural/causal/execution/data_integrity/regime_persistence/
// cross_venue_validity) + 3 strength levels + dependency graph + fragility-
// driven size penalty. "Pe ce ma bazez, chiar daca nu am spus-o explicit?"
// Distinct from §120 unknownsRegistry (gap inventory; THIS = positive
// premise registry), §117 epistemicProvenance (lineage), §113 socratic
// SelfDoubt (adversarial falsification), §122 selfModel (capability graph).
migrate('247_ml_assumptions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_assumptions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assumption_id   TEXT NOT NULL UNIQUE,
            decision_id     TEXT NOT NULL,
            premise_type    TEXT NOT NULL CHECK(premise_type IN
                            ('structural','causal','execution',
                             'data_integrity','regime_persistence',
                             'cross_venue_validity')),
            strength_level  TEXT NOT NULL CHECK(strength_level IN
                            ('strong','fragile','speculative')),
            fragility_score REAL NOT NULL CHECK(fragility_score >= 0 AND fragility_score <= 1),
            statement       TEXT NOT NULL,
            ts              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mla_user_env_decision_ts
            ON ml_assumptions(user_id, resolved_env, decision_id, ts);
        CREATE INDEX IF NOT EXISTS idx_mla_user_env_strength_ts
            ON ml_assumptions(user_id, resolved_env, strength_level, ts);
    `);
});

migrate('248_ml_assumption_dependencies', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_assumption_dependencies (
            id                     INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                INTEGER NOT NULL,
            resolved_env           TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            dependency_id          TEXT NOT NULL UNIQUE,
            parent_assumption_id   TEXT NOT NULL,
            child_assumption_id    TEXT NOT NULL,
            ts                     INTEGER NOT NULL,
            CHECK(parent_assumption_id <> child_assumption_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mlad_user_env_parent_ts
            ON ml_assumption_dependencies(user_id, resolved_env, parent_assumption_id, ts);
        CREATE INDEX IF NOT EXISTS idx_mlad_user_env_child_ts
            ON ml_assumption_dependencies(user_id, resolved_env, child_assumption_id, ts);
    `);
});

// [OMEGA Wave 3 §128 FALSE CONSENSUS DETECTOR 2026-05-16] R6 canonical PDF
// — §128 (lines 3665-3722). Epistemic dependence graph + consensus inflation
// penalty. "Am multe dovezi diferite sau doar mai multe ecouri ale aceleiasi
// dovezi?". 3 verdicts: robust_independent/partially_shared/highly_coupled_
// pseudo. Distinct from §117 epistemicProvenance (lineage tracking), §48
// ensembleVoting (raw vote counting), §124 pluralSelfChamber (rival worldview
// dissent), §51 dataIntegrityConsensus (price median anomaly).
migrate('245_ml_consensus_dependence_edges', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_consensus_dependence_edges (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id               INTEGER NOT NULL,
            resolved_env          TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            edge_id               TEXT NOT NULL UNIQUE,
            signal_id             TEXT NOT NULL,
            upstream_source_id    TEXT NOT NULL,
            ts                    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlcde_user_env_signal_ts
            ON ml_consensus_dependence_edges(user_id, resolved_env, signal_id, ts);
        CREATE INDEX IF NOT EXISTS idx_mlcde_user_env_source_ts
            ON ml_consensus_dependence_edges(user_id, resolved_env, upstream_source_id, ts);
    `);
});

migrate('246_ml_consensus_assessments', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_consensus_assessments (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id               TEXT NOT NULL UNIQUE,
            signals_json                TEXT NOT NULL,
            raw_count                   INTEGER NOT NULL CHECK(raw_count >= 0),
            effective_count             REAL NOT NULL CHECK(effective_count >= 0),
            mean_pairwise_dependence    REAL NOT NULL CHECK(mean_pairwise_dependence >= 0 AND mean_pairwise_dependence <= 1),
            inflation_factor            REAL NOT NULL CHECK(inflation_factor >= 0 AND inflation_factor <= 1),
            verdict                     TEXT NOT NULL CHECK(verdict IN
                                        ('robust_independent','partially_shared',
                                         'highly_coupled_pseudo')),
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlca_user_env_verdict_ts
            ON ml_consensus_assessments(user_id, resolved_env, verdict, ts);
    `);
});

// [OMEGA Wave 3 §127 IDENTITY CONTINUITY 2026-05-16] _meta canonical PDF
// — §127 (lines 3608-3662). 7-axis identity hash snapshots + cumulative
// drift tracking. "Sunt tot eu, doar mai bun, sau am devenit alt agent?"
// 4-state ladder: evolution_normal/identity_drift/major_self_rewrite/
// forced_governance_review. Distinct from §116 charter (immutable),
// §123 ontologyRevision (vocabulary), §247 preRegistration (hash-locked).
migrate('243_ml_identity_snapshots', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_identity_snapshots (
            id                            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                       INTEGER NOT NULL,
            resolved_env                  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            snapshot_id                   TEXT NOT NULL UNIQUE,
            version_label                 TEXT NOT NULL,
            charter_hash                  TEXT NOT NULL,
            ontology_hash                 TEXT NOT NULL,
            concepts_hash                 TEXT NOT NULL,
            utility_priorities_hash       TEXT NOT NULL,
            regime_grammar_hash           TEXT NOT NULL,
            policy_style_hash             TEXT NOT NULL,
            risk_philosophy_hash          TEXT NOT NULL,
            ts                            INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlis_user_env_version_ts
            ON ml_identity_snapshots(user_id, resolved_env, version_label, ts);
    `);
});

migrate('244_ml_identity_drift_audits', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_identity_drift_audits (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id            INTEGER NOT NULL,
            resolved_env       TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id           TEXT NOT NULL UNIQUE,
            from_snapshot_id   TEXT NOT NULL,
            to_snapshot_id     TEXT NOT NULL,
            axis_drifts_json   TEXT NOT NULL,
            continuity_score   REAL NOT NULL CHECK(continuity_score >= 0 AND continuity_score <= 1),
            drift_kind         TEXT NOT NULL CHECK(drift_kind IN
                               ('evolution_normal','identity_drift',
                                'major_self_rewrite','forced_governance_review')),
            ts                 INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlida_user_env_drift_ts
            ON ml_identity_drift_audits(user_id, resolved_env, drift_kind, ts);
    `);
});

// [OMEGA Wave 3 §126 SECOND-ORDER UNCERTAINTY 2026-05-16] R5A canonical
// PDF — §126 (lines 3554-3605). Confidence-of-confidence engine + 4
// quadrant classifier (high_conf_robust/high_conf_fragile/low_conf_robust/
// low_conf_noisy). "Cat de mult am voie sa cred in propriul meu
// confidence?" Distinct from §20 calibration (history), §92
// uncertaintyPropagation (first-order pipeline), §15 confidenceDecay
// (time), §122 selfModel (module trust).
migrate('241_ml_confidence_assessments', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_confidence_assessments (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id               TEXT NOT NULL UNIQUE,
            decision_id                 TEXT NOT NULL,
            primary_confidence          REAL NOT NULL CHECK(primary_confidence >= 0 AND primary_confidence <= 1),
            confidence_of_confidence    REAL NOT NULL CHECK(confidence_of_confidence >= 0 AND confidence_of_confidence <= 1),
            calibration_reliability     REAL NOT NULL CHECK(calibration_reliability >= 0 AND calibration_reliability <= 1),
            local_drift                 REAL NOT NULL CHECK(local_drift >= 0 AND local_drift <= 1),
            quadrant                    TEXT NOT NULL CHECK(quadrant IN
                                        ('high_conf_robust','high_conf_fragile',
                                         'low_conf_robust','low_conf_noisy')),
            penalized_confidence        REAL NOT NULL CHECK(penalized_confidence >= 0 AND penalized_confidence <= 1),
            recommended_action          TEXT NOT NULL CHECK(recommended_action IN
                                        ('proceed','size_reduce','wait',
                                         'active_sensing','observer')),
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlca_user_env_quadrant_ts
            ON ml_confidence_assessments(user_id, resolved_env, quadrant, ts);
    `);
});

migrate('242_ml_calibration_drift_audit', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_calibration_drift_audit (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id          TEXT NOT NULL UNIQUE,
            assessment_id     TEXT NOT NULL,
            drift_source      TEXT NOT NULL,
            drift_magnitude   REAL NOT NULL CHECK(drift_magnitude >= 0 AND drift_magnitude <= 1),
            notes             TEXT,
            ts                INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlcda_user_env_assessment_ts
            ON ml_calibration_drift_audit(user_id, resolved_env, assessment_id, ts);
    `);
});

// [OMEGA Wave 3 §125 EPISTEMIC TENSION FIELD 2026-05-16] _meta canonical
// PDF — §125 (lines 3494-3552). Pre-contradiction stress engine peste 8
// surse canonice + 4 gradient kinds + 5 action states. "Sistemul meu este
// pe cale sa se rupa din interior?" NU inlocuieste veto/drift/OOD — le
// SUPRAPUNE intr-un stres compus. Distinct from §120 unknownsRegistry
// (explicit ignorance), §121 reflectiveEquilibrium (post-hoc audit), §44
// adversarialSelfTester (post-attack), §29 circuitBreaker (active).
migrate('239_ml_tension_assessments', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_tension_assessments (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id        TEXT NOT NULL UNIQUE,
            sources_json         TEXT NOT NULL,
            tension_score        REAL NOT NULL CHECK(tension_score >= 0 AND tension_score <= 1),
            gradient_kind        TEXT NOT NULL CHECK(gradient_kind IN
                                 ('local','global','persistent','acute')),
            recommended_state    TEXT NOT NULL CHECK(recommended_state IN
                                 ('continue','caution','reduce_size',
                                  'observer','full_freeze')),
            ts                   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlta_user_env_state_ts
            ON ml_tension_assessments(user_id, resolved_env, recommended_state, ts);
    `);
});

migrate('240_ml_tension_sources_audit', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_tension_sources_audit (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id             TEXT NOT NULL UNIQUE,
            assessment_id        TEXT NOT NULL,
            source_kind          TEXT NOT NULL CHECK(source_kind IN
                                 ('hypotheses','thesis_nodes','regime_beliefs',
                                  'confidence_bounds','unknowns','competence',
                                  'operational_health','utility_priorities')),
            contribution_score   REAL NOT NULL CHECK(contribution_score >= 0 AND contribution_score <= 1),
            notes                TEXT,
            ts                   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mltsa_user_env_assessment_source
            ON ml_tension_sources_audit(user_id, resolved_env, assessment_id, source_kind);
    `);
});

// [OMEGA Wave 3 §124 PLURAL SELF / RIVAL WORLDVIEW 2026-05-16] R6 canonical
// PDF — §124 (lines 3445-3491). N worldview agents cu ontologii diferite
// (trend_following/mean_reversion/liquidity_hunt/macro_dominant/
// risk_minimalist). "Dissent mare → size_reduce / WAIT / active_sensing /
// observer." Distinct from §71 internalDebate (same ontology), §112
// competingHypothesesEngine (market explanations), §111 scenarioTreePlanner
// (future worlds), §48 ensembleVoting (predictions).
migrate('237_ml_worldview_agents', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_worldview_agents (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            agent_id                 TEXT NOT NULL UNIQUE,
            worldview_kind           TEXT NOT NULL CHECK(worldview_kind IN
                                     ('trend_following','mean_reversion',
                                      'liquidity_hunt','macro_dominant',
                                      'risk_minimalist','custom')),
            priors_json              TEXT NOT NULL,
            signal_preferences_json  TEXT NOT NULL,
            is_active                INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
            ts_registered            INTEGER NOT NULL,
            ts_retired               INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mlwa_user_env_kind_active
            ON ml_worldview_agents(user_id, resolved_env, worldview_kind, is_active);
    `);
});

migrate('238_ml_plural_decisions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_plural_decisions (
            id                     INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                INTEGER NOT NULL,
            resolved_env           TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id            TEXT NOT NULL UNIQUE,
            market_context_json    TEXT NOT NULL,
            votes_json             TEXT NOT NULL,
            dissent_index          REAL NOT NULL CHECK(dissent_index >= 0 AND dissent_index <= 1),
            dominant_agent_id      TEXT,
            consensus_action       TEXT NOT NULL CHECK(consensus_action IN
                                   ('proceed','reduce_size','wait',
                                    'active_sensing','observer')),
            ts                     INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlpd_user_env_action_ts
            ON ml_plural_decisions(user_id, resolved_env, consensus_action, ts);
    `);
});

// [OMEGA Wave 3 §123 ONTOLOGY REVISION / PRIMITIVE DISCOVERY 2026-05-16]
// R5B canonical PDF — §123 (lines 3401-3442). Revises VOCABULARY/categories.
// 7 operations × 4 gain metrics × 4-stage lifecycle. "Primitivele noi NU
// intra direct in live fara shadow + validation." Distinct from §93
// regimeGrammar (atomic primitives FIXED), §114 conceptLibrary (named
// compound concepts), §113 causalDiscoveryEngine (causal edges), §94
// complexityBudget (feature pruning).
migrate('235_ml_primitive_proposals', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_primitive_proposals (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            proposal_id          TEXT NOT NULL UNIQUE,
            target_kind          TEXT NOT NULL CHECK(target_kind IN
                                 ('concept','regime_primitive')),
            operation            TEXT NOT NULL CHECK(operation IN
                                 ('add','split','merge','rename',
                                  'widen','narrow','remove_redundant')),
            proposal_summary     TEXT NOT NULL,
            explanatory_gain     REAL NOT NULL CHECK(explanatory_gain >= 0 AND explanatory_gain <= 1),
            compression_gain     REAL NOT NULL CHECK(compression_gain >= 0 AND compression_gain <= 1),
            predictive_gain      REAL NOT NULL CHECK(predictive_gain >= 0 AND predictive_gain <= 1),
            complexity_cost      REAL NOT NULL CHECK(complexity_cost >= 0 AND complexity_cost <= 1),
            net_score            REAL NOT NULL,
            status               TEXT NOT NULL DEFAULT 'PROPOSED' CHECK(status IN
                                 ('PROPOSED','SHADOW','CONFIRMED','REJECTED')),
            ts_proposed          INTEGER NOT NULL,
            ts_decided           INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mlpp_user_env_status
            ON ml_primitive_proposals(user_id, resolved_env, status);
    `);
});

migrate('236_ml_ontology_versions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_ontology_versions (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            version_id               TEXT NOT NULL UNIQUE,
            version_number           INTEGER NOT NULL CHECK(version_number >= 1),
            applied_proposals_json   TEXT NOT NULL,
            revision_reason          TEXT NOT NULL,
            ts_applied               INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlov_user_env_version
            ON ml_ontology_versions(user_id, resolved_env, version_number);
    `);
});

// [OMEGA Wave 3 §122 SELF-MODEL / INTROSPECTIVE CAPABILITY 2026-05-16]
// _meta canonical PDF — §122 (lines 3350-3398). Module-level self-trust
// graph cu 6 module kinds × 4 capability states. "Pot sa am incredere in
// mine insumi acum?" Distinct from §106 competenceMap (market validity),
// §35 monitoring (raw KPI), §98 dependencyGraph (topology), §38
// intelligenceChecker (per-decision eval).
migrate('233_ml_self_capability_graph', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_self_capability_graph (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            capability_id       TEXT NOT NULL UNIQUE,
            module_id           TEXT NOT NULL,
            module_kind         TEXT NOT NULL CHECK(module_kind IN
                                ('detector','scorer','policy','execution',
                                 'memory_learning','safety')),
            health              REAL NOT NULL CHECK(health >= 0 AND health <= 1),
            reliability         REAL NOT NULL CHECK(reliability >= 0 AND reliability <= 1),
            recency             REAL NOT NULL CHECK(recency >= 0 AND recency <= 1),
            trust_score         REAL NOT NULL CHECK(trust_score >= 0 AND trust_score <= 1),
            state               TEXT NOT NULL CHECK(state IN
                                ('strong','degraded','uncertain','unavailable')),
            ts_last_assessed    INTEGER NOT NULL,
            ts_created          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlscg_user_env_state_kind
            ON ml_self_capability_graph(user_id, resolved_env, state, module_kind);
    `);
});

migrate('234_ml_introspective_summaries', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_introspective_summaries (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            summary_id               TEXT NOT NULL UNIQUE,
            decision_id              TEXT NOT NULL,
            modules_relied_on_json   TEXT NOT NULL,
            self_trust_aggregate     REAL NOT NULL CHECK(self_trust_aggregate >= 0 AND self_trust_aggregate <= 1),
            confidence_modifier      REAL NOT NULL CHECK(confidence_modifier >= 0 AND confidence_modifier <= 1),
            ts                       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlis_user_env_decision_ts
            ON ml_introspective_summaries(user_id, resolved_env, decision_id, ts);
    `);
});

// [OMEGA Wave 3 §121 REFLECTIVE EQUILIBRIUM 2026-05-16] _meta canonical PDF
// — §121 (lines 3297-3347). Cross-layer coherence audit pe 6 canonical
// layers (constitution/utility/regime_grammar/concept_library/thesis_graph/
// policy_layer). "Sistemul meu, ca intreg, inca coerent cu el insusi?"
// Distinct from §116 charter (immutable), §115 selfRepair (proposals),
// §114/§93/§68 (individual layers).
migrate('231_ml_coherence_audits', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_coherence_audits (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id               INTEGER NOT NULL,
            resolved_env          TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id              TEXT NOT NULL UNIQUE,
            layers_checked_json   TEXT NOT NULL,
            equilibrium_score     REAL NOT NULL CHECK(equilibrium_score >= 0 AND equilibrium_score <= 1),
            conflicts_detected    INTEGER NOT NULL CHECK(conflicts_detected >= 0),
            recurring_count       INTEGER NOT NULL CHECK(recurring_count >= 0),
            ts                    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlca_user_env_ts
            ON ml_coherence_audits(user_id, resolved_env, ts);
    `);
});

migrate('232_ml_systemic_contradictions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_systemic_contradictions (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            contradiction_id        TEXT NOT NULL UNIQUE,
            audit_id                TEXT NOT NULL,
            layer_a                 TEXT NOT NULL CHECK(layer_a IN
                                    ('constitution','utility','regime_grammar',
                                     'concept_library','thesis_graph','policy_layer')),
            layer_b                 TEXT NOT NULL CHECK(layer_b IN
                                    ('constitution','utility','regime_grammar',
                                     'concept_library','thesis_graph','policy_layer')),
            conflict_description    TEXT NOT NULL,
            recurrence_count        INTEGER NOT NULL CHECK(recurrence_count >= 1),
            recommended_action      TEXT NOT NULL CHECK(recommended_action IN
                                    ('review_rule','weaken_concept',
                                     'quarantine_heuristic',
                                     'escalate_governance','no_action')),
            ts                      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlsc_user_env_layers
            ON ml_systemic_contradictions(user_id, resolved_env, layer_a, layer_b);
    `);
});

// [OMEGA Wave 3 §120 UNKNOWNS REGISTRY 2026-05-16] _meta canonical PDF —
// §120 (lines 3249-3295). Explicit ignorance ledger cu 5 unknown kinds +
// 5-axis impact tracking + 5-action debt response. "Necunoscutele NU au
// voie sa ramana invizibile in decizie." Distinct from §47 inactivityDecay
// (time decay), §97 forgettingEngine (knowledge retire), §103 wisdomLayer
// (judgment), §106 competenceMap (validity), §99 activeSensingPolicy.
migrate('229_ml_unknowns', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_unknowns (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            unknown_id               TEXT NOT NULL UNIQUE,
            kind                     TEXT NOT NULL CHECK(kind IN
                                     ('unknown_known','known_unknown',
                                      'unresolved_ambiguity',
                                      'fragile_assumption',
                                      'temporary_operational')),
            description              TEXT NOT NULL,
            impact_sizing            REAL NOT NULL CHECK(impact_sizing >= 0 AND impact_sizing <= 1),
            impact_confidence        REAL NOT NULL CHECK(impact_confidence >= 0 AND impact_confidence <= 1),
            impact_regime            REAL NOT NULL CHECK(impact_regime >= 0 AND impact_regime <= 1),
            impact_execution         REAL NOT NULL CHECK(impact_execution >= 0 AND impact_execution <= 1),
            impact_portfolio_risk    REAL NOT NULL CHECK(impact_portfolio_risk >= 0 AND impact_portfolio_risk <= 1),
            debt_score               REAL NOT NULL CHECK(debt_score >= 0 AND debt_score <= 1),
            status                   TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN
                                     ('OPEN','RESOLVED','ACCEPTED')),
            ts_registered            INTEGER NOT NULL,
            ts_resolved              INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mlu_user_env_status_debt
            ON ml_unknowns(user_id, resolved_env, status, debt_score);
    `);
});

migrate('230_ml_assumption_debt_audit', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_assumption_debt_audit (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id        TEXT NOT NULL UNIQUE,
            unknown_id      TEXT NOT NULL,
            action_taken    TEXT NOT NULL CHECK(action_taken IN
                            ('size_reduce','wait','active_sensing',
                             'observer','resolve')),
            reason          TEXT NOT NULL,
            ts              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlada_user_env_unknown_ts
            ON ml_assumption_debt_audit(user_id, resolved_env, unknown_id, ts);
    `);
});

// [OMEGA Wave 3 §119 PRE-MORTEM FAILURE REHEARSAL 2026-05-16] R3A canonical
// PDF — §119 (lines 3204-3246). 8-mode failure rehearsal cu severity ×
// detectability × recoverability + 5 action plans. "Daca trade-ul moare
// urat, cum moare cel mai probabil si ce fac atunci?" Distinct from §111
// scenarioTree (5 futures), §44 adversarialSelfTester (attacks), §88
// accountStressEngine (liquidation only).
migrate('227_ml_premortem_sessions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_premortem_sessions (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            session_id              TEXT NOT NULL UNIQUE,
            decision_id             TEXT NOT NULL,
            dominant_failure_mode   TEXT,
            total_failure_modes     INTEGER NOT NULL DEFAULT 0 CHECK(total_failure_modes >= 0),
            max_severity            REAL NOT NULL DEFAULT 0 CHECK(max_severity >= 0 AND max_severity <= 1),
            aggregate_risk_score    REAL NOT NULL DEFAULT 0,
            status                  TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED')),
            ts_started              INTEGER NOT NULL,
            ts_closed               INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mlps_user_env_decision_status
            ON ml_premortem_sessions(user_id, resolved_env, decision_id, status);
    `);
});

migrate('228_ml_premortem_failure_modes', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_premortem_failure_modes (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            mode_id           TEXT NOT NULL UNIQUE,
            session_id        TEXT NOT NULL,
            failure_kind      TEXT NOT NULL CHECK(failure_kind IN
                              ('thesis_invalidation_rapid','fakeout',
                               'liquidity_vacuum','slippage_blowout',
                               'venue_failure','latency_miss',
                               'macro_interruption','cross_asset_contagion')),
            severity          REAL NOT NULL CHECK(severity >= 0 AND severity <= 1),
            detectability     REAL NOT NULL CHECK(detectability >= 0 AND detectability <= 1),
            recoverability    REAL NOT NULL CHECK(recoverability >= 0 AND recoverability <= 1),
            action_plan       TEXT NOT NULL CHECK(action_plan IN
                              ('reduce','hedge','exit','observer','lock')),
            ts                INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlpfm_user_env_session
            ON ml_premortem_failure_modes(user_id, resolved_env, session_id);
    `);
});

// [OMEGA Wave 3 §118 BELIEF UPDATE REGULARIZER 2026-05-16] R5A canonical
// PDF — §118 (lines 3164-3201). Velocity-limiter + evidence classifier
// (structural_signal/strident_event/lucky_streak/unlucky_streak). "Credintele
// centrale NU au voie sa se rescrie brutal fara evidenta suficienta."
// Distinct from §15 confidenceDecay (time decay), §21 driftDetection
// (statistical drift), §97 forgettingEngine (TTL), §105 latentStateFilter
// (Bayesian update history), §107 invarianceLayer (perturbation).
migrate('225_ml_belief_regularization_audit', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_belief_regularization_audit (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id                 TEXT NOT NULL UNIQUE,
            belief_id                TEXT NOT NULL,
            prior_value              REAL NOT NULL,
            proposed_value           REAL NOT NULL,
            applied_value            REAL NOT NULL,
            evidence_kind            TEXT NOT NULL CHECK(evidence_kind IN
                                     ('structural_signal','strident_event',
                                      'lucky_streak','unlucky_streak')),
            regularization_factor    REAL NOT NULL CHECK(regularization_factor >= 0 AND regularization_factor <= 1),
            reason                   TEXT,
            ts                       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlbra_user_env_belief_ts
            ON ml_belief_regularization_audit(user_id, resolved_env, belief_id, ts);
    `);
});

migrate('226_ml_belief_update_limits', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_belief_update_limits (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            limit_id                 TEXT NOT NULL UNIQUE,
            belief_category          TEXT NOT NULL,
            max_delta_per_update     REAL NOT NULL CHECK(max_delta_per_update > 0),
            max_updates_per_window   INTEGER NOT NULL CHECK(max_updates_per_window > 0),
            window_seconds           INTEGER NOT NULL CHECK(window_seconds > 0),
            regime_modifier_json     TEXT,
            ts_created               INTEGER NOT NULL,
            ts_last_updated          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlbul_user_env_category
            ON ml_belief_update_limits(user_id, resolved_env, belief_category);
    `);
});

// [OMEGA Wave 3 §117 EPISTEMIC PROVENANCE 2026-05-16] _audit canonical PDF
// — §117 (lines 3118-3161). Belief lineage DAG cu 7 node kinds + 5 source
// types per canonical taxonomy. "Nu exista belief important fara lineage."
// Distinct from auditTrail.js (flat snapshots), §16 attribution (PnL
// decomposition), §25 explainability (output XAI), §35 monitoring (KPI).
migrate('223_ml_belief_nodes', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_belief_nodes (
            id                     INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                INTEGER NOT NULL,
            resolved_env           TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            node_id                TEXT NOT NULL UNIQUE,
            belief_id              TEXT NOT NULL,
            kind                   TEXT NOT NULL CHECK(kind IN
                                   ('raw_feed','preprocess','detector_output',
                                    'score_transform','gating_event',
                                    'thesis_node','policy_verdict')),
            source_type            TEXT NOT NULL CHECK(source_type IN
                                   ('direct_observation','derived_inference',
                                    'propagated_hypothesis',
                                    'historical_prior','episodic_analogy')),
            parent_node_ids_json   TEXT NOT NULL,
            content_summary        TEXT NOT NULL,
            ts                     INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlbn_user_env_belief_ts
            ON ml_belief_nodes(user_id, resolved_env, belief_id, ts);
    `);
});

migrate('224_ml_belief_lineages', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_belief_lineages (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            lineage_id          TEXT NOT NULL UNIQUE,
            belief_id           TEXT NOT NULL,
            root_node_id        TEXT NOT NULL,
            terminal_node_id    TEXT NOT NULL,
            decision_id         TEXT NOT NULL,
            node_count          INTEGER NOT NULL CHECK(node_count >= 1),
            ts                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlbl_user_env_belief_ts
            ON ml_belief_lineages(user_id, resolved_env, belief_id, ts);
    `);
});

// [OMEGA Wave 3 §116 CONSTITUTIONAL CHARTER 2026-05-16] R1 canonical PDF —
// §116 (lines 3076-3115). Immutable charter cu 6 principles ierarhie
// (safety > truth > compliance > integrity > long_term_survivability >
// profit). "Constitutional blocks BAT utility optimization." Distinct
// from §10 supremePrinciple (cognitive), §104 integrityConstraint
// (ecosystem), §66 compliance (legal).
migrate('221_ml_charter_principles', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_charter_principles (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            principle_id      TEXT NOT NULL UNIQUE,
            kind              TEXT NOT NULL CHECK(kind IN
                              ('profit','safety','truth','compliance',
                               'integrity','long_term_survivability')),
            priority_rank     INTEGER NOT NULL CHECK(priority_rank >= 1),
            description       TEXT NOT NULL,
            is_active         INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
            ts_created        INTEGER NOT NULL,
            ts_last_updated   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlcp116_user_env_rank
            ON ml_charter_principles(user_id, resolved_env, priority_rank);
    `);
});

migrate('222_ml_charter_decisions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_charter_decisions (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id                 TEXT NOT NULL UNIQUE,
            action_summary              TEXT NOT NULL,
            conflicting_principles_json TEXT NOT NULL,
            charter_status              TEXT NOT NULL CHECK(charter_status IN
                                        ('CONSTITUTIONAL_COMPLIANT',
                                         'CONSTITUTIONALLY_DEGRADED',
                                         'CONSTITUTIONALLY_BLOCKED')),
            utility_score               REAL,
            override_reason             TEXT,
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlcd116_user_env_status_ts
            ON ml_charter_decisions(user_id, resolved_env, charter_status, ts);
    `);
});

// [OMEGA Wave 3 §115 SELF-REPAIR ENGINE 2026-05-16] meta canonical PDF —
// §115 (lines 3036-3074). Autonomous improvement proposal engine across
// 6 issue kinds × 6 remediation types. Lifecycle PROPOSED→SHADOW→CANARY
// →APPLIED enforces canonical line 3068 "NU se auto-modifica direct in live".
// Distinct from §113 causalDiscoveryEngine (causal-specific), §44
// adversarialSelfTester (attacks), §38 intelligenceChecker (self-eval),
// §101 socraticSelfDoubt (worldview), §254 autoQuarantine (post-hoc failure).
migrate('219_ml_repair_proposals', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_repair_proposals (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            proposal_id              TEXT NOT NULL UNIQUE,
            issue_kind               TEXT NOT NULL CHECK(issue_kind IN
                                     ('threshold','regime_misclassification',
                                      'sizing','execution_drift',
                                      'feature_redundancy','stale_concepts')),
            remediation_type         TEXT NOT NULL CHECK(remediation_type IN
                                     ('retune','retrain','disable','replace',
                                      'quarantine','shadow_experiment')),
            affected_component_id    TEXT NOT NULL,
            expected_benefit         REAL NOT NULL CHECK(expected_benefit >= 0 AND expected_benefit <= 1),
            expected_risk            REAL NOT NULL CHECK(expected_risk >= 0 AND expected_risk <= 1),
            rank_score               REAL NOT NULL,
            status                   TEXT NOT NULL DEFAULT 'PROPOSED' CHECK(status IN
                                     ('PROPOSED','SHADOW','CANARY','APPLIED','REJECTED')),
            justification            TEXT NOT NULL,
            ts_proposed              INTEGER NOT NULL,
            ts_decided               INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mlrp115_user_env_status
            ON ml_repair_proposals(user_id, resolved_env, status);
    `);
});

migrate('220_ml_repair_outcomes', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_repair_outcomes (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            outcome_id          TEXT NOT NULL UNIQUE,
            proposal_id         TEXT NOT NULL,
            observed_benefit    REAL NOT NULL,
            observed_risk       REAL NOT NULL,
            decision            TEXT NOT NULL CHECK(decision IN
                                ('PROMOTE','REJECT','EXTEND_SHADOW')),
            reason              TEXT,
            ts                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlro115_user_env_proposal
            ON ml_repair_outcomes(user_id, resolved_env, proposal_id);
    `);
});

// [OMEGA Wave 3 §114 CONCEPT LIBRARY / SEMANTIC ABSTRACTION 2026-05-16]
// R5A canonical PDF — §114 (lines 3001-3033). Named compound concept
// library (exhausted_breakout, fragile_squeeze...) with empirical support
// + utility tracking. "Conceptele NU sunt etichete decorative." Distinct
// from §93 regimeGrammar (atomic primitive dims), §27 temporalPatterns
// (time recurrence), §102 crossDomainAnalogy (external domains).
migrate('217_ml_concepts', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_concepts (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            concept_id           TEXT NOT NULL UNIQUE,
            label                TEXT NOT NULL,
            description          TEXT NOT NULL,
            support_count        INTEGER NOT NULL DEFAULT 0 CHECK(support_count >= 0),
            utility_score        REAL NOT NULL DEFAULT 0 CHECK(utility_score >= 0 AND utility_score <= 1),
            confidence           REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
            status               TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN
                                 ('ACTIVE','MERGED','SPLIT','RETIRED')),
            parent_concept_id    TEXT,
            ts_created           INTEGER NOT NULL,
            ts_last_updated      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlc_user_env_status_label
            ON ml_concepts(user_id, resolved_env, status, label);
    `);
});

migrate('218_ml_concept_observations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_concept_observations (
            id                     INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                INTEGER NOT NULL,
            resolved_env           TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            observation_id         TEXT NOT NULL UNIQUE,
            concept_id             TEXT NOT NULL,
            market_state_json      TEXT NOT NULL,
            outcome                TEXT NOT NULL,
            decision_relevance     REAL NOT NULL CHECK(decision_relevance >= 0 AND decision_relevance <= 1),
            ts                     INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlco_user_env_concept_ts
            ON ml_concept_observations(user_id, resolved_env, concept_id, ts);
    `);
});

// [OMEGA Wave 3 §113 CAUSAL DISCOVERY / GRAPH REVISION 2026-05-16] R2
// canonical PDF — §113 (lines 2971-2998). SCM edge revision proposals
// with proposal-confirm-apply lifecycle. "Descoperirea cauzala NU modifica
// direct live graph fara validare." Distinct from §40 structuralCausalModel
// (static chains), §42 interventionalReasoning (do-calculus on STATIC),
// §68 thesisGraph (per-trade DAG).
migrate('215_ml_causal_edge_proposals', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_causal_edge_proposals (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            proposal_id          TEXT NOT NULL UNIQUE,
            from_node            TEXT NOT NULL,
            to_node              TEXT NOT NULL,
            proposed_change      TEXT NOT NULL CHECK(proposed_change IN
                                 ('ADD','STRENGTHEN','WEAKEN','INVERT',
                                  'REMOVE','CONTEXTUALIZE')),
            candidate_strength   REAL NOT NULL CHECK(candidate_strength >= 0 AND candidate_strength <= 1),
            evidence_summary     TEXT NOT NULL,
            evidence_count       INTEGER NOT NULL CHECK(evidence_count >= 0),
            status               TEXT NOT NULL DEFAULT 'PROPOSED' CHECK(status IN
                                 ('PROPOSED','SHADOW_VALIDATING','CONFIRMED','REJECTED')),
            human_approved       INTEGER NOT NULL DEFAULT 0 CHECK(human_approved IN (0,1)),
            ts_proposed          INTEGER NOT NULL,
            ts_decided           INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mlcep_user_env_status
            ON ml_causal_edge_proposals(user_id, resolved_env, status);
    `);
});

migrate('216_ml_graph_revisions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_graph_revisions (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            revision_id              TEXT NOT NULL UNIQUE,
            version                  INTEGER NOT NULL CHECK(version >= 1),
            applied_proposals_json   TEXT NOT NULL,
            revision_reason          TEXT NOT NULL,
            ts_applied               INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlgr_user_env_version
            ON ml_graph_revisions(user_id, resolved_env, version);
    `);
});

// [OMEGA Wave 3 §112 COMPETING HYPOTHESES ENGINE 2026-05-16] R2 canonical
// PDF — §112 (lines 2936-2968). Live market-wide hypothesis registry cu
// posterior transfer. "Nicio teza dominanta fara alternative explicite."
// Distinct from §68 thesisGraph (1 trade DAG), §247 preRegistration
// (hash-locked pre-test), §111 scenarioTree (FUTURE worlds), §100
// narrativeCoherence (1 story).
migrate('213_ml_hypothesis_registry', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_hypothesis_registry (
            id                            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                       INTEGER NOT NULL,
            resolved_env                  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            hypothesis_id                 TEXT NOT NULL UNIQUE,
            kind                          TEXT NOT NULL CHECK(kind IN
                                          ('continuation','distribution',
                                           'short_covering','liquidity_grab',
                                           'macro_override')),
            posterior_score               REAL NOT NULL CHECK(posterior_score >= 0 AND posterior_score <= 1),
            status                        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN
                                          ('ACTIVE','RETIRED','DOMINANT')),
            invalidation_conditions_json  TEXT NOT NULL,
            ts_created                    INTEGER NOT NULL,
            ts_last_updated               INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlhr_user_env_status
            ON ml_hypothesis_registry(user_id, resolved_env, status);
    `);
});

migrate('214_ml_hypothesis_transitions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_hypothesis_transitions (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            transition_id            TEXT NOT NULL UNIQUE,
            from_hypothesis_id       TEXT NOT NULL,
            to_hypothesis_id         TEXT NOT NULL,
            evidence_summary         TEXT NOT NULL,
            posterior_from_before    REAL NOT NULL CHECK(posterior_from_before >= 0 AND posterior_from_before <= 1),
            posterior_from_after     REAL NOT NULL CHECK(posterior_from_after >= 0 AND posterior_from_after <= 1),
            posterior_to_before      REAL NOT NULL CHECK(posterior_to_before >= 0 AND posterior_to_before <= 1),
            posterior_to_after       REAL NOT NULL CHECK(posterior_to_after >= 0 AND posterior_to_after <= 1),
            amount_transferred       REAL NOT NULL CHECK(amount_transferred >= 0),
            ts                       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlht_user_env_ts
            ON ml_hypothesis_transitions(user_id, resolved_env, ts);
    `);
});

// [OMEGA Wave 3 §111 SCENARIO TREE PLANNER 2026-05-16] R6 canonical PDF —
// §111 (lines 2901-2933). Tree-of-thought multi-future projection per
// decision. "Daca intru acum, care sunt cele mai probabile 3-5 lumi care
// urmeaza?" Distinct from §71 internalDebate (1 decision, 3 voices),
// §48 ensembleVoting (aggregate predictions), §96 synthetic-for-training,
// §100 narrativeCoherence (1 story).
migrate('211_ml_scenario_trees', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_scenario_trees (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            tree_id                  TEXT NOT NULL UNIQUE,
            decision_id              TEXT NOT NULL,
            dominant_branch          TEXT NOT NULL CHECK(dominant_branch IN
                                     ('continuation','fakeout','squeeze',
                                      'mean_reversion','macro_interruption')),
            active_branches_count    INTEGER NOT NULL CHECK(active_branches_count >= 0),
            weighted_score           REAL NOT NULL,
            adverse_share            REAL NOT NULL CHECK(adverse_share >= 0 AND adverse_share <= 1),
            ts                       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlst_user_env_ts
            ON ml_scenario_trees(user_id, resolved_env, ts);
    `);
});

migrate('212_ml_scenario_branches', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_scenario_branches (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            branch_id         TEXT NOT NULL UNIQUE,
            tree_id           TEXT NOT NULL,
            branch_kind       TEXT NOT NULL CHECK(branch_kind IN
                              ('continuation','fakeout','squeeze',
                               'mean_reversion','macro_interruption')),
            probability       REAL NOT NULL CHECK(probability >= 0 AND probability <= 1),
            expected_action   TEXT NOT NULL,
            expected_pnl      REAL NOT NULL,
            is_pruned         INTEGER NOT NULL CHECK(is_pruned IN (0,1)),
            reason            TEXT,
            ts                INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlsb_user_env_tree
            ON ml_scenario_branches(user_id, resolved_env, tree_id);
    `);
});

// [OMEGA Wave 3 §110 ADAPTIVE REASONING ROUTER 2026-05-16] R2 canonical PDF
// — §110 (lines 2869-2898). Context-aware reasoning module selection with
// safety/veto enforcement. "Pentru acest caz concret, ce fir de gandire
// merita rulat?" Distinct from §9 thinkingPipeline (fixed chain), §24
// detectorRegistry (catalog), §85 computeBudgetGovernor (mode binary).
migrate('209_ml_module_priorities', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_module_priorities (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            priority_id         TEXT NOT NULL UNIQUE,
            module_id           TEXT NOT NULL,
            kind                TEXT NOT NULL CHECK(kind IN
                                ('safety','veto','normal')),
            constant_priority   INTEGER NOT NULL,
            is_active           INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
            last_invoked        INTEGER,
            ts                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlmp_user_env_kind_active
            ON ml_module_priorities(user_id, resolved_env, kind, is_active);
    `);
});

migrate('210_ml_reasoning_paths', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_reasoning_paths (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            path_id                  TEXT NOT NULL UNIQUE,
            decision_context_json    TEXT NOT NULL,
            modules_included_json    TEXT NOT NULL,
            modules_skipped_json     TEXT NOT NULL,
            cognitive_budget_used    REAL NOT NULL CHECK(cognitive_budget_used >= 0),
            justification            TEXT NOT NULL,
            ts                       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlrp_user_env_ts
            ON ml_reasoning_paths(user_id, resolved_env, ts);
    `);
});

// [OMEGA Wave 3 §109 POLICY REGRET 2026-05-16] R5A canonical PDF —
// §109 (lines 2818-2867). Feasible hindsight oracle gap engine. "Cat de
// departe am fost de cea mai buna decizie pe care chiar aveam voie sa o iau
// atunci?" Distinct from §16 attribution / §242 counterfactual / §49
// override-tracker — §109 = absolute distance vs constrained oracle.
migrate('207_ml_oracle_decisions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_oracle_decisions (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            oracle_id                       TEXT NOT NULL UNIQUE,
            decision_id                     TEXT NOT NULL,
            actual_action_json              TEXT NOT NULL,
            optimal_feasible_action_json    TEXT NOT NULL,
            total_regret                    REAL NOT NULL CHECK(total_regret >= 0),
            feasibility_constraints_json    TEXT NOT NULL,
            ts                              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlod_user_env_ts
            ON ml_oracle_decisions(user_id, resolved_env, ts);
        CREATE INDEX IF NOT EXISTS idx_mlod_decision
            ON ml_oracle_decisions(decision_id);
    `);
});

migrate('208_ml_regret_components', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_regret_components (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            component_id      TEXT NOT NULL UNIQUE,
            oracle_id         TEXT NOT NULL,
            regret_kind       TEXT NOT NULL CHECK(regret_kind IN
                              ('signal','timing','sizing','execution','abstention')),
            component_value   REAL NOT NULL CHECK(component_value >= 0),
            notes             TEXT,
            ts                INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlrc_user_env_oracle_kind
            ON ml_regret_components(user_id, resolved_env, oracle_id, regret_kind);
    `);
});

// [OMEGA Wave 3 §108 PROGRESSIVE COMMITMENT 2026-05-16] R4 canonical PDF —
// §108 (lines 2773-2815). Real-options entry engine: probe → expand on
// confirmation, abort on contradiction. "Merita sa cumpar informatie
// printr-o pozitie mica inainte de a ma angaja complet?"
migrate('205_ml_commitment_setups', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_commitment_setups (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id               INTEGER NOT NULL,
            resolved_env          TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            setup_id              TEXT NOT NULL UNIQUE,
            target_total_size     REAL NOT NULL CHECK(target_total_size >= 0),
            current_filled_size   REAL NOT NULL DEFAULT 0 CHECK(current_filled_size >= 0),
            status                TEXT NOT NULL DEFAULT 'probing' CHECK(status IN
                                  ('probing','confirming','full','aborted','completed')),
            thesis_id             TEXT,
            ts_created            INTEGER NOT NULL,
            ts_last_updated       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlcs108_user_env_status
            ON ml_commitment_setups(user_id, resolved_env, status);
    `);
});

migrate('206_ml_commitment_tranches', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_commitment_tranches (
            id                        INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                   INTEGER NOT NULL,
            resolved_env              TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            tranche_id                TEXT NOT NULL UNIQUE,
            setup_id                  TEXT NOT NULL,
            kind                      TEXT NOT NULL CHECK(kind IN
                                      ('exploratory','conviction',
                                       'confirmation_add','defensive_reduce')),
            size                      REAL NOT NULL,
            market_response_score     REAL,
            decision_after            TEXT CHECK(decision_after IS NULL OR decision_after IN
                                      ('expand','hold','abort','exit')),
            ts                        INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlct108_user_env_setup_ts
            ON ml_commitment_tranches(user_id, resolved_env, setup_id, ts);
    `);
});

// [OMEGA Wave 3 §107 INVARIANCE / NUISANCE-ROBUSTNESS 2026-05-16] R5A
// canonical PDF — §107 (lines 2729-2770). Stability tests pe perturbari
// irelevante (scale/jitter/resampling/feed/representation). "Daca nu s-a
// schimbat sensul pietei, de ce s-a schimbat decizia?"
migrate('203_ml_invariance_tests', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_invariance_tests (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            test_id             TEXT NOT NULL UNIQUE,
            model_id            TEXT NOT NULL,
            perturbation_kind   TEXT NOT NULL CHECK(perturbation_kind IN
                                ('scale','timestamp_jitter','resampling',
                                 'feed_perturbation','representation')),
            original_verdict    TEXT NOT NULL,
            perturbed_verdict   TEXT NOT NULL,
            verdict_stable      INTEGER NOT NULL CHECK(verdict_stable IN (0,1)),
            magnitude           REAL,
            ts                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlit_user_env_model_kind
            ON ml_invariance_tests(user_id, resolved_env, model_id, perturbation_kind);
    `);
});

migrate('204_ml_robustness_scores', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_robustness_scores (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            score_id        TEXT NOT NULL UNIQUE,
            model_id        TEXT NOT NULL,
            kind            TEXT NOT NULL CHECK(kind IN
                            ('scale','timestamp_jitter','resampling',
                             'feed_perturbation','representation','aggregate')),
            score           REAL NOT NULL CHECK(score >= 0 AND score <= 1),
            sample_count    INTEGER NOT NULL CHECK(sample_count >= 0),
            status          TEXT NOT NULL CHECK(status IN
                            ('ROBUST','FRAGILE','INSUFFICIENT')),
            ts              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlrs_user_env_model_status_ts
            ON ml_robustness_scores(user_id, resolved_env, model_id, status, ts);
    `);
});

// [OMEGA Wave 3 §106 COMPETENCE MAP 2026-05-16] R5B canonical PDF —
// §106 (lines 2673-2726). Domain-of-validity cartography with per-cell
// action permission. "Performanta globala buna NU acorda permisiune
// universala — fiecare regiune isi castiga dreptul la capital."
migrate('201_ml_competence_cells', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_competence_cells (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            cell_id             TEXT NOT NULL UNIQUE,
            dimensions_json     TEXT NOT NULL,
            validity_score      REAL NOT NULL CHECK(validity_score >= 0 AND validity_score <= 1),
            sample_count        INTEGER NOT NULL CHECK(sample_count >= 0),
            win_rate            REAL,
            action_permission   TEXT NOT NULL CHECK(action_permission IN
                                ('allowed','reduced_size','shadow_only','observer_only')),
            last_updated        INTEGER NOT NULL,
            ts_created          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlcc_user_env_permission
            ON ml_competence_cells(user_id, resolved_env, action_permission);
    `);
});

migrate('202_ml_competence_decisions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_competence_decisions (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id         TEXT NOT NULL UNIQUE,
            cell_id             TEXT,
            decision_context    TEXT NOT NULL,
            action_permission   TEXT NOT NULL CHECK(action_permission IN
                                ('allowed','reduced_size','shadow_only','observer_only')),
            reason              TEXT NOT NULL,
            ts                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlcd_user_env_permission_ts
            ON ml_competence_decisions(user_id, resolved_env, action_permission, ts);
    `);
});

// [OMEGA Wave 3 §105 LATENT STATE ESTIMATION 2026-05-16] R2 canonical PDF —
// §105 (lines 2628-2671). Bayesian belief-state engine over unobservables:
// inventory pressure / liquidity withdrawal / crowd fragility / squeeze /
// regime transition / forced flow. "Ce se intampla probabil in spatele a
// ceea ce vad?"
migrate('199_ml_latent_states', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_latent_states (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            state_id                 TEXT NOT NULL UNIQUE,
            kind                     TEXT NOT NULL CHECK(kind IN
                                     ('inventory_pressure','liquidity_withdrawal',
                                      'crowd_fragility','squeeze_pressure',
                                      'regime_transition','forced_flow')),
            belief_value             REAL NOT NULL CHECK(belief_value >= 0 AND belief_value <= 1),
            confidence               REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
            inference_tier           TEXT NOT NULL CHECK(inference_tier IN
                                     ('direct_observation','inference',
                                      'weak_hypothesis','strong_hypothesis')),
            supporting_sources_json  TEXT,
            ts                       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlls_user_env_kind_ts
            ON ml_latent_states(user_id, resolved_env, kind, ts);
    `);
});

migrate('200_ml_belief_updates', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_belief_updates (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            update_id         TEXT NOT NULL UNIQUE,
            state_id          TEXT NOT NULL,
            prior_belief      REAL NOT NULL CHECK(prior_belief >= 0 AND prior_belief <= 1),
            posterior_belief  REAL NOT NULL CHECK(posterior_belief >= 0 AND posterior_belief <= 1),
            likelihood        REAL NOT NULL CHECK(likelihood >= 0 AND likelihood <= 1),
            evidence_json     TEXT,
            delta             REAL NOT NULL,
            ts                INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlbu_user_env_state_ts
            ON ml_belief_updates(user_id, resolved_env, state_id, ts);
    `);
});

// [OMEGA Wave 3 §104 INTEGRITY CONSTRAINT LAYER 2026-05-16] cross-cutting
// canonical PDF — §104 (line 2625). Self-imposed ethical/ecosystem
// constraints beyond legal compliance. "Un sistem fara integritate e un
// participant care mananca ecosistemul din care traieste."
migrate('197_ml_integrity_constraints', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_integrity_constraints (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            constraint_id   TEXT NOT NULL UNIQUE,
            kind            TEXT NOT NULL CHECK(kind IN
                            ('venue_health','ecosystem_impact',
                             'peer_predation','liquidity_provision')),
            description     TEXT NOT NULL,
            severity        TEXT NOT NULL CHECK(severity IN ('advisory','strict')),
            is_active       INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
            ts              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlic_user_env_kind_active
            ON ml_integrity_constraints(user_id, resolved_env, kind, is_active);
    `);
});

migrate('198_ml_integrity_violations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_integrity_violations (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id          INTEGER NOT NULL,
            resolved_env     TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            violation_id     TEXT NOT NULL UNIQUE,
            constraint_id    TEXT,
            action_context   TEXT NOT NULL,
            severity_score   REAL NOT NULL CHECK(severity_score >= 0 AND severity_score <= 1),
            decision         TEXT NOT NULL CHECK(decision IN
                             ('BLOCK','REDUCE_SIZE','WARN','ACCEPT')),
            reason           TEXT,
            ts               INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mliv_user_env_decision_ts
            ON ml_integrity_violations(user_id, resolved_env, decision, ts);
    `);
});

// [OMEGA Wave 3 §103 WISDOM LAYER 2026-05-16] meta canonical PDF —
// canonical PDF §103 (line 2623). Judgment overlay: when signal quality is
// poor + decision complexity high, downgrade to simple heuristics. "Opusul
// intelligence-ului — e judecata."
migrate('195_ml_wisdom_heuristics', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_wisdom_heuristics (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            heuristic_id    TEXT NOT NULL UNIQUE,
            rule_text       TEXT NOT NULL,
            kind            TEXT NOT NULL CHECK(kind IN
                            ('timing','regime','cognition','risk')),
            priority        INTEGER NOT NULL DEFAULT 0,
            is_active       INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
            ts              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlwh_user_env_kind_active
            ON ml_wisdom_heuristics(user_id, resolved_env, kind, is_active);
    `);
});

migrate('196_ml_wisdom_overrides', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_wisdom_overrides (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id            INTEGER NOT NULL,
            resolved_env       TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            override_id        TEXT NOT NULL UNIQUE,
            heuristic_id       TEXT,
            decision_context   TEXT NOT NULL,
            complexity_score   REAL NOT NULL CHECK(complexity_score >= 0),
            signal_quality     REAL NOT NULL CHECK(signal_quality >= 0 AND signal_quality <= 1),
            ratio              REAL NOT NULL,
            override_action    TEXT NOT NULL CHECK(override_action IN
                               ('SIMPLIFY','ABSTAIN','PROCEED_NORMAL')),
            ts                 INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlwo_user_env_action_ts
            ON ml_wisdom_overrides(user_id, resolved_env, override_action, ts);
    `);
});

// [OMEGA Wave 3 §102 CROSS-DOMAIN ANALOGY 2026-05-16] R2 canonical PDF —
// canonical PDF §102 (line 2621). Structural analogies from ecology/
// epidemiology/hydrodynamics/thermodynamics applied to market. "Captureaza
// MECANISMUL, nu pattern-ul... modele matematice exportabile."
migrate('193_ml_analogy_templates', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_analogy_templates (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            template_id             TEXT NOT NULL UNIQUE,
            source_domain           TEXT NOT NULL CHECK(source_domain IN
                                    ('ecology','epidemiology','hydrodynamics',
                                     'thermodynamics','physics','network_theory','biology')),
            structural_pattern_json TEXT NOT NULL,
            market_application      TEXT NOT NULL,
            status                  TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN
                                    ('ACTIVE','RETIRED')),
            ts                      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlat_user_env_domain_status
            ON ml_analogy_templates(user_id, resolved_env, source_domain, status);
    `);
});

migrate('194_ml_analogy_matches', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_analogy_matches (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            match_id                 TEXT NOT NULL UNIQUE,
            template_id              TEXT NOT NULL,
            market_situation_id      TEXT NOT NULL,
            structural_similarity    REAL NOT NULL CHECK(structural_similarity >= 0 AND structural_similarity <= 1),
            predicted_outcome        TEXT NOT NULL,
            actual_outcome           TEXT,
            accuracy                 REAL,
            ts                       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlam_user_env_template_ts
            ON ml_analogy_matches(user_id, resolved_env, template_id, ts);
    `);
});

// [OMEGA Wave 3 §101 SOCRATIC SELF-DOUBT 2026-05-16] meta canonical PDF —
// canonical PDF §101 (line 2619). Periodic worldview falsification protocol.
// "Atacă premisele generale, nu un trade specific. Un sistem care nu se
// indoieste sistematic de sine devine dogmatic."
migrate('191_ml_socratic_sessions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_socratic_sessions (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            session_id          TEXT NOT NULL UNIQUE,
            trigger             TEXT NOT NULL CHECK(trigger IN
                                ('periodic_interval','post_good_performance','manual')),
            beliefs_examined    INTEGER NOT NULL DEFAULT 0,
            beliefs_falsified   INTEGER NOT NULL DEFAULT 0,
            status              TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN
                                ('OPEN','CLOSED')),
            ts_started          INTEGER NOT NULL,
            ts_closed           INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mlss_user_env_status_ts
            ON ml_socratic_sessions(user_id, resolved_env, status, ts_started);
    `);
});

migrate('192_ml_socratic_challenges', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_socratic_challenges (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            challenge_id            TEXT NOT NULL UNIQUE,
            session_id              TEXT NOT NULL,
            belief_id               TEXT NOT NULL,
            premise                 TEXT NOT NULL,
            counterfactual          TEXT NOT NULL,
            falsification_result    TEXT NOT NULL CHECK(falsification_result IN
                                    ('CONFIRMED','QUESTIONED','REFUTED','INCONCLUSIVE')),
            evidence_score          REAL,
            ts                      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlsc_user_env_session
            ON ml_socratic_challenges(user_id, resolved_env, session_id);
    `);
});

// [OMEGA Wave 3 §100 NARRATIVE COHERENCE 2026-05-16] R2 canonical PDF —
// canonical PDF §100 (line 2617). Causal-story validator over aggregated
// signals. "Diferit de thesis graph (dependente logice) — narrative engine
// mapeaza plauzibilitate cauzala umana."
migrate('189_ml_narrative_threads', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_narrative_threads (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id               INTEGER NOT NULL,
            resolved_env          TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            thread_id             TEXT NOT NULL UNIQUE,
            why_moving            TEXT,
            who_selling           TEXT,
            who_buying            TEXT,
            trapped_side          TEXT,
            expected_resolution   TEXT,
            coherence_score       REAL NOT NULL DEFAULT 0 CHECK(coherence_score >= 0 AND coherence_score <= 1),
            status                TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN
                                  ('COHERENT','INCOHERENT','PENDING')),
            ts                    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlnt_user_env_status
            ON ml_narrative_threads(user_id, resolved_env, status);
    `);
});

migrate('190_ml_narrative_arc_links', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_narrative_arc_links (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            link_id         TEXT NOT NULL UNIQUE,
            thread_id       TEXT NOT NULL,
            signal_id       TEXT NOT NULL,
            supports        INTEGER NOT NULL CHECK(supports IN (0,1)),
            contribution    REAL,
            reason          TEXT,
            ts              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlnl_user_env_thread
            ON ml_narrative_arc_links(user_id, resolved_env, thread_id);
    `);
});

// [OMEGA Wave 3 §99 ACTIVE SENSING POLICY 2026-05-16] R4 canonical PDF —
// canonical PDF §99 (lines 2569-2615). Cost-aware observability acquisition.
// "Merita sa consum resurse acum pentru inca o bucata de cunoastere?" Decisions
// query_now/wait/skip via IG-vs-cost ratio + deadline budget.
migrate('187_ml_observability_queries', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_observability_queries (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            query_id                TEXT NOT NULL UNIQUE,
            observation_type        TEXT NOT NULL CHECK(observation_type IN
                                    ('deep_book','venue_confirmation',
                                     'options_refresh','funding_oi_refresh',
                                     'sentiment_refresh')),
            decision                TEXT NOT NULL CHECK(decision IN
                                    ('query_now','wait','skip')),
            expected_ig             REAL NOT NULL CHECK(expected_ig >= 0),
            cost_estimate           REAL NOT NULL CHECK(cost_estimate >= 0),
            utility_ratio           REAL NOT NULL,
            deadline_remaining_ms   INTEGER NOT NULL,
            reason                  TEXT,
            ts                      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mloq_user_env_type_ts
            ON ml_observability_queries(user_id, resolved_env, observation_type, ts);
    `);
});

migrate('188_ml_observability_outcomes', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_observability_outcomes (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            outcome_id        TEXT NOT NULL UNIQUE,
            query_id          TEXT NOT NULL,
            actual_ig         REAL NOT NULL,
            actual_cost       REAL NOT NULL CHECK(actual_cost >= 0),
            verdict_changed   INTEGER NOT NULL CHECK(verdict_changed IN (0,1)),
            ts                INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mloo_user_env_query
            ON ml_observability_outcomes(user_id, resolved_env, query_id);
    `);
});

// [OMEGA Wave 3 §98 DEPENDENCY GRAPH / BLAST RADIUS 2026-05-16] R3A canonical
// PDF — canonical PDF §98 (lines 2524-2566). Operational dependency map for
// SPOF detection + blast radius via BFS. "Daca pica asta, ce altceva moare
// odata cu el?"
migrate('185_ml_dependency_nodes', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_dependency_nodes (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            node_id              TEXT NOT NULL UNIQUE,
            node_type            TEXT NOT NULL CHECK(node_type IN
                                 ('feed','detector','model','execution_path',
                                  'safety_module','monitoring')),
            name                 TEXT NOT NULL,
            owner                TEXT NOT NULL,
            blast_radius_score   REAL NOT NULL DEFAULT 0 CHECK(blast_radius_score >= 0),
            criticality          TEXT NOT NULL CHECK(criticality IN
                                 ('critical','important','optional')),
            is_active            INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
            ts                   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mldn_user_env_type
            ON ml_dependency_nodes(user_id, resolved_env, node_type);
    `);
});

migrate('186_ml_dependency_edges', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_dependency_edges (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            edge_id         TEXT NOT NULL UNIQUE,
            from_node_id    TEXT NOT NULL,
            to_node_id      TEXT NOT NULL,
            edge_type       TEXT NOT NULL CHECK(edge_type IN
                            ('depends_on','feeds','monitors')),
            strength        REAL NOT NULL CHECK(strength >= 0 AND strength <= 1),
            ts              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlde_user_env_from
            ON ml_dependency_edges(user_id, resolved_env, from_node_id);
        CREATE INDEX IF NOT EXISTS idx_mlde_user_env_to
            ON ml_dependency_edges(user_id, resolved_env, to_node_id);
    `);
});

// [OMEGA Wave 3 §97 FORGETTING ENGINE 2026-05-16] R5B canonical PDF —
// canonical PDF §97 (lines 2471-2520). TTL/decay-based knowledge expiry
// with ladder WEAKEN→QUARANTINE→RETIRE→REVIVE. "Uitarea nu este stergere
// haotica... orice cunostinta retrasa explicabila si eventual restaurata."
migrate('183_ml_knowledge_items', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_knowledge_items (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            item_id              TEXT NOT NULL UNIQUE,
            kind                 TEXT NOT NULL CHECK(kind IN
                                 ('heuristic','threshold','episodic_analogy',
                                  'prior','causal_relation','execution_rule')),
            content_json         TEXT NOT NULL,
            freshness_score      REAL NOT NULL CHECK(freshness_score >= 0 AND freshness_score <= 1),
            status               TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN
                                 ('ACTIVE','WEAKENED','QUARANTINED','RETIRED','REVIVED')),
            ts_created           INTEGER NOT NULL,
            ts_last_relevance    INTEGER NOT NULL,
            ts_status_changed    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlki_user_env_status
            ON ml_knowledge_items(user_id, resolved_env, status);
        CREATE INDEX IF NOT EXISTS idx_mlki_user_env_kind
            ON ml_knowledge_items(user_id, resolved_env, kind);
    `);
});

migrate('184_ml_forgetting_decisions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_forgetting_decisions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id     TEXT NOT NULL UNIQUE,
            item_id         TEXT NOT NULL,
            action          TEXT NOT NULL CHECK(action IN
                            ('WEAKEN','QUARANTINE','RETIRE','REVIVE')),
            prior_status    TEXT NOT NULL,
            new_status      TEXT NOT NULL,
            reason          TEXT NOT NULL,
            evidence_json   TEXT,
            ts              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlfd_user_env_item_ts
            ON ml_forgetting_decisions(user_id, resolved_env, item_id, ts);
    `);
});

// [OMEGA Wave 3 §96 SYNTHETIC MARKET WORLD MODEL 2026-05-16] R5A canonical PDF
// — canonical PDF §96 (lines 2427-2469). Plausible scenario generator with
// transition-matrix realism + KL plausibility validation. is_synthetic=1
// hard CHECK to prevent confusion with real data. "Realism structural
// obligatoriu... scenariile marcate clar."
migrate('181_ml_data_fingerprints', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_data_fingerprints (
            id                         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                    INTEGER NOT NULL,
            resolved_env               TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            fingerprint_id             TEXT NOT NULL UNIQUE,
            marginal_distributions_json TEXT NOT NULL,
            transition_matrix_json     TEXT NOT NULL,
            sample_count               INTEGER NOT NULL CHECK(sample_count >= 0),
            ts                         INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mldf_user_env_ts
            ON ml_data_fingerprints(user_id, resolved_env, ts);
    `);
});

migrate('182_ml_synthetic_scenarios', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_synthetic_scenarios (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            scenario_id              TEXT NOT NULL UNIQUE,
            regime_sequence_json     TEXT NOT NULL,
            scenario_type            TEXT NOT NULL CHECK(scenario_type IN
                                     ('trend_to_panic','range_to_squeeze',
                                      'macro_shock','venue_fragmentation','custom')),
            source_fingerprint_id    TEXT,
            plausibility_score       REAL,
            is_synthetic             INTEGER NOT NULL DEFAULT 1 CHECK(is_synthetic = 1),
            flagged_for_review       INTEGER NOT NULL DEFAULT 0 CHECK(flagged_for_review IN (0,1)),
            flag_reason              TEXT,
            ts                       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlss_user_env_type
            ON ml_synthetic_scenarios(user_id, resolved_env, scenario_type);
    `);
});

// [OMEGA Wave 3 §95 CURIOSITY ENGINE 2026-05-16] R6 canonical PDF — canonical
// PDF §95 (lines 2381-2425). Bounded exploration with explicit capital separation
// exploitation vs exploration. Ladder EXPLORE → OBSERVE → VALIDATE → GRADUATED.
// "Cat capital sunt dispus sa risc pentru a afla ceva nou?"
migrate('179_ml_curiosity_setups', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_curiosity_setups (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            setup_id            TEXT NOT NULL UNIQUE,
            hypothesis          TEXT NOT NULL,
            stage               TEXT NOT NULL DEFAULT 'EXPLORE' CHECK(stage IN
                                ('EXPLORE','OBSERVE','VALIDATE','GRADUATED','RETIRED')),
            allocated_capital   REAL NOT NULL CHECK(allocated_capital >= 0),
            max_capital_cap     REAL NOT NULL CHECK(max_capital_cap >= 0),
            observations_count  INTEGER NOT NULL DEFAULT 0,
            pnl_cumulative      REAL NOT NULL DEFAULT 0,
            ts_created          INTEGER NOT NULL,
            ts_last_updated     INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlcs_user_env_stage
            ON ml_curiosity_setups(user_id, resolved_env, stage);
    `);
});

migrate('180_ml_curiosity_trades', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_curiosity_trades (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            resolved_env  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            trade_id      TEXT NOT NULL UNIQUE,
            setup_id      TEXT NOT NULL,
            source        TEXT NOT NULL CHECK(source IN ('exploitation','exploration')),
            capital_used  REAL NOT NULL CHECK(capital_used >= 0),
            pnl           REAL NOT NULL,
            ts            INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlct_user_env_source_ts
            ON ml_curiosity_trades(user_id, resolved_env, source, ts);
        CREATE INDEX IF NOT EXISTS idx_mlct_setup_ts
            ON ml_curiosity_trades(setup_id, ts);
    `);
});

// [OMEGA Wave 3 §94 COMPLEXITY BUDGET / MDL 2026-05-16] R5B canonical PDF
// — canonical PDF §94 (line 2378). Parsimony principle: features must justify
// marginal IG vs complexity cost via MDL/BIC. "Cele care nu trec sunt eliminate,
// nu pastrate din inertie." Distinct from §90 goodhart (gaming) + §254*
// autoQuarantine (failure).
migrate('177_ml_complexity_registry', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_complexity_registry (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            feature_id        TEXT NOT NULL UNIQUE,
            complexity_units  REAL NOT NULL CHECK(complexity_units >= 0),
            information_gain  REAL,
            mdl_score         REAL,
            status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN
                              ('ACTIVE','EVALUATING','PRUNED')),
            last_evaluated    INTEGER,
            ts                INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlcr_user_env_status
            ON ml_complexity_registry(user_id, resolved_env, status);
    `);
});

migrate('178_ml_complexity_evaluations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_complexity_evaluations (
            id                     INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                INTEGER NOT NULL,
            resolved_env           TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            evaluation_id          TEXT NOT NULL UNIQUE,
            feature_id             TEXT NOT NULL,
            marginal_ig            REAL NOT NULL,
            marginal_complexity    REAL NOT NULL CHECK(marginal_complexity >= 0),
            mdl_delta              REAL,
            decision               TEXT NOT NULL CHECK(decision IN ('KEEP','WATCH','PRUNE')),
            reason                 TEXT,
            ts                     INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlce_user_env_feat_ts
            ON ml_complexity_evaluations(user_id, resolved_env, feature_id, ts);
    `);
});

// [OMEGA Wave 3 §93 REGIME GRAMMAR 2026-05-16] R2 canonical PDF — canonical
// PDF §93 (line 2376). Compositional regime language with 5 orthogonal
// primitives (volatility × trend × liquidity × derivatives × macro). Replaces
// flat taxonomy; enables hybrid/transition regimes + knowledge transfer via
// primitive overlap.
migrate('175_ml_regime_sentences', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_regime_sentences (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            sentence_id     TEXT NOT NULL UNIQUE,
            regime_label    TEXT NOT NULL,
            primitives_json TEXT NOT NULL,
            source_context  TEXT,
            ts              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlrs_user_env_ts
            ON ml_regime_sentences(user_id, resolved_env, ts);
        CREATE INDEX IF NOT EXISTS idx_mlrs_user_env_label
            ON ml_regime_sentences(user_id, resolved_env, regime_label);
    `);
});

migrate('176_ml_regime_overlaps', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_regime_overlaps (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id          INTEGER NOT NULL,
            resolved_env     TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            overlap_id       TEXT NOT NULL UNIQUE,
            sentence_a_id    TEXT NOT NULL,
            sentence_b_id    TEXT NOT NULL,
            overlap_count    INTEGER NOT NULL CHECK(overlap_count BETWEEN 0 AND 5),
            overlap_ratio    REAL NOT NULL,
            ts               INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlro_user_env_ts
            ON ml_regime_overlaps(user_id, resolved_env, ts);
    `);
});

// [OMEGA Wave 3 §92 UNCERTAINTY PROPAGATION 2026-05-16] cross-cutting canonical PDF
// — canonical PDF §92 (line 2374). Pipeline-level uncertainty compounding via
// linear/product propagation algebra. "Confidence 74% pe pipeline degradat
// = 74% ± 18%, NU ± 3%." Distinct from §20 calibration (output-only).
migrate('173_ml_uncertainty_nodes', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_uncertainty_nodes (
            id                           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                      INTEGER NOT NULL,
            resolved_env                 TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            node_id                      TEXT NOT NULL UNIQUE,
            pipeline_id                  TEXT NOT NULL,
            kind                         TEXT NOT NULL CHECK(kind IN
                                         ('data','detector','aggregator','decision')),
            point_estimate               REAL NOT NULL,
            variance                     REAL NOT NULL CHECK(variance >= 0),
            contributing_node_ids_json   TEXT,
            ts                           INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlun_user_env_pipe
            ON ml_uncertainty_nodes(user_id, resolved_env, pipeline_id);
    `);
});

migrate('174_ml_uncertainty_pipelines', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_uncertainty_pipelines (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pipeline_id                 TEXT NOT NULL UNIQUE,
            name                        TEXT NOT NULL,
            decision_node_id            TEXT,
            total_propagated_variance   REAL,
            status                      TEXT NOT NULL DEFAULT 'HEALTHY' CHECK(status IN
                                        ('HEALTHY','DEGRADED','UNRELIABLE')),
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlup_user_env_status
            ON ml_uncertainty_pipelines(user_id, resolved_env, status);
    `);
});

// [OMEGA Wave 3 §91 TOPOLOGICAL DATA ANALYSIS 2026-05-16] R2 canonical PDF
// — canonical PDF §91 (line 2372). Persistent homology primitive on price feature
// space. Detects regime shifts via Betti numbers (B0=components, B1=loops) before
// statistical drift surfaces. "Squeeze pre-explozie are topologie diferita."
migrate('171_ml_topology_snapshots', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_topology_snapshots (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            snapshot_id              TEXT NOT NULL UNIQUE,
            feature_window_size      INTEGER NOT NULL,
            betti_0                  INTEGER NOT NULL,
            betti_1                  INTEGER NOT NULL,
            persistence_diagram_json TEXT,
            regime_label             TEXT,
            ts                       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlts_user_env_ts
            ON ml_topology_snapshots(user_id, resolved_env, ts);
    `);
});

migrate('172_ml_topology_transitions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_topology_transitions (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id            INTEGER NOT NULL,
            resolved_env       TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            transition_id      TEXT NOT NULL UNIQUE,
            from_snapshot_id   TEXT NOT NULL,
            to_snapshot_id     TEXT NOT NULL,
            betti_delta_json   TEXT NOT NULL,
            transition_type    TEXT NOT NULL CHECK(transition_type IN
                               ('STABLE','REGIME_SHIFT','CORRELATION_BREAKDOWN')),
            severity           REAL NOT NULL,
            ts                 INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mltt_user_env_ts
            ON ml_topology_transitions(user_id, resolved_env, ts);
    `);
});

// [OMEGA Wave 3 §90 GOODHART'S LAW PROTECTION 2026-05-16] R5B canonical PDF
// — canonical PDF §90 (line 2370). Metric gaming prevention via composite,
// holdout (model-invisible) + rotation. "Cand metrica devine tinta, inceteaza
// sa mai fie buna." Governance layer over metrics.
migrate('169_ml_metric_registry', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_metric_registry (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            metric_id       TEXT NOT NULL UNIQUE,
            name            TEXT NOT NULL,
            formula_hash    TEXT NOT NULL,
            kind            TEXT NOT NULL CHECK(kind IN ('primary','secondary','holdout')),
            model_visible   INTEGER NOT NULL DEFAULT 1 CHECK(model_visible IN (0,1)),
            status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN
                            ('ACTIVE','RETIRED','ROTATED')),
            active_from     INTEGER NOT NULL,
            retired_at      INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mlmr_user_env_kind_status
            ON ml_metric_registry(user_id, resolved_env, kind, status);
    `);
});

migrate('170_ml_metric_rotations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_metric_rotations (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            rotation_id          TEXT NOT NULL UNIQUE,
            retired_metric_ids   TEXT NOT NULL,
            new_metric_ids       TEXT NOT NULL,
            rotation_reason      TEXT NOT NULL,
            ts                   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlmrot_user_env_ts
            ON ml_metric_rotations(user_id, resolved_env, ts);
    `);
});

// [OMEGA Wave 3 §89 TEACHER-STUDENT DISTILLATION 2026-05-16] R5A canonical PDF
// — canonical PDF §89 (lines 2335-2368). Teacher (heavy/research) vs student
// (light/live). Consistency monitoring + fallback rules. "Cat de aproape live?"
migrate('167_ml_model_distillation_pairs', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_model_distillation_pairs (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pair_id                 TEXT NOT NULL UNIQUE,
            teacher_model_id        TEXT NOT NULL,
            student_model_id        TEXT NOT NULL,
            regime_scope            TEXT NOT NULL,
            divergence_threshold    REAL NOT NULL,
            status                  TEXT NOT NULL DEFAULT 'HEALTHY' CHECK(status IN
                                    ('HEALTHY','DRIFTING','FALLBACK_ACTIVE')),
            last_validated          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlmdp_user_env_status
            ON ml_model_distillation_pairs(user_id, resolved_env, status);
    `);
});

migrate('168_ml_distillation_observations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_distillation_observations (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            observation_id      TEXT NOT NULL UNIQUE,
            pair_id             TEXT NOT NULL,
            decision_context    TEXT,
            teacher_output_json TEXT NOT NULL,
            student_output_json TEXT NOT NULL,
            divergence          REAL NOT NULL,
            fallback_triggered  INTEGER NOT NULL DEFAULT 0 CHECK(fallback_triggered IN (0,1)),
            ts                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mldo89_user_env_pair_ts
            ON ml_distillation_observations(user_id, resolved_env, pair_id, ts);
    `);
});

// [OMEGA Wave 3 §88 ACCOUNT LIQUIDATION SURFACE / PATH STRESS 2026-05-16] R3A canonical PDF
// — canonical PDF §88 (lines 2290-2333). Path-dependent margin stress simulation.
// 6 path types. "Nu doar daca pot pierde, ci prin ce secventa devine vulnerabil?"
migrate('165_ml_account_stress_simulations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_account_stress_simulations (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            simulation_id               TEXT NOT NULL UNIQUE,
            portfolio_snapshot_json     TEXT NOT NULL,
            path_type                   TEXT NOT NULL CHECK(path_type IN
                                        ('trend_adverse','whipsaw','spike_retrace',
                                         'funding_shock','volatility_expansion',
                                         'correlation_breakdown')),
            trajectory_steps_json       TEXT NOT NULL,
            distance_to_liquidation     REAL NOT NULL,
            peak_margin_used_pct        REAL NOT NULL,
            liquidation_triggered       INTEGER NOT NULL CHECK(liquidation_triggered IN (0,1)),
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlass_user_env_path_ts
            ON ml_account_stress_simulations(user_id, resolved_env, path_type, ts);
    `);
});

migrate('166_ml_liquidation_warnings', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_liquidation_warnings (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            warning_id                  TEXT NOT NULL UNIQUE,
            portfolio_snapshot_json     TEXT NOT NULL,
            closest_path                TEXT NOT NULL,
            distance                    REAL NOT NULL,
            recommended_action          TEXT NOT NULL CHECK(recommended_action IN
                                        ('CONTINUE','REDUCE_SIZE','DEFENSIVE',
                                         'CLOSE_PARTIAL','EMERGENCY_EXIT')),
            severity                    TEXT NOT NULL CHECK(severity IN
                                        ('info','warn','critical')),
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mllw_user_env_severity_ts
            ON ml_liquidation_warnings(user_id, resolved_env, severity, ts);
    `);
});

// [OMEGA Wave 3 §87 VENUE COUNTERPARTY / EXCHANGE CREDIT RISK 2026-05-16] R3A canonical PDF
// — canonical PDF §87 (lines 2242-2283). Exchange = counterparty risk + operational
// trust. 6 incident types + 7 factors. "Edge NU bate riscul existential de contraparte."
migrate('163_ml_venue_risk_scores', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_venue_risk_scores (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            venue_id                    TEXT NOT NULL,
            counterparty_risk_score     REAL NOT NULL,
            operational_trust_score     REAL NOT NULL,
            factor_scores_json          TEXT NOT NULL,
            capital_limit_pct           REAL NOT NULL,
            status                      TEXT NOT NULL CHECK(status IN
                                        ('HEALTHY','DEGRADED','RESTRICTED','MIGRATE')),
            last_evaluated              INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, venue_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mlvrs_user_env_status
            ON ml_venue_risk_scores(user_id, resolved_env, status);
    `);
});

migrate('164_ml_venue_incidents', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_venue_incidents (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            venue_id        TEXT NOT NULL,
            incident_type   TEXT NOT NULL CHECK(incident_type IN
                            ('withdrawal_freeze','insolvency','insurance_fund_weakness',
                             'regulatory_freeze','api_instability','operational_failure')),
            severity        TEXT NOT NULL CHECK(severity IN ('low','med','high','critical')),
            details_json    TEXT,
            ts              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlvi_user_env_venue_ts
            ON ml_venue_incidents(user_id, resolved_env, venue_id, ts);
    `);
});

// [OMEGA Wave 3 §86 STRATEGY CAPACITY / EDGE CAPACITY CEILING 2026-05-16] R5A canonical PDF
// — canonical PDF §86 (lines 2196-2236). Capacity estimation per strategy×regime×asset.
// "Edge-ul NU scaleaza liniar. Cat capital poate absorbi inainte sa se strice?"
migrate('161_ml_capacity_observations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_capacity_observations (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            strategy_id                 TEXT NOT NULL,
            regime                      TEXT NOT NULL,
            asset                       TEXT NOT NULL,
            deployed_capital            REAL NOT NULL,
            observed_pnl                REAL NOT NULL,
            observed_slippage_bps       REAL NOT NULL,
            observed_impact_bps         REAL NOT NULL,
            marginal_alpha              REAL,
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlco_user_env_strat_regime_asset
            ON ml_capacity_observations(user_id, resolved_env, strategy_id, regime, asset);
    `);
});

migrate('162_ml_capacity_ceilings', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_capacity_ceilings (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            strategy_id                     TEXT NOT NULL,
            regime                          TEXT NOT NULL,
            asset                           TEXT NOT NULL,
            soft_cap_capital                REAL NOT NULL,
            hard_cap_capital                REAL NOT NULL,
            diminishing_returns_inflection  REAL NOT NULL,
            last_validated                  INTEGER NOT NULL,
            status                          TEXT NOT NULL CHECK(status IN
                                            ('VALID','STALE','EXCEEDED')),
            UNIQUE(user_id, resolved_env, strategy_id, regime, asset)
        );
        CREATE INDEX IF NOT EXISTS idx_mlcc86_user_env_status
            ON ml_capacity_ceilings(user_id, resolved_env, status);
    `);
});

// [OMEGA Wave 3 §85 REAL-TIME DEADLINE / COMPUTE BUDGET GOVERNOR 2026-05-16] R4 canonical PDF
// — canonical PDF §85 (lines 2152-2191). Deadline enforcement per decision type +
// inference mode selection. "Decizie la timp > sofisticata intarziata."
migrate('159_ml_compute_budgets', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_compute_budgets (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_type       TEXT NOT NULL CHECK(decision_type IN
                                ('scalp','intraday','swing','emergency_exit')),
            deadline_ms         INTEGER NOT NULL,
            compute_budget_ms   INTEGER NOT NULL,
            safety_priority     TEXT NOT NULL CHECK(safety_priority IN
                                ('low','normal','high','critical')),
            last_updated        INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, decision_type)
        );
        CREATE INDEX IF NOT EXISTS idx_mlcb_user_env_type
            ON ml_compute_budgets(user_id, resolved_env, decision_type);
    `);
});

migrate('160_ml_inference_decisions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_inference_decisions (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            inference_id            TEXT NOT NULL UNIQUE,
            decision_type           TEXT NOT NULL CHECK(decision_type IN
                                    ('scalp','intraday','swing','emergency_exit')),
            time_remaining_ms       INTEGER NOT NULL,
            estimated_cost_ms       INTEGER NOT NULL,
            chosen_mode             TEXT NOT NULL CHECK(chosen_mode IN
                                    ('full_stack','reduced_stack','emergency_safety')),
            early_exit_triggered    INTEGER NOT NULL DEFAULT 0 CHECK(early_exit_triggered IN (0,1)),
            reasoning               TEXT,
            ts                      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlid_user_env_mode_ts
            ON ml_inference_decisions(user_id, resolved_env, chosen_mode, ts);
    `);
});

// [OMEGA Wave 3 §84 GAME THEORY ON MICROSTRUCTURE 2026-05-16] R2 canonical PDF
// — canonical PDF §84 (lines 2149-2150). Rational agent modeling: market_maker /
// liquidation / whale / arb_bot / retail. "Nu statistica — rationament strategic."
migrate('157_ml_agent_models', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_agent_models (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            agent_id                    TEXT NOT NULL UNIQUE,
            agent_type                  TEXT NOT NULL CHECK(agent_type IN
                                        ('market_maker','liquidation_engine','whale',
                                         'arb_bot','retail')),
            objective_function_json     TEXT NOT NULL,
            decision_parameters_json    TEXT NOT NULL,
            last_updated                INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlam_user_env_type
            ON ml_agent_models(user_id, resolved_env, agent_type);
    `);
});

migrate('158_ml_game_predictions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_game_predictions (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            prediction_id               TEXT NOT NULL UNIQUE,
            agent_id                    TEXT NOT NULL,
            scenario_json               TEXT NOT NULL,
            predicted_action            TEXT NOT NULL CHECK(predicted_action IN
                                        ('widen_spread','withdraw_liquidity','execute_market',
                                         'accumulate','distribute','no_action')),
            confidence                  REAL NOT NULL,
            expected_impact_bps         REAL NOT NULL,
            time_horizon_seconds        INTEGER NOT NULL,
            actual_action               TEXT,
            actual_impact_bps           REAL,
            validated                   INTEGER NOT NULL DEFAULT 0 CHECK(validated IN (0,1)),
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlgp_user_env_agent_ts
            ON ml_game_predictions(user_id, resolved_env, agent_id, ts);
    `);
});

// [OMEGA Wave 3 §83 HIERARCHICAL TEMPORAL PLANNING 2026-05-16] R3A canonical PDF
// — canonical PDF §83 (lines 2147-2148). 3-level hierarchy: strategic > tactical >
// execution. "Nivelul inferior NU poate contrazice mandatul nivelului superior."
migrate('155_ml_strategic_mandates', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_strategic_mandates (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            mandate_id          TEXT NOT NULL UNIQUE,
            level               TEXT NOT NULL CHECK(level IN
                                ('strategic','tactical','execution')),
            constraint_type     TEXT NOT NULL CHECK(constraint_type IN
                                ('max_exposure','asset_block','regime_block',
                                 'direction_limit','exposure_cap')),
            parameters_json     TEXT NOT NULL,
            valid_from          INTEGER NOT NULL,
            valid_until         INTEGER NOT NULL,
            status              TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN
                                ('ACTIVE','EXPIRED')),
            created_at          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlsm83_user_env_level_status
            ON ml_strategic_mandates(user_id, resolved_env, level, status);
    `);
});

migrate('156_ml_hierarchical_decisions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_hierarchical_decisions (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id             TEXT NOT NULL UNIQUE,
            level                   TEXT NOT NULL CHECK(level IN
                                    ('strategic','tactical','execution')),
            candidate_action_json   TEXT NOT NULL,
            mandates_checked_json   TEXT NOT NULL,
            violations_json         TEXT,
            decision                TEXT NOT NULL CHECK(decision IN
                                    ('APPROVED','REJECTED_BY_HIGHER_LEVEL','MODIFIED')),
            reasoning               TEXT,
            ts                      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlhd_user_env_level_decision
            ON ml_hierarchical_decisions(user_id, resolved_env, level, decision);
    `);
});

// [OMEGA Wave 3 §82 COMPOSITIONAL GENERALIZATION 2026-05-16] R2 canonical PDF
// — canonical PDF §82 (lines 2145-2146). Decompose novel case into known atomic
// conditions + reason via composition. "Diferit de OOD blocheaza — §82 rationam."
migrate('153_ml_condition_components', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_condition_components (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            condition_id            TEXT NOT NULL UNIQUE,
            name                    TEXT NOT NULL,
            atomic_features_json    TEXT NOT NULL,
            known_outcomes_json     TEXT NOT NULL,
            ts                      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlcc_user_env
            ON ml_condition_components(user_id, resolved_env);
    `);
});

migrate('154_ml_compositional_predictions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_compositional_predictions (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            prediction_id               TEXT NOT NULL UNIQUE,
            components_used_json        TEXT NOT NULL,
            interaction_rule            TEXT NOT NULL CHECK(interaction_rule IN
                                        ('additive','multiplicative','min','max')),
            interaction_score           REAL NOT NULL,
            predicted_outcome_json      TEXT NOT NULL,
            confidence                  REAL NOT NULL,
            actual_outcome_json         TEXT,
            validated                   INTEGER NOT NULL DEFAULT 0 CHECK(validated IN (0,1)),
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlcp_user_env_ts
            ON ml_compositional_predictions(user_id, resolved_env, ts);
    `);
});

// [OMEGA Wave 3 §81 DISTRIBUTIONAL ROBUSTNESS OPTIMIZATION 2026-05-16] R5A canonical PDF
// — canonical PDF §81 (lines 2143-2144). DRO: optimize WORST-case across uncertainty set,
// not expected value. "Robustetea in coada valoreaza mai mult decat media." Floor garantat.
migrate('151_ml_dro_uncertainty_sets', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_dro_uncertainty_sets (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            set_id                  TEXT NOT NULL UNIQUE,
            set_name                TEXT NOT NULL,
            distribution_configs_json TEXT NOT NULL,
            num_distributions       INTEGER NOT NULL,
            last_updated            INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mldus_user_env
            ON ml_dro_uncertainty_sets(user_id, resolved_env);
    `);
});

migrate('152_ml_dro_optimizations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_dro_optimizations (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            optimization_id             TEXT NOT NULL UNIQUE,
            set_id                      TEXT NOT NULL,
            candidate_params_json       TEXT NOT NULL,
            worst_case_score            REAL NOT NULL,
            average_score               REAL NOT NULL,
            robustness_premium          REAL NOT NULL,
            recommended_params_json     TEXT NOT NULL,
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mldo_user_env_ts
            ON ml_dro_optimizations(user_id, resolved_env, ts);
    `);
});

// [OMEGA Wave 3 §80 VALUE OF INFORMATION (VOI) 2026-05-16] R2 canonical PDF
// — canonical PDF §80 (lines 2141-2142). Formal VOI calculus: benefit of waiting
// minus cost of delay. "WAIT fara VOI = emotional. WAIT cu VOI = matematica."
migrate('150_ml_voi_evaluations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_voi_evaluations (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id                     TEXT NOT NULL UNIQUE,
            expected_confirmation_value     REAL NOT NULL,
            funding_cost_bps                REAL NOT NULL,
            opportunity_cost                REAL NOT NULL,
            slippage_cost_bps               REAL NOT NULL,
            total_cost                      REAL NOT NULL,
            voi                             REAL NOT NULL,
            recommendation                  TEXT NOT NULL CHECK(recommendation IN
                                            ('WAIT','ACT_NOW')),
            ts                              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlve_user_env_rec_ts
            ON ml_voi_evaluations(user_id, resolved_env, recommendation, ts);
    `);
});

// [OMEGA Wave 3 §79 GLOBAL OPPORTUNITY SCHEDULER 2026-05-16] R3A canonical PDF
// — canonical PDF §79 (lines 2086-2125). Capital auction arbitrating between
// simultaneously valid setups. "Pe care il merit cu adevarat?" + 4 budgets.
migrate('148_ml_opportunity_candidates', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_opportunity_candidates (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            opportunity_id      TEXT NOT NULL UNIQUE,
            symbol              TEXT NOT NULL,
            opportunity_score   REAL NOT NULL,
            capital_required    REAL NOT NULL,
            margin_required     REAL NOT NULL,
            classification      TEXT NOT NULL CHECK(classification IN
                                ('best_trade_available','good_but_inferior',
                                 'valid_but_crowded','valid_but_execution_poor')),
            status              TEXT NOT NULL CHECK(status IN
                                ('PENDING','ACCEPTED','DEFERRED','REPLACED','REJECTED')),
            submitted_at        INTEGER NOT NULL,
            decided_at          INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mloc_user_env_status
            ON ml_opportunity_candidates(user_id, resolved_env, status);
    `);
});

migrate('149_ml_capital_auction_decisions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_capital_auction_decisions (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            auction_id                  TEXT NOT NULL UNIQUE,
            candidates_json             TEXT NOT NULL,
            accepted_ids_json           TEXT NOT NULL,
            deferred_ids_json           TEXT NOT NULL,
            rejected_ids_json           TEXT NOT NULL,
            total_capital_available     REAL NOT NULL,
            total_capital_used          REAL NOT NULL,
            reasoning                   TEXT,
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlcad_user_env_ts
            ON ml_capital_auction_decisions(user_id, resolved_env, ts);
    `);
});

// [OMEGA Wave 3 §78 LABEL RELIABILITY / OUTCOME PURITY 2026-05-16] R5A canonical PDF
// — canonical PDF §78 (lines 2034-2080). 4-class label purity + 8 contamination
// types + sample weighting for ML training. "Rezultatul reflecta calitatea?"
migrate('146_ml_label_purity_scores', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_label_purity_scores (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            trade_id                    TEXT NOT NULL UNIQUE,
            label_classification        TEXT NOT NULL CHECK(label_classification IN
                                        ('clean','noisy','censored','excluded')),
            purity_score                REAL NOT NULL,
            sample_weight               REAL NOT NULL,
            outcome                     TEXT NOT NULL,
            contamination_reasons_json  TEXT,
            last_updated                INTEGER NOT NULL,
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mllps_user_env_class
            ON ml_label_purity_scores(user_id, resolved_env, label_classification);
    `);
});

migrate('147_ml_contamination_events', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_contamination_events (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            trade_id            TEXT NOT NULL,
            contamination_type  TEXT NOT NULL CHECK(contamination_type IN
                                ('stiri_majore','exchange_outage','venue_anomaly',
                                 'spread_spike','feed_degradation','execution_failure',
                                 'forced_flatten_extern','dead_man_event')),
            severity            TEXT NOT NULL CHECK(severity IN ('low','med','high')),
            details_json        TEXT,
            ts                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlce_user_env_trade_ts
            ON ml_contamination_events(user_id, resolved_env, trade_id, ts);
        CREATE INDEX IF NOT EXISTS idx_mlce_user_env_type_ts
            ON ml_contamination_events(user_id, resolved_env, contamination_type, ts);
    `);
});

// [OMEGA Wave 3 §77 CROSS-HORIZON ARBITRATION 2026-05-16] R3A canonical PDF
// — canonical PDF §77 (lines 1985-2024). Horizon ownership per position +
// signal conflict arbitration (HTF/MTF/LTF/micro). "Cine are autoritate?"
migrate('144_ml_horizon_ownership', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_horizon_ownership (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            position_id         TEXT NOT NULL,
            thesis_horizon      TEXT NOT NULL CHECK(thesis_horizon IN
                                ('scalp','intraday','swing','macro_defensive')),
            owner_timeframe     TEXT NOT NULL CHECK(owner_timeframe IN
                                ('HTF','MTF','LTF','micro')),
            assigned_at         INTEGER NOT NULL,
            status              TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','RETIRED')),
            retired_at          INTEGER,
            UNIQUE(user_id, resolved_env, position_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mlho_user_env_status
            ON ml_horizon_ownership(user_id, resolved_env, status);
    `);
});

migrate('145_ml_horizon_conflicts', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_horizon_conflicts (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            position_id         TEXT NOT NULL,
            signal_timeframe    TEXT NOT NULL CHECK(signal_timeframe IN
                                ('HTF','MTF','LTF','micro')),
            signal_strength     REAL NOT NULL,
            conflict_score      REAL NOT NULL,
            action_recommended  TEXT NOT NULL CHECK(action_recommended IN
                                ('ignore','hedge','reduce','exit')),
            resolution_reasoning TEXT,
            ts                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlhc_user_env_position_ts
            ON ml_horizon_conflicts(user_id, resolved_env, position_id, ts);
    `);
});

// [OMEGA Wave 3 §76 COUNTERFACTUAL MARKET BASELINE 2026-05-16] R5A canonical PDF
// — canonical PDF §76 (lines 1982-1983). Shadow HODL baseline ("nicio actiune")
// vs bot PnL. Alpha real = bot - HODL. Complement §16 attribution, §42, §242.
// "Singura masura care conteaza cu adevarat: alpha real fata de beta de piata."
migrate('142_ml_inactivity_baseline_snapshots', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_inactivity_baseline_snapshots (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            asset           TEXT NOT NULL,
            hodl_quantity   REAL NOT NULL,
            mark_price      REAL NOT NULL,
            hodl_value      REAL NOT NULL,
            initial_value   REAL NOT NULL,
            ts              INTEGER NOT NULL,
            last_updated    INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, asset)
        );
        CREATE INDEX IF NOT EXISTS idx_mlibs_user_env_asset
            ON ml_inactivity_baseline_snapshots(user_id, resolved_env, asset);
    `);
});

migrate('143_ml_alpha_observations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_alpha_observations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            period_id       TEXT NOT NULL,
            asset           TEXT NOT NULL,
            bot_pnl         REAL NOT NULL,
            baseline_pnl    REAL NOT NULL,
            alpha_real      REAL NOT NULL,
            alpha_pct       REAL NOT NULL,
            market_regime   TEXT NOT NULL CHECK(market_regime IN
                            ('bull','bear','range','high_vol','low_vol')),
            ts              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlao_user_env_period
            ON ml_alpha_observations(user_id, resolved_env, period_id);
        CREATE INDEX IF NOT EXISTS idx_mlao_user_env_ts
            ON ml_alpha_observations(user_id, resolved_env, ts);
    `);
});

// [OMEGA Wave 3 §75 BELIEF PROPAGATION 2026-05-16] R2 canonical PDF
// — canonical PDF §75 (lines 1980-1981). Real-time cascade updates through
// thesis graph edges (requires/supports/invalidates). Complement §68 thesisGraph.
// "Nu la urmatorul ciclu. Acum. Organism viu reactionand continuu."
migrate('141_ml_belief_propagation_log', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_belief_propagation_log (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            thesis_id               TEXT NOT NULL,
            source_node_id          TEXT NOT NULL,
            source_old_conf         REAL NOT NULL,
            source_new_conf         REAL NOT NULL,
            propagation_chain_json  TEXT NOT NULL,
            propagation_depth       INTEGER NOT NULL,
            ts                      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlbpl_user_env_thesis_ts
            ON ml_belief_propagation_log(user_id, resolved_env, thesis_id, ts);
    `);
});

// [OMEGA Wave 3 §74 INTERVENTIONAL REASONING / DO-CALCULUS 2026-05-16] R2 canonical PDF
// — canonical PDF §74 (lines 1978-1979). Do-calculus pre-action: price perturbation
// + queue shift + signal emission + 2nd-order reaction. Complement §40 SCM + §23 TCA.
// "A actiona inseamna a schimba mediul in care actionezi."
migrate('139_ml_intervention_predictions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_intervention_predictions (
            id                                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                             INTEGER NOT NULL,
            resolved_env                        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            intervention_id                     TEXT NOT NULL UNIQUE,
            action_type                         TEXT NOT NULL CHECK(action_type IN
                                                ('market_buy','market_sell','limit_buy','limit_sell')),
            size                                REAL NOT NULL,
            baseline_state_json                 TEXT,
            predicted_price_perturbation_bps    REAL NOT NULL,
            predicted_queue_shift               REAL NOT NULL,
            predicted_signal_emission           REAL NOT NULL,
            predicted_second_order_risk         REAL NOT NULL,
            predicted_second_order_json         TEXT,
            ts                                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlip_user_env_action_ts
            ON ml_intervention_predictions(user_id, resolved_env, action_type, ts);
    `);
});

migrate('140_ml_intervention_outcomes', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_intervention_outcomes (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            intervention_id                 TEXT NOT NULL,
            actual_price_perturbation_bps   REAL NOT NULL,
            actual_queue_shift              REAL NOT NULL,
            actual_reaction_score           REAL NOT NULL,
            prediction_error_score          REAL NOT NULL,
            ts                              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlio_intervention
            ON ml_intervention_outcomes(intervention_id);
        CREATE INDEX IF NOT EXISTS idx_mlio_user_env_ts
            ON ml_intervention_outcomes(user_id, resolved_env, ts);
    `);
});

// [OMEGA Wave 3 §73 INFORMATION-THEORETIC EDGE 2026-05-15] R5A canonical PDF
// — canonical PDF §73 (lines 1976-1977). Edge in BITS via Mutual Information.
// "MI zero = zero predictive content, indiferent cat arata frumos pe backtest."
// Redundancy + synergy detection between signals.
migrate('137_ml_signal_mi_observations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_signal_mi_observations (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            signal_id           TEXT NOT NULL,
            signal_value_bin    INTEGER NOT NULL CHECK(signal_value_bin >= 0 AND signal_value_bin <= 9),
            outcome             TEXT NOT NULL CHECK(outcome IN ('win','loss','scratch')),
            count               INTEGER NOT NULL DEFAULT 0,
            last_updated        INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, signal_id, signal_value_bin, outcome)
        );
        CREATE INDEX IF NOT EXISTS idx_mlsmo_user_env_signal
            ON ml_signal_mi_observations(user_id, resolved_env, signal_id);
    `);
});

migrate('138_ml_signal_mi_scores', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_signal_mi_scores (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            signal_id                   TEXT NOT NULL,
            mutual_information_bits     REAL NOT NULL,
            joint_entropy_bits          REAL NOT NULL,
            sample_count                INTEGER NOT NULL,
            redundancy_partners_json    TEXT,
            synergy_partners_json       TEXT,
            last_computed               INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, signal_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mlsms_user_env_mi
            ON ml_signal_mi_scores(user_id, resolved_env, mutual_information_bits);
    `);
});

// [OMEGA Wave 3 §72 META-LEARNING / RAPID ADAPTATION 2026-05-15] R5A canonical PDF
// — canonical PDF §72 (lines 1974-1975). Track adaptation speed per regime transition.
// Bot normal 3-6 weeks → bot cu meta-learning 3-5 days. Wave 3 scope = adaptation
// episode tracking + speedup measurement. Model training infra deferred to ML phase.
migrate('135_ml_meta_adaptation_episodes', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_meta_adaptation_episodes (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            episode_id                  TEXT NOT NULL UNIQUE,
            from_regime                 TEXT NOT NULL,
            to_regime                   TEXT NOT NULL,
            detection_ts                INTEGER NOT NULL,
            recalibration_complete_ts   INTEGER,
            samples_used                INTEGER NOT NULL DEFAULT 0,
            recalibration_quality_score REAL,
            status                      TEXT NOT NULL CHECK(status IN
                                        ('DETECTING','ADAPTING','CALIBRATED','FAILED')),
            failure_reason              TEXT,
            created_at                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlmae_user_env_status_ts
            ON ml_meta_adaptation_episodes(user_id, resolved_env, status, created_at);
    `);
});

migrate('136_ml_meta_baseline_speed', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_meta_baseline_speed (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            avg_adaptation_hours        REAL NOT NULL DEFAULT 0,
            p50_samples_to_calibrate    INTEGER NOT NULL DEFAULT 0,
            p95_samples_to_calibrate    INTEGER NOT NULL DEFAULT 0,
            episodes_observed           INTEGER NOT NULL DEFAULT 0,
            last_updated                INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
    `);
});

// [OMEGA Wave 3 §71 INTERNAL DEBATE / PROPOSER-CRITIC-JUDGE 2026-05-15] R6 canonical PDF
// — canonical PDF §71 (lines 1924-1973). 4 roles: proposer/critic/risk_prosecutor/judge.
// Veto power critic/risk → NO_TRADE. Per-role quality tracking. "Orice semnal trebuie
// contestat intern. Aprobarea finala = confruntare structurata, nu o singura voce."
migrate('133_ml_debate_sessions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_debate_sessions (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            debate_id                   TEXT NOT NULL UNIQUE,
            proposer_thesis             TEXT,
            critic_concerns_json        TEXT,
            risk_prosecutor_args_json   TEXT,
            judge_verdict               TEXT CHECK(judge_verdict IN
                                        ('LONG','SHORT','NO_TRADE','WAIT','REDUCE')),
            pro_score                   REAL NOT NULL DEFAULT 0,
            con_score                   REAL NOT NULL DEFAULT 0,
            vetoed_by                   TEXT NOT NULL DEFAULT 'none' CHECK(vetoed_by IN
                                        ('none','critic','risk_prosecutor','both')),
            explanation                 TEXT,
            created_at                  INTEGER NOT NULL,
            verdict_ts                  INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mlds_user_env_verdict
            ON ml_debate_sessions(user_id, resolved_env, judge_verdict);
        CREATE INDEX IF NOT EXISTS idx_mlds_user_env_ts
            ON ml_debate_sessions(user_id, resolved_env, created_at);
    `);
});

migrate('134_ml_role_performance', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_role_performance (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            role                TEXT NOT NULL CHECK(role IN
                                ('proposer','critic','risk_prosecutor','judge')),
            total_decisions     INTEGER NOT NULL DEFAULT 0,
            correct_calls       INTEGER NOT NULL DEFAULT 0,
            false_positives     INTEGER NOT NULL DEFAULT 0,
            false_negatives     INTEGER NOT NULL DEFAULT 0,
            quality_score       REAL NOT NULL DEFAULT 0,
            last_updated        INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, role)
        );
    `);
});

// [OMEGA Wave 3 §70 EVIDENCE SUFFICIENCY / MINIMUM SUPPORT GATE 2026-05-15] R5A canonical PDF
// — canonical PDF §70 (lines 1881-1921). Support count gate per setup×regime×asset×tf.
// Maturity classification: observational/shadow/probation/mature. Size multiplier
// scales with maturity. "Am voie sa cred in pattern-uri" — evidence-based gate.
migrate('131_ml_evidence_support', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_evidence_support (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            setup_key                   TEXT NOT NULL,
            setup_type                  TEXT NOT NULL,
            regime_type                 TEXT NOT NULL,
            asset                       TEXT NOT NULL,
            timeframe                   TEXT NOT NULL,
            total_observations          INTEGER NOT NULL DEFAULT 0,
            win_count                   INTEGER NOT NULL DEFAULT 0,
            quality_weighted_score      REAL NOT NULL DEFAULT 0,
            recent_observations         INTEGER NOT NULL DEFAULT 0,
            oldest_ts                   INTEGER,
            last_updated                INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, setup_key)
        );
        CREATE INDEX IF NOT EXISTS idx_mles_user_env_type
            ON ml_evidence_support(user_id, resolved_env, setup_type);
    `);
});

migrate('132_ml_setup_maturity', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_setup_maturity (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            setup_key               TEXT NOT NULL,
            maturity_class          TEXT NOT NULL CHECK(maturity_class IN
                                    ('observational','shadow','probation','mature')),
            authority_level         TEXT NOT NULL CHECK(authority_level IN
                                    ('none','reduced','full')),
            evidence_sufficient     INTEGER NOT NULL CHECK(evidence_sufficient IN (0,1)),
            size_multiplier         REAL NOT NULL,
            last_classified_ts      INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, setup_key)
        );
        CREATE INDEX IF NOT EXISTS idx_mlsm_user_env_class
            ON ml_setup_maturity(user_id, resolved_env, maturity_class);
    `);
});

// [OMEGA Wave 3 §69 SINGLE-DECISION OOD GATE 2026-05-15] R3A canonical PDF
// — canonical PDF §69 (lines 1837-1878). Per-decision novelty score across 5
// dimensions (feature/regime/microstructure/macro/portfolio). Refuse exotic cases.
// "OOD local NU e drift global. Un singur caz ciudat poate justifica NO TRADE."
migrate('129_ml_ood_manifold', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_ood_manifold (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            dimension           TEXT NOT NULL CHECK(dimension IN
                                ('feature_vector','regime_state','microstructure_state',
                                 'macro_context','portfolio_state')),
            reference_points_json TEXT NOT NULL,
            n_samples           INTEGER NOT NULL,
            last_updated        INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, dimension)
        );
        CREATE INDEX IF NOT EXISTS idx_mlom_user_env_dim
            ON ml_ood_manifold(user_id, resolved_env, dimension);
    `);
});

migrate('130_ml_ood_decisions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_ood_decisions (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id             TEXT NOT NULL,
            novelty_score           REAL NOT NULL,
            dimension_scores_json   TEXT NOT NULL,
            classification          TEXT NOT NULL CHECK(classification IN
                                    ('drift_slow','local_outlier','new_valid',
                                     'dangerous_unseen')),
            action                  TEXT NOT NULL CHECK(action IN
                                    ('continue_normal','reduce_size',
                                     'observer','alert')),
            ts                      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlod_user_env_classif_ts
            ON ml_ood_decisions(user_id, resolved_env, classification, ts);
        CREATE INDEX IF NOT EXISTS idx_mlod_user_env_action_ts
            ON ml_ood_decisions(user_id, resolved_env, action, ts);
    `);
});

// [OMEGA Wave 3 §68 THESIS GRAPH / EVIDENCE DEPENDENCY ENGINE 2026-05-15] R2 canonical PDF
// — canonical PDF §68 (lines 1784-1834). Each trade has explicit thesis structured
// as evidence DAG: 7 node types + edges (requires/supports/invalidates) + decay.
// "Nu exista trade fara thesis graph. Nu exista management din inertie."
migrate('127_ml_thesis_graphs', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_thesis_graphs (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            thesis_id               TEXT NOT NULL UNIQUE,
            position_id             TEXT,
            nodes_json              TEXT NOT NULL,
            edges_json              TEXT NOT NULL,
            break_conditions_json   TEXT,
            status                  TEXT NOT NULL CHECK(status IN
                                    ('ACTIVE','PARTIAL_DEGRADED','INVALID',
                                     'CONFIRMED_STRENGTHENED')),
            created_at              INTEGER NOT NULL,
            last_updated            INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mltg_user_env_status
            ON ml_thesis_graphs(user_id, resolved_env, status);
    `);
});

migrate('128_ml_thesis_evaluations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_thesis_evaluations (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            thesis_id           TEXT NOT NULL,
            evaluation_ts       INTEGER NOT NULL,
            overall_health      TEXT NOT NULL CHECK(overall_health IN
                                ('active','degraded','invalid','strengthened')),
            failing_nodes_json  TEXT,
            action_recommended  TEXT NOT NULL CHECK(action_recommended IN
                                ('HOLD','EXIT_PARTIAL','EXIT_FULL','SCALE_UP')),
            ts                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlte_user_env_thesis_ts
            ON ml_thesis_evaluations(user_id, resolved_env, thesis_id, ts);
    `);
});

// [OMEGA Wave 3 §67 CONFORMAL PREDICTION / ABSTENTION BOUNDS 2026-05-15] R5A canonical PDF
// — canonical PDF §67 (lines 1747-1781). Per-decision formal coverage bounds.
// Uncertainty-aware NO_TRADE fallback when prediction set too ambiguous.
// Complement §20 calibration — §67 adds per-case in/out-of-coverage zone.
migrate('125_ml_conformal_calibration', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_conformal_calibration (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            trading_mode            TEXT NOT NULL CHECK(trading_mode IN
                                    ('scalp','intraday','swing','news_risk')),
            regime_type             TEXT NOT NULL,
            coverage_target         REAL NOT NULL,
            calibration_scores_json TEXT NOT NULL,
            n_calibration_samples   INTEGER NOT NULL,
            last_updated            INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, trading_mode, regime_type)
        );
        CREATE INDEX IF NOT EXISTS idx_mlcc_user_env_mode_regime
            ON ml_conformal_calibration(user_id, resolved_env, trading_mode, regime_type);
    `);
});

migrate('126_ml_conformal_decisions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_conformal_decisions (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id         TEXT NOT NULL,
            trading_mode        TEXT NOT NULL CHECK(trading_mode IN
                                ('scalp','intraday','swing','news_risk')),
            regime_type         TEXT NOT NULL,
            prediction_set_size INTEGER NOT NULL,
            conformal_score     REAL NOT NULL,
            coverage_target     REAL NOT NULL,
            in_coverage_zone    INTEGER NOT NULL CHECK(in_coverage_zone IN (0,1)),
            decision_action     TEXT NOT NULL CHECK(decision_action IN
                                ('TRADE','NO_TRADE','WAIT')),
            ts                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlcd_user_env_mode_ts
            ON ml_conformal_decisions(user_id, resolved_env, trading_mode, ts);
        CREATE INDEX IF NOT EXISTS idx_mlcd_user_env_regime_ts
            ON ml_conformal_decisions(user_id, resolved_env, regime_type, ts);
    `);
});

// [OMEGA Wave 3 §54 XAI LAYER 2026-05-15] cross-cutting canonical PDF
// — canonical PDF §54 (line 1588). Top-3 factori + confidence interval +
// counterfactual "ce ar fi trebuit sa se schimbe ca sa nu iau trade-ul".
// Complement §25 explainability — §54 adds CI + counterfactual breakeven.
migrate('124_ml_xai_explanations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_xai_explanations (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id         TEXT NOT NULL,
            action              TEXT NOT NULL,
            top_factors_json    TEXT NOT NULL,
            counterfactual_json TEXT,
            confidence_level    REAL NOT NULL,
            ts                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlxe_user_env_decision
            ON ml_xai_explanations(user_id, resolved_env, decision_id);
        CREATE INDEX IF NOT EXISTS idx_mlxe_user_env_ts
            ON ml_xai_explanations(user_id, resolved_env, ts);
    `);
});

// [OMEGA Wave 3 §52 DRIFT ORCHESTRATION 2026-05-15] R5A canonical PDF
// — canonical PDF §52 (line 1586). Monitor PSI/KS/Brier; canary retrain on
// PSI > 0.2 OR Brier degrade; block live deploy until validation passes.
// Complement §21 driftDetection (compute metrics) — §52 orchestrates response.
migrate('122_ml_drift_orchestration_state', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_drift_orchestration_state (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            model_id        TEXT NOT NULL,
            status          TEXT NOT NULL CHECK(status IN
                            ('HEALTHY','DEGRADED','RETRAIN_QUEUED',
                             'CANARY_RUNNING','BLOCKED')),
            psi             REAL,
            brier           REAL,
            ks              REAL,
            last_trigger_ts INTEGER,
            updated_at      INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, model_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mldos_user_env_status
            ON ml_drift_orchestration_state(user_id, resolved_env, status);
    `);
});

migrate('123_ml_retrain_canary_runs', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_retrain_canary_runs (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            model_id            TEXT NOT NULL,
            canary_run_id       TEXT NOT NULL UNIQUE,
            trigger_metric      TEXT NOT NULL CHECK(trigger_metric IN ('psi','brier','ks')),
            trigger_value       REAL NOT NULL,
            status              TEXT NOT NULL CHECK(status IN
                                ('PENDING','RUNNING','PASSED','FAILED')),
            live_blocked        INTEGER NOT NULL CHECK(live_blocked IN (0,1)),
            metrics_json        TEXT,
            started_at          INTEGER NOT NULL,
            completed_at        INTEGER,
            ts                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlrcr_user_env_model_ts
            ON ml_retrain_canary_runs(user_id, resolved_env, model_id, ts);
    `);
});

// [OMEGA Wave 3 §51 TCA/FILL SIMULATOR 2026-05-15] R4 canonical PDF
// — canonical PDF §51 (line 1585). L2 depth historic + per-exchange-per-symbol
// slippage calibration + backtest/shadow integration. Complement §23 TCA.
migrate('119_ml_l2_depth_snapshots', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_l2_depth_snapshots (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            exchange        TEXT NOT NULL,
            symbol          TEXT NOT NULL,
            bids_json       TEXT NOT NULL,
            asks_json       TEXT NOT NULL,
            mid_price       REAL NOT NULL,
            ts              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mll2_user_env_ex_sym_ts
            ON ml_l2_depth_snapshots(user_id, resolved_env, exchange, symbol, ts);
    `);
});

migrate('120_ml_slippage_calibration', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_slippage_calibration (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            exchange        TEXT NOT NULL,
            symbol          TEXT NOT NULL,
            sample_count    INTEGER NOT NULL,
            alpha           REAL NOT NULL,
            beta            REAL NOT NULL,
            r_squared       REAL NOT NULL,
            last_updated    INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, exchange, symbol)
        );
        CREATE INDEX IF NOT EXISTS idx_mlsc_user_env_ex_sym
            ON ml_slippage_calibration(user_id, resolved_env, exchange, symbol);
    `);
});

migrate('121_ml_fill_simulations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_fill_simulations (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            exchange                    TEXT NOT NULL,
            symbol                      TEXT NOT NULL,
            mode                        TEXT NOT NULL CHECK(mode IN ('backtest','shadow')),
            order_side                  TEXT NOT NULL CHECK(order_side IN ('LONG','SHORT')),
            order_size                  REAL NOT NULL,
            simulated_avg_price         REAL NOT NULL,
            simulated_slippage_bps      REAL NOT NULL,
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlfs_user_env_mode_ts
            ON ml_fill_simulations(user_id, resolved_env, mode, ts);
        CREATE INDEX IF NOT EXISTS idx_mlfs_user_env_ex_sym_ts
            ON ml_fill_simulations(user_id, resolved_env, exchange, symbol, ts);
    `);
});

// [OMEGA Wave 3 §66 REGULATORY / COMPLIANCE LAYER 2026-05-15] cross-cutting canonical PDF
// — canonical PDF §66 (lines 1741-1742). Self-pattern detection: quote stuffing,
// wash trading, event-sync manipulation. Logs economic justification per decision.
// "Exact ceea ce un regulator ar cere daca vreodata activitatea e investigata."
migrate('117_ml_compliance_violations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_compliance_violations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            violation_type  TEXT NOT NULL CHECK(violation_type IN
                            ('quote_stuff','wash_trade','event_sync','cancel_rate','other')),
            severity        TEXT NOT NULL CHECK(severity IN ('info','warn','critical')),
            context_json    TEXT,
            action_taken    TEXT,
            ts              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlcv_user_env_type_ts
            ON ml_compliance_violations(user_id, resolved_env, violation_type, ts);
    `);
});

migrate('118_ml_economic_justifications', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_economic_justifications (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id                     TEXT NOT NULL,
            action_type                     TEXT NOT NULL,
            justification_text              TEXT NOT NULL,
            supporting_signals_json         TEXT,
            expected_economic_outcome       TEXT,
            ts                              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlej_user_env_decision
            ON ml_economic_justifications(user_id, resolved_env, decision_id);
        CREATE INDEX IF NOT EXISTS idx_mlej_user_env_ts
            ON ml_economic_justifications(user_id, resolved_env, ts);
    `);
});

// [OMEGA Wave 3 §65 EPISODIC MEMORY / FINGERPRINTING 2026-05-15] R5A canonical PDF
// — canonical PDF §65 (lines 1739-1740). "Mai am vazut asta": multi-factor
// fingerprint (funding/OI/BTC.D/macro) + cosine similarity vs historical archive.
// Bayesian prior, NOT prediction. "Analogie structurata."
migrate('115_ml_episodic_archive', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_episodic_archive (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            archive_id              TEXT NOT NULL,
            label                   TEXT NOT NULL,
            start_ts                INTEGER NOT NULL,
            end_ts                  INTEGER NOT NULL,
            fingerprint_vector_json TEXT NOT NULL,
            outcome_summary         TEXT,
            lessons_json            TEXT,
            created_at              INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, archive_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mlea_user_env
            ON ml_episodic_archive(user_id, resolved_env);
    `);
});

migrate('116_ml_fingerprint_matches', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_fingerprint_matches (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            query_fingerprint_json      TEXT NOT NULL,
            archive_id                  TEXT NOT NULL,
            similarity_score            REAL NOT NULL,
            ranked_position             INTEGER NOT NULL,
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlfm_user_env_ts
            ON ml_fingerprint_matches(user_id, resolved_env, ts);
    `);
});

// [OMEGA Wave 3 §64 REGIME DURATION MODELING 2026-05-15] R2 canonical PDF
// — canonical PDF §64 (lines 1737-1738). Trend 3 weeks vs 3 days = different
// probability. Track regime age + duration distribution + adjust aggressiveness.
// "Un bot care stie ca trendul are medie 80h si sunt deja 72h se comporta diferit."
migrate('113_ml_regime_history', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_regime_history (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            regime_type         TEXT NOT NULL CHECK(regime_type IN
                                ('trend_up','trend_down','range','chop','volatile_expansion')),
            start_ts            INTEGER NOT NULL,
            end_ts              INTEGER,
            duration_ms         INTEGER,
            terminated_naturally INTEGER CHECK(terminated_naturally IN (0,1)),
            created_at          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlrh_user_env_type_ts
            ON ml_regime_history(user_id, resolved_env, regime_type, start_ts);
    `);
});

migrate('114_ml_regime_current_state', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_regime_current_state (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            regime_type         TEXT NOT NULL CHECK(regime_type IN
                                ('trend_up','trend_down','range','chop','volatile_expansion')),
            started_at          INTEGER NOT NULL,
            history_id          INTEGER,
            last_updated        INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
    `);
});

// [OMEGA Wave 3 §63 DEAD MAN'S SWITCH 2026-05-15] R0 canonical PDF
// — canonical PDF §63 (lines 1735-1736). External independent process receives
// heartbeat; if absent → close positions + cancel orders + alert. Wave 3 scope
// = state primitives + emergency ledger. External watchdog deployment = ops layer.
// "Nu e modul de siguranta. E siguranta de rezerva a modului de siguranta."
migrate('111_ml_heartbeat_state', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_heartbeat_state (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            last_heartbeat_ts       INTEGER NOT NULL,
            expected_interval_ms    INTEGER NOT NULL,
            staleness_threshold_ms  INTEGER NOT NULL,
            dead_threshold_ms       INTEGER NOT NULL,
            status                  TEXT NOT NULL CHECK(status IN
                                    ('HEALTHY','STALE','DEAD')),
            last_check_ts           INTEGER,
            updated_at              INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
        CREATE INDEX IF NOT EXISTS idx_mlhs_user_env
            ON ml_heartbeat_state(user_id, resolved_env);
    `);
});

migrate('112_ml_dead_man_emergencies', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_dead_man_emergencies (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            trigger_reason              TEXT NOT NULL CHECK(trigger_reason IN
                                        ('heartbeat_dead','manual','external_watchdog')),
            positions_closed_count      INTEGER,
            orders_cancelled_count      INTEGER,
            alert_sent                  INTEGER NOT NULL DEFAULT 0 CHECK(alert_sent IN (0,1)),
            completed_at                INTEGER,
            ts                          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mldme_user_env_ts
            ON ml_dead_man_emergencies(user_id, resolved_env, ts);
    `);
});

// [OMEGA Wave 3 §62 ADVERSARIAL MARKET AWARENESS 2026-05-15] R3A canonical PDF
// — canonical PDF §62 (lines 1733-1734). Bot is observable. Randomize timing
// /sizing/order-type so HFT/MM cannot read pattern. Self-fingerprint detection.
// "NU pentru executie mai buna, ci pentru ca pattern-ul sa nu fie citit."
migrate('109_ml_fingerprint_observations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_fingerprint_observations (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            setup_type              TEXT NOT NULL,
            entry_delay_ms          INTEGER NOT NULL,
            size_jitter_pct         REAL NOT NULL,
            order_type_used         TEXT NOT NULL CHECK(order_type_used IN
                                    ('market','limit','post_only','ioc')),
            actual_slippage_bps     REAL NOT NULL,
            expected_slippage_bps   REAL NOT NULL,
            slippage_excess_bps     REAL NOT NULL,
            ts                      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlfo_user_env_setup_ts
            ON ml_fingerprint_observations(user_id, resolved_env, setup_type, ts);
    `);
});

migrate('110_ml_fingerprint_alerts', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_fingerprint_alerts (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            setup_type              TEXT NOT NULL,
            slippage_trend_bps      REAL NOT NULL,
            samples_in_window       INTEGER NOT NULL,
            severity                TEXT NOT NULL CHECK(severity IN ('warn','critical')),
            ts                      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlfa_user_env_setup_ts
            ON ml_fingerprint_alerts(user_id, resolved_env, setup_type, ts);
    `);
});

// [OMEGA Wave 3 §61 RUNTIME INVARIANT ENGINE 2026-05-15] R3A canonical PDF
// — canonical PDF §61 (lines 1710-1732). 6 built-in invariants + custom registry.
// Pre/post action verification + lock/alert/snapshot/forensic_log on violation.
// "Gardul logic suprem care sta deasupra modulelor."
migrate('108_ml_invariant_violations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_invariant_violations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            invariant_id    TEXT NOT NULL,
            severity        TEXT NOT NULL CHECK(severity IN ('warn','critical')),
            context_json    TEXT,
            snapshot_id     TEXT,
            action_taken    TEXT NOT NULL CHECK(action_taken IN
                            ('lock','alert','snapshot','forensic_log','noop')),
            ts              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mliv_user_env_inv_ts
            ON ml_invariant_violations(user_id, resolved_env, invariant_id, ts);
        CREATE INDEX IF NOT EXISTS idx_mliv_severity_ts
            ON ml_invariant_violations(severity, ts);
    `);
});

// [OMEGA Wave 3 §60 DATA INTEGRITY / POISONING / CONSENSUS 2026-05-15] R3A canonical PDF
// — canonical PDF §60 (lines 1688-1707). Distinct from §13 dataFreshness (fresh ≠ true).
// Multi-source consensus + trust score per source + 6 anomaly detectors.
// "Un feed proaspat poate fi totusi mincinos."
migrate('106_ml_source_trust', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_source_trust (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            source_id           TEXT NOT NULL,
            trust_score         REAL NOT NULL,
            total_observations  INTEGER NOT NULL DEFAULT 0,
            anomaly_count       INTEGER NOT NULL DEFAULT 0,
            last_anomaly_ts     INTEGER,
            status              TEXT NOT NULL CHECK(status IN
                                ('TRUSTED','DEGRADED','EXCLUDED')),
            updated_at          INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, source_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mlst_user_env_status
            ON ml_source_trust(user_id, resolved_env, status);
    `);
});

migrate('107_ml_anomaly_events', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_anomaly_events (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            source_id       TEXT NOT NULL,
            anomaly_type    TEXT NOT NULL CHECK(anomaly_type IN
                            ('impossible_print','ts_spoof','packet_corrupt',
                             'venue_anomaly','sentiment_burst','signal_burst')),
            severity        TEXT NOT NULL CHECK(severity IN ('low','med','high')),
            payload_hash    TEXT,
            details_json    TEXT,
            ts              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlae_user_env_source_ts
            ON ml_anomaly_events(user_id, resolved_env, source_id, ts);
        CREATE INDEX IF NOT EXISTS idx_mlae_anomaly_type_ts
            ON ml_anomaly_events(anomaly_type, ts);
    `);
});

// [OMEGA Wave 3 §59 UNIFIED OBJECTIVE / UTILITY FUNCTION 2026-05-15] meta canonical PDF
// — canonical PDF §59 (lines 1667-1685). Single scalar utility = "verdictul final".
// totalUtility = expectancy_after_costs - tail_risk - turnover - latency - concentration
// "Scorurile sunt ingrediente. Utility function este verdictul."
migrate('105_ml_utility_evaluations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_utility_evaluations (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id         TEXT NOT NULL,
            expectancy_after_costs  REAL NOT NULL,
            tail_risk_penalty   REAL NOT NULL,
            turnover_penalty    REAL NOT NULL,
            latency_penalty     REAL NOT NULL,
            concentration_penalty  REAL NOT NULL,
            crowding_penalty    REAL NOT NULL,
            total_utility       REAL NOT NULL,
            weights_json        TEXT,
            ts                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlue_user_env_ts
            ON ml_utility_evaluations(user_id, resolved_env, ts);
        CREATE INDEX IF NOT EXISTS idx_mlue_decision_id
            ON ml_utility_evaluations(decision_id);
    `);
});

// [OMEGA Wave 3 §58 FACTOR RISK DECOMPOSITION + NETTING 2026-05-15] R3A canonical PDF
// — canonical PDF §58 (lines 1645-1664). 6-factor exposure (btc_beta/market_beta
// /vol/liquidity/funding/macro). Detects when "3 diferite" sunt acelasi pariu.
// "Corelatia = fotografie. Factor decomposition = anatomie."
migrate('103_ml_factor_exposures', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_factor_exposures (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            position_id     TEXT NOT NULL,
            btc_beta        REAL NOT NULL,
            market_beta     REAL NOT NULL,
            vol_factor      REAL NOT NULL,
            liquidity_factor  REAL NOT NULL,
            funding_factor  REAL NOT NULL,
            macro_factor    REAL NOT NULL,
            gross_exposure  REAL NOT NULL,
            ts              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlfe_user_env_pos_ts
            ON ml_factor_exposures(user_id, resolved_env, position_id, ts);
    `);
});

migrate('104_ml_netting_decisions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_netting_decisions (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_type       TEXT NOT NULL CHECK(decision_type IN
                                ('NET','HEDGE','REDUCE','REPLACE','HOLD')),
            positions_json      TEXT NOT NULL,
            dominant_factor     TEXT NOT NULL,
            factor_overlap_score REAL NOT NULL,
            recommended_action  TEXT,
            ts                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlnd_user_env_ts
            ON ml_netting_decisions(user_id, resolved_env, ts);
    `);
});

// [OMEGA Wave 3 §57 EXACTLY-ONCE EXECUTION / IDEMPOTENCY 2026-05-15] R4 canonical PDF
// — canonical PDF §57 (lines 1626-1642). Unique intent_id + dedup submit/cancel
// + retry safety + immutable execution ledger. "Idempotency previne ca acel
// ceva sa se intample." UNIQUE constraint at DB = physically impossible duplicate.
migrate('102_ml_execution_intents', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_execution_intents (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            intent_id       TEXT NOT NULL UNIQUE,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            action_type     TEXT NOT NULL CHECK(action_type IN
                            ('place_order','cancel_order','modify_order','close_position')),
            payload_hash    TEXT NOT NULL,
            payload_json    TEXT NOT NULL,
            status          TEXT NOT NULL CHECK(status IN
                            ('PENDING','CONFIRMED','REJECTED','EXPIRED')),
            order_id        TEXT,
            fill_id         TEXT,
            position_id     TEXT,
            reject_reason   TEXT,
            created_at      INTEGER NOT NULL,
            confirmed_at    INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mlei_user_env_status_ts
            ON ml_execution_intents(user_id, resolved_env, status, created_at);
        CREATE INDEX IF NOT EXISTS idx_mlei_user_env_payload_hash
            ON ml_execution_intents(user_id, resolved_env, payload_hash);
    `);
});

// [OMEGA Wave 3 §53 ADVERSARIAL SUITE MONTE-CARLO 2026-05-15] R-1 canonical PDF
// — canonical PDF §53 (line 1587). Defines stress scenarios (funding_spike,
// oi_cascade, venue_outage, flash_crash, liquidity_evaporation), runs Monte-Carlo
// PnL distribution. Distinct de §44 adversarialSelfTester (binary safety hold).
migrate('101_ml_adversarial_mc_runs', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_adversarial_mc_runs (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            scenario_type           TEXT NOT NULL CHECK(scenario_type IN
                                    ('funding_spike','oi_cascade','venue_outage',
                                     'flash_crash','liquidity_evaporation')),
            scenario_params_json    TEXT,
            num_simulations         INTEGER NOT NULL,
            base_pnl                REAL NOT NULL,
            mc_mean_pnl             REAL NOT NULL,
            mc_p5_pnl               REAL NOT NULL,
            mc_p50_pnl              REAL NOT NULL,
            mc_p95_pnl              REAL NOT NULL,
            mc_p99_pnl              REAL NOT NULL,
            max_drawdown            REAL NOT NULL,
            max_loss                REAL NOT NULL,
            stress_factor           REAL NOT NULL,
            ts                      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlamc_user_env_scenario_ts
            ON ml_adversarial_mc_runs(user_id, resolved_env, scenario_type, ts);
    `);
});

// [OMEGA Wave 3 §56 LIMIT QUEUE POSITION + FILL PROBABILITY 2026-05-15] R4 canonical PDF
// — canonical PDF §56 (lines 1605-1623). Models queue rank at submit, fill prob
// decay over time + movement, maker vs taker decision, cancel penalty, missed-fill risk.
// "Diferenta dintre model bun pe hartie si executie reala."
migrate('100_ml_queue_fill_observations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_queue_fill_observations (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol                  TEXT NOT NULL,
            side                    TEXT NOT NULL CHECK(side IN ('LONG','SHORT')),
            queue_rank_est          INTEGER NOT NULL,
            fill_prob_est           REAL NOT NULL,
            decay_rate              REAL NOT NULL,
            maker_cost_bps          REAL NOT NULL,
            taker_cost_bps          REAL NOT NULL,
            decision                TEXT NOT NULL CHECK(decision IN ('maker','taker','reprice','abstain')),
            actual_filled           INTEGER NOT NULL CHECK(actual_filled IN (0,1)),
            time_to_fill_ms         INTEGER,
            cancelled               INTEGER NOT NULL CHECK(cancelled IN (0,1)),
            cancel_count            INTEGER NOT NULL DEFAULT 0,
            ts                      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlqf_user_env_symbol_ts
            ON ml_queue_fill_observations(user_id, resolved_env, symbol, ts);
        CREATE INDEX IF NOT EXISTS idx_mlqf_user_env_decision_ts
            ON ml_queue_fill_observations(user_id, resolved_env, decision, ts);
    `);
});

// [OMEGA Wave 3 §55 POINT-IN-TIME FEATURE STORE + REPLAY 2026-05-15] R0 canonical PDF
// — canonical PDF §55 (lines 1589-1602). Coloana vertebrala a reproductibilitatii:
// salveaza features as-of time (NOT recalculated), snapshot complet (market+features
// +model+vetos+scores+intent), replay determinist tick-cu-tick, time-travel debugging.
migrate('099_ml_pit_snapshots', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_pit_snapshots (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            snapshot_type       TEXT NOT NULL CHECK(snapshot_type IN
                                ('decision','tick','event','manual')),
            ts                  INTEGER NOT NULL,
            market_state_json   TEXT,
            feature_state_json  TEXT,
            model_output_json   TEXT,
            vetos_json          TEXT,
            scores_json         TEXT,
            order_intent_json   TEXT,
            created_at          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlpit_user_env_ts
            ON ml_pit_snapshots(user_id, resolved_env, ts);
        CREATE INDEX IF NOT EXISTS idx_mlpit_user_env_type_ts
            ON ml_pit_snapshots(user_id, resolved_env, snapshot_type, ts);
    `);
});

// [OMEGA Wave 3 §42 COUNTERFACTUAL LEARNING ENGINE 2026-05-15] R5A canonical PDF
// — canonical PDF §42 (lines 1522-1523). Shadow alternative simulations
// (alt entry/SL/size/TP on actual price path) to calibrate future params.
// "Singura metoda obiectiva de optimizare a executiei fara look-ahead bias."
migrate('098_ml_counterfactual_runs', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_counterfactual_runs (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            trade_id            TEXT NOT NULL,
            param_type          TEXT NOT NULL CHECK(param_type IN ('entry','sl','size','tp')),
            actual_value        REAL NOT NULL,
            alt_value           REAL NOT NULL,
            actual_pnl          REAL NOT NULL,
            alt_pnl             REAL NOT NULL,
            would_have_hit_sl   INTEGER NOT NULL CHECK(would_have_hit_sl IN (0,1)),
            would_have_hit_tp   INTEGER NOT NULL CHECK(would_have_hit_tp IN (0,1)),
            improvement         REAL NOT NULL,
            created_at          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlcf_user_env_ts
            ON ml_counterfactual_runs(user_id, resolved_env, created_at);
        CREATE INDEX IF NOT EXISTS idx_mlcf_user_env_param
            ON ml_counterfactual_runs(user_id, resolved_env, param_type, created_at);
        CREATE INDEX IF NOT EXISTS idx_mlcf_trade
            ON ml_counterfactual_runs(trade_id);
    `);
});

// [OMEGA Wave 3 §41 STRATEGY CROWDING DETECTION 2026-05-15] R5A canonical PDF
// — canonical PDF §41 (lines 1520-1521). 3rd drift type: edge decay from
// crowding. Not detectable by KS/PSI (distribution looks normal).
migrate('097_ml_strategy_crowding', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_strategy_crowding (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            setup_type      TEXT NOT NULL CHECK(setup_type IN
                            ('liquidity_sweep','funding_extreme','cross_venue_div',
                             'stop_run_reclaim','cvd_divergence','breakout',
                             'mean_reversion','momentum_continuation')),
            hit_rate        REAL NOT NULL,
            slippage_bps    REAL,
            created_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlsc_user_env_setup_ts
            ON ml_strategy_crowding(user_id, resolved_env, setup_type, created_at);
    `);
});

// [OMEGA Wave 3 §40 STRUCTURAL CAUSAL MODEL 2026-05-15] R2 canonical PDF
// — canonical PDF §40 (lines 1518-1519). Explicit causal chains
// (DXY → risk → liquidations → bounce) for distribution-shift robustness.
migrate('096_ml_structural_causal_model', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_causal_chains (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            chain_id            TEXT NOT NULL UNIQUE,
            name                TEXT NOT NULL,
            edges_json          TEXT NOT NULL,
            expected_outcome    TEXT NOT NULL,
            created_at          INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ml_causal_observations (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            chain_id            TEXT NOT NULL,
            state               TEXT NOT NULL CHECK(state IN
                                ('LATENT','TRIGGERED','RESOLVED','INVALIDATED')),
            trigger_event_json  TEXT,
            evidence_json       TEXT,
            actual_outcome      TEXT,
            matched             INTEGER,
            created_at          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlco_user_env_chain
            ON ml_causal_observations(user_id, resolved_env, chain_id);
        CREATE INDEX IF NOT EXISTS idx_mlco_state
            ON ml_causal_observations(state, created_at);
    `);
});

// [OMEGA Wave 3 §48 ENSEMBLE VOTING 2026-05-15] R6 canonical PDF
// — canonical PDF §48 (lines 1562-1572). 3-model voting:
//   3/3 → 100% size, 2/3 → 50%, 1-0/3 → NO_TRADE.
migrate('095_ml_ensemble_votes', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_ensemble_votes (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id         TEXT NOT NULL,
            model_type          TEXT NOT NULL,
            vote_action         TEXT NOT NULL CHECK(vote_action IN ('BUY','SELL','NO_TRADE')),
            vote_confidence     REAL NOT NULL,
            created_at          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlev_user_env_dec
            ON ml_ensemble_votes(user_id, resolved_env, decision_id);
        CREATE INDEX IF NOT EXISTS idx_mlev_model_action
            ON ml_ensemble_votes(model_type, vote_action);
    `);
});

// [OMEGA Wave 3 §47 INACTIVITY DECAY 2026-05-15] meta canonical PDF
// — canonical PDF §47 (lines 1553-1560). Anti-FOMO: threshold INCREASES
// after X days of inactivity (spec EXPLICIT: do NOT decrease).
migrate('094_ml_inactivity_state', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_inactivity_state (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            last_trade_at   INTEGER NOT NULL,
            updated_at      INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
    `);
});

// [OMEGA Wave 3 §49 HUMAN OVERRIDE PERFORMANCE TRACKER 2026-05-15] Operator canonical PDF
// — canonical PDF §49 (lines 1574-1582). Log override + delta vs hypothetical.
migrate('093_ml_override_performance', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_override_performance (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pos_id                      TEXT,
            symbol                      TEXT,
            direction                   TEXT,
            override_type               TEXT NOT NULL CHECK(override_type IN
                                        ('entry','exit','size','sl','tp','cancel','skip')),
            original_decision_json      TEXT NOT NULL,
            final_decision_json         TEXT NOT NULL,
            actor                       TEXT NOT NULL,
            actual_pnl                  REAL,
            hypothetical_bot_pnl        REAL,
            delta                       REAL,
            created_at                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlop_user_env_ts
            ON ml_override_performance(user_id, resolved_env, created_at);
    `);
});

// [OMEGA Wave 3 §45 LATENCY-AWARE EXECUTION 2026-05-15] R4 canonical PDF
// — canonical PDF §45 (lines 1528-1538). E2E latency measurement + behavior
// adaptation: <50ms scalping / 50-150ms swing / >150ms observer.
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §45.
migrate('092_ml_latency_aware', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_latency_measurements (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            e2e_ms                  INTEGER NOT NULL,
            feed_to_decision_ms     INTEGER,
            decision_to_order_ms    INTEGER,
            order_to_ack_ms         INTEGER,
            mode                    TEXT NOT NULL CHECK(mode IN
                                    ('SCALPING_ALLOWED','SWING_ONLY','OBSERVER_ONLY')),
            created_at              INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ml_latency_modes (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            mode                    TEXT NOT NULL CHECK(mode IN
                                    ('SCALPING_ALLOWED','SWING_ONLY','OBSERVER_ONLY')),
            current_latency_ms      INTEGER NOT NULL,
            updated_at              INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
        CREATE INDEX IF NOT EXISTS idx_mllm_user_env_ts
            ON ml_latency_measurements(user_id, resolved_env, created_at);
    `);
});

// [OMEGA Wave 3 §44 ADVERSARIAL SELF-TESTING 2026-05-15] cross-cutting canonical PDF
// — canonical PDF §44 (lines 1526-1527). Red team scenarios periodic.
// 6 scenario types: veto_bypass / state_machine_edge / api_saturation /
// latency_injection / feed_desync / flash_crash.
migrate('091_ml_adversarial', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_adversarial_runs (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            scenario_id                 TEXT NOT NULL UNIQUE,
            name                        TEXT NOT NULL,
            type                        TEXT NOT NULL CHECK(type IN
                                        ('veto_bypass','state_machine_edge','api_saturation',
                                         'latency_injection','feed_desync','flash_crash')),
            payload_json                TEXT NOT NULL,
            expected_safety_trigger     TEXT NOT NULL,
            severity                    TEXT NOT NULL CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
            created_at                  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ml_adversarial_results (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            scenario_id         TEXT NOT NULL,
            mode                TEXT NOT NULL CHECK(mode IN ('SIMULATED','ACTUAL')),
            passed              INTEGER NOT NULL CHECK(passed IN (0,1)),
            observations_json   TEXT NOT NULL,
            duration_ms         INTEGER,
            created_at          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlares_user_env_sc_ts
            ON ml_adversarial_results(user_id, resolved_env, scenario_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_mlares_passed
            ON ml_adversarial_results(scenario_id, passed);
    `);
});

// [OMEGA Wave 3 §46 LOSS STREAK DETECTION GEOMETRIC 2026-05-15] R3A canonical PDF
// — canonical PDF §46 (lines 1540-1551). Geometric size reduction pe consecutive
// losses: 2→50% / 3→25% / 4+→0 + gradual recovery on wins.
// Distinct de §246* (post-DD recovery) și OBS-2 (pre-production ramp).
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §46.
migrate('090_ml_loss_streak_state', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_loss_streak_state (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            consecutive_losses  INTEGER NOT NULL DEFAULT 0,
            size_multiplier     REAL NOT NULL DEFAULT 1.0,
            last_win_at         INTEGER,
            recovery_progress   INTEGER NOT NULL DEFAULT 0,
            updated_at          INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
    `);
});

// [OMEGA Wave 3 §43 NO TRADE EXPLAINABILITY 2026-05-15] cross-cutting canonical PDF
// — canonical PDF §43 (lines 1524-1525). Closes asymmetric learning gap:
// log every NO_TRADE refusal + retrospective outcome (MISSED 3R+ / GOOD_SKIP / NEUTRAL).
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §43.
migrate('089_ml_no_trade_decisions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_no_trade_decisions (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol                  TEXT,
            signal_candidate_json   TEXT NOT NULL,
            veto_reason             TEXT NOT NULL,
            score                   REAL NOT NULL,
            threshold               REAL NOT NULL,
            regime                  TEXT,
            expected_direction      TEXT,
            created_at              INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ml_no_trade_outcomes (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            no_trade_id             INTEGER NOT NULL,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            market_move_r           REAL NOT NULL,
            direction_matched       INTEGER NOT NULL CHECK(direction_matched IN (0,1)),
            outcome_type            TEXT NOT NULL CHECK(outcome_type IN
                                    ('MISSED_OPPORTUNITY','GOOD_SKIP','NEUTRAL','PENDING')),
            validated_at            INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlntd_user_env_reason_ts
            ON ml_no_trade_decisions(user_id, resolved_env, veto_reason, created_at);
        CREATE INDEX IF NOT EXISTS idx_mlnto_user_env_outcome
            ON ml_no_trade_outcomes(user_id, resolved_env, outcome_type);
    `);
});

// [OMEGA Wave 3 RAID-R REACTION SYSTEM 2026-05-15] Operator A-Z raid
// — A-Z raid MUST-ADD item R. Ω personality commentary on Manual/DSL trades.
migrate('088_ml_omega_reactions', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_omega_reactions (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pos_id              TEXT,
            outcome_type        TEXT NOT NULL CHECK(outcome_type IN
                                ('big_win','win','breakeven','loss','big_loss','missed_opportunity')),
            reaction_text       TEXT NOT NULL,
            trade_context_json  TEXT NOT NULL,
            created_at          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlor_user_env_ts
            ON ml_omega_reactions(user_id, resolved_env, created_at);
    `);
});

// [OMEGA Wave 3 RAID-Q QUIET HOURS SCHEDULER 2026-05-15] Operator A-Z raid
// — A-Z raid MUST-ADD item Q. Window-based quiet hours for alert suppression.
migrate('087_ml_quiet_hours', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_quiet_hours (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            windows_json    TEXT NOT NULL,
            timezone        TEXT NOT NULL DEFAULT 'UTC',
            actor           TEXT NOT NULL,
            enabled         INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
            updated_at      INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
    `);
});

// [OMEGA Wave 3 RAID-O OPERATOR PRESENCE 2026-05-15] Operator A-Z raid
// — A-Z raid MUST-ADD item O. Heartbeat-driven operator presence detection.
migrate('086_ml_operator_presence', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_operator_presence (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            state               TEXT NOT NULL CHECK(state IN ('ACTIVE','AWAY','UNKNOWN')),
            last_activity_at    INTEGER NOT NULL,
            updated_at          INTEGER NOT NULL,
            explicit_reason     TEXT,
            UNIQUE(user_id, resolved_env)
        );
        CREATE TABLE IF NOT EXISTS ml_operator_activity_log (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            activity_type       TEXT NOT NULL,
            source              TEXT,
            created_at          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mloal_user_env_ts
            ON ml_operator_activity_log(user_id, resolved_env, created_at);
    `);
});

// [OMEGA Wave 3 RAID-N TELEGRAM PUSHER 2026-05-15] Operator A-Z raid
// — A-Z raid MUST-ADD item N. Critical-only Telegram push with dedup + audit.
migrate('085_ml_telegram_pushes', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_telegram_pushes (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            event_type      TEXT NOT NULL,
            severity        TEXT NOT NULL CHECK(severity IN ('CRITICAL','HIGH','MEDIUM','LOW')),
            message         TEXT NOT NULL,
            payload_json    TEXT NOT NULL,
            dedup_key       TEXT,
            delivery_status TEXT NOT NULL DEFAULT 'PENDING'
                            CHECK(delivery_status IN ('PENDING','SENT','FAILED','DEDUPED')),
            created_at      INTEGER NOT NULL,
            delivered_at    INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mltp_user_env_dedup
            ON ml_telegram_pushes(user_id, resolved_env, dedup_key, created_at);
    `);
});

// [OMEGA Wave 3 RAID-L LATENCY BUDGET GUARD 2026-05-15] cross-cutting A-Z raid
// — A-Z raid MUST-ADD item L. Hard cap latency budgets (voice_push <100ms).
migrate('084_ml_latency_budget_log', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_latency_budget_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            task_type       TEXT NOT NULL,
            latency_ms      INTEGER NOT NULL,
            budget_ms       INTEGER NOT NULL,
            accepted        INTEGER NOT NULL CHECK(accepted IN (0,1)),
            drop_reason     TEXT,
            created_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mllbl_user_env_task_ts
            ON ml_latency_budget_log(user_id, resolved_env, task_type, created_at);
        CREATE INDEX IF NOT EXISTS idx_mllbl_accepted
            ON ml_latency_budget_log(accepted, created_at);
    `);
});

// [OMEGA Wave 3 RAID-M MOOD EMA TRACKER 2026-05-15] cross-cutting A-Z raid
// — A-Z raid MUST-ADD item M. Anti-flicker EMA smoothing for Ω mood.
migrate('083_ml_mood_state', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_mood_state (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            smoothed_score  REAL NOT NULL,
            sample_count    INTEGER NOT NULL DEFAULT 0,
            last_raw_score  REAL,
            updated_at      INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
        CREATE TABLE IF NOT EXISTS ml_mood_history (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            raw_score       REAL NOT NULL,
            smoothed_score  REAL NOT NULL,
            alpha_used      REAL,
            created_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlmh_user_env_ts
            ON ml_mood_history(user_id, resolved_env, created_at);
    `);
});

// [OMEGA Wave 3 OBS-6 DB CONTENTION MONITOR 2026-05-15] R0 expert-obs P1 PERF
// — expert observation 2026-05-05. SQLite contention monitoring at scale.
migrate('082_ml_db_contention', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_db_contention_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            operation       TEXT NOT NULL,
            duration_ms     INTEGER NOT NULL,
            lock_wait_ms    INTEGER,
            error_msg       TEXT,
            created_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mldcl_user_env_op_ts
            ON ml_db_contention_log(user_id, resolved_env, operation, created_at);
        CREATE INDEX IF NOT EXISTS idx_mldcl_duration
            ON ml_db_contention_log(duration_ms);
    `);
});

// [OMEGA Wave 3 OBS-5 FAILURE MODE RUNBOOK 2026-05-15] Operator expert-obs P1
// — expert observation 2026-05-05. Ops-grade runbooks per failure mode.
migrate('081_ml_runbooks', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_runbooks (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            runbook_id          TEXT NOT NULL UNIQUE,
            name                TEXT NOT NULL,
            trigger_signals_json TEXT NOT NULL,
            steps_json          TEXT NOT NULL,
            auto_execute        INTEGER NOT NULL DEFAULT 0,
            severity            TEXT NOT NULL CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
            created_at          INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ml_runbook_executions (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            runbook_id          TEXT NOT NULL,
            mode                TEXT NOT NULL CHECK(mode IN ('AUTO','MANUAL','DRY_RUN')),
            actor               TEXT NOT NULL,
            matched_signals_json TEXT NOT NULL,
            steps_executed      INTEGER NOT NULL DEFAULT 0,
            status              TEXT NOT NULL CHECK(status IN ('EXECUTED','SIMULATED','FAILED')),
            created_at          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlre_user_env_rb_ts
            ON ml_runbook_executions(user_id, resolved_env, runbook_id, created_at);
    `);
});

// [OMEGA Wave 3 OBS-3 CONFIG ROLLBACK <60s 2026-05-15] R0 expert-obs P1
// — expert observation 2026-05-05. Rapid config rollback distinct de §19 versionRegistry.
// Spec: project_ml_v3_expert_observations_2026-05-05.md
migrate('080_ml_config_rollback', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_config_snapshots (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            config_key      TEXT NOT NULL,
            value_json      TEXT NOT NULL,
            version         TEXT NOT NULL,
            is_active       INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
            actor           TEXT NOT NULL,
            reason          TEXT,
            created_at      INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ml_config_rollback_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            config_key      TEXT NOT NULL,
            from_version    TEXT,
            to_version      TEXT NOT NULL,
            reason          TEXT NOT NULL,
            actor           TEXT NOT NULL,
            duration_ms     INTEGER,
            created_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlcs_user_env_key_active
            ON ml_config_snapshots(user_id, resolved_env, config_key, is_active);
        CREATE INDEX IF NOT EXISTS idx_mlcrl_user_env_ts
            ON ml_config_rollback_log(user_id, resolved_env, created_at);
    `);
});

// [OMEGA Wave 3 OBS-2 SIZE-RAMP ALGORITHM 2026-05-15] R3A expert-obs P1
// — expert observation 2026-05-05. Size ramping for first N live trades.
// Spec: project_ml_v3_expert_observations_2026-05-05.md
migrate('079_ml_size_ramp_state', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_size_ramp_state (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            stage               TEXT NOT NULL CHECK(stage IN
                                ('STAGE_1','STAGE_2','STAGE_3','STAGE_4','COMPLETE')),
            trades_completed    INTEGER NOT NULL DEFAULT 0,
            wins_count          INTEGER NOT NULL DEFAULT 0,
            losses_count        INTEGER NOT NULL DEFAULT 0,
            current_multiplier  REAL NOT NULL DEFAULT 0.25,
            planned_trades      INTEGER NOT NULL,
            started_at          INTEGER NOT NULL,
            completed_at        INTEGER,
            updated_at          INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
    `);
});

// [OMEGA Wave 3 EXEC-N3 RATE-LIMIT PRIORITY QUEUE 2026-05-15] R4 audit-gap P2 LAST
// — audit gap 2026-05-05. API rate limit budget priority queue.
// Spec: project_ml_v3_additional_gaps_audit_2026-05-05.md
migrate('078_ml_api_request_queue', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_api_request_queue (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            exchange        TEXT NOT NULL,
            request_type    TEXT NOT NULL,
            priority        TEXT NOT NULL CHECK(priority IN ('CRITICAL','HIGH','NORMAL','LOW')),
            payload_json    TEXT NOT NULL,
            status          TEXT NOT NULL CHECK(status IN ('PENDING','SENT','EXPIRED','DROPPED')),
            deadline_at     INTEGER,
            enqueued_at     INTEGER NOT NULL,
            processed_at    INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mlaq_user_env_ex_prio_status
            ON ml_api_request_queue(user_id, resolved_env, exchange, priority, status);
    `);
});

// [OMEGA Wave 3 DOM-N1 SPOOFING DETECTOR 2026-05-15] R2 audit-gap P2
// — audit gap 2026-05-05. Spoofing + fake wall + layering pattern detection.
// Spec: project_ml_v3_additional_gaps_audit_2026-05-05.md
migrate('077_ml_spoofing_events', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_spoofing_events (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            event_type      TEXT NOT NULL CHECK(event_type IN
                            ('suspected_spoof','fake_wall_detected',
                             'pulled_orders','layering_pattern')),
            symbol          TEXT,
            severity        REAL NOT NULL DEFAULT 0,
            payload_json    TEXT NOT NULL,
            created_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlse_user_env_sym_ts
            ON ml_spoofing_events(user_id, resolved_env, symbol, created_at);
    `);
});

// [OMEGA Wave 3 EXEC-N1 SMART POST-ONLY PRICE-SHADE 2026-05-15] R4 audit-gap P1
// — audit gap 2026-05-05. Post-only order optimization with adaptive
// price shading + fill outcome tracking + rolling stats.
// Spec: project_ml_v3_additional_gaps_audit_2026-05-05.md
migrate('076_ml_post_only_orders', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_post_only_orders (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pos_id          TEXT,
            exchange        TEXT NOT NULL,
            side            TEXT NOT NULL CHECK(side IN ('BUY','SELL')),
            placed_price    REAL NOT NULL,
            shaded_price    REAL NOT NULL,
            reference_best  REAL NOT NULL,
            urgency         TEXT NOT NULL CHECK(urgency IN ('LOW','MEDIUM','HIGH')),
            strategy        TEXT NOT NULL CHECK(strategy IN ('PASSIVE','MODERATE','AGGRESSIVE')),
            outcome         TEXT NOT NULL CHECK(outcome IN ('FILLED','MISSED','PENDING','CANCELLED')),
            filled_price    REAL,
            cost_savings_bps REAL,
            created_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlpoo_user_env_ex_ts
            ON ml_post_only_orders(user_id, resolved_env, exchange, created_at);
    `);
});

// [OMEGA Wave 3 OPS-N1 OPERATOR PANIC BUTTON 2026-05-15] Operator audit-gap P1
// — audit gap 2026-05-05. Hard halt mechanism.
// Compose §29 setBreakerLevel('L5') + §34 setEmergencyKillSwitch('ON').
// Manual recovery only (does NOT auto-reset breaker on clear).
// Spec: /root/.claude/projects/-root/memory/project_ml_v3_additional_gaps_audit_2026-05-05.md
migrate('075_ml_panic_events', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_panic_events (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            severity        TEXT NOT NULL CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
            reason          TEXT NOT NULL,
            actor           TEXT NOT NULL,
            state           TEXT NOT NULL CHECK(state IN ('ACTIVE','CLEARED')),
            triggered_at    INTEGER NOT NULL,
            cleared_at      INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mlpe_user_env_state
            ON ml_panic_events(user_id, resolved_env, state);
    `);
});

// [OMEGA Wave 3 EXEC-N2 FUNDING-AWARE EXIT TIMING 2026-05-15] R4 audit-gap P1 HIGH
// — audit gap 2026-05-05. 8h funding ping awareness + exposure cost + exit
// recommendation. Per (user × env × pos) evaluation log.
// Spec: /root/.claude/projects/-root/memory/project_ml_v3_additional_gaps_audit_2026-05-05.md
migrate('074_ml_funding_evaluations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_funding_evaluations (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pos_id                  TEXT,
            current_funding_rate    REAL NOT NULL,
            time_to_funding_ms      INTEGER NOT NULL,
            estimated_cost_usd      REAL NOT NULL,
            recommendation          TEXT NOT NULL CHECK(recommendation IN ('HOLD','REDUCE','EXIT')),
            should_exit             INTEGER NOT NULL CHECK(should_exit IN (0, 1)),
            reason                  TEXT,
            created_at              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlfe_user_env_pos_ts
            ON ml_funding_evaluations(user_id, resolved_env, pos_id, created_at);
    `);
});

// [OMEGA Wave 3 §9 FORMULA LUI CORECTA DE GANDIRE 2026-05-15] R2
// — canonical PDF §9 (lines 749-760). Per-decision step trace through
// 12 thinking steps. Conductor module for brain reasoning pipeline.
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §9.
migrate('073_ml_thinking_traces', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_thinking_traces (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id     TEXT NOT NULL,
            step            TEXT NOT NULL CHECK(step IN
                            ('OBSERVA','CLASIFICA_REGIMUL','VERIFICA_BIAS_GLOBAL',
                             'MAPEAZA_STRUCTURA','IDENTIFICA_LICHIDITATEA',
                             'VERIFICA_PARTICIPAREA_REALA',
                             'VERIFICA_MACRO_CORELATII_OPTIONS_VENUES',
                             'EVALUAZA_RISCUL_SI_EXECUTIA','CALCULEAZA_AVANTAJUL',
                             'DECIDE_SAU_STA','GESTIONEAZA','INVATA')),
            step_index      INTEGER NOT NULL,
            input_json      TEXT,
            output_json     TEXT,
            status          TEXT NOT NULL CHECK(status IN ('OK','SKIPPED','ERROR')),
            duration_ms     INTEGER,
            created_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mltt_user_env_dec_step
            ON ml_thinking_traces(user_id, resolved_env, decision_id, step_index);
        CREATE INDEX IF NOT EXISTS idx_mltt_step_status
            ON ml_thinking_traces(step, status);
    `);
});

// [OMEGA Wave 3 §26 ML AVANSAT SI RL PENTRU MANAGEMENT 2026-05-15] R6
// — canonical PDF §26 (lines 1174-1188). 2 tables:
//   ml_rl_decisions: per-action audit (proposed/allowed/blockers/reward)
//   ml_rl_validation_state: per (user × env) validation stage (UNIQUE)
// 5 INVARIANTS enforced "in cusca de risc" (lines 1184-1188).
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §26.
migrate('072_ml_rl_management', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_rl_decisions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pos_id          TEXT,
            action_type     TEXT NOT NULL CHECK(action_type IN
                            ('take_partial','activate_trailing','force_exit',
                             'leave_runner','aggressive_reduce')),
            proposed_at     INTEGER,
            allowed         INTEGER NOT NULL DEFAULT 0,
            blockers_json   TEXT NOT NULL DEFAULT '[]',
            executed        INTEGER NOT NULL DEFAULT 0,
            reward          REAL,
            created_at      INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ml_rl_validation_state (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            stage           TEXT NOT NULL CHECK(stage IN
                            ('simulator','backtest','shadow','probation','live')),
            since           INTEGER NOT NULL,
            reason          TEXT NOT NULL,
            actor           TEXT NOT NULL,
            created_at      INTEGER NOT NULL,
            updated_at      INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
        CREATE INDEX IF NOT EXISTS idx_mlrd_user_env_pos
            ON ml_rl_decisions(user_id, resolved_env, pos_id);
    `);
});

// [OMEGA Wave 3 §32 OPTIONS / GEX / MAX PAIN 2026-05-15] R2
// — canonical PDF §32 (lines 1313-1321). Options market context observations.
// INVARIANT line 1321: "options data nu este obligatoriu semnal primar,
//                       dar poate modifica bias-ul, riscul si probabilitatea
//                       de reversion / pinning"
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §32.
migrate('071_ml_options', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_options_observations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            observation_type TEXT NOT NULL CHECK(observation_type IN
                            ('gex_profile','gamma_pin','gamma_squeeze',
                             'max_pain','expiration_proximity')),
            payload_json    TEXT NOT NULL,
            symbol          TEXT,
            created_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mloo_user_env_type_ts
            ON ml_options_observations(user_id, resolved_env, observation_type, created_at);
    `);
});

// [OMEGA Wave 3 §31 CROSS-VENUE / SMART MONEY / CASCADE PREDICTION 2026-05-15] R2
// — canonical PDF §31 (lines 1291-1307). Per-signal rolling observations
// stats for 10 smart money signal types. Per (user × env × signal × regime).
// "Unde este durerea celorlalti" + "Cine controleaza miscarea".
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §31.
migrate('070_ml_smart_money', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_smart_money_observations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            signal_type     TEXT NOT NULL CHECK(signal_type IN
                            ('institutional_divergence','venue_divergence',
                             'smart_money_signature','absorption_post_sweep',
                             'hidden_distribution','cluster_short_above',
                             'cluster_long_below','cascade_probability',
                             'heatmap_pressure','liquidation_magnet')),
            sample_count    INTEGER NOT NULL DEFAULT 0,
            mean_strength   REAL NOT NULL DEFAULT 0,
            regime          TEXT,
            created_at      INTEGER NOT NULL,
            updated_at      INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, signal_type, regime)
        );
        CREATE INDEX IF NOT EXISTS idx_mlsmo_user_env_sig
            ON ml_smart_money_observations(user_id, resolved_env, signal_type);
    `);
});

// [OMEGA Wave 3 §38 DEFINITIA INTELIGENTEI REALE 2026-05-15] meta
// — canonical PDF §38 (lines 1451-1469). Per-criterion intelligence audit:
// 12 spec criteria + 4 anti-patterns. Records satisfied/score/evidence
// per (user × env). Self-assessment dashboard for OMEGA brain.
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §38.
migrate('069_ml_intelligence_checks', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_intelligence_checks (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            resolved_env  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            criterion     TEXT NOT NULL CHECK(criterion IN
                          ('knows_regime','knows_context','knows_no_edge',
                           'knows_signal_conflict','knows_execution_compromised',
                           'knows_data_degraded','knows_model_drift',
                           'knows_portfolio_overloaded','knows_when_to_reduce',
                           'knows_when_to_stop','knows_how_to_explain',
                           'knows_how_to_learn_honestly')),
            satisfied     INTEGER NOT NULL CHECK(satisfied IN (0, 1)),
            score         REAL,
            evidence_json TEXT,
            created_at    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlic_user_env_crit_ts
            ON ml_intelligence_checks(user_id, resolved_env, criterion, created_at);
    `);
});

// [OMEGA Wave 3 §37 FILOZOFIA CORECTA DE FRECVENTA 2026-05-15] meta
// — canonical PDF §37 (lines 1416-1445). 2 tables:
//   ml_frequency_mode_state:       current mode per (user × env) UNIQUE
//   ml_frequency_mode_transitions: append-only mode change history
// 4 modes per spec: SNIPER/SCALP/OBSERVER/ADAPTIVE.
// Principle: "regimul pietei decide frecventa" (line 1419).
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §37.
migrate('068_ml_frequency_modes', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_frequency_mode_state (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            resolved_env  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            mode          TEXT NOT NULL CHECK(mode IN ('SNIPER','SCALP','OBSERVER','ADAPTIVE')),
            since         INTEGER NOT NULL,
            reason        TEXT NOT NULL,
            actor         TEXT NOT NULL,
            regime        TEXT,
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
        CREATE TABLE IF NOT EXISTS ml_frequency_mode_transitions (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            resolved_env  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            from_mode     TEXT,
            to_mode       TEXT NOT NULL CHECK(to_mode IN ('SNIPER','SCALP','OBSERVER','ADAPTIVE')),
            reason        TEXT NOT NULL,
            actor         TEXT NOT NULL,
            regime        TEXT,
            created_at    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlfmt_user_env_ts
            ON ml_frequency_mode_transitions(user_id, resolved_env, created_at);
    `);
});

// [OMEGA Wave 3 §36 REGULI NUMERICE SI PRAGURI CONCRETE 2026-05-15] R3B
// — canonical PDF §36 (lines 1390-1410). 2 tables forming single source
// of truth for ALL numerical thresholds:
//   ml_thresholds_canonical: name UNIQUE, default_value, category (17 spec)
//                            Pre-populated on module load with concrete values.
//   ml_threshold_overrides:  per (user × env × regime) override, with audit.
//                            Resolution chain: regime-override > general-override > canonical.
// INVARIANT (line 1409-1410): "Aceste valori nu trebuie lasate vagi in
// implementare. Trebuie definite explicit." Enforced via validateAllSet().
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §36.
migrate('067_ml_thresholds', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_thresholds_canonical (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL UNIQUE,
            category        TEXT NOT NULL,
            default_value   REAL NOT NULL,
            description     TEXT,
            version         TEXT NOT NULL,
            created_at      INTEGER NOT NULL,
            updated_at      INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ml_threshold_overrides (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            threshold_name  TEXT NOT NULL,
            value           REAL NOT NULL,
            regime          TEXT,
            reason          TEXT NOT NULL,
            actor           TEXT NOT NULL,
            created_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlto_user_env_name_reg
            ON ml_threshold_overrides(user_id, resolved_env, threshold_name, regime);
        CREATE INDEX IF NOT EXISTS idx_mltc_category
            ON ml_thresholds_canonical(category);
    `);
});

// [OMEGA Wave 3 §23 SIMULARE COSTURI / TCA / MARKET IMPACT 2026-05-15] R4
// — canonical PDF §23 (lines 1102-1116). Per-decision TCA estimate +
// optional actual reconciliation:
//   estimated_*_bps = pre-trade estimates per slippage/fees/total
//   actual_*_bps    = filled-in post-fill from execution layer
//   is_viable       = INVARIANT (line 1116) check at decision time
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §23.
migrate('066_ml_tca_estimates', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_tca_estimates (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pos_id                      TEXT,
            exchange                    TEXT NOT NULL,
            order_size_usd              REAL NOT NULL,
            estimated_slippage_bps      REAL NOT NULL,
            estimated_fees_bps          REAL NOT NULL,
            estimated_total_cost_bps    REAL NOT NULL,
            actual_slippage_bps         REAL,
            actual_fees_bps             REAL,
            is_viable                   INTEGER NOT NULL CHECK(is_viable IN (0, 1)),
            expected_edge_bps           REAL,
            created_at                  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mltca_user_env_ex_ts
            ON ml_tca_estimates(user_id, resolved_env, exchange, created_at);
        CREATE INDEX IF NOT EXISTS idx_mltca_viable
            ON ml_tca_estimates(is_viable, created_at);
    `);
});

// [OMEGA Wave 3 §27 PATTERNS TEMPORALE 2026-05-15] R2
// — canonical PDF §27 (lines 1194-1211). Per-pattern rolling outcome stats:
//   Track how 10 temporal patterns (sessions, day-of-week, EOM/EOQ, etc.)
//   correlate with trade outcomes per (user × env × regime).
// UNIQUE per (user_id, resolved_env, pattern, regime) — one row per cell.
// INVARIANT (line 1211): "NU sunt semnale suficiente singure pentru intrare"
// — enforced in evaluateScoreAdjustment which caps cumulative effect.
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §27.
migrate('065_ml_temporal_observations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_temporal_observations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pattern         TEXT NOT NULL CHECK(pattern IN
                            ('seasonality_intraday','day_of_week',
                             'friday_evening','sunday_morning','wednesday_noon',
                             'end_of_month','end_of_quarter',
                             'london_open','new_york_open','asia_drift')),
            sample_count    INTEGER NOT NULL DEFAULT 0,
            mean_outcome    REAL NOT NULL DEFAULT 0,
            regime          TEXT,
            last_seen_at    INTEGER,
            created_at      INTEGER NOT NULL,
            updated_at      INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, pattern, regime)
        );
        CREATE INDEX IF NOT EXISTS idx_mlto_user_env_pat_reg
            ON ml_temporal_observations(user_id, resolved_env, pattern, regime);
    `);
});

// [OMEGA Wave 3 §35 MONITORING / LOGGING / KPI DASHBOARDS 2026-05-15] cross-cutting
// — canonical PDF §35 (lines 1358-1384). 2 tables:
//   ml_observability_events: generic event stream (13 spec event types)
//   ml_kpi_snapshots:        KPI time-series (11 spec KPIs)
// Cross-cutting foundation. Closes OBS-4 alert channel by providing uniform
// pipe for all rings (R0-R6 + Operator + Cross-cutting) to emit observability.
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §35.
migrate('064_ml_observability', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_observability_events (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            resolved_env  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            event_type    TEXT NOT NULL CHECK(event_type IN
                          ('decision_log','raw_features','detector_score',
                           'meta_score','execution_event','fill','pnl',
                           'slippage','latency','reconciliation_status',
                           'drift_status','veto_reason','explainability_snapshot')),
            payload_json  TEXT NOT NULL,
            regime        TEXT,
            pos_id        TEXT,
            ts            INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ml_kpi_snapshots (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            resolved_env  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            kpi           TEXT NOT NULL CHECK(kpi IN
                          ('kpi_per_regime','pnl_per_regime','hit_rate_per_regime',
                           'avg_rr','avg_slippage','avg_latency','fill_quality',
                           'confidence_calibration','drift_monitor',
                           'false_breakout_monitor','venue_divergence_monitor')),
            value         REAL NOT NULL,
            regime        TEXT,
            ts            INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mloe_user_env_type_ts
            ON ml_observability_events(user_id, resolved_env, event_type, ts);
        CREATE INDEX IF NOT EXISTS idx_mlks_user_env_kpi_ts
            ON ml_kpi_snapshots(user_id, resolved_env, kpi, ts);
        CREATE INDEX IF NOT EXISTS idx_mlks_regime
            ON ml_kpi_snapshots(regime, ts);
    `);
});

// [OMEGA Wave 3 §25 EXPLAINABILITY / SHAP / LIMBAJ UMAN 2026-05-15] cross-cutting
// — canonical PDF §25 (lines 1156-1168). 2 tables:
//   ml_explanations:    per-decision SHAP values + derived top3 factors
//                       + decisive factor + human-language explanation
//   ml_feature_health:  rolling feature importance tracking + degradation
//                       detection + disable-in-model flag
// First module in NEW _crosscutting/ directory. Serves R2/R5A/R6 rings.
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §25.
migrate('063_ml_explanations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_explanations (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id         TEXT NOT NULL,
            pos_id              TEXT,
            decision            TEXT NOT NULL,
            shap_values_json    TEXT NOT NULL,
            top_positive_json   TEXT NOT NULL,
            top_negative_json   TEXT NOT NULL,
            decisive_factor     TEXT,
            human_language      TEXT,
            model_version       TEXT,
            created_at          INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, decision_id)
        );
        CREATE TABLE IF NOT EXISTS ml_feature_health (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            feature_name        TEXT NOT NULL,
            sample_count        INTEGER NOT NULL DEFAULT 0,
            mean_importance     REAL NOT NULL DEFAULT 0,
            last_seen_at        INTEGER,
            disabled            INTEGER NOT NULL DEFAULT 0,
            disabled_reason     TEXT,
            disabled_at         INTEGER,
            created_at          INTEGER NOT NULL,
            updated_at          INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, feature_name)
        );
        CREATE INDEX IF NOT EXISTS idx_mlex_user_env_dec
            ON ml_explanations(user_id, resolved_env, decision_id);
        CREATE INDEX IF NOT EXISTS idx_mlfh_user_env_feat
            ON ml_feature_health(user_id, resolved_env, feature_name);
    `);
});

// [OMEGA Wave 3 §24 ARHITECTURA ML SI DETECTORS 2026-05-15] R2
// — canonical PDF §24 (lines 1122-1150). Detector registry + per-call outputs:
//   ml_detector_registry: catalog of detectors with input/output schema,
//                         time horizon, weight, allowed regimes, model type
//   ml_detector_outputs:  audit log of detector invocations per user×env
// Per Plan v3 wrap-not-rewrite: this is the registry SCAFFOLD; concrete
// detector implementations come in subsequent waves with real ML models.
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §24.
migrate('062_ml_detector_registry', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_detector_registry (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            detector_id           TEXT NOT NULL UNIQUE,
            kind                  TEXT NOT NULL CHECK(kind IN
                                  ('order_flow','liquidity_sweep','regime_classifier',
                                   'derivatives_stress','macro_filter','venue_divergence',
                                   'options_context','portfolio_risk','execution_quality')),
            input_schema_json     TEXT NOT NULL,
            output_schema_json    TEXT NOT NULL,
            time_horizon_ms       INTEGER NOT NULL,
            weight                REAL NOT NULL CHECK(weight >= 0 AND weight <= 1),
            allowed_regimes_json  TEXT NOT NULL,
            model_type            TEXT NOT NULL CHECK(model_type IN
                                  ('LIGHTGBM','XGBOOST','TRANSFORMER','LSTM','HEURISTIC')),
            model_version         TEXT NOT NULL,
            enabled               INTEGER NOT NULL DEFAULT 1,
            created_at            INTEGER NOT NULL,
            updated_at            INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ml_detector_outputs (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id               INTEGER NOT NULL,
            resolved_env          TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            detector_id           TEXT NOT NULL,
            pos_id                TEXT,
            output_json           TEXT NOT NULL,
            regime                TEXT,
            model_version         TEXT,
            created_at            INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mldo_user_env_det_ts
            ON ml_detector_outputs(user_id, resolved_env, detector_id, created_at);
    `);
});

// [OMEGA Wave 3 §12 STATE MACHINE A POZITIEI 2026-05-15] R4
// — canonical PDF §12 (lines 828-849). 12-state FSM lifecycle (IDLE →
// WATCHING → ARMED → READY → ENTERED → MANAGING → PARTIAL_TAKEN →
// RUNNER_ACTIVE → EXITED + INVALIDATED/LOCKED/COOLDOWN safety states).
// 2 tables: state (current per pos, UNIQUE) + transitions (audit log).
// First OMEGA module in R4 execution layer.
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §12.
migrate('061_ml_position_state', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_position_state (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            resolved_env  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pos_id        TEXT NOT NULL,
            symbol        TEXT NOT NULL,
            state         TEXT NOT NULL CHECK(state IN
                          ('IDLE','WATCHING','ARMED','READY','ENTERED','MANAGING',
                           'PARTIAL_TAKEN','RUNNER_ACTIVE','EXITED','INVALIDATED',
                           'LOCKED','COOLDOWN')),
            state_since   INTEGER NOT NULL,
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, pos_id)
        );
        CREATE TABLE IF NOT EXISTS ml_position_transitions (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            resolved_env  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pos_id        TEXT NOT NULL,
            from_state    TEXT NOT NULL CHECK(from_state IN
                          ('IDLE','WATCHING','ARMED','READY','ENTERED','MANAGING',
                           'PARTIAL_TAKEN','RUNNER_ACTIVE','EXITED','INVALIDATED',
                           'LOCKED','COOLDOWN')),
            to_state      TEXT NOT NULL CHECK(to_state IN
                          ('IDLE','WATCHING','ARMED','READY','ENTERED','MANAGING',
                           'PARTIAL_TAKEN','RUNNER_ACTIVE','EXITED','INVALIDATED',
                           'LOCKED','COOLDOWN')),
            event         TEXT,
            reason        TEXT NOT NULL,
            actor         TEXT NOT NULL,
            created_at    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlpt_user_env_pos_ts
            ON ml_position_transitions(user_id, resolved_env, pos_id, created_at);
    `);
});

// [OMEGA Wave 3 §15 CONFIDENCE DECAY SI TIME-TO-THESIS 2026-05-15] R2
// — canonical PDF §15 (lines 909-927). Per-position confidence lifecycle:
// entry baseline + decay history + thesis criteria + signal-driven decay.
// UNIQUE(user_id, resolved_env, pos_id) — one active state per position.
// First OMEGA module in R2 cognition layer.
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §15.
migrate('060_ml_confidence_state', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_confidence_state (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pos_id                   TEXT NOT NULL,
            symbol                   TEXT NOT NULL,
            entry_confidence         REAL NOT NULL,
            current_confidence       REAL NOT NULL,
            max_stagnation_ms        INTEGER NOT NULL,
            validation_window_ms     INTEGER NOT NULL,
            thesis_criteria_json     TEXT,
            decay_signals_json       TEXT,
            last_signal_at           INTEGER,
            created_at               INTEGER NOT NULL,
            updated_at               INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, pos_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mlcs_user_env_pos
            ON ml_confidence_state(user_id, resolved_env, pos_id);
        CREATE INDEX IF NOT EXISTS idx_mlcs_updated
            ON ml_confidence_state(updated_at);
    `);
});

// [OMEGA Wave 3 §30 PORTOFOLIU CORELATII SI CAPITAL GOVERNANCE 2026-05-15] R3A
// — canonical PDF §30 (lines 1273-1285). Audit log table for 5 portfolio
// governance primitives: evaluateNewPositionRisk (POSITION_RISK),
// calculateExposure (EXPOSURE), assessClusterRisk (CLUSTER),
// estimateRuinProbability (RUIN), computeCorrelationMatrix (CORRELATION).
// Per (user × env) isolation. Composability: BLOCK → §14 portfolio_risk.
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §30.
migrate('059_ml_portfolio_state', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_portfolio_state (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id               INTEGER NOT NULL,
            resolved_env          TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            check_kind            TEXT NOT NULL CHECK(check_kind IN
                                  ('POSITION_RISK','EXPOSURE','CLUSTER','RUIN','CORRELATION')),
            decision              TEXT NOT NULL CHECK(decision IN ('ALLOW','RESTRICT','BLOCK')),
            total_exposure_pct    REAL,
            risk_score            REAL,
            details_json          TEXT,
            created_at            INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlps_user_env_kind_ts
            ON ml_portfolio_state(user_id, resolved_env, check_kind, created_at);
        CREATE INDEX IF NOT EXISTS idx_mlps_decision_ts
            ON ml_portfolio_state(decision, created_at);
    `);
});

// [OMEGA Wave 3 §29 CIRCUIT BREAKER MULTI-NIVEL 2026-05-15] R3A
// — canonical PDF §29 (lines 1237-1267). State machine + history:
//   - ml_circuit_state: current breaker state per (user × env) — UNIQUE.
//     Level L0-L5, optional probation, manual_required flag.
//   - ml_circuit_history: append-only transitions log for audit.
// 5-level escalation per spec (L1 reduce size → L2 stop new entries →
// L3 management-only → L4 full stop → L5 flatten). Probation prevents
// direct return to full power post-incident (canonical recovery logic).
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §29.
migrate('058_ml_circuit_state', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_circuit_state (
            id                            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                       INTEGER NOT NULL,
            resolved_env                  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            level                         TEXT NOT NULL CHECK(level IN ('L0','L1','L2','L3','L4','L5')),
            reason                        TEXT NOT NULL,
            actor                         TEXT NOT NULL,
            probation_active              INTEGER NOT NULL DEFAULT 0,
            probation_trades_remaining    INTEGER NOT NULL DEFAULT 0,
            manual_required               INTEGER NOT NULL DEFAULT 0,
            since                         INTEGER NOT NULL,
            updated_at                    INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
        CREATE TABLE IF NOT EXISTS ml_circuit_history (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            old_level       TEXT,
            new_level       TEXT NOT NULL CHECK(new_level IN ('L0','L1','L2','L3','L4','L5')),
            transition_type TEXT NOT NULL CHECK(transition_type IN
                            ('ESCALATE','PROBATION_ENTER','PROBATION_DECREMENT','RESUME')),
            reason          TEXT NOT NULL,
            actor           TEXT NOT NULL,
            created_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlch_user_env_ts
            ON ml_circuit_history(user_id, resolved_env, created_at);
    `);
});

// [OMEGA Wave 3 §28 OPERATIONAL SAFETY SI POSITION RECONCILIATION 2026-05-15] R3A
// — canonical PDF §28 (lines 1217-1231). Audit log table for 3 operational
// safety primitives: reconcilePosition (RECON), monitorLatency (LATENCY),
// checkRateLimit (RATE_LIMIT). Records action (OK/ALERT/LOCK/FLATTEN),
// severity score, divergences JSON, optional details. Per (user × env) isolation.
// Composability: severe RECON → §14 reconciliation_failed; LATENCY alert →
// §14 api_latency_severe.
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §28.
migrate('057_ml_recon_log', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_recon_log (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            check_type        TEXT NOT NULL CHECK(check_type IN ('RECON','LATENCY','RATE_LIMIT')),
            subject           TEXT,
            action            TEXT NOT NULL CHECK(action IN ('OK','ALERT','LOCK','FLATTEN')),
            severity          REAL NOT NULL DEFAULT 0,
            divergences_json  TEXT NOT NULL DEFAULT '[]',
            details_json      TEXT,
            created_at        INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlrl_user_env_type_ts
            ON ml_recon_log(user_id, resolved_env, check_type, created_at);
        CREATE INDEX IF NOT EXISTS idx_mlrl_action_ts
            ON ml_recon_log(action, created_at);
    `);
});

// [OMEGA Wave 3 §13 DATA FRESHNESS SI VALIDARE FEED 2026-05-15] R3A
// — canonical PDF §13 (lines 852-872). Audit log table for feed health
// evaluations. Records each evaluateFeedHealth() call: action (OK / OBSERVER /
// ALERT / PAUSE / REDUCE_RISK / NO_TRADE), issue_count, stale feeds + source
// divergences + snapshot issues (JSON arrays), clock drift ms, optional context.
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §13.
migrate('056_ml_freshness_log', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_freshness_log (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id               INTEGER NOT NULL,
            resolved_env          TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            action                TEXT NOT NULL CHECK(action IN
                                  ('OK','OBSERVER','ALERT','PAUSE','REDUCE_RISK','NO_TRADE')),
            issue_count           INTEGER NOT NULL DEFAULT 0,
            stale_feeds_json      TEXT NOT NULL,
            divergences_json      TEXT NOT NULL,
            snapshot_issues_json  TEXT NOT NULL,
            clock_drift_ms        REAL,
            context_json          TEXT,
            created_at            INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlfl_user_env_ts
            ON ml_freshness_log(user_id, resolved_env, created_at);
        CREATE INDEX IF NOT EXISTS idx_mlfl_action_ts
            ON ml_freshness_log(action, created_at);
    `);
});

// [OMEGA Wave 3 §14 CONFLICT RESOLUTION SI VETO RULES 2026-05-15] R3A
// — canonical PDF §14 (lines 875-903). Audit log table for veto evaluations.
// Records each evaluateVetoSignals() call: decision (BLOCK/PROCEED/PENALIZED),
// winning signal + hierarchy when applicable, blockers + penalties JSON arrays,
// score input vs adjusted, optional context (symbol/side/etc). Per (user × env)
// isolation strict via user_id + resolved_env CHECK.
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §14.
migrate('055_ml_veto_log', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_veto_log (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision            TEXT NOT NULL CHECK(decision IN ('BLOCK','PROCEED','PENALIZED')),
            winning_signal      TEXT,
            winning_severity    TEXT CHECK(winning_severity IN ('BLOCK','SCORE_PENALTY') OR winning_severity IS NULL),
            winning_hierarchy   TEXT,
            blockers_json       TEXT NOT NULL,
            penalties_json      TEXT NOT NULL,
            score_input         REAL,
            score_adjusted      REAL,
            context_json        TEXT,
            created_at          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlvl_user_env_ts
            ON ml_veto_log(user_id, resolved_env, created_at);
        CREATE INDEX IF NOT EXISTS idx_mlvl_decision_ts
            ON ml_veto_log(decision, created_at);
    `);
});

// [OMEGA Wave 3 §33 A/B TESTING / SHADOW COMPARE 2026-05-15] R6
// — canonical PDF §33 (lines 1324-1336). 2 NEW tables for experiment
// lifecycle: ml_experiments + ml_experiment_outcomes. Pairs cu §19
// versionRegistry (winner promotion via activateVersion).
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §33.
migrate('053_ml_experiments', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_experiments (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            name                TEXT NOT NULL,
            version_a_id        INTEGER NOT NULL,
            version_b_id        INTEGER NOT NULL,
            allocation_pct_b    REAL NOT NULL CHECK(allocation_pct_b >= 0 AND allocation_pct_b <= 100),
            isolation_mode      TEXT NOT NULL CHECK(isolation_mode IN ('STRICT','SHARED_CAPITAL')),
            state               TEXT NOT NULL DEFAULT 'CREATED'
                                CHECK(state IN ('CREATED','RUNNING','COMPLETED','PROMOTED','ROLLED_BACK')),
            started_at          INTEGER,
            completed_at        INTEGER,
            decided_at          INTEGER,
            decided_by          TEXT,
            decision_reason     TEXT,
            actor               TEXT NOT NULL,
            created_at          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlexp_state
            ON ml_experiments(state, created_at);

        CREATE TABLE IF NOT EXISTS ml_experiment_outcomes (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            experiment_id       INTEGER NOT NULL,
            arm                 TEXT NOT NULL CHECK(arm IN ('A','B')),
            decision_digest     TEXT NOT NULL,
            outcome             TEXT NOT NULL,
            pnl_pct             REAL,
            recorded_at         INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlexpo_exp_arm
            ON ml_experiment_outcomes(experiment_id, arm);
    `);
});

// [OMEGA Wave 3 §18 SHADOW MODE SI LANSARE CONTROLATA 2026-05-15] R5B
// — canonical PDF §18 (lines 990-1015). 6-stage deployment ladder cu
// transition log: ENTER/EXIT/DEGRADE/PAUSE/ROLLBACK. Pairs cu §19
// versionRegistry + §20 calibration + §21 drift for gate criteria.
// Spec: /root/_review/ml_brain/ml_brain_canonic.txt §18.
migrate('052_ml_shadow_stage_log', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_shadow_stage_log (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            version_id              INTEGER NOT NULL,
            stage                   TEXT NOT NULL CHECK(stage IN (
                'offline_backtest', 'walk_forward', 'paper',
                'shadow_live', 'limited_probation', 'normal_live'
            )),
            transition_type         TEXT NOT NULL CHECK(transition_type IN (
                'ENTER', 'EXIT', 'DEGRADE', 'PAUSE', 'ROLLBACK'
            )),
            metrics_json            TEXT,
            threshold_breach_json   TEXT,
            reason                  TEXT NOT NULL,
            actor                   TEXT NOT NULL,
            started_at              INTEGER NOT NULL,
            ended_at                INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mlssl_version_ts
            ON ml_shadow_stage_log(version_id, started_at);
    `);
});

// [OMEGA Wave 3 §243 DISASTER RECOVERY 2026-05-15] R0 substrate
// — DR orchestration: heartbeat tracking, backup manifest, failover
// state machine, DR drill log. §243 is chat-precedent addition
// (2026-04, BEFORE Claude-extras 04-29), NOT in canonical PDF.
// Spec: project_ml_brain_pro_244.md "243 → R0 (VPS single point of
// failure, requires DISASTER_RECOVERY.md + off-site backup +
// standby + heartbeat.ts + failover.ts)". Code primitives only;
// actual S3/Backblaze + VPS provisioning = operator infra config.
migrate('051_ml_dr_state', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_dr_state (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            record_type     TEXT NOT NULL CHECK(record_type IN (
                'HEARTBEAT', 'BACKUP', 'FAILOVER', 'DRILL'
            )),
            node_id         TEXT,
            role            TEXT,
            state           TEXT,
            payload_json    TEXT NOT NULL,
            actor           TEXT,
            created_at      INTEGER NOT NULL,
            expires_at      INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mldr_type_ts
            ON ml_dr_state(record_type, created_at);
        CREATE INDEX IF NOT EXISTS idx_mldr_node_type
            ON ml_dr_state(node_id, record_type, created_at);
    `);
});

// [OMEGA Wave 3 §248* BLACK SWAN ABSTENTION 2026-05-15] R3A safety
// — regime-level OOD events (flash crash, structural break). Severity
// derived from # triggered conditions (5 detection signals). Cooldown
// ladder: MINOR 1h auto-clear, MAJOR 24h auto-clear, CRITICAL 168h
// operator-only clear. Hard invariant: CRITICAL must be manually cleared
// by an actor prefixed 'operator'.
// Spec: project_ml_brain_pro_244.md §248* (Claude-extras 2026-04-29).
migrate('050_ml_black_swan_events', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_black_swan_events (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol              TEXT NOT NULL,
            severity            TEXT NOT NULL CHECK(severity IN ('MINOR','MAJOR','CRITICAL')),
            signals_json        TEXT NOT NULL,
            triggers_json       TEXT NOT NULL,
            abstention_state    TEXT NOT NULL DEFAULT 'ACTIVE'
                                CHECK(abstention_state IN ('ACTIVE','CLEARED','EXPIRED')),
            cooldown_until      INTEGER NOT NULL,
            actor               TEXT NOT NULL,
            detected_at         INTEGER NOT NULL,
            cleared_at          INTEGER,
            cleared_by          TEXT,
            clear_reason        TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_mlbs_user_env_state
            ON ml_black_swan_events(user_id, resolved_env, abstention_state);
    `);
});

// [OMEGA Wave 3 §246* GRADUATED DD RECOVERY 2026-05-15] R3A safety
// — ADD COLUMN x3 la ml_dd_pauses pentru 4-stage recovery ladder
// (25%/50%/75%/100% size) post-§255* auto-resume. Pure additive
// (default NULL/0); existing rows safe.
// Spec: project_ml_brain_pro_244.md §246* (Claude-extras 2026-04-29).
migrate('049_ml_dd_pauses_graduated_recovery', () => {
    db.exec(`
        ALTER TABLE ml_dd_pauses ADD COLUMN recovery_stage INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE ml_dd_pauses ADD COLUMN recovery_wins_at_stage INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE ml_dd_pauses ADD COLUMN recovery_started_at INTEGER;
    `);
});

// [OMEGA Wave 3 §253* OPERATOR UNAVAILABILITY LADDER 2026-05-15]
// Operator Interaction Layer + R5B. Escalation audit log: 24h WARN /
// 72h HANDOVER / 7d FALLBACK. Hard invariant: FALLBACK sets approval
// state='EXPIRED' (status quo), NEVER 'APPROVED'.
// Spec: project_ml_brain_pro_244.md §253* (Claude-extras 2026-04-29).
migrate('048_ml_operator_escalations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_operator_escalations (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            approval_id              INTEGER NOT NULL,
            level                    TEXT NOT NULL CHECK(level IN (
                'WARN', 'HANDOVER', 'FALLBACK'
            )),
            hours_since_request      REAL NOT NULL,
            action_taken             TEXT NOT NULL,
            actor                    TEXT NOT NULL,
            notified_operators_json  TEXT,
            created_at               INTEGER NOT NULL,
            UNIQUE(approval_id, level)
        );
        CREATE INDEX IF NOT EXISTS idx_mloe_approval_ts
            ON ml_operator_escalations(approval_id, created_at);
    `);
});

migrate('047_ml_dd_pauses', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_dd_pauses (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pause_reason             TEXT NOT NULL,
            dd_at_pause              REAL NOT NULL,
            state                    TEXT NOT NULL DEFAULT 'ACTIVE'
                                     CHECK(state IN ('ACTIVE', 'RESUMED', 'EXPIRED')),
            resume_eligible_after    INTEGER NOT NULL,
            shadow_wins_count        INTEGER NOT NULL DEFAULT 0,
            auto_resumed             INTEGER NOT NULL DEFAULT 0,
            paused_at                INTEGER NOT NULL,
            resumed_at               INTEGER,
            resumed_by               TEXT,
            resume_reason            TEXT,
            paused_by                TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mldp_user_env_state
            ON ml_dd_pauses(user_id, resolved_env, state);
    `);
});

// [OMEGA Wave 3 §247* HYPOTHESIS PRE-REGISTRATION 2026-05-15] R5B
// anti-p-hacking discipline. Each registration locks: hypothesis,
// predicted metrics, success criteria, eval window, hash. Once
// REGISTERED, content is immutable. evaluate() requires
// eval_window_to <= now (no early peek-cheat). Only ONE REGISTERED
// per version_id at a time.
// Spec: project_ml_brain_pro_244.md §247* (Claude-extras 2026-04-29).
migrate('046_ml_hypothesis_pre_registrations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_hypothesis_pre_registrations (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            version_id               INTEGER NOT NULL,
            hypothesis               TEXT NOT NULL,
            predicted_metrics_json   TEXT NOT NULL,
            success_criteria_json    TEXT NOT NULL,
            eval_window_from         INTEGER NOT NULL,
            eval_window_to           INTEGER NOT NULL,
            registration_hash        TEXT NOT NULL,
            state                    TEXT NOT NULL DEFAULT 'REGISTERED'
                                     CHECK(state IN ('REGISTERED', 'EVALUATING', 'PASS', 'FAIL', 'INVALID')),
            actual_metrics_json      TEXT,
            pass_fail_details_json   TEXT,
            actor                    TEXT NOT NULL,
            registered_at            INTEGER NOT NULL,
            evaluated_at             INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mlhpr_version_state
            ON ml_hypothesis_pre_registrations(version_id, state);
    `);
});

// [Wave 9 / Canonical PDF #8] Fundamentals cache — TTL-based store for
// CoinGecko market data (global dominance, top-200 markets) so brain has
// fundamental context (market_cap_rank, dominance, vol_24h) on top of
// regime/signals/structure. Additive — fusion math unchanged.
migrate('380_ml_fundamentals_cache', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_fundamentals_cache (
            cache_key   TEXT PRIMARY KEY,
            value_json  TEXT NOT NULL,
            fetched_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
        );
        CREATE INDEX IF NOT EXISTS idx_fundamentals_fetched_at
            ON ml_fundamentals_cache(fetched_at);
    `);
});

// [Sub-C.1 / Task 1] Long-term chat memory system (Omega Wave 1 Foundation)
// M1: Core memory store — one fact per (user × class × fact_key × env).
// dual source cols (created_source_chat_id / last_source_chat_id) for lineage.
// UNIQUE constraint prevents duplicates; updates reaffirm via upsert logic.
migrate('381_ml_chat_memory', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_chat_memory (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            env                     TEXT,
            class                   TEXT NOT NULL CHECK(class IN (
                                        'identity','personal_context','trading_strategy','temporary','style'
                                    )),
            fact_key                TEXT NOT NULL,
            fact_value              TEXT NOT NULL,
            importance              REAL NOT NULL DEFAULT 0.5,
            created_source_chat_id  INTEGER,
            last_source_chat_id     INTEGER,
            reaffirm_count          INTEGER NOT NULL DEFAULT 1,
            decay_at                INTEGER,
            last_seen_at            INTEGER NOT NULL,
            tombstone_at            INTEGER,
            forgotten_by            TEXT,
            created_at              INTEGER NOT NULL,
            updated_at              INTEGER NOT NULL,
            UNIQUE(user_id, class, fact_key, env)
        );
    `);
});

// [Sub-C.1 / Task 1] M2: Cross-cluster cache invalidation tracker.
// One row per user; bumped on any memory write so other nodes know to
// re-fetch rather than serve stale cache.
migrate('382_ml_chat_memory_meta', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_chat_memory_meta (
            user_id         INTEGER PRIMARY KEY,
            last_modified_at INTEGER NOT NULL
        );
    `);
});

// [Sub-C.1 / Task 1] M3: Extraction pipeline status column on ml_voice_log.
// CRITICAL: NO DEFAULT clause — pre-migration rows get NULL intentionally.
// Cron retry query filters WHERE extraction_status='failed_transient',
// so NULL legacy rows are never picked up (no backfill storm).
migrate('383_ml_voice_log_extraction_status', () => {
    db.exec(`ALTER TABLE ml_voice_log ADD COLUMN extraction_status TEXT`);
});

// [Sub-C.1 / Task 1] M4: Retry attempt counter for extraction pipeline.
// DEFAULT 0 safe on existing rows (they've had 0 attempts in new system).
migrate('384_ml_voice_log_attempts', () => {
    db.exec(`ALTER TABLE ml_voice_log ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`);
});

// [Sub-C.1 / Task 1] M5: Timestamp of most recent extraction attempt.
// NULL = never attempted in new pipeline (fine for legacy rows).
migrate('385_ml_voice_log_last_attempt_at', () => {
    db.exec(`ALTER TABLE ml_voice_log ADD COLUMN last_attempt_at INTEGER`);
});

// [Sub-C.1 / Task 1] M6: Scheduled next retry time for failed_transient rows.
// NULL = not scheduled / not applicable.
migrate('386_ml_voice_log_next_retry_at', () => {
    db.exec(`ALTER TABLE ml_voice_log ADD COLUMN next_retry_at INTEGER`);
});

// [Sub-C.1 / Task 1] M7: Primary lookup index — active memories for a user
// filtered by class. Covers the hot read path (inject into prompt).
migrate('387_idx_mlcm_user_active', () => {
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_mlcm_user_active
            ON ml_chat_memory(user_id, tombstone_at, class);
    `);
});

// [Sub-C.1 / Task 1] M8: Partial index for tombstone GC sweeps.
// Only indexes rows where tombstone_at IS NOT NULL — keeps index tiny.
migrate('388_idx_mlcm_tombstone_cleanup', () => {
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_mlcm_tombstone_cleanup
            ON ml_chat_memory(tombstone_at) WHERE tombstone_at IS NOT NULL;
    `);
});

// [Sub-C.1 / Task 1] M9: Partial index for decay scheduler cron.
// Only live (non-tombstoned) rows with a scheduled decay_at.
migrate('389_idx_mlcm_decay', () => {
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_mlcm_decay
            ON ml_chat_memory(decay_at)
            WHERE decay_at IS NOT NULL AND tombstone_at IS NULL;
    `);
});

// [Sub-C.1 / Task 1] M10: Partial index for cron retry of failed_transient
// extractions — only indexes the rows the cron actually needs to scan.
migrate('390_idx_mlvl_extraction_recovery', () => {
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_mlvl_extraction_recovery
            ON ml_voice_log(extraction_status, next_retry_at)
            WHERE extraction_status = 'failed_transient';
    `);
});

// [V6 Binance defense 2026-05-20] Persistent rate-limit state.
// Eliminates restart amnesia — PM2 reload no longer resets in-memory ban
// counter, preventing the new process from triggering another ban probe.
migrate('391_binance_rate_state', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS binance_rate_state (
            scope TEXT PRIMARY KEY DEFAULT 'global',
            banned_until INTEGER NOT NULL DEFAULT 0,
            ban_reason TEXT,
            warm_until INTEGER NOT NULL DEFAULT 0,
            used_weight_1m INTEGER NOT NULL DEFAULT 0,
            used_weight_ts INTEGER,
            burst_calls_10s INTEGER NOT NULL DEFAULT 0,
            burst_window_start INTEGER,
            last_heavy_endpoint_ts INTEGER,
            resume_generation INTEGER NOT NULL DEFAULT 1,
            consecutive_ban_count INTEGER NOT NULL DEFAULT 0,
            last_ban_at INTEGER,
            updated_at INTEGER NOT NULL
        );
    `);
});

migrate('392_binance_rate_state_log', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS binance_rate_state_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts INTEGER NOT NULL,
            event_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_bin_rate_log_ts
            ON binance_rate_state_log(ts);
    `);
});

migrate('393_bybit_exchange_columns', () => {
    // [Bybit Phase 1A] Exchange dimension on existing tables.
    // Additive only: ALTER TABLE ADD COLUMN with DEFAULT 'binance' covers existing rows.
    // Idempotent: _hasColumn/_hasIndex guards (Zeus migrate() runs once per name,
    // but guards make this safe if manually re-run).
    const _hasColumn = (table, column) => {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all();
        return cols.some(c => c.name === column);
    };
    const _hasIndex = (name) => !!db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(name);

    if (!_hasColumn('at_positions', 'exchange')) {
        db.exec(`ALTER TABLE at_positions ADD COLUMN exchange TEXT NOT NULL DEFAULT 'binance'`);
        db.exec(`UPDATE at_positions SET exchange='binance' WHERE exchange IS NULL OR exchange=''`);
    }
    if (!_hasColumn('at_closed', 'exchange')) {
        db.exec(`ALTER TABLE at_closed ADD COLUMN exchange TEXT NOT NULL DEFAULT 'binance'`);
        db.exec(`UPDATE at_closed SET exchange='binance' WHERE exchange IS NULL OR exchange=''`);
    }
    if (!_hasColumn('brain_decisions', 'exchange')) {
        db.exec(`ALTER TABLE brain_decisions ADD COLUMN exchange TEXT NOT NULL DEFAULT 'binance'`);
        db.exec(`UPDATE brain_decisions SET exchange='binance' WHERE exchange IS NULL OR exchange=''`);
    }
    if (!_hasColumn('brain_parity_log', 'exchange')) {
        db.exec(`ALTER TABLE brain_parity_log ADD COLUMN exchange TEXT NOT NULL DEFAULT 'binance'`);
        db.exec(`UPDATE brain_parity_log SET exchange='binance' WHERE exchange IS NULL OR exchange=''`);
    }
    if (!_hasColumn('dsl_parity_log', 'exchange')) {
        db.exec(`ALTER TABLE dsl_parity_log ADD COLUMN exchange TEXT NOT NULL DEFAULT 'binance'`);
        db.exec(`UPDATE dsl_parity_log SET exchange='binance' WHERE exchange IS NULL OR exchange=''`);
    }
    if (!_hasIndex('idx_at_positions_user_exchange_status')) {
        db.exec(`CREATE INDEX idx_at_positions_user_exchange_status ON at_positions(user_id, exchange, status)`);
    }
    if (!_hasIndex('idx_at_closed_user_exchange_ts')) {
        db.exec(`CREATE INDEX idx_at_closed_user_exchange_ts ON at_closed(user_id, exchange, closed_at)`);
    }
    if (!_hasIndex('idx_brain_decisions_user_exchange_ts')) {
        db.exec(`CREATE INDEX idx_brain_decisions_user_exchange_ts ON brain_decisions(user_id, exchange, ts)`);
    }
});

migrate('394_position_events_table', () => {
    // [Bybit Phase 1A] position_events append-only journal.
    // Tracks every state transition for replay + audit of incidents.
    // Append-only: production code must NEVER UPDATE or DELETE rows here.
    const _hasTable = (name) => !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
    const _hasIndex = (name) => !!db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(name);

    if (!_hasTable('position_events')) {
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
    if (!_hasIndex('idx_position_events_position')) {
        db.exec(`CREATE INDEX idx_position_events_position ON position_events(position_seq, ts)`);
    }
    if (!_hasIndex('idx_position_events_user_ts')) {
        db.exec(`CREATE INDEX idx_position_events_user_ts ON position_events(user_id, ts)`);
    }
});

migrate('395_bybit_support_tables', () => {
    // [Bybit Phase 1A+1B] Support tables:
    //   - at_positions_orphaned: positions left after exchange disconnect
    //   - emergency_close_queue: catastrophic close failure persistence (manual resolve)
    //   - bybit_rate_state: DB-persistent rate limit tracking per user
    const _hasTable = (name) => !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
    const _hasIndex = (name) => !!db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(name);

    if (!_hasTable('at_positions_orphaned')) {
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
    if (!_hasIndex('idx_orphaned_user_exchange')) {
        db.exec(`CREATE INDEX idx_orphaned_user_exchange ON at_positions_orphaned(user_id, exchange, disconnected_at)`);
    }

    if (!_hasTable('emergency_close_queue')) {
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
    if (!_hasIndex('idx_emergency_close_unresolved')) {
        db.exec(`CREATE INDEX idx_emergency_close_unresolved ON emergency_close_queue(user_id, resolved_at)`);
    }

    if (!_hasTable('bybit_rate_state')) {
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
    if (!_hasIndex('idx_bybit_rate_state_user')) {
        db.exec(`CREATE UNIQUE INDEX idx_bybit_rate_state_user ON bybit_rate_state(user_id)`);
    }
});

migrate('396_emergency_close_decision_key_unique', () => {
    // [Bybit Phase 1A+1B] Idempotency + fast-lookup on emergency_close_queue.decision_key.
    // Issue #1 from code review of migration 395 (commit 6dd7c0f).
    // UNIQUE INDEX: prevents duplicate decision_key inserts (idempotent recovery queue).
    // Index also makes WHERE decision_key = ? lookup O(log n) instead of O(n).
    const _hasIndex = (name) => !!db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(name);
    if (!_hasIndex('idx_emergency_close_decision_key')) {
        db.exec(`CREATE UNIQUE INDEX idx_emergency_close_decision_key ON emergency_close_queue(decision_key)`);
    }
});

// [Wave 6] R4 Execution — DB-backed idempotency ledger for exactly-once
// order semantics. Cross-restart guarantee: in-memory _idempotencyCache in
// trading.js stays as fast path; this ledger backs it up so PM2 reload
// doesn't lose dedup state. TTL default 24h; purgeExpired() callable.
migrate('379_ml_idempotency_ledger', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_idempotency_ledger (
            idempotency_key TEXT PRIMARY KEY,
            payload_hash    TEXT NOT NULL,
            result_json     TEXT NOT NULL,
            created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
            ttl_ms          INTEGER NOT NULL DEFAULT 86400000
        );
        CREATE INDEX IF NOT EXISTS idx_idem_created_at
            ON ml_idempotency_ledger(created_at);
    `);
});

// [Wave 7b] Audit trail with chained hash — every entry links to previous
// via sha256(prev_hash || payload || ts). Tampering with any entry breaks
// the chain (entry_hash mismatch propagates forward). Append-on-demand
// from critical sites (position open/close, mode flip, kill switch).
migrate('378_ml_audit_chain', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_audit_chain (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            prev_hash    TEXT NOT NULL,
            entry_hash   TEXT NOT NULL UNIQUE,
            kind         TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            ts           INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
        );
        CREATE INDEX IF NOT EXISTS idx_audit_chain_ts
            ON ml_audit_chain(ts);
        CREATE INDEX IF NOT EXISTS idx_audit_chain_kind_ts
            ON ml_audit_chain(kind, ts);
    `);
});

// [Wave 7a] R7 Meta — inter-ring communication trace. Lightweight rolling
// log of ring-to-ring calls (caller, callee, method, input/output summary,
// duration, ok flag). Used by Doctor + /api/omega/inter-ring/recent.
// Volume-aware: kept compact via input_summary/output_summary truncation
// at insert site (not column-level).
migrate('377_ml_inter_ring_trace', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_inter_ring_trace (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            caller_module   TEXT NOT NULL,
            callee_module   TEXT NOT NULL,
            method          TEXT NOT NULL,
            input_summary   TEXT,
            output_summary  TEXT,
            duration_ms     REAL,
            ok              INTEGER NOT NULL DEFAULT 1,
            ts              INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
        );
        CREATE INDEX IF NOT EXISTS idx_r7_trace_ts
            ON ml_inter_ring_trace(ts);
        CREATE INDEX IF NOT EXISTS idx_r7_trace_callee_ts
            ON ml_inter_ring_trace(callee_module, ts);
    `);
});

// [Wave 5] R1 Constitution — audit log for principle violations. Logged
// regardless of enforcement_mode (advisory|blocking). Operator surfaces
// via /api/omega/constitution/violations + future UI tab.
migrate('376_ml_r1_violations', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_r1_violations (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            principle_id            TEXT NOT NULL,
            principle_name          TEXT NOT NULL,
            symbol                  TEXT,
            side                    TEXT,
            severity                TEXT NOT NULL CHECK(severity IN ('hard','soft','advisory')),
            decision_payload_json   TEXT NOT NULL,
            enforcement_mode        TEXT NOT NULL CHECK(enforcement_mode IN ('advisory','blocking')),
            ts                      INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
        );
        CREATE INDEX IF NOT EXISTS idx_r1_violations_user_ts
            ON ml_r1_violations(user_id, ts);
        CREATE INDEX IF NOT EXISTS idx_r1_violations_principle
            ON ml_r1_violations(principle_id, ts);
    `);
});

// [Wave 4] R3B Safety — calibration buffer for Conformal Prediction +
// OOD detection feature histograms. Additive only; consumed by R3B_safety
// modules (conformalPrediction.js / oodDetector.js).
migrate('375_ml_r3b_calibration_buffer', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_r3b_calibration (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            regime            TEXT NOT NULL,
            confidence_bucket INTEGER NOT NULL,
            residual          REAL NOT NULL,
            outcome           REAL NOT NULL,
            ts                INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
        );
        CREATE INDEX IF NOT EXISTS idx_r3b_calib_regime_ts
            ON ml_r3b_calibration(regime, ts);
        CREATE TABLE IF NOT EXISTS ml_r3b_ood_histogram (
            feature_name TEXT NOT NULL,
            bin_id       INTEGER NOT NULL,
            count        INTEGER NOT NULL DEFAULT 0,
            updated_at   INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
            PRIMARY KEY (feature_name, bin_id)
        );
    `);
});

// [Day 33 #2] Operator-stated preferences surfaced via chat ("remember
// that I prefer tight SL"). Injected into Omega's LLM system prompt so
// tactical reads respect operator's stated trading style.
migrate('374_trader_profile_preferences', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS trader_profile_preferences (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            preference  TEXT NOT NULL,
            created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_trader_profile_user
            ON trader_profile_preferences(user_id);
    `);
});

// [Wave 1 2026-05-24] Extend ml_config_snapshots resolved_env CHECK to include 'SYSTEM'
// so migrationFlags.set() wiring can snapshot system-level flag changes without
// forcing them into a user/env-specific bucket (userId=0, resolvedEnv='SYSTEM').
// SQLite cannot ALTER CHECK constraints — must recreate tables via RENAME+INSERT+DROP.
migrate('397_ml_config_rollback_system_env', () => {
    db.exec(`
        ALTER TABLE ml_config_snapshots RENAME TO ml_config_snapshots_old;
        CREATE TABLE ml_config_snapshots (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL','SYSTEM')),
            config_key      TEXT NOT NULL,
            value_json      TEXT NOT NULL,
            version         INTEGER NOT NULL,
            is_active       INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
            actor           TEXT NOT NULL,
            reason          TEXT,
            created_at      INTEGER NOT NULL
        );
        INSERT INTO ml_config_snapshots SELECT * FROM ml_config_snapshots_old;
        DROP TABLE ml_config_snapshots_old;

        ALTER TABLE ml_config_rollback_log RENAME TO ml_config_rollback_log_old;
        CREATE TABLE ml_config_rollback_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL','SYSTEM')),
            config_key      TEXT NOT NULL,
            from_version    INTEGER,
            to_version      INTEGER NOT NULL,
            reason          TEXT NOT NULL,
            actor           TEXT NOT NULL,
            duration_ms     INTEGER,
            created_at      INTEGER NOT NULL
        );
        INSERT INTO ml_config_rollback_log SELECT * FROM ml_config_rollback_log_old;
        DROP TABLE ml_config_rollback_log_old;

        CREATE INDEX IF NOT EXISTS idx_mlcs_user_env_key_active
            ON ml_config_snapshots(user_id, resolved_env, config_key, is_active);
        CREATE INDEX IF NOT EXISTS idx_mlcrl_user_env_ts
            ON ml_config_rollback_log(user_id, resolved_env, created_at);
    `);
});

migrate('398_ml_reflection_tables', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_reflection_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at INTEGER NOT NULL,
            finished_at INTEGER NOT NULL,
            decisions_processed INTEGER NOT NULL DEFAULT 0,
            modules_run INTEGER NOT NULL DEFAULT 0,
            modules_failed INTEGER NOT NULL DEFAULT 0,
            total_insights INTEGER NOT NULL DEFAULT 0,
            duration_ms INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS ml_reflection_insights (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id INTEGER NOT NULL,
            ts INTEGER NOT NULL,
            module_id TEXT NOT NULL,
            decision_id INTEGER NOT NULL DEFAULT 0,
            insight_type TEXT NOT NULL DEFAULT 'observation',
            severity TEXT NOT NULL DEFAULT 'low',
            insight_text TEXT NOT NULL DEFAULT '',
            metadata_json TEXT,
            surfaced_in_voice INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_refl_insights_ts ON ml_reflection_insights(ts);
        CREATE INDEX IF NOT EXISTS idx_refl_insights_module ON ml_reflection_insights(module_id, ts);
        CREATE INDEX IF NOT EXISTS idx_refl_insights_severity ON ml_reflection_insights(severity, ts);
        CREATE INDEX IF NOT EXISTS idx_refl_insights_voice ON ml_reflection_insights(surfaced_in_voice, ts);
    `);
});

migrate('399_ml_charter_system_env', () => {
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS ml_charter_principles_v2 (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id           INTEGER NOT NULL,
                resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL','SYSTEM')),
                principle_id      TEXT NOT NULL UNIQUE,
                kind              TEXT NOT NULL CHECK(kind IN
                                  ('profit','safety','truth','compliance',
                                   'integrity','long_term_survivability')),
                priority_rank     INTEGER NOT NULL CHECK(priority_rank >= 1),
                description       TEXT NOT NULL,
                is_active         INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
                ts_created        INTEGER NOT NULL,
                ts_last_updated   INTEGER NOT NULL
            );
            INSERT OR IGNORE INTO ml_charter_principles_v2 SELECT * FROM ml_charter_principles;
            DROP TABLE IF EXISTS ml_charter_principles;
            ALTER TABLE ml_charter_principles_v2 RENAME TO ml_charter_principles;
        `);
    } catch (_) {}
});

migrate('400_brain_decisions_resolved_env', () => {
    try {
        db.exec("ALTER TABLE brain_decisions ADD COLUMN resolved_env TEXT DEFAULT 'DEMO'");
    } catch (_) {}
});

migrate('401_ml_cognitive_snapshots', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_cognitive_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trigger_type TEXT NOT NULL CHECK(trigger_type IN ('auto_p0', 'manual', 'scheduled')),
            trigger_event_id INTEGER,
            cognitive_state TEXT NOT NULL,
            snapshot_json TEXT NOT NULL,
            modules_involved_json TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cog_snap_ts ON ml_cognitive_snapshots(created_at);
        CREATE INDEX IF NOT EXISTS idx_cog_snap_trigger ON ml_cognitive_snapshots(trigger_type, created_at);
    `);
});

migrate('402_ml_cognitive_checkpoints', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_cognitive_checkpoints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            label TEXT NOT NULL,
            cognitive_state TEXT NOT NULL,
            checkpoint_json TEXT NOT NULL,
            auto_created INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cog_ckpt_ts ON ml_cognitive_checkpoints(created_at);
        CREATE INDEX IF NOT EXISTS idx_cog_ckpt_auto ON ml_cognitive_checkpoints(auto_created, cognitive_state);
    `);
});

migrate('403_ml_voice_feedback', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_voice_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            voice_log_id INTEGER NOT NULL UNIQUE,
            user_id INTEGER NOT NULL,
            feedback TEXT NOT NULL CHECK(feedback IN ('up', 'down')),
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_voice_fb_user ON ml_voice_feedback(user_id, created_at);
    `);
});

migrate('404_position_classifications', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS position_classifications (
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
        CREATE INDEX IF NOT EXISTS idx_pos_class_ts ON position_classifications(ts);
    `);
});

migrate('405_position_classifications_exchange', () => {
    db.exec(`ALTER TABLE position_classifications ADD COLUMN exchange TEXT DEFAULT 'binance'`);
});

migrate('406_handover_log', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS handover_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            from_owner  TEXT,
            to_owner    TEXT,
            reason      TEXT,
            created_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_handover_user_ts ON handover_log(user_id, created_at);
    `);
});

// [REAL-GATE P0-3 2026-06-09] Per-user explicit opt-in for REAL ML influence.
// Absence of a row = NOT opted in (fail-closed). Written only via
// mlLiveOptin.setOptin (audited). Read by influenceEligibility on env=REAL.
migrate('407_ml_live_optin', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_live_optin (
            user_id     INTEGER PRIMARY KEY,
            opted_in    INTEGER NOT NULL DEFAULT 0,
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            source      TEXT
        );
    `);
});

migrate('408_support_messages', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS support_messages (
            id            INTEGER PRIMARY KEY,
            user_id       INTEGER NOT NULL,
            sender        TEXT NOT NULL CHECK(sender IN ('user','admin')),
            message       TEXT NOT NULL,
            read_by_admin INTEGER NOT NULL DEFAULT 0,
            read_by_user  INTEGER NOT NULL DEFAULT 0,
            created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_support_user   ON support_messages(user_id, id);
        CREATE INDEX IF NOT EXISTS idx_support_unread ON support_messages(read_by_admin);
    `);
});
migrate('409_ml_dsl_arm_posterior', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_dsl_arm_posterior (
            cell_key   TEXT NOT NULL,
            arm        TEXT NOT NULL,
            alpha      REAL NOT NULL DEFAULT 1,
            beta       REAL NOT NULL DEFAULT 1,
            n          INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (cell_key, arm)
        );
    `);
});
migrate('410_ml_dsl_outcome', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_dsl_outcome (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            pos_id          TEXT NOT NULL,
            user_id         INTEGER NOT NULL,
            env             TEXT, symbol TEXT, regime TEXT,
            arm             TEXT, cohort TEXT,
            ml_pnl_pct      REAL, baseline_pnl_pct REAL, advantage REAL,
            win             INTEGER,
            ts              INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mldsl_out_ts ON ml_dsl_outcome(ts);
    `);
});
migrate('411_indicator_usage', () => {
    // Per-user currently-active indicator set — drives the picker's live usage badge.
    // Telemetry-only; never touches brain/trading/signals.
    db.exec(`
        CREATE TABLE IF NOT EXISTS indicator_usage (
            user_id      INTEGER NOT NULL,
            indicator_id TEXT NOT NULL,
            updated_at   INTEGER NOT NULL,
            PRIMARY KEY (user_id, indicator_id)
        );
    `);
});

migrate('412_users_profile', () => {
    // [2026-06-24] User profile fields (flip-header profile). Public, social-readable.
    db.exec("ALTER TABLE users ADD COLUMN display_name TEXT DEFAULT NULL");
    db.exec("ALTER TABLE users ADD COLUMN username TEXT DEFAULT NULL");
    db.exec("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT NULL");
    db.exec("ALTER TABLE users ADD COLUMN accent_color TEXT DEFAULT NULL");
    db.exec("ALTER TABLE users ADD COLUMN tagline TEXT DEFAULT NULL");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL");
});

// ─── User methods ───

const _stmts = {
    findByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    findById: db.prepare('SELECT * FROM users WHERE id = ?'),
    setUserProfile: db.prepare("UPDATE users SET display_name=?, username=?, avatar=?, accent_color=?, tagline=?, updated_at=datetime('now') WHERE id=?"),
    getUserProfileById: db.prepare("SELECT id, display_name, username, avatar, accent_color, tagline FROM users WHERE id=?"),
    findUserByUsername: db.prepare("SELECT id, username FROM users WHERE LOWER(username)=LOWER(?)"),
    countUsers: db.prepare('SELECT COUNT(*) as cnt FROM users'),
    insertUser: db.prepare('INSERT INTO users (email, password_hash, role, approved) VALUES (?, ?, ?, ?)'),
    setUserTermsConsent: db.prepare("UPDATE users SET terms_accepted_at = ?, terms_version = ?, updated_at = datetime('now') WHERE id = ?"),
    listUsers: db.prepare('SELECT id, email, role, approved, status, created_at FROM users ORDER BY created_at'),
    approveUser: db.prepare("UPDATE users SET approved = 1, updated_at = datetime('now') WHERE email = ?"),
    deleteUser: db.prepare('DELETE FROM users WHERE email = ? AND role != ?'),
    updatePassword: db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?"),
    updateEmail: db.prepare("UPDATE users SET email = ?, updated_at = datetime('now') WHERE id = ?"),
    blockUser: db.prepare("UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?"),
    banUser: db.prepare("UPDATE users SET status = 'banned', banned_until = ?, updated_at = datetime('now') WHERE id = ?"),
    unbanUser: db.prepare("UPDATE users SET status = 'active', banned_until = NULL, updated_at = datetime('now') WHERE id = ?"),

    // Exchange accounts
    findExchange: db.prepare('SELECT * FROM exchange_accounts WHERE user_id = ? AND is_active = 1 LIMIT 1'),
    findExchangeByName: db.prepare('SELECT * FROM exchange_accounts WHERE user_id = ? AND exchange = ? AND is_active = 1'),
    // [Multi-exchange switch P1] Verified row for an exchange REGARDLESS of is_active —
    // lets us load creds for a NON-active exchange to manage its still-open positions
    // (close/SL/DSL) after a switch. Prefer the active row, then most-recently-verified.
    findExchangeByNameAny: db.prepare("SELECT * FROM exchange_accounts WHERE user_id = ? AND exchange = ? AND status = 'verified' ORDER BY is_active DESC, last_verified_at DESC LIMIT 1"),
    findAllExchanges: db.prepare('SELECT * FROM exchange_accounts WHERE user_id = ? AND is_active = 1'),
    findExchangeById: db.prepare('SELECT * FROM exchange_accounts WHERE id = ? AND user_id = ?'),
    insertExchange: db.prepare('INSERT INTO exchange_accounts (user_id, exchange, api_key_encrypted, api_secret_encrypted, mode, status, last_verified_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))'),
    // [P7.0a Multi-connect] Insert a connected-but-INACTIVE account (a 2nd exchange
    // saved while another is active). is_active=0 keeps the one-active-per-user index
    // (idx_exchange_user_active_single) intact; Switch (P3) activates it later.
    insertExchangeInactive: db.prepare('INSERT INTO exchange_accounts (user_id, exchange, api_key_encrypted, api_secret_encrypted, mode, status, last_verified_at, is_active) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'), 0)'),
    updateExchange: db.prepare("UPDATE exchange_accounts SET api_key_encrypted = ?, api_secret_encrypted = ?, mode = ?, status = ?, last_verified_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ? AND is_active = 1"),
    updateExchangeByName: db.prepare("UPDATE exchange_accounts SET api_key_encrypted = ?, api_secret_encrypted = ?, mode = ?, status = ?, last_verified_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ? AND exchange = ? AND is_active = 1"),
    // [P7.0a] Update a (user, exchange) row regardless of is_active — re-verifying a
    // connected-but-inactive exchange must update its row (the is_active=1-only update
    // would miss it and the caller would wrongly insert a duplicate).
    updateExchangeByNameAny: db.prepare("UPDATE exchange_accounts SET api_key_encrypted = ?, api_secret_encrypted = ?, mode = ?, status = ?, last_verified_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ? AND exchange = ?"),
    // [P7.0b] All connected (verified) exchanges for a user — active first.
    findConnectedExchanges: db.prepare("SELECT * FROM exchange_accounts WHERE user_id = ? AND status = 'verified' ORDER BY is_active DESC, exchange"),
    deactivateExchange: db.prepare("UPDATE exchange_accounts SET is_active = 0, status = 'disconnected', updated_at = datetime('now') WHERE user_id = ? AND is_active = 1"),
    deactivateExchangeByName: db.prepare("UPDATE exchange_accounts SET is_active = 0, status = 'disconnected', updated_at = datetime('now') WHERE user_id = ? AND exchange = ? AND is_active = 1"),
    listAllExchanges: db.prepare(`
    SELECT ea.id, ea.user_id, ea.exchange, ea.mode, ea.status, ea.last_verified_at, ea.is_active, ea.created_at,
           u.email
    FROM exchange_accounts ea
    JOIN users u ON u.id = ea.user_id
    WHERE ea.is_active = 1
    ORDER BY ea.created_at
  `),

    // Telegram per-user
    setUserTelegram: db.prepare("UPDATE users SET telegram_bot_token_enc = ?, telegram_chat_id = ?, telegram_broken_at = NULL, telegram_broken_reason = NULL, updated_at = datetime('now') WHERE id = ?"),
    getUserTelegram: db.prepare('SELECT telegram_bot_token_enc, telegram_chat_id, telegram_broken_at, telegram_broken_reason FROM users WHERE id = ?'),
    // [ZT-AUD-#16] Skip rows already flagged broken so reload doesn't retry endlessly.
    getAllTelegramUsers: db.prepare('SELECT id, telegram_bot_token_enc, telegram_chat_id FROM users WHERE telegram_bot_token_enc IS NOT NULL AND telegram_chat_id IS NOT NULL AND telegram_broken_at IS NULL'),
    markTelegramBroken: db.prepare("UPDATE users SET telegram_broken_at = ?, telegram_broken_reason = ?, updated_at = datetime('now') WHERE id = ?"),
    clearTelegramBroken: db.prepare("UPDATE users SET telegram_broken_at = NULL, telegram_broken_reason = NULL WHERE id = ?"),
    getTelegramBrokenStatus: db.prepare('SELECT telegram_broken_at, telegram_broken_reason FROM users WHERE id = ?'),

    // PIN per-user
    setPin: db.prepare("UPDATE users SET pin_hash = ?, updated_at = datetime('now') WHERE id = ?"),
    getPin: db.prepare('SELECT pin_hash FROM users WHERE id = ?'),
    clearPin: db.prepare("UPDATE users SET pin_hash = NULL, updated_at = datetime('now') WHERE id = ?"),

    // Token version (session invalidation)
    bumpTokenVersion: db.prepare("UPDATE users SET token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?"),

    // Temp-password metadata (set by admin reset, cleared on user change)
    setPwdTempMeta: db.prepare("UPDATE users SET pwd_temp_expires_at = ?, pwd_must_change = 1, updated_at = datetime('now') WHERE id = ?"),
    clearPwdTempMeta: db.prepare("UPDATE users SET pwd_temp_expires_at = NULL, pwd_must_change = 0, updated_at = datetime('now') WHERE id = ?"),

    // [ZT-AUD-#12] Inactivity tracking (survives pm2 restart)
    setLastActiveAt: db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?'),
    getLastActiveAt: db.prepare('SELECT last_active_at FROM users WHERE id = ?'),

    // Password history
    insertPasswordHistory: db.prepare('INSERT INTO password_history (user_id, password_hash) VALUES (?, ?)'),
    getPasswordHistory: db.prepare('SELECT password_hash FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 5'),
    prunePasswordHistory: db.prepare('DELETE FROM password_history WHERE user_id = ? AND id NOT IN (SELECT id FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 5)'),

    // Audit
    insertAudit: db.prepare('INSERT INTO audit_log (user_id, action, details, ip) VALUES (?, ?, ?, ?)'),
    listAudit: db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?'), // [M10]
    countAudit: db.prepare('SELECT COUNT(*) AS n FROM audit_log'), // [M10]
    listAuditByUser: db.prepare('SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'), // [M10]
    countAuditByUser: db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ?'), // [M10]

    // AT Engine persistence — [MULTI-USER] all queries now include user_id
    atUpsertPos: db.prepare("INSERT INTO at_positions (seq, data, status, user_id) VALUES (?, ?, ?, ?) ON CONFLICT(seq) DO UPDATE SET data = excluded.data, status = excluded.status, user_id = excluded.user_id, updated_at = datetime('now')"),
    atDeletePos: db.prepare('DELETE FROM at_positions WHERE seq = ?'),
    atLoadOpenPosByUser: db.prepare("SELECT seq, data FROM at_positions WHERE status = 'OPEN' AND user_id = ?"),
    atGetOpenUserIds: db.prepare("SELECT DISTINCT user_id FROM at_positions WHERE status = 'OPEN' AND user_id IS NOT NULL"),
    atInsertClosed: db.prepare('INSERT OR REPLACE INTO at_closed (seq, data, user_id) VALUES (?, ?, ?)'),
    atGetState: db.prepare('SELECT value FROM at_state WHERE key = ?'),
    atSetState: db.prepare('INSERT OR REPLACE INTO at_state (key, value, user_id) VALUES (?, ?, ?)'),
    atGetStateByUser: db.prepare('SELECT key, value FROM at_state WHERE user_id = ?'),
    atPruneClosed: db.prepare('DELETE FROM at_closed WHERE user_id = ? AND seq NOT IN (SELECT seq FROM at_closed WHERE user_id = ? ORDER BY closed_at DESC LIMIT 500)'),
    // Journal queries
    journalGetClosed: db.prepare('SELECT seq, data, closed_at FROM at_closed WHERE user_id = ? ORDER BY closed_at DESC LIMIT ? OFFSET ?'),
    journalCountClosed: db.prepare('SELECT COUNT(*) as cnt FROM at_closed WHERE user_id = ?'),
    // Trade annotations
    annotationUpsert: db.prepare("INSERT INTO trade_annotations (seq, user_id, notes, tags, rating, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(seq, user_id) DO UPDATE SET notes = excluded.notes, tags = excluded.tags, rating = excluded.rating, updated_at = datetime('now')"),
    annotationGet: db.prepare('SELECT notes, tags, rating FROM trade_annotations WHERE seq = ? AND user_id = ?'),
    annotationsByUser: db.prepare('SELECT seq, notes, tags, rating FROM trade_annotations WHERE user_id = ? ORDER BY seq DESC'),
    // User settings (per-user, UPSERT)
    settingsGet: db.prepare('SELECT data FROM user_settings WHERE user_id = ?'),
    settingsGetWithTs: db.prepare('SELECT data, updated_at FROM user_settings WHERE user_id = ?'),
    settingsUpsert: db.prepare("INSERT INTO user_settings (user_id, data, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')"),
    settingsGetTs: db.prepare('SELECT updated_at FROM user_settings WHERE user_id = ?'),
    // ARES state (per-user, UPSERT)
    aresGet: db.prepare('SELECT data FROM ares_state WHERE user_id = ?'),
    aresUpsert: db.prepare("INSERT INTO ares_state (user_id, data, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')"),
    // User context data (per-user per-section, Phase 8)
    ctxGet: db.prepare('SELECT data FROM user_ctx_data WHERE user_id = ? AND section = ?'),
    ctxGetAll: db.prepare('SELECT section, data, updated_at FROM user_ctx_data WHERE user_id = ?'),
    ctxUpsert: db.prepare("INSERT INTO user_ctx_data (user_id, section, data, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(user_id, section) DO UPDATE SET data = excluded.data, updated_at = datetime('now')"),
    ctxDelete: db.prepare('DELETE FROM user_ctx_data WHERE user_id = ? AND section = ?'),
    ctxDeleteAll: db.prepare('DELETE FROM user_ctx_data WHERE user_id = ?'),
    // Brain decisions (ML data layer)
    bdInsert: db.prepare('INSERT INTO brain_decisions (snap_id, user_id, symbol, ts, cycle, source_path, final_tier, final_conf, final_dir, final_action, linked_seq, data, resolved_env) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    bdLinkSeq: db.prepare('UPDATE brain_decisions SET linked_seq = ? WHERE snap_id = ?'),
    bdUpdateData: db.prepare('UPDATE brain_decisions SET data = ? WHERE snap_id = ?'),
    bdUpdateAction: db.prepare('UPDATE brain_decisions SET final_action = ? WHERE snap_id = ?'),
    bdGetBySnap: db.prepare('SELECT snap_id, data FROM brain_decisions WHERE snap_id = ?'),
    bdGetBySeq: db.prepare('SELECT snap_id, data FROM brain_decisions WHERE linked_seq = ?'),
    bdPruneNoTrade: db.prepare("DELETE FROM brain_decisions WHERE final_tier = 'NO_TRADE' AND linked_seq IS NULL AND ts < ?"),
    bdPruneBlocked: db.prepare("DELETE FROM brain_decisions WHERE final_action LIKE 'blocked_%' AND ts < ?"),
    bdPruneTrade: db.prepare("DELETE FROM brain_decisions WHERE final_action = 'entry' AND ts < ? AND linked_seq IS NULL"),
    // [AUDIT-F1/F2 2026-06-11] Retention for the two unbounded ML tables
    // (created_at is INTEGER ms). Mirrors the bdPrune tiered-retention model.
    mlAuditPruneOld: db.prepare('DELETE FROM ml_influence_audit WHERE created_at < ?'),
    parityPruneOld: db.prepare('DELETE FROM brain_parity_log WHERE created_at < ?'),
    bdCount: db.prepare('SELECT COUNT(*) as cnt, final_action FROM brain_decisions GROUP BY final_action'),
    // Missed trades
    missedInsert: db.prepare('INSERT INTO missed_trades (user_id, symbol, side, reason, price, confidence, tier, regime, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    missedByUser: db.prepare('SELECT id, symbol, side, reason, price, confidence, tier, regime, data, created_at FROM missed_trades WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'),
    missedPrune: db.prepare('DELETE FROM missed_trades WHERE user_id = ? AND id NOT IN (SELECT id FROM missed_trades WHERE user_id = ? ORDER BY created_at DESC LIMIT 200)'),
    // Regime history
    regimeInsert: db.prepare('INSERT INTO regime_history (symbol, regime, prev_regime, confidence, price, user_id) VALUES (?, ?, ?, ?, ?, ?)'),
    regimeBySymbolUser: db.prepare('SELECT id, symbol, regime, prev_regime, confidence, price, user_id, created_at FROM regime_history WHERE symbol = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?'),
    regimeByUser: db.prepare('SELECT id, symbol, regime, prev_regime, confidence, price, user_id, created_at FROM regime_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'),
    regimePruneUser: db.prepare('DELETE FROM regime_history WHERE user_id = ? AND id NOT IN (SELECT id FROM regime_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 500)'),

    // [SEC-1] Login attempts (per-IP, per-email) — persisted so pm2 reload can't reset the window
    loginAttemptGet: db.prepare('SELECT count, reset_at FROM login_attempts WHERE kind = ? AND key = ?'),
    loginAttemptUpsert: db.prepare('INSERT INTO login_attempts (kind, key, count, reset_at) VALUES (?, ?, ?, ?) ON CONFLICT(kind, key) DO UPDATE SET count = excluded.count, reset_at = excluded.reset_at'),
    loginAttemptDelete: db.prepare('DELETE FROM login_attempts WHERE kind = ? AND key = ?'),
    loginAttemptPruneExpired: db.prepare('DELETE FROM login_attempts WHERE reset_at < ?'),
};

// ─── Public API ───

function findUserByEmail(email) {
    return _stmts.findByEmail.get(email.toLowerCase().trim());
}

function findUserById(id) {
    return _stmts.findById.get(id);
}

// ─── User profile (flip-header) ───
function setUserProfile(id, p) {
    p = p || {};
    return _stmts.setUserProfile.run(
        p.display_name ?? null, (p.username ?? null) || null, p.avatar ?? null,
        p.accent_color ?? null, p.tagline ?? null, id);
}
function getUserProfileById(id) {
    return _stmts.getUserProfileById.get(id) || null;
}
function findUserByUsername(u) {
    return (u ? _stmts.findUserByUsername.get(u) : null) || null;
}

function countUsers() {
    return _stmts.countUsers.get().cnt;
}

function createUser(email, passwordHash, role, approved) {
    const info = _stmts.insertUser.run(email.toLowerCase().trim(), passwordHash, role, approved ? 1 : 0);
    return info.lastInsertRowid;
}

function setUserTermsConsent(userId, acceptedAt, version) {
    if (!userId) return;
    const ts = (typeof acceptedAt === 'string' && acceptedAt) ? acceptedAt : new Date().toISOString();
    const ver = (typeof version === 'string' && version) ? version : 'unknown';
    return _stmts.setUserTermsConsent.run(ts, ver, userId);
}

function listUsers() {
    return _stmts.listUsers.all();
}

function approveUser(email) {
    return _stmts.approveUser.run(email.toLowerCase().trim());
}

function rejectUser(email) {
    return _stmts.deleteUser.run(email.toLowerCase().trim(), 'admin');
}

function deleteUser(email, protectedRole) {
    return _stmts.deleteUser.run(email.toLowerCase().trim(), protectedRole || 'admin');
}

function updatePassword(userId, newHash) {
    return _stmts.updatePassword.run(newHash, userId);
}

function bumpTokenVersion(userId) {
    return _stmts.bumpTokenVersion.run(userId);
}

function setTempPasswordMeta(userId, expiresAtIso) {
    return _stmts.setPwdTempMeta.run(expiresAtIso, userId);
}

function clearTempPasswordMeta(userId) {
    return _stmts.clearPwdTempMeta.run(userId);
}

function setLastActiveAt(userId, ts) {
    return _stmts.setLastActiveAt.run(ts, userId);
}

function getLastActiveAt(userId) {
    const row = _stmts.getLastActiveAt.get(userId);
    return row ? row.last_active_at : null;
}

function updateEmail(userId, newEmail) {
    return _stmts.updateEmail.run(newEmail.toLowerCase().trim(), userId);
}

function atomicEmailUpdate(userId, newEmail) {
    const normalised = newEmail.toLowerCase().trim();
    const txn = db.transaction(() => {
        const existing = _stmts.findByEmail.get(normalised);
        if (existing) return { ok: false, error: 'Acest email este deja folosit' };
        _stmts.updateEmail.run(normalised, userId);
        return { ok: true };
    });
    return txn();
}

// [M6] Allowed user.status values — single source of truth.
// active  = normal account
// blocked = admin permanently disabled
// banned  = temporary ban (with banned_until); see banUser()
const USER_STATUS = Object.freeze({ ACTIVE: 'active', BLOCKED: 'blocked', BANNED: 'banned' });
const _ALLOWED_STATUSES = new Set(Object.values(USER_STATUS));

function setUserStatus(userId, status) {
    if (!_ALLOWED_STATUSES.has(status)) {
        throw new Error(`setUserStatus: invalid status '${status}' (allowed: ${[..._ALLOWED_STATUSES].join(',')})`);
    }
    return _stmts.blockUser.run(status, userId);
}

function banUser(userId, until) {
    return _stmts.banUser.run(until || null, userId);
}

function unbanUser(userId) {
    return _stmts.unbanUser.run(userId);
}

// ─── Exchange Account methods ───

function getExchangeAccount(userId) {
    return _stmts.findExchange.get(userId);
}

function getExchangeByName(userId, exchange) {
    return _stmts.findExchangeByName.get(userId, exchange);
}

// [Multi-exchange switch P1] Verified account for an exchange regardless of is_active.
function getExchangeAccountByExchange(userId, exchange) {
    return _stmts.findExchangeByNameAny.get(userId, exchange);
}

function getAllExchanges(userId) {
    return _stmts.findAllExchanges.all(userId);
}

function saveExchangeAccount(userId, exchange, encKey, encSecret, mode) {
    const existing = _stmts.findExchange.get(userId);
    if (existing) {
        _stmts.updateExchange.run(encKey, encSecret, mode, 'verified', userId);
        return existing.id;
    }
    const info = _stmts.insertExchange.run(userId, exchange, encKey, encSecret, mode, 'verified');
    return info.lastInsertRowid;
}

// [P7.0a Multi-connect] makeActive (default true) controls is_active ONLY for a
// brand-new row: true → active (first/only exchange), false → connected-but-inactive
// (a 2nd exchange saved while another is active; Switch activates it later). Existing
// rows (any is_active) are updated in place — re-verify never changes active state.
// Uses findExchangeByNameAny so an inactive row is found + updated (not duplicated).
function saveExchangeByName(userId, exchange, encKey, encSecret, mode, makeActive = true) {
    const existing = _stmts.findExchangeByNameAny.get(userId, exchange);
    if (existing) {
        _stmts.updateExchangeByNameAny.run(encKey, encSecret, mode, 'verified', userId, exchange);
        return existing.id;
    }
    const stmt = makeActive ? _stmts.insertExchange : _stmts.insertExchangeInactive;
    const info = stmt.run(userId, exchange, encKey, encSecret, mode, 'verified');
    return info.lastInsertRowid;
}

// [P7.0b] All connected (verified) exchanges for a user — active row first.
function getConnectedExchanges(userId) {
    return _stmts.findConnectedExchanges.all(userId);
}

function disconnectExchange(userId) {
    return _stmts.deactivateExchange.run(userId);
}

function disconnectExchangeByName(userId, exchange) {
    return _stmts.deactivateExchangeByName.run(userId, exchange);
}

function listAllExchangeAccounts() {
    return _stmts.listAllExchanges.all();
}

// ─── Password history methods ───

function addPasswordHistory(userId, hash) {
    _stmts.insertPasswordHistory.run(userId, hash);
    _stmts.prunePasswordHistory.run(userId, userId);
}

function getPasswordHistory(userId) {
    return _stmts.getPasswordHistory.all(userId).map(r => r.password_hash);
}

// ─── Audit methods ───

function auditLog(userId, action, details, ip) {
    _stmts.insertAudit.run(userId || null, action, typeof details === 'string' ? details : JSON.stringify(details), ip || null);
}

// [M10] True pagination — returns rows + total for the UI.
function listAuditLog(limit, offset) {
    const lim = Math.max(1, Math.min(parseInt(limit, 10) || 100, 500));
    const off = Math.max(0, parseInt(offset, 10) || 0);
    return {
        rows: _stmts.listAudit.all(lim, off),
        total: _stmts.countAudit.get().n,
        limit: lim,
        offset: off,
    };
}

function listAuditLogByUser(userId, limit, offset) {
    const lim = Math.max(1, Math.min(parseInt(limit, 10) || 100, 500));
    const off = Math.max(0, parseInt(offset, 10) || 0);
    return {
        rows: _stmts.listAuditByUser.all(userId, lim, off),
        total: _stmts.countAuditByUser.get(userId).n,
        limit: lim,
        offset: off,
    };
}

function listAuditLogByTarget(emailOrId, limit) {
    // Matches actor (user_id) OR target referenced in details payload.
    // Escape LIKE wildcards (%, _, \) in the caller-supplied value so a value
    // like "%admin@%" cannot enumerate audit rows it shouldn't see.
    const escaped = String(emailOrId).toLowerCase().replace(/[\\%_]/g, '\\$&');
    const like = '%' + escaped + '%';
    const rows = db.prepare(
      "SELECT * FROM audit_log WHERE user_id = ? OR LOWER(details) LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?"
    ).all(Number(emailOrId) || -1, like, limit || 100);
    return rows;
}

// ─── Migration from users.json ───

function migrateFromJson() {
    const jsonPath = path.join(__dirname, '..', '..', 'data', 'users.json');
    if (!fs.existsSync(jsonPath)) return { migrated: 0 };

    let users;
    try {
        users = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch (e) {
        console.warn('[DB] Could not parse users.json:', e.message);
        return { migrated: 0, error: e.message };
    }

    if (!Array.isArray(users) || users.length === 0) return { migrated: 0 };

    // Check if we already migrated
    const existing = countUsers();
    if (existing > 0) {
        console.log('[DB] Users already exist in SQLite — skipping migration');
        return { migrated: 0, skipped: true };
    }

    const insert = db.transaction(() => {
        let count = 0;
        for (const u of users) {
            if (!u.email || !u.password) continue;
            _stmts.insertUser.run(
                u.email.toLowerCase().trim(),
                u.password, // already bcrypt hash
                u.role || 'user',
                u.approved ? 1 : 0
            );
            count++;
        }
        return count;
    });

    const migrated = insert();
    console.log(`[DB] Migrated ${migrated} users from users.json to SQLite`);

    // Rename old file as backup
    const backupPath = jsonPath + '.migrated';
    fs.renameSync(jsonPath, backupPath);
    console.log(`[DB] Renamed users.json → users.json.migrated`);

    return { migrated };
}

// ─── Telegram per-user ───
function setUserTelegram(userId, tokenEnc, chatId) {
    _stmts.setUserTelegram.run(tokenEnc, chatId, userId);
}

function getUserTelegram(userId) {
    return _stmts.getUserTelegram.get(userId);
}

function getAllTelegramUsers() {
    return _stmts.getAllTelegramUsers.all();
}

function markTelegramBroken(userId, reason) {
    _stmts.markTelegramBroken.run(Date.now(), String(reason || 'unknown').slice(0, 200), userId);
}

function clearTelegramBroken(userId) {
    _stmts.clearTelegramBroken.run(userId);
}

function getTelegramBrokenStatus(userId) {
    const row = _stmts.getTelegramBrokenStatus.get(userId);
    if (!row || !row.telegram_broken_at) return null;
    return { brokenAt: row.telegram_broken_at, reason: row.telegram_broken_reason };
}

// ─── PIN per-user ───

function setUserPin(userId, pinHash) {
    _stmts.setPin.run(pinHash, userId);
}

function getUserPin(userId) {
    const row = _stmts.getPin.get(userId);
    return row ? row.pin_hash : null;
}

function clearUserPin(userId) {
    _stmts.clearPin.run(userId);
}

// ─── AT Engine persistence — [MULTI-USER] ───

function atSavePosition(pos) {
    _stmts.atUpsertPos.run(pos.seq, JSON.stringify(pos), pos.status || 'OPEN', pos.userId || null);
}

function atRemovePosition(seq) {
    _stmts.atDeletePos.run(seq);
}

const _txnArchiveClosed = db.transaction((pos) => {
    _stmts.atInsertClosed.run(pos.seq, JSON.stringify(pos), pos.userId || null);
    _stmts.atDeletePos.run(pos.seq);
});
// [DB-4] Defensive transaction error isolation. SQLite atomic txn already
// rolls back both INSERT + DELETE if either fails. Caller logs error via
// try/catch (serverAT.js _persistClose). This wrapper adds explicit shape:
// returns { ok, error } pentru caller to react without re-throwing.
// Legacy callers using try/catch still work — exceptions still propagate
// for them; new callers can opt into return-shape pattern.
function atArchiveClosed(pos) {
    _txnArchiveClosed(pos);
    return { ok: true };
}

function atLoadOpenPositions(userId) {
    if (!userId) throw new Error('atLoadOpenPositions requires userId');
    return _stmts.atLoadOpenPosByUser.all(userId).map(r => {
        try { return JSON.parse(r.data); } catch (_) { return null; }
    }).filter(Boolean);
}

function atGetOpenUserIds() {
    return _stmts.atGetOpenUserIds.all().map(r => r.user_id);
}

function atGetState(key) {
    const row = _stmts.atGetState.get(key);
    if (!row) return null;
    try { return JSON.parse(row.value); } catch (_) { return row.value; }
}

// [Task M 2026-05-28] Return Set<orderIdStr> for all Zeus-managed orders
// known to DB for a given user. Used by orderSweeper to distinguish active
// Zeus orders (preserved) from orphans (cancelled at boot).
// Extracts slOrderId / tpOrderId from at_positions.data JSON for OPEN positions.
function getZeusOrderIds(userId) {
    const ids = new Set();
    if (!userId) return ids;
    try {
        const rows = db.prepare(
            `SELECT data FROM at_positions WHERE user_id = ? AND status IN ('OPEN', 'OPENING')`
        ).all(userId);
        for (const r of rows) {
            let d;
            try { d = JSON.parse(r.data); } catch (_) { continue; }
            if (d && d.slOrderId) ids.add(String(d.slOrderId));
            if (d && d.tpOrderId) ids.add(String(d.tpOrderId));
            // entry/mainOrderId also tracked for completeness, though entries
            // are MARKET (rarely sit as open). Defensive.
            if (d && d.mainOrderId) ids.add(String(d.mainOrderId));
            if (d && d.live && d.live.mainOrderId) ids.add(String(d.live.mainOrderId));
            if (d && d.live && d.live.slOrderId) ids.add(String(d.live.slOrderId));
            if (d && d.live && d.live.tpOrderId) ids.add(String(d.live.tpOrderId));
        }
    } catch (_) { /* defensive: schema may not exist on fresh DB */ }
    return ids;
}

function atSetState(key, value, userId) {
    // [SRV-8] Defensive cross-user scoping check — keys often follow
    // format 'category:userId' (e.g. 'serverAT:closeCooldowns:1') sau
    // 'engine:<userId>'. If key contains a userId-shaped segment that
    // doesn't match the userId arg, that's likely a caller bug (wrong
    // scope = cross-user overwrite). Log warn so the discrepancy
    // surfaces în development testing instead of silently corrupting
    // another user's at_state row. Uses console.warn instead of logger
    // to avoid circular import (database.js is core dep). Match regex:
    // `:NUMBER` followed by either end-of-string or another `:` —
    // covers 'a:b:1' (id=1), 'engine:5' (id=5), 'cooldown:1:BTCUSDT'
    // (id=1 in middle). False positives possible if a non-id numeric
    // segment matches; warn only, don't block.
    try {
        const _m = String(key || '').match(/:(\d+)(?:$|:)/);
        if (_m && userId != null && String(userId) !== _m[1]) {
            console.warn('[AT_DB] atSetState scoping mismatch — key=' + key + ' embeds uid=' + _m[1] + ' but called cu userId=' + userId + '. Possible cross-user overwrite.');
        }
    } catch (_) { /* never block write on diagnostic failure */ }
    _stmts.atSetState.run(key, JSON.stringify(value), userId != null ? userId : null);
}

function atGetStateByUser(userId) {
    return _stmts.atGetStateByUser.all(userId).map(r => {
        let val;
        try { val = JSON.parse(r.value); } catch (_) { val = r.value; }
        return { key: r.key, value: val };
    });
}

function atPruneClosed(userId) {
    if (!userId) return; // safety: no global prune without userId
    _stmts.atPruneClosed.run(userId, userId);
}

// ─── [PERF-2 2026-06-01] Parity-log retention prune (batched, no VACUUM) ───
// dsl_parity_log + brain_parity_log are shadow/validation harnesses that grow
// unbounded (no prune existed). At ~970MB / +178MB per 3 days the DB would bloat.
// Strategy: delete rows older than `retentionDays` in SMALL batches keyed on the
// id PK (fast, index-backed), yielding between batches so the live trading writer
// is never blocked for long. NO VACUUM (a 970MB VACUUM would lock the DB) — freed
// pages are reused, so the file stops growing instead of shrinking. Safe on a live DB.
const _PARITY_TABLES = ['dsl_parity_log', 'brain_parity_log'];

// One batch: delete up to `batchLimit` rows with id <= cutoffId. Returns rows deleted.
// `handle` is injectable for tests; defaults to the live db.
function _parityPruneBatch(table, cutoffId, batchLimit, handle) {
    const h = handle || db;
    if (!cutoffId || cutoffId <= 0) return 0;
    // id is the PK (AUTOINCREMENT) → index-backed, no full scan.
    return h.prepare(
        `DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE id <= ? ORDER BY id LIMIT ?)`
    ).run(cutoffId, batchLimit).changes;
}

// Resolve the highest id whose created_at is older than the cutoff (the prune boundary).
function _parityCutoffId(table, cutoffMs, handle) {
    const h = handle || db;
    try {
        const r = h.prepare(`SELECT MAX(id) m FROM ${table} WHERE created_at < ?`).get(cutoffMs);
        return (r && r.m) ? Number(r.m) : 0;
    } catch (_) { return 0; }
}

// Async runner: prune both parity tables older than retentionDays, batched + yielding.
// maxBatchesPerTable bounds work per call so a single invocation can't run away;
// the daily schedule + this cap drain the backlog over a few runs.
async function pruneParityLogs(retentionDays = 7, batchLimit = 5000, maxBatchesPerTable = 200, yieldMs = 80) {
    const cutoffMs = Date.now() - retentionDays * 24 * 3600 * 1000;
    const result = {};
    for (const table of _PARITY_TABLES) {
        const cutoffId = _parityCutoffId(table, cutoffMs);
        let total = 0;
        for (let i = 0; i < maxBatchesPerTable && cutoffId > 0; i++) {
            let n = 0;
            try { n = _parityPruneBatch(table, cutoffId, batchLimit); }
            catch (e) { console.warn('[PERF-2] parity prune batch failed', table, e.message); break; }
            total += n;
            if (n < batchLimit) break; // caught up
            await new Promise(r => setTimeout(r, yieldMs)); // let the live writer through
        }
        result[table] = total;
    }
    return result;
}

// ─── Graceful close ───
function closeDb() {
    try { db.close(); } catch (_) { }
}

// ─── Daily SQLite backup (keeps last 7 copies) [C5] ───
const BACKUP_DIR = path.join(dataDir, 'db_backups');
const MAX_BACKUPS = 7;
let _lastBackupDate = '';

// [DB-6] Backup retry queue — single attempt retry on async failure.
// Previously: db.backup().catch(err => log + Telegram) — single attempt,
// no recovery. Now: on first failure, retry once after 60s delay (covers
// transient disk-full / fs-rename race windows). Both attempts log; only
// final failure (post-retry) escalates to Telegram alert.
function _runDailyBackup() {
    const today = new Date().toISOString().slice(0, 10);
    if (_lastBackupDate === today) return;
    try {
        if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const dest = path.join(BACKUP_DIR, `zeus-${today}.db`);
        if (fs.existsSync(dest)) { _lastBackupDate = today; return; }
        const _onSuccess = () => {
            _lastBackupDate = today;
            console.log(`[DB] Backup created: ${dest}`);
            // Prune old backups
            try {
                const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db')).sort();
                while (files.length > MAX_BACKUPS) {
                    const old = files.shift();
                    fs.unlinkSync(path.join(BACKUP_DIR, old));
                    console.log(`[DB] Pruned old backup: ${old}`);
                }
            } catch (pruneErr) { console.error('[DB] Backup prune failed:', pruneErr.message); }
        };
        db.backup(dest).then(_onSuccess).catch(err => {
            console.warn(`[DB] Backup attempt 1/2 failed: ${err.message} — retrying în 60s`);
            setTimeout(() => {
                // [DB-6] Retry once. If dest now exists (concurrent succeeded), skip.
                if (fs.existsSync(dest)) { _lastBackupDate = today; return; }
                db.backup(dest).then(_onSuccess).catch(err2 => {
                    console.error(`[DB] Backup attempt 2/2 failed: ${err2.message} — escalating`);
                    try { require('./telegram').send(`⚠️ DB backup failed (2 attempts): ${err2.message}`); } catch (_) { }
                });
            }, 60000);
        });
    } catch (err) {
        console.error('[DB] Backup failed:', err.message);
    }
}
// Run backup check every hour + once at startup (after 30s)
setTimeout(_runDailyBackup, 30000);
setInterval(_runDailyBackup, 3600000);

// ─── [OPS-7] audit_log retention cron ───────────────────────────────
// Audit_log was unbounded — 47,988 rows în 52 days at audit time would
// reach ~330k rows în 1 year. ML observation phase will multiply ~10x.
// Retain 90 days rolling (covers SOX-style 60d minimum + buffer). Daily
// cadence; cheap delete (indexed on created_at). Failure non-fatal —
// log + Telegram alert, never crash boot.
const AUDIT_RETENTION_DAYS = 90;
let _lastAuditPruneDate = '';
function _runAuditLogRetention() {
    const today = new Date().toISOString().slice(0, 10);
    if (_lastAuditPruneDate === today) return;
    try {
        const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 86400000).toISOString();
        const result = db.prepare("DELETE FROM audit_log WHERE created_at < ?").run(cutoff);
        _lastAuditPruneDate = today;
        if (result.changes > 0) {
            console.log(`[DB] Audit log retention: pruned ${result.changes} rows older than ${AUDIT_RETENTION_DAYS}d`);
        }
    } catch (err) {
        console.error('[DB] Audit retention failed:', err.message);
        try { require('./telegram').send(`⚠️ Audit log retention failed: ${err.message}`); } catch (_) { }
    }
}
setTimeout(_runAuditLogRetention, 60000);   // 60s post-boot
setInterval(_runAuditLogRetention, 3600000); // hourly check, day-tracked

// ─── [OPS-3] DB restore probe cron ──────────────────────────────────
// Backups were Schrödinger's — created daily but never tested. Weekly
// probe: open most-recent backup readonly, query sqlite_master + key
// tables, compare row counts vs live. Detects silent backup corruption
// (incomplete writes, stale files, missing tables). Pre-S10 trust
// requirement. Failure non-fatal — log + Telegram, never crash.
let _lastRestoreProbeDate = '';
function _runRestoreProbe() {
    const today = new Date().toISOString().slice(0, 10);
    // Run probe on Mondays only (1 = Monday în getUTCDay)
    const dow = new Date().getUTCDay();
    if (dow !== 1) { _lastRestoreProbeDate = today; return; }
    if (_lastRestoreProbeDate === today) return;
    try {
        if (!fs.existsSync(BACKUP_DIR)) { _lastRestoreProbeDate = today; return; }
        const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db')).sort();
        if (files.length === 0) { _lastRestoreProbeDate = today; return; }
        const latest = path.join(BACKUP_DIR, files[files.length - 1]);
        const Db = require('better-sqlite3');
        const probeDb = new Db(latest, { readonly: true, fileMustExist: true });
        try {
            const tables = probeDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            const userCount = probeDb.prepare("SELECT COUNT(*) AS n FROM users").get().n;
            const auditCount = probeDb.prepare("SELECT COUNT(*) AS n FROM audit_log").get().n;
            // Compare vs live: live values should be >= backup (writes since backup)
            const liveUsers = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
            const liveAudit = db.prepare("SELECT COUNT(*) AS n FROM audit_log").get().n;
            const ok = tables.length >= 5 && userCount > 0 && liveUsers >= userCount;
            const msg = `[DB] Restore probe ${ok ? 'OK' : 'WARN'}: ${path.basename(latest)} tables=${tables.length} users=${userCount}/${liveUsers} audit=${auditCount}/${liveAudit}`;
            console.log(msg);
            if (!ok) {
                try { require('./telegram').send(`⚠️ DB restore probe failed: ${msg}`); } catch (_) { }
            }
        } finally {
            probeDb.close();
        }
        _lastRestoreProbeDate = today;
    } catch (err) {
        console.error('[DB] Restore probe failed:', err.message);
        try { require('./telegram').send(`⚠️ DB restore probe error: ${err.message}`); } catch (_) { }
    }
}
setTimeout(_runRestoreProbe, 90000);    // 90s post-boot (after backup cron settled)
setInterval(_runRestoreProbe, 3600000); // hourly check; day-tracked + DOW-gated

// ─── [OPS-5] PM2 restart count alert cron ───────────────────────────
// PM2 was at 167 restarts în 20 days at audit baseline = ~8/day. Pattern
// of issues invisible without operator polling. Daily cron counts
// SERVER_BOOT audit_log rows în last 24h; if exceeds threshold, alert
// via Telegram. Boot event is persisted by server.js post-listen
// (see [OPS-5] block at line ~1153).
const RESTART_ALERT_THRESHOLD = 10; // restarts/day before alert
let _lastRestartAlertDate = '';
function _runRestartCountCheck() {
    const today = new Date().toISOString().slice(0, 10);
    if (_lastRestartAlertDate === today) return;
    try {
        const cutoff = new Date(Date.now() - 86400000).toISOString();
        const row = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='SERVER_BOOT' AND created_at >= ?").get(cutoff);
        const count = (row && row.n) || 0;
        _lastRestartAlertDate = today;
        if (count > RESTART_ALERT_THRESHOLD) {
            const msg = `⚠️ Zeus restart count anomaly: ${count} SERVER_BOOT events în last 24h (threshold ${RESTART_ALERT_THRESHOLD})`;
            console.warn('[DB] ' + msg);
            // [P3] Escape Markdown specials (SERVER_BOOT has '_') so the Markdown-default
            // send() doesn't fail-then-plain-retry with a "can't parse entities" log line.
            try { const tg = require('./telegram'); tg.send(tg.escapeMarkdown(msg)); } catch (_) { }
        } else if (count > 0) {
            console.log(`[DB] Restart count OK: ${count}/24h (threshold ${RESTART_ALERT_THRESHOLD})`);
        }
    } catch (err) {
        console.error('[DB] Restart count check failed:', err.message);
    }
}
setTimeout(_runRestartCountCheck, 120000);   // 2min post-boot
setInterval(_runRestartCountCheck, 3600000); // hourly day-tracked

// ─── [SEC-22] Trading anomaly detector ──────────────────────────────
// Sudden volume spikes (100 trades/min) = compromised account or runaway
// bug. audit_log already captures ORDER_PLACED + ORDER_FILLED via
// audit.record() at routes/trading.js:315. Cron checks last 5min window
// per user; if any user exceeds threshold, Telegram alert. Cooldown
// _seen Set prevents flood (single alert per user per 30min window).
const ANOMALY_THRESHOLD = 30;          // trades/5min/user
const ANOMALY_COOLDOWN_MS = 30 * 60 * 1000; // 30min between repeat alerts per user
const _anomalyAlertedAt = new Map();   // userId → ms timestamp last alert
function _runAnomalyDetector() {
    try {
        const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const rows = db.prepare(
            "SELECT user_id, COUNT(*) AS n FROM audit_log WHERE created_at >= ? AND action IN ('ORDER_PLACED','ORDER_FILLED') GROUP BY user_id HAVING n >= ?"
        ).all(cutoff, ANOMALY_THRESHOLD);
        if (rows.length === 0) return;
        const now = Date.now();
        for (const r of rows) {
            const last = _anomalyAlertedAt.get(r.user_id) || 0;
            if (now - last < ANOMALY_COOLDOWN_MS) continue;
            _anomalyAlertedAt.set(r.user_id, now);
            const msg = `⚠️ Trading anomaly uid=${r.user_id}: ${r.n} ORDER events în 5min (threshold ${ANOMALY_THRESHOLD}). Possible runaway bug or account compromise.`;
            console.warn('[DB] ' + msg);
            try { require('./telegram').send(msg); } catch (_) { }
        }
    } catch (err) {
        console.error('[DB] Anomaly detector failed:', err.message);
    }
}
setTimeout(_runAnomalyDetector, 150000);    // 2.5min post-boot
setInterval(_runAnomalyDetector, 5 * 60 * 1000); // every 5min

process.on('exit', closeDb);

// ─── [Phase 2 S3] Brain Parity Harness Helpers ───
const _parityInsert = db.prepare(
    'INSERT INTO brain_parity_log (user_id, symbol, source, cycle, dir, decision, confidence, score, reasons, created_at) '
    + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);

function _parityNormalizeDir(d) {
    if (!d) return 'neutral';
    const s = String(d).toLowerCase();
    if (s === 'long' || s === 'bull' || s === 'buy') return 'long';
    if (s === 'short' || s === 'bear' || s === 'sell') return 'short';
    return 'neutral';
}

function logParityRow(userId, symbol, source, fusion, cycle) {
    // Shadow logging — never throws. Silently skips bad input so parity
    // infrastructure can never affect the live runtime.
    try {
        if (!userId || !symbol) return;
        if (source !== 'client' && source !== 'server') return;
        if (!fusion || typeof fusion !== 'object') return;
        _parityInsert.run(
            Number(userId),
            String(symbol).slice(0, 32),
            source,
            cycle != null && !isNaN(Number(cycle)) ? Number(cycle) : null,
            fusion.dir != null ? String(fusion.dir).slice(0, 16) : null,
            fusion.decision != null ? String(fusion.decision).slice(0, 16) : null,
            fusion.confidence != null && !isNaN(Number(fusion.confidence)) ? Number(fusion.confidence) : null,
            fusion.score != null && !isNaN(Number(fusion.score)) ? Number(fusion.score) : null,
            fusion.reasons ? JSON.stringify(Array.isArray(fusion.reasons) ? fusion.reasons : [String(fusion.reasons)]).slice(0, 4096) : null,
            Date.now()
        );
    } catch (_err) { /* shadow must never throw */ }
}

// ─── [SP2 Task 8] Handover observability — record entry-ownership flips ───
const _handoverInsert = db.prepare(
    'INSERT INTO handover_log (user_id, from_owner, to_owner, reason, created_at) VALUES (?,?,?,?,?)'
);

function logHandover(userId, fromOwner, toOwner, reason) {
    try {
        if (!userId) return;
        _handoverInsert.run(Number(userId), String(fromOwner || ''), String(toOwner || ''), reason ? String(reason).slice(0, 64) : null, Date.now());
    } catch (_e) { /* observability must never throw */ }
}

// [Phase 2 S3.1b-fix] Parity report — PRIMARY vs COVERAGE split.
// Client emits two kinds of rows:
//   1. PRIMARY: chart symbol via autotrade.ts::computeFusionDecision — runs
//      the same weighted-fusion + modifier pipeline the server uses.
//      reasons field does NOT contain 'MultiScan_coverage'. THIS is the
//      metric that gates S4/S6/S8/S10/S11.
//   2. COVERAGE: non-chart symbols from klines.ts::runMultiSymbolScan —
//      uses a 5-indicator simple score without fusion modifiers. Emits
//      always decision='NO_TRADE' + reasons starting with 'MultiScan_coverage'.
//      Direction-only signal. Tracked separately so it does NOT inflate the
//      primary agreement score with forced NO_TRADE↔NO_TRADE matches.
// The report returns both metrics; callers (S4 gate, dashboards, scripts)
// must use primaryAgreementPct for unlock decisions.
const COVERAGE_TAG = 'MultiScan_coverage';

function queryParityReport(opts) {
    opts = opts || {};
    const since = opts.since != null && !isNaN(Number(opts.since)) ? Number(opts.since) : (Date.now() - 24 * 3600 * 1000);
    const symbolFilter = opts.symbol ? String(opts.symbol) : null;
    const userFilter = opts.userId != null && !isNaN(Number(opts.userId)) ? Number(opts.userId) : null;
    const matchWindowMs = 15000; // ±15s correlation window per audit S3 spec

    // Pull client rows — reasons is JSON text, filter in JS so legacy rows
    // without the tag fall into PRIMARY automatically (safe default).
    const clientSql = 'SELECT id, user_id, symbol, cycle, dir, decision, confidence, score, reasons, created_at '
        + 'FROM brain_parity_log WHERE source = \'client\' AND created_at >= ?'
        + (userFilter != null ? ' AND user_id = ?' : '')
        + (symbolFilter ? ' AND symbol = ?' : '')
        + ' ORDER BY created_at ASC';
    const clientArgs = [since];
    if (userFilter != null) clientArgs.push(userFilter);
    if (symbolFilter) clientArgs.push(symbolFilter);
    const clientRows = db.prepare(clientSql).all(...clientArgs);

    // Aggregate counts — server rows visible in window for context
    const serverCountRow = db.prepare(
        'SELECT COUNT(*) AS cnt FROM brain_parity_log WHERE source = \'server\' AND created_at >= ?'
        + (userFilter != null ? ' AND user_id = ?' : '')
        + (symbolFilter ? ' AND symbol = ?' : '')
    ).get(...clientArgs);
    const serverRowCount = (serverCountRow && serverCountRow.cnt) || 0;

    const findPair = db.prepare(
        'SELECT id, dir, decision, confidence, score, created_at FROM brain_parity_log '
        + 'WHERE source = \'server\' AND user_id = ? AND symbol = ? '
        + 'AND created_at BETWEEN ? AND ? '
        + 'ORDER BY ABS(created_at - ?) ASC LIMIT 1'
    );

    // Separate accumulators for primary and coverage tracks.
    // [S3.1e] Per-bucket: RAW (existing) + ADJUSTED (NO_TRADE/NO_TRADE = match
    // dir-agnostic) + per-user breakdown alongside per-symbol.
    const _mkBucket = () => ({
        matched: 0, mismatched: 0, unpaired: 0,
        adjMatched: 0, adjMismatched: 0, ntDirOnly: 0,
        // [SP1] Actionable subset — cycles where at least one side would trade
        // (decision != NO_TRADE). actionableMatched = full dir+tier agreement
        // among those. This is the parity that matters for execution: it ignores
        // direction-lean noise on mutual NO_TRADE, but (unlike adjusted) does NOT
        // count NO_TRADE/NO_TRADE as agreement, so no-trade regimes can't inflate it.
        actionable: 0, actionableMatched: 0,
        mismatchReasons: new Map(),
        bySymbol: new Map(),
        byUser: new Map(),
    });
    const primary = _mkBucket();
    const coverage = _mkBucket();

    for (const cr of clientRows) {
        const isCoverage = typeof cr.reasons === 'string' && cr.reasons.indexOf(COVERAGE_TAG) >= 0;
        const bucket = isCoverage ? coverage : primary;

        const sr = findPair.get(cr.user_id, cr.symbol, cr.created_at - matchWindowMs, cr.created_at + matchWindowMs, cr.created_at);
        if (!sr) { bucket.unpaired++; continue; }
        const cdN = _parityNormalizeDir(cr.dir);
        const sdN = _parityNormalizeDir(sr.dir);
        const cdec = String(cr.decision || '').toUpperCase();
        const sdec = String(sr.decision || '').toUpperCase();
        const dirMatch = cdN === sdN;
        const tierMatch = (cr.decision || '') === (sr.decision || '');
        const isMatch = dirMatch && tierMatch;
        // [S3.1e] Adjusted: NO_TRADE/NO_TRADE = match regardless of dir.
        const isAdjMatch = isMatch || (cdec === 'NO_TRADE' && sdec === 'NO_TRADE');
        const isNtDirOnly = !isMatch && (cdec === 'NO_TRADE' && sdec === 'NO_TRADE');

        if (isMatch) bucket.matched++; else bucket.mismatched++;
        if (isAdjMatch) bucket.adjMatched++; else bucket.adjMismatched++;
        if (isNtDirOnly) bucket.ntDirOnly++;
        // [SP1] Actionable: at least one side has a real (non-NO_TRADE) decision.
        if (cdec !== 'NO_TRADE' || sdec !== 'NO_TRADE') {
            bucket.actionable++;
            if (isMatch) bucket.actionableMatched++;
        }

        if (!isMatch) {
            const parts = [];
            if (!dirMatch) parts.push('dir:' + (cr.dir || '?') + '->' + (sr.dir || '?'));
            if (!tierMatch) parts.push('tier:' + (cr.decision || '?') + '->' + (sr.decision || '?'));
            const key = parts.join(' ') || 'unknown';
            bucket.mismatchReasons.set(key, (bucket.mismatchReasons.get(key) || 0) + 1);
        }
        // Per-symbol
        if (!bucket.bySymbol.has(cr.symbol)) bucket.bySymbol.set(cr.symbol, { matched: 0, mismatched: 0, adjMatched: 0, adjMismatched: 0 });
        const bs = bucket.bySymbol.get(cr.symbol);
        if (isMatch) bs.matched++; else bs.mismatched++;
        if (isAdjMatch) bs.adjMatched++; else bs.adjMismatched++;
        // Per-user
        if (!bucket.byUser.has(cr.user_id)) bucket.byUser.set(cr.user_id, { matched: 0, mismatched: 0, adjMatched: 0, adjMismatched: 0, unpaired: 0 });
        const bu = bucket.byUser.get(cr.user_id);
        if (isMatch) bu.matched++; else bu.mismatched++;
        if (isAdjMatch) bu.adjMatched++; else bu.adjMismatched++;
    }

    const _finalize = (bucket) => {
        const paired = bucket.matched + bucket.mismatched;
        const agreementPct = paired > 0 ? Number((100 * bucket.matched / paired).toFixed(2)) : null;
        const adjAgreementPct = paired > 0 ? Number((100 * bucket.adjMatched / paired).toFixed(2)) : null;
        // [SP1] Actionable agreement — over cycles where at least one side trades.
        const actionableAgreementPct = bucket.actionable > 0 ? Number((100 * bucket.actionableMatched / bucket.actionable).toFixed(2)) : null;
        const topMismatches = Array.from(bucket.mismatchReasons.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([reason, count]) => ({ reason, count }));
        const bySymbol = Array.from(bucket.bySymbol.entries()).map(([sym, v]) => {
            const tot = v.matched + v.mismatched;
            return {
                symbol: sym,
                matched: v.matched,
                mismatched: v.mismatched,
                agreementPct: tot > 0 ? Number((100 * v.matched / tot).toFixed(2)) : null,
                adjMatched: v.adjMatched,
                adjMismatched: v.adjMismatched,
                adjAgreementPct: tot > 0 ? Number((100 * v.adjMatched / tot).toFixed(2)) : null,
            };
        });
        const byUser = Array.from(bucket.byUser.entries()).map(([uid, v]) => {
            const tot = v.matched + v.mismatched;
            return {
                userId: uid,
                paired: tot,
                matched: v.matched,
                mismatched: v.mismatched,
                agreementPct: tot > 0 ? Number((100 * v.matched / tot).toFixed(2)) : null,
                adjMatched: v.adjMatched,
                adjMismatched: v.adjMismatched,
                adjAgreementPct: tot > 0 ? Number((100 * v.adjMatched / tot).toFixed(2)) : null,
            };
        }).sort((a, b) => b.paired - a.paired);
        return {
            paired,
            unpaired: bucket.unpaired,
            matched: bucket.matched,
            mismatched: bucket.mismatched,
            agreementPct,
            adjMatched: bucket.adjMatched,
            adjMismatched: bucket.adjMismatched,
            adjAgreementPct,
            ntDirOnly: bucket.ntDirOnly,
            actionable: bucket.actionable,
            actionableMatched: bucket.actionableMatched,
            actionableAgreementPct,
            topMismatches,
            bySymbol,
            byUser,
        };
    };

    const primaryStats = _finalize(primary);
    const coverageStats = _finalize(coverage);

    return {
        since,
        filters: { symbol: symbolFilter, userId: userFilter },
        // [S4-GATE] — S4 unlock decision reads primary.* only. coverage.* is
        // informational; forced NO_TRADE emits on multi-sym would inflate
        // tier-matching if merged.
        // [S3.1e] Adjusted metrics treat NO_TRADE/NO_TRADE as a match
        // regardless of direction. Per-user breakdown surfaces
        // modifier-induced divergence that the global average can mask.
        totals: {
            clientRows: clientRows.length,
            clientPrimaryRows: clientRows.length - clientRows.filter(r => typeof r.reasons === 'string' && r.reasons.indexOf(COVERAGE_TAG) >= 0).length,
            clientCoverageRows: clientRows.filter(r => typeof r.reasons === 'string' && r.reasons.indexOf(COVERAGE_TAG) >= 0).length,
            serverRows: serverRowCount,
            // Primary RAW — the original S4 metric
            primaryPairs: primaryStats.paired,
            primaryUnpaired: primaryStats.unpaired,
            primaryMatched: primaryStats.matched,
            primaryMismatched: primaryStats.mismatched,
            primaryAgreementPct: primaryStats.agreementPct,
            // [SP1] Primary ACTIONABLE — agreement over cycles where ≥1 side trades.
            // This is the SP1 gate metric: it ignores dir-lean noise on mutual
            // NO_TRADE yet (unlike adjusted) cannot be inflated by no-trade regimes.
            primaryActionablePairs: primaryStats.actionable,
            primaryActionableMatched: primaryStats.actionableMatched,
            primaryActionableAgreementPct: primaryStats.actionableAgreementPct,
            // Primary ADJUSTED — NO_TRADE/NO_TRADE dir-only counted as match
            primaryAdjMatched: primaryStats.adjMatched,
            primaryAdjMismatched: primaryStats.adjMismatched,
            primaryAdjAgreementPct: primaryStats.adjAgreementPct,
            primaryNtDirOnly: primaryStats.ntDirOnly,
            // Coverage RAW — informational
            coveragePairs: coverageStats.paired,
            coverageUnpaired: coverageStats.unpaired,
            coverageMatched: coverageStats.matched,
            coverageMismatched: coverageStats.mismatched,
            coverageAgreementPct: coverageStats.agreementPct,
            // Coverage ADJUSTED — informational
            coverageAdjMatched: coverageStats.adjMatched,
            coverageAdjMismatched: coverageStats.adjMismatched,
            coverageAdjAgreementPct: coverageStats.adjAgreementPct,
            coverageNtDirOnly: coverageStats.ntDirOnly,
        },
        primary: {
            topMismatches: primaryStats.topMismatches,
            bySymbol: primaryStats.bySymbol,
            byUser: primaryStats.byUser,
        },
        coverage: {
            topMismatches: coverageStats.topMismatches,
            bySymbol: coverageStats.bySymbol,
            byUser: coverageStats.byUser,
        },
    };
}

// [BUG-S7] DSL parity logging — silent-on-failure to never disturb runtime.
// Caller fire-and-forgets; failures only console.warn for forensic visibility.
const _stmtLogDslParity = db.prepare(
    'INSERT INTO dsl_parity_log (user_id, pos_id, symbol, source, phase, current_sl, pivot_left, pivot_right, impulse_val, entry_price, tick_price, created_at) '
    + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
function logDslParityRow(userId, posId, symbol, source, dslState) {
    // [BUG-S7] Input guards — match S3 logParityRow pattern. Prevent corrupt
    // rows from polluting report (null/undefined coerced to literal string).
    if (!userId || !posId || !symbol) return;
    if (source !== 'client' && source !== 'server') return;
    if (!dslState || typeof dslState !== 'object') return;
    try {
        _stmtLogDslParity.run(
            userId, String(posId), symbol, source,
            dslState.phase || null,
            Number.isFinite(dslState.currentSL) ? dslState.currentSL : null,
            Number.isFinite(dslState.pivotLeft) ? dslState.pivotLeft : null,
            Number.isFinite(dslState.pivotRight) ? dslState.pivotRight : null,
            Number.isFinite(dslState.impulseVal) ? dslState.impulseVal : null,
            Number.isFinite(dslState.entry) ? dslState.entry : null,
            Number.isFinite(dslState.price) ? dslState.price : null,
            Date.now()
        );
    } catch (err) {
        console.warn('[DSL-PARITY] logDslParityRow failed:', err.message);
    }
}

// queryDslParityReport — correlate server↔client DSL rows on
// (user_id, pos_id, created_at ±2s) and compute divergence + phase match metrics.
function queryDslParityReport(opts) {
    opts = opts || {};
    const since = parseInt(opts.since, 10) || (Date.now() - 24 * 3600 * 1000);

    // Build WHERE clauses + args dynamic (parameterized binding — S3 norm)
    const buildQuery = (source) => {
        let sql = 'SELECT * FROM dsl_parity_log WHERE source = ? AND created_at >= ?';
        const args = [source, since];
        if (opts.userId != null) { sql += ' AND user_id = ?'; args.push(Number(opts.userId)); }
        if (opts.posId)          { sql += ' AND pos_id = ?';  args.push(String(opts.posId)); }
        sql += ' ORDER BY created_at';
        return { sql, args };
    };

    const sq = buildQuery('server');
    const cq = buildQuery('client');
    const serverRows = db.prepare(sq.sql).all(...sq.args);
    const clientRows = db.prepare(cq.sql).all(...cq.args);

    const PAIR_WINDOW_MS = 2000;
    const paired = [];
    const usedClientIdx = new Set();
    for (const sRow of serverRows) {
        let bestC = -1, bestDt = Infinity;
        for (let ci = 0; ci < clientRows.length; ci++) {
            if (usedClientIdx.has(ci)) continue;
            const cRow = clientRows[ci];
            if (cRow.user_id !== sRow.user_id || cRow.pos_id !== sRow.pos_id) continue;
            const dt = Math.abs(cRow.created_at - sRow.created_at);
            if (dt > PAIR_WINDOW_MS) continue;
            if (dt < bestDt) { bestDt = dt; bestC = ci; }
        }
        if (bestC >= 0) {
            usedClientIdx.add(bestC);
            paired.push({ s: sRow, c: clientRows[bestC] });
        }
    }

    const divs = [];
    let phaseMatches = 0;
    let phaseValidPairs = 0;
    for (const p of paired) {
        const entry = p.s.entry_price || p.c.entry_price;
        if (!Number.isFinite(entry) || entry <= 0) continue;
        if (Number.isFinite(p.s.current_sl) && Number.isFinite(p.c.current_sl)) {
            const div = Math.abs(p.s.current_sl - p.c.current_sl) / entry * 100;
            divs.push(div);
        }
        if (p.s.phase && p.c.phase) {
            phaseValidPairs++;
            if (p.s.phase === p.c.phase) phaseMatches++;
        }
    }
    divs.sort((a, b) => a - b);
    const mean = divs.length ? divs.reduce((a, b) => a + b, 0) / divs.length : 0;
    const p95 = divs.length ? divs[Math.floor(divs.length * 0.95)] : 0;
    const max = divs.length ? divs[divs.length - 1] : 0;

    return {
        since,
        paired: paired.length,
        divergencePct: { mean, p95, max, count: divs.length },
        phaseMatchPct: phaseValidPairs ? (phaseMatches / phaseValidPairs * 100) : 0,
        phaseValidPairs,
        gate: {
            primary_pass: mean < 2.0 && p95 < 5.0 && divs.length >= 500,
            secondary_pass: phaseValidPairs >= 100 && (phaseMatches / phaseValidPairs * 100) >= 95.0,
        },
    };
}

// [Wave 1] R0 DB contention monitor — records slow operations for diagnostics.
let _contentionMonitor = null;
function recordSlowQuery(userId, resolvedEnv, operation, durationMs) {
    if (durationMs < 100) return; // only log slow ops (>100ms threshold)
    try {
        if (!_contentionMonitor) _contentionMonitor = require('./ml/R0_substrate/dbContentionMonitor');
        _contentionMonitor.recordOperation({ userId, resolvedEnv, operation, durationMs });
    } catch (_) { /* never block on contention telemetry */ }
}

// ─── Support chat helpers ───
const _supInsert = db.prepare(
    'INSERT INTO support_messages (user_id, sender, message, read_by_admin, read_by_user) VALUES (?, ?, ?, ?, ?)'
);
const _supGetById = db.prepare('SELECT * FROM support_messages WHERE id = ?');
const _supThread = db.prepare('SELECT * FROM support_messages WHERE user_id = ? ORDER BY id ASC');
const _supUnreadUser = db.prepare(
    "SELECT COUNT(*) AS n FROM support_messages WHERE user_id = ? AND sender = 'admin' AND read_by_user = 0"
);
const _supTotalUnreadAdmin = db.prepare(
    "SELECT COUNT(*) AS n FROM support_messages WHERE sender = 'user' AND read_by_admin = 0"
);
const _supMarkAdmin = db.prepare(
    "UPDATE support_messages SET read_by_admin = 1 WHERE user_id = ? AND sender = 'user'"
);
const _supMarkUser = db.prepare(
    "UPDATE support_messages SET read_by_user = 1 WHERE user_id = ? AND sender = 'admin'"
);
const _supInbox = db.prepare(`
    SELECT m.user_id                                   AS user_id,
           u.email                                     AS email,
           (SELECT message FROM support_messages x WHERE x.user_id = m.user_id ORDER BY x.id DESC LIMIT 1) AS last_message,
           (SELECT created_at FROM support_messages x WHERE x.user_id = m.user_id ORDER BY x.id DESC LIMIT 1) AS last_at,
           SUM(CASE WHEN m.sender = 'user' AND m.read_by_admin = 0 THEN 1 ELSE 0 END) AS unread_count
    FROM support_messages m
    LEFT JOIN users u ON u.id = m.user_id
    GROUP BY m.user_id
    ORDER BY last_at DESC
`);
const _supAdminIds = db.prepare("SELECT id FROM users WHERE role = 'admin'");

function insertSupportMessage(userId, sender, message) {
    const readByAdmin = sender === 'admin' ? 1 : 0;
    const readByUser = sender === 'user' ? 1 : 0;
    const info = _supInsert.run(userId, sender, message, readByAdmin, readByUser);
    return _supGetById.get(info.lastInsertRowid);
}
function getSupportThread(userId) { return _supThread.all(userId); }
function getSupportUnreadForUser(userId) { return _supUnreadUser.get(userId).n; }
function getSupportTotalUnreadForAdmin() { return _supTotalUnreadAdmin.get().n; }
function markSupportThreadReadByAdmin(userId) { _supMarkAdmin.run(userId); }
function markSupportThreadReadByUser(userId) { _supMarkUser.run(userId); }
function getSupportInbox() { return _supInbox.all(); }
function getAdminUserIds() { return _supAdminIds.all().map(r => r.id); }

module.exports = {
    db,
    USER_STATUS, // [M6]
    findUserByEmail,
    findUserById,
    setUserProfile,
    getUserProfileById,
    findUserByUsername,
    countUsers,
    createUser,
    setUserTermsConsent,
    listUsers,
    approveUser,
    rejectUser,
    deleteUser,
    updatePassword,
    bumpTokenVersion,
    setTempPasswordMeta,
    clearTempPasswordMeta,
    setLastActiveAt,
    getLastActiveAt,
    markTelegramBroken,
    clearTelegramBroken,
    getTelegramBrokenStatus,
    updateEmail,
    atomicEmailUpdate,
    setUserStatus,
    banUser,
    unbanUser,
    getExchangeAccount,
    getExchangeByName,
    getExchangeAccountByExchange,
    getConnectedExchanges,
    getAllExchanges,
    saveExchangeAccount,
    saveExchangeByName,
    disconnectExchange,
    disconnectExchangeByName,
    listAllExchangeAccounts,
    setUserTelegram,
    getUserTelegram,
    getAllTelegramUsers,
    auditLog,
    listAuditLog,
    listAuditLogByUser,
    listAuditLogByTarget,
    // [Phase 2 S3] Parity harness
    logParityRow,
    queryParityReport,
    // [SP2 Task 8] Handover observability
    logHandover,
    // [S7] DSL Parity harness
    logDslParityRow,
    queryDslParityReport,
    addPasswordHistory,
    getPasswordHistory,
    migrateFromJson,
    closeDb,
    // PIN
    setUserPin,
    getUserPin,
    clearUserPin,
    // AT Engine
    atSavePosition,
    atRemovePosition,
    atArchiveClosed,
    atInsertClosed: (seq, data, userId) => _stmts.atInsertClosed.run(seq, data, userId),
    atLoadOpenPositions,
    atGetOpenUserIds,
    atGetState,
    atSetState,
    atGetStateByUser,
    atPruneClosed,
    // [PERF-2 2026-06-01] Parity-log retention prune (batched, no VACUUM)
    pruneParityLogs,
    _parityPruneBatch,
    _parityCutoffId,
    // [Task M 2026-05-28] Orphan order sweeper helper
    getZeusOrderIds,
    // [B2] Startup ghost cleanup helpers
    runRaw: (sql) => { const r = db.prepare(sql).run(); return r.changes; },
    deleteGhostPosition: (seq, userId) => { return db.prepare('DELETE FROM at_positions WHERE seq = ? AND user_id = ?').run(seq, userId).changes; },
    getGhostCandidates: () => {
        // Returns seqs that exist in BOTH at_positions AND at_closed, with timestamps for comparison
        return db.prepare(`
            SELECT p.seq, p.user_id,
                   COALESCE(json_extract(p.data, '$.ts'), 0) as openTs,
                   COALESCE(c.closed_at, json_extract(c.data, '$.closeTs'), 0) as closedTs
            FROM at_positions p
            INNER JOIN at_closed c ON p.seq = c.seq AND p.user_id = c.user_id
        `).all();
    },
    // [S2] Max seq across positions + closed — prevents seq collision after reset.
    // [DB-9] Was UNION ALL on `seq` columns — SQLite materializes into temp result
    // before MAX. Split into 2 separate queries that hit `idx_at_pos_user` and
    // `idx_at_closed_user` indexes directly + Math.max în JS. Faster + scales
    // linearly per-table instead of dual scan.
    getMaxSeq: (userId) => {
        const r1 = db.prepare('SELECT MAX(seq) as m FROM at_positions WHERE user_id = ?').get(userId);
        const r2 = db.prepare('SELECT MAX(seq) as m FROM at_closed WHERE user_id = ?').get(userId);
        return Math.max((r1 && r1.m) || 0, (r2 && r2.m) || 0);
    },
    // Journal
    journalGetClosed: (userId, limit, offset) => _stmts.journalGetClosed.all(userId, limit, offset),
    journalCountClosed: (userId) => (_stmts.journalCountClosed.get(userId) || { cnt: 0 }).cnt,
    // Trade annotations
    saveAnnotation: (seq, userId, notes, tags, rating) => _stmts.annotationUpsert.run(seq, userId, notes || '', JSON.stringify(tags || []), rating || 0),
    getAnnotation: (seq, userId) => {
        const row = _stmts.annotationGet.get(seq, userId);
        if (!row) return null;
        try { row.tags = JSON.parse(row.tags); } catch (_) { row.tags = []; }
        return row;
    },
    getAnnotationsByUser: (userId) => {
        return _stmts.annotationsByUser.all(userId).map(r => {
            try { r.tags = JSON.parse(r.tags); } catch (_) { r.tags = []; }
            return r;
        });
    },
    // User settings (per-user UPSERT)
    getUserSettings: (userId) => {
        const row = _stmts.settingsGet.get(userId);
        if (!row) return null;
        try { return JSON.parse(row.data); } catch (_) { return null; }
    },
    // [MIGRATION-F0] Returns { data, updatedAt } where updatedAt is epoch ms.
    // Used by GET /api/user/settings to expose updated_at so clients can
    // detect server-newer state without re-parsing whole payload.
    getUserSettingsWithTs: (userId) => {
        const row = _stmts.settingsGetWithTs.get(userId);
        if (!row) return { data: null, updatedAt: 0 };
        let data = null;
        try { data = JSON.parse(row.data); } catch (_) { data = null; }
        const updatedAt = row.updated_at ? Date.parse(row.updated_at + 'Z') || 0 : 0;
        return { data, updatedAt };
    },
    saveUserSettings: (userId, data) => {
        _stmts.settingsUpsert.run(userId, JSON.stringify(data));
        // Return the fresh updated_at so callers can broadcast it.
        const row = _stmts.settingsGetTs.get(userId);
        return row && row.updated_at ? (Date.parse(row.updated_at + 'Z') || 0) : 0;
    },
    // ARES state (per-user UPSERT)
    getAresState: (userId) => {
        const row = _stmts.aresGet.get(userId);
        if (!row) return null;
        try { return JSON.parse(row.data); } catch (_) { return null; }
    },
    saveAresState: (userId, data) => {
        _stmts.aresUpsert.run(userId, JSON.stringify(data));
    },
    // User context data (per-user per-section, Phase 8)
    getCtxSection: (userId, section) => {
        const row = _stmts.ctxGet.get(userId, section);
        if (!row) return null;
        try { return JSON.parse(row.data); } catch (_) { return null; }
    },
    getCtxAll: (userId) => {
        const rows = _stmts.ctxGetAll.all(userId);
        const result = {};
        for (const r of rows) {
            try { result[r.section] = JSON.parse(r.data); } catch (_) { result[r.section] = null; }
        }
        return result;
    },
    saveCtxSection: (userId, section, data) => {
        _stmts.ctxUpsert.run(userId, section, JSON.stringify(data));
    },
    saveCtxBulk: (userId, sections) => {
        const tx = db.transaction(() => {
            for (const [section, data] of Object.entries(sections)) {
                _stmts.ctxUpsert.run(userId, section, JSON.stringify(data));
            }
        });
        tx();
    },
    deleteCtxSection: (userId, section) => {
        _stmts.ctxDelete.run(userId, section);
    },
    deleteCtxAll: (userId) => {
        _stmts.ctxDeleteAll.run(userId);
    },
    // Missed trades
    saveMissedTrade: (userId, symbol, side, reason, price, confidence, tier, regime, data) => {
        _stmts.missedInsert.run(userId, symbol, side, reason, price, confidence || 0, tier || '', regime || '', JSON.stringify(data || {}));
        _stmts.missedPrune.run(userId, userId); // keep max 200 per user
    },
    getMissedTrades: (userId, limit) => {
        return _stmts.missedByUser.all(userId, limit || 50).map(r => {
            try { r.data = JSON.parse(r.data); } catch (_) { r.data = {}; }
            return r;
        });
    },
    // Regime history (per-user; userId required)
    saveRegimeChange: (symbol, regime, prevRegime, confidence, price, userId) => {
        if (!userId) throw new Error('saveRegimeChange requires userId');
        _stmts.regimeInsert.run(symbol, regime, prevRegime || '', confidence || 0, price || 0, userId);
        _stmts.regimePruneUser.run(userId, userId); // keep max 500 per user
    },
    getRegimeHistory: (symbol, userId, limit) => {
        if (!userId) throw new Error('getRegimeHistory requires userId');
        return _stmts.regimeBySymbolUser.all(symbol, userId, limit || 100);
    },
    getRegimeHistoryByUser: (userId, limit) => {
        if (!userId) throw new Error('getRegimeHistoryByUser requires userId');
        return _stmts.regimeByUser.all(userId, limit || 100);
    },
    // Brain decisions (ML data layer)
    bdInsert: (snapId, userId, symbol, ts, cycle, sourcePath, finalTier, finalConf, finalDir, finalAction, linkedSeq, data, resolvedEnv) => {
        _stmts.bdInsert.run(snapId, userId, symbol, ts, cycle, sourcePath, finalTier, finalConf, finalDir, finalAction, linkedSeq, JSON.stringify(data), resolvedEnv || 'DEMO');
    },
    bdLinkSeq: (snapId, seq) => _stmts.bdLinkSeq.run(seq, snapId),
    bdUpdateData: (snapId, data) => _stmts.bdUpdateData.run(JSON.stringify(data), snapId),
    bdUpdateAction: (snapId, action) => _stmts.bdUpdateAction.run(action, snapId),
    bdGetBySnap: (snapId) => {
        const row = _stmts.bdGetBySnap.get(snapId);
        if (!row) return null;
        try { row.data = JSON.parse(row.data); } catch (_) { row.data = {}; }
        return row;
    },
    bdGetBySeq: (seq) => {
        const rows = _stmts.bdGetBySeq.all(seq);
        for (const r of rows) { try { r.data = JSON.parse(r.data); } catch (_) { r.data = {}; } }
        return rows;
    },
    bdPrune: () => {
        const now = Date.now();
        const d30 = now - 30 * 86400000;
        const d90 = now - 90 * 86400000;
        const d365 = now - 365 * 86400000;
        _stmts.bdPruneNoTrade.run(d30);
        _stmts.bdPruneBlocked.run(d90);
        _stmts.bdPruneTrade.run(d365);
    },
    // [AUDIT-F1 2026-06-11] ml_influence_audit retention — keep 30 days.
    mlAuditPrune: (now = Date.now()) => _stmts.mlAuditPruneOld.run(now - 30 * 86400000).changes,
    // [AUDIT-F2 2026-06-11] brain_parity_log retention — keep 60 days.
    parityPrune: (now = Date.now()) => _stmts.parityPruneOld.run(now - 60 * 86400000).changes,
    bdCount: () => _stmts.bdCount.all(),
    // [SEC-1] Login attempts
    loginAttemptGet: (kind, key) => _stmts.loginAttemptGet.get(kind, key) || null,
    loginAttemptUpsert: (kind, key, count, resetAt) => _stmts.loginAttemptUpsert.run(kind, key, count, resetAt),
    loginAttemptDelete: (kind, key) => _stmts.loginAttemptDelete.run(kind, key),
    loginAttemptPruneExpired: (now) => _stmts.loginAttemptPruneExpired.run(now).changes,
    // [Wave 1] R0 DB contention monitor — records slow operations for diagnostics.
    recordSlowQuery,
    // [Task 1 support chat] DB helpers for support_messages table
    insertSupportMessage,
    getSupportThread,
    getSupportUnreadForUser,
    getSupportTotalUnreadForAdmin,
    markSupportThreadReadByAdmin,
    markSupportThreadReadByUser,
    getSupportInbox,
    getAdminUserIds,
};
