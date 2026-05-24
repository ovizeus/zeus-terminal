'use strict';
const VOICE_LATENCY_CAP_MS = 100;
let _totalAbandons = 0;
let _abandonsThisMinute = 0;
let _lastMinuteReset = Date.now();

function withLatencyCap(fn, timeoutMs) {
    const cap = timeoutMs || VOICE_LATENCY_CAP_MS;
    return new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
            if (!done) { done = true; _totalAbandons++; _abandonsThisMinute++; resolve(null); }
        }, cap);
        try {
            const result = fn();
            if (result && typeof result.then === 'function') {
                result.then(v => { if (!done) { done = true; clearTimeout(timer); resolve(v); } })
                      .catch(() => { if (!done) { done = true; clearTimeout(timer); resolve(null); } });
            } else {
                if (!done) { done = true; clearTimeout(timer); resolve(result); }
            }
        } catch (_) { if (!done) { done = true; clearTimeout(timer); resolve(null); } }
    });
}

function getAbandonStats() {
    const now = Date.now();
    if (now - _lastMinuteReset > 60000) { _abandonsThisMinute = 0; _lastMinuteReset = now; }
    return { totalAbandons: _totalAbandons, abandonsLastMinute: _abandonsThisMinute };
}

module.exports = { withLatencyCap, getAbandonStats, VOICE_LATENCY_CAP_MS };
