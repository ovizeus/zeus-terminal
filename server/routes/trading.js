// Zeus Terminal — Trading API Routes
// Proxy endpoints for Binance Futures with server-side signing + risk guards
// Per-user: each request uses authenticated user's exchange credentials
'use strict';

const express = require('express');
const router = express.Router();
const config = require('../config');
const { sendSignedRequest } = require('../services/binanceSigner');
const { validateOrder, recordClosedPnL } = require('../services/riskGuard');
const { roundOrderParams } = require('../services/exchangeInfo');
const { validateOrderBody, validateCancelBody, validateLeverageBody } = require('../middleware/validate');
const resolveExchange = require('../middleware/resolveExchange');
const telegram = require('../services/telegram');
const logger = require('../services/logger');
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
  _idempotencyCache.set(fullKey, Date.now());
  return null;
}

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

// ─── GET /api/audit ── Last N audit entries (admin only) ───
router.get('/audit', (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const count = Math.min(parseInt(req.query.count, 10) || 50, 200);
  res.json(audit.readLast(count));
});

// ─── GET /api/balance ───
router.get('/balance', async (req, res) => {
  if (!config.tradingEnabled) {
    return res.status(403).json({ error: 'Trading disabled' });
  }
  try {
    const data = await sendSignedRequest('GET', '/fapi/v2/balance', {}, req.exchangeCreds);
    const usdt = data.find(a => a.asset === 'USDT') || {};
    res.json({
      totalBalance: parseFloat(usdt.balance || 0),
      availableBalance: parseFloat(usdt.availableBalance || 0),
      unrealizedPnL: parseFloat(usdt.crossUnPnl || 0),
    });
  } catch (err) {
    console.error('[API] balance error:', err.message);
    logger.error('API', 'balance error', { error: err.message });
    res.status(err.status || 500).json({ error: _safeError(err) });
  }
});

// ─── GET /api/positions ───
router.get('/positions', async (req, res) => {
  if (!config.tradingEnabled) {
    return res.status(403).json({ error: 'Trading disabled' });
  }
  try {
    const data = await sendSignedRequest('GET', '/fapi/v2/positionRisk', {}, req.exchangeCreds);
    const active = data
      .filter(p => parseFloat(p.positionAmt) !== 0)
      .map(p => ({
        symbol: p.symbol,
        side: parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT',
        size: Math.abs(parseFloat(p.positionAmt)),
        entryPrice: parseFloat(p.entryPrice),
        unrealizedPnL: parseFloat(p.unRealizedProfit),
        leverage: parseInt(p.leverage, 10),
        liquidationPrice: parseFloat(p.liquidationPrice),
      }));
    res.json(active);
  } catch (err) {
    console.error('[API] positions error:', err.message);
    logger.error('API', 'positions error', { error: err.message });
    res.status(err.status || 500).json({ error: _safeError(err) });
  }
});

// ─── POST /api/order/place ───
router.post('/order/place', validateOrderBody, async (req, res) => {
  // Idempotency check — reject missing key or duplicate submissions
  const idem = _checkIdempotency(req);
  if (idem && idem.reject) {
    return res.status(400).json({ error: idem.reason });
  }
  if (idem && idem.duplicate) {
    return res.status(409).json({ error: 'Duplicate order — already processing (key: ' + req.headers['x-idempotency-key'] + ')' });
  }
  // [BE-01] Compute idempotency key early for cleanup on all confirmed-failure paths
  const _idemKey = req.user && req.headers['x-idempotency-key'] ? `${req.user.id}:${req.headers['x-idempotency-key']}` : null;
  if (!config.tradingEnabled) {
    if (_idemKey) _idempotencyCache.delete(_idemKey); // [BE-01] Release key — trading disabled
    return res.status(403).json({ error: 'Trading disabled' });
  }
  const { symbol, side, type, quantity, price, leverage, stopPrice, newClientOrderId, closePosition } = req.body;

  // Server-side risk check
  const owner = _owner(req.body);
  const risk = validateOrder({ symbol, side, type, quantity, price: price || 0, referencePrice: req.body.referencePrice || 0, leverage: leverage || 1 }, owner, req.user.id);
  if (!risk.ok) {
    if (_idemKey) _idempotencyCache.delete(_idemKey); // [BE-01] Release key — order was never sent to exchange
    console.warn('[RISK] Order blocked:', risk.reason);
    logger.warn('RISK', 'Order blocked: ' + risk.reason, { symbol, side, owner });
    audit.record('ORDER_BLOCKED', { symbol, side, type, quantity, reason: risk.reason }, owner, req.ip);
    metrics.recordOrder('blocked');
    telegram.alertRiskBlock(risk.reason, owner, req.user.id);
    return res.status(403).json({ error: risk.reason });
  }

  try {
    // Set leverage first if provided
    if (leverage) {
      try {
        await sendSignedRequest('POST', '/fapi/v1/leverage', { symbol, leverage }, req.exchangeCreds);
      } catch (levErr) {
        console.error('[API] leverage set failed:', levErr.message);
        if (_idemKey) _idempotencyCache.delete(_idemKey); // [BE-01] order never reached exchange
        return res.status(500).json({ error: 'Failed to set leverage: ' + _safeError(levErr) });
      }
    }

    // Place the order
    const params = { symbol, side, type: type || 'MARKET' };
    // Round quantity + stopPrice to exchange LOT_SIZE / PRICE_FILTER
    const _rounded = roundOrderParams(symbol, parseFloat(quantity), stopPrice ? parseFloat(stopPrice) : undefined);
    params.quantity = String(_rounded.quantity || quantity);
    if (type === 'LIMIT' && price) {
      params.price = String(price);
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
    // Reduce-only for close orders
    if (closePosition === true && type === 'MARKET') {
      params.reduceOnly = true;
    }
    const data = await sendSignedRequest('POST', '/fapi/v1/order', params, req.exchangeCreds);

    // [ZT-AUD-002] Log actual status instead of assuming FILLED
    const fillStatus = data.status || 'UNKNOWN';
    console.log(`[ORDER] ${side} ${quantity} ${symbol} @ ${type} → orderId: ${data.orderId} status: ${fillStatus}`);
    logger.info('ORDER', `${side} ${quantity} ${symbol} @ ${type}`, { orderId: data.orderId, status: fillStatus, avgPrice: data.avgPrice, executedQty: data.executedQty });
    audit.record(fillStatus === 'FILLED' ? 'ORDER_FILLED' : 'ORDER_PLACED', { symbol, side, type, quantity, orderId: data.orderId, status: fillStatus, avgPrice: data.avgPrice, executedQty: data.executedQty }, owner, req.ip);
    metrics.recordOrder(fillStatus === 'FILLED' ? 'filled' : 'placed');
    if (fillStatus === 'FILLED') {
      telegram.alertOrderFilled(symbol, side, data.executedQty || quantity, data.avgPrice || 0, data.orderId, req.user.id);
    }
    res.json({
      orderId: data.orderId,
      status: data.status,
      avgPrice: parseFloat(data.avgPrice || 0),
      executedQty: parseFloat(data.executedQty || 0),
      symbol: data.symbol,
      side: data.side,
      type: data.type,
    });
  } catch (err) {
    // [BE-01] Release idempotency key only if order confirmed NOT executed (4xx = Binance rejected)
    // Do NOT release on 5xx/timeout — order status is ambiguous, keeping key prevents duplicate
    if (_idemKey && err.status && err.status >= 400 && err.status < 500) {
      _idempotencyCache.delete(_idemKey);
    }
    console.error('[API] order/place error:', err.message);
    logger.error('ORDER', 'order/place failed', { symbol, side, error: err.message });
    audit.record('ORDER_FAILED', { symbol, side, type, quantity, error: err.message }, owner, req.ip);
    metrics.recordOrder('failed');
    metrics.recordError(err.message);
    telegram.alertOrderFailed(symbol, side, err.message, req.user.id);
    res.status(err.status || 500).json({ error: _safeError(err) });
  }
});

// ─── POST /api/order/cancel ───
router.post('/order/cancel', validateCancelBody, async (req, res) => {
  if (!config.tradingEnabled) {
    return res.status(403).json({ error: 'Trading disabled' });
  }
  try {
    const data = await sendSignedRequest('DELETE', '/fapi/v1/order', {
      symbol: req.body.symbol,
      orderId: req.body.orderId,
    }, req.exchangeCreds);
    res.json({ orderId: data.orderId, status: data.status });
  } catch (err) {
    console.error('[API] order/cancel error:', err.message);
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
    const data = await sendSignedRequest('POST', '/fapi/v1/leverage', {
      symbol: req.body.symbol,
      leverage: req.body.leverage,
    }, req.exchangeCreds);
    res.json({ leverage: data.leverage, maxNotionalValue: data.maxNotionalValue });
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
    const data = await sendSignedRequest('GET', '/fapi/v1/openOrders', params, req.exchangeCreds);
    // Return relevant fields only
    const orders = (Array.isArray(data) ? data : []).map(o => ({
      orderId: o.orderId,
      symbol: o.symbol,
      side: o.side,
      type: o.type,
      status: o.status,
      price: parseFloat(o.price || 0),
      stopPrice: parseFloat(o.stopPrice || 0),
      origQty: parseFloat(o.origQty || 0),
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
  const { symbol, orderId, newPrice, newQuantity } = req.body;
  const np = parseFloat(newPrice);
  if (!newPrice || isNaN(np) || np <= 0) {
    return res.status(400).json({ error: 'Invalid newPrice' });
  }
  try {
    // Step 1: Cancel existing order
    const cancelData = await sendSignedRequest('DELETE', '/fapi/v1/order', {
      symbol, orderId,
    }, req.exchangeCreds);
    // Step 2: Re-place with new price
    const side = cancelData.side || req.body.side;
    const qty = newQuantity ? parseFloat(newQuantity) : parseFloat(cancelData.origQty);
    const _rounded = roundOrderParams(symbol, qty);
    const placeParams = {
      symbol,
      side,
      type: 'LIMIT',
      quantity: String(_rounded.quantity || qty),
      price: String(np),
      timeInForce: 'GTC',
    };
    if (req.body.newClientOrderId) placeParams.newClientOrderId = req.body.newClientOrderId;
    const placeData = await sendSignedRequest('POST', '/fapi/v1/order', placeParams, req.exchangeCreds);
    logger.info('ORDER', `MODIFY LIMIT ${symbol} old=${orderId} new=${placeData.orderId} price=${np}`);
    audit.record('ORDER_MODIFIED', { symbol, oldOrderId: orderId, newOrderId: placeData.orderId, newPrice: np }, 'MANUAL', req.ip);
    res.json({
      cancelledOrderId: cancelData.orderId,
      orderId: placeData.orderId,
      status: placeData.status,
      price: np,
      symbol: placeData.symbol,
      side: placeData.side,
      origQty: parseFloat(placeData.origQty || qty),
    });
  } catch (err) {
    console.error('[API] order/modify error:', err.message);
    logger.error('ORDER', 'order/modify failed', { symbol, orderId, error: err.message });
    res.status(err.status || 500).json({ error: _safeError(err) });
  }
});

// ─── POST /api/manual/protection ── Set or update SL/TP for a manual live position ───
// Handles cancel-old + place-new atomically. Type: 'STOP_MARKET' or 'TAKE_PROFIT_MARKET'
router.post('/manual/protection', validateOrderBody, async (req, res) => {
  if (!config.tradingEnabled) {
    return res.status(403).json({ error: 'Trading disabled' });
  }
  const { symbol, side, type, quantity, stopPrice, cancelOrderId } = req.body;
  try {
    // Cancel existing protection order if provided
    if (cancelOrderId) {
      try {
        await sendSignedRequest('DELETE', '/fapi/v1/order', {
          symbol, orderId: String(cancelOrderId),
        }, req.exchangeCreds);
        logger.info('ORDER', `Cancelled old protection ${cancelOrderId} for ${symbol}`);
      } catch (cancelErr) {
        // If cancel fails with "Unknown order" it was already filled/cancelled — safe to continue
        if (cancelErr.message && (cancelErr.message.includes('Unknown order') || cancelErr.message.includes('UNKNOWN_ORDER'))) {
          logger.warn('ORDER', `Old protection ${cancelOrderId} already gone — continuing`);
        } else {
          throw cancelErr;
        }
      }
    }
    // Place new protection order
    const _rounded = roundOrderParams(symbol, parseFloat(quantity), parseFloat(stopPrice));
    const params = {
      symbol,
      side,
      type,
      quantity: String(_rounded.quantity || quantity),
      stopPrice: String(_rounded.stopPrice != null ? _rounded.stopPrice : stopPrice),
      reduceOnly: true,
    };
    if (req.body.newClientOrderId) params.newClientOrderId = req.body.newClientOrderId;
    const data = await sendSignedRequest('POST', '/fapi/v1/order', params, req.exchangeCreds);
    const protType = type === 'STOP_MARKET' ? 'SL' : 'TP';
    logger.info('ORDER', `MANUAL ${protType} SET ${symbol} stopPrice=${stopPrice} orderId=${data.orderId}`);
    audit.record('PROTECTION_SET', { symbol, type: protType, stopPrice, orderId: data.orderId }, 'MANUAL', req.ip);
    res.json({
      orderId: data.orderId,
      status: data.status,
      type: data.type,
      stopPrice: parseFloat(data.stopPrice || stopPrice),
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
    const { seq, maxAddon } = req.body;
    if (!seq || !Number.isFinite(Number(seq))) {
      return res.status(400).json({ error: 'Missing or invalid seq' });
    }
    const serverAT = require('../services/serverAT');
    const opts = {};
    if (maxAddon && Number.isFinite(Number(maxAddon))) opts.maxAddon = Number(maxAddon);
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

// ─── [F1] Per-user AT on/off toggle ───
router.post('/at/toggle', (req, res) => {
  try {
    const userId = req.user.id;
    const { active } = req.body;
    if (typeof active !== 'boolean') {
      return res.status(400).json({ error: 'active must be boolean (true/false)' });
    }
    const serverAT = require('../services/serverAT');
    const result = serverAT.toggleActive(userId, active);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[API] at/toggle error:', err.message);
    res.status(500).json({ error: 'Toggle failed' });
  }
});

module.exports = router;
