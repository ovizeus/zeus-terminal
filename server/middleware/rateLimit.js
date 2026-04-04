// Zeus Terminal — Rate Limiter Middleware
// Per-user rate limiting on critical trading routes (Etapa 4B)
'use strict';

const WINDOW_MS = 60000; // 1 minute window

// Per-user limits (per minute)
const LIMITS = {
  critical: 15,   // order/place, order/cancel, order/modify, manual/protection
  trading: 60,    // balance, positions, leverage, openOrders, risk/pnl
  general: 120,   // config, status, metrics, telegram, etc.
  fallback: 10,   // no userId (IP-based) — conservative
};

// Categorized route paths (matched against req.path inside trading router)
const _CRITICAL_PATHS = new Set(['/order/place', '/order/cancel', '/order/modify', '/manual/protection']);
const _TRADING_PATHS = new Set(['/balance', '/positions', '/leverage', '/openOrders', '/risk/pnl']);

const _hits = new Map();

// Clean expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of _hits) {
    if (now - data.windowStart > WINDOW_MS) _hits.delete(key);
  }
}, 300000);

function _getCategory(path) {
  if (_CRITICAL_PATHS.has(path)) return 'critical';
  if (_TRADING_PATHS.has(path)) return 'trading';
  return 'general';
}

function rateLimit(req, res, next) {
  const userId = req.user && req.user.id;
  const baseKey = userId ? `u:${userId}` : `ip:${req.ip || req.connection.remoteAddress || 'unknown'}`;
  const category = _getCategory(req.path);
  const key = `${baseKey}:${category}`;
  const limit = userId ? LIMITS[category] : LIMITS.fallback;
  const now = Date.now();

  let data = _hits.get(key);
  if (!data || now - data.windowStart > WINDOW_MS) {
    data = { windowStart: now, count: 0 };
    _hits.set(key, data);
  }

  data.count++;
  const remaining = Math.max(0, limit - data.count);
  const resetTime = Math.ceil((data.windowStart + WINDOW_MS) / 1000);

  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', resetTime);

  if (data.count > limit) {
    const retryAfter = Math.ceil((data.windowStart + WINDOW_MS - now) / 1000);
    res.setHeader('Retry-After', retryAfter);
    return res.status(429).json({
      error: `Rate limit exceeded (${category}). Max ${limit} requests per minute. Retry after ${retryAfter}s.`,
    });
  }

  next();
}

// ─── Standalone per-user limiter for AT routes (outside trading router) ───
const _AT_LIMIT = 10; // AT close/control actions per minute per user
const _atHits = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, data] of _atHits) {
    if (now - data.windowStart > WINDOW_MS) _atHits.delete(key);
  }
}, 300000);

function atCriticalLimit(req, res, next) {
  if (!req.user || !req.user.id) return next(); // let auth middleware handle
  const key = `at:${req.user.id}`;
  const now = Date.now();

  let data = _atHits.get(key);
  if (!data || now - data.windowStart > WINDOW_MS) {
    data = { windowStart: now, count: 0 };
    _atHits.set(key, data);
  }

  data.count++;
  if (data.count > _AT_LIMIT) {
    const retryAfter = Math.ceil((data.windowStart + WINDOW_MS - now) / 1000);
    return res.status(429).json({
      error: `Rate limit exceeded (AT action). Max ${_AT_LIMIT} per minute. Retry after ${retryAfter}s.`,
    });
  }

  next();
}

// ─── Global API limiter (per-IP, covers all /api/ routes) ───
const _GLOBAL_LIMIT = 600; // per minute per IP — raised for React bridge (old JS + React both make API calls at boot)
const _globalHits = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, data] of _globalHits) {
    if (now - data.windowStart > WINDOW_MS) _globalHits.delete(key);
  }
}, 300000);

function globalApiLimit(req, res, next) {
  const key = req.user && req.user.id ? `g:u:${req.user.id}` : `g:ip:${req.ip || 'unknown'}`;
  const now = Date.now();

  let data = _globalHits.get(key);
  if (!data || now - data.windowStart > WINDOW_MS) {
    data = { windowStart: now, count: 0 };
    _globalHits.set(key, data);
  }

  data.count++;
  if (data.count > _GLOBAL_LIMIT) {
    const retryAfter = Math.ceil((data.windowStart + WINDOW_MS - now) / 1000);
    res.setHeader('Retry-After', retryAfter);
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }

  next();
}

rateLimit.atCriticalLimit = atCriticalLimit;
rateLimit.globalApiLimit = globalApiLimit;
module.exports = rateLimit;
