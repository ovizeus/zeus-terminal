// Zeus Terminal — Binance HMAC Signer
// Signs requests for Binance Futures API using HMAC-SHA256
// Per-user: accepts credentials as parameter, no global config
'use strict';

const crypto = require('crypto');
const metrics = require('./metrics');

// ─── Circuit Breaker — stops cascading failures when Binance is down ───
const _cb = {
  failures: 0,
  lastFailure: 0,
  state: 'CLOSED',     // CLOSED (normal), OPEN (blocking), HALF_OPEN (testing)
  THRESHOLD: 5,         // consecutive failures to trip
  RESET_MS: 30000,      // 30s cooldown before retrying
};

function _cbRecordSuccess() {
  _cb.failures = 0;
  _cb.state = 'CLOSED';
}

function _cbRecordFailure() {
  _cb.failures++;
  _cb.lastFailure = Date.now();
  if (_cb.failures >= _cb.THRESHOLD) {
    _cb.state = 'OPEN';
    console.warn(`[BINANCE] Circuit breaker OPEN — ${_cb.failures} consecutive failures`);
  }
}

function _cbCanProceed() {
  if (_cb.state === 'CLOSED') return true;
  if (_cb.state === 'OPEN' && Date.now() - _cb.lastFailure > _cb.RESET_MS) {
    _cb.state = 'HALF_OPEN';
    return true; // allow one test request
  }
  return _cb.state === 'HALF_OPEN'; // already testing
}

/**
 * Sign parameters with HMAC-SHA256 using the provided secret.
 * @param {object} params - Request parameters
 * @param {string} apiSecret - User's API secret (decrypted)
 * @returns {object} params with signature and timestamp added
 */
function signParams(params, apiSecret) {
  if (!apiSecret) throw new Error('API secret required for signing');
  const timestamp = Date.now();
  const withTs = { ...params, timestamp, recvWindow: 5000 };
  const query = Object.entries(withTs)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(query)
    .digest('hex');
  withTs.signature = signature;
  return withTs;
}

/**
 * Send a signed request to Binance Futures API.
 * @param {string} method - 'GET' | 'POST' | 'DELETE'
 * @param {string} path - e.g. '/fapi/v1/order'
 * @param {object} params - Request parameters (will be signed)
 * @param {object} creds - { apiKey, apiSecret, baseUrl }
 * @returns {Promise<object>} Binance response JSON
 */
async function sendSignedRequest(method, path, params = {}, creds = {}) {
  if (!creds.apiKey || !creds.apiSecret) {
    throw new Error('Exchange credentials required — connect your API keys in Settings');
  }

  // Circuit breaker check
  if (!_cbCanProceed()) {
    const err = new Error('Binance API temporarily unavailable — circuit breaker open');
    err.status = 503;
    throw err;
  }

  const baseUrl = creds.baseUrl || 'https://fapi.binance.com';
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 300;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Re-sign on each attempt so timestamp stays fresh within recvWindow
    const signed = signParams(params, creds.apiSecret);
    const query = Object.entries(signed)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const url = (method === 'GET' || method === 'DELETE')
      ? `${baseUrl}${path}?${query}`
      : `${baseUrl}${path}`;

    const options = {
      method,
      headers: {
        'X-MBX-APIKEY': creds.apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      signal: AbortSignal.timeout(10000),
    };

    if (method !== 'GET' && method !== 'DELETE') {
      options.body = query;
    }

    const _t0 = Date.now();
    let res;
    try {
      res = await fetch(url, options);
    } catch (fetchErr) {
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }
      _cbRecordFailure();
      const err = new Error('Binance API unreachable: ' + fetchErr.message);
      err.status = 503;
      throw err;
    }
    metrics.recordLatency(Date.now() - _t0);

    // 5xx server error — retry with backoff
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
      continue;
    }

    let data;
    try {
      data = await res.json();
    } catch (_jsonErr) {
      if (!res.ok) _cbRecordFailure();
      const err = new Error(`Binance returned non-JSON response (HTTP ${res.status})`);
      err.status = res.status;
      throw err;
    }

    if (!res.ok) {
      _cbRecordFailure();
      const err = new Error(`Binance API error: ${data.msg || res.statusText}`);
      err.code = data.code;
      err.status = res.status;
      throw err;
    }

    _cbRecordSuccess();
    return data;
  }
}

module.exports = { signParams, sendSignedRequest };
