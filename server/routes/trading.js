// Zeus Terminal — Trading API Routes
// Proxy endpoints for Binance Futures with server-side signing + risk guards
// Per-user: each request uses authenticated user's exchange credentials
'use strict';

const express = require('express');
const router = express.Router();
const config = require('../config');
const { sendSignedRequest } = require('../services/binanceSigner');
const exchangeOps = require('../services/exchangeOps');
const decisionKeyService = require('../services/decisionKey');
const { validateOrder, recordClosedPnL } = require('../services/riskGuard');
const { roundOrderParams } = require('../services/exchangeInfo');
const { validateOrderBody, validateCancelBody, validateLeverageBody, validateSettingsBody } = require('../middleware/validate');
const resolveExchange = require('../middleware/resolveExchange');
const telegram = require('../services/telegram');
const logger = require('../services/logger');
// Lazy require to avoid circular dependency
function _getServerAT() { return require('../services/serverAT'); }
const audit = require('../services/audit');
const metrics = require('../services/metrics');
const rateLimit = require('../middleware/rateLimit');

// Determine owner from newClientOrderId prefix
function _owner(body) {
  return (body.newClientOrderId && body.newClientOrderId.startsWith('ARES_')) ? 'ARES' : 'AT';
}

// ─── Idempotency: prevent duplicate order submissions ───
const _idempotencyCache = new Map();
setInterval(() => {
  const cutoff = Date.now() - 300000; // 5min TTL
  for (const [k, ts] of _idempotencyCache) {
    if (ts < cutoff) _idempotencyCache.delete(k);
  }
}, 60000);

function _checkIdempotency(req) {
  const key = req.headers['x-idempotency-key'];
  if (!key || typeof key !== 'string' || key.trim().length < 5) {
    return { reject: true, reason: !key ? 'Missing x-idempotency-key header' : 'Invalid x-idempotency-key (too short or empty)' };
  }
  const fullKey = `${req.user.id}:${key}`;
  if (_idempotencyCache.has(fullKey)) return { duplicate: true, key: fullKey };

  // [Wave 6] Cross-restart guarantee — consult DB ledger when in-memory
  // cache misses (typical after PM2 reload). If ledger has the key with
  // an unexpired record, treat as duplicate + return cached result.
  try {
    const ledger = require('../services/ml/R4_execution/exactlyOnceLedger');
    const seen = ledger.seen(fullKey);
    if (seen) {
      _idempotencyCache.set(fullKey, Date.now());  // warm in-memory cache
      return { duplicate: true, key: fullKey, cachedResult: seen.result };
    }
  } catch (_) { /* ledger unavailable — fall through to mark fresh */ }

  _idempotencyCache.set(fullKey, Date.now());
  return null;
}

// [Wave 6] Record successful order placement in DB ledger for cross-restart
// dedup. Called after Binance accepts the order. Errors swallowed — order
// already placed, dedup is best-effort.
function _recordIdempotencySuccess(req, payload, result) {
  try {
    const key = req.headers['x-idempotency-key'];
    if (!key) return;
    const fullKey = `${req.user.id}:${key}`;
    const ledger = require('../services/ml/R4_execution/exactlyOnceLedger');
    ledger.record(fullKey, payload, result);
  } catch (_) { /* never block order response */ }
}

// [Bug#3 STEP 2] In-memory per-user+exchange+symbol+side OPEN-order barrier.
// Closes the TOCTOU hole between the sync duplicate-guard check and the async
// Binance await: two parallel opens with different idempotency keys used to
// both pass the guard (neither had committed a registration yet) and both hit
// Binance, producing merged exchange qty + phantom seq. With this lock, the
// second caller sees 409 before the guard even runs. Does not touch
// close/reduceOnly orders — those legitimately reduce exposure and must pass.
const _orderLocks = new Map();
function _acquireOrderLock(userId, symbol, side, exchangeLabel) {
  const key = `${userId}:${exchangeLabel || 'default'}:${symbol}:${side}`;
  if (_orderLocks.has(key)) return null;
  _orderLocks.set(key, Date.now());
  return key;
}
function _releaseOrderLock(key) {
  if (key) _orderLocks.delete(key);
}
// Safety sweep — release any lock older than 30s (guards against a path that
// forgot finally on throw; no deadlock even in worst case).
setInterval(() => {
  const cutoff = Date.now() - 30000;
  for (const [k, ts] of _orderLocks) {
    if (ts < cutoff) _orderLocks.delete(k);
  }
}, 15000);

// Sanitize error messages — pass Binance errors (have .status), hide internal errors
function _safeError(err) {
  if (err.status && err.status >= 400 && err.status < 500) return err.message;
  if (err.message && err.message.startsWith('Binance')) return err.message;
  return 'Internal server error';
}

// Reject oversized bodies for trading routes (10KB max)
router.use((req, res, next) => {
  const len = parseInt(req.headers['content-length'], 10);
  if (len > 10240) return res.status(413).json({ error: 'Request body too large' });
  next();
});

// Apply rate limiter + per-user exchange credential resolution
router.use(rateLimit);
router.use(resolveExchange);

// ─── GET /api/status ───
router.get('/status', (req, res) => {
  const db = require('../services/database');
  const hasExchange = req.user && req.user.id ? !!db.getExchangeAccount(req.user.id) : false;
  res.json({
    tradingEnabled: config.tradingEnabled,
    apiKeyConfigured: hasExchange,
    riskLimits: config.risk,
    serverTime: Date.now(),
  });
});

// ─── GET /api/metrics ── Server health dashboard (admin only) ───
router.get('/metrics', (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  res.json(metrics.getMetrics());
});

// ─── GET /api/audit ── Last N audit entries (admin: all or per-user; user: own only) ───
router.get('/audit', (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const count = Math.min(parseInt(req.query.count, 10) || 50, 200);
  const filterUserId = req.query.userId ? parseInt(req.query.userId, 10) : null;
  if (filterUserId) {
    res.json(audit.readByUser(filterUserId, count));
  } else {
    res.json(audit.readLast(count));
  }
});

// ─── GET /api/audit/me ── Current user's audit trail ───
router.get('/audit/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Auth required' });
  const count = Math.min(parseInt(req.query.count, 10) || 50, 100);
  res.json(audit.readByUser(req.user.id, count));
});

// ─── GET /api/balance ───
// [FIX 2026-05-27] Cache last known-good balance per user so UI never shows $0
// during temporary Binance unavailability (ban, rate limit, network).
// [BUG-3 FIX 2026-05-28] TTL 30min — stale entries evicted on read/write.
// [BUG-4 FIX 2026-05-28] Route through exchangeOps (Binance OR Bybit) instead
// of hardcoded /fapi/v2/balance — Bybit users were getting 500 errors.
const _balanceCache = new Map();
const BALANCE_CACHE_TTL_MS = 30 * 60 * 1000;
router.get('/balance', async (req, res) => {
  if (!config.tradingEnabled) {
    return res.status(403).json({ error: 'Trading disabled' });
  }
  const uid = req.user && req.user.id;
  try {
    const exchangeOps = require('../services/exchangeOps');
    const bal = await exchangeOps.getBalance(uid);
    const result = {
      totalBalance: parseFloat(bal.walletBalance || 0),
      availableBalance: parseFloat(bal.availableBalance || 0),
      unrealizedPnL: parseFloat(bal.totalUnrealizedPnL || 0),
      exchange: bal.rawExchange || 'unknown',
    };
    if (uid && result.totalBalance > 0) _balanceCache.set(uid, { ...result, cachedAt: Date.now() });
    res.json(result);
  } catch (err) {
    console.error('[API] balance error:', err.message);
    logger.error('API', 'balance error', { error: err.message });
    const cached = uid && _balanceCache.get(uid);
    if (cached && (Date.now() - cached.cachedAt) <= BALANCE_CACHE_TTL_MS) {
      res.json({ ...cached, _cached: true, _reason: err.message });
    } else {
      if (cached) _balanceCache.delete(uid);
      res.status(err.status || 500).json({ error: _safeError(err) });
    }
  }
});

// ─── GET /api/positions ───
// [BUG-4 FIX 2026-05-28] Route through exchangeOps (Binance OR Bybit) —
// hardcoded /fapi/v2/positionRisk broke for Bybit users.
router.get('/positions', async (req, res) => {
  if (!config.tradingEnabled) {
    return res.status(403).json({ error: 'Trading disabled' });
  }
  try {
    const exchangeOps = require('../services/exchangeOps');
    const positions = await exchangeOps.getPositions(req.user.id);
    const active = (positions || []).map(p => ({
      symbol: p.symbol,
      side: p.side,
      size: Math.abs(parseFloat(p.qty || 0)),
      entryPrice: parseFloat(p.entryPrice || 0),
      unrealizedPnL: parseFloat(p.unrealizedPnl || 0),
      leverage: parseInt(p.leverage, 10) || 0,
      liquidationPrice: parseFloat(p.liquidationPrice || 0),
      exchange: p.rawExchange || 'unknown',
    }));
    res.json(active);
  } catch (err) {
    console.error('[API] positions error:', err.message);
    logger.error('API', 'positions error', { error: err.message });
    res.status(err.status || 500).json({ error: _safeError(err) });
  }
});

// [Bug fix 2026-05-29] Stale-trade guard decision. The old guard blocked an order
// whenever wsProxy.isSymbolStale was true — but wsProxy's per-symbol Binance WS can be
// IP-blocked (no _healthState → staleness=Infinity) while marketFeed @bookTicker keeps
// serverState fresh (the price actually used for SL/TP/PnL/brain). That wrongly refused
// EVERY testnet/live order (HTTP 423). Now: block only when the wsProxy feed is stale
// AND the canonical serverState live price is also stale/unknown (fail-closed).
function _resolveStaleBlock(wsStale, ssAgeMs, thresholdMs) {
    if (!wsStale) return false;                                   // primary feed fresh → allow
    if (ssAgeMs == null || !Number.isFinite(ssAgeMs)) return true; // no live price → fail-closed (block)
    return ssAgeMs > thresholdMs;                                 // block only if live source also stale
}

// ─── POST /api/order/place ───
router.post('/order/place', validateOrderBody, async (req, res) => {
  // [M1.2 Cat D 2026-05-14] Demo mode bypass — demo entries NU touch Binance.
  // Route through registerManualPosition (unified path) pentru consistent
  // entry shape + local state tracking. Returns 200 + ok=true direct fără
  // marginType/leverage/order Binance round-trips.
  if (req.body.mode === 'demo') {
    try {
      const regResult = await _getServerAT().registerManualPosition(req.user.id, {
        symbol: req.body.symbol,
        side: req.body.side,
        entryPrice: parseFloat(req.body.entryPrice) || parseFloat(req.body.price) || 0,
        qty: parseFloat(req.body.quantity) || 0,
        leverage: parseInt(req.body.leverage, 10) || 1,
        sl: req.body.sl ? parseFloat(req.body.sl) : null,
        tp: req.body.tp ? parseFloat(req.body.tp) : null,
        mode: 'demo',
        source: req.body.source,
        dslParams: req.body.dslParams,
      });
      return res.status(regResult.ok ? 200 : 400).json(regResult);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
  // [SP2-b 2026-06-07] Defense-in-depth: when the server FULLY owns entries
  // for this user (SERVER_AT_FULL_OWNERSHIP + cutover, testnet-only), reject
  // client-originated AUTO opens. A fresh client whose serverActive lockout
  // hasn't synced yet would otherwise double-open (observed live 2026-06-07 —
  // two AT_ entries from a cold session, blocked only by insufficient margin).
  // reduceOnly (closes) and manual orders always pass — pure decision tested
  // in ownership.test.js::shouldRejectClientAutoOrder.
  try {
    const { shouldRejectClientAutoOrder } = require('../services/ownership');
    if (shouldRejectClientAutoOrder({
      serverOwnsEntries: _getServerAT().serverFullyOwnsEntries(req.user.id),
      source: req.body.source,
      reduceOnly: req.body.reduceOnly === true || req.body.reduceOnly === 'true',
    })) {
      try {
        require('../services/database').auditLog(req.user.id, 'ORDER_REJECT_ENTRY_OWNED_BY_SERVER',
          JSON.stringify({ symbol: req.body.symbol, side: req.body.side, source: req.body.source }), req.ip);
      } catch (_) {}
      return res.status(409).json({ ok: false, error: 'ENTRY_OWNED_BY_SERVER', detail: 'Server AT owns entries for this account — client auto-entries are locked out (SP2-b full ownership).' });
    }
  } catch (e) {
    // Guard must never break manual trading — log and continue on internal error.
    console.error('[API] order/place SP2-b ownership guard error:', e.message);
  }
  // [Fix #1 2026-05-20 — BUG-T2c Path B regression seal] Server-resolved
  // engineMode check. Client may send mode=undefined or no mode field at all
  // (historical client behavior); validateOrderBody middleware's mode==='live'
  // SL-required guard is bypassed. trading.js then routes through the live
  // path because server-side us.engineMode='live' (for user 1, at least),
  // BUT _placeProtectionForExistingEntry's gate (line ~399 below) checks
  // req.body.sl truthy — null → SL placement SKIPPED → position opens on
  // Binance with no exchange SL = BUG-T2c regression.
  //
  // [WS-PROXY B.8] Stale data trade blocker — refuse order if price data is stale.
  // Only when WS_PROXY_ENABLED (proxy is the price source). Non-demo only.
  try {
    const MF = require('../migrationFlags');
    if (MF.WS_PROXY_ENABLED) {
      const wsProxy = require('../services/wsMarketProxy');
      const symbol = req.body.symbol;
      const wsStale = wsProxy.isSymbolStale(symbol);
      // [Bug fix 2026-05-29] Consult the canonical live price (serverState, fed by
      // marketFeed @bookTicker) — wsProxy's per-symbol WS may be IP-blocked while this
      // is fresh. Block only if BOTH are stale (fail-closed when serverState unknown).
      let ssAgeMs = null;
      try {
        const snap = require('../services/serverState').getSnapshotForSymbol(symbol);
        if (snap && snap.priceTs) ssAgeMs = Date.now() - snap.priceTs;
      } catch (_) { /* leave null → fail-closed */ }
      if (_resolveStaleBlock(wsStale, ssAgeMs, 10000)) {
        const staleness = (ssAgeMs != null && Number.isFinite(ssAgeMs)) ? ssAgeMs : wsProxy.getStalenessMs(symbol);
        try { audit.record('STALE_TRADE_BLOCKED', { userId: req.user.id, symbol, staleness_ms: staleness, ss_age_ms: ssAgeMs, ws_stale: wsStale, threshold_ms: 10000 }, 'TRADE_BLOCKER', req.ip); } catch (_) {}
        return res.status(423).json({
          error: 'STALE_DATA',
          symbol,
          staleness_ms: Number.isFinite(staleness) ? Math.round(staleness) : null,
          threshold_ms: 10000,
          message: `Trading paused — ${symbol} market data is stale (max 10s)`,
        });
      }
    }
  } catch (_) { /* defensive — never block trading on wsProxy load failure */ }

  // M1.9 audit (2026-05-20) confirmed 0/48 live trades had slOrderId for
  // exactly this reason. Block here at the entry edge.
  let _actualEngineMode;
  try {
    _actualEngineMode = _getServerAT().getMode(req.user.id) || 'demo';
  } catch (_) {
    _actualEngineMode = req.body.mode || 'demo';
  }
  const _isTestnet = req.exchangeMode === 'testnet';
  // [AUDIT-20260619 BUG B] A reduce-only CLOSE never carries an SL (you don't
  // stop-loss a close), so the SL-required entry guard must NOT reject it. Without
  // this exemption a live close without `sl` was rejected 400 (the bug was acute when
  // _isTestnet mis-resolved to false and treated a testnet close as a REAL entry).
  const _slRequired = require('../services/orderGuards').slRequiredForEntry({
    engineMode: _actualEngineMode,
    isTestnet: _isTestnet,
    closePosition: !!req.body.closePosition,
    reduceOnly: req.body.reduceOnly === true || req.body.reduceOnly === 'true',
  });
  if (_slRequired) {
    const _slCheck = req.body.sl;
    if (_slCheck === undefined || _slCheck === null || _slCheck === '' ||
        typeof _slCheck === 'object' || typeof _slCheck === 'boolean') {
      audit.record('ORDER_BLOCKED_NO_SL_SERVER_RESOLVED', {
        userId: req.user.id,
        symbol: req.body.symbol,
        side: req.body.side,
        actualMode: _actualEngineMode,
        bodyMode: req.body.mode,
      }, 'FIX1_SERVER_RESOLVED', req.ip);
      return res.status(400).json({ error: 'SL required for live mode (server-resolved engineMode; defense-in-depth Fix #1)' });
    }
    const _slNum = Number(String(_slCheck).trim());
    if (!Number.isFinite(_slNum) || _slNum <= 0) {
      audit.record('ORDER_BLOCKED_NO_SL_SERVER_RESOLVED', {
        userId: req.user.id,
        symbol: req.body.symbol,
        side: req.body.side,
        actualMode: _actualEngineMode,
        bodyMode: req.body.mode,
        slValue: _slCheck,
      }, 'FIX1_SERVER_RESOLVED', req.ip);
      return res.status(400).json({ error: 'SL required for live mode (server-resolved engineMode; defense-in-depth Fix #1)' });
    }
  }

  // Idempotency check — reject missing key or duplicate submissions
  const idem = _checkIdempotency(req);
  if (idem && idem.reject) {
    return res.status(400).json({ error: idem.reason });
  }
  if (idem && idem.duplicate) {
    // [Wave 6] If we have a cached result from DB ledger (cross-restart hit),
    // return it (200) instead of 409. This preserves exactly-once semantics
    // across PM2 reloads. If only in-memory duplicate (no cached result),
    // keep legacy 409 behavior — caller likely retrying a still-processing
    // submission.
    if (idem.cachedResult) {
      return res.status(200).json({ ...idem.cachedResult, _idempotent: 'replayed_from_ledger' });
    }
    return res.status(409).json({ error: 'Duplicate order — already processing (key: ' + req.headers['x-idempotency-key'] + ')' });
  }
  if (!config.tradingEnabled) {
    return res.status(403).json({ error: 'Trading disabled' });
  }
  // [S2.C C1] Global PANIC halt — block any new live exposure via direct manual order
  if (_getServerAT().isGlobalHaltActive()) {
    logger.warn('ORDER', `Order blocked — GLOBAL_HALT active uid=${req.user && req.user.id}`);
    try { audit.record('ORDER_BLOCKED_GLOBAL_HALT', { userId: req.user && req.user.id, symbol: req.body.symbol, side: req.body.side }, 'MANUAL', req.ip); } catch (_) { /* best-effort */ }
    return res.status(423).json({ error: 'GLOBAL_HALT active — new live orders blocked' });
  }
  // [BE-01] Compute idempotency key for cleanup on confirmed-failure paths
  const _idemKey = req.user && req.headers['x-idempotency-key'] ? `${req.user.id}:${req.headers['x-idempotency-key']}` : null;
  const { symbol, side, type, quantity, price, leverage, stopPrice, newClientOrderId, closePosition } = req.body;

  // Server-side risk check
  const owner = _owner(req.body);
  const risk = validateOrder({ symbol, side, type, quantity, price: price || 0, referencePrice: req.body.referencePrice || 0, leverage: leverage || 1, closePosition: !!closePosition, reduceOnly: !!req.body.reduceOnly }, owner, req.user.id);
  if (!risk.ok) {
    console.warn('[RISK] Order blocked:', risk.reason);
    logger.warn('RISK', 'Order blocked: ' + risk.reason, { symbol, side, owner });
    audit.record('ORDER_BLOCKED', { userId: req.user.id, symbol, side, type, quantity, reason: risk.reason }, owner, req.ip);
    metrics.recordOrder('blocked');
    telegram.alertRiskBlock(risk.reason, owner, req.user.id);
    return res.status(403).json({ error: risk.reason });
  }

  // [Bug#3 STEP 2] Acquire per-user+exchange+symbol+side lock BEFORE the duplicate
  // guard. Parallel opens that arrive in the same tick used to both pass the guard
  // (TOCTOU: sync check + async Binance await) — now the second caller short-circuits
  // at 409 before ever reaching Binance. Close/reduceOnly orders skip the lock.
  const _isOpening = !closePosition && !req.body.reduceOnly;
  const _exLabel = req.exchangeMode || (req.exchangeCreds && req.exchangeCreds.baseUrl) || 'default';
  const _orderLockKey = _isOpening ? _acquireOrderLock(req.user.id, symbol, side, _exLabel) : null;
  if (_isOpening && !_orderLockKey) {
    logger.warn('ORDER', `Order lock busy: ${side} ${symbol} uid=${req.user.id} ex=${_exLabel} — parallel submit rejected`);
    if (_idemKey) _idempotencyCache.delete(_idemKey);
    return res.status(409).json({ error: `Order in progress for ${side} ${symbol} — try again in a moment` });
  }

  try {
    // Duplicate position guard — prevent accidental double-open on same symbol+side
    // Override with allowDuplicate:true in body for intentional hedging/scaling
    if (!req.body.allowDuplicate && !closePosition) {
      const _existingLive = require('../services/serverAT').getLivePositions(req.user.id);
      const _dup = _existingLive.find(p => p.symbol === symbol && p.side === side);
      if (_dup) {
        logger.warn('ORDER', `Duplicate guard: ${side} ${symbol} already open (seq=${_dup.seq}) uid=${req.user.id}`);
        if (_idemKey) _idempotencyCache.delete(_idemKey);
        return res.status(409).json({ error: `Position already open: ${side} ${symbol} (seq=${_dup.seq}). Send allowDuplicate:true to override.` });
      }
    }

    // [SAFE-2] Force CROSSED margin type before leverage/order — Zeus AT risk
    // math assumes CROSS pooling. Same rationale as serverAT.js
    // _executeLiveEntry SAFE-2 patch (now both CLIENT_AT path
    // /api/order/place + future SERVER_AT path are covered). Skip on
    // close/reduceOnly orders (no new exposure). Idempotent: Binance
    // returns numeric err.code -4046 if already CROSSED — treat as success
    // and proceed silently. Real failure blocks order before placement,
    // mirrors existing leverage failure style: console.error + _idemKey
    // cleanup + 500 response with _safeError. Detection of -4046 uses
    // err.code numeric (propagated by binanceSigner.js:211 from
    // Binance data.code), not message-substring.
    if (_isOpening) {
      // [Day 35 bugfix] Idempotent — Binance refuses redundant set when symbol
      // has open orders (-4144 / -4048); helper verifies actual marginType via
      // positionRisk and treats refusal as silent if state already CROSSED.
      // [Phase M] exchange-aware: Binance via marginTypeHelper, Bybit UNIFIED no-op.
      const _mt = await exchangeOps.setMarginType(req.user.id, { symbol });
      if (_mt && _mt.ok === false) {
        console.error('[API] marginType set failed:', _mt.error);
        if (_idemKey) _idempotencyCache.delete(_idemKey); // [BE-01] order never reached exchange
        return res.status(500).json({ error: 'Failed to set margin type: ' + _safeError(new Error(_mt.error || 'unknown')) });
      }
    }

    // Set leverage first if provided
    if (leverage) {
      // [Phase M] exchange-aware leverage (Binance /fapi/v1/leverage, Bybit set-leverage).
      const _lev = await exchangeOps.setLeverage(req.user.id, { symbol, leverage });
      if (_lev && _lev.ok === false) {
        console.error('[API] leverage set failed:', _lev.error);
        if (_idemKey) _idempotencyCache.delete(_idemKey); // [BE-01] order never reached exchange
        return res.status(500).json({ error: 'Failed to set leverage: ' + _safeError(new Error(_lev.error || 'unknown')) });
      }
    }

    // Place the order
    const params = { symbol, side, type: type || 'MARKET' };
    // Round quantity + stopPrice to exchange LOT_SIZE / PRICE_FILTER
    const _rounded = roundOrderParams(symbol, parseFloat(quantity), stopPrice ? parseFloat(stopPrice) : undefined);
    params.quantity = String(_rounded.quantity || quantity);
    if (type === 'LIMIT' && price) {
      // Round limit price to tickSize (same as stopPrice rounding)
      const _rndPrice = roundOrderParams(symbol, 0, parseFloat(price));
      params.price = String(_rndPrice.stopPrice != null ? _rndPrice.stopPrice : price);
      params.timeInForce = 'GTC';
    }
    // STOP_MARKET / TAKE_PROFIT_MARKET require stopPrice
    // Binance rejects if both closePosition and quantity are sent — use quantity only
    if ((type === 'STOP_MARKET' || type === 'TAKE_PROFIT_MARKET') && stopPrice) {
      params.stopPrice = String(_rounded.stopPrice != null ? _rounded.stopPrice : stopPrice);
      params.reduceOnly = true; // SL/TP are always reduce-only (close exposure, never open new)
    }
    // ARES tag — newClientOrderId for tracking
    if (newClientOrderId) {
      params.newClientOrderId = newClientOrderId;
    }
    // [CLOSE-FIX] MARKET close: reduceOnly + rounded to exchange stepSize
    if (closePosition === true && type === 'MARKET') {
      const _closRound = roundOrderParams(symbol, parseFloat(quantity));
      params.quantity = String(_closRound.quantity || quantity);
      params.reduceOnly = 'true';
    }
    // [Phase M] Exchange-aware placement — route through exchangeOps so Bybit gets
    // its /v5/order/create (was Binance-hardcoded /fapi/v1/order, which a Bybit-active
    // user's manual order hit on the Bybit host → "non-JSON (HTTP 200)" → not taken).
    const _isConditional = type === 'STOP_MARKET' || type === 'TAKE_PROFIT_MARKET';
    let data;
    if (_isConditional) {
      // Standalone manual SL/TP. side BUY/SELL is the ORDER (closing) side; the
      // position side is its inverse (SELL closes a LONG, BUY closes a SHORT).
      const _posSide = params.side === 'SELL' ? 'LONG' : 'SHORT';
      const _cond = type === 'TAKE_PROFIT_MARKET'
        ? await exchangeOps.placeTakeProfit(req.user.id, { symbol, side: _posSide, triggerPrice: params.stopPrice, quantity: params.quantity, clientOrderId: params.newClientOrderId })
        : await exchangeOps.placeStopLoss(req.user.id, { symbol, side: _posSide, stopPrice: params.stopPrice, quantity: params.quantity, newClientOrderId: params.newClientOrderId, decisionKey: params.newClientOrderId || `cond_${symbol}` });
      if (!_cond || _cond.ok === false) {
        if (_idemKey) _idempotencyCache.delete(_idemKey);
        return res.status(400).json({ error: 'Conditional order rejected: ' + _safeError(new Error((_cond && _cond.error && (_cond.error.message || _cond.error)) || 'unknown')) });
      }
      data = { orderId: _cond.slOrderId || _cond.tpOrderId || _cond.orderId, status: String(_cond.status || 'NEW').toUpperCase() };
    } else {
      const _ord = await exchangeOps.placeOrder(req.user.id, {
        symbol, side, type: type || 'MARKET',
        quantity: params.quantity, price: params.price,
        reduceOnly: params.reduceOnly === true || params.reduceOnly === 'true',
        closePosition: closePosition === true,
        clientOrderId: params.newClientOrderId,
      });
      if (!_ord || _ord.ok === false) {
        if (_idemKey) _idempotencyCache.delete(_idemKey);
        return res.status(400).json({ error: 'Order rejected: ' + _safeError(new Error((_ord && _ord.error && (_ord.error.message || _ord.error)) || 'unknown')) });
      }
      data = { orderId: _ord.orderId, status: String(_ord.status || 'NEW').toUpperCase() };
    }

    // [ZT-AUD-002] Log actual status instead of assuming FILLED
    const fillStatus = data.status || data.algoStatus || 'UNKNOWN';
    console.log(`[ORDER] ${side} ${quantity} ${symbol} @ ${type} → orderId: ${data.orderId} status: ${fillStatus}`);
    logger.info('ORDER', `${side} ${quantity} ${symbol} @ ${type}`, { orderId: data.orderId, status: fillStatus, avgPrice: data.avgPrice, executedQty: data.executedQty });
    audit.record(fillStatus === 'FILLED' ? 'ORDER_FILLED' : 'ORDER_PLACED', { userId: req.user.id, symbol, side, type, quantity, orderId: data.orderId, status: fillStatus, avgPrice: data.avgPrice, executedQty: data.executedQty }, owner, req.ip);
    metrics.recordOrder(fillStatus === 'FILLED' ? 'filled' : 'placed');
    // [batch3-W] Binance Futures testnet frequently returns status=NEW on MARKET
    // orders (fill happens async microseconds later). Treat NEW and FILLED as
    // "accepted by exchange" for position registration — skip only on rejected/
    // CANCELED/EXPIRED statuses. Defer a single getOrder fetch to patch
    // avgPrice/executedQty once the fill materializes.
    const _acceptedForRegistration = (fillStatus === 'FILLED' || fillStatus === 'NEW' || fillStatus === 'PARTIALLY_FILLED');
    if (fillStatus === 'FILLED') {
      telegram.alertOrderFilled(symbol, side, data.executedQty || quantity, data.avgPrice || 0, data.orderId, req.user.id);
    }
    if (_acceptedForRegistration && !closePosition && !req.body.reduceOnly && type === 'MARKET') {
      try {
        const _entryPriceFallback = parseFloat(data.avgPrice) || parseFloat(data.price) || parseFloat(req.body.referencePrice) || 0;
        const _qtyFallback = parseFloat(data.executedQty) || parseFloat(quantity) || 0;
        // [BUG-T2c FIX 2026-05-14] Place SL on Binance after main order success.
        // Pre-M1, Path B (trading.js → registerManualPosition) NEVER placed SL on
        // exchange — only memorized locally. M1 unified path expected mode='live'
        // but trading.js never passed it, so fell through to legacy (silent
        // sl=null accept). 1678/1720 (97.6%) live testnet positions had no
        // Binance SL → BUG-T2c. Fix: place SL (HARD) + TP (conditional on
        // !dslParams) BEFORE registerManualPosition, pass orderIds explicitly.
        // DSL rule: DSL ON → no native TP (trail SL exits via PL hit).
        const _sl = req.body.sl ? parseFloat(req.body.sl) : null;
        const _tp = req.body.tp ? parseFloat(req.body.tp) : null;
        let _protection = { slOrderId: null, tpOrderId: null, status: 'LIVE_NO_SL' };
        if (_sl && _sl > 0 && req.body.mode !== 'demo') {
          try {
            _protection = await _getServerAT()._placeProtectionForExistingEntry({
              userId: req.user.id,
              symbol, side,
              sl: _sl, tp: _tp,
              executedQty: _qtyFallback,
              avgPrice: _entryPriceFallback,
              dslParams: req.body.dslParams,
              leverage: parseInt(leverage, 10) || 1,
              seq: data.orderId,
            }, req.exchangeCreds);
          } catch (protErr) {
            logger.error('ORDER', `Path B protection failed: ${protErr.message}`, { symbol, side, orderId: data.orderId });
            audit.record('PB_PROTECTION_FAILED', { userId: req.user.id, symbol, side, orderId: data.orderId, error: protErr.message }, 'PATH_B', req.ip);
            try { telegram.sendToUser(req.user.id, `🚨 *PATH B SL FAILED*\n${side} ${symbol}\nMain order ${data.orderId} placed but SL helper threw.\nPosition may be UNPROTECTED — verify on Binance.\nError: ${protErr.message}`); } catch (_) {}
          }
        }
        // [M1.2 Cat C 2026-05-14] registerManualPosition acum async — await pentru
        // a obține regResult sincron. Caller route handler e async, await safe.
        const regResult = await _getServerAT().registerManualPosition(req.user.id, {
          symbol,
          side,
          entryPrice: _entryPriceFallback,
          qty: _qtyFallback,
          leverage: parseInt(leverage, 10) || 1,
          orderId: data.orderId,
          sl: _sl,
          tp: _tp,
          // [BUG-T2c FIX 2026-05-14] Real exchange orderIds from protection helper.
          // legacy _registerManualPositionLegacy reads these into entry.live.{slOrderId,tpOrderId}.
          // NOTE: mode NU propagat intentionally — wrapper defaults to 'demo' and routes
          // to legacy fallback (us.engineMode='live'). This avoids unified path triggering
          // _executeLiveEntryCore which would attempt to place ANOTHER main order
          // (trading.js already placed it above). Path B = main order pe trading.js +
          // SL/TP pe _placeProtectionForExistingEntry; registration only stores state.
          slOrderId: _protection.slOrderId,
          tpOrderId: _protection.tpOrderId,
          // [Phase 7 — Manual Parity GAP-1] Forward client-computed DSL preset so manual LIVE
          // registers with the user's params (same as manual DEMO via /api/at/register-manual).
          // undefined → serverAT falls back to DSL_DEFAULTS (legacy clients); null → DSL OFF.
          dslParams: req.body.dslParams,
          // [Phase 10 classification] Client marks auto vs manual origin explicitly.
          // Without this, every /order/place fill was registered as manual even
          // when client AT fired it, so AT positions appeared in the Manual panel.
          source: req.body.source,
        });
        if (regResult.ok) logger.info('ORDER', `Manual position registered: seq=${regResult.seq} ${symbol} ${side} status=${fillStatus}`);
        // [batch3-W] If fill wasn't immediate (status=NEW), fetch the order a
        // moment later to patch the real avgPrice/executedQty onto the
        // already-registered position so the UI reflects actual fill price.
        if (fillStatus !== 'FILLED' && regResult.ok && regResult.seq) {
          setTimeout(() => {
            // [Phase M] exchange-aware fill query (Bybit status is 'Filled', Binance 'FILLED').
            exchangeOps.getOrder(req.user.id, { symbol, orderId: data.orderId }).then(fresh => {
              if (!fresh || String(fresh.status).toUpperCase() !== 'FILLED') return;
              const _px = parseFloat(fresh.avgPrice) || parseFloat(fresh.price) || 0;
              const _qty = parseFloat(fresh.executedQty) || 0;
              if (_px > 0 && _qty > 0) {
                const patched = _getServerAT().patchPositionFill(req.user.id, regResult.seq, { entryPrice: _px, qty: _qty });
                if (patched && patched.ok) {
                  telegram.alertOrderFilled(symbol, side, _qty, _px, data.orderId, req.user.id);
                  logger.info('ORDER', `Manual position fill patched: seq=${regResult.seq} ${symbol} ${side} @ ${_px} qty=${_qty}`);
                }
              }
            }).catch(e => logger.warn('ORDER', `Fill-patch fetch failed seq=${regResult.seq}: ${e.message}`));
          }, 1500);
        }
      } catch (regErr) {
        logger.warn('ORDER', `Manual position registration failed: ${regErr.message}`);
        // [BUG-T4 2026-05-13] Orphan position risk defense-in-depth: main
        // order succeeded pe Binance dar registerManualPosition threw →
        // position există fizic, Zeus zero tracking. Fire 3 alerts
        // best-effort: audit_log + Telegram + Sentry. Operator decides
        // next action (manual close on exchange or accept risk).
        try {
          require('../services/orphanAlert').alertOrphanRisk(regErr, {
            req, symbol, side, type, quantity, data, owner,
          });
        } catch (_) { /* best-effort isolation — outer wrapper safety */ }
      }
    }
    const _placeResult = {
      orderId: data.orderId,
      status: data.status,
      avgPrice: parseFloat(data.avgPrice || 0),
      executedQty: parseFloat(data.executedQty || 0),
      symbol: data.symbol,
      side: data.side,
      type: data.type,
    };
    // [Wave 6] Record success in DB ledger for cross-restart dedup
    _recordIdempotencySuccess(req, { symbol, side, type, quantity, leverage }, _placeResult);
    res.json(_placeResult);
  } catch (err) {
    // [BE-01] Release idempotency key only if order confirmed NOT executed (4xx = Binance rejected)
    // Do NOT release on 5xx/timeout — order status is ambiguous, keeping key prevents duplicate
    if (_idemKey && err.status && err.status >= 400 && err.status < 500) {
      _idempotencyCache.delete(_idemKey);
    }
    console.error('[API] order/place error:', err.message);
    logger.error('ORDER', 'order/place failed', { symbol, side, error: err.message });
    audit.record('ORDER_FAILED', { userId: req.user.id, symbol, side, type, quantity, error: err.message }, owner, req.ip);
    metrics.recordOrder('failed');
    metrics.recordError(err.message);
    telegram.alertOrderFailed(symbol, side, err.message, req.user.id);
    res.status(err.status || 500).json({ error: _safeError(err) });
  } finally {
    // [Bug#3 STEP 2] Release the per-user+exchange+symbol+side lock in all paths.
    if (_orderLockKey) _releaseOrderLock(_orderLockKey);
  }
});

// ─── POST /api/order/cancel ───
router.post('/order/cancel', validateCancelBody, async (req, res) => {
  if (!config.tradingEnabled) {
    return res.status(403).json({ error: 'Trading disabled' });
  }
  const { symbol, orderId } = req.body;
  try {
    const result = await exchangeOps.cancelOrder(req.user.id, { symbol, orderId });
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    res.json({ orderId: result.orderId, status: result.status });
  } catch (err) {
    console.error('[API] order/cancel error:', err.message);
    logger.error('ORDER', 'cancel failed', { symbol, orderId, error: err.message });
    res.status(err.status || 500).json({ error: _safeError(err) });
  }
});

// ─── POST /api/risk/pnl ─── Report a closed trade's PnL for daily loss tracking
router.post('/risk/pnl', (req, res) => {
  const pnl = parseFloat(req.body.pnl);
  if (isNaN(pnl)) return res.status(400).json({ error: 'pnl must be a number' });
  if (Math.abs(pnl) > 1000000) return res.status(400).json({ error: 'pnl value out of range' });
  const owner = (req.body.owner === 'ARES') ? 'ARES' : 'AT';
  recordClosedPnL(pnl, owner, req.user.id);
  res.json({ ok: true, owner });
});

// ─── POST /api/leverage ───
router.post('/leverage', validateLeverageBody, async (req, res) => {
  if (!config.tradingEnabled) {
    return res.status(403).json({ error: 'Trading disabled' });
  }
  try {
    // [Phase M] exchange-aware leverage (Binance /fapi/v1/leverage, Bybit set-leverage).
    const _lev = await exchangeOps.setLeverage(req.user.id, { symbol: req.body.symbol, leverage: req.body.leverage });
    if (!_lev || _lev.ok === false) {
      return res.status(400).json({ error: _safeError(new Error((_lev && _lev.error) || 'leverage failed')) });
    }
    res.json({ leverage: _lev.leverage });
  } catch (err) {
    console.error('[API] leverage error:', err.message);
    res.status(err.status || 500).json({ error: _safeError(err) });
  }
});

// ─── GET /api/config ─── Read current risk config ───
router.get('/config', (req, res) => {
  res.json({
    risk: { ...config.risk },
    tradingEnabled: config.tradingEnabled,
  });
});

// ─── POST /api/user/telegram ─── Per-user Telegram credentials ───
router.post('/user/telegram', (req, res) => {
  const { botToken, chatId } = req.body;
  if (!botToken || !chatId) {
    return res.status(400).json({ error: 'botToken and chatId are required' });
  }
  try {
    const { encrypt } = require('../services/encryption');
    const db = require('../services/database');
    const tokenEnc = encrypt(String(botToken).trim());
    const chatIdClean = String(chatId).trim();
    db.setUserTelegram(req.user.id, tokenEnc, chatIdClean);
    audit.record('TELEGRAM_CONFIG', { chatId: chatIdClean, userId: req.user.id }, 'user', req.ip);
    logger.info('CONFIG', 'Telegram credentials updated for user ' + req.user.id);
    res.json({ ok: true });
  } catch (e) {
    logger.error('CONFIG', 'Telegram save failed: ' + e.message);
    res.status(500).json({ error: 'Failed to save telegram config' });
  }
});

// ─── GET /api/user/telegram ─── Check if telegram is configured ───
router.get('/user/telegram', (req, res) => {
  try {
    const db = require('../services/database');
    const row = db.getUserTelegram(req.user.id);
    const configured = !!(row && row.telegram_bot_token_enc && row.telegram_chat_id);
    res.json({ configured, chatId: configured ? row.telegram_chat_id : '' });
  } catch (e) {
    res.json({ configured: false, chatId: '' });
  }
});

// ─── GET /api/user/settings ─── Load per-user settings ───
router.get('/user/settings', (req, res) => {
  try {
    const db = require('../services/database');
    const { data, updatedAt } = db.getUserSettingsWithTs(req.user.id);
    res.json({ ok: true, settings: data || {}, updated_at: updatedAt });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Failed to load settings' });
  }
});

// ─── POST /api/user/settings ─── Save per-user settings (whitelist + UPSERT) ───
// [MIGRATION-F0] Whitelist extended to cover every settings key produced by
// client `_usSave` so the legacy user_ctx FS path can be retired. Additions:
// profile/bmMode/assistArmed (brain mode), manualLive (live trade defaults),
// ptLevDemo/ptLevLive/ptMarginMode (leverage per account), chartTz,
// dslSettings (DSL presets overrides).
const SETTINGS_WHITELIST = new Set([
  // AT
  'confMin', 'sigMin', 'size', 'riskPct', 'maxDay', 'maxPos', 'sl', 'rr',
  'killPct', 'lossStreak', 'maxAddon', 'lev', 'adaptEnabled', 'adaptLive', 'smartExitEnabled',
  // Multi-Symbol scan
  'mscanEnabled', 'mscanSyms',
  // UI
  'theme', 'uiScale', 'soundEnabled',
  // Chart
  'chartTf', 'chartTz', 'chartType', 'candleColors', 'heatmapSettings', 'timezoneOffset',
  // Indicators
  'indSettings',
  // Liq / LLV / Supremus / S-R
  'liqSettings', 'llvSettings', 'zsSettings', 'srSettings',
  // Alerts
  'alertSettings',
  // Brain / profile
  'profile', 'bmMode', 'assistArmed',
  // [BRAIN-MODE-SPLIT b74] per-AT-mode brain namespace ({live:{profile,bmMode},demo:{...}})
  'brain',
  // Manual live/testnet defaults + per-account leverage
  'manualLive', 'manualTestnet', 'ptLevDemo', 'ptLevLive', 'ptMarginMode',
  // DSL
  'dslSettings',
  // Radar Lens (D4 persistence)
  'radarLens',
]);

router.post('/user/settings', validateSettingsBody, (req, res) => {
  try {
    const db = require('../services/database');
    const raw = req.body.settings;
    if (!raw || typeof raw !== 'object') return res.status(400).json({ ok: false, error: 'Missing settings object' });

    // [Phase 8D2] Optimistic concurrency guard for multi-tab safety.
    // Client may pass `if_updated_at` (epoch ms of the version the UI
    // reflects). If the DB already holds a newer version, reject with 409
    // and return the current snapshot so the stale tab can refresh instead
    // of overwriting the fresher change from another tab / device.
    const ifTs = Number(req.body.if_updated_at) || 0;
    if (ifTs > 0) {
      const current = db.getUserSettingsWithTs(req.user.id);
      if (current && current.updatedAt > 0 && current.updatedAt > ifTs) {
        return res.status(409).json({
          ok: false,
          error: 'stale',
          current_updated_at: current.updatedAt,
          current_settings: current.data || {},
        });
      }
    }

    // Whitelist: only allowed keys pass through
    const clean = {};
    for (const key of Object.keys(raw)) {
      if (SETTINGS_WHITELIST.has(key)) clean[key] = raw[key];
    }

    // Merge with existing (so partial updates don't wipe other keys)
    const existing = db.getUserSettings(req.user.id) || {};
    const merged = { ...existing, ...clean };

    // [R5] Deep-merge per-mode brain namespace. Top-level spread replaces the
    // whole `brain` object, so a client POST carrying only `{brain:{demo:{...}}}`
    // would silently wipe `brain.live` (and vice-versa). Preserve both slots by
    // merging each namespace shallowly against the existing snapshot. An empty
    // slot in the payload (`{live:{...},demo:{}}`) is still merged defensively
    // so nothing is clobbered.
    if (clean.brain && typeof clean.brain === 'object' && !Array.isArray(clean.brain)) {
      const existingBrain = (existing.brain && typeof existing.brain === 'object' && !Array.isArray(existing.brain))
        ? existing.brain : { live: {}, demo: {} };
      merged.brain = {
        live: { ...(existingBrain.live || {}), ...(clean.brain.live || {}) },
        demo: { ...(existingBrain.demo || {}), ...(clean.brain.demo || {}) },
      };
    }

    // [DIAG 2026-05-20] Log assistArmed flow to find DSL persistence bug
    if (clean.assistArmed !== undefined || (clean.brain && (clean.brain.demo || clean.brain.live))) {
      const beforeFlat = existing.assistArmed;
      const afterFlat = merged.assistArmed;
      const beforeBrain = existing.brain || {};
      const afterBrain = merged.brain || {};
      console.log('[DSL-DIAG] uid=' + req.user.id +
        ' clean.assistArmed=' + clean.assistArmed +
        ' clean.brain.demo.assistArmed=' + (clean.brain && clean.brain.demo ? clean.brain.demo.assistArmed : 'n/a') +
        ' clean.brain.live.assistArmed=' + (clean.brain && clean.brain.live ? clean.brain.live.assistArmed : 'n/a') +
        ' | before flat=' + beforeFlat +
        ' before brain.demo=' + (beforeBrain.demo && beforeBrain.demo.assistArmed) +
        ' before brain.live=' + (beforeBrain.live && beforeBrain.live.assistArmed) +
        ' | after flat=' + afterFlat +
        ' after brain.demo=' + (afterBrain.demo && afterBrain.demo.assistArmed) +
        ' after brain.live=' + (afterBrain.live && afterBrain.live.assistArmed));
    }

    const updatedAt = db.saveUserSettings(req.user.id, merged);

    // [MIGRATION-F0] Fan-out to every live session of this user so other
    // devices can refetch without polling. Uses the existing `/ws/sync`
    // WSS (no parallel socket). Helper is wired on `app.locals` by
    // server.js; also exposed on `global.__zeusWsBroadcastToUser` for
    // modules without access to `req.app`. Best-effort — missing helper
    // (e.g. during tests) must not break the save.
    try {
      const broadcast = (req.app && req.app.locals && req.app.locals.wsBroadcastToUser) || global.__zeusWsBroadcastToUser;
      if (typeof broadcast === 'function') {
        broadcast(req.user.id, {
          type: 'settings.changed',
          updated_at: updatedAt,
          keys: Object.keys(clean),
        });
      }
    } catch (_) { /* broadcast is best-effort */ }

    res.json({ ok: true, updated_at: updatedAt });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Failed to save settings' });
  }
});

// ─── GET /api/user/ares ─── Load per-user ARES state ───
router.get('/user/ares', (req, res) => {
  try {
    const db = require('../services/database');
    const data = db.getAresState(req.user.id);
    res.json({ ok: true, ares: data || {} });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Failed to load ARES state' });
  }
});

// [SEC-7] Strip prototype-pollution-prone keys from user-controlled payload
// before merge. Express body parser keeps `__proto__`/`constructor`/`prototype`
// as regular own properties post-JSON.parse — they don't auto-trigger
// pollution via spread, BUT persist via JSON.stringify and can manifest
// downstream when ARES state is read back și iterated. /api/user/settings
// (line 560) already has SETTINGS_WHITELIST defense; ARES has dynamic-keys
// schema cu no whitelist, so apply explicit strip helper la boundary.
// Top-level shallow strip is sufficient because spread is shallow — pollution
// at nested __proto__ doesn't auto-pollute Object.prototype unless code does
// `obj[someKey] = value` cu `someKey === '__proto__'`, which spread doesn't.
function _stripDangerousKeys(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  for (const k of Object.keys(obj)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    // [2026-06-23] REAL-money consent is server-authoritative — a client sync can NEVER set it
    // (defense-in-depth on top of the SERVER_ARES 409 guard). Only setRealOptIn() flips it.
    if (k === 'realOptIn' || k === 'realOptInTs' || k === 'killSwitch' || k === 'dailyLoss' || k === 'aresActive' || k === 'aresActiveTs') continue;
    out[k] = obj[k];
  }
  return out;
}

// ─── POST /api/user/ares ─── Save per-user ARES state (UPSERT) ───
router.post('/user/ares', (req, res) => {
  try {
    const db = require('../services/database');
    // [SERVER-ARES 2026-06-07] Server-authoritative guard: when the server
    // engine owns ARES, a legacy client pushing its localStorage snapshot
    // would CLOBBER the server wallet (this route merges raw over existing).
    // 409 so old clients stop retrying silently corrupted state.
    if (require('../migrationFlags').SERVER_ARES === true) {
      return res.status(409).json({ ok: false, error: 'ARES_OWNED_BY_SERVER', detail: 'ARES state is server-authoritative — client snapshots are ignored. Use /api/ares/fund | /api/ares/withdraw.' });
    }
    const raw = req.body.ares;
    if (!raw || typeof raw !== 'object') return res.status(400).json({ ok: false, error: 'Missing ares object' });
    // [SEC-7] Strip dangerous keys before merge so prototype-pollution
    // attempts în request body don't persist into DB ARES state.
    const cleanRaw = _stripDangerousKeys(raw);
    // Merge with existing (also clean existing pe read în case prior writes
    // pre-patch persisted polluted state — defense-in-depth cleanup over time).
    const existing = _stripDangerousKeys(db.getAresState(req.user.id) || {});
    const merged = { ...existing, ...cleanRaw };
    db.saveAresState(req.user.id, merged);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Failed to save ARES state' });
  }
});

// ─── [SERVER-ARES 2026-06-07] Wallet ops — server-authoritative ARES ───
router.post('/ares/fund', express.json(), (req, res) => {
  try {
    if (require('../migrationFlags').SERVER_ARES !== true) return res.status(409).json({ ok: false, error: 'SERVER_ARES_OFF' });
    const r = require('../services/serverAres').fund(req.user.id, req.body.amount);
    if (r.ok) { try { require('../services/database').auditLog(req.user.id, 'ARES_FUND', JSON.stringify({ amount: +req.body.amount }), req.ip); } catch (_) {} }
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/ares/withdraw', express.json(), (req, res) => {
  try {
    if (require('../migrationFlags').SERVER_ARES !== true) return res.status(409).json({ ok: false, error: 'SERVER_ARES_OFF' });
    const r = require('../services/serverAres').withdraw(req.user.id, req.body.amount);
    if (r.ok) { try { require('../services/database').auditLog(req.user.id, 'ARES_WITHDRAW', JSON.stringify({ amount: +req.body.amount }), req.ip); } catch (_) {} }
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─── [SERVER-ARES 2026-06-07] Public state (panel refresh without full sync) ───
router.get('/ares/state', (req, res) => {
  try {
    res.json({ ok: true, ares: require('../services/serverAres').getPublicState(req.user.id) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─── [2026-06-23] REAL-money consent toggle. Server-authoritative; user sets ONLY their own.
// Enabling requires an explicit acknowledgment so it can never be a one-tap accident. This does
// NOT enable real execution by itself — the protected _SRV_POS_REAL_ENABLED master switch still
// gates everything. It only records that THIS user consents to ARES trading their real capital.
router.post('/ares/real-optin', express.json(), (req, res) => {
  try {
    const serverAres = require('../services/serverAres');
    const enabled = req.body.enabled === true;
    if (enabled && req.body.ack !== true) {
      return res.status(400).json({ ok: false, error: 'ACK_REQUIRED', detail: 'Enabling real autonomous trading requires explicit acknowledgment (ack:true).' });
    }
    const value = serverAres.setRealOptIn(req.user.id, enabled);
    try { require('../services/database').auditLog(req.user.id, 'ARES_REAL_OPTIN', JSON.stringify({ enabled: value }), req.ip); } catch (_) {}
    res.json({ ok: true, realOptIn: value });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─── [2026-06-23] Persistent kill-switch toggle (emergency stop). Survives restart. ───
router.post('/ares/kill', express.json(), (req, res) => {
  try {
    const serverAres = require('../services/serverAres');
    const value = serverAres.setKillSwitch(req.user.id, req.body.enabled === true);
    try { require('../services/database').auditLog(req.user.id, 'ARES_KILL_SWITCH', JSON.stringify({ enabled: value }), req.ip); } catch (_) {}
    res.json({ ok: true, killSwitch: value });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─── [2026-06-24] ARES ACTIVE toggle (mutual exclusion with AT). Enabling ARES FORCES AutoTrade
// off for this account so only ARES trades (no conflicting same-symbol positions). User sets only
// their own. ───
router.post('/ares/active', express.json(), (req, res) => {
  try {
    const serverAres = require('../services/serverAres');
    const value = serverAres.setAresActive(req.user.id, req.body.enabled === true);
    try { require('../services/database').auditLog(req.user.id, 'ARES_ACTIVE_TOGGLE', JSON.stringify({ enabled: value }), req.ip); } catch (_) {}
    res.json({ ok: true, aresActive: value });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─── POST /api/user/telegram/test ─── Send a test message ───
router.post('/user/telegram/test', async (req, res) => {
  const telegram = require('../services/telegram');
  const ok = await telegram.sendToUser(req.user.id, '✅ *Zeus Terminal* — Test alert received!\nUser: ' + (req.user.email || req.user.id) + '\nTime: ' + new Date().toISOString());
  res.json({ ok });
});

// ─── POST /api/config ─── Hot-reload risk limits (no restart required) ───
router.post('/config', (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { maxLeverage, maxPositionUsdt, dailyLossLimitPct } = req.body;
  const prev = { ...config.risk };
  const changes = [];
  if (maxLeverage !== undefined) {
    const v = parseInt(maxLeverage, 10);
    if (v >= 1 && v <= 125) { config.risk.maxLeverage = v; changes.push('maxLeverage=' + v); }
  }
  if (maxPositionUsdt !== undefined) {
    const v = parseFloat(maxPositionUsdt);
    if (v > 0 && v <= 100000) { config.risk.maxPositionUsdt = v; changes.push('maxPositionUsdt=' + v); }
  }
  if (dailyLossLimitPct !== undefined) {
    const v = parseFloat(dailyLossLimitPct);
    if (v > 0 && v <= 100) { config.risk.dailyLossLimitPct = v; changes.push('dailyLossLimitPct=' + v); }
  }
  if (changes.length === 0) {
    return res.status(400).json({ error: 'No valid config changes provided' });
  }
  audit.record('CONFIG_CHANGED', { changes, previousConfig: prev, newConfig: config.risk, userId: req.user.id }, 'user', req.ip);
  logger.info('CONFIG', 'Risk config updated: ' + changes.join(', '));
  config.saveOverrides();
  res.json({ ok: true, changes, risk: config.risk });
});

// ═══════════════════════════════════════════════════════════════════════════
// MANUAL TRADING — Exchange-real endpoints for manual live trading
// All per-user via resolveExchange middleware (req.exchangeCreds)
// ═══════════════════════════════════════════════════════════════════════════

// ─── GET /api/openOrders ── Query open orders from Binance per-user ───
router.get('/openOrders', async (req, res) => {
  if (!config.tradingEnabled) {
    return res.status(403).json({ error: 'Trading disabled' });
  }
  try {
    const params = {};
    const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : null;
    if (symbol) {
      if (!/^[A-Z0-9]{2,20}$/.test(symbol)) return res.status(400).json({ error: 'Invalid symbol' });
      params.symbol = symbol;
    }
    // [Phase M] exchange-aware open orders (canonical shape from binanceOps/bybitOps).
    const data = await exchangeOps.getOpenOrders(req.user.id, params);
    const orders = (Array.isArray(data) ? data : []).map(o => ({
      orderId: o.orderId,
      symbol: o.symbol,
      side: o.side,
      type: o.type,
      status: o.status,
      price: parseFloat(o.price || 0),
      stopPrice: parseFloat(o.stopPrice || o.triggerPrice || 0),
      origQty: parseFloat(o.origQty != null ? o.origQty : (o.qty || 0)),
      executedQty: parseFloat(o.executedQty || 0),
      timeInForce: o.timeInForce,
      clientOrderId: o.clientOrderId || '',
      time: o.time || o.updateTime,
    }));
    res.json(orders);
  } catch (err) {
    console.error('[API] openOrders error:', err.message);
    logger.error('API', 'openOrders error', { error: err.message });
    res.status(err.status || 500).json({ error: _safeError(err) });
  }
});

// ─── POST /api/order/modify ── Cancel + replace a LIMIT order (atomic cancel/re-place) ───
router.post('/order/modify', validateCancelBody, async (req, res) => {
  if (!config.tradingEnabled) {
    return res.status(403).json({ error: 'Trading disabled' });
  }
  // [S2.C C3] Global PANIC halt — cancel+replace POSTs a new LIMIT, counts as new exposure
  if (_getServerAT().isGlobalHaltActive()) {
    logger.warn('ORDER', `Order modify blocked — GLOBAL_HALT active uid=${req.user && req.user.id}`);
    try { audit.record('ORDER_MODIFY_BLOCKED_GLOBAL_HALT', { userId: req.user && req.user.id, symbol: req.body.symbol, orderId: req.body.orderId }, 'MANUAL', req.ip); } catch (_) { /* best-effort */ }
    return res.status(423).json({ error: 'GLOBAL_HALT active — order modify blocked' });
  }
  const { symbol, orderId, newPrice, newQuantity } = req.body;
  const np = parseFloat(newPrice);
  if (!newPrice || isNaN(np) || np <= 0) {
    return res.status(400).json({ error: 'Invalid newPrice' });
  }
  // [BUG-5 FIX 2026-05-28] Cancel-then-replace with partial failure recovery.
  // If step-1 (cancel) succeeds but step-2 (replace) fails, the original order
  // is gone and position is unprotected. We now: (a) audit cancel separately,
  // (b) attempt to re-place original on step-2 failure, (c) Telegram alert if
  // recovery also fails, (d) return structured error to UI for actionable display.
  // [Phase M] exchange-aware. Cancel responses differ per exchange; fetch the order
  // first (canonical getOpenOrders) for side/qty/price, then cancel via exchangeOps.
  let _origOrder = null;
  try {
    const _open = await exchangeOps.getOpenOrders(req.user.id, { symbol });
    _origOrder = (Array.isArray(_open) ? _open : []).find(o => String(o.orderId) === String(orderId)) || null;
  } catch (_) { /* best-effort */ }
  let cancelData = null;
  try {
    const _c = await exchangeOps.cancelOrder(req.user.id, { symbol, orderId });
    if (!_c || _c.ok === false) throw new Error((_c && _c.error && (_c.error.message || _c.error)) || 'cancel rejected');
    cancelData = {
      orderId,
      side: (_origOrder && _origOrder.side) || req.body.side,
      origQty: _origOrder ? (_origOrder.origQty != null ? _origOrder.origQty : _origOrder.qty) : undefined,
      price: _origOrder ? _origOrder.price : undefined,
    };
    audit.record('ORDER_MODIFY_CANCELLED', { userId: req.user.id, symbol, orderId, side: cancelData.side, qty: cancelData.origQty, price: cancelData.price }, 'MANUAL', req.ip);
  } catch (cancelErr) {
    console.error('[API] order/modify cancel failed:', cancelErr.message);
    logger.error('ORDER', 'order/modify cancel failed', { symbol, orderId, error: cancelErr.message });
    return res.status(cancelErr.status || 500).json({ error: _safeError(cancelErr), stage: 'cancel' });
  }

  // Step 2: Re-place with new price
  const side = cancelData.side || req.body.side;
  let qty = newQuantity ? parseFloat(newQuantity) : parseFloat(cancelData.origQty);
  if (!Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({ error: 'Invalid newQuantity', stage: 'replace', _cancelled: true });
  }
  const _rounded = roundOrderParams(symbol, qty);
  const placeParams = {
    symbol, side, type: 'LIMIT',
    quantity: String(_rounded.quantity || qty),
    price: String(np),
    timeInForce: 'GTC',
  };
  if (req.body.newClientOrderId) placeParams.newClientOrderId = req.body.newClientOrderId;

  try {
    const _pl = await exchangeOps.placeOrder(req.user.id, { symbol, side, type: 'LIMIT', quantity: String(_rounded.quantity || qty), price: String(np), clientOrderId: req.body.newClientOrderId });
    if (!_pl || _pl.ok === false) throw new Error((_pl && _pl.error && (_pl.error.message || _pl.error)) || 'replace rejected');
    const placeData = { orderId: _pl.orderId, status: _pl.status, symbol, side, origQty: _rounded.quantity || qty };
    logger.info('ORDER', `MODIFY LIMIT ${symbol} old=${orderId} new=${placeData.orderId} price=${np}`);
    audit.record('ORDER_MODIFIED', { userId: req.user.id, symbol, oldOrderId: orderId, newOrderId: placeData.orderId, newPrice: np }, 'MANUAL', req.ip);
    return res.json({
      cancelledOrderId: cancelData.orderId,
      orderId: placeData.orderId,
      status: placeData.status,
      price: np,
      symbol: placeData.symbol,
      side: placeData.side,
      origQty: parseFloat(placeData.origQty || qty),
    });
  } catch (placeErr) {
    console.error('[API] order/modify replace failed:', placeErr.message);
    logger.error('ORDER', 'order/modify replace failed — attempting recovery', { symbol, orderId, error: placeErr.message });
    audit.record('ORDER_MODIFY_REPLACE_FAILED', { userId: req.user.id, symbol, orderId, error: placeErr.message }, 'MANUAL', req.ip);

    // Recovery attempt: re-place original (no price change) so position stays protected
    try {
      const origPrice = cancelData.price && parseFloat(cancelData.price) > 0 ? parseFloat(cancelData.price) : null;
      if (origPrice) {
        const recoveryParams = {
          symbol, side, type: 'LIMIT',
          quantity: String(_rounded.quantity || qty),
          price: String(origPrice),
          timeInForce: 'GTC',
        };
        const _rec = await exchangeOps.placeOrder(req.user.id, { symbol, side, type: 'LIMIT', quantity: String(_rounded.quantity || qty), price: String(origPrice) });
        if (!_rec || _rec.ok === false) throw new Error((_rec && _rec.error && (_rec.error.message || _rec.error)) || 'recovery rejected');
        const recoveryData = { orderId: _rec.orderId };
        logger.warn('ORDER', `MODIFY recovery: re-placed original ${symbol} @ $${origPrice} → ${recoveryData.orderId}`);
        audit.record('ORDER_MODIFY_RECOVERY_OK', { userId: req.user.id, symbol, originalOrderId: orderId, recoveryOrderId: recoveryData.orderId, recoveredPrice: origPrice }, 'MANUAL', req.ip);
        return res.status(502).json({
          error: 'Modify failed but original order recovered',
          stage: 'replace',
          _cancelled: true,
          _recovered: true,
          recoveryOrderId: recoveryData.orderId,
          detail: placeErr.message,
        });
      }
    } catch (recoveryErr) {
      logger.error('ORDER', `MODIFY recovery FAILED — position unprotected: ${recoveryErr.message}`);
      audit.record('ORDER_MODIFY_RECOVERY_FAILED', { userId: req.user.id, symbol, orderId, replaceError: placeErr.message, recoveryError: recoveryErr.message }, 'MANUAL', req.ip);
      try {
        const telegram = require('../services/telegram');
        telegram.sendToUser(req.user.id, `🚨 *ORDER MODIFY CRITICAL*\n${side} ${symbol}\nOriginal order ${orderId} cancelled BUT replace AND recovery failed.\n*Position may be unprotected — verify on exchange immediately.*\nReplace err: ${placeErr.message}\nRecovery err: ${recoveryErr.message}`);
      } catch (_) {}
    }
    return res.status(placeErr.status || 500).json({ error: _safeError(placeErr), stage: 'replace', _cancelled: true, _recovered: false });
  }
});

// ─── POST /api/manual/protection ── Set or update SL/TP for a manual live position ───
// Handles cancel-old + place-new atomically. Type: 'STOP_MARKET' or 'TAKE_PROFIT_MARKET'
// Task 37: SL placement + cancel-old route through exchangeOps (exchange-aware).
// TP placement retains direct Binance algo path (no exchangeOps.placeTakeProfit yet).
router.post('/manual/protection', validateOrderBody, async (req, res) => {
  if (!config.tradingEnabled) {
    return res.status(403).json({ error: 'Trading disabled' });
  }
  const { symbol, side, type, quantity, stopPrice, cancelOrderId } = req.body;
  try {
    // Cancel existing protection order if provided
    // Route through exchangeOps.cancelOrder so Bybit users are handled correctly.
    // [ALGO-FIX] For Binance: binanceOps.cancelOrder tries algo cancel first, then regular.
    if (cancelOrderId) {
      try {
        const cancelResult = await exchangeOps.cancelOrder(req.user.id, { symbol, orderId: String(cancelOrderId) });
        if (cancelResult.ok) {
          logger.info('ORDER', `Cancelled old protection ${cancelOrderId} for ${symbol}`);
        }
        // If !ok but "already gone" — tolerate silently (same behaviour as before)
      } catch (_cancelErr) {
        const _cm = _cancelErr.message || '';
        if (!_cm.includes('Unknown order') && !_cm.includes('UNKNOWN_ORDER') &&
            !_cm.includes('not found') && !_cm.includes('not active') &&
            !_cm.includes('already')) {
          throw _cancelErr;
        }
        // Already gone — proceed
      }
    }

    // ── SL placement via exchangeOps (Task 37) ──
    if (type === 'STOP_MARKET' || type === 'STOP_LOSS') {
      const dk = req.body.decisionKey || decisionKeyService.generate();
      const result = await exchangeOps.placeStopLoss(req.user.id, {
        symbol, side, stopPrice, decisionKey: dk,
      });
      if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.error });
      }
      logger.info('ORDER', `MANUAL SL SET ${symbol} triggerPrice=${stopPrice} orderId=${result.slOrderId}`);
      audit.record('PROTECTION_SET', { userId: req.user.id, symbol, type: 'SL', stopPrice, orderId: result.slOrderId }, 'MANUAL', req.ip);
      return res.json({
        orderId: result.slOrderId,
        status: result.status || 'NEW',
        type: type,
        stopPrice: parseFloat(stopPrice),
        symbol,
        side,
        rawExchange: result.rawExchange,
      });
    }

    // ── TP placement — [Phase M] exchange-aware via exchangeOps.placeTakeProfit ──
    // side is the ORDER (closing) side; position side is its inverse.
    const _rounded = roundOrderParams(symbol, parseFloat(quantity), parseFloat(stopPrice));
    const _posSideTp = side === 'SELL' ? 'LONG' : 'SHORT';
    const _tpRes = await exchangeOps.placeTakeProfit(req.user.id, {
      symbol, side: _posSideTp,
      triggerPrice: String(_rounded.stopPrice != null ? _rounded.stopPrice : stopPrice),
      quantity: String(_rounded.quantity || quantity),
      clientOrderId: req.body.newClientOrderId,
    });
    if (!_tpRes || _tpRes.ok === false) {
      return res.status(400).json({ error: _safeError(new Error((_tpRes && _tpRes.error && (_tpRes.error.message || _tpRes.error)) || 'TP rejected')) });
    }
    const data = { orderId: _tpRes.tpOrderId, status: _tpRes.status };
    const protType = type === 'STOP_MARKET' ? 'SL' : 'TP';
    logger.info('ORDER', `MANUAL ${protType} SET ${symbol} triggerPrice=${stopPrice} algoId=${data.orderId}`);
    audit.record('PROTECTION_SET', { userId: req.user.id, symbol, type: protType, stopPrice, orderId: data.orderId }, 'MANUAL', req.ip);
    res.json({
      orderId: data.orderId,
      status: data.status || data.algoStatus,
      type: data.type || data.orderType,
      stopPrice: parseFloat(data.triggerPrice || stopPrice),
      symbol: data.symbol,
      side: data.side,
    });
  } catch (err) {
    console.error('[API] manual/protection error:', err.message);
    logger.error('ORDER', 'manual/protection failed', { symbol, type, error: err.message });
    res.status(err.status || 500).json({ error: _safeError(err) });
  }
});

// ─── Add-On (Faza 2 Batch A + Batch C live) ───
router.post('/addon', async (req, res) => {
  try {
    const userId = req.user.id;
    const { seq, maxAddon, addOnSize, currentPrice } = req.body;
    if (!seq || !Number.isFinite(Number(seq))) {
      return res.status(400).json({ error: 'Missing or invalid seq' });
    }
    const serverAT = require('../services/serverAT');
    // [S2.C C4] Global PANIC halt — add-on adds size/margin/risk, is new exposure
    if (serverAT.isGlobalHaltActive()) {
      logger.warn('ORDER', `Add-on blocked — GLOBAL_HALT active uid=${userId} seq=${seq}`);
      try { audit.record('ADDON_BLOCKED_GLOBAL_HALT', { userId, seq }, 'MANUAL', req.ip); } catch (_) { /* best-effort */ }
      return res.status(423).json({ error: 'GLOBAL_HALT active — add-on blocked' });
    }
    const opts = {};
    if (maxAddon && Number.isFinite(Number(maxAddon))) opts.maxAddon = Number(maxAddon);
    // [Phase 10.7] Forward user-chosen add-on amount from AddOnModal
    if (addOnSize && Number.isFinite(Number(addOnSize)) && Number(addOnSize) > 0) {
      opts.addOnSize = Number(addOnSize);
    }
    // [Phase 10.7] Forward current price for server in-profit re-check
    if (currentPrice && Number.isFinite(Number(currentPrice)) && Number(currentPrice) > 0) {
      opts.currentPrice = Number(currentPrice);
    }
    const result = await serverAT.addOnPosition(userId, Number(seq), opts);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    console.error('[API] addon error:', err.message);
    res.status(500).json({ error: 'Add-on failed' });
  }
});

// [S12] Removed duplicate /at/toggle — already defined in server.js (without resolveExchange requirement)

// ─── Brain Vision API (Brain V2 UI) ───
router.get('/brain/vision', (req, res) => {
  try {
    const serverBrain = require('../services/serverBrain');
    res.json(serverBrain.getBrainVision());
  } catch (err) {
    console.error('[API] brain/vision error:', err.message);
    res.status(500).json({ error: 'Brain vision unavailable' });
  }
});

// ─── Brain Dashboard API (Reflection Engine UI) ───
router.get('/brain/dashboard', (req, res) => {
  try {
    const serverReflection = require('../services/serverReflection');
    res.json(serverReflection.getDashboard(req.user.id));
  } catch (err) {
    console.error('[API] brain/dashboard error:', err.message);
    res.status(500).json({ error: 'Brain dashboard unavailable' });
  }
});

// ─── [L1-DIAG] Recent AT block reasons for client feed ───
router.get('/brain/recent-blocks', (req, res) => {
  try {
    const serverBrain = require('../services/serverBrain');
    const since = parseInt(req.query.since, 10) || 0;
    const blocks = serverBrain.getRecentBlocks(req.user.id, since);
    res.json({ ok: true, ts: Date.now(), blocks });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'recent-blocks unavailable' });
  }
});

// [2026-06-19] THEIA — last brain decisions (canonical brain_decisions trail, read-only)
router.get('/brain/decisions/recent', (req, res) => {
  try {
    const serverBrain = require('../services/serverBrain');
    const limit = parseInt(req.query.limit, 10) || 12;
    const decisions = serverBrain.getRecentDecisions(req.user.id, limit);
    res.json({ ok: true, ts: Date.now(), decisions });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'recent-decisions unavailable' });
  }
});

// ─── Exit Analysis API ───
router.get('/brain/exits', (req, res) => {
  try {
    const serverExitManager = require('../services/serverExitManager');
    res.json({ regimeStats: serverExitManager.getRegimeStats(req.user.id) });
  } catch (err) {
    res.status(500).json({ error: 'Exit analysis unavailable' });
  }
});

// [Bug fix 2026-05-29] Pure stale-guard decision exposed for unit testing.
router._staleTest = { resolveStaleBlock: _resolveStaleBlock };

module.exports = router;
