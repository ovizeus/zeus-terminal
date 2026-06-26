'use strict';
// [VAULT 2026-06-26] Zero-knowledge vault server crypto. The assistant encrypts
// items to the operator's PUBLIC key (no password / private key needed to WRITE);
// only the operator can decrypt client-side. These tests prove the server-side
// encrypt-to-public + the round-trip + that tampering/wrong-key fails (AES-GCM auth).

const crypto = require('crypto');
const { encryptItemForVault, decryptItemWithPrivate } = require('../../server/services/vaultCrypto');

function genKeys() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

describe('vaultCrypto — zero-knowledge encrypt-to-public', () => {
  test('encrypt with public, decrypt with private → original (round-trip)', () => {
    const { publicKey, privateKey } = genKeys();
    const secret = Buffer.from('my-binance-password-🔑', 'utf8');
    const part = encryptItemForVault(publicKey, secret);
    expect(typeof part.encKey).toBe('string');
    expect(typeof part.iv).toBe('string');
    expect(typeof part.ciphertext).toBe('string');
    // ciphertext must NOT contain the plaintext
    expect(Buffer.from(part.ciphertext, 'base64').toString('utf8')).not.toContain('password');
    const back = decryptItemWithPrivate(privateKey, part);
    expect(back.equals(secret)).toBe(true);
  });

  test('wrong private key cannot decrypt (throws)', () => {
    const a = genKeys();
    const b = genKeys();
    const part = encryptItemForVault(a.publicKey, Buffer.from('secret'));
    expect(() => decryptItemWithPrivate(b.privateKey, part)).toThrow();
  });

  test('tampered ciphertext fails AES-GCM auth (throws)', () => {
    const { publicKey, privateKey } = genKeys();
    const part = encryptItemForVault(publicKey, Buffer.from('secret-data'));
    const raw = Buffer.from(part.ciphertext, 'base64');
    raw[0] = raw[0] ^ 0xff; // flip a byte
    const tampered = { ...part, ciphertext: raw.toString('base64') };
    expect(() => decryptItemWithPrivate(privateKey, tampered)).toThrow();
  });

  test('handles binary content (e.g. a file chunk), not just text', () => {
    const { publicKey, privateKey } = genKeys();
    const bin = crypto.randomBytes(4096);
    const back = decryptItemWithPrivate(privateKey, encryptItemForVault(publicKey, bin));
    expect(back.equals(bin)).toBe(true);
  });
});

// Full zero-knowledge chain, simulating the BROWSER side with Node crypto (same
// algorithms WebCrypto uses): keygen → wrap private key under PBKDF2(password) →
// assistant encrypts to PUBLIC key → operator unlocks with password → decrypts.
// Proves the on-the-wire format the server/vault-put produces is decryptable only
// with the operator's vault password, and a wrong password fails.
describe('vault — full zero-knowledge round-trip (browser simulated)', () => {
  const ITERS = 210000;
  function setupVault(password) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });
    const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
    const kdf = crypto.pbkdf2Sync(password, salt, ITERS, 32, 'sha256');
    const c = crypto.createCipheriv('aes-256-gcm', kdf, iv);
    const wrappedPriv = Buffer.concat([c.update(privateKey), c.final(), c.getAuthTag()]);
    return { publicKey, salt, iv, wrappedPriv }; // what the server stores
  }
  function unlock(password, vault) {
    const kdf = crypto.pbkdf2Sync(password, vault.salt, ITERS, 32, 'sha256');
    const d = crypto.createDecipheriv('aes-256-gcm', kdf, vault.iv);
    d.setAuthTag(vault.wrappedPriv.subarray(vault.wrappedPriv.length - 16));
    const der = Buffer.concat([d.update(vault.wrappedPriv.subarray(0, vault.wrappedPriv.length - 16)), d.final()]);
    return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }).export({ type: 'pkcs8', format: 'pem' });
  }

  test('operator can decrypt an assistant-uploaded item; wrong password cannot', () => {
    const vault = setupVault('correct horse battery staple');
    // assistant uploads (only the public key)
    const part = encryptItemForVault(vault.publicKey, Buffer.from('binance-api-secret-9f3a'));
    // operator unlocks + decrypts
    const privPem = unlock('correct horse battery staple', vault);
    expect(decryptItemWithPrivate(privPem, part).toString()).toBe('binance-api-secret-9f3a');
    // wrong vault password cannot even unwrap the private key
    expect(() => unlock('wrong password', vault)).toThrow();
  });
});
