'use strict';

/**
 * OMEGA Doctor D-3.5 — Analyzer (orchestrator + state transition).
 *
 * Runs every ANALYZER_INTERVAL_MS (5s) and computes:
 *   - Current cognitive state per FAILURE_ONTOLOGY (HEALTHY → DEAD)
 *   - Active P0/P1 alert counts (from persistent log)
 *   - Low-trust modules (trustScorer)
 *   - Downweighted modules (falsePositiveAuditor FP rate)
 *   - Quota status (severityClassifier rolling counts)
 *
 * Emits state_change event when transitioning.
 *
 * State precedence (highest wins): DEAD > SAFE_MODE > COMPROMISED > DEGRADED > HEALTHY
 *
 * This module is the READ-ONLY observational Doctor — it computes state but
 * does NOT clamp influence or trigger quarantines. Intervention happens in
 * D-5 Quarantine Manager (which subscribes to state_change events from here).
 */

const { db } = require('../../database');
const eventBus = require('./eventBus');
const severityClassifier = require('./severityClassifier');
const trustScorer = require('./trustScorer');
const falsePositiveAuditor = require('./falsePositiveAuditor');
const quarantineManager = require('./quarantineManager');
const shedManager = require('./shedManager');

const COGNITIVE_STATES = Object.freeze([
    'HEALTHY', 'DEGRADED', 'COMPROMISED', 'SAFE_MODE', 'DEAD'
]);
const ANALYZER_INTERVAL_MS = 5000;

let _lastState = null;
let _running = false;
let _timer = null;

function _required(p, k) {
    if (p == null || p[k] == null) {
        throw new Error(`analyzer: missing required field ${k}`);
    }
    return p[k];
}

function computeCognitiveState(inputs) {
    // Validate all required inputs (computeCognitiveState is pure — explicit args).
    const required = [
        'activeP0', 'activeP1',
        'hotPathCriticalQuarantined', 'hotPathAssistQuarantined',
        'doctorHeartbeatStale', 'moneyFrozen', 'dbIntegrityFail', 'nowTs'
    ];
    for (const k of required) {
        if (inputs == null || inputs[k] == null) {
            throw new Error(`analyzer.computeCognitiveState: missing ${k}`);
        }
    }

    // DEAD — highest precedence.
    if (inputs.dbIntegrityFail) {
        return { state: 'DEAD', reason: 'DB integrity check failed' };
    }

    // SAFE_MODE — money frozen OR 3+ hot_path_critical down.
    if (inputs.moneyFrozen) {
        return { state: 'SAFE_MODE', reason: 'money path frozen (positions cannot close)' };
    }
    if (inputs.hotPathCriticalQuarantined >= 3) {
        return { state: 'SAFE_MODE',
                 reason: `${inputs.hotPathCriticalQuarantined} hot_path_critical modules quarantined` };
    }

    // COMPROMISED — active P0, hot_path_critical quarantined, 2+ hot_path_assist,
    // Doctor self-stale.
    if (inputs.activeP0 >= 1) {
        return { state: 'COMPROMISED', reason: `${inputs.activeP0} active P0 alert(s)` };
    }
    if (inputs.hotPathCriticalQuarantined >= 1) {
        return { state: 'COMPROMISED', reason: 'hot_path_critical module quarantined' };
    }
    if (inputs.hotPathAssistQuarantined >= 2) {
        return { state: 'COMPROMISED',
                 reason: `${inputs.hotPathAssistQuarantined} hot_path_assist modules quarantined` };
    }
    if (inputs.doctorHeartbeatStale) {
        return { state: 'COMPROMISED', reason: 'Doctor self-heartbeat stale (>30s)' };
    }

    // DEGRADED — 1 P1 active OR 1 hot_path_assist quarantined.
    if (inputs.activeP1 >= 1 || inputs.hotPathAssistQuarantined >= 1) {
        return { state: 'DEGRADED',
                 reason: inputs.activeP1 >= 1
                    ? `${inputs.activeP1} active P1 alert(s)`
                    : 'hot_path_assist module quarantined' };
    }

    return { state: 'HEALTHY', reason: 'all systems operational' };
}

const _activeCountStmt = db.prepare(`
    SELECT COUNT(*) AS n FROM ml_diagnostic_events
    WHERE severity = ? AND ts >= ?
      AND (verdict IS NULL OR verdict != 'false_positive')
`);

function _countActive(severity, sinceTs) {
    return _activeCountStmt.get(severity, sinceTs).n;
}

function analyze(params) {
    const nowTs = _required(params, 'nowTs');

    // P0 active = unresolved (verdict NULL or non-FP) in last 24h.
    // P1 active = unresolved in last 1h.
    const activeP0 = _countActive('P0', nowTs - 86400_000);
    const activeP1 = _countActive('P1', nowTs - 3600_000);

    // D-5 wired: real quarantine counts from quarantineManager.
    const qCounts = quarantineManager.getActiveCountsByRole();
    const hotPathCriticalQuarantined = qCounts.hot_path_critical;
    const hotPathAssistQuarantined = qCounts.hot_path_assist;

    // Doctor self-stale: when telemetryCollector hasn't recorded a Doctor
    // heartbeat in >30s. For D-3 we assume Doctor itself running (false).
    // When D-3.5 boot integration emits its own heartbeat, we'll query
    // telemetryCollector.isStale({moduleId: '_doctor_analyzer'}).
    const doctorHeartbeatStale = false;

    // moneyFrozen: hook for §28 reconcilePosition status. For D-3 always false.
    const moneyFrozen = false;

    // dbIntegrityFail: SQLite PRAGMA integrity_check. For D-3 always false.
    const dbIntegrityFail = false;

    const { state, reason } = computeCognitiveState({
        activeP0, activeP1,
        hotPathCriticalQuarantined, hotPathAssistQuarantined,
        doctorHeartbeatStale, moneyFrozen, dbIntegrityFail, nowTs
    });

    // Emit state_change event when transition occurs (skip on first run).
    if (_lastState !== null && _lastState !== state) {
        eventBus.emit({
            eventType: 'state_change',
            moduleId: '_doctor_analyzer',
            severity: state === 'HEALTHY' ? 'P3'
                    : state === 'DEGRADED' ? 'P2'
                    : state === 'COMPROMISED' ? 'P0'
                    : state === 'SAFE_MODE' ? 'P0'
                    : 'P0',  // DEAD
            payload: { from: _lastState, to: state, reason },
            ts: nowTs
        });
    }
    _lastState = state;

    return {
        state,
        reason,
        activeP0, activeP1,
        hotPathCriticalQuarantined, hotPathAssistQuarantined,
        quotaStatus: severityClassifier.getQuotaStatus({ nowTs }),
        lowTrustModules: trustScorer.listLowTrustModules(),
        downweightedModules: falsePositiveAuditor.listDownweightedModules({ nowTs }),
        shedState: shedManager.getCurrentState(),
        activeQuarantines: quarantineManager.getActiveQuarantines()
    };
}

function getCurrentState() {
    return _lastState;
}

function start() {
    if (_running) return;
    _running = true;
    _timer = setInterval(() => {
        try { analyze({ nowTs: Date.now() }); }
        catch (err) {
            console.error('[OMEGA-DOCTOR analyzer] tick error:', err.message);
        }
    }, ANALYZER_INTERVAL_MS);
    if (_timer.unref) _timer.unref();
}

function stop() {
    if (!_running) return;
    _running = false;
    if (_timer) { clearInterval(_timer); _timer = null; }
}

function resetForTest() {
    stop();
    _lastState = null;
}

module.exports = {
    COGNITIVE_STATES, ANALYZER_INTERVAL_MS,
    computeCognitiveState, analyze, getCurrentState,
    start, stop, resetForTest
};
