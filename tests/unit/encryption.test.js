/**
 * Zeus Terminal — Unit Tests: encryption.js
 * Tests encrypt(), decrypt(), maskKey()
 */
'use strict';

const crypto = require('crypto');

// Set a valid test encryption key before requiring module
const TEST_KEY = crypto.randomBytes(32).toString('hex');
process.env.ENCRYPTION_KEY = TEST_KEY;

const { encrypt, decrypt, maskKey } = require('../../server/services/encryption');

// ══════════════════════════════════════════════════════════════
// encrypt + decrypt round-trip
// ══════════════════════════════════════════════════════════════
describe('encrypt/decrypt', () => {

  test('round-trip preserves original text', () => {
    const original = 'myBinanceApiKey123';
    const encrypted = encrypt(original);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  test('round-trip with empty string', () => {
    const encrypted = encrypt('');
    expect(decrypt(encrypted)).toBe('');
  });

  test('round-trip with special characters', () => {
    const original = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`éàü中文';
    expect(decrypt(encrypt(original))).toBe(original);
  });

  test('round-trip with long string (API secret)', () => {
    const original = crypto.randomBytes(128).toString('hex');
    expect(decrypt(encrypt(original))).toBe(original);
  });

  test('encrypted output has v1: prefix', () => {
    const encrypted = encrypt('test');
    expect(encrypted.startsWith('v1:')).toBe(true);
  });

  test('encrypted output has 4 parts separated by colon', () => {
    const parts = encrypt('test').split(':');
    expect(parts.length).toBe(4);
    expect(parts[0]).toBe('v1');
  });

  test('each encrypt produces different ciphertext (random IV)', () => {
    const a = encrypt('same');
    const b = encrypt('same');
    expect(a).not.toBe(b); // different IV each time
  });

  test('decrypt with tampered ciphertext throws', () => {
    const encrypted = encrypt('secret');
    const parts = encrypted.split(':');
    // Tamper the ciphertext
    parts[2] = 'ff' + parts[2].slice(2);
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  test('decrypt with tampered auth tag throws', () => {
    const encrypted = encrypt('secret');
    const parts = encrypted.split(':');
    // Tamper the auth tag
    parts[3] = '00'.repeat(16);
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  test('decrypt with wrong format throws', () => {
    expect(() => decrypt('invalid')).toThrow(/format/i);
    expect(() => decrypt('a:b')).toThrow(/format/i);
    expect(() => decrypt('v1:a:b:c:d:e')).toThrow();
  });

  test('decrypt legacy format (3 parts, no version prefix)', () => {
    // Manually create legacy format: iv:encrypted:tag
    const key = Buffer.from(TEST_KEY, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let enc = cipher.update('legacy-test', 'utf8', 'hex');
    enc += cipher.final('hex');
    const tag = cipher.getAuthTag();
    const legacy = iv.toString('hex') + ':' + enc + ':' + tag.toString('hex');
    expect(decrypt(legacy)).toBe('legacy-test');
  });
});

// ══════════════════════════════════════════════════════════════
// encrypt with bad key
// ══════════════════════════════════════════════════════════════
describe('encryption key validation', () => {

  test('missing ENCRYPTION_KEY throws', () => {
    const saved = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    // Need to re-call encrypt which calls _getKey internally
    expect(() => encrypt('test')).toThrow(/ENCRYPTION_KEY/);
    process.env.ENCRYPTION_KEY = saved;
  });

  test('short key throws', () => {
    const saved = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = 'abcd';
    expect(() => encrypt('test')).toThrow(/ENCRYPTION_KEY/);
    process.env.ENCRYPTION_KEY = saved;
  });

  test('non-hex key throws', () => {
    const saved = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = 'g'.repeat(64);
    expect(() => encrypt('test')).toThrow(/ENCRYPTION_KEY/);
    process.env.ENCRYPTION_KEY = saved;
  });
});

// ══════════════════════════════════════════════════════════════
// maskKey
// ══════════════════════════════════════════════════════════════
describe('maskKey', () => {

  test('masks key showing last 4 chars', () => {
    expect(maskKey('abcdefghijklmnop')).toBe('******mnop');
  });

  test('short key returns all asterisks', () => {
    expect(maskKey('abc')).toBe('******');
  });

  test('null/undefined returns asterisks', () => {
    expect(maskKey(null)).toBe('******');
    expect(maskKey(undefined)).toBe('******');
    expect(maskKey('')).toBe('******');
  });
});
