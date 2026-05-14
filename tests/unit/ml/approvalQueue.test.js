/**
 * Cross-cutting Operator Interaction — approvalQueue stub tests
 *
 * Verifies approval queue facade over ml_operator_approval. Powers tiered
 * authority (spec 252*): MAJOR/CRITICAL changes queue up for operator,
 * MINOR auto-applied per ML_BANDIT_AUTO_APPLY_MINOR flag.
 */

const { db } = require('../../../server/services/database');
const {
    enqueue,
    getPending,
    decide,
    getById,
    TIERS,
    REQUEST_TYPES
} = require('../../../server/services/ml/_operator/approvalQueue');

describe('Cross-cutting Operator Interaction — approvalQueue', () => {
    const TEST_USER_ID = 99003;

    afterAll(() => {
        db.prepare(`DELETE FROM ml_operator_approval WHERE user_id = ?`).run(TEST_USER_ID);
    });

    test('TIERS exposes MINOR/MAJOR/CRITICAL', () => {
        expect(TIERS).toEqual(expect.arrayContaining(['MINOR', 'MAJOR', 'CRITICAL']));
    });

    test('REQUEST_TYPES exposes core enum values', () => {
        expect(REQUEST_TYPES).toEqual(
            expect.arrayContaining(['PROMOTION', 'DEMOTION', 'QUARANTINE', 'RESUME', 'CHARTER_CHANGE', 'EMERGENCY_HALT'])
        );
    });

    describe('enqueue', () => {
        test('inserts pending row and returns id', () => {
            const result = enqueue({
                userId: TEST_USER_ID,
                requestType: 'PROMOTION',
                payload: { featureId: 'test_feat_x' },
                tier: 'MAJOR'
            });
            expect(typeof result.id).toBe('number');
            expect(result.id).toBeGreaterThan(0);
        });

        test('CRITICAL tier auto-sets cooldown_until to ~24h ahead', () => {
            const before = Date.now();
            const result = enqueue({
                userId: TEST_USER_ID,
                requestType: 'CHARTER_CHANGE',
                payload: { newValue: 1 },
                tier: 'CRITICAL'
            });
            const row = getById(result.id);
            expect(row.cooldown_until).toBeGreaterThan(before + 23 * 3600 * 1000);
            expect(row.cooldown_until).toBeLessThan(before + 25 * 3600 * 1000);
        });

        test('MINOR/MAJOR have no cooldown by default', () => {
            const major = enqueue({
                userId: TEST_USER_ID,
                requestType: 'QUARANTINE',
                payload: {},
                tier: 'MAJOR'
            });
            const row = getById(major.id);
            expect(row.cooldown_until).toBeNull();
        });

        test('rejects invalid tier', () => {
            expect(() => enqueue({
                userId: TEST_USER_ID,
                requestType: 'PROMOTION',
                payload: {},
                tier: 'HUGE'
            })).toThrow(/CHECK constraint/);
        });
    });

    describe('getPending', () => {
        test('returns array of pending rows for user', () => {
            enqueue({
                userId: TEST_USER_ID,
                requestType: 'RESUME',
                payload: { reason: 'manual' },
                tier: 'MAJOR'
            });
            const pending = getPending({ userId: TEST_USER_ID });
            expect(Array.isArray(pending)).toBe(true);
            expect(pending.length).toBeGreaterThan(0);
            for (const row of pending) {
                expect(row.queue_state).toBe('PENDING');
            }
        });

        test('filters by tier', () => {
            const filtered = getPending({ userId: TEST_USER_ID, tier: 'CRITICAL' });
            for (const row of filtered) {
                expect(row.tier).toBe('CRITICAL');
            }
        });
    });

    describe('decide', () => {
        test('updates row to APPROVED state', () => {
            const enq = enqueue({
                userId: TEST_USER_ID,
                requestType: 'PROMOTION',
                payload: {},
                tier: 'MAJOR'
            });
            decide({ id: enq.id, decision: 'APPROVED', decidedBy: 'operator_test', signature: 'sig_xyz' });
            const row = getById(enq.id);
            expect(row.queue_state).toBe('APPROVED');
            expect(row.decided_by).toBe('operator_test');
        });

        test('throws on invalid decision value', () => {
            const enq = enqueue({
                userId: TEST_USER_ID,
                requestType: 'PROMOTION',
                payload: {},
                tier: 'MAJOR'
            });
            expect(() => decide({ id: enq.id, decision: 'MAYBE', decidedBy: 'op' })).toThrow(/decision/i);
        });
    });
});
