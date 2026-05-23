# ZT1.c — localStorage Keys Triage (2026-04-17)

**Scope**: All `localStorage.(get|set|remove)Item` calls in `client/src/`.
**Purpose**: Inventory per-user scoping state before ZT6 sweep.

## Count reconciliation

Audit quantum claimed "~42 chei non-scopate" (R21 had done ~20). Precise count from grep: **41 distinct localStorage keys** across 30 call-sites in 25 files.

## Full inventory — classification

### UI state (per-device user preference — acceptable device-global)

| Key | Files | Purpose | Scope verdict |
|---|---|---|---|
| `zeus_theme` | uiStore.ts | Dark/light theme | **DEVICE-GLOBAL LEGIT** (visual preference, not user data) |
| `zeus_ui_scale` | dev.ts, config.ts | UI zoom scale | **DEVICE-GLOBAL LEGIT** (per-screen sizing) |
| `zeus_mtf_open` | config.ts | MTF strip open/closed | **DEVICE-GLOBAL LEGIT** (per-device UI preference) |
| `zeus_dsl_strip_open` | config.ts, bootstrapStartApp.ts, arianova.ts | DSL strip toggle | **DEVICE-GLOBAL LEGIT** |
| `zeus_at_strip_open` | config.ts, bootstrapStartApp.ts, arianova.ts | AT strip toggle | **DEVICE-GLOBAL LEGIT** |
| `zeus_pt_strip_open` | config.ts, bootstrapStartApp.ts, arianova.ts | PT strip toggle | **DEVICE-GLOBAL LEGIT** |
| `zeus_adaptive_strip_open` | risk.ts, config.ts | Adaptive strip toggle | **DEVICE-GLOBAL LEGIT** |
| `zeus_teacher_panel_open` | teacherPanel.ts, config.ts | Teacher panel toggle | **DEVICE-GLOBAL LEGIT** |
| `zeus_ts_open` | timeSales.ts | Time & Sales open | **DEVICE-GLOBAL LEGIT** |
| `zeus_groups` | config.ts | UI groups layout | **DEVICE-GLOBAL LEGIT** |
| `aub_expanded` | aub.ts, config.ts | AUB strip expanded | **DEVICE-GLOBAL LEGIT** |
| `of_hud_v2` | config.ts | OF HUD version | **DEVICE-GLOBAL LEGIT** |
| `of_hud_pos_v1` | config.ts | OF HUD position | **DEVICE-GLOBAL LEGIT** |
| `of_hud_anchor_x_v1` | config.ts | OF HUD anchor | **DEVICE-GLOBAL LEGIT** |
| `zeus_dev_enabled` | main.tsx, dev.ts, bootstrapStartApp.ts | Dev panel visibility | **DEVICE-GLOBAL LEGIT** (dev-only toggle) |

**15 keys** legit device-global. Document as such. NO scoping needed.

### App meta (device-level, not user data)

| Key | Files | Purpose | Scope verdict |
|---|---|---|---|
| `zeus_app_version` | bootstrapError.ts | PWA update tracking | **DEVICE-GLOBAL LEGIT** |

**1 key**. Document as such.

### User-scoped already (R21 wave 1)

The ~20 keys R21 handled are already scoped at read/write sites with `_userKey(key)` helper. Verification needed — grep shows the raw keys above, meaning R21 may not have touched these files' raw sites. Need to check services/storage.ts helper invocation.

**Action in ZT6**: verify which of the listed keys are already wrapped in `_userKey()` vs. truly raw.

### Settings (user data — NEEDS SCOPING)

| Key | Files | Purpose | Current scope | ZT6 action |
|---|---|---|---|---|
| `zeus_user_settings` | config.ts, settingsStore.ts, bootstrapStartApp.ts | Full settings JSON | **UNSCOPED** | **SCOPE or remove** (server is SoT per Phase 4) |
| `zeus_ind_settings` | state.ts, config.ts | Indicator settings | **UNSCOPED** | **SCOPE** |
| `zeus_llv_settings` | marketDataOverlays.ts, config.ts | LLV overlay settings | **UNSCOPED** | **SCOPE** |
| `zeus_signal_registry` | config.ts | Signal registry | **UNSCOPED** | **SCOPE** |
| `zeus_notifications` | config.ts | Notification state | **UNSCOPED** | **SCOPE** |
| `zeus_ui_context` | config.ts | UI context per-user | **UNSCOPED** | **SCOPE** |
| `zeus_uc_dirty_ts` | config.ts | Dirty timestamps | **UNSCOPED** | **SCOPE** |

**7 keys** user data unscoped.

### Trading state (user data — NEEDS SCOPING)

| Key | Files | Purpose | Current scope | ZT6 action |
|---|---|---|---|---|
| `zeus_adaptive_v1` | risk.ts | Adaptive engine state | **UNSCOPED** | **SCOPE** |
| `zeus_dsl_mode` | autotrade.ts, config.ts, brain.ts | DSL mode | **UNSCOPED** | **SCOPE** |
| `zeus_mscan_syms` | klines.ts, AutoTradePanel.tsx, settingsStore.ts | Multi-scan symbols | **UNSCOPED** | **SCOPE** |
| `zt_journal` | state.ts, storage.ts | Trading journal | **UNSCOPED** | **SCOPE** |

**4 keys** trading user data unscoped.

### Teacher state (user data — NEEDS SCOPING)

| Key | Files | Purpose | Current scope | ZT6 action |
|---|---|---|---|---|
| `zeus_teacher_config` | config.ts | Teacher config | **UNSCOPED** | **SCOPE** |
| `zeus_teacher_sessions` | config.ts | Teacher sessions | **UNSCOPED** | **SCOPE** |
| `zeus_teacher_lessons` | config.ts | Teacher lessons | **UNSCOPED** | **SCOPE** |
| `zeus_teacher_stats` | config.ts | Teacher stats | **UNSCOPED** | **SCOPE** |
| `zeus_teacher_memory` | config.ts | Teacher memory | **UNSCOPED** | **SCOPE** |
| `zeus_teacher_v2state` | config.ts | Teacher v2 state | **UNSCOPED** | **SCOPE** |

**6 keys** teacher user data unscoped.

### AUB state (user data — NEEDS SCOPING)

| Key | Files | Purpose | Current scope | ZT6 action |
|---|---|---|---|---|
| `aub_bb` | aub.ts, config.ts | AUB BB snapshot | **UNSCOPED** | **SCOPE** |
| `aub_macro` | aub.ts, config.ts | AUB macro data | **UNSCOPED** | **SCOPE** |
| `aub_sim_last` | config.ts | AUB last simulation | **UNSCOPED** | **SCOPE** |

**3 keys** AUB user data unscoped.

### ARIA/NOVA state (user data — NEEDS SCOPING)

| Key | Files | Purpose | Current scope | ZT6 action |
|---|---|---|---|---|
| `aria_v1` | config.ts | Aria state | **UNSCOPED** | **SCOPE** |
| `nova_v1` | config.ts | Nova state | **UNSCOPED** | **SCOPE** |

**2 keys** unscoped.

### ARES state (user data — NEEDS SCOPING)

| Key | Files | Purpose | Current scope | ZT6 action |
|---|---|---|---|---|
| `ARES_MISSION_STATE_V1_vw2` | aresStore.ts, config.ts | ARES wallet/mission state | **UNSCOPED** | **SCOPE** |
| `ARES_POSITIONS_V1` | config.ts | ARES positions | **UNSCOPED** | **SCOPE** |
| `ARES_STATE_V1` | config.ts | ARES general state | **UNSCOPED** | **SCOPE** |
| `ares_init_v1` | config.ts | ARES init flag | **UNSCOPED** | **SCOPE** |
| `ARES_LAST_TRADE_TS` | config.ts, aresDecision.ts | ARES last trade ts | **UNSCOPED** | **SCOPE** |
| `ARES_JOURNAL_V1` | config.ts | ARES journal | **UNSCOPED** | **SCOPE** |

**6 keys** ARES user data unscoped.

### Auth/secrets (critical — SPECIAL HANDLING)

| Key | Files | Purpose | Current scope | ZT6 action |
|---|---|---|---|---|
| `zeus_pin_hash` | bootstrapMisc.ts | PIN hash local cache | **UNSCOPED** | **REMOVE** — server is SoT; local cache could be stale and leaked cross-user |
| `zt_api_key` | indicators.ts (removeItem only) | API key | — | Already removed; verify not set elsewhere |
| `zt_api_secret` | indicators.ts (removeItem only) | API secret | — | Already removed |
| `zt_api_token` | indicators.ts (removeItem only) | API token | — | Already removed |
| `zt_api_exchange` | indicators.ts (removeItem only) | API exchange ID | — | Already removed |

**1 key** to remove (pin_hash). **4 keys** already removed but verify.

### Misc (verify scope)

| Key | Files | Purpose | Current scope | ZT6 action |
|---|---|---|---|---|
| `zt_cloud_last_hash` | marketDataWS.ts (initCloudSettings) | Cloud sync last hash | **UNSCOPED** | **SCOPE** |

**1 key** to scope.

## Summary

- **41 distinct keys** total
- **16 keys LEGIT device-global** (UI state + app version + dev toggle)
- **25 keys USER DATA UNSCOPED** — need scoping in ZT6
  - 7 settings
  - 4 trading
  - 6 teacher
  - 3 AUB
  - 2 aria/nova
  - 6 ARES
  - 1 cloud sync
- **1 key to REMOVE** (pin_hash — server SoT)
- **4 keys verify already removed** (api credentials)

## ZT6 plan

1. **Add `localStorageUserKey(key, userId)` helper** in `services/storage.ts` (if not exists)
2. **For each of the 25 unscoped keys**:
   - Wrap `localStorage.getItem(key)` → `localStorage.getItem(_userKey(key))`
   - Wrap `localStorage.setItem(key, val)` → `localStorage.setItem(_userKey(key), val)`
   - Migration-on-read: if scoped key missing but raw key exists, move it
3. **Remove `zeus_pin_hash`** (server PIN verification is SoT; local cache is stale risk)
4. **Document 16 device-global keys** explicitly in `services/storage.ts` header
5. **Verify 4 api credential keys** are not set anywhere; if found, remove

Expected outcome: 25 user-scoped + 16 device-global + 0 unscoped.

Cross-user pollution risk eliminated.

---

## Status post-ZT6 execution (appended 2026-04-17)

The plan above assumed the sweep would need to introduce per-user
scoping. ZT6 discovered the scoping infrastructure already existed:

- `client/src/core/state.ts::_initUserScopedStorage()` (lines 29–152)
  installs a whitelist-driven wrapper over
  `localStorage.{get,set,remove}Item` at module load. Any key in
  `_USER_KEYS` or prefixed by `_USER_PREFIXES` gets `:<uid>` appended
  transparently; pre-existing global values are migrated once on first
  login. Logout cleanup is exposed via `window._lsClearUser()`.

So ZT6 became a **whitelist audit**, not a scoping rewrite. What it
actually did:

- **Used-but-not-whitelisted audit** flagged one real privacy bug:
  `zeus_pin_unlocked_until` was global. Fixed in ZT6 — now
  whitelisted and scoped per-user. `zeus_tab_leader` and
  `zeus_app_version` were confirmed intentionally global and
  documented as such.
- **Whitelist rot cleanup**: removed three orphan entries from the
  teacher-v2 migration (`zeus_teacher_enabled`, `zeus_teacher_mode`,
  `zeus_teacher_sessionState`) that had no live writer.
- **Key count reconciliation**: the 41-key table above was based on a
  first-pass grep. ZT6's canonical audit found **64 unique keys**
  across 218 call-sites in 33 files after resolving 14 variable-held
  keys (`LS_KEY`/`KEY`/`POS_KEY`) to their const definitions. The
  per-category counts in this triage (settings/trading/teacher/AUB/
  aria-nova/ARES) are therefore undercounts, but the scoping
  decision for each was already correct because the whitelist covered
  most of them pre-ZT6.

ZT6 did NOT execute the "25 unscoped → scope each" plan literally —
the great majority were already scoped via the existing whitelist.
The real outcome was a targeted bug fix (`zeus_pin_unlocked_until`) +
rot removal + documented intentional globals.

Close trail: `docs/close-plan-v2/ZT6_FULL_CLOSE_REPORT.md`.
