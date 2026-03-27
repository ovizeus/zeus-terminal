// Zeus Terminal — Server-Side Risk Guard
// Validates orders against risk limits BEFORE they reach the exchange
// AT and ARES have independent daily loss trackers — per user, no cross-veto
'use strict';

const config = require('../config');
const fs = require('fs');
const path = require('path');
const telegram = require('./telegram');
const audit = require('./audit'); // [OB-01]

// ── Persistence file — survives server restarts ──
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const RISK_STATE_FILE = path.join(DATA_DIR, 'riskState.json');

// Per-user state: { "<userId>": { atDaily, aresDaily, emergencyKill } }
let _users = {};

function _saveToDisk() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = RISK_STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(_users, null, 2));
    fs.renameSync(tmp, RISK_STATE_FILE);
  } catch (err) {
    console.error('[RISK] Failed to persist state:', err.message);
  }
}

function _loadFromDisk() {
  try {
    if (!fs.existsSync(RISK_STATE_FILE)) return;
    const raw = fs.readFileSync(RISK_STATE_FILE, 'utf8');
    const state = JSON.parse(raw);

    // Migration: old global format → per-user format (assign to user "1")
    if (state.atDaily && !state['1']) {
      _users['1'] = {
        atDaily: state.atDaily,
        aresDaily: state.aresDaily || _makeTracker(),
        emergencyKill: !!state.emergencyKill,
      };
      console.log('[RISK] Migrated global riskState → per-user (userId=1)');
    } else {
      // New per-user format
      for (const uid of Object.keys(state)) {
        const u = state[uid];
        if (u && u.atDaily) _users[uid] = u;
      }
    }

    // Log loaded state
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
  const state = _getUserState(userId);
  const tracker = (owner === 'ARES') ? _resetIfNewDay(state.aresDaily) : _resetIfNewDay(state.atDaily);
  tracker.realizedPnL += pnl;
  _saveToDisk();
}

/**
 * Activate or deactivate the emergency kill switch for a user.
 */
function setEmergencyKill(active, userId) {
  const state = _getUserState(userId);
  state.emergencyKill = !!active;
  _saveToDisk();
  try { telegram.alertKillSwitch(state.emergencyKill, userId); } catch (e) { console.warn('[RISK]', `alertKillSwitch TG failed (best-effort): ${e.message}`); }
  if (state.emergencyKill) console.warn('[RISK] EMERGENCY KILL activated — all orders blocked for user ' + userId);
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

  // Leverage check
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

  // Position size check
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

  // Daily loss limit — per-user, per-owner
  const tracker = (owner === 'ARES') ? _resetIfNewDay(state.aresDaily) : _resetIfNewDay(state.atDaily);
  const lossLimit = config.risk.maxPositionUsdt * (config.risk.dailyLossLimitPct / 100);
  if (tracker.realizedPnL < 0 && Math.abs(tracker.realizedPnL) >= lossLimit) {
    const who = owner === 'ARES' ? 'ARES' : 'AT';
    // [AUDIT] Per-user dedupe — one daily loss TG per user per owner per day
    const _today = new Date().toISOString().slice(0, 10);
    const _dlKey = `${userId}:${who}:${_today}`;
    if (!_dailyLossAlerted[_dlKey]) {
      _dailyLossAlerted[_dlKey] = true;
      try { telegram.alertDailyLoss(who, tracker.realizedPnL, lossLimit, userId); } catch (e) { console.warn('[RISK]', `alertDailyLoss TG failed (best-effort): ${e.message}`); }
    }
    const r = `${who} daily loss limit reached ($${Math.abs(tracker.realizedPnL).toFixed(2)} / $${lossLimit.toFixed(2)})`;
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
