/**
 * Cross-cutting Audit Trail — stub tests
 *
 * Verifies the audit trail facade over ml_decision_snapshots + ml_decision_light.
 * Foundation for spec invariant #6 (replay determinism) — every decision must
 * be loggable and retrievable by digest.
 */

const { db } = require('../../../server/services/database');
const {
    logDecision,
    logLight,
    getByDigest,
    getRecent
} = require('../../../server/services/ml/_audit/auditTrail');

describe('Cross-cutting Audit Trail', () => {
    const TEST_USER_ID = 99001;
    const TEST_DIGEST_PREFIX = `omega_audit_${Date.now()}_`;

    afterAll(() => {
        // Clean up test rows
        db.prepare(`DELETE FROM ml_decision_snapshots WHERE user_id = ? AND decision_digest LIKE ?`)
            .run(TEST_USER_ID, `${TEST_DIGEST_PREFIX}%`);
        db.prepare(`DELETE FROM ml_decision_light WHERE user_id = ? AND decision_digest LIKE ?`)
            .run(TEST_USER_ID, `${TEST_DIGEST_PREFIX}%`);
    });

    describe('logDecision', () => {
        test('inserts row into ml_decision_snapshots and returns inserted id', () => {
            const digest = `${TEST_DIGEST_PREFIX}d1`;
            const result = logDecision({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                symbol: 'BTCUSDT',
                snapshotEventType: 'TRADE',
                snapshotJson: JSON.stringify({ score: 0.75 }),
                decisionDigest: digest,
                registryDigest: 'reg_v1'
            });
            expect(typeof result.id).toBe('number');
            expect(result.id).toBeGreaterThan(0);
        });

        test('rejects invalid resolvedEnv via CHECK constraint', () => {
            expect(() => logDecision({
                userId: TEST_USER_ID,
                resolvedEnv: 'BADENV',
                symbol: 'BTC',
                snapshotEventType: 'TRADE',
                snapshotJson: '{}',
                decisionDigest: `${TEST_DIGEST_PREFIX}bad1`,
                registryDigest: 'r'
            })).toThrow(/CHECK constraint/);
        });

        test('rejects missing required fields', () => {
            expect(() => logDecision({})).toThrow();
        });
    });

    describe('logLight', () => {
        test('inserts row into ml_decision_light', () => {
            const digest = `${TEST_DIGEST_PREFIX}light1`;
            const result = logLight({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                symbol: 'BTCUSDT',
                decisionDigest: digest,
                score: 0.42,
                top5FeaturesJson: JSON.stringify(['a', 'b', 'c']),
                abstainCount: 1,
                reasonCode: 'LOW_CONFIDENCE'
            });
            expect(typeof result.id).toBe('number');
            expect(result.id).toBeGreaterThan(0);
        });
    });

    describe('getByDigest', () => {
        test('retrieves snapshot by digest', () => {
            const digest = `${TEST_DIGEST_PREFIX}get1`;
            logDecision({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                symbol: 'ETHUSDT',
                snapshotEventType: 'ABSTAIN_CRITIC',
                snapshotJson: JSON.stringify({ score: 0 }),
                decisionDigest: digest,
                registryDigest: 'reg_v2'
            });
            const found = getByDigest(digest);
            expect(found).toBeDefined();
            expect(found.decision_digest).toBe(digest);
            expect(found.snapshot_event_type).toBe('ABSTAIN_CRITIC');
        });

        test('returns null for missing digest', () => {
            expect(getByDigest('nonexistent_omega_audit_digest_xyz')).toBeNull();
        });
    });

    describe('getRecent', () => {
        test('returns recent decisions for user/env', () => {
            const digest = `${TEST_DIGEST_PREFIX}recent1`;
            logLight({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                symbol: 'BTCUSDT',
                decisionDigest: digest,
                score: 0.5,
                top5FeaturesJson: '[]',
                abstainCount: 0,
                reasonCode: 'OK'
            });
            const recent = getRecent({ userId: TEST_USER_ID, resolvedEnv: 'DEMO', sinceMs: Date.now() - 60_000 });
            expect(Array.isArray(recent)).toBe(true);
            expect(recent.length).toBeGreaterThan(0);
        });

        test('returns empty array when no rows match', () => {
            const recent = getRecent({ userId: 999_999_999, resolvedEnv: 'DEMO', sinceMs: 0 });
            expect(recent).toEqual([]);
        });
    });
});
