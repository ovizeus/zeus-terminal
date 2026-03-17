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
`);

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
    blockUser: db.prepare("UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?"),

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

    // Audit
    insertAudit: db.prepare('INSERT INTO audit_log (user_id, action, details, ip) VALUES (?, ?, ?, ?)'),
    listAudit: db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?'),
    listAuditByUser: db.prepare('SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'),
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

function deleteUser(email, protectedRole) {
    return _stmts.deleteUser.run(email.toLowerCase().trim(), protectedRole || 'admin');
}

function updatePassword(userId, newHash) {
    return _stmts.updatePassword.run(newHash, userId);
}

function setUserStatus(userId, status) {
    return _stmts.blockUser.run(status, userId);
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

// ─── Audit methods ───

function auditLog(userId, action, details, ip) {
    _stmts.insertAudit.run(userId || null, action, typeof details === 'string' ? details : JSON.stringify(details), ip || null);
}

function getAuditLog(limit) {
    return _stmts.listAudit.all(Math.min(limit || 50, 500));
}

function getAuditLogByUser(userId, limit) {
    return _stmts.listAuditByUser.all(userId, Math.min(limit || 50, 500));
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

// ─── Graceful close ───
function closeDb() {
    try { db.close(); } catch (_) { }
}

process.on('exit', closeDb);

module.exports = {
    db,
    findUserByEmail,
    findUserById,
    countUsers,
    createUser,
    listUsers,
    approveUser,
    deleteUser,
    updatePassword,
    setUserStatus,
    getExchangeAccount,
    saveExchangeAccount,
    disconnectExchange,
    listAllExchangeAccounts,
    auditLog,
    getAuditLog,
    getAuditLogByUser,
    migrateFromJson,
    closeDb,
};
