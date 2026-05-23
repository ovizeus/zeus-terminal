'use strict';

/**
 * decisionKey — Idempotency token shared across Binance + Bybit.
 *
 * Regex: intersection of Binance newClientOrderId and Bybit orderLinkId
 * allowed characters: alphanumeric + underscore + hyphen, max 36 chars.
 *
 * Generated keys: 16 random chars (collision-resistant for our throughput).
 */

const crypto = require('crypto');

const REGEX = /^[a-zA-Z0-9_-]{1,36}$/;

function validate(key) {
    return typeof key === 'string' && REGEX.test(key);
}

function assert(key) {
    if (!validate(key)) {
        throw new Error(`decisionKey invalid: must match ${REGEX} (got: ${JSON.stringify(key)})`);
    }
}

function generate() {
    // base64url is alphanumeric + - + _ (already matches our regex)
    return crypto.randomBytes(12).toString('base64url').slice(0, 16);
}

module.exports = { REGEX, validate, assert, generate };
