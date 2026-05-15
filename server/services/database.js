// Zeus Terminal — SQLite Database Service
// Per-user isolation: users + exchange_accounts
'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'zeus.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

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

// ─── User methods ───

const _stmts = {
    findByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    findById: db.prepare('SELECT * FROM users WHERE id = ?'),
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
    findAllExchanges: db.prepare('SELECT * FROM exchange_accounts WHERE user_id = ? AND is_active = 1'),
    findExchangeById: db.prepare('SELECT * FROM exchange_accounts WHERE id = ? AND user_id = ?'),
    insertExchange: db.prepare('INSERT INTO exchange_accounts (user_id, exchange, api_key_encrypted, api_secret_encrypted, mode, status, last_verified_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))'),
    updateExchange: db.prepare("UPDATE exchange_accounts SET api_key_encrypted = ?, api_secret_encrypted = ?, mode = ?, status = ?, last_verified_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ? AND is_active = 1"),
    updateExchangeByName: db.prepare("UPDATE exchange_accounts SET api_key_encrypted = ?, api_secret_encrypted = ?, mode = ?, status = ?, last_verified_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ? AND exchange = ? AND is_active = 1"),
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
    bdInsert: db.prepare('INSERT INTO brain_decisions (snap_id, user_id, symbol, ts, cycle, source_path, final_tier, final_conf, final_dir, final_action, linked_seq, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    bdLinkSeq: db.prepare('UPDATE brain_decisions SET linked_seq = ? WHERE snap_id = ?'),
    bdUpdateData: db.prepare('UPDATE brain_decisions SET data = ? WHERE snap_id = ?'),
    bdUpdateAction: db.prepare('UPDATE brain_decisions SET final_action = ? WHERE snap_id = ?'),
    bdGetBySnap: db.prepare('SELECT snap_id, data FROM brain_decisions WHERE snap_id = ?'),
    bdGetBySeq: db.prepare('SELECT snap_id, data FROM brain_decisions WHERE linked_seq = ?'),
    bdPruneNoTrade: db.prepare("DELETE FROM brain_decisions WHERE final_tier = 'NO_TRADE' AND linked_seq IS NULL AND ts < ?"),
    bdPruneBlocked: db.prepare("DELETE FROM brain_decisions WHERE final_action LIKE 'blocked_%' AND ts < ?"),
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

function saveExchangeByName(userId, exchange, encKey, encSecret, mode) {
    const existing = _stmts.findExchangeByName.get(userId, exchange);
    if (existing) {
        _stmts.updateExchangeByName.run(encKey, encSecret, mode, 'verified', userId, exchange);
        return existing.id;
    }
    const info = _stmts.insertExchange.run(userId, exchange, encKey, encSecret, mode, 'verified');
    return info.lastInsertRowid;
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
            try { require('./telegram').send(msg); } catch (_) { }
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

module.exports = {
    db,
    USER_STATUS, // [M6]
    findUserByEmail,
    findUserById,
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
    bdInsert: (snapId, userId, symbol, ts, cycle, sourcePath, finalTier, finalConf, finalDir, finalAction, linkedSeq, data) => {
        _stmts.bdInsert.run(snapId, userId, symbol, ts, cycle, sourcePath, finalTier, finalConf, finalDir, finalAction, linkedSeq, JSON.stringify(data));
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
        _stmts.bdPruneNoTrade.run(d30);
        _stmts.bdPruneBlocked.run(d90);
    },
    bdCount: () => _stmts.bdCount.all(),
    // [SEC-1] Login attempts
    loginAttemptGet: (kind, key) => _stmts.loginAttemptGet.get(kind, key) || null,
    loginAttemptUpsert: (kind, key, count, resetAt) => _stmts.loginAttemptUpsert.run(kind, key, count, resetAt),
    loginAttemptDelete: (kind, key) => _stmts.loginAttemptDelete.run(kind, key),
    loginAttemptPruneExpired: (now) => _stmts.loginAttemptPruneExpired.run(now).changes,
};
