/**
 * R5A Learning Core — calibration tests (canonical §20)
 *
 * Probabilistic calibration measurement: Brier score + reliability diagram
 * + Expected Calibration Error + calibration_quality (which fills the §17
 * stub) + Wilson confidence interval.
 *
 * Pure-math primitives are deterministic; DB queries seed via recordAttribution.
 *
 * NOT TESTED HERE (other §):
 *   - Platt scaling / isotonic regression remap → Wave 5+ retraining loop
 *   - Aleatoric / epistemic uncertainty → Wave 5+ ensemble-based
 */

const { db } = require('../../../server/services/database')
const {
    recordAttribution
} = require('../../../server/services/ml/R5A_learning/attributionEngine')
const {
    brierScore,
    reliabilityDiagram,
    expectedCalibrationError,
    calibrationQuality,
    wilsonInterval,
    getCalibration,
    getRegimeCalibration
} = require('../../../server/services/ml/R5A_learning/calibration')

describe('R5A — calibration (canonical §20)', () => {
    const TEST_USER_ID = 99900

    afterAll(() => {
        db.prepare(`DELETE FROM ml_attribution_events WHERE user_id = ?`).run(TEST_USER_ID)
    })

    // ── Pure math: brierScore ─────────────────────────────────────
    describe('brierScore', () => {
        test('perfect prediction (pred=1 actual=1) → 0', () => {
            expect(brierScore([{ score: 1.0, actual_win: 1 }])).toBeCloseTo(0, 6)
            expect(brierScore([{ score: 0.0, actual_win: 0 }])).toBeCloseTo(0, 6)
        })

        test('worst prediction (pred=1 actual=0) → 1', () => {
            expect(brierScore([{ score: 1.0, actual_win: 0 }])).toBeCloseTo(1, 6)
            expect(brierScore([{ score: 0.0, actual_win: 1 }])).toBeCloseTo(1, 6)
        })

        test('average of multiple predictions', () => {
            // pred=0.8 actual=1 → (0.8-1)^2 = 0.04
            // pred=0.3 actual=0 → (0.3-0)^2 = 0.09
            // mean = (0.04 + 0.09) / 2 = 0.065
            expect(brierScore([
                { score: 0.8, actual_win: 1 },
                { score: 0.3, actual_win: 0 }
            ])).toBeCloseTo(0.065, 4)
        })

        test('returns 0 on empty array', () => {
            expect(brierScore([])).toBe(0)
        })

        test('throws on non-array input', () => {
            expect(() => brierScore(null)).toThrow()
            expect(() => brierScore('not an array')).toThrow()
        })
    })

    // ── reliabilityDiagram ────────────────────────────────────────
    describe('reliabilityDiagram', () => {
        test('returns N bins with min/max/mean_pred/mean_actual/count', () => {
            const preds = [
                { score: 0.05, actual_win: 0 },
                { score: 0.55, actual_win: 1 },
                { score: 0.85, actual_win: 1 },
                { score: 0.95, actual_win: 1 }
            ]
            const bins = reliabilityDiagram(preds, 10)
            expect(bins.length).toBe(10)
            for (const b of bins) {
                expect(b).toHaveProperty('bin_min')
                expect(b).toHaveProperty('bin_max')
                expect(b).toHaveProperty('mean_pred')
                expect(b).toHaveProperty('mean_actual')
                expect(b).toHaveProperty('count')
            }
        })

        test('correctly bins predictions to [0, 0.1), [0.1, 0.2), ... [0.9, 1.0]', () => {
            const preds = [
                { score: 0.05, actual_win: 0 },     // bin 0
                { score: 0.55, actual_win: 1 },     // bin 5
                { score: 0.95, actual_win: 1 }      // bin 9
            ]
            const bins = reliabilityDiagram(preds, 10)
            expect(bins[0].count).toBe(1)
            expect(bins[5].count).toBe(1)
            expect(bins[9].count).toBe(1)
            // Empty bins
            expect(bins[1].count).toBe(0)
            expect(bins[3].count).toBe(0)
        })

        test('mean_pred and mean_actual computed correctly per bin', () => {
            const preds = [
                { score: 0.83, actual_win: 1 },
                { score: 0.87, actual_win: 1 }
            ]
            const bins = reliabilityDiagram(preds, 10)
            // bin 8 = [0.8, 0.9)
            expect(bins[8].count).toBe(2)
            expect(bins[8].mean_pred).toBeCloseTo(0.85, 3)
            expect(bins[8].mean_actual).toBeCloseTo(1.0, 3)
        })

        test('empty bins have null mean_pred and mean_actual', () => {
            const preds = [{ score: 0.5, actual_win: 1 }]
            const bins = reliabilityDiagram(preds, 10)
            expect(bins[0].count).toBe(0)
            expect(bins[0].mean_pred).toBeNull()
            expect(bins[0].mean_actual).toBeNull()
        })

        test('returns empty bins array if no predictions', () => {
            const bins = reliabilityDiagram([], 10)
            expect(bins.length).toBe(10)
            for (const b of bins) expect(b.count).toBe(0)
        })
    })

    // ── expectedCalibrationError ─────────────────────────────────
    describe('expectedCalibrationError (ECE)', () => {
        test('returns 0 for perfectly calibrated bins', () => {
            const bins = [
                { count: 100, mean_pred: 0.1, mean_actual: 0.1 },
                { count: 100, mean_pred: 0.5, mean_actual: 0.5 },
                { count: 100, mean_pred: 0.9, mean_actual: 0.9 }
            ]
            expect(expectedCalibrationError(bins)).toBeCloseTo(0, 6)
        })

        test('returns positive value for miscalibration', () => {
            const bins = [
                { count: 100, mean_pred: 0.8, mean_actual: 0.5 }
            ]
            expect(expectedCalibrationError(bins)).toBeCloseTo(0.3, 4)
        })

        test('weights by bin count', () => {
            const bins = [
                { count: 90, mean_pred: 0.5, mean_actual: 0.5 },  // perfect, 90 weight
                { count: 10, mean_pred: 0.9, mean_actual: 0.5 }   // off by 0.4, 10 weight
            ]
            // weighted = (0 * 90 + 0.4 * 10) / 100 = 0.04
            expect(expectedCalibrationError(bins)).toBeCloseTo(0.04, 4)
        })

        test('returns 0 for empty bins', () => {
            expect(expectedCalibrationError([])).toBe(0)
            expect(expectedCalibrationError([{ count: 0, mean_pred: null, mean_actual: null }])).toBe(0)
        })
    })

    // ── calibrationQuality ─────────────────────────────────────────
    describe('calibrationQuality (0-1, fills §17 stub)', () => {
        test('returns 1 for perfectly calibrated predictions', () => {
            // 80% predictions, 8/10 win
            const preds = []
            for (let i = 0; i < 8; i++) preds.push({ score: 0.8, actual_win: 1 })
            for (let i = 0; i < 2; i++) preds.push({ score: 0.8, actual_win: 0 })
            expect(calibrationQuality(preds)).toBeCloseTo(1.0, 2)
        })

        test('returns < 1 for miscalibrated predictions', () => {
            // 80% predictions, but only 50% win
            const preds = []
            for (let i = 0; i < 5; i++) preds.push({ score: 0.8, actual_win: 1 })
            for (let i = 0; i < 5; i++) preds.push({ score: 0.8, actual_win: 0 })
            const q = calibrationQuality(preds)
            expect(q).toBeLessThan(1.0)
            expect(q).toBeGreaterThanOrEqual(0)
        })

        test('clamps to [0, 1]', () => {
            const preds = [{ score: 1.0, actual_win: 0 }]
            const q = calibrationQuality(preds)
            expect(q).toBeGreaterThanOrEqual(0)
            expect(q).toBeLessThanOrEqual(1)
        })

        test('returns 0 for empty array', () => {
            expect(calibrationQuality([])).toBe(0)
        })
    })

    // ── wilsonInterval ─────────────────────────────────────────────
    describe('wilsonInterval(wins, total, confidence)', () => {
        test('returns {low, high} both in [0, 1]', () => {
            const ci = wilsonInterval(50, 100, 0.95)
            expect(ci.low).toBeGreaterThanOrEqual(0)
            expect(ci.high).toBeLessThanOrEqual(1)
            expect(ci.low).toBeLessThan(ci.high)
        })

        test('50/100 wins → CI roughly [0.4, 0.6]', () => {
            const ci = wilsonInterval(50, 100, 0.95)
            expect(ci.low).toBeCloseTo(0.404, 2)
            expect(ci.high).toBeCloseTo(0.596, 2)
        })

        test('returns {0, 0} for total=0', () => {
            expect(wilsonInterval(0, 0, 0.95)).toEqual({ low: 0, high: 0 })
        })

        test('throws on invalid input', () => {
            expect(() => wilsonInterval(-1, 10, 0.95)).toThrow()
            expect(() => wilsonInterval(5, 10, 1.5)).toThrow()
            expect(() => wilsonInterval(20, 10, 0.95)).toThrow()  // wins > total
        })
    })

    // ── DB-driven: getCalibration ─────────────────────────────────
    describe('getCalibration — DB integration', () => {
        function seed({ regime, score, wins, losses }) {
            const ids = []
            for (let i = 0; i < wins; i++) {
                ids.push(recordAttribution({
                    userId: TEST_USER_ID,
                    resolvedEnv: 'DEMO',
                    trade: {
                        pos_id: `omega_w2_p20_w_${Date.now()}_${i}_${Math.random()}`,
                        symbol: 'BTCUSDT',
                        pnl_pct: 1.0,
                        closed_by: 'tp',
                        score_at_entry: score
                    },
                    snapshot: {
                        decision_digest: `omega_w2_p20_d_${Math.random()}`,
                        regime
                    }
                }).id)
            }
            for (let i = 0; i < losses; i++) {
                ids.push(recordAttribution({
                    userId: TEST_USER_ID,
                    resolvedEnv: 'DEMO',
                    trade: {
                        pos_id: `omega_w2_p20_l_${Date.now()}_${i}_${Math.random()}`,
                        symbol: 'BTCUSDT',
                        pnl_pct: -1.0,
                        closed_by: 'sl',
                        score_at_entry: score
                    },
                    snapshot: {
                        decision_digest: `omega_w2_p20_d_${Math.random()}`,
                        regime
                    }
                }).id)
            }
            return ids
        }

        test('returns expected shape', () => {
            seed({ regime: 'trend', score: 0.75, wins: 3, losses: 1 })
            const result = getCalibration({ userId: TEST_USER_ID, resolvedEnv: 'DEMO', sinceMs: 0 })
            expect(result).toHaveProperty('sample_count')
            expect(result).toHaveProperty('brier_score')
            expect(result).toHaveProperty('ece')
            expect(result).toHaveProperty('calibration_quality')
            expect(result).toHaveProperty('reliability_diagram')
            expect(result).toHaveProperty('isotonic_correction')
            expect(result).toHaveProperty('aleatoric_uncertainty')
            expect(Array.isArray(result.reliability_diagram)).toBe(true)
            expect(result.reliability_diagram.length).toBe(10)
            expect(result.sample_count).toBeGreaterThan(0)
        })

        test('stub fields are null (Wave 5+ work)', () => {
            const result = getCalibration({ userId: TEST_USER_ID, resolvedEnv: 'DEMO', sinceMs: 0 })
            expect(result.isotonic_correction).toBeNull()
            expect(result.aleatoric_uncertainty).toBeNull()
            expect(result.epistemic_uncertainty).toBeNull()
        })

        test('calibration_quality in [0, 1]', () => {
            const result = getCalibration({ userId: TEST_USER_ID, resolvedEnv: 'DEMO', sinceMs: 0 })
            expect(result.calibration_quality).toBeGreaterThanOrEqual(0)
            expect(result.calibration_quality).toBeLessThanOrEqual(1)
        })

        test('returns zero stats for unknown user', () => {
            const result = getCalibration({ userId: 999999970, resolvedEnv: 'DEMO', sinceMs: 0 })
            expect(result.sample_count).toBe(0)
            expect(result.brier_score).toBe(0)
            expect(result.calibration_quality).toBe(0)
        })

        test('only counts decisive trades (WIN or LOSS), excludes ABSTAIN', () => {
            const before = getCalibration({ userId: TEST_USER_ID, resolvedEnv: 'DEMO', sinceMs: 0 })
            recordAttribution({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                trade: { symbol: 'BTCUSDT', abstain: true, would_have_pnl: 0.5, score_at_entry: 0.7 },
                snapshot: { decision_digest: `omega_w2_p20_abs_${Date.now()}` }
            })
            const after = getCalibration({ userId: TEST_USER_ID, resolvedEnv: 'DEMO', sinceMs: 0 })
            // ABSTAIN should not change sample_count
            expect(after.sample_count).toBe(before.sample_count)
        })
    })

    // ── getRegimeCalibration ───────────────────────────────────────
    describe('getRegimeCalibration', () => {
        test('returns shape filtered by regime', () => {
            recordAttribution({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                trade: { pos_id: `rc_${Date.now()}`, symbol: 'BTCUSDT', pnl_pct: 1.0, closed_by: 'tp', score_at_entry: 0.75 },
                snapshot: { decision_digest: `rc_d_${Date.now()}`, regime: 'squeeze' }
            })
            const result = getRegimeCalibration({ userId: TEST_USER_ID, resolvedEnv: 'DEMO', regime: 'squeeze', sinceMs: 0 })
            expect(result.sample_count).toBeGreaterThanOrEqual(1)
            expect(result).toHaveProperty('calibration_quality')
        })

        test('returns zero stats for empty regime', () => {
            const result = getRegimeCalibration({ userId: TEST_USER_ID, resolvedEnv: 'DEMO', regime: 'never-seen-regime', sinceMs: 0 })
            expect(result.sample_count).toBe(0)
            expect(result.calibration_quality).toBe(0)
        })
    })
})
