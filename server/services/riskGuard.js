// Zeus Terminal — Server-Side Risk Guard
// Validates orders against risk limits BEFORE they reach the exchange
// AT and ARES have independent daily loss trackers — per user, no cross-veto
'use strict';

const config = require('../config');
const fs = require('fs');
const path = require('path');
const telegram = require('./telegram');

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
  // [MULTI-USER] Hard guard — never fall back to user 1
  if (!userId) throw new Error('[RISK] _getUserState called without userId');
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
  telegram.alertKillSwitch(state.emergencyKill, userId);
  if (state.emergencyKill) console.warn('[RISK] EMERGENCY KILL activated — all orders blocked for user ' + userId);
}

/**
 * Validate an order against all risk limits.
 * @param {object} order — { symbol, side, type, quantity, price, leverage }
 * @param {string} owner — 'ARES' or 'AT' (default: 'AT')
 * @param {number|string} [userId=1]
 * Returns { ok: true } or { ok: false, reason: string }.
 */
function validateOrder(order, owner, userId) {
  const state = _getUserState(userId);

  // Global emergency kill
  if (state.emergencyKill) {
    return { ok: false, reason: 'Emergency kill switch active — all trading blocked' };
  }

  // Master kill switch
  if (!config.tradingEnabled) {
    return { ok: false, reason: 'Trading is disabled (TRADING_ENABLED=false)' };
  }

  // Leverage check
  const lev = parseInt(order.leverage, 10);
  if (lev > config.risk.maxLeverage) {
    return { ok: false, reason: `Leverage ${lev}x exceeds max ${config.risk.maxLeverage}x` };
  }

  // Position size check
  const orderType = String(order.type || 'MARKET').toUpperCase();
  if (orderType === 'LIMIT' || orderType === 'MARKET') {
    const refPrice = parseFloat(order.price || order.referencePrice || 0);
    if (!Number.isFinite(refPrice) || refPrice <= 0) {
      return { ok: false, reason: `Missing or invalid reference price for ${orderType} order (got ${refPrice})` };
    }
    const notional = parseFloat(order.quantity) * refPrice;
    if (notional > config.risk.maxPositionUsdt) {
      return { ok: false, reason: `Position size $${notional.toFixed(2)} exceeds max $${config.risk.maxPositionUsdt}` };
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
      telegram.alertDailyLoss(who, tracker.realizedPnL, lossLimit, userId);
    }
    return { ok: false, reason: `${who} daily loss limit reached ($${Math.abs(tracker.realizedPnL).toFixed(2)} / $${lossLimit.toFixed(2)})` };
  }

  return { ok: true };
}

function getDailyState(owner, userId) {
  const state = _getUserState(userId);
  const tracker = (owner === 'ARES') ? _resetIfNewDay(state.aresDaily) : _resetIfNewDay(state.atDaily);
  return { ...tracker };
}

module.exports = { validateOrder, recordClosedPnL, setEmergencyKill, getDailyState };
