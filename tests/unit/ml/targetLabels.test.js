/**
 * R5A Learning Core — targetLabels tests (canonical §11)
 *
 * "Brain-ul trebuie sa aiba definit explicit ce prezice."
 *
 * §11 = foundational definitional point. Enums + label classifier + output
 * action validator. No DB writes, pure logic. Used by other rings to map
 * concrete trade outcomes to canonical label vocabulary.
 */

const {
    TARGET_FORMULATIONS,
    FORECAST_HORIZONS,
    LABELS,
    OUTPUT_ACTIONS,
    classifyLabel,
    validateOutput,
    isValidAction
} = require('../../../server/services/ml/R5A_learning/targetLabels')

describe('R5A — targetLabels (canonical §11)', () => {
    // ── Exported enums ─────────────────────────────────────────────
    describe('TARGET_FORMULATIONS — §11.A', () => {
        test('has 3 spec formulations', () => {
            expect(TARGET_FORMULATIONS).toEqual([
                'p_tp_before_sl',
                'p_x_atr_in_y_window',
                'p_directional_confirm_after_costs'
            ])
        })
    })

    describe('FORECAST_HORIZONS — §11.B', () => {
        test('has 4 spec horizons', () => {
            expect(FORECAST_HORIZONS).toEqual([
                'ultra-short', 'short', 'intraday', 'swing-short'
            ])
        })
    })

    describe('LABELS — §11.C', () => {
        test('has 7 spec labels', () => {
            expect(LABELS).toEqual([
                'win_structural',
                'loss_structural',
                'invalidated_quick',
                'stagnation_no_follow',
                'fake_breakout',
                'reclaim_valid',
                'no_edge_no_trade'
            ])
        })
    })

    describe('OUTPUT_ACTIONS — §11.D', () => {
        test('has 5 spec actions', () => {
            expect(OUTPUT_ACTIONS).toEqual([
                'LONG', 'SHORT', 'NO_TRADE', 'WAIT', 'EXIT'
            ])
        })
    })

    // ── classifyLabel ──────────────────────────────────────────────
    describe('classifyLabel(trade, snapshot)', () => {
        test('no_edge_no_trade for ABSTAIN trades', () => {
            expect(classifyLabel({ abstain: true }, {})).toBe('no_edge_no_trade')
        })

        test('win_structural for WIN + high score + clean execution', () => {
            const trade = { pnl_pct: 1.2, closed_by: 'tp', score_at_entry: 0.78, time_in_trade_min: 60 }
            const snap = { mfe: 1.4, mae: 0.3 }
            expect(classifyLabel(trade, snap)).toBe('win_structural')
        })

        test('loss_structural for LOSS + high score (good process, market wrong)', () => {
            const trade = { pnl_pct: -0.9, closed_by: 'sl', score_at_entry: 0.75, time_in_trade_min: 45 }
            const snap = { mfe: 0.2, mae: 0.95 }
            expect(classifyLabel(trade, snap)).toBe('loss_structural')
        })

        test('invalidated_quick when stopped out within first 5 minutes', () => {
            const trade = { pnl_pct: -0.7, closed_by: 'sl', score_at_entry: 0.7, time_in_trade_min: 2 }
            const snap = { mfe: 0.0, mae: 0.7 }
            expect(classifyLabel(trade, snap)).toBe('invalidated_quick')
        })

        test('stagnation_no_follow when MFE never developed and ended in BREAKEVEN/LOSS', () => {
            // No follow-through: low MFE, moderate-to-long time-in-trade, BE/loss
            const trade = { pnl_pct: -0.02, closed_by: 'timeout', score_at_entry: 0.65, time_in_trade_min: 90 }
            const snap = { mfe: 0.15, mae: 0.4 }
            expect(classifyLabel(trade, snap)).toBe('stagnation_no_follow')
        })

        test('fake_breakout when entered breakout setup and reversed quickly', () => {
            const trade = {
                pnl_pct: -0.6, closed_by: 'sl', score_at_entry: 0.7,
                time_in_trade_min: 8, setup_type: 'breakout'
            }
            const snap = { mfe: 0.05, mae: 0.65 }
            expect(classifyLabel(trade, snap)).toBe('fake_breakout')
        })

        test('reclaim_valid when entered post-reclaim and worked out', () => {
            const trade = {
                pnl_pct: 1.0, closed_by: 'tp', score_at_entry: 0.7,
                time_in_trade_min: 40, setup_type: 'reclaim'
            }
            const snap = { mfe: 1.1, mae: 0.2 }
            expect(classifyLabel(trade, snap)).toBe('reclaim_valid')
        })

        test('throws on missing trade', () => {
            expect(() => classifyLabel(null, {})).toThrow()
        })
    })

    // ── validateOutput / isValidAction ─────────────────────────────
    describe('validateOutput / isValidAction', () => {
        test('accepts all 5 OUTPUT_ACTIONS values', () => {
            for (const a of OUTPUT_ACTIONS) {
                expect(isValidAction(a)).toBe(true)
                expect(() => validateOutput(a)).not.toThrow()
            }
        })

        test('rejects unknown actions', () => {
            expect(isValidAction('HOLD')).toBe(false)
            expect(isValidAction('CLOSE')).toBe(false)
            expect(isValidAction(null)).toBe(false)
            expect(isValidAction('')).toBe(false)
            expect(() => validateOutput('INVALID')).toThrow(/OUTPUT_ACTIONS/)
        })

        test('isValidAction is case-sensitive', () => {
            expect(isValidAction('long')).toBe(false)
            expect(isValidAction('Short')).toBe(false)
        })
    })
})
