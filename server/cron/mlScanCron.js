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

    let users;
    try {
        users = _db.prepare('SELECT DISTINCT user_id FROM ml_bandit_evidence').all();
    } catch (_) {
        users = [];
    }

    let scanAllFeatures;
    try {
        scanAllFeatures = require('../services/ml/R5B_governance/autoQuarantine').scanAllFeatures;
    } catch (_) { return; }

    for (const row of users) {
        for (const env of ENVS) {
            try {
                const result = scanAllFeatures({ userId: row.user_id, resolvedEnv: env, sinceMs });
                totalEvaluated += result.evaluated || 0;
                totalQuarantined += (result.quarantined || []).length;
                totalErrors += (result.errors || []).length;
            } catch (err) {
                totalErrors++;
                if (_logger && _logger.warn) {
                    _logger.warn('ML_SCAN_CRON', `scanAllFeatures failed uid=${row.user_id} env=${env}: ${err.message}`);
                }
            }
        }
        usersScanned++;
    }

    if (_logger && _logger.info) {
        _logger.info('ML_SCAN_CRON', `tick complete: ${usersScanned} users × ${ENVS.length} envs, evaluated=${totalEvaluated}, quarantined=${totalQuarantined}, errors=${totalErrors}`);
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
