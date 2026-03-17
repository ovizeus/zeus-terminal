// Zeus Terminal — Rate Limiter Middleware
// Simple in-memory rate limiting per IP
'use strict';

const MAX_REQUESTS = 10;    // max requests per window (general API)
const MAX_TRADING = 30;    // [FIX R2] higher limit for trading routes (order + SL + TP + close cycles)
const WINDOW_MS = 60000;   // 1 minute window

const _hits = new Map();

// Clean expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of _hits) {
    if (now - data.windowStart > WINDOW_MS) _hits.delete(ip);
  }
}, 300000);

// [FIX R2] Trading-critical paths get higher limit so live cycle (lev+order+SL+TP+close) is never blocked
const _TRADING_PATHS = new Set(['/order/place', '/order/cancel', '/leverage', '/balance', '/positions']);

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  let data = _hits.get(ip);

  if (!data || now - data.windowStart > WINDOW_MS) {
    data = { windowStart: now, count: 0, tradeCount: 0 };
    _hits.set(ip, data);
  }

  const isTradingRoute = _TRADING_PATHS.has(req.path);
  if (isTradingRoute) {
    data.tradeCount++;
    if (data.tradeCount > MAX_TRADING) {
      return res.status(429).json({
        error: 'Trading rate limit exceeded. Max ' + MAX_TRADING + ' requests per minute.',
      });
    }
  } else {
    data.count++;
    if (data.count > MAX_REQUESTS) {
      return res.status(429).json({
        error: 'Rate limit exceeded. Max ' + MAX_REQUESTS + ' requests per minute.',
      });
    }
  }

  next();
}

module.exports = rateLimit;
