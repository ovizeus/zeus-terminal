'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-oj-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const oj = require('../../../server/services/ml/_doctor/overrideJournal');

const _now = () => Date.now();
const _daysAgo = (d) => _now() - d * 86400_000;

function clean() {
    db.prepare("DELETE FROM ml_doctor_override_journal").run();
}

describe('D-5.4 overrideJournal', () => {
    beforeEach(clean);

    describe('Constants', () => {
        test('OUTCOME_VERDICTS frozen 4', () => {
            expect(oj.OUTCOME_VERDICTS).toEqual([
                'doctor_was_right', 'operator_was_right', 'inconclusive', 'partial'
            ]);
        });
    });

    describe('recordOverride', () => {
        test('inserts override row', () => {
            const r = oj.recordOverride({
                moduleId: 'm1', doctorRecommendedAction: 'quarantine',
                operatorForcedAction: 'allow_continue',
                operatorReason: 'edge case false positive',
                operatorId: 1, ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.id).toBeGreaterThan(0);
        });

        test('outcome_verdict starts NULL', () => {
            oj.recordOverride({
                moduleId: 'mNull', doctorRecommendedAction: 'q',
                operatorForcedAction: 'a', operatorReason: 'r',
                operatorId: 1, ts: _now()
            });
            const row = db.prepare("SELECT outcome_verdict FROM ml_doctor_override_journal WHERE module_id = ?").get('mNull');
            expect(row.outcome_verdict).toBeNull();
        });

        test('rejects missing required field', () => {
            expect(() => oj.recordOverride({
                doctorRecommendedAction: 'q', operatorForcedAction: 'a',
                operatorReason: 'r', operatorId: 1, ts: _now()
            })).toThrow(/moduleId/);
        });
    });

    describe('setOutcomeVerdict', () => {
        test('updates outcome on existing override', () => {
            const { id } = oj.recordOverride({
                moduleId: 'mOut', doctorRecommendedAction: 'q',
                operatorForcedAction: 'a', operatorReason: 'r',
                operatorId: 1, ts: _now()
            });
            oj.setOutcomeVerdict({ id, outcomeVerdict: 'doctor_was_right' });
            const row = db.prepare("SELECT outcome_verdict FROM ml_doctor_override_journal WHERE id = ?").get(id);
            expect(row.outcome_verdict).toBe('doctor_was_right');
        });

        test('rejects invalid verdict', () => {
            const { id } = oj.recordOverride({
                moduleId: 'mInv', doctorRecommendedAction: 'q',
                operatorForcedAction: 'a', operatorReason: 'r',
                operatorId: 1, ts: _now()
            });
            expect(() => oj.setOutcomeVerdict({
                id, outcomeVerdict: 'maybe'
            })).toThrow(/invalid/);
        });

        test('rejects unknown id', () => {
            expect(() => oj.setOutcomeVerdict({
                id: 99999, outcomeVerdict: 'doctor_was_right'
            })).toThrow(/not found/);
        });
    });

    describe('computeOverrideAccuracy per operator', () => {
        test('100% doctor_was_right → operator accuracy 0', () => {
            const now = _now();
            for (let i = 0; i < 5; i++) {
                const { id } = oj.recordOverride({
                    moduleId: `m_acc_${i}`, doctorRecommendedAction: 'q',
                    operatorForcedAction: 'a', operatorReason: 'r',
                    operatorId: 1, ts: now
                });
                oj.setOutcomeVerdict({ id, outcomeVerdict: 'doctor_was_right' });
            }
            const r = oj.computeOverrideAccuracy({ operatorId: 1, nowTs: now });
            expect(r.operatorAccuracy).toBe(0);
        });

        test('100% operator_was_right → operator accuracy 1', () => {
            const now = _now();
            for (let i = 0; i < 5; i++) {
                const { id } = oj.recordOverride({
                    moduleId: `m_ok_${i}`, doctorRecommendedAction: 'q',
                    operatorForcedAction: 'a', operatorReason: 'r',
                    operatorId: 2, ts: now
                });
                oj.setOutcomeVerdict({ id, outcomeVerdict: 'operator_was_right' });
            }
            const r = oj.computeOverrideAccuracy({ operatorId: 2, nowTs: now });
            expect(r.operatorAccuracy).toBe(1);
        });

        test('partial counts as 0.5', () => {
            const now = _now();
            const { id: id1 } = oj.recordOverride({
                moduleId: 'mp1', doctorRecommendedAction: 'q',
                operatorForcedAction: 'a', operatorReason: 'r',
                operatorId: 3, ts: now
            });
            const { id: id2 } = oj.recordOverride({
                moduleId: 'mp2', doctorRecommendedAction: 'q',
                operatorForcedAction: 'a', operatorReason: 'r',
                operatorId: 3, ts: now
            });
            oj.setOutcomeVerdict({ id: id1, outcomeVerdict: 'operator_was_right' });
            oj.setOutcomeVerdict({ id: id2, outcomeVerdict: 'partial' });
            const r = oj.computeOverrideAccuracy({ operatorId: 3, nowTs: now });
            expect(r.operatorAccuracy).toBe(0.75);  // (1 + 0.5) / 2
        });

        test('inconclusive excluded from accuracy calc', () => {
            const now = _now();
            const { id: id1 } = oj.recordOverride({
                moduleId: 'mc1', doctorRecommendedAction: 'q',
                operatorForcedAction: 'a', operatorReason: 'r',
                operatorId: 4, ts: now
            });
            const { id: id2 } = oj.recordOverride({
                moduleId: 'mc2', doctorRecommendedAction: 'q',
                operatorForcedAction: 'a', operatorReason: 'r',
                operatorId: 4, ts: now
            });
            oj.setOutcomeVerdict({ id: id1, outcomeVerdict: 'doctor_was_right' });
            oj.setOutcomeVerdict({ id: id2, outcomeVerdict: 'inconclusive' });
            const r = oj.computeOverrideAccuracy({ operatorId: 4, nowTs: now });
            expect(r.operatorAccuracy).toBe(0);  // 1 doctor_right, inconclusive excluded
            expect(r.totalVerdicted).toBe(1);
        });

        test('null when no verdicted overrides', () => {
            oj.recordOverride({
                moduleId: 'mE', doctorRecommendedAction: 'q',
                operatorForcedAction: 'a', operatorReason: 'r',
                operatorId: 5, ts: _now()
            });
            const r = oj.computeOverrideAccuracy({ operatorId: 5, nowTs: _now() });
            expect(r.operatorAccuracy).toBeNull();
        });

        test('only events within 90d window count', () => {
            const now = _now();
            // 5 doctor_was_right >90d ago
            for (let i = 0; i < 5; i++) {
                const { id } = oj.recordOverride({
                    moduleId: `mold_${i}`, doctorRecommendedAction: 'q',
                    operatorForcedAction: 'a', operatorReason: 'r',
                    operatorId: 6, ts: _daysAgo(91)
                });
                oj.setOutcomeVerdict({ id, outcomeVerdict: 'doctor_was_right' });
            }
            // 1 operator_was_right recent
            const { id } = oj.recordOverride({
                moduleId: 'mnew', doctorRecommendedAction: 'q',
                operatorForcedAction: 'a', operatorReason: 'r',
                operatorId: 6, ts: now
            });
            oj.setOutcomeVerdict({ id, outcomeVerdict: 'operator_was_right' });
            const r = oj.computeOverrideAccuracy({ operatorId: 6, nowTs: now });
            expect(r.operatorAccuracy).toBe(1);  // only recent counts
            expect(r.totalVerdicted).toBe(1);
        });
    });

    describe('listRecentOverrides', () => {
        test('returns most recent first', () => {
            const now = _now();
            oj.recordOverride({
                moduleId: 'list1', doctorRecommendedAction: 'q1',
                operatorForcedAction: 'a', operatorReason: 'r',
                operatorId: 1, ts: now
            });
            oj.recordOverride({
                moduleId: 'list2', doctorRecommendedAction: 'q2',
                operatorForcedAction: 'a', operatorReason: 'r',
                operatorId: 1, ts: now + 1000
            });
            const list = oj.listRecentOverrides({ limit: 10 });
            expect(list.length).toBe(2);
            expect(list[0].moduleId).toBe('list2'); // newest first
        });

        test('respects limit', () => {
            for (let i = 0; i < 10; i++) {
                oj.recordOverride({
                    moduleId: `lim_${i}`, doctorRecommendedAction: 'q',
                    operatorForcedAction: 'a', operatorReason: 'r',
                    operatorId: 1, ts: _now() + i
                });
            }
            const list = oj.listRecentOverrides({ limit: 3 });
            expect(list.length).toBe(3);
        });
    });
});
