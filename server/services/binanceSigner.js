// Zeus Terminal — Binance HMAC Signer
// Signs requests for Binance Futures API using HMAC-SHA256
// Per-user: accepts credentials as parameter, no global config
'use strict';

const crypto = require('crypto');
const metrics = require('./metrics');

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
  const baseUrl = creds.baseUrl || 'https://fapi.binance.com';

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
  const res = await fetch(url, options);
  metrics.recordLatency(Date.now() - _t0);
  let data;
  try {
    data = await res.json();
  } catch (_jsonErr) {
    throw new Error(`Binance returned non-JSON response (HTTP ${res.status})`);
  }

  if (!res.ok) {
    const err = new Error(`Binance API error: ${data.msg || res.statusText}`);
    err.code = data.code;
    err.status = res.status;
    throw err;
  }

  return data;
}

module.exports = { signParams, sendSignedRequest };
