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

// ─── GET /api/metrics ── Server health dashboard (read-only) ───
router.get('/metrics', (req, res) => {
  res.json(metrics.getMetrics());
});

// ─── GET /api/audit ── Last N audit entries (read-only) ───
router.get('/audit', (req, res) => {
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
    res.status(err.status || 500).json({ error: err.message });
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
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/order/place ───
router.post('/order/place', validateOrderBody, async (req, res) => {
  if (!config.tradingEnabled) {
    return res.status(403).json({ error: 'Trading disabled' });
  }
  const { symbol, side, type, quantity, price, leverage, stopPrice, newClientOrderId, closePosition } = req.body;

  // Server-side risk check
  const owner = _owner(req.body);
  const risk = validateOrder({ symbol, side, type, quantity, price: price || 0, referencePrice: req.body.referencePrice || 0, leverage: leverage || 1 }, owner);
  if (!risk.ok) {
    console.warn('[RISK] Order blocked:', risk.reason);
    logger.warn('RISK', 'Order blocked: ' + risk.reason, { symbol, side, owner });
    audit.record('ORDER_BLOCKED', { symbol, side, type, quantity, reason: risk.reason }, owner, req.ip);
    metrics.recordOrder('blocked');
    telegram.alertRiskBlock(risk.reason, owner);
    return res.status(403).json({ error: risk.reason });
  }

  try {
    // Set leverage first if provided
    if (leverage) {
      try {
        await sendSignedRequest('POST', '/fapi/v1/leverage', { symbol, leverage }, req.exchangeCreds);
      } catch (levErr) {
        console.error('[API] leverage set failed:', levErr.message);
        return res.status(500).json({ error: 'Failed to set leverage: ' + levErr.message });
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
      params.reduceOnly = 'true'; // SL/TP are always reduce-only (close exposure, never open new)
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

    console.log(`[ORDER] ${side} ${quantity} ${symbol} @ ${type} → orderId: ${data.orderId}`);
    logger.info('ORDER', `${side} ${quantity} ${symbol} @ ${type}`, { orderId: data.orderId, avgPrice: data.avgPrice, executedQty: data.executedQty });
    audit.record('ORDER_FILLED', { symbol, side, type, quantity, orderId: data.orderId, avgPrice: data.avgPrice, executedQty: data.executedQty }, owner, req.ip);
    metrics.recordOrder('filled');
    telegram.alertOrderFilled(symbol, side, data.executedQty || quantity, data.avgPrice || 0, data.orderId);
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
    console.error('[API] order/place error:', err.message);
    logger.error('ORDER', 'order/place failed', { symbol, side, error: err.message });
    audit.record('ORDER_FAILED', { symbol, side, type, quantity, error: err.message }, owner, req.ip);
    metrics.recordOrder('failed');
    metrics.recordError(err.message);
    telegram.alertOrderFailed(symbol, side, err.message);
    res.status(err.status || 500).json({ error: err.message });
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
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/risk/pnl ─── Report a closed trade's PnL for daily loss tracking
router.post('/risk/pnl', (req, res) => {
  const pnl = parseFloat(req.body.pnl);
  if (isNaN(pnl)) return res.status(400).json({ error: 'pnl must be a number' });
  const owner = (req.body.owner === 'ARES') ? 'ARES' : 'AT';
  recordClosedPnL(pnl, owner);
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
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── GET /api/config ─── Read current risk config ───
router.get('/config', (req, res) => {
  res.json({
    risk: { ...config.risk },
    tradingEnabled: config.tradingEnabled,
  });
});

// ─── POST /api/config/telegram ─── Update Telegram credentials at runtime ───
router.post('/config/telegram', (req, res) => {
  const { botToken, chatId } = req.body;
  if (!botToken || !chatId) {
    return res.status(400).json({ error: 'botToken and chatId are required' });
  }
  config.telegram.botToken = String(botToken).trim();
  config.telegram.chatId = String(chatId).trim();
  audit.record('TELEGRAM_CONFIG', { chatId: config.telegram.chatId }, 'user', req.ip);
  logger.info('CONFIG', 'Telegram credentials updated via UI');
  res.json({ ok: true });
});

// ─── POST /api/config/telegram/test ─── Send a test message ───
router.post('/config/telegram/test', async (req, res) => {
  const telegram = require('../services/telegram');
  const ok = await telegram.send('✅ *Zeus Terminal* — Test alert received!\nServer time: ' + new Date().toISOString());
  res.json({ ok });
});

// ─── POST /api/config ─── Hot-reload risk limits (no restart required) ───
router.post('/config', (req, res) => {
  const { maxLeverage, maxPositionUsdt, dailyLossLimitPct } = req.body;
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
  audit.record('CONFIG_CHANGED', { changes, newConfig: config.risk }, 'user', req.ip);
  logger.info('CONFIG', 'Risk config updated: ' + changes.join(', '));
  res.json({ ok: true, changes, risk: config.risk });
});

module.exports = router;
