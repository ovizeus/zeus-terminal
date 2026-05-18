'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-mlib-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

require('../../../server/services/database');
const builder = require('../../../server/services/ml/_ring5/mlInputsBuilder');

function _fusion(over = {}) {
    return {
        dir: 'LONG', confidence: 70, score: 5, reasons: [], ts: Date.now(),
        _intermediates: {
            modifiers: {
                structure: 1.0, liquidity: 1.0, liqAnticipation: 1.0,
                journal: 1.0, knn: 1.0, session: 1.0, volatility: 1.0,
                tilt: 1.0, trapRisk: 1.0, regimeDanger: 1.0,
            },
            fusRegimeScore: 0.5, fusAlignScore: 0.5,
            fusIndScore: 0.5, fusMtfScore: 0.5,
            fusStructScore: 0.5, fusFlowScore: 0.5, fusSentScore: 0.5,
            ...over._intermediates
        },
        ...over
    };
}

describe('mlInputsBuilder.build', () => {
    test('returns null when fusion missing _intermediates', () => {
        const r = builder.build({ confidence: 70 });
        expect(r).toBeNull();
    });

    test('returns null when no modifiers AND no score components', () => {
        const r = builder.build({ _intermediates: {} });
        expect(r).toBeNull();
    });

    test('all neutral modifiers + neutral scores -> zero sum', () => {
        const r = builder.build(_fusion());
        expect(r).not.toBeNull();
        const sum = r.contributions.reduce((s, c) => s + c.contribution, 0);
        expect(Math.abs(sum)).toBeLessThan(0.01);  // ~0 (might have tiny float noise)
    });

    test('boost modifier (1.08) maps to positive contribution', () => {
        const f = _fusion({ _intermediates: { modifiers: { structure: 1.08, liquidity: 1.0, liqAnticipation: 1.0, journal: 1.0, knn: 1.0, session: 1.0, volatility: 1.0, tilt: 1.0, trapRisk: 1.0, regimeDanger: 1.0 } } });
        const r = builder.build(f);
        const structContrib = r.contributions.find(c => c.moduleId === 'mod_structure');
        expect(structContrib).toBeDefined();
        expect(structContrib.contribution).toBeCloseTo(0.08, 4);
    });

    test('cut modifier (0.85) maps to negative contribution', () => {
        const f = _fusion({ _intermediates: { modifiers: { structure: 0.85, liquidity: 1.0, liqAnticipation: 1.0, journal: 1.0, knn: 1.0, session: 1.0, volatility: 1.0, tilt: 1.0, trapRisk: 1.0, regimeDanger: 1.0 } } });
        const r = builder.build(f);
        const structContrib = r.contributions.find(c => c.moduleId === 'mod_structure');
        expect(structContrib.contribution).toBeCloseTo(-0.15, 4);
    });

    test('clamps individual contribution to [-1, +1]', () => {
        const f = _fusion({ _intermediates: { modifiers: { structure: 5.0, liquidity: -2.0, liqAnticipation: 1.0, journal: 1.0, knn: 1.0, session: 1.0, volatility: 1.0, tilt: 1.0, trapRisk: 1.0, regimeDanger: 1.0 } } });
        const r = builder.build(f);
        const s = r.contributions.find(c => c.moduleId === 'mod_structure');
        const l = r.contributions.find(c => c.moduleId === 'mod_liquidity');
        expect(s.contribution).toBeLessThanOrEqual(1.0);
        expect(l.contribution).toBeGreaterThanOrEqual(-1.0);
    });

    test('falls back to score components if modifiers all neutral AND scores meaningful', () => {
        const f = _fusion({ _intermediates: {
            modifiers: { structure: 1.0, liquidity: 1.0, liqAnticipation: 1.0, journal: 1.0, knn: 1.0, session: 1.0, volatility: 1.0, tilt: 1.0, trapRisk: 1.0, regimeDanger: 1.0 },
            fusRegimeScore: 0.8, fusAlignScore: 0.7, fusIndScore: 0.5, fusMtfScore: 0.5, fusStructScore: 0.5, fusFlowScore: 0.5, fusSentScore: 0.5
        }});
        const r = builder.build(f);
        // Both modifiers (10) AND score components (7) -> 17 contributions
        expect(r.contributions.length).toBeGreaterThanOrEqual(10);
        const reg = r.contributions.find(c => c.moduleId === 'fus_regime');
        expect(reg).toBeDefined();
        expect(reg.contribution).toBeCloseTo(0.6, 2); // (0.8 - 0.5) * 2 = 0.6
    });

    test('skips non-finite modifier values', () => {
        const f = _fusion({ _intermediates: { modifiers: { structure: NaN, liquidity: 1.05, liqAnticipation: 1.0, journal: 1.0, knn: 1.0, session: 1.0, volatility: 1.0, tilt: 1.0, trapRisk: 1.0, regimeDanger: 1.0 } } });
        const r = builder.build(f);
        const struct = r.contributions.find(c => c.moduleId === 'mod_structure');
        expect(struct).toBeUndefined();  // skipped
        const liq = r.contributions.find(c => c.moduleId === 'mod_liquidity');
        expect(liq).toBeDefined();
        expect(liq.contribution).toBeCloseTo(0.05, 4);
    });
});
