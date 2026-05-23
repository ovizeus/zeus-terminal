'use strict';

// [Wave 6] R4 Exposure Manager — unified read-model for total exposure
// across all positions of a user. Aggregates from already-flowing data
// (serverAT.getOpenPositions output shape), no new state. Companion to
// existing per-feature guards (correlationGuard, drawdownGuard, riskGuard
// per-order) which continue to enforce. exposureManager = single source
// of truth for "how exposed is the user right now" + projected check.
//
// Pure functions — caller passes positions + balance, manager returns
// aggregate. No DB queries here (cheap, can be called per tick).

const DEFAULT_MAX_PCT = 50;

function getTotalExposure({ positions, balance } = {}) {
    const pos = Array.isArray(positions) ? positions : [];
    const bal = Number(balance) || 0;

    let totalSize = 0;
    let totalNotional = 0;
    const bySymbol = {};
    const byDir = { LONG: 0, SHORT: 0 };

    for (const p of pos) {
        const size = +p.size || 0;
        const qty = +p.qty || 0;
        const price = +p.price || 0;
        const notional = qty * price;
        const sym = p.symbol || '?';
        const dir = p.side === 'SHORT' ? 'SHORT' : 'LONG';

        totalSize += size;
        totalNotional += notional;

        if (!bySymbol[sym]) bySymbol[sym] = { size: 0, notional: 0, positions: 0 };
        bySymbol[sym].size += size;
        bySymbol[sym].notional += notional;
        bySymbol[sym].positions += 1;

        byDir[dir] += size;
    }

    const exposurePct = bal > 0 ? (totalSize / bal) * 100 : 0;

    return {
        totalSize,
        totalNotional,
        positionCount: pos.length,
        bySymbol,
        byDir,
        exposurePct,
    };
}

function wouldExceedLimit({ positions, balance, newOrder, maxPct } = {}) {
    const limit = maxPct != null ? maxPct : DEFAULT_MAX_PCT;
    const current = getTotalExposure({ positions, balance });
    const newSize = (newOrder && +newOrder.size) || 0;
    const projectedSize = current.totalSize + newSize;
    const projectedPct = balance > 0 ? (projectedSize / balance) * 100 : 0;
    return {
        wouldExceed: projectedPct > limit,
        currentPct: current.exposurePct,
        projectedPct,
        limitPct: limit,
        delta: newSize,
    };
}

module.exports = { getTotalExposure, wouldExceedLimit };
