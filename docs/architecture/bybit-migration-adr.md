# ADR: Bybit Migration Architecture (Phase 1A+1B)

## Status: Implemented (2026-05-23)

## Context

Zeus Terminal was Binance-only. To diversify against exchange bans and support
multi-exchange trading, we implemented Bybit as the second exchange.

## Decisions

### 1. Duck-typed JS modules (NOT TypeScript interfaces)
Per existing Zeus convention. Contract tests enforce API parity.

### 2. Per-user exchange routing via _getUserExchange + exchangeOps router
Each user has one active exchange. Brain cycle resolves per-user.
Explicit barrier (_pendingSwitch + _applyPendingSwitches) prevents mid-cycle switch.

### 3. Brain loop swap: user OUTER, symbol INNER
Was: symbol -> user. Now: user -> exchange -> symbols.
Eliminates cross-exchange data contamination.
Regime broadcast keyed by ${symbol}|${exchange}.

### 4. BYBIT_DRY_RUN_ONLY throughout Phase 1A
bybitOps uses buildSignedRequestDryRun which validates but doesn't send HTTP.
Synthetic responses for full plumbing test. Phase 1E spec for live flip.

### 5. Dual DB write transitional (Option B)
binanceOps.placeEntry creates at_positions row. serverAT._persistPosition also writes.
Linked via entry.live.opsSeq. Planned removal in Phase 2.

### 6. State machine with append-only event journal
9 states, 14 valid edges. position_events never UPDATE/DELETE.
Race protection via atomic state mismatch check in transition().

### 7. Emergency close pattern: SL retry 3x -> emergency 3x -> catastrophic
If both fail: emergency_close_queue persist + setGlobalHalt + Telegram CRITICAL.

## Consequences

- Bybit users route end-to-end through canonical interfaces
- Zero regression on existing Binance flow (324 tests verify)
- Recovery boot reconciles on every PM2 restart
- Parity shadow logging always-on for divergence monitoring
