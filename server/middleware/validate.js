// Zeus Terminal — Input Validation Middleware
// Sanitizes and validates order parameters
'use strict';

const VALID_SIDES = new Set(['BUY', 'SELL']);
const VALID_TYPES = new Set(['MARKET', 'LIMIT', 'STOP_MARKET', 'TAKE_PROFIT_MARKET']);
const SYMBOL_RE = /^[A-Z0-9]{2,20}$/;

function validateOrderBody(req, res, next) {
  const { symbol, side, type, quantity, leverage, stopPrice, newClientOrderId } = req.body;

  if (!symbol || !SYMBOL_RE.test(String(symbol).toUpperCase())) {
    return res.status(400).json({ error: 'Invalid symbol' });
  }
  if (!VALID_SIDES.has(String(side).toUpperCase())) {
    return res.status(400).json({ error: 'Invalid side (BUY or SELL)' });
  }
  if (type != null && !VALID_TYPES.has(String(type).toUpperCase())) {
    return res.status(400).json({ error: 'Invalid order type' });
  }
  const qty = parseFloat(quantity);
  if (!quantity || isNaN(qty) || qty <= 0) {
    return res.status(400).json({ error: 'Invalid quantity' });
  }
  if (leverage !== undefined) {
    const lev = parseInt(leverage, 10);
    if (isNaN(lev) || lev < 1 || lev > 125) {
      return res.status(400).json({ error: 'Invalid leverage (1-125)' });
    }
  }
  // stopPrice required for STOP_MARKET / TAKE_PROFIT_MARKET
  const normType = type ? String(type).toUpperCase() : 'MARKET';
  // [FIX QA-H12] Validate price for LIMIT orders
  if (normType === 'LIMIT') {
    const { price } = req.body;
    const p = parseFloat(price);
    if (price === undefined || price === null || isNaN(p) || p <= 0) {
      return res.status(400).json({ error: 'Invalid or missing price for LIMIT order' });
    }
    req.body.price = p;
  }
  if (normType === 'STOP_MARKET' || normType === 'TAKE_PROFIT_MARKET') {
    if (stopPrice === undefined || stopPrice === null) {
      return res.status(400).json({ error: 'stopPrice required for ' + normType });
    }
    const sp = parseFloat(stopPrice);
    if (isNaN(sp) || sp <= 0) {
      return res.status(400).json({ error: 'Invalid stopPrice' });
    }
    req.body.stopPrice = sp;
  }
  // newClientOrderId — alphanumeric + underscore, max 36 chars (Binance limit)
  if (newClientOrderId !== undefined) {
    const cid = String(newClientOrderId);
    if (!/^[A-Za-z0-9_]{1,36}$/.test(cid)) {
      return res.status(400).json({ error: 'Invalid newClientOrderId' });
    }
    req.body.newClientOrderId = cid;
  }

  // Normalize values
  req.body.symbol = String(symbol).toUpperCase();
  req.body.side = String(side).toUpperCase();
  req.body.type = normType;
  req.body.quantity = qty;
  if (leverage !== undefined) req.body.leverage = parseInt(leverage, 10);

  next();
}

function validateCancelBody(req, res, next) {
  const { symbol, orderId } = req.body;
  if (!symbol || !SYMBOL_RE.test(String(symbol).toUpperCase())) {
    return res.status(400).json({ error: 'Invalid symbol' });
  }
  if (!orderId) {
    return res.status(400).json({ error: 'Missing orderId' });
  }
  const oid = String(orderId);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(oid) && isNaN(Number(orderId))) {
    return res.status(400).json({ error: 'Invalid orderId format' });
  }
  req.body.orderId = oid;
  req.body.symbol = String(symbol).toUpperCase();
  next();
}

function validateLeverageBody(req, res, next) {
  const { symbol, leverage } = req.body;
  if (!symbol || !SYMBOL_RE.test(String(symbol).toUpperCase())) {
    return res.status(400).json({ error: 'Invalid symbol' });
  }
  const lev = parseInt(leverage, 10);
  if (isNaN(lev) || lev < 1 || lev > 125) {
    return res.status(400).json({ error: 'Invalid leverage (1-125)' });
  }
  req.body.symbol = String(symbol).toUpperCase();
  req.body.leverage = lev;
  next();
}

// [MIGRATION-F1 commit 4] Settings body validator — LOG-ONLY (soft mode).
// Mirrors the client-side SettingsPayload contract (see
// client/src/types/settings-contracts.ts) and the whitelist in
// routes/trading.js. Any shape/type mismatch is logged with a
// "[validate][settings]" prefix; the request is ALWAYS forwarded to the
// handler via next(). This commit intentionally does NOT introduce new
// 400 responses — tightening to strict reject is planned for a later
// phase after soft-mode logs confirm the contract matches real traffic.
const SETTINGS_SHAPE = {
  // numbers
  confMin: 'number', sigMin: 'number', size: 'number', riskPct: 'number',
  maxDay: 'number', maxPos: 'number', sl: 'number', rr: 'number',
  killPct: 'number', lossStreak: 'number', maxAddon: 'number', lev: 'number',
  uiScale: 'number', timezoneOffset: 'number',
  ptLevDemo: 'number', ptLevLive: 'number',
  // booleans
  adaptEnabled: 'boolean', adaptLive: 'boolean', smartExitEnabled: 'boolean',
  mscanEnabled: 'boolean', soundEnabled: 'boolean', assistArmed: 'boolean',
  // strings
  theme: 'string', chartTf: 'string', chartTz: 'string', chartType: 'string',
  profile: 'string', bmMode: 'string', ptMarginMode: 'string',
  // arrays
  mscanSyms: 'array',
  // objects (nested blobs — null also acceptable)
  candleColors: 'object', heatmapSettings: 'object',
  indSettings: 'object', liqSettings: 'object', llvSettings: 'object',
  zsSettings: 'object', srSettings: 'object', alertSettings: 'object',
  manualLive: 'object', dslSettings: 'object',
};

function validateSettingsBody(req, res, next) {
  try {
    const raw = req.body && req.body.settings;
    if (raw === undefined || raw === null) {
      console.warn('[validate][settings] log-only: missing settings object');
      return next();
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      console.warn('[validate][settings] log-only: settings is not a plain object, got', Array.isArray(raw) ? 'array' : typeof raw);
      return next();
    }
    const unknownKeys = [];
    const badTypes = [];
    for (const key of Object.keys(raw)) {
      const expected = SETTINGS_SHAPE[key];
      if (!expected) { unknownKeys.push(key); continue; }
      const value = raw[key];
      if (value === null) continue; // null accepted for any whitelisted key
      const actual = Array.isArray(value) ? 'array' : typeof value;
      if (actual !== expected) badTypes.push({ key, expected, actual });
    }
    if (unknownKeys.length > 0) {
      console.warn('[validate][settings] log-only: unknown keys (server will whitelist-strip):', unknownKeys.join(','));
    }
    if (badTypes.length > 0) {
      console.warn('[validate][settings] log-only: type mismatches:', JSON.stringify(badTypes));
    }
  } catch (err) {
    console.warn('[validate][settings] log-only: middleware error, passing through:', err && err.message);
  }
  return next();
}

module.exports = { validateOrderBody, validateCancelBody, validateLeverageBody, validateSettingsBody };
