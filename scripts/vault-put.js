#!/usr/bin/env node
'use strict';
// [VAULT 2026-06-26] Assistant tool — put an item INTO the operator's vault using
// only the PUBLIC key (zero-knowledge: I can write, never read). Mirrors the
// client crypto exactly (one AES-256-GCM key encrypts meta + optional file; the
// AES key is RSA-OAEP-wrapped to the public key). Requires the operator to have
// created the vault first (so a public key exists).
//
// Usage:
//   node scripts/vault-put.js <userId> <category> note   "<name>" --content "secret/link" [--note "desc"]
//   node scripts/vault-put.js <userId> <category> file   "<name>" --file /path/to/file [--note "desc"]
//
// Example:
//   node scripts/vault-put.js 1 Backups file "Full DB backup 2026-06-26" --file /opt/zeus-terminal/_backup/x.tar.gz

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function arg(name) { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; }

function main() {
  const userId = parseInt(process.argv[2], 10);
  const category = process.argv[3];
  const type = process.argv[4];        // 'note' | 'secret' | 'link' | 'file'
  const name = process.argv[5];
  if (!userId || !category || !type || !name) {
    console.error('Usage: node scripts/vault-put.js <userId> <category> <note|secret|link|file> "<name>" [--content "..."] [--note "..."] [--file path]');
    process.exit(1);
  }
  const note = arg('--note') || '';
  let content = arg('--content') || '';
  const contentFile = arg('--content-file');
  if (contentFile) { try { content = fs.readFileSync(contentFile, 'utf8'); } catch (e) { console.error('[vault-put] --content-file read failed: ' + e.message); process.exit(4); } }
  const filePath = arg('--file');

  const db = require('../server/services/database');
  const keys = db.getVaultKeys(userId);
  if (!keys) { console.error(`[vault-put] uid=${userId} has no vault yet — operator must create it first.`); process.exit(2); }
  const publicKey = keys.public_key;

  // one AES key for this item; RSA-OAEP wrap it to the public key
  const aesKey = crypto.randomBytes(32);
  const encKey = crypto.publicEncrypt({ key: publicKey, oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, aesKey).toString('base64');

  const gcm = (plain, key) => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([c.update(plain), c.final()]);
    return { iv: iv.toString('base64'), ct: Buffer.concat([ct, c.getAuthTag()]).toString('base64') };
  };

  const meta = { name, note };
  let fileIv = null, storedPath = null, size = 0;
  if (type === 'file') {
    if (!filePath || !fs.existsSync(filePath)) { console.error('[vault-put] --file required + must exist for type=file'); process.exit(3); }
    meta.fileName = path.basename(filePath);
    const bytes = fs.readFileSync(filePath);
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
    const blob = Buffer.concat([c.update(bytes), c.final(), c.getAuthTag()]);
    const dir = path.join(__dirname, '..', 'data', 'vault');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    storedPath = path.join(dir, `${Date.now()}_${userId}.enc`);
    fs.writeFileSync(storedPath, blob);
    fs.chmodSync(storedPath, 0o600);
    fileIv = iv.toString('base64');
    size = bytes.length;
  } else {
    meta.content = content;
  }

  const m = gcm(Buffer.from(JSON.stringify(meta), 'utf8'), aesKey);
  const id = db.insertVaultItem(userId, {
    category, type, encKey, metaIv: m.iv, metaCt: m.ct, fileIv, filePath: storedPath, size, addedBy: 'assistant',
  });
  console.log(`[vault-put] ✅ added item id=${id} (${type} "${name}" in ${category}${size ? ', ' + (size / 1048576).toFixed(1) + 'MB' : ''}) for uid=${userId}`);
  process.exit(0);
}
main();
