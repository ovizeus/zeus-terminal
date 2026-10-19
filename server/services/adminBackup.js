'use strict';
// [BACKUP-ZEUS 2026-10-19] Operator-triggered, passphrase-encrypted full backup
// of the live database, downloadable once from the admin panel.
//
// WHY THIS EXISTS, AND WHY IT VERIFIES SO HARD
// On 2026-10-18 four consecutive nightly backups were found MALFORMED while
// looking perfectly healthy in a directory listing: right name, right date,
// plausible size. Two processes had been running the online backup against the
// same live database, and the copy was torn. Nobody had opened the result. So:
//   * the snapshot is quick_check'ed BEFORE anything is published;
//   * the encrypted artifact is then decrypted and decompressed end-to-end,
//     so what we offer has been proven readable, not merely written;
//   * publishing is a rename of a .tmp that already passed both gates, which
//     also makes a second writer unable to collide with the final name.
//
// THREAT MODEL FOR THE DOWNLOAD
// This file is the single most sensitive object in the system: exchange keys
// (themselves encrypted), password hashes, every user's data. So the server
// never holds the key: the operator types a passphrase, scrypt derives a key in
// memory, AES-256-GCM encrypts, and the passphrase is dropped. A leaked file is
// inert without it. GCM also means tampering is detected rather than restored.
// Format: "ZEUSBK01" | salt(16) | iv(12) | gzip-then-AES ciphertext | tag(16)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');

const MAGIC = Buffer.from('ZEUSBK01', 'utf8');
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + SALT_LEN + IV_LEN;
const SCRYPT_N = 1 << 15; // ~100ms, deliberate: this guards an offline file
const MIN_PASSPHRASE = 8;

const ID_RE = /^zeus-full-(\d{1,16})\.db\.gz\.enc$/;
const DOWNLOAD_TTL_MS = 5 * 60 * 1000;

function _deriveKey(passphrase, salt) {
    return crypto.scryptSync(String(passphrase), salt, 32, { N: SCRYPT_N, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
}

// ─── ids / paths ─────────────────────────────────────────────────────────────
// Resolve a request id to a real path inside dir, or null. Traversal-safe: the
// id must match ID_RE (no separators possible) AND still land in dir.
function resolveBackup(id, dir) {
    if (typeof id !== 'string' || !ID_RE.test(id)) return null;
    const full = path.join(dir, id);
    if (path.dirname(full) !== path.resolve(dir)) return null;
    return full;
}
function _manifestPathFor(full) { return full.replace(/\.db\.gz\.enc$/, '.json'); }

// ─── download tokens ─────────────────────────────────────────────────────────
// Single-use and short-lived, because a long-lived URL for this file is a
// standing liability: it would survive in history, proxies and screenshots.
const _tokens = new Map(); // token -> { id, expiresAt }

function issueDownloadToken(id, opts) {
    const o = opts || {};
    const now = o.nowMs != null ? o.nowMs : Date.now();
    const ttl = o.ttlMs != null ? o.ttlMs : DOWNLOAD_TTL_MS;
    const token = crypto.randomBytes(32).toString('hex');
    _tokens.set(token, { id, expiresAt: now + ttl });
    // Opportunistic sweep so a long-lived process cannot accumulate dead tokens.
    for (const [t, v] of _tokens) if (v.expiresAt <= now) _tokens.delete(t);
    return token;
}

function verifyDownloadToken(token, opts) {
    if (typeof token !== 'string' || !token) return null;
    const o = opts || {};
    const now = o.nowMs != null ? o.nowMs : Date.now();
    const rec = _tokens.get(token);
    if (!rec) return null;
    _tokens.delete(token); // single use: spent whether or not it was still valid
    if (rec.expiresAt <= now) return null;
    return rec.id;
}

// ─── listing ─────────────────────────────────────────────────────────────────
// A file without a manifest is reported UNVERIFIED. It is never reported as
// fine: that is exactly the mistake the 2026-10-18 listing made.
function listBackups(dir) {
    let names;
    try { names = fs.readdirSync(dir); } catch (_) { return []; }
    return names
        .filter((n) => ID_RE.test(n))
        .map((n) => {
            const full = path.join(dir, n);
            let size = 0;
            try { size = fs.statSync(full).size; } catch (_) { /* */ }
            let man = null;
            try { man = JSON.parse(fs.readFileSync(_manifestPathFor(full), 'utf8')); } catch (_) { /* */ }
            return {
                id: n,
                createdAt: man && man.createdAt != null ? man.createdAt : parseInt(n.match(ID_RE)[1], 10),
                size,
                verified: !!(man && man.verified === true),
                sha256: (man && man.sha256) || null,
                dbBytes: (man && man.dbBytes) || null,
                note: (man && man.note) || null,
            };
        })
        .sort((a, b) => b.createdAt - a.createdAt);
}

function deleteBackup(id, dir) {
    const full = resolveBackup(id, dir);
    if (!full || !fs.existsSync(full)) return false;
    try {
        fs.unlinkSync(full);
        try { fs.unlinkSync(_manifestPathFor(full)); } catch (_) { /* manifest may be absent */ }
        return true;
    } catch (_) { return false; }
}

// ─── verification of a plain snapshot ────────────────────────────────────────
function _quickCheck(snapPath) {
    let db = null;
    try {
        const Database = require('better-sqlite3');
        db = new Database(snapPath, { readonly: true, fileMustExist: true });
        const row = db.prepare('PRAGMA quick_check').get();
        const val = row && (row.quick_check || row['quick_check']);
        return { ok: String(val) === 'ok', detail: String(val) };
    } catch (e) {
        return { ok: false, detail: e && e.message ? e.message : 'quick_check threw' };
    } finally {
        if (db) { try { db.close(); } catch (_) { /* */ } }
    }
}

// Online snapshot of a live database. Uses the SQLite backup API through
// better-sqlite3, which is WAL-safe for THIS connection — the 2026-10-18
// corruption came from a second process doing the same thing concurrently,
// not from the API itself.
async function _snapshot(srcPath, destPath) {
    const Database = require('better-sqlite3');
    const db = new Database(srcPath, { readonly: true, fileMustExist: true });
    try { await db.backup(destPath); } finally { try { db.close(); } catch (_) { /* */ } }
}

// ─── encrypt / decrypt ───────────────────────────────────────────────────────
async function _encryptFile(plainPath, encPath, passphrase) {
    const salt = crypto.randomBytes(SALT_LEN);
    const iv = crypto.randomBytes(IV_LEN);
    const key = _deriveKey(passphrase, salt);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const out = fs.createWriteStream(encPath);
    out.write(Buffer.concat([MAGIC, salt, iv]));
    await pipeline(fs.createReadStream(plainPath), zlib.createGzip({ level: 6 }), cipher, out);
    // GCM tag is only known once everything is through, so it trails the body.
    await fs.promises.appendFile(encPath, cipher.getAuthTag());
    const hash = crypto.createHash('sha256');
    await pipeline(fs.createReadStream(encPath), hash);
    return { sha256: hash.digest('hex') };
}

// Decrypt to destPath. Throws if the passphrase is wrong or the file was
// tampered with (GCM), and never leaves a partial database behind.
async function decryptToFile({ encPath, destPath, passphrase }) {
    const st = await fs.promises.stat(encPath);
    if (st.size < HEADER_LEN + TAG_LEN) throw new Error('backup file is too small to be valid');
    const fh = await fs.promises.open(encPath, 'r');
    let header, tag;
    try {
        header = Buffer.alloc(HEADER_LEN);
        await fh.read(header, 0, HEADER_LEN, 0);
        tag = Buffer.alloc(TAG_LEN);
        await fh.read(tag, 0, TAG_LEN, st.size - TAG_LEN);
    } finally { await fh.close(); }

    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not a Zeus backup file');
    const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_LEN);
    const iv = header.subarray(MAGIC.length + SALT_LEN, HEADER_LEN);
    const decipher = crypto.createDecipheriv('aes-256-gcm', _deriveKey(passphrase, salt), iv);
    decipher.setAuthTag(tag);

    try {
        await pipeline(
            fs.createReadStream(encPath, { start: HEADER_LEN, end: st.size - TAG_LEN - 1 }),
            decipher,
            zlib.createGunzip(),
            fs.createWriteStream(destPath),
        );
    } catch (e) {
        try { fs.unlinkSync(destPath); } catch (_) { /* */ }
        const msg = /auth/i.test(String(e && e.message)) ? 'wrong passphrase, or the file was altered' : (e && e.message) || 'decrypt failed';
        throw new Error(msg);
    }
}

// Prove the artifact we are about to publish actually reads back: decrypt and
// decompress it to nowhere. Catches a bad tag and a bad gzip CRC.
async function _verifyEncrypted(encPath, passphrase) {
    const st = await fs.promises.stat(encPath);
    const fh = await fs.promises.open(encPath, 'r');
    let header, tag;
    try {
        header = Buffer.alloc(HEADER_LEN);
        await fh.read(header, 0, HEADER_LEN, 0);
        tag = Buffer.alloc(TAG_LEN);
        await fh.read(tag, 0, TAG_LEN, st.size - TAG_LEN);
    } finally { await fh.close(); }
    const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_LEN);
    const iv = header.subarray(MAGIC.length + SALT_LEN, HEADER_LEN);
    const decipher = crypto.createDecipheriv('aes-256-gcm', _deriveKey(passphrase, salt), iv);
    decipher.setAuthTag(tag);
    let bytes = 0;
    const sink = new (require('stream').Writable)({ write(c, _e, cb) { bytes += c.length; cb(); } });
    await pipeline(
        fs.createReadStream(encPath, { start: HEADER_LEN, end: st.size - TAG_LEN - 1 }),
        decipher, zlib.createGunzip(), sink,
    );
    return { ok: bytes > 0, plainBytes: bytes };
}

// ─── create ──────────────────────────────────────────────────────────────────
async function createBackup({ srcPath, dir, passphrase, nowMs, verify, verifyEncrypted, note }) {
    const now = nowMs != null ? nowMs : Date.now();
    const pass = typeof passphrase === 'string' ? passphrase.trim() : '';
    if (pass.length < MIN_PASSPHRASE) {
        return { ok: false, verified: false, error: `passphrase must be at least ${MIN_PASSPHRASE} characters` };
    }

    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* */ }
    const id = `zeus-full-${now}.db.gz.enc`;
    const finalPath = path.join(dir, id);
    const snapTmp = path.join(dir, `.zeus-full-${now}-${process.pid}.snap.tmp`);
    const encTmp = path.join(dir, `.zeus-full-${now}-${process.pid}.enc.tmp`);
    const cleanup = () => { for (const p of [snapTmp, encTmp]) { try { fs.unlinkSync(p); } catch (_) { /* */ } } };

    try {
        await _snapshot(srcPath, snapTmp);

        const verdict = (verify || _quickCheck)(snapTmp);
        if (!verdict || verdict.ok !== true) {
            cleanup();
            return { ok: false, verified: false, error: `snapshot failed verification: ${verdict && verdict.detail}` };
        }
        const dbBytes = fs.statSync(snapTmp).size;

        const { sha256 } = await _encryptFile(snapTmp, encTmp, pass);
        const rt = await (verifyEncrypted || _verifyEncrypted)(encTmp, pass);
        if (!rt.ok || rt.plainBytes !== dbBytes) {
            cleanup();
            return { ok: false, verified: false, error: 'encrypted artifact did not read back identically' };
        }

        fs.renameSync(encTmp, finalPath); // atomic publish
        const manifest = {
            id, createdAt: now, verified: true, sha256,
            cipher: 'aes-256-gcm', kdf: `scrypt(N=${SCRYPT_N},r=8,p=1)`,
            dbBytes, encBytes: fs.statSync(finalPath).size,
            note: note || null,
        };
        fs.writeFileSync(_manifestPathFor(finalPath), JSON.stringify(manifest, null, 2));
        try { fs.unlinkSync(snapTmp); } catch (_) { /* */ }
        return { ok: true, verified: true, id, ...manifest };
    } catch (e) {
        cleanup();
        return { ok: false, verified: false, error: (e && e.message) || 'backup failed' };
    }
}

module.exports = {
    createBackup, listBackups, deleteBackup, resolveBackup, decryptToFile,
    issueDownloadToken, verifyDownloadToken,
    ID_RE, MIN_PASSPHRASE, MAGIC, HEADER_LEN, TAG_LEN,
};
