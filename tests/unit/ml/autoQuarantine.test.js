/**
 * R5B Governance — autoQuarantine tests (§254* Claude-extras)
 *
 * §254* AUTO-QUARANTINE FAILED FEATURES = anti-feature-rot mechanism.
 * Source: project_ml_brain_pro_244.md "254* (R5 + R3B) — set weight=0
 * immediate când feature contribuie negativ peste 100+ trades + Brier
 * worse than null + p<0.01 + bad în ≥2 regime."
 *
 * Claude-extras approved 2026-04-29, NOT in canonical PDF.
 *
 * 4 cumulative conditions for auto-quarantine:
 *   1. Sample count >= 100 trades
 *   2. Brier score worse than null model (always predict base rate)
 *   3. Statistical significance: p-value < 0.01 (z-test on win rate vs 50%)
 *   4. Bad performance in >= 2 distinct regimes
 *
 * NO new migration — composes ml_attribution_events (data) +
 * ml_feature_global_overrides (quarantine state) + ml_feature_audit_log.
 */

const { db } = require('../../../server/services/database')
const {
    THRESHOLDS,
    evaluateFeature,
    quarantineFeature,
    unquarantineFeature,
    scanAllFeatures,
    getQuarantineStatus,
    RECOMMENDATIONS
} = require('../../../server/services/ml/R5B_governance/autoQuarantine')

describe('R5B — autoQuarantine (§254* Claude-extras)', () => {
    const TEST_PREFIX = `omega_w3_p254_${Date.now()}_`
    const TEST_USER_ID = 99780

    afterAll(() => {
        db.prepare(`DELETE FROM ml_attribution_events WHERE user_id = ?`).run(TEST_USER_ID)
        db.prepare(`DELETE FROM ml_feature_global_overrides WHERE feature_id LIKE ?`).run(`${TEST_PREFIX}%`)
        db.prepare(`DELETE FROM ml_feature_audit_log WHERE feature_id LIKE ?`).run(`${TEST_PREFIX}%`)
    })

    // Helper to seed attribution events for a feature
    // INSERT directly with feature marker as decision_digest (no UPDATE).
    function seedAttribution({ featureId, regime, score, pnl, count }) {
        const featureMarker = `${featureId}_marker`
        for (let i = 0; i < count; i++) {
            const posId = `${featureId}_p_${i}_${Math.random()}`
            db.prepare(`INSERT INTO ml_attribution_events
                (decision_digest, user_id, resolved_env, symbol, pos_id,
                 outcome_class, r_multiple, pnl_pct, operator_feedback,
                 attributed_at, regime, score_at_entry, mfe_pct, mae_pct,
                 slippage_pct, time_in_trade_min, side)
                VALUES (?, ?, 'DEMO', 'BTCUSDT', ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'long')
            `).run(
                featureMarker,
                TEST_USER_ID,
                posId,
                pnl > 0 ? 'WIN' : 'LOSS',
                pnl > 0 ? 1 : -1,
                pnl,
                Date.now() - (count - i) * 1000,
                regime,
                score,
                pnl > 0 ? pnl * 1.2 : 0.1,
                pnl < 0 ? Math.abs(pnl) : 0.1,
                0.05,
                30
            )
        }
    }

    // ── Exported constants ─────────────────────────────────────────
    describe('Exported constants', () => {
        test('THRESHOLDS exposes spec values', () => {
            expect(THRESHOLDS).toHaveProperty('min_trades')
            expect(THRESHOLDS).toHaveProperty('p_threshold')
            expect(THRESHOLDS).toHaveProperty('min_bad_regimes')
            expect(THRESHOLDS.min_trades).toBe(100)
            expect(THRESHOLDS.p_threshold).toBe(0.01)
            expect(THRESHOLDS.min_bad_regimes).toBe(2)
        })

        test('RECOMMENDATIONS export', () => {
            expect(RECOMMENDATIONS).toEqual(['QUARANTINE', 'KEEP', 'INSUFFICIENT_DATA'])
        })
    })

    // ── evaluateFeature ────────────────────────────────────────────
    describe('evaluateFeature', () => {
        test('returns INSUFFICIENT_DATA when sample count < 100', () => {
            const fid = `${TEST_PREFIX}insuff`
            seedAttribution({ featureId: fid, regime: 'trend', score: 0.55, pnl: -0.5, count: 50 })
            const result = evaluateFeature({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                featureMarker: `${fid}_marker`,
                sinceMs: 0
            })
            expect(result.recommendation).toBe('INSUFFICIENT_DATA')
            expect(result.eligible_for_quarantine).toBe(false)
        })

        test('returns KEEP when conditions not all met (e.g., one regime only)', () => {
            const fid = `${TEST_PREFIX}keep_one_regime`
            seedAttribution({ featureId: fid, regime: 'trend', score: 0.55, pnl: -0.3, count: 120 })
            const result = evaluateFeature({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                featureMarker: `${fid}_marker`,
                sinceMs: 0
            })
            expect(result.recommendation).toBe('KEEP')
            expect(result.conditions.multi_regime_bad).toBe(false)
        })

        test('returns QUARANTINE when all 4 conditions met', () => {
            const fid = `${TEST_PREFIX}quarantine_now`
            // Bad in 2 regimes, 200 trades total
            seedAttribution({ featureId: fid, regime: 'trend', score: 0.55, pnl: -0.5, count: 100 })
            seedAttribution({ featureId: fid, regime: 'range', score: 0.55, pnl: -0.5, count: 100 })
            const result = evaluateFeature({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                featureMarker: `${fid}_marker`,
                sinceMs: 0
            })
            expect(result.recommendation).toBe('QUARANTINE')
            expect(result.eligible_for_quarantine).toBe(true)
            expect(result.conditions.sufficient_samples).toBe(true)
            expect(result.conditions.multi_regime_bad).toBe(true)
        })

        test('result shape includes all conditions + metrics', () => {
            const fid = `${TEST_PREFIX}shape`
            seedAttribution({ featureId: fid, regime: 'trend', score: 0.55, pnl: -0.5, count: 120 })
            const result = evaluateFeature({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                featureMarker: `${fid}_marker`,
                sinceMs: 0
            })
            expect(result).toHaveProperty('sample_count')
            expect(result).toHaveProperty('win_rate')
            expect(result).toHaveProperty('brier_score')
            expect(result).toHaveProperty('null_model_brier')
            expect(result).toHaveProperty('p_value')
            expect(result).toHaveProperty('bad_regime_count')
            expect(result).toHaveProperty('conditions')
            expect(result.conditions).toHaveProperty('sufficient_samples')
            expect(result.conditions).toHaveProperty('brier_worse')
            expect(result.conditions).toHaveProperty('p_significant')
            expect(result.conditions).toHaveProperty('multi_regime_bad')
        })

        test('throws on missing required fields', () => {
            expect(() => evaluateFeature({})).toThrow()
        })
    })

    // ── quarantineFeature ──────────────────────────────────────────
    describe('quarantineFeature', () => {
        test('inserts QUARANTINED override + audit log entry', () => {
            const fid = `${TEST_PREFIX}q1`
            const result = quarantineFeature({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                symbol: 'BTCUSDT',
                featureId: fid,
                scope: 'GLOBAL',
                reason: 'auto-quarantine: all 4 §254* conditions met',
                actor: 'omega_w3_p254_test'
            })
            expect(typeof result.override_id).toBe('number')
            expect(typeof result.audit_log_id).toBe('number')
            const row = db.prepare(`SELECT * FROM ml_feature_global_overrides WHERE id = ?`).get(result.override_id)
            expect(row.override_status).toBe('QUARANTINED')
            expect(row.feature_id).toBe(fid)
        })

        test('throws if feature already quarantined at same scope', () => {
            const fid = `${TEST_PREFIX}q_dup`
            quarantineFeature({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                symbol: 'BTCUSDT',
                featureId: fid,
                scope: 'GLOBAL',
                reason: 'first',
                actor: 'test'
            })
            expect(() => quarantineFeature({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                symbol: 'BTCUSDT',
                featureId: fid,
                scope: 'GLOBAL',
                reason: 'second',
                actor: 'test'
            })).toThrow(/already.*quarantined|UNIQUE/i)
        })
    })

    // ── unquarantineFeature ────────────────────────────────────────
    describe('unquarantineFeature', () => {
        test('removes quarantine override + logs audit entry', () => {
            const fid = `${TEST_PREFIX}unq1`
            const q = quarantineFeature({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                symbol: 'BTCUSDT',
                featureId: fid,
                scope: 'GLOBAL',
                reason: 'temp',
                actor: 'test'
            })
            unquarantineFeature({
                overrideId: q.override_id,
                actor: 'operator',
                reason: 'manual unquarantine'
            })
            const row = db.prepare(`SELECT * FROM ml_feature_global_overrides WHERE id = ?`).get(q.override_id)
            expect(row).toBeUndefined()
        })

        test('throws if override does not exist', () => {
            expect(() => unquarantineFeature({
                overrideId: 999999990,
                actor: 'operator',
                reason: 'try'
            })).toThrow(/not found|missing/i)
        })
    })

    // ── getQuarantineStatus ────────────────────────────────────────
    describe('getQuarantineStatus', () => {
        test('returns override row when feature quarantined', () => {
            const fid = `${TEST_PREFIX}status1`
            quarantineFeature({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                symbol: 'BTCUSDT',
                featureId: fid,
                scope: 'GLOBAL',
                reason: 'test',
                actor: 'test'
            })
            const status = getQuarantineStatus({ featureId: fid })
            expect(status).not.toBeNull()
            expect(status.override_status).toBe('QUARANTINED')
        })

        test('returns null when feature not quarantined', () => {
            const status = getQuarantineStatus({ featureId: `${TEST_PREFIX}never_quarantined` })
            expect(status).toBeNull()
        })
    })

    // ── scanAllFeatures ────────────────────────────────────────────
    describe('scanAllFeatures', () => {
        test('returns {evaluated, quarantined, skipped, errors}', () => {
            const result = scanAllFeatures({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                sinceMs: 0
            })
            expect(result).toHaveProperty('evaluated')
            expect(result).toHaveProperty('quarantined')
            expect(result).toHaveProperty('skipped')
            expect(result).toHaveProperty('errors')
            expect(Array.isArray(result.quarantined)).toBe(true)
            expect(Array.isArray(result.errors)).toBe(true)
        })

        test('auto-quarantines features meeting all 4 conditions', () => {
            const fid = `${TEST_PREFIX}scan_quarantine`
            seedAttribution({ featureId: fid, regime: 'trend', score: 0.55, pnl: -0.5, count: 100 })
            seedAttribution({ featureId: fid, regime: 'range', score: 0.55, pnl: -0.5, count: 100 })
            const result = scanAllFeatures({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                sinceMs: 0
            })
            const found = result.quarantined.find(q => q.featureId === `${fid}_marker`)
            expect(found).toBeDefined()
        })
    })
})
