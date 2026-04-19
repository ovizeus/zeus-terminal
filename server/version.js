// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.22',
    build: 48,
    date: '2026-04-19',
    changelog: 'Post-v2 batch4 b48 v1.7.22 — Phase 4 (4A→4D) Exchange/API Mutual Exclusion policy completion — server-first, no half-fixes. (1) Phase 4A (audit, read-only): confirmed Phase 1A route /save already rejects EXCHANGE_CONFLICT + ENV_CONFLICT with exact policy messages; identified DB schema gap (old idx_exchange_user_name permitted 2 active rows per user) + UI gap (settings reactive-only, no proactive blocking). (2) Phase 4B: migration 025_exchange_single_active — collapses any pre-existing user with >1 active row (keep most-recent by updated_at DESC + id DESC, deactivate losers with status=disconnected_reconcile), drops legacy idx_exchange_user_name, creates idx_exchange_user_active_single UNIQUE ON (user_id) WHERE is_active = 1. At-most-ONE active exchange per user enforceable at the schema level — any future writer that bypasses the route cannot split state. Prod reconciliation is a no-op. (3) Phase 4C: SettingsHubModal derives activeExchange exclusively from server-sourced exAccounts (no localStorage/window). Non-active exchange card renders BLOCKED state: 🔒 BLOCKED badge, inline orange policy notice with exact Phase 1A phrasing, no inputs, no toggle, disabled VERIFY & SAVE (BLOCKED) button. Active card CONNECTED path + RE-VERIFY/DISCONNECT unchanged. ENV_CONFLICT has no proactive client surface because connected card hides mode toggle (mode change only via DISCONNECT + re-save, server-governed). (4) Phase 4D: deploy. Tests: vitest 76/76 + vite build OK + 4B harness 39/39 + 4C harness 20/20 + full prior-phase sweep (1a 23/23, 1b 12/12, 2a 26/26, 2b 24/24, 3a 23/23, 3b 44/44, 3c 11/11, 3d 10/10, 3e 19/19, 3f 14/14, 3g 13/13, hotfix 16/16) all PASS. Previous: batch4 b47 v1.7.21 (Phase 3 full-truth/ownership/render remediation + mode-switch hotfix + repo cleanup).'
};
