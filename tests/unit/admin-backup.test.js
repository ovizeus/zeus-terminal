// [BACKUP-ZEUS 2026-10-19] Operator-triggered, passphrase-encrypted full backup,
// downloadable from the admin panel.
//
// These tests exist because of the 2026-10-18 incident: four consecutive nightly
// backups were MALFORMED while looking perfectly healthy in a directory listing
// (right name, right date, plausible size). A backup nobody verified is not a
// backup. Two contracts are asserted here:
//   1. a snapshot that fails quick_check is NEVER published as downloadable;
//   2. the passphrase never reaches disk — the file is useless without it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const Database = require('better-sqlite3');

const svc = require('../../server/services/adminBackup');

const PASS = 'correct horse battery staple';
let tmpRoot;

function makeSrcDb(dir, rows = 5) {
    const p = path.join(dir, 'src.db');
    const db = new Database(p);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    const ins = db.prepare('INSERT INTO t (v) VALUES (?)');
    for (let i = 0; i < rows; i++) ins.run('row-' + i);
    db.close();
    return p;
}

beforeEach(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-bkp-test-')); });
afterEach(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) { /* */ } });

describe('backup id resolution is traversal-safe', () => {
    test('rejects path traversal and junk ids', () => {
        const dir = path.join(tmpRoot, 'b'); fs.mkdirSync(dir, { recursive: true });
        for (const bad of ['../../etc/passwd', '..', '/etc/passwd', 'zeus-full-1.db.gz.enc/../x',
            'nope.txt', '', null, undefined, 'zeus-full-abc.db.gz.enc', 'zeus-full-1.db.gz']) {
            expect(svc.resolveBackup(bad, dir)).toBeNull();
        }
    });
    test('accepts a well-formed id, inside the dir', () => {
        const dir = path.join(tmpRoot, 'b'); fs.mkdirSync(dir, { recursive: true });
        const id = 'zeus-full-1792367351000.db.gz.enc';
        expect(svc.resolveBackup(id, dir)).toBe(path.join(dir, id));
    });
});

describe('download tokens are short-lived and single-use', () => {
    test('verifies once, then is spent', () => {
        const tok = svc.issueDownloadToken('zeus-full-1792367351000.db.gz.enc');
        expect(tok.length).toBeGreaterThan(20);
        expect(svc.verifyDownloadToken(tok)).toBe('zeus-full-1792367351000.db.gz.enc');
        expect(svc.verifyDownloadToken(tok)).toBeNull();
    });
    test('refused once expired', () => {
        const id = 'zeus-full-1792367351001.db.gz.enc';
        expect(svc.verifyDownloadToken(svc.issueDownloadToken(id, { nowMs: 1000, ttlMs: 500 }), { nowMs: 1400 })).toBe(id);
        expect(svc.verifyDownloadToken(svc.issueDownloadToken(id, { nowMs: 1000, ttlMs: 500 }), { nowMs: 1600 })).toBeNull();
    });
    test('forged tokens refused', () => {
        for (const t of ['deadbeef'.repeat(8), '', null, 'x']) expect(svc.verifyDownloadToken(t)).toBeNull();
    });
});

describe('createBackup publishes only a VERIFIED, encrypted snapshot', () => {
    test('happy path: encrypted file published, and it restores to a sound DB', async () => {
        const dir = path.join(tmpRoot, 'b');
        const out = await svc.createBackup({ srcPath: makeSrcDb(tmpRoot, 7), dir, passphrase: PASS });

        expect(out.ok).toBe(true);
        expect(out.verified).toBe(true);
        expect(out.id).toMatch(/^zeus-full-\d+\.db\.gz\.enc$/);
        const full = path.join(dir, out.id);
        expect(fs.existsSync(full)).toBe(true);

        // Round-trip through the real decrypt path, then open the database.
        const plain = path.join(tmpRoot, 'restored.db');
        await svc.decryptToFile({ encPath: full, destPath: plain, passphrase: PASS });
        const rdb = new Database(plain, { readonly: true });
        expect(rdb.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
        expect(rdb.prepare('SELECT COUNT(*) AS n FROM t').get().n).toBe(7);
        rdb.close();

        expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp'))).toEqual([]);
    });

    test('THE PASSPHRASE NEVER REACHES DISK', async () => {
        const dir = path.join(tmpRoot, 'b');
        const out = await svc.createBackup({ srcPath: makeSrcDb(tmpRoot, 3), dir, passphrase: PASS });
        expect(out.ok).toBe(true);
        // Neither the manifest nor the ciphertext may contain the passphrase.
        for (const f of fs.readdirSync(dir)) {
            const buf = fs.readFileSync(path.join(dir, f));
            expect(buf.includes(Buffer.from(PASS, 'utf8'))).toBe(false);
        }
        const man = JSON.parse(fs.readFileSync(path.join(dir, out.id.replace(/\.db\.gz\.enc$/, '.json')), 'utf8'));
        expect(JSON.stringify(man)).not.toContain(PASS);
        expect(man.verified).toBe(true);
        expect(man.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(man.cipher).toBe('aes-256-gcm');
        // No key material parked in the manifest — only the public salt/iv live in the file header.
        expect(man.key).toBeUndefined();
        expect(man.passphrase).toBeUndefined();
    });

    test('a WRONG passphrase cannot decrypt it', async () => {
        const dir = path.join(tmpRoot, 'b');
        const out = await svc.createBackup({ srcPath: makeSrcDb(tmpRoot, 3), dir, passphrase: PASS });
        await expect(svc.decryptToFile({
            encPath: path.join(dir, out.id), destPath: path.join(tmpRoot, 'x.db'), passphrase: 'wrong pass',
        })).rejects.toThrow();
        // A failed decrypt must not leave a half-written database lying around.
        expect(fs.existsSync(path.join(tmpRoot, 'x.db'))).toBe(false);
    });

    test('a TAMPERED file is detected, not silently restored', async () => {
        const dir = path.join(tmpRoot, 'b');
        const out = await svc.createBackup({ srcPath: makeSrcDb(tmpRoot, 3), dir, passphrase: PASS });
        const full = path.join(dir, out.id);
        const buf = fs.readFileSync(full);
        buf[Math.floor(buf.length / 2)] ^= 0xff; // flip one byte in the ciphertext
        fs.writeFileSync(full, buf);
        await expect(svc.decryptToFile({
            encPath: full, destPath: path.join(tmpRoot, 'y.db'), passphrase: PASS,
        })).rejects.toThrow();
    });

    test('THE INCIDENT: a snapshot failing quick_check is NOT published', async () => {
        const dir = path.join(tmpRoot, 'b');
        const out = await svc.createBackup({
            srcPath: makeSrcDb(tmpRoot, 3), dir, passphrase: PASS,
            verify: () => ({ ok: false, detail: 'database disk image is malformed' }),
        });
        expect(out.ok).toBe(false);
        expect(out.verified).toBe(false);
        expect(String(out.error)).toMatch(/malformed/i);
        const left = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
        expect(left.filter((f) => f.endsWith('.enc'))).toEqual([]);
        expect(left.filter((f) => f.includes('.tmp'))).toEqual([]);
    });

    // M4 regression: without this test, deleting the round-trip check in
    // createBackup changed nothing — the gate was decoration. A snapshot can be
    // sound while the artifact we hand over is not (bad tag, truncated gzip),
    // which is precisely how 2026-10-18 looked from the outside.
    test('an artifact that does not read back is NOT published', async () => {
        const dir = path.join(tmpRoot, 'b');
        const out = await svc.createBackup({
            srcPath: makeSrcDb(tmpRoot, 4), dir, passphrase: PASS,
            verifyEncrypted: async () => ({ ok: false, plainBytes: 0 }),
        });
        expect(out.ok).toBe(false);
        expect(out.verified).toBe(false);
        expect(String(out.error)).toMatch(/read back/i);
        const left = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
        expect(left.filter((f) => f.endsWith('.enc'))).toEqual([]);
        expect(left.filter((f) => f.includes('.tmp'))).toEqual([]);
    });

    test('refuses to run without a passphrase', async () => {
        const dir = path.join(tmpRoot, 'b');
        const src = makeSrcDb(tmpRoot, 2);
        for (const bad of [undefined, '', '   ', 'short']) {
            const out = await svc.createBackup({ srcPath: src, dir, passphrase: bad });
            expect(out.ok).toBe(false);
            expect(String(out.error)).toMatch(/passphrase/i);
        }
        expect(fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.enc')) : []).toEqual([]);
    });
});

describe('listBackups reports what the operator needs to trust a file', () => {
    test('newest first, with size and verified status', async () => {
        const dir = path.join(tmpRoot, 'b');
        const src = makeSrcDb(tmpRoot, 2);
        const a = await svc.createBackup({ srcPath: src, dir, passphrase: PASS, nowMs: 1000 });
        const b = await svc.createBackup({ srcPath: src, dir, passphrase: PASS, nowMs: 2000 });
        expect(a.ok && b.ok).toBe(true);
        const items = svc.listBackups(dir);
        expect(items.map((i) => i.id)).toEqual([b.id, a.id]);
        expect(items[0].createdAt).toBe(2000);
        expect(items[0].size).toBeGreaterThan(0);
        expect(items[0].verified).toBe(true);
    });
    test('a file with no manifest is UNVERIFIED, never reported as fine', () => {
        const dir = path.join(tmpRoot, 'b'); fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'zeus-full-1792367351000.db.gz.enc'), 'junk');
        const items = svc.listBackups(dir);
        expect(items).toHaveLength(1);
        expect(items[0].verified).toBe(false);
    });
    test('missing dir lists nothing instead of throwing', () => {
        expect(svc.listBackups(path.join(tmpRoot, 'nope'))).toEqual([]);
    });
});

describe('deleteBackup removes the file and its manifest', () => {
    test('deletes both; refuses traversal; idempotent', async () => {
        const dir = path.join(tmpRoot, 'b');
        const out = await svc.createBackup({ srcPath: makeSrcDb(tmpRoot, 2), dir, passphrase: PASS });
        const man = path.join(dir, out.id.replace(/\.db\.gz\.enc$/, '.json'));
        expect(svc.deleteBackup('../../etc/passwd', dir)).toBe(false);
        expect(svc.deleteBackup(out.id, dir)).toBe(true);
        expect(fs.existsSync(path.join(dir, out.id))).toBe(false);
        expect(fs.existsSync(man)).toBe(false);
        expect(svc.deleteBackup(out.id, dir)).toBe(false);
    });
});
