'use strict';
// [REAL-GATE P0-4 2026-06-09] Pure flag-combination sanity for the REAL day.
// NEVER blocks (the 3 fail-closed layers in serverAT + ownership do that) —
// this SCREAMS, so an incoherent flip is noticed in seconds, not at the
// first invisible fill. Wired: boot (server.js) + migrationFlags.set().

function checkRealGateCoherence(f) {
    if (!f || typeof f !== 'object') {
        return { coherent: false, problems: ['flags object missing — cannot assess REAL gate coherence'] };
    }
    const problems = [];
    if (f._SRV_POS_REAL_ENABLED === true) {
        if (f._USERDATA_STREAM_REAL_ENABLED !== true) {
            problems.push('REAL exec ON but _USERDATA_STREAM_REAL_ENABLED off — fills on real money would be INVISIBLE (phantom-position factory)');
        }
        if (f.USERDATA_STREAM_ENABLED !== true) {
            problems.push('REAL exec ON but master USERDATA_STREAM_ENABLED off — no fill stream at all');
        }
        if (f.SERVER_AT_FULL_OWNERSHIP !== true) {
            problems.push('REAL exec ON but SERVER_AT_FULL_OWNERSHIP off — SP2-a hybrid = two engines racing on real money');
        }
    }
    if (f.ML_LIVE_INFLUENCE_ENABLED === true && f.ML_LIVE_OPTIN_REQUIRED !== true) {
        problems.push('ML_LIVE_INFLUENCE_ENABLED on without ML_LIVE_OPTIN_REQUIRED — real-money ML without per-user consent');
    }
    return { coherent: problems.length === 0, problems };
}

// Convenience wrapper used by the two wiring points (server.js boot +
// migrationFlags.set). Loud, best-effort: log + Telegram, never throws.
// Verified signatures: logger.error(component, message[, data]) and
// telegram.send(text[, parseMode]) → Promise (global-config bot, email
// fallback inside). Lazy requires keep the checker pure for unit tests.
function assertAndAlert(flagsGetAll, label) {
    try {
        const r = checkRealGateCoherence(flagsGetAll);
        if (!r.coherent) {
            const msg = `🚨 *REAL GATE INCOHERENT* (${label}):\n- ` + r.problems.join('\n- ');
            try { require('./logger').error('REAL_GATE', msg); } catch (_) { console.error(msg); }
            try { Promise.resolve(require('./telegram').send(msg)).catch(() => {}); } catch (_) {}
        }
        return r;
    } catch (e) {
        console.error('[REAL_GATE] coherence check crashed: ' + e.message);
        return { coherent: false, problems: ['coherence check crashed: ' + e.message] };
    }
}

module.exports = { checkRealGateCoherence, assertAndAlert };
