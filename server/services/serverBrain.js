// Zeus Terminal — Server Brain Cycle (Phase 3)
// Runs the brain decision pipeline server-side: confluence, regime, AT gate check, fusion.
// Observation-only — logs decisions but does NOT execute trades.
// Gated by MF.SERVER_BRAIN flag.
'use strict';

const logger = require('./logger');
const brainLock = require('../brainLock');
const serverState = require('./serverState');
const serverAT = require('./serverAT');
const telegram = require('./telegram');

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
};
const _stcMap = new Map(); // userId → STC config

function _getSTC(userId) {
    return _stcMap.has(userId) ? _stcMap.get(userId) : null;
}

// ── Brain state ──
let _timer = null;
let _running = false;
let _cycleCount = 0;
let _lastDecision = null;
let _prevRegime = null;
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
    logger.info('BRAIN', 'Server brain starting (observation mode, 30s cycle)');
    _timer = setInterval(_runCycle, CYCLE_INTERVAL_MS);
    // Run first cycle after short delay to let data settle
    setTimeout(_runCycle, 5000);
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
        // ── 1. Data readiness check ──
        if (!serverState.isDataReady()) {
            _logDecision('SKIP', 'DATA_NOT_READY', null, { reason: 'Insufficient data for brain' });
            return;
        }

        const snap = serverState.getSnapshot();
        const ind = snap.indicators;
        if (!ind) {
            _logDecision('SKIP', 'NO_INDICATORS', null, { reason: 'Indicators not computed yet' });
            return;
        }

        // ── 2. Data staleness check ──
        if (snap.stale || (Date.now() - snap.priceTs) > STALE_DATA_MS) {
            _logDecision('SKIP', 'DATA_STALE', null, {
                reason: 'Price data stale',
                lastPrice: snap.price,
                priceAge: Date.now() - snap.priceTs,
            });
            return;
        }

        // ── 3. Confluence score (from teacher indicators) ──
        // teacherComputeIndicators already computes confluence, but we also
        // compute our own version that matches the client's calcConfluenceScore
        // using the same inputs: RSI, SuperTrend, FR, OI
        const confluence = _calcConfluence(snap, ind);

        // ── 4. Regime (from teacher indicators) ──
        const regime = {
            regime: ind.regime || 'RANGE',
            confidence: ind.regimeConf || 0,
            trendBias: ind.trendBias || 'neutral',
            volatilityState: ind.volatilityState || 'normal',
            trapRisk: ind.trapRisk || 0,
        };

        // Log regime changes
        if (_prevRegime !== null && _prevRegime !== regime.regime) {
            logger.info('BRAIN', `Regime change: ${_prevRegime} → ${regime.regime} (conf=${regime.confidence}%)`);
            // [AUDIT] Per-user throttle — max 1 regime TG per 15min per user
            const _regimeMsg = '🌐 *Regime Change*\n' +
                '`' + _prevRegime + '` → *' + regime.regime + '*\n' +
                'Confidence: `' + regime.confidence + '%`\n' +
                'Bias: `' + regime.trendBias + '` | Vol: `' + regime.volatilityState + '`\n' +
                'BTC: `$' + (snap.price ? snap.price.toFixed(0) : '?') + '`';
            const _now = Date.now();
            // sendToAll iterates all users — instead, use per-user throttle
            const _allUserIds = require('./telegram').getAllUserIds ? require('./telegram').getAllUserIds() : [];
            for (const _uid of _allUserIds) {
                const _lastTs = _regimeTgLastTs.get(_uid) || 0;
                if (_now - _lastTs >= REGIME_TG_COOLDOWN_MS) {
                    _regimeTgLastTs.set(_uid, _now);
                    require('./telegram').sendToUser(_uid, _regimeMsg);
                } else {
                    logger.info('BRAIN', `Regime TG throttled for uid=${_uid} (${Math.round((_now - _lastTs) / 1000)}s since last)`);
                }
            }
        }
        _prevRegime = regime.regime;

        // ── 5-7. Per-user gate check + fusion + AT execution ──
        const users = _stcMap.size > 0 ? _stcMap : new Map([[1, Object.assign({}, DEFAULT_STC)]]);
        let loggedDecision = null;

        for (const [userId, stc] of users) {
            const gates = _checkGates(snap, ind, confluence, stc, userId);
            const fusion = _computeFusion(snap, ind, confluence, regime, gates);
            const decision = {
                ts: Date.now(),
                cycle: _cycleCount,
                symbol: snap.symbol,
                price: snap.price,
                priceTs: snap.priceTs, // [F2] Price age for freshness gate
                confluence: confluence,
                regime: regime,
                gates: gates,
                fusion: fusion,
            };
            if (!loggedDecision) loggedDecision = decision;

            if (fusion.decision !== 'NO_TRADE') {
                const entry = serverAT.processBrainDecision(decision, stc, userId);
                if (entry) {
                    _cooldowns.set(userId + ':' + decision.symbol, Date.now());
                    logger.info(`[BRAIN] Cooldown set for user ${userId} ${decision.symbol} (${stc.cooldownMs}ms)`);
                }
            }
        }

        // Expire stale positions (all users)
        serverAT.expireStale();

        _lastDecision = loggedDecision;
        if (loggedDecision) {
            _logDecision(
                loggedDecision.fusion.decision,
                loggedDecision.fusion.decision === 'NO_TRADE' ? 'gates_or_fusion' : loggedDecision.fusion.dir,
                loggedDecision,
                { score: confluence.score, regime: regime.regime, confidence: loggedDecision.fusion.confidence }
            );
        }

        // ── 8. Log summary every 10 cycles or on trade signal ──
        const logFusion = loggedDecision ? loggedDecision.fusion : { decision: 'N/A', dir: 'neutral', confidence: 0 };
        if (_cycleCount % 10 === 0 || logFusion.decision !== 'NO_TRADE') {
            logger.info('BRAIN',
                `[C${_cycleCount}] ${snap.symbol} $${snap.price} | ` +
                `Conf=${confluence.score} | Regime=${regime.regime}(${regime.confidence}%) | ` +
                `ADX=${ind.adx != null ? ind.adx.toFixed(1) : '—'} RSI=${snap.rsi['5m'] != null ? snap.rsi['5m'].toFixed(1) : '—'} | ` +
                `Fusion=${logFusion.decision} ${logFusion.dir} ${logFusion.confidence}%`
            );
        }

    } catch (err) {
        logger.error('BRAIN', 'Brain cycle error:', err.message);
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
    const dirFactor = bullDirs / dirs.length;
    const baseScore = dirFactor * 100;

    // Signal boost (from indicator alignment)
    const alignedCount = Math.max(bullDirs, bearDirs);
    const signalBoost = alignedCount >= 4 ? 20 : alignedCount >= 3 ? 10 : 0;

    const isBull = bullDirs > bearDirs;
    const finalScore = Math.round(Math.max(0, Math.min(100,
        isBull ? baseScore + signalBoost : baseScore - signalBoost
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
        allOk: false,
        reasons: [],
    };

    // 1. Confluence gate
    if (confluence.isBull) {
        gates.confOk = confluence.score >= stc.confMin;
    } else if (confluence.isBear) {
        gates.confOk = confluence.score <= (100 - stc.confMin);
    }
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

    // All gates
    gates.allOk = gates.confOk && gates.sigOk && gates.stOk &&
        gates.adxOk && gates.hourOk && gates.posOk && gates.coolOk;

    return gates;
}

// ══════════════════════════════════════════════════════════════════
// Fusion Decision (mirrors client computeFusionDecision)
// ══════════════════════════════════════════════════════════════════
function _computeFusion(snap, ind, confluence, regime, gates) {
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

    // ── Weighted fusion (matches client weights) ──
    // Confluence: 35%
    const confNorm = confluence.score / 100;
    const confWeight = 0.35;

    // Regime: 20%
    let regimeScore;
    const r = regime.regime;
    if (r === 'TREND_UP' || r === 'TREND_DOWN') regimeScore = 0.75;
    else if (r === 'RANGE') regimeScore = 0.55;
    else if (r === 'SQUEEZE') regimeScore = 0.60;
    else if (r === 'EXPANSION') regimeScore = 0.80;
    else regimeScore = 0.35;  // CHAOS, LIQUIDATION_EVENT, etc.
    const regimeWeight = 0.20;

    // Alignment: 20% (directional consensus)
    const alignScore = Math.max(confluence.bullDirs, confluence.bearDirs) / 5;
    const alignWeight = 0.20;

    // Indicator strength: 25% (ADX + RSI extremity)
    const adxNorm = ind.adx != null ? Math.min(1, ind.adx / 50) : 0.3;
    const rsiV = (snap.rsi && snap.rsi['5m']) || 50;
    const rsiStrength = Math.abs(rsiV - 50) / 50; // 0 at neutral, 1 at extreme
    const indScore = (adxNorm * 0.6 + rsiStrength * 0.4);
    const indWeight = 0.25;

    // ── Raw confidence ──
    let confidence = (confNorm * confWeight + regimeScore * regimeWeight +
        alignScore * alignWeight + indScore * indWeight) * 100;

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
        prevRegime: _prevRegime,
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
    logger.info('BRAIN', `Config updated uid=${userId}: ` + JSON.stringify(stc));
}

function getSTC(userId) {
    return _stcMap.has(userId) ? Object.assign({}, _stcMap.get(userId)) : Object.assign({}, DEFAULT_STC);
}

module.exports = {
    start,
    stop,
    getStatus,
    getDecisionLog,
    updateConfig,
    getSTC,
    get STC() { return Object.assign({}, DEFAULT_STC); },
};
