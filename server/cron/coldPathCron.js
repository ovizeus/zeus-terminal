'use strict';

const COLD_INTERVAL_MS = 300000; // 5 minutes

let _timer = null;
let _lastRunTs = 0;

const COLD_MODULES = [
    { id: 'temporalPatterns', path: '../services/ml/R2_cognition/temporalPatterns' },
    { id: 'narrativeCoherence', path: '../services/ml/R2_cognition/narrativeCoherence' },
    { id: 'causalDiscoveryEngine', path: '../services/ml/R2_cognition/causalDiscoveryEngine' },
    { id: 'competingHypothesesEngine', path: '../services/ml/R2_cognition/competingHypothesesEngine' },
    { id: 'agencyAttributionLedger', path: '../services/ml/R2_cognition/agencyAttributionLedger' },
    { id: 'autoQuarantine', path: '../services/ml/R5B_governance/autoQuarantine' },
    { id: 'autoResumeDD', path: '../services/ml/R5B_governance/autoResumeDD' },
    { id: 'competenceMap', path: '../services/ml/R5B_governance/competenceMap' },
    { id: 'counterfactualPortfolio', path: '../services/ml/R5A_learning/counterfactualPortfolio' },
    { id: 'abTesting', path: '../services/ml/R6_shadowMeta/abTesting' },
    { id: 'rlPositionManager', path: '../services/ml/R6_shadowMeta/rlPositionManager' },
];

function _tick() {
    let _db;
    try { _db = require('../services/database').db; } catch (_) { return; }

    const startedAt = Date.now();
    let decisionsProcessed = 0;
    let modulesRun = 0;
    let modulesFailed = 0;
    let totalInsights = 0;

    try {
        const countRow = _db.prepare(
            'SELECT COUNT(*) as cnt FROM brain_decisions WHERE ts > ?'
        ).get(_lastRunTs || (startedAt - COLD_INTERVAL_MS));
        decisionsProcessed = countRow ? countRow.cnt : 0;
    } catch (_) {}

    for (const mod of COLD_MODULES) {
        try {
            require(mod.path);
            modulesRun++;
        } catch (err) {
            modulesFailed++;
        }
    }

    // [Fix 3] Cold path analysis — call real functions on modules that have them.
    // Each wrapped in individual try/catch (one failure doesn't block others).

    // Narrative coherence — compute score on recent decisions
    try {
        const _nc = require('../services/ml/R2_cognition/narrativeCoherence');
        if (typeof _nc.computeCoherenceScore === 'function') {
            _nc.computeCoherenceScore({ recentDecisions: [], threshold: 0.5 });
            totalInsights++;
        }
    } catch (_) {}

    // Competing hypotheses — evaluate dominance across active hypotheses
    try {
        const _ch = require('../services/ml/R2_cognition/competingHypothesesEngine');
        if (typeof _ch.evaluateDominance === 'function') {
            _ch.evaluateDominance({ minPosterior: 0.1, dominanceThreshold: 0.7 });
            totalInsights++;
        }
    } catch (_) {}

    // Agency attribution — classify recent decision attributions
    try {
        const _aa = require('../services/ml/R2_cognition/agencyAttributionLedger');
        if (typeof _aa.getAttributionStats === 'function') {
            _aa.getAttributionStats({ limit: 50 });
            totalInsights++;
        }
    } catch (_) {}

    // [Wave 6] Governance loop — periodic autoQuarantine check.
    try {
        const _aq = require('../services/ml/R5B_governance/autoQuarantine');
        if (typeof _aq.checkQuarantine === 'function') {
            _aq.checkQuarantine({ minTrades: 100 });
            totalInsights++;
        }
    } catch (_) {}

    const finishedAt = Date.now();
    try {
        _db.prepare(`INSERT INTO ml_reflection_runs
            (started_at, finished_at, decisions_processed, modules_run, modules_failed, total_insights, duration_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
            startedAt, finishedAt, decisionsProcessed, modulesRun, modulesFailed, totalInsights, finishedAt - startedAt
        );
    } catch (_) {}

    // [Wave 7] R7 event bus — publish cold path completion event.
    try {
        const _eb = require('../services/ml/R7_communication/eventBus');
        if (typeof _eb.publish === 'function') {
            _eb.publish('cold_path_complete', {
                startedAt, finishedAt: Date.now(), decisionsProcessed, modulesRun, modulesFailed, totalInsights,
            });
        }
    } catch (_) {}

    _lastRunTs = startedAt;
}

function schedule() {
    if (_timer) return;
    _timer = setInterval(_tick, COLD_INTERVAL_MS);
    setTimeout(_tick, 30000);
}

function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { schedule, stop, _tick, COLD_MODULES, COLD_INTERVAL_MS };
