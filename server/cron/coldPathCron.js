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

    // [2026-10-09 audit A1] This block used to hold four "analyses" that were
    // calls to nothing, each in its own silent catch, which is why every
    // recorded run produced total_insights=0 while looking healthy:
    //   computeCoherenceScore — passed {recentDecisions:[]} but requires a
    //       `thread`, and nothing enumerates threads, so there is no periodic
    //       entry point for it at all;
    //   getAttributionStats — does not exist (that module exports per-event
    //       helpers, nothing periodic);
    //   checkQuarantine — does not exist either; the real sweep is
    //       scanAllFeatures, which mlScanCron already owns on a 4h cadence, so
    //       running it here every 5 minutes would duplicate rather than add;
    //   evaluateDominance — real, but was handed thresholds instead of the
    //       `hypotheses` array it requires.
    // Only dominance is a genuine periodic analysis, so it is the one kept and
    // made to work. The other three are removed rather than left pretending to
    // be a reflection layer.
    try {
        const _ch = require('../services/ml/R2_cognition/competingHypothesesEngine');
        // Same discovery as mlScanCron: the (user, env) pairs with recent evidence.
        let pairs = [];
        try {
            pairs = _db.prepare(
                `SELECT DISTINCT user_id, resolved_env FROM ml_attribution_events
                 WHERE attributed_at >= ?`
            ).all(startedAt - COLD_INTERVAL_MS * 12);
        } catch (_) { pairs = []; }

        for (const { user_id: uid, resolved_env: env } of pairs) {
            try {
                const hypotheses = _ch.getCompetingHypotheses({ userId: uid, resolvedEnv: env });
                if (!Array.isArray(hypotheses) || hypotheses.length === 0) continue;
                _ch.evaluateDominance({ hypotheses });
                totalInsights++;
            } catch (err) {
                modulesFailed++;
            }
        }
    } catch (_) { /* the loader itself failing is already counted above */ }

    const finishedAt = Date.now();

    // [2026-10-09 audit C2] Report the outcome. This cron used to write nothing
    // at all, which is how it went unnoticed that every analysis below fails
    // into a silent catch and the layer produces no insights whatsoever.
    try {
        const logger = require('../services/logger');
        const summary = `tick: ${decisionsProcessed} decisions, ${modulesRun} modules loaded, `
            + `${modulesFailed} failed, ${totalInsights} insights, ${finishedAt - startedAt}ms`;
        if (totalInsights === 0 || modulesFailed > 0) {
            logger.warn('COLD_PATH', `${summary} — 0 insights means every analysis threw; the reflection layer is inert`);
        } else {
            logger.info('COLD_PATH', summary);
        }
    } catch (_) { /* logging must never break the cron */ }

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
