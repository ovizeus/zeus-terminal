// Zeus v122 — teacher/teacherAutopilot.js
// TEACHER V2 — Main Autonomous Loop
// Orchestrates: fetch → replay → auto-trade → review → learn → next
// Manages capital ruin/reload, session chaining, curriculum advance
// 100% sandboxed — NO live writes
'use strict';

// ══════════════════════════════════════════════════════════════════
// AUTOPILOT STATE
// ══════════════════════════════════════════════════════════════════

var _teacherAutoRunning = false;
var _teacherAutoTimer = null;
var _teacherAutoPaused = false;

// Persistent V2 state (saved/loaded via teacherStorage)
function teacherInitV2State() {
  if (!window.TEACHER) return;
  var T = window.TEACHER;
  T.v2 = T.v2 || {
    running: false,
    status: 'IDLE',        // IDLE|LOADING|SCANNING|IN_TRADE|REVIEWING|LEARNING|FAIL|RELOADING
    statusDetail: '',
    startedAt: 0,

    // Capital management
    startCapital: 10000,
    currentCapital: 10000,
    failCount: 0,           // times capital was ruined
    reloadCount: 0,         // times capital was reloaded
    ruinThreshold: 1000,    // 90% loss = ruin

    // Current session
    currentSegment: null,    // from teacherPickNextSegment
    currentProfile: null,    // TEACHER_PROFILES[x]
    currentRegime: null,     // from teacherDetectRegimeV2
    currentTF: '',
    sessionTrades: 0,

    // Aggregate lifetime stats
    lifetimeTrades: [],      // all closed trades (capped at 2000)
    lifetimeStats: null,
    lifetimeSessions: 0,

    // Curriculum
    curriculum: teacherInitCurriculum(),

    // Last decisions for display
    lastDecision: null,      // { action, reasons, confidence, noTradeReasons, warnings }
    lastReview: null,        // post-trade review summary
    lastLesson: null,        // most recent lesson extracted
    recentActivity: [],      // last 20 activity log entries

    // Capability
    capability: 0,
    capabilityLabel: 'WEAK',
    capabilityBreakdown: null,
  };
  return T.v2;
}

// ══════════════════════════════════════════════════════════════════
// STATUS / LOG — Activity feed
// ══════════════════════════════════════════════════════════════════

function _teacherLog(msg, type) {
  var T = window.TEACHER;
  if (!T || !T.v2) return;
  type = type || 'info';
  T.v2.recentActivity.unshift({
    ts: Date.now(),
    msg: msg,
    type: type, // info | trade | review | fail | learn | warn
  });
  if (T.v2.recentActivity.length > 30) T.v2.recentActivity.length = 30;
}

function _teacherSetStatus(status, detail) {
  var T = window.TEACHER;
  if (!T || !T.v2) return;
  T.v2.status = status;
  T.v2.statusDetail = detail || '';
}

// ══════════════════════════════════════════════════════════════════
// CAPITAL MANAGEMENT — Ruin detection + reload
// ══════════════════════════════════════════════════════════════════

function _teacherCheckRuin() {
  var T = window.TEACHER;
  if (!T || !T.v2 || !T._equity) return false;
  return T._equity.capital <= T.v2.ruinThreshold;
}

function _teacherReloadCapital() {
  var T = window.TEACHER;
  if (!T || !T.v2) return;

  T.v2.failCount++;
  T.v2.reloadCount++;
  _teacherLog('CAPITAL DESTROYED — Fail #' + T.v2.failCount + ' — Reloading $10,000', 'fail');
  _teacherSetStatus('RELOADING', 'Fail #' + T.v2.failCount);

  // Reset equity
  T.v2.currentCapital = T.v2.startCapital;
  T.config.capitalUSD = T.v2.startCapital;
}

// ══════════════════════════════════════════════════════════════════
// MAIN AUTONOMOUS LOOP — Single session cycle
// Called repeatedly by the outer loop timer
// ══════════════════════════════════════════════════════════════════

/**
 * Run one complete autonomous session:
 * 1. Pick segment (curriculum)
 * 2. Fetch dataset
 * 3. Init replay
 * 4. Step bar-by-bar with auto entry/exit
 * 5. Session review + learning
 * 6. Record to curriculum
 * 7. Return or continue
 */
async function teacherRunOneSession() {
  var T = window.TEACHER;
  if (!T || !T.v2) return null;
  var v2 = T.v2;

  // ── 1. PICK SEGMENT ──
  _teacherSetStatus('LOADING', 'Choosing segment...');
  var segment;
  if (teacherShouldForceRotation(v2.curriculum)) {
    segment = teacherForceRotatedSegment(v2.curriculum);
    _teacherLog('Forced rotation — least-tested TF/regime', 'info');
  } else {
    segment = teacherPickNextSegment(v2.curriculum);
  }
  if (!segment) {
    _teacherLog('No segment available', 'warn');
    return null;
  }

  v2.currentSegment = segment;
  v2.currentTF = segment.tf;
  var monthLabel = segment.year + '-' + String(segment.month).padStart(2, '0');
  _teacherLog('Segment: ' + monthLabel + ' ' + segment.tf + (segment.isOOS ? ' [OOS]' : ' [IS]'), 'info');

  // ── 2. FETCH DATASET ──
  _teacherSetStatus('LOADING', 'Fetching ' + monthLabel + ' ' + segment.tf + '...');
  var dataset;
  try {
    dataset = await teacherLoadDataset({
      tf: segment.tf,
      startMs: segment.startMs,
      endMs: segment.endMs,
      maxBars: 5000,
    });
  } catch (err) {
    _teacherLog('Fetch failed: ' + err.message, 'warn');
    _teacherSetStatus('IDLE', 'Fetch error');
    return null;
  }

  if (!dataset || !dataset.bars || dataset.bars.length < 200) {
    _teacherLog('Insufficient data: ' + (dataset ? dataset.bars.length : 0) + ' bars', 'warn');
    return null;
  }

  _teacherLog('Loaded ' + dataset.bars.length + ' bars', 'info');

  // ── 3. INIT REPLAY ──
  // Set capital from current equity (persistent across sessions)
  T.config.capitalUSD = v2.currentCapital;
  teacherInitReplay(dataset, {
    startBar: Math.min(100, dataset.bars.length - 1),
    onTick: null,
    onComplete: null,
  });
  teacherInitEquity();

  // Do initial regime detection for profile selection
  var initBars = dataset.bars.slice(0, T.cursor + 1);
  var initRegime = teacherDetectRegimeV2(T.indicators, initBars);
  var profile = teacherAutoSelectProfile(initRegime);
  v2.currentProfile = profile;
  v2.currentRegime = initRegime;
  teacherSetMaxBarsInTrade(profile.maxBarsInTrade);

  _teacherLog('Profile: ' + profile.name + ' | Regime: ' + initRegime.regime, 'info');
  _teacherSetStatus('SCANNING', profile.name + ' | ' + initRegime.regime);

  // ── 4. BAR-BY-BAR REPLAY ──
  var maxCursor = dataset.bars.length - 1;
  var sessionTrades = 0;
  var noTradeCount = 0;
  var dominantRegimeMap = {};

  while (T.cursor < maxCursor && _teacherAutoRunning) {
    // Wait for unpause
    while (_teacherAutoPaused && _teacherAutoRunning) {
      await new Promise(function (r) { setTimeout(r, 200); });
    }
    if (!_teacherAutoRunning) break;

    // Step forward
    var tick = teacherStep(1);
    if (!tick) break;

    // Update regime detection every 10 bars
    if (T.cursor % 10 === 0) {
      var visibleBars = dataset.bars.slice(0, T.cursor + 1);
      var regime = teacherDetectRegimeV2(T.indicators, visibleBars);
      v2.currentRegime = regime;

      // Track regime for coverage
      dominantRegimeMap[regime.regime] = (dominantRegimeMap[regime.regime] || 0) + 1;

      // Possibly re-select profile on major regime change
      var newProfile = teacherAutoSelectProfile(regime);
      if (newProfile.name !== profile.name && !T.openTrade) {
        profile = newProfile;
        v2.currentProfile = profile;
        teacherSetMaxBarsInTrade(profile.maxBarsInTrade);
      }
    }

    // ── TRADE MANAGEMENT ──
    if (T.openTrade) {
      _teacherSetStatus('IN_TRADE', T.openTrade.side + ' @ ' + T.openTrade.entry.toFixed(0));

      // Process SL/TP/DSL (already handled by teacherStep → _teacherProcessTradeBar)
      // Check enhanced exits
      var exitReason = teacherDecideExit(T.openTrade, T.indicators, v2.currentRegime, profile);
      if (exitReason) {
        var bar = dataset.bars[T.cursor];
        var closed = _teacherCloseTrade(bar.close, exitReason, { bar: bar, barIndex: T.cursor });
        if (closed) {
          _teacherUpdateEquity(closed);
          _teacherPostTradeReview(closed, v2);
          sessionTrades++;
        }
      }

      // Check if trade was closed by SL/TP/DSL inside teacherStep
      if (!T.openTrade && T.trades.length > 0) {
        var lastTrade = T.trades[T.trades.length - 1];
        if (lastTrade.exitBar === T.cursor) {
          _teacherUpdateEquity(lastTrade);
          _teacherPostTradeReview(lastTrade, v2);
          sessionTrades++;
        }
      }

    } else {
      // ── ENTRY DECISION ──
      _teacherSetStatus('SCANNING', (v2.currentRegime ? v2.currentRegime.regime : '?') + ' | ' + profile.name);

      var equity = teacherGetEquity();
      var decision = teacherDecideEntry(
        T.indicators,
        v2.currentRegime,
        profile,
        equity,
        T.memory
      );
      v2.lastDecision = decision;

      if (decision.action !== 'NO_TRADE') {
        // Size the trade
        var sizing = teacherAutoSize(profile, equity || { currentCapital: v2.currentCapital, startCapital: v2.startCapital, currentDDPct: 0 }, T.indicators);
        if (sizing) {
          var opened = teacherOpenTrade(decision.action, {
            slPct: sizing.slPct,
            tpPct: sizing.tpPct,
            leverageX: sizing.leverageX,
            dslEnabled: sizing.dslEnabled,
            dslActivation: sizing.dslActivation,
            dslTrailPct: sizing.dslTrailPct,
            feeProfile: sizing.feeProfile,
            orderType: sizing.orderType,
          });
          if (opened) {
            // Store extra metadata on trade
            opened._profile = profile.name;
            opened._regime = v2.currentRegime ? v2.currentRegime.regime : 'UNKNOWN';
            opened._tf = segment.tf;
            opened._decision = decision;
            opened._segment = { year: segment.year, month: segment.month };
            _teacherLog(decision.action + ' @ ' + opened.entry.toFixed(0) + ' [' + decision.reasons.join(', ') + ']', 'trade');
            noTradeCount = 0;
          }
        }
      } else {
        noTradeCount++;
      }
    }

    // ── RUIN CHECK ──
    if (_teacherCheckRuin()) {
      _teacherReloadCapital();
      // Force-close any open trade
      if (T.openTrade) {
        var ruinBar = dataset.bars[T.cursor];
        _teacherCloseTrade(ruinBar.close, 'RUIN_EXIT', { bar: ruinBar, barIndex: T.cursor });
      }
      // Reset equity for next trades in this session
      teacherInitEquity();
      _teacherLog('Capital reloaded. Continuing session.', 'fail');
    }

    // ── AUTO SPEED ──
    var speed = teacherAutoSpeed(!!T.openTrade, T.indicators, v2.currentRegime);
    await new Promise(function (r) { setTimeout(r, speed); });

    // Update UI callback if registered
    if (typeof _teacherV2OnTick === 'function') {
      try { _teacherV2OnTick(tick); } catch (e) {}
    }
  }

  // ── 5. FORCE-CLOSE open trade at end ──
  if (T.openTrade && dataset.bars.length > 0) {
    var lastBar = dataset.bars[dataset.bars.length - 1];
    var finalClosed = _teacherCloseTrade(lastBar.close, 'SESSION_END', { bar: lastBar, barIndex: dataset.bars.length - 1 });
    if (finalClosed) {
      _teacherUpdateEquity(finalClosed);
      _teacherPostTradeReview(finalClosed, v2);
      sessionTrades++;
    }
  }

  // ── 6. SESSION SUMMARY ──
  var sessionStats = null;
  if (typeof teacherComputeStats === 'function' && T.trades.length > 0) {
    sessionStats = teacherComputeStats(T.trades);
  }

  // Determine dominant regime
  var dominantRegime = 'RANGE';
  var maxRegimeCount = 0;
  for (var rk in dominantRegimeMap) {
    if (dominantRegimeMap[rk] > maxRegimeCount) {
      maxRegimeCount = dominantRegimeMap[rk];
      dominantRegime = rk;
    }
  }

  var sessionResult = {
    sessionId: 'S_' + Date.now(),
    totalTrades: sessionTrades,
    totalPnl: sessionStats ? sessionStats.totalPnl : 0,
    winRate: sessionStats ? sessionStats.winRate : 0,
    profitFactor: sessionStats ? sessionStats.profitFactor : 0,
    profile: profile.name,
    tf: segment.tf,
    dominantRegime: dominantRegime,
    isOOS: segment.isOOS,
    barsReplayed: T.cursor + 1,
    year: segment.year,
    month: segment.month,
  };

  // ── 7. LEARNING PHASE ──
  _teacherSetStatus('LEARNING', 'Extracting lessons...');

  // Add trades to lifetime pool
  for (var ti = 0; ti < T.trades.length; ti++) {
    var tr = T.trades[ti];
    // Enrich with profile/regime/tf metadata
    tr._profile = tr._profile || profile.name;
    tr._regime = tr._regime || dominantRegime;
    tr._tf = tr._tf || segment.tf;
    tr._isOOS = segment.isOOS;
    tr._classification = teacherClassifyTradeV2(tr);
    v2.lifetimeTrades.push(tr);
  }
  // Cap lifetime trades
  if (v2.lifetimeTrades.length > 2000) {
    v2.lifetimeTrades = v2.lifetimeTrades.slice(-2000);
  }

  // Lessons + memory
  if (typeof teacherExtractLessons === 'function' && T.trades.length > 0) {
    var lessons = teacherExtractLessons(T.trades);
    if (typeof teacherEndSessionMemoryUpdate === 'function') {
      teacherEndSessionMemoryUpdate(T.trades);
    }
    if (lessons && lessons.length > 0) {
      v2.lastLesson = lessons[0];
      _teacherLog('Learned ' + lessons.length + ' lesson(s)', 'learn');
    }
  }

  // Record to curriculum
  teacherRecordSegment(v2.curriculum, segment, sessionResult);

  // Update equity to v2 state
  var eq = teacherGetEquity();
  if (eq) v2.currentCapital = eq.currentCapital;

  // Update capability
  if (typeof teacherComputeCapability === 'function') {
    var cap = teacherComputeCapability(v2);
    v2.capability = cap.score;
    v2.capabilityLabel = cap.label;
    v2.capabilityBreakdown = cap.breakdown;
  }

  // Lifetime stats
  if (typeof teacherComputeStats === 'function' && v2.lifetimeTrades.length > 0) {
    v2.lifetimeStats = teacherComputeStats(v2.lifetimeTrades);
  }
  v2.lifetimeSessions++;

  _teacherLog('Session complete: ' + sessionTrades + ' trades, PnL: $' + (sessionStats ? sessionStats.totalPnl.toFixed(2) : '0.00') + (segment.isOOS ? ' [OOS]' : ''), 'info');

  // Persist
  if (typeof teacherSaveV2State === 'function') teacherSaveV2State();

  return sessionResult;
}

// ══════════════════════════════════════════════════════════════════
// POST-TRADE REVIEW — Auto-analyze each closed trade
// ══════════════════════════════════════════════════════════════════

function _teacherPostTradeReview(trade, v2) {
  if (!trade || !v2) return;

  var review = { tradeId: trade.id, ts: Date.now() };

  // Classify
  trade._classification = teacherClassifyTradeV2(trade);

  // Score
  if (typeof teacherScoreTrade === 'function') {
    var scoreResult = teacherScoreTrade(trade);
    trade._qualityScore = scoreResult.score;
    trade._qualityGrade = scoreResult.grade;
    review.score = scoreResult.score;
    review.grade = scoreResult.grade;
  }

  // R-multiple
  if (typeof teacherCalcRMultiple === 'function') {
    trade._rMultiple = teacherCalcRMultiple(trade);
  }

  // WHY analysis (only for interesting trades)
  if (trade._classification === 'MISTAKE' || trade._classification === 'BAD_TRADE' ||
      trade._classification === 'AVOIDABLE_LOSS' || trade._classification === 'LUCKY_TRADE') {
    if (typeof teacherWhyEntered === 'function') {
      review.whyEntered = teacherWhyEntered(trade);
    }
    if (typeof teacherWhyExited === 'function') {
      review.whyExited = teacherWhyExited(trade);
    }
    if (typeof teacherWhyOutcome === 'function') {
      review.whyOutcome = teacherWhyOutcome(trade);
    }
    _teacherLog(trade._classification + ': ' + trade.side + ' ' + trade.exitReason + ' (' + (trade.pnlNet >= 0 ? '+' : '') + trade.pnlNet.toFixed(2) + ')', 'review');
  } else {
    _teacherLog(trade.side + ' ' + trade.exitReason + ' → ' + trade.outcome + ' ' + (trade.pnlNet >= 0 ? '+' : '') + '$' + trade.pnlNet.toFixed(2), 'trade');
  }

  v2.lastReview = review;
}

// ══════════════════════════════════════════════════════════════════
// START / STOP — Public API
// ══════════════════════════════════════════════════════════════════

async function teacherStartAutonomous() {
  var T = window.TEACHER;
  if (!T) {
    if (typeof _initTeacherState === 'function') window.TEACHER = _initTeacherState();
    T = window.TEACHER;
  }
  if (!T) return;

  teacherInitV2State();
  var v2 = T.v2;

  // Load persisted state
  if (typeof teacherLoadV2State === 'function') teacherLoadV2State();
  if (typeof teacherLoadAllPersistent === 'function') teacherLoadAllPersistent();

  _teacherAutoRunning = true;
  _teacherAutoPaused = false;
  v2.running = true;
  v2.startedAt = Date.now();

  _teacherLog('TEACHER V2 STARTED — Autonomous mode', 'info');
  _teacherSetStatus('LOADING', 'Starting autonomous loop...');

  // Main loop: run sessions continuously
  while (_teacherAutoRunning) {
    try {
      var result = await teacherRunOneSession();
      if (!result && _teacherAutoRunning) {
        // Brief pause before retry on fetch failure
        _teacherLog('Retrying in 5s...', 'warn');
        await new Promise(function (r) { setTimeout(r, 5000); });
      }
    } catch (err) {
      _teacherLog('Session error: ' + err.message, 'warn');
      await new Promise(function (r) { setTimeout(r, 5000); });
    }

    // Small gap between sessions
    if (_teacherAutoRunning) {
      _teacherSetStatus('IDLE', 'Preparing next session...');
      await new Promise(function (r) { setTimeout(r, 2000); });
    }
  }

  v2.running = false;
  _teacherSetStatus('IDLE', 'Stopped');
  _teacherLog('TEACHER V2 STOPPED', 'info');
  if (typeof teacherSaveV2State === 'function') teacherSaveV2State();
}

function teacherStopAutonomous() {
  _teacherAutoRunning = false;
  var T = window.TEACHER;
  if (T && T.v2) {
    T.v2.running = false;
    _teacherSetStatus('IDLE', 'Stopping...');
  }
  // Also stop any V1 replay
  if (typeof teacherStopReplay === 'function') teacherStopReplay();
}

function teacherIsRunning() {
  return _teacherAutoRunning;
}

// UI tick callback (set by panel)
var _teacherV2OnTick = null;
function teacherSetV2TickCallback(fn) {
  _teacherV2OnTick = typeof fn === 'function' ? fn : null;
}
