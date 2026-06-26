# Vault — Zero-Knowledge Admin Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans + test-driven-development. Steps use `- [ ]`.

**Goal:** A password-protected admin "Vault" (after Uploads + Book) where the assistant uploads important items (backup links, APK, full backups) and stores secrets (passwords). Only the operator can READ them, gated by a SEPARATE vault password that never leaves their device (zero-knowledge). The assistant can WRITE without the password. Operator can download/share/delete (with confirm) each item.

**Architecture (zero-knowledge, asymmetric):** On setup the browser generates an RSA-OAEP-2048 keypair. The public key is stored plaintext on the server (used to ENCRYPT new items — by the assistant server-side via Node, or by the operator in-browser). The private key is wrapped with AES-256-GCM under a key = PBKDF2(vaultPassword, salt, 210k, SHA-256) and stored as ciphertext; the vault password NEVER hits the server. Each item: a random AES-256-GCM key encrypts the content; that AES key is RSA-OAEP-wrapped to the public key. Reading requires the operator to enter the vault password in-browser → unwrap private key → unwrap each item key → decrypt. Account breach (session only) or server breach (ciphertext only) cannot read. Files stored AES-GCM encrypted on disk (data/vault/), chunked for large ones.

**Tech Stack:** Node `crypto` (server: encrypt-to-public, for assistant uploads), WebCrypto SubtleCrypto (browser: keygen, unlock, decrypt), better-sqlite3, Express, React/Zustand, Jest, Vitest.

**Threat model met:** (1) account-breach → vault locked, no password on server; (2) server-breach → only ciphertext; (3) assistant can write (public key) but not read (no private key/password); (4) forgot password → unrecoverable (by design — warn operator to store it externally).

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `server/services/vaultCrypto.js` | CREATE | pure-ish Node crypto: `encryptItemForVault(publicKeyPem, contentBuffer)` → {encKey, iv, ciphertext}; helpers. Unit-tested round-trip. |
| `server/services/database.js` | MODIFY | migration `417_vault` (vault_keys + vault_items tables) + db methods |
| `server/routes/admin.js` | MODIFY | `/vault/*` endpoints (setup, meta, wrapped, items CRUD, file up/download) |
| `client/src/stores/adminStore.ts` | MODIFY | add `'vault'` section |
| `client/src/components/admin/AdminSidebar.tsx` | MODIFY | nav item after Uploads |
| `client/src/components/admin/AdminPage.tsx` | MODIFY | render VaultSection |
| `client/src/components/admin/sections/VaultSection.tsx` | CREATE | full UI: create/unlock/list/add-secret/add-file/download/delete |
| `client/src/components/admin/sections/vaultCryptoClient.ts` | CREATE | WebCrypto: keygen, wrap/unwrap private key, encrypt/decrypt item |
| `scripts/vault-put.js` | CREATE | assistant tool: encrypt a file/secret with the stored public key + insert (so I can upload) |
| `tests/unit/vault-crypto.test.js` | CREATE | Node crypto round-trip + wrong-key-fails |

---

### Task 1: Server crypto module (the foundation — assistant can encrypt-to-public)

**Files:** Create `server/services/vaultCrypto.js`, Test `tests/unit/vault-crypto.test.js`

- [ ] **Step 1: failing test** — generate a test RSA keypair, `encryptItemForVault(pub, Buffer('secret'))` → decrypt with private (RSA-OAEP unwrap AES key + AES-GCM) → equals 'secret'; wrong private key throws; tampered ciphertext throws (GCM auth).
- [ ] **Step 2: run → fail** (`encryptItemForVault` undefined)
- [ ] **Step 3: implement** `vaultCrypto.js`:

```javascript
'use strict';
const crypto = require('crypto');
// Encrypt a content buffer for a vault public key (RSA-OAEP-SHA256 wraps a random
// AES-256-GCM key; AES-GCM encrypts the content). Returns base64 parts. No private
// key / password needed — this is how the assistant uploads WITHOUT being able to read.
function encryptItemForVault(publicKeyPem, contentBuf) {
    const aesKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
    const ct = Buffer.concat([cipher.update(contentBuf), cipher.final()]);
    const tag = cipher.getAuthTag();
    const encKey = crypto.publicEncrypt({ key: publicKeyPem, oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, aesKey);
    return { encKey: encKey.toString('base64'), iv: iv.toString('base64'), ciphertext: Buffer.concat([ct, tag]).toString('base64') };
}
// Test-only inverse (the real decrypt happens client-side in WebCrypto).
function decryptItemWithPrivate(privateKeyPem, part) {
    const aesKey = crypto.privateDecrypt({ key: privateKeyPem, oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(part.encKey, 'base64'));
    const raw = Buffer.from(part.ciphertext, 'base64');
    const ct = raw.subarray(0, raw.length - 16), tag = raw.subarray(raw.length - 16);
    const d = crypto.createDecipheriv('aes-256-gcm', aesKey, Buffer.from(part.iv, 'base64'));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
}
module.exports = { encryptItemForVault, decryptItemWithPrivate };
```

- [ ] **Step 4: run → pass**; **Step 5: commit**

### Task 2: DB (migration 417 + methods)
- vault_keys(user_id PK, public_key TEXT, wrapped_priv TEXT, salt TEXT, iv TEXT, kdf_iters INT, created_at)
- vault_items(id PK, user_id, name, type[secret|file|link], enc_key TEXT, iv TEXT, ciphertext TEXT NULL (secrets/links inline), file_path TEXT NULL (files on disk), size INT, added_by, created_at)
- db methods: getVaultKeys/saveVaultKeys, insertVaultItem/listVaultItems(meta only)/getVaultItem/deleteVaultItem. TDD against temp DB.

### Task 3: Endpoints (admin-gated, /api/admin/vault)
- POST /setup {publicKey, wrappedPriv, salt, iv, kdfIters} (refuse overwrite unless ?force + a wipe — protect against accidental reset)
- GET /meta → {hasVault, publicKey}
- GET /key → {wrappedPriv, salt, iv, kdfIters} (ciphertext — safe to admin)
- POST /items (secret/link: JSON {name,type,encKey,iv,ciphertext}; file: multipart, server stores encrypted blob already produced client-side OR raw + server encrypts with public key)
- GET /items → metadata list
- GET /items/:id → encrypted blob (secrets) or streams encrypted file (files)
- DELETE /items/:id → remove (with the UI confirm)

### Task 4: Client crypto (vaultCryptoClient.ts, WebCrypto)
- generateVault(password) → {publicKeyPem, wrappedPriv, salt, iv, kdfIters}
- unlock(password, {wrappedPriv,salt,iv,kdfIters}) → CryptoKey privateKey (in memory) or throw (wrong pw)
- encryptForPublic(publicKeyPem, bytes) → {encKey,iv,ciphertext} (operator adds secrets)
- decryptItem(privateKey, {encKey,iv,ciphertext}) → bytes
- tsc verified.

### Task 5: Client UI (VaultSection.tsx) + nav wiring
- States: no-vault (Create vault: set password ×2 + strong warning "unrecoverable"), locked (Unlock: enter password, auto-lock 5min), unlocked (list + add-secret + add-file + per-item Download/Copy/Share + Delete-with-confirm).
- Files: download decrypts in browser (chunked/streaming for big); secrets: Copy to clipboard.

### Task 6: Assistant upload tool (scripts/vault-put.js)
- Read public key from DB → encryptItemForVault → insert (file→disk, secret/link→inline). So I can put the APK/backup/links in.

### Task 7: Verify + deploy
- TDD green; tsc; build; bump version; reload; live Playwright (CAREFUL: close browser after — the Playwright-CPU-starvation lesson); deploy; book/memory.

## Honest caveats
- Multi-GB files on a phone: in-browser whole-file decryption is impractical (RAM). Chunked AES-GCM + streaming download (service worker / showSaveFilePicker) is the proper path — implement in Task 5 file handling; if a target device lacks streaming APIs, fall back to a vault LINK for truly huge backups.
- Forgot vault password = data unrecoverable (zero-knowledge). UI must warn loudly + recommend external paper backup of the password.
- Crypto must use vetted primitives only (WebCrypto / Node crypto): RSA-OAEP-SHA256, AES-256-GCM, PBKDF2-SHA256 ≥210k. No hand-rolled crypto.
