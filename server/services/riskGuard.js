// Zeus Terminal — Server-Side Risk Guard
// Validates orders against risk limits BEFORE they reach the exchange
// AT and ARES have independent daily loss trackers — no cross-veto
'use strict';

const config = require('../config');
const fs = require('fs');
const path = require('path');
const telegram = require('./telegram');

// ── Persistence file — survives server restarts ──
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const RISK_STATE_FILE = path.join(DATA_DIR, 'riskState.json');

function _saveToDisk() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const state = { atDaily: _atDaily, aresDaily: _aresDaily, emergencyKill: _emergencyKill };
    fs.writeFileSync(RISK_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[RISK] Failed to persist state:', err.message);
  }
}

function _loadFromDisk() {
  try {
    if (!fs.existsSync(RISK_STATE_FILE)) return;
    const raw = fs.readFileSync(RISK_STATE_FILE, 'utf8');
    const state = JSON.parse(raw);
    if (state.atDaily && state.atDaily.date) _atDaily = state.atDaily;
    if (state.aresDaily && state.aresDaily.date) _aresDaily = state.aresDaily;
    if (state.emergencyKill === true) _emergencyKill = true;
    console.log('[RISK] Loaded persisted state — AT PnL: $' + _atDaily.realizedPnL.toFixed(2) +
      ', ARES PnL: $' + _aresDaily.realizedPnL.toFixed(2) +
      ', Kill: ' + _emergencyKill);
  } catch (err) {
    console.warn('[RISK] Failed to load persisted state:', err.message);
  }
}

// ── Separate daily loss trackers for AT and ARES ──
function _makeTracker() {
  return { date: new Date().toISOString().slice(0, 10), realizedPnL: 0 };
}
let _atDaily = _makeTracker();
let _aresDaily = _makeTracker();
let _emergencyKill = false; // global kill switch — blocks ALL orders

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
 */
function recordClosedPnL(pnl, owner) {
  const tracker = (owner === 'ARES') ? _resetIfNewDay(_aresDaily) : _resetIfNewDay(_atDaily);
  tracker.realizedPnL += pnl;
  _saveToDisk();
}

/**
 * Activate or deactivate the global emergency kill switch.
 */
function setEmergencyKill(active) {
  _emergencyKill = !!active;
  _saveToDisk();
  telegram.alertKillSwitch(_emergencyKill);
  if (_emergencyKill) console.warn('[RISK] EMERGENCY KILL activated — all orders blocked');
}

/**
 * Validate an order against all risk limits.
 * @param {object} order — { symbol, side, type, quantity, price, leverage }
 * @param {string} owner — 'ARES' or 'AT' (default: 'AT')
 * Returns { ok: true } or { ok: false, reason: string }.
 */
function validateOrder(order, owner) {
  // Global emergency kill
  if (_emergencyKill) {
    return { ok: false, reason: 'Emergency kill switch active — all trading blocked' };
  }

  // Master kill switch
  if (!config.tradingEnabled) {
    return { ok: false, reason: 'Trading is disabled (TRADING_ENABLED=false)' };
  }

  // (Per-user API key check handled by resolveExchange middleware)

  // Leverage check
  const lev = parseInt(order.leverage, 10);
  if (lev > config.risk.maxLeverage) {
    return { ok: false, reason: `Leverage ${lev}x exceeds max ${config.risk.maxLeverage}x` };
  }

  // Position size check (notional = quantity * price)
  // Enforce for LIMIT and MARKET entry orders. STOP_MARKET/TAKE_PROFIT_MARKET are
  // protective (close existing exposure) — skip those.
  const orderType = String(order.type || 'MARKET').toUpperCase();
  if (orderType === 'LIMIT' || orderType === 'MARKET') {
    const refPrice = parseFloat(order.price || order.referencePrice || 0);
    // [FIX QA-C7 + R3] MARKET/LIMIT orders MUST have a finite positive referencePrice
    if (!Number.isFinite(refPrice) || refPrice <= 0) {
      return { ok: false, reason: `Missing or invalid reference price for ${orderType} order (got ${refPrice})` };
    }
    const notional = parseFloat(order.quantity) * refPrice;
    if (notional > config.risk.maxPositionUsdt) {
      return { ok: false, reason: `Position size $${notional.toFixed(2)} exceeds max $${config.risk.maxPositionUsdt}` };
    }
  }

  // Daily loss limit — checked per-owner, independent
  const tracker = (owner === 'ARES') ? _resetIfNewDay(_aresDaily) : _resetIfNewDay(_atDaily);
  const lossLimit = config.risk.maxPositionUsdt * (config.risk.dailyLossLimitPct / 100);
  if (tracker.realizedPnL < 0 && Math.abs(tracker.realizedPnL) >= lossLimit) {
    const who = owner === 'ARES' ? 'ARES' : 'AT';
    telegram.alertDailyLoss(who, tracker.realizedPnL, lossLimit);
    return { ok: false, reason: `${who} daily loss limit reached ($${Math.abs(tracker.realizedPnL).toFixed(2)} / $${lossLimit.toFixed(2)})` };
  }

  return { ok: true };
}

function getDailyState(owner) {
  const tracker = (owner === 'ARES') ? _resetIfNewDay(_aresDaily) : _resetIfNewDay(_atDaily);
  return { ...tracker };
}

module.exports = { validateOrder, recordClosedPnL, setEmergencyKill, getDailyState };
