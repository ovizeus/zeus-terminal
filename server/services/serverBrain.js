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
const brainLogger = require('./brainLogger');
const MF = require('../migrationFlags');

// [ML Phase B Day 7] Ring5 influence-mode telemetry — wraps fusion decision so
// audit / eligibility / posteriors get populated from real brain flow. Day 7
// is observation-only: wrap output is logged + audited but NOT used downstream.
const ring5LearningService = require('./ml/ring5LearningService');

// [ML Phase B Day 10] Build mlBrainProInputs feed from fusion score components.
// Each component is normalized [0..1] (per _computeFusion). Map to [-1..+1]
// signed contribution where neutral 0.5 -> 0, strong agree 1.0 -> +1.0, strong
// disagree 0.0 -> -1.0. Proposer in wrap() can then fire when ML signal AND
// bandit both lean strongly in same direction.
function _buildRing5MlInputs(fusion) {
    if (!fusion || !fusion._intermediates) return null;
    const i = fusion._intermediates;
    const components = [
        ['fus_regime', i.fusRegimeScore],
        ['fus_alignment', i.fusAlignScore],
        ['fus_indicator', i.fusIndScore],
        ['fus_mtf', i.fusMtfScore],
        ['fus_structure', i.fusStructScore],
        ['fus_flow', i.fusFlowScore],
        ['fus_sentiment', i.fusSentScore]
    ];
    const contributions = [];
    for (const [moduleId, val] of components) {
        if (typeof val !== 'number' || !isFinite(val)) continue;
        const signed = Math.max(-1, Math.min(1, (val - 0.5) * 2));
        contributions.push({ moduleId, contribution: signed });
    }
    return contributions.length > 0 ? { contributions } : null;
}

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
// [SRV-2] Track last activity timestamp per user for unbounded-growth defense.
// Updated on every _stcMap.set() and _stcMap.get() access via the helper
// pair below. Hourly cleanup (line ~85) drops stale entries older than
// _STC_INACTIVITY_MS to prevent unbounded growth across user churn (test
// accounts, deleted users, multi-env reuse).
const _stcLastSeen = new Map();          // userId → ms timestamp
const _STC_INACTIVITY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
function _touchStc(userId) {
    if (userId == null) return;
    _stcLastSeen.set(userId, Date.now());
}

// _getSTC removed — unused (brain uses _stcMap directly)

// ── Brain state ──
let _timer = null;
let _shadowTimer = null;  // [Phase 2 S3] separate timer for parity harness shadow cycle
let _running = false;
let _shadowRunning = false;  // [Phase 2 S3] re-entry guard for shadow cycle
let _cycleCount = 0;
let _lastDecision = null;
const _prevRegimes = new Map();  // [MULTI-SYM] symbol → last regime
// [S5] _cooldowns value semantics changed from lastEntryTs → deadlineMs.
// Gate is `now < deadlineMs`; cleanup drops entries with deadline <= now.
// Persisted per-user in at_state under key 'brain:cooldowns:{uid}'.
const _cooldowns = new Map();   // 'userId:symbol' → deadlineMs
// [AUDIT] Per-user regime change Telegram throttle (max 1 per 15min per user)
const _regimeTgLastTs = new Map();  // userId → timestamp
const REGIME_TG_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

// [RT-03 + S5] Hourly cleanup. Cooldowns are deadline-based now: drop only if
// deadline already past. TG throttle is timestamp-based: drop entries older
// than the throttle window so we never leak memory.
setInterval(() => {
    const now = Date.now();
    for (const [k, deadline] of _cooldowns) { if (deadline <= now) _cooldowns.delete(k); }
    for (const [k, ts] of _regimeTgLastTs) { if (now - ts > REGIME_TG_COOLDOWN_MS) _regimeTgLastTs.delete(k); }
    // [SRV-2] Cleanup stale _stcMap entries — drop users inactive >30 days.
    for (const [uid, lastTs] of _stcLastSeen) {
        if ((now - lastTs) > _STC_INACTIVITY_MS) {
            _stcMap.delete(uid);
            _stcLastSeen.delete(uid);
        }
    }
}, 3600000);

// ══════════════════════════════════════════════════════════════════
// [Phase 2 S6-B1] DEMO server-authority dispatch helpers — INERT.
// Both helpers are pure flag readers; current production state has
// SERVER_BRAIN=false, SERVER_BRAIN_DEMO=false, SERVER_AT=false,
// SERVER_AT_DEMO=false, so _shouldRunMainCycle() returns false today
// (start() falls through to the existing PARITY_SHADOW_ENABLED branch)
// and _isServerAuthoritativeForUser() returns false for every user
// (per-user dispatch loop continues past every user). When S6-B6
// flips SERVER_BRAIN_DEMO + SERVER_AT_DEMO to true, these helpers
// become live: main cycle starts and demo-mode users get dispatched
// to serverAT.processBrainDecision; live-mode users still skip
// because their gate condition requires the FULL SERVER_AT flag.
// ══════════════════════════════════════════════════════════════════

function _shouldRunMainCycle() {
    return MF.SERVER_BRAIN === true || MF.SERVER_BRAIN_DEMO === true;
}

// [BUG-T1 2026-05-13 FIX path B] Per-user gate now reads engineMode din `us`
// (serverAT.getMode) — single source of truth pentru mode. Pre-T1: gate read
// `stc.engineMode` care era ghost field (absent din DEFAULT_STC schema +
// at_state.stc:N JSON) → gate returned false pentru toți useri → server-side
// AT demo dispatch + brainLogger.logDecision unreachable (9 call sites inert).
// Now: gate accepts userId, reads engineMode via serverAT.getMode(userId).
// Backward-compat NU breakable — DEFAULT_STC nu mai are engineMode (per design;
// mode trăiește în engine state, NOT în trading config).
function _isServerAuthoritativeForUser(userId) {
    if (MF.SERVER_AT === true) return true;
    if (MF.SERVER_AT_DEMO === true) {
        const userMode = serverAT.getMode(userId);
        if (userMode === 'demo') return true;
    }
    return false;
}

// ── Decision log (ring buffer) ──
const DECISION_LOG_MAX = 200;
const _decisionLog = [];

// [L1-DIAG] Per-user recent blocks ring buffer for client diagnostic surfacing
const BLOCKS_MAX_PER_USER = 60;
const _recentBlocks = new Map(); // userId -> [{ ts, symbol, reasons, score, adx, stage }]
function _pushBlock(userId, symbol, reasons, stage, extra) {
    if (!userId || !reasons || !reasons.length) return;
    let buf = _recentBlocks.get(userId);
    if (!buf) { buf = []; _recentBlocks.set(userId, buf); }
    buf.push({
        ts: Date.now(),
        symbol: symbol || '?',
        reasons: Array.isArray(reasons) ? reasons.slice() : [String(reasons)],
        stage: stage || 'gates',
        score: extra && extra.score != null ? extra.score : null,
        adx: extra && extra.adx != null ? extra.adx : null,
        confidence: extra && extra.confidence != null ? extra.confidence : null,
    });
    if (buf.length > BLOCKS_MAX_PER_USER) buf.splice(0, buf.length - BLOCKS_MAX_PER_USER);
}
function getRecentBlocks(userId, sinceTs) {
    const buf = _recentBlocks.get(userId);
    if (!buf) return [];
    const since = Number(sinceTs) || 0;
    return since > 0 ? buf.filter(e => e.ts > since) : buf.slice();
}

// ══════════════════════════════════════════════════════════════════
// Start / Stop
// ══════════════════════════════════════════════════════════════════
function start() {
    if (_timer || _shadowTimer) return;
    // ── Restore persisted state from SQLite ──
    _restoreStcFromDb();
    _restoreCooldowns();
    // [S5] Restore regime baseline + per-user TG throttle so a restart does
    // not silently swallow the next regime change and does not bypass the
    // 15-min Telegram dedup.
    _restoreRegimeBaseline();
    _restoreRegimeTgThrottle();
    // [BRAIN-V2] Start liquidity depth polling + order flow tracking —
    // required inputs for both the main cycle and the parity shadow cycle.
    serverLiquidity.startDepthPolling(serverState.getConfiguredSymbols());
    serverOrderflow.init();
    serverJournal.start();
    serverSentiment.start(serverState.getConfiguredSymbols());
    serverKNN.start();
    serverReflection.start();
    if (_shouldRunMainCycle()) {
        // [Phase 2 S6-B1] Boot main cycle when EITHER full SERVER_BRAIN is on
        // OR the demo carve-out SERVER_BRAIN_DEMO is on. Per-user dispatch
        // inside _runCycle further filters via _isServerAuthoritativeForUser
        // so a demo-only carve-out cannot route a live user's decision to
        // server execution.
        const _mode = MF.SERVER_BRAIN ? 'full' : 'demo-only';
        logger.info('BRAIN', `Server brain starting (${_mode}, observation mode, 30s cycle)`);
        _timer = setInterval(_runCycle, CYCLE_INTERVAL_MS);
        // Run first cycle after short delay to let data settle
        setTimeout(_runCycle, 5000);
    } else if (MF.PARITY_SHADOW_ENABLED) {
        // [Phase 2 S3] Shadow-only mode: compute fusion per user/symbol and
        // write parity rows; NEVER touch serverAT, Telegram, regime history,
        // reflection, or any other live side-effect path.
        logger.info('BRAIN', '[S3] Server brain starting in shadow-only mode (parity harness, 30s cycle)');
        _shadowTimer = setInterval(_runShadowCycle, CYCLE_INTERVAL_MS);
        setTimeout(_runShadowCycle, 5000);
    }
    // [ML] Daily prune of old decision snapshots
    setInterval(() => { try { brainLogger.prune(); } catch (_) {} }, 86400000);
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
                    _touchStc(userId);              // [SRV-2] mark active
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

// [S5] Persist cooldowns as { 'uid:symbol': deadlineMs } per-user. The shape
// of each persisted row stays { 'uid:symbol': number } — only the SEMANTICS
// of that number changes from lastEntryTs (legacy) to deadlineMs (S5+).
function _persistCooldowns() {
    try {
        const byUser = new Map();
        for (const [k, v] of _cooldowns) {
            const m = /^(\d+):/.exec(k);
            if (!m) continue;
            const uid = parseInt(m[1], 10);
            if (!byUser.has(uid)) byUser.set(uid, {});
            byUser.get(uid)[k] = v;
        }
        for (const [uid, obj] of byUser) {
            db.atSetState('brain:cooldowns:' + uid, obj, uid);
        }
    } catch (e) {
        logger.warn('BRAIN', '_persistCooldowns failed: ' + (e && e.message));
    }
}

// [S5] Restore using absolute-deadline semantics. Backward compatible with
// pre-S5 rows (bare lastEntryTs): treat any value below LEGACY_TS_THRESHOLD
// as a pre-S5 lastEntryTs and apply the old 10-min restore window — i.e.
// effective deadline = oldTs + 600000 ms. Drop any entry whose effective
// deadline is already in the past.
function _restoreCooldowns() {
    try {
        const users = db.listUsers ? db.listUsers() : [];
        const now = Date.now();
        // Pre-S5 cooldowns were stored as Date.now() at the moment of the
        // entry, so values fall in the 1.7e12 range. Post-S5 deadlines also
        // fall in that range (now + cooldownMs). The DISTINGUISHING property
        // is that legacy lastEntryTs cannot be larger than (now + ~5min)
        // grace, while S5 deadlines are typically (now + cooldownMs).
        // Conservative legacy heuristic: if value <= now, it is either an
        // expired deadline OR a legacy lastEntryTs that has already been
        // consumed. Either way we apply legacy +10min compatibility window
        // to bare values <= now-old; new deadlines are always > now.
        let restored = 0, legacyApplied = 0, dropped = 0;
        for (const u of users) {
            const saved = db.atGetState('brain:cooldowns:' + u.id);
            if (!saved || typeof saved !== 'object') continue;
            for (const [k, v] of Object.entries(saved)) {
                if (typeof v !== 'number' || !Number.isFinite(v)) { dropped++; continue; }
                let deadline = v;
                if (v <= now) {
                    // Treat as legacy lastEntryTs: effective deadline = v + 10min.
                    deadline = v + 600000;
                    legacyApplied++;
                }
                if (deadline > now) {
                    _cooldowns.set(k, deadline);
                    restored++;
                } else {
                    dropped++;
                }
            }
        }
        if (restored > 0 || legacyApplied > 0 || dropped > 0) {
            logger.info('BRAIN', `[S5] Restored ${restored} cooldown(s) from DB (${legacyApplied} legacy-converted, ${dropped} dropped/expired)`);
        }
    } catch (e) {
        logger.warn('BRAIN', '_restoreCooldowns failed: ' + (e && e.message));
    }
}

// [S5] Set a deadline-based cooldown and persist immediately. Centralizes
// the (set + persist) pattern so call sites cannot accidentally write a
// timestamp that was never persisted.
function _setCooldownDeadline(userId, symbol, cooldownMs) {
    if (!Number.isFinite(cooldownMs) || cooldownMs <= 0) return;
    const deadline = Date.now() + cooldownMs;
    _cooldowns.set(userId + ':' + symbol, deadline);
    _persistCooldowns();
}

// [S5] Persist the global per-symbol regime baseline. Regime is global market
// state, but at_state requires a non-NULL user_id (FK CASCADE since migration
// 023). Mirror the existing per-user pattern used by db.saveRegimeChange:
// write one row per active brain user (= keys of _stcMap), each carrying the
// SAME map. On restore, the union across all rows is the baseline (entries
// agree by construction).
function _persistRegimeBaseline() {
    try {
        const obj = {};
        for (const [sym, regime] of _prevRegimes) obj[sym] = regime;
        for (const _uid of _stcMap.keys()) {
            try { db.atSetState('brain:prevRegimes:' + _uid, obj, _uid); } catch (_) {}
        }
    } catch (e) {
        logger.warn('BRAIN', '_persistRegimeBaseline failed: ' + (e && e.message));
    }
}

function _restoreRegimeBaseline() {
    try {
        const users = db.listUsers ? db.listUsers() : [];
        let restored = 0;
        for (const u of users) {
            const saved = db.atGetState('brain:prevRegimes:' + u.id);
            if (!saved || typeof saved !== 'object') continue;
            for (const [sym, regime] of Object.entries(saved)) {
                if (typeof regime === 'string' && regime.length > 0 && !_prevRegimes.has(sym)) {
                    _prevRegimes.set(sym, regime);
                    restored++;
                }
            }
        }
        if (restored > 0) logger.info('BRAIN', `[S5] Restored regime baseline for ${restored} symbol(s)`);
    } catch (e) {
        logger.warn('BRAIN', '_restoreRegimeBaseline failed: ' + (e && e.message));
    }
}

// [S5] Persist + restore per-user regime-change Telegram throttle so the
// 15-min dedup survives a PM2 reload.
function _persistRegimeTgThrottle() {
    try {
        for (const [uid, ts] of _regimeTgLastTs) {
            if (Number.isFinite(ts)) db.atSetState('brain:regimeTg:' + uid, { ts }, uid);
        }
    } catch (e) {
        logger.warn('BRAIN', '_persistRegimeTgThrottle failed: ' + (e && e.message));
    }
}

function _restoreRegimeTgThrottle() {
    try {
        const users = db.listUsers ? db.listUsers() : [];
        let restored = 0;
        for (const u of users) {
            const saved = db.atGetState('brain:regimeTg:' + u.id);
            if (saved && typeof saved === 'object' && Number.isFinite(saved.ts)) {
                _regimeTgLastTs.set(u.id, saved.ts);
                restored++;
            }
        }
        if (restored > 0) logger.info('BRAIN', `[S5] Restored regime TG throttle for ${restored} user(s)`);
    } catch (e) {
        logger.warn('BRAIN', '_restoreRegimeTgThrottle failed: ' + (e && e.message));
    }
}

function stop() {
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
    if (_shadowTimer) {
        clearInterval(_shadowTimer);
        _shadowTimer = null;
    }
    _running = false;
    _shadowRunning = false;
    logger.info('BRAIN', 'Server brain stopped');
}

// ══════════════════════════════════════════════════════════════════
// [ML] Build snapshot for brainLogger
// ══════════════════════════════════════════════════════════════════
function _buildSnapshot(userId, symbol, snap, ind, confluence, regime, gates, fusion, extra) {
    try {
        const s = {
            // Identity
            userId, symbol, cycle: _cycleCount, ts: Date.now(),
            // Price
            price: snap.price, priceTs: snap.priceTs,
            dataAge: snap.priceTs ? Date.now() - snap.priceTs : null,
            // Raw 5m indicators
            rsi5m: (snap.rsi && snap.rsi['5m']) || null,
            adx: ind.adx != null ? +ind.adx.toFixed(2) : null,
            macdDir: ind.macdDir || null,
            stDir: ind.stDir || null,
            bbWidth: ind.bbWidth != null ? +ind.bbWidth.toFixed(4) : null,
            atr: ind.atr != null ? +ind.atr.toFixed(4) : null,
            fr: snap.fr != null ? snap.fr : null,
            oi: snap.oi != null ? snap.oi : null,
            // Regime
            regime: regime.regime, regimeConf: regime.confidence,
            trendBias: regime.trendBias, volatilityState: regime.volatilityState,
            trapRisk: regime.trapRisk,
            // Confluence
            confScore: confluence.score,
            confBullDirs: confluence.bullDirs, confBearDirs: confluence.bearDirs,
            confIsBull: confluence.isBull,
            // Gates
            gateAllOk: gates ? gates.allOk : null,
            gateReasons: gates ? gates.reasons : [],
            // Fusion
            finalConfidence: fusion ? fusion.confidence : 0,
            finalDir: fusion ? fusion.dir : 'neutral',
            finalTier: fusion ? fusion.decision : 'NO_TRADE',
            fusionReasons: fusion ? fusion.reasons : [],
        };
        // Fusion intermediates (if available)
        if (fusion && fusion._intermediates) {
            s.fusRawConfidence = fusion._intermediates.fusRawConfidence;
            s.fusConfNorm = fusion._intermediates.fusConfNorm;
            s.fusRegimeScore = fusion._intermediates.fusRegimeScore;
            s.fusAlignScore = fusion._intermediates.fusAlignScore;
            s.fusIndScore = fusion._intermediates.fusIndScore;
            s.fusMtfScore = fusion._intermediates.fusMtfScore;
            s.fusStructScore = fusion._intermediates.fusStructScore;
            s.fusFlowScore = fusion._intermediates.fusFlowScore;
            s.fusSentScore = fusion._intermediates.fusSentScore;
            s.modStructure = fusion._intermediates.modifiers.structure;
            s.modLiquidity = fusion._intermediates.modifiers.liquidity;
            s.modLiqAnticipation = fusion._intermediates.modifiers.liqAnticipation;
            s.modJournal = fusion._intermediates.modifiers.journal;
            s.modKnn = fusion._intermediates.modifiers.knn;
            s.modSession = fusion._intermediates.modifiers.session;
            s.modVolatility = fusion._intermediates.modifiers.volatility;
            s.modTilt = fusion._intermediates.modifiers.tilt;
            s.modTrapRisk = fusion._intermediates.modifiers.trapRisk;
            s.modRegimeDanger = fusion._intermediates.modifiers.regimeDanger;
        }
        // Extra fields from caller
        if (extra) Object.assign(s, extra);
        return s;
    } catch (e) {
        logger.warn('BRAIN', '_buildSnapshot failed: ' + (e && e.message));
        return { userId, symbol, ts: Date.now(), cycle: _cycleCount };
    }
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
                // Persist per-user: each active-brain user gets their own row for isolation.
                for (const _uid of _stcMap.keys()) {
                    try {
                        db.saveRegimeChange(symbol, regime.regime, prevRegimeForSym, regime.confidence, snap.price || 0, _uid);
                    } catch (_) {}
                }
                const _regimeMsg = '🌐 *Regime Change* `' + symbol.replace('USDT', '') + '`\n' +
                    '`' + prevRegimeForSym + '` → *' + regime.regime + '*\n' +
                    'Confidence: `' + regime.confidence + '%`\n' +
                    'Bias: `' + regime.trendBias + '` | Vol: `' + regime.volatilityState + '`\n' +
                    'Price: `$' + (snap.price ? snap.price.toFixed(snap.price >= 100 ? 0 : 2) : '?') + '`';
                const _now = Date.now();
                // Only notify users who have active TC config (= brain/AT participants)
                let _tgChanged = false;
                for (const _uid of _stcMap.keys()) {
                    const _lastTs = _regimeTgLastTs.get(_uid) || 0;
                    if (_now - _lastTs >= REGIME_TG_COOLDOWN_MS) {
                        _regimeTgLastTs.set(_uid, _now);
                        _tgChanged = true;
                        telegram.sendToUser(_uid, _regimeMsg);
                    }
                }
                // [S5] Persist TG throttle so the 15-min dedup survives reload.
                if (_tgChanged) _persistRegimeTgThrottle();
            }
            _prevRegimes.set(symbol, regime.regime);
            // [S5] Persist regime baseline whenever it changes so a restart
            // does not silently swallow the next real regime change.
            _persistRegimeBaseline();

            // ── Per-user gate check + fusion + AT execution ──
            for (const [userId, stc] of users) {
                // Skip users who have AT disabled — no point computing gates/fusion
                if (!serverAT.isATActive(userId)) continue;
                // [Phase 2 S6-B1] Server-authoritative dispatch gate. Skip dispatch
                // unless either:
                //   (A) MF.SERVER_AT === true (full server-AT enabled — covers both
                //       demo and live), OR
                //   (B) MF.SERVER_AT_DEMO === true AND stc.engineMode === 'demo'
                //       (demo carve-out — live users still execute via client AT).
                // With both flags false (current production), this skip fires for
                // every user and the loop exits early — bit-identical with pre-S6-B1
                // because today _shouldRunMainCycle() is also false, so this loop
                // never runs anyway. The gate is INERT until S6-B6 flips the flags.
                // [BUG-T1 2026-05-13] Pass userId în loc de stc — gate reads mode
                // din serverAT.getMode(userId), source of truth (engineMode în us).
                if (!_isServerAuthoritativeForUser(userId)) continue;
                // [MULTI-SYM] Skip if user has symbol selection and this symbol is not in it
                if (Array.isArray(stc.symbols) && !stc.symbols.includes(symbol)) continue;

                // [2G] Check existing pending entries before evaluating new ones
                const pendingResult = serverPendingEntry.checkPending(symbol, snap.price, userId);
                if (pendingResult) {
                    if (pendingResult.action === 'FILL' || pendingResult.action === 'MOMENTUM') {
                        // Execute the pending entry via AT (use stored stc from pending)
                        const pendStc = pendingResult.pending.stc || serverRegimeParams.getAdaptedParams(regime.regime, stc);
                        // [BUG-O7 S2] Cap pending-entry execution by raw TC.size as max per-trade cap (parity with main + scale-in paths).
                        const _userIntentPending = Number((_stcMap.get(userId) || DEFAULT_STC).size);
                        const entry = serverAT.processBrainDecision(pendingResult.pending.decision, pendStc, userId, _userIntentPending);
                        if (entry) {
                            // [ML] Link pending snapshot to the created position
                            const _pendSnapId = pendingResult.pending._snapId;
                            if (_pendSnapId && entry.seq) {
                                try {
                                    brainLogger.linkSeq(_pendSnapId, entry.seq);
                                    brainLogger.updateAction(_pendSnapId, pendingResult.action === 'FILL' ? 'pending_fill' : 'pending_momentum');
                                } catch (_) {}
                            }
                            logger.info('BRAIN', `[2G] Pending ${pendingResult.action} executed for uid=${userId} ${symbol}`);
                        }
                    }
                    // [ML] Handle EXPIRE — update snapshot action
                    if (pendingResult.action === 'EXPIRE' || pendingResult.action === 'CANCEL') {
                        const _pendSnapId = pendingResult.pending._snapId;
                        if (_pendSnapId) {
                            try { brainLogger.updateAction(_pendSnapId, pendingResult.action === 'EXPIRE' ? 'pending_expire' : 'pending_cancel'); } catch (_) {}
                        }
                    }
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
                            // [BUG-O7 S2] Cap scale-in entry size by raw TC.size (max per-trade cap). Total-position cap NOT addressed in this batch — separate ticket.
                            const _userIntentSI = Number((_stcMap.get(userId) || DEFAULT_STC).size);
                            const scaleEntry = serverAT.processBrainDecision(scaleDec, scaleStc, userId, _userIntentSI);
                            if (scaleEntry) {
                                serverMultiEntry.recordScaleIn(userId, symbol, snap.price, scaleStc.size);
                                try { brainLogger.logDecision(_buildSnapshot(userId, symbol, snap, ind, confluence, regime, null, null, {
                                    sourcePath: 'scale_in', finalAction: 'entry',
                                    finalConfidence: confluence.score, finalDir: existingPos.side,
                                    finalTier: 'SMALL', linkedSeq: scaleEntry.seq || null,
                                    scaleLevel: scaleCheck.level, scaleSizeMult: scaleCheck.sizeMultiplier,
                                })); } catch (_) {}
                                logger.info('BRAIN', `[V3] Scale-in L${scaleCheck.level} ${symbol} uid=${userId}`);
                            }
                        }
                    }
                }

                // [V3] Session block check
                const sessionBlock = serverSessionProfile.checkSessionBlock(userId);
                if (sessionBlock.blocked) {
                    _logDecision('BLOCKED', 'session', null, { reason: sessionBlock.reason });
                    _pushBlock(userId, symbol, ['session_block:' + (sessionBlock.reason || 'na')], 'session', { score: confluence.score, adx: ind.adx });
                    try { brainLogger.logDecision(_buildSnapshot(userId, symbol, snap, ind, confluence, regime, null, null, {
                        sourcePath: 'no_trade', finalAction: 'blocked_session', finalTier: 'NO_TRADE', finalDir: 'neutral', finalConfidence: 0,
                        sessionBlocked: true, sessionBlockReason: sessionBlock.reason,
                    })); } catch (_) {}
                    continue;
                }

                // [V3] Drawdown assessment
                const us = serverAT.getUserState ? serverAT.getUserState(userId) : null;
                const dailyPnL = us ? (us.dailyPnL || 0) : 0;
                const refBalance = us ? (us.demoBalance || us.liveBalanceRef || 10000) : 10000;
                const ddAssess = serverDrawdownGuard.assessDrawdown(dailyPnL, refBalance);
                if (ddAssess.locked) {
                    _logDecision('BLOCKED', 'drawdown_lockout', null, { drawdownPct: ddAssess.drawdownPct });
                    _pushBlock(userId, symbol, ['drawdown_lockout:' + (ddAssess.drawdownPct != null ? ddAssess.drawdownPct.toFixed(1) + '%' : 'na')], 'drawdown', { score: confluence.score, adx: ind.adx });
                    try { brainLogger.logDecision(_buildSnapshot(userId, symbol, snap, ind, confluence, regime, null, null, {
                        sourcePath: 'no_trade', finalAction: 'blocked_drawdown', finalTier: 'NO_TRADE', finalDir: 'neutral', finalConfidence: 0,
                        ddDailyPnL: dailyPnL, ddRefBalance: refBalance, ddPct: ddAssess.drawdownPct,
                        ddTier: ddAssess.tier ? ddAssess.tier.label : 'LOCKOUT', ddLocked: true,
                    })); } catch (_) {}
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

                // [ML Phase B Day 9] Ring5 influence ACTIVATED. wrap output now
                // applied downstream when layeredBy='ring5-influence-applied' (i.e.
                // eligibility passed AND proposer fired AND reflectionGate accepted).
                // Otherwise wrap returns the original phase2 decision — no change.
                //
                // Mutation strategy: confidence + reasons mutated in place; dir/score
                // never touched (Phase 4 proposer is confidence-only per spec).
                // Cut → re-evaluate tier (downgrade to SMALL or NO_TRADE). Boost →
                // tier stays at Phase 2's authoritative level (no sizing-up risk).
                //
                // Day 7+8 invariants preserved: try/catch isolation, error swallow.
                const _ring5MarketCtx = _buildMarketContext(snap, bars, userId);
                try {
                    const _execEnv = serverAT._resolveExecutionEnv(userId);
                    if (_execEnv && _execEnv.env) {
                        const _ring5Wrap = ring5LearningService.wrap({
                            userId,
                            resolvedEnv: _execEnv.env,
                            symbol: snap.symbol,
                            phase2Decision: fusion,
                            // [Day 10] Real ML signal from fusion score components.
                            // Proposer requires sumContribution >= 0.10 (boost) or
                            // <= -0.10 (cut), AND bandit sample to confirm.
                            mlBrainProInputs: _buildRing5MlInputs(fusion),
                            mode: 'influence',
                            regime: regime.regime,
                            marketContext: _ring5MarketCtx,
                            nowTs: Date.now()
                        });
                        if (_ring5Wrap && _ring5Wrap.layeredBy === 'ring5-influence-applied') {
                            fusion.confidence = _ring5Wrap.confidence;
                            if (Array.isArray(_ring5Wrap.reasons)) fusion.reasons = _ring5Wrap.reasons;
                            fusion.layeredBy = 'ring5-influence-applied';
                            // Tier re-eval on cut. Boost never upgrades tier (sizing
                            // stays at Phase 2 authoritative level for safety).
                            if (fusion.confidence < 62 && fusion.decision !== 'NO_TRADE') {
                                fusion.decision = 'NO_TRADE';
                            } else if (fusion.confidence < 72 &&
                                       (fusion.decision === 'MEDIUM' || fusion.decision === 'LARGE')) {
                                fusion.decision = 'SMALL';
                            }
                        }
                    }
                } catch (_ring5Err) {
                    // Ring5 influence must NEVER affect brain flow — swallow any error.
                }

                if (fusion.decision !== 'NO_TRADE') {
                    // [REFLECTION] Pre-trade questioning — brain asks itself "am I sure?"
                    const marketCtx = _ring5MarketCtx;
                    const questioning = serverReflection.questionEntry(
                        snap.symbol, fusion.dir, fusion.confidence, regime.regime, marketCtx, userId
                    );

                    if (!questioning.proceed) {
                        // Brain blocked its own entry
                        serverReflection.trackSkippedTrade(snap.symbol, fusion.dir, fusion.confidence, snap.price, userId);
                        _logDecision('BLOCKED', 'reflection', decision, {
                            concerns: questioning.concerns.map(c => c.type),
                        });
                        _pushBlock(userId, symbol, ['reflection:' + questioning.concerns.map(c => c.type).join(',')], 'reflection', { score: confluence.score, adx: ind.adx, confidence: fusion.confidence });
                        try { brainLogger.logDecision(_buildSnapshot(userId, symbol, snap, ind, confluence, regime, gates, fusion, {
                            sourcePath: 'no_trade', finalAction: 'blocked_reflection',
                            reflProceed: false, reflConcernCount: questioning.concerns.length,
                            reflConcernTypes: questioning.concerns.map(c => c.type),
                            ddDailyPnL: dailyPnL, ddRefBalance: refBalance, ddPct: ddAssess.drawdownPct,
                            ddTier: ddAssess.tier ? ddAssess.tier.label : 'GREEN',
                        })); } catch (_) {}
                        continue; // skip to next user
                    }

                    // Apply confidence penalty from reflection
                    if (questioning.totalPenalty) {
                        decision.fusion.confidence = Math.max(0, decision.fusion.confidence + questioning.totalPenalty);
                        // Re-evaluate tier after penalty
                        if (decision.fusion.confidence < 62) {
                            decision.fusion.decision = 'NO_TRADE';
                            decision.fusion.reasons.push('reflection_penalty');
                            _pushBlock(userId, symbol, ['reflection_penalty:conf=' + decision.fusion.confidence], 'reflection_penalty', { score: confluence.score, adx: ind.adx, confidence: decision.fusion.confidence });
                            serverReflection.trackSkippedTrade(snap.symbol, fusion.dir, fusion.confidence, snap.price, userId);
                            try { brainLogger.logDecision(_buildSnapshot(userId, symbol, snap, ind, confluence, regime, gates, fusion, {
                                sourcePath: 'no_trade', finalAction: 'blocked_reflection_penalty',
                                finalConfidence: decision.fusion.confidence, finalTier: 'NO_TRADE',
                                modReflectionPenalty: questioning.totalPenalty,
                                ddDailyPnL: dailyPnL, ddRefBalance: refBalance,
                            })); } catch (_) {}
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
                        _pushBlock(userId, symbol, ['correlation:' + (corrCheck.reason || 'na')], 'correlation', { score: confluence.score, adx: ind.adx, confidence: fusion.confidence });
                        try { brainLogger.logDecision(_buildSnapshot(userId, symbol, snap, ind, confluence, regime, gates, fusion, {
                            sourcePath: 'no_trade', finalAction: 'blocked_correlation',
                            corrAllowed: false, corrReason: corrCheck.reason,
                            corrCorrelatedWith: corrCheck.correlatedWith || [],
                        })); } catch (_) {}
                        continue;
                    }

                    // [V3] Correlation modifier on confidence
                    const corrMod = serverCorrelationGuard.getCorrelationModifier(snap.symbol, fusion.dir, openPos);
                    if (corrMod < 1.0) {
                        decision.fusion.confidence = Math.round(decision.fusion.confidence * corrMod);
                        if (decision.fusion.confidence < 62) {
                            decision.fusion.decision = 'NO_TRADE';
                            decision.fusion.reasons.push('correlation_penalty');
                            _pushBlock(userId, symbol, ['correlation_penalty:conf=' + decision.fusion.confidence], 'correlation_penalty', { score: confluence.score, adx: ind.adx, confidence: decision.fusion.confidence });
                            try { brainLogger.logDecision(_buildSnapshot(userId, symbol, snap, ind, confluence, regime, gates, fusion, {
                                sourcePath: 'no_trade', finalAction: 'blocked_correlation_penalty',
                                finalConfidence: decision.fusion.confidence, finalTier: 'NO_TRADE',
                                modCorrelation: corrMod,
                            })); } catch (_) {}
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

                    // [ML] Build snapshot for this trade decision
                    const _mlExtra = {
                        finalConfidence: decision.fusion.confidence, finalTier: decision.fusion.decision,
                        finalDir: decision.fusion.dir,
                        modReflectionPenalty: questioning.totalPenalty || 0,
                        modCorrelation: corrMod < 1.0 ? corrMod : 1.0,
                        corrAllowed: true,
                        sizingKellyMult: sizingResult.multiplier, sizingReason: sizingResult.reason,
                        sizingFinalMult: finalSizeMult,
                        sizeBrainIntended: sizingStc.size,
                        ddDailyPnL: dailyPnL, ddRefBalance: refBalance, ddPct: ddAssess.drawdownPct,
                        ddTier: ddAssess.tier ? ddAssess.tier.label : 'GREEN',
                        ddSizeScale: ddSizeScale, ddConfBoost: ddAssess.confBoost || 0,
                        volLevel: volProfile.level, volScore: volProfile.score,
                        volSlMult: volProfile.slMultiplier,
                        sessionName: sessionBlock.session || null,
                    };

                    // [2G] Pending Entry System — wait for pullback instead of instant entry
                    const pending = serverPendingEntry.createPending(decision, sizingStc, userId, marketCtx);
                    if (pending) {
                        // [S5] Use the SAME cooldownMs that the gate at line ~1050 will read
                        // (volAdjustedStc.cooldownMs ⇒ stc.cooldownMs at gate time). Persist
                        // immediately so a crash/reload can not drop the deadline.
                        _setCooldownDeadline(userId, decision.symbol, volAdjustedStc.cooldownMs);
                        const _snapId = brainLogger.logDecision(_buildSnapshot(userId, symbol, snap, ind, confluence, regime, gates, fusion,
                            Object.assign({}, _mlExtra, { sourcePath: 'pending_created', finalAction: 'pending_created' })
                        ));
                        if (_snapId && pending) pending._snapId = _snapId; // carry for Phase 2 linkage
                        logger.info(`[BRAIN] Pending entry created for user ${userId} ${decision.symbol} (${volAdjustedStc.cooldownMs}ms cooldown)`);
                    } else {
                        // Fallback: if pending creation failed (e.g., already pending), execute directly
                        const _snapId = brainLogger.logDecision(_buildSnapshot(userId, symbol, snap, ind, confluence, regime, gates, fusion,
                            Object.assign({}, _mlExtra, { sourcePath: 'direct', finalAction: 'entry' })
                        ));
                        // [BUG-O7 S2] Pass raw TC.size as userIntent so serverAT enforces max-cap (TC.size = absolute margin ceiling per autotrade.ts canonical semantic). Use raw _stcMap value, NOT volAdjustedStc/sizingStc which are already pipeline-modified.
                        const _userIntent = Number((_stcMap.get(userId) || DEFAULT_STC).size);
                        const entry = serverAT.processBrainDecision(decision, sizingStc, userId, _userIntent);
                        if (entry) {
                            // [S5] Same deadline-based cooldown set as the pending branch.
                            _setCooldownDeadline(userId, decision.symbol, volAdjustedStc.cooldownMs);
                            if (_snapId && entry.seq) brainLogger.linkSeq(_snapId, entry.seq);
                            logger.info(`[BRAIN] Direct entry for user ${userId} ${decision.symbol}`);
                        }
                    }
                } else {
                    // [L1-DIAG] Surface gate blocks to client diagnostic feed
                    if (!gates.allOk && gates.reasons && gates.reasons.length) {
                        _pushBlock(userId, symbol, gates.reasons, 'gates', { score: confluence.score, adx: ind.adx, confidence: fusion.confidence });
                    }
                    // Track NO_TRADE for regret analysis
                    if (fusion.confidence > 50) {
                        serverReflection.trackSkippedTrade(snap.symbol, confluence.isBull ? 'LONG' : 'SHORT', fusion.confidence, snap.price, userId);
                    }
                    try { brainLogger.logDecision(_buildSnapshot(userId, symbol, snap, ind, confluence, regime, gates, fusion, {
                        sourcePath: 'no_trade', finalAction: gates.allOk ? 'no_trade' : 'blocked_gates',
                        ddDailyPnL: dailyPnL, ddRefBalance: refBalance, ddPct: ddAssess.drawdownPct,
                        ddTier: ddAssess.tier ? ddAssess.tier.label : 'GREEN',
                    })); } catch (_) {}
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
// [Phase 2 S3] Parity Harness — Shadow Cycle
// ══════════════════════════════════════════════════════════════════
// Runs the minimum required to produce a server-side fusion decision per
// configured user/symbol: confluence → regime → (pure) gates → fusion.
// Writes a source='server' row to brain_parity_log and returns. Intentionally
// DOES NOT: call serverAT.processBrainDecision, send Telegram, persist regime
// changes, track reflection, call serverMultiEntry, correlation guard,
// adaptive sizing, or any other live side-effect. Never rethrows — shadow
// failures must not contaminate the runtime.
function _runShadowCycle() {
    if (_shadowRunning) return;
    // Skip if flag flipped off mid-run or any main-cycle flag took over.
    // [S6-B1] Use _shouldRunMainCycle() instead of bare MF.SERVER_BRAIN so the
    // shadow cycle is also suppressed when SERVER_BRAIN_DEMO=true and the main
    // cycle is the active path. Defense in depth: start() never starts both
    // cycles, but if a future drift caused both timers to fire, this gate keeps
    // parity log writes clean.
    if (!MF.PARITY_SHADOW_ENABLED || _shouldRunMainCycle()) return;
    _shadowRunning = true;
    try {
        const readySymbols = serverState.getReadySymbols();
        if (!readySymbols || readySymbols.length === 0) return;
        if (_stcMap.size === 0) return;

        for (const symbol of readySymbols) {
            const snap = serverState.getSnapshotForSymbol(symbol);
            if (!snap || !snap.indicators) continue;
            if (snap.stale || (Date.now() - snap.priceTs) > STALE_DATA_MS) continue;

            const ind = snap.indicators;
            let confluence, regime, bars;
            try {
                // [Phase 2 S3.1c] Use client-mirror confluence for shadow rows
                // so parity agreement is computed on matching formula +
                // matching indicator set (RSI/ST/LS/FR/OI, not MACD).
                confluence = _calcConfluenceParity(snap, ind);
                regime = {
                    regime: ind.regime || 'RANGE',
                    confidence: ind.regimeConf || 0,
                    trendBias: ind.trendBias || 'neutral',
                    volatilityState: ind.volatilityState || 'normal',
                    trapRisk: ind.trapRisk || 0,
                };
                bars = serverState.getBarsForSymbol(symbol);
            } catch (_e) { continue; }

            for (const [userId, stc] of _stcMap) {
                if (Array.isArray(stc.symbols) && !stc.symbols.includes(symbol)) continue;
                try {
                    // [Phase 2 S3.1e] Shadow-pure fusion — mirrors client
                    // computeFusionDecision exactly, with NO per-user
                    // modifiers and NO gates. Live _computeFusion stays
                    // untouched (still drives SERVER_BRAIN live path when
                    // that flag is on). This removes the journal/KNN/
                    // session/drawdown modifier-induced divergence that
                    // was producing 25/27 BTCUSDT mismatches on the admin
                    // user during S3.1 re-soak.
                    const fusion = _computeFusionParity(snap, ind, confluence, regime, bars);
                    if (!fusion) continue;
                    db.logParityRow(userId, symbol, 'server', {
                        dir: fusion.dir,
                        decision: fusion.decision,
                        confidence: fusion.confidence,
                        score: fusion.score,
                        reasons: fusion.reasons,
                    }, _cycleCount);
                } catch (_userErr) { /* per-user shadow failure is non-fatal */ }
            }
        }
    } catch (err) {
        // Top-level guard: log once per N minutes if needed, but never throw.
        logger.warn('BRAIN', '[S3] Shadow cycle error: ' + (err && err.message));
    } finally {
        _shadowRunning = false;
    }
}

// ══════════════════════════════════════════════════════════════════
// [Phase 2 S3.1c] Parity Confluence — mirrors client calcConfluenceScore
// Used ONLY by _runShadowCycle for parity rows; the live _calcConfluence
// below stays untouched so server's live brain (if ever flipped) keeps
// its [SHORT-FIX] direction-agnostic scoring. S3.1c aligns the shadow
// formula to the client's in client/src/engine/confluence.ts so the
// ≥95% agreement gate is computed on the same indicator set + same
// score shape. Residual gap: client uses LongShort ratio (getLS()),
// server has no LS feed yet → lsDir defaults to 'neut' here, mirroring
// client's neutral-LS behavior; a follow-up batch should add
// /futures/data/topLongShortPositionRatio polling to serverState.
// ══════════════════════════════════════════════════════════════════
function _calcConfluenceParity(snap, ind) {
    // rsi direction — identical to client (50 split, binary)
    const rsiV = (snap.rsi && snap.rsi['5m']) || 50;
    const rsiDir = rsiV > 50 ? 'bull' : 'bear';

    // Supertrend — client forces binary bull|bear (defaults bear if no bull
    // signal found). Server's ind.stDir can be 'neut'; fold neut → bear to
    // match client's fallback semantics.
    const stDir = ind.stDir === 'bull' ? 'bull' : 'bear';

    // LongShort ratio — server has no LS feed; default to 'neut' (same as
    // client when getLS() returns null).
    const lsDir = 'neut';

    // Funding rate — identical to client
    const fr = snap.fr;
    const frDir = (fr != null) ? (fr < 0 ? 'bull' : 'bear') : 'neut';

    // Open interest — identical to client (stale/missing → neut)
    const oi = snap.oi;
    const oiPrev = snap.oiPrev;
    const oiDir = (oi == null || oiPrev == null) ? 'neut' : (oi > oiPrev ? 'bull' : 'bear');

    // Client's dirs set: [rsi, st, ls, fr, oi] — NO macd.
    const dirs = [rsiDir, stDir, lsDir, frDir, oiDir];
    const bullDirs = dirs.filter(d => d === 'bull').length;
    const bearDirs = dirs.filter(d => d === 'bear').length;

    // Client formula: linear bull-bias (bullDirs / 5), not absolute alignment.
    const dirFactor = bullDirs / dirs.length;
    const baseScore = dirFactor * 100;

    // Signal boost: client uses sd.signals count (external). Server has no
    // equivalent, proxy with total non-neut dirs. Closest honest mapping.
    const total = bullDirs + bearDirs;
    const signalBoost = total >= 4 ? 20 : total >= 2 ? 10 : 0;

    // Client finalScore: direction-specific sign on the boost (add when bull
    // majority, subtract when bear majority, base otherwise). NOT the server
    // live path's [SHORT-FIX] direction-agnostic add-only.
    const finalScore = Math.round(Math.max(0, Math.min(100,
        bullDirs > bearDirs ? baseScore + signalBoost :
        bullDirs < bearDirs ? baseScore - signalBoost :
        baseScore
    )));

    return {
        score: finalScore,
        bullDirs,
        bearDirs,
        rsiDir,
        stDir,
        macdDir: ind.macdDir || 'neut',  // not used by client formula; kept for _computeFusion contract
        frDir,
        oiDir,
        isBull: bullDirs > bearDirs,
        isBear: bearDirs > bullDirs,
    };
}

// ══════════════════════════════════════════════════════════════════
// [Phase 2 S3.1e] Fusion Parity — mirrors client computeFusionDecision
// EXACTLY, with NO per-user modifiers and NO gates. Used ONLY by
// _runShadowCycle for parity rows. Live _computeFusion below stays
// untouched.
//
// Why this exists: the live _computeFusion applies per-user modifiers
// (serverJournal, serverKNN, serverSessionProfile, serverDrawdownGuard,
// serverStructure, serverLiquidity, serverVolatility) which are NOT
// present in client's computeFusionDecision. For users with rich
// history (e.g. uid=1 admin) those modifiers can shift confidence
// across tier thresholds and produce SMALL/MEDIUM where client emits
// NO_TRADE — a per-user-history-induced divergence the parity gate
// must not see. S3.1e isolates parity rows from those modifiers.
//
// Inputs available on server side mirror the client's brain context:
//   confluence.score   ↔ BM.confluenceScore
//   serverOrderflow    ↔ BM.ofi (buy/sell volumes → OFI ratio)
//   serverLiquidity.liquidityGrabRisk ↔ MAGNETS.nearPct/100 (analog,
//                                       not exact)
//   regime.regime      ↔ brain.regime (case folded)
// Server has no equivalent of:
//   - computeProbScore (Scenario)  → defaults to 0.5 (matches client
//                                    null-prob default)
//   - LAST_SCAN.sigDir (multi-sym scan direction bonus) → 0
//   - LongShort feed → handled in _calcConfluenceParity already
//
// Risk: zero on live decisions. This function is called only when
// PARITY_SHADOW_ENABLED && !SERVER_BRAIN. It does not write to
// serverAT, telegram, db (other than via the caller's logParityRow),
// reflection, multi-entry, or any modifier service.
// ══════════════════════════════════════════════════════════════════
function _computeFusionParity(snap, ind, confluence, regime, bars) {
    // Confluence value (0-100) — mirrors client BM.confluenceScore
    const conf = Number.isFinite(confluence && confluence.score) ? confluence.score : 50;
    const confN = Math.max(0, Math.min(1, (conf - 50) / 50));

    // 4) OFI from server orderflow — mirrors client BM.ofi.{buy,sell}
    let ofi = 0;
    let totalVol = 0;
    try {
        const flow = serverOrderflow.getFlow(snap.symbol);
        const buy = (flow && Number.isFinite(flow.buyVol)) ? flow.buyVol : 0;
        const sell = (flow && Number.isFinite(flow.sellVol)) ? flow.sellVol : 0;
        totalVol = buy + sell;
        if (totalVol > 0) ofi = (buy - sell) / totalVol;
    } catch (_) { /* OFI=0 on failure, matches client neutral */ }
    const ofiN = (ofi + 1) / 2;

    // 2) Scenario / probScore — server has no computeProbScore equivalent.
    // Client defaults probN=0.5 when prob is null; mirror that here.
    const probN = 0.5;

    // 3) Regime mapping — mirrors client substring match (case-insensitive
    // because server uses 'TREND_UP'/'RANGE'/'CHAOS' uppercase).
    const rRaw = String((regime && regime.regime) || 'unknown');
    const r = rRaw.toLowerCase();
    let regimeN = 0.5;
    if (r.indexOf('trend') >= 0) regimeN = 0.75;
    else if (r.indexOf('range') >= 0) regimeN = 0.55;
    else if (r.indexOf('chop') >= 0 || r.indexOf('unstable') >= 0) regimeN = 0.35;

    // 5) Liquidity danger — server analog of client MAGNETS.nearPct/100.
    // Client default is 0.2 when nearPct is null; mirror that.
    let liqDangerN = 0.2;
    let liqDangerSet = false;
    try {
        const liq = serverLiquidity.getLiquidity(snap.symbol, bars || [], snap.price);
        if (liq && Number.isFinite(liq.liquidityGrabRisk)) {
            liqDangerN = Math.max(0, Math.min(1, liq.liquidityGrabRisk));
            liqDangerSet = true;
        }
    } catch (_) { /* keep default 0.2, matches client */ }

    // 7) Direction score — mirrors client formula exactly.
    // Server has no LAST_SCAN.sigDir equivalent → bonus is 0.
    let dirScore = 0;
    dirScore += ofi * 0.55;
    dirScore += ((conf - 50) / 50) * 0.30;
    dirScore = Math.max(-1, Math.min(1, dirScore));

    const dir = dirScore > 0.15 ? 'long' : dirScore < -0.15 ? 'short' : 'neutral';

    // 8) Confidence fusion — mirrors client formula exactly (no modifiers).
    const alignN = dir === 'neutral' ? 0 : (dir === 'long' ? ofiN : (1 - ofiN));
    let confF = (confN * 0.35) + (probN * 0.25) + (regimeN * 0.20) + (alignN * 0.20);
    confF *= (1 - (liqDangerN * 0.55));
    confF = Math.max(0, Math.min(1, confF));
    const confidence = Math.round(confF * 100);

    // 9) Entry tier — mirrors client thresholds exactly.
    let decision;
    if (dir === 'neutral') {
        decision = 'NO_TRADE';
    } else if (confidence >= 82 && conf >= 75 && regimeN >= 0.55) {
        decision = 'LARGE';
    } else if (confidence >= 72 && conf >= 68) {
        decision = 'MEDIUM';
    } else if (confidence >= 62 && conf >= 60) {
        decision = 'SMALL';
    } else {
        decision = 'NO_TRADE';
    }

    // Reasons payload — informational, mirrors client format. Parity
    // matching uses dir+decision only; reasons help debugging.
    const reasons = [
        'Confluence:' + Math.round(conf),
        'Regime:' + r,
    ];
    if (totalVol > 0) reasons.push('OFI:' + Math.round(ofi * 100) + '%');
    if (liqDangerSet) reasons.push('LiqDanger:' + Math.round(liqDangerN * 100) + '%');
    reasons.push('DirScore:' + Math.round(dirScore * 100) + '%');
    reasons.push('Decision:' + decision + '(' + confidence + '%)');

    return {
        ts: Date.now(),
        dir,
        decision,
        confidence,
        score: Math.round(dirScore * confidence),
        reasons,
    };
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

    // 7. Cooldown gate (per-user + per-symbol). [S5] deadline semantics:
    // value is the absolute deadlineMs at which the cooldown expires.
    // OK when no deadline OR deadline already past.
    const cdKey = userId + ':' + snap.symbol;
    const cdDeadline = _cooldowns.get(cdKey);
    gates.coolOk = !cdDeadline || Date.now() >= cdDeadline;
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
    const indWeight = 0.18; // [H7] was 0.20 — total was 1.02, now sums to 1.00

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

    // ── [ML] Track all modifiers for data layer ──
    const _mods = {
        structure: 1.0, liquidity: 1.0, liqAnticipation: 1.0,
        journal: 1.0, knn: 1.0, session: 1.0, volatility: 1.0,
        tilt: 1.0, trapRisk: 1.0, regimeDanger: 1.0,
    };

    const fusRawConfidence = confidence; // capture pre-modifier value

    // ── Structure modifier (CHoCH contra = penalty, BOS with = boost) ──
    if (tradeDir !== 'neut') {
        _mods.structure = serverStructure.getStructureModifier(tradeDir, structure);
        confidence *= _mods.structure;
    }

    // ── Liquidity modifier (near liquidity zone = penalty) ──
    if (tradeDir !== 'neut') {
        const liq = serverLiquidity.getLiquidity(snap.symbol, bars || [], snap.price);
        let liqMod = serverLiquidity.getLiquidityModifier(tradeDir, liq);
        const antic = serverLiquidity.getAnticipation(snap.symbol, bars || [], snap.price);
        _mods.liqAnticipation = 1.0;
        if (antic.tradeBias === 'avoid_long' && tradeDir === 'bull') { liqMod *= 0.85; _mods.liqAnticipation = 0.85; }
        if (antic.tradeBias === 'avoid_short' && tradeDir === 'bear') { liqMod *= 0.85; _mods.liqAnticipation = 0.85; }
        if (antic.tradeBias === 'bull' && tradeDir === 'bull') { liqMod *= 1.08; _mods.liqAnticipation = 1.08; }
        if (antic.tradeBias === 'bear' && tradeDir === 'bear') { liqMod *= 1.08; _mods.liqAnticipation = 1.08; }
        _mods.liquidity = liqMod;
        confidence *= liqMod;
    }

    // ── Journal learning modifier (adaptive from trade history) ──
    if (userId && tradeDir !== 'neut') {
        const dir = confluence.isBull ? 'LONG' : 'SHORT';
        _mods.journal = serverJournal.getAdaptiveModifier(userId, r, dir, snap.symbol);
        confidence *= _mods.journal;
    }

    // ── KNN pattern matching modifier ──
    if (tradeDir !== 'neut') {
        const knnPred = serverKNN.predict(snap, confluence, ind, userId);
        if (knnPred) {
            const knnDir = confluence.isBull ? 'LONG' : 'SHORT';
            _mods.knn = serverKNN.getKNNModifier(knnDir, knnPred);
            confidence *= _mods.knn;
        }
    }

    // ── [V3] Session modifier ──
    if (userId) {
        _mods.session = serverSessionProfile.getSessionModifier(userId);
        confidence *= _mods.session;
    }

    // ── [V3] Volatility modifier ──
    if (bars && bars.length > 30) {
        const snap2 = { indicators: ind, symbol: ind.symbol };
        const volProf = serverVolatilityEngine.assessVolatility(snap2, bars);
        _mods.volatility = serverVolatilityEngine.getVolatilityModifier(volProf);
        confidence *= _mods.volatility;
    }

    // ── [V3] Drawdown tilt modifier ──
    if (userId) {
        _mods.tilt = serverDrawdownGuard.getTiltModifier(userId);
        confidence *= _mods.tilt;
    }

    // ── Trap risk penalty ──
    if (regime.trapRisk >= 40) {
        _mods.trapRisk = (1 - regime.trapRisk * 0.005);
        confidence *= _mods.trapRisk;
    }

    // ── Regime danger penalty ──
    if (r === 'CHAOS' || r === 'LIQUIDATION_EVENT') {
        _mods.regimeDanger = 0.5;
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
        // [ML] Intermediates for data layer — not used by decision pipeline
        _intermediates: {
            fusConfNorm: +confNorm.toFixed(4),
            fusRegimeScore: +regimeScore.toFixed(4),
            fusAlignScore: +alignScore.toFixed(4),
            fusIndScore: +indScore.toFixed(4),
            fusMtfScore: +mtfScore.toFixed(4),
            fusStructScore: +structScore.toFixed(4),
            fusFlowScore: +flowScore.toFixed(4),
            fusSentScore: +sentScore.toFixed(4),
            fusRawConfidence: +fusRawConfidence.toFixed(2),
            modifiers: _mods,
        },
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
    _touchStc(userId);                              // [SRV-2] mark active on any config update
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
    if (_stcMap.has(userId)) {
        _touchStc(userId);                          // [SRV-2] read = activity
        return Object.assign({}, _stcMap.get(userId));
    }
    return Object.assign({}, DEFAULT_STC);
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
    getRecentBlocks,
    updateConfig,
    getSTC,
    getBrainVision,
    get STC() { return Object.assign({}, DEFAULT_STC); },
    // [S5] Test-only hooks. Exposed via require but never called by any
    // runtime path (start/_runCycle/_runShadowCycle do not reference them).
    // Used by tests/probe-s5.js to exercise persistence + restore + cleanup
    // without booting the brain cycle.
    _s5TestHooks: Object.freeze({
        cooldowns: _cooldowns,
        prevRegimes: _prevRegimes,
        regimeTgLastTs: _regimeTgLastTs,
        persistCooldowns: _persistCooldowns,
        restoreCooldowns: _restoreCooldowns,
        setCooldownDeadline: _setCooldownDeadline,
        persistRegimeBaseline: _persistRegimeBaseline,
        restoreRegimeBaseline: _restoreRegimeBaseline,
        persistRegimeTgThrottle: _persistRegimeTgThrottle,
        restoreRegimeTgThrottle: _restoreRegimeTgThrottle,
        REGIME_TG_COOLDOWN_MS,
    }),
    // [Phase 2 S6-B1] Test-only hooks for the demo dispatch gate. Pure flag
    // readers exposed via require but never called by any runtime path
    // (start() and _runCycle reference the local function symbols, not these
    // exports). Used by tests/probe-s6b1.js to exercise the helpers against
    // synthetic flag combinations without mutating live state.
    _s6b1TestHooks: Object.freeze({
        shouldRunMainCycle: _shouldRunMainCycle,
        isServerAuthoritativeForUser: _isServerAuthoritativeForUser,
    }),
};
