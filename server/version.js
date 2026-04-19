// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.19',
    build: 45,
    date: '2026-04-19',
    changelog: 'Post-v2 batch4 b45 v1.7.19 — Phase 2B: canonical server execution env. New _resolveExecutionEnv(userId) helper is the single source of truth for execution semantics — demo→DEMO, non-demo+valid testnet creds→TESTNET, non-demo+valid live creds→REAL, non-demo+no/invalid creds→null with stable blockedReason (NO_ACTIVE_API_CREDENTIALS or INVALID_ACTIVE_API_CONFIGURATION). getFullState() additively returns executionEnv + executionBlockedReason. preLiveChecklist API_KEYS check now carries the stable code on failure. resolvedEnv legacy field preserved as-is (alignment to canonical helper deferred — would require client changes). No client patches in this phase. Existing setMode live gate unchanged. Previous: batch4 b44 v1.7.18 (Phases 1A + 1B + 2A + invalid-mode hotfix). Phase 1A: POST /api/exchange/save now enforces single-exchange XOR single-env-per-exchange before external verification, returning HTTP 409 with stable codes EXCHANGE_CONFLICT / ENV_CONFLICT and verbatim user-facing messages. Phase 1B: Settings exchange flow (exSave/exVerify) surfaces the exact server `message` field on conflict (no false success, no state mutation on 409). Phase 2A: credentialStore.js made exchange- and env-aware with a 4-cell baseUrl matrix (binance/bybit × testnet/live), no Binance fallback for unknown exchanges, invalid mode safe-defaults to live. serverAT.getFullState() additively returns `activeExchange: "binance"|"bybit"|null`. All existing fields (apiConfigured, exchangeMode, resolvedEnv) preserved. DEMO untouched. Tested via 3 isolated harnesses + 161/161 jest unit. Previous: batch3-X b43 v1.7.17 (AT TESTNET warning text).'
};
