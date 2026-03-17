// Zeus v122 — teacher/teacherConfig.js
// THE TEACHER — Configuration, constants, defaults, state init
// 100% sandboxed — NO writes to S, BM, BRAIN, CORE_STATE, TP, AT, or any live object
'use strict';

// ══════════════════════════════════════════════════════════════════
// FEE / SLIPPAGE MODEL (independent copy — does NOT read live FEE_MODEL)
// ══════════════════════════════════════════════════════════════════
const TEACHER_FEES = Object.freeze({
  makerPct:  0.0002,   // 0.02%
  takerPct:  0.0004,   // 0.04%
  slippage: Object.freeze({
    fast:       0.0003,  // 0.03% — scalping
    swing:      0.0002,  // 0.02%
    defensive:  0.0001,  // 0.01%
  }),
});

// ══════════════════════════════════════════════════════════════════
// INDICATOR DEFAULTS
// ══════════════════════════════════════════════════════════════════
const TEACHER_IND_DEFAULTS = Object.freeze({
  rsiPeriod:    14,
  adxPeriod:    14,
  macdFast:     12,
  macdSlow:     26,
  macdSignal:    9,
  stMult:        3,
  stPeriod:     10,
  atrPeriod:    14,
  bbPeriod:     20,
  bbMult:        2,
  squeezeLookback: 20,
});

// ══════════════════════════════════════════════════════════════════
// REPLAY DEFAULTS
// ══════════════════════════════════════════════════════════════════
const TEACHER_REPLAY_DEFAULTS = Object.freeze({
  timeframe:   '5m',       // default replay TF
  speedMs:     500,        // ms per bar in auto-play
  minBars:     200,        // minimum bars needed before replay starts
  maxBars:     5000,       // max bars per dataset
  lookback:    100,        // bars visible before cursor at start
});

// ══════════════════════════════════════════════════════════════════
// TRADE SIMULATION DEFAULTS
// ══════════════════════════════════════════════════════════════════
const TEACHER_TRADE_DEFAULTS = Object.freeze({
  capitalUSD:    10000,    // starting virtual capital (V2: $10,000)
  leverageX:         5,    // default leverage
  maxLeverage:      20,    // hard cap
  slPct:           1.0,    // default SL %
  tpPct:           2.0,    // default TP %
  dslEnabled:     true,    // Dynamic SL (trailing)
  dslActivation:   0.5,    // activate trail after +0.5%
  dslTrailPct:     0.3,    // trail distance %
  feeProfile:   'swing',   // 'fast' | 'swing' | 'defensive'
  orderType:   'MARKET',   // 'MARKET' | 'LIMIT'
});

// ══════════════════════════════════════════════════════════════════
// TAG TAXONOMY (reason/classification tags for trade analysis)
// ══════════════════════════════════════════════════════════════════
const TEACHER_TAGS = Object.freeze({
  entryReasons: [
    'RSI_OVERSOLD', 'RSI_OVERBOUGHT',
    'MACD_CROSS_BULL', 'MACD_CROSS_BEAR',
    'ST_FLIP_BULL', 'ST_FLIP_BEAR',
    'BB_SQUEEZE_BREAK', 'BB_TOUCH_LOWER', 'BB_TOUCH_UPPER',
    'HIGH_ADX_TREND', 'LOW_ADX_RANGE',
    'CONFLUENCE_HIGH', 'CONFLUENCE_LOW',
    'VOLUME_CLIMAX', 'DIVERGENCE_BULL', 'DIVERGENCE_BEAR',
    'REGIME_TREND', 'REGIME_BREAKOUT', 'REGIME_RANGE',
  ],
  exitReasons: [
    'TP_HIT', 'SL_HIT', 'DSL_HIT', 'MANUAL_EXIT',
    'SIGNAL_FLIP', 'REGIME_CHANGE', 'CONFLUENCE_DROP',
    'TIME_STOP', 'MAX_BARS_EXIT',
  ],
  outcomes: ['WIN', 'LOSS', 'BREAKEVEN'],
});

// ══════════════════════════════════════════════════════════════════
// TIMEFRAME CONFIGS
// ══════════════════════════════════════════════════════════════════
const TEACHER_TIMEFRAMES = Object.freeze({
  '1m':  { ms:   60000, label: '1m',  klineKey: '1m'  },
  '3m':  { ms:  180000, label: '3m',  klineKey: '3m'  },
  '5m':  { ms:  300000, label: '5m',  klineKey: '5m'  },
  '15m': { ms:  900000, label: '15m', klineKey: '15m' },
  '1h':  { ms: 3600000, label: '1h',  klineKey: '1h'  },
  '4h':  { ms:14400000, label: '4h',  klineKey: '4h'  },
});

// ══════════════════════════════════════════════════════════════════
// STORAGE KEYS (prefixed to isolate from live data)
// ══════════════════════════════════════════════════════════════════
const TEACHER_STORAGE_KEYS = Object.freeze({
  config:     'zeus_teacher_config',
  sessions:   'zeus_teacher_sessions',
  lessons:    'zeus_teacher_lessons',
  stats:      'zeus_teacher_stats',
  memory:     'zeus_teacher_memory',
  v2state:    'zeus_teacher_v2state',
});

// ══════════════════════════════════════════════════════════════════
// TEACHER STATE — completely isolated global (window.TEACHER)
// ══════════════════════════════════════════════════════════════════
function _initTeacherState() {
  return {
    // ── status ──
    active:     false,     // is teacher panel open
    replaying:  false,     // is replay running (auto-play)
    paused:     false,     // is replay paused

    // ── dataset ──
    dataset:    null,      // { bars:[], tf:'5m', symbol:'BTCUSDT', loadedAt:ts }
    cursor:     0,         // current bar index in dataset

    // ── indicators (computed per cursor) ──
    indicators: {
      rsi: null, adx: null, macd: null, macdSignal: null, macdHist: null,
      stDir: 'neut', atr: null,
      bbUpper: null, bbMiddle: null, bbLower: null, bbSqueeze: false,
      regime: 'RANGE', regimeConf: 0,
      confluence: 50,
    },

    // ── current simulated trade (null = no open trade) ──
    openTrade:  null,
    // { side:'LONG'|'SHORT', entry, sl, tp, dsl:{active,trail}, entryBar, entryTs,
    //   entryReasons:[], leverage, qty, notional, feePaid }

    // ── completed trades history (this session) ──
    trades:     [],

    // ── lessons + memory (persistent) ──
    lessons:    [],
    memory:     { patterns: [], edges: [], mistakes: [] },

    // ── stats (computed from trades) ──
    stats:      null,

    // ── config overrides (user can tweak per session) ──
    config: {
      capitalUSD:    TEACHER_TRADE_DEFAULTS.capitalUSD,
      leverageX:     TEACHER_TRADE_DEFAULTS.leverageX,
      slPct:         TEACHER_TRADE_DEFAULTS.slPct,
      tpPct:         TEACHER_TRADE_DEFAULTS.tpPct,
      dslEnabled:    TEACHER_TRADE_DEFAULTS.dslEnabled,
      dslActivation: TEACHER_TRADE_DEFAULTS.dslActivation,
      dslTrailPct:   TEACHER_TRADE_DEFAULTS.dslTrailPct,
      feeProfile:    TEACHER_TRADE_DEFAULTS.feeProfile,
      orderType:     TEACHER_TRADE_DEFAULTS.orderType,
      timeframe:     TEACHER_REPLAY_DEFAULTS.timeframe,
      speedMs:       TEACHER_REPLAY_DEFAULTS.speedMs,
    },
  };
}

// Initialize on load — fully sandboxed
window.TEACHER = _initTeacherState();

// Reset to clean state (for new session)
function teacherResetState() {
  window.TEACHER = _initTeacherState();
}
