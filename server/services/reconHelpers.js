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
 * [BUG-RECON-SYMBOL FIX 2026-05-14] Value includes pure `symbol` field
 * (without side suffix). Downstream callers in serverAT.js iterate the map
 * via `for (const [key, bpos] of binanceHeld)` and previously used the
 * destructured composite key as the `symbol` query param to Binance →
 * "Invalid symbol" errors + orphan auto-close silent failure on real
 * orphans. Reading `bpos.symbol` keeps API calls correct.
 *
 * @param {Array} binancePositions — from /fapi/v2/positionRisk API
 * @returns {Map<string, {symbol, amt, side, entryPrice, markPrice, unrealizedProfit}>}
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
            symbol: bp.symbol, // [BUG-RECON-SYMBOL FIX] pure symbol for downstream API calls
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
        // [P2c.1] Normalized exchangeOps.getUserTrades exposes `ts`; raw Binance uses `time`.
        if (Number(t.ts != null ? t.ts : t.time) <= posOpenTs) continue;
        if (String(t.side).toUpperCase() !== expectedExitSide) continue;
        const tQty = Math.abs(parseFloat(t.qty || 0));
        if (tQty < minQty) continue;
        return t;
    }
    return null;
}

/**
 * [P2c.1] Build a cross-exchange held-positions map from exchangeOps.getPositions
 * NORMALIZED output (binance + bybit share the shape:
 * {symbol, side:'LONG'|'SHORT', qty, entryPrice, markPrice, ...}).
 * Replaces buildBinanceHeldMap (raw positionRisk) in cross-exchange recon.
 * Key: `symbol_side`. Skips zero/invalid qty.
 *
 * @param {Array} positions — normalized positions from exchangeOps.getPositions
 * @returns {Map<string, {symbol, side, qty, entryPrice, markPrice}>}
 */
function buildHeldMap(positions) {
    const map = new Map();
    if (!Array.isArray(positions)) return map;
    for (const p of positions) {
        if (!p || !p.symbol || (p.side !== 'LONG' && p.side !== 'SHORT')) continue;
        const qty = Math.abs(parseFloat(p.qty || 0));
        if (!(qty > 0)) continue;
        map.set(p.symbol + '_' + p.side, {
            symbol: p.symbol,
            side: p.side,
            qty,
            // [P2c.1] amt + unrealizedProfit kept for orphan-branch compatibility
            // (it reads bpos.amt / bpos.unrealizedProfit, mirroring buildBinanceHeldMap).
            amt: qty,
            entryPrice: parseFloat(p.entryPrice || 0),
            markPrice: parseFloat(p.markPrice || 0),
            unrealizedProfit: parseFloat(p.unrealizedPnl || 0),
        });
    }
    return map;
}

/**
 * [P2c.1] Group live positions by their OWN exchange so recon can query each
 * exchange's held positions with the right creds (via exchangeOps exchangeOverride
 * → getExchangeCredsFor). Null/missing exchange → 'binance' (legacy pre-stamp rows).
 *
 * @param {Array} positions — server positions, each optionally carrying `exchange`
 * @returns {Map<string, Array>} exchange → positions[]
 */
function groupPositionsByExchange(positions) {
    const groups = new Map();
    if (!Array.isArray(positions)) return groups;
    for (const p of positions) {
        const ex = (p && p.exchange) ? p.exchange : 'binance';
        if (!groups.has(ex)) groups.set(ex, []);
        groups.get(ex).push(p);
    }
    return groups;
}

// [ROOT FIX 2026-06-18] Trust-gate for the exchange held-map snapshot.
// /fapi/v2/positionRisk can return a 200-OK EMPTY array even while positions are
// genuinely open (Binance eventual-consistency / stale read, worse under degraded
// datacenter connectivity). Recon previously trusted this as ground truth → falsely
// phantom-closed live positions → which then re-adopted as external/lev1 "Manual x1"
// orphans (recurring bug). An empty held-map WHILE we track live positions is almost
// always a stale/failed poll, not a real simultaneous close of every position (real
// closes arrive via userDataStream). Treat it as untrusted → skip destructive recon
// this cycle and wait for a good poll. Defensive: only flags the unambiguous case
// (finite, heldSize===0, trackedCount>0); never skips on garbage inputs.
function isUntrustedEmptyHeld(heldSize, trackedCount) {
    return Number.isFinite(heldSize) && Number.isFinite(trackedCount)
        && heldSize === 0 && trackedCount > 0;
}

module.exports = { buildBinanceHeldMap, findExitTrade, buildHeldMap, groupPositionsByExchange, isUntrustedEmptyHeld };
