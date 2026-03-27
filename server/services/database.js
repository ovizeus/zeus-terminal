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
        console.log('[DB] Migration applied:', name);
    } catch (err) {
        console.warn('[DB] Migration', name, 'skipped:', err.message);
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

// ─── User methods ───

const _stmts = {
    findByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    findById: db.prepare('SELECT * FROM users WHERE id = ?'),
    countUsers: db.prepare('SELECT COUNT(*) as cnt FROM users'),
    insertUser: db.prepare('INSERT INTO users (email, password_hash, role, approved) VALUES (?, ?, ?, ?)'),
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
    findExchangeById: db.prepare('SELECT * FROM exchange_accounts WHERE id = ? AND user_id = ?'),
    insertExchange: db.prepare('INSERT INTO exchange_accounts (user_id, exchange, api_key_encrypted, api_secret_encrypted, mode, status, last_verified_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))'),
    updateExchange: db.prepare("UPDATE exchange_accounts SET api_key_encrypted = ?, api_secret_encrypted = ?, mode = ?, status = ?, last_verified_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ? AND is_active = 1"),
    deactivateExchange: db.prepare("UPDATE exchange_accounts SET is_active = 0, status = 'disconnected', updated_at = datetime('now') WHERE user_id = ? AND is_active = 1"),
    listAllExchanges: db.prepare(`
    SELECT ea.id, ea.user_id, ea.exchange, ea.mode, ea.status, ea.last_verified_at, ea.is_active, ea.created_at,
           u.email
    FROM exchange_accounts ea
    JOIN users u ON u.id = ea.user_id
    WHERE ea.is_active = 1
    ORDER BY ea.created_at
  `),

    // Telegram per-user
    setUserTelegram: db.prepare("UPDATE users SET telegram_bot_token_enc = ?, telegram_chat_id = ?, updated_at = datetime('now') WHERE id = ?"),
    getUserTelegram: db.prepare('SELECT telegram_bot_token_enc, telegram_chat_id FROM users WHERE id = ?'),
    getAllTelegramUsers: db.prepare('SELECT id, telegram_bot_token_enc, telegram_chat_id FROM users WHERE telegram_bot_token_enc IS NOT NULL AND telegram_chat_id IS NOT NULL'),

    // PIN per-user
    setPin: db.prepare("UPDATE users SET pin_hash = ?, updated_at = datetime('now') WHERE id = ?"),
    getPin: db.prepare('SELECT pin_hash FROM users WHERE id = ?'),
    clearPin: db.prepare("UPDATE users SET pin_hash = NULL, updated_at = datetime('now') WHERE id = ?"),

    // Token version (session invalidation)
    bumpTokenVersion: db.prepare("UPDATE users SET token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?"),

    // Password history
    insertPasswordHistory: db.prepare('INSERT INTO password_history (user_id, password_hash) VALUES (?, ?)'),
    getPasswordHistory: db.prepare('SELECT password_hash FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 5'),
    prunePasswordHistory: db.prepare('DELETE FROM password_history WHERE user_id = ? AND id NOT IN (SELECT id FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 5)'),

    // Audit
    insertAudit: db.prepare('INSERT INTO audit_log (user_id, action, details, ip) VALUES (?, ?, ?, ?)'),
    listAudit: db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?'),
    listAuditByUser: db.prepare('SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'),

    // AT Engine persistence — [MULTI-USER] all queries now include user_id
    atUpsertPos: db.prepare("INSERT INTO at_positions (seq, data, status, user_id) VALUES (?, ?, ?, ?) ON CONFLICT(seq) DO UPDATE SET data = excluded.data, status = excluded.status, user_id = excluded.user_id, updated_at = datetime('now')"),
    atDeletePos: db.prepare('DELETE FROM at_positions WHERE seq = ?'),
    atLoadOpenPosByUser: db.prepare("SELECT seq, data FROM at_positions WHERE status = 'OPEN' AND user_id = ?"),
    atGetOpenUserIds: db.prepare("SELECT DISTINCT user_id FROM at_positions WHERE status = 'OPEN' AND user_id IS NOT NULL"),
    atInsertClosed: db.prepare('INSERT OR REPLACE INTO at_closed (seq, data, user_id) VALUES (?, ?, ?)'),
    atGetState: db.prepare('SELECT value FROM at_state WHERE key = ?'),
    atSetState: db.prepare('INSERT OR REPLACE INTO at_state (key, value, user_id) VALUES (?, ?, ?)'),
    atGetStateByUser: db.prepare('SELECT key, value FROM at_state WHERE user_id = ?'),
    atPruneClosed: db.prepare('DELETE FROM at_closed WHERE seq NOT IN (SELECT seq FROM at_closed ORDER BY closed_at DESC LIMIT 500)'),
    // Journal queries
    journalGetClosed: db.prepare('SELECT seq, data, closed_at FROM at_closed WHERE user_id = ? ORDER BY closed_at DESC LIMIT ? OFFSET ?'),
    journalCountClosed: db.prepare('SELECT COUNT(*) as cnt FROM at_closed WHERE user_id = ?'),
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

function setUserStatus(userId, status) {
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

function saveExchangeAccount(userId, exchange, encKey, encSecret, mode) {
    const existing = _stmts.findExchange.get(userId);
    if (existing) {
        _stmts.updateExchange.run(encKey, encSecret, mode, 'verified', userId);
        return existing.id;
    }
    const info = _stmts.insertExchange.run(userId, exchange, encKey, encSecret, mode, 'verified');
    return info.lastInsertRowid;
}

function disconnectExchange(userId) {
    return _stmts.deactivateExchange.run(userId);
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

function listAuditLog(limit) {
    return _stmts.listAudit.all(limit || 100);
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

function atArchiveClosed(pos) {
    _stmts.atInsertClosed.run(pos.seq, JSON.stringify(pos), pos.userId || null);
    _stmts.atDeletePos.run(pos.seq);
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
    _stmts.atSetState.run(key, JSON.stringify(value), userId != null ? userId : null);
}

function atGetStateByUser(userId) {
    return _stmts.atGetStateByUser.all(userId).map(r => {
        let val;
        try { val = JSON.parse(r.value); } catch (_) { val = r.value; }
        return { key: r.key, value: val };
    });
}

function atPruneClosed() {
    _stmts.atPruneClosed.run();
}

// ─── Graceful close ───
function closeDb() {
    try { db.close(); } catch (_) { }
}

// ─── Daily SQLite backup (keeps last 7 copies) [C5] ───
const BACKUP_DIR = path.join(dataDir, 'db_backups');
const MAX_BACKUPS = 7;
let _lastBackupDate = '';

function _runDailyBackup() {
    const today = new Date().toISOString().slice(0, 10);
    if (_lastBackupDate === today) return;
    try {
        if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const dest = path.join(BACKUP_DIR, `zeus-${today}.db`);
        if (fs.existsSync(dest)) { _lastBackupDate = today; return; }
        db.backup(dest).then(() => {
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
        }).catch(err => {
            console.error('[DB] Backup failed:', err.message);
            try { require('./telegram').send(`⚠️ DB backup failed: ${err.message}`); } catch (_) { }
        });
    } catch (err) {
        console.error('[DB] Backup failed:', err.message);
    }
}
// Run backup check every hour + once at startup (after 30s)
setTimeout(_runDailyBackup, 30000);
setInterval(_runDailyBackup, 3600000);

process.on('exit', closeDb);

module.exports = {
    db,
    findUserByEmail,
    findUserById,
    countUsers,
    createUser,
    listUsers,
    approveUser,
    rejectUser,
    deleteUser,
    updatePassword,
    bumpTokenVersion,
    updateEmail,
    atomicEmailUpdate,
    setUserStatus,
    banUser,
    unbanUser,
    getExchangeAccount,
    saveExchangeAccount,
    disconnectExchange,
    listAllExchangeAccounts,
    setUserTelegram,
    getUserTelegram,
    getAllTelegramUsers,
    auditLog,
    listAuditLog,
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
    atLoadOpenPositions,
    atGetOpenUserIds,
    atGetState,
    atSetState,
    atGetStateByUser,
    atPruneClosed,
    // Journal
    journalGetClosed: (userId, limit, offset) => _stmts.journalGetClosed.all(userId, limit, offset),
    journalCountClosed: (userId) => (_stmts.journalCountClosed.get(userId) || { cnt: 0 }).cnt,
};
