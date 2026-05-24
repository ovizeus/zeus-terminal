# Radar D2 + D4: Per-Timeframe Metrics + Lens Persistence

> **Status:** APPROVED 2026-05-25
> **Operator:** Ovi (wsov2@protonmail.com)
> **Note:** D1, D3, D5, D6 verified DONE or SKIPPED. Only D2 + D4 remain.

## D2: Per-Timeframe Real Kline Metrics

**Current:** Scanner uses 1-min ring buffer ticks with offset-based lookback (TICKS_1H=60, TICKS_4H=240). No real per-TF kline data.

**New:** Pull real klines from serverState for 5 timeframes: 5m, 15m, 30m, 1h, 4h. Compute per-TF price change % using actual candle close prices.

**Implementation:**
- `marketRadar.js`: add `_computePerTfMetrics(symbol)` function
- Reads `serverState.getBarsForSymbol(symbol, tf)` for each TF
- Computes `changePct = (currentClose - prevClose) / prevClose * 100` per TF
- Adds `tfMetrics: { '5m': +0.3, '15m': -0.1, '30m': +0.8, '1h': +1.2, '4h': -2.1 }` to each RadarEvent
- Falls back to ring buffer delta if klines unavailable for a TF

**30m note:** serverState may not have 30m klines (ALT_WS_FEEDS uses 5m/1h/4h). If 30m unavailable, interpolate from 1h or skip that TF gracefully (`null` value).

## D4: Radar Lens Persistence

**Current:** `radarLens` not in SETTINGS_WHITELIST → server rejects save → lost on refresh.

**Fix:** Add `'radarLens'` to SETTINGS_WHITELIST in `server/routes/trading.js:662`.

One-line fix. Client already sends/receives this key.

## File Map

| File | Action |
|------|--------|
| `server/services/marketRadar.js` | MODIFY — add _computePerTfMetrics |
| `server/routes/trading.js` | MODIFY — add radarLens to SETTINGS_WHITELIST |
| `tests/unit/ml/radarPerTf.test.js` | CREATE |

## Constraints

- Never blocks scanner poll (try/catch on kline read)
- Falls back to ring buffer if klines missing
- 30m graceful skip if no data source
- Zero trading impact (radar is read-only)

## Testing

- `radarPerTf.test.js`: per-TF compute with mock klines, fallback on missing TF, null handling
