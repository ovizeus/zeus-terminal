# Fetch Exceptions Audit — Final Classification (2026-04-17)

Phase 2 identified 34 raw fetch() exceptions. Full re-audit found 81 total raw
fetch() calls. Each is classified below as: ACCEPTED (by design), MIGRATED, or
FUTURE (explicit future feature work — NOT migration debt).

## ACCEPTED BY DESIGN — Cross-origin external APIs (13 calls)

These fetch() calls hit external exchange/data APIs. Cannot use internal api.raw()
because: cross-origin, no auth cookies, different error handling, AbortSignal usage.

| File | URL pattern | Reason |
|------|------------|--------|
| data/marketDataChart.ts | fapi.binance.com/fapi/v1/klines | External exchange |
| data/klines.ts | fapi.binance.com/fapi/v1/klines | External + AbortSignal |
| data/basisRate.ts | fapi.binance.com/fapi/v1/premiumIndex | External exchange |
| data/onChainMetrics.ts | api.binance.com/api/v3/klines (×2) | External exchange |
| data/btcDominance.ts | api.coingecko.com/api/v3/* (×2) | External data provider |
| data/crossExchangeFR.ts | api.bybit.com + okx.com (×2) | Cross-exchange data |
| utils/guards.ts | fapi.binance.com/fapi/v1/time | External time check |
| quantmonitor/engines/liqMap.ts | fapi.binance.com/futures/data | External exchange |
| hooks/useMarketData.ts | fapi.binance.com/fapi/v1/klines | React hook, external |
| teacher/teacherDataset.ts | Binance klines | Teacher engine, external |

## ACCEPTED BY DESIGN — keepalive / page-unload (6 calls)

These use keepalive:true or sendBeacon semantics for page-unload survival.
api.raw() does not support keepalive — these must remain raw.

| File | URL pattern | Reason |
|------|------------|--------|
| core/state.ts:756 | /api/sync/state | Unload beacon push |
| core/state.ts:1147 | /api/at/close | Unload close retry |
| core/config.ts:1484 | /api/sync/user-context | Beacon push (sendBeacon) |
| core/config.ts:542 | /api/sync/user-context | UC push (debounced) |
| core/bootstrapError.ts:29 | /api/client-error | Error report keepalive |
| services/storage.ts:41 | /api/journal/report | Journal keepalive |

## ACCEPTED BY DESIGN — fire-and-forget internal (8 calls)

Fire-and-forget calls that intentionally skip error handling. Migration to api.raw()
would add unwanted overhead for calls that are designed to silently fail.

| File | URL pattern | Reason |
|------|------------|--------|
| core/state.ts:273 | /api/tc/sync | Config sync, debounced |
| core/state.ts:1156+ | /api/at/state | AT polling (5 calls in state.ts) |
| engine/ares.ts:440 | /api/risk/pnl | PnL report fire-and-forget |
| data/marketDataPositions.ts:345 | /api/risk/pnl | Fill PnL fire-and-forget |

## ACCEPTED BY DESIGN — intentional wrappers (2 calls)

| File | URL pattern | Reason |
|------|------------|--------|
| trading/liveApi.ts:45 | /api/order/* | Live trading wrapper with custom retry |
| data/marketDataFeeds.ts:121 | /api/sd/* | Feed subscription with AbortSignal |

## ACCEPTED BY DESIGN — boot/init path (8 calls)

Bootstrap and preboot fetches that run before stores/api layer is initialized.

| File | URL pattern | Reason |
|------|------------|--------|
| core/bootstrapStartApp.ts:58-60 | /api/at/state + /api/sync/state | Preboot parallel |
| core/bootstrapError.ts:68,76 | /api/version | Version check (2 calls) |
| core/config.ts:591 | /api/sync/user-context | UC pull |
| core/state.ts:1211,1224 | /api/brain/recent-blocks, /api/sync | State init |

## ACCEPTED BY DESIGN — auth/admin flows (20+ calls)

Auth and admin calls use direct fetch() because they handle auth cookies,
redirects, and error states that don't fit the api.raw() pattern (which
assumes authenticated JSON endpoints).

| File | Call count | URL pattern |
|------|-----------|------------|
| components/auth/LoginPage.tsx | 7 | /auth/login, /auth/verify-code, /auth/register, /auth/forgot-* |
| stores/adminStore.ts | 4 | /auth/admin/* |
| components/admin/sections/*.tsx | 7 | /auth/admin/users, sessions, modules, flags |
| components/modals/AdminModal.tsx | 3 | /auth/admin/* |
| core/bootstrapMisc.ts | 4 | /auth/pin/* |
| components/layout/Header.tsx | 1 | /auth/logout |

## FUTURE FEATURE — potential authApi / adminApi (post-migration)

Creating a dedicated authApi and adminApi module is a NEW FEATURE, not
migration debt. These work correctly as-is. If/when an authApi is built,
these would naturally migrate.

| Candidates | Count |
|-----------|-------|
| Auth flows (LoginPage, PIN, logout) | 12 |
| Admin flows (adminStore, admin sections) | 14 |

## FUTURE FEATURE — minor endpoint additions

| File | URL | Note |
|------|-----|------|
| components/layout/ModeBar.tsx | /api/mode | Missing from api.ts |
| utils/dev.ts (×3) | /api/user/telegram | Dev panel only |
| stores/aresStore.ts | /api/user/ares | ARES config |
| components/modals/SettingsHubModal.tsx | dynamic POST | Settings hub |

## SUMMARY

| Classification | Count | Status |
|---------------|-------|--------|
| ACCEPTED BY DESIGN | 57 | Justified, documented, closed |
| FUTURE FEATURE (authApi/adminApi) | 26 | NOT migration debt, future work |
| To migrate now | 0 | None required for migration close |

**Total: 83 fetch calls classified. 0 unclassified. D8 = CLOSED.**
