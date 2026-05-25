# Server-Authoritative Positions — Eliminate AT/Manual Misclassification

> **Status:** PLAN — awaiting operator approval before ANY code
> **Priority:** HIGH — bug reported 3+ times, 5 loss vectors identified
> **Risk:** Real money misclassification if done wrong

## Problem

AT positions appear in Manual Trade panel. 5 identified loss vectors where `autoTrade` flag gets lost between server → client:

| Vector | Location | Mechanism | Fixed by this plan? |
|--------|----------|-----------|-------------------|
| #1 | `_normalizePositionRow` server | autoTrade undefined + sourceMode null → false | ✅ YES — server always has autoTrade |
| #2 | WS reconnect race | `/api/at/state` vs `at_update` race | ✅ YES — single source, no merge |
| #3 | `_mapServerPos` client | Server omits field + no existing → DEFAULT FALSE | ✅ YES — server positions are canonical |
| #4 | Boot race | liveApiSyncState before _lastServerPositions | ✅ YES — no liveApiSyncState for positions |
| #5 | ManualTradePanel filter | null/undefined autoTrade = manual | ✅ YES — server always provides boolean |

**ALL 5 VECTORS ELIMINATED** by making server the sole position source.

## Architecture Change

```
BEFORE (broken):
  Server AT → _positions[] (has autoTrade)
  Client liveApi → Binance getPositions() (NO autoTrade)
  Client MERGES both → autoTrade lost in merge race
  ManualTradePanel reads merged → misclassified

AFTER (fix):
  Server AT → _positions[] (has autoTrade) → WS push to client
  Client reads ONLY server WS state for position list
  Binance getPositions() used ONLY for mark price + uPnL update
  ManualTradePanel reads server-authoritative → always correct
```

## Feature Flag

```javascript
// migrationFlags.js
SERVER_AUTHORITATIVE_POSITIONS: false  // default OFF — flip after shadow soak
```

When `true`: client position list = server WS `state.livePositions` + `state.demoPositions`
When `false`: client position list = legacy liveApi merge (current behavior)

## Shadow Mode Design

When flag is `false` (pre-cutover):
1. Server positions arrive via WS `at_update` → stored in `_shadowPositions`
2. Legacy liveApi merge runs as before → stored in `TP.livePositions`
3. Every 10s: compare `_shadowPositions` vs `TP.livePositions`
4. Log divergences: `{ symbol, side, shadowAutoTrade, legacyAutoTrade, match: bool }`
5. After 48h of zero divergences → flip flag to `true`

When flag is `true`:
- `TP.livePositions` = server WS positions directly
- liveApi `getPositions()` still called BUT only for mark price + uPnL enrichment
- Position creation/close = server only
- autoTrade classification = server only (NEVER from client merge)

## Test Matrix

| Scenario | What to verify | How |
|----------|---------------|-----|
| AT entry DEMO | autoTrade=true, appears in AT section NOT manual | Brain opens position → check UI |
| AT entry TESTNET | autoTrade=true, appears in AT section NOT manual | Brain opens on testnet → check UI |
| Manual entry TESTNET | autoTrade=false, appears in Manual section | User places manual → check UI |
| Boot / PM2 reload | All positions retain correct autoTrade after reload | PM2 reload → check positions |
| WS reconnect | Positions re-classify correctly on reconnect | Kill WS → auto-reconnect → check |
| Mixed AT + Manual | Both types visible in correct panels simultaneously | Open 1 AT + 1 manual → check |
| Position close | Close removes from correct panel | Close AT → gone from AT panel |
| Exchange position not in server | Reconciliation handles it (RECON_PHANTOM) | Close on exchange → check server |

## Files To Be Modified

| File | Change | Risk |
|------|--------|------|
| `server/migrationFlags.js` | Add SERVER_AUTHORITATIVE_POSITIONS flag | LOW |
| `data/migration_flags.json` | Add flag = false | LOW |
| `client/src/core/state.ts` | Store server positions separately when flag ON | MEDIUM |
| `client/src/trading/liveApi.ts` | When flag ON: use server positions, exchange only for prices | HIGH |
| `client/src/stores/positionsStore.ts` | Source positions from server state when flag ON | MEDIUM |
| `client/src/components/dock/ManualTradePanel.tsx` | No change needed (filter stays `autoTrade !== true`) | NONE |

## What We Do NOT Change

- Server `serverAT.js` — already correct (has autoTrade on all positions)
- Server WS push — already sends positions with autoTrade
- ManualTradePanel filter logic — already correct (`autoTrade !== true`)
- Exchange order execution — stays in liveApi (signed requests)
- Position PnL calculation — stays client-side (needs live mark price)

## Rollback

1. Flip `SERVER_AUTHORITATIVE_POSITIONS = false` → instant revert to legacy
2. PM2 reload → client uses old merge path
3. Zero data loss (server positions unchanged, DB unchanged)

## Backup Before Start

```bash
git tag pre-srv-pos-$(date +%Y%m%d-%H%M)
cp data/zeus.db data/zeus.db.pre-srv-pos
git push --tags
```

## Execution Order

1. Add feature flag (migrationFlags + JSON) — commit
2. Add shadow mode logging in state.ts — commit
3. Deploy shadow mode, monitor 1h for divergences
4. If clean: modify liveApi.ts position source when flag ON — commit
5. Deploy with flag OFF, verify shadow logs
6. Flip flag ON, verify UI
7. Monitor 48h
8. If green: remove legacy path + shadow mode (cleanup)

## TODO (separate, post-soak)

- [ ] Cleanup gateway fallback paths in marketFeed.js + marketRadar.js (try-catch direct fetch)
- [ ] Remove shadow mode after 48h soak green
- [ ] Remove legacy liveApi position merge after confirmed stable
