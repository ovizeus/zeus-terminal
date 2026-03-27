// Zeus Terminal — AES-256-GCM Encryption Service
// Encrypts/decrypts exchange API keys at rest
'use strict';

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 16;
const TAG_LEN = 16;
const KEY_VERSION = 'v1';

// Master key from env — must be 64-char hex (32 bytes)
function _getKey() {
    const hex = process.env.ENCRYPTION_KEY;
    if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) { // [SC-03] strict hex validation
        throw new Error('ENCRYPTION_KEY must be set in .env (64 hex chars = 32 bytes). Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    }
    return Buffer.from(hex, 'hex');
}

/**
 * Encrypt plaintext to versioned string: v1:iv:ciphertext:authTag
 * @param {string} text - plaintext to encrypt
 * @returns {string} - "v1:iv.hex:encrypted.hex:tag.hex"
 */
function encrypt(text) {
    const key = _getKey();
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    return KEY_VERSION + ':' + iv.toString('hex') + ':' + encrypted + ':' + tag.toString('hex');
}

/**
 * Decrypt a string produced by encrypt().
 * Supports both versioned ("v1:iv:encrypted:tag") and legacy ("iv:encrypted:tag") formats.
 * @param {string} data - encrypted string
 * @returns {string} - original plaintext
 */
function decrypt(data) {
    const key = _getKey();
    const parts = data.split(':');
    let iv, encrypted, tag;

    if (parts.length === 4 && parts[0] === KEY_VERSION) {
        // Versioned format: v1:iv:encrypted:tag
        iv = Buffer.from(parts[1], 'hex');
        encrypted = parts[2];
        tag = Buffer.from(parts[3], 'hex');
    } else if (parts.length === 3) {
        // Legacy format: iv:encrypted:tag
        iv = Buffer.from(parts[0], 'hex');
        encrypted = parts[1];
        tag = Buffer.from(parts[2], 'hex');
    } else {
        throw new Error('Invalid encrypted data format');
    }

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
