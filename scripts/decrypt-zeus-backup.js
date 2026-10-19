#!/usr/bin/env node
'use strict';
// Standalone decryptor for a "Backup Zeus" file. Uses ONLY Node built-ins, so it
// runs anywhere node runs — you are never dependent on Zeus being alive, or on
// this repo, to read your own backup. Keep a copy of this file with your backups.
//
//   node decrypt-zeus-backup.js zeus-full-<ts>.db.gz.enc restored.db
//
// It asks for the passphrase without echoing it, and refuses to overwrite.
// Format: "ZEUSBK01" | salt(16) | iv(12) | gzip-then-AES-256-GCM | tag(16)

const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');

const MAGIC = Buffer.from('ZEUSBK01', 'utf8');
const SALT_LEN = 16, IV_LEN = 12, TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + SALT_LEN + IV_LEN;
const SCRYPT_N = 1 << 15;

function askPassphrase() {
    return new Promise((resolve, reject) => {
        if (process.env.ZEUS_BACKUP_PASSPHRASE) return resolve(process.env.ZEUS_BACKUP_PASSPHRASE);
        if (!process.stdin.isTTY) return reject(new Error('No TTY. Set ZEUS_BACKUP_PASSPHRASE instead.'));
        process.stdout.write('Passphrase: ');
        process.stdin.setRawMode(true);
        process.stdin.resume();
        let buf = '';
        process.stdin.on('data', (d) => {
            for (const ch of d.toString('utf8')) {
                if (ch === '\r' || ch === '\n') {
                    process.stdin.setRawMode(false); process.stdin.pause();
                    process.stdout.write('\n'); return resolve(buf);
                }
                if (ch === '\u0003') { process.stdout.write('\n'); return reject(new Error('cancelled')); }
                if (ch === '\u007f') { buf = buf.slice(0, -1); continue; }
                buf += ch;
            }
        });
    });
}

async function main() {
    const [src, dest] = process.argv.slice(2);
    if (!src || !dest) {
        console.error('Usage: node decrypt-zeus-backup.js <backup.db.gz.enc> <output.db>');
        process.exit(2);
    }
    if (fs.existsSync(dest)) { console.error(`Refusing to overwrite ${dest}`); process.exit(2); }

    const st = fs.statSync(src);
    if (st.size < HEADER_LEN + TAG_LEN) { console.error('File is too small to be a Zeus backup.'); process.exit(1); }

    const fh = fs.openSync(src, 'r');
    const header = Buffer.alloc(HEADER_LEN);
    fs.readSync(fh, header, 0, HEADER_LEN, 0);
    const tag = Buffer.alloc(TAG_LEN);
    fs.readSync(fh, tag, 0, TAG_LEN, st.size - TAG_LEN);
    fs.closeSync(fh);

    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) { console.error('Not a Zeus backup file.'); process.exit(1); }
    const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_LEN);
    const iv = header.subarray(MAGIC.length + SALT_LEN, HEADER_LEN);

    const passphrase = await askPassphrase();
    process.stdout.write('Deriving key and decrypting...\n');
    const key = crypto.scryptSync(String(passphrase), salt, 32, { N: SCRYPT_N, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    try {
        await pipeline(
            fs.createReadStream(src, { start: HEADER_LEN, end: st.size - TAG_LEN - 1 }),
            decipher, zlib.createGunzip(), fs.createWriteStream(dest),
        );
    } catch (e) {
        try { fs.unlinkSync(dest); } catch (_) { /* */ }
        console.error(/auth/i.test(String(e && e.message))
            ? 'FAILED: wrong passphrase, or the file was altered in transit.'
            : `FAILED: ${(e && e.message) || e}`);
        process.exit(1);
    }

    console.log(`OK -> ${dest} (${fs.statSync(dest).size} bytes)`);
    console.log('Verify it before trusting it:  sqlite3 ' + dest + " 'PRAGMA quick_check;'");
}

main().catch((e) => { console.error(`FAILED: ${(e && e.message) || e}`); process.exit(1); });
