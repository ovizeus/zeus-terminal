'use strict';

const SCAN_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const LOOKBACK_MS = 24 * 60 * 60 * 1000;     // 24h
const ENVS = ['DEMO', 'TESTNET', 'REAL'];

let _timer = null;

function _tick() {
    let _db, _mf, _logger;
    try { _db = require('../services/database').db; } catch (_) { return; }
    try { _mf = require('../migrationFlags'); } catch (_) { return; }
    try { _logger = require('../services/logger'); } catch (_) {}

    if (!_mf.ML_CRON_SCAN_ENABLED) {
        if (_logger && _logger.info) _logger.info('ML_SCAN_CRON', 'skipped — ML_CRON_SCAN_ENABLED=false');
        return;
    }

    const sinceMs = Date.now() - LOOKBACK_MS;
    let totalEvaluated = 0, totalQuarantined = 0, totalErrors = 0, usersScanned = 0;

    // [2026-10-09] Discover from ml_attribution_events — the table scanAllFeatures
    // actually reads, and the one that carries user_id and resolved_env. The previous
    // query asked ml_bandit_evidence for a user_id column it does not have (the user
    // is the first segment of cell_key), so prepare() threw on every tick and the
    // bare catch turned that into "0 users" for as long as this cron has existed.
    // Scanning only the (user, env) pairs with evidence in the window also drops the
    // two-thirds of calls that were always made against envs holding nothing.
    let pairs;
    try {
        pairs = _db.prepare(
            `SELECT DISTINCT user_id, resolved_env FROM ml_attribution_events
             WHERE attributed_at >= ?`
        ).all(sinceMs);
    } catch (err) {
        pairs = [];
        if (_logger && _logger.error) {
            _logger.error('ML_SCAN_CRON', `user discovery failed, scanning nobody: ${err.message}`);
        }
    }

    let scanAllFeatures;
    try {
        scanAllFeatures = require('../services/ml/R5B_governance/autoQuarantine').scanAllFeatures;
    } catch (_) { return; }

    const seenUsers = new Set();
    for (const { user_id: uid, resolved_env: env } of pairs) {
        try {
            const result = scanAllFeatures({ userId: uid, resolvedEnv: env, sinceMs });
            totalEvaluated += result.evaluated || 0;
            totalQuarantined += (result.quarantined || []).length;
            totalErrors += (result.errors || []).length;
        } catch (err) {
            totalErrors++;
            if (_logger && _logger.warn) {
                _logger.warn('ML_SCAN_CRON', `scanAllFeatures failed uid=${uid} env=${env}: ${err.message}`);
            }
        }
        seenUsers.add(uid);
    }
    usersScanned = seenUsers.size;

    if (_logger && _logger.info) {
        _logger.info('ML_SCAN_CRON', `tick complete: ${usersScanned} users, ${pairs.length} user/env pairs, evaluated=${totalEvaluated}, quarantined=${totalQuarantined}, errors=${totalErrors}`);
    }
}

function schedule() {
    if (_timer) return;
    _timer = setInterval(_tick, SCAN_INTERVAL_MS);
    setTimeout(_tick, 60000);
}

function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { schedule, stop, _tick, SCAN_INTERVAL_MS, ENVS };
