// Zeus Terminal — Binance HMAC Signer
// Signs requests for Binance Futures API using HMAC-SHA256
// Per-user: accepts credentials as parameter, no global config
'use strict';

const crypto = require('crypto');
const metrics = require('./metrics');

// [BIN-TELEM 2026-05-19] lazy-require telemetry — never block signing path
let _telem = null;
function _getTelem() {
    if (_telem === null) {
        try { _telem = require('./binanceTelemetry'); } catch (_) { _telem = false; }
    }
    return _telem || null;
}

// ─── Circuit Breaker — per-user isolation [BE-04] ───
const _CB_THRESHOLD = 5;        // consecutive failures to trip
const _CB_RESET_MS = 30000;     // 30s cooldown before retrying
const _cbMap = new Map();       // [BE-04] userId|apiKey → { failures, lastFailure, state }

// ─── IP-level Circuit Breaker — Fix 2 (post 2026-04-23 16:19 ban incident) ───
// Binance enforces 418 (IP banned) and 429 (rate-limited) per IP, NOT per API key.
// Per-user CB above does not protect us: when user A trips a 418, every subsequent
// request from any user on the same IP extends the ban. This breaker is a process-
// global gate: parse `banned until <epoch_ms>` from Binance's error message, refuse
// all signed requests until that deadline + small jitter. If the message lacks a
// timestamp (defensive fallback), use _IP_CB_FALLBACK_MS.
const _IP_CB_FALLBACK_MS = 60000;  // cap on fallback ban window (Binance min ban is usually ~2min, but be lenient)
const _IP_CB_JITTER_MS = 500;      // small post-deadline buffer
let _ipBannedUntil = 0;
let _ipBanReason = '';

// [V6 Binance defense 2026-05-20] Lazy-load persistent rate state — survives PM2 reloads.
// On first call, loads banned_until from DB so the new process inherits any
// existing ban window rather than re-probing Binance and getting re-banned.
let _rateStateLoaded = false;
function _ensureRateStateLoaded() {
  if (_rateStateLoaded) return;
  _rateStateLoaded = true;
  try {
    const rateState = require('./binanceRateState');
    const s = rateState.load();
    if (s.banned_until > Date.now()) {
      _ipBannedUntil = s.banned_until;
      _ipBanReason = s.ban_reason || 'persisted ban (loaded from DB)';
      const remainingS = Math.ceil((_ipBannedUntil - Date.now()) / 1000);
      console.warn(`[BINANCE IP-CB] Loaded persisted ban from DB — suppressing for ~${remainingS}s. Reason: ${_ipBanReason}`);
    }
  } catch (_err) {
    // DB unreachable or migration not yet applied — in-memory fallback only
  }
}

function _isIpBanned() {
  _ensureRateStateLoaded();
  return _ipBannedUntil > Date.now();
}
function _setIpBan(untilMs, reason) {
  _ensureRateStateLoaded();
  // Never shrink an existing ban; only extend.
  const target = Math.max(_ipBannedUntil, untilMs + _IP_CB_JITTER_MS);
  if (target > _ipBannedUntil) {
    _ipBannedUntil = target;
    _ipBanReason = reason || _ipBanReason || 'IP rate-limit';
    const remainingS = Math.ceil((target - Date.now()) / 1000);
    console.warn(`[BINANCE IP-CB] Tripped — refusing all signed requests for ~${remainingS}s. Reason: ${_ipBanReason}`);

    // [V6] Persist to DB so PM2 reload doesn't lose ban state.
    try {
      const rateState = require('./binanceRateState');
      rateState.recordBan({ bannedUntil: target, reason: _ipBanReason, now: Date.now() });
      rateState.appendTransitionLog({
        from: 'NORMAL_OR_WARM',
        to: 'SUPPRESSED',
        reason: _ipBanReason,
        ts: Date.now(),
        bannedUntil: target,
      });
    } catch (_err) { /* defensive — never block ban path */ }
  }
}
// Parse `banned until 1776961979385` style timestamp from Binance error msg.
function _parseBanUntil(msg) {
  if (!msg || typeof msg !== 'string') return null;
  const m = msg.match(/banned until\s+(\d{10,16})/i);
  if (!m) return null;
  const ts = parseInt(m[1], 10);
  if (!Number.isFinite(ts) || ts <= Date.now()) return null;
  return ts;
}
function getIpCbStatus() {
  return { banned: _isIpBanned(), bannedUntil: _ipBannedUntil, reason: _ipBanReason };
}

function _getCb(key) {
  if (!_cbMap.has(key)) _cbMap.set(key, { failures: 0, lastFailure: 0, state: 'CLOSED' });
  return _cbMap.get(key);
}

function _cbRecordSuccess(key) {
  const cb = _getCb(key);
  cb.failures = 0;
  cb.state = 'CLOSED';
}

function _cbRecordFailure(key) {
  const cb = _getCb(key);
  cb.failures++;
  cb.lastFailure = Date.now();
  if (cb.failures >= _CB_THRESHOLD) {
    cb.state = 'OPEN';
    console.warn(`[BINANCE] Circuit breaker OPEN for ${key} — ${cb.failures} consecutive failures`);
  }
}

function _cbCanProceed(key) {
  const cb = _getCb(key);
  if (cb.state === 'CLOSED') return true;
  if (cb.state === 'OPEN' && Date.now() - cb.lastFailure > _CB_RESET_MS) {
    cb.state = 'HALF_OPEN';
    return true; // allow one test request
  }
  return cb.state === 'HALF_OPEN'; // already testing
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

  // [BE-04] Per-user circuit breaker key — userId preferred, fallback to apiKey
  const _cbKey = creds.userId ? String(creds.userId) : creds.apiKey;

  // [Fix 2] IP-level gate — refuse instantly during active ban so we don't extend it.
  if (_isIpBanned()) {
    const remainingS = Math.ceil((_ipBannedUntil - Date.now()) / 1000);
    const err = new Error(`Binance IP rate-limit — paused for ~${remainingS}s (${_ipBanReason})`);
    err.status = 503;
    err.code = 'IP_BANNED';
    throw err;
  }

  // Circuit breaker check
  if (!_cbCanProceed(_cbKey)) {
    const err = new Error('Binance API temporarily unavailable — circuit breaker open');
    err.status = 503;
    throw err;
  }

  if (!creds.baseUrl) {
    const err = new Error('[SIGNER] Missing baseUrl in credentials — refusing to default to production. Check credentialStore.');
    err.status = 500;
    throw err;
  }
  const baseUrl = creds.baseUrl;
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 300;

  // [Phase A.2 2026-05-19] Auto critical section for order ops — begin before
  // retry loop, end in finally so lane-based degradation pauses for the entire
  // order pipeline (place + algoOrder for SL/TP + retries).
  let _criticalOpId = null;
  try {
    const _scheduler = require('./binanceScheduler');
    if (_scheduler.isOrderOp(method, path)) {
      _criticalOpId = `signer:${creds.userId || creds.apiKey}:${method}:${path}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
      _scheduler.beginCriticalSection(_criticalOpId);
    }
  } catch (_) { _criticalOpId = null; }

  try {
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
      // [BIN-TELEM 2026-05-19] Tag source from creds.__src (caller-supplied) or default
      const _src = (creds && creds.__src) || ('signer:' + method + ' ' + path);
      const _t = _getTelem();
      res = _t ? await _t.wrapFetch(fetch, url, Object.assign({}, options, { __src: _src, __weight: 5 })) : await fetch(url, options);
    } catch (fetchErr) {
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }
      _cbRecordFailure(_cbKey);
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
      if (!res.ok) _cbRecordFailure(_cbKey);
      const err = new Error(`Binance returned non-JSON response (HTTP ${res.status})`);
      err.status = res.status;
      throw err;
    }

    if (!res.ok) {
      // [Fix 2] Detect IP-level rate-limit / ban (418/429) and trip global gate.
      // Binance puts the unban deadline in the message: "...banned until <ts>...".
      // If parsing fails, fall back to a fixed window so we still pause requests.
      if (res.status === 418 || res.status === 429) {
        const parsedTs = _parseBanUntil(data.msg);
        const untilMs = parsedTs != null ? parsedTs : Date.now() + _IP_CB_FALLBACK_MS;
        _setIpBan(untilMs, `HTTP ${res.status}: ${data.msg || res.statusText}`);
      }
      _cbRecordFailure(_cbKey);
      const err = new Error(`Binance API error: ${data.msg || res.statusText}`);
      err.code = data.code;
      err.status = res.status;
      throw err;
    }

    _cbRecordSuccess(_cbKey);
    return data;
  }
  } finally {
    if (_criticalOpId) {
      try { require('./binanceScheduler').endCriticalSection(_criticalOpId); } catch (_) {}
    }
  }
}

module.exports = { signParams, sendSignedRequest, getIpCbStatus };
