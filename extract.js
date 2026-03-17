/**
 * Zeus v122 Surgical Extraction Script
 * Reads zeus-v122-final.html and extracts JS into module files
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync('zeus-v122-final.html', 'utf8');
const lines = src.split('\n');

function extractLines(start, end) {
  // 1-indexed to 0-indexed
  return lines.slice(start - 1, end).join('\n');
}

function writeModule(filePath, content, header = '') {
  const fullPath = path.join('public', filePath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const final = header ? header + '\n' + content : content;
  fs.writeFileSync(fullPath, final, 'utf8');
  console.log(`  ✓ ${filePath} (${final.length} bytes)`);
}

console.log('═══ ZEUS v122 SURGICAL EXTRACTION ═══\n');

// ═══════════════════════════════════════════════════
// 1. UTILS — foundations, no dependencies
// ═══════════════════════════════════════════════════
console.log('── utils/ ──');

// utils/helpers.js — el(), safeSetText, safeSetHTML, escHtml (L332-335 + L125-131)
writeModule('js/utils/helpers.js', 
`// Zeus v122 — utils/helpers.js
// DOM helpers & safe setters — used everywhere
'use strict';

${extractLines(332, 335)}

// escHtml — sanitize dynamic fields (from L125)
${extractLines(125, 131)}
`);

// utils/formatters.js — fmt, fP, timezone formatters (L336-342)
writeModule('js/utils/formatters.js',
`// Zeus v122 — utils/formatters.js
// Number & date formatting — used for UI display
'use strict';

${extractLines(336, 342)}
`);

// utils/math.js — _clamp, calcRSIArr, math helpers (scattered)
writeModule('js/utils/math.js',
`// Zeus v122 — utils/math.js
// Math utility functions
'use strict';

${extractLines(13018, 13018)}

// clamp variants for fusion
${extractLines(19764, 19765)}

// RSI calculation
${extractLines(13565, 13580)}
`);

// utils/guards.js — _SAFETY config, _safe state, safety engine, degraded mode (L2000-2053 + L19437-19704)
writeModule('js/utils/guards.js',
`// Zeus v122 — utils/guards.js
// Safety guards, watchdogs, degraded mode, recovery
'use strict';

// Safety configuration
${extractLines(2000, 2053)}

// Recovery mode state
${extractLines(2054, 2054)}

// Price sanity check
${extractLines(19437, 19504)}

// Watchdog & intervals
${extractLines(19505, 19660)}

// Error handlers
${extractLines(19661, 19704)}
`);


// ═══════════════════════════════════════════════════
// 2. CORE — state, config, constants
// ═══════════════════════════════════════════════════
console.log('── core/ ──');

// core/state.js — CORE_STATE, BlockReason, S, TP, chart refs, API keys (L24-L400)
writeModule('js/core/state.js',
`// Zeus v122 — core/state.js
// Global state objects — ALL exported to window for compat
'use strict';

// CORE_STATE — single source of truth
${extractLines(24, 31)}

// BlockReason — unified block reason
${extractLines(34, 82)}

// Atomic snapshot builder
${extractLines(84, 122)}

// State persistence (ZState)
${extractLines(135, 330)}

// Main state object S
${extractLines(343, 365)}

// Chart series refs
${extractLines(366, 368)}

// Trading Positions state
${extractLines(369, 371)}

// OI + Watchlist + Prices
${extractLines(394, 400)}

// Window exports for backward compat
window.CORE_STATE = CORE_STATE;
window.BlockReason = BlockReason;
window.buildExecSnapshot = buildExecSnapshot;
window.escHtml = escHtml;
window.ZState = ZState;
window.S = S;
window.TP = TP;
window.oiHistory = oiHistory;
window.allPrices = allPrices;
window.wlPrices = wlPrices;
`);

// core/config.js — INDICATORS, PROFILE_TF, SESS_CFG, etc. (L372-L1870)
writeModule('js/core/config.js',
`// Zeus v122 — core/config.js
// Configuration constants, indicator definitions, profile timeframes
'use strict';

// Indicators array
${extractLines(372, 393)}

// Watchlist symbols
${extractLines(395, 397)}

// Signal Registry (L404-L627)
${extractLines(404, 627)}

// Notification Center (L628-L1463)
${extractLines(628, 1463)}

// User Settings (L1464-L1671)
${extractLines(1464, 1671)}

// Chart overlay state
${extractLines(1672, 1675)}

// Backtest config
${extractLines(1675, 1699)}

// Day/Hour Filter
${extractLines(1700, 1711)}

// Performance tracker
${extractLines(1712, 1724)}

// Brain Extension state
${extractLines(1721, 1730)}

// Session configs
${extractLines(1725, 1735)}

// Brain & BM state
${extractLines(1736, 1846)}

// Profile Timeframes
${extractLines(1847, 1870)}

// ARM_ASSIST, NEWS, regime history, fakeout, session defs
${extractLines(1871, 1896)}

// Animation state
${extractLines(1887, 1896)}

// Window exports
window.INDICATORS = INDICATORS;
window.WL_SYMS = WL_SYMS;
window.SIGNAL_REGISTRY = SIGNAL_REGISTRY;
window.NOTIFICATION_CENTER = NOTIFICATION_CENTER;
window.USER_SETTINGS = USER_SETTINGS;
window.BT = BT;
window.BT_INDICATORS = BT_INDICATORS;
window.DSL = DSL;
window.MSCAN_SYMS = MSCAN_SYMS;
window.MSCAN = MSCAN;
window.DHF = DHF;
window.PERF = PERF;
window.BEXT = BEXT;
window.SESSION_HOURS_BT = SESSION_HOURS_BT;
window.SESS_CFG = SESS_CFG;
window.BRAIN = BRAIN;
window.BM = BM;
window.PROFILE_TF = PROFILE_TF;
window.ARM_ASSIST = ARM_ASSIST;
window.NEWS = NEWS;
window.ZANIM = ZANIM;
`);

// core/constants.js — small pure constants
writeModule('js/core/constants.js',
`// Zeus v122 — core/constants.js
// Pure constants, no state
'use strict';

${extractLines(13030, 13038)}

const STALL_GRACE_MS = 20000;

// Gate definitions
${extractLines(17799, 17813)}

// Session definitions
${extractLines(1879, 1884)}

// Neuro symbols
${extractLines(1885, 1886)}

// Window exports
window.MACRO_MULT = MACRO_MULT;
window.STALL_GRACE_MS = STALL_GRACE_MS;
window.GATE_DEFS = GATE_DEFS;
window._SESS_DEF = _SESS_DEF;
window._SESS_PRIORITY = _SESS_PRIORITY;
window._NEURO_SYMS = _NEURO_SYMS;
`);


// ═══════════════════════════════════════════════════
// 3. CORE — AutoTrade state + exec queue + pending close
// ═══════════════════════════════════════════════════

// core/events.js — AT state object, exec queue, pending close, Intervals manager
writeModule('js/core/events.js',
`// Zeus v122 — core/events.js
// AutoTrade state, execution queue, pending close, interval manager
'use strict';

// AutoTrade engine state
${extractLines(1897, 1999)}

// Execution queue
${extractLines(1895, 1896)}

// Pending close state
${extractLines(20624, 20625)}

// Confirm close buttons
${extractLines(20626, 20715)}

// Interval Manager (safe wrapper)
${extractLines(19649, 19660)}

// Window exports
window.AT = AT;
window._execQueue = _execQueue;
window._pendingClose = _pendingClose;
`);


// ═══════════════════════════════════════════════════
// 4. DATA modules
// ═══════════════════════════════════════════════════
console.log('── data/ ──');

// data/storage.js — ZState is already in state.js, this is journal + localStorage helpers
writeModule('js/data/storage.js',
`// Zeus v122 — data/storage.js
// LocalStorage helpers, trade journal, cloud save
'use strict';

// Safe localStorage set
${extractLines(14363, 14377)}

// Trade journal
${extractLines(14378, 14423)}

// Funding Rate countdown
${extractLines(14425, 14443)}

// OI Delta tracking
${extractLines(14444, 14473)}
`);

// data/symbols.js — watchlist, multi-symbol, ZStore
writeModule('js/data/symbols.js',
`// Zeus v122 — data/symbols.js
// Watchlist, multi-symbol support, ZStore
'use strict';

// ZStore
${extractLines(14475, 14542)}

// Switch watchlist symbol
${extractLines(14533, 14542)}
`);

// data/marketData.js — WebSocket, kline fetch, data processing (mega section L5339+)
// This is the biggest section — from startApp's WS setup and the main data functions
// We need to find the WS/fetch functions. Let me read the relevant sections.

console.log('── trading/ ──');

// trading/autotrade.js — AT logic, conditions, placeAutoTrade, autoClose (L19223-L20623)
writeModule('js/trading/autotrade.js',
`// Zeus v122 — trading/autotrade.js
// AutoTrade engine: conditions, execution, monitoring, kill switch
'use strict';

// AT UI helpers
${extractLines(19223, 19348)}

// Condition checker
${extractLines(19349, 19436)}

// Data quality for autotrade
${extractLines(19749, 19763)}

// Fusion decision
${extractLines(19764, 19869)}

// Main AT check loop
${extractLines(19870, 19977)}

// Place auto trade
${extractLines(19978, 20145)}

// Auto-close monitor
${extractLines(20146, 20328)}

// Kill switch
${extractLines(20329, 20413)}

// Render AT positions
${extractLines(20414, 20623)}
`);

// trading/dsl.js — DSL object + all DSL functions (L15661-L16113)
writeModule('js/trading/dsl.js',
`// Zeus v122 — trading/dsl.js
// Dynamic Stop Loss — brain logic, widget render, intervals
'use strict';

// DSL toggle + assist
${extractLines(15661, 15766)}

// DSL Brain logic
${extractLines(15768, 15929)}

// DSL Widget render
${extractLines(15930, 16113)}
`);

// trading/risk.js — risk management, performance, macro (L13040-L13508)
writeModule('js/trading/risk.js',
`// Zeus v122 — trading/risk.js
// Macro cortex, adaptive parameters, performance tracking
'use strict';

// Macro cortex computation
${extractLines(13040, 13172)}

// Macro UI
${extractLines(13107, 13172)}

// Adaptive save/load/recalc
${extractLines(13173, 13460)}

// Position sizing
${extractLines(13469, 13527)}
`);

// trading/positions.js — position management, partial close
writeModule('js/trading/positions.js',
`// Zeus v122 — trading/positions.js
// Position management, open/close handlers
'use strict';

// On position opened
${extractLines(19708, 19748)}

// On trade executed overlay
${extractLines(18773, 18856)}

// On trade closed
${extractLines(18812, 18856)}

// Exec cinematic
${extractLines(18857, 18902)}
`);

// trading/orders.js — order execution helpers
writeModule('js/trading/orders.js',
`// Zeus v122 — trading/orders.js  
// Order execution flow, confirm close
'use strict';

// Exec overlay
${extractLines(18750, 18772)}

// BM post close
${extractLines(19171, 19221)}
`);


// ═══════════════════════════════════════════════════
// 5. BRAIN modules
// ═══════════════════════════════════════════════════
console.log('── brain/ ──');

// brain/brain.js — BRAIN state, BM, brain update loop, renderBrainCockpit (L17258-L19136)
writeModule('js/brain/brain.js',
`// Zeus v122 — brain/brain.js
// Brain state machine, neurons, update loop, cockpit
'use strict';

// Neuron updater
${extractLines(17258, 17341)}

// Brain arc
${extractLines(17343, 17372)}

// Brain state machine
${extractLines(17374, 17436)}

// Thought log
${extractLines(17437, 17449)}

// Brain main loop
${extractLines(17451, 17501)}

// Arm assist, sync functions
${extractLines(17502, 17660)}

// Enhanced regime detection
${extractLines(17660, 17798)}

// Gates computation
${extractLines(17814, 17968)}

// Chaos bar, news shield, protect mode
${extractLines(17969, 18065)}

// DSL telemetry
${extractLines(18066, 18121)}

// Exec cinematic placeholder
${extractLines(18122, 18168)}

// Safety gates
${extractLines(18169, 18243)}

// Session management
${extractLines(18244, 18320)}

// Brain Cockpit render (massive)
${extractLines(18320, 18684)}

// Z Particles animation
${extractLines(18685, 18749)}

// Brain dirty cache
${extractLines(18903, 18972)}

// Circuit brain render
${extractLines(18972, 19136)}

// Grand update
${extractLines(19128, 19136)}

// Brain cockpit init
${extractLines(19137, 19170)}
`);

// brain/signals.js — Signal Registry functions, renderSignals
writeModule('js/brain/signals.js',
`// Zeus v122 — brain/signals.js
// Signal rendering
'use strict';

// Render signals
${extractLines(14160, 14213)}
`);

// brain/confluence.js — confluence score (L15046-L15097)
writeModule('js/brain/confluence.js',
`// Zeus v122 — brain/confluence.js
// Confluence score computation
'use strict';

${extractLines(15046, 15096)}
`);

// brain/forecast.js — scenario engine, quantum exit (L13541-L13982)
writeModule('js/brain/forecast.js',
`// Zeus v122 — brain/forecast.js
// Quantum Exit Brain, scenario engine, probability score
'use strict';

// QEB swing pivots
${extractLines(13541, 13981)}

// Prob score
${extractLines(13983, 14050)}

// Scenario data
${extractLines(14051, 14159)}
`);

// brain/deepdive.js — ARES, ARES_MIND, PM (IIFEs) (L8708-L12152)
writeModule('js/brain/deepdive.js',
`// Zeus v122 — brain/deepdive.js
// PM (Pattern Matcher), ARES, ARES_MIND — deep analysis engines
'use strict';

// PM module
${extractLines(8708, 9097)}

// ARES module
${extractLines(9098, 9805)}

// ARES_MIND module
${extractLines(9806, 11756)}

// Deep dive chart data hook
${extractLines(11757, 11874)}

// Deep dive timer
${extractLines(11875, 12152)}
`);


// ═══════════════════════════════════════════════════
// 6. UI modules
// ═══════════════════════════════════════════════════
console.log('── ui/ ──');

// ui/dom.js — DOM manipulation, render functions for basic elements
writeModule('js/ui/dom.js',
`// Zeus v122 — ui/dom.js
// DOM utilities, render helpers
'use strict';

// Audio init & alerts
${extractLines(14214, 14283)}

// Price scale settings
${extractLines(14284, 14361)}

// Init act bar
${extractLines(14307, 14361)}
`);

// ui/panels.js — panel toggles, strips, eye panel, etc.
writeModule('js/ui/panels.js',
`// Zeus v122 — ui/panels.js
// Panel toggles, strip UI, eye panel
'use strict';

// Eye panel (indicator visibility)
${extractLines(15098, 15133)}

// Magnets
${extractLines(15135, 15359)}

// Backtest results render
${extractLines(15360, 15660)}

// VWAP
${extractLines(14543, 14624)}

// OVI (Order Volume Imbalance) 
${extractLines(14625, 14962)}

// Session overlays
${extractLines(14963, 15045)}
`);

// ui/modals.js — modal dialogs
writeModule('js/ui/modals.js',
`// Zeus v122 — ui/modals.js
// Modal dialogs & overlays
'use strict';

// Exec overlay
${extractLines(18750, 18772)}
`);

// ui/notifications.js — notification rendering
writeModule('js/ui/notifications.js',
`// Zeus v122 — ui/notifications.js
// Notification rendering — NOTIFICATION_CENTER functions are in core/config.js
'use strict';

// The notification rendering is handled by NOTIFICATION_CENTER in core/config.js
// This file exists for the prescribed structure
`);

// ui/render.js — chart rendering, main render
writeModule('js/ui/render.js',
`// Zeus v122 — ui/render.js
// Chart and main rendering functions
// NOTE: Most render functions are deeply coupled to the main script block
// They are loaded via the main mega-script in data/marketData.js
'use strict';

// Indicator performance render
${extractLines(16730, 16803)}

// Brain extension UI
${extractLines(16804, 17103)}
`);


// ═══════════════════════════════════════════════════
// 7. DATA continued — main mega script must stay together
// ═══════════════════════════════════════════════════

// data/marketData.js — The massive script block L5339-L8707 (WS, fetch, chart, render)
writeModule('js/data/marketData.js',
`// Zeus v122 — data/marketData.js
// WebSocket connections, data fetching, chart rendering, main update loops
// WARNING: This is the tightly-coupled core — kept together for stability
'use strict';

${extractLines(5339, 8707)}
`);

// data/klines.js — kline-specific utilities
writeModule('js/data/klines.js',
`// Zeus v122 — data/klines.js
// Kline data processing helpers
'use strict';

// ADX calculator
${extractLines(16144, 16188)}

// RSI from klines
${extractLines(16262, 16307)}

// MACD detection
${extractLines(16276, 16307)}

// Supertrend direction
${extractLines(16293, 16307)}

// Symbol score
${extractLines(16190, 16260)}

// Multi-symbol scan functions
${extractLines(16308, 16635)}
`);


// ═══════════════════════════════════════════════════
// 8. REMAINING — Dev tools, ZLOG, Hub, AUB, ARIA/NOVA, Orderflow
// ═══════════════════════════════════════════════════
console.log('── remaining modules ──');

// DEV + ZLOG + Hub (L12153-L13017)
writeModule('js/utils/dev.js',
`// Zeus v122 — utils/dev.js
// Development tools, ZLOG logging, Hub settings, safeAsync
'use strict';

${extractLines(12153, 13017)}
`);

// AUB module (L21831-L22481) - from its own script tag
writeModule('js/brain/aub.js',
`// Zeus v122 — brain/aub.js
// AUB Analytics & Monitoring module
'use strict';

${extractLines(21832, 22480)}
`);

// ARIA/NOVA (L22482-L24066) - from its own script tags  
writeModule('js/brain/arianova.js',
`// Zeus v122 — brain/arianova.js
// ARIA pattern recognition + NOVA forecasting
'use strict';

${extractLines(22482, 24066)}
`);

// Orderflow modules (L24067-L29527) - all orderflow script tags
writeModule('js/data/orderflow.js',
`// Zeus v122 — data/orderflow.js
// Orderflow Modules P1-P15 + Patch Layer v122.3
'use strict';

${extractLines(24067, 29527)}
`);

// Patch layer (L29528-L29794)
writeModule('js/core/patch.js',
`// Zeus v122 — core/patch.js
// v122.3 Patch Layer — final patches
'use strict';

${extractLines(29528, 29794)}
`);


// ═══════════════════════════════════════════════════
// 9. BOOTSTRAP
// ═══════════════════════════════════════════════════
console.log('── core/bootstrap.js ──');

writeModule('js/core/bootstrap.js',
`// Zeus v122 — core/bootstrap.js
// Application init, startApp, initZeusGroups
'use strict';

// Init zeus groups (DOM structure)
${extractLines(20722, 20910)}

// Feed-gated extras
${extractLines(20911, 20950)}

// Health checks
${extractLines(20951, 21013)}

// startApp — MAIN ENTRY POINT
${extractLines(21014, 21413)}

// Build info
${extractLines(21414, 21498)}

// Master reset
${extractLines(21500, 21557)}

// Heartbeat reconnect
${extractLines(21557, 21811)}

// MidStack init
${extractLines(21596, 21811)}

// Global error handler
${extractLines(21812, 21830)}
`);


console.log('\n═══ EXTRACTION COMPLETE ═══');
console.log('All modules extracted to public/js/');
