'use strict';

/**
 * OMEGA Doctor D-3.1 — Severity Classifier with quota anti-fatigue.
 *
 * Per FAILURE_ONTOLOGY:
 *   - P0 CRITICAL: max 3/day → 4th = P0-FLOOD (alert system itself broken)
 *   - P1 HIGH: max 10/hour → 11th coalesces into alert_storm
 *   - P2 MEDIUM: max 100/hour → 101st coalesces
 *   - P3 INFO: unlimited
 *
 * Query strategy: count from ml_diagnostic_events in the rolling window.
 * Source of truth is the persisted log (eventually consistent ~1s lag from
 * persistentLogWriter); not the live ring buffer.
 *
 * Output API: classify({severity, moduleId, ts}) → {
 *   severity,             // potentially promoted to P0-FLOOD
 *   quotaExceeded,        // bool
 *   coalesced,            // bool (true for P1/P2 overflow)
 *   alertStorm,           // bool (true on coalesce)
 *   reason                // explanation string
 * }
 */

const { db } = require('../../database');

const SEVERITIES = Object.freeze(['P0', 'P1', 'P2', 'P3', 'P0-FLOOD']);
const QUOTA_P0_PER_DAY = 3;
const QUOTA_P1_PER_HOUR = 10;
const QUOTA_P2_PER_HOUR = 100;
const WINDOW_24H_MS = 86400_000;
const WINDOW_1H_MS = 3600_000;

function _required(p, k) {
    if (p == null || p[k] == null) {
        throw new Error(`severityClassifier: missing required field ${k}`);
    }
    return p[k];
}

const _countStmt = db.prepare(`
    SELECT COUNT(*) AS n FROM ml_diagnostic_events
    WHERE severity = ? AND ts >= ?
`);

function _countInWindow(severity, sinceTs) {
    return _countStmt.get(severity, sinceTs).n;
}

function classify(params) {
    const severity = _required(params, 'severity');
    const moduleId = _required(params, 'moduleId');
    const ts = _required(params, 'ts');

    if (!SEVERITIES.includes(severity)) {
        throw new Error(`severityClassifier: invalid severity '${severity}'`);
    }

    // P3 unlimited; pass through immediately.
    if (severity === 'P3') {
        return {
            severity: 'P3', quotaExceeded: false,
            coalesced: false, alertStorm: false,
            reason: 'P3 unlimited'
        };
    }

    if (severity === 'P0') {
        const count = _countInWindow('P0', ts - WINDOW_24H_MS);
        if (count >= QUOTA_P0_PER_DAY) {
            return {
                severity: 'P0-FLOOD',
                quotaExceeded: true,
                coalesced: false,
                alertStorm: false,
                reason: `P0 quota ${QUOTA_P0_PER_DAY}/24h exceeded — alert system itself may be malfunctioning`
            };
        }
        return {
            severity: 'P0', quotaExceeded: false,
            coalesced: false, alertStorm: false,
            reason: `under quota (${count + 1}/${QUOTA_P0_PER_DAY})`
        };
    }

    if (severity === 'P1') {
        const count = _countInWindow('P1', ts - WINDOW_1H_MS);
        if (count >= QUOTA_P1_PER_HOUR) {
            return {
                severity: 'P1',
                quotaExceeded: true,
                coalesced: true,
                alertStorm: true,
                reason: `P1 quota ${QUOTA_P1_PER_HOUR}/1h exceeded — coalesce into alert_storm`
            };
        }
        return {
            severity: 'P1', quotaExceeded: false,
            coalesced: false, alertStorm: false,
            reason: `under quota (${count + 1}/${QUOTA_P1_PER_HOUR})`
        };
    }

    if (severity === 'P2') {
        const count = _countInWindow('P2', ts - WINDOW_1H_MS);
        if (count >= QUOTA_P2_PER_HOUR) {
            return {
                severity: 'P2',
                quotaExceeded: true,
                coalesced: true,
                alertStorm: true,
                reason: `P2 quota ${QUOTA_P2_PER_HOUR}/1h exceeded — coalesce into alert_storm`
            };
        }
        return {
            severity: 'P2', quotaExceeded: false,
            coalesced: false, alertStorm: false,
            reason: `under quota (${count + 1}/${QUOTA_P2_PER_HOUR})`
        };
    }

    // P0-FLOOD passes through; cannot be promoted further.
    return {
        severity: 'P0-FLOOD', quotaExceeded: true,
        coalesced: false, alertStorm: false,
        reason: 'already P0-FLOOD'
    };
}

function getQuotaStatus(params) {
    const nowTs = _required(params, 'nowTs');
    return {
        p0_24h: _countInWindow('P0', nowTs - WINDOW_24H_MS),
        p1_1h: _countInWindow('P1', nowTs - WINDOW_1H_MS),
        p2_1h: _countInWindow('P2', nowTs - WINDOW_1H_MS),
        p0_flood_24h: _countInWindow('P0-FLOOD', nowTs - WINDOW_24H_MS)
    };
}

function resetForTest() {
    // Stateless module — DB-driven. resetForTest exists for parity with other
    // Doctor modules; no internal state to clear.
}

module.exports = {
    SEVERITIES, QUOTA_P0_PER_DAY, QUOTA_P1_PER_HOUR, QUOTA_P2_PER_HOUR,
    WINDOW_24H_MS, WINDOW_1H_MS,
    classify, getQuotaStatus, resetForTest
};
