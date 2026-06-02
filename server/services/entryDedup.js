'use strict';
const _last = new Map();
const _key = (u, s) => `${u}:${s}`;
function shouldBlockOpen(userId, symbol, now, windowMs) {
  const t = _last.get(_key(userId, symbol));
  return t != null && (now - t) < windowMs;
}
function markOpened(userId, symbol, now) { _last.set(_key(userId, symbol), now); }
function _reset() { _last.clear(); }
module.exports = { shouldBlockOpen, markOpened, _reset };
