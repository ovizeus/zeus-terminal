# Indicator Picker — Search + Live Usage Count — Design

**Date:** 2026-06-20
**Status:** Approved direction (operator). Two enhancements to the indicator picker box. UI + a small read-only/telemetry server store. Never touches brain/trading/signals.

## Goal

Two useful additions to the indicator picker (the box that opens at the top with all indicators):
1. **🔍 Search** — a search field at the top to find an indicator by name (the list is long and hard to scan).
2. **🌍 Live usage count** — by each indicator's logo, show how many users currently use that indicator globally (TradingView-style social proof). Real live count, grows organically. **0 → badge hidden.**

## Key finding (drove the Feature-2 design)

The active on/off state of indicators is **NOT persisted server-side** in any aggregatable form. The client keeps it in `USER_SETTINGS.indicators` (a `{id: bool}` dict, config.ts:1915/2053) → localStorage. The server's `user_settings` blob and `user_ctx_data` sections hold only `indSettings` (indicator *parameters*), not the on/off set. (What looked like server-restored active indicators in testing were just the `def:true` defaults.)

→ Therefore the live count needs a **lightweight client→server report** of each user's active set. This is the only added plumbing; the count is still real and live.

## Feature 1 — Search (client-only)

- Add a search `<input>` at the top of the picker. On input, filter the rendered indicator items by a case-insensitive substring match against `name` + `desc` + `cat` (the `INDICATORS` meta in config.ts already has these). Empty query → show all. A small ✕ clears it.
- Pure client. A pure helper `_indMatchesQuery(ind, query)` (TDD) decides match; the render loop hides non-matching items.
- Lives in the picker render (`renderActBar` in indicators.ts) + a little CSS. No server involvement.

## Feature 2 — Live usage count

### Server store (new, tiny, telemetry-safe)
- New SQLite table `indicator_usage(user_id INTEGER, indicator_id TEXT, updated_at INTEGER, PRIMARY KEY(user_id, indicator_id))` — one row per (user, currently-active indicator). Additive migration.
- `POST /api/indicators/active` — body `{ active: ["ema","rsi",...] }` (the user's currently-active indicator ids). Handler replaces that user's rows: delete the user's existing rows, insert the current active set with `updated_at=now`. Auth = the normal session (req.user.id). Validates ids against the known `INDICATORS` id set (ignore unknown). Never touches trading/brain.
- `GET /api/indicators/usage` — returns `{ ema: 3, rsi: 5, ... }`: for each indicator id, **count of DISTINCT users** whose row is "live". **Live = `updated_at` within the last 30 days** (so dead/abandoned accounts drop out and the number reflects current usage). Cached in-memory ~60s (changes slowly; avoids re-aggregating per open). Aggregate only — no user identities returned.

### Client
- On indicator toggle (`togInd`) and on initial load (`initActBar`), the client reports its active set via `POST /api/indicators/active` — **debounced ~2s** (coalesce rapid toggles into one request). Fire-and-forget; failure is silently ignored.
- When the picker opens, fetch `GET /api/indicators/usage` (and on a light interval while open). Store the counts; the render shows a small badge next to each indicator's logo with the count. **Count 0 or missing → no badge** (hidden, per operator).
- A pure helper `_usageBadge(count)` (TDD) → returns the badge text/null (null when ≤0).

## Data flow

```
toggle indicator → debounced POST /api/indicators/active {active:[...]} → server upserts indicator_usage rows for this user
picker opens → GET /api/indicators/usage → {id:count} (distinct live users per id, cached 60s) → render badge by each logo (hidden if 0)
search box → _indMatchesQuery filters the visible items (client-only, instant)
```

## Error handling (fail-safe)
- Usage endpoint down / fetch fails → badges simply don't render; the picker + search work normally (search is client-only).
- Report POST fails → ignored (the user's own usage just isn't counted until the next successful report); no UI impact.
- Server handlers wrapped; never throw into the request path; never touch brain/trading tables.

## Testing
- Unit (client, vitest): `_indMatchesQuery` (matches on name/desc/cat, case-insensitive, empty=all); `_usageBadge` (null for 0/negative, text for ≥1).
- Unit (server, jest): the usage aggregator — counts distinct users per id, excludes rows older than 30 days, ignores unknown ids. The `POST /active` upsert — replaces the user's set (old rows gone, new set present). Run as `sudo -u zeus`.
- Headless: open picker → search filters the list; with seeded `indicator_usage` rows, badges show the right counts; indicators with 0 users show no badge; 0 page/console errors.

## Files
- Create: `server/routes/indicators.js` (or extend an existing market/ui route) — `POST /active` + `GET /usage` + the aggregator (pure, exported for test). Migration for `indicator_usage` table.
- Modify: `client/src/engine/indicators.ts` (`renderActBar`) — search input + per-item usage badge + `_indMatchesQuery` + `_usageBadge` (pure helpers, exported for test).
- Modify: `client/src/ui/dom2.ts` (`togInd`) + `initActBar` — debounced report of the active set.
- Modify: `client/src/app.css` — search box + badge styles.
- Bump `server/version.js`.

## Out of scope (YAGNI)
- "Ever used" / historical counts (operator chose real live = currently-active users).
- Per-indicator trending/sparklines of usage over time.
- Showing WHO uses an indicator (privacy — aggregate only).
- Search by fuzzy/typo tolerance (simple substring is enough).

## Decisions (operator)
Real **live** count (distinct currently-active users, 30-day liveness). **0 → badge hidden.** Search filters by name (+desc/cat).
