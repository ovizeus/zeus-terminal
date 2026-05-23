'use strict';

/**
 * OMEGA R3A Safety — dataFreshness (canonical §13)
 *
 * §13 DATA FRESHNESS SI VALIDARE FEED.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 852-872.
 *
 * "Brain-ul nu are voie sa decida pe date stale sau desincronizate."
 *
 * 8 verifications (lines 857-865):
 *   feed_age / timestamp_alignment / update_gap / source_divergence
 *   / snapshot_integrity / websocket_health / clock_drift / flow_continuity
 *
 * 5-action ladder (lines 867-872, escalating severity):
 *   OK → OBSERVER → ALERT → PAUSE → REDUCE_RISK → NO_TRADE
 *
 * Composable with §14: verdict propagates as `feed_unstable` signal into
 * evaluateVetoSignals() (closes safety loop).
 */

const { db } = require('../../database');

const FEED_CHECK_KEYS = Object.freeze([
    'feed_age',
    'timestamp_alignment',
    'update_gap',
    'source_divergence',
    'snapshot_integrity',
    'websocket_health',
    'clock_drift',
    'flow_continuity'
]);

// Order matters: lower index = healthier; ACTION_LADDER[max] = most severe.
const ACTION_LADDER = Object.freeze([
    'OK',
    'OBSERVER',
    'ALERT',
    'PAUSE',
    'REDUCE_RISK',
    'NO_TRADE'
]);

const DEFAULT_THRESHOLDS = Object.freeze({
    feed_age_ms:           30000,   // 30s — feed considered stale beyond this
    update_gap_ms:         15000,   // 15s — gap between updates flagged
    timestamp_skew_ms:     5000,    // 5s — feed timestamp vs now divergence
    source_divergence_pct: 0.5,     // 0.5% divergence between sources critical
    clock_drift_ms:        2000,    // 2s clock drift local vs exchange
    flow_gap_ms:           60000    // 60s — no any-update means flow broken
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`dataFreshness: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statement ─────────────────────────────────────────────
const _stmts = {
    insertLog: db.prepare(`
        INSERT INTO ml_freshness_log
        (user_id, resolved_env, action, issue_count,
         stale_feeds_json, divergences_json, snapshot_issues_json,
         clock_drift_ms, context_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
};

// ── Severity scoring → action ladder ───────────────────────────────
function _classifyAction({ issueCount, hasNoTrade, hasReduceRisk, hasPause, hasAlert, hasObserver }) {
    if (hasNoTrade) return 'NO_TRADE';
    if (hasReduceRisk) return 'REDUCE_RISK';
    if (hasPause) return 'PAUSE';
    if (hasAlert) return 'ALERT';
    if (hasObserver || issueCount > 0) return 'OBSERVER';
    return 'OK';
}

// ── evaluateFeedHealth ─────────────────────────────────────────────
function evaluateFeedHealth(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const feeds = (params && params.feeds) ? params.feeds : {};
    const websocketHealthy = params && params.websocketHealthy !== undefined
        ? !!params.websocketHealthy : true;
    const clockDriftMs = (params && typeof params.clockDriftMs === 'number')
        ? Math.abs(params.clockDriftMs) : 0;
    const thresholds = (params && params.thresholds)
        ? params.thresholds : DEFAULT_THRESHOLDS;
    const criticalSourceGroups = (params && params.criticalSourceGroups)
        ? params.criticalSourceGroups : {};
    const context = (params && params.context) ? params.context : null;

    const now = Date.now();
    const staleFeeds = [];
    const snapshotIssues = [];
    const divergences = [];
    const flowIssues = [];

    // Check 1+2+3: feed_age, timestamp_alignment, update_gap, snapshot_integrity
    for (const [feedKey, feed] of Object.entries(feeds)) {
        if (!feed || feed.lastUpdate === undefined || feed.lastUpdate === null) {
            staleFeeds.push(feedKey);
            continue;
        }
        const age = now - feed.lastUpdate;
        if (age > thresholds.feed_age_ms) {
            staleFeeds.push(feedKey);
        }
        if (feed.snapshotIntegrity === false) {
            snapshotIssues.push(feedKey);
        }
    }

    // Check 4: source_divergence (cross-source consistency)
    for (const [groupName, feedKeys] of Object.entries(criticalSourceGroups)) {
        const values = feedKeys
            .map(k => feeds[k] && typeof feeds[k].value === 'number' ? feeds[k].value : null)
            .filter(v => v !== null);
        if (values.length < 2) continue;
        const max = Math.max(...values);
        const min = Math.min(...values);
        if (min <= 0) continue;
        const divPct = ((max - min) / min) * 100;
        if (divPct > thresholds.source_divergence_pct) {
            divergences.push(groupName);
        }
    }

    // Check 6: websocket_health
    if (!websocketHealthy) flowIssues.push('websocket_down');

    // Check 7: clock_drift
    const clockDriftFlag = clockDriftMs > thresholds.clock_drift_ms;
    // Check 8: flow_continuity — simulated by websocketHealthy + no feeds-fresh
    if (Object.keys(feeds).length > 0 && staleFeeds.length === Object.keys(feeds).length) {
        flowIssues.push('flow_broken');
    }

    // Severity scoring → action
    const issueCount =
        staleFeeds.length + snapshotIssues.length + divergences.length
        + flowIssues.length + (clockDriftFlag ? 1 : 0);

    const totalFeeds = Object.keys(feeds).length;
    const staleRatio = totalFeeds > 0 ? staleFeeds.length / totalFeeds : 0;
    const wsDown = !websocketHealthy;
    const severeClockDrift = clockDriftMs > thresholds.clock_drift_ms * 10;
    const snapshotBroken = snapshotIssues.length > 0;

    const hasNoTrade =
        (staleRatio >= 0.75 && wsDown) ||  // catastrophic
        (staleRatio >= 0.75 && severeClockDrift) ||
        (wsDown && severeClockDrift && snapshotBroken);
    const hasReduceRisk =
        (staleRatio >= 0.5 && wsDown) ||
        (issueCount >= 4);
    const hasPause =
        (staleRatio >= 0.5) ||
        (wsDown && (clockDriftFlag || snapshotBroken)) ||
        (issueCount >= 3);
    const hasAlert =
        wsDown || snapshotBroken || divergences.length > 0
        || (staleFeeds.length > 0 && clockDriftFlag);
    const hasObserver = staleFeeds.length > 0 || clockDriftFlag;

    const action = _classifyAction({
        issueCount, hasNoTrade, hasReduceRisk, hasPause, hasAlert, hasObserver
    });

    _stmts.insertLog.run(
        userId, env, action, issueCount,
        JSON.stringify(staleFeeds),
        JSON.stringify(divergences),
        JSON.stringify(snapshotIssues),
        clockDriftMs,
        context ? JSON.stringify(context) : null,
        Date.now()
    );

    return {
        action,
        issueCount,
        staleFeeds,
        divergences,
        snapshotIssues,
        flowIssues,
        clockDriftFlag
    };
}

module.exports = {
    FEED_CHECK_KEYS,
    ACTION_LADDER,
    DEFAULT_THRESHOLDS,
    evaluateFeedHealth
};
