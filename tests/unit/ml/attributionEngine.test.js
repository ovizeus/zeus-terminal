/**
 * R5A Learning Core — attributionEngine tests
 *
 * Canonical §16 POST-TRADE ATTRIBUTION — first R5A point implemented
 * point-by-point per operator discipline (feedback_post_skeleton_point_by_point_ml).
 *
 * Tests cover:
 * - Migration 043 ADD COLUMN applied (causal_class + assessment_json)
 * - classifyOutcome — 7 binary outcomes (WIN/LOSS/BREAKEVEN/TIMEOUT/MANUAL_CLOSE/ABSTAIN_CORRECT/ABSTAIN_WRONG)
 * - classifyCausal — 11 spec classes (WIN_GOOD, WIN_LUCKY, LOSS_GOOD, etc.)
 * - assessQuestions — 6 boolean answers per §16 closing questions
 * - recordAttribution — orchestrator inserts to ml_attribution_events
 */

const { db } = require('../../../server/services/database')
const {
    classifyOutcome,
    classifyCausal,
    assessQuestions,
    recordAttribution,
    setOperatorFeedback,
    getRecentAttributions,
    getAttributionStats,
    OUTCOME_CLASSES,
    CAUSAL_CLASSES,
    ASSESSMENT_QUESTIONS
} = require('../../../server/services/ml/R5A_learning/attributionEngine')

describe('R5A — attributionEngine (canonical §16)', () => {
    const TEST_USER_ID = 99700

    afterAll(() => {
        db.prepare(`DELETE FROM ml_attribution_events WHERE user_id = ?`).run(TEST_USER_ID)
    })

    // ── Migration 043 verification ─────────────────────────────────
    describe('Migration 043 — ml_attribution_events ADD COLUMN', () => {
        test('causal_class column exists', () => {
            const cols = db.prepare("PRAGMA table_info(ml_attribution_events)").all()
            const c = cols.find(x => x.name === 'causal_class')
            expect(c).toBeDefined()
            expect(c.type.toUpperCase()).toBe('TEXT')
        })

        test('assessment_json column exists', () => {
            const cols = db.prepare("PRAGMA table_info(ml_attribution_events)").all()
            const c = cols.find(x => x.name === 'assessment_json')
            expect(c).toBeDefined()
            expect(c.type.toUpperCase()).toBe('TEXT')
        })
    })

    // ── Exported constants ─────────────────────────────────────────
    describe('Exported enums', () => {
        test('OUTCOME_CLASSES has 7 binary outcomes', () => {
            expect(OUTCOME_CLASSES).toEqual(expect.arrayContaining([
                'WIN', 'LOSS', 'BREAKEVEN', 'TIMEOUT', 'MANUAL_CLOSE',
                'ABSTAIN_CORRECT', 'ABSTAIN_WRONG'
            ]))
            expect(OUTCOME_CLASSES.length).toBe(7)
        })

        test('CAUSAL_CLASSES has 11 spec classes per §16', () => {
            expect(CAUSAL_CLASSES).toEqual(expect.arrayContaining([
                'WIN_GOOD', 'WIN_LUCKY',
                'LOSS_GOOD', 'LOSS_BAD',
                'GOOD_READ_BAD_TIMING', 'GOOD_TIMING_BAD_MGMT',
                'BAD_EXECUTION', 'WRONG_CONTEXT',
                'OVERSIZED', 'FORCED_ENTRY',
                'NOT_APPLICABLE'
            ]))
            expect(CAUSAL_CLASSES.length).toBe(11)
        })

        test('ASSESSMENT_QUESTIONS has 6 per §16 closing block', () => {
            expect(ASSESSMENT_QUESTIONS).toEqual([
                'model_correct',
                'execution_ruined',
                'sizing_wrong',
                'regime_misidentified',
                'signal_decay_ignored',
                'macro_underestimated'
            ])
        })
    })

    // ── classifyOutcome ────────────────────────────────────────────
    describe('classifyOutcome — 7 binary outcomes', () => {
        test('WIN when pnl_pct > 0 and not abstain/timeout/manual', () => {
            expect(classifyOutcome({ pnl_pct: 1.5, closed_by: 'tp' })).toBe('WIN')
        })

        test('LOSS when pnl_pct < 0 and stopped out', () => {
            expect(classifyOutcome({ pnl_pct: -0.8, closed_by: 'sl' })).toBe('LOSS')
        })

        test('BREAKEVEN when |pnl_pct| < 0.05', () => {
            expect(classifyOutcome({ pnl_pct: 0.02, closed_by: 'tp' })).toBe('BREAKEVEN')
            expect(classifyOutcome({ pnl_pct: -0.03, closed_by: 'sl' })).toBe('BREAKEVEN')
        })

        test('TIMEOUT when closed_by=timeout', () => {
            expect(classifyOutcome({ pnl_pct: 0.1, closed_by: 'timeout' })).toBe('TIMEOUT')
        })

        test('MANUAL_CLOSE when closed_by=manual', () => {
            expect(classifyOutcome({ pnl_pct: 0.5, closed_by: 'manual' })).toBe('MANUAL_CLOSE')
        })

        test('ABSTAIN_CORRECT when abstain=true and would-have-lost', () => {
            expect(classifyOutcome({ abstain: true, would_have_pnl: -1.0 })).toBe('ABSTAIN_CORRECT')
        })

        test('ABSTAIN_WRONG when abstain=true and would-have-won', () => {
            expect(classifyOutcome({ abstain: true, would_have_pnl: 1.5 })).toBe('ABSTAIN_WRONG')
        })

        test('throws on missing required fields', () => {
            expect(() => classifyOutcome(null)).toThrow(/trade/i)
            expect(() => classifyOutcome({})).toThrow()
        })
    })

    // ── classifyCausal ─────────────────────────────────────────────
    describe('classifyCausal — 11 spec classes per §16', () => {
        test('WIN_GOOD when WIN + high score (followed process)', () => {
            const trade = { pnl_pct: 1.5, closed_by: 'tp', score_at_entry: 0.78 }
            const snap = { mfe: 1.8, mae: 0.3 }
            expect(classifyCausal(trade, snap)).toBe('WIN_GOOD')
        })

        test('WIN_LUCKY when WIN + low score (got lucky)', () => {
            const trade = { pnl_pct: 1.2, closed_by: 'tp', score_at_entry: 0.42 }
            const snap = { mfe: 1.4, mae: 1.1 }
            expect(classifyCausal(trade, snap)).toBe('WIN_LUCKY')
        })

        test('LOSS_GOOD when LOSS + high score (followed process correctly, market wrong)', () => {
            const trade = { pnl_pct: -0.9, closed_by: 'sl', score_at_entry: 0.75 }
            const snap = { mfe: 0.1, mae: 0.95 }
            expect(classifyCausal(trade, snap)).toBe('LOSS_GOOD')
        })

        test('LOSS_BAD when LOSS + moderate score (not forced, but weak conviction)', () => {
            // Score [0.4, 0.6) = not forced (>=0.4) but not high-conviction (<0.6)
            const trade = { pnl_pct: -0.95, closed_by: 'sl', score_at_entry: 0.48 }
            const snap = { mfe: 0.1, mae: 1.0 }
            expect(classifyCausal(trade, snap)).toBe('LOSS_BAD')
        })

        test('GOOD_READ_BAD_TIMING when LOSS but mfe ≫ |loss|', () => {
            const trade = { pnl_pct: -0.4, closed_by: 'sl', score_at_entry: 0.65 }
            const snap = { mfe: 1.8, mae: 0.5 }
            expect(classifyCausal(trade, snap)).toBe('GOOD_READ_BAD_TIMING')
        })

        test('BAD_EXECUTION when slippage_pct > 0.3', () => {
            const trade = { pnl_pct: 0.5, closed_by: 'tp', score_at_entry: 0.7, slippage_pct: 0.5 }
            const snap = { mfe: 0.7, mae: 0.1 }
            expect(classifyCausal(trade, snap)).toBe('BAD_EXECUTION')
        })

        test('FORCED_ENTRY when score_at_entry < 0.4 regardless of outcome', () => {
            const trade = { pnl_pct: 0.6, closed_by: 'tp', score_at_entry: 0.32 }
            const snap = { mfe: 0.7, mae: 0.1 }
            expect(classifyCausal(trade, snap)).toBe('FORCED_ENTRY')
        })

        test('NOT_APPLICABLE for ABSTAIN outcomes', () => {
            const trade = { abstain: true, would_have_pnl: 0.5 }
            const snap = {}
            expect(classifyCausal(trade, snap)).toBe('NOT_APPLICABLE')
        })
    })

    // ── assessQuestions ────────────────────────────────────────────
    describe('assessQuestions — 6 booleans per §16', () => {
        test('returns object with 6 expected keys all boolean', () => {
            const trade = { pnl_pct: 1.0, closed_by: 'tp', score_at_entry: 0.7 }
            const snap = { mfe: 1.2, mae: 0.2, regime: 'TREND', macro_score: 0.6 }
            const a = assessQuestions(trade, snap)
            expect(Object.keys(a).sort()).toEqual(ASSESSMENT_QUESTIONS.slice().sort())
            for (const k of ASSESSMENT_QUESTIONS) {
                expect(typeof a[k]).toBe('boolean')
            }
        })

        test('model_correct=true when score_at_entry>=0.6 and WIN', () => {
            const a = assessQuestions(
                { pnl_pct: 1.0, closed_by: 'tp', score_at_entry: 0.72 },
                { mfe: 1.2, mae: 0.2 }
            )
            expect(a.model_correct).toBe(true)
        })

        test('execution_ruined=true when slippage_pct>0.3', () => {
            const a = assessQuestions(
                { pnl_pct: -0.5, closed_by: 'sl', score_at_entry: 0.7, slippage_pct: 0.6 },
                { mfe: 0.8, mae: 0.6 }
            )
            expect(a.execution_ruined).toBe(true)
        })

        test('sizing_wrong=true when risk_pct>2.0', () => {
            const a = assessQuestions(
                { pnl_pct: -0.5, closed_by: 'sl', score_at_entry: 0.7, risk_pct: 3.5 },
                { mfe: 0.8, mae: 0.6 }
            )
            expect(a.sizing_wrong).toBe(true)
        })
    })

    // ── recordAttribution ──────────────────────────────────────────
    describe('recordAttribution — orchestrator', () => {
        test('inserts row into ml_attribution_events with all fields', () => {
            const trade = {
                pos_id: 'omega_w2_p16_test_1',
                symbol: 'BTCUSDT',
                pnl_pct: 1.5,
                closed_by: 'tp',
                score_at_entry: 0.75
            }
            const snapshot = {
                decision_digest: 'omega_w2_p16_digest_1',
                mfe: 1.8,
                mae: 0.3,
                regime: 'TREND'
            }
            const result = recordAttribution({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                trade,
                snapshot
            })
            expect(typeof result.id).toBe('number')
            expect(result.id).toBeGreaterThan(0)

            const row = db.prepare(
                `SELECT * FROM ml_attribution_events WHERE id = ?`
            ).get(result.id)
            expect(row.user_id).toBe(TEST_USER_ID)
            expect(row.symbol).toBe('BTCUSDT')
            expect(row.outcome_class).toBe('WIN')
            expect(row.causal_class).toBe('WIN_GOOD')
            expect(row.decision_digest).toBe('omega_w2_p16_digest_1')

            const assessment = JSON.parse(row.assessment_json)
            expect(assessment).toHaveProperty('model_correct')
            expect(assessment).toHaveProperty('execution_ruined')
        })

        test('rejects missing required fields', () => {
            expect(() => recordAttribution({})).toThrow()
            expect(() => recordAttribution({ userId: TEST_USER_ID })).toThrow()
        })

        test('handles ABSTAIN trades (no pos_id)', () => {
            const result = recordAttribution({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                trade: { symbol: 'ETHUSDT', abstain: true, would_have_pnl: -0.5 },
                snapshot: { decision_digest: 'omega_w2_p16_abstain_1' }
            })
            const row = db.prepare(
                `SELECT * FROM ml_attribution_events WHERE id = ?`
            ).get(result.id)
            expect(row.outcome_class).toBe('ABSTAIN_CORRECT')
            expect(row.causal_class).toBe('NOT_APPLICABLE')
            expect(row.pos_id).toBeNull()
        })
    })

    // ── setOperatorFeedback (proactive — A-Z raid item F) ─────────
    describe('setOperatorFeedback — operator thumb up/down ground truth', () => {
        test('updates operator_feedback column on existing row', () => {
            const result = recordAttribution({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                trade: { pos_id: 'omega_w2_p16_fb_1', symbol: 'BTCUSDT', pnl_pct: 1.0, closed_by: 'tp', score_at_entry: 0.7 },
                snapshot: { decision_digest: 'omega_w2_p16_fb_digest_1' }
            })
            setOperatorFeedback({ id: result.id, feedback: 1 })
            const row = db.prepare(`SELECT operator_feedback FROM ml_attribution_events WHERE id = ?`).get(result.id)
            expect(row.operator_feedback).toBe(1)
        })

        test('supports -1 (thumb down), 0 (neutral), 1 (thumb up), null (clear)', () => {
            const result = recordAttribution({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                trade: { pos_id: 'omega_w2_p16_fb_2', symbol: 'BTCUSDT', pnl_pct: -0.5, closed_by: 'sl', score_at_entry: 0.7 },
                snapshot: { decision_digest: 'omega_w2_p16_fb_digest_2' }
            })
            for (const fb of [1, -1, 0]) {
                setOperatorFeedback({ id: result.id, feedback: fb })
                const r = db.prepare(`SELECT operator_feedback FROM ml_attribution_events WHERE id = ?`).get(result.id)
                expect(r.operator_feedback).toBe(fb)
            }
        })

        test('rejects invalid feedback values', () => {
            expect(() => setOperatorFeedback({ id: 1, feedback: 5 })).toThrow(/feedback/i)
            expect(() => setOperatorFeedback({ id: 1, feedback: 'good' })).toThrow(/feedback/i)
        })
    })

    // ── getRecentAttributions (proactive — UI + analysis) ─────────
    describe('getRecentAttributions — query helper', () => {
        test('returns recent attributions for user/env', () => {
            recordAttribution({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                trade: { pos_id: 'omega_w2_p16_recent_1', symbol: 'BTCUSDT', pnl_pct: 1.5, closed_by: 'tp', score_at_entry: 0.7 },
                snapshot: { decision_digest: 'omega_w2_p16_recent_d1' }
            })
            const rows = getRecentAttributions({ userId: TEST_USER_ID, resolvedEnv: 'DEMO', limit: 10 })
            expect(Array.isArray(rows)).toBe(true)
            expect(rows.length).toBeGreaterThan(0)
            for (const r of rows) {
                expect(r.user_id).toBe(TEST_USER_ID)
                expect(r.resolved_env).toBe('DEMO')
            }
        })

        test('respects limit parameter', () => {
            const rows = getRecentAttributions({ userId: TEST_USER_ID, resolvedEnv: 'DEMO', limit: 1 })
            expect(rows.length).toBeLessThanOrEqual(1)
        })

        test('returns empty array on no match', () => {
            const rows = getRecentAttributions({ userId: 999999999, resolvedEnv: 'DEMO', limit: 10 })
            expect(rows).toEqual([])
        })
    })

    // ── getAttributionStats (proactive — performance summary) ─────
    describe('getAttributionStats — aggregate stats', () => {
        test('returns stats with hit_rate, avg_pnl_pct, total_count', () => {
            // Ensure some recent rows exist
            recordAttribution({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                trade: { pos_id: 'omega_w2_p16_stats_w', symbol: 'BTCUSDT', pnl_pct: 1.0, closed_by: 'tp', score_at_entry: 0.7 },
                snapshot: { decision_digest: 'omega_w2_p16_stats_d1' }
            })
            recordAttribution({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                trade: { pos_id: 'omega_w2_p16_stats_l', symbol: 'BTCUSDT', pnl_pct: -0.5, closed_by: 'sl', score_at_entry: 0.7 },
                snapshot: { decision_digest: 'omega_w2_p16_stats_d2' }
            })
            const stats = getAttributionStats({ userId: TEST_USER_ID, resolvedEnv: 'DEMO', sinceMs: 0 })
            expect(stats).toHaveProperty('total_count')
            expect(stats).toHaveProperty('hit_rate')
            expect(stats).toHaveProperty('avg_pnl_pct')
            expect(stats).toHaveProperty('outcome_breakdown')
            expect(stats.total_count).toBeGreaterThan(0)
            expect(stats.hit_rate).toBeGreaterThanOrEqual(0)
            expect(stats.hit_rate).toBeLessThanOrEqual(1)
        })

        test('returns zero stats on no data', () => {
            const stats = getAttributionStats({ userId: 999999998, resolvedEnv: 'DEMO', sinceMs: 0 })
            expect(stats.total_count).toBe(0)
            expect(stats.hit_rate).toBe(0)
        })
    })
})
