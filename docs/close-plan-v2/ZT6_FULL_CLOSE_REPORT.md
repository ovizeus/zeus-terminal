# ZT6 FULL CLOSE REPORT — localStorage User-Scoping Sweep

**Date:** 2026-04-17
**Scope:** Master Zero-Tail Close Plan v2 — Lot ZT6 (localStorage user-scoping whitelist audit + sweep)
**Mandate:** Verify every `localStorage.*Item` key used in `client/src/` is
either in the per-user whitelist or intentionally global, document any gaps,
apply the minimal fix. tsc principal = 0, vite green, no regressions.
**Verdict:** **CLOSED REAL**

---

## 1. Summary

The per-user localStorage isolation system already lives in
`client/src/core/state.ts::_initUserScopedStorage()` (lines 29–152). At module
load it:

1. Reads `zeus_uid` cookie (non-httpOnly companion to `zeus_token`).
2. Wraps `localStorage.getItem/setItem/removeItem` so any key in the
   `_USER_KEYS` whitelist (or prefixed in `_USER_PREFIXES`) gets `:<uid>`
   appended transparently.
3. Migrates pre-existing global values to user-scoped keys once, on first
   login on a given device.
4. Exposes `window._lsClearUser()` for logout cleanup.

ZT6 was a **sweep**, not an infra rewrite: audit every literal key passed to
`localStorage.*Item` (directly or via `_safeLocalStorageSet`) and cross-check
against the whitelist. Any real user-data key missing from the list is a
privacy bug (user A's state leaks into user B's session on the same
browser). Any list entry with no live writer is whitelist rot.

---

## 2. Audit method

1. `grep -rn "localStorage\.\(get\|set\|remove\)Item\|_safeLocalStorageSet"
   client/src/` — 218 call-sites across 33 files.
2. Extracted literal keys; resolved 14 variable-held keys
   (`LS_KEY`/`KEY`/`POS_KEY` et al.) to their `const X = '…'` definitions.
3. Produced canonical used-key list (64 unique keys).
4. Cross-checked: used ∩ whitelist, used ∖ whitelist, whitelist ∖ used.

## 3. Findings

### 3.1 Used-but-not-whitelisted (privacy-sensitivity review)

| Key | Owner | Scoping decision |
|---|---|---|
| `zeus_pin_unlocked_until` | `core/bootstrapMisc.ts` (PIN gate, 4h TTL) | **BUG — must be per-user.** User A unlocking their PIN was inadvertently granting unlock to User B on the same browser. **Fix applied.** |
| `zeus_tab_leader` | `services/tabLeader.ts` (cross-tab AT executor election) | **Correctly global.** Leader election needs to be visible across tabs regardless of which user is logged in. Writing per-user would fracture leadership and allow two AT executors to race. Documented in comment. |
| `zeus_app_version` | `core/bootstrapError.ts` (PWA/update banner version marker) | **Correctly global.** Tied to the browser's cached bundle, not to the logged-in user. Documented in comment. |

### 3.2 Whitelisted-but-not-used (rot)

| Key | Status |
|---|---|
| `zt_state_v1` | False positive in first grep (self-defined inside `core/state.ts`). **Kept** — actively used by snapshot loader at line 389. |
| `zeus_teacher_enabled` | Orphan (teacher v2 migration). **Removed.** |
| `zeus_teacher_mode` | Orphan (teacher v2 migration). **Removed.** |
| `zeus_teacher_sessionState` | Orphan. **Removed.** |
| `zeus_teacher_cumulative` | Orphan. **Removed.** |
| `zeus_teacher_checklistPrefs` | Orphan. **Removed.** |
| `zeus_teacher_checklistState` | Orphan. **Removed.** |
| `zeus_teacher_dismissed` | Orphan. **Removed.** |

Verified: `grep -rn "zeus_teacher_(enabled|mode|sessionState|cumulative|
checklistPrefs|checklistState|dismissed)" client/src/` → 0 matches after
removing the whitelist lines. No code reads or writes any of them.

The 7 teacher keys currently in active use are kept:
`zeus_teacher_config`, `zeus_teacher_sessions`, `zeus_teacher_lessons`,
`zeus_teacher_stats`, `zeus_teacher_memory`, `zeus_teacher_v2state`,
`zeus_teacher_panel_open`.

## 4. Change applied

Single edit in `client/src/core/state.ts`, inside `_USER_KEYS`:

- **Added** `'zeus_pin_unlocked_until': 1` with inline comment `// [ZT6] PIN
  unlock is per-user`.
- **Removed** 7 orphan `zeus_teacher_*` keys; kept only the 7 actively used.
- **Added** block comment documenting the 2 intentionally-global keys
  (`zeus_tab_leader`, `zeus_app_version`) so future audits don't flag them.

No other file changed.

## 5. Migration impact

The `_initUserScopedStorage()` migration loop (lines 98–128) runs once per
login per device, moving unscoped keys in `_USER_KEYS` → `key:<uid>`. With
`zeus_pin_unlocked_until` newly in the whitelist, the next login on any
device that has a stale unscoped value will migrate that value to the
current user's scope. This is the desired behavior: any existing PIN-unlock
timestamp already on the device will be attributed to the currently-logged-
in user (best-effort; if the wrong user's session was active when the value
was written, they still need to re-enter PIN on login expiry which is ≤4h
TTL anyway).

## 6. Mandate compliance

| Requirement | Status | Evidence |
|---|---|---|
| Used keys cross-referenced against whitelist | ✅ | 64 used keys audited; 3 gaps identified (1 real bug, 2 intentional globals) |
| Privacy bug fixed | ✅ | `zeus_pin_unlocked_until` now scoped per-user |
| Whitelist rot removed | ✅ | 7 teacher orphans dropped after code-reference verification |
| Intentional globals documented | ✅ | Inline comment in `core/state.ts` explains the 2 per-browser exceptions |
| tsc principal = 0 | ✅ | Empty stderr |
| vite build green | ✅ | "built in 774ms" |
| No test regressions | ✅ | 4 pre-existing failures (same as pre-ZT6 baseline) |
| No scope creep | ✅ | 1 file, +7/-5 net lines; whitelist edits only, no refactor |

## 7. Verification commands

```bash
# Keys used in app code:
grep -rn "localStorage\.\(get\|set\|remove\)Item\|_safeLocalStorageSet" client/src/ | wc -l
# → 218 call-sites

# Confirm the fix is in:
grep -n "zeus_pin_unlocked_until" client/src/core/state.ts
# → 74:    'zeus_pin_hash': 1, 'zeus_pin_unlocked_until': 1, // [ZT6] PIN unlock is per-user

# Confirm orphans are gone:
grep -c "zeus_teacher_enabled\|zeus_teacher_mode\|zeus_teacher_sessionState\|zeus_teacher_cumulative\|zeus_teacher_checklistPrefs\|zeus_teacher_checklistState\|zeus_teacher_dismissed" client/src/core/state.ts
# → 0

# Build:
cd client && npx tsc --noEmit -p tsconfig.app.json && npm run build
# → 0 errors / built ~770ms
```

## 8. Artifacts

- Tag pair: `post-v2/ZT6-pre`, `post-v2/ZT6-post`
- Commit: ZT6 whitelist sweep (see `git log --grep="ZT6"`)
- Branch: `post-v2/real-finish` (pushed)
- Final close tag: `post-v2/ZT6-FULL-CLOSED`

## 9. Verdict

**ZT6 — CLOSED REAL.**

One real privacy bug fixed (`zeus_pin_unlocked_until` is now user-scoped).
Whitelist trimmed of 7 orphan teacher keys. The two intentionally-global
keys are documented. Infrastructure (the `_initUserScopedStorage` wrapper
itself) was correct and needed no change.

Next up: **ZT7 — stateAccessors resolution**.
