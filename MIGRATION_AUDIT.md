# Zeus Terminal — Client-Side Architecture Audit

## Server Migration Assessment · v122 · Read-Only Analysis

---

## EXECUTIVE SUMMARY

| Metric | Value |
|--------|-------|
| **Files audited** | 23 |
| **Total lines** | ~27,400 |
| **Global objects** | 25+ (S, BM, BRAIN, AT, TP, DSL, OF, RAW_FLOW, ARES, etc.) |
| **Module system** | NONE — all globals loaded via script tags |
| **setSymbol wrapper chain** | 16+ layers deep |
| **OF_DEBUG_SNAPSHOT patch chain** | 8+ layers (P4→P9→P10→P11→P12→P13→P14→P15) |
| **Intervals** | Managed via `Intervals.set()` singleton |
| **Server dependencies** | REST: /api/sync/*, /api/order/*, /api/exchange/*, /api/balance; WS: /ws/sync, aggTrade |
| **Estimated pure logic (node-safe)** | ~30% across all files |
| **Estimated DOM/browser-bound** | ~70% across all files |

---

## CRITICAL MIGRATION FINDINGS

### 1. setSymbol Wrapper Chain (16+ layers)

Each IIFE wraps `window.setSymbol` to add cleanup/reset logic on symbol change. Order matters:

```
Original (marketData) → AUB → OF_P1 → OF_P2 → OF_P3 → OF_P4/P5
→ VACUUM → DFLIP → ICEBERG → P7_TRAP → P8_STATE → P10_MMTRAP
→ P11_ABS_EXH → P12_SWEEP_CASCADE → P13_MAGNET → P14_VOID → P15_QUANT
```

**Migration risk**: Must preserve call order or refactor to event-based pub/sub.

### 2. OF_DEBUG_SNAPSHOT Patch Chain (8+ layers)

Each detector wraps `window.OF_DEBUG_SNAPSHOT` to add its own data:

```
Base (HUD) → P9_dp.of → P10_flow+mmTrap → P11_absorb+exh
→ P12_sweep+cascade → P13_magnet → P14_void → P15_quant
```

### 3. closeDemoPos — Touches 15+ Systems

Single function coordinates: AT.realizedDailyPnL, AT.closedTradesToday, DSL.positions, DSL._attachedIds, TP.demoPositions, TP.demoBalance, TP.demoWins/Losses, journal, ZState.syncNow,_zeusRecentlyClosed, PostMortem, _demoCloseHooks, srUpdateOutcome, ncAdd, BlockReason/kill switch.

### 4. ARES is a Complete Isolated Subsystem

ARES_WALLET → ARES_DECISION (14 rules) → ARES_EXECUTE (live orders) → ARES_MONITOR (3-phase DSL) → ARES_JOURNAL (ML dataset) → ARES_MIND (cognitive engine). BTCUSDT only, separate from AT system.

### 5. No Module System

All code loaded via `<script>` tags in index.html. Dependencies are implicit through global variable access. All exports go to `window.*`.

---

## PER-FILE AUDIT

---

### core/state.js — 658 lines

| Category | Details |
|----------|---------|
| **READS** | localStorage (`zt_*` keys), document.hidden |
| **WRITES** | `window.S` (master state: price, rsi, klines, signalData, fr, oi, symbol, mode, profile, tz, alerts, magnets, magnetBias, atr, chartTf, overlays, llvBuckets, llvSettings, heatmapSettings, bids, asks, indicators, vwapOn, oviOn, bnbOk, bybOk, liqMetrics, events, btcClusters, totalUSD/longUSD/shortUSD/cnt, zsSettings, liqFilter, sessions, activeInds, feeRate), `window.TP` (demoPositions, demoBalance, demoPnL, demoWins, demoLosses, livePositions, liveBalance, liveAvailableBalance, liveUnrealizedPnL, liveConnected, liveExchange, journal, demoOpen, liveOpen, demoSide, liveSide), `window.ZState` (save/load/syncNow/pullAndMerge/scheduleSave/_usScheduleSave), `window.ZLOG`, `window._SAFETY` |
| **DOM** | None (pure state) |
| **BROWSER_APIS** | localStorage, fetch (/api/sync/state, /api/sync/journal, /api/sync/user-context), WebSocket (/ws/sync), JSON.parse/stringify, setTimeout, performance.now |
| **CALLS** | fetch (server sync), WebSocket (cross-device), localStorage (persistence) |
| **DOM_SIDE_EFFECTS** | None |
| **PURE_LOGIC_PCT** | ~40% (merge logic, state shape definitions, delta computation) |
| **CAN_RUN_IN_NODE** | State shape YES; ZState sync logic YES with fetch/WS stubs; localStorage persistence needs adapter |

---

### core/config.js — 1893 lines

| Category | Details |
|----------|---------|
| **READS** | localStorage (`zt_bm_*`, `zt_at_*`, `zt_perf_*`, `zt_risk_state`), S.*, BRAIN.* |
| **WRITES** | `window.BM` (confluenceScore, confMin, mode, profile, runMode, protectMode, gates, entryScore, mtf, sweep, flow, qexit, probScore, macro, adapt, positionSizing, regimeEngine, phaseFilter, atmosphere, structure, volBuffer, volRegime, liqCycle, danger, dangerBreakdown, conviction, convictionMult, core, performance, adaptive, dailyPnL, newsRisk, lossStreak, riskState, _dayKey, dailyTrades, regime), `window.BRAIN` (state, score, regime, regimeAtrPct, regimeConfidence, regimeSlope, thoughts, neurons, ofi, tickerQueue, adaptParams,_safetyCache, _ctxCache), `window.DSL`, `window.PERF`, `window.DAILY_STATS`, `window.DHF`, `window.MSCAN`, `window.BEXT`, `window.ZANIM`, `window.IND_SETTINGS`, `window.INDICATORS`, `window.DEV`, `window.FetchLock`, `window.BlockReason`, `window.AP` |
| **DOM** | None (pure config/global init) |
| **BROWSER_APIS** | localStorage |
| **CALLS** | localStorage.getItem/setItem |
| **DOM_SIDE_EFFECTS** | None |
| **PURE_LOGIC_PCT** | ~85% (all config shape definitions, indicator settings, FEE_MODEL constants) |
| **CAN_RUN_IN_NODE** | YES — all config objects are plain data structures |

---

### core/constants.js — 42 lines

| Category | Details |
|----------|---------|
| **READS** | None |
| **WRITES** | `window.COLORS`, `window.TF_MAP`, `window.CHART_COLORS` |
| **DOM** | None |
| **BROWSER_APIS** | None |
| **CALLS** | None |
| **DOM_SIDE_EFFECTS** | None |
| **PURE_LOGIC_PCT** | 100% |
| **CAN_RUN_IN_NODE** | YES |

---

### core/events.js — 227 lines

| Category | Details |
|----------|---------|
| **READS** | S.*, BM.*, BRAIN.*, AT.*, document elements |
| **WRITES** | `window.AT` (enabled, mode, running, killTriggered, killSwitch, interval, totalTrades, wins, losses, totalPnL, dailyPnL, realizedDailyPnL, closedTradesToday, dailyStart, lastTradeSide, lastTradeTs, cooldownMs, _cooldownBySymbol,_killTriggeredTs, log), `window.CORE_STATE`, `window.WS` |
| **DOM** | Status badges, kill switch UI elements |
| **BROWSER_APIS** | Intervals.set, document.getElementById |
| **CALLS** | toast(), ncAdd() |
| **DOM_SIDE_EFFECTS** | Updates status indicators, kill switch display |
| **PURE_LOGIC_PCT** | ~50% (AT state shape, event dispatch logic) |
| **CAN_RUN_IN_NODE** | AT state shape YES; event dispatch YES with DOM stubs |

---

### core/bootstrap.js — 2037 lines

| Category | Details |
|----------|---------|
| **READS** | S.*, BM.*, BRAIN.*, AT.*, TP.*, DSL.*, localStorage, document.*, window.innerWidth |
| **WRITES** | S (symbol, chartTf, tz, klines, rsi, overlays, indicators, activeInds, etc.), BM.*, BRAIN.*, chart series variables (mainChart, ema50S, ema200S, etc.), `window.setSymbol`, `window.setTF`, `window.renderChart`, `window.fP`, `window.fmtTime`, `window.fmtDate`, `window.fmtNow`, `window.fmt`, `window.el`, `window.toast`, `window.ncAdd`, `window.sendAlert`, `window.playAlertSound` |
| **DOM** | 100+ elements — full UI rendering: charts (LightweightCharts), modals, panels, watchlist, orderbook, trade panels, brain panel, signal panel, all overlays |
| **BROWSER_APIS** | LightweightCharts (external library), localStorage, fetch (/api/klines, /api/rsi, /api/ticker/24hr, /api/depth, /api/fr, /api/oi, /api/premium-index, multiple WS feeds), WebSocket (kline, depth, aggregated trades, liquidations, fundingRate, openInterest, markPrice), Notification API, Audio API, ResizeObserver, MutationObserver, IntersectionObserver, requestAnimationFrame, performance.now, matchMedia |
| **CALLS** | All brain files (brainLoop, signalScan, updateDeepDive, runQEB, runScenario, runMacroCortex), all trading files, all data files, ZState (sync), WS manager |
| **DOM_SIDE_EFFECTS** | Renders entire UI, creates all chart instances, sets up all WebSocket feeds, manages sub-chart sync |
| **PURE_LOGIC_PCT** | ~10% (fP, fmtTime, fmt, calcATR helpers are pure; 90% is DOM/WS/fetch orchestration) |
| **CAN_RUN_IN_NODE** | fP/fmt/fmtTime/fmtDate/fmtNow YES; init phases NO; chart rendering NO; WS feeds need adapter |

---

### brain/brain.js — 2576 lines

| Category | Details |
|----------|---------|
| **READS** | S.*, BM.*, BRAIN.*, AT.*, TP.*, DSL.*, OF.*, FEE_MODEL, CORE_STATE, _SAFETY, BlockReason, document elements |
| **WRITES** | BRAIN.score, BRAIN.thoughts, BRAIN.neurons, BRAIN.state, BM.confluenceScore, BM.danger, BM.dangerBreakdown, BM.conviction, BM.convictionMult, BM.core, BM.performance, BM.adaptive, BM.atmosphere, BM.structure, BM.volBuffer, BM.volRegime, BM.liqCycle, BM.positionSizing, S.signalData |
| **DOM** | ~30+ elements — brain panel (neurons grid, score display, danger bars, conviction meter, thoughts feed, regime badge, atmosphere indicator), modal detail panels |
| **BROWSER_APIS** | localStorage (zt_brain_thoughts), Intervals.set, requestAnimationFrame (neuron animations), document.getElementById/querySelector |
| **CALLS** | regimeDetect(), confluenceScore(), arianovaVote(), forecastScore(), phaseFilterApply(), aubScore(), srRecord(), runSignalScan(), updateDeepDive() |
| **DOM_SIDE_EFFECTS** | Updates brain panel UI, neuron animations, thought stream, regime badge, danger/conviction displays |
| **PURE_LOGIC_PCT** | ~35% (confluenceCalc, dangerCalc, convictionCalc, atmosphereCalc, structureCalc, positionSizing are extractable; volBuffer/liqCycle are pure math) |
| **CAN_RUN_IN_NODE** | Scoring algorithms YES; brainLoop orchestration YES with stubs; DOM rendering NO |

---

### brain/arianova.js — 1753 lines

| Category | Details |
|----------|---------|
| **READS** | S.*, BM.*, BRAIN.*, AT.*, TP.*, OF.*, FEE_MODEL,_SAFETY |
| **WRITES** | `window.WVE_CONFIG`, `window.WVE_STATE`, `window.arianovaVote`, BRAIN.neurons (individual neuron updates), BM.macro.* |
| **DOM** | None (pure scoring — UI display delegated to brain.js) |
| **BROWSER_APIS** | None |
| **CALLS** | Reads all brain/trading state for weighted voting |
| **DOM_SIDE_EFFECTS** | None |
| **PURE_LOGIC_PCT** | ~90% (Weighted Vote Engine is almost entirely pure math — sigmoid, SMA, scoring functions) |
| **CAN_RUN_IN_NODE** | YES — needs global stubs for S/BM/BRAIN/AT/TP/OF but logic is pure |

---

### brain/confluence.js — 64 lines

| Category | Details |
|----------|---------|
| **READS** | BRAIN.neurons, BM.gates |
| **WRITES** | BM.confluenceScore |
| **DOM** | None |
| **BROWSER_APIS** | None |
| **CALLS** | None |
| **DOM_SIDE_EFFECTS** | None |
| **PURE_LOGIC_PCT** | 100% |
| **CAN_RUN_IN_NODE** | YES |

---

### brain/signals.js — 58 lines

| Category | Details |
|----------|---------|
| **READS** | S.signalData |
| **WRITES** | None (read-only signal aggregation) |
| **DOM** | None |
| **BROWSER_APIS** | None |
| **CALLS** | None |
| **DOM_SIDE_EFFECTS** | None |
| **PURE_LOGIC_PCT** | 100% |
| **CAN_RUN_IN_NODE** | YES |

---

### brain/regime.js — 242 lines

| Category | Details |
|----------|---------|
| **READS** | S.klines, S.price, BRAIN.* |
| **WRITES** | BRAIN.regime, BRAIN.regimeAtrPct, BRAIN.regimeConfidence, BRAIN.regimeSlope, `window.REGIME` |
| **DOM** | None |
| **BROWSER_APIS** | None |
| **CALLS** | None |
| **DOM_SIDE_EFFECTS** | None |
| **PURE_LOGIC_PCT** | 95% (ATR calc, slope, regime classification — only global writes prevent 100%) |
| **CAN_RUN_IN_NODE** | YES |

---

### brain/forecast.js — 639 lines

| Category | Details |
|----------|---------|
| **READS** | S.*, BM.*, BRAIN.*, AT.* |
| **WRITES** | BM.probScore, forecast result object |
| **DOM** | None |
| **BROWSER_APIS** | None |
| **CALLS** | None |
| **DOM_SIDE_EFFECTS** | None |
| **PURE_LOGIC_PCT** | 95% |
| **CAN_RUN_IN_NODE** | YES |

---

### brain/phaseFilter.js — 229 lines

| Category | Details |
|----------|---------|
| **READS** | BRAIN.regime, BM.phaseFilter, S.klines |
| **WRITES** | BM.phaseFilter state |
| **DOM** | None |
| **BROWSER_APIS** | None |
| **CALLS** | None |
| **DOM_SIDE_EFFECTS** | None |
| **PURE_LOGIC_PCT** | 95% |
| **CAN_RUN_IN_NODE** | YES |

---

### brain/aub.js — 617 lines

| Category | Details |
|----------|---------|
| **READS** | S.*, BM.*, BRAIN.*, AT.*, OF.*, TP.* |
| **WRITES** | AUB score result, wraps `window.setSymbol` (layer 1) |
| **DOM** | None |
| **BROWSER_APIS** | None |
| **CALLS** | None |
| **DOM_SIDE_EFFECTS** | None |
| **PURE_LOGIC_PCT** | 90% (scoring logic is pure; setSymbol wrapper is side-effectful) |
| **CAN_RUN_IN_NODE** | YES with stubs |

---

### brain/deepdive.js — 4855 lines

| Category | Details |
|----------|---------|
| **READS** | S.*, BM.*, BRAIN.*, AT.*, TP.*, DSL.*, OF.*, FEE_MODEL, CORE_STATE, *SAFETY, BlockReason, allPrices, wlPrices, localStorage (zt_ares**, zeus_postmortem_v1) |
| **WRITES** | `window.ARES` (wallet, positions, STATE, onTradeClosed), `window.ARES_WALLET`, `window.ARES_POSITIONS`, `window.ARES_DECISION`, `window.ARES_EXECUTE`, `window.ARES_JOURNAL`, `window.ARES_MIND`, `window._aresRender`, `window._ariaBrainWave`, `window.__ARIA_BRAIN_INIT__`, `window.initARES`, `window.initAriaBrain`, S.activeInds, S.indicators, S.macdData, S.signalData, BM.probScore, chart series (bbUpperS, ichimokuSeries, fibSeries, pivotSeries, vpSeries, etc.), sub-chart instances (_rsiChart,_macdChart, etc.) |
| **DOM** | 200+ elements — ARES panel (strip bar, badge, conf, IMM, emotions, wound, decision, stage progress, wallet with ADD/WITHDRAW buttons, positions list, mission arc SVG, brain core SVG with 136 nodes, cognitive bar, thought stream, stats row, lesson, history dots), indicator panels (BB, Ichimoku, Fib, Pivot, VP, RSI, Stoch, ATR, OBV, MFI, CCI, MACD), indicator settings modal, deep dive narrative panel |
| **BROWSER_APIS** | localStorage (zt_ares_wallet, zt_ares_journal, zt_ares_positions, zt_ares_closed, zeus_postmortem_v1), LightweightCharts, requestAnimationFrame (ARIA brain wave engine), MutationObserver (badge state changes), performance.now, matchMedia (prefers-reduced-motion), fetch (/api/exchange/status, /api/order/*, /api/balance), crypto.subtle (SHA-256 — used in ARES journal ID), prompt/alert (wallet fund/withdraw), SVG DOM manipulation |
| **CALLS** | ARES subsystem (wallet→decision→execute→monitor→journal→mind), liveApi functions (aresPlaceOrder, aresSetStopLoss, aresSetTakeProfit, aresCancelOrder, aresClosePosition), calcMACD, detectSupertrendFlip, detectRSIDivergence, runSignalScan (signal scanner), all indicator update functions, srRecord, _indRenderHook |
| **DOM_SIDE_EFFECTS** | Renders ARES neural command center, 136-node animated brain SVG with RAF wave engine (4 wave modes: LR/TB/DIAG/RADIAL), low-poly brain (28 vertices/36 triangles/6 zones), mission arc, indicator charts (17 types), deep dive narrative, indicator settings, CSS injection (500+ lines across multiple IIFEs) |
| **PURE_LOGIC_PCT** | ~20% (ARES_DECISION 14-rule evaluator, ARES_MIND cognitive engine, calcMACD, detectSupertrendFlip, detectRSIDivergence, Bollinger/Ichimoku/ATR/RSI/Stoch/OBV/MFI/CCI math, generateDeepDive narrative, calcLiqPrice are extractable; 80% is DOM/SVG/chart rendering) |
| **CAN_RUN_IN_NODE** | ARES_DECISION YES, ARES_MIND YES, ARES_JOURNAL YES, indicator math YES, signal scan YES, generateDeepDive narrative YES (returns HTML string but logic is pure); ARES_EXECUTE NO (exchange orders), ARES_MONITOR partially (DSL math yes, exchange interaction no), all rendering NO, RAF wave engine NO |

---

### trading/autotrade.js — 1498 lines

| Category | Details |
|----------|---------|
| **READS** | S.*, BM.*, BRAIN.*, AT.*, TP.*, DSL.*, OF.*, FEE_MODEL,_SAFETY, BlockReason, CORE_STATE, FUSION_CACHE/FUSION_LAST/FUSION_SIZE_MULT |
| **WRITES** | AT.* (running, lastTradeSide, lastTradeTs, totalTrades, wins, losses, totalPnL, _cooldownBySymbol, etc.), TP.demoPositions (push), TP.demoBalance (deduct), `window.FUSION_CACHE`, `window.FUSION_LAST`, `window.FUSION_SIZE_MULT`, BM.dailyTrades, `window.scheduleAutoClose` |
| **DOM** | ~15 elements — autotrade panel (status, log, metrics, kill switch) |
| **BROWSER_APIS** | Intervals.set, localStorage (zt_at_log), document.getElementById |
| **CALLS** | placeDemoOrder (marketData), liveApiPlaceOrder (liveApi), runConfluence, arianovaVote, forecastScore, phaseFilterApply, aubScore, srRecord, toast, ncAdd, ZState.save |
| **DOM_SIDE_EFFECTS** | Updates autotrade panel UI, log display |
| **PURE_LOGIC_PCT** | ~40% (FUSION scoring, position sizing, cooldown logic, blockCheck, entry validation are pure; trade execution and DOM updates are not) |
| **CAN_RUN_IN_NODE** | Scoring/sizing/validation YES; execution flow YES with order placement stubs; DOM rendering NO |

---

### trading/dsl.js — 1158 lines

| Category | Details |
|----------|---------|
| **READS** | S.*, BM.*, BRAIN.*, AT.*, TP.*, DSL.*, OF.* |
| **WRITES** | DSL.positions, DSL._attachedIds, DSL.enabled, TP.demoPositions (SL/TP modification) |
| **DOM** | ~10 elements — DSL settings panel, visual indicators on positions |
| **BROWSER_APIS** | Intervals.set, document.getElementById |
| **CALLS** | getSymPrice (marketData), calcDslTargetPrice (internal), toast |
| **DOM_SIDE_EFFECTS** | DSL indicators on position rows, settings panel |
| **PURE_LOGIC_PCT** | ~55% (calcDslTargetPrice, pivot detection, trail logic, magnet detection are pure math) |
| **CAN_RUN_IN_NODE** | Trail/pivot/magnet math YES; position management YES with stubs; DOM NO |

---

### trading/risk.js — 546 lines

| Category | Details |
|----------|---------|
| **READS** | S.*, BM.*, AT.*, TP.*, BRAIN.*, FEE_MODEL |
| **WRITES** | BM.riskState, BM.adaptive.*, BM.dailyPnL.*, AT.killSwitch/killTriggered |
| **DOM** | ~5 elements — risk dashboard |
| **BROWSER_APIS** | localStorage (zt_risk_state) |
| **CALLS** | toast, ncAdd, sendAlert |
| **DOM_SIDE_EFFECTS** | Updates risk dashboard display |
| **PURE_LOGIC_PCT** | ~70% (drawdown calc, position sizing, heat computation, VAR calc, kill switch logic are pure) |
| **CAN_RUN_IN_NODE** | YES — most logic is pure math, just needs global stubs |

---

### trading/orders.js — 78 lines

| Category | Details |
|----------|---------|
| **READS** | S.price |
| **WRITES** | None (utility functions) |
| **DOM** | None |
| **BROWSER_APIS** | None |
| **CALLS** | None |
| **DOM_SIDE_EFFECTS** | None |
| **PURE_LOGIC_PCT** | 100% |
| **CAN_RUN_IN_NODE** | YES |

---

### trading/positions.js — 181 lines

| Category | Details |
|----------|---------|
| **READS** | TP.*, S.price, FEE_MODEL |
| **WRITES** | TP.demoPositions (partial close), TP.demoBalance |
| **DOM** | None |
| **BROWSER_APIS** | None |
| **CALLS** | getSymPrice |
| **DOM_SIDE_EFFECTS** | None |
| **PURE_LOGIC_PCT** | 90% (PnL calc, partial close logic are pure) |
| **CAN_RUN_IN_NODE** | YES |

---

### trading/liveApi.js — 418 lines

| Category | Details |
|----------|---------|
| **READS** | TP.*, S.symbol |
| **WRITES** | TP.liveBalance, TP.liveAvailableBalance, TP.livePositions, TP.liveUnrealizedPnL, TP.liveConnected |
| **DOM** | None (API layer only) |
| **BROWSER_APIS** | fetch (/api/order/place, /api/order/cancel, /api/balance, /api/positions, /api/leverage, /api/exchange/status) |
| **CALLS** | fetch (server proxy to Binance) |
| **DOM_SIDE_EFFECTS** | None |
| **PURE_LOGIC_PCT** | ~20% (response parsing is pure; rest is async fetch) |
| **CAN_RUN_IN_NODE** | YES with node-fetch or native fetch |

---

### data/klines.js — 578 lines

| Category | Details |
|----------|---------|
| **READS** | S.klines, S.symbol, S.chartTf |
| **WRITES** | S.klines, S.chartBars, `window._calcATRSeries` |
| **DOM** | None |
| **BROWSER_APIS** | fetch (/api/klines) |
| **CALLS** | fetch, renderChart (callback) |
| **DOM_SIDE_EFFECTS** | None |
| **PURE_LOGIC_PCT** | ~60% (_calcATRSeries with wilder/trueRange modes is pure; kline fetch/parse is I/O) |
| **CAN_RUN_IN_NODE** | _calcATRSeries YES; fetch wrappers YES with fetch adapter |

---

### data/marketData.js — 2256 lines

| Category | Details |
|----------|---------|
| **READS** | S.*, BM.*, BRAIN.*, AT.*, TP.*, DSL.*, allPrices, wlPrices, window._zeusRecentlyClosed, document elements |
| **WRITES** | S.zsSettings.*, S.overlays.*, S.alerts.*, S.liqFilter.*, TP.demoPositions (push/splice), TP.demoBalance, TP.demoWins/demoLosses, TP.livePositions (splice), AT.realizedDailyPnL, AT.closedTradesToday, DSL.positions (delete), DSL._attachedIds (delete), window._zeusRecentlyClosed, window._liqSrcFilter, window.allPrices, window.wlPrices, window.setSymbol (original definition), window.setTF, window.setTZ |
| **DOM** | ~80+ elements — price tickers, RSI panel, heatmap, watchlist, orderbook depth visualization, trade panels (demo/live), leverage selectors, liquidation display, alert settings, Zeus Supremus overlay, cloud sync settings, S/R overlay |
| **BROWSER_APIS** | crypto.subtle.digest (SHA-256 for email hash), localStorage (zt_cloud_*, zt_alerts_*), LightweightCharts (mainChart series), fetch (implicit via liveApi), WebSocket data handlers, JSON.parse/stringify, setTimeout, Intervals.set |
| **CALLS** | liveApiClosePosition, liveApiSyncState, ZState.save/syncNow, _bmPostClose, srUpdateOutcome, scheduleAutoClose, toast, ncAdd, sendAlert, renderChart, setChartData, PostMortem engine |
| **DOM_SIDE_EFFECTS** | Updates all price/RSI/orderbook/heatmap/watchlist/position displays; manages Zeus Supremus chart overlays (supply/demand zones, market structure); renders demo/live position tables; cloud settings save/load |
| **PURE_LOGIC_PCT** | ~20% (calcLiqPrice, calcRSI, _calcATRSeries, ZS pivot detection, getSymPrice price resolution are extractable; vast majority is DOM/WS/fetch) |
| **CAN_RUN_IN_NODE** | calcLiqPrice YES, calcRSI YES, ZS pivot math YES, getSymPrice YES with stubs; position management/rendering NO; chart overlays NO |

---

### data/orderflow.js — 5424 lines

| Category | Details |
|----------|---------|
| **READS** | window.OF.* (all sub-objects), window.S.price, window.S.bids/asks, window.S.klines, window.S.llvBuckets, window.RAW_FLOW.buf, window.OF_PRICE_BUF, window.WS.isOpen, window.CORE_STATE.engineStatus, window.REGIME, window.BM.regime, window.ZLOG, localStorage (of_hud_v2) |
| **WRITES** | `window.OF` (sym, ts, buyVol, sellVol, delta, deltaAbs, deltaPct, deltaVel, z, mean, std, quality, flags, abs, exhaust, vacuum, dFlip, ice, flow, trapMM, trap, absorb, exh, sweep, cascade, magnet, void, quant), `window.RAW_FLOW` (sym, buf, windowMs, maxTrades, dropped), `window.OF_PRICE_BUF`, `window.CORE_STATE.engineStatus`, `window.buildDiagSnapshot` (patched), `window.OF_DEBUG_SNAPSHOT` (8-layer patch chain), `window.setSymbol` (16-layer wrapper chain: layers 2-16), `window.runQuantDetectors`, `window.ofHudToggle`, `window.ofHudDebugToggle`, `window.ofHudResetPos`, `window.toggleOFlowBadge`, `window._tickVacuum`, `window._tickDeltaFlip`, `window._tickIceberg`, `window._tickAbsorbP11`, `window._tickExhaustP11`, `window._tickSweepP12`, `window._tickCascadeP12`, `window._tickMagnetP13`, `window._tickVoidP14`, singleton guards (`window.__ZEUS_OF_P1__` through `__ZEUS_OF_QUANT__`) |
| **DOM** | #of-hud fixed overlay (~60+ nested elements), #of-hud-anchor badge, #of-health-badge, #engineStatusLbl; all detail rows for 15 detectors (TRAP/VAC/ICE/FLIP/ABS-EXH/MMTRAP/ABSORB-P11/EXHAUST-P11/SWEEP-P12/CASCADE-P12/MAGNET-P13/VOID-P14/WALL-P15/STOP-P15/SMF-P15) |
| **BROWSER_APIS** | Intervals.set (6 intervals: of_p1, of_p6_badge, of_p7_trap, of_p8_state, of_p10_flow, of_p15_quant), localStorage (of_hud_v2, position persistence), document.createElement, pointer events (drag), setTimeout/clearTimeout, MutationObserver (HUD teardown), CSS injection (400+ lines across 8 IIFEs) |
| **CALLS** | WS.isOpen (feed health), ZLOG.push (logging), Intervals.set/clear |
| **DOM_SIDE_EFFECTS** | HUD overlay with zero-layout-shift rendering (textContent/className only, no innerHTML on panel), CSS injection for neon chip styles, health badge, engine state label, anchor badge with drag |
| **PURE_LOGIC_PCT** | ~50% (All 15 detector algorithms are pure math: delta/z-score calc, absorb/exhaust detection, vacuum/dFlip/iceberg patterns, trap state machine, flow bias calc, MM trap, sweep/cascade, magnet clustering, void scoring, wall detection from orderbook, stop run prediction, SMF footprint analysis. HUD rendering and DOM setup is the other 50%) |
| **CAN_RUN_IN_NODE** | ALL detector algorithms YES (P1-P15 core math); HUD/DOM/CSS NO; OF_DEBUG_SNAPSHOT builder YES; _flowStats helper YES; price/vol analysis YES. Would need: RAW_FLOW buffer as input, S.price/bids/asks/klines/llvBuckets as input, OF state object as output. |

---

## GLOBAL STATE DEPENDENCY MAP

```
S (state.js)
├── price, rsi, klines, signalData, fr, oi, symbol, chartTf
├── alerts, magnets, magnetBias, atr, overlays, indicators
├── bids, asks (depth20 orderbook)
├── llvBuckets, llvSettings (liquidation clusters)
├── zsSettings (Zeus Supremus)
├── Read by: ALL files
└── Written by: bootstrap, marketData, klines, state sync

BM (config.js)
├── confluenceScore, danger, conviction, regime, performance
├── adaptive, positionSizing, riskState, dailyPnL
├── Read by: brain, autotrade, risk, dsl, deepdive, arianova
└── Written by: brain.js (main), risk.js, autotrade.js

BRAIN (config.js)
├── score, regime, regimeAtrPct, regimeConfidence, regimeSlope
├── thoughts, neurons, ofi, state
├── Read by: brain.js, autotrade, dsl, deepdive, arianova, forecast
└── Written by: brain.js, regime.js

AT (events.js)
├── enabled, mode, running, killTriggered, killSwitch
├── totalTrades, wins, losses, totalPnL, dailyPnL
├── Read by: brain.js, autotrade, risk, dsl, deepdive
└── Written by: autotrade.js, risk.js, marketData (closeDemoPos)

TP (state.js)
├── demoPositions, demoBalance, demoPnL, demoWins, demoLosses
├── livePositions, liveBalance, liveConnected, journal
├── Read by: autotrade, dsl, risk, brain, positions, marketData
└── Written by: autotrade (open), marketData (close), liveApi (sync)

DSL (config.js)
├── positions, _attachedIds, enabled, mode
├── Read by: autotrade, brain, deepdive
└── Written by: dsl.js, marketData (closeDemoPos cleanup)

OF (orderflow.js)
├── deltaPct, deltaVel, z, quality, flags
├── abs, exhaust, vacuum, dFlip, ice
├── flow, trapMM, trap, absorb, exh
├── sweep, cascade, magnet, void, quant
├── Read by: brain.js, arianova, autotrade, aub, deepdive
└── Written by: orderflow.js (all 15 detector IIFEs)

ARES (deepdive.js)
├── wallet, positions, STATE, TARGET, DAYS_MAX
├── DECISION, EXECUTE, JOURNAL, MONITOR, MIND
├── Fully isolated subsystem (BTCUSDT only)
└── Communicated via: _demoCloseHooks, ARES.onTradeClosed
```

---

## SERVER API DEPENDENCIES

| Endpoint | Method | Used By | Purpose |
|----------|--------|---------|---------|
| `/api/sync/state` | GET/POST | state.js (ZState) | State sync (pull/push) |
| `/api/sync/journal` | POST | state.js (ZState) | Journal sync |
| `/api/sync/user-context` | POST | state.js (ZState) | User context sync |
| `/ws/sync` | WebSocket | state.js (ZState) | Cross-device real-time sync |
| `/api/klines` | GET | klines.js, bootstrap | Historical candle data |
| `/api/rsi` | GET | bootstrap | Multi-TF RSI values |
| `/api/ticker/24hr` | GET | bootstrap | 24h ticker stats |
| `/api/depth` | GET | bootstrap | Initial orderbook depth |
| `/api/fr` | GET | bootstrap | Funding rate |
| `/api/oi` | GET | bootstrap | Open interest |
| `/api/premium-index` | GET | bootstrap | Premium index |
| `/api/order/place` | POST | liveApi | Place live order |
| `/api/order/cancel` | POST | liveApi, deepdive (ARES) | Cancel order |
| `/api/balance` | GET | liveApi | Account balance |
| `/api/positions` | GET | liveApi | Open positions |
| `/api/leverage` | POST | liveApi | Set leverage |
| `/api/exchange/status` | GET | deepdive, liveApi | Exchange connection status |

---

## WEBSOCKET FEEDS

| Feed | Source | Consumer | Data |
|------|--------|----------|------|
| kline (1m, 5m, etc.) | Binance WS proxy | bootstrap → S.klines | Real-time candles |
| depth20 | Binance WS proxy | bootstrap → S.bids/asks | Orderbook snapshot |
| aggTrade | Binance WS proxy | orderflow.js → RAW_FLOW.buf | Trade-by-trade flow |
| forceOrder | Binance WS proxy | bootstrap → heatmap | Liquidation events |
| fundingRate | Binance WS proxy | bootstrap → S.fr | Funding rate updates |
| openInterest | Binance WS proxy | bootstrap → S.oi | OI changes |
| markPrice | Binance WS proxy | bootstrap → allPrices | Mark prices for all symbols |
| /ws/sync | Zeus server | state.js (ZState) | Cross-device state sync |

---

## MIGRATION STRATEGY RECOMMENDATIONS

### Tier 1: Extract Immediately (Pure Logic → Node.js)

These can move to the server with minimal changes:

- `brain/regime.js` — regime detection (pure math)
- `brain/confluence.js` — confluence scoring
- `brain/signals.js` — signal aggregation
- `brain/forecast.js` — probability scoring
- `brain/phaseFilter.js` — phase filtering
- `brain/arianova.js` — weighted vote engine (~90% pure)
- `brain/aub.js` — AUB scoring (~90% pure)
- `trading/orders.js` — order validation (100% pure)
- `trading/positions.js` — PnL calc (90% pure)
- `trading/risk.js` — risk computation (~70% pure)
- `core/constants.js` — constants (100% pure)
- `core/config.js` — config shapes (~85% pure)
- `data/klines.js` — _calcATRSeries (pure math)
- `data/orderflow.js` — ALL 15 detector algorithms (P1-P15 core math)

### Tier 2: Extract with Stubs (Needs Adapter Layer)

- `brain/brain.js` — scoring orchestration (needs S/BM/BRAIN stubs)
- `trading/autotrade.js` — FUSION scoring + entry validation (needs order placement stub)
- `trading/dsl.js` — trail/pivot/magnet math (needs position interface)
- `trading/liveApi.js` — already server-facing (just needs server-to-server calls)
- `brain/deepdive.js` — ARES_DECISION, ARES_MIND, ARES_JOURNAL, indicator math, signal scanner
- `core/state.js` — ZState sync logic (already talks to server)

### Tier 3: Client-Only (DOM-Bound)

- `core/bootstrap.js` — UI orchestration, charts, all DOM rendering
- `data/marketData.js` — ~80% DOM (charts, panels, overlays, position rendering)
- `brain/deepdive.js` — ARES_RENDER (136-node brain SVG, RAF wave engine, mission arc, all CSS)
- `data/orderflow.js` — HUD overlay, CSS injection, drag/interaction

### Critical Refactoring Required

1. **setSymbol chain → Event emitter**: Replace 16-layer wrapper chain with pub/sub
2. **OF_DEBUG_SNAPSHOT chain → Composition**: Replace 8-layer patch chain with snapshot builder that collects from registered providers
3. **closeDemoPos decomposition**: Break into discrete events (balance update, journal entry, DSL cleanup, sync, notification) for server-side coordination
4. **Global state → Dependency injection**: Extract S/BM/BRAIN/AT/TP/DSL/OF into injectable state containers

---

*Generated by read-only audit — no files were modified.*
