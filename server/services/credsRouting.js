'use strict';

// Per-position credential routing for serverAT exit/SL/TP/add-on ops.
//
// [Multi-exchange switch P2a] New orders go to the ACTIVE exchange; an existing
// position must be managed on ITS OWN exchange (position.exchange) regardless of
// which exchange is currently active. After a switch, the old exchange's row is
// kept connected (is_active=0) so getExchangeCredsFor can still load its creds.
//
// Pure + dependency-injected (the credentialStore is passed in) so it unit-tests
// without booting serverAT. Falls back to ACTIVE creds when the position carries
// no exchange (demo or legacy pre-stamp positions) — identical to prior behavior.
function credsForPosition(store, userId, pos) {
    if (pos && pos.exchange) {
        return store.getExchangeCredsFor(userId, pos.exchange);
    }
    return store.getExchangeCreds(userId);
}

module.exports = { credsForPosition };
