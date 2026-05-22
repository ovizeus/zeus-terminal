'use strict';

/**
 * binanceOps — Binance exchange operations.
 * Stub: full implementation in Tasks 25-30 (Phase 5 Bybit Phase 1A+1B).
 * This file exists so exchangeOps lazy require resolves correctly.
 */

function _notImpl(name) {
    return async () => { throw new Error(`binanceOps.${name} not yet implemented`); };
}

module.exports = {
    placeEntry:        _notImpl('placeEntry'),
    closePosition:     _notImpl('closePosition'),
    ensureSymbolReady: _notImpl('ensureSymbolReady'),
    getPositions:      _notImpl('getPositions'),
    getBalance:        _notImpl('getBalance'),
    getUserTrades:     _notImpl('getUserTrades'),
    ping:              _notImpl('ping'),
    cancelOrder:       _notImpl('cancelOrder'),
    placeStopLoss:     _notImpl('placeStopLoss'),
};
