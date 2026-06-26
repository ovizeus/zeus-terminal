'use strict';
// [VAULT 2026-06-26] Vault DB layer — keys upsert + items CRUD on a temp DB
// (ZEUS_DB_PATH), live zeus.db untouched. Verifies migration 417 + the methods.

const path = require('path');
const fs = require('fs');
const os = require('os');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-db-'));
process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
const db = require('../../server/services/database');

describe('vault DB layer', () => {
  test('keys upsert + get', () => {
    expect(db.getVaultKeys(5)).toBeNull();
    db.saveVaultKeys(5, { publicKey: 'PUB', wrappedPriv: 'WP', salt: 'S', iv: 'IV', kdfIters: 210000 });
    const k = db.getVaultKeys(5);
    expect(k.public_key).toBe('PUB');
    expect(k.wrapped_priv).toBe('WP');
    expect(k.kdf_iters).toBe(210000);
    // upsert replaces
    db.saveVaultKeys(5, { publicKey: 'PUB2', wrappedPriv: 'WP2', salt: 'S2', iv: 'IV2', kdfIters: 300000 });
    expect(db.getVaultKeys(5).public_key).toBe('PUB2');
  });

  test('item insert + list grouped + get + delete, scoped per-user', () => {
    const uid = 6;
    const id1 = db.insertVaultItem(uid, { category: 'Passwords', type: 'secret', encKey: 'EK', metaIv: 'MI', metaCt: 'MC', size: 10, addedBy: 'operator' });
    const id2 = db.insertVaultItem(uid, { category: 'Backups', type: 'file', encKey: 'EK2', metaIv: 'MI2', metaCt: 'MC2', fileIv: 'FI', filePath: '/x/y.enc', size: 999, addedBy: 'assistant' });
    const list = db.listVaultItems(uid);
    expect(list.length).toBe(2);
    // list must NOT leak file_path (only metadata + enc parts)
    expect(list[0].file_path).toBeUndefined();
    expect(list.some(i => i.category === 'Backups' && i.type === 'file')).toBe(true);
    const full = db.getVaultItem(id2, uid);
    expect(full.file_path).toBe('/x/y.enc');
    expect(full.added_by).toBe('assistant');
    // cross-user isolation
    expect(db.getVaultItem(id1, 999)).toBeNull();
    expect(db.listVaultItems(999).length).toBe(0);
    // delete
    expect(db.deleteVaultItem(id1, uid)).toBe(true);
    expect(db.deleteVaultItem(id1, uid)).toBe(false); // already gone
    expect(db.listVaultItems(uid).length).toBe(1);
  });
});
