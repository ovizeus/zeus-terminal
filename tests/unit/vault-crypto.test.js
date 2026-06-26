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
