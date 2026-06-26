'use strict';
// [VAULT 2026-06-26] Zero-knowledge vault — server-side encrypt-to-public.
//
// The operator's vault is protected by a key PAIR. The PUBLIC key lives plaintext
// on the server; the PRIVATE key is wrapped under the operator's vault password
// (PBKDF2 → AES-GCM) client-side and the password NEVER reaches the server.
//
// This module lets the ASSISTANT (or any server code) put items INTO the vault
// using only the PUBLIC key — encrypt, never able to read back. Hybrid scheme:
//   - random AES-256-GCM key encrypts the content
//   - that AES key is RSA-OAEP(SHA-256) wrapped to the public key
// The operator decrypts entirely client-side (WebCrypto). Vetted primitives only.

const crypto = require('crypto');

const OAEP = { oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING };
const TAG_LEN = 16;

/**
 * Encrypt a content buffer for a vault public key. No password / private key needed.
 * @param {string} publicKeyPem  SPKI PEM public key
 * @param {Buffer} contentBuf    plaintext bytes
 * @returns {{encKey:string, iv:string, ciphertext:string}} all base64 (ciphertext = ct||tag)
 */
function encryptItemForVault(publicKeyPem, contentBuf) {
    if (!publicKeyPem) throw new Error('publicKeyPem required');
    const buf = Buffer.isBuffer(contentBuf) ? contentBuf : Buffer.from(String(contentBuf), 'utf8');
    const aesKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
    const ct = Buffer.concat([cipher.update(buf), cipher.final()]);
    const tag = cipher.getAuthTag();
    const encKey = crypto.publicEncrypt({ key: publicKeyPem, ...OAEP }, aesKey);
    return {
        encKey: encKey.toString('base64'),
        iv: iv.toString('base64'),
        ciphertext: Buffer.concat([ct, tag]).toString('base64'),
    };
}

/**
 * Inverse — used only by tests / a one-off operator-side decrypt with the raw PEM
 * private key. In production the operator decrypts in the browser (WebCrypto); the
 * server never holds the private key in usable (unwrapped) form.
 */
function decryptItemWithPrivate(privateKeyPem, part) {
    const aesKey = crypto.privateDecrypt({ key: privateKeyPem, ...OAEP }, Buffer.from(part.encKey, 'base64'));
    const raw = Buffer.from(part.ciphertext, 'base64');
    if (raw.length < TAG_LEN) throw new Error('ciphertext too short');
    const ct = raw.subarray(0, raw.length - TAG_LEN);
    const tag = raw.subarray(raw.length - TAG_LEN);
    const d = crypto.createDecipheriv('aes-256-gcm', aesKey, Buffer.from(part.iv, 'base64'));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
}

module.exports = { encryptItemForVault, decryptItemWithPrivate };
