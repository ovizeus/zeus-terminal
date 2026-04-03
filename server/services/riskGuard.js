// Zeus Terminal — Server-Side Risk Guard
// Validates orders against risk limits BEFORE they reach the exchange
// AT and ARES have independent daily loss trackers — per user, no cross-veto
'use strict';

const Sentry = require('@sentry/node');
const config = require('../config');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const telegram = require('./telegram');
const audit = require('./audit'); // [OB-01]

// ── Persistence via SQLite at_state (unified with rest of DB) ──
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const RISK_STATE_FILE = path.join(DATA_DIR, 'riskState.json'); // legacy — migrated to SQLite

// Per-user state: { "<userId>": { atDaily, aresDaily, emergencyKill } }
let _users = {};

function _saveToDisk() {
  try {
    const db = require('./database');
    for (const uid of Object.keys(_users)) {
      db.atSetState('risk:' + uid, _users[uid], parseInt(uid, 10) || null);
    }
  } catch (err) {
    console.error('[RISK] Failed to persist state:', err.message);
    Sentry.captureException(err, { tags: { module: 'riskGuard', action: 'persist_state' } });
  }
}

function _loadFromDisk() {
  try {
    const db = require('./database');
    // Try SQLite first
    const rows = db.db.prepare("SELECT key, value FROM at_state WHERE key LIKE 'risk:%'").all();
    let fromDb = 0;
    for (const row of rows) {
      const m = /^risk:(\d+)$/.exec(row.key);
      if (!m) continue;
      try {
        const u = JSON.parse(row.value);
        if (u && u.atDaily) { _users[m[1]] = u; fromDb++; }
      } catch (_) {}
    }
    if (fromDb > 0) {
      for (const uid of Object.keys(_users)) {
        const u = _users[uid];
        console.log(`[RISK] User ${uid} — AT PnL: $${(u.atDaily.realizedPnL || 0).toFixed(2)}, ARES PnL: $${(u.aresDaily.realizedPnL || 0).toFixed(2)}, Kill: ${u.emergencyKill}`);
      }
      return;
    }
    // Fallback: migrate from legacy JSON file
    if (!fs.existsSync(RISK_STATE_FILE)) return;
    const raw = fs.readFileSync(RISK_STATE_FILE, 'utf8');
    const state = JSON.parse(raw);
    if (state.atDaily && !state['1']) {
      _users['1'] = { atDaily: state.atDaily, aresDaily: state.aresDaily || _makeTracker(), emergencyKill: !!state.emergencyKill };
      console.log('[RISK] Migrated global riskState → per-user (userId=1)');
    } else {
      for (const uid of Object.keys(state)) {
        const u = state[uid];
        if (u && u.atDaily) _users[uid] = u;
      }
    }
    // Persist migrated data to SQLite
    _saveToDisk();
    // Rename legacy file
    try { fs.renameSync(RISK_STATE_FILE, RISK_STATE_FILE + '.migrated'); } catch (_) {}
    console.log('[RISK] Migrated riskState.json → SQLite');
    for (const uid of Object.keys(_users)) {
      const u = _users[uid];
      console.log(`[RISK] User ${uid} — AT PnL: $${(u.atDaily.realizedPnL || 0).toFixed(2)}, ARES PnL: $${(u.aresDaily.realizedPnL || 0).toFixed(2)}, Kill: ${u.emergencyKill}`);
    }
  } catch (err) {
    console.warn('[RISK] Failed to load persisted state:', err.message);
  }
}

// ── Per-user state helpers ──
function _makeTracker() {
  return { date: new Date().toISOString().slice(0, 10), realizedPnL: 0 };
}

// [AUDIT] Per-user daily loss TG dedupe — one alert per user per owner per day
const _dailyLossAlerted = {};  // { "userId:owner:date" → true }
// [BUGFIX] Cleanup stale daily alert keys (keep only today)
setInterval(() => {
  const today = new Date().toISOString().slice(0, 10);
  for (const k of Object.keys(_dailyLossAlerted)) {
    if (!k.endsWith(today)) delete _dailyLossAlerted[k];
  }
}, 3600000); // hourly

function _getUserState(userId) {
  // [RM-05] Defensive: return safe default instead of throwing — prevents caller crash
  if (!userId) {
    console.error('[RISK] _getUserState called without userId — returning safe default');
    return { atDaily: _makeTracker(), aresDaily: _makeTracker(), emergencyKill: true }; // [RM-05] kill=true blocks orders for safety
  }
  const key = String(userId);
  if (!_users[key]) {
    _users[key] = { atDaily: _makeTracker(), aresDaily: _makeTracker(), emergencyKill: false };
  }
  return _users[key];
}

// Load persisted state on module init
_loadFromDisk();

function _resetIfNewDay(tracker) {
  const today = new Date().toISOString().slice(0, 10);
  if (tracker.date !== today) {
    tracker.date = today;
    tracker.realizedPnL = 0;
  }
  return tracker;
}

/**
 * Record a closed trade's PnL for daily loss tracking.
 * @param {number} pnl
 * @param {string} owner — 'ARES' or 'AT' (default: 'AT')
 * @param {number|string} [userId=1]
 */
function recordClosedPnL(pnl, owner, userId) {
  const safePnl = Number(pnl);
  if (!Number.isFinite(safePnl)) {
    logger.warn('RISK', 'recordClosedPnL rejected invalid pnl=' + pnl + ' owner=' + owner + ' uid=' + userId);
    return;
  }
  const state = _getUserState(userId);
  const tracker = (owner === 'ARES') ? _resetIfNewDay(state.aresDaily) : _resetIfNewDay(state.atDaily);
  tracker.realizedPnL += safePnl;
  _saveToDisk();
}

/**
 * Activate or deactivate the emergency kill switch for a user.
 */
function setEmergencyKill(active, userId) {
  const state = _getUserState(userId);
  state.emergencyKill = !!active;
  _saveToDisk();
  try { telegram.alertKillSwitch(state.emergencyKill, userId); } catch (_) {}
  if (state.emergencyKill) {
    console.warn('[RISK] EMERGENCY KILL activated — all orders blocked for user ' + userId);
    Sentry.captureMessage('Emergency kill switch activated', { level: 'warning', tags: { module: 'riskGuard' }, user: { id: String(userId) } });
  }
}

/**
 * Validate an order against all risk limits.
 * @param {object} order — { symbol, side, type, quantity, price, leverage }
 * @param {string} owner — 'ARES' or 'AT' (default: 'AT')
 * @param {number|string} [userId=1]
 * Returns { ok: true } or { ok: false, reason: string }.
 */
// [OB-01] Log blocked orders to audit trail for observability
function _logBlock(order, owner, userId, reason) {
  try {
    audit.record('ORDER_BLOCKED', { symbol: order.symbol, side: order.side, type: order.type, owner: owner, userId: userId, reason: reason }, owner || 'system');
  } catch (_) { /* audit is best-effort */ }
}

function validateOrder(order, owner, userId) {
  const state = _getUserState(userId);

  // Global emergency kill
  if (state.emergencyKill) {
    const r = 'Emergency kill switch active — all trading blocked';
    _logBlock(order, owner, userId, r); // [OB-01]
    return { ok: false, reason: r };
  }

  // Master kill switch
  if (!config.tradingEnabled) {
    const r = 'Trading is disabled (TRADING_ENABLED=false)';
    _logBlock(order, owner, userId, r); // [OB-01]
    return { ok: false, reason: r };
  }

  // [CLOSE-FIX] Close/reduce-only orders do not create new exposure — skip entry-style validation
  const _isClose = !!(order.reduceOnly || order.closePosition);
  if (!_isClose) {
    // Leverage check (entry orders only)
    const lev = parseInt(order.leverage, 10);
    if (!Number.isFinite(lev) || lev < 1) {
      const r = 'Invalid or missing leverage';
      _logBlock(order, owner, userId, r); // [OB-01]
      return { ok: false, reason: r };
    }
    if (lev > config.risk.maxLeverage) {
      const r = `Leverage ${lev}x exceeds max ${config.risk.maxLeverage}x`;
      _logBlock(order, owner, userId, r); // [OB-01]
      return { ok: false, reason: r };
    }

    // Position size check (entry orders only)
    const orderType = String(order.type || 'MARKET').toUpperCase();
    if (orderType === 'LIMIT' || orderType === 'MARKET') {
      const refPrice = parseFloat(order.price || order.referencePrice || 0);
      if (!Number.isFinite(refPrice) || refPrice <= 0) {
        const r = `Missing or invalid reference price for ${orderType} order (got ${refPrice})`;
        _logBlock(order, owner, userId, r); // [OB-01]
        return { ok: false, reason: r };
      }
      const qty = parseFloat(order.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        const r = 'Invalid or missing quantity';
        _logBlock(order, owner, userId, r); // [OB-01]
        return { ok: false, reason: r };
      }
      const notional = qty * refPrice;
      if (notional > config.risk.maxPositionUsdt) {
        const r = `Position size $${notional.toFixed(2)} exceeds max $${config.risk.maxPositionUsdt}`;
        _logBlock(order, owner, userId, r); // [OB-01]
        return { ok: false, reason: r };
      }
    }
  }

  // Daily loss limit — per-user, per-owner
  const tracker = (owner === 'ARES') ? _resetIfNewDay(state.aresDaily) : _resetIfNewDay(state.atDaily);
  // Safety: if realizedPnL is corrupted (NaN), treat as exceeded to block orders
  if (!Number.isFinite(tracker.realizedPnL)) {
    tracker.realizedPnL = 0; // self-heal
    logger.warn('RISK', 'realizedPnL was NaN for uid=' + userId + ' owner=' + owner + ' — reset to 0');
  }
  const lossLimit = config.risk.maxPositionUsdt * (config.risk.dailyLossLimitPct / 100);
  if (tracker.realizedPnL < 0 && Math.abs(tracker.realizedPnL) >= lossLimit) {
    const who = owner === 'ARES' ? 'ARES' : 'AT';
    // [AUDIT] Per-user dedupe — one daily loss TG per user per owner per day
    const _today = new Date().toISOString().slice(0, 10);
    const _dlKey = `${userId}:${who}:${_today}`;
    if (!_dailyLossAlerted[_dlKey]) {
      _dailyLossAlerted[_dlKey] = true;
      telegram.alertDailyLoss(who, tracker.realizedPnL, lossLimit, userId);
    }
    const r = `${who} daily loss limit reached ($${Math.abs(tracker.realizedPnL).toFixed(2)} / $${lossLimit.toFixed(2)})`;
    Sentry.captureMessage(`Daily loss limit hit: ${who}`, { level: 'warning', tags: { module: 'riskGuard', owner: who }, user: { id: String(userId) }, extra: { pnl: tracker.realizedPnL, limit: lossLimit } });
    _logBlock(order, owner, userId, r); // [OB-01]
    return { ok: false, reason: r };
  }

  return { ok: true };
}

function getDailyState(owner, userId) {
  const state = _getUserState(userId);
  const tracker = (owner === 'ARES') ? _resetIfNewDay(state.aresDaily) : _resetIfNewDay(state.atDaily);
  return { ...tracker };
}

module.exports = { validateOrder, recordClosedPnL, setEmergencyKill, getDailyState };
