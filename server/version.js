// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.16',
    build: 42,
    date: '2026-04-19',
    changelog: 'Post-v2 batch3-X b42 v1.7.16 AT SETTINGS PERSISTENCE FIX (BUG 2 of 2) — leverage and other AT integer fields silently reverted to defaults (lev→5, maxPos→4, maxDay→5, lossStreak→3, maxAddon→2, sigMin→3) after any UI action that scheduled _usSave. Root cause: _usSave (legacy DOM-read save in core/config.ts) read these 6 fields via document.getElementById(id)?.getAttribute("value"), which returns the initial HTML attribute. React-controlled <select>/<input> do not sync that attribute with state, so the read returned null → parseInt("") || N → default N. _usSave then called _ssStore.loadFromLegacy + saveToServer, POSTing the wrong value to the server, which broadcast settings.changed via WS and re-hydrated all tabs back to default. Fix: minimal surgical change in core/config.ts:_usSave — replaced the 6 getAttribute("value") reads with the existing _iv(id, def) helper that reads property .value (the React-controlled live value). Zero changes elsewhere. BUG 1 (TESTNET-mode showing "REAL funds" warning) deferred to next commit per audit plan.'
};
