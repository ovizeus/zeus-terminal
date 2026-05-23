/**
 * R5A Learning Core — driftDetection tests (canonical §21)
 *
 * "Piata se schimba. Modelul trebuie sa stie cand nu mai intelege piata."
 *
 * Tests cover pure math (KS test, PSI, level classifier) plus DB queries
 * comparing reference window vs current window for outcome/score/pnl drift.
 *
 * NOT TESTED HERE (deferred to other §):
 *   - Feature drift (needs per-decision feature snapshots, Wave 3+)
 *   - Relationship drift (covariance tracking, Wave 3+)
 *   - Auto-retrain trigger (retraining loop, Wave 5+)
 *   - Auto-suspend integration with R5B governance (Wave 4)
 *   - Alert channels (Operator Interaction, Wave 5)
 */

const { db } = require('../../../server/services/database')
const {
    recordAttribution
} = require('../../../server/services/ml/R5A_learning/attributionEngine')
const {
    ksTest,
    psi,
    psiLevel,
    getDrift,
    getRegimeDrift,
    DRIFT_LEVELS
} = require('../../../server/services/ml/R5A_learning/driftDetection')

describe('R5A — driftDetection (canonical §21)', () => {
    const TEST_USER_ID = 99950

    afterAll(() => {
        db.prepare(`DELETE FROM ml_attribution_events WHERE user_id = ?`).run(TEST_USER_ID)
    })

    // ── Pure math: ksTest ──────────────────────────────────────────
    describe('ksTest(sample1, sample2)', () => {
        test('returns {D, p_value} for two samples', () => {
            const a = [1, 2, 3, 4, 5]
            const b = [1, 2, 3, 4, 5]
            const r = ksTest(a, b)
            expect(r).toHaveProperty('D')
            expect(r).toHaveProperty('p_value')
            expect(typeof r.D).toBe('number')
            expect(typeof r.p_value).toBe('number')
        })

        test('identical samples → D = 0', () => {
            const a = [1, 2, 3, 4, 5]
            expect(ksTest(a, a).D).toBeCloseTo(0, 6)
        })

        test('completely shifted distributions → D close to 1', () => {
            const a = [1, 2, 3, 4, 5]
            const b = [100, 200, 300, 400, 500]
            expect(ksTest(a, b).D).toBeCloseTo(1, 1)
        })

        test('D bounded to [0, 1]', () => {
            const a = [1, 5, 3, 2, 4]
            const b = [2, 6, 4, 3, 5]
            const D = ksTest(a, b).D
            expect(D).toBeGreaterThanOrEqual(0)
            expect(D).toBeLessThanOrEqual(1)
        })

        test('p_value bounded to [0, 1]', () => {
            const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
            const b = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
            const p = ksTest(a, b).p_value
            expect(p).toBeGreaterThanOrEqual(0)
            expect(p).toBeLessThanOrEqual(1)
        })

        test('returns D=0 p_value=1 on empty samples (cannot compute)', () => {
            expect(ksTest([], [1, 2, 3])).toEqual({ D: 0, p_value: 1 })
            expect(ksTest([1, 2, 3], [])).toEqual({ D: 0, p_value: 1 })
        })

        test('throws on non-array input', () => {
            expect(() => ksTest(null, [1])).toThrow()
            expect(() => ksTest([1], 'bad')).toThrow()
        })
    })

    // ── Pure math: psi ─────────────────────────────────────────────
    describe('psi(reference, current, nBins)', () => {
        test('identical distributions → PSI ≈ 0', () => {
            const ref = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
            const cur = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
            expect(psi(ref, cur, 5)).toBeCloseTo(0, 4)
        })

        test('completely shifted → PSI > 0.25 (UNSTABLE)', () => {
            const ref = [1, 1, 1, 1, 1, 2, 2, 2, 2, 2]   // all in [1, 2]
            const cur = [9, 9, 9, 9, 9, 10, 10, 10, 10, 10]  // all in [9, 10]
            expect(psi(ref, cur, 5)).toBeGreaterThan(0.25)
        })

        test('returns 0 on empty current sample', () => {
            expect(psi([1, 2, 3], [], 5)).toBe(0)
        })

        test('returns 0 on empty reference sample', () => {
            expect(psi([], [1, 2, 3], 5)).toBe(0)
        })

        test('throws on non-array inputs', () => {
            expect(() => psi(null, [1], 5)).toThrow()
            expect(() => psi([1], null, 5)).toThrow()
        })

        test('throws on invalid nBins', () => {
            expect(() => psi([1, 2], [1, 2], 0)).toThrow()
            expect(() => psi([1, 2], [1, 2], 'bad')).toThrow()
        })
    })

    // ── psiLevel classifier ────────────────────────────────────────
    describe('psiLevel(psiValue)', () => {
        test('< 0.1 → STABLE', () => {
            expect(psiLevel(0.05)).toBe('STABLE')
            expect(psiLevel(0)).toBe('STABLE')
            expect(psiLevel(0.099)).toBe('STABLE')
        })
        test('0.1 ≤ psi < 0.25 → MODERATE', () => {
            expect(psiLevel(0.1)).toBe('MODERATE')
            expect(psiLevel(0.2)).toBe('MODERATE')
            expect(psiLevel(0.249)).toBe('MODERATE')
        })
        test('≥ 0.25 → UNSTABLE', () => {
            expect(psiLevel(0.25)).toBe('UNSTABLE')
            expect(psiLevel(1.0)).toBe('UNSTABLE')
        })
        test('handles negative or invalid → STABLE (defensive)', () => {
            expect(psiLevel(-0.1)).toBe('STABLE')
            expect(psiLevel(NaN)).toBe('STABLE')
        })
    })

    // ── DRIFT_LEVELS export ────────────────────────────────────────
    test('DRIFT_LEVELS exports 3 expected levels', () => {
        expect(DRIFT_LEVELS).toEqual(['STABLE', 'MODERATE', 'UNSTABLE'])
    })

    // ── DB-driven: getDrift ────────────────────────────────────────
    describe('getDrift — DB integration', () => {
        function seed({ regime, score, pnl_pct, count, attributedAt }) {
            const rows = []
            for (let i = 0; i < count; i++) {
                rows.push(recordAttribution({
                    userId: TEST_USER_ID,
                    resolvedEnv: 'DEMO',
                    trade: {
                        pos_id: `omega_w2_p21_${attributedAt}_${i}_${Math.random()}`,
                        symbol: 'BTCUSDT',
                        pnl_pct,
                        closed_by: pnl_pct > 0 ? 'tp' : 'sl',
                        score_at_entry: score
                    },
                    snapshot: { decision_digest: `omega_w2_p21_d_${Math.random()}`, regime }
                }))
            }
            // Override attributed_at to simulate temporal windows
            db.prepare(`UPDATE ml_attribution_events SET attributed_at = ? WHERE user_id = ? AND attributed_at > ? - 5000`)
                .run(attributedAt, TEST_USER_ID, attributedAt + 60_000)
            return rows
        }

        test('returns expected shape', () => {
            const refTs = Date.now() - 3 * 86_400_000
            const curTs = Date.now() - 86_400_000
            seed({ regime: 'trend', score: 0.7, pnl_pct: 1.0, count: 5, attributedAt: refTs })
            seed({ regime: 'trend', score: 0.7, pnl_pct: 1.0, count: 5, attributedAt: curTs })

            const r = getDrift({
                userId: TEST_USER_ID, resolvedEnv: 'DEMO',
                referenceWindow: { fromMs: refTs - 5_000, toMs: refTs + 5_000 },
                currentWindow: { fromMs: curTs - 5_000, toMs: curTs + 5_000 }
            })
            expect(r).toHaveProperty('sample_count')
            expect(r.sample_count).toHaveProperty('reference')
            expect(r.sample_count).toHaveProperty('current')
            expect(r).toHaveProperty('outcome_drift')
            expect(r).toHaveProperty('score_drift')
            expect(r).toHaveProperty('pnl_drift')
            expect(r).toHaveProperty('drift_score')
            expect(r).toHaveProperty('drift_level')
            expect(r).toHaveProperty('feature_drift')
            expect(r).toHaveProperty('relationship_drift')
            expect(r).toHaveProperty('retrain_recommended')
            expect(r).toHaveProperty('auto_suspend_triggered')
        })

        test('stubs are null (Wave 5+ work)', () => {
            const r = getDrift({
                userId: TEST_USER_ID, resolvedEnv: 'DEMO',
                referenceWindow: { fromMs: 0, toMs: Date.now() },
                currentWindow: { fromMs: 0, toMs: Date.now() }
            })
            expect(r.feature_drift).toBeNull()
            expect(r.relationship_drift).toBeNull()
            expect(r.retrain_recommended).toBeNull()
            expect(r.auto_suspend_triggered).toBeNull()
        })

        test('drift_score in [0, 1]', () => {
            const r = getDrift({
                userId: TEST_USER_ID, resolvedEnv: 'DEMO',
                referenceWindow: { fromMs: 0, toMs: Date.now() },
                currentWindow: { fromMs: 0, toMs: Date.now() }
            })
            expect(r.drift_score).toBeGreaterThanOrEqual(0)
            expect(r.drift_score).toBeLessThanOrEqual(1)
        })

        test('drift_level in DRIFT_LEVELS', () => {
            const r = getDrift({
                userId: TEST_USER_ID, resolvedEnv: 'DEMO',
                referenceWindow: { fromMs: 0, toMs: Date.now() },
                currentWindow: { fromMs: 0, toMs: Date.now() }
            })
            expect(DRIFT_LEVELS).toContain(r.drift_level)
        })

        test('zero stats when no data in either window', () => {
            const r = getDrift({
                userId: 999999850, resolvedEnv: 'DEMO',
                referenceWindow: { fromMs: 0, toMs: 1 },
                currentWindow: { fromMs: 0, toMs: 1 }
            })
            expect(r.sample_count.reference).toBe(0)
            expect(r.sample_count.current).toBe(0)
            expect(r.drift_score).toBe(0)
            expect(r.drift_level).toBe('STABLE')
        })

        test('requires both windows', () => {
            expect(() => getDrift({ userId: TEST_USER_ID, resolvedEnv: 'DEMO' })).toThrow()
        })
    })

    // ── getRegimeDrift ─────────────────────────────────────────────
    describe('getRegimeDrift', () => {
        test('returns shape filtered by regime', () => {
            const refTs = Date.now() - 5 * 86_400_000
            const curTs = Date.now() - 86_400_000
            // Seed range regime
            recordAttribution({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                trade: { pos_id: `rd_${Date.now()}`, symbol: 'BTCUSDT', pnl_pct: 1.0, closed_by: 'tp', score_at_entry: 0.7 },
                snapshot: { decision_digest: `rd_d_${Date.now()}`, regime: 'range' }
            })

            const r = getRegimeDrift({
                userId: TEST_USER_ID, resolvedEnv: 'DEMO', regime: 'range',
                referenceWindow: { fromMs: 0, toMs: Date.now() },
                currentWindow: { fromMs: 0, toMs: Date.now() }
            })
            expect(r).toHaveProperty('drift_score')
        })

        test('requires regime parameter', () => {
            expect(() => getRegimeDrift({
                userId: TEST_USER_ID, resolvedEnv: 'DEMO',
                referenceWindow: { fromMs: 0, toMs: 1 },
                currentWindow: { fromMs: 0, toMs: 1 }
            })).toThrow()
        })
    })
})
