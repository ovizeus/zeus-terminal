'use strict';

/**
 * Margin type idempotent setter — defends against Binance refusing redundant
 * marginType set calls when there are open orders on the symbol.
 *
 * Day 35 bug: operator hit persistent error
 *   "Failed to set margin type: Binance API error: Position side cannot be
 *    changed if there exists open orders."
 * Original code only treated -4046 (no need to change) as silent. Other
 * variants (-4144, -4048) blocked every order attempt on symbols with
 * leftover SL/TP from previous positions.
 *
 * Strategy: POST marginType. On any non-success, verify via positionRisk —
 * if Binance reports current marginType is already 'cross', treat the
 * refusal as idempotent. If 'isolated', throw an actionable error that
 * tells the operator to fix it manually (Zeus risk math assumes CROSS).
 */

function _isCross(v) {
    return typeof v === 'string' && v.toLowerCase().startsWith('cross');
}

async function ensureCrossed(symbol, creds, sendSignedRequest) {
    try {
        await sendSignedRequest('POST', '/fapi/v1/marginType', { symbol, marginType: 'CROSSED' }, creds);
        return;
    } catch (setErr) {
        // -4046 = "no need to change" — already CROSSED, silent + no verify needed
        if (setErr && setErr.code === -4046) return;

        // Any other error: verify actual current marginType. If it matches our
        // target (CROSSED), treat as idempotent — Binance refused the redundant
        // call but state is already correct.
        let posRows;
        try {
            posRows = await sendSignedRequest('GET', '/fapi/v2/positionRisk', { symbol }, creds);
        } catch (verifyErr) {
            // Can't verify → propagate ORIGINAL error (most informative for operator).
            throw setErr;
        }

        if (!Array.isArray(posRows)) throw setErr;
        const row = posRows.find(p => p && p.symbol === symbol);
        if (!row) throw setErr;

        if (_isCross(row.marginType)) {
            // Idempotent path — Binance state matches target despite refused set.
            return;
        }

        // True ISOLATED state — Zeus risk math assumes CROSS; refuse with
        // actionable message instead of letting downstream order fail late.
        const e = new Error(
            `marginType is ${String(row.marginType || '').toUpperCase()} on Binance for ${symbol}; ` +
            `Zeus requires CROSSED. Set it manually on Binance, then retry. ` +
            `(Auto-change refused: ${setErr.message})`
        );
        e.code = setErr.code;
        e.status = setErr.status || 500;
        throw e;
    }
}

module.exports = { ensureCrossed };
