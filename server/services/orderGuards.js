'use strict';

// [AUDIT-20260619 BUG B] Pure order-guard predicates. Extracted from trading.js so
// the SL-required entry rule is unit-testable without the route's heavy require chain
// (and without the STALE_DATA e2e flake that fires upstream of the SL guard).

/**
 * Does this /api/order/place request require a stop-loss in the body?
 * - A reduce-only CLOSE never carries an SL (you don't stop-loss a close) → false.
 * - Live REAL entries MUST carry an SL → true. Testnet entries are exempt (existing
 *   design); demo entries are exempt.
 */
function slRequiredForEntry({ engineMode, isTestnet, closePosition, reduceOnly } = {}) {
    if (closePosition === true || reduceOnly === true) return false;
    return engineMode === 'live' && isTestnet !== true;
}

module.exports = { slRequiredForEntry };
