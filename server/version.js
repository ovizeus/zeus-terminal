// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.18',
    build: 44,
    date: '2026-04-19',
    changelog: 'Post-v2 batch4 b44 v1.7.18 — Exchange API UX hardening (Phases 1A + 1B + 2A). Phase 1A: POST /api/exchange/save now enforces single-exchange XOR single-env-per-exchange before external verification, returning HTTP 409 with stable codes EXCHANGE_CONFLICT / ENV_CONFLICT and verbatim user-facing messages. Phase 1B: Settings exchange flow (exSave/exVerify) surfaces the exact server `message` field on conflict (no false success, no state mutation on 409). Phase 2A: credentialStore.js made exchange- and env-aware with a 4-cell baseUrl matrix (binance/bybit × testnet/live), no Binance fallback for unknown exchanges, invalid mode safe-defaults to live. serverAT.getFullState() additively returns `activeExchange: "binance"|"bybit"|null`. All existing fields (apiConfigured, exchangeMode, resolvedEnv) preserved. DEMO untouched. Tested via 3 isolated harnesses + 161/161 jest unit. Previous: batch3-X b43 v1.7.17 (AT TESTNET warning text).'
};
