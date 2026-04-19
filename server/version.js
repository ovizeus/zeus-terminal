// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.21',
    build: 47,
    date: '2026-04-19',
    changelog: 'Post-v2 batch4 b47 v1.7.21 — Phase 3 (3A→3G) full-truth/ownership/render remediation + critical mode-switch hotfix + repo cleanup. (1) Phase 3A: position ownership hardened, manual render filters by sourceMode. (2) Phase 3B: logout cleanup clears legacy mirrors and resets all client stores. (3) Phase 3C: client engine mode unified to single source of truth. (4) Phase 3D: eliminated resolvedEnv legacy false truth — server now sends canonical executionEnv only, client mirrors directly null-safe. (5) Phase 3E: WS reconnect now triggers canonical AT state pull (closes up-to-30s stale window after reconnect). (6) Phase 3F: optimistic TP.liveBalance deduction mirrored to React store + catch-block reconcile via liveApiSyncState() (closes up-to-120s drift window after live-order failure). (7) Phase 3G: LOCKED visual styling — .zmb-btn-locked, .locked-hdr, .tp-exec-locked CSS rules + ManualTradePanel conditionals so live+no-creds shows orange not red/blue. (8) Hotfix mode-switch: removed legacy NO_LIVE_POSITIONS gate from preLiveChecklist — returning DEMO→same non-demo env with open positions no longer falsely blocked with "X live position(s) already open". (9) Cleanup: untracked runtime + backup artifacts (data/audit.jsonl, data/user_ctx/, data/backups/) — removed 225 stale files from index, .gitignore updated. Tests: 76/76 vitest + tsc clean + vite build OK + 72 Phase 3 harness PASS (3D 10 + 3E 19 + 3F 14 + 3G 13 + hotfix 16). Previous: batch4 b46 v1.7.20 (Phase 2C client consumer migration to canonical executionEnv).'
};
