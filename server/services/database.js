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
    const userIdFilter = opts.userId ? `AND user_id = ${parseInt(opts.userId, 10)}` : '';
    const posIdFilter = opts.posId ? `AND pos_id = '${String(opts.posId).replace(/'/g, "''")}'` : '';

    const serverRows = db.prepare(
        `SELECT * FROM dsl_parity_log WHERE source='server' AND created_at >= ? ${userIdFilter} ${posIdFilter} ORDER BY created_at`
    ).all(since);
    const clientRows = db.prepare(
        `SELECT * FROM dsl_parity_log WHERE source='client' AND created_at >= ? ${userIdFilter} ${posIdFilter} ORDER BY created_at`
    ).all(since);

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
