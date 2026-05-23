/**
 * R5A Learning Core — regimeMetrics tests (canonical §17)
 *
 * METRICI PE REGIM — per-regime / per-session / per-confidence-bucket
 * breakdown of attribution data. Builds on §16 ml_attribution_events
 * extended with 7 new columns (Migration 044).
 *
 * Drift / calibration stubs return null until §20 + §21 implementations.
 */

const { db } = require('../../../server/services/database')
const {
    recordAttribution
} = require('../../../server/services/ml/R5A_learning/attributionEngine')
const {
    getRegimeMetrics,
    getAllRegimeMetrics,
    getSessionMetrics,
    getDirectionMetrics,
    getMetricsByConfidenceBucket,
    getConfidenceBucket,
    CONFIDENCE_BUCKETS,
    REGIME_VALUES
} = require('../../../server/services/ml/R5A_learning/regimeMetrics')

describe('R5A — regimeMetrics (canonical §17)', () => {
    const TEST_USER_ID = 99800

    afterAll(() => {
        db.prepare(`DELETE FROM ml_attribution_events WHERE user_id = ?`).run(TEST_USER_ID)
    })

    // Helper to seed deterministic attributions
    function seedTrade({ regime, session, pnl_pct, score, side = 'long', mfe = 0, mae = 0, slippage = 0, time_in = 30 }) {
        return recordAttribution({
            userId: TEST_USER_ID,
            resolvedEnv: 'DEMO',
            trade: {
                pos_id: `omega_w2_p17_${Date.now()}_${Math.random()}`,
                symbol: side === 'long' ? 'BTCUSDT' : 'ETHUSDT',
                side,
                pnl_pct,
                closed_by: pnl_pct > 0 ? 'tp' : 'sl',
                score_at_entry: score,
                slippage_pct: slippage,
                time_in_trade_min: time_in
            },
            snapshot: {
                decision_digest: `omega_w2_p17_d_${Math.random()}`,
                mfe,
                mae,
                regime,
                session
            }
        })
    }

    // ── Migration 044 verification ─────────────────────────────────
    describe('Migration 044 — ml_attribution_events ADD COLUMNs', () => {
        test('regime column exists', () => {
            const cols = db.prepare("PRAGMA table_info(ml_attribution_events)").all()
            expect(cols.find(c => c.name === 'regime')).toBeDefined()
        })
        test('session column exists', () => {
            const cols = db.prepare("PRAGMA table_info(ml_attribution_events)").all()
            expect(cols.find(c => c.name === 'session')).toBeDefined()
        })
        test('score_at_entry, mfe_pct, mae_pct, slippage_pct, time_in_trade_min all exist', () => {
            const cols = db.prepare("PRAGMA table_info(ml_attribution_events)").all()
            const names = cols.map(c => c.name)
            expect(names).toEqual(expect.arrayContaining([
                'score_at_entry', 'mfe_pct', 'mae_pct', 'slippage_pct', 'time_in_trade_min'
            ]))
        })
        test('regime and session indexes exist', () => {
            const indexes = db.prepare("PRAGMA index_list(ml_attribution_events)").all()
            const names = indexes.map(i => i.name)
            expect(names).toEqual(expect.arrayContaining([
                'idx_mlae_regime_ts',
                'idx_mlae_session_ts'
            ]))
        })
    })

    // ── Exported constants ─────────────────────────────────────────
    describe('Exported enums', () => {
        test('CONFIDENCE_BUCKETS has 4 expected buckets', () => {
            expect(CONFIDENCE_BUCKETS).toEqual(['low', 'mid', 'high', 'very_high'])
        })
        test('REGIME_VALUES includes core regimes from spec', () => {
            expect(REGIME_VALUES).toEqual(expect.arrayContaining([
                'trend', 'range', 'chop', 'squeeze', 'news-risk', 'high-vol', 'low-vol'
            ]))
        })
    })

    // ── getConfidenceBucket ────────────────────────────────────────
    describe('getConfidenceBucket(score)', () => {
        test('score < 0.55 → low', () => {
            expect(getConfidenceBucket(0.42)).toBe('low')
            expect(getConfidenceBucket(0.5)).toBe('low')
        })
        test('0.55 ≤ score < 0.7 → mid', () => {
            expect(getConfidenceBucket(0.55)).toBe('mid')
            expect(getConfidenceBucket(0.65)).toBe('mid')
        })
        test('0.7 ≤ score < 0.85 → high', () => {
            expect(getConfidenceBucket(0.7)).toBe('high')
            expect(getConfidenceBucket(0.82)).toBe('high')
        })
        test('score ≥ 0.85 → very_high', () => {
            expect(getConfidenceBucket(0.85)).toBe('very_high')
            expect(getConfidenceBucket(0.95)).toBe('very_high')
        })
        test('returns null for invalid input', () => {
            expect(getConfidenceBucket(null)).toBeNull()
            expect(getConfidenceBucket('not a number')).toBeNull()
            expect(getConfidenceBucket(NaN)).toBeNull()
        })
    })

    // ── recordAttribution extended fields ──────────────────────────
    describe('recordAttribution — extended fields (Migration 044)', () => {
        test('stores regime + session in DB row', () => {
            const result = seedTrade({
                regime: 'trend', session: 'ny',
                pnl_pct: 1.2, score: 0.72, mfe: 1.5, mae: 0.2,
                slippage: 0.05, time_in: 45
            })
            const row = db.prepare(`SELECT regime, session, score_at_entry, mfe_pct, mae_pct, slippage_pct, time_in_trade_min FROM ml_attribution_events WHERE id = ?`).get(result.id)
            expect(row.regime).toBe('trend')
            expect(row.session).toBe('ny')
            expect(row.score_at_entry).toBeCloseTo(0.72, 2)
            expect(row.mfe_pct).toBeCloseTo(1.5, 2)
            expect(row.mae_pct).toBeCloseTo(0.2, 2)
            expect(row.slippage_pct).toBeCloseTo(0.05, 2)
            expect(row.time_in_trade_min).toBeCloseTo(45, 1)
        })

        test('null safe when regime/session not provided in snapshot', () => {
            const result = recordAttribution({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                trade: { pos_id: `null_safe_${Date.now()}`, symbol: 'BTCUSDT', pnl_pct: 0.5, closed_by: 'tp', score_at_entry: 0.7 },
                snapshot: { decision_digest: `null_safe_d_${Date.now()}` }
            })
            const row = db.prepare(`SELECT regime, session FROM ml_attribution_events WHERE id = ?`).get(result.id)
            expect(row.regime).toBeNull()
            expect(row.session).toBeNull()
        })
    })

    // ── getRegimeMetrics ───────────────────────────────────────────
    describe('getRegimeMetrics — per-regime breakdown', () => {
        test('returns metrics shape for given regime', () => {
            seedTrade({ regime: 'trend', session: 'ny', pnl_pct: 1.5, score: 0.75, mfe: 2.0, mae: 0.3 })
            seedTrade({ regime: 'trend', session: 'ny', pnl_pct: -0.5, score: 0.7, mfe: 0.4, mae: 0.55 })
            const m = getRegimeMetrics({ userId: TEST_USER_ID, resolvedEnv: 'DEMO', regime: 'trend', sinceMs: 0 })
            expect(m).toHaveProperty('total_count')
            expect(m).toHaveProperty('hit_rate')
            expect(m).toHaveProperty('avg_rr')
            expect(m).toHaveProperty('avg_slippage_pct')
            expect(m).toHaveProperty('sum_pnl_pct')
            expect(m).toHaveProperty('avg_mfe')
            expect(m).toHaveProperty('avg_mae')
            expect(m).toHaveProperty('avg_time_in_trade_min')
            expect(m).toHaveProperty('drift_score')      // stub null until §21
            expect(m).toHaveProperty('calibration_quality')  // stub null until §20
            expect(m.total_count).toBeGreaterThan(0)
        })

        test('drift_score and calibration_quality are null stubs', () => {
            seedTrade({ regime: 'range', session: 'asia', pnl_pct: 0.8, score: 0.65 })
            const m = getRegimeMetrics({ userId: TEST_USER_ID, resolvedEnv: 'DEMO', regime: 'range', sinceMs: 0 })
            expect(m.drift_score).toBeNull()
            expect(m.calibration_quality).toBeNull()
        })

        test('returns zero/null metrics for empty regime', () => {
            const m = getRegimeMetrics({ userId: 999999990, resolvedEnv: 'DEMO', regime: 'trend', sinceMs: 0 })
            expect(m.total_count).toBe(0)
            expect(m.hit_rate).toBe(0)
        })
    })

    // ── getAllRegimeMetrics ────────────────────────────────────────
    describe('getAllRegimeMetrics — all regimes at once', () => {
        test('returns object keyed by regime', () => {
            seedTrade({ regime: 'chop', session: 'overlap', pnl_pct: -0.2, score: 0.55 })
            const all = getAllRegimeMetrics({ userId: TEST_USER_ID, resolvedEnv: 'DEMO', sinceMs: 0 })
            expect(typeof all).toBe('object')
            expect(all).toHaveProperty('chop')
            expect(all.chop.total_count).toBeGreaterThan(0)
        })
    })

    // ── getSessionMetrics ──────────────────────────────────────────
    describe('getSessionMetrics — per-session breakdown', () => {
        test('returns metrics for given session', () => {
            seedTrade({ regime: 'trend', session: 'london', pnl_pct: 1.0, score: 0.7 })
            seedTrade({ regime: 'range', session: 'london', pnl_pct: -0.4, score: 0.6 })
            const m = getSessionMetrics({ userId: TEST_USER_ID, resolvedEnv: 'DEMO', session: 'london', sinceMs: 0 })
            expect(m.total_count).toBeGreaterThan(0)
            expect(m.hit_rate).toBeGreaterThan(0)
        })
    })

    // ── getDirectionMetrics ────────────────────────────────────────
    describe('getDirectionMetrics — long vs short breakdown', () => {
        test('returns object with long + short keys', () => {
            seedTrade({ regime: 'trend', session: 'ny', side: 'long', pnl_pct: 0.8, score: 0.7 })
            seedTrade({ regime: 'trend', session: 'ny', side: 'short', pnl_pct: -0.3, score: 0.65 })
            const m = getDirectionMetrics({ userId: TEST_USER_ID, resolvedEnv: 'DEMO', sinceMs: 0 })
            expect(m).toHaveProperty('long')
            expect(m).toHaveProperty('short')
            expect(m.long.total_count).toBeGreaterThan(0)
            expect(m.short.total_count).toBeGreaterThan(0)
        })
    })

    // ── getMetricsByConfidenceBucket ───────────────────────────────
    describe('getMetricsByConfidenceBucket — confidence-banded performance', () => {
        test('returns object with all 4 buckets', () => {
            seedTrade({ regime: 'trend', session: 'ny', pnl_pct: 1.5, score: 0.45 })       // low
            seedTrade({ regime: 'trend', session: 'ny', pnl_pct: 0.7, score: 0.6 })        // mid
            seedTrade({ regime: 'trend', session: 'ny', pnl_pct: 1.2, score: 0.78 })       // high
            seedTrade({ regime: 'trend', session: 'ny', pnl_pct: 1.8, score: 0.9 })        // very_high
            const m = getMetricsByConfidenceBucket({ userId: TEST_USER_ID, resolvedEnv: 'DEMO', sinceMs: 0 })
            for (const b of CONFIDENCE_BUCKETS) {
                expect(m).toHaveProperty(b)
                expect(m[b]).toHaveProperty('n')
                expect(m[b]).toHaveProperty('hit_rate')
            }
            expect(m.high.n).toBeGreaterThan(0)
            expect(m.very_high.n).toBeGreaterThan(0)
        })

        test('returns zero stats per bucket for unknown user', () => {
            const m = getMetricsByConfidenceBucket({ userId: 999999991, resolvedEnv: 'DEMO', sinceMs: 0 })
            for (const b of CONFIDENCE_BUCKETS) {
                expect(m[b].n).toBe(0)
                expect(m[b].hit_rate).toBe(0)
            }
        })
    })
})
