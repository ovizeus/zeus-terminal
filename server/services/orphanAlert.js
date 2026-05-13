// Zeus Terminal — Orphan Position Risk Alert helper (BUG-T4 2026-05-13)
//
// Fires 3 best-effort alerts când registerManualPosition() throws DUPĂ ce
// main order succeeded pe Binance — position există fizic pe exchange dar
// Zeus ZERO tracking în at_positions. Defense-in-depth pattern:
//
//   1. audit.record('ORDER_ORPHAN_RISK', ...) — forensic audit_log entry
//   2. telegram.alertOrderFailed(...) — operator notified IMMEDIATELY
//   3. Sentry.captureException(...) — remote error tracking
//
// Toate 3 wrap în try/catch — failure pe oricare NU blocks celelalte.
// Coordonat cu BUG-T2c (Path A/B no-SL) + BUG-T5 (validateOrderBody SL guard).
// Operator decides next action (manual close on Binance UI sau accept risc).

'use strict';

function alertOrphanRisk(err, ctx) {
  const userId = (ctx && ctx.req && ctx.req.user && ctx.req.user.id) || null;
  const ip = (ctx && ctx.req && ctx.req.ip) || null;
  const orderId = (ctx && ctx.data && ctx.data.orderId) || null;
  const symbol = (ctx && ctx.symbol) || null;
  const side = (ctx && ctx.side) || null;
  const type = (ctx && ctx.type) || null;
  const quantity = (ctx && ctx.quantity) != null ? ctx.quantity : null;
  const owner = (ctx && ctx.owner) || 'MANUAL';
  const errMsg = (err && err.message) || String(err);

  // [1/3] Audit log — forensic record
  try {
    const audit = require('./audit');
    audit.record('ORDER_ORPHAN_RISK', {
      userId, symbol, side, type, quantity, orderId, error: errMsg,
    }, owner, ip);
  } catch (_) { /* best-effort isolation */ }

  // [2/3] Telegram alert — operator notified imediat
  try {
    const telegram = require('./telegram');
    const msg = 'ORPHAN RISK: position EXISTS pe exchange dar Zeus zero tracking. ' +
      'Order ' + orderId + '. Verify manual și close dacă needed. Error: ' + errMsg;
    telegram.alertOrderFailed(symbol, side, msg, userId);
  } catch (_) { /* best-effort isolation */ }

  // [3/3] Sentry capture — remote error tracking
  try {
    const Sentry = require('@sentry/node');
    Sentry.captureException(err, {
      tags: { kind: 'orphan-position-risk', orderId },
      extra: { userId, symbol, side, type, quantity },
    });
  } catch (_) { /* best-effort isolation */ }
}

module.exports = { alertOrphanRisk };
