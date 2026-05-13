// Zeus Terminal — Reconciliation Pure-Function Helpers (BUG-T2a + T2b 2026-05-13)
//
// Extracted din serverAT.js _runReconciliation pentru testability + clarity.
// Both helpers sunt PURE functions (no side effects, no DB, no logger).
//
// BUG-T2a: buildBinanceHeldMap — keys by (symbol_side) tuple în loc de symbol-only.
//   Pre-T2a: în HEDGE mode (LONG + SHORT pe same symbol), Binance returns 2
//   positions cu same `symbol` field. Map keyed by symbol alone overwrote first
//   entry with second → recon detection looking up by symbol+side mismatch.
//   Fix: key by `symbol+'_'+side` tuple — preserves both positions independently.
//
// BUG-T2b: findExitTrade — strict validation for userTrades fallback exit detection.
//   Pre-T2b: filter `t.realizedPnl !== 0` matched ANY trade with realized PnL —
//   could fortuitously pick UNRELATED old trade for same symbol. Worked în
//   2026-05-10 incident dar nu deterministic — race condition risc.
//   Fix: require t.time > pos.openTs + opposite-side + qty ≥95% of pos qty.

'use strict';

/**
 * Build hedge-aware Binance held positions map.
 * Key: `symbol_side` tuple (e.g. 'BTCUSDT_LONG').
 * Skips positions cu zero positionAmt.
 *
 * @param {Array} binancePositions — from /fapi/v2/positionRisk API
 * @returns {Map<string, {amt, side, entryPrice, markPrice, unrealizedProfit}>}
 */
function buildBinanceHeldMap(binancePositions) {
    const map = new Map();
    if (!Array.isArray(binancePositions)) return map;
    for (const bp of binancePositions) {
        const amt = parseFloat(bp.positionAmt || 0);
        if (amt === 0) continue;
        const side = amt > 0 ? 'LONG' : 'SHORT';
        const key = bp.symbol + '_' + side;
        map.set(key, {
            amt, side,
            entryPrice: parseFloat(bp.entryPrice || 0),
            markPrice: parseFloat(bp.markPrice || 0),
            unrealizedProfit: parseFloat(bp.unRealizedProfit || 0),
        });
    }
    return map;
}

/**
 * Find legitimate exit trade pentru a server position din Binance userTrades response.
 *
 * Strict validation:
 *   - Same symbol
 *   - realizedPnl != 0 (close trade)
 *   - time > pos.openTs (trade AFTER position opened — discard old unrelated trades)
 *   - side opposite la pos.side (LONG exits with SELL; SHORT exits with BUY)
 *   - |qty| ≥ 95% of |pos.qty| (close trade matches position size within tolerance)
 *
 * Iterates trades în reverse (most recent first) — returns first valid match.
 *
 * @param {Array} trades — from /fapi/v1/userTrades API
 * @param {Object} pos — server position { symbol, side, qty, openTs, ts }
 * @returns {Object|null} — exit trade or null if no match
 */
function findExitTrade(trades, pos) {
    if (!Array.isArray(trades) || trades.length === 0) return null;
    if (!pos) return null;

    const posOpenTs = Number(pos.openTs || pos.ts || 0);
    const posQty = Math.abs(parseFloat(pos.qty || pos.executedQty || 1));
    const minQty = 0.95 * posQty;
    const expectedExitSide = pos.side === 'LONG' ? 'SELL' : 'BUY';

    // Iterate reverse (newest first) — return first match
    for (let i = trades.length - 1; i >= 0; i--) {
        const t = trades[i];
        if (!t) continue;
        if (t.symbol !== pos.symbol) continue;
        if (!t.realizedPnl) continue;
        if (parseFloat(t.realizedPnl) === 0) continue;
        if (Number(t.time) <= posOpenTs) continue;
        if (String(t.side).toUpperCase() !== expectedExitSide) continue;
        const tQty = Math.abs(parseFloat(t.qty || 0));
        if (tQty < minQty) continue;
        return t;
    }
    return null;
}

module.exports = { buildBinanceHeldMap, findExitTrade };
