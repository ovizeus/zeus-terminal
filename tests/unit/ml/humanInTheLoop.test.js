/**
 * Operator Interaction — humanInTheLoop tests (canonical §34)
 *
 * §34 HUMAN-IN-THE-LOOP SI CONTROALE UMANE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1340-1354.
 *
 * Adds TRIGGER detection for things requiring human review +
 * emergency kill switch state. Composes approvalQueue (Wave 1D)
 * for the actual review workflow.
 */

const { db } = require('../../../server/services/database')
const approvalQueue = require('../../../server/services/ml/_operator/approvalQueue')
const {
    OVERRIDE_KINDS,
    KILL_SWITCH_STATES,
    CONFIDENCE_AMBIGUITY,
    DEFAULT_THRESHOLDS,
    detectAmbiguousConfidence,
    detectIntermediateThreshold,
    detectUnusualExposure,
    detectOperationalConflict,
    submitForReview,
    recordManualOverride,
    setEmergencyKillSwitch,
    getEmergencyKillSwitchState,
    isKillSwitchActive
} = require('../../../server/services/ml/_operator/humanInTheLoop')

describe('Operator — humanInTheLoop (canonical §34)', () => {
    const TEST_USER_BASE = 99550

    afterAll(() => {
        db.prepare(`DELETE FROM ml_human_overrides WHERE user_id BETWEEN ? AND ?`)
            .run(TEST_USER_BASE, TEST_USER_BASE + 100)
        db.prepare(`DELETE FROM ml_operator_approval WHERE user_id BETWEEN ? AND ?`)
            .run(TEST_USER_BASE, TEST_USER_BASE + 100)
    })

    // ── Migration 054 ──────────────────────────────────────────────
    describe('Migration 054 — ml_human_overrides', () => {
        test('table exists', () => {
            const row = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='ml_human_overrides'"
            ).get()
            expect(row).toBeDefined()
        })

        test('has expected columns', () => {
            const cols = db.prepare("PRAGMA table_info(ml_human_overrides)").all()
            const names = cols.map(c => c.name)
            expect(names).toEqual(expect.arrayContaining([
                'id', 'record_type', 'user_id', 'resolved_env',
                'override_kind', 'state', 'payload_json',
                'reason', 'actor', 'created_at', 'cleared_at'
            ]))
        })

        test('record_type CHECK constraint', () => {
            expect(() => db.prepare(`INSERT INTO ml_human_overrides
                (record_type, user_id, resolved_env, state, payload_json,
                 reason, actor, created_at)
                VALUES ('INVALID', 1, 'DEMO', 'ACTIVE', '{}', 'r', 'a', 0)
            `).run()).toThrow(/CHECK constraint/)
        })

        test('state CHECK constraint', () => {
            expect(() => db.prepare(`INSERT INTO ml_human_overrides
                (record_type, user_id, resolved_env, state, payload_json,
                 reason, actor, created_at)
                VALUES ('OVERRIDE', 1, 'DEMO', 'BANANA', '{}', 'r', 'a', 0)
            `).run()).toThrow(/CHECK constraint/)
        })
    })

    // ── Exported constants ─────────────────────────────────────────
    describe('Exported constants', () => {
        test('OVERRIDE_KINDS = 4 kinds', () => {
            expect(OVERRIDE_KINDS).toEqual([
                'AMBIGUOUS_CONFIDENCE', 'INTERMEDIATE_THRESHOLD',
                'UNUSUAL_EXPOSURE', 'OPERATIONAL_CONFLICT'
            ])
        })
        test('KILL_SWITCH_STATES', () => {
            expect(KILL_SWITCH_STATES).toEqual(['ON', 'OFF'])
        })
        test('CONFIDENCE_AMBIGUITY band [0.45, 0.55]', () => {
            expect(CONFIDENCE_AMBIGUITY.lo).toBe(0.45)
            expect(CONFIDENCE_AMBIGUITY.hi).toBe(0.55)
        })
        test('DEFAULT_THRESHOLDS', () => {
            expect(DEFAULT_THRESHOLDS).toHaveProperty('intermediate_min')
            expect(DEFAULT_THRESHOLDS).toHaveProperty('intermediate_max')
            expect(DEFAULT_THRESHOLDS).toHaveProperty('unusual_exposure_pct')
        })
    })

    // ── detectAmbiguousConfidence ──────────────────────────────────
    describe('detectAmbiguousConfidence', () => {
        test('returns true when score in [0.45, 0.55]', () => {
            expect(detectAmbiguousConfidence({ score: 0.5 })).toBe(true)
            expect(detectAmbiguousConfidence({ score: 0.45 })).toBe(true)
            expect(detectAmbiguousConfidence({ score: 0.55 })).toBe(true)
        })
        test('returns false outside ambiguity band', () => {
            expect(detectAmbiguousConfidence({ score: 0.3 })).toBe(false)
            expect(detectAmbiguousConfidence({ score: 0.7 })).toBe(false)
        })
        test('returns false on invalid score', () => {
            expect(detectAmbiguousConfidence({ score: null })).toBe(false)
            expect(detectAmbiguousConfidence({ score: 'bad' })).toBe(false)
        })
    })

    // ── detectIntermediateThreshold ────────────────────────────────
    describe('detectIntermediateThreshold', () => {
        test('returns true when score in [0.5, 0.65)', () => {
            expect(detectIntermediateThreshold({ score: 0.55 })).toBe(true)
            expect(detectIntermediateThreshold({ score: 0.5 })).toBe(true)
        })
        test('returns false outside band', () => {
            expect(detectIntermediateThreshold({ score: 0.4 })).toBe(false)
            expect(detectIntermediateThreshold({ score: 0.8 })).toBe(false)
        })
    })

    // ── detectUnusualExposure ──────────────────────────────────────
    describe('detectUnusualExposure', () => {
        test('returns true when candidate alone > unusual_exposure_pct', () => {
            const result = detectUnusualExposure({
                currentPositions: [],
                candidate: { symbol: 'BTC', side: 'long', sizeUsd: 400, score: 0.7 },
                balance: 10000
            })
            // 400/10000 = 4% > 3% threshold
            expect(result).toBe(true)
        })
        test('returns false when within limits', () => {
            const result = detectUnusualExposure({
                currentPositions: [],
                candidate: { symbol: 'BTC', side: 'long', sizeUsd: 100, score: 0.7 },
                balance: 10000
            })
            expect(result).toBe(false)
        })
        test('returns false on invalid input', () => {
            expect(detectUnusualExposure({})).toBe(false)
        })
    })

    // ── detectOperationalConflict ──────────────────────────────────
    describe('detectOperationalConflict', () => {
        test('returns true when 2+ critical signals', () => {
            expect(detectOperationalConflict({
                signals: { drift_unstable: true, exchange_degraded: true, balance_mismatch: false }
            })).toBe(true)
        })
        test('returns false with 0-1 critical signals', () => {
            expect(detectOperationalConflict({
                signals: { drift_unstable: true, exchange_degraded: false }
            })).toBe(false)
        })
        test('returns false on empty signals', () => {
            expect(detectOperationalConflict({ signals: {} })).toBe(false)
        })
    })

    // ── submitForReview ────────────────────────────────────────────
    describe('submitForReview', () => {
        test('inserts override row + enqueues approval', () => {
            const uid = TEST_USER_BASE + 1
            const result = submitForReview({
                userId: uid, resolvedEnv: 'DEMO',
                kind: 'AMBIGUOUS_CONFIDENCE',
                payload: { score: 0.5, symbol: 'BTC' },
                reason: 'score in ambiguity band',
                actor: 'test'
            })
            expect(typeof result.reviewId).toBe('number')
            expect(typeof result.approvalId).toBe('number')

            const overrideRow = db.prepare(`SELECT * FROM ml_human_overrides WHERE id = ?`).get(result.reviewId)
            expect(overrideRow.record_type).toBe('REVIEW_REQUEST')
            expect(overrideRow.override_kind).toBe('AMBIGUOUS_CONFIDENCE')

            const approvalRow = approvalQueue.getById(result.approvalId)
            expect(approvalRow.queue_state).toBe('PENDING')
        })

        test('throws on invalid kind', () => {
            expect(() => submitForReview({
                userId: TEST_USER_BASE + 2,
                resolvedEnv: 'DEMO',
                kind: 'INVALID_KIND',
                payload: {},
                reason: 'r',
                actor: 't'
            })).toThrow(/kind/i)
        })
    })

    // ── recordManualOverride ───────────────────────────────────────
    describe('recordManualOverride', () => {
        test('inserts OVERRIDE row (no approval queue)', () => {
            const uid = TEST_USER_BASE + 3
            const result = recordManualOverride({
                userId: uid, resolvedEnv: 'DEMO',
                kind: 'OPERATIONAL_CONFLICT',
                payload: { override_id: 'op_x_y' },
                reason: 'operator override on auto-decision',
                actor: 'operator_manual'
            })
            expect(typeof result.overrideId).toBe('number')
            const row = db.prepare(`SELECT * FROM ml_human_overrides WHERE id = ?`).get(result.overrideId)
            expect(row.record_type).toBe('OVERRIDE')
        })
    })

    // ── setEmergencyKillSwitch ─────────────────────────────────────
    describe('setEmergencyKillSwitch', () => {
        test('sets state=ON inserts KILL_SWITCH row ACTIVE', () => {
            const uid = TEST_USER_BASE + 4
            setEmergencyKillSwitch({
                userId: uid, resolvedEnv: 'DEMO',
                state: 'ON',
                reason: 'manual emergency',
                actor: 'operator'
            })
            expect(isKillSwitchActive({ userId: uid, resolvedEnv: 'DEMO' })).toBe(true)
        })

        test('sets state=OFF clears active kill switch', () => {
            const uid = TEST_USER_BASE + 5
            setEmergencyKillSwitch({
                userId: uid, resolvedEnv: 'DEMO',
                state: 'ON',
                reason: 'first',
                actor: 'operator'
            })
            setEmergencyKillSwitch({
                userId: uid, resolvedEnv: 'DEMO',
                state: 'OFF',
                reason: 'second / clear',
                actor: 'operator'
            })
            expect(isKillSwitchActive({ userId: uid, resolvedEnv: 'DEMO' })).toBe(false)
        })

        test('rejects invalid state', () => {
            expect(() => setEmergencyKillSwitch({
                userId: TEST_USER_BASE + 6,
                resolvedEnv: 'DEMO',
                state: 'PARTIAL',
                reason: 'r', actor: 'op'
            })).toThrow(/state/i)
        })
    })

    // ── getEmergencyKillSwitchState ────────────────────────────────
    describe('getEmergencyKillSwitchState', () => {
        test('returns {state: ON, reason} when active', () => {
            const uid = TEST_USER_BASE + 7
            setEmergencyKillSwitch({
                userId: uid, resolvedEnv: 'DEMO',
                state: 'ON',
                reason: 'flash crash detected',
                actor: 'auto'
            })
            const state = getEmergencyKillSwitchState({ userId: uid, resolvedEnv: 'DEMO' })
            expect(state.state).toBe('ON')
            expect(state.reason).toBe('flash crash detected')
        })

        test('returns {state: OFF, reason: null} when never set', () => {
            const state = getEmergencyKillSwitchState({ userId: TEST_USER_BASE + 99, resolvedEnv: 'DEMO' })
            expect(state.state).toBe('OFF')
        })
    })

    // ── isKillSwitchActive ─────────────────────────────────────────
    describe('isKillSwitchActive', () => {
        test('returns true after ON, false after OFF', () => {
            const uid = TEST_USER_BASE + 8
            expect(isKillSwitchActive({ userId: uid, resolvedEnv: 'TESTNET' })).toBe(false)
            setEmergencyKillSwitch({
                userId: uid, resolvedEnv: 'TESTNET',
                state: 'ON', reason: 'test', actor: 'op'
            })
            expect(isKillSwitchActive({ userId: uid, resolvedEnv: 'TESTNET' })).toBe(true)
            setEmergencyKillSwitch({
                userId: uid, resolvedEnv: 'TESTNET',
                state: 'OFF', reason: 'clear', actor: 'op'
            })
            expect(isKillSwitchActive({ userId: uid, resolvedEnv: 'TESTNET' })).toBe(false)
        })

        test('isolates between envs', () => {
            const uid = TEST_USER_BASE + 9
            setEmergencyKillSwitch({
                userId: uid, resolvedEnv: 'DEMO',
                state: 'ON', reason: 'demo only', actor: 'op'
            })
            expect(isKillSwitchActive({ userId: uid, resolvedEnv: 'DEMO' })).toBe(true)
            expect(isKillSwitchActive({ userId: uid, resolvedEnv: 'REAL' })).toBe(false)
        })
    })
})
