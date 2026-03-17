// Zeus Terminal — AES-256-GCM Encryption Service
// Encrypts/decrypts exchange API keys at rest
'use strict';

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 16;
const TAG_LEN = 16;

// Master key from env — must be 64-char hex (32 bytes)
function _getKey() {
    const hex = process.env.ENCRYPTION_KEY;
    if (!hex || hex.length !== 64) {
        throw new Error('ENCRYPTION_KEY must be set in .env (64 hex chars = 32 bytes). Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    }
    return Buffer.from(hex, 'hex');
}

/**
 * Encrypt plaintext to base64 string: iv:ciphertext:authTag
 * @param {string} text - plaintext to encrypt
 * @returns {string} - base64-encoded "iv:encrypted:tag"
 */
function encrypt(text) {
    const key = _getKey();
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    // Store as: iv.hex:encrypted.hex:tag.hex
    return iv.toString('hex') + ':' + encrypted + ':' + tag.toString('hex');
}

/**
 * Decrypt a string produced by encrypt()
 * @param {string} data - "iv:encrypted:tag" hex string
 * @returns {string} - original plaintext
 */
function decrypt(data) {
    const key = _getKey();
    const parts = data.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted data format');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const tag = Buffer.from(parts[2], 'hex');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

/**
 * Mask an API key for display: ******LAST4
 * @param {string} key - the plain or encrypted key
 * @returns {string} - masked version
 */
function maskKey(key) {
    if (!key || key.length < 6) return '******';
    return '******' + key.slice(-4);
}

module.exports = { encrypt, decrypt, maskKey };
