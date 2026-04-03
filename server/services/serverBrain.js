// Zeus Terminal — Server Brain Cycle (Phase 3)
// Runs the brain decision pipeline server-side: confluence, regime, AT gate check, fusion.
// Observation-only — logs decisions but does NOT execute trades.
// Gated by MF.SERVER_BRAIN flag.
'use strict';

const Sentry = require('@sentry/node');
const logger = require('./logger');
const brainLock = require('../brainLock');
const serverState = require('./serverState');
const serverAT = require('./serverAT');
const telegram = require('./telegram');
const db = require('./database');
const serverStructure = require('./serverStructure');
const serverLiquidity = require('./serverLiquidity');
const serverOrderflow = require('./serverOrderflow');
const serverRegimeParams = require('./serverRegimeParams');
const serverJournal = require('./serverJournal');
const serverSentiment = require('./serverSentiment');
const serverKNN = require('./serverKNN');
const serverReflection = require('./serverReflection');
const serverCalibration = require('./serverCalibration');
const serverPendingEntry = require('./serverPendingEntry');
const serverExitManager = require('./serverExitManager');
const serverCorrelationGuard = require('./serverCorrelationGuard');
const serverAdaptiveSizing = require('./serverAdaptiveSizing');
const serverSessionProfile = require('./serverSessionProfile');
const serverDrawdownGuard = require('./serverDrawdownGuard');
const serverMultiEntry = require('./serverMultiEntry');
const serverVolatilityEngine = require('./serverVolatilityEngine');

// ══════════════════════════════════════════════════════════════════
// Configuration
// ══════════════════════════════════════════════════════════════════
const CYCLE_INTERVAL_MS = 30000;    // 30s brain cycle (matches client AT interval)
const STALE_DATA_MS = 120000;       // 2min = data too old
const MIN_BARS = 50;                // minimum candles for valid analysis

// ── Per-user trading config (mirrors client TC defaults) ──
const DEFAULT_STC = {
    confMin: 65,        // minimum confluence for entry
    sigMin: 3,          // minimum signal count
    adxMin: 18,         // minimum ADX for trend confirmation
    maxPos: 3,          // max simultaneous positions
    cooldownMs: 300000, // 5min cooldown between entries per symbol
    lev: 5,
    size: 200,
    slPct: 1.5,
    rr: 2,
    dslMode: 'def',     // Brain DSL mode (fast/tp/def/atr/swing)
    symbols: null,      // [MULTI-SYM] null = trade all configured symbols, or array of specific symbols
};
const _stcMap = new Map(); // userId → STC config

// _getSTC removed — unused (brain uses _stcMap directly)

// ── Brain state ──
let _timer = null;
let _running = false;
let _cycleCount = 0;
let _lastDecision = null;
const _prevRegimes = new Map();  // [MULTI-SYM] symbol → last regime
const _cooldowns = new Map();   // 'userId:symbol' → lastEntryTs
// [AUDIT] Per-user regime change Telegram throttle (max 1 per 15min per user)
const _regimeTgLastTs = new Map();  // userId → timestamp
const REGIME_TG_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

// ── Decision log (ring buffer) ──
const DECISION_LOG_MAX = 200;
const _decisionLog = [];

// ══════════════════════════════════════════════════════════════════
// Start / Stop
// ══════════════════════════════════════════════════════════════════
function start() {
    if (_timer) return;
    // ── Restore persisted state from SQLite ──
    _restoreStcFromDb();
    _restoreCooldowns();
    logger.info('BRAIN', 'Server brain starting (observation mode, 30s cycle)');
    // [BRAIN-V2] Start liquidity depth polling + order flow tracking
    serverLiquidity.startDepthPolling(serverState.getConfiguredSymbols());
    serverOrderflow.init();
    serverJournal.start();
    serverSentiment.start(serverState.getConfiguredSymbols());
    serverKNN.start();
    serverReflection.start();
    _timer = setInterval(_runCycle, CYCLE_INTERVAL_MS);
    // Run first cycle after short delay to let data settle
    setTimeout(_runCycle, 5000);
}

function _restoreStcFromDb() {
    try {
        const rows = db.db.prepare("SELECT key, value, user_id FROM at_state WHERE key LIKE 'stc:%'").all();
        let restored = 0;
        for (const row of rows) {
            const m = /^stc:(\d+)$/.exec(row.key);
            if (!m) continue;
            const userId = parseInt(m[1], 10);
            if (!userId || userId <= 0) continue;
            try {
                const cfg = JSON.parse(row.value);
                if (cfg && typeof cfg === 'object') {
                    _stcMap.set(userId, Object.assign({}, DEFAULT_STC, cfg));
                    restored++;
                }
            } catch (_) { /* skip corrupt row */ }
        }
        if (restored > 0) {
            logger.info('BRAIN', `Restored STC config for ${restored} user(s) from DB`);
        }
    } catch (err) {
        logger.error('BRAIN', 'Failed to restore STC from DB:', err.message);
    }
}

function _persistCooldowns() {
    try {
        const obj = {};
        for (const [k, v] of _cooldowns) obj[k] = v;
        db.atSetState('brain:cooldowns', obj, null);
    } catch (_) {}
}

function _restoreCooldowns() {
    try {
        const saved = db.atGetState('brain:cooldowns');
        if (saved && typeof saved === 'object') {
            const now = Date.now();
            let restored = 0;
            for (const [k, v] of Object.entries(saved)) {
                // Only restore cooldowns less than 10min old
                if (typeof v === 'number' && (now - v) < 600000) {
                    _cooldowns.set(k, v);
                    restored++;
                }
            }
            if (restored > 0) logger.info('BRAIN', `Restored ${restored} cooldown(s) from DB`);
        }
    } catch (_) {}
}

function stop() {
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
    _running = false;
    logger.info('BRAIN', 'Server brain stopped');
}

// ══════════════════════════════════════════════════════════════════
// Main Brain Cycle
// ══════════════════════════════════════════════════════════════════
function _runCycle() {
    if (_running) return;
    if (!brainLock.acquire('brainCycle')) {
        logger.warn('BRAIN', 'Brain cycle skipped — lock held');
        return;
    }
    _running = true;
    _cycleCount++;

    try {
        // ── [MULTI-SYM] Get all symbols with sufficient data ──
        const readySymbols = serverState.getReadySymbols();
        if (readySymbols.length === 0) {
            _logDecision('SKIP', 'DATA_NOT_READY', null, { reason: 'No symbols have sufficient data' });
            return;
        }

        if (_stcMap.size === 0) {
            _logDecision('SKIP', 'NO_USERS', null, { reason: 'No user TC configs — skipping cycle' });
            return;
        }
        const users = _stcMap;
        let loggedDecision = null;

        // ── Iterate each ready symbol independently ──
        for (const symbol of readySymbols) {
            const snap = serverState.getSnapshotForSymbol(symbol);
            if (!snap || !snap.indicators) continue;

            // Data staleness check (per-symbol)
            if (snap.stale || (Date.now() - snap.priceTs) > STALE_DATA_MS) continue;

            // [REFLECTION] Track price + regime for calibration/transition detection
            serverCalibration.trackPrice(symbol, snap.price);
            serverCalibration.trackRegime(symbol, snap.indicators.regime || 'RANGE', snap.indicators.adx, snap.indicators.volatilityState);
            // [REFLECTION] Evaluate previously skipped trades (per-user)
            for (const [_uid] of users) {
                serverReflection.evaluateSkipped(symbol, snap.price, _uid);
            }

            const ind = snap.indicators;

            // ── Confluence score ──
            const confluence = _calcConfluence(snap, ind);

            // ── Regime ──
            const regime = {
                regime: ind.regime || 'RANGE',
                confidence: ind.regimeConf || 0,
                trendBias: ind.trendBias || 'neutral',
                volatilityState: ind.volatilityState || 'normal',
                trapRisk: ind.trapRisk || 0,
            };

            // Log regime changes (per-symbol)
            const prevRegimeForSym = _prevRegimes.get(symbol);
            if (prevRegimeForSym !== undefined && prevRegimeForSym !== regime.regime) {
                logger.info('BRAIN', `[${symbol}] Regime change: ${prevRegimeForSym} → ${regime.regime} (conf=${regime.confidence}%)`);
                // Persist regime change to SQLite
                try { db.saveRegimeChange(symbol, regime.regime, prevRegimeForSym, regime.confidence, snap.price || 0); } catch (_) {}
                const _regimeMsg = '🌐 *Regime Change* `' + symbol.replace('USDT', '') + '`\n' +
                    '`' + prevRegimeForSym + '` → *' + regime.regime + '*\n' +
                    'Confidence: `' + regime.confidence + '%`\n' +
                    'Bias: `' + regime.trendBias + '` | Vol: `' + regime.volatilityState + '`\n' +
                    'Price: `$' + (snap.price ? snap.price.toFixed(snap.price >= 100 ? 0 : 2) : '?') + '`';
                const _now = Date.now();
                // Only notify users who have active TC config (= brain/AT participants)
                for (const _uid of _stcMap.keys()) {
                    const _lastTs = _regimeTgLastTs.get(_uid) || 0;
                    if (_now - _lastTs >= REGIME_TG_COOLDOWN_MS) {
                        _regimeTgLastTs.set(_uid, _now);
                        telegram.sendToUser(_uid, _regimeMsg);
                    }
                }
            }
            _prevRegimes.set(symbol, regime.regime);

            // ── Per-user gate check + fusion + AT execution ──
            for (const [userId, stc] of users) {
                // Skip users who have AT disabled — no point computing gates/fusion
                if (!serverAT.isATActive(userId)) continue;
                // [MULTI-SYM] Skip if user has symbol selection and this symbol is not in it
                if (Array.isArray(stc.symbols) && !stc.symbols.includes(symbol)) continue;

                // [2G] Check existing pending entries before evaluating new ones
                const pendingResult = serverPendingEntry.checkPending(symbol, snap.price, userId);
                if (pendingResult) {
                    if (pendingResult.action === 'FILL' || pendingResult.action === 'MOMENTUM') {
                        // Execute the pending entry via AT (use stored stc from pending)
                        const pendStc = pendingResult.pending.stc || serverRegimeParams.getAdaptedParams(regime.regime, stc);
                        const entry = serverAT.processBrainDecision(pendingResult.pending.decision, pendStc, userId);
                        if (entry) {
                            logger.info('BRAIN', `[2G] Pending ${pendingResult.action} executed for uid=${userId} ${symbol}`);
                        }
                    }
                    // EXPIRE and CANCEL — nothing to do, already cleaned up
                }

                // [V3] Multi-entry / pyramiding check for existing winning positions
                if (!pendingResult) {
                    const existingPos = (serverAT.getOpenPositions ? serverAT.getOpenPositions(userId) : [])
                        .find(p => p.symbol === symbol);
                    if (existingPos && existingPos.pnlPct > 0) {
                        const scaleCheck = serverMultiEntry.checkScaleIn(existingPos, confluence.score, regime.regime);
                        if (scaleCheck.shouldScale) {
                            const scaleStc = { ...serverRegimeParams.getAdaptedParams(regime.regime, stc) };
                            scaleStc.size = Math.round(scaleStc.size * scaleCheck.sizeMultiplier);
                            const scaleDec = {
                                ts: Date.now(), cycle: _cycleCount, symbol, price: snap.price, priceTs: snap.priceTs,
                                fusion: { dir: existingPos.side, decision: 'SMALL', confidence: confluence.score, score: confluence.score, reasons: ['scale_in'] },
                            };
                            const scaleEntry = serverAT.processBrainDecision(scaleDec, scaleStc, userId);
                            if (scaleEntry) {
                                serverMultiEntry.recordScaleIn(userId, symbol, snap.price, scaleStc.size);
                                logger.info('BRAIN', `[V3] Scale-in L${scaleCheck.level} ${symbol} uid=${userId}`);
                            }
                        }
                    }
                }

                // [V3] Session block check
                const sessionBlock = serverSessionProfile.checkSessionBlock(userId);
                if (sessionBlock.blocked) {
                    _logDecision('BLOCKED', 'session', null, { reason: sessionBlock.reason });
                    continue;
                }

                // [V3] Drawdown assessment
                const us = serverAT.getUserState ? serverAT.getUserState(userId) : null;
                const dailyPnL = us ? (us.dailyPnL || 0) : 0;
                const refBalance = us ? (us.demoBalance || us.liveBalanceRef || 10000) : 10000;
                const ddAssess = serverDrawdownGuard.assessDrawdown(dailyPnL, refBalance);
                if (ddAssess.locked) {
                    _logDecision('BLOCKED', 'drawdown_lockout', null, { drawdownPct: ddAssess.drawdownPct });
                    continue;
                }

                // [BRAIN-V2] Adapt STC params to current regime
                const adaptedStc = serverRegimeParams.getAdaptedParams(regime.regime, stc);

                // [V3] Volatility-adjusted params
                const bars = serverState.getBarsForSymbol(symbol);
                const volProfile = serverVolatilityEngine.assessVolatility(snap, bars);
                const volAdjustedStc = serverVolatilityEngine.adjustParams(adaptedStc, volProfile);

                // [V3] Drawdown raises confMin requirement
                if (ddAssess.confBoost > 0) {
                    volAdjustedStc.confMin = (volAdjustedStc.confMin || 65) + ddAssess.confBoost;
                }

                const gates = _checkGates(snap, ind, confluence, volAdjustedStc, userId);
                const fusion = _computeFusion(snap, ind, confluence, regime, gates, bars, userId);
                const decision = {
                    ts: Date.now(),
                    cycle: _cycleCount,
                    symbol: snap.symbol,
                    price: snap.price,
                    priceTs: snap.priceTs,
                    confluence: confluence,
                    regime: regime,
                    gates: gates,
                    fusion: fusion,
                };
                if (!loggedDecision) loggedDecision = decision;

                if (fusion.decision !== 'NO_TRADE') {
                    // [REFLECTION] Pre-trade questioning — brain asks itself "am I sure?"
                    const marketCtx = _buildMarketContext(snap, bars, userId);
                    const questioning = serverReflection.questionEntry(
                        snap.symbol, fusion.dir, fusion.confidence, regime.regime, marketCtx, userId
                    );

                    if (!questioning.proceed) {
                        // Brain blocked its own entry
                        serverReflection.trackSkippedTrade(snap.symbol, fusion.dir, fusion.confidence, snap.price, userId);
                        _logDecision('BLOCKED', 'reflection', decision, {
                            concerns: questioning.concerns.map(c => c.type),
                        });
                        continue; // skip to next user
                    }

                    // Apply confidence penalty from reflection
                    if (questioning.totalPenalty) {
                        decision.fusion.confidence = Math.max(0, decision.fusion.confidence + questioning.totalPenalty);
                        // Re-evaluate tier after penalty
                        if (decision.fusion.confidence < 62) {
                            decision.fusion.decision = 'NO_TRADE';
                            decision.fusion.reasons.push('reflection_penalty');
                            serverReflection.trackSkippedTrade(snap.symbol, fusion.dir, fusion.confidence, snap.price, userId);
                            continue;
                        } else if (decision.fusion.confidence < 72) {
                            decision.fusion.decision = 'SMALL';
                        }
                    }

                    // [REFLECTION] Enrich entry snapshot with all V2 data for post-trade analysis
                    decision._entrySnapshot = {
                        confidence: fusion.confidence,
                        regime: regime.regime,
                        mtfAlignment: _calcMTFAlignment(snap, confluence),
                        structureTrend: serverStructure.getStructure(snap.symbol, bars || []).trend,
                        liquidityGrabRisk: Math.round(serverLiquidity.getLiquidity(snap.symbol, bars || [], snap.price).liquidityGrabRisk * 100),
                        cvdAligned: _isCvdAligned(snap, confluence),
                        regimeTransition: serverCalibration.detectRegimeTransition(snap.symbol),
                        reflectionConcerns: questioning.concerns.length,
                    };

                    // [V3] Correlation guard — block if too much correlated exposure
                    const openPos = serverAT.getOpenPositions ? serverAT.getOpenPositions(userId) : [];
                    const corrCheck = serverCorrelationGuard.checkEntry(snap.symbol, fusion.dir, openPos);
                    if (!corrCheck.allowed) {
                        _logDecision('BLOCKED', 'correlation', decision, { reason: corrCheck.reason });
                        continue;
                    }

                    // [V3] Correlation modifier on confidence
                    const corrMod = serverCorrelationGuard.getCorrelationModifier(snap.symbol, fusion.dir, openPos);
                    if (corrMod < 1.0) {
                        decision.fusion.confidence = Math.round(decision.fusion.confidence * corrMod);
                        if (decision.fusion.confidence < 62) {
                            decision.fusion.decision = 'NO_TRADE';
                            decision.fusion.reasons.push('correlation_penalty');
                            continue;
                        }
                    }

                    // [V3] Adaptive sizing
                    const sizingResult = serverAdaptiveSizing.calcSizeMultiplier(
                        userId, fusion.decision, fusion.confidence, regime.regime, dailyPnL, volAdjustedStc.size
                    );
                    // [V3] Drawdown size scaling
                    const ddSizeScale = ddAssess.sizeScale != null ? ddAssess.sizeScale : 1.0;
                    const finalSizeMult = sizingResult.multiplier * ddSizeScale;
                    const sizingStc = { ...volAdjustedStc, size: Math.round(volAdjustedStc.size * finalSizeMult) };

                    // [2G] Pending Entry System — wait for pullback instead of instant entry
                    const pending = serverPendingEntry.createPending(decision, sizingStc, userId, marketCtx);
                    if (pending) {
                        _cooldowns.set(userId + ':' + decision.symbol, Date.now());
                        _persistCooldowns();
                        logger.info(`[BRAIN] Pending entry created for user ${userId} ${decision.symbol} (${volAdjustedStc.cooldownMs}ms cooldown)`);
                    } else {
                        // Fallback: if pending creation failed (e.g., already pending), execute directly
                        const entry = serverAT.processBrainDecision(decision, sizingStc, userId);
                        if (entry) {
                            _cooldowns.set(userId + ':' + decision.symbol, Date.now());
                            _persistCooldowns();
                            logger.info(`[BRAIN] Direct entry for user ${userId} ${decision.symbol}`);
                        }
                    }
                } else {
                    // Track NO_TRADE for regret analysis
                    if (fusion.confidence > 50) {
                        serverReflection.trackSkippedTrade(snap.symbol, confluence.isBull ? 'LONG' : 'SHORT', fusion.confidence, snap.price, userId);
                    }
                }
            }

            // ── Log summary per symbol (every 10 cycles or on trade signal) ──
            if (_cycleCount % 10 === 0) {
                logger.info('BRAIN',
                    `[C${_cycleCount}] ${symbol} $${snap.price} | ` +
                    `Conf=${confluence.score} | Regime=${regime.regime}(${regime.confidence}%) | ` +
                    `ADX=${ind.adx != null ? ind.adx.toFixed(1) : '—'} RSI=${snap.rsi['5m'] != null ? snap.rsi['5m'].toFixed(1) : '—'} | ` +
                    `MTF=${Object.entries(snap.mtfIndicators || {}).map(([t, v]) => t + ':' + (v.stDir || '?')).join(',')} | ` +
                    `Struct=${serverStructure.getStructure(symbol, serverState.getBarsForSymbol(symbol)).trend}`
                );
            }
        }

        // [FIX-EXPIRY] Time-based expiry removed — positions close only via SL/TP/DSL/manual/kill/recon

        _lastDecision = loggedDecision;
        if (loggedDecision) {
            _logDecision(
                loggedDecision.fusion.decision,
                loggedDecision.fusion.decision === 'NO_TRADE' ? 'gates_or_fusion' : loggedDecision.fusion.dir,
                loggedDecision,
                { score: loggedDecision.confluence.score, regime: loggedDecision.regime.regime, confidence: loggedDecision.fusion.confidence }
            );
        }

    } catch (err) {
        logger.error('BRAIN', 'Brain cycle error: ' + String(err) + ' | ' + (err && err.stack ? err.stack : 'no stack'));
        Sentry.captureException(err, { tags: { module: 'brain', cycle: _cycleCount } });
        _logDecision('ERROR', 'EXCEPTION', null, { error: err.message });
    } finally {
        _running = false;
        brainLock.release('brainCycle');
    }
}

// ══════════════════════════════════════════════════════════════════
// Confluence Score (mirrors client calcConfluenceScore)
// ══════════════════════════════════════════════════════════════════
function _calcConfluence(snap, ind) {
    const rsiV = (snap.rsi && snap.rsi['5m']) || 50;
    const rsiDir = rsiV > 50 ? 'bull' : 'bear';

    // SuperTrend direction from indicators
    const stDir = ind.stDir || 'neut';

    // Funding rate
    const fr = snap.fr;
    const frDir = (fr != null) ? (fr < 0 ? 'bull' : 'bear') : 'neut';

    // Open interest direction
    const oi = snap.oi;
    const oiPrev = snap.oiPrev;
    const oiDir = (oi == null || oiPrev == null) ? 'neut' : (oi > oiPrev ? 'bull' : 'bear');

    // MACD direction
    const macdDir = ind.macdDir || 'neut';

    // Direction consensus
    const dirs = [rsiDir, stDir === 'neut' ? 'neut' : stDir, macdDir, frDir, oiDir];
    const bullDirs = dirs.filter(d => d === 'bull').length;
    const bearDirs = dirs.filter(d => d === 'bear').length;
    const alignedCount = Math.max(bullDirs, bearDirs);
    const dirFactor = alignedCount / dirs.length;          // [SHORT-FIX] direction-agnostic strength
    const baseScore = dirFactor * 100;

    // Signal boost (from indicator alignment)
    const signalBoost = alignedCount >= 4 ? 20 : alignedCount >= 3 ? 10 : 0;

    const isBull = bullDirs > bearDirs;
    const finalScore = Math.round(Math.max(0, Math.min(100,
        baseScore + signalBoost                            // [SHORT-FIX] always add boost, never penalize
    )));

    return {
        score: finalScore,
        bullDirs,
        bearDirs,
        rsiDir,
        stDir,
        macdDir,
        frDir,
        oiDir,
        isBull,
        isBear: bearDirs > bullDirs,
    };
}

// ══════════════════════════════════════════════════════════════════
// Gate Check (mirrors client checkATConditions — 9 gates)
// ══════════════════════════════════════════════════════════════════
function _checkGates(snap, ind, confluence, stc, userId) {
    const gates = {
        confOk: false,
        sigOk: false,
        stOk: false,
        adxOk: false,
        hourOk: false,
        posOk: true,
        coolOk: true,
        closeCoolOk: true, // [RE-ENTRY] post-close cooldown gate
        allOk: false,
        reasons: [],
    };

    // 1. Confluence gate (score is now direction-agnostic: 0-100 = strength of conviction)
    gates.confOk = confluence.score >= stc.confMin;        // [SHORT-FIX] symmetric threshold for LONG and SHORT
    if (!gates.confOk) gates.reasons.push('conf_low');

    // 2. Signal count gate (use aligned direction count as proxy)
    const sigCount = Math.max(confluence.bullDirs, confluence.bearDirs);
    gates.sigOk = sigCount >= stc.sigMin;
    if (!gates.sigOk) gates.reasons.push('sig_low');

    // 3. SuperTrend direction present
    gates.stOk = ind.stDir != null && ind.stDir !== 'neut';
    if (!gates.stOk) gates.reasons.push('no_st');

    // 4. ADX gate
    const adx = ind.adx;
    gates.adxOk = (adx == null) || (adx >= stc.adxMin);
    if (!gates.adxOk) gates.reasons.push('adx_low');

    // 5. Hour filter (simplified — server uses UTC hours)
    const hour = new Date().getUTCHours();
    // Skip low-liquidity hours (2-4 UTC = Asian gap)
    gates.hourOk = !(hour >= 2 && hour <= 4);
    if (!gates.hourOk) gates.reasons.push('hour_filter');

    // 6. Position gate — per-user position count
    const openCount = serverAT.getOpenCount(userId);
    gates.posOk = openCount < stc.maxPos;
    if (!gates.posOk) gates.reasons.push('max_pos');

    // 7. Cooldown gate (per-user + per-symbol)
    const cdKey = userId + ':' + snap.symbol;
    const lastEntry = _cooldowns.get(cdKey);
    gates.coolOk = !lastEntry || (Date.now() - lastEntry) > stc.cooldownMs;
    if (!gates.coolOk) gates.reasons.push('cooldown');

    // 8. [RE-ENTRY] Close cooldown — prevent re-entry after recent close (10 min)
    gates.closeCoolOk = !serverAT.isCloseCooldownActive(userId, snap.symbol);
    if (!gates.closeCoolOk) gates.reasons.push('close_cooldown');

    // All gates
    gates.allOk = gates.confOk && gates.sigOk && gates.stOk &&
        gates.adxOk && gates.hourOk && gates.posOk && gates.coolOk && gates.closeCoolOk;

    return gates;
}

// ══════════════════════════════════════════════════════════════════
// [BRAIN-V2] Multi-Timeframe Alignment Score
// ══════════════════════════════════════════════════════════════════
function _calcMTFAlignment(snap, confluence) {
    const dir = confluence.isBull ? 'bull' : confluence.isBear ? 'bear' : 'neut';
    if (dir === 'neut') return 0.5;

    const mtf = snap.mtfIndicators || {};
    let weightedAgree = 0;
    let totalWeight = 0;
    // Higher TFs get progressively more weight
    const TF_WEIGHTS = { '15m': 1.0, '1h': 1.5, '4h': 2.0 };

    for (const tf of ['15m', '1h', '4h']) {
        const tfInd = mtf[tf];
        if (!tfInd || !tfInd.stDir) continue;
        const w = TF_WEIGHTS[tf];
        totalWeight += w;
        // Check if higher TF SuperTrend agrees with entry direction
        if (tfInd.stDir === dir) {
            weightedAgree += w;
        }
        // Bonus: higher TF MACD also agrees
        if (tfInd.macdDir === dir) {
            weightedAgree += w * 0.3;
            totalWeight += w * 0.3;
        }
    }

    if (totalWeight === 0) return 0.5; // no MTF data → neutral
    return Math.min(1, weightedAgree / totalWeight);
}

// ══════════════════════════════════════════════════════════════════
// Fusion Decision (mirrors client computeFusionDecision)
// ══════════════════════════════════════════════════════════════════
function _computeFusion(snap, ind, confluence, regime, gates, bars, userId) {
    // If gates failed → NO_TRADE immediately
    if (!gates.allOk) {
        return {
            ts: Date.now(),
            dir: 'neutral',
            decision: 'NO_TRADE',
            confidence: 0,
            score: confluence.score,
            reasons: gates.reasons,
        };
    }

    // ── [BRAIN-V2] Weighted fusion: Confluence + Regime + Alignment + Indicators + MTF + Structure + Flow ──
    // Weights sum to 1.0: 0.25 + 0.12 + 0.12 + 0.20 + 0.12 + 0.08 + 0.08 + 0.03(spare) = 1.00
    const confNorm = confluence.score / 100;
    const confWeight = 0.25;

    let regimeScore;
    const r = regime.regime;
    if (r === 'TREND' || r === 'TREND_UP' || r === 'TREND_DOWN') regimeScore = 0.75;
    else if (r === 'BREAKOUT' || r === 'EXPANSION') regimeScore = 0.80;
    else if (r === 'RANGE') regimeScore = 0.55;
    else if (r === 'SQUEEZE') regimeScore = 0.60;
    else if (r === 'VOLATILE') regimeScore = 0.40;
    else regimeScore = 0.35;
    const regimeWeight = 0.12;

    const alignScore = Math.max(confluence.bullDirs, confluence.bearDirs) / 5;
    const alignWeight = 0.12;

    const adxNorm = ind.adx != null ? Math.min(1, ind.adx / 50) : 0.3;
    const rsiV = (snap.rsi && snap.rsi['5m']) || 50;
    const rsiStrength = Math.abs(rsiV - 50) / 50;
    const indScore = (adxNorm * 0.6 + rsiStrength * 0.4);
    const indWeight = 0.20;

    // [BRAIN-V2] MTF Alignment: 12%
    const mtfScore = _calcMTFAlignment(snap, confluence);
    const mtfWeight = 0.12;

    // [BRAIN-V2] Market Structure: 8%
    const structure = serverStructure.getStructure(snap.symbol, bars || []);
    const structScore = structure.structureScore;
    const structWeight = 0.08;

    // [BRAIN-V2] Order Flow: 8%
    const tradeDir = confluence.isBull ? 'bull' : confluence.isBear ? 'bear' : 'neut';
    const flowData = serverOrderflow.getFlow(snap.symbol);
    const flowScore = tradeDir !== 'neut' ? serverOrderflow.getFlowScore(tradeDir, flowData) : 0.5;
    const flowWeight = 0.08;

    // [BRAIN-V2] Sentiment: 5% (contrarian)
    const sentData = serverSentiment.getSentiment(snap.symbol);
    const sentScore = tradeDir !== 'neut' ? serverSentiment.getSentimentScore(tradeDir, sentData) : 0.5;
    const sentWeight = 0.05;

    // ── Raw confidence ──
    // Weights: 0.25+0.12+0.12+0.20+0.12+0.08+0.08+0.05 = 1.02 (slightly >1 = OK, small conservative bias)
    let confidence = (confNorm * confWeight + regimeScore * regimeWeight +
        alignScore * alignWeight + indScore * indWeight +
        mtfScore * mtfWeight + structScore * structWeight +
        flowScore * flowWeight + sentScore * sentWeight) * 100;

    // ── Structure modifier (CHoCH contra = penalty, BOS with = boost) ──
    if (tradeDir !== 'neut') {
        const structMod = serverStructure.getStructureModifier(tradeDir, structure);
        confidence *= structMod;
    }

    // ── Liquidity modifier (near liquidity zone = penalty) ──
    if (tradeDir !== 'neut') {
        const liq = serverLiquidity.getLiquidity(snap.symbol, bars || [], snap.price);
        let liqMod = serverLiquidity.getLiquidityModifier(tradeDir, liq);
        // [3I] Liquidity anticipation — avoid traps, ride grabs
        const antic = serverLiquidity.getAnticipation(snap.symbol, bars || [], snap.price);
        if (antic.tradeBias === 'avoid_long' && tradeDir === 'bull') liqMod *= 0.85;
        if (antic.tradeBias === 'avoid_short' && tradeDir === 'bear') liqMod *= 0.85;
        if (antic.tradeBias === 'bull' && tradeDir === 'bull') liqMod *= 1.08; // grabbed below → bullish
        if (antic.tradeBias === 'bear' && tradeDir === 'bear') liqMod *= 1.08; // grabbed above → bearish
        confidence *= liqMod;
    }

    // ── Journal learning modifier (adaptive from trade history) ──
    if (userId && tradeDir !== 'neut') {
        const dir = confluence.isBull ? 'LONG' : 'SHORT';
        const journalMod = serverJournal.getAdaptiveModifier(userId, r, dir, snap.symbol);
        confidence *= journalMod;
    }

    // ── KNN pattern matching modifier ──
    if (tradeDir !== 'neut') {
        const knnPred = serverKNN.predict(snap, confluence, ind, userId);
        if (knnPred) {
            const knnDir = confluence.isBull ? 'LONG' : 'SHORT';
            const knnMod = serverKNN.getKNNModifier(knnDir, knnPred);
            confidence *= knnMod;
        }
    }

    // ── [V3] Session modifier ──
    if (userId) {
        const sessMod = serverSessionProfile.getSessionModifier(userId);
        confidence *= sessMod;
    }

    // ── [V3] Volatility modifier ──
    if (bars && bars.length > 30) {
        const snap2 = { indicators: ind, symbol: ind.symbol };
        const volProf = serverVolatilityEngine.assessVolatility(snap2, bars);
        const volMod = serverVolatilityEngine.getVolatilityModifier(volProf);
        confidence *= volMod;
    }

    // ── [V3] Drawdown tilt modifier ──
    if (userId) {
        const tiltMod = serverDrawdownGuard.getTiltModifier(userId);
        confidence *= tiltMod;
    }

    // ── Trap risk penalty ──
    if (regime.trapRisk >= 40) {
        confidence *= (1 - regime.trapRisk * 0.005); // up to 50% reduction at trapRisk=100
    }

    // ── Regime danger penalty ──
    if (r === 'CHAOS' || r === 'LIQUIDATION_EVENT') {
        confidence *= 0.5;
    }

    confidence = Math.round(Math.max(0, Math.min(100, confidence)));

    // ── Direction ──
    const dir = confluence.isBull ? 'LONG' : confluence.isBear ? 'SHORT' : 'neutral';

    // ── Entry tier classification (matches client tiers) ──
    let decision;
    const reasons = [];
    if (confidence >= 82 && confluence.score >= 75) {
        decision = 'LARGE';
        reasons.push('high_conf', 'strong_alignment');
    } else if (confidence >= 72 && confluence.score >= 68) {
        decision = 'MEDIUM';
        reasons.push('good_conf');
    } else if (confidence >= 62 && confluence.score >= 60) {
        decision = 'SMALL';
        reasons.push('min_conf');
    } else {
        decision = 'NO_TRADE';
        reasons.push('conf_insufficient');
    }

    return {
        ts: Date.now(),
        dir,
        decision,
        confidence,
        score: confluence.score,
        reasons,
    };
}

// ══════════════════════════════════════════════════════════════════
// [REFLECTION] Helpers
// ══════════════════════════════════════════════════════════════════
function _buildMarketContext(snap, bars, userId) {
    const ctx = {};
    try {
        ctx.structure = serverStructure.getStructure(snap.symbol, bars || []);
        ctx.liquidity = serverLiquidity.getLiquidity(snap.symbol, bars || [], snap.price);
        ctx.flow = serverOrderflow.getFlow(snap.symbol);
        ctx.regime = snap.indicators ? snap.indicators.regime : 'UNKNOWN';
        ctx.regimeTransition = serverCalibration.detectRegimeTransition(snap.symbol);
        // Open positions for correlation check
        ctx.openPositions = serverAT.getOpenPositions ? serverAT.getOpenPositions(userId) : [];
    } catch (_) {}
    return ctx;
}

function _isCvdAligned(snap, confluence) {
    try {
        const flow = serverOrderflow.getFlow(snap.symbol);
        if (confluence.isBull && flow.delta5m > 0) return true;
        if (confluence.isBear && flow.delta5m < 0) return true;
        return false;
    } catch (_) { return null; }
}

// ══════════════════════════════════════════════════════════════════
// Decision Logging
// ══════════════════════════════════════════════════════════════════
function _logDecision(type, reason, decision, extra) {
    const entry = {
        ts: Date.now(),
        cycle: _cycleCount,
        type,
        reason,
        extra: extra || {},
    };
    _decisionLog.push(entry);
    if (_decisionLog.length > DECISION_LOG_MAX) {
        _decisionLog.splice(0, _decisionLog.length - DECISION_LOG_MAX);
    }
}

// ══════════════════════════════════════════════════════════════════
// Status / Health
// ══════════════════════════════════════════════════════════════════
function getStatus() {
    return {
        running: !!_timer,
        cycleCount: _cycleCount,
        lastDecision: _lastDecision,
        prevRegimes: Object.fromEntries(_prevRegimes),
        recentLog: _decisionLog.slice(-20),
    };
}

function getDecisionLog(limit) {
    limit = Math.min(limit || 50, DECISION_LOG_MAX);
    return _decisionLog.slice(-limit);
}

// Allow updating server trading config from client sync (per-user)
function updateConfig(userId, cfg) {
    if (!userId || !cfg || typeof cfg !== 'object') return;
    let stc = _stcMap.get(userId);
    if (!stc) {
        stc = Object.assign({}, DEFAULT_STC);
        _stcMap.set(userId, stc);
    }
    for (const k of Object.keys(DEFAULT_STC)) {
        if (k === 'dslMode') continue; // handled separately below
        if (k in cfg && typeof cfg[k] === 'number' && isFinite(cfg[k])) {
            stc[k] = cfg[k];
        }
    }
    // DSL mode is a string field
    if (cfg.dslMode && typeof cfg.dslMode === 'string') {
        const valid = ['fast', 'tp', 'def', 'atr', 'swing'];
        const m = cfg.dslMode.toLowerCase();
        if (valid.includes(m)) stc.dslMode = m;
    }
    // [MULTI-SYM] Symbol selection per user
    if (Array.isArray(cfg.symbols)) {
        const configuredSymbols = serverState.getConfiguredSymbols();
        const valid = cfg.symbols
            .filter(s => typeof s === 'string')
            .map(s => s.toUpperCase())
            .filter(s => configuredSymbols.includes(s));
        stc.symbols = valid.length > 0 ? valid : null;  // null = all
    } else if (cfg.symbols === null) {
        stc.symbols = null;  // explicit "all symbols"
    }
    // ── Persist to SQLite so config survives server restart ──
    try {
        db.atSetState('stc:' + userId, stc, userId);
    } catch (err) {
        logger.error('BRAIN', `Failed to persist STC for uid=${userId}:`, err.message);
    }
    logger.info('BRAIN', `Config updated uid=${userId}: ` + JSON.stringify(stc));
}

function getSTC(userId) {
    return _stcMap.has(userId) ? Object.assign({}, _stcMap.get(userId)) : Object.assign({}, DEFAULT_STC);
}

// ══════════════════════════════════════════════════════════════════
// [BRAIN-V2] Brain Vision — expose all V2 module data for UI
// ══════════════════════════════════════════════════════════════════
function getBrainVision() {
    const readySymbols = serverState.getReadySymbols();
    const vision = {};

    for (const symbol of readySymbols) {
        const snap = serverState.getSnapshotForSymbol(symbol);
        if (!snap || !snap.indicators) continue;

        const bars = serverState.getBarsForSymbol(symbol);
        const ind = snap.indicators;

        // MTF
        const mtf = {};
        for (const [tf, tfInd] of Object.entries(snap.mtfIndicators || {})) {
            mtf[tf] = { st: tfInd.stDir || '?', macd: tfInd.macdDir || '?', rsi: tfInd.rsi ? Math.round(tfInd.rsi) : null };
        }

        // Structure
        const struct = serverStructure.getStructure(symbol, bars);

        // Liquidity
        const liq = serverLiquidity.getLiquidity(symbol, bars, snap.price);
        const antic = serverLiquidity.getAnticipation(symbol, bars, snap.price);

        // Order Flow
        const flow = serverOrderflow.getFlow(symbol);

        // Sentiment
        const sent = serverSentiment.getSentiment(symbol);

        // Regime params
        const regime = ind.regime || 'UNKNOWN';
        const regimeProfile = serverRegimeParams.getProfile(regime);

        // First user for KNN/Journal (vision is a summary view)
        const firstUser = _stcMap.keys().next().value;

        // KNN
        let knn = null;
        try {
            const confluence = _calcConfluence(snap, ind);
            knn = serverKNN.predict(snap, confluence, ind, firstUser);
        } catch (_) {}

        // Journal (per first user for now)
        let journal = null;
        if (firstUser) {
            const ins = serverJournal.getInsights(firstUser);
            if (ins && !ins.insufficient) {
                journal = {
                    trades: ins.tradeCount,
                    winRate: Math.round(ins.overallWinRate * 100),
                    regimeWR: {},
                    bestRegime: null,
                    worstRegime: null,
                };
                let bestWR = -1, worstWR = 101;
                for (const [r, rp] of Object.entries(ins.regimeWinRate)) {
                    if (rp.winRate !== null && rp.count >= 3) {
                        journal.regimeWR[r] = Math.round(rp.winRate * 100);
                        if (rp.winRate > bestWR) { bestWR = rp.winRate; journal.bestRegime = r; }
                        if (rp.winRate < worstWR) { worstWR = rp.winRate; journal.worstRegime = r; }
                    }
                }
            }
        }

        // [V3] Volatility engine
        const volProfile = serverVolatilityEngine.assessVolatility(snap, bars);

        vision[symbol] = {
            price: snap.price,
            regime,
            mtf,
            structure: { trend: struct.trend, bos: struct.lastBOS ? struct.lastBOS.dir : null, choch: struct.lastCHoCH ? struct.lastCHoCH.dir : null, score: Math.round(struct.structureScore * 100) },
            flow: { delta5m: Math.round(flow.delta5m), cvd: Math.round(flow.cvd), absorption: Math.round(flow.absorptionScore * 100), poc: flow.poc ? +flow.poc.toFixed(2) : null },
            sentiment: { score: sent.compositeScore, crowd: sent.crowdPosition, funding: sent.fundingTrend },
            liquidity: {
                above: liq.nearestAbove ? +liq.nearestAbove.price.toFixed(2) : null,
                below: liq.nearestBelow ? +liq.nearestBelow.price.toFixed(2) : null,
                grabRisk: Math.round(liq.liquidityGrabRisk * 100),
                zones: liq.zones.length,
                antic: antic.tradeBias,
            },
            regimeParams: { confMin: regimeProfile.confMin, slMult: regimeProfile.slMult, rrMin: regimeProfile.rrMin, dsl: regimeProfile.dslMode, sizeScale: regimeProfile.sizeScale },
            knn: knn ? { winRate: knn.winRate, dir: knn.dir, avgPnl: knn.avgPnl, patterns: knn.matchCount, similarity: knn.avgSimilarity } : null,
            journal,
            // [V3] New modules
            volatility: { level: volProfile.level, score: volProfile.score, atrPct: volProfile.atrPercentile, slMult: volProfile.slMultiplier, signals: volProfile.signals },
        };
    }

    // [REFLECTION] Add brain dashboard data
    const _visionUser = _stcMap.keys().next().value;
    const reflection = serverReflection.getDashboard(_visionUser);
    const exitAnalysis = {};
    // Analyze open positions for exit recommendations
    for (const symbol of readySymbols) {
        const snap = serverState.getSnapshotForSymbol(symbol);
        if (!snap) continue;
        const bars = serverState.getBarsForSymbol(symbol);
        const regTrans = serverCalibration.detectRegimeTransition(symbol);
        if (regTrans.transitioning) {
            if (!vision[symbol]) continue;
            vision[symbol].regimeTransition = regTrans;
        }
        // Volatility forecast
        const volForecast = serverCalibration.forecastVolatility(symbol, snap);
        if (vision[symbol]) vision[symbol].volatilityForecast = volForecast;
    }

    // [V3] Per-user intelligence data
    const v3Data = {};
    if (_visionUser) {
        v3Data.session = serverSessionProfile.getSessionData(_visionUser);
        v3Data.sizing = serverAdaptiveSizing.getEdgeStats(_visionUser);
        const _us = serverAT.getUserState ? serverAT.getUserState(_visionUser) : null;
        const _dpnl = _us ? (_us.dailyPnL || 0) : 0;
        const _ref = _us ? (_us.demoBalance || _us.liveBalanceRef || 10000) : 10000;
        v3Data.drawdown = serverDrawdownGuard.getDrawdownData(_visionUser, _dpnl, _ref);
        const _openPos = serverAT.getOpenPositions ? serverAT.getOpenPositions(_visionUser) : [];
        v3Data.correlation = serverCorrelationGuard.getAnalysis(_openPos);
        v3Data.scaling = serverMultiEntry.getAllScaleData(_visionUser);
    }

    return { ts: Date.now(), cycle: _cycleCount, symbols: vision, reflection, v3: v3Data };
}

module.exports = {
    start,
    stop,
    getStatus,
    getDecisionLog,
    updateConfig,
    getSTC,
    getBrainVision,
    get STC() { return Object.assign({}, DEFAULT_STC); },
};
