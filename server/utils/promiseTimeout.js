'use strict';

// [BUG-MULTI 2026-05-31] Race an awaited promise against a timeout so a hung async step
// cannot block the rest of a critical flow. Used by /api/order/place Path B to bound
// _placeProtectionForExistingEntry: a stalled real-SL placement must NOT prevent the
// position from being registered (else the filled exchange position is orphaned).
// On settle-before-timeout → resolves/rejects with the wrapped result (timer cleared,
// no leak). On timeout → rejects with new Error(label).
function withTimeout(promise, ms, label) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label || 'TIMEOUT')), ms);
    });
    return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

module.exports = { withTimeout };
