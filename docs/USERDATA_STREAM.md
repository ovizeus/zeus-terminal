# UserDataStream — Real-Time Position/Order/Balance Updates

## Overview

Replaces 60s REST poll with <100ms WebSocket events for position changes, order fills, and balance updates.

Module: `server/services/userDataStream.js`

## Architecture

- Per-user isolation: each user gets own listenKey + WS connection
- Lifecycle: POST listenKey → WS connect → PUT refresh 25min → DELETE shutdown
- Health: `GET /api/userdatastream/health`
- Reconnect: exponential backoff 1s→30s + listenKey recreate on auth fail

## WebSocket Endpoints

| Environment | URL | Status from Hetzner DC |
|-------------|-----|----------------------|
| REAL/PROD | `wss://fstream.binance.com/ws/<listenKey>` | BLOCKED (data frames silently dropped) |
| TESTNET | `wss://stream.binancefuture.com/ws/<listenKey>` | WORKS |

Code auto-selects based on `creds.baseUrl` containing "testnet".

## Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `USERDATA_STREAM_ENABLED` | false | Master switch |
| `_USERDATA_STREAM_TESTNET_ENABLED` | false | Testnet sub-flag |
| `_USERDATA_STREAM_REAL_ENABLED` | false | Real sub-flag |

## Events Handled

| Event | Fields | Action |
|-------|--------|--------|
| `ACCOUNT_UPDATE.P[]` | symbol, positionAmt, entryPrice, unrealizedPnL | Update position state |
| `ACCOUNT_UPDATE.B[]` | asset, walletBalance | Update balance |
| `ORDER_TRADE_UPDATE` | symbol, side, orderId, avgPrice, filledQty | Log fill, update order status |
| `MARGIN_CALL` | — | Telegram alert to operator |

## Scheduler Priority

listenKey operations classified as **P1** (never rejected):
- POST `/fapi/v1/listenKey` → P1
- PUT `/fapi/v1/listenKey` → P1
- DELETE `/fapi/v1/listenKey` → P1

## Known Limitations

- Hetzner DC blocks `fstream.binance.com` WS data frames (TCP/TLS OK, data silent drop)
- REAL activation requires DC investigation or proxy solution
- Demo positions don't fire real Binance events (Zeus-internal simulation)
- REST recon kept at 5min as divergence safety net

## Rollback

```bash
# In data/migration_flags.json: set USERDATA_STREAM_ENABLED to false
pm2 reload zeus --update-env
```

Instant revert to 60s REST poll behavior.

## Test Results 2026-05-27

- TESTNET: 12 events captured, latency <100ms
- ACCOUNT_UPDATE + ORDER_FILL flowing correctly
- Health: 0 reconnects, listenKey stable
- Verified: `curl /api/userdatastream/health` shows connected=true, eventsTotal=12

## For REAL Activation (Future)

1. Test connectivity: verify `fstream.binance.com` WS data frames reach server
2. If blocked: proxy through different DC or keep REST-only for REAL
3. Flip `_USERDATA_STREAM_REAL_ENABLED=true` + PM2 reload
4. Monitor 30 min — verify ACCOUNT_UPDATE events flow (not just connect)
5. If no events after 60s connected → DC still blocks → rollback
