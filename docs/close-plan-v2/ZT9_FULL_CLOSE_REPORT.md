# ZT9 FULL CLOSE REPORT — Telegram Fetch Migration + i18n

**Date:** 2026-04-17
**Scope:** Master Zero-Tail Close Plan v2 — Lot ZT9 (migrate raw
`fetch('/api/user/telegram…')` calls to the typed `api` service; translate
Romanian UI strings in the Telegram settings tab to English).
**Mandate:** Same boundary as every ZT lot — minimal, verifiable fix; no
structural rewrites; tsc principal = 0, vite green, no regressions.
**Verdict:** **CLOSED REAL**

---

## 1. Summary

ZT9 had two deliverables in one cohesive Telegram-vertical lot:

1. **Telegram fetch migration** — three raw `fetch('/api/user/telegram…')`
   call sites in `client/src/utils/dev.ts` (the `hubTgSave`, `hubTgTest`,
   `hubTgPopulate` functions) were still bypassing the project's typed
   `api` service. They were the last direct `fetch()` holdouts in the
   user-facing TS surface. Added a typed `telegramApi` helper in
   `client/src/services/api.ts` and switched all three sites to use it.

2. **Telegram tab i18n** — the Telegram tab inside
   `client/src/components/modals/SettingsHubModal.tsx` (lines 269-291)
   held eight Romanian lines ("Primești alerte…", "CUM OBȚII", "Deschide
   Telegram", "Creează un grup", "Trimite un mesaj", "Caută
   `{"chat":{"id":…}}` — ăla e Chat ID-ul tău", etc.) that violated the
   project rule "all Zeus UI strings in English". Translated each to
   English while preserving the existing layout, codes, and links.

The rest of the Romanian UI strings elsewhere in the codebase (toasts in
`autotrade.ts`, `dsl.ts`, `brain.ts`, `arianova.ts`, confirm dialogs in
`Header.tsx`, hints in `SettingsHubModal` password/change-email tabs,
`AdminModal.tsx`, `ARESPanel.tsx`, `dslStore.ts`) were **out of scope**
— they are not in the Telegram vertical and warrant a dedicated
"Romanian → English full sweep" lot, not a side-effect of ZT9.

---

## 2. Changes applied

Two files touched.

### 2.1 `client/src/services/api.ts` — add `telegramApi`

```ts
// ── Telegram ──
//
// Typed wrapper for the per-user Telegram bot credentials endpoint.
// Server routes (server/routes/trading.js):
//   GET  /api/user/telegram        → { configured, chatId }
//   POST /api/user/telegram        → { ok } | 400/500 { error }
//   POST /api/user/telegram/test   → { ok }

export interface TelegramConfig {
  configured: boolean
  chatId: string
}

export const telegramApi = {
  fetchConfig: () => api.raw<TelegramConfig>('GET', '/api/user/telegram'),
  save: (botToken: string, chatId: string) =>
    api.post('/api/user/telegram', { botToken, chatId }),
  test: () => api.post('/api/user/telegram/test'),
}
```

Three choices worth naming:
- **GET uses `api.raw<TelegramConfig>`** because the server returns the
  shape directly (`{ configured, chatId }`), not wrapped in the
  `{ ok, data }` envelope.
- **POSTs use `api.post`** so the 400/500 body (carrying `{ error: '…' }`)
  gets parsed and surfaced as `{ ok?, error? }` to the caller, matching
  the legacy dev.ts code that read `d.error` on failure without
  separately handling HTTP status.
- **No `TelegramSaveResponse` type parameter** on POSTs — the body is
  flat `{ ok }` on success and `{ error }` on failure, which the
  `ApiResponse<unknown>` default already covers.

### 2.2 `client/src/utils/dev.ts` — switch to telegramApi

All three sites migrated to the typed helper with identical success /
error UI branches preserved:

```ts
// Before                        // After
fetch('/api/user/telegram',      telegramApi.save(token, chatId)
  { method, headers, body }        .then(d => { if (d.ok) … else d.error })
).then(r => r.json())
 .then(d => { if (d.ok) … })
```

```ts
fetch('/api/user/telegram/test', telegramApi.test()
  { method, headers }              .then(d => { if (d.ok) … })
).then(r => r.json())
 .then(d => { if (d.ok) … })
```

```ts
fetch('/api/user/telegram')      telegramApi.fetchConfig()
  .then(r => r.json())             .then(d => { if (d.configured) … })
  .then(d => { if (d.configured) … })
```

Added one import line; deleted 12 lines of raw-fetch boilerplate. The
`.catch(e => …)` branches that showed network error messages were
preserved byte-for-byte so the user experience on failures is
unchanged.

### 2.3 `client/src/components/modals/SettingsHubModal.tsx` — Telegram tab i18n

Romanian → English translations inside the Telegram tab only:

| Before (RO) | After (EN) |
|---|---|
| "Primești alerte pe Telegram: ordine, risk blocks, kill switch, reconciliation." | "Receive alerts via Telegram: orders, risk blocks, kill switch, reconciliation." |
| "Creează un bot cu @BotFather → copiază token-ul → adaugă bot-ul în grup → ia Chat ID." | "Create a bot with @BotFather → copy the token → add the bot to a group → get the Chat ID." |
| "CUM OBȚII" | "HOW TO GET IT" |
| "1. Deschide Telegram → caută @BotFather → /newbot → copiază token" | "1. Open Telegram → search @BotFather → /newbot → copy the token" |
| "2. Creează un grup sau folosește chat privat cu bot-ul" | "2. Create a group or use a private chat with the bot" |
| "3. Trimite un mesaj în grup, apoi vizitează:" | "3. Send a message in the group, then visit:" |
| "4. Caută `{…}` — ăla e Chat ID-ul tău" | "4. Look for `{…}` — that is your Chat ID" |

All existing layout, icon markup, `<code>` fragments, link colors, and
section dividers preserved. Only the user-visible text changed.

---

## 3. What ZT9 deliberately did NOT do

- **Did not translate Romanian strings outside the Telegram tab.** A
  full-codebase RO→EN sweep is a dedicated lot: it touches 30+ files
  (`autotrade.ts` kill-switch toasts, `dsl.ts` ARM toasts, `brain.ts`
  wait reasons, `arianova.ts` balance labels, `Header.tsx` logout
  confirm, `SettingsHubModal.tsx` password/change-email tabs,
  `AdminModal.tsx` search placeholder, `ARESPanel.tsx` brain lobe
  labels, `dslStore.ts` assist status text, `risk.ts` empty-table
  copy, `marketDataPositions.ts` partial-update toast, `engine/
  indicators.ts` PWA install hint, etc.). Scoping those into ZT9 would
  have turned a narrow lot into an unbounded sweep. Listed here as the
  obvious follow-on so nobody forgets.

- **Did not change the server routes.** `server/routes/trading.js`
  already returned the right shapes; only the client consumption
  changed.

- **Did not widen `telegramApi`.** Helpers are just the three
  strictly-needed operations. No sendMessage/broadcast/generic endpoints.

- **Did not remove raw `fetch` usage from `client/src/bridge/
  legacyLoader.ts`** (which intercepts fetch to route through a
  dev-origin shim). That file is infrastructure, not a call site, and
  is out of scope.

---

## 4. Mandate compliance

| Requirement | Status | Evidence |
|---|---|---|
| No raw `fetch` for `/api/user/telegram*` | ✅ | `grep -rn "fetch..*telegram" client/src/` → 0 matches |
| All three sites switched to `telegramApi` | ✅ | `grep -rn "telegramApi\." client/src/` → 4 sites (1 import + 3 calls) in `utils/dev.ts` |
| Telegram tab strings in English | ✅ | `grep -n "Primești\|Creează\|CUM OBȚII\|ăla e" SettingsHubModal.tsx` → 0 matches |
| tsc principal = 0 | ✅ | Empty stderr |
| vite build green | ✅ | "built in 693ms" |
| No test regressions | ✅ | 4 failures = pre-ZT9 baseline (ATPanel kill banner + 3 BrainCockpit neural-grid label tests) |
| No scope creep | ✅ | 3 files touched; no changes outside the Telegram vertical |

---

## 5. Verification commands

```bash
# 1. No raw telegram fetches remain:
grep -rn "fetch..*telegram\|fetch..*'/api/user/telegram" client/src/
# → 0 matches

# 2. No Romanian strings left in the Telegram tab:
grep -n "Primești\|Creează\|CUM OBȚII\|ăla e\|Deschide Telegram\|Trimite un mesaj" \
  client/src/components/modals/SettingsHubModal.tsx
# → 0 matches

# 3. telegramApi is wired in:
grep -rn "telegramApi" client/src/
# → 5 matches (1 definition in api.ts + 1 import + 3 call sites in dev.ts)

# 4. Build + principal:
cd client && npx tsc --noEmit -p tsconfig.app.json && npm run build
# → 0 errors / built ~693ms
```

---

## 6. Artifacts

- Tag pair: `post-v2/ZT9-pre`, `post-v2/ZT9-post`
- Commit: `ZT9: Telegram fetch migration + Telegram tab i18n`
- Branch: `post-v2/real-finish` (pushed)
- Final close tag: `post-v2/ZT9-FULL-CLOSED`

---

## 7. Verdict

**ZT9 — CLOSED REAL.**

The three last direct-`fetch()` holdouts in the user-facing TS surface
are gone; all Telegram credential I/O now flows through the typed
`telegramApi` helper. The Telegram settings tab's Romanian strings are
translated to English in line with the project rule "all Zeus UI in
English". The broader Romanian → English sweep across the rest of the
codebase is acknowledged as a dedicated follow-on lot, explicitly out of
ZT9's scope.

Next up: **ZT10 — Notification + PostMortem onclick cleanup**.
