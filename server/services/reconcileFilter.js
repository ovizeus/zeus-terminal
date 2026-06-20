'use strict';
// Pure: should the recovery-boot reconciler attempt this exchange for a user?
//
// Bybit while the dry-run safety latch (BYBIT_DRY_RUN_ONLY) is on has NO real positions/orders to
// reconcile — its fail-closed dispatch guard blocks real HTTP. Attempting it there both logs a
// spurious "reconciliation failed" error AND (worse) lands the user in erroredUsers, which keeps
// their global halt ARMED even when their live exchange (Binance) reconciled cleanly. So skip it.
// Once Bybit goes live (BYBIT_DRY_RUN_ONLY=false), it reconciles normally again.
function shouldReconcileExchange(exchange, flags) {
  if (String(exchange) === 'bybit' && flags && flags.BYBIT_DRY_RUN_ONLY) return false;
  return true;
}

module.exports = { shouldReconcileExchange };
