// Zeus Terminal — KNN Pattern Matching (Brain V2 — Phase 3H)
// Builds feature vectors from trade snapshots, matches current market state
// against historical outcomes via cosine similarity. Zero external deps.
// *** Per-user isolated: pattern DB keyed by userId ***
'use strict';

const logger = require('./logger');
const db = require('./database');

// ══════════════════════════════════════════════════════════════════
// Configuration
// ══════════════════════════════════════════════════════════════════
const K = 5;                        // nearest neighbors
const MAX_PATTERNS = 2000;          // max pattern DB size per user
const REBUILD_INTERVAL = 3600000;   // hourly rebuild
const MIN_PATTERNS = 10;            // minimum patterns for prediction
const FEATURE_COUNT = 10;           // number of features in vector

// ══════════════════════════════════════════════════════════════════
// Per-user pattern database
// ══════════════════════════════════════════════════════════════════
const _patternDBs = new Map(); // userId → [{ vector, outcome, pnl, dir }]
let _timer = null;
let _lastBuild = 0;

// ══════════════════════════════════════════════════════════════════
// Start / Stop
// ══════════════════════════════════════════════════════════════════
function start() {
    if (_timer) return;
    _timer = setInterval(_rebuildAll, REBUILD_INTERVAL);
    setTimeout(_rebuildAll, 45000);
    logger.info('KNN', 'Pattern matching started (per-user, hourly rebuild)');
}

function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}

// ══════════════════════════════════════════════════════════════════
// Build pattern DB from closed trades — per user
// ══════════════════════════════════════════════════════════════════
function _rebuildAll() {
    try {
        const userRows = db.db.prepare('SELECT DISTINCT user_id FROM at_closed WHERE user_id IS NOT NULL').all();
        for (const row of userRows) {
            _rebuildForUser(row.user_id);
        }
        _lastBuild = Date.now();
        logger.info('KNN', `Pattern DB rebuilt for ${userRows.length} user(s)`);
    } catch (err) {
        logger.error('KNN', `Rebuild failed: ${err.message}`);
    }
}

function _rebuildForUser(userId) {
    try {
        const trades = db.journalGetClosed(userId, 500, 0);
        const patterns = [];

        for (const tRow of trades) {
            try {
                const t = JSON.parse(tRow.data);
                if (!t.closePnl && t.closePnl !== 0) continue;
                if (t.closeReason && t.closeReason.startsWith('ENTRY_FAILED')) continue;

                const vector = _extractVector(t);
                if (!vector) continue;

                patterns.push({
                    vector,
                    outcome: t.closePnl > 0 ? 'win' : 'loss',
                    pnl: t.closePnl || 0,
                    dir: t.side || 'UNKNOWN',
                });
            } catch (_) {}
        }

        const toStore = patterns.length > MAX_PATTERNS
            ? patterns.slice(-MAX_PATTERNS)
            : patterns;
        _patternDBs.set(userId, toStore);
    } catch (err) {
        logger.error('KNN', `Rebuild for uid=${userId} failed: ${err.message}`);
    }
}

// ══════════════════════════════════════════════════════════════════
// Feature extraction — normalized 0-1
// ══════════════════════════════════════════════════════════════════
function _extractVector(trade) {
    const v = new Float64Array(FEATURE_COUNT);

    v[0] = _clamp((trade.rsi || 50) / 100);
    v[1] = _clamp((trade.adx || 20) / 50);
    v[2] = _clamp((trade.confidence || 50) / 100);

    const confScore = trade.confluenceScore || (trade.confluence && trade.confluence.score) || 50;
    v[3] = _clamp(confScore / 100);

    const regimeMap = { CHAOS: 0, LIQUIDATION_EVENT: 0, VOLATILE: 0.25, SQUEEZE: 0.4, RANGE: 0.5, BREAKOUT: 0.75, EXPANSION: 0.8, TREND: 1, TREND_UP: 1, TREND_DOWN: 1 };
    v[4] = regimeMap[trade.regime] !== undefined ? regimeMap[trade.regime] : 0.5;

    v[5] = trade.side === 'LONG' ? 1 : 0;

    const tierMap = { SMALL: 0.33, MEDIUM: 0.67, LARGE: 1.0 };
    v[6] = tierMap[trade.tier] || 0.33;

    const stDir = trade.stDir || (trade.indicators && trade.indicators.stDir) || 'neut';
    v[7] = stDir === 'bull' ? 1 : stDir === 'bear' ? 0 : 0.5;

    const macdDir = trade.macdDir || (trade.indicators && trade.indicators.macdDir) || 'neut';
    v[8] = macdDir === 'bull' ? 1 : macdDir === 'bear' ? 0 : 0.5;

    const bull = trade.bullDirs || (trade.confluence && trade.confluence.bullDirs) || 0;
    const bear = trade.bearDirs || (trade.confluence && trade.confluence.bearDirs) || 0;
    v[9] = _clamp(Math.max(bull, bear) / 5);

    return v;
}

function extractFromSnapshot(snap, confluence, ind) {
    const v = new Float64Array(FEATURE_COUNT);

    v[0] = _clamp(((snap.rsi && snap.rsi['5m']) || 50) / 100);
    v[1] = _clamp((ind.adx || 20) / 50);
    v[2] = 0.5;
    v[3] = _clamp((confluence.score || 50) / 100);

    const regimeMap = { CHAOS: 0, LIQUIDATION_EVENT: 0, VOLATILE: 0.25, SQUEEZE: 0.4, RANGE: 0.5, BREAKOUT: 0.75, EXPANSION: 0.8, TREND: 1, TREND_UP: 1, TREND_DOWN: 1 };
    v[4] = regimeMap[ind.regime] !== undefined ? regimeMap[ind.regime] : 0.5;

    v[5] = confluence.isBull ? 1 : 0;
    v[6] = 0.5;
    v[7] = ind.stDir === 'bull' ? 1 : ind.stDir === 'bear' ? 0 : 0.5;
    v[8] = ind.macdDir === 'bull' ? 1 : ind.macdDir === 'bear' ? 0 : 0.5;
    v[9] = _clamp(Math.max(confluence.bullDirs || 0, confluence.bearDirs || 0) / 5);

    return v;
}

// ══════════════════════════════════════════════════════════════════
// Cosine similarity
// ══════════════════════════════════════════════════════════════════
function _cosineSim(a, b) {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    magA = Math.sqrt(magA);
    magB = Math.sqrt(magB);
    if (magA === 0 || magB === 0) return 0;
    return dot / (magA * magB);
}

// ══════════════════════════════════════════════════════════════════
// Prediction — per user
// ══════════════════════════════════════════════════════════════════
function predict(snap, confluence, ind, userId) {
    if (!userId) return null;
    const patternDB = _patternDBs.get(userId) || [];
    if (patternDB.length < MIN_PATTERNS) return null;

    const query = extractFromSnapshot(snap, confluence, ind);

    const scored = patternDB.map((p, idx) => ({
        idx,
        sim: _cosineSim(query, p.vector),
        outcome: p.outcome,
        pnl: p.pnl,
        dir: p.dir,
    }));

    scored.sort((a, b) => b.sim - a.sim);
    const neighbors = scored.slice(0, K);

    if (neighbors.length === 0) return null;

    const wins = neighbors.filter(n => n.outcome === 'win').length;
    const winRate = wins / neighbors.length;
    const avgPnl = neighbors.reduce((s, n) => s + n.pnl, 0) / neighbors.length;
    const avgSim = neighbors.reduce((s, n) => s + n.sim, 0) / neighbors.length;

    const longWins = neighbors.filter(n => n.outcome === 'win' && n.dir === 'LONG').length;
    const shortWins = neighbors.filter(n => n.outcome === 'win' && n.dir === 'SHORT').length;
    const predDir = longWins > shortWins ? 'LONG' : shortWins > longWins ? 'SHORT' : 'neutral';

    return {
        confidence: Math.round(winRate * 100),
        dir: predDir,
        avgPnl: Math.round(avgPnl * 100) / 100,
        matchCount: patternDB.length,
        winRate: Math.round(winRate * 100),
        avgSimilarity: Math.round(avgSim * 100),
    };
}

function getKNNModifier(tradeDir, prediction) {
    if (!prediction) return 1.0;

    const agrees = prediction.dir === tradeDir;
    const strongPrediction = prediction.confidence >= 60;

    if (agrees && strongPrediction) return 1.10;
    if (agrees) return 1.05;
    if (!agrees && strongPrediction) return 0.85;
    if (!agrees) return 0.92;

    return 1.0;
}

function _clamp(v) { return Math.max(0, Math.min(1, v)); }

module.exports = {
    start,
    stop,
    predict,
    getKNNModifier,
    extractFromSnapshot,
};
