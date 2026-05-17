'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p190-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/anomalySanctuary');

const UID = 9190, UID2 = 9290, ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    db.prepare(`DELETE FROM ml_anomaly_sanctuary WHERE user_id IN (?, ?)`).run(UID, UID2);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §190 ANOMALY SANCTUARY', () => {
    test('migration 337 applied', () => {
        expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('337_ml_anomaly_sanctuary')).toBeTruthy();
    });
    test('ANOMALY_TAGS frozen 5', () => {
        expect(M.ANOMALY_TAGS).toEqual([
            'unexplained_but_stable', 'unexplained_and_volatile',
            'repeat_anomaly', 'anomaly_cluster',
            'anomaly_with_ontological_pressure'
        ]);
        expect(Object.isFrozen(M.ANOMALY_TAGS)).toBe(true);
    });
    test('MIN_EVIDENCE_FOR_EXPLANATION = 0.60', () => {
        expect(M.MIN_EVIDENCE_FOR_EXPLANATION).toBe(0.60);
    });
    test('computePreservationScore: ontological_pressure highest', () => {
        const ont = M.computePreservationScore({ anomalyTag: 'anomaly_with_ontological_pressure' });
        const vol = M.computePreservationScore({ anomalyTag: 'unexplained_and_volatile' });
        expect(ont.preservationScore).toBeGreaterThan(vol.preservationScore);
    });
    test('shouldForceExplain: low evidence → 0', () => {
        expect(M.shouldForceExplain({ currentEvidenceForExplanation: 0.30 }).forceExplainAllowed).toBe(0);
    });
    test('shouldForceExplain: high evidence → 1', () => {
        expect(M.shouldForceExplain({ currentEvidenceForExplanation: 0.85 }).forceExplainAllowed).toBe(1);
    });
    test('recordAnomaly persists and auto-classifies', () => {
        const r = M.recordAnomaly({
            userId: UID, resolvedEnv: ENV,
            anomalyId: 'a_1', phenomenonLabel: 'unexplained spike',
            anomalyTag: 'unexplained_but_stable',
            currentEvidenceForExplanation: 0.30,
            ts: _now()
        });
        expect(r.recorded).toBe(true);
        expect(r.forceExplainAllowed).toBe(0);
        expect(r.preservationScore).toBeCloseTo(0.65, 5);
    });
    test('duplicate anomalyId throws', () => {
        M.recordAnomaly({
            userId: UID, resolvedEnv: ENV, anomalyId: 'a_dup',
            phenomenonLabel: 'l', anomalyTag: 'repeat_anomaly',
            currentEvidenceForExplanation: 0.5, ts: _now()
        });
        expect(() => M.recordAnomaly({
            userId: UID, resolvedEnv: ENV, anomalyId: 'a_dup',
            phenomenonLabel: 'l', anomalyTag: 'repeat_anomaly',
            currentEvidenceForExplanation: 0.5, ts: _now()
        })).toThrow(/duplicate/);
    });
    test('getRecentAnomalies filter by tag', () => {
        M.recordAnomaly({
            userId: UID, resolvedEnv: ENV, anomalyId: 'a_r',
            phenomenonLabel: 'l', anomalyTag: 'repeat_anomaly',
            currentEvidenceForExplanation: 0.5, ts: _now()
        });
        M.recordAnomaly({
            userId: UID, resolvedEnv: ENV, anomalyId: 'a_c',
            phenomenonLabel: 'l', anomalyTag: 'anomaly_cluster',
            currentEvidenceForExplanation: 0.5, ts: _now()
        });
        const repeats = M.getRecentAnomalies({
            userId: UID, resolvedEnv: ENV, anomalyTag: 'repeat_anomaly'
        });
        expect(repeats.length).toBe(1);
    });
    test('uid isolation', () => {
        M.recordAnomaly({
            userId: UID, resolvedEnv: ENV, anomalyId: 'a_iso',
            phenomenonLabel: 'l', anomalyTag: 'repeat_anomaly',
            currentEvidenceForExplanation: 0.5, ts: _now()
        });
        expect(M.getRecentAnomalies({ userId: UID2, resolvedEnv: ENV })).toEqual([]);
    });
});
