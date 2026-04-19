// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.17',
    build: 43,
    date: '2026-04-19',
    changelog: 'Post-v2 batch3-X b43 v1.7.17 AT TESTNET WARNING TEXT (BUG 1 of 2) — when engine is in live mode and a TESTNET API is configured, the AT panel correctly showed "TESTNET MODE" at the top, but the warning banner at the bottom of the panel was hardcoded "LIVE MODE ACTIVE: Auto trades will execute with REAL funds on Binance." regardless of env. Misleading and inconsistent with all other env-aware UI surfaces (ModeBar, StatusBar, Manual panel, confirm dialogs). Fix: AutoTradePanel.tsx now reads useUiStore.resolvedEnv and branches the warning text — TESTNET shows "TESTNET MODE ACTIVE: Auto trades will execute with TEST funds on Binance Testnet.", REAL keeps the original "LIVE MODE ACTIVE / REAL funds" text. Single-file surgical change. No store contract changes, no env-logic changes, no server changes. resolvedEnv is the same authoritative server-pushed field already used by ModeBar/StatusBar/Manual panel — single source of truth via useServerSync.applyATUpdate. Previous: batch3-X b42 v1.7.16 (AT settings persistence fix BUG 2 of 2).'
};
