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
const telemetryCollector = require('./telemetryCollector');

const COGNITIVE_STATES = Object.freeze([
    'HEALTHY', 'DEGRADED', 'COMPROMISED', 'SAFE_MODE', 'DEAD'
]);
const ANALYZER_INTERVAL_MS = 5000;
// [Day 22] DB integrity check throttle — `PRAGMA integrity_check` is expensive
// (full DB scan); run at most once per 5 min. Cached result reused between checks.
const DB_INTEGRITY_CHECK_INTERVAL_MS = 5 * 60 * 1000;
let _lastDbIntegrityCheckTs = 0;
let _lastDbIntegrityFail = false;

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

    // [Day 21] Brain heartbeat staleness check. serverBrain emits heartbeats
    // every cycle (~30s) via telemetryCollector.recordInvocation. If no
    // heartbeat in >30s (STALENESS_THRESHOLD_MS), brain is dead/stuck → mark
    // doctorHeartbeatStale=true → escalates cognitive state to COMPROMISED.
    let doctorHeartbeatStale = false;
    try {
        const staleness = telemetryCollector.isStale({ moduleId: 'serverBrain', nowTs });
        // Cold-start guard: ignore stale=true when lastHeartbeatTs is null
        // (no rows yet → system just booted, give it time before alarming).
        if (staleness && staleness.stale && staleness.lastHeartbeatTs != null) {
            doctorHeartbeatStale = true;
        }
    } catch (_) { /* fall through to false */ }

    // moneyFrozen: hook for §28 reconcilePosition status. For D-3 always false.
    const moneyFrozen = false;

    // [Day 22] DB integrity check periodic — runs at most once per 5 min.
    // PRAGMA integrity_check returns 'ok' if healthy, error list otherwise.
    let dbIntegrityFail = _lastDbIntegrityFail;
    if (nowTs - _lastDbIntegrityCheckTs >= DB_INTEGRITY_CHECK_INTERVAL_MS) {
        _lastDbIntegrityCheckTs = nowTs;
        try {
            const rows = db.prepare('PRAGMA integrity_check(1)').all();
            // Healthy: single row [{integrity_check: 'ok'}]. Anything else = fail.
            dbIntegrityFail = !(rows.length === 1 && rows[0].integrity_check === 'ok');
        } catch (_) {
            dbIntegrityFail = true; // exception running pragma = DB unreadable
        }
        _lastDbIntegrityFail = dbIntegrityFail;
    }

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
        // [Day 22] Analyzer self-heartbeat via telemetryCollector — closes
        // recursive observability loop (Doctor monitors itself; if analyzer
        // freezes, its own staleness gets reported when re-running).
        const tickStart = Date.now();
        let tickOk = 1;
        try { analyze({ nowTs: tickStart }); }
        catch (err) {
            tickOk = 0;
            console.error('[OMEGA-DOCTOR analyzer] tick error:', err.message);
        } finally {
            try {
                telemetryCollector.recordInvocation({
                    moduleId: '_doctor_analyzer',
                    latencyMs: Date.now() - tickStart,
                    ranOk: tickOk,
                    ts: Date.now()
                });
            } catch (_) { /* never block tick */ }
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
