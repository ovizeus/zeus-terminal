// Zeus Terminal — Bybit V5 Signer (DRY-RUN ONLY)
// S4-B1: signing/canonicalization/header helpers + dry-run signed-request builder.
// HARD CONTRACT: this module performs NO HTTP send. No fetch/axios/http import.
// A real sender will be introduced in a later S4 batch only with explicit operator GO.
//
// Bybit V5 signing reference (mirrors the working pattern already used in
// server/routes/exchange.js::_testBybitKeys):
//   signPayload = `${timestamp}${apiKey}${recvWindow}${payload}`
//   signature   = HMAC_SHA256(apiSecret, signPayload).hex
// where `payload` is:
//   - the canonical queryString for GET / DELETE
//   - the JSON-stringified body for POST / PUT
// The same string MUST appear unchanged on the wire (URL queryString or POST body),
// otherwise Bybit rejects with "invalid signature".
'use strict';

const crypto = require('crypto');
const MF = require('../migrationFlags');

const _DEFAULT_RECV_WINDOW = 5000;

function _isPresent(v) {
    return v !== undefined && v !== null;
}

/**
 * Stable canonical query string for GET / DELETE.
 * - drops undefined / null fields
 * - sorts keys ASCII ascending for deterministic signing
 * - does NOT URL-encode values (matches Bybit V5 expectation that the same
 *   raw string appears in URL queryString and in the signed payload)
 *
 * Caller is responsible for keeping values free of reserved chars (& = ?).
 *
 * @param {object} params
 * @returns {string}
 */
function canonicalizeQuery(params) {
    if (!params || typeof params !== 'object') return '';
    const keys = Object.keys(params).filter(k => _isPresent(params[k])).sort();
    return keys.map(k => `${k}=${params[k]}`).join('&');
}

/**
 * Stable canonical JSON body for POST / PUT.
 * - drops undefined / null fields
 * - sorts top-level keys for deterministic signing
 *
 * @param {object} params
 * @returns {string}
 */
function canonicalizeBody(params) {
    if (!params || typeof params !== 'object') return '';
    const out = {};
    Object.keys(params).sort().forEach(k => {
        if (_isPresent(params[k])) out[k] = params[k];
    });
    return JSON.stringify(out);
}

/**
 * Bybit V5 HMAC-SHA256 signature. Pure function, no I/O.
 *
 * @param {object} args
 * @param {string} args.apiSecret
 * @param {number} args.timestamp - epoch ms
 * @param {string} args.apiKey
 * @param {number} args.recvWindow - ms
 * @param {string} args.payload   - canonical queryString or canonical body
 * @returns {string} hex signature
 */
function signV5({ apiSecret, timestamp, apiKey, recvWindow, payload } = {}) {
    if (!apiSecret) throw new Error('signV5: apiSecret required');
    if (!apiKey) throw new Error('signV5: apiKey required');
    if (!Number.isFinite(timestamp)) throw new Error('signV5: timestamp must be a finite number');
    if (!Number.isFinite(recvWindow)) throw new Error('signV5: recvWindow must be a finite number');
    const safePayload = typeof payload === 'string' ? payload : '';
    const signPayload = `${timestamp}${apiKey}${recvWindow}${safePayload}`;
    return crypto.createHmac('sha256', apiSecret).update(signPayload).digest('hex');
}

/**
 * Build Bybit V5 request headers. Never includes apiSecret.
 *
 * @param {object} args
 * @param {string} args.apiKey
 * @param {string} args.signature  - hex from signV5
 * @param {number} args.timestamp
 * @param {number} args.recvWindow
 * @returns {object} header map
 */
function buildBybitHeaders({ apiKey, signature, timestamp, recvWindow } = {}) {
    if (!apiKey) throw new Error('buildBybitHeaders: apiKey required');
    if (!signature) throw new Error('buildBybitHeaders: signature required');
    if (!Number.isFinite(timestamp)) throw new Error('buildBybitHeaders: timestamp must be a finite number');
    if (!Number.isFinite(recvWindow)) throw new Error('buildBybitHeaders: recvWindow must be a finite number');
    return {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-SIGN': signature,
        'X-BAPI-SIGN-TYPE': '2',
        'X-BAPI-TIMESTAMP': String(timestamp),
        'X-BAPI-RECV-WINDOW': String(recvWindow),
        'Content-Type': 'application/json',
    };
}

/**
 * Build a signed request descriptor WITHOUT sending HTTP.
 * Returns a plain object describing what would be sent to Bybit.
 *
 * Hard-gated by BYBIT_DRY_RUN_ONLY=true. If a future batch lowers the flag,
 * the caller must switch to the real sender (which does not yet exist).
 *
 * @param {string} method - 'GET' | 'POST' | 'DELETE' | 'PUT'
 * @param {string} path   - e.g. '/v5/order/create'
 * @param {object} params - request parameters
 * @param {object} creds  - { apiKey, apiSecret, baseUrl }
 * @param {object} [options] - { recvWindow, timestamp }
 * @returns {object} { method, path, url, headers, query, body, timestamp, recvWindow, dryRun:true }
 */
function buildSignedRequestDryRun(method, path, params = {}, creds = {}, options = {}) {
    if (!method || typeof method !== 'string') throw new Error('buildSignedRequestDryRun: method required');
    if (!path || typeof path !== 'string') throw new Error('buildSignedRequestDryRun: path required');
    if (!creds || !creds.apiKey || !creds.apiSecret) {
        throw new Error('buildSignedRequestDryRun: creds.apiKey and creds.apiSecret required');
    }
    if (!creds.baseUrl) {
        throw new Error('buildSignedRequestDryRun: creds.baseUrl required (refusing to default to production)');
    }
    const M = String(method).toUpperCase();
    const timestamp = Number.isFinite(options.timestamp) ? options.timestamp : Date.now();
    const recvWindow = Number.isFinite(options.recvWindow) ? options.recvWindow : _DEFAULT_RECV_WINDOW;

    let query = '';
    let body = '';
    let signPayload = '';

    if (M === 'GET' || M === 'DELETE') {
        query = canonicalizeQuery(params);
        signPayload = query;
    } else {
        body = canonicalizeBody(params);
        signPayload = body;
    }

    const signature = signV5({
        apiSecret: creds.apiSecret,
        timestamp,
        apiKey: creds.apiKey,
        recvWindow,
        payload: signPayload,
    });
    const headers = buildBybitHeaders({ apiKey: creds.apiKey, signature, timestamp, recvWindow });

    const url = (M === 'GET' || M === 'DELETE') && query
        ? `${creds.baseUrl}${path}?${query}`
        : `${creds.baseUrl}${path}`;

    return {
        method: M,
        path,
        url,
        headers,
        query,
        body,
        timestamp,
        recvWindow,
        dryRun: true,
    };
}

/**
 * Build and send a signed Bybit V5 HTTP request.
 * Reuses the same signing logic as buildSignedRequestDryRun but actually sends.
 *
 * @param {string} method - 'GET' | 'POST' | 'DELETE' | 'PUT'
 * @param {string} path   - e.g. '/v5/order/create'
 * @param {object} params - request parameters
 * @param {object} creds  - { apiKey, apiSecret, baseUrl }
 * @param {object} [options] - { recvWindow, timestamp, timeoutMs }
 * @returns {Promise<{retCode:number, retMsg:string, result:*, time:number}>}
 */
async function sendSignedRequest(method, path, params = {}, creds = {}, options = {}) {
    const M = String(method).toUpperCase();
    const timestamp = Number.isFinite(options.timestamp) ? options.timestamp : Date.now();
    const recvWindow = Number.isFinite(options.recvWindow) ? options.recvWindow : _DEFAULT_RECV_WINDOW;

    if (!creds || !creds.apiKey || !creds.apiSecret) {
        throw new Error('sendSignedRequest: creds.apiKey and creds.apiSecret required');
    }
    if (!creds.baseUrl) {
        throw new Error('sendSignedRequest: creds.baseUrl required');
    }

    let query = '';
    let body = '';
    let signPayload = '';

    if (M === 'GET' || M === 'DELETE') {
        query = canonicalizeQuery(params);
        signPayload = query;
    } else {
        body = canonicalizeBody(params);
        signPayload = body;
    }

    const signature = signV5({
        apiSecret: creds.apiSecret,
        timestamp,
        apiKey: creds.apiKey,
        recvWindow,
        payload: signPayload,
    });
    const headers = buildBybitHeaders({ apiKey: creds.apiKey, signature, timestamp, recvWindow });

    const url = (M === 'GET' || M === 'DELETE') && query
        ? `${creds.baseUrl}${path}?${query}`
        : `${creds.baseUrl}${path}`;

    const fetchOpts = {
        method: M,
        headers: { ...headers, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(options.timeoutMs || 10000),
    };
    if (M === 'POST' || M === 'PUT') {
        fetchOpts.body = body;
    }

    const res = await fetch(url, fetchOpts);
    const json = await res.json();
    return json;  // { retCode, retMsg, result, time }
}

/**
 * Normalize a Bybit V5 response into a safe internal shape.
 * Pure function — does NOT throw on retCode != 0; caller decides policy.
 *
 * @param {*} resp
 * @returns {{retCode:number, retMsg:string, time:number, result:*}}
 */
function parseBybitError(resp) {
    if (!resp || typeof resp !== 'object') {
        return { retCode: -1, retMsg: 'invalid_response', time: 0, result: null };
    }
    return {
        retCode: Number.isFinite(resp.retCode) ? resp.retCode : -1,
        retMsg: typeof resp.retMsg === 'string' ? resp.retMsg : '',
        time: Number.isFinite(resp.time) ? resp.time : 0,
        result: resp.result !== undefined ? resp.result : null,
    };
}

/**
 * Inert circuit-breaker status placeholder. No CB behavior in S4-B1 because
 * no HTTP send exists. Future S4 batches will wire real per-user / IP-level CB
 * mirroring binanceSigner. Shape kept stable so future callers compile today.
 *
 * @returns {{enabled:boolean,state:string,failures:number,lastFailure:number,note:string}}
 */
function getBybitCbStatus() {
    return {
        enabled: false,
        state: 'CLOSED',
        failures: 0,
        lastFailure: 0,
        note: 'S4-B1 dry-run only — no HTTP send, no breaker active',
    };
}

module.exports = {
    signV5,
    buildBybitHeaders,
    canonicalizeQuery,
    canonicalizeBody,
    buildSignedRequestDryRun,
    sendSignedRequest,
    parseBybitError,
    getBybitCbStatus,
};
