/**
 * R5A Learning Core — counterfactualPortfolio tests (§242 chat-precedent)
 *
 * §242 = chat-precedent addition (2026-04, BEFORE Claude-extras 04-29).
 * NOT in canonical PDF, NOT Claude-extras `*`.
 * Source: project_ml_brain_pro_244.md "242 → R5 (counterfactual portfolio
 * addition)".
 *
 * Before opening a new position: compute counterfactual portfolio that
 * includes the candidate. Score it. ADD only if delta is beneficial AND
 * counterfactual respects all portfolio risk limits (exposure /
 * concentration / correlation).
 *
 * Pure logic — NO migration, NO DB writes. Operates on input data.
 */

const {
    THRESHOLDS,
    RECOMMENDATIONS,
    computeCounterfactualPortfolio,
    scorePortfolio,
    estimateCorrelation,
    evaluateAddition
} = require('../../../server/services/ml/R5A_learning/counterfactualPortfolio')

describe('R5A — counterfactualPortfolio (§242 chat-precedent)', () => {
    // ── Exported constants ─────────────────────────────────────────
    describe('Exported constants', () => {
        test('THRESHOLDS shape', () => {
            expect(THRESHOLDS).toHaveProperty('max_total_exposure_pct')
            expect(THRESHOLDS).toHaveProperty('max_concentration_pct')
            expect(THRESHOLDS).toHaveProperty('max_correlation')
            expect(THRESHOLDS).toHaveProperty('min_score_delta')
            expect(THRESHOLDS.max_total_exposure_pct).toBe(5.0)
            expect(THRESHOLDS.max_concentration_pct).toBe(2.0)
            expect(THRESHOLDS.max_correlation).toBe(0.8)
        })

        test('RECOMMENDATIONS = [ADD, SKIP]', () => {
            expect(RECOMMENDATIONS).toEqual(['ADD', 'SKIP'])
        })
    })

    // ── estimateCorrelation ────────────────────────────────────────
    describe('estimateCorrelation', () => {
        test('returns 1.0 for same symbol', () => {
            expect(estimateCorrelation('BTCUSDT', 'BTCUSDT')).toBe(1.0)
        })

        test('returns ~0.95 for same family (BTCUSDT vs BTCUSDC)', () => {
            expect(estimateCorrelation('BTCUSDT', 'BTCUSDC')).toBeCloseTo(0.95, 2)
        })

        test('returns ~0.7 for both major (BTC vs ETH)', () => {
            const c = estimateCorrelation('BTCUSDT', 'ETHUSDT')
            expect(c).toBeGreaterThan(0.6)
            expect(c).toBeLessThan(0.8)
        })

        test('returns ~0.5 for major + alt', () => {
            const c = estimateCorrelation('BTCUSDT', 'XRPUSDT')
            expect(c).toBeGreaterThan(0.4)
            expect(c).toBeLessThan(0.65)
        })

        test('returns ~0.3 for two unrelated alts', () => {
            const c = estimateCorrelation('XRPUSDT', 'DOGEUSDT')
            expect(c).toBeGreaterThan(0.2)
            expect(c).toBeLessThan(0.4)
        })

        test('bounded to [0, 1]', () => {
            expect(estimateCorrelation('BTC', 'random_string_xyz')).toBeGreaterThanOrEqual(0)
            expect(estimateCorrelation('BTCUSDT', 'BTCUSDT')).toBeLessThanOrEqual(1)
        })

        test('throws on missing args', () => {
            expect(() => estimateCorrelation(null, 'BTC')).toThrow()
            expect(() => estimateCorrelation('BTC', null)).toThrow()
        })
    })

    // ── computeCounterfactualPortfolio ─────────────────────────────
    describe('computeCounterfactualPortfolio', () => {
        test('returns current + candidate appended', () => {
            const current = [
                { symbol: 'BTCUSDT', side: 'long', sizeUsd: 100, score: 0.7 }
            ]
            const candidate = { symbol: 'ETHUSDT', side: 'long', sizeUsd: 50, score: 0.65 }
            const portfolio = computeCounterfactualPortfolio({
                currentPositions: current, candidate
            })
            expect(portfolio.length).toBe(2)
            expect(portfolio[1].symbol).toBe('ETHUSDT')
        })

        test('handles empty current portfolio', () => {
            const candidate = { symbol: 'BTCUSDT', side: 'long', sizeUsd: 100, score: 0.7 }
            const portfolio = computeCounterfactualPortfolio({
                currentPositions: [], candidate
            })
            expect(portfolio.length).toBe(1)
        })

        test('throws on missing candidate', () => {
            expect(() => computeCounterfactualPortfolio({ currentPositions: [] })).toThrow()
        })
    })

    // ── scorePortfolio ─────────────────────────────────────────────
    describe('scorePortfolio', () => {
        test('returns expected shape', () => {
            const portfolio = [
                { symbol: 'BTCUSDT', side: 'long', sizeUsd: 100, score: 0.7 },
                { symbol: 'ETHUSDT', side: 'long', sizeUsd: 50, score: 0.65 }
            ]
            const score = scorePortfolio(portfolio, 10000)
            expect(score).toHaveProperty('total_exposure_pct')
            expect(score).toHaveProperty('max_concentration_pct')
            expect(score).toHaveProperty('max_correlation_pair')
            expect(score).toHaveProperty('avg_score')
            expect(score).toHaveProperty('position_count')
            expect(score).toHaveProperty('score')
        })

        test('total_exposure_pct = sum sizes / balance × 100', () => {
            const portfolio = [
                { symbol: 'BTC', side: 'long', sizeUsd: 100, score: 0.5 },
                { symbol: 'ETH', side: 'long', sizeUsd: 50, score: 0.5 }
            ]
            const score = scorePortfolio(portfolio, 1000)
            expect(score.total_exposure_pct).toBeCloseTo(15, 1)
        })

        test('max_concentration_pct = largest single position / balance × 100', () => {
            const portfolio = [
                { symbol: 'BTC', side: 'long', sizeUsd: 100, score: 0.5 },
                { symbol: 'ETH', side: 'long', sizeUsd: 250, score: 0.5 }
            ]
            const score = scorePortfolio(portfolio, 1000)
            expect(score.max_concentration_pct).toBeCloseTo(25, 1)
        })

        test('max_correlation_pair captures highest pair correlation', () => {
            const portfolio = [
                { symbol: 'BTCUSDT', side: 'long', sizeUsd: 100, score: 0.7 },
                { symbol: 'BTCUSDC', side: 'long', sizeUsd: 100, score: 0.65 }  // same family
            ]
            const score = scorePortfolio(portfolio, 1000)
            expect(score.max_correlation_pair.correlation).toBeGreaterThan(0.9)
        })

        test('avg_score = mean of position scores', () => {
            const portfolio = [
                { symbol: 'BTC', side: 'long', sizeUsd: 100, score: 0.6 },
                { symbol: 'ETH', side: 'long', sizeUsd: 100, score: 0.8 }
            ]
            const score = scorePortfolio(portfolio, 1000)
            expect(score.avg_score).toBeCloseTo(0.7, 2)
        })

        test('empty portfolio → zero metrics', () => {
            const score = scorePortfolio([], 1000)
            expect(score.total_exposure_pct).toBe(0)
            expect(score.position_count).toBe(0)
            expect(score.avg_score).toBe(0)
        })

        test('throws if balance <= 0', () => {
            expect(() => scorePortfolio([], 0)).toThrow(/balance/i)
            expect(() => scorePortfolio([], -100)).toThrow(/balance/i)
        })
    })

    // ── evaluateAddition ───────────────────────────────────────────
    describe('evaluateAddition', () => {
        test('returns ADD when candidate improves portfolio without breaching limits', () => {
            const current = [
                { symbol: 'BTCUSDT', side: 'long', sizeUsd: 100, score: 0.6 }
            ]
            const candidate = { symbol: 'XRPUSDT', side: 'long', sizeUsd: 50, score: 0.75 }
            const result = evaluateAddition({
                currentPositions: current, candidate, balance: 10000
            })
            expect(result.recommendation).toBe('ADD')
            expect(result.violations.length).toBe(0)
        })

        test('returns SKIP when total exposure breach', () => {
            const current = [
                { symbol: 'BTCUSDT', side: 'long', sizeUsd: 400, score: 0.7 }
            ]
            // Balance 10000 → 4% used. Candidate 200 → 6% total > 5% cap.
            const candidate = { symbol: 'ETHUSDT', side: 'long', sizeUsd: 200, score: 0.7 }
            const result = evaluateAddition({
                currentPositions: current, candidate, balance: 10000
            })
            expect(result.recommendation).toBe('SKIP')
            expect(result.violations).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: 'total_exposure' })
            ]))
        })

        test('returns SKIP when concentration breach', () => {
            const candidate = { symbol: 'BTCUSDT', side: 'long', sizeUsd: 250, score: 0.7 }
            // Candidate alone = 2.5% of 10000 > 2% cap
            const result = evaluateAddition({
                currentPositions: [], candidate, balance: 10000
            })
            expect(result.recommendation).toBe('SKIP')
            expect(result.violations).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: 'concentration' })
            ]))
        })

        test('returns SKIP when correlation breach (duplicate exposure)', () => {
            const current = [
                { symbol: 'BTCUSDT', side: 'long', sizeUsd: 100, score: 0.7 }
            ]
            const candidate = { symbol: 'BTCUSDC', side: 'long', sizeUsd: 100, score: 0.7 }  // ~0.95 correlation
            const result = evaluateAddition({
                currentPositions: current, candidate, balance: 10000
            })
            expect(result.recommendation).toBe('SKIP')
            expect(result.violations).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: 'correlation' })
            ]))
        })

        test('result includes current_metrics, counterfactual_metrics, delta', () => {
            const result = evaluateAddition({
                currentPositions: [],
                candidate: { symbol: 'BTC', side: 'long', sizeUsd: 100, score: 0.7 },
                balance: 10000
            })
            expect(result).toHaveProperty('current_metrics')
            expect(result).toHaveProperty('counterfactual_metrics')
            expect(result).toHaveProperty('delta')
        })

        test('accepts custom thresholds override', () => {
            const candidate = { symbol: 'BTC', side: 'long', sizeUsd: 100, score: 0.7 }
            // Strict: max_concentration_pct = 0.5%, candidate alone = 1%
            const result = evaluateAddition({
                currentPositions: [], candidate, balance: 10000,
                thresholds: { max_concentration_pct: 0.5 }
            })
            expect(result.recommendation).toBe('SKIP')
        })

        test('throws on missing required fields', () => {
            expect(() => evaluateAddition({})).toThrow()
        })
    })
})
